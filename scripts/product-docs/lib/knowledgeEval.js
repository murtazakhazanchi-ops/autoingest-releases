'use strict';

// Stage 1 Knowledge Engine — runs the 20-question corpus
// (knowledgeTestCorpus.js) against the real engine, reports expected vs.
// actual honestly (including known misses — see the corpus file's own
// `knownLimitation` notes), and emits a knowledge-gap report (Phase 11 of
// AI-FEAT-058's brief). This is a prototype evaluation artifact, not part
// of the deterministic `build`/`validate` freshness-diff contract — it
// depends on the fixed test corpus, not on canonical docs/product/
// Markdown, so it is written directly here rather than folded into
// lib/build.js's files map.

const fs = require('fs');
const path = require('path');
const build = require('./build');
const { answerQuestion, buildEngineContext, explainHistoricalContext } = require('./knowledgeEngine');
const { CORPUS } = require('./knowledgeTestCorpus');
const { CORPUS_V2 } = require('./knowledgeTestCorpusV2');
const { REGRESSION_CORPUS_V3 } = require('./knowledgeRegressionCorpusV3');
const { captureEvidence, diagnoseMissingMember } = require('./knowledgeEvalDiagnostics');
const { stableStringify } = require('./stableJson');
const { GENERATED_ROOT } = require('./repoRoot');

function evaluateOne(entry, ctx) {
  const answer = answerQuestion(entry.question, ctx);
  const statusMatch = answer.capabilityStatus === entry.expectedStatus;
  const qualityMatch = answer.matchQuality === entry.expectedMatchQuality;
  // Stage 1 never has real instructions (no Workflow record type yet) — the
  // only valid "instructions exist" signal is a non-fallback guidance
  // string, which never happens in Stage 1. Asserted explicitly so a future
  // stage that adds Workflow records changes this deliberately, not silently.
  // V2 corpus entries (Phase 20) don't carry instructionsShouldExist/
  // shouldAcknowledgeGap — those fields are undefined, treated as N/A
  // (always matching) rather than forcing every V2 entry to declare them.
  const actualInstructionsExist = !!answer.guidance && answer.guidance !== 'AutoIngest supports this capability, but detailed operator instructions are not yet documented.';
  const instructionsMatch = entry.instructionsShouldExist === undefined ? true : (actualInstructionsExist === entry.instructionsShouldExist);
  const acknowledgesGap = answer.matchQuality === 'weak' || answer.matchQuality === 'none' || !!answer.guidance;
  const gapAcknowledgementMatch = entry.shouldAcknowledgeGap === undefined ? true : (acknowledgesGap === entry.shouldAcknowledgeGap || entry.shouldAcknowledgeGap === false);

  const pass = statusMatch && qualityMatch && instructionsMatch;

  return {
    id: entry.id,
    domain: entry.domain,
    question: entry.question,
    expectedStatus: entry.expectedStatus,
    actualStatus: answer.capabilityStatus,
    expectedMatchQuality: entry.expectedMatchQuality,
    actualMatchQuality: answer.matchQuality,
    statusMatch,
    qualityMatch,
    instructionsMatch,
    gapAcknowledgementMatch,
    pass,
    knownLimitation: entry.knownLimitation || null,
    actualDirectAnswer: answer.directAnswer,
    actualPrimaryMatches: answer.matchedCapabilities.map((m) => `${m.id}(${m.score})`),
    actualSources: answer.sources.map((s) => s.id),
  };
}

function renderTable(results) {
  const rows = results.map((r) => {
    const mark = r.pass ? 'PASS' : (r.knownLimitation ? 'KNOWN-MISS' : 'FAIL');
    return `${r.id.padEnd(4)} ${mark.padEnd(11)} status ${r.actualStatus.padEnd(15)}(exp ${r.expectedStatus.padEnd(15)}) quality ${String(r.actualMatchQuality).padEnd(8)}(exp ${r.expectedMatchQuality})  ${r.domain}`;
  });
  return rows.join('\n');
}

function runEval({ outPath, corpus } = {}) {
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);
  const results = (corpus || CORPUS).map((entry) => evaluateOne(entry, ctx));

  const passCount = results.filter((r) => r.pass).length;
  const knownMissCount = results.filter((r) => !r.pass && r.knownLimitation).length;
  const unexplainedFailures = results.filter((r) => !r.pass && !r.knownLimitation);

  const table = renderTable(results);
  const summary = `${passCount}/${results.length} passed exactly as expected; ${knownMissCount}/${results.length} deviated in an already-documented, evidenced way (see each entry's knownLimitation); ${unexplainedFailures.length}/${results.length} deviated with NO prior explanation (real regressions, not yet documented).`;

  const gapReport = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    corpus_size: results.length,
    pass_count: passCount,
    known_miss_count: knownMissCount,
    unexplained_failure_count: unexplainedFailures.length,
    gaps: results
      .filter((r) => r.expectedMatchQuality !== 'strong' || !r.pass)
      .map((r) => ({
        gapType: r.actualMatchQuality === 'none' ? 'NO_MATCH' : (r.actualMatchQuality === 'weak' ? 'AMBIGUOUS_RETRIEVAL' : (r.pass ? 'MISSING_OPERATOR_WORKFLOW' : 'UNEXPECTED_RESULT')),
        query: r.question,
        domain: r.domain,
        relatedFeature: r.actualPrimaryMatches[0] || null,
        missingEvidence: r.actualMatchQuality === 'weak' || r.actualMatchQuality === 'none'
          ? ['unambiguous topical match', 'step-by-step instructions', 'UI navigation']
          : ['step-by-step instructions', 'UI navigation'],
        pass: r.pass,
        note: r.knownLimitation || (r.pass ? null : 'Unexplained deviation from expectation — needs investigation.'),
      })),
  };

  const resolvedOutPath = outPath || path.join(GENERATED_ROOT, 'knowledge-gap-report.json');
  fs.mkdirSync(path.dirname(resolvedOutPath), { recursive: true });
  fs.writeFileSync(resolvedOutPath, stableStringify(gapReport));

  return { results, table, summary, outPath: resolvedOutPath, failures: unexplainedFailures };
}

// Stage 2, Phase 20 — runs the expanded 99-question corpus (superset of the
// V1 20 — see knowledgeTestCorpusV2.js's own header) against the real
// engine, writing a separate gap report so it never overwrites V1's.
function runEvalV2({ outPath } = {}) {
  return runEval({ outPath: outPath || path.join(GENERATED_ROOT, 'knowledge-gap-report-v2.json'), corpus: CORPUS_V2 });
}

// Part 3 Phase 4.1 (Decision 7) — the hardened evaluator. Extends, never
// replaces, evaluateOne() above: same answerQuestion() call, same
// observe-and-assert discipline (see knowledgeEvalDiagnostics.js's header
// comment on harness independence — no scoring/admission/relationship
// algorithm is reimplemented here). Only checks a test entry actually
// declares are evaluated — an entry with no applicable fields (a pure
// 'schema-placeholder') returns meetsTargetExpectation: null, never a false
// failure for an assertion that was never made.
function evaluateOneHardened(entry, ctx, authorityIndex) {
  const answer = answerQuestion(entry.question, ctx);
  const evidence = captureEvidence(answer);
  const checks = [];
  const diagnostics = [];

  const candidateIds = new Set(evidence.matchedCapabilities.map((m) => m.id));
  const sourceIds = evidence.sources.map((s) => s.id);
  const primaryId = sourceIds[0] || (evidence.matchedCapabilities[0] && evidence.matchedCapabilities[0].id) || null;

  if (entry.expectedStatus !== undefined) {
    checks.push({ name: 'status', pass: answer.capabilityStatus === entry.expectedStatus, expected: entry.expectedStatus, actual: answer.capabilityStatus });
  }
  if (entry.expectedMatchQuality !== undefined) {
    checks.push({ name: 'matchQuality', pass: answer.matchQuality === entry.expectedMatchQuality, expected: entry.expectedMatchQuality, actual: answer.matchQuality });
  }
  if (entry.expectedClassification !== undefined) {
    checks.push({ name: 'classification', pass: answer.classification === entry.expectedClassification, expected: entry.expectedClassification, actual: answer.classification });
  }
  if (entry.allowedMemberIds && entry.allowedMemberIds.length) {
    checks.push({ name: 'allowedPrimary', pass: entry.allowedMemberIds.includes(primaryId), expected: entry.allowedMemberIds, actual: primaryId });
  }
  if (entry.forbiddenMemberIds && entry.forbiddenMemberIds.length) {
    checks.push({ name: 'forbiddenPrimary', pass: !entry.forbiddenMemberIds.includes(primaryId), expected: `not one of [${entry.forbiddenMemberIds.join(', ')}]`, actual: primaryId });
  }
  if (entry.requiredMemberIds && entry.requiredMemberIds.length) {
    for (const reqId of entry.requiredMemberIds) {
      const present = candidateIds.has(reqId) || sourceIds.includes(reqId);
      checks.push({ name: `required:${reqId}`, pass: present, expected: reqId, actual: present ? 'present' : 'absent' });
      if (!present) diagnostics.push(diagnoseMissingMember(reqId, evidence, authorityIndex));
    }
  }
  if (entry.expectedMaxSources !== undefined) {
    checks.push({ name: 'maxSources', pass: evidence.sources.length <= entry.expectedMaxSources, expected: `<= ${entry.expectedMaxSources}`, actual: evidence.sources.length });
  }
  if (entry.mustNotContainMemoryRecord) {
    const hasMemory = sourceIds.some((id) => /^AI-MEM-/.test(id)) || evidence.matchedCapabilities.some((m) => /^AI-MEM-/.test(m.id));
    checks.push({ name: 'noMemoryRecord', pass: !hasMemory, expected: 'no AI-MEM-#### present', actual: hasMemory ? 'present' : 'absent' });
  }
  // Part 5 Phase 5.3 (Decision 5) — observes the real sources[] entry's own
  // role/evidenceQualification fields (lib/knowledgeHistoricalContext.js
  // appends these, never reimplemented here) rather than a second admission
  // algorithm, same "harness independence" discipline as every other check
  // in this function.
  if (entry.requiredHistoricalRole) {
    const src = evidence.sources.find((s) => s.id === entry.requiredHistoricalRole.id);
    checks.push({ name: `historicalRole:${entry.requiredHistoricalRole.id}`, pass: !!src && src.role === entry.requiredHistoricalRole.expectedRole, expected: entry.requiredHistoricalRole.expectedRole, actual: src ? src.role : 'absent' });
  }
  if (entry.requiredEvidenceQualificationSubstring) {
    const src = evidence.sources.find((s) => s.id === entry.requiredEvidenceQualificationSubstring.id);
    const actual = src ? src.evidenceQualification : undefined;
    const pass = !!actual && actual.includes(entry.requiredEvidenceQualificationSubstring.substring);
    checks.push({ name: `evidenceQualification:${entry.requiredEvidenceQualificationSubstring.id}`, pass, expected: `contains "${entry.requiredEvidenceQualificationSubstring.substring}"`, actual: actual || 'absent' });
  }
  // Part 5 Phase 5.3 Decision C materiality safety closure (Product Owner
  // directive) — unanchored Architecture/Memory historical context is
  // deliberately never attached to the real public answer object anymore
  // (retrieved != material != admitted; no existing deterministic signal
  // reliably distinguishes materiality from mere strong, unique retrieval —
  // see DEC-020's own Post-Decision Evolution entry for the full empirical
  // account). `expectedPublicUnanchoredAbsent` asserts this structural
  // withdrawal directly against the real answer object.
  if (entry.expectedPublicUnanchoredAbsent) {
    const present = Object.prototype.hasOwnProperty.call(answer, 'unanchoredHistoricalContext');
    checks.push({ name: 'publicUnanchoredAbsent', pass: !present, expected: 'unanchoredHistoricalContext key absent from the real public answer', actual: present ? 'present' : 'absent' });
  }
  // The following three checks observe the DIAGNOSTIC seam
  // (explainHistoricalContext(), unchanged, never consulted by
  // answerQuestion() itself) rather than the real answer object — this is
  // the only place withheld candidates remain inspectable/testable, exactly
  // as intended. Computed lazily, only when an entry actually declares one
  // of these fields, to avoid needless extra work for the other ~40 entries.
  if (entry.requiredDiagnosticUnanchoredMemberIds || entry.forbiddenDiagnosticUnanchoredMemberIds || entry.requiredDiagnosticUnanchoredRole) {
    const diag = explainHistoricalContext(entry.question, ctx);
    const diagIds = diag.unanchored ? diag.unanchored.candidates.map((c) => c.id) : [];
    for (const reqId of entry.requiredDiagnosticUnanchoredMemberIds || []) {
      checks.push({ name: `requiredDiagnosticUnanchored:${reqId}`, pass: diagIds.includes(reqId), expected: reqId, actual: diagIds.includes(reqId) ? 'present' : 'absent' });
    }
    for (const forbiddenId of entry.forbiddenDiagnosticUnanchoredMemberIds || []) {
      checks.push({ name: `forbiddenDiagnosticUnanchored:${forbiddenId}`, pass: !diagIds.includes(forbiddenId), expected: 'not present', actual: diagIds.includes(forbiddenId) ? 'present' : 'absent' });
    }
    if (entry.requiredDiagnosticUnanchoredRole) {
      const cand = diag.unanchored ? diag.unanchored.candidates.find((c) => c.id === entry.requiredDiagnosticUnanchoredRole.id) : null;
      checks.push({ name: `diagnosticUnanchoredRole:${entry.requiredDiagnosticUnanchoredRole.id}`, pass: !!cand && cand.role === entry.requiredDiagnosticUnanchoredRole.expectedRole, expected: entry.requiredDiagnosticUnanchoredRole.expectedRole, actual: cand ? cand.role : 'absent' });
    }
  }
  if (entry.expectedConfidenceRange) {
    const [min, max] = entry.expectedConfidenceRange;
    checks.push({ name: 'confidenceRange', pass: answer.confidence >= min && answer.confidence <= max, expected: entry.expectedConfidenceRange, actual: answer.confidence });
  }

  const meetsTargetExpectation = checks.length > 0 ? checks.every((c) => c.pass) : null;

  return {
    id: entry.id, targetPhase: entry.targetPhase, decisionRef: entry.decisionRef, auditRef: entry.auditRef,
    status: entry.status, category: entry.category, question: entry.question,
    checks, meetsTargetExpectation, diagnostics, evidence,
  };
}

// Classifies each V3 result against what its own declared `status` predicts,
// flagging anomalies rather than silently accepting them — a 'control' that
// fails today, or a 'known-baseline-failure' that unexpectedly already
// passes, both need a human look before Phase 4.1 can close (see this
// phase's own baseline-gate procedure: "prove deterministic... document the
// baseline").
function summarizeHardenedResults(results) {
  const byStatus = { control: [], 'known-baseline-failure': [], 'schema-placeholder': [] };
  const anomalies = [];
  for (const r of results) {
    (byStatus[r.status] || (byStatus[r.status] = [])).push(r);
    if (r.status === 'control' && r.meetsTargetExpectation === false) {
      anomalies.push({ id: r.id, kind: 'CONTROL_FAILING', note: 'A control case (expected to already pass today) is failing — investigate before closing Phase 4.1.' });
    }
    if (r.status === 'known-baseline-failure' && r.meetsTargetExpectation === true) {
      anomalies.push({ id: r.id, kind: 'BASELINE_ALREADY_PASSES', note: 'A known-baseline-failure case unexpectedly already meets its target expectation today — either already fixed by a prior pass, or the assertion needs re-checking.' });
    }
  }
  return {
    total: results.length,
    controlCount: byStatus.control.length,
    controlsPassing: byStatus.control.filter((r) => r.meetsTargetExpectation === true).length,
    knownBaselineFailureCount: byStatus['known-baseline-failure'].length,
    knownBaselineFailuresConfirmedFailing: byStatus['known-baseline-failure'].filter((r) => r.meetsTargetExpectation === false).length,
    schemaPlaceholderCount: byStatus['schema-placeholder'].length,
    anomalies,
  };
}

// Phase 4.1's own baseline-gate procedure: run the EXISTING V1+V2 corpus
// through the UNCHANGED evaluateOne() (proving this phase's additions
// regressed nothing), run the NEW regression-family corpus through the
// hardened evaluator, and write one consolidated baseline snapshot that
// every later phase's classifyRun() (knowledgeEvalClassification.js) will
// be compared against.
function runHardenedEval({ outPath } = {}) {
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);
  const authorityIndex = built.authorityIndex;

  const v1Results = CORPUS.map((e) => evaluateOne(e, ctx));
  const v2Results = CORPUS_V2.map((e) => evaluateOne(e, ctx));
  const v3Results = REGRESSION_CORPUS_V3.map((e) => evaluateOneHardened(e, ctx, authorityIndex));
  const v3Summary = summarizeHardenedResults(v3Results);

  const v1Summary = { total: v1Results.length, pass: v1Results.filter((r) => r.pass).length, knownMiss: v1Results.filter((r) => !r.pass && r.knownLimitation).length, unexplained: v1Results.filter((r) => !r.pass && !r.knownLimitation).length };
  const v2Summary = { total: v2Results.length, pass: v2Results.filter((r) => r.pass).length, knownMiss: v2Results.filter((r) => !r.pass && r.knownLimitation).length, unexplained: v2Results.filter((r) => !r.pass && !r.knownLimitation).length };

  const baseline = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    note: 'Part 3 Phase 4.1 (Decision 7) frozen baseline — every later phase\'s changed results get classified (Improvement/Acceptable change/Regression/Unexplained change/Unchanged, see knowledgeEvalClassification.js) against THIS snapshot.',
    v1: v1Summary,
    v2: v2Summary,
    v3: v3Summary,
    v1Cases: v1Results.map((r) => ({ id: r.id, pass: r.pass, knownLimitation: r.knownLimitation, actualStatus: r.actualStatus, actualMatchQuality: r.actualMatchQuality, actualPrimaryMatches: r.actualPrimaryMatches, actualSources: r.actualSources })),
    v2Cases: v2Results.map((r) => ({ id: r.id, pass: r.pass, knownLimitation: r.knownLimitation, actualStatus: r.actualStatus, actualMatchQuality: r.actualMatchQuality, actualPrimaryMatches: r.actualPrimaryMatches, actualSources: r.actualSources })),
    v3Cases: v3Results.map((r) => ({ id: r.id, targetPhase: r.targetPhase, status: r.status, category: r.category, meetsTargetExpectation: r.meetsTargetExpectation, checks: r.checks, diagnostics: r.diagnostics, evidence: r.evidence })),
  };

  const resolvedOutPath = outPath || path.join(GENERATED_ROOT, 'knowledge-eval-hardened-baseline.json');
  fs.mkdirSync(path.dirname(resolvedOutPath), { recursive: true });
  fs.writeFileSync(resolvedOutPath, stableStringify(baseline));

  return { v1Results, v2Results, v3Results, v1Summary, v2Summary, v3Summary, baseline, outPath: resolvedOutPath };
}

module.exports = { runEval, runEvalV2, evaluateOne, renderTable, evaluateOneHardened, runHardenedEval, summarizeHardenedResults };
