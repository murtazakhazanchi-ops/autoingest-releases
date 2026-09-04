'use strict';
// Ask AutoIngest — Stage 1 deterministic retrieval foundation, Section 12
// (index build lifecycle) + Section 20 (performance). Measures the
// production retrieval module's own cost in isolation from the Qwen
// runtime it is designed to eventually sit beneath. No model, no network,
// no GPU -- pure Node process timing/memory.
//
// Run with: node scripts/product-docs/bench/orchestrator/retrievalStage1Performance.js
// Writes a JSON report to scripts/product-docs/bench/results/retrieval-stage1-performance.json

const fs = require('fs');
const path = require('path');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { search, buildRetrievalIndex } = require('../../lib/askRetrieval/retrieval');
const retrieval250 = require('./retrieval250');

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

// Rough, best-available in-memory size estimate for a Map-based structure
// (there is no persisted-to-disk index artifact in Stage 1's design --
// the index is built in-process and held by the caller, never serialized
// -- so "artifact size" here means the live object's approximate memory
// footprint, not a file size). JSON.stringify of the Map contents is used
// as a deterministic, reproducible proxy; not exact V8 heap accounting.
function approxIndexBytes(index) {
  const plain = {
    idf: Object.fromEntries(index.idf),
    tfById: Object.fromEntries([...index.tfById].map(([k, v]) => [k, Object.fromEntries(v)])),
    docLenById: Object.fromEntries(index.docLenById),
    avgDocLen: index.avgDocLen,
    N: index.N,
  };
  return Buffer.byteLength(JSON.stringify(plain), 'utf8');
}

function main() {
  const report = {};

  if (global.gc) global.gc();
  const heapBefore = process.memoryUsage().heapUsed;

  const t0 = nowMs();
  const { built } = build.assemble();
  const t1 = nowMs();
  report.kbAssembleMs = +(t1 - t0).toFixed(2);

  const t2 = nowMs();
  const ctx = buildEngineContext(built);
  const t3 = nowMs();
  report.engineContextBuildMs = +(t3 - t2).toFixed(2);

  const t4 = nowMs();
  const indexNoCtx = buildRetrievalIndex(built);
  const t5 = nowMs();
  report.retrievalIndexBuildMs_withoutDecisionText = +(t5 - t4).toFixed(2);

  const t6 = nowMs();
  const indexWithCtx = buildRetrievalIndex(built, ctx);
  const t7 = nowMs();
  report.retrievalIndexBuildMs_withDecisionText = +(t7 - t6).toFixed(2);

  const heapAfterBuild = process.memoryUsage().heapUsed;
  report.approxHeapDeltaAfterBothIndexesBytes = heapAfterBuild - heapBefore;

  report.approxIndexSizeBytes_withoutDecisionText = approxIndexBytes(indexNoCtx);
  report.approxIndexSizeBytes_withDecisionText = approxIndexBytes(indexWithCtx);
  report.indexedDocumentCount = indexNoCtx.N;

  // Query latency: run every scored retrieval250 query once (certified,
  // no-ctx configuration -- the configuration Qwen/tool layer would call
  // in Stage 1's own design), record per-query wall time.
  const scored = retrieval250.filter((b) => b.style !== 'no-answer');
  const latenciesMs = [];
  for (const item of scored) {
    const qStart = nowMs();
    search(built, ctx, indexNoCtx, item.q);
    latenciesMs.push(nowMs() - qStart);
  }
  latenciesMs.sort((a, b) => a - b);
  report.queryCount = latenciesMs.length;
  report.queryLatencyMs = {
    p50: +percentile(latenciesMs, 50).toFixed(3),
    p90: +percentile(latenciesMs, 90).toFixed(3),
    p95: +percentile(latenciesMs, 95).toFixed(3),
    max: +latenciesMs[latenciesMs.length - 1].toFixed(3),
    mean: +(latenciesMs.reduce((a, b) => a + b, 0) / latenciesMs.length).toFixed(3),
  };

  report.notes = [
    'No persisted-to-disk index artifact exists in Stage 1\'s design -- the index is built in-process via buildRetrievalIndex() and held by the caller; "index size" above is an approximate in-memory footprint (JSON-serialization proxy), not a file size.',
    'Query latency measured against the full retrieval250 scored set (237 queries) using the certified (no decision-text enrichment) configuration, single-process, no warmup discard, cold-cache-per-query in the sense that no query result is memoized.',
    'These numbers are for the retrieval layer only -- no Qwen/model inference is included anywhere in this measurement (Stage 1 has zero learned retrieval components and zero production callers).',
  ];

  const outPath = path.join(__dirname, '..', 'results', 'retrieval-stage1-performance.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWritten to ${outPath}`);
}

main();
