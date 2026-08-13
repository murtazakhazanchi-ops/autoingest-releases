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
const { answerQuestion, buildEngineContext } = require('./knowledgeEngine');
const { CORPUS } = require('./knowledgeTestCorpus');
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
  const actualInstructionsExist = !!answer.guidance && answer.guidance !== 'AutoIngest supports this capability, but detailed operator instructions are not yet documented.';
  const instructionsMatch = actualInstructionsExist === entry.instructionsShouldExist;
  const acknowledgesGap = answer.matchQuality === 'weak' || answer.matchQuality === 'none' || !!answer.guidance;
  const gapAcknowledgementMatch = acknowledgesGap === entry.shouldAcknowledgeGap || entry.shouldAcknowledgeGap === false;

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

function runEval({ outPath } = {}) {
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);
  const results = CORPUS.map((entry) => evaluateOne(entry, ctx));

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

module.exports = { runEval, evaluateOne, renderTable };
