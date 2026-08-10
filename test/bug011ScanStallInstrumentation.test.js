'use strict';

// Regression test for the per-entry scan-stall diagnostic instrumentation added
// to main/main.js's master:scanEvents (BUG-011 stall investigation, 2026-08-10).
// Mirrors the exact phase-tag sequence and heartbeat state transitions verbatim
// (source-drift guarded via a comment, same pattern as
// bug011DirentMismatchRegression.test.js) rather than driving the real
// ipcMain.handle body, since main.js cannot be require()'d standalone outside
// Electron and Playwright's electronApp.evaluate() runs without require()
// available (both confirmed empirically in earlier rounds of this
// investigation — a genuine tooling limitation, not a finding about the fix).
//
// What this proves: when one entry's per-entry filesystem operation never
// resolves, per-entry logging stops at that exact phase (e.g. REALPATH_START)
// with no matching _OK/_FAIL ever following, and the heartbeat state reflects
// exactly which entry/operation is stuck — the mechanism the real diagnostic
// build relies on to name the stalled folder from a real tester's app.log.
//
// Run: node test/bug011ScanStallInstrumentation.test.js

const assert = require('node:assert/strict');

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ok — ${name}`);
}
function fail(name, detail) {
  process.exitCode = 1;
  console.error(`  FAIL — ${name}`);
  if (detail !== undefined) console.error(detail);
}

// ── Mirror of main/main.js's master:scanEvents per-entry logging shape ──────
// Keep this structurally in sync with main.js if that loop's phase tags,
// operation order (STAT → REALPATH → READ_EVENT_JSON), or heartbeat field
// names ever change. Durations/scanId/timestamps are omitted here since only
// the phase sequence and heartbeat transitions are under test.
async function runEntryLoopMirror(entries, ops, log, hb) {
  for (let i = 0; i < entries.length; i++) {
    const name = entries[i];
    const idx = i + 1;
    hb.currentEntry = idx;
    hb.currentTotal = entries.length;
    hb.currentOperation = 'none';
    log(`[EventDiscoveryEntryStart] index=${idx} total=${entries.length} name=${JSON.stringify(name)}`);

    hb.currentOperation = 'STAT';
    log(`[EventDiscoveryEntry] phase=STAT_START index=${idx} name=${JSON.stringify(name)}`);
    try {
      await ops.stat(name);
      log(`[EventDiscoveryEntry] phase=STAT_OK index=${idx} name=${JSON.stringify(name)}`);
    } catch {
      log(`[EventDiscoveryEntry] phase=STAT_FAIL index=${idx} name=${JSON.stringify(name)}`);
    }
    hb.currentOperation = 'none';

    hb.currentOperation = 'REALPATH';
    log(`[EventDiscoveryEntry] phase=REALPATH_START index=${idx} name=${JSON.stringify(name)}`);
    try {
      await ops.realpath(name);
      log(`[EventDiscoveryEntry] phase=REALPATH_OK index=${idx} name=${JSON.stringify(name)}`);
    } catch {
      log(`[EventDiscoveryEntry] phase=REALPATH_FAIL index=${idx} name=${JSON.stringify(name)}`);
    }
    hb.currentOperation = 'none';

    hb.currentOperation = 'READ_EVENT_JSON';
    log(`[EventDiscoveryEntry] phase=READ_EVENT_JSON_START index=${idx} name=${JSON.stringify(name)}`);
    try {
      await ops.readFile(name);
      log(`[EventDiscoveryEntry] phase=READ_EVENT_JSON_OK index=${idx} name=${JSON.stringify(name)}`);
    } catch {
      log(`[EventDiscoveryEntry] phase=READ_EVENT_JSON_FAIL index=${idx} name=${JSON.stringify(name)}`);
    }
    hb.currentOperation = 'none';
  }
}

(async () => {
  const entries = ['1448-01-15 _01-Majlis-Adam Masjid-Bradford', '1448-02-22 _01-QMZ-East London-Arrival-Ziyarat-London'];

  // Entry 2's realpath() is a promise this test controls directly and never
  // resolves during the assertion window — simulating a real hung SMB call
  // without any real filesystem or timer, per "control the promise
  // deterministically" / "do not wait indefinitely".
  let _resolveEntry2Realpath; // eslint-disable-line no-unused-vars
  const entry2RealpathPromise = new Promise((resolve) => { _resolveEntry2Realpath = resolve; });

  const ops = {
    stat:     async () => true,
    realpath: async (name) => (name === entries[1] ? entry2RealpathPromise : name),
    readFile: async () => 'data',
  };

  const logs = [];
  const log = (msg) => logs.push(msg);
  const hb = { currentEntry: 0, currentTotal: 0, currentOperation: 'none' };

  // Intentionally not awaited: once entry 2's realpath() never resolves, this
  // promise never settles either. Bounded polling below (never an unbounded
  // wait) is what lets the test observe the stall without hanging.
  runEntryLoopMirror(entries, ops, log, hb);

  const STALL_POLL_CAP = 200; // generous bound on immediately-resolving microtask drains
  let reachedStall = false;
  for (let i = 0; i < STALL_POLL_CAP; i++) {
    if (hb.currentEntry === 2 && hb.currentOperation === 'REALPATH') { reachedStall = true; break; }
    await new Promise((resolve) => setImmediate(resolve));
  }

  if (reachedStall) {
    ok('TEST 1: loop reaches entry 2 and heartbeat reports currentOperation=REALPATH before stalling');
  } else {
    fail('TEST 1: loop never reached the expected stall point within the poll cap', { hb, logs });
  }

  // Entry 1 must have fully completed with every phase's _OK counterpart present.
  const entry1Phases = logs.filter((l) => l.includes('index=1'));
  const entry1Expected = [
    '[EventDiscoveryEntryStart]', 'STAT_START', 'STAT_OK', 'REALPATH_START', 'REALPATH_OK',
    'READ_EVENT_JSON_START', 'READ_EVENT_JSON_OK',
  ];
  const entry1Actual = entry1Phases.map((l) => {
    const m = l.match(/phase=(\w+)/);
    return m ? m[1] : (l.includes('EntryStart') ? '[EventDiscoveryEntryStart]' : l);
  });
  try {
    assert.deepStrictEqual(entry1Actual, entry1Expected);
    ok('TEST 2: entry 1 (unaffected by the stall) logs the full 7-phase OK sequence in order');
  } catch (err) {
    fail('TEST 2: entry 1 phase sequence mismatch', err.message);
  }

  // Entry 2 must show EntryStart, STAT_START, STAT_OK, REALPATH_START — and
  // NOTHING after that. This is the exact signal a real tester's app.log
  // would show for a folder whose realpath() call is genuinely hung.
  const entry2Phases = logs.filter((l) => l.includes('index=2')).map((l) => {
    const m = l.match(/phase=(\w+)/);
    return m ? m[1] : '[EventDiscoveryEntryStart]';
  });
  const entry2Expected = ['[EventDiscoveryEntryStart]', 'STAT_START', 'STAT_OK', 'REALPATH_START'];
  try {
    assert.deepStrictEqual(entry2Phases, entry2Expected);
    ok('TEST 3: entry 2 logging ends exactly at REALPATH_START — no REALPATH_OK/FAIL, no READ_EVENT_JSON_* ever logged');
  } catch (err) {
    fail('TEST 3: entry 2 phase sequence did not end where expected', { actual: entry2Phases, expected: entry2Expected, error: err.message });
  }

  // Heartbeat state at the stall must name the exact stuck entry/operation.
  if (hb.currentEntry === 2 && hb.currentTotal === 2 && hb.currentOperation === 'REALPATH') {
    ok('TEST 4: heartbeat state at the stall point is currentEntry=2/2 currentOperation=REALPATH');
  } else {
    fail('TEST 4: heartbeat state did not match the expected stall signature', hb);
  }

  // Cleanup: release the never-resolving promise so the background loop
  // (never awaited above) can finish and the process can exit cleanly. This
  // happens strictly after all assertions above, so it cannot affect them.
  _resolveEntry2Realpath('resolved-for-cleanup-only');
  await new Promise((resolve) => setImmediate(resolve));

  console.log(`\n${passed} test(s) passed.`);
})();
