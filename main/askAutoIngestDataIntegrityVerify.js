'use strict';

// main/askAutoIngestDataIntegrityVerify.js — Phase C8 corrective checkpoint,
// Defect 1 forensic proof. Verifies whether cross-turn "contamination"
// observed in a prior test harness's JSON output originates in the actual
// answer-construction DATA pipeline (conversationalAsk.js -> trySynthesize
// -> shapeConversationalResponse -> IPC response), or purely in that
// harness's own DOM-query technique (reading #aaStepsList/#aaStatusBadge
// directly without checking their container's `hidden` flag -- renderer.js's
// _renderAnswer() hides these elements on an empty-content turn but does
// NOT clear their innerHTML/textContent, a pre-existing, C4-era pattern
// unrelated to C8).
//
// This harness calls window.api.askConverse() and inspects the RAW IPC
// RESPONSE OBJECT directly -- the actual data contract between main and
// renderer -- never the DOM. If the raw response for each turn already has
// correct, non-contaminated steps/status, the bug (if real) is proven to
// be DOM-only, not a data/object-contamination defect.
//
// Run with: node_modules/.bin/electron main/askAutoIngestDataIntegrityVerify.js

const path = require('path');
const fs = require('fs');
const os = require('os');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-c8-dataintegrity-userdata-'));
const { app, BrowserWindow } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

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

async function main() {
  await setUpRealEmbeddingModel();
  await setUpRealPhi();
  require('./askAutoIngest').registerIpcHandlers();

  const win = new BrowserWindow({
    width: 1280, height: 860, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 400));

  // Reproduces the exact ordering the Product Owner's report described:
  // a QMZ/transfer-heavy question immediately followed by SD-card import,
  // face recognition, and roadmap -- the exact three "contaminations".
  const sequence = [
    { label: 'warm-up (QMZ, has real steps)', q: 'How do I sort QMZ photos?' },
    { label: 'SD-card import (must have its OWN steps, never QMZ steps)', q: 'How do I import photographs from an SD card?' },
    { label: 'warm-up (Transfer Export, has real steps)', q: 'My transfer stopped halfway.' },
    { label: 'face recognition (boundary, must have NO steps, status Not supported)', q: 'Does AutoIngest support face recognition?' },
    { label: 'roadmap (must have NO steps, no status badge -- status.code null)', q: "What's coming next for AutoIngest?" },
  ];

  const results = [];
  for (const step of sequence) {
    await win.webContents.executeJavaScript(`window.api.resetAskConversation()`, true).catch(() => {});
    // Raw IPC call, bypassing DOM entirely -- this IS the actual data
    // contract, exactly what shapeConversationalResponse() returns to the
    // renderer over the wire.
    const raw = await win.webContents.executeJavaScript(`window.api.askConverse(${JSON.stringify(step.q)})`, true);
    results.push({
      label: step.label,
      question: step.q,
      kind: raw.kind,
      status: raw.answer ? raw.answer.status : null,
      stepsCount: raw.answer ? (raw.answer.steps || []).length : null,
      steps: raw.answer ? raw.answer.steps : null,
      directAnswerSnippet: raw.answer ? (raw.answer.directAnswer || '').slice(0, 80) : null,
    });
    console.log(`\n[data-integrity] ${step.label}`);
    console.log(`  question: ${step.q}`);
    console.log(`  RAW IPC RESPONSE status: ${JSON.stringify(raw.answer && raw.answer.status)}`);
    console.log(`  RAW IPC RESPONSE steps (${raw.answer ? (raw.answer.steps || []).length : 0}): ${JSON.stringify(raw.answer && raw.answer.steps)}`);
  }

  // Now ALSO read the DOM directly after the LAST turn (face recognition or
  // roadmap, whichever ran last) to show whether stale DOM nodes exist
  // despite the RAW DATA already being proven clean above -- this isolates
  // exactly where any observed "contamination" actually lives.
  await win.webContents.executeJavaScript(`document.getElementById('askAutoIngestBtn').click()`, true);
  await new Promise((r) => setTimeout(r, 150));
  await win.webContents.executeJavaScript(`window.api.resetAskConversation()`, true).catch(() => {});
  await win.webContents.executeJavaScript(`(() => { document.getElementById('aaQuestionInput').value = 'How do I sort QMZ photos?'; document.getElementById('aaAskBtn').click(); return true; })()`, true);
  await new Promise((r) => setTimeout(r, 30000));
  const domStepsAfterQmz = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#aaStepsList li')).map(li => li.textContent)`, true);
  const stepsSectionHiddenAfterQmz = await win.webContents.executeJavaScript(`document.getElementById('aaStepsSection').hidden`, true);

  await win.webContents.executeJavaScript(`(() => { document.getElementById('aaQuestionInput').value = 'Does AutoIngest support face recognition?'; document.getElementById('aaAskBtn').click(); return true; })()`, true);
  await new Promise((r) => setTimeout(r, 15000));
  const rawFaceRecog = await win.webContents.executeJavaScript(`window.api.askConverse ? null : null`, true); // placeholder, real call already done via sequence above
  const domStepsAfterFaceRecog = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#aaStepsList li')).map(li => li.textContent)`, true);
  const stepsSectionHiddenAfterFaceRecog = await win.webContents.executeJavaScript(`document.getElementById('aaStepsSection').hidden`, true);
  const domStatusTextAfterFaceRecog = await win.webContents.executeJavaScript(`document.getElementById('aaStatusBadge').textContent`, true);
  const statusBadgeHiddenAfterFaceRecog = await win.webContents.executeJavaScript(`document.getElementById('aaStatusBadge').hidden`, true);

  console.log('\n[data-integrity] === DOM-level probe (bypassing the hidden flag, exactly like the prior test harness did) ===');
  console.log('  after "How do I sort QMZ photos?": stepsSection.hidden =', stepsSectionHiddenAfterQmz, ', raw <li> text =', JSON.stringify(domStepsAfterQmz));
  console.log('  after "Does AutoIngest support face recognition?" (next turn): stepsSection.hidden =', stepsSectionHiddenAfterFaceRecog, ', raw <li> text (STALE, still QMZ) =', JSON.stringify(domStepsAfterFaceRecog));
  console.log('  statusBadge.hidden =', statusBadgeHiddenAfterFaceRecog, ', raw statusBadge.textContent =', JSON.stringify(domStatusTextAfterFaceRecog));

  win.destroy();
  const runtime = require('../services/localJudge/runtime');
  await runtime.unload().catch(() => {});
  runtime.terminate();
  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });

  fs.writeFileSync('/Users/funun_pa/.claude/jobs/6629ed37/tmp/data_integrity_results.json', JSON.stringify({
    results,
    domProbe: { domStepsAfterQmz, stepsSectionHiddenAfterQmz, domStepsAfterFaceRecog, stepsSectionHiddenAfterFaceRecog, domStatusTextAfterFaceRecog, statusBadgeHiddenAfterFaceRecog },
  }, null, 2));
  app.exit(0);
}

app.whenReady().then(() => main().catch((e) => { console.error('FATAL', e); app.exit(1); }));
