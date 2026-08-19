'use strict';

// services/localJudge/electronMeasure.js — Phase C2, Parts L/M. Real
// Electron main-process measurement harness (utilityProcess + node-llama-cpp
// only exist inside a running Electron app, so this cannot be a plain-node
// script). Measures, from real runs, what Part L/M explicitly forbid
// inventing without evidence: representative inference latency (median/p95/
// slowest/cold/warm) and RAM while loaded (via app.getAppMetrics(), which
// reports the CHILD utilityProcess's own memory -- not this main process's,
// which the earlier smoke test incorrectly measured).
//
// Run with:
//   node_modules/.bin/electron services/localJudge/electronMeasure.js [modelPath]

const { app } = require('electron');
const path = require('path');
const runtime = require('./runtime');

const MODEL_PATH = process.argv[2] || path.join(__dirname, '..', '..', 'scripts', 'product-docs', 'bench', 'models', 'phi-4-mini-instruct-Q4_K_M.gguf');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['judgment', 'evidenceHandles', 'confidence'],
  properties: {
    judgment: { type: 'string', enum: ['SUPPORTS', 'CONTRADICTS', 'INSUFFICIENT_EVIDENCE'] },
    evidenceHandles: { type: 'array', items: { type: 'string', enum: ['S1'] } },
    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
  },
};
const SYSTEM = 'You are a strict evidence-entailment classifier. Output only the JSON object described by the schema.';

// 8 representative claim/evidence pairs spanning the shapes actually seen
// in the frozen gold set (short/long evidence, SUPPORTS/INSUFFICIENT-shaped)
// -- not the full 56-case benchmark (that is Part T's separate, dedicated
// acceptance-bar run); this is purely for latency/RAM measurement.
const CASES = [
  { claim: 'AutoIngest offers duplicate detection during import', evidence: 'Same name + size -> skip. Different size -> rename (_1, _2 numbered-slot search). No overwrite under any condition.' },
  { claim: 'AutoIngest supports QMZ sequencing', evidence: 'QMZ = Qadam / Majlis / Ziyafat -- a standalone sequencing workspace distinct from standard Event Import, with its own root and durable state file.' },
  { claim: 'AutoIngest supports archive health reporting', evidence: 'Four read-only reporting and audit surfaces giving operators visibility into archive health: Consistency Report, Completeness Checklist, Archive Diagnostics, and Audit Timeline.' },
  { claim: 'AutoIngest offers stale lock detection and recovery', evidence: 'Photographer-level write locks for Direct Archive imports, preventing concurrent imports into the same event folder, with automatic detection and recovery of stale locks.' },
  { claim: 'AutoIngest supports blockchain-verified chain-of-custody signing for archived photos', evidence: 'No matching code, feature, or roadmap record for blockchain, chain-of-custody, or cryptographic signing anywhere in the documented feature set.' },
  { claim: 'AutoIngest offers cloud backup', evidence: 'All four storage roots are local or NAS-based; no fallback to a remote service when local storage is unavailable.' },
  { claim: 'An operator can tell if a teammate is online right now', evidence: 'On-demand audit view for any event in the master archive: import history grouped by date with event-level summary. Team Live tab shows an Active Now device list.' },
  { claim: 'AutoIngest supports drone footage import with GPS flight paths', evidence: 'Metadata verification cross-checks EXIF/IPTC/XMP fields against expected schema; no drone-specific or GPS-flight-path handling is documented anywhere in this record.' },
];

function userFor(claim, evidence) {
  return JSON.stringify({ claim, availableEvidence: [{ handle: 'S1', kind: 'summary', text: evidence }], availableHandles: ['S1'] }, null, 2);
}

function childMemMB() {
  const pid = runtime.getLoadState().pid;
  if (!pid) return null;
  const metrics = app.getAppMetrics();
  const entry = metrics.find((m) => m.pid === pid);
  if (!entry) return null;
  return { workingSetSizeMB: Math.round(entry.memory.workingSetSize / 1024), peakWorkingSetSizeMB: Math.round(entry.memory.peakWorkingSetSize / 1024), type: entry.type };
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

async function main() {
  const report = {};

  // Cold load + first judgment (the actual first-use latency an operator
  // would experience).
  const tColdStart = Date.now();
  const loadResult = await runtime.ensureLoaded(MODEL_PATH);
  const tAfterLoad = Date.now();
  const first = await runtime.infer({ system: SYSTEM, user: userFor(CASES[0].claim, CASES[0].evidence), schema: SCHEMA, maxTokens: 200, modelPath: MODEL_PATH, timeoutMs: 60000 });
  const tAfterFirstInfer = Date.now();
  report.coldLoadMs = tAfterLoad - tColdStart;
  report.coldLoadPlusFirstJudgmentMs = tAfterFirstInfer - tColdStart;
  report.reportedLoadMs = loadResult.loadMs;
  report.gpu = loadResult.gpu;
  report.ramWhileLoadedMB = childMemMB();
  console.log('[measure] cold load:', report.coldLoadMs, 'ms; cold load + first judgment:', report.coldLoadPlusFirstJudgmentMs, 'ms; RAM:', JSON.stringify(report.ramWhileLoadedMB));

  // Warm judgments -- run every representative case 3x each (24 total),
  // discard the already-counted cold-start first call, report the full
  // warm-latency distribution.
  const warmLatencies = [];
  for (let round = 0; round < 3; round++) {
    for (const c of CASES) {
      const t0 = Date.now();
      const r = await runtime.infer({ system: SYSTEM, user: userFor(c.claim, c.evidence), schema: SCHEMA, maxTokens: 200, modelPath: MODEL_PATH, timeoutMs: 60000 });
      const ms = Date.now() - t0;
      warmLatencies.push(ms);
      console.log(`[measure] warm round ${round + 1} "${c.claim.slice(0, 40)}...": ${ms}ms, judgment=${r.parsed && r.parsed.judgment}`);
    }
  }
  const sorted = [...warmLatencies].sort((a, b) => a - b);
  report.warmLatency = {
    n: sorted.length,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    slowestMs: sorted[sorted.length - 1],
    fastestMs: sorted[0],
    meanMs: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
  report.ramWhileLoadedAfterWarmRuns = childMemMB();
  console.log('[measure] warm latency distribution:', JSON.stringify(report.warmLatency));
  console.log('[measure] RAM after warm runs:', JSON.stringify(report.ramWhileLoadedAfterWarmRuns));

  // Idle-unload behavior: does node-llama-cpp actually release memory on
  // unload(), and what does a subsequent reload cost?
  const pidBeforeUnload = runtime.getLoadState().pid;
  await runtime.unload();
  // Give the OS a moment to reclaim pages after the child's model.dispose()
  // -- measured, not assumed; the metric itself proves whether this
  // matters at all.
  await new Promise((r) => setTimeout(r, 500));
  const metricsAfterUnload = app.getAppMetrics().find((m) => m.pid === pidBeforeUnload);
  report.ramAfterUnloadMB = metricsAfterUnload ? Math.round(metricsAfterUnload.memory.workingSetSize / 1024) : null;
  report.processStillAliveAfterUnload = !!metricsAfterUnload;
  console.log('[measure] RAM after unload():', report.ramAfterUnloadMB, 'process still alive:', report.processStillAliveAfterUnload);

  const tReloadStart = Date.now();
  const reloadResult = await runtime.ensureLoaded(MODEL_PATH);
  const tReloadEnd = Date.now();
  report.reloadAfterUnloadMs = tReloadEnd - tReloadStart;
  report.reloadReportedLoadMs = reloadResult.loadMs;
  console.log('[measure] reload after unload:', report.reloadAfterUnloadMs, 'ms (reused same child process:', runtime.getLoadState().pid === pidBeforeUnload, ')');

  await runtime.unload();
  runtime.terminate();

  console.log('\n[measure] FULL REPORT JSON:');
  console.log(JSON.stringify(report, null, 2));
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[measure] FATAL:', err);
    app.exit(1);
  });
});
