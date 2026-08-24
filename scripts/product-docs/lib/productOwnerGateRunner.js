'use strict';

// Phase C6.3 (Section N) — evaluator for lib/productOwnerAcceptanceGate.js.
// Deliberately separate from lib/retrievalEvalRunner.js (C6.1's generic
// corpus runner): this gate has three shapes retrievalEvalRunner.js does
// not model — 'ROADMAP' special-cased questions (no searchIndex record at
// all), knowledge-gap questions graded on capabilityStatus rather than a
// record id, and explicit forbiddenMemberIds independent of goldLabel.
// Reuses answerQuestion() directly — no second retrieval implementation.

const { answerQuestion, QUESTION_TYPES } = require('./knowledgeEngine');
const { isWithheld } = require('./retrievalEvalRunner');

function primaryIdOf(answer) {
  return answer.matchedCapabilities && answer.matchedCapabilities.length ? answer.matchedCapabilities[0].id : null;
}

function evaluatePOEntry(entry, ctx) {
  const answer = answerQuestion(entry.question, ctx);
  const primaryId = primaryIdOf(answer);

  let correct;
  let note = '';
  if (entry.specialCase === 'roadmap') {
    correct = answer.classification === QUESTION_TYPES.ROADMAP;
    note = correct ? 'ROADMAP-routed as expected' : `expected ROADMAP classification, got ${answer.classification}`;
  } else if (entry.specialCase === 'knowledge-gap') {
    correct = answer.capabilityStatus === 'PLANNED' || answer.capabilityStatus === 'NOT_SUPPORTED';
    note = correct ? `honest non-affirmative (${answer.capabilityStatus})` : `false-affirmative risk: capabilityStatus=${answer.capabilityStatus}`;
  } else if (entry.goldLabel === 'SHOULD_WITHHOLD') {
    correct = isWithheld(answer);
  } else {
    correct = !!(entry.allowedMemberIds && entry.allowedMemberIds.includes(primaryId));
  }
  const forbiddenHit = !!(entry.forbiddenMemberIds && entry.forbiddenMemberIds.includes(primaryId));
  if (forbiddenHit) correct = false;

  return {
    id: entry.id, question: entry.question, goldLabel: entry.goldLabel, allowedMemberIds: entry.allowedMemberIds || null,
    primaryId, classification: answer.classification, capabilityStatus: answer.capabilityStatus, matchQuality: answer.matchQuality,
    correct, forbiddenHit, note,
  };
}

function runProductOwnerGate(corpus, ctx) {
  const results = corpus.map((e) => evaluatePOEntry(e, ctx));
  const passing = results.filter((r) => r.correct);
  return {
    total: results.length,
    passing: passing.length,
    passRate: Math.round((1000 * passing.length) / results.length) / 10,
    failing: results.filter((r) => !r.correct).map((r) => r.id),
    results,
  };
}

module.exports = { runProductOwnerGate, evaluatePOEntry, primaryIdOf };
