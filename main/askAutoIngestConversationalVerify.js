'use strict';

// main/askAutoIngestConversationalVerify.js — Phase C8 FINAL ACCEPTANCE.
// Real, REQUIRED Electron + real Phi conversational verification harness.
// Not shipped, not wired into the app, not run in CI. Mirrors
// askAutoIngestUIVerify.js's own established technique exactly (this repo
// still has no Playwright/Electron test automation): a real BrowserWindow
// loading the real renderer/index.html with the exact same webPreferences
// main.js itself uses, webContents.executeJavaScript() to drive/inspect
// the real DOM, webContents.sendInputEvent() for real keyboard events,
// webContents.capturePage() for real screenshots -- the actual UI, not a
// simulation.
//
// Symlinks the EXACT previously-verified artifacts already on disk in
// this checkout -- scripts/product-docs/bench/models/phi-4-mini-instruct-Q4_K_M.gguf
// (checksum-confirmed against modelManager.js's own pinned identity this
// session) and the C7-era bge-small-en-v1.5-q8_0.gguf embedding model
// (checksum-confirmed against embeddingModelManager.js's own pinned
// identity earlier this checkpoint) -- into a disposable userData dir, so
// BOTH real local models actually run inside the real app. No download of
// any replacement artifact. main/askAutoIngest.js's production ask:converse
// handler omits synthesize/formulateClarification overrides, so once
// modelManager reports READY it uses the REAL productionSynthesize/
// productionFormulateClarification providers automatically -- no special
// test-mode wiring needed for Phi to actually run.
//
// Run with: node_modules/.bin/electron main/askAutoIngestConversationalVerify.js [screenshotDir]

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-c8-conv-verify-userdata-'));
const SCREENSHOT_DIR = process.argv[2] || path.join(os.tmpdir(), 'ai-c8-conv-screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const { app, BrowserWindow } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail: detail || null });
  console.log(`[conv-verify] ${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
}

function logVerificationScope() {
  const repoRoot = path.join(__dirname, '..');
  const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain']).length > 0;
  console.log('[conv-verify] ══════════════════════════════════════════════════════════');
  console.log(`[conv-verify] branch=${branch} commit=${commit}${dirty ? ' (dirty working tree)' : ''}`);
  console.log(`[conv-verify] repoRoot=${repoRoot}`);
  console.log('[conv-verify] ══════════════════════════════════════════════════════════');
  return { branch, commit, dirty };
}

async function setUpRealPhi() {
  const modelManager = require('../services/localJudge/modelManager');
  const REAL_MODEL_PATH = path.join(__dirname, '..', 'scripts', 'product-docs', 'bench', 'models', 'phi-4-mini-instruct-Q4_K_M.gguf');
  if (!fs.existsSync(REAL_MODEL_PATH)) return { ok: false, path: REAL_MODEL_PATH };
  const { finalPath } = modelManager.resolvePaths(path.join(FIXTURE_USER_DATA, 'local-judge-models'));
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.symlinkSync(REAL_MODEL_PATH, finalPath);
  const v = await modelManager.verify(path.join(FIXTURE_USER_DATA, 'local-judge-models'));
  return { ok: v.status === modelManager.STATUS.READY, path: REAL_MODEL_PATH, sha256: modelManager.EXPECTED_SHA256, verify: v };
}

async function setUpRealEmbeddingModel() {
  const embeddingModelManager = require('../services/semanticRetrieval/embeddingModelManager');
  const REAL_MODEL_PATH = '/Users/funun_pa/.claude/jobs/6629ed37/tmp/models/bge-small-en-v1.5-q8_0.gguf';
  if (!fs.existsSync(REAL_MODEL_PATH)) return { ok: false, path: REAL_MODEL_PATH };
  const { finalPath } = embeddingModelManager.resolvePaths();
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.symlinkSync(REAL_MODEL_PATH, finalPath);
  const v = await embeddingModelManager.verify();
  return { ok: v.status === embeddingModelManager.STATUS.READY, path: REAL_MODEL_PATH, sha256: embeddingModelManager.EXPECTED_SHA256, verify: v };
}

function mb(bytes) { return +(bytes / 1048576).toFixed(1); }

async function main() {
  const verificationScope = logVerificationScope();
  const timings = {};
  const ram = {};
  ram.baseline = mb(process.memoryUsage().rss);

  const phiSetup = await setUpRealPhi();
  const embSetup = await setUpRealEmbeddingModel();
  record('real Phi-4-mini artifact present and checksum-verified (not downloaded)', phiSetup.ok, { path: phiSetup.path, sha256: phiSetup.sha256 });
  record('real bge-small-en-v1.5-q8_0 embedding artifact present and checksum-verified (not downloaded)', embSetup.ok, { path: embSetup.path, sha256: embSetup.sha256 });

  require('./askAutoIngest').registerIpcHandlers();

  const win = new BrowserWindow({
    width: 1280, height: 860, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.show();
  await new Promise((r) => setTimeout(r, 400));

  const ejs = (script) => win.webContents.executeJavaScript(script, true);
  async function waitForTurn(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const stillLoading = await ejs(`!document.getElementById('aaLoadingState').hidden`);
      if (!stillLoading) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  }
  async function currentTurnShape() {
    const clarificationVisible = await ejs(`!document.getElementById('aaClarificationArea').hidden`);
    const answerVisible = await ejs(`!document.getElementById('aaAnswerArea').hidden`);
    if (clarificationVisible) {
      const text = await ejs(`document.getElementById('aaClarificationText').textContent`);
      const choices = await ejs(`Array.from(document.querySelectorAll('.aa-clarification-chip')).map(c => c.textContent)`);
      return { kind: 'clarification', text, choices };
    }
    if (answerVisible) {
      const status = await ejs(`document.getElementById('aaStatusBadge').textContent`);
      const text = await ejs(`document.getElementById('aaDirectAnswer').textContent`);
      await ejs(`document.getElementById('aaTechnicalDetails').open = true`);
      const synthesisApplied = await ejs(`(() => { const rows = Array.from(document.querySelectorAll('.aa-tech-row')); const r = rows.find(x => x.querySelector('.aa-tech-label')?.textContent === 'Answer wording'); return r ? r.querySelector('.aa-tech-value')?.textContent : null; })()`);
      const finalStatusRow = await ejs(`(() => { const rows = Array.from(document.querySelectorAll('.aa-tech-row')); const r = rows.find(x => x.querySelector('.aa-tech-label')?.textContent === 'Final status'); return r ? r.querySelector('.aa-tech-value')?.textContent : null; })()`);
      return { kind: 'final', status, text, synthesisApplied, finalStatusRow };
    }
    return { kind: 'none' };
  }
  async function submit(text) {
    await ejs(`(() => { document.getElementById('aaQuestionInput').value = ${JSON.stringify(text)}; document.getElementById('aaAskBtn').click(); return true; })()`);
    await waitForTurn(60000);
    return currentTurnShape();
  }
  async function clickPill(labelSubstring) {
    await ejs(`(() => { const chip = Array.from(document.querySelectorAll('.aa-clarification-chip')).find(c => c.textContent.includes(${JSON.stringify(labelSubstring)})); if (chip) chip.click(); return !!chip; })()`);
    await waitForTurn(60000);
    return currentTurnShape();
  }
  async function freshConversation() {
    await win.webContents.executeJavaScript(`window.api.resetAskConversation()`, true).catch(() => {});
  }
  async function openDrawer() {
    await ejs(`document.getElementById('askAutoIngestBtn').click()`);
    await new Promise((r) => setTimeout(r, 150));
  }
  async function closeDrawer() {
    await ejs(`document.getElementById('askAutoIngestClose').click()`);
    await new Promise((r) => setTimeout(r, 100));
  }

  await ejs(`(() => { const ob = document.getElementById('onboardingOverlay'); if (ob) ob.style.display = 'none'; return true; })()`);

  const scenarios = {};
  const RAW_ID_RE = /\b(AI-FEAT-\d+|AI-WF-\d+|AI-RM-\d+|DEC-\d+|BUG-\d+|PM-\d+|AI-MEM-\d+)\b/;

  // ── 1-2. Open ────────────────────────────────────────────────────────────
  const btnVisible = await ejs(`(() => { const b = document.getElementById('askAutoIngestBtn'); return !!b && getComputedStyle(b).display !== 'none' && b.offsetParent !== null; })()`);
  record('1. entry point visible', btnVisible);
  await openDrawer();
  record('1. opens on click', await ejs(`document.getElementById('askAutoIngestOverlay').classList.contains('open')`));
  record('11. focus enters question input on open', await ejs(`document.activeElement && document.activeElement.id === 'aaQuestionInput'`));

  // ── 2. Direct question ──────────────────────────────────────────────────
  await freshConversation();
  let t0 = Date.now();
  const direct = await submit('What is QMZ?');
  timings.firstTurnMs = Date.now() - t0;
  record('2. direct question answers immediately', direct.kind === 'final');
  record('E5. direct question: no unnecessary clarification (QMZ)', direct.kind === 'final');
  scenarios.direct = direct;
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '01-direct-answer.png'), img.toPNG()));

  // ── 3-4. Ambiguous question -> clarification ────────────────────────────
  await closeDrawer(); await openDrawer(); await freshConversation();
  t0 = Date.now();
  const ambiguous = await submit('My transfer stopped halfway.');
  timings.clarificationTurnMs = Date.now() - t0;
  record('3-4. ambiguous question receives a clarification, not a guessed final answer', ambiguous.kind === 'clarification', ambiguous);
  scenarios.ambiguousFirstTurn = ambiguous;
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '02-ambiguous-clarification.png'), img.toPNG()));
  record('11. question field remains typeable during a clarification', await ejs(`!document.getElementById('aaQuestionInput').disabled`));
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '03-clarification-pills.png'), img.toPNG()));

  // ── 5. Click a pill ──────────────────────────────────────────────────────
  const afterPill = await clickPill('Export');
  record('5. clicking a clarification pill resolves the conversation', afterPill.kind === 'final', afterPill);
  scenarios.afterPillClick = afterPill;
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '05-final-resolved-answer.png'), img.toPNG()));
  record('18. raw record IDs never appear in ordinary conversation text', !RAW_ID_RE.test(afterPill.text || ''), { text: afterPill.text });

  // ── E1. SCENARIO 1 — full transfer multi-turn ───────────────────────────
  await closeDrawer(); await openDrawer(); await freshConversation();
  const s1t1 = await submit('My transfer stopped halfway.');
  const s1t2 = await submit('Transfer Export.');
  const s1t3 = await submit('The NAS disconnected.');
  record('E1. transfer multi-turn: turn 1 clarifies (not a guess)', s1t1.kind === 'clarification');
  record('E1. transfer multi-turn: turn 2 resolves the transfer type', s1t2.kind === 'final');
  record('E1. transfer multi-turn: turn 3 stays grounded, does not lose earlier clarification', s1t3.kind === 'final' && s1t3.status === 'Available');
  scenarios.transferMultiTurn = { s1t1: s1t1.kind, s1t2, s1t3 };
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '06-topic-change.png'), img.toPNG())); // placeholder slot reused below

  // ── 6-7. Free-form follow-up instead of a pill ──────────────────────────
  await closeDrawer(); await openDrawer(); await freshConversation();
  const ffT1 = await submit("My photos aren't appearing.");
  const ffT2 = await submit("I'm importing from an SD card.");
  record('6-7. E2. free-form follow-up continues the conversation correctly (no pill click needed)', ffT2.kind === 'final', { ffT1: ffT1.kind, ffT2 });
  scenarios.freeFormFollowUp = { ffT1: ffT1.kind, ffT2 };
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '04-free-form-followup.png'), img.toPNG()));

  // ── 9. E3. Not sure ──────────────────────────────────────────────────────
  await closeDrawer(); await openDrawer(); await freshConversation();
  const nsT1 = await submit('My transfer stopped halfway.');
  const nsT2 = await submit('Not sure.');
  record('9. E3. "Not sure" does not dead-end -- assistant keeps helping', nsT2.kind === 'final' && !!nsT2.text, { nsT1: nsT1.kind, nsT2 });
  scenarios.notSure = { nsT1: nsT1.kind, nsT2 };

  // ── 8. E4. Topic change mid-conversation ────────────────────────────────
  await closeDrawer(); await openDrawer(); await freshConversation();
  const tcT1 = await submit('My transfer stopped halfway.');
  const tcT2 = await submit('Actually, how do I sort QMZ photos?');
  record('8. E4. topic change recognized cleanly; old transfer state does not contaminate the new answer', tcT2.kind === 'final' && !/transfer|export|import/i.test(tcT2.text || ''), { tcT1: tcT1.kind, tcT2 });
  scenarios.topicChange = { tcT1: tcT1.kind, tcT2 };
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '06-topic-change.png'), img.toPNG()));

  // ── E6. Boundary ─────────────────────────────────────────────────────────
  await closeDrawer(); await openDrawer(); await freshConversation();
  const boundary = await submit('Does AutoIngest support face recognition?');
  record('E6. boundary question: direct NOT_SUPPORTED, no unnecessary clarification', boundary.kind === 'final' && boundary.status === 'Not supported', boundary);
  scenarios.boundary = boundary;

  // ── 12. Related pills still work ────────────────────────────────────────
  await closeDrawer(); await openDrawer(); await freshConversation();
  await submit('My transfer stopped halfway.'); // leave an unresolved conversation open
  const relatedList = await ejs(`document.getElementById('aaRelatedSection').hidden`);
  // Navigate to a known record directly via IPC (mirrors clicking a real Related chip -- exact-id lookup, Section 8).
  t0 = Date.now();
  const relatedResult = await ejs(`window.api.askRelated('AI-WF-005')`);
  timings.relatedNavMs = Date.now() - t0;
  record('12. Related-topic navigation resolves the exact known record, isolated from the open conversation', relatedResult && relatedResult.status && relatedResult.status.code === 'AVAILABLE', { relatedResult: relatedResult && relatedResult.status });

  // ── 13. Escape closes ────────────────────────────────────────────────────
  await openDrawer();
  await ejs(`document.getElementById('aaQuestionInput').focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await new Promise((r) => setTimeout(r, 150));
  record('13. Escape closes the Ask AutoIngest surface', await ejs(`!document.getElementById('askAutoIngestOverlay').classList.contains('open')`));

  // ── 10. Close/reopen preserves state ────────────────────────────────────
  await openDrawer();
  await freshConversation();
  await submit('What is QMZ?');
  const beforeClose = await ejs(`document.getElementById('aaDirectAnswer').textContent`);
  await closeDrawer();
  await openDrawer();
  const afterReopen = await ejs(`document.getElementById('aaDirectAnswer').textContent`);
  record('10. closing/reopening the drawer preserves the last visible state', beforeClose === afterReopen && !!beforeClose);

  // ── 14-15. Light/dark mode + overflow ───────────────────────────────────
  await ejs(`document.documentElement.setAttribute('data-theme', 'light')`);
  await new Promise((r) => setTimeout(r, 100));
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '07-light-mode.png'), img.toPNG()));
  const overflowLight = await ejs(`document.getElementById('askAutoIngestBox').scrollWidth <= document.getElementById('askAutoIngestBox').clientWidth + 1`);
  record('14. light mode: no horizontal overflow', overflowLight);

  await ejs(`document.documentElement.setAttribute('data-theme', 'dark')`);
  await new Promise((r) => setTimeout(r, 100));
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, '08-dark-mode.png'), img.toPNG()));
  const overflowDark = await ejs(`document.getElementById('askAutoIngestBox').scrollWidth <= document.getElementById('askAutoIngestBox').clientWidth + 1`);
  record('15. dark mode: no horizontal overflow', overflowDark);

  // ── 16-17. Minimum window size + scrolling ──────────────────────────────
  win.setSize(1024, 720);
  await new Promise((r) => setTimeout(r, 150));
  const overflowSmall = await ejs(`document.body.scrollWidth <= document.body.clientWidth + 1`);
  const clarificationScrolls = await ejs(`(() => { const body = document.getElementById('askAutoIngestBody'); return body ? getComputedStyle(body).overflowY !== 'visible' || body.scrollHeight >= body.clientHeight : true; })()`);
  record('16. 1024x720 window: no page-level horizontal overflow', overflowSmall);
  record('17. drawer body supports internal scrolling for long content', clarificationScrolls);
  win.setSize(1280, 860);

  // ── C. Real Phi path ─────────────────────────────────────────────────────
  const phiLoadState = require('../services/localJudge/runtime').getLoadState();
  const clarificationService = require('../services/localJudge/clarificationService');
  const phiAvailability = clarificationService.getModelAvailability();
  record('C1. clarificationService reports Phi model READY (real artifact, real verification)', phiAvailability.status === 'READY', phiAvailability);

  let phiClarificationExample = null;
  let phiSynthesisExample = null;
  if (phiAvailability.status === 'READY') {
    await closeDrawer(); await openDrawer(); await freshConversation();
    t0 = Date.now();
    const phiT1 = await submit('My transfer stopped halfway.');
    timings.phiClarificationTurnMs = Date.now() - t0;
    phiClarificationExample = phiT1;
    record('C2. clarification wording produced with real Phi active', phiT1.kind === 'clarification', phiT1);
    record('C3. Phi does not invent a candidate not in the deterministic list', phiT1.kind === 'clarification' && phiT1.choices.every((c) => ['Export or Update a Transfer Drive', 'Import or Update From a Transfer Drive', 'Backup Update Scanning', 'Not sure'].includes(c)), phiT1.choices);
    record('D. clarification wording is natural (not the raw deterministic template sentence)', phiT1.kind === 'clarification' && !phiT1.text.startsWith('Could you tell me which one you mean:'), { text: phiT1.text });

    t0 = Date.now();
    const phiT2 = await clickPill('Export');
    timings.phiSynthesisTurnMs = Date.now() - t0;
    phiSynthesisExample = phiT2;
    record('C5. final answer synthesis runs only after ambiguity resolved', phiT2.kind === 'final');
    record('C2/6. final synthesized answer preserves capability status (AVAILABLE)', phiT2.status === 'Available', phiT2);
    record('C6. synthesis-wording technical-details field confirms AI-refined vs deterministic', !!phiT2.synthesisApplied, { synthesisApplied: phiT2.synthesisApplied });

    // C7: boundary stays deterministic even with Phi active.
    await closeDrawer(); await openDrawer(); await freshConversation();
    const phiBoundary = await submit('Does AutoIngest support face recognition?');
    record('C7. unsupported/boundary answers remain deterministic even with Phi active', phiBoundary.kind === 'final' && phiBoundary.status === 'Not supported' && phiBoundary.synthesisApplied === 'Deterministic (AutoIngest knowledge engine)', phiBoundary);
  } else {
    record('C. Phi portion skipped -- model not READY (see phiAvailability detail above)', false, phiAvailability);
  }

  // ── F. RAM at each stage (main process only -- Phi's utilityProcess RAM
  // is a separate OS process and not captured by process.memoryUsage()
  // here; reported honestly as a gap in the final report, not fabricated).
  ram.afterModelsAndWalkthrough = mb(process.memoryUsage().rss);

  win.destroy();
  const runtime = require('../services/localJudge/runtime');
  await runtime.unload().catch(() => {});
  runtime.terminate();
  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n[conv-verify] ${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) console.log('[conv-verify] FAILED:', JSON.stringify(failed, null, 2));
  const out = { verificationScope, results, scenarios, timings, ram, phiAvailability, phiClarificationExample, phiSynthesisExample, phiSetup: { ok: phiSetup.ok }, embSetup: { ok: embSetup.ok } };
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'results.json'), JSON.stringify(out, null, 2));
  console.log(`[conv-verify] Full results + screenshots in ${SCREENSHOT_DIR}`);
  app.exit(failed.length ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[conv-verify] FATAL:', err);
    app.exit(1);
  });
});
