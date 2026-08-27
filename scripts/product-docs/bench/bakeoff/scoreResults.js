'use strict';

// ASK AUTOINGEST — CONVERSATIONAL MODEL BAKE-OFF, programmatic scorer.
// Benchmark-only. Reads the raw per-model JSON files main/askAutoIngestModelBakeOff.js
// produces and scores every case against acceptanceSet.js's own `expect`
// block -- deterministic, mechanical checks only (status correctness,
// clarification correctness, raw-ID/technical-identifier leakage,
// hallucinated-status contradiction, topic-change correctness). Qualitative
// dimensions (naturalness, fluency) are not scored here -- see the
// Product Owner report's own manual/blind-read notes for those.
//
// Run with: node scripts/product-docs/bench/bakeoff/scoreResults.js <resultsDir>

const fs = require('fs');
const path = require('path');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { buildEvidencePackage } = require('../../lib/askSynthesis/evidencePackage');
const { ID_SHAPE_RE } = require('../../lib/askSynthesis/safetyValidation');
const { CASES } = require('./acceptanceSet');

// Always score against the CURRENT acceptanceSet.js expectations, never a
// snapshot baked into an older results file -- a stored `expect` block
// reflects whatever the acceptance set said at RUN time, which can drift
// out of date if the set is corrected afterward (as happened this
// checkpoint: three cases' expectations were found wrong and fixed after
// the first run already completed).
const EXPECT_BY_ID = new Map(CASES.map((c) => [c.id, c.expect]));

const RESULTS_DIR = process.argv[2];
if (!RESULTS_DIR) {
  console.error('Usage: node scoreResults.js <resultsDir>');
  process.exit(1);
}

const { built } = build.assemble();
const ctx = buildEngineContext(built);

// Technical-atom cache keyed by bare question text -- computed fresh per
// unique turn message, independent of which model produced the answer, so
// every model is checked against the exact same "what would leak" set.
const technicalAtomCache = new Map();
function technicalAtomsFor(question) {
  if (technicalAtomCache.has(question)) return technicalAtomCache.get(question);
  let atoms = [];
  try {
    const pkg = buildEvidencePackage(question, ctx);
    atoms = (pkg.evidenceAtoms || []).filter((a) => a.role === 'TECHNICAL').map((a) => a.text);
  } catch { /* leave empty */ }
  technicalAtomCache.set(question, atoms);
  return atoms;
}

function scanText(text, technicalAtoms) {
  if (typeof text !== 'string' || !text) return { idLeak: false, technicalLeak: null };
  const idMatches = text.match(ID_SHAPE_RE);
  const leakedTechnical = technicalAtoms.find((atom) => atom.length > 2 && text.includes(atom));
  return { idLeak: !!(idMatches && idMatches.length), technicalLeak: leakedTechnical || null };
}

function scoreCase(kase) {
  const expect = EXPECT_BY_ID.get(kase.id) || kase.expect || {};
  const turnScores = [];
  let anyIdLeak = false;
  let anyTechnicalLeak = false;
  let anyClarificationMismatch = false;
  let synthesisAttemptedCount = 0;
  let synthesisAppliedCount = 0;
  let lastFinal = null;

  for (let i = 0; i < kase.results.length; i++) {
    const turn = kase.results[i];
    const expectedClarify = Array.isArray(expect.expectClarificationAtTurn) ? expect.expectClarificationAtTurn[i] : null;
    const actualIsClarification = turn.kind === 'clarification';
    let clarificationOk = true;
    if (expectedClarify === true) clarificationOk = actualIsClarification;
    if (expectedClarify === false) clarificationOk = !actualIsClarification;
    if (!clarificationOk) anyClarificationMismatch = true;

    // TECHNICAL-category cases (e.g. "Where does QMZ store its sequencing
    // state?") deliberately supply technical evidence atoms to the model
    // because the operator's own question asked for them -- using that
    // evidence there is CORRECT behavior, not a leak. Scored as a leak
    // only for every other category, where technical evidence was never
    // offered at all (evidenceSerializer.js's own includeTechnical gate).
    const technicalAtoms = kase.category === 'TECHNICAL' ? [] : technicalAtomsFor(kase.turns[i]);
    const textToScan = turn.finalAnswer ? turn.finalAnswer.directAnswer : turn.clarificationText;
    const scan = scanText(textToScan, technicalAtoms);
    if (scan.idLeak) anyIdLeak = true;
    if (scan.technicalLeak) anyTechnicalLeak = true;

    if (turn.finalAnswer && turn.finalAnswer.synthesis) {
      synthesisAttemptedCount += turn.finalAnswer.synthesis.reason !== 'weak-retrieval-none' ? 1 : 0;
      if (turn.finalAnswer.synthesis.applied) synthesisAppliedCount += 1;
    }
    turnScores.push({ turnIndex: i, clarificationOk, idLeak: scan.idLeak, technicalLeak: scan.technicalLeak, error: turn.error });
  }

  // The LAST turn's own finalAnswer only -- NOT accumulated/carried across
  // turns. A stale earlier-turn value here would be exactly the class of
  // cross-turn contamination bug this checkpoint's own Defect 1 corrective
  // work exists to prevent; caught and fixed here before it could produce
  // a false "FAIL" against a case whose actual last turn is a
  // clarification, not a final answer.
  const lastTurn = kase.results[kase.results.length - 1];
  lastFinal = lastTurn ? lastTurn.finalAnswer : null;

  let statusOk = true;
  if (expect.status && expect.status !== 'ANY') {
    if (expect.status === 'ROADMAP') {
      statusOk = !!(lastFinal && lastFinal.classification === 'ROADMAP');
    } else if (expect.status === null) {
      statusOk = !lastFinal; // expected to end in clarification, not a final answer
    } else {
      statusOk = !!(lastFinal && lastFinal.capabilityStatus === expect.status);
    }
  } else if (expect.status === null) {
    statusOk = !lastFinal;
  }

  const hasError = kase.results.some((t) => t.error);
  const clarificationAllOk = turnScores.every((t) => t.clarificationOk);
  const pass = !hasError && statusOk && clarificationAllOk && !anyIdLeak && !anyTechnicalLeak;
  const partial = !pass && !hasError && !anyIdLeak && statusOk; // clarification timing off but otherwise sound, no hallucination

  return {
    id: kase.id, category: kase.category,
    verdict: pass ? 'PASS' : (partial ? 'PARTIAL' : 'FAIL'),
    statusOk, clarificationAllOk, anyIdLeak, anyTechnicalLeak, anyClarificationMismatch, hasError,
    synthesisAttemptedCount, synthesisAppliedCount,
    turnScores,
    finalDirectAnswerSnippet: lastFinal ? (lastFinal.directAnswer || '').slice(0, 200) : null,
  };
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function scoreModel(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const caseScores = data.cases.map(scoreCase);
  const allTurnMs = data.cases.flatMap((c) => c.results.map((t) => t.ms || 0));
  const totalTurns = allTurnMs.length;
  const totalMs = allTurnMs.reduce((s, ms) => s + ms, 0);
  // Multiple downloads/model runs shared this machine's CPU concurrently
  // during this benchmark -- a handful of turns show anomalous multi-
  // minute latency (resource contention, not real model slowness; the
  // TEXT for those turns is normal, coherent output). Median is reported
  // alongside mean specifically because of this -- see the Product Owner
  // report's own latency caveat.
  const medianMsPerTurn = Math.round(median(allTurnMs));
  const outlierTurns = allTurnMs.filter((ms) => ms > 60000).length;
  const pass = caseScores.filter((c) => c.verdict === 'PASS').length;
  const partial = caseScores.filter((c) => c.verdict === 'PARTIAL').length;
  const fail = caseScores.filter((c) => c.verdict === 'FAIL').length;
  const idLeaks = caseScores.filter((c) => c.anyIdLeak).length;
  const technicalLeaks = caseScores.filter((c) => c.anyTechnicalLeak).length;
  const acceptableRate = (pass + partial) / caseScores.length;

  return {
    candidate: data.candidate,
    loadMs: data.loadMs,
    totalCases: caseScores.length,
    totalTurns,
    totalMs,
    avgMsPerTurn: Math.round(totalMs / totalTurns),
    medianMsPerTurn,
    outlierTurns,
    pass, partial, fail,
    acceptableRate: Number((acceptableRate * 100).toFixed(1)),
    idLeaks, technicalLeaks,
    caseScores,
  };
}

const files = fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json') && f !== 'scored.json');
const summary = files.map((f) => scoreModel(path.join(RESULTS_DIR, f)));
summary.sort((a, b) => b.acceptableRate - a.acceptableRate);

fs.writeFileSync(path.join(RESULTS_DIR, 'scored.json'), JSON.stringify(summary, null, 2));

console.log('\n=== MODEL BAKE-OFF SCORE SUMMARY ===\n');
for (const s of summary) {
  console.log(`${s.candidate.label} (${s.candidate.id})`);
  console.log(`  cases: ${s.totalCases}  PASS=${s.pass}  PARTIAL=${s.partial}  FAIL=${s.fail}  acceptableRate=${s.acceptableRate}%`);
  console.log(`  idLeaks=${s.idLeaks}  technicalLeaks=${s.technicalLeaks}`);
  console.log(`  loadMs=${s.loadMs}  avgMsPerTurn=${s.avgMsPerTurn}  medianMsPerTurn=${s.medianMsPerTurn}  outlierTurns(>60s)=${s.outlierTurns}  totalMs=${s.totalMs}`);
  console.log('');
}
console.log(`Wrote ${path.join(RESULTS_DIR, 'scored.json')}`);
