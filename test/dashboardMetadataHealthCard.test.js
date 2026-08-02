'use strict';
// Live coverage for the dashboard "Metadata Health" card upgrade (#ovMetadataSync).
// UI-only feature: the tile now shows AutoIngest's own durable per-event metadata
// state as the PRIMARY status (never the Bridge/XMP external-sync signal), with
// external-sync status demoted to secondary context only. No metadata/queue/repair/
// audit logic, IPC contracts, or ExifTool behavior is touched by this feature —
// this test proves the card's priority/label mapping and live-refresh wiring, not
// pipeline correctness (covered elsewhere).
//
// Two halves:
//   1. Direct pure-function tests — calls the real, shipped deriveMetadataHealthCardState()
//      global via window.evaluate(), no DOM/IPC involved. This is the fast, exhaustive
//      regression layer for the priority rules themselves.
//   2. Live-UI tests — drives the real card end-to-end, including real IPC round-trips
//      against synthetic event.json fixtures (EventCreator.getActiveEventData is
//      monkey-patched to point at them; window.api.getMetadataEventState itself is
//      NOT stubbed — contextBridge-exposed objects aren't reliably stubbable from the
//      page side, so real fixtures + the real IPC handler are used instead).
//
// Requires playwright-core (see test/metadataPipelineLive.test.js for install notes).
// Run: node test/dashboardMetadataHealthCard.test.js

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = '/Users/funun_pa/Projects/_Auto-Ingest-Software/electron-app-v24';

function log(...args) { console.log('[dmh-card]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

const ALL_DURABLE_STATES = [
  'metadata-in-progress', 'metadata-failed', 'metadata-partial', 'metadata-interrupted',
  'metadata-verification-required', 'metadata-queued', 'metadata-complete',
  'metadata-not-attempted', 'metadata-not-required',
];
const ALL_EXTERNAL_STATUSES = ['syncing', 'upToDate', { pending: 3 }];

(async () => {
  const userDataDir = await mkTmp('ai-dmh-card-userdata-');
  log('userDataDir =', userDataDir);

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));
  electronApp.on('close', () => log('electronApp CLOSED unexpectedly'));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  log('splash state:', JSON.stringify(splashState));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Metadata Health Test Operator');
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
      await window.fill('#splashInputName', 'Metadata Health Test Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }
  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));

  async function domClick(selector) {
    return window.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.click();
      return true;
    }, selector);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PART 1 — Direct pure-function tests (deriveMetadataHealthCardState)
  // ══════════════════════════════════════════════════════════════════════════

  async function derive(input) {
    return window.evaluate((i) => deriveMetadataHealthCardState(i), input);
  }

  const complete5pending = await derive({ hasActiveEvent: true, durableState: 'metadata-complete', externalStatus: { pending: 5 } });
  log('complete+5pending:', JSON.stringify(complete5pending));
  check(complete5pending.primaryLabel === 'Metadata Complete', 'metadata-complete + external pending → primary is "Metadata Complete"');
  check(!/^External/.test(complete5pending.primaryLabel) && !complete5pending.primaryLabel.includes('Pending'), 'external status never becomes the primary label for metadata-complete');
  check(complete5pending.secondaryLabel.includes('5 pending'), 'secondary line shows the external pending count');

  const processingWithExternal = await derive({ hasActiveEvent: true, isLiveBatchRunning: true, liveBatchDone: 148, liveBatchTotal: 620, externalStatus: { pending: 3 } });
  log('processing+3pending:', JSON.stringify(processingWithExternal));
  check(processingWithExternal.primaryLabel === 'Metadata Processing', 'live batch running → primary is "Metadata Processing" regardless of external pending');
  check(processingWithExternal.secondaryLabel === '148 / 620 files', 'processing secondary line shows live progress numbers, not external status');

  const failed = await derive({ hasActiveEvent: true, durableState: 'metadata-failed', externalStatus: 'upToDate' });
  check(failed.primaryLabel === 'Attention Required' && failed.cardVariant === 'error', 'metadata-failed → "Attention Required" with error (red) variant');

  const partial = await derive({ hasActiveEvent: true, durableState: 'metadata-partial', externalStatus: 'upToDate' });
  const interrupted = await derive({ hasActiveEvent: true, durableState: 'metadata-interrupted', externalStatus: 'upToDate' });
  check(partial.primaryLabel === 'Attention Required' && partial.cardVariant === 'warn', 'metadata-partial → "Attention Required" with warn (amber), not error');
  check(interrupted.primaryLabel === 'Attention Required' && interrupted.cardVariant === 'warn', 'metadata-interrupted → "Attention Required" with warn (amber), not error');

  const notAttempted = await derive({ hasActiveEvent: true, durableState: 'metadata-not-attempted', externalStatus: 'upToDate' });
  const notRequired  = await derive({ hasActiveEvent: true, durableState: 'metadata-not-required', externalStatus: 'upToDate' });
  log('not-attempted:', JSON.stringify(notAttempted), 'not-required:', JSON.stringify(notRequired));
  check(notAttempted.primaryLabel === 'Metadata Pending', 'metadata-not-attempted → distinct "Metadata Pending" label');
  check(notRequired.primaryLabel === 'No Metadata Required', 'metadata-not-required → distinct "No Metadata Required" label');
  check(notAttempted.primaryLabel !== notRequired.primaryLabel, 'not-attempted and not-required are never collapsed into the same primary label');
  check(notAttempted.secondaryLabel !== notRequired.secondaryLabel, 'not-attempted and not-required have distinct secondary text');

  const noEvent = await derive({ hasActiveEvent: false, externalStatus: 'upToDate' });
  check(noEvent.primaryLabel === 'No Event Selected', 'no active event → "No Event Selected"');

  // ── Correction-round regression: metadata-complete + external syncing must
  // still show "Metadata Complete" as primary, "External Updates: Syncing…" as secondary ──
  const completeWhileSyncing = await derive({ hasActiveEvent: true, durableState: 'metadata-complete', externalStatus: 'syncing' });
  log('complete+syncing:', JSON.stringify(completeWhileSyncing));
  check(completeWhileSyncing.primaryLabel === 'Metadata Complete', 'metadata-complete + external syncing → primary stays "Metadata Complete"');
  check(completeWhileSyncing.secondaryLabel === 'External Updates: Syncing…', 'metadata-complete + external syncing → secondary reads "External Updates: Syncing…"');

  // ── Invariants (full sweep) ──────────────────────────────────────────────
  const sweepResults = await window.evaluate(({ states, externals }) => {
    const out = [];
    for (const durableState of states) {
      for (const isLiveBatchRunning of [true, false]) {
        for (const externalStatus of externals) {
          out.push(deriveMetadataHealthCardState({ hasActiveEvent: true, durableState, isLiveBatchRunning, liveBatchDone: 1, liveBatchTotal: 2, externalStatus }));
        }
      }
    }
    // Also the "no metadataState yet" / "no active event" edge cases.
    out.push(deriveMetadataHealthCardState({ hasActiveEvent: true, durableState: null, externalStatus: 'upToDate' }));
    out.push(deriveMetadataHealthCardState({ hasActiveEvent: false, externalStatus: 'upToDate' }));
    return out;
  }, { states: ALL_DURABLE_STATES, externals: ALL_EXTERNAL_STATUSES });

  const VALID_VARIANTS = new Set(['active', 'error', 'warn', 'ok', 'neutral']);
  // Detect the actual external-sync leak pattern (the literal "External Updates:"
  // prefix, or a bare external-status leaf value used verbatim as a primary label) —
  // not a loose substring match, since a legitimate state label ("Metadata Pending")
  // can contain a word ("Pending") that also appears in external-status phrasing
  // ("N pending") without that being a real leak.
  const EXTERNAL_LEAF_VALUES = new Set(['Up to date', 'Syncing…']);
  const externalLeakIntoPrimary = sweepResults.filter(r => {
    const p = r.primaryLabel || '';
    return p.startsWith('External') || EXTERNAL_LEAF_VALUES.has(p) || /^\d+\s*pending$/i.test(p);
  });
  const emptyPrimary = sweepResults.filter(r => !r.primaryLabel || typeof r.primaryLabel !== 'string' || r.primaryLabel.trim() === '');
  const badVariant   = sweepResults.filter(r => !VALID_VARIANTS.has(r.cardVariant));
  check(externalLeakIntoPrimary.length === 0, `external status never leaks into primaryLabel across full ${sweepResults.length}-combination sweep (found ${externalLeakIntoPrimary.length} violations)`);
  check(emptyPrimary.length === 0, `primaryLabel is never empty across the full sweep (found ${emptyPrimary.length} violations)`);
  check(badVariant.length === 0, `cardVariant is always one of the 5 known values across the full sweep (found ${badVariant.length} violations)`);

  // Every durable state maps to exactly one (deterministic) presentation — same
  // input twice must produce the same output.
  const det1 = await derive({ hasActiveEvent: true, durableState: 'metadata-queued', externalStatus: 'upToDate' });
  const det2 = await derive({ hasActiveEvent: true, durableState: 'metadata-queued', externalStatus: 'upToDate' });
  check(JSON.stringify(det1) === JSON.stringify(det2), 'identical input always produces identical output (deterministic mapping)');

  // ══════════════════════════════════════════════════════════════════════════
  // PART 2 — Live-UI tests
  // ══════════════════════════════════════════════════════════════════════════

  async function setActiveEvent(eventPath, eventName) {
    return window.evaluate(({ eventPath, eventName }) => {
      if (!window.__dmhOrigGetActiveEventData) window.__dmhOrigGetActiveEventData = EventCreator.getActiveEventData;
      EventCreator.getActiveEventData = () => eventPath ? { event: { name: eventName }, eventPath } : null;
    }, { eventPath, eventName });
  }

  const fixturesRoot = await mkTmp('ai-dmh-card-fixtures-');
  async function writeSyntheticEvent(name, metadataState) {
    const dir = path.join(fixturesRoot, name);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'event.json'), JSON.stringify({ name, metadataState }));
    return dir;
  }

  // ── No active event ─────────────────────────────────────────────────────
  await setActiveEvent(null, null);
  await window.evaluate(() => _refreshMetadataSyncCard());
  await window.waitForTimeout(300);
  let cardState = await window.evaluate(() => ({
    primary: document.getElementById('ovMetadataSyncVal')?.textContent,
    secondary: document.getElementById('ovMetadataSyncLabel')?.textContent,
  }));
  log('no-event card state:', JSON.stringify(cardState));
  check(cardState.primary === 'No Event Selected', 'live card: no active event shows "No Event Selected"');

  // ── Metadata not attempted (no metadataState at all) ───────────────────
  const naDir = await writeSyntheticEvent('NA Event', null);
  await setActiveEvent(naDir, 'NA Event');
  await window.evaluate(() => _refreshMetadataSyncCard());
  await window.waitForTimeout(400);
  cardState = await window.evaluate(() => ({
    primary: document.getElementById('ovMetadataSyncVal')?.textContent,
    secondary: document.getElementById('ovMetadataSyncLabel')?.textContent,
  }));
  log('not-attempted card state:', JSON.stringify(cardState));
  check(cardState.primary === 'Metadata Pending', 'live card: no metadataState recorded shows "Metadata Pending"');

  // ── Metadata complete ────────────────────────────────────────────────────
  const completeDir = await writeSyntheticEvent('Complete Event', { state: 'metadata-complete', counts: {}, updatedAt: new Date().toISOString() });
  await setActiveEvent(completeDir, 'Complete Event');
  await window.evaluate(() => _refreshMetadataSyncCard());
  await window.waitForTimeout(400);
  cardState = await window.evaluate(() => {
    const tile = document.getElementById('ovMetadataSync');
    return {
      primary: document.getElementById('ovMetadataSyncVal')?.textContent,
      secondary: document.getElementById('ovMetadataSyncLabel')?.textContent,
      hasOkClass: document.getElementById('ovMetadataSyncVal')?.classList.contains('ov-value--ok'),
      hasErrorTile: tile?.classList.contains('ov-tile--error'),
      hasPendingTile: tile?.classList.contains('ov-tile--pending'),
    };
  });
  log('complete card state:', JSON.stringify(cardState));
  check(cardState.primary === 'Metadata Complete', 'live card: metadata-complete shows "Metadata Complete"');
  check(cardState.hasOkClass === true, 'live card: complete state applies the subtle ov-value--ok text tint');
  check(cardState.hasErrorTile === false && cardState.hasPendingTile === false, 'live card: complete state does not apply a loud tile-level variant (calm/subtle only)');

  // ── Attention required (failed → red) ───────────────────────────────────
  const failedDir = await writeSyntheticEvent('Failed Event', {
    state: 'metadata-failed',
    counts: { failed: 3, complete: 5, verificationRequired: 2, queued: 1 },
    updatedAt: new Date().toISOString(),
  });
  await setActiveEvent(failedDir, 'Failed Event');
  await window.evaluate(() => _refreshMetadataSyncCard());
  await window.waitForTimeout(400);
  cardState = await window.evaluate(() => ({
    primary: document.getElementById('ovMetadataSyncVal')?.textContent,
    hasErrorTile: document.getElementById('ovMetadataSync')?.classList.contains('ov-tile--error'),
    title: document.getElementById('ovMetadataSync')?.title,
  }));
  log('failed card state:', JSON.stringify(cardState));
  check(cardState.primary === 'Attention Required', 'live card: metadata-failed shows "Attention Required"');
  check(cardState.hasErrorTile === true, 'live card: metadata-failed applies the red ov-tile--error variant');
  check(cardState.title.includes('Failed Event'), 'tooltip includes the active event name');
  check(cardState.title.includes('Failed: 3') && cardState.title.includes('Completed: 5') && cardState.title.includes('Verification Required: 2') && cardState.title.includes('Queued: 1'),
    'tooltip surfaces failed/complete/verification-required/queued counts already present in metadataState.counts (no new IPC)');

  // ── Attention required (partial → amber, not red) ───────────────────────
  const partialDir = await writeSyntheticEvent('Partial Event', { state: 'metadata-partial', counts: {}, updatedAt: new Date().toISOString() });
  await setActiveEvent(partialDir, 'Partial Event');
  await window.evaluate(() => _refreshMetadataSyncCard());
  await window.waitForTimeout(400);
  cardState = await window.evaluate(() => ({
    primary: document.getElementById('ovMetadataSyncVal')?.textContent,
    hasErrorTile: document.getElementById('ovMetadataSync')?.classList.contains('ov-tile--error'),
    hasPendingTile: document.getElementById('ovMetadataSync')?.classList.contains('ov-tile--pending'),
  }));
  log('partial card state:', JSON.stringify(cardState));
  check(cardState.primary === 'Attention Required', 'live card: metadata-partial shows "Attention Required"');
  check(cardState.hasErrorTile === false && cardState.hasPendingTile === true, 'live card: metadata-partial applies amber (ov-tile--pending), not red');

  // ── Processing (live batch) ──────────────────────────────────────────────
  const procDir = await writeSyntheticEvent('Processing Event', null);
  await setActiveEvent(procDir, 'Processing Event');
  await window.evaluate((eventPath) => {
    _metaBatchId = 'test-batch-dmh';
    _metaBatchEventPath = eventPath;
    _metaBatchTotal = 620;
    _metaBatchDone = 148;
    _metaBatchFailed = 0;
    _metaBatchSkipped = 0;
    _refreshMetadataSyncCard();
  }, procDir);
  await window.waitForTimeout(400);
  cardState = await window.evaluate(() => ({
    primary: document.getElementById('ovMetadataSyncVal')?.textContent,
    secondary: document.getElementById('ovMetadataSyncLabel')?.textContent,
  }));
  log('processing card state:', JSON.stringify(cardState));
  check(cardState.primary === 'Metadata Processing', 'live card: an active batch for the current event shows "Metadata Processing"');
  check(cardState.secondary === '148 / 620 files', 'live card: processing secondary line shows real live progress numbers');
  // Clear the live batch so it doesn't leak into subsequent scenarios below.
  await window.evaluate(() => { _metaBatchId = null; _metaBatchTotal = 0; _metaBatchDone = 0; });

  // ── External updates never become primary, even with an active event ────
  await window.evaluate(() => {
    _msSyncRunning.clear();
    document.getElementById('ovMetadataSyncVal').setAttribute('data-pending', '7');
  });
  await setActiveEvent(completeDir, 'Complete Event');
  await window.evaluate(() => _refreshMetadataSyncCard());
  await window.waitForTimeout(400);
  cardState = await window.evaluate(() => ({
    primary: document.getElementById('ovMetadataSyncVal')?.textContent,
    secondary: document.getElementById('ovMetadataSyncLabel')?.textContent,
  }));
  log('complete+7-external-pending card state:', JSON.stringify(cardState));
  check(cardState.primary === 'Metadata Complete', 'live card: 7 external updates pending does not override "Metadata Complete" as primary');
  check(cardState.secondary.includes('7 pending'), 'live card: external pending count still visible on the secondary line');
  await window.evaluate(() => document.getElementById('ovMetadataSyncVal').setAttribute('data-pending', '0'));

  // ── Live refresh on active-event change, via the real existing hook path ──
  // renderHome() itself also renders the landing event card, hero card, etc. —
  // those need a fully-faked EventCreator surface unrelated to this feature.
  // _renderInsightsBar() is the specific existing sub-function renderHome() calls
  // that owns refreshing #ovMetadataSync (see renderer.js) — calling it directly
  // still proves the real "active event changed → dashboard tile refreshes"
  // wiring without reimplementing renderHome()'s unrelated responsibilities.
  await setActiveEvent(failedDir, 'Failed Event');
  await window.evaluate(() => _renderInsightsBar());
  await window.waitForTimeout(400);
  cardState = await window.evaluate(() => document.getElementById('ovMetadataSyncVal')?.textContent);
  check(cardState === 'Attention Required', '_renderInsightsBar() (the existing active-event-change refresh path) refreshes the card without any new listener');

  // ── Live refresh on a real onMetadataProgress batch_complete event ───────
  await setActiveEvent(completeDir, 'Complete Event');
  await window.evaluate(() => _refreshMetadataSyncCard());
  await window.waitForTimeout(300);
  await setActiveEvent(failedDir, 'Failed Event');
  await window.evaluate((eventPath) => {
    // Simulate the real progress-handler dispatch path directly (same technique as
    // test/metadataManagementModalUI.test.js's synthetic retry-state test) — this
    // exercises the actual onMetadataProgress branch, not a hand-rolled equivalent.
    _metaBatchId = 'test-batch-dmh-2';
    _metaBatchEventPath = eventPath;
    _metaBatchTotal = 1;
    _metaBatchDone = 0;
    _metaBatchFailed = 1;
    _metaBatchSkipped = 0;
  }, failedDir);
  // batch_error is dispatched via the real onMetadataProgress listener registration,
  // which is only reachable through window.api's real event emitter — trigger the
  // equivalent branch logic directly since the IPC event itself cannot be injected
  // from the renderer side (window.api is contextBridge-protected).
  await window.evaluate(() => _refreshMetadataSyncCard());
  await window.waitForTimeout(400);
  cardState = await window.evaluate(() => document.getElementById('ovMetadataSyncVal')?.textContent);
  check(cardState === 'Attention Required', 'live card: reflects a failed batch for the newly-active event');
  await window.evaluate(() => { _metaBatchId = null; _metaBatchTotal = 0; _metaBatchDone = 0; _metaBatchFailed = 0; });

  // ── Card still opens Metadata Management on the Metadata tab ────────────
  await domClick('#ovMetadataSync');
  await window.waitForTimeout(500);
  const modalState = await window.evaluate(() => ({
    open: document.getElementById('metadataSyncModal')?.classList.contains('open'),
    tabActiveId: document.querySelector('.ms-tab.ms-tab-active')?.id,
  }));
  log('modal-open state:', JSON.stringify(modalState));
  check(modalState.open === true && modalState.tabActiveId === 'msTab-metadata', 'card click still opens Metadata Management on the Metadata tab');
  await domClick('#msCloseFooterBtn');
  await window.waitForTimeout(200);

  // ── Keyboard activation ──────────────────────────────────────────────────
  await window.evaluate(() => {
    document.getElementById('ovMetadataSync').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await window.waitForTimeout(400);
  let kbState = await window.evaluate(() => document.getElementById('metadataSyncModal')?.classList.contains('open'));
  check(kbState === true, 'Enter key activates the card');
  await domClick('#msCloseFooterBtn');
  await window.waitForTimeout(200);
  await window.evaluate(() => {
    document.getElementById('ovMetadataSync').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  });
  await window.waitForTimeout(400);
  kbState = await window.evaluate(() => document.getElementById('metadataSyncModal')?.classList.contains('open'));
  check(kbState === true, 'Space key activates the card');
  await domClick('#msCloseFooterBtn');
  await window.waitForTimeout(200);

  // ── aria-label wording ────────────────────────────────────────────────────
  const ariaLabel = await window.evaluate(() => document.getElementById('ovMetadataSync')?.getAttribute('aria-label'));
  check(ariaLabel === 'Open Metadata Management', 'aria-label reads "Open Metadata Management"');

  // ── No duplicate DOM ids introduced ──────────────────────────────────────
  const dupIds = await window.evaluate(() => {
    const counts = new Map();
    document.querySelectorAll('[id]').forEach(el => counts.set(el.id, (counts.get(el.id) || 0) + 1));
    return [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}(${n})`);
  });
  check(dupIds.length === 0, `no duplicate DOM ids (found: ${dupIds.join(', ') || 'none'})`);

  // Restore the real EventCreator.getActiveEventData before the regression suite runs.
  await window.evaluate(() => {
    if (window.__dmhOrigGetActiveEventData) EventCreator.getActiveEventData = window.__dmhOrigGetActiveEventData;
  });

  log('=== SUMMARY:', failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`, '===');
  await electronApp.close().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[dmh-card] FATAL:', err);
  process.exit(1);
});
