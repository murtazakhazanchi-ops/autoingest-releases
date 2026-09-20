'use strict';

// ASK AUTOINGEST — CHECKPOINT 9: validator additions. EXPERIMENTAL.
// validator.js (Checkpoint 6/7's frozen control) is required UNMODIFIED for
// protocol-artifact containment (containProtocolArtifacts -- Gemma4's real
// control-token vocabulary, unchanged, still correct for this checkpoint
// since the chat wrapper itself is unchanged). Everything else here is new
// or corrected, all disclosed:
//
//   1. Checkpoint 8 forensic finding, fixed: the old CAPABILITY_CLAIM_RE
//      required the literal word "AutoIngest" immediately BEFORE the claim
//      verb ("AutoIngest does not support X"). A real Checkpoint 8 failure
//      (frozen19, conversation G) used the phrasing "...is not currently
//      supported by AutoIngest" -- AutoIngest AFTER the verb -- and the old
//      regex missed it entirely. Broadened below to match either order.
//
//   2. NEW structural check: a raw session handle (e.g. "H3") reaching the
//      operator's final text. Handles are internal-only by design (Phase 3
//      of the checkpoint brief) -- exactly the same class of leak as a raw
//      AI-FEAT-### id, just a different, new shape this checkpoint
//      introduces, so it needs its own detector; the old id-shape pattern
//      in validator.js cannot see it.
//
//   3. NEW structural check: an invalid-handle-derived conclusion. Phase 5's
//      mandatory invariant -- "search failure is not capability truth" --
//      is enforced here mechanically: if THIS turn's tool calls include an
//      invalid_handle/no-record protocol error and the final text also
//      contains a capability-negative claim, that is flagged HARD_SAFETY
//      regardless of whether get_capability_status was separately called,
//      because the claim may be causally downstream of the protocol error
//      even when a real capability_status call also happened elsewhere in
//      the turn (defense in depth, not a replacement for check #4).
//
//   4. NEW: process-narration detection. Checkpoint 8's dominant, measured
//      defect (self-narration of the model's own tool-use process --
//      "Based on the search results...", "Let me check...", "I called...")
//      is a Phase 6 violation ("internal actions are not operator
//      messages"). ACTION itself remains 100% structural in this
//      architecture (node-llama-cpp's native function-calling -- a tool
//      call is metadata, never part of the response text, by construction;
//      verified from source, not assumed). Narration is a DIFFERENT
//      problem: the model's own free-text FINAL answer describing its
//      process, which structural function-calling separation cannot
//      prevent by itself. This is necessarily phrase-pattern detection
//      (there is no structural signal for "the model is describing what it
//      just did" the way there is for an actual tool call) -- disclosed as
//      such, general sentence-start lead-ins, not tied to any specific
//      benchmark question, and it feeds the SAME existing one-shot
//      regeneration backstop engineC9.js reuses from engine.js, not a new
//      mechanism.

const { detectStructuralLeak, containProtocolArtifacts } = require('./validator');

const STRUCTURAL_LEAK_PATTERNS = [
  { code: 'internal-record-id', re: /\b(?:KM|AI-FEAT|AI-WF|AI-MEM|AI-DEC|AI-BUG|AI-RM|DEC|BUG|PM)-[A-Za-z0-9-]+\b/ },
  // Forensic finding, direct testing this checkpoint: a real corpus
  // `limitations` field contains a raw `.md` doc path
  // (docs/archive-operations-layer.md) alongside a governance-record id --
  // the old validator.js pattern only covered code-file extensions
  // (js/json/jsx/ts/mjs), never markdown, so this gap is closed here as
  // defense-in-depth on top of the source-level sanitizer fix in
  // knowledgeAccessC9.js.
  { code: 'source-file-path', re: /`?\b[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)+\.(?:js|json|jsx|ts|mjs|md)\b`?/ },
  { code: 'bare-file-reference', re: /`[a-zA-Z0-9_.-]+\.(?:js|json|jsx|ts|mjs|md)`/ },
  { code: 'function-call-reference', re: /`[a-zA-Z_][a-zA-Z0-9_]*\(\)`/ },
  { code: 'ipc-reference', re: /\bipcMain\.|`?ipcRenderer\.|`?window\.api\.[a-zA-Z]+/ },
  // New this checkpoint: a bare session handle in operator-facing text.
  // Requires the exact "H<digits>" shape as its own word/token so it can
  // never match ordinary prose ("H1" alone, not "Chapter H1 review").
  { code: 'session-handle-leak', re: /(?<![A-Za-z0-9])H\d{1,4}(?![A-Za-z0-9])/ },
  // Forensic finding, direct testing this checkpoint: Gemma sometimes
  // emits a tool-call's SYNTAX as literal free text instead of a real
  // structured function call -- zero real tool calls that turn, a fragment
  // resembling its own internal call representation reaching the final
  // answer instead. Observed in TWO different literal shapes across
  // different tools -- "roadmap_status()" (paren-call form) and
  // "search_autoingest{query: \"...\"}" (the curly-brace form closer to
  // Gemma4ChatWrapper's own real "call:{...}" internal syntax, traced in
  // validator.js's header -- consistent with a partially-failed native
  // function-call attempt leaking its argument fragment as visible text
  // once containProtocolArtifacts strips the surrounding control tokens).
  // Caught here as a general pattern covering BOTH shapes, for any of the
  // four tool names -- a real, general leak class, not a fix for one
  // observed string.
  { code: 'literal-tool-call-syntax', re: /\b(?:search_autoingest|read_autoingest|capability_status|roadmap_status)\s*[({]/ },
];

function checkStructuralLeak({ finalText, toolCalls }) {
  const t = String(finalText || '');
  for (const p of STRUCTURAL_LEAK_PATTERNS) {
    const m = p.re.exec(t);
    if (!m) continue;
    if (p.code === 'internal-record-id' || p.code === 'session-handle-leak' || p.code === 'literal-tool-call-syntax') {
      const label = p.code === 'session-handle-leak' ? 'session handle' : p.code === 'literal-tool-call-syntax' ? 'literal tool-call syntax' : 'internal identifier';
      return { severity: 'HARD_SAFETY', code: p.code === 'session-handle-leak' ? 'handle-leak' : p.code === 'literal-tool-call-syntax' ? 'literal-tool-call-leak' : 'internal-id-leak', detail: `Answer text contains a raw ${label}: ${m[0]}` };
    }
    const technicalCalls = (toolCalls || []).filter((c) => c.tool === 'read_autoingest' && Array.isArray(c.args && c.args.dimensions) && c.args.dimensions.includes('technicalDetail'));
    const retrievedText = technicalCalls.map((c) => (c.result && c.result.dimensions && c.result.dimensions.technicalDetail) || '').join(' ');
    const bareMatch = m[0].replace(/`/g, '');
    if (technicalCalls.length && retrievedText.includes(bareMatch)) return null;
    return {
      severity: 'HARD_SAFETY', code: 'implementation-leak',
      detail: `Answer text contains an implementation reference (${p.code}): ${m[0]}${technicalCalls.length ? ' -- requested but not found in the retrieved (sanitized) technicalDetail text' : ' -- technicalDetail was never requested this turn'}.`,
    };
  }
  return null;
}

// Fix #1: matches "AutoIngest" either immediately before OR immediately
// after the claim verb, within the same short clause -- catches the exact
// phrasing shape Checkpoint 8's frozen19/G_followup_after_answer missed
// ("...is not currently supported by AutoIngest").
const CAPABILITY_CLAIM_RE = /\bAutoIngest\s+(?:can(?:not|'t)?|does(?:n'?t| not)?|supports?|is (?:able|not able|available|planned|not supported|not available)|has(?:n'?t| not)?\s+(?:the|a)\s+(?:capability|feature))\b|\b(?:is|are|was)\s+(?:not\s+)?(?:currently\s+)?(?:supported|available|planned|implemented)\s+(?:by|in|with)\s+AutoIngest\b/i;

function checkCapabilityGrounding({ finalText, sessionToolLog }) {
  const text = String(finalText || '');
  if (!CAPABILITY_CLAIM_RE.test(text)) return null;
  const everCalled = (sessionToolLog || []).some((c) => c.tool === 'capability_status');
  if (everCalled) return null;
  return { severity: 'HARD_SAFETY', code: 'ungrounded-capability-claim', detail: 'Answer makes an AutoIngest capability/support claim, but capability_status was never called anywhere in this conversation.' };
}

// New check #3: invalid-handle-derived conclusion. Defense in depth beyond
// #2's capability-grounding check -- catches the case where the model DID
// call capability_status validly (so #2 passes) for one subject, but the
// actual claim in the text is about a DIFFERENT subject it only reached via
// an invalid-handle protocol error this same turn (e.g. it guessed a stale
// handle from an earlier, unrelated topic).
function checkInvalidHandleConclusion({ finalText, toolCalls }) {
  const hadProtocolError = (toolCalls || []).some((c) => c.result && c.result.error === 'invalid_handle');
  if (!hadProtocolError) return null;
  if (!CAPABILITY_CLAIM_RE.test(String(finalText || ''))) return null;
  const hadValidStatusThisTurn = (toolCalls || []).some((c) => c.tool === 'capability_status' && c.result && !c.result.error);
  if (hadValidStatusThisTurn) return null; // a real, valid status call this same turn covers the claim
  return {
    severity: 'HARD_SAFETY', code: 'invalid-handle-derived-conclusion',
    detail: 'This turn hit an invalid-handle protocol error and the final text makes a capability claim without a valid capability_status call in the same turn -- the claim may be resting on the protocol error rather than real evidence.',
  };
}

// New check #4: process-narration. General, sentence-start lead-ins only
// (never mid-sentence, to avoid false-positiving on legitimate content that
// happens to contain "the search" as an ordinary noun phrase, e.g.
// "AutoIngest's Global Search feature"). Disclosed as phrase-pattern
// detection, unlike the ACTION/text separation itself, which remains fully
// structural -- see this file's header.
const NARRATION_LEAD_IN_RE = /(^|[.!?]\s+|\n)\s*(Based on|According to|Let me (?:check|search|look)|I(?:'| wi)ll (?:check|search|look)|I (?:found|checked|searched|called)|The (?:search|tool)s? (?:results?|says?|shows?)|To (?:confirm|get more information)|I need to (?:check|look|search)|I(?:'m| am) (?:unable to find|checking|searching)|Unfortunately,? (?:AutoIngest's? knowledge|I) (?:doesn'?t|does not|couldn'?t|could not) have)/i;

function checkProcessNarration({ finalText }) {
  const text = String(finalText || '').trim();
  if (!text) return null;
  if (NARRATION_LEAD_IN_RE.test(text)) {
    return { severity: 'HARD_SAFETY', code: 'process-narration', detail: 'Answer narrates internal search/tool-use process to the operator instead of just answering (Phase 6: internal actions are not operator messages).' };
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
