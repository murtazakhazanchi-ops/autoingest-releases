'use strict';

// Fixtures for the durable manifest+journal queue store — real filesystem, isolated
// tmp dir per run, no Electron (AUTOINGEST_METADATA_QUEUE_DIR overrides app.getPath).
// Run with: node test/metadataQueueStore.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

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

function freshQueueDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqs-'));
  process.env.AUTOINGEST_METADATA_QUEUE_DIR = dir;
  delete require.cache[require.resolve('../main/metadataQueueStore')];
  return require('../main/metadataQueueStore');
}

async function main() {
  console.log('metadataQueueStore');

  await t('writeManifestOnce is immutable — a second call for the same batchId is a no-op', async () => {
    const store = freshQueueDir();
    await store.writeManifestOnce('b1', { schemaVersion: 1, batchId: 'b1', files: [{ dest: 'x' }] });
    await store.writeManifestOnce('b1', { schemaVersion: 1, batchId: 'b1', files: [{ dest: 'DIFFERENT' }] });
    const manifest = await store.readManifest('b1');
    assert.equal(manifest.files[0].dest, 'x');
  });

  await t('appendJournalEntry + readJournal round-trips in order', async () => {
    const store = freshQueueDir();
    await store.appendJournalEntry('b1', { dest: '/a', status: 'writing' });
    await store.appendJournalEntry('b1', { dest: '/a', status: 'complete' });
    const entries = await store.readJournal('b1');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].status, 'writing');
    assert.equal(entries[1].status, 'complete');
    assert.ok(entries[0].ts);
  });

  await t('corrupt journal lines are quarantined, not dropped silently or fatal', async () => {
    const store = freshQueueDir();
    await store.appendJournalEntry('b1', { dest: '/a', status: 'complete' });
    // Hand-inject a corrupt line directly, simulating a torn write.
    const dir = process.env.AUTOINGEST_METADATA_QUEUE_DIR;
    fs.appendFileSync(path.join(dir, 'b1.journal.jsonl'), 'not valid json{{{\n', 'utf8');
    const entries = await store.readJournal('b1');
    assert.equal(entries.length, 1);
    assert.ok(fs.existsSync(path.join(dir, 'b1.journal.jsonl.quarantine')));
  });

  await t('computeFileStates: no journal entry → interrupted', async () => {
    const store = freshQueueDir();
    const manifest = { files: [{ dest: '/a' }, { dest: '/b' }] };
    const states = store.computeFileStates(manifest, []);
    assert.equal(states.get('/a').status, 'interrupted');
    assert.equal(states.get('/b').status, 'interrupted');
  });

  await t('computeFileStates: last entry non-terminal (writing) → interrupted', async () => {
    const store = freshQueueDir();
    const manifest = { files: [{ dest: '/a' }] };
    const journal = [{ ts: '2026-01-01T00:00:00.000Z', dest: '/a', status: 'writing' }];
    const states = store.computeFileStates(manifest, journal);
    assert.equal(states.get('/a').status, 'interrupted');
  });

  await t('computeFileStates: last entry terminal → that terminal status', async () => {
    const store = freshQueueDir();
    const manifest = { files: [{ dest: '/a' }] };
    const journal = [
      { ts: '2026-01-01T00:00:00.000Z', dest: '/a', status: 'writing' },
      { ts: '2026-01-01T00:00:01.000Z', dest: '/a', status: 'complete' },
    ];
    const states = store.computeFileStates(manifest, journal);
    assert.equal(states.get('/a').status, 'complete');
  });

  await t('computeFileStates picks the latest entry by timestamp, not array order', async () => {
    const store = freshQueueDir();
    const manifest = { files: [{ dest: '/a' }] };
    const journal = [
      { ts: '2026-01-01T00:00:02.000Z', dest: '/a', status: 'complete' },
      { ts: '2026-01-01T00:00:01.000Z', dest: '/a', status: 'writing' },
    ];
    const states = store.computeFileStates(manifest, journal);
    assert.equal(states.get('/a').status, 'complete');
  });

  await t('listActiveBatchIds lists every manifest present', async () => {
    const store = freshQueueDir();
    await store.writeManifestOnce('b1', { batchId: 'b1', files: [] });
    await store.writeManifestOnce('b2', { batchId: 'b2', files: [] });
    const ids = (await store.listActiveBatchIds()).sort();
    assert.deepEqual(ids, ['b1', 'b2']);
  });

  await t('compactBatch removes the batch from the active list and preserves its files', async () => {
    const store = freshQueueDir();
    await store.writeManifestOnce('b1', { batchId: 'b1', files: [{ dest: '/a' }] });
    await store.appendJournalEntry('b1', { dest: '/a', status: 'complete' });
    await store.compactBatch('b1');
    const ids = await store.listActiveBatchIds();
    assert.deepEqual(ids, []);
    const dir = process.env.AUTOINGEST_METADATA_QUEUE_DIR;
    const compactedManifest = JSON.parse(fs.readFileSync(path.join(dir, 'compacted', 'b1.manifest.json'), 'utf8'));
    assert.equal(compactedManifest.batchId, 'b1');
    const compactedJournal = fs.readFileSync(path.join(dir, 'compacted', 'b1.journal.jsonl'), 'utf8');
    assert.match(compactedJournal, /"status":"complete"/);
  });

  await t('readRootIdentity returns null for a missing marker, the marker fields when present', async () => {
    const store = freshQueueDir();
    const missing = await store.readRootIdentity('/no/such/marker.json');
    assert.equal(missing, null);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqs-marker-'));
    const markerPath = path.join(dir, 'archive-root.json');
    fs.writeFileSync(markerPath, JSON.stringify({ type: 'autoingest-nas-root', createdAt: '2026-01-01T00:00:00.000Z' }));
    const identity = await store.readRootIdentity(markerPath);
    assert.deepEqual(identity, { type: 'autoingest-nas-root', createdAt: '2026-01-01T00:00:00.000Z' });
  });

  // ── pruneCompactedBatches (retention policy) ───────────────────────────────

  function setMtime(filePath, msAgo) {
    const t = new Date(Date.now() - msAgo);
    fs.utimesSync(filePath, t, t);
  }

  await t('pruneCompactedBatches: a recently-compacted batch (within retention) is kept', async () => {
    const store = freshQueueDir();
    await store.writeManifestOnce('recent', { batchId: 'recent', files: [{ dest: '/a' }] });
    await store.appendJournalEntry('recent', { dest: '/a', status: 'complete' });
    await store.compactBatch('recent');

    const dir = process.env.AUTOINGEST_METADATA_QUEUE_DIR;
    const manifestPath = path.join(dir, 'compacted', 'recent.manifest.json');
    setMtime(manifestPath, 1000); // 1 second old — nowhere near 90 days.

    const summary = await store.pruneCompactedBatches(90 * 24 * 60 * 60 * 1000);
    assert.ok(summary.scanned >= 1);
    assert.equal(summary.deleted, 0, 'a recent compacted file must survive pruning');
    assert.ok(fs.existsSync(manifestPath));
  });

  await t('pruneCompactedBatches: a batch older than the retention window is deleted', async () => {
    const store = freshQueueDir();
    await store.writeManifestOnce('old', { batchId: 'old', files: [{ dest: '/a' }] });
    await store.appendJournalEntry('old', { dest: '/a', status: 'complete' });
    await store.compactBatch('old');

    const dir = process.env.AUTOINGEST_METADATA_QUEUE_DIR;
    const manifestPath = path.join(dir, 'compacted', 'old.manifest.json');
    const journalPath = path.join(dir, 'compacted', 'old.journal.jsonl');
    const FAR_PAST = 200 * 24 * 60 * 60 * 1000; // 200 days — well past a 90-day retention.
    setMtime(manifestPath, FAR_PAST);
    setMtime(journalPath, FAR_PAST);

    const summary = await store.pruneCompactedBatches(90 * 24 * 60 * 60 * 1000);
    assert.equal(summary.deleted, 2, 'both the expired manifest and journal must be deleted');
    assert.equal(summary.failed, 0);
    assert.equal(fs.existsSync(manifestPath), false);
    assert.equal(fs.existsSync(journalPath), false);
  });

  await t('pruneCompactedBatches: a malformed (unparseable) compacted file is still pruned safely by age, never crashes the sweep', async () => {
    const store = freshQueueDir();
    const dir = process.env.AUTOINGEST_METADATA_QUEUE_DIR;
    await fsp.mkdir(path.join(dir, 'compacted'), { recursive: true });
    const malformedPath = path.join(dir, 'compacted', 'garbled.manifest.json');
    fs.writeFileSync(malformedPath, 'not valid json at all {{{', 'utf8');
    setMtime(malformedPath, 200 * 24 * 60 * 60 * 1000);

    const summary = await store.pruneCompactedBatches(90 * 24 * 60 * 60 * 1000);
    assert.equal(summary.failed, 0, 'a malformed file must not be reported as a failure — age-based pruning never parses content');
    assert.equal(summary.deleted, 1);
    assert.equal(fs.existsSync(malformedPath), false);
  });

  await t('pruneCompactedBatches: an ACTIVE batch (not yet compacted) is never touched, even if very old', async () => {
    const store = freshQueueDir();
    await store.writeManifestOnce('still-active', { batchId: 'still-active', files: [{ dest: '/a' }] });
    await store.appendJournalEntry('still-active', { dest: '/a', status: 'writing' }); // never completed/compacted.

    const dir = process.env.AUTOINGEST_METADATA_QUEUE_DIR;
    const activeManifest = path.join(dir, 'still-active.manifest.json');
    const activeJournal = path.join(dir, 'still-active.journal.jsonl');
    setMtime(activeManifest, 365 * 24 * 60 * 60 * 1000); // a full year old — still must never be pruned.
    setMtime(activeJournal, 365 * 24 * 60 * 60 * 1000);

    await store.pruneCompactedBatches(90 * 24 * 60 * 60 * 1000);

    assert.ok(fs.existsSync(activeManifest), 'an active (non-compacted) manifest must never be deleted by retention pruning');
    assert.ok(fs.existsSync(activeJournal), 'an active (non-compacted) journal must never be deleted by retention pruning');
    const ids = await store.listActiveBatchIds();
    assert.deepEqual(ids, ['still-active'], 'the batch must still be resumable/recoverable after a prune sweep');
  });

  await t('pruneCompactedBatches: missing compacted/ directory (nothing ever compacted yet) is a safe no-op, not an error', async () => {
    const store = freshQueueDir(); // fresh dir — compacted/ was never created.
    const summary = await store.pruneCompactedBatches();
    assert.deepEqual(summary, { scanned: 0, deleted: 0, failed: 0 });
  });

  await t('COMPACTED_RETENTION_MS is exported as the single named constant defining the default', async () => {
    const store = freshQueueDir();
    assert.equal(store.COMPACTED_RETENTION_MS, 90 * 24 * 60 * 60 * 1000);
  });

  console.log(`${passed} passed`);
  if (process.exitCode) console.log('SOME TESTS FAILED');
}

main();
