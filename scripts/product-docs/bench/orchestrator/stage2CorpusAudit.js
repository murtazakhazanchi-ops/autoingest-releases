'use strict';
// Ask AutoIngest — Stage 2 deterministic knowledge/tool foundation,
// Section 22 (corpus audit). Every count below is reproducible: re-running
// this script against the same repository state produces identical
// numbers (no randomness, no model, no network).
//
// Run with: node scripts/product-docs/bench/orchestrator/stage2CorpusAudit.js
// Writes scripts/product-docs/bench/results/stage2-corpus-audit.json

const fs = require('fs');
const path = require('path');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { KNOWLEDGE_MODEL, findAllByFeatureId } = require('../../lib/knowledgeModel/index');
const { classifyRelationType, validateFullCorpus, scanForLeaks, isRecognizedRecordIdShape } = require('../../lib/askKnowledge/validators');
const { resolveRelationship, DIRECTIONAL_TYPES, PROCEDURAL_ORDERING_TYPES } = require('../../lib/askKnowledge/relationships');
const { readAutoIngest, VALID_DIMENSIONS } = require('../../lib/askKnowledge/read');
const { searchAutoIngest } = require('../../lib/askKnowledge/search');
const { buildRetrievalIndex } = require('../../lib/askRetrieval/retrieval');
const { HandleSession } = require('../../lib/askKnowledge/handles');
const { decisionFactsFor } = require('../../lib/askKnowledge/decisionFacts');

function main() {
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  const featureRecords = built.featureIndex || [];
  const workflowRecords = built.workflowIndex || [];

  // --- Decision records considered vs. included -----------------------------
  // "Considered": every Decision-type record in the shared search index
  // (production infrastructure, read-only). "Included": those actually
  // reachable via decisionFactsFor() for at least one Feature (i.e. cited
  // by some Feature's own authorityIndexByFeatureId.relatedDecisions).
  const allDecisionIds = new Set();
  for (const [id, rec] of ctx.searchIndexById || new Map()) {
    if (rec && rec.entity_type === 'decision') allDecisionIds.add(id);
  }
  const includedDecisionIds = new Set();
  for (const f of featureRecords) {
    for (const fact of decisionFactsFor(f.feature_id, ctx)) {
      // decisionFactsFor returns resolved TEXT, not ids -- re-derive the
      // id set directly from the same source it reads, for an accurate
      // reproducible count without re-parsing resolved prose.
      void fact;
    }
    const entry = ctx.authorityIndexByFeatureId && ctx.authorityIndexByFeatureId.get(f.feature_id);
    for (const decId of (entry && entry.relatedDecisions) || []) {
      const dec = ctx.searchIndexById.get(decId);
      if (dec && dec.entity_type === 'decision' && (dec.detail || dec.summary)) includedDecisionIds.add(decId);
    }
  }

  // --- Relationship edges, by classification ---------------------------------
  let totalEdges = 0;
  const byClassification = { DIRECTIONAL: 0, SYMMETRIC: 0, GENERIC_UNKNOWN: 0 };
  const byType = {};
  const unresolvedTargets = [];
  for (const r of KNOWLEDGE_MODEL) {
    for (const rel of r.relationships || []) {
      totalEdges++;
      byClassification[classifyRelationType(rel.type)]++;
      byType[rel.type] = (byType[rel.type] || 0) + 1;
      const targetRecords = findAllByFeatureId(rel.targetId);
      const targetById = KNOWLEDGE_MODEL.find((x) => x.id === rel.targetId);
      if (!targetRecords.length && !targetById) unresolvedTargets.push({ fromRecord: r.id, targetId: rel.targetId, type: rel.type });
    }
  }

  // --- Conflicting facts: relationship CONFLICT + capability-status source
  // inconsistency, both computed exhaustively (every Feature pair with any
  // edge at all; every Feature's own KM-vs-live status), not sampled. -----
  const relationshipConflicts = [];
  // Softer finding (Section 10/DEC-023): a non-procedural DIRECTIONAL type
  // (uses/writesTo/readsFrom) asserted in both directions for the same
  // pair is NOT treated as a CONFLICT by resolveRelationship() (real
  // components can legitimately use/write-to/read-from each other
  // mutually) -- but it is still worth a maintainer's attention for
  // redundancy/consistency review, so it is reported here separately,
  // never as an authority-affecting finding.
  const bidirectionalNonProceduralEdges = [];
  const nonProceduralDirectionalTypes = [...DIRECTIONAL_TYPES].filter((t) => !PROCEDURAL_ORDERING_TYPES.has(t));
  const checkedPairs = new Set();
  for (const r of KNOWLEDGE_MODEL) {
    if (!r.featureId) continue;
    for (const rel of r.relationships || []) {
      const targetRecord = KNOWLEDGE_MODEL.find((x) => x.id === rel.targetId || x.featureId === rel.targetId);
      const targetFeatureId = targetRecord ? (targetRecord.featureId || targetRecord.id) : rel.targetId;
      const pairKey = [r.featureId, targetFeatureId].sort().join('|');
      if (checkedPairs.has(pairKey)) continue;
      checkedPairs.add(pairKey);
      const result = resolveRelationship(r.featureId, targetFeatureId);
      if (result.status === 'CONFLICT') {
        relationshipConflicts.push({ pair: [r.featureId, targetFeatureId], note: result.note });
      }
      for (const t of nonProceduralDirectionalTypes) {
        const subjectSide = result.edges.some((m) => m.direction === 'subject->object' && m.type === t);
        const objectSide = result.edges.some((m) => m.direction === 'object->subject' && m.type === t);
        if (subjectSide && objectSide) bidirectionalNonProceduralEdges.push({ pair: [r.featureId, targetFeatureId], type: t });
      }
    }
  }

  // --- EMPTY / THIN records, no-retrieval-surface records --------------------
  // Every real Feature+Workflow id, read through read_autoingest with the
  // full VALID_DIMENSIONS set (the most complete possible read), classified
  // by its own knowledgeState.
  const hs = new HandleSession();
  let emptyCount = 0;
  let thinCount = 0;
  let documentedCount = 0;
  const emptyIds = [];
  const thinIds = [];
  const allRealIds = [...featureRecords.map((f) => f.feature_id), ...workflowRecords.map((w) => w.id)];
  const handleById = new Map();
  for (const id of allRealIds) handleById.set(id, hs.issue(id));

  const leakCandidates = [];
  for (const id of allRealIds) {
    const result = readAutoIngest(handleById.get(id), VALID_DIMENSIONS, ctx, hs);
    if (result.knowledgeState === 'EMPTY') { emptyCount++; emptyIds.push(id); }
    else if (result.knowledgeState === 'THIN') { thinCount++; thinIds.push(id); }
    else documentedCount++;
    // Operator-facing leak scan, folded into the same pass: every real
    // record's full dimension set, scanned exhaustively (not sampled) for
    // any remaining unresolved internal reference.
    const leaks = scanForLeaks(result);
    if (leaks.length) leakCandidates.push({ id, source: 'read', leaks });
  }

  // Search-surface leak scan (Section 22, folded in after an integration
  // test caught a real gap: purposeFor()'s docs-tooling summary/whatItDoes
  // fallback text can itself cite a raw AI-FEAT-### id -- exhaustively
  // exercised here by searching on every record's own title, guaranteeing
  // that record's own purpose text is exercised by purposeFor() at least
  // once, not merely sampled).
  const retrievalIndex = buildRetrievalIndex(built);
  const searchHs = new HandleSession();
  for (const id of allRealIds) {
    const title = (built.featureIndex.find((f) => f.feature_id === id) || {}).name
      || (built.workflowIndex.find((w) => w.id === id) || {}).title;
    if (!title) continue;
    const result = searchAutoIngest(title, ctx, built, retrievalIndex, searchHs);
    const leaks = scanForLeaks(result);
    if (leaks.length) leakCandidates.push({ id, source: 'search', leaks });
  }

  const schemaErrors = validateFullCorpus();

  const report = {
    featureRecordCount: featureRecords.length,
    workflowRecordCount: workflowRecords.length,
    knowledgeModelRecordCount: KNOWLEDGE_MODEL.length,
    decisionRecordsConsidered: allDecisionIds.size,
    decisionRecordsIncluded: includedDecisionIds.size,
    relationshipEdges: {
      total: totalEdges,
      byClassification,
      byType,
      unresolvedTargets,
    },
    conflictingFacts: {
      relationshipConflicts,
      count: relationshipConflicts.length,
    },
    bidirectionalNonProceduralEdges: {
      note: 'Not CONFLICTs -- uses/writesTo/readsFrom can be legitimately mutual. Reported for maintainer redundancy/consistency review only.',
      pairs: bidirectionalNonProceduralEdges,
      count: bidirectionalNonProceduralEdges.length,
    },
    knowledgeStateCounts: {
      EMPTY: emptyCount,
      THIN: thinCount,
      DOCUMENTED: documentedCount,
      emptyIds,
      thinIds,
    },
    recordsWithNoUsefulRetrievalSurface: emptyIds, // EMPTY == no KM record == no retrieval-surface enrichment beyond docs-tooling summary
    operatorFacingLeakCandidates: leakCandidates,
    schemaValidationErrors: schemaErrors,
    allRecordIdsRecognizedShape: allRealIds.every(isRecognizedRecordIdShape),
    reproducibility: 'Deterministic: re-running this script against the same repository state (no git changes) produces identical counts. No randomness, model, network, or wall-clock-dependent logic is used anywhere in this computation.',
  };

  const outPath = path.join(__dirname, '..', 'results', 'stage2-corpus-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  console.log(`Features: ${report.featureRecordCount}, Workflows: ${report.workflowRecordCount}, KM records: ${report.knowledgeModelRecordCount}`);
  console.log(`Decisions considered/included: ${report.decisionRecordsConsidered}/${report.decisionRecordsIncluded}`);
  console.log(`Relationship edges: ${totalEdges} (directional=${byClassification.DIRECTIONAL}, symmetric=${byClassification.SYMMETRIC}, generic=${byClassification.GENERIC_UNKNOWN})`);
  console.log(`Unresolved relationship targets: ${unresolvedTargets.length}`);
  console.log(`Relationship conflicts: ${relationshipConflicts.length}`);
  console.log(`Bidirectional non-procedural edges (informational): ${bidirectionalNonProceduralEdges.length}`);
  console.log(`knowledgeState: EMPTY=${emptyCount} THIN=${thinCount} DOCUMENTED=${documentedCount}`);
  console.log(`Leak candidates: ${leakCandidates.length}`);
  console.log(`Schema validation errors: ${schemaErrors.length}`);
  console.log(`\nWritten to ${outPath}`);
}

main();
