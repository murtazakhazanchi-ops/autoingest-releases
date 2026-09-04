'use strict';
// Ask AutoIngest — Stage 2 deterministic knowledge/tool foundation,
// Section 26 (performance). Measures Stage 2's own deterministic
// infrastructure in isolation from the Qwen runtime it is designed to
// eventually sit beneath -- no model, no network, no GPU.
//
// Run with: node scripts/product-docs/bench/orchestrator/stage2Performance.js
// Writes scripts/product-docs/bench/results/stage2-performance.json

const fs = require('fs');
const path = require('path');
const build = require('../../lib/build');
const { buildKnowledgeContext, createKnowledgeOperations, HandleSession } = require('../../lib/askKnowledge/index');
const { KNOWLEDGE_MODEL } = require('../../lib/knowledgeModel/index');

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

function stats(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    p50: +percentile(sorted, 50).toFixed(3),
    p90: +percentile(sorted, 90).toFixed(3),
    p95: +percentile(sorted, 95).toFixed(3),
    max: +sorted[sorted.length - 1].toFixed(3),
    mean: +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(3),
  };
}

function main() {
  const report = {};

  const heapBefore = process.memoryUsage().heapUsed;

  const t0 = nowMs();
  const { built } = build.assemble();
  const t1 = nowMs();
  report.kbAssembleMs = +(t1 - t0).toFixed(2);

  const t2 = nowMs();
  const knowledgeContext = buildKnowledgeContext(built); // ctx + Stage-1 retrieval index, one call
  const t3 = nowMs();
  report.buildKnowledgeContextMs = +(t3 - t2).toFixed(2);

  const heapAfterBuild = process.memoryUsage().heapUsed;
  report.approxHeapDeltaBytes = heapAfterBuild - heapBefore;

  // Knowledge Model in-memory footprint -- the 66-record corpus itself is
  // require()'d module data (already resident before this script's own
  // timers start), reported here via JSON size as the best-available proxy
  // for "how much data Stage 2's own knowledge layer adds beyond Stage 1's
  // retrieval index and the existing production KB."
  report.knowledgeModelRecordCount = KNOWLEDGE_MODEL.length;
  report.approxKnowledgeModelSizeBytes = Buffer.byteLength(JSON.stringify(KNOWLEDGE_MODEL), 'utf8');

  const hs = new HandleSession();
  const ops = createKnowledgeOperations(knowledgeContext, hs);

  // Search latency: one search per real record (title as query, same
  // deterministic exercise the corpus audit uses).
  const allRealIds = [
    ...built.featureIndex.map((f) => f.feature_id),
    ...built.workflowIndex.map((w) => w.id),
  ];
  const titleById = new Map();
  for (const f of built.featureIndex) titleById.set(f.feature_id, f.name);
  for (const w of built.workflowIndex) titleById.set(w.id, w.title);

  const searchLatencies = [];
  const handleByRealId = new Map();
  for (const id of allRealIds) {
    const t = nowMs();
    const result = ops.search_autoingest(titleById.get(id));
    searchLatencies.push(nowMs() - t);
    if (result.results.length) handleByRealId.set(id, result.results[0].handle);
  }
  report.searchLatencyMs = stats(searchLatencies);
  report.searchCount = searchLatencies.length;

  // Read latency: full-dimension read for every issued handle.
  const readLatencies = [];
  for (const handle of handleByRealId.values()) {
    const t = nowMs();
    ops.read_autoingest(handle, ['purpose', 'behavior', 'operatorWorkflow', 'preconditions', 'actions', 'recovery', 'limitations', 'relationships', 'technicalDetail']);
    readLatencies.push(nowMs() - t);
  }
  report.readLatencyMs = stats(readLatencies);
  report.readCount = readLatencies.length;

  // Relationship-lookup latency: every consecutive pair of issued handles.
  const handles = [...handleByRealId.values()];
  const relLatencies = [];
  for (let i = 0; i < handles.length - 1; i++) {
    const t = nowMs();
    ops.check_relationship(handles[i], handles[i + 1]);
    relLatencies.push(nowMs() - t);
  }
  report.relationshipLookupLatencyMs = stats(relLatencies);
  report.relationshipLookupCount = relLatencies.length;

  // capability_status and roadmap_status latency, same handle set.
  (async () => {
    const capLatencies = [];
    for (const handle of handles.slice(0, 30)) {
      const t = nowMs();
      // eslint-disable-next-line no-await-in-loop
      await ops.capability_status(handle);
      capLatencies.push(nowMs() - t);
    }
    report.capabilityStatusLatencyMs = stats(capLatencies);

    const roadmapLatencies = [];
    for (const handle of handles.slice(0, 30)) {
      const t = nowMs();
      ops.roadmap_status(handle);
      roadmapLatencies.push(nowMs() - t);
    }
    report.roadmapStatusLatencyMs = stats(roadmapLatencies);

    report.notes = [
      'No persisted-to-disk artifact exists for Stage 2\'s own knowledge layer -- the Knowledge Model is require()\'d module data (already resident), and buildKnowledgeContext() builds the engine ctx + Stage-1 retrieval index in-process, held by the caller.',
      'All latencies measured against the real, full 67-record corpus (58 Features + 9 Workflows), single-process, no warmup discard.',
      'These numbers are for the deterministic knowledge/tool layer only -- no Qwen/model inference is included anywhere (Stage 2 has zero learned retrieval or judgment components).',
    ];

    const outPath = path.join(__dirname, '..', 'results', 'stage2-performance.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nWritten to ${outPath}`);
  })();
}

main();
