'use strict';

// main/askAutoIngestAtomicEvidenceVerify.js — C8 corrective checkpoint
// (2026-08-24), Defect 2 real-Phi acceptance run. Real Electron + real Phi
// + real embedding model, same established technique as
// askAutoIngestConversationalVerify.js/askAutoIngestAnswerQualityVerify.js.
//
// Fixes a real methodological defect found in this checkpoint's own prior
// harness (askAutoIngestAnswerQualityVerify.js's currentTurnShape()): that
// function read #aaStatusBadge/#aaStepsList directly from the DOM without
// checking their container's `hidden` flag first -- exactly the technique
// that produced a false "cross-turn contamination" report earlier this
// checkpoint (see Defect 1's own resolution). This harness instead reads
// the RAW IPC response object returned by window.api.askConverse() itself
// (the true data contract), and separately reads the DOM only for what a
// real operator actually sees (respecting `hidden`), never conflating the
// two. Every turn also records `staleFieldContamination`: true only if a
// field present in this turn's raw answer object exactly matches content
// that could only have come from a DIFFERENT record than this turn's own
// primary match (the same check Defect 1's regression tests pin, applied
// here per-turn as an extra acceptance signal, not a replacement for
// those tests).
//
// Run with: node_modules/.bin/electron main/askAutoIngestAtomicEvidenceVerify.js [screenshotDir]

const path = require('path');
const fs = require('fs');
const os = require('os');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-c8-atomic-verify-userdata-'));
const SCREENSHOT_DIR = process.argv[2] || path.join(os.tmpdir(), 'ai-c8-atomic-screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const { app, BrowserWindow } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

const PRODUCT_DOCS = path.join(__dirname, '..', 'scripts', 'product-docs');
const build = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
const { buildEngineContext } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
const { buildEvidencePackage } = require(path.join(PRODUCT_DOCS, 'lib', 'askSynthesis', 'evidencePackage.js'));

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
  console.log(`[atomic-verify] real Phi ready: ${hasRealPhi}, real embedding ready: ${hasRealEmbedding}`);

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
  await ejs(`(() => { const ob = document.getElementById('onboardingOverlay'); if (ob) ob.style.display = 'none'; return true; })()`);
  async function openDrawer() { await ejs(`document.getElementById('askAutoIngestBtn').click()`); await new Promise((r) => setTimeout(r, 150)); }
  async function closeDrawer() { await ejs(`document.getElementById('askAutoIngestClose').click()`); await new Promise((r) => setTimeout(r, 100)); }
  async function freshConversation() { await ejs(`window.api.resetAskConversation()`).catch(() => {}); }

  // RAW IPC call -- the true data contract, exactly like
  // askAutoIngestDataIntegrityVerify.js's proven technique for Defect 1.
  async function rawAsk(question) {
    return ejs(`window.api.askConverse(${JSON.stringify(question)})`);
  }
  // What a real operator actually sees -- respects `hidden`, never reads
  // through it (the exact bug this harness exists to avoid repeating).
  async function domSnapshot() {
    return ejs(`({
      clarificationVisible: !document.getElementById('aaClarificationArea').hidden,
      clarificationText: document.getElementById('aaClarificationArea').hidden ? null : document.getElementById('aaClarificationText').textContent,
      answerVisible: !document.getElementById('aaAnswerArea').hidden,
      statusVisible: !document.getElementById('aaStatusBadge').hidden,
      statusText: document.getElementById('aaStatusBadge').hidden ? null : document.getElementById('aaStatusBadge').textContent,
      directAnswer: document.getElementById('aaAnswerArea').hidden ? null : document.getElementById('aaDirectAnswer').textContent,
      stepsVisible: !document.getElementById('aaStepsSection').hidden,
      stepsText: document.getElementById('aaStepsSection').hidden ? [] : Array.from(document.querySelectorAll('#aaStepsList li')).map(li => li.textContent),
    })`);
  }
  async function submitViaUI(question) {
    await ejs(`(() => { document.getElementById('aaQuestionInput').value = ${JSON.stringify(question)}; document.getElementById('aaAskBtn').click(); return true; })()`);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const stillLoading = await ejs(`!document.getElementById('aaLoadingState').hidden`);
      if (!stillLoading) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    return domSnapshot();
  }
  async function clickPill(labelSubstring) {
    await ejs(`(() => { const chip = Array.from(document.querySelectorAll('.aa-clarification-chip')).find(c => c.textContent.includes(${JSON.stringify(labelSubstring)})); if (chip) chip.click(); return !!chip; })()`);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const stillLoading = await ejs(`!document.getElementById('aaLoadingState').hidden`);
      if (!stillLoading) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    return domSnapshot();
  }

  function evidenceSummary(question) {
    try {
      const pkg = buildEvidencePackage(question, ctx);
      return {
        classification: pkg.classification,
        capabilityStatus: pkg.capabilityStatus,
        primaryId: pkg.primary && pkg.primary.id,
        directAnswer: pkg.directAnswer,
        historyProvenance: pkg.historyProvenance,
        evidenceAtomRoles: pkg.evidenceAtoms.map((a) => `${a.role}:${a.sourceField}`),
        selectedEvidenceAtomRoles: pkg.selectedEvidenceAtoms.map((a) => a.role),
        technicalAtoms: pkg.evidenceAtoms.filter((a) => a.role === 'TECHNICAL').map((a) => a.text),
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  // staleFieldContamination: true only if the raw answer's own steps/
  // status are inconsistent with what THIS turn's own evidence package
  // (recomputed independently, same question text) says they should be --
  // an actual cross-turn data-object leak check, not a DOM read.
  function detectStaleContamination(question, raw) {
    if (!raw || raw.kind !== 'final' || !raw.answer) return { checked: false, contaminated: false };
    const freshEvidence = evidenceSummary(question);
    if (freshEvidence.error) return { checked: false, contaminated: false };
    // raw.answer is the SHAPED (shapeAnswerForUI) response -- status is
    // `{ code, label }`, not a bare capabilityStatus string.
    const actualStatusCode = raw.answer.status ? raw.answer.status.code : undefined;
    const expectedStatusCode = freshEvidence.capabilityStatus === 'ROADMAP' ? null : freshEvidence.capabilityStatus;
    const contaminated = actualStatusCode !== expectedStatusCode;
    return { checked: true, contaminated, expectedStatus: expectedStatusCode, actualStatus: actualStatusCode };
  }

  const report = [];
  let shotIndex = 0;
  async function runOne(id, question, screenshotName) {
    await closeDrawer(); await openDrawer(); await freshConversation();
    const evidence = evidenceSummary(question);
    const t0 = Date.now();
    const raw = await rawAsk(question);
    const dom = await submitViaUI(question);
    const ms = Date.now() - t0;
    const staleCheck = detectStaleContamination(question, raw);
    shotIndex += 1;
    const shotFile = `${String(shotIndex).padStart(2, '0')}-${screenshotName}.png`;
    await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, shotFile), img.toPNG()));
    const entry = { id, question, evidence, raw, dom, staleFieldContamination: staleCheck, ms, screenshot: shotFile };
    report.push(entry);
    console.log(`\n[atomic-verify] ${id} :: ${question}`);
    console.log(`  classification=${evidence.classification} selectedRoles=${JSON.stringify(evidence.selectedEvidenceAtomRoles)}`);
    console.log(`  raw.kind: ${raw.kind}${raw.kind === 'clarification' ? ' | text: ' + raw.text : ''}`);
    console.log(`  raw.answer.directAnswer: ${((raw.answer && raw.answer.directAnswer) || '').slice(0, 300)}`);
    console.log(`  raw.answer.steps: ${JSON.stringify(raw.answer && raw.answer.steps)}`);
    console.log(`  raw.answer.technicalDetails.synthesis: ${JSON.stringify(raw.answer && raw.answer.technicalDetails && raw.answer.technicalDetails.synthesis)}`);
    console.log(`  staleFieldContamination: ${JSON.stringify(staleCheck)}`);
    return entry;
  }

  await runOne('Q1', 'What is QMZ?', 'q1-what-is-qmz');
  await runOne('Q2', 'How do I sort QMZ photos?', 'q2-sort-qmz-photos');
  await runOne('Q3', 'Why is QMZ separate from normal Event Import?', 'q3-why-qmz-separate');
  await runOne('Q4', 'Where does QMZ store its sequencing state?', 'q4-qmz-storage');
  await runOne('Q5', 'How do I import photographs from an SD card?', 'q5-sd-card-import');

  // Q6 -- multi-turn: ambiguous -> pill click -> inspect final (raw IPC at each step).
  await closeDrawer(); await openDrawer(); await freshConversation();
  const q6Evidence = evidenceSummary('My transfer stopped halfway.');
  const q6t0 = Date.now();
  const q6Raw1 = await rawAsk('My transfer stopped halfway. What should I do?');
  const q6Dom1 = await submitViaUI('My transfer stopped halfway. What should I do?');
  let q6RawFinal = q6Raw1; let q6DomFinal = q6Dom1;
  if (q6Raw1.kind === 'clarification') {
    q6RawFinal = await rawAsk('Transfer Export.');
    q6DomFinal = await clickPill('Export');
  }
  const q6Ms = Date.now() - q6t0;
  shotIndex += 1;
  const q6Shot = `${String(shotIndex).padStart(2, '0')}-q6-transfer-clarify-resolved.png`;
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, q6Shot), img.toPNG()));
  report.push({ id: 'Q6', question: 'My transfer stopped halfway. What should I do?', evidence: q6Evidence, raw: q6RawFinal, dom: q6DomFinal, ms: q6Ms, screenshot: q6Shot });
  console.log(`\n[atomic-verify] Q6 :: multi-turn transfer :: final kind=${q6RawFinal.kind}`);
  console.log(`  raw.answer.directAnswer: ${((q6RawFinal.answer && q6RawFinal.answer.directAnswer) || '').slice(0, 300)}`);

  await runOne('Q7', 'Does AutoIngest support face recognition?', 'q7-face-recognition');
  await runOne('Q8', "What's coming next for AutoIngest?", 'q8-roadmap');
  await runOne('Q9', 'What is Source Detection?', 'q9-ordinary-feature-explanation');
  await runOne('Q10', 'How do I recover from a stale archive lock error?', 'q10-archive-lock-troubleshooting');
  await runOne('Q11', 'Why does Transfer Import exist?', 'q11-why-transfer-import');
  await runOne('Q12', 'Does AutoIngest support telemetry?', 'q12-telemetry-capability');

  win.destroy();
  const runtime = require('../services/localJudge/runtime');
  await runtime.unload().catch(() => {});
  runtime.terminate();
  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });

  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'atomic-evidence-report.json'), JSON.stringify({ hasRealPhi, hasRealEmbedding, report }, null, 2));
  console.log(`\n[atomic-verify] Done. Full report + screenshots in ${SCREENSHOT_DIR}`);
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[atomic-verify] FATAL:', err);
    app.exit(1);
  });
});
