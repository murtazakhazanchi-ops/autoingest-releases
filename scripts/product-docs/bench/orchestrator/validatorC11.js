'use strict';

// ASK AUTOINGEST — CHECKPOINT 11: GROUNDING DISCIPLINE. EXPERIMENTAL.
//
// Reuses validatorC10.js's Qwen-family protocol containment UNMODIFIED
// (the chat wrapper/model family is unchanged this checkpoint, so its real
// control-token vocabulary is still correct). Reuses every structural leak
// check unmodified too (handle-leak, internal-id-leak, literal-tool-call-
// syntax-leak, process-narration, invalid-handle-derived-conclusion).
//
// ONE check is corrected, per Checkpoint 11's own Phase 6/7 finding:
// checkCapabilityGrounding. Phase 7's regeneration forensics on the actual
// Checkpoint-10 run found that roughly half of the "ungrounded-capability-
// claim" HARD_SAFETY triggers that ended in an unrecovered fallback fired
// on turns where the model HAD genuinely consulted AutoIngest's knowledge
// -- via read_autoingest (or, less often, roadmap_status) -- but not via
// capability_status specifically, the only tool the old check accepted as
// proof of grounding (examples traced directly from the C10 run:
// generalization14's G14_multiturn_drift, "does it warn me?", read
// purpose/behavior/operatorWorkflow before answering; finalBlind25's
// F03_followup_why, a "why" explanation grounded via read_autoingest;
// finalBlindC7's G21_competing_records, a "what happens if..." behavioral
// question also grounded via read_autoingest -- all three flagged as
// ungrounded anyway, all three ended as neutral non-answers instead of the
// real, correct information the model had already retrieved).
//
// Per Checkpoint 11's Phase 6 framing exactly -- "was appropriate product
// knowledge obtained before making the claim... process, not semantic
// truth" -- the check below asks a broader but still purely mechanical
// question: was ANY of AutoIngest's three knowledge tools consulted this
// conversation, not specifically capability_status. This is a provenance
// check, not a truth-checker, and it is not benchmark-specific: it applies
// identically regardless of which tool, which subject, or which wording
// triggered the original claim.

const {
  checkStructuralLeak, checkInvalidHandleConclusion, checkProcessNarration,
  containProtocolArtifacts, detectStructuralLeak,
} = require('./validatorC10');

const CAPABILITY_CLAIM_RE = /\bAutoIngest\s+(?:can(?:not|'t)?|does(?:n'?t| not)?|supports?|is (?:able|not able|available|planned|not supported|not available)|has(?:n'?t| not)?\s+(?:the|a)\s+(?:capability|feature))\b|\b(?:is|are|was)\s+(?:not\s+)?(?:currently\s+)?(?:supported|available|planned|implemented)\s+(?:by|in|with)\s+AutoIngest\b/i;

// Checkpoint 11 correction: any of the three real AutoIngest-knowledge
// tools counts as provenance for a product claim -- all three read from
// the same trusted Knowledge Base; capability_status remains the required
// tool for the SYSTEM PROMPT's own instruction ("always call it before
// making that kind of claim"), so the model is still steered toward the
// authoritative source first. This check is the backstop, not the primary
// mechanism, and a backstop should not punish a claim that IS genuinely
// grounded, just grounded via a different one of the three legitimate
// tools.
const GROUNDING_TOOLS = new Set(['capability_status', 'read_autoingest', 'roadmap_status']);

function checkCapabilityGrounding({ finalText, sessionToolLog }) {
  const text = String(finalText || '');
  if (!CAPABILITY_CLAIM_RE.test(text)) return null;
  const everGrounded = (sessionToolLog || []).some((c) => GROUNDING_TOOLS.has(c.tool));
  if (everGrounded) return null;
  return { severity: 'HARD_SAFETY', code: 'ungrounded-capability-claim', detail: 'Answer makes an AutoIngest capability/support claim, but no AutoIngest knowledge tool (capability_status, read_autoingest, or roadmap_status) was ever called in this conversation.' };
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
  checkInvalidHandleConclusion, checkProcessNarration, containProtocolArtifacts,
  detectStructuralLeak,
};
