'use strict';

// ASK AUTOINGEST — CHECKPOINT 6, PHASE 2: validator redesign. EXPERIMENTAL.
//
// Checkpoint 5's validator produced many false-positive CRITICAL flags (6 of
// 7 manually-reviewed "capability-contradiction" flags across the three
// acceptance runs turned out to be false positives on manual review, plus
// one caught and fixed pre-freeze). Root cause: a keyword affirm/negate
// heuristic cannot tell "AutoIngest doesn't support X" (a real denial) apart
// from "it doesn't start the import yet" or "that doesn't specifically
// mention Y" (ordinary negation with nothing to do with capability
// existence). Per this checkpoint's explicit instruction, keyword-negation
// heuristics are RETIRED from deciding factual contradiction.
//
// Findings are now split into two kinds:
//
//   HARD_SAFETY -- genuine factual/safety violations. These block the
//     answer (trigger engine.js's one-shot regeneration, and count as
//     zero-tolerance violations in acceptance scoring). Two checks only,
//     both STRUCTURAL (pattern-shape, not vocabulary) or PROCESS-based (was
//     the authoritative tool actually consulted), never sentiment-based:
//       (a) structural internal-id / implementation-reference leak
//       (b) an AutoIngest capability/support claim made without
//           get_capability_status ever having been called THIS CONVERSATION
//           ("grounded" means the authoritative tool was consulted, not
//           that the prose is proven to echo its exact wording -- see this
//           file's own header for why a stronger, text-agreement check was
//           deliberately not attempted here).
//
//   SOFT_QUALITY -- logged for the report's qualitative review, never
//     blocks: possible multi-subject ambiguity, no-tool-calls-with-a-
//     specific-sounding-claim. These are signals for a human reviewer, not
//     an automated gate.
//
// Explicitly NOT attempted here (disclosed, not hidden): automated
// "wrong-feature" detection. Telling whether a genuinely well-formed,
// well-grounded answer is nonetheless about the WRONG feature requires
// actually understanding what the operator meant -- exactly the kind of
// judgment this checkpoint's Phase 8 reserves for manual transcript review,
// not a regex.

// Structural leak patterns -- shapes, not a vocabulary blacklist. Ordinary
// words like "archive", "metadata", "NAS", "transfer" can never match any
// of these; they require a specific corpus-id format, a file-path shape
// with an extension, or a backtick-wrapped function-call shape.
const STRUCTURAL_LEAK_PATTERNS = [
  { code: 'internal-record-id', re: /\b(?:KM|AI-FEAT|AI-WF|AI-MEM|AI-DEC|AI-BUG|AI-RM|DEC|BUG|PM)-[A-Za-z0-9-]+\b/ },
  { code: 'source-file-path', re: /`?\b[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)+\.(?:js|json|jsx|ts|mjs)\b`?/ },
  { code: 'bare-file-reference', re: /`[a-zA-Z0-9_.-]+\.(?:js|json|jsx|ts|mjs)`/ },
  { code: 'function-call-reference', re: /`[a-zA-Z_][a-zA-Z0-9_]*\(\)`/ },
  { code: 'ipc-reference', re: /\bipcMain\.|`?ipcRenderer\.|`?window\.api\.[a-zA-Z]+/ },
];

// Exported so engine.js's post-generation regeneration backstop (Phase 1A)
// can reuse the exact same structural detector the validator itself uses --
// one definition of "leak," not two that could drift apart.
function detectStructuralLeak(text) {
  const t = String(text || '');
  for (const p of STRUCTURAL_LEAK_PATTERNS) {
    const m = p.re.exec(t);
    if (m) return { code: p.code, match: m[0] };
  }
  return null;
}

// Checkpoint 7, Phase 7: model/runtime protocol-token containment.
//
// Traced, not guessed: node_modules/node-llama-cpp/dist/chatWrappers/
// Gemma4ChatWrapper.js's own `settings.functions`/`settings.segments`
// object defines the EXACT control-token strings this specific chat
// wrapper uses to delimit a function-call segment, a function-result
// segment, and a "thought" segment:
//   call:    prefix "<|tool_call>call:"   suffix "}<tool_call|>"
//   result:  prefix "<tool_response>response:"  suffix "}</tool_response>"
//   thought: prefix "<|channel>thought\n"  suffix "<channel|>"
// These are marked `SpecialTokensText` -- the chat wrapper's own parser is
// supposed to recognize and consume them as control markers, never as
// literal output text. F23's observed leak (`<tool_call|>` reaching the
// operator, missing its leading `}`) is consistent with the model emitting
// a malformed/partial attempt at one of these boundary sequences that the
// wrapper's segment matcher did not fully recognize and consume, leaving a
// fragment in the plain-text stream returned as `responseText`.
//
// This is a STRUCTURAL boundary at the model/runtime -> presentation
// interface, built from the wrapper's own real vocabulary (not a single
// string replacement of the one observed fragment) -- it strips whole and
// partial forms of every one of these six sequences, plus the specific
// bare tokens node-llama-cpp's own model-load warnings named for this GGUF
// (`<|tool_response>`, `</s>`, `<eos>`) in case any of those ever leak the
// same way. A final, narrow generic pattern also catches any other
// Gemma-style `<|word>`/`<word|>` control-token SHAPE, since the wrapper's
// vocabulary could gain more segment types in a future model/library
// update this file wouldn't otherwise know about -- deliberately narrow
// (requires the `<|`/`|>` pipe-adjacent-to-angle-bracket shape unique to
// this token family) so it cannot match ordinary operator-facing prose,
// code the operator might paste, or emoticons.
const PROTOCOL_TOKEN_PATTERNS = [
  /<\|tool_call>call:/g,
  /\}?<tool_call\|>/g,
  /<tool_response>response:/g,
  /\}?<\/tool_response>/g,
  /<\|channel>thought\n?/g,
  /<channel\|>/g,
  /<\|tool_response>/g,
  /<\/s>/g,
  /<eos>/g,
  /<\|[a-zA-Z_][a-zA-Z0-9_]*>/g, // generic "<|word>"-shaped control token
  /(?<!\w)[a-zA-Z_][a-zA-Z0-9_]*\|>/g, // generic "word|>"-shaped control token
];

// A "thought" segment's DELIMITERS are stripped by PROTOCOL_TOKEN_PATTERNS
// above, but its CONTENT is internal reasoning that must never reach the
// operator either -- removed as a whole unit (open tag through close tag,
// non-greedy) before the individual-token pass runs, so a genuine leaked
// segment doesn't just lose its markers and leave the reasoning text
// behind in the open.
const THOUGHT_SEGMENT_RE = /<\|channel>thought\n?[\s\S]*?<channel\|>/g;

function containProtocolArtifacts(text) {
  let t = String(text || '');
  let stripped = false;
  if (THOUGHT_SEGMENT_RE.test(t)) stripped = true;
  THOUGHT_SEGMENT_RE.lastIndex = 0;
  t = t.replace(THOUGHT_SEGMENT_RE, '');
  for (const re of PROTOCOL_TOKEN_PATTERNS) {
    if (re.test(t)) stripped = true;
    re.lastIndex = 0;
    t = t.replace(re, '');
  }
  // Collapse any double-spacing/blank-line artifacts left behind by removal.
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: t, stripped };
}

// Capability/support claims -- deliberately requires the literal subject
// "AutoIngest" immediately before the claim verb, which is what actually
// distinguishes "AutoIngest does not support X" (a real capability denial)
// from "it doesn't start the import yet" or "that doesn't specifically
// mention Y" (ordinary negation about something else entirely) -- a
// structural/subject requirement, not a sentiment judgment.
const CAPABILITY_CLAIM_RE = /\bAutoIngest\s+(?:can(?:not|'t)?|does(?:n'?t| not)?|supports?|is (?:able|not able|available|planned|not supported|not available)|has(?:n'?t| not)?\s+(?:the|a)\s+(?:capability|feature))\b/i;

function checkStructuralLeak({ finalText, toolCalls }) {
  const leak = detectStructuralLeak(finalText);
  if (!leak) return null;
  if (leak.code === 'internal-record-id') {
    return { severity: 'HARD_SAFETY', code: 'internal-id-leak', detail: `Answer text contains a raw internal/record identifier: ${leak.match}` };
  }
  // file-path / function-call / IPC leaks: legitimate ONLY if
  // technicalDetail was explicitly requested this turn AND the exact
  // matched text appears in the retrieved technicalDetail content
  // (grounded disclosure, not invented) -- mirrors Checkpoint 5's own
  // exemption, now correctly filed under HARD_SAFETY rather than a
  // separate ad hoc severity.
  const technicalCalls = (toolCalls || []).filter((c) => c.tool === 'get_knowledge' && Array.isArray(c.args && c.args.dimensions) && c.args.dimensions.includes('technicalDetail'));
  const retrievedText = technicalCalls.map((c) => (c.result && c.result.dimensions && c.result.dimensions.technicalDetail) || '').join(' ');
  const bareMatch = leak.match.replace(/`/g, '');
  if (technicalCalls.length && retrievedText.includes(bareMatch)) return null; // legitimate, deliberate, grounded technical disclosure
  return {
    severity: 'HARD_SAFETY',
    code: 'implementation-leak',
    detail: `Answer text contains an implementation reference (${leak.code}): ${leak.match}${technicalCalls.length ? ' -- requested but not found in the retrieved technicalDetail text' : ' -- technicalDetail was never requested this turn'}.`,
  };
}

// `sessionToolLog` is CUMULATIVE across the whole conversation (passed in by
// engine.js), not just this turn -- a later turn legitimately answering
// from an EARLIER turn's get_capability_status call (e.g. reusing context
// with zero new tool calls, exactly the good behavior this architecture is
// supposed to produce) must not be flagged just because no tool ran THIS
// turn.
function checkCapabilityGrounding({ finalText, sessionToolLog }) {
  const text = String(finalText || '');
  if (!CAPABILITY_CLAIM_RE.test(text)) return null; // no capability/support claim at all this turn
  const everCalled = (sessionToolLog || []).some((c) => c.tool === 'get_capability_status');
  if (everCalled) return null;
  return { severity: 'HARD_SAFETY', code: 'ungrounded-capability-claim', detail: 'Answer makes an AutoIngest capability/support claim, but get_capability_status was never called anywhere in this conversation.' };
}

// Soft, informational only -- never blocks, never counts toward the
// zero-tolerance list. Surfaced for the report's qualitative review.
function checkSoftSignals({ finalText, toolCalls }) {
  const findings = [];
  const text = String(finalText || '');
  if (!toolCalls || toolCalls.length === 0) {
    if (/\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(text) && !/^(I don'?t|I'?m not sure|Could you|Can you)/i.test(text.trim())) {
      findings.push({ severity: 'SOFT_QUALITY', code: 'no-tool-calls-but-specific-claim', detail: 'No knowledge tool was called this turn, yet the answer makes a specific-sounding claim -- likely reusing prior-turn context; verify manually.' });
    }
  }
  const distinctSubjects = new Set((toolCalls || []).filter((c) => c.tool === 'get_knowledge' || c.tool === 'get_capability_status').map((c) => c.args && c.args.id).filter(Boolean));
  if (distinctSubjects.size >= 3) {
    findings.push({ severity: 'SOFT_QUALITY', code: 'multi-subject-turn', detail: `This turn consulted ${distinctSubjects.size} different subject ids -- possible candidate ambiguity; verify the final answer picked the right one.` });
  }
  return findings;
}

// Returns { ok, findings } -- `ok` is false only when a HARD_SAFETY finding
// is present. `findings` includes both HARD_SAFETY and SOFT_QUALITY items,
// each tagged with its own severity so callers can filter.
function validateFinalAnswer({ finalText, toolCalls, sessionToolLog }) {
  const findings = [];
  const leak = checkStructuralLeak({ finalText, toolCalls });
  if (leak) findings.push(leak);
  const grounding = checkCapabilityGrounding({ finalText, sessionToolLog: sessionToolLog || toolCalls });
  if (grounding) findings.push(grounding);
  findings.push(...checkSoftSignals({ finalText, toolCalls }));
  const ok = !findings.some((f) => f.severity === 'HARD_SAFETY');
  return { ok, findings };
}

module.exports = { validateFinalAnswer, detectStructuralLeak, checkStructuralLeak, checkCapabilityGrounding, containProtocolArtifacts };
