'use strict';

// Fixtures for the serialized event.json updater — real filesystem, isolated tmp
// dir per run, no Electron. Run with: node test/eventJsonStore.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { updateEventJsonAtomic } = require('../main/eventJsonStore');

let passed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    console.error(`  FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function makeEventJson(dir, doc) {
  const p = path.join(dir, 'event.json');
  fs.writeFileSync(p, JSON.stringify(doc, null, 2), 'utf8');
  return p;
}

async function main() {
  console.log('eventJsonStore');

  await t('mutator partial-update preserves every unrelated/unknown field', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ejs-'));
    const p = makeEventJson(dir, {
      version: 1, hijriDate: '1448-01-16', sequence: 1, eventName: 'Urs Majlis',
      components: [], status: 'created',
      lastMetadataRun: { status: 'applied', processed: 10 },
      metadataGroups: [{ id: 'g1', metadataTags: ['Majlis'] }],
      someFutureFieldThisModuleHasNeverHeardOf: { nested: true },
    });

    await updateEventJsonAtomic(p, () => ({ status: 'complete' }));

    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(doc.status, 'complete');
    assert.equal(doc.eventName, 'Urs Majlis');
    assert.deepEqual(doc.lastMetadataRun, { status: 'applied', processed: 10 });
    assert.deepEqual(doc.metadataGroups, [{ id: 'g1', metadataTags: ['Majlis'] }]);
    assert.deepEqual(doc.someFutureFieldThisModuleHasNeverHeardOf, { nested: true });
  });

  await t('concurrent overlapping writes to the same path both survive (no lost update)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ejs-'));
    const p = makeEventJson(dir, { version: 1, eventName: 'Event', status: 'created' });

    // Simulate an event-edit save and a metadata-completion write firing at the same
    // time — both mutators read a snapshot before either write lands, but the shared
    // in-process chain must still serialize the actual writes so neither is lost.
    const editWrite = updateEventJsonAtomic(p, async (doc) => {
      await new Promise(r => setTimeout(r, 20));
      return { eventName: 'Renamed Event' };
    });
    const metadataWrite = updateEventJsonAtomic(p, async (doc) => {
      return { lastMetadataRun: { status: 'applied', processed: 5 } };
    });

    await Promise.all([editWrite, metadataWrite]);

    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(doc.eventName, 'Renamed Event');
    assert.deepEqual(doc.lastMetadataRun, { status: 'applied', processed: 5 });
  });

  await t('a rejected mutator does not jam the per-path chain for the next caller', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ejs-'));
    const p = makeEventJson(dir, { version: 1, status: 'created' });

    await assert.rejects(() => updateEventJsonAtomic(p, () => {
      throw new Error('simulated mutator failure');
    }));

    await updateEventJsonAtomic(p, () => ({ status: 'complete' }));
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(doc.status, 'complete');
  });

  await t('mutator must return a partial-update object, not the whole document', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ejs-'));
    const p = makeEventJson(dir, { version: 1, status: 'created' });
    await assert.rejects(
      () => updateEventJsonAtomic(p, () => null),
      /must return a partial-update object/
    );
  });

  // Faithful copy of main/main.js's updateEventJson() full-payload mutator (the
  // isFullPayload branch, keep in sync with that function — not exported for direct
  // import since main.js isn't structured as a module). Proves the real production
  // merge shape, not a reimplementation of a different one.
  function fullPayloadChanges(payload) {
    return {
      version:       payload.version ?? 1,
      hijriDate:     payload.hijriDate,
      sequence:       typeof payload.sequence === 'number' ? payload.sequence : parseInt(payload.sequence, 10),
      eventName:     payload.eventName,
      safeEventName: payload.safeEventName,
      status:        payload.status ?? 'created',
      components:    payload.components,
      ...(payload.adoption != null ? { adoption: payload.adoption } : {}),
      updatedAt:     payload.updatedAt ?? Date.now(),
    };
  }

  await t('editing a complete event\'s descriptive fields preserves status:"complete" (renderer now threads _viewingExisting.status through instead of hardcoding "created")', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ejs-'));
    const p = makeEventJson(dir, {
      version: 1, hijriDate: '1448-01-16', sequence: 1, eventName: 'Waaz Mubarak',
      safeEventName: 'Waaz Mubarak', components: [], status: 'complete',
      lastMetadataRun: { status: 'applied', processed: 10 },
    });

    // Mirrors renderer/eventCreator.js's fixed noRenamePayload/renamePayload
    // construction: status now comes from _viewingExisting.status (the event's real
    // on-disk status, read back from the scanner) rather than a hardcoded literal.
    const existingStatus = 'complete'; // stands in for _viewingExisting.status
    const editSavePayload = {
      eventName: 'Waaz Mubarak (Edited)', safeEventName: 'Waaz Mubarak (Edited)',
      hijriDate: '1448-01-16', sequence: 1, components: [],
      status: existingStatus || 'created',
    };

    await updateEventJsonAtomic(p, () => fullPayloadChanges(editSavePayload));

    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(doc.status, 'complete', 'editing descriptive fields must never revert a complete event to created');
    assert.equal(doc.eventName, 'Waaz Mubarak (Edited)');
    assert.deepEqual(doc.lastMetadataRun, { status: 'applied', processed: 10 }, 'unrelated fields still survive');
  });

  await t('a legacy event with no existing status yet still defaults to "created" on first repair-write', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ejs-'));
    // No status field at all — simulates a legacy event.json being repaired for the
    // first time (services/eventCreator.js's _repairLegacyEvent call site, which
    // legitimately still sends an explicit status:'created' payload for this case).
    const p = makeEventJson(dir, { version: 1, hijriDate: '1448-01-16', sequence: 1, eventName: 'Legacy' });

    await updateEventJsonAtomic(p, () => fullPayloadChanges({
      eventName: 'Legacy', safeEventName: 'Legacy', hijriDate: '1448-01-16', sequence: 1,
      components: [{ id: 1, types: [], location: null, city: '', isUnresolved: true }],
      status: 'created',
    }));

    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(doc.status, 'created');
  });

  console.log(`${passed} passed`);
  if (process.exitCode) console.log('SOME TESTS FAILED');
}

main();
