'use strict';

// Fixtures for the durable metadata-state decision tree + counts aggregation.
// Real filesystem, isolated tmp dir per run, no Electron
// (AUTOINGEST_METADATA_QUEUE_DIR overrides app.getPath). Run with:
//   node test/metadataStateService.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
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

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mss-'));
  process.env.AUTOINGEST_METADATA_QUEUE_DIR = dir;
  delete require.cache[require.resolve('../main/metadataQueueStore')];
  delete require.cache[require.resolve('../main/metadataStateService')];
  delete require.cache[require.resolve('../main/eventJsonStore')];
  const store = require('../main/metadataQueueStore');
  const stateService = require('../main/metadataStateService');
  return { store, stateService, dir };
}

function baseCounts(overrides) {
  return {
    eligible: 0, complete: 0, failed: 0, ambiguous: 0, stale: 0,
    verificationRequired: 0, queued: 0, active: 0, interrupted: 0,
    ...overrides,
  };
}

async function main() {
  console.log('metadataStateService');

  const { stateService } = fresh();

  await t('deriveState: no eligible files → metadata-not-required', () => {
    assert.equal(stateService.deriveState(baseCounts({ eligible: 0 })), 'metadata-not-required');
  });

  await t('deriveState: interrupted takes priority over everything else', () => {
    assert.equal(
      stateService.deriveState(baseCounts({ eligible: 5, complete: 5, interrupted: 1 })),
      'metadata-interrupted'
    );
  });

  await t('deriveState: active takes priority over complete/failed', () => {
    assert.equal(
      stateService.deriveState(baseCounts({ eligible: 5, complete: 4, active: 1 })),
      'metadata-in-progress'
    );
  });

  await t('deriveState: every eligible file complete → metadata-complete', () => {
    assert.equal(
      stateService.deriveState(baseCounts({ eligible: 3, complete: 3 })),
      'metadata-complete'
    );
  });

  await t('deriveState: some complete, some incomplete → metadata-partial', () => {
    assert.equal(
      stateService.deriveState(baseCounts({ eligible: 3, complete: 2, failed: 1 })),
      'metadata-partial'
    );
    assert.equal(
      stateService.deriveState(baseCounts({ eligible: 3, complete: 2, ambiguous: 1 })),
      'metadata-partial'
    );
  });

  await t('deriveState: none complete, some failed → metadata-failed', () => {
    assert.equal(
      stateService.deriveState(baseCounts({ eligible: 2, complete: 0, failed: 2 })),
      'metadata-failed'
    );
  });

  await t('deriveState: unverified-only (Transfer Import / same-size-skip) → metadata-verification-required', () => {
    assert.equal(
      stateService.deriveState(baseCounts({ eligible: 4, verificationRequired: 4 })),
      'metadata-verification-required'
    );
    assert.equal(
      stateService.deriveState(baseCounts({ eligible: 2, ambiguous: 1, stale: 1 })),
      'metadata-verification-required'
    );
  });

  await t('deriveState: durably queued but not active → metadata-queued', () => {
    assert.equal(
      stateService.deriveState(baseCounts({ eligible: 2, queued: 2 })),
      'metadata-queued'
    );
  });

  await t('deriveState: eligible files exist, nothing attempted → metadata-not-attempted', () => {
    assert.equal(
      stateService.deriveState(baseCounts({ eligible: 2 })),
      'metadata-not-attempted'
    );
  });

  await t('computeEventDurableCounts merges across batches by dest — a later batch supersedes an earlier one for the same file', async () => {
    const { store, stateService: ss, dir } = fresh();
    const eventJsonPath = path.join(dir, 'event.json');
    fs.writeFileSync(eventJsonPath, JSON.stringify({ version: 1, status: 'created' }));

    // Batch 1: file failed.
    await store.writeManifestOnce('batch1', {
      batchId: 'batch1', eventJsonPath, queuedAt: '2026-01-01T00:00:00.000Z',
      files: [{ dest: '/a', isVideo: false, isRaw: false, expectation: {}, evidence: {} }],
    });
    await store.appendJournalEntry('batch1', { dest: '/a', status: 'failed', classification: 'failed' });

    // Batch 2 (a retry): the same file now completes — must supersede batch1's failure.
    await store.writeManifestOnce('batch2', {
      batchId: 'batch2', eventJsonPath, queuedAt: '2026-01-02T00:00:00.000Z',
      files: [{ dest: '/a', isVideo: false, isRaw: false, expectation: {}, evidence: {} }],
    });
    await store.appendJournalEntry('batch2', { dest: '/a', status: 'complete', classification: 'complete' });

    const counts = await ss.computeEventDurableCounts(eventJsonPath);
    assert.equal(counts.eligible, 1);
    assert.equal(counts.complete, 1);
    assert.equal(counts.failed, 0);
  });

  await t('computeEventDurableCounts: an all-partial batch (read-back mismatches, nothing verified-complete) must never report metadata-complete', async () => {
    const { store, stateService: ss, dir } = fresh();
    const eventJsonPath = path.join(dir, 'event.json');
    fs.writeFileSync(eventJsonPath, JSON.stringify({ version: 1, status: 'created' }));

    await store.writeManifestOnce('batch1', {
      batchId: 'batch1', eventJsonPath, queuedAt: '2026-01-01T00:00:00.000Z',
      files: [{ dest: '/a', isVideo: false, isRaw: false, expectation: {}, evidence: {} }],
    });
    // Write succeeded (no error thrown) but read-back found field mismatches — the
    // exact "didn't throw but didn't land correctly" class of bug this redesign exists
    // to make visible. Must never collapse into the same bucket as a verified 'complete'.
    await store.appendJournalEntry('batch1', { dest: '/a', status: 'partial', classification: 'partial', error: 'Read-back mismatch: keywords' });

    const counts = await ss.computeEventDurableCounts(eventJsonPath);
    assert.equal(counts.complete, 0, 'a partial write must not be counted as complete');
    const state = ss.deriveState(counts);
    assert.notEqual(state, 'metadata-complete');
    assert.equal(state, 'metadata-failed');
  });

  await t('computeEventDurableCounts never counts video-excluded files as eligible', async () => {
    const { store, stateService: ss, dir } = fresh();
    const eventJsonPath = path.join(dir, 'event.json');
    fs.writeFileSync(eventJsonPath, JSON.stringify({ version: 1, status: 'created' }));

    await store.writeManifestOnce('batch1', {
      batchId: 'batch1', eventJsonPath, queuedAt: '2026-01-01T00:00:00.000Z',
      files: [
        { dest: '/photo.jpg', isVideo: false, isRaw: false, expectation: {}, evidence: {} },
        { dest: '/clip.mp4', isVideo: true, isRaw: false, expectation: null, evidence: null },
      ],
    });
    await store.appendJournalEntry('batch1', { dest: '/photo.jpg', status: 'complete', classification: 'complete' });
    await store.appendJournalEntry('batch1', { dest: '/clip.mp4', status: 'excluded', classification: 'excluded' });

    const counts = await ss.computeEventDurableCounts(eventJsonPath);
    assert.equal(counts.eligible, 1);
    assert.equal(counts.complete, 1);
  });

  await t('persistEventMetadataState writes counts+state into event.json, always re-derivable', async () => {
    const { store, stateService: ss, dir } = fresh();
    const eventJsonPath = path.join(dir, 'event.json');
    fs.writeFileSync(eventJsonPath, JSON.stringify({ version: 1, status: 'created' }));

    await store.writeManifestOnce('batch1', {
      batchId: 'batch1', eventJsonPath, queuedAt: '2026-01-01T00:00:00.000Z',
      files: [{ dest: '/a', isVideo: false, isRaw: false, expectation: {}, evidence: {} }],
    });
    await store.appendJournalEntry('batch1', { dest: '/a', status: 'complete', classification: 'complete' });

    const result = await ss.persistEventMetadataState(eventJsonPath);
    assert.equal(result.state, 'metadata-complete');

    const doc = JSON.parse(fs.readFileSync(eventJsonPath, 'utf8'));
    assert.equal(doc.metadataState.state, 'metadata-complete');
    assert.equal(doc.metadataState.counts.eligible, 1);
    assert.ok(doc.metadataState.updatedAt);
    assert.equal(doc.status, 'created'); // unrelated fields survive.
  });

  console.log(`${passed} passed`);
  if (process.exitCode) console.log('SOME TESTS FAILED');
}

main();
