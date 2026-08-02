'use strict';
// Live UI-regression coverage for the Metadata Management modal restructure —
// the former "Metadata Sync" modal (2 tabs) consolidated with the former standalone
// "Metadata Audit" modal into one 3-tab modal (Metadata / Audit & Repair / Keyword
// Registry), plus a new "AutoIngest Metadata" apply/status/retry/reapply sub-section
// added to the Metadata tab. This is UI-only: no metadata/queue/repair/audit logic,
// IPC contracts, or ExifTool behavior changed by that restructure — this test drives
// the real UI to prove the restructure itself didn't break wiring, not to re-prove
// pipeline correctness (already covered by the other test/metadata*.test.js files).
//
// Requires playwright-core (see test/metadataPipelineLive.test.js for install notes).
// Run: node test/metadataManagementModalUI.test.js

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = '/Users/funun_pa/Projects/_Auto-Ingest-Software/electron-app-v24';

function log(...args) { console.log('[mm-modal-ui]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

(async () => {
  const userDataDir = await mkTmp('ai-mm-modal-ui-userdata-');
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
    await window.fill('#splashInputName', 'MM Modal Test Operator');
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
      await window.fill('#splashInputName', 'MM Modal Test Operator');
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

  // Real click dispatched at the DOM level, bypassing Playwright actionability checks
  // on elements that may be visually inside a currently-hidden ancestor panel — still
  // exercises the real addEventListener handler (established pattern, see qmzLiveE2E.test.js).
  async function domClick(selector) {
    return window.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.click();
      return true;
    }, selector);
  }

  // ── No duplicate DOM ids anywhere in the document ──────────────────────────────
  const dupIds = await window.evaluate(() => {
    const counts = new Map();
    document.querySelectorAll('[id]').forEach(el => counts.set(el.id, (counts.get(el.id) || 0) + 1));
    return [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}(${n})`);
  });
  check(dupIds.length === 0, `no duplicate DOM ids present (found: ${dupIds.join(', ') || 'none'})`);

  // ── The standalone #metadataAuditModal is fully gone; its poll-stopper is bridged ──
  const auditModalGone = await window.evaluate(() => document.getElementById('metadataAuditModal') === null);
  check(auditModalGone, 'standalone #metadataAuditModal no longer exists in the DOM');
  const stopPollBridged = await window.evaluate(() => typeof window._maStopPoll === 'function');
  check(stopPollBridged, 'window._maStopPoll bridge is wired (audit code loaded inside the consolidated modal)');

  // ── Dashboard tile opens the consolidated modal on the Metadata tab ────────────
  await domClick('#ovMetadataSync');
  await window.waitForTimeout(500);
  let modalState = await window.evaluate(() => ({
    open:     document.getElementById('metadataSyncModal')?.classList.contains('open'),
    title:    document.getElementById('msTitle')?.textContent,
    tabActiveId: document.querySelector('.ms-tab.ms-tab-active')?.id,
    ariaLabel: document.getElementById('ovMetadataSync')?.getAttribute('aria-label'),
  }));
  log('modal state after dashboard tile click:', JSON.stringify(modalState));
  check(modalState.open === true, 'dashboard tile opens the Metadata Management modal');
  check(modalState.title === 'Metadata Management', 'modal title reads "Metadata Management"');
  check(modalState.tabActiveId === 'msTab-metadata', 'default tab on dashboard-tile open is Metadata');
  check(modalState.ariaLabel === 'Open Metadata Management', 'dashboard tile aria-label updated to Metadata Management');

  // ── AutoIngest Metadata sub-section: context row + disabled Reapply with no active event ──
  const applyStatusState = await window.evaluate(() => ({
    contextRowText: document.getElementById('msCurrentEventRow')?.textContent,
    reapplyBtn: document.getElementById('msReapplyMetaBtn'),
    reapplyDisabled: document.getElementById('msReapplyMetaBtn')?.disabled,
  }));
  log('AutoIngest Metadata sub-section state:', JSON.stringify({
    contextRowText: applyStatusState.contextRowText,
    hasReapplyBtn: !!applyStatusState.reapplyBtn,
    reapplyDisabled: applyStatusState.reapplyDisabled,
  }));
  check(
    /No event selected/.test(applyStatusState.contextRowText || ''),
    'Current Event context row correctly shows "No event selected" with no active event'
  );
  check(
    !applyStatusState.reapplyBtn || applyStatusState.reapplyDisabled === true,
    'Reapply Metadata is absent or disabled when no valid event context exists'
  );

  // ── Tab switching: Audit & Repair ───────────────────────────────────────────────
  await domClick('[data-ms-tab="msTabAudit"]');
  await window.waitForTimeout(200);
  let auditTabState = await window.evaluate(() => ({
    auditVisible:    document.getElementById('msTabAudit')?.style.display !== 'none',
    metadataHidden:  document.getElementById('msTabMetadata')?.style.display === 'none',
    exportJsonHidden: document.getElementById('maExportJsonBtn')?.hidden,
    exportCsvHidden:  document.getElementById('maExportCsvBtn')?.hidden,
    repairBtnHidden:  document.getElementById('maRepairBtn')?.hidden,
    statusText:       document.getElementById('maStatusText')?.textContent,
  }));
  log('Audit & Repair tab state:', JSON.stringify(auditTabState));
  check(auditTabState.auditVisible === true, 'Audit & Repair panel becomes visible on tab switch');
  check(auditTabState.metadataHidden === true, 'Metadata panel hides when Audit & Repair is active');
  check(
    auditTabState.exportJsonHidden === true && auditTabState.exportCsvHidden === true && auditTabState.repairBtnHidden === true,
    'audit action buttons (Export JSON/CSV, Repair) stay hidden merely from switching tabs — no audit has run yet'
  );
  check(/Idle/.test(auditTabState.statusText || ''), 'audit status text shows its normal idle state, unaffected by relocation');

  // ── Tab switching: Keyword Registry ─────────────────────────────────────────────
  await domClick('[data-ms-tab="msTabRegistry"]');
  await window.waitForTimeout(200);
  let registryTabState = await window.evaluate(() => ({
    registryVisible: document.getElementById('msTabRegistry')?.style.display !== 'none',
    auditHidden:     document.getElementById('msTabAudit')?.style.display === 'none',
    hasImportBtn:    !!document.getElementById('msBridgeImportBtn'),
  }));
  log('Keyword Registry tab state:', JSON.stringify(registryTabState));
  check(registryTabState.registryVisible === true, 'Keyword Registry panel becomes visible on tab switch');
  check(registryTabState.auditHidden === true, 'Audit & Repair panel hides when Keyword Registry is active');
  check(registryTabState.hasImportBtn === true, 'Keyword Registry controls (Bridge import) are present and unchanged');

  // ── Close via the shared footer Close button ────────────────────────────────────
  await domClick('#msCloseFooterBtn');
  await window.waitForTimeout(200);
  const closedState = await window.evaluate(() => document.getElementById('metadataSyncModal')?.classList.contains('open'));
  check(closedState === false, 'Close button closes the modal');

  // ── openMetadataSyncModal({tab: 'msTabAudit'}) still targets Audit & Repair directly.
  // No current UI trigger calls it with this option (the former #alocMetadataAuditBtn
  // deep-link from Archive Location Setup was removed — Metadata Management is now
  // the sole audit entry point, reached via the dashboard tile's default-tab open,
  // then manually switching to Audit & Repair) — kept as defensive coverage of the
  // open function's own tab-targeting behavior. ──
  await window.evaluate(() => window.openMetadataSyncModal({ tab: 'msTabAudit' }));
  await window.waitForTimeout(500);
  let directAuditOpen = await window.evaluate(() => ({
    open: document.getElementById('metadataSyncModal')?.classList.contains('open'),
    tabActiveId: document.querySelector('.ms-tab.ms-tab-active')?.id,
  }));
  log('direct Audit-tab open state:', JSON.stringify(directAuditOpen));
  check(directAuditOpen.open === true && directAuditOpen.tabActiveId === 'msTab-audit', 'opening with {tab: "msTabAudit"} lands directly on Audit & Repair');
  await domClick('#msCloseFooterBtn');
  await window.waitForTimeout(200);

  // ── Metadata Audit is no longer a separate entry point inside Archive Location
  // Setup — it was consolidated into Metadata Management → Audit & Repair (the
  // {tab: 'msTabAudit'} open path checked above). #alocMetadataAuditBtn must not
  // exist anywhere in the DOM, and the Advanced Archive Operations section must
  // not have gained a replacement audit entry of any kind. ──
  const alocAuditRemoved = await window.evaluate(() => ({
    btnGone: document.getElementById('alocMetadataAuditBtn') === null,
    advancedRowText: document.querySelector('.aloc-advanced-row')?.textContent || '',
  }));
  log('Archive Location Setup Advanced Archive Operations state:', JSON.stringify(alocAuditRemoved));
  check(alocAuditRemoved.btnGone, '#alocMetadataAuditBtn no longer exists in the DOM');
  check(!/audit/i.test(alocAuditRemoved.advancedRowText), 'Advanced Archive Operations no longer mentions Metadata Audit in any form');

  // ── Backdrop-click / Escape guard: no-op while a repair preview or reapply is pending ──
  // Self-contained: explicitly (re)open the modal rather than relying on a prior
  // test block happening to leave it open as a side effect.
  await window.evaluate(() => window.openMetadataSyncModal());
  await window.waitForTimeout(300);
  await window.evaluate(() => { _metaReapplyPending = true; });
  await window.evaluate(() => {
    document.getElementById('metadataSyncModal')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  // Dispatch directly at the overlay element with target === overlay, matching the real guard check.
  const stillOpenDuringReapply = await window.evaluate(() => {
    const overlay = document.getElementById('metadataSyncModal');
    const ev = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(ev, 'target', { value: overlay });
    overlay.dispatchEvent(ev);
    return overlay.classList.contains('open');
  });
  check(stillOpenDuringReapply === true, 'backdrop click is a no-op while _metaReapplyPending is true');
  await window.evaluate(() => { _metaReapplyPending = false; });
  const closesAfterClear = await window.evaluate(() => {
    const overlay = document.getElementById('metadataSyncModal');
    const ev = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(ev, 'target', { value: overlay });
    overlay.dispatchEvent(ev);
    return overlay.classList.contains('open');
  });
  check(closesAfterClear === false, 'backdrop click closes the modal again once the guarded state clears');

  // ── Retry Failed wiring: Metadata Management's copy runs the same click handler
  // as Activity Log's (_wireAlRetryBtn), which itself calls the real
  // window.api.retryMetadata IPC. contextBridge-exposed objects aren't reliably
  // stubbable from the page side, so this checks the handler's own synchronous
  // pre-IPC side effects (_metaRetryPending flips true, button disables and
  // relabels) instead of intercepting the IPC call itself — same code path,
  // observable without fighting contextBridge's isolation. ──
  await window.evaluate(() => window.openMetadataSyncModal({ tab: 'msTabMetadata' }));
  await window.waitForTimeout(300);
  await window.evaluate(() => {
    _metaBatchId     = 'test-batch-mm-modal-ui';
    _metaBatchFailed = 1;
    _metaRetryPending = false;
    _refreshMsApplyStatusPanel();
  });
  await window.waitForTimeout(200);
  const retryBtnExists = await window.evaluate(() => !!document.getElementById('msRetryMetaBtn'));
  check(retryBtnExists, 'Retry Failed button (ms-prefixed) renders when a failed batch is present');
  if (retryBtnExists) {
    const postClickState = await window.evaluate(() => {
      const btn = document.getElementById('msRetryMetaBtn');
      btn.click();
      return { pending: _metaRetryPending, disabled: btn.disabled, text: btn.textContent };
    });
    log('msRetryMetaBtn click synchronous state:', JSON.stringify(postClickState));
    check(
      postClickState.pending === true && postClickState.disabled === true && postClickState.text === 'Retrying…',
      'clicking Retry Failed in Metadata Management runs the same _wireAlRetryBtn handler the real pipeline uses (sets _metaRetryPending, disables + relabels the button before the IPC call)'
    );
  }

  // ── Final duplicate-id sanity check after all the above open/close/tab-switch churn ──
  const dupIdsFinal = await window.evaluate(() => {
    const counts = new Map();
    document.querySelectorAll('[id]').forEach(el => counts.set(el.id, (counts.get(el.id) || 0) + 1));
    return [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}(${n})`);
  });
  check(dupIdsFinal.length === 0, `still no duplicate DOM ids after repeated open/close/tab-switch (found: ${dupIdsFinal.join(', ') || 'none'})`);

  log('=== SUMMARY:', failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`, '===');
  await electronApp.close().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[mm-modal-ui] FATAL:', err);
  process.exit(1);
});
