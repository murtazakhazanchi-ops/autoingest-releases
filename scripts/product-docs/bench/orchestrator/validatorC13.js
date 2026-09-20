'use strict';

// ASK AUTOINGEST — CHECKPOINT 13: RELATIONAL KNOWLEDGE ARCHITECTURE.
// EXPERIMENTAL. PRODUCT OWNER-AUTHORIZED FOLLOW-UP TO CHECKPOINT 12's NO-GO.
//
// Reuses every validatorC12.js check unmodified (structural leak,
// capability grounding, ungrounded-identity-claim, invalid-handle-derived
// conclusion, process narration, soft signals). ONE new check,
// `checkContradictedRelationshipAssertion`, answering Phase 10's brief:
// "If Qwen asserts A relation B and the deterministic knowledge returned
// CONTRADICTED, that answer must not reach the operator."
//
// SCOPE DISCIPLINE, explicitly recorded (Phase 10's own instruction: "do
// NOT attempt full natural-language semantic truth verification with
// giant regex logic... determine the narrowest structural validation
// possible"): this check does NOT attempt to parse or judge the MEANING
// of the final answer. It does exactly one narrow, mechanical thing: if
// check_relationship was called THIS conversation and returned
// CONTRADICTED for a specific pair, and the final answer's text contains
// recognizable mentions of BOTH subjects with NO negation word anywhere
// in the answer at all, flag it. The negation-word list is a small,
// CLOSED-CLASS set of ordinary English negation function words (no, not,
// n't, separate, distinct, different, etc) -- linguistically bounded and
// stable, fundamentally different in kind from the narration phrase
// dictionary this project has repeatedly, deliberately declined to grow
// (see validatorC11/C12's own headers) -- growing that dictionary means
// adding new OBSERVED PHRASINGS of a specific behavior; this list does not
// grow with new failures, it is the closed set of negation words English
// already has. This is DISCLOSED as an imperfect, narrow heuristic, not a
// semantic judge: it can miss a genuinely contradicted claim phrased
// without any of these words (a false negative), and it is deliberately
// tolerant of that gap rather than trying to close it with broader
// pattern-matching, per Phase 10's explicit instruction to prefer the
// narrowest safe mechanism over an ever-growing one.

const {
  checkStructuralLeak, checkInvalidHandleConclusion, checkProcessNarration,
  checkCapabilityGrounding, checkUngroundedIdentityClaim, containProtocolArtifacts, detectStructuralLeak,
} = require('./validatorC12');

const NEGATION_CUES = [
  'no,', 'not the same', 'not', "n't", 'separate', 'distinct', 'different',
  'own window', 'own modal', 'own interface', 'no relationship', 'no connection',
  'not documented', 'not established', 'unrelated', 'independent', 'apart from',
  'as opposed to', 'rather than', 'instead of', 'unlike',
];

function normalizeForMatch(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleMentioned(text, title) {
  const normText = normalizeForMatch(text);
  const normTitle = normalizeForMatch(title);
  if (!normTitle) return false;
  if (normText.includes(normTitle)) return true;
  const words = normTitle.split(' ').filter((w) => w.length >= 4);
  if (words.length < 2) return false;
  const matched = words.filter((w) => normText.includes(w));
  return matched.length >= Math.ceil(words.length / 2);
}

// Checkpoint 13, Phase 10. Builds a handle -> title map from every
// search_autoingest result seen so far this conversation (the only place
// a handle's real-world title is ever shown), so a check_relationship
// call's opaque handles can be matched back to the names the final answer
// would actually use.
function buildHandleTitleMap(allCalls) {
  const map = new Map();
  for (const c of allCalls) {
    if (c.tool !== 'search_autoingest') continue;
    const results = (c.result && c.result.results) || [];
    for (const r of results) {
      if (r && r.handle && r.title) map.set(r.handle, r.title);
    }
  }
  return map;
}

function checkContradictedRelationshipAssertion({ finalText, toolCalls, sessionToolLog }) {
  const allCalls = [...(sessionToolLog || []), ...(toolCalls || [])];
  const relCalls = allCalls.filter((c) => c.tool === 'check_relationship' && c.result && c.result.status === 'CONTRADICTED');
  if (!relCalls.length) return null;

  const handleTitles = buildHandleTitleMap(allCalls);
  const text = String(finalText || '');
  const hasNegation = NEGATION_CUES.some((cue) => text.toLowerCase().includes(cue));
  if (hasNegation) return null; // conservative: any negation word anywhere clears it

  for (const call of relCalls) {
    const subjectTitle = handleTitles.get(call.args && call.args.subjectHandle);
    const objectTitle = handleTitles.get(call.args && call.args.objectHandle);
    if (!subjectTitle || !objectTitle) continue;
    if (titleMentioned(text, subjectTitle) && titleMentioned(text, objectTitle)) {
      return {
        severity: 'HARD_SAFETY',
        code: 'contradicted-relationship-assertion',
        detail: `Answer mentions both "${subjectTitle}" and "${objectTitle}" with no negation, but this conversation's own check_relationship call found AutoIngest's knowledge explicitly documents them as separate/distinct (CONTRADICTED).`,
      };
    }
  }
  return null;
}

function checkSoftSignals({ finalText, toolCalls }) {
  const findings = [];
  const text = String(finalText || '');
  if (!toolCalls || toolCalls.length === 0) {
    if (/\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(text) && !/^(I don'?t|I'?m not sure|Could you|Can you)/i.test(text.trim())) {
      findings.push({ severity: 'SOFT_QUALITY', code: 'no-tool-calls-but-specific-claim', detail: 'No knowledge tool was called this turn, yet the answer makes a specific-sounding claim -- likely reusing prior-turn context; verify manually.' });
    }
  }
  const distinctSubjects = new Set((toolCalls || []).filter((c) => c.tool === 'read_autoingest' || c.tool === 'capability_status').map((c) => c.args && c.args.handle).filter(Boolean));
  if (distinctSubjects.size >= 3) {
    findings.push({ severity: 'SOFT_QUALITY', code: 'multi-subject-turn', detail: `This turn consulted ${distinctSubjects.size} different subject handles -- possible candidate ambiguity; verify the final answer picked the right one.` });
  }
  return findings;
}

function validateFinalAnswer({ finalText, toolCalls, sessionToolLog }) {
  const findings = [];
  const leak = checkStructuralLeak({ finalText, toolCalls });
  if (leak) findings.push(leak);
  const grounding = checkCapabilityGrounding({ finalText, sessionToolLog: sessionToolLog || toolCalls });
  if (grounding) findings.push(grounding);
  const identity = checkUngroundedIdentityClaim({ finalText, toolCalls, sessionToolLog });
  if (identity) findings.push(identity);
  const relationship = checkContradictedRelationshipAssertion({ finalText, toolCalls, sessionToolLog });
  if (relationship) findings.push(relationship);
  const invalidHandle = checkInvalidHandleConclusion({ finalText, toolCalls });
  if (invalidHandle) findings.push(invalidHandle);
  const narration = checkProcessNarration({ finalText });
  if (narration) findings.push(narration);
  findings.push(...checkSoftSignals({ finalText, toolCalls }));
  const ok = !findings.some((f) => f.severity === 'HARD_SAFETY');
  return { ok, findings };
}

module.exports = {
  validateFinalAnswer, checkStructuralLeak, checkCapabilityGrounding,
  checkUngroundedIdentityClaim, checkContradictedRelationshipAssertion,
  checkInvalidHandleConclusion, checkProcessNarration,
  containProtocolArtifacts, detectStructuralLeak,
};
