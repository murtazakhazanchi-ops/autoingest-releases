'use strict';

// Plain Node fixtures for the per-batch metadata tracker — the multi-event fixes for the
// single-slot Local First sync manifest and for attributing metadata progress to the
// batch's OWN event instead of the operator's Current Event.
// Run with: node test/metadataBatchTracker.test.js

const assert = require('node:assert/strict');
const Tracker = require('../renderer/metadataBatchTracker');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const manifest = (batchId, eventName) => ({ batchId, importId: `imp-${batchId}`, eventName, localEventPath: `/local/${eventName}`, fileCount: 3 });

console.log('metadataBatchTracker');

// ── Event identity ───────────────────────────────────────────────────────────

t('a batch is attributed to the event in ITS payload, not the Current Event', () => {
  const tr = Tracker.create();
  const rec = tr.start({ batchId: 'bB', total: 5, eventPath: '/archive/C/EventB' }, '/archive/C/EventA' /* operator is looking at A */);
  assert.equal(rec.eventPath, '/archive/C/EventB');
});

t('without an eventPath in the payload (single-event / retry emitters) the legacy fallback is used', () => {
  const tr = Tracker.create();
  assert.equal(tr.start({ batchId: 'b1', total: 2 }, '/archive/C/Active').eventPath, '/archive/C/Active');
  assert.equal(tr.start({ batchId: 'b2', total: 2 }).eventPath, null);
});

t('progress counters are tracked per batch — B running while A is Current', () => {
  const tr = Tracker.create();
  tr.start({ batchId: 'bA', total: 4, eventPath: '/e/A' });
  tr.start({ batchId: 'bB', total: 10, eventPath: '/e/B' });
  tr.apply({ batchId: 'bB', event: 'file_done', done: 3, skipped: 0, failed: 1 });
  tr.apply({ batchId: 'bA', event: 'file_done', done: 4, skipped: 0, failed: 0 });
  assert.deepEqual([tr.get('bA').done, tr.get('bA').eventPath], [4, '/e/A']);
  assert.deepEqual([tr.get('bB').done, tr.get('bB').failed, tr.get('bB').eventPath], [3, 1, '/e/B']);
});

t('the latest-STARTED batch is what the legacy scalar globals mirror', () => {
  const tr = Tracker.create();
  tr.start({ batchId: 'bA', total: 1, eventPath: '/e/A' });
  tr.start({ batchId: 'bB', total: 1, eventPath: '/e/B' });
  assert.equal(tr.getLatest().batchId, 'bB');
  assert.equal(tr.apply({ batchId: 'bA', event: 'file_done', done: 1 }).isLatest, false);
  assert.equal(tr.apply({ batchId: 'bB', event: 'file_done', done: 1 }).isLatest, true);
});

t('unknown batches are ignored (as the legacy `batchId !== _metaBatchId` guard did)', () => {
  const tr = Tracker.create();
  assert.equal(tr.apply({ batchId: 'nope', event: 'file_done', done: 1 }), null);
});

// ── Local First manifests: one per event, independent ────────────────────────

t('three Local First events → three independent manifests, each consumed only by its own batch', () => {
  const tr = Tracker.create();
  for (const [id, ev] of [['bA', 'A'], ['bB', 'B'], ['bC', 'C']]) {
    tr.start({ batchId: id, total: 3, eventPath: `/e/${ev}` });
    assert.equal(tr.registerManifest(manifest(id, ev)).writeNow, null);
  }
  assert.equal(tr.pendingManifestCount(), 3);

  // B finishes first (out of order): only B's manifest is produced.
  tr.apply({ batchId: 'bB', event: 'batch_complete', done: 3, failed: 0, skipped: 0 });
  assert.equal(tr.takeManifest('bB').eventName, 'B');
  assert.equal(tr.pendingManifestCount(), 2);

  tr.apply({ batchId: 'bA', event: 'batch_complete', done: 3, failed: 0, skipped: 0 });
  assert.equal(tr.takeManifest('bA').eventName, 'A');
  tr.apply({ batchId: 'bC', event: 'batch_error', failed: 3, errors: [{ file: 'x', error: 'boom' }] });
  assert.equal(tr.takeManifest('bC').eventName, 'C');
  assert.equal(tr.pendingManifestCount(), 0);
});

t('one batch failing does not consume or overwrite another batch’s manifest', () => {
  const tr = Tracker.create();
  tr.start({ batchId: 'bA', total: 2, eventPath: '/e/A' });
  tr.start({ batchId: 'bB', total: 2, eventPath: '/e/B' });
  tr.registerManifest(manifest('bA', 'A'));
  tr.registerManifest(manifest('bB', 'B'));
  tr.apply({ batchId: 'bB', event: 'batch_error', failed: 2, errors: [] });
  assert.equal(tr.takeManifest('bB').eventName, 'B');
  assert.equal(tr.takeManifest('bA').eventName, 'A', 'A’s manifest is intact');
  assert.equal(tr.takeManifest('bB'), null, 'a manifest is taken at most once');
});

t('registering B’s manifest never replaces A’s (the old single slot bug)', () => {
  const tr = Tracker.create();
  tr.start({ batchId: 'bA', total: 1, eventPath: '/e/A' });
  tr.start({ batchId: 'bB', total: 1, eventPath: '/e/B' });
  tr.registerManifest(manifest('bA', 'A'));
  tr.registerManifest(manifest('bB', 'B'));
  assert.equal(tr.takeManifest('bA').localEventPath, '/local/A');
  assert.equal(tr.takeManifest('bB').localEventPath, '/local/B');
});

t('metadata that finished BEFORE the manifest was registered is written immediately, not dropped', () => {
  const tr = Tracker.create();
  tr.start({ batchId: 'bA', total: 1, eventPath: '/e/A' });
  tr.apply({ batchId: 'bA', event: 'batch_complete', done: 1, failed: 0, skipped: 0 });
  const r = tr.registerManifest(manifest('bA', 'A'));
  assert.equal(r.writeNow.status, 'complete');
  assert.equal(r.writeNow.manifest.eventName, 'A');
  assert.equal(tr.pendingManifestCount(), 0);
});

t('the first terminal event decides the outcome (batch_complete then batch_error keeps legacy semantics)', () => {
  const tr = Tracker.create();
  tr.start({ batchId: 'bA', total: 2, eventPath: '/e/A' });
  const c = tr.apply({ batchId: 'bA', event: 'batch_complete', done: 1, failed: 1, skipped: 0 });
  assert.equal(c.firstTerminal, true);
  const e = tr.apply({ batchId: 'bA', event: 'batch_error', failed: 1, errors: [{ file: 'f', error: 'e' }] });
  assert.equal(e.firstTerminal, false);
  assert.equal(tr.get('bA').outcome, 'complete');
  assert.equal(tr.get('bA').errors.length, 1);
});

t('a batch with no manifest (single-event / direct-nas) simply has nothing to take', () => {
  const tr = Tracker.create();
  tr.start({ batchId: 'bA', total: 1, eventPath: '/e/A' });
  tr.apply({ batchId: 'bA', event: 'batch_complete', done: 1, failed: 0, skipped: 0 });
  assert.equal(tr.takeManifest('bA'), null);
});

t('finished batches are pruned beyond the cap; running batches and pending manifests are never dropped', () => {
  const tr = Tracker.create();
  tr.start({ batchId: 'running', total: 5, eventPath: '/e/run' });                 // never finishes
  tr.start({ batchId: 'held', total: 1, eventPath: '/e/held' });
  tr.registerManifest(manifest('held', 'Held'));                                    // manifest still pending
  tr.apply({ batchId: 'held', event: 'batch_complete', done: 1, failed: 0, skipped: 0 });
  for (let i = 0; i < 300; i++) {
    tr.start({ batchId: `b${i}`, total: 1, eventPath: `/e/${i}` });
    tr.apply({ batchId: `b${i}`, event: 'batch_complete', done: 1, failed: 0, skipped: 0 });
  }
  assert.ok(tr.get('running'), 'a still-running batch is kept');
  assert.equal(tr.get('held') !== null, true, 'a batch whose manifest is still pending is kept');
  assert.equal(tr.takeManifest('held').eventName, 'Held');
  assert.equal(tr.get('b0'), null, 'old finished batches are dropped');
  assert.ok(tr.get('b299'), 'recent batches are kept');
});

console.log(`${passed} passed`);
