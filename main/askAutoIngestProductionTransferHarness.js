'use strict';

// main/askAutoIngestProductionTransferHarness.js — Product Owner
// production-transfer validation checkpoint (2026-08-27). Not shipped, not
// wired into the app, not run in CI. Drives the REAL, UNMODIFIED
// production Ask AutoIngest request path -- main/askAutoIngest.js's real
// `ask:converse` IPC handler, called through the REAL preload.js/
// contextBridge `window.api.askConverse()` surface, from a real (hidden)
// BrowserWindow loading the real renderer/index.html -- mirroring
// main/askAutoIngestConversationalVerify.js's already-established
// technique exactly, the same one this checkpoint's own readiness report
// cited as the smallest faithful adapter for this purpose.
//
// Unlike askAutoIngestConversationTrial.js/ArchitectureExperiment.js/
// KnowledgeModelExperiment.js (the A/B/C harnesses), this file NEVER calls
// conversationalAsk.js, answerWithAuthority.js, or trySynthesize()
// directly, and NEVER injects a mock options.synthesize provider. Every
// turn goes through the real ask:converse IPC handler exactly as the
// renderer would trigger it, which uses the real productionSynthesize/
// productionFormulateClarification providers automatically once
// modelManager reports READY (see askAutoIngestConversationalVerify.js's
// own header comment for why no special test-mode wiring is needed).
//
// Produces P0 (current pinned model, unmodified modelManager.js/
// runtimeWorker.js), P1 (Gemma, after the disclosed model/runtime
// configuration change described in the integration-validation report),
// or P2 (Gemma + Knowledge Model, once the evidence-shaping integration
// lands) depending on which commit of the worktree this is run against --
// this file's own code never differs between the three; only the
// production files it drives do.
//
// Env vars:
//   PT_LABEL          human label for this run, e.g. "P0-phi" (required)
//   PT_MODEL_PATH     absolute path to the .gguf to symlink into
//                      modelManager's currently-pinned artifact location
//                      (required)
//   PT_EMBEDDING_PATH absolute path to the BGE embedding .gguf (required)
//   PT_OUT_DIR        output directory (default: os.tmpdir()/ai-pt-<label>)
//   PT_CONV_LIMIT     optional: only run the first N frozen conversations
//   PT_RUN_GENERALIZATION  '1' to also run the frozen generalization set
//
// Run with: node_modules/.bin/electron main/askAutoIngestProductionTransferHarness.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const LABEL = process.env.PT_LABEL;
if (!LABEL) { console.error('[prod-transfer] PT_LABEL is required'); process.exit(1); }
const MODEL_PATH = process.env.PT_MODEL_PATH;
if (!MODEL_PATH || !fs.existsSync(MODEL_PATH)) { console.error('[prod-transfer] PT_MODEL_PATH missing or does not exist:', MODEL_PATH); process.exit(1); }
const EMBEDDING_PATH = process.env.PT_EMBEDDING_PATH;
const OUT_DIR = process.env.PT_OUT_DIR || path.join(os.tmpdir(), `ai-pt-${LABEL}`);
fs.mkdirSync(OUT_DIR, { recursive: true });
const CONV_LIMIT = process.env.PT_CONV_LIMIT ? Number(process.env.PT_CONV_LIMIT) : null;
const RUN_GENERALIZATION = process.env.PT_RUN_GENERALIZATION === '1';

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), `ai-pt-${LABEL}-userdata-`));

const { app, BrowserWindow } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

function logScope() {
  const repoRoot = path.join(__dirname, '..');
  const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain']).length > 0;
  console.log(`[prod-transfer:${LABEL}] branch=${branch} commit=${commit}${dirty ? ' (dirty working tree)' : ''}`);
  return { branch, commit, dirty };
}

async function setUpModel() {
  const modelManager = require('../services/localJudge/modelManager');
  const modelDirOverride = path.join(FIXTURE_USER_DATA, 'local-judge-models');
  const { finalPath } = modelManager.resolvePaths(modelDirOverride);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.symlinkSync(MODEL_PATH, finalPath);
  const v = await modelManager.verify(modelDirOverride);
  return { ok: v.status === modelManager.STATUS.READY, modelId: modelManager.MODEL_ID, expectedSha256: modelManager.EXPECTED_SHA256, verify: v, finalPath };
}

async function setUpEmbedding() {
  if (!EMBEDDING_PATH || !fs.existsSync(EMBEDDING_PATH)) return { ok: false, path: EMBEDDING_PATH };
  const embeddingModelManager = require('../services/semanticRetrieval/embeddingModelManager');
  const { finalPath } = embeddingModelManager.resolvePaths();
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.symlinkSync(EMBEDDING_PATH, finalPath);
  const v = await embeddingModelManager.verify();
  return { ok: v.status === embeddingModelManager.STATUS.READY, path: EMBEDDING_PATH, verify: v };
}

async function main() {
  const verificationScope = logScope();
  const modelSetup = await setUpModel();
  const embSetup = await setUpEmbedding();
  console.log(`[prod-transfer:${LABEL}] model ready=${modelSetup.ok} (${modelSetup.modelId}); embedding ready=${embSetup.ok}`);
  if (!modelSetup.ok) {
    console.error(`[prod-transfer:${LABEL}] FATAL: model did not verify READY through the real modelManager.verify() path`, modelSetup.verify);
    app.exit(1);
    return;
  }

  require('./askAutoIngest').registerIpcHandlers();

  const win = new BrowserWindow({
    width: 1280, height: 860, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 300));

  const ejs = (script) => win.webContents.executeJavaScript(script, true);
  async function resetConversation() {
    await ejs(`window.api.resetAskConversation()`).catch(() => {});
  }
  // Real ask:converse IPC round-trip -- returns the FULL, real
  // shapeConversationalResponse() object (classification, capabilityStatus,
  // synthesis.applied/reason, authority detail, etc.), not a DOM scrape.
  async function converse(message) {
    const t0 = Date.now();
    const response = await ejs(`window.api.askConverse(${JSON.stringify(message)})`);
    return { response, ms: Date.now() - t0 };
  }

  async function runConversationSet(conversations, label) {
    const out = [];
    for (const conv of conversations) {
      await resetConversation();
      const transcript = [];
      for (const message of conv.turns) {
        transcript.push({ role: 'user', text: message });
        let errored = null;
        let result = null;
        try {
          result = await converse(message);
        } catch (err) {
          errored = String(err && err.stack || err);
        }
        if (errored) {
          transcript.push({ role: 'assistant', kind: 'error', text: `[ERROR: ${errored}]` });
          console.log(`[prod-transfer:${LABEL}] ${label} ${conv.id} :: "${message.slice(0, 40)}" :: ERROR`);
          continue;
        }
        const { response, ms } = result;
        if (response.kind === 'clarification') {
          transcript.push({ role: 'assistant', kind: 'clarification', text: response.text, choices: response.choices, ms });
        } else {
          transcript.push({
            role: 'assistant', kind: 'final', text: response.answer.directAnswer, ms,
            meta: {
              classification: response.answer.classification,
              capabilityStatus: response.answer.status ? response.answer.status.code : null,
              statusLabel: response.answer.status ? response.answer.status.label : null,
              uncertaintyMessage: response.answer.uncertaintyMessage,
              steps: response.answer.steps,
              limitations: response.answer.limitations,
              synthesis: response.answer.technicalDetails ? response.answer.technicalDetails.synthesis : null,
              authority: response.answer.technicalDetails ? response.answer.technicalDetails.authority : null,
              topicChanged: !!response.topicChanged,
              hedged: !!response.hedged,
            },
          });
        }
        console.log(`[prod-transfer:${LABEL}] ${label} ${conv.id} :: "${message.slice(0, 40)}" (${ms}ms) :: ${response.kind}`);
      }
      out.push({ id: conv.id, category: conv.category || null, shape: conv.shape || null, transcript });
    }
    return out;
  }

  const { CONVERSATIONS } = require(path.join(__dirname, '..', 'scripts', 'product-docs', 'bench', 'bakeoff', 'conversationTrial.js'));
  const conversationsToRun = CONV_LIMIT ? CONVERSATIONS.slice(0, CONV_LIMIT) : CONVERSATIONS;

  const frozen19 = await runConversationSet(conversationsToRun, 'frozen19');

  let generalization = null;
  if (RUN_GENERALIZATION) {
    const { GENERALIZATION_CONVERSATIONS } = require(path.join(__dirname, '..', 'scripts', 'product-docs', 'bench', 'candidateC', 'generalizationSet.js'));
    generalization = await runConversationSet(GENERALIZATION_CONVERSATIONS, 'generalization');
  }

  win.destroy();
  const runtime = require('../services/localJudge/runtime');
  await runtime.unload().catch(() => {});
  runtime.terminate();
  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });

  const out = {
    label: LABEL,
    verificationScope,
    modelSetup: { ok: modelSetup.ok, modelId: modelSetup.modelId, expectedSha256: modelSetup.expectedSha256 },
    embSetup: { ok: embSetup.ok },
    frozen19,
    generalization,
  };
  fs.writeFileSync(path.join(OUT_DIR, `${LABEL}.json`), JSON.stringify(out, null, 2));
  console.log(`\n[prod-transfer:${LABEL}] Done. Wrote ${LABEL}.json to ${OUT_DIR}`);
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error(`[prod-transfer:${LABEL}] FATAL:`, err);
    app.exit(1);
  });
});
