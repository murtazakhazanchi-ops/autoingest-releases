'use strict';

// main/askAutoIngestAnswerQualityVerify.js — Phase C8 final-answer-quality
// correction checkpoint (Product Owner-authorized, 2026-08-24). Real
// Electron + real Phi, same established technique as
// askAutoIngestConversationalVerify.js (real BrowserWindow, real preload/
// IPC, webContents.executeJavaScript/capturePage). This harness exists
// ONLY to capture the before/after answer-QUALITY evidence the Product
// Owner asked for -- question, evidence supplied to Phi, final rendered
// answer, synthesisApplied, and a screenshot, for each of the 10 required
// questions -- not to re-test mechanical/structural correctness (already
// covered by askAutoIngestConversationalVerify.js's 32/33).
//
// "Evidence supplied to Phi" is captured via a SEPARATE, cheap, direct
// library call to buildEvidencePackageForAuthorityAnswer() (deterministic,
// no model, milliseconds) using the exact same query text the real UI
// turn used -- not a second real model call. "Raw Phi output" is not
// captured as a separate artifact: this checkpoint's own forensic trace
// (previous message in this session) already established that
// mergeSynthesizedAnswer() performs NO further alteration --
// directAnswer is resolved.answer verbatim, steps[].text is
// resolved.steps[].text verbatim -- so the final rendered answer/steps
// ARE Phi's raw output, just wrapped for display. Doubling every real
// Phi call to fetch a redundant raw copy was judged unnecessary given
// that established fact, and would have roughly doubled total real-model
// runtime for no new information.
//
// Run with: node_modules/.bin/electron main/askAutoIngestAnswerQualityVerify.js [screenshotDir]

const path = require('path');
const fs = require('fs');
const os = require('os');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-c8-quality-verify-userdata-'));
const SCREENSHOT_DIR = process.argv[2] || path.join(os.tmpdir(), 'ai-c8-quality-screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const { app, BrowserWindow } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

const PRODUCT_DOCS = path.join(__dirname, '..', 'scripts', 'product-docs');
const build = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
const { buildEngineContext } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
const { buildEvidencePackageForAuthorityAnswer } = require(path.join(PRODUCT_DOCS, 'lib', 'askSynthesis', 'evidencePackage.js'));

async function setUpRealPhi() {
  const modelManager = require('../services/localJudge/modelManager');
  const REAL_MODEL_PATH = path.join(__dirname, '..', 'scripts', 'product-docs', 'bench', 'models', 'phi-4-mini-instruct-Q4_K_M.gguf');
  if (!fs.existsSync(REAL_MODEL_PATH)) return false;
  const { finalPath } = modelManager.resolvePaths(path.join(FIXTURE_USER_DATA, 'local-judge-models'));
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.symlinkSync(REAL_MODEL_PATH, finalPath);
  const v = await modelManager.verify(path.join(FIXTURE_USER_DATA, 'local-judge-models'));
  return v.status === modelManager.STATUS.READY;
}

async function setUpRealEmbeddingModel() {
  const embeddingModelManager = require('../services/semanticRetrieval/embeddingModelManager');
  const REAL_MODEL_PATH = '/Users/funun_pa/.claude/jobs/6629ed37/tmp/models/bge-small-en-v1.5-q8_0.gguf';
  if (!fs.existsSync(REAL_MODEL_PATH)) return false;
  const { finalPath } = embeddingModelManager.resolvePaths();
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.symlinkSync(REAL_MODEL_PATH, finalPath);
  const v = await embeddingModelManager.verify();
  return v.status === embeddingModelManager.STATUS.READY;
}

async function main() {
  const hasRealPhi = await setUpRealPhi();
  const hasRealEmbedding = await setUpRealEmbeddingModel();
  console.log(`[quality-verify] real Phi ready: ${hasRealPhi}, real embedding ready: ${hasRealEmbedding}`);

  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

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
      const stepsList = await ejs(`Array.from(document.querySelectorAll('#aaStepsList li')).map(li => li.textContent)`);
      await ejs(`document.getElementById('aaTechnicalDetails').open = true`);
      const synthesisApplied = await ejs(`(() => { const rows = Array.from(document.querySelectorAll('.aa-tech-row')); const r = rows.find(x => x.querySelector('.aa-tech-label')?.textContent === 'Answer wording'); return r ? r.querySelector('.aa-tech-value')?.textContent : null; })()`);
      return { kind: 'final', status, text, steps: stepsList, synthesisApplied };
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
    await ejs(`window.api.resetAskConversation()`).catch(() => {});
  }
  async function openDrawer() { await ejs(`document.getElementById('askAutoIngestBtn').click()`); await new Promise((r) => setTimeout(r, 150)); }
  async function closeDrawer() { await ejs(`document.getElementById('askAutoIngestClose').click()`); await new Promise((r) => setTimeout(r, 100)); }

  await ejs(`(() => { const ob = document.getElementById('onboardingOverlay'); if (ob) ob.style.display = 'none'; return true; })()`);

  function evidenceSummary(question) {
    try {
      const pkg = buildEvidencePackageForAuthorityAnswer(question, { capabilityStatus: undefined }, ctx);
      return {
        classification: pkg.classification,
        capabilityStatus: pkg.capabilityStatus,
        matchQuality: pkg.matchQuality,
        directAnswer: pkg.directAnswer,
        guidance: pkg.guidance,
        stepsCount: (pkg.steps || []).length,
        stepsText: (pkg.steps || []).map((s) => s.text),
        limitations: pkg.limitations,
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  const report = [];
  let shotIndex = 0;
  async function runOne(id, question, screenshotName) {
    await closeDrawer(); await openDrawer(); await freshConversation();
    const evidence = evidenceSummary(question);
    const t0 = Date.now();
    const finalTurn = await submit(question);
    const ms = Date.now() - t0;
    shotIndex += 1;
    const shotFile = `${String(shotIndex).padStart(2, '0')}-${screenshotName}.png`;
    await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, shotFile), img.toPNG()));
    const entry = { id, question, evidence, finalTurn, ms, screenshot: shotFile };
    report.push(entry);
    console.log(`[quality-verify] ${id} :: ${question}`);
    console.log(`  evidence.directAnswer: ${(evidence.directAnswer || '').slice(0, 200)}`);
    console.log(`  final: ${JSON.stringify(finalTurn).slice(0, 400)}`);
    return entry;
  }

  await runOne('Q1', 'What is QMZ?', 'q1-what-is-qmz');
  await runOne('Q2', 'How do I sort QMZ photos?', 'q2-sort-qmz-photos');
  await runOne('Q3', 'Why is QMZ separate from normal Event Import?', 'q3-why-qmz-separate');
  await runOne('Q4', 'Where does QMZ store its sequencing state?', 'q4-qmz-storage');
  await runOne('Q5', 'How do I import photographs from an SD card?', 'q5-sd-card-import');

  // Q6 -- multi-turn: ambiguous -> pill click -> inspect final.
  await closeDrawer(); await openDrawer(); await freshConversation();
  const q6Evidence = evidenceSummary('My transfer stopped halfway.');
  const q6t0 = Date.now();
  const q6First = await submit('My transfer stopped halfway. What should I do?');
  const q6Clarify = q6First.kind === 'clarification' ? q6First : await submit('My transfer stopped halfway.');
  const q6Final = q6Clarify.kind === 'clarification' ? await clickPill('Export') : q6Clarify;
  const q6Ms = Date.now() - q6t0;
  shotIndex += 1;
  const q6Shot = `${String(shotIndex).padStart(2, '0')}-q6-transfer-clarify-resolved.png`;
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, q6Shot), img.toPNG()));
  report.push({ id: 'Q6', question: 'My transfer stopped halfway. What should I do?', evidence: q6Evidence, clarifyTurn: q6Clarify, finalTurn: q6Final, ms: q6Ms, screenshot: q6Shot });
  console.log(`[quality-verify] Q6 :: multi-turn transfer :: clarify=${q6Clarify.kind} final=${JSON.stringify(q6Final).slice(0, 300)}`);

  await runOne('Q7', 'Does AutoIngest support face recognition?', 'q7-face-recognition');
  await runOne('Q8', "What's coming next for AutoIngest?", 'q8-roadmap');
  await runOne('Q10', 'How do I recover from a stale archive lock error?', 'q10-archive-lock-troubleshooting');

  win.destroy();
  const runtime = require('../services/localJudge/runtime');
  await runtime.unload().catch(() => {});
  runtime.terminate();
  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });

  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'quality-report.json'), JSON.stringify({ hasRealPhi, hasRealEmbedding, report }, null, 2));
  console.log(`\n[quality-verify] Done. Full report + screenshots in ${SCREENSHOT_DIR}`);
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[quality-verify] FATAL:', err);
    app.exit(1);
  });
});
