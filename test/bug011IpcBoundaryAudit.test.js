'use strict';

// IPC-boundary audit for BUG-011's stall investigation (2026-08-10/11 round).
// After every named synchronous per-entry/post-loop stage was ruled out by
// direct timing (see BUG-011's investigation log), this tests the next
// hypothesis: does the returned payload structured-clone safely, and does the
// real production IPC round-trip (main:master:scanEvents -> preload -> renderer)
// work correctly at realistic scale? Runs the REAL Electron app (Playwright
// _electron), never a mirror — same pattern as the other bug011*.test.js files.
//
// Experiments (per the "four-step IPC experiment" request):
//   A — empty collection ({ok:true, events:[]})              -> already covered
//       by test/eventManagementReliabilityLive.test.js's collection-selection
//       flow and this file's own setup; not duplicated here.
//   B — one synthetic plain event                             -> already covered
//       by test/eventManagementReliabilityLive.test.js TEST A/C.
//   C — one REAL event.json-derived record (the QMZ event)    -> already covered
//       by test/bug011RealEventJsonReproduction.test.js TEST 1.
//   D — full real-shaped array (51 synthetic + real QMZ, 52 total) -> NEW, this
//       file. If D passes (as A/B/C already do), the IPC boundary itself is not
//       the problem for any payload shape/size producible from known data.
//
// Also performs the structured-clone-safety audit and payload-size measurement
// requested for this round, against the REAL returned events array (not a
// hand-built fixture) — so this is checking actual production output, not an
// assumption about it.
//
// Run: node test/bug011IpcBoundaryAudit.test.js

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = '/Users/funun_pa/Projects/_Auto-Ingest-Software/electron-app-v24';

function log(...args) { console.log('[ipc-audit]', ...args); }
let failures = 0;
function check(cond, msg, detail) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); if (detail !== undefined) log('  detail:', JSON.stringify(detail)); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function writeEventJsonFixture(dir, data) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'event.json'), JSON.stringify(data, null, 2), 'utf8');
}

function realQmzEventJson() {
  return {
    version: 1,
    hijriDate: '1448-02-22',
    sequence: 1,
    eventName: '1448-02-22 _01-QMZ-East London-Arrival-Ziyarat-London',
    safeEventName: '1448-02-22 _01-QMZ-East London-Arrival-Ziyarat-London',
    status: 'complete',
    components: [
      { types: ['QMZ'], location: null, city: 'East London', country: 'United Kingdom', folderName: '01-QMZ-East London' },
      { types: ['Arrival', 'Ziyarat'], location: null, city: 'London', country: 'United Kingdom', folderName: '02-Arrival-Ziyarat-London' },
    ],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 3600000,
    imports: [
      { source: { path: 'E:\\UK Asfaar-Photos\\DCIM\\100EOS5D\\IMG_0001.CR2' }, importedAt: Date.now() - 86000000 },
      { source: { path: 'E:\\UK Asfaar-Photos\\DCIM\\100EOS5D\\IMG_0002.CR2' }, importedAt: Date.now() - 86000000 },
    ],
    lastImport: { importedAt: Date.now() - 86000000, count: 2 },
    lastMetadataRun: { timestamp: new Date().toISOString(), status: 'applied', processed: 2, failed: 0, skipped: 0, partial: 0, ambiguous: 0, metadataVersion: 1 },
    metadataState: { counts: { eligible: 2, complete: 2, failed: 0, ambiguous: 0, stale: 0, verificationRequired: 0, queued: 0, active: 0, interrupted: 0 }, state: 'metadata-complete', updatedAt: new Date().toISOString() },
  };
}

function simpleEventJson(i) {
  const day = String(1 + (i % 28)).padStart(2, '0');
  return {
    version: 1,
    hijriDate: `1448-01-${day}`,
    sequence: 1,
    eventName: `1448-01-${day} _01-Majlis-Bradford-${i}`,
    safeEventName: `1448-01-${day} _01-Majlis-Bradford-${i}`,
    status: 'complete',
    components: [{ types: ['Majlis'], location: null, city: 'Bradford', country: 'United Kingdom', folderName: '01-Majlis-Bradford' }],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 3600000,
  };
}

// Structured-clone safety: recursively walk a value and collect any type NOT
// on the allow-list (string/number/boolean/null/undefined/plain Array/plain
// Object). Detects Dirent/Stats/Buffer/Error/Date/class-instance/function/
// Promise/BigInt/Symbol/cyclic references.
function findNonCloneSafeValues(value, pathStr, seen, violations) {
  if (value === null || value === undefined) return;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return;
  if (t === 'bigint') { violations.push({ path: pathStr, type: 'bigint' }); return; }
  if (t === 'symbol') { violations.push({ path: pathStr, type: 'symbol' }); return; }
  if (t === 'function') { violations.push({ path: pathStr, type: 'function' }); return; }
  if (t !== 'object') { violations.push({ path: pathStr, type: t }); return; }

  // `seen` tracks the current ANCESTRY PATH only (added before recursing,
  // removed after) — a true cycle is an object appearing in its own ancestor
  // chain. The same object referenced from two unrelated branches (a DAG, e.g.
  // event.components and event._eventJson.components sharing one array via the
  // `{...eventJson}` shallow spread) is not a cycle and must not be flagged —
  // structured clone explicitly supports shared references and real cycles
  // alike (unlike JSON.stringify, which only rejects true cycles).
  if (seen.has(value)) { violations.push({ path: pathStr, type: 'cyclic-reference' }); return; }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((v, i) => findNonCloneSafeValues(v, `${pathStr}[${i}]`, seen, violations));
    seen.delete(value);
    return;
  }
  if (Buffer.isBuffer(value)) { violations.push({ path: pathStr, type: 'Buffer' }); seen.delete(value); return; }
  if (value instanceof Date) { violations.push({ path: pathStr, type: 'Date' }); seen.delete(value); return; }
  if (value instanceof Error) { violations.push({ path: pathStr, type: 'Error' }); seen.delete(value); return; }
  if (value instanceof Promise) { violations.push({ path: pathStr, type: 'Promise' }); seen.delete(value); return; }

  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    violations.push({ path: pathStr, type: `custom-prototype:${value.constructor?.name || 'unknown'}` });
    seen.delete(value);
    return;
  }
  for (const key of Object.keys(value)) {
    findNonCloneSafeValues(value[key], `${pathStr}.${key}`, seen, violations);
  }
  seen.delete(value);
}

(async () => {
  const userDataDir = await mkTmp('ai-ipc-audit-userdata-');
  const archiveRoot = await mkTmp('ai-ipc-audit-archive-');
  log('userDataDir =', userDataDir);
  log('archiveRoot =', archiveRoot);

  const collName = '1448-01-11 _UK Safar';
  const collDir = path.join(archiveRoot, collName);

  for (let i = 1; i <= 51; i++) {
    const day = String(1 + (i % 28)).padStart(2, '0');
    const evName = `1448-01-${day} _01-Majlis-Bradford-${i}`;
    await writeEventJsonFixture(path.join(collDir, evName), simpleEventJson(i));
  }
  const qmzName = '1448-02-22 _01-QMZ-East London-Arrival-Ziyarat-London';
  await writeEventJsonFixture(path.join(collDir, qmzName), realQmzEventJson());

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', () => {});
  electronApp.process().stderr.on('data', () => {});

  let window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'IPC Audit Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) {
      await window.click('.splash-user-item');
      await window.click('#splashSelectStartBtn');
    } else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'IPC Audit Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }

  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  await window.evaluate(async (root) => {
    await window.api.initArchiveRoot(root);
    await window.api.setNasRoot(root);
    await window.api.setMainArchiveRoot(root);
  }, archiveRoot);

  // ── Experiment D: full 52-event real-shaped array through the real IPC path ──
  const t0 = Date.now();
  const scanResult = await window.evaluate(async (masterPath) => window.api.scanMasterEvents(masterPath), collDir);
  const elapsed = Date.now() - t0;

  check(scanResult?.ok === true, 'Experiment D: ok:true for a 52-entry real-shaped collection');
  check(Array.isArray(scanResult?.events) && scanResult.events.length === 52, 'Experiment D: all 52 events returned', scanResult?.events?.length);
  check(elapsed < 5000, `Experiment D: IPC round-trip completed quickly (${elapsed}ms)`, elapsed);
  const qmzEvent = (scanResult?.events || []).find((e) => e.folderName === qmzName);
  check(!!qmzEvent, 'Experiment D: the real QMZ event is present in the returned array');
  check(qmzEvent && qmzEvent._eventJson && !('imports' in qmzEvent._eventJson), 'Experiment D: imports[] correctly stripped from the returned QMZ record');

  // ── Structured-clone safety audit on the ACTUAL returned payload ────────────
  const violations = [];
  findNonCloneSafeValues(scanResult?.events, 'events', new Set(), violations);
  check(violations.length === 0, 'Structured-clone safety: no Dirent/Stats/Buffer/Error/Date/class-instance/function/Promise/BigInt/Symbol/cyclic value anywhere in the returned events array', violations);

  // ── Payload size measurement ─────────────────────────────────────────────────
  const serialized = JSON.stringify(scanResult?.events || []);
  const totalBytes = Buffer.byteLength(serialized, 'utf8');
  const perEventBytes = (scanResult?.events || []).map((e) => Buffer.byteLength(JSON.stringify(e), 'utf8'));
  const largestEventBytes = perEventBytes.length ? Math.max(...perEventBytes) : 0;
  log(`payload size: ${totalBytes} bytes total, 52 events, largest single event = ${largestEventBytes} bytes`);
  check(totalBytes < 1024 * 1024, `Payload size stays well under 1MB for 52 real-shaped events (${totalBytes} bytes)`, totalBytes);

  // ── Drive the REAL UI so eventCreator.js's _scanAndRenderEventList() actually
  // runs (the direct window.api.scanMasterEvents() call above bypasses it
  // entirely). Same pattern as test/eventManagementReliabilityLive.test.js's
  // TEST C.
  await window.evaluate(() => { document.getElementById('heroSecondaryBtn')?.click() || document.getElementById('emmOpenBtn')?.click(); });
  const emmVisible = await window.evaluate(() => document.getElementById('eventMgmtModal')?.classList.contains('open'));
  if (!emmVisible) {
    await window.evaluate(() => { EventMgmt.open({ mode: 'select' }); EventCreator.start(); });
  }
  await window.waitForTimeout(500);
  await window.waitForSelector(`.ec-coll-card[data-name="${collName}"]`, { timeout: 10000 }).catch(() => {});
  const cardExists = await window.evaluate((name) =>
    !!document.querySelector(`.ec-coll-card[data-name="${CSS.escape(name)}"]`), collName);
  if (cardExists) {
    await window.click(`.ec-coll-card[data-name="${collName}"]`);
    await window.waitForTimeout(200);
    await window.click('#ecMasterContinue');
    await window.waitForTimeout(800);
  }
  const uiListState = await window.evaluate(() => ({
    evlItems: document.querySelectorAll('.ec-evl-item[data-folder]').length,
  }));
  check(cardExists, 'Real UI: collection card for the 52-entry archive is listed');
  check(uiListState.evlItems === 52, 'Real UI: Event Management renders all 52 events after the real _scanAndRenderEventList() flow', uiListState);

  // ── Renderer log forwarding: diagLog -> preload bridge -> ipcMain -> logger.js ──
  // Proves the actual chain end-to-end (real Electron, real fs.appendFile),
  // not just that console output looks right — the tester's returned app.log
  // is what this round depends on, so this specific path must be verified.
  const forwardMarker = `RENDERER_LOG_FORWARDING_TEST_${Date.now()}`;
  await window.evaluate((marker) => { window.api.diagLog(marker); }, forwardMarker);

  const appLogPath = path.join(userDataDir, 'app.log');
  let forwardedLineSeen = false;
  for (let i = 0; i < 50; i++) { // bounded poll, not a blind sleep — fs.appendFile is fire-and-forget
    const text = await fsp.readFile(appLogPath, 'utf8').catch(() => '');
    if (text.includes(forwardMarker)) { forwardedLineSeen = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  check(forwardedLineSeen, 'Renderer log forwarding: window.api.diagLog() reaches app.log via diag:rendererLog -> ipcMain.on -> logger.js (not just devtools console)');

  // ── Confirm the Phase 4 diagnostic cleanup (2026-08-11) actually took effect ──
  // BUG-011's exhaustive per-entry/per-operation trace markers (IPC_HANDLER_ENTER,
  // SCAN_PROMISE_CREATED, SCAN_PROMISE_RESOLVED, BEFORE_IPC_RETURN,
  // RENDERER_SCAN_INVOKE_START/RESOLVED, and everything under
  // [EventDiscoveryEntry]/heartbeat/RECORD/OPERATION_TIMING) were deliberately
  // removed once BUG-011's root cause was confirmed and fixed — see
  // 10_CHANGELOG.md and BUG-011's Prevention/Reusable Lesson section. Only the
  // high-value summary/error/assertion logging remains. This asserts both
  // halves: the retained markers still fire, and the removed ones are gone.
  const fullLog = await fsp.readFile(appLogPath, 'utf8').catch(() => '');
  const retainedMarkers = ['EVENT_DISCOVERY_SUMMARY', 'SCAN_COMPLETE'];
  for (const marker of retainedMarkers) {
    check(fullLog.includes(marker), `Retained summary marker present in app.log: ${marker}`);
  }
  const removedMarkers = [
    'IPC_HANDLER_ENTER', 'SCAN_PROMISE_CREATED', 'SCAN_PROMISE_RESOLVED', 'BEFORE_IPC_RETURN',
    'RENDERER_SCAN_INVOKE_START', 'RENDERER_SCAN_INVOKE_RESOLVED',
    '[EventDiscoveryEntry]', '[EventDiscoveryEntryStart]', '[EventDiscoveryHeartbeat]',
    'RECORD {', 'OPERATION_TIMING', 'POST_LOOP_START', 'RETURN_START',
  ];
  const stillPresent = removedMarkers.filter((m) => fullLog.includes(m));
  check(stillPresent.length === 0, 'Debug-only per-entry/per-operation markers no longer appear in app.log (Phase 4 cleanup verified)', stillPresent);

  await electronApp.close();
  await fsp.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  await fsp.rm(archiveRoot, { recursive: true, force: true }).catch(() => {});

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
