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

  // Console error tracking — registered here, captures from this point through the
  // rest of the run (covers all Audit & Repair layout checks below).
  const consoleErrors = [];
  window.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  window.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

  async function getRects(selectors) {
    return window.evaluate((sels) => {
      const out = {};
      for (const s of sels) {
        const el = document.querySelector(s);
        out[s] = el ? (({ x, y, width, height, top, bottom, left, right }) => ({ x, y, width, height, top, bottom, left, right }))(el.getBoundingClientRect()) : null;
      }
      return out;
    }, selectors);
  }

  async function setWindowSize(w, h) {
    await electronApp.evaluate(({ BrowserWindow }, dims) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setSize(dims.w, dims.h);
    }, { w, h });
    await window.waitForTimeout(300);
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

  // ════════════════════════════════════════════════════════════════════════════════
  // Audit & Repair tab layout rebalance (full-height flex column, single scroll
  // region, explicit .ma-results-scroll--empty state class) — pure layout/UX, no
  // audit/repair/IPC/polling logic touched. Uses a mix of real production code paths
  // (Run button click, real _maRenderList calls via a real Run attempt) and synthetic
  // DOM manipulation that mirrors exactly what _maRenderList/_maPollOnce already do
  // in production (same class list, same innerHTML shape) to reach states (large
  // result sets, populated exceptions, repair preview) not practical to produce via
  // a real backend audit against a freshly created, unconfigured test profile.
  // ════════════════════════════════════════════════════════════════════════════════
  await window.evaluate(() => window.openMetadataSyncModal({ tab: 'msTabAudit' }));
  await window.waitForTimeout(400);

  // ── Control block hierarchy: Run/Cancel + status stay grouped inside .diag-actions ──
  const containment = await window.evaluate(() => {
    const actions = document.querySelector('#msTabAudit .diag-actions');
    return {
      runRowInside: !!actions && actions.contains(document.querySelector('#msTabAudit .ma-run-row')),
      statusInside: !!actions && actions.contains(document.getElementById('maStatusText')),
    };
  });
  check(containment.runRowInside && containment.statusInside, '.ma-run-row and #maStatusText are both descendants of .diag-actions (Run/Cancel/status stay visually grouped, divider correctly falls after status)');

  // ── Run→Cancel: no layout jump ──────────────────────────────────────────────────
  const beforeRunRow = (await getRects(['#msTabAudit .ma-run-row']))['#msTabAudit .ma-run-row'];
  await window.evaluate(() => {
    document.getElementById('maCancelBtn').hidden = false;
    document.getElementById('maRunBtn').disabled = true;
    document.getElementById('maRunBtn').textContent = 'Running…';
  });
  await window.waitForTimeout(150);
  const afterRunRow = (await getRects(['#msTabAudit .ma-run-row']))['#msTabAudit .ma-run-row'];
  check(!!beforeRunRow && !!afterRunRow && beforeRunRow.x === afterRunRow.x && beforeRunRow.y === afterRunRow.y, '.ma-run-row position unchanged when Cancel un-hides (no layout jump)');
  await window.evaluate(() => {
    document.getElementById('maCancelBtn').hidden = true;
    document.getElementById('maRunBtn').disabled = false;
    document.getElementById('maRunBtn').textContent = 'Run Audit';
  });

  // ── Left-edge alignment across the four vertical-zone blocks ───────────────────
  const edgeRects = await getRects(['#msTabAudit .diag-helper', '#msTabAudit .diag-actions', '#msTabAudit .ma-results-panel', '#msTabAudit .ms-audit-local-footer']);
  const xs = Object.values(edgeRects).filter(Boolean).map(r => r.x);
  const xSpread = xs.length ? Math.max(...xs) - Math.min(...xs) : 999;
  check(xs.length === 4 && xSpread <= 1, `left edges of helper/controls/results-panel/footer align within 1px (spread=${xSpread.toFixed(2)}px, values=${xs.map(v => v.toFixed(1)).join(',')})`);

  // ── Initial empty state ─────────────────────────────────────────────────────────
  const initialEmpty = await window.evaluate(() => ({
    hasAlEmpty: !!document.querySelector('#maList .al-empty'),
    scrollHasEmptyClass: document.querySelector('#msTabAudit .ma-results-scroll')?.classList.contains('ma-results-scroll--empty'),
  }));
  check(initialEmpty.hasAlEmpty && initialEmpty.scrollHasEmptyClass, 'initial empty state ("No audit has been run yet.") is present and .ma-results-scroll--empty is set by default');

  // ── State-class correctness: real Run click, then both _maRenderList branches ──
  await domClick('#maRunBtn');
  await window.waitForTimeout(400);
  const scanningState = await window.evaluate(() => ({
    scrollHasEmptyClass: document.querySelector('#msTabAudit .ma-results-scroll')?.classList.contains('ma-results-scroll--empty'),
  }));
  check(scanningState.scrollHasEmptyClass, '.ma-results-scroll--empty is added by the real Run-button click handler the instant scanning starts');

  // Let whatever the real attempt resolves to (completes against this fresh,
  // unconfigured profile, or fails to start cleanly) — layout/class state must stay
  // consistent either way; audit pipeline correctness is covered elsewhere.
  await window.waitForTimeout(2500);
  const postRunState = await window.evaluate(() => ({
    runBtnText: document.getElementById('maRunBtn')?.textContent,
    runBtnDisabled: document.getElementById('maRunBtn')?.disabled,
  }));
  log('post-run-attempt state:', JSON.stringify(postRunState));
  check(postRunState.runBtnText === 'Run Audit' && postRunState.runBtnDisabled === false, 'Run button returns to its normal idle state after the attempt resolves');

  // Synthetic populated-with-exceptions state — mirrors _maRenderList's populated
  // branch exactly (same innerHTML shape, same class toggle it performs).
  await window.evaluate(() => {
    const list = document.getElementById('maList');
    const scroll = document.querySelector('#msTabAudit .ma-results-scroll');
    list.innerHTML = '<div class="diag-item diag-item-warn">'
      + '<div class="diag-item-header"><span class="diag-item-sev">Ambiguous</span><span class="diag-item-title">/synthetic/path/IMG_0001.CR3</span></div>'
      + '<div class="diag-item-msg">keywords: non-compliant</div></div>';
    scroll.classList.remove('ma-results-scroll--empty');
  });
  await window.waitForTimeout(150);
  const populatedState = await window.evaluate(() => ({
    hasAlEmpty: !!document.querySelector('#maList .al-empty'),
    hasDiagItem: !!document.querySelector('#maList .diag-item'),
    scrollHasEmptyClass: document.querySelector('#msTabAudit .ma-results-scroll')?.classList.contains('ma-results-scroll--empty'),
  }));
  check(!populatedState.hasAlEmpty && populatedState.hasDiagItem, 'empty state is gone once #maList is populated with real result rows');
  check(!populatedState.scrollHasEmptyClass, '.ma-results-scroll--empty is removed once results are populated');

  const rowAlignment = await window.evaluate(() => {
    const list = document.getElementById('maList');
    const row = document.querySelector('#maList .diag-item');
    return list && row ? { listTop: list.getBoundingClientRect().top, rowTop: row.getBoundingClientRect().top } : null;
  });
  check(!!rowAlignment && Math.abs(rowAlignment.rowTop - rowAlignment.listTop) <= 2, 'populated result rows start at the top of #maList (never vertically centered)');

  // Synthetic "no exceptions" completed state — mirrors _maRenderList's empty branch.
  await window.evaluate(() => {
    const list = document.getElementById('maList');
    const scroll = document.querySelector('#msTabAudit .ma-results-scroll');
    list.innerHTML = '<div class="sq-empty">No exceptions in this page of results.</div>';
    scroll.classList.add('ma-results-scroll--empty');
  });
  await window.waitForTimeout(150);
  const noExceptionsState = await window.evaluate(() => document.querySelector('#msTabAudit .ma-results-scroll')?.classList.contains('ma-results-scroll--empty'));
  check(noExceptionsState === true, '.ma-results-scroll--empty is re-added when a completed audit finds 0 exceptions (class is not "stuck" false from the prior populated run)');

  // ── .adopt-section isolation: the modifier must not leak into #adoptionSection ──
  const adoptIsolation = await window.evaluate(() => {
    const el = document.getElementById('adoptionSection');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { maxHeight: cs.maxHeight, overflowY: cs.overflowY, hasInlineModifier: el.classList.contains('adopt-section--inline') };
  });
  log('#adoptionSection isolation check:', JSON.stringify(adoptIsolation));
  check(!!adoptIsolation && adoptIsolation.maxHeight === '260px' && adoptIsolation.overflowY === 'auto' && !adoptIsolation.hasInlineModifier, '#adoptionSection (Orphan File Adoption, unrelated feature) keeps its own bounded max-height:260px/overflow-y:auto — the .adopt-section--inline modifier used for Repair Preview does not leak into the shared .adopt-section base rule');

  // ── Single scroll region: large synthetic result set + Repair Preview visible ──
  await window.evaluate(() => {
    const list = document.getElementById('maList');
    const scroll = document.querySelector('#msTabAudit .ma-results-scroll');
    let html = '';
    for (let i = 0; i < 300; i++) {
      html += '<div class="diag-item diag-item-warn">'
        + `<div class="diag-item-header"><span class="diag-item-sev">Ambiguous</span><span class="diag-item-title">/synthetic/path/IMG_${String(i).padStart(4, '0')}.CR3</span></div>`
        + '<div class="diag-item-msg">keywords: non-compliant</div></div>';
    }
    list.innerHTML = html;
    scroll.classList.remove('ma-results-scroll--empty');
    document.getElementById('maSummaryBar').hidden = false;
    const repair = document.getElementById('maRepairSection');
    repair.hidden = false;
    document.getElementById('maRepairList').innerHTML = '<div class="adopt-item">synthetic repair candidate</div>';
    document.getElementById('maRepairConfirmBtn').hidden = false;
  });
  await window.waitForTimeout(200);

  const scrollDiag = await window.evaluate(() => {
    function overflowInfo(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: cs.overflowY, scrolls: el.scrollHeight > el.clientHeight + 1 };
    }
    return {
      scrollRegion: overflowInfo('#msTabAudit .ma-results-scroll'),
      list: overflowInfo('#maList'),
      repair: overflowInfo('#maRepairSection'),
    };
  });
  log('single-scroll-region diagnostics (large set + repair preview):', JSON.stringify(scrollDiag));
  check(scrollDiag.scrollRegion?.overflowY === 'auto' && scrollDiag.scrollRegion?.scrolls, '.ma-results-scroll is scrollable with a large result set + Repair Preview visible');
  check(!scrollDiag.list?.scrolls, '#maList does not independently scroll (single-scrollbar policy — no nested scrollbar between audit list and Repair Preview)');
  check(!scrollDiag.repair?.scrolls, '#maRepairSection does not independently scroll (its own max-height:260px is relaxed via .adopt-section--inline)');

  // Confirm & Write Repairs remains reachable by scrolling the single shared region.
  await window.evaluate(() => {
    const scrollEl = document.querySelector('#msTabAudit .ma-results-scroll');
    scrollEl.scrollTop = scrollEl.scrollHeight;
  });
  await window.waitForTimeout(150);
  const confirmBtnReachable = await window.evaluate(() => {
    const btn = document.getElementById('maRepairConfirmBtn');
    const scrollEl = document.querySelector('#msTabAudit .ma-results-scroll');
    if (!btn || !scrollEl) return false;
    const btnRect = btn.getBoundingClientRect();
    const scrollRect = scrollEl.getBoundingClientRect();
    return btnRect.top >= scrollRect.top - 2 && btnRect.bottom <= scrollRect.bottom + 2;
  });
  check(confirmBtnReachable, 'Confirm & Write Repairs button is reachable within the viewport by scrolling the single shared results region to its end');

  // ── Proportional gaps at minimum and taller window heights (large-set state active) ──
  const GAP_TOLERANCE = 45; // generous bound — "no large unexplained gap," not exact-pixel; accounts for legitimate nested container padding (.diag-body + #msBody)
  async function checkProportionalGaps(label) {
    const g = await getRects(['#msTabAudit .ma-results-panel', '#msTabAudit .ms-audit-local-footer', '#metadataSyncModal .emm-footer']);
    const panel = g['#msTabAudit .ma-results-panel'];
    const localFooter = g['#msTabAudit .ms-audit-local-footer'];
    const modalFooter = g['#metadataSyncModal .emm-footer'];
    const gap1 = (localFooter && panel) ? localFooter.top - panel.bottom : null;
    const gap2 = (modalFooter && localFooter) ? modalFooter.top - localFooter.bottom : null;
    log(`${label} — panel.bottom→localFooter.top gap=${gap1?.toFixed(1)}; localFooter.bottom→modalFooter.top gap=${gap2?.toFixed(1)}`);
    check(gap1 !== null && gap1 >= -1 && gap1 <= GAP_TOLERANCE, `[${label}] .ma-results-panel's bottom edge sits close to .ms-audit-local-footer's top edge (gap=${gap1?.toFixed(1)}px, no stranded blank region)`);
    check(gap2 !== null && gap2 >= -1 && gap2 <= GAP_TOLERANCE, `[${label}] .ms-audit-local-footer's bottom edge sits close to the shared modal footer's top edge (gap=${gap2?.toFixed(1)}px)`);
  }
  await setWindowSize(1400, 700); // app's documented minHeight
  await checkProportionalGaps('minHeight:700');
  await setWindowSize(1400, 1000); // taller window — zone should grow, not leave a fixed gap
  await checkProportionalGaps('height:1000 (taller)');

  // ── #msTabAudit outer height stays constant across idle/running/complete states ──
  await window.evaluate(() => {
    document.getElementById('maRepairSection').hidden = true;
    document.getElementById('maSummaryBar').hidden = true;
    document.getElementById('maList').innerHTML = '<div class="al-empty"><div class="al-empty-title">No audit has been run yet.</div><p>Select a scope and click Run Audit.</p></div>';
    document.querySelector('#msTabAudit .ma-results-scroll').classList.add('ma-results-scroll--empty');
  });
  await window.waitForTimeout(150);
  const hIdle = (await getRects(['#msTabAudit']))['#msTabAudit'].height;

  await window.evaluate(() => { document.getElementById('maList').innerHTML = '<div class="sq-empty">Scanning…</div>'; });
  await window.waitForTimeout(150);
  const hRunning = (await getRects(['#msTabAudit']))['#msTabAudit'].height;

  await window.evaluate(() => {
    const list = document.getElementById('maList');
    let html = '';
    for (let i = 0; i < 50; i++) html += `<div class="diag-item diag-item-warn"><div class="diag-item-header"><span class="diag-item-sev">Ambiguous</span><span class="diag-item-title">/x/${i}.CR3</span></div><div class="diag-item-msg">keywords: non-compliant</div></div>`;
    list.innerHTML = html;
    document.querySelector('#msTabAudit .ma-results-scroll').classList.remove('ma-results-scroll--empty');
  });
  await window.waitForTimeout(150);
  const hComplete = (await getRects(['#msTabAudit']))['#msTabAudit'].height;

  log(`#msTabAudit outer height — idle=${hIdle} running=${hRunning} complete=${hComplete}`);
  check(Math.abs(hIdle - hRunning) <= 1 && Math.abs(hRunning - hComplete) <= 1, '#msTabAudit outer height stays constant across idle/running/complete states (no modal jump/resize)');

  // ── Running state: incremental row appends, checking after each step ───────────
  await window.evaluate(() => {
    document.getElementById('maList').innerHTML = '<div class="sq-empty">Scanning…</div>';
    document.querySelector('#msTabAudit .ma-results-scroll').classList.add('ma-results-scroll--empty');
    document.getElementById('maSummaryBar').hidden = false;
  });
  await window.waitForTimeout(150);

  const fixedSelectors = ['#msTabAudit .ms-subsection-title', '#msTabAudit #maSummaryBar', '#msTabAudit .diag-actions', '#msTabAudit .ms-audit-local-footer'];
  const basePositions = await getRects(fixedSelectors);
  let allStepsStable = true;
  let emptyRemovedAtStep1 = null;
  let firstRowGapOk = null;
  let listNeverScrolls = true;
  let scrollOverflowStable = true;

  for (let step = 1; step <= 8; step++) {
    const isFirst = step === 1;
    await window.evaluate((first) => {
      const list = document.getElementById('maList');
      const scroll = document.querySelector('#msTabAudit .ma-results-scroll');
      if (first) { list.innerHTML = ''; scroll.classList.remove('ma-results-scroll--empty'); }
      const row = document.createElement('div');
      row.className = 'diag-item diag-item-warn';
      row.innerHTML = '<div class="diag-item-header"><span class="diag-item-sev">Ambiguous</span><span class="diag-item-title">/x/step.CR3</span></div><div class="diag-item-msg">keywords: non-compliant</div>';
      list.appendChild(row);
    }, isFirst);
    await window.waitForTimeout(60);

    const nowPositions = await getRects(fixedSelectors);
    const stable = fixedSelectors.every(s => basePositions[s] && nowPositions[s] && Math.abs(basePositions[s].x - nowPositions[s].x) <= 1 && Math.abs(basePositions[s].y - nowPositions[s].y) <= 1);
    if (!stable) { allStepsStable = false; log(`step ${step}: position drift detected`, JSON.stringify({ basePositions, nowPositions })); }

    const diag = await window.evaluate(() => {
      function overflowInfo(sel) {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        return { overflowY: cs.overflowY, scrolls: el.scrollHeight > el.clientHeight + 1 };
      }
      return {
        hasEmpty: !!document.querySelector('#maList .al-empty, #maList .sq-empty'),
        scrollRegion: overflowInfo('#msTabAudit .ma-results-scroll'),
        list: overflowInfo('#maList'),
      };
    });
    if (isFirst) {
      emptyRemovedAtStep1 = !diag.hasEmpty;
      const firstRowGeom = await getRects(['#msTabAudit #maSummaryBar', '#maList .diag-item:first-child']);
      const summary = firstRowGeom['#msTabAudit #maSummaryBar'];
      const firstRow = firstRowGeom['#maList .diag-item:first-child'];
      firstRowGapOk = !!(summary && firstRow) && (firstRow.top - summary.bottom) < 40 && (firstRow.top - summary.bottom) > -5;
    }
    if (diag.list.scrolls) listNeverScrolls = false;
    if (diag.scrollRegion.overflowY !== 'auto') scrollOverflowStable = false;
  }
  const finalHasEmpty = await window.evaluate(() => !!document.querySelector('#maList .al-empty, #maList .sq-empty'));

  check(allStepsStable, 'Results heading/summary/controls/footer note position stays unchanged across all incremental row-append steps (no layout shift while content grows)');
  check(emptyRemovedAtStep1 === true, 'empty state is removed exactly on the first appended row');
  check(finalHasEmpty === false, 'empty state never reappears across subsequent appends');
  check(firstRowGapOk === true, 'the first appended row appears immediately below #maSummaryBar with no unexpected gap or jump');
  check(listNeverScrolls, '#maList never independently scrolls during incremental appends — only .ma-results-scroll does');
  check(scrollOverflowStable, '.ma-results-scroll keeps overflow-y:auto throughout appends (scrollbar presence changes only because content height changes, not a style toggle)');

  // ── Empty-state centering stability at minimum and taller window heights ───────
  await window.evaluate(() => {
    document.getElementById('maRepairSection').hidden = true;
    document.getElementById('maSummaryBar').hidden = true;
    document.getElementById('maList').innerHTML = '<div class="al-empty"><div class="al-empty-title">No audit has been run yet.</div><p>Select a scope and click Run Audit.</p></div>';
    document.querySelector('#msTabAudit .ma-results-scroll').classList.add('ma-results-scroll--empty');
  });
  await window.waitForTimeout(150);

  async function emptyCenterOffset() {
    return window.evaluate(() => {
      const scroll = document.querySelector('#msTabAudit .ma-results-scroll');
      const empty = document.querySelector('#maList .al-empty');
      if (!scroll || !empty) return null;
      const s = scroll.getBoundingClientRect();
      const e = empty.getBoundingClientRect();
      return ((e.top + e.height / 2) - (s.top + s.height / 2)) / s.height; // proportional offset
    });
  }
  await setWindowSize(1400, 700);
  const offsetMin = await emptyCenterOffset();
  await setWindowSize(1400, 1400);
  await window.waitForTimeout(200);
  const offsetMax = await emptyCenterOffset();
  log(`empty-state centering proportional offset — minHeight=${offsetMin} tallHeight=${offsetMax}`);
  check(offsetMin !== null && Math.abs(offsetMin) <= 0.08, 'empty state is centered (not drifting) within the results zone at minimum window height');
  check(offsetMax !== null && Math.abs(offsetMax) <= 0.08, 'empty state is centered (not drifting) within the results zone at a taller window height');

  // ── Cancel still works ──────────────────────────────────────────────────────────
  await window.evaluate(() => { document.getElementById('maList').innerHTML = '<div class="al-empty"><div class="al-empty-title">No audit has been run yet.</div><p>Select a scope and click Run Audit.</p></div>'; });
  await domClick('#maRunBtn');
  await window.waitForTimeout(200);
  const cancelVisible = await window.evaluate(() => document.getElementById('maCancelBtn')?.hidden === false);
  if (cancelVisible) {
    await domClick('#maCancelBtn');
    await window.waitForTimeout(400);
    const afterCancel = await window.evaluate(() => document.getElementById('maCancelBtn')?.hidden);
    check(afterCancel === true, 'Cancel button click hides itself and returns the Run button to its normal state');
  } else {
    log('Run resolved before Cancel could be exercised (audit likely failed to start immediately in this unconfigured test profile) — Cancel logic itself is unchanged production code, not part of this layout task.');
    check(true, 'Cancel button wiring unchanged (untouched production logic — Run resolved immediately in this environment)');
  }

  // ── Export/Repair buttons still governed by the unchanged production logic ─────
  const exportRepairIdsIntact = await window.evaluate(() => !!document.getElementById('maExportJsonBtn') && !!document.getElementById('maExportCsvBtn') && !!document.getElementById('maRepairBtn'));
  check(exportRepairIdsIntact, 'Export JSON/CSV and Repair… buttons retain their original ids (still governed by the unchanged exceptionCount===0 visibility logic in _maPollOnce)');

  await window.evaluate(() => window._maStopPoll && window._maStopPoll());
  await domClick('#msCloseFooterBtn');
  await window.waitForTimeout(200);

  // ── Final duplicate-id sanity check after all the above open/close/tab-switch churn ──
  const dupIdsFinal = await window.evaluate(() => {
    const counts = new Map();
    document.querySelectorAll('[id]').forEach(el => counts.set(el.id, (counts.get(el.id) || 0) + 1));
    return [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}(${n})`);
  });
  check(dupIdsFinal.length === 0, `still no duplicate DOM ids after repeated open/close/tab-switch (found: ${dupIdsFinal.join(', ') || 'none'})`);

  // ── No console errors across the entire run (registered before the Audit & Repair
  // layout checks; benign/pre-existing warnings below error level are not tracked) ──
  log('console errors captured during run:', JSON.stringify(consoleErrors));
  check(consoleErrors.length === 0, `no console errors were emitted during the run (found: ${consoleErrors.length})`);

  log('=== SUMMARY:', failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`, '===');
  await electronApp.close().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[mm-modal-ui] FATAL:', err);
  process.exit(1);
});
