'use strict';

// services/localJudge/electronSynthesisRelatedBenchmark.js — Phase C5,
// Section S/U supplementary run. Focused, faster companion to
// electronSynthesisBenchmark.js covering exactly the checkpoint's
// Related-topic acceptance set (Section S: "Source Selection", "Source
// Detection", "Grouping System", "Transfer Export", plus one Workflow
// record) through the real production known-record synthesis path
// (answerKnownRecordWithSynthesis()) -- no judge/authority calls are
// possible on this path (baseAuthorityDiagnostic() only), so this is much
// faster than the full 13-question sweep.
//
// Run with:
//   node_modules/.bin/electron services/localJudge/electronSynthesisRelatedBenchmark.js

const path = require('path');
const fs = require('fs');
const os = require('os');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-c5-related-bench-userdata-'));
const { app } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

const modelManager = require('./modelManager');
const runtime = require('./runtime');

const PRODUCT_DOCS = path.join(__dirname, '..', '..', 'scripts', 'product-docs');
const REAL_MODEL_PATH = path.join(PRODUCT_DOCS, 'bench', 'models', 'phi-4-mini-instruct-Q4_K_M.gguf');

const RELATED_TITLES = ['Source Selection', 'Source Detection', 'Grouping System', 'Transfer Export'];
const WORKFLOW_TITLE = 'Create a New Event';

async function main() {
  const { finalPath } = modelManager.resolvePaths(path.join(FIXTURE_USER_DATA, 'local-judge-models'));
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.symlinkSync(REAL_MODEL_PATH, finalPath);
  await modelManager.verify(path.join(FIXTURE_USER_DATA, 'local-judge-models'));
  const status = modelManager.getStatus();
  if (status.status !== modelManager.STATUS.READY) {
    console.error('[c5-related-bench] FATAL: not READY', JSON.stringify(status));
    process.exit(1);
  }

  const { answerKnownRecordWithSynthesis } = require(path.join(PRODUCT_DOCS, 'lib', 'answerWithSynthesis.js'));
  const { assemble } = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
  const { buildEngineContext } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
  const { built } = assemble();

  const titles = [...RELATED_TITLES, WORKFLOW_TITLE];
  const results = [];
  for (const title of titles) {
    const ctx = buildEngineContext(built);
    const feature = built.knowledgeIndex.find((f) => f.title === title || f.title.startsWith(`${title} (`));
    const workflow = !feature ? built.workflowIndex.find((w) => w.title === title || w.title.startsWith(`${title} (`)) : null;
    const record = feature || workflow;
    if (!record) {
      console.log(`\n[c5-related-bench] "${title}": NOT FOUND in real index`);
      results.push({ title, error: 'record not found' });
      continue;
    }
    const t0 = Date.now();
    const result = await answerKnownRecordWithSynthesis(record.id, ctx);
    const ms = Date.now() - t0;
    console.log(`\n[c5-related-bench] "${title}" (${record.id}, ${record.entityType || (workflow ? 'workflow' : 'feature')}, ${ms}ms) applied=${result.synthesis.applied} reason=${result.synthesis.reason || '-'}`);
    console.log(`  BEFORE: ${result.synthesis.applied ? '(see deterministic corpus)' : result.directAnswer}`);
    console.log(`  AFTER:  ${result.directAnswer}`);
    results.push({ title, recordId: record.id, ms, applied: result.synthesis.applied, reason: result.synthesis.reason, directAnswer: result.directAnswer, status: result.capabilityStatus });
  }

  await runtime.unload();
  runtime.terminate();
  fs.rmSync(finalPath, { force: true });
  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });

  const outPath = path.join(PRODUCT_DOCS, 'bench', 'results', 'phase-c5-synthesis-related-real-model.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n[c5-related-bench] applied ${results.filter((r) => r.applied).length}/${results.length} | wrote ${outPath}`);
  app.exit(0);
}

app.whenReady().then(() => main().catch((err) => { console.error('[c5-related-bench] FATAL:', err); app.exit(1); }));
