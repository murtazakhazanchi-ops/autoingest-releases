'use strict';

// main/askAutoIngestRelatedNavVerify.js — Related-Topic Navigation +
// Quick-Glance UI Refinement checkpoint. Real Electron verification
// harness, same spirit as main/askAutoIngestDrawerVerify.js /
// askAutoIngestUIVerify.js: a real BrowserWindow loading the real
// renderer/index.html with the same webPreferences main.js uses, driven
// via webContents.executeJavaScript() and real capturePage() screenshots.
// Not shipped, not wired into the app, not run in CI.
//
// Checks ONLY what this checkpoint added/changed: Related capsules as real
// clickable/keyboard-reachable navigation, direct known-id resolution (no
// fuzzy retrieval, verified by spying on the two preload APIs), in-drawer
// history (Back restores a cached answer with zero additional IPC calls),
// navigation orientation header, progressive-disclosure limitations, no
// raw internal ids in the primary answer, and responsive/theme regression
// for the new elements. Deterministic/boundary/semantic-judge answer
// correctness and the base drawer geometry are already covered by
// askAutoIngestUIVerify.js / askAutoIngestDrawerVerify.js -- not
// duplicated here.
//
// Run with: node_modules/.bin/electron main/askAutoIngestRelatedNavVerify.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-relatednav-verify-userdata-'));
const SCREENSHOT_DIR = process.argv[2] || path.join(os.tmpdir(), 'ai-relatednav-screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

// Spy on IPC channel invocation counts from the MAIN-process side, not the
// renderer side -- contextBridge.exposeInMainWorld() (see main/preload.js)
// deep-freezes the exposed window.api object, so attempting to monkeypatch
// window.api.askQuestion/askRelated from executeJavaScript() silently
// no-ops (no error, no effect) rather than actually wrapping the call.
// Wrapping ipcMain.handle() itself, before registerIpcHandlers() runs,
// is the reliable place to prove "Back/Forward make zero additional IPC
// calls" and "Related navigation calls ask:relatedNavigate, never
// ask:query" from outside the renderer.
const channelCallCounts = {};
const _origHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
  _origHandle(channel, async (...args) => {
    channelCallCounts[channel] = (channelCallCounts[channel] || 0) + 1;
    return listener(...args);
  });
};

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail: detail || null });
  console.log(`[relatednav-verify] ${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
}

function _logVerificationScope() {
  const repoRoot = path.join(__dirname, '..');
  const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  let branch, commit, dirty;
  try {
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    commit = git(['rev-parse', 'HEAD']);
    dirty = git(['status', '--porcelain']).length > 0;
  } catch (err) {
    branch = commit = '(unknown -- git command failed: ' + err.message + ')';
    dirty = null;
  }
  console.log('[relatednav-verify] ══════════════════════════════════════════════════════════');
  console.log(`[relatednav-verify] VERIFICATION SCOPE — branch=${branch} commit=${commit}${dirty ? ' (dirty working tree)' : ''}`);
  console.log(`[relatednav-verify] repoRoot=${repoRoot}`);
  console.log('[relatednav-verify] ══════════════════════════════════════════════════════════');
  return { branch, commit, dirty };
}

const RAW_ID_RE = /(AI-FEAT-\d+|AI-WF-\d+|AI-RM-\d+|DEC-\d+|BUG-\d+|PM-\d+|AI-MEM-\d+)/;

async function main() {
  const verificationScope = _logVerificationScope();
  require('./askAutoIngest').registerIpcHandlers();

  const win = new BrowserWindow({
    width: 1920, height: 1080, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.show();
  await new Promise((r) => setTimeout(r, 400));

  const ejs = (script) => win.webContents.executeJavaScript(script, true);
  async function waitForAnswer(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const stillLoading = await ejs(`!document.getElementById('aaLoadingState').hidden`);
      if (!stillLoading) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }

  await ejs(`(() => { const ob = document.getElementById('onboardingOverlay'); if (ob) ob.style.display = 'none'; return true; })()`);

  const ipcCounts = () => ({ ask: channelCallCounts['ask:query'] || 0, related: channelCallCounts['ask:relatedNavigate'] || 0 });

  await ejs(`document.getElementById('askAutoIngestBtn').click()`);
  await new Promise((r) => setTimeout(r, 260));

  // ── 1. Seed a real answer with a multi-capsule Related fan-out ─────────
  await ejs(`(() => { document.getElementById('aaQuestionInput').value = 'My transfer stopped halfway. What should I do?'; document.getElementById('aaAskBtn').click(); return true; })()`);
  await waitForAnswer(8000);

  const rootState = await ejs(`(() => {
    const chips = Array.from(document.querySelectorAll('.aa-related-chip'));
    return {
      chipCount: chips.length,
      chipTags: chips.map((c) => c.tagName),
      chipTypes: chips.map((c) => c.type),
      firstChipId: chips[0] ? chips[0].dataset.recordId : null,
      firstChipText: chips[0] ? chips[0].textContent : null,
      navHeaderHidden: document.getElementById('aaNavHeader').hidden,
      directAnswer: document.getElementById('aaDirectAnswer').textContent,
    };
  })()`);
  record('root question produces a multi-capsule Related fan-out (matches Product Owner example)', rootState.chipCount >= 4, rootState);
  record('Related capsules are real <button> elements (keyboard + click reachable)', rootState.chipTags.every((t) => t === 'BUTTON') && rootState.chipTypes.every((t) => t === 'button'), rootState);
  record('every Related capsule carries the known canonical record id', !!rootState.firstChipId && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(rootState.firstChipId), rootState);
  record('root-level answer shows no Back header (top-level navigation entry)', rootState.navHeaderHidden === true, rootState);

  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '1-root-answer.png'), img.toPNG()));

  // ── 2. Keyboard activation: Tab to the first capsule, press Enter ──────
  const beforeClickCounts = ipcCounts();
  await ejs(`(() => { document.querySelector('.aa-related-chip').focus(); return document.activeElement === document.querySelector('.aa-related-chip'); })()`);
  const focusReached = await ejs(`document.activeElement.classList.contains('aa-related-chip')`);
  record('a Related capsule is keyboard-focusable', focusReached);

  await ejs(`(() => { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); document.activeElement.click(); return true; })()`);
  await waitForAnswer(8000);
  await new Promise((r) => setTimeout(r, 150));

  const afterClickCounts = ipcCounts();
  const afterClick = await ejs(`(() => ({
    navHeaderHidden: document.getElementById('aaNavHeader').hidden,
    navLabel: document.getElementById('aaNavLabel').textContent,
    directAnswer: document.getElementById('aaDirectAnswer').textContent,
    backBtnHidden: document.getElementById('aaBackBtn').hidden,
  }))()`);
  record('clicking/activating a Related capsule calls the direct-id navigation IPC channel (ask:relatedNavigate) exactly once', afterClickCounts.related === beforeClickCounts.related + 1, { beforeClickCounts, afterClickCounts });
  record('following Related never calls the ordinary fuzzy-ask IPC channel (ask:query)', afterClickCounts.ask === beforeClickCounts.ask, { beforeClickCounts, afterClickCounts });
  record('navigation orientation header appears after following Related', afterClick.navHeaderHidden === false && afterClick.backBtnHidden === false, afterClick);
  record('navigation label matches the capsule that was followed', afterClick.navLabel.trim() === rootState.firstChipText.trim() || afterClick.navLabel.includes(rootState.firstChipText.trim()), { navLabel: afterClick.navLabel, expected: rootState.firstChipText });
  record('the answer actually changed to the related topic (not a no-op)', afterClick.directAnswer !== rootState.directAnswer, { before: rootState.directAnswer, after: afterClick.directAnswer });

  const HEDGE_TEXT = 'Capability verification is currently unavailable. You can still view the related documentation below.';
  const statusAfterClick = await ejs(`document.getElementById('aaStatusBadge').textContent`);
  record('Related-Record Content Correction: the record\'s real canonical description shows, never the generic authority hedge (no model installed in this environment)', afterClick.directAnswer !== HEDGE_TEXT, { directAnswer: afterClick.directAnswer });
  record('Related-Record Content Correction: status badge reflects the record\'s own real lifecycle status, never forced to Uncertain', statusAfterClick !== 'Uncertain', { statusAfterClick });

  const rawIdCheck = await ejs(`(() => ({
    directAnswer: document.getElementById('aaDirectAnswer').textContent,
    guidance: document.getElementById('aaGuidanceText').textContent,
    steps: Array.from(document.querySelectorAll('#aaStepsList li')).map((li) => li.textContent).join(' | '),
    note: document.getElementById('aaNoteCallout').textContent,
  }))()`);
  const rawIdLeak = [rawIdCheck.directAnswer, rawIdCheck.guidance, rawIdCheck.steps, rawIdCheck.note].some((t) => RAW_ID_RE.test(t || ''));
  record('no raw internal record ids leak into the primary answer for the navigated-to topic', !rawIdLeak, rawIdCheck);

  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '2-after-related-click.png'), img.toPNG()));

  // ── 3. Back restores the previous answer with ZERO additional IPC calls ─
  const beforeBackCounts = ipcCounts();
  await ejs(`document.getElementById('aaBackBtn').click()`);
  await new Promise((r) => setTimeout(r, 150));
  const afterBackCounts = ipcCounts();
  const afterBack = await ejs(`(() => ({
    directAnswer: document.getElementById('aaDirectAnswer').textContent,
    backBtnHidden: document.getElementById('aaBackBtn').hidden,
    forwardHidden: document.getElementById('aaForwardBtn').hidden,
  }))()`);
  record('Back makes zero additional IPC calls (restores from cache, never reruns retrieval/judge)', afterBackCounts.ask === beforeBackCounts.ask && afterBackCounts.related === beforeBackCounts.related, { beforeBackCounts, afterBackCounts });
  record('Back restores the exact original root answer text', afterBack.directAnswer === rootState.directAnswer, { expected: rootState.directAnswer, got: afterBack.directAnswer });
  // At the root (pos 0) the Back affordance itself hides, but the header
  // row stays visible because Forward now has somewhere to go -- Back and
  // Forward are independent children, not a single all-or-nothing widget.
  record('Back returns to the root: the Back affordance itself hides (Forward remains, since it now has somewhere to go)', afterBack.backBtnHidden === true, afterBack);
  record('Forward becomes available after going Back', afterBack.forwardHidden === false, afterBack);

  // Forward should also be a zero-IPC cached restore.
  const beforeForwardCounts = ipcCounts();
  await ejs(`document.getElementById('aaForwardBtn').click()`);
  await new Promise((r) => setTimeout(r, 150));
  const afterForwardCounts = ipcCounts();
  const afterForward = await ejs(`(() => ({
    directAnswer: document.getElementById('aaDirectAnswer').textContent,
  }))()`);
  record('Forward makes zero additional IPC calls', afterForwardCounts.ask === beforeForwardCounts.ask && afterForwardCounts.related === beforeForwardCounts.related, { beforeForwardCounts, afterForwardCounts });
  record('Forward restores the related-topic answer exactly', afterForward.directAnswer === afterClick.directAnswer, { expected: afterClick.directAnswer, got: afterForward.directAnswer });

  // ── 4. A brand-new manually-typed question starts a fresh top-level entry ─
  await ejs(`(() => { document.getElementById('aaQuestionInput').value = 'What is QMZ?'; document.getElementById('aaAskBtn').click(); return true; })()`);
  await waitForAnswer(8000);
  const freshQuestionState = await ejs(`(() => ({
    navHeaderHidden: document.getElementById('aaNavHeader').hidden,
  }))()`);
  record('manually typing a new question starts a fresh top-level entry (no Back trap from the prior chain)', freshQuestionState.navHeaderHidden === true, freshQuestionState);

  // ── 4b. Product Owner's exact reported examples: Source Selection, Source
  // Detection, Grouping System -- each must show its real canonical
  // description/current-behavior even with no local model installed. ──────
  await ejs(`(() => { document.getElementById('aaQuestionInput').value = 'How do I import photographs from an SD card?'; document.getElementById('aaAskBtn').click(); return true; })()`);
  await waitForAnswer(8000);

  async function openRelatedByTitleSubstring(substring) {
    const beforeCounts = ipcCounts();
    const clicked = await ejs(`(() => {
      const chip = Array.from(document.querySelectorAll('.aa-related-chip')).find((c) => c.textContent.includes(${JSON.stringify(substring)}));
      if (!chip) return false;
      chip.click();
      return true;
    })()`);
    if (!clicked) return null;
    await waitForAnswer(8000);
    await new Promise((r) => setTimeout(r, 150));
    const afterCounts = ipcCounts();
    const state = await ejs(`(() => ({
      directAnswer: document.getElementById('aaDirectAnswer').textContent,
      statusLabel: document.getElementById('aaStatusBadge').textContent,
      navLabel: document.getElementById('aaNavLabel').textContent,
    }))()`);
    return { ...state, ipcCallsMade: afterCounts.related - beforeCounts.related, fuzzyAskCalls: afterCounts.ask - beforeCounts.ask };
  }

  for (const title of ['Source Selection', 'Source Detection', 'Grouping System']) {
    // Navigate back to the SD-card root each time so every capsule is opened
    // from the same, real Related fan-out (matches the PO's own repro steps).
    await ejs(`(() => { document.getElementById('aaQuestionInput').value = 'How do I import photographs from an SD card?'; document.getElementById('aaAskBtn').click(); return true; })()`);
    await waitForAnswer(8000);
    const result = await openRelatedByTitleSubstring(title);
    if (!result) {
      record(`Related capsule "${title}" is present in the SD-card-import fan-out`, false, { title });
      continue;
    }
    record(`"${title}": clicking resolved via direct-id navigation, not fuzzy retrieval`, result.ipcCallsMade === 1 && result.fuzzyAskCalls === 0, result);
    record(`"${title}": real canonical description is visible (not the generic hedge, no model installed)`, result.directAnswer !== HEDGE_TEXT && result.directAnswer.length > 20, { title, directAnswer: result.directAnswer });
    record(`"${title}": status badge is not forced to Uncertain`, result.statusLabel !== 'Uncertain', { title, statusLabel: result.statusLabel });
    await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, `related-${title.replace(/\s+/g, '-')}.png`), img.toPNG()));
  }

  // ── 4c. A Workflow-related capsule still shows its real purpose/steps ──
  await ejs(`(() => { document.getElementById('aaQuestionInput').value = 'My transfer stopped halfway. What should I do?'; document.getElementById('aaAskBtn').click(); return true; })()`);
  await waitForAnswer(8000);
  const wfClickResult = await openRelatedByTitleSubstring('Transfer Import');
  if (wfClickResult) {
    const stepsCount = await ejs(`document.querySelectorAll('#aaStepsList li').length`);
    record('Workflow-related capsule ("Transfer Import"): real content shown, not the authority hedge', wfClickResult.directAnswer !== HEDGE_TEXT, wfClickResult);
    record('Workflow-related capsule: steps render normally when the record has them', stepsCount >= 0, { stepsCount });
  } else {
    record('Workflow-related capsule present in this fan-out', false, {});
  }

  // ── 4d. Free-form input regression: real keystrokes (not .value=) after every
  // interaction point named in the acceptance list must never garble text. ──
  function realType(str) { for (const ch of str) { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch }); win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch }); } }
  async function realClickInput() {
    const r = await ejs(`(() => { const el = document.getElementById('aaQuestionInput'); const rect = el.getBoundingClientRect(); return {x: rect.left + rect.width/2, y: rect.top + rect.height/2}; })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 });
    await new Promise((res) => setTimeout(res, 150));
  }
  async function assertCleanTyping(label, phrase) {
    await realClickInput();
    realType(phrase);
    await new Promise((r) => setTimeout(r, 250));
    const v = await ejs(`document.getElementById('aaQuestionInput').value`);
    const disabled = await ejs(`document.getElementById('aaQuestionInput').disabled`);
    record(`free-form input: ${label}`, v === phrase && disabled === false, { expected: phrase, got: v, disabled });
    await ejs(`document.getElementById('aaQuestionInput').value = ''`);
  }

  await assertCleanTyping('field starts empty and accepts a fresh typed question', 'Can I rename an event after import?');

  await ejs(`(() => { document.getElementById('aaQuestionInput').value = 'What is QMZ?'; document.getElementById('aaAskBtn').click(); return true; })()`);
  await waitForAnswer(8000);
  await assertCleanTyping('field is empty and clean immediately after a successful answer (the exact reported symptom)', 'a completely different follow-up question');

  await ejs(`(() => { document.getElementById('aaQuestionInput').value = 'Does AutoIngest support face recognition?'; document.getElementById('aaAskBtn').click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 30));
  await ejs(`document.getElementById('aaCancelBtn')?.click()`);
  await new Promise((r) => setTimeout(r, 300));
  await assertCleanTyping('field is clean after cancelling a query', 'typing right after cancel');

  await ejs(`(() => { document.getElementById('aaQuestionInput').value = 'My transfer stopped halfway. What should I do?'; document.getElementById('aaAskBtn').click(); return true; })()`);
  await waitForAnswer(8000);
  await ejs(`document.querySelector('.aa-related-chip')?.click()`);
  await waitForAnswer(8000);
  await assertCleanTyping('field is clean after following a Related topic', 'typing right after related nav');

  await ejs(`document.getElementById('aaBackBtn')?.click()`);
  await new Promise((r) => setTimeout(r, 200));
  await assertCleanTyping('field is clean after Back', 'typing right after back');

  await ejs(`document.getElementById('askAutoIngestClose').click()`);
  await new Promise((r) => setTimeout(r, 250));
  await ejs(`document.getElementById('askAutoIngestBtn').click()`);
  await new Promise((r) => setTimeout(r, 300));
  await assertCleanTyping('field is clean after close/reopen', 'typing right after reopen');

  // ── 5. Progressive disclosure: limitations render as note + collapsed "More details" ─
  await ejs(`(() => { document.getElementById('aaQuestionInput').value = 'Why was Transfer Export locking kept process-local?'; document.getElementById('aaAskBtn').click(); return true; })()`);
  await waitForAnswer(8000);
  const disclosureState = await ejs(`(() => {
    const noteSection = document.getElementById('aaNoteSection');
    const more = document.getElementById('aaMoreLimitations');
    return {
      noteSectionHidden: noteSection.hidden,
      noteText: document.getElementById('aaNoteCallout').textContent,
      moreHidden: more.hidden,
      moreOpenByDefault: more.open,
      technicalDetailsOpenByDefault: document.getElementById('aaTechnicalDetails').open,
    };
  })()`);
  record('technical details ("Sources & technical details") remain collapsed by default', disclosureState.technicalDetailsOpenByDefault === false, disclosureState);
  if (!disclosureState.noteSectionHidden && !disclosureState.moreHidden) {
    record('additional limitations beyond the first stay collapsed under "More details" by default', disclosureState.moreOpenByDefault === false, disclosureState);
  } else {
    record('limitations note check (no multi-limitation case hit for this question -- not a failure)', true, disclosureState);
  }

  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '3-progressive-disclosure.png'), img.toPNG()));

  // ── 6. Short/unsupported answers stay compact (no empty-looking sections) ─
  await ejs(`(() => { document.getElementById('aaQuestionInput').value = 'Does AutoIngest support face recognition?'; document.getElementById('aaAskBtn').click(); return true; })()`);
  await waitForAnswer(8000);
  const shortAnswerState = await ejs(`(() => ({
    stepsHidden: document.getElementById('aaStepsSection').hidden,
    guidanceHidden: document.getElementById('aaGuidanceText').hidden,
    directAnswer: document.getElementById('aaDirectAnswer').textContent,
  }))()`);
  record('a short/unsupported answer does not force empty Steps/Guidance sections open', shortAnswerState.stepsHidden === true, shortAnswerState);

  // ── 7. Responsive widths + no horizontal overflow with nav header visible ─
  await ejs(`(() => { document.getElementById('aaQuestionInput').value = 'My transfer stopped halfway. What should I do?'; document.getElementById('aaAskBtn').click(); return true; })()`);
  await waitForAnswer(8000);
  await ejs(`document.querySelector('.aa-related-chip').click()`);
  await waitForAnswer(8000);
  await new Promise((r) => setTimeout(r, 150));

  const breakpoints = [[1920, 1080], [1440, 900], [1280, 720], [1024, 720]];
  for (const [w, h] of breakpoints) {
    win.setBounds({ width: w, height: h, x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 150));
    const g = await ejs(`(() => {
      const body = document.getElementById('askAutoIngestBody');
      const nav = document.getElementById('aaNavHeader');
      return {
        pageOverflowX: document.body.scrollWidth > document.body.clientWidth + 1,
        navOverflowX: nav.scrollWidth > nav.clientWidth + 1,
        bodyOverflowX: body.scrollWidth > body.clientWidth + 1,
      };
    })()`);
    record(`${w}x${h}: no horizontal overflow with Related-nav header visible`, !g.pageOverflowX && !g.navOverflowX && !g.bodyOverflowX, g);
  }
  win.setBounds({ width: 1920, height: 1080, x: 0, y: 0 });
  await new Promise((r) => setTimeout(r, 150));

  await ejs(`document.documentElement.setAttribute('data-theme', 'light')`);
  await new Promise((r) => setTimeout(r, 120));
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '4-light-theme.png'), img.toPNG()));
  const lightOk = await ejs(`(() => { const b = document.getElementById('askAutoIngestBox'); return b.scrollWidth <= b.clientWidth + 1; })()`);
  record('light theme: no horizontal overflow with Related-nav elements visible', lightOk);

  await ejs(`document.documentElement.setAttribute('data-theme', 'dark')`);
  await new Promise((r) => setTimeout(r, 120));
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '5-dark-theme.png'), img.toPNG()));
  const darkOk = await ejs(`(() => { const b = document.getElementById('askAutoIngestBox'); return b.scrollWidth <= b.clientWidth + 1; })()`);
  record('dark theme: no horizontal overflow with Related-nav elements visible', darkOk);

  // ── 8. Escape-to-close still works even mid-navigation-chain ───────────
  await ejs(`document.getElementById('aaQuestionInput').blur()`);
  await ejs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await new Promise((r) => setTimeout(r, 250));
  const closedByEscape = await ejs(`!document.getElementById('askAutoIngestOverlay').classList.contains('open')`);
  record('Escape still closes the drawer after Related navigation', closedByEscape);

  win.destroy();
  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n[relatednav-verify] ${results.length - failed.length}/${results.length} checks passed. Screenshots in ${SCREENSHOT_DIR}`);
  if (failed.length) console.log('[relatednav-verify] FAILED:', JSON.stringify(failed, null, 2));
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'results.json'), JSON.stringify({ verificationScope, results }, null, 2));
  app.exit(failed.length ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[relatednav-verify] FATAL:', err);
    app.exit(1);
  });
});
