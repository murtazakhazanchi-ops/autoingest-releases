'use strict';

// ASK AUTOINGEST — CHECKPOINT 14: ONE-BRAIN ARCHITECTURE CLOSURE
// QUALIFICATION. EXPERIMENTAL, ISOLATED PROTOTYPE. PRODUCT OWNER-
// AUTHORIZED NARROW CLOSURE FOLLOW-UP TO CHECKPOINT 13's HOLD.
//
// Reuses every validatorC13.js check unmodified (structural leak,
// capability grounding, ungrounded-identity-claim, contradicted-
// relationship-assertion, invalid-handle-derived conclusion, process
// narration, soft signals). ONE new check, `checkResidualCodeSpanLeak`.
//
// Phase 4's corpus-wide audit found the shared, frozen validator.js's
// STRUCTURAL_LEAK_PATTERNS (internal-record-id, source-file-path,
// bare-file-reference, function-call-reference, ipc-reference) does not
// include a general "any backtick-quoted span" or "commit-hash-shaped
// token" shape -- the exact gap knowledgeAccessC14.js's resolveThenSanitize
// was just fixed to close AT THE DATA LAYER (corpus-wide, 522/522
// (feature, dimension) pairs verified zero leaks). This adds the SAME
// general shape as a defense-in-depth BACKSTOP on the model's actual final
// answer text, catching it if some future/untested knowledge path ever
// re-introduces a raw span the data-layer fix didn't anticipate -- it does
// not replace the data-layer fix, and is not specific to any one feature,
// decision, or prior failure id. validator.js itself (shared across every
// checkpoint since C9) is left untouched, per the freeze requirement --
// this is a new, additive check local to C14 only.

const {
  checkStructuralLeak, checkInvalidHandleConclusion, checkProcessNarration,
  checkCapabilityGrounding, checkUngroundedIdentityClaim, checkContradictedRelationshipAssertion,
  containProtocolArtifacts, detectStructuralLeak,
} = require('./validatorC13');

// General shapes only -- never a specific id, name, or prior failure's
// literal text. A backtick-wrapped span of any content is always internal
// markdown/code syntax, never legitimate conversational prose (the system
// prompt already forbids the model from writing ids/handles/file names/
// function names to the operator at all). A bare commit-hash-shaped token
// (7-40 lowercase hex characters as its own word) is the same general
// shape found leaking in DEC-017's raw text during Phase 4's audit.
const RESIDUAL_LEAK_PATTERNS = [
  { code: 'residual-backtick-span', re: /`[^`]+`/ },
  { code: 'residual-commit-hash', re: /\b[0-9a-f]{7,40}\b/i },
];

function checkResidualCodeSpanLeak({ finalText }) {
  const text = String(finalText || '');
  for (const p of RESIDUAL_LEAK_PATTERNS) {
    const m = p.re.exec(text);
    if (m) {
      return {
        severity: 'HARD_SAFETY',
        code: p.code,
        detail: `Final answer contains a residual internal-detail shape (${p.code}): "${m[0]}". This shape must never reach the operator regardless of what tool result produced it.`,
      };
    }
  }
  return null;
}

// Phase 7 -- generic repetition protection. Forensic finding: Phase 6's
// tool-loop circuit breaker (engineC14.js) measurably shortened RB27's
// repeated-tool-call spam (verified: 3 deduped repeats -> 1), but the
// SMOKE_RB27 re-test still showed the model free-generating a long run of
// near-identical paragraphs in its own final narrative pass, independent of
// any further tool call -- a genuine model-level text-degeneracy failure
// mode, not something a tool-call cap alone can bound. This is the
// SEPARATE, structural-similarity backstop Phase 7 asks for: it detects the
// SHAPE of degenerate repetition (two segments of the answer that are
// near-duplicates of each other), never a specific phrase ("let me check",
// "to be sure", etc. do not appear anywhere in this file) -- and wiring it
// into validateFinalAnswer as HARD_SAFETY reuses the EXISTING regeneration
// mechanism (engineC14.js's regenerateWithoutLeak), which already prompts
// again with NO tools available at all, so a caught repetition loop cannot
// simply re-enter the tool-calling cycle on retry.
function normalizeForSimilarity(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordOverlapSimilarity(a, b) {
  const wa = a.split(' ').filter(Boolean);
  const wb = b.split(' ').filter(Boolean);
  if (!wa.length || !wb.length) return 0;
  const setA = new Set(wa);
  const setB = new Set(wb);
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  return shared / Math.max(setA.size, setB.size);
}

// Deliberately conservative, to avoid flagging legitimate repetition (a
// short name repeated for clarity across otherwise-different paragraphs,
// numbered steps that share structure but differ in content, the same
// feature discussed in two genuinely different contexts): a segment must
// carry real content (>= 6 words) before it is compared at all, and two
// segments must be NEAR-DUPLICATES (>= 80% shared vocabulary), not merely
// topically related, before this fires.
const MIN_SEGMENT_WORDS = 6;
const SIMILARITY_THRESHOLD = 0.8;

function findNearDuplicateSegments(segments) {
  const normalized = segments.map(normalizeForSimilarity);
  for (let i = 0; i < normalized.length; i++) {
    const wordsI = normalized[i].split(' ').filter(Boolean);
    if (wordsI.length < MIN_SEGMENT_WORDS) continue;
    for (let j = i + 1; j < normalized.length; j++) {
      const wordsJ = normalized[j].split(' ').filter(Boolean);
      if (wordsJ.length < MIN_SEGMENT_WORDS) continue;
      const sim = wordOverlapSimilarity(normalized[i], normalized[j]);
      if (sim >= SIMILARITY_THRESHOLD) return { a: segments[i], b: segments[j], similarity: sim };
    }
  }
  return null;
}

function checkStructuralRepetition({ finalText }) {
  const text = String(finalText || '');
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let dup = paragraphs.length >= 2 ? findNearDuplicateSegments(paragraphs) : null;
  let unit = 'paragraph';
  if (!dup) {
    // Fallback for a degenerate loop that repeats without blank-line
    // breaks between repeats -- same conservative threshold, sentence-
    // level segments instead of paragraph-level.
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length >= 2) {
      dup = findNearDuplicateSegments(sentences);
      unit = 'sentence';
    }
  }
  if (!dup) return null;
  return {
    severity: 'HARD_SAFETY',
    code: 'structural-repetition-loop',
    detail: `Final answer repeats near-identical content across two different ${unit}s (word-overlap similarity ${dup.similarity.toFixed(2)}) -- a structural repetition-loop shape, not a legitimate restatement.`,
  };
}

function validateFinalAnswer({ finalText, toolCalls, sessionToolLog }) {
  const findings = [];
  const leak = checkStructuralLeak({ finalText, toolCalls });
  if (leak) findings.push(leak);
  const residual = checkResidualCodeSpanLeak({ finalText });
  if (residual) findings.push(residual);
  const repetition = checkStructuralRepetition({ finalText });
  if (repetition) findings.push(repetition);
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
  const ok = !findings.some((f) => f.severity === 'HARD_SAFETY');
  return { ok, findings };
}

module.exports = {
  validateFinalAnswer, checkStructuralLeak, checkResidualCodeSpanLeak, checkStructuralRepetition,
  checkCapabilityGrounding, checkUngroundedIdentityClaim, checkContradictedRelationshipAssertion,
  checkInvalidHandleConclusion, checkProcessNarration,
  containProtocolArtifacts, detectStructuralLeak,
};
