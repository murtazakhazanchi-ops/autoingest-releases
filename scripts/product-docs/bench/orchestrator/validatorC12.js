'use strict';

// ASK AUTOINGEST — CHECKPOINT 12: QWEN3.5-4B FINAL QUALIFICATION.
// EXPERIMENTAL.
//
// Reuses validatorC11.js's checks unmodified (structural leak, capability
// grounding, invalid-handle-derived-conclusion, process narration --
// deliberately NOT expanded with the "Let me try a different search"
// phrase found this checkpoint, per the explicit instruction not to grow
// the narration phrase dictionary; see engineC12.js's header for the
// structural investigation and its honest, disclosed conclusion).
//
// ONE new check, `checkUngroundedIdentityClaim`, directly answering Phase
// 1/2's brief: "when the user asks the assistant to IDENTIFY or NAME an
// AutoIngest-specific concept, the requested name itself is an
// AutoIngest product fact and therefore must be grounded." This is
// deliberately NOT a classifier of the user's QUESTION wording (no regex
// for "what are those two things called", no special-casing of any
// feature) -- it is a check on the ASSISTANT'S OWN ANSWER: does every
// bolded, name-shaped claim in the final text actually appear somewhere
// in the AutoIngest knowledge genuinely retrieved this conversation?
//
// Evidence this was built from (Checkpoint 12's own forensic trace of
// every Checkpoint-11 regeneration event, not assumed): the two known
// fabrications ("pushing"/"pulling" for Transfer Export/Import,
// "drives"/"drivesets" for the same underlying question) were both
// presented in **bold**, both in direct answer to an indirect
// identification question, and NEITHER string appears anywhere in the
// real Knowledge Base content for the actual correct records. This same
// check would fire identically for a fabricated report name, workflow
// name, or technical-component name -- the mechanism does not know or
// care what the true answer should have been, only whether the claimed
// name is traceable to real retrieved evidence.

const {
  checkStructuralLeak, checkInvalidHandleConclusion, checkProcessNarration,
  checkCapabilityGrounding, containProtocolArtifacts, detectStructuralLeak,
} = require('./validatorC11');

// Generic UI/action labels that legitimately get bolded without being a
// product NAME claim -- these are real, short, imperative-style words the
// Knowledge Base itself uses for on-screen buttons/choices (confirmed by
// direct corpus read: "Skip / Import All / Cancel" appears verbatim in
// several operatorWorkflow/actions dimensions). A generic, fixed,
// short exclusion list of common English words/short verbs -- not a
// per-feature exclusion, not tuned to any specific failure case.
const GENERIC_BOLD_TERMS = new Set([
  'skip', 'cancel', 'import all', 'yes', 'no', 'ok', 'okay', 'update backup',
  'resume', 'retry', 'continue', 'confirm', 'apply', 'save', 'done', 'close',
]);

function normalizeForMatch(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Checkpoint 12 refinement, found necessary during Phase 8 dev testing:
// generic domain words (report, reporting, feature, system, workflow...)
// trivially substring-match almost any retrieved text about ANY subject,
// letting a fabricated multi-word name earn false "partial credit" purely
// because it shares one common word with genuine content (e.g. a
// fabricated "Completeness Report" partially matching real "Completeness
// Checklist" purely via the word "report" inside "reporting", present in
// nearly every sentence about a reporting feature). Mirrors the same
// established pattern this codebase already uses in
// lib/candidateRecall.js's own GENERIC_RECALL_WORDS -- a fixed, generic,
// not-tuned-to-any-feature exclusion list.
const GENERIC_MATCH_WORDS = new Set([
  'report', 'reporting', 'reports', 'feature', 'features', 'system', 'systems',
  'workflow', 'workflows', 'process', 'processes', 'data', 'file', 'files',
  'information', 'operation', 'operations', 'archive', 'archives', 'event',
  'events', 'import', 'imports', 'export', 'exports', 'check', 'checks', 'audit',
]);

// Checkpoint 12, Phase 1/2. Extracts every **bolded** span in the final
// text and checks it against the text of every tool result seen so far
// this conversation (titles, purposes, and all dimension text actually
// retrieved) -- a pure content-provenance check, not a truth-checker and
// not a wording classifier of the operator's question.
function checkUngroundedIdentityClaim({ finalText, toolCalls, sessionToolLog }) {
  const text = String(finalText || '');
  const boldSpans = [...text.matchAll(/\*\*([^*]{2,60})\*\*/g)].map((m) => m[1].trim());

  // Checkpoint 12 refinement, found necessary during this checkpoint's own
  // Phase 8 dev testing (MULTI04: "the four surfaces are: Consistency
  // Report, Completeness Report, Integrity Report, and Availability
  // Report" -- three of those four names are fabricated, and NONE of the
  // four were bolded, evading the bold-only check entirely). A general,
  // structural signal for an enumerated-list identity claim: 3+ Title-
  // Case multi-word phrases joined by commas/"and", regardless of
  // markdown formatting. This is a SHAPE of the assistant's own answer
  // (a list of named things), not a classifier of any specific feature
  // list or question wording -- it applies identically to a list of 3,
  // 4, or 10 items about any subject.
  const listPattern = /(?:[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)+)(?:,\s*(?:[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)+)){2,}(?:,?\s*and\s+(?:[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)+))?/g;
  const listSpans = [];
  for (const m of text.matchAll(listPattern)) {
    const items = m[0].split(/,\s*(?:and\s+)?|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
    listSpans.push(...items);
  }

  const allSpans = [...boldSpans, ...listSpans];
  if (!allSpans.length) return null;

  const allCalls = [...(sessionToolLog || []), ...(toolCalls || [])];
  const retrievedText = normalizeForMatch(allCalls.map((c) => {
    try { return JSON.stringify(c.result || {}); } catch { return ''; }
  }).join(' '));

  for (const span of allSpans) {
    const norm = normalizeForMatch(span);
    if (norm.length < 3) continue;
    if (GENERIC_BOLD_TERMS.has(norm)) continue;
    if (retrievedText.includes(norm)) continue; // exact/substring match -- grounded

    // Partial credit for genuine multi-word paraphrase: if this is a 2+
    // word claim and at least half its DISTINCTIVE (4+ char, non-generic)
    // words appear in the retrieved text, treat it as grounded -- avoids
    // false-positiving on the model's own natural paraphrasing of a real,
    // retrieved title/phrase. Generic domain words (GENERIC_MATCH_WORDS)
    // are excluded from both the numerator and denominator here -- found
    // necessary this checkpoint because a word like "report" trivially
    // substring-matches almost any real text about a reporting-adjacent
    // subject, giving false credit to a fabricated name that merely shares
    // one common word with something real (e.g. fabricated "Completeness
    // Report" against real "Completeness Checklist" + "reporting").
    const words = norm.split(' ').filter((w) => w.length >= 4 && !GENERIC_MATCH_WORDS.has(w));
    if (words.length >= 2) {
      const matchedWords = words.filter((w) => retrievedText.includes(w));
      if (matchedWords.length >= Math.ceil(words.length / 2)) continue;
    }

    return {
      severity: 'HARD_SAFETY',
      code: 'ungrounded-identity-claim',
      detail: `Answer names "${span}" in bold as if it were a specific AutoIngest term, but this does not appear anywhere in the AutoIngest knowledge actually retrieved this conversation.`,
    };
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
  checkUngroundedIdentityClaim, checkInvalidHandleConclusion, checkProcessNarration,
  containProtocolArtifacts, detectStructuralLeak,
};
