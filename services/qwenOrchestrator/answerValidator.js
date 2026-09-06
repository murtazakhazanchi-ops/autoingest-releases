'use strict';

// services/qwenOrchestrator/answerValidator.js — Ask AutoIngest Stage 4,
// Sections 21-25. A narrow, deterministic, mechanical final-answer
// boundary -- consolidated (not chained) from the qualified Checkpoint
// 9-14 bench validator lineage (validatorC9.js through validatorC14.js),
// which reached this exact set of checks through six rounds of forensic,
// evidenced refinement (see DEC-026's audit table for the full
// provenance). Every check here is PROMOTED, not reinvented; this file
// only reorganizes six chained checkpoint files into one production
// module, since a chain-of-checkpoints structure is right for preserving
// experimental history and wrong for shipped code.
//
// Per Section 25's own explicit boundary: this is NOT another AI, NOT a
// semantic correctness engine, and NOT a hand-coded answer authority. It
// checks MECHANICAL conditions only (does a raw internal id/handle/path
// appear in the text, does the text narrate its own tool use, does it
// repeat itself structurally, is a capability/relationship claim
// traceable to a real tool call this conversation). Truth itself comes
// from Qwen reasoning over the authoritative facts its tools returned --
// this module never judges whether a natural-language claim is TRUE.

// --- containProtocolArtifacts: Qwen-family control-token stripping -----
// Traced directly from node-llama-cpp 3.20.0's own installed
// QwenChatWrapper source (validatorC10.js's own header documents this;
// re-spot-checked this stage against the same installed version Stage 3
// qualified -- no version drift, still accurate). Covers both the
// "3"/Hermes-4 and "3.5" function-call token shapes, which genuinely
// differ, plus the shared thought/tool-response/ChatML structural tokens.
const THOUGHT_SEGMENT_RE = /<think>\n?[\s\S]*?\n?<\/think>/g;

const PROTOCOL_TOKEN_PATTERNS = [
  /<tool_call>\n?\{"name":\s*"/g,
  /"\}\n?<\/tool_call>/g,
  /<tool_call>\n?<function=/g,
  /<\/parameter>\n?<\/function>\n?<\/tool_call>/g,
  /<parameter=params>\n?/g,
  /<tool_response>\n?/g,
  /\n?<\/tool_response>/g,
  /<think>\n?/g,
  /\n?<\/think>/g,
  /<\|im_end\|>/g,
  /<\|im_start\|>user/g,
  /<\|im_start\|>assistant/g,
  /<\|im_start\|>/g,
  /<\|[a-zA-Z_][a-zA-Z0-9_]*\|>/g,
];

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
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: t, stripped };
}

// Reuses Stage 2's own leakBoundary.js pattern rather than a second,
// independently-maintained copy of the same regex -- one leak boundary,
// shared by the Knowledge Base's own tool outputs and this final-answer
// check (the two patterns were independently found to be byte-identical
// during this stage's own audit; importing removes the duplication).
const { INTERNAL_ID_LEAK_RE } = require('../../scripts/product-docs/lib/askKnowledge/leakBoundary');
const { detectPathologicalRepetition } = require('./repetitionDetector');

// --- checkStructuralLeak: internal ids, handles, paths, literal tool-call
// syntax reaching operator-facing text --------------------------------
const STRUCTURAL_LEAK_PATTERNS = [
  { code: 'internal-record-id', re: INTERNAL_ID_LEAK_RE },
  { code: 'source-file-path', re: /`?\b[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)+\.(?:js|json|jsx|ts|mjs|md)\b`?/ },
  { code: 'bare-file-reference', re: /`[a-zA-Z0-9_.-]+\.(?:js|json|jsx|ts|mjs|md)`/ },
  { code: 'function-call-reference', re: /`[a-zA-Z_][a-zA-Z0-9_]*\(\)`/ },
  { code: 'ipc-reference', re: /\bipcMain\.|`?ipcRenderer\.|`?window\.api\.[a-zA-Z]+/ },
  // A bare session handle ("H3") as its own word/token -- never matches
  // ordinary prose ("H1" alone, not "Chapter H1 review").
  { code: 'session-handle-leak', re: /(?<![A-Za-z0-9])H\d{1,4}(?![A-Za-z0-9])/ },
  { code: 'literal-tool-call-syntax', re: /\b(?:search_autoingest|read_autoingest|capability_status|roadmap_status|check_relationship)\s*[({]/ },
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

// General shapes only -- never a specific id/name/prior-failure text. A
// backtick-wrapped span is always internal markdown/code syntax, never
// legitimate conversational prose (the system prompt already forbids
// writing ids/handles/file names/function names). A bare commit-hash-
// shaped token (7-40 lowercase hex chars as its own word) is the same
// general shape found leaking in real Decision-record text during Stage
// 2's own corpus audit.
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

// --- checkCapabilityGrounding: a capability/support claim must trace to
// a real knowledge-tool call this conversation --------------------------
const CAPABILITY_CLAIM_RE = /\bAutoIngest\s+(?:can(?:not|'t)?|does(?:n'?t| not)?|supports?|is (?:able|not able|available|planned|not supported|not available)|has(?:n'?t| not)?\s+(?:the|a)\s+(?:capability|feature))\b|\b(?:is|are|was)\s+(?:not\s+)?(?:currently\s+)?(?:supported|available|planned|implemented)\s+(?:by|in|with)\s+AutoIngest\b/i;

// Any of the three knowledge-bearing tools counts as provenance for a
// capability claim -- all three read from the same trusted Knowledge
// Base. capability_status remains the system prompt's own required tool
// for making that specific KIND of claim; this check is the mechanical
// backstop, not the primary steering mechanism.
const GROUNDING_TOOLS = new Set(['capability_status', 'read_autoingest', 'roadmap_status']);

function checkCapabilityGrounding({ finalText, sessionToolLog }) {
  const text = String(finalText || '');
  if (!CAPABILITY_CLAIM_RE.test(text)) return null;
  const everGrounded = (sessionToolLog || []).some((c) => GROUNDING_TOOLS.has(c.tool));
  if (everGrounded) return null;
  return { severity: 'HARD_SAFETY', code: 'ungrounded-capability-claim', detail: 'Answer makes an AutoIngest capability/support claim, but no AutoIngest knowledge tool (capability_status, read_autoingest, or roadmap_status) was ever called in this conversation.' };
}

// --- checkUngroundedIdentityClaim: a named/bolded/listed AutoIngest term
// must be traceable to real retrieved evidence --------------------------
const GENERIC_BOLD_TERMS = new Set([
  'skip', 'cancel', 'import all', 'yes', 'no', 'ok', 'okay', 'update backup',
  'resume', 'retry', 'continue', 'confirm', 'apply', 'save', 'done', 'close',
]);
const GENERIC_MATCH_WORDS = new Set([
  'report', 'reporting', 'reports', 'feature', 'features', 'system', 'systems',
  'workflow', 'workflows', 'process', 'processes', 'data', 'file', 'files',
  'information', 'operation', 'operations', 'archive', 'archives', 'event',
  'events', 'import', 'imports', 'export', 'exports', 'check', 'checks', 'audit',
]);

function normalizeForMatch(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function checkUngroundedIdentityClaim({ finalText, toolCalls, sessionToolLog }) {
  const text = String(finalText || '');
  const boldSpans = [...text.matchAll(/\*\*([^*]{2,60})\*\*/g)].map((m) => m[1].trim());

  // A general, structural signal for an enumerated-list identity claim
  // (3+ Title-Case multi-word phrases joined by commas/"and"), regardless
  // of markdown formatting -- a fabricated list can evade a bold-only
  // check entirely if none of its items happen to be bolded.
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
    if (retrievedText.includes(norm)) continue;

    // Partial credit for genuine paraphrase: if at least half the claim's
    // distinctive (4+ char, non-generic) words appear in the retrieved
    // text, treat it as grounded -- avoids false-positiving on the
    // model's own natural paraphrasing of a real, retrieved phrase.
    const words = norm.split(' ').filter((w) => w.length >= 4 && !GENERIC_MATCH_WORDS.has(w));
    if (words.length >= 2) {
      const matchedWords = words.filter((w) => retrievedText.includes(w));
      if (matchedWords.length >= Math.ceil(words.length / 2)) continue;
    }

    return {
      severity: 'HARD_SAFETY',
      code: 'ungrounded-identity-claim',
      detail: `Answer names "${span}" as if it were a specific AutoIngest term, but this does not appear anywhere in the AutoIngest knowledge actually retrieved this conversation.`,
    };
  }
  return null;
}

// --- checkContradictedRelationshipAssertion -----------------------------
const NEGATION_CUES = [
  'no,', 'not the same', 'not', "n't", 'separate', 'distinct', 'different',
  'own window', 'own modal', 'own interface', 'no relationship', 'no connection',
  'not documented', 'not established', 'unrelated', 'independent', 'apart from',
  'as opposed to', 'rather than', 'instead of', 'unlike',
];

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
  if (hasNegation) return null;

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

// --- checkInvalidHandleConclusion ---------------------------------------
function checkInvalidHandleConclusion({ finalText, toolCalls }) {
  const hadProtocolError = (toolCalls || []).some((c) => c.result && c.result.error === 'invalid_handle');
  if (!hadProtocolError) return null;
  if (!CAPABILITY_CLAIM_RE.test(String(finalText || ''))) return null;
  const hadValidStatusThisTurn = (toolCalls || []).some((c) => c.tool === 'capability_status' && c.result && !c.result.error);
  if (hadValidStatusThisTurn) return null;
  return {
    severity: 'HARD_SAFETY', code: 'invalid-handle-derived-conclusion',
    detail: 'This turn hit an invalid-handle protocol error and the final text makes a capability claim without a valid capability_status call in the same turn -- the claim may be resting on the protocol error rather than real evidence.',
  };
}

// --- checkProcessNarration ------------------------------------------------
const NARRATION_LEAD_IN_RE = /(^|[.!?]\s+|\n)\s*(Based on|According to|Let me (?:check|search|look)|I(?:'| wi)ll (?:check|search|look)|I (?:found|checked|searched|called)|The (?:search|tool)s? (?:results?|says?|shows?)|To (?:confirm|get more information)|I need to (?:check|look|search)|I(?:'m| am) (?:unable to find|checking|searching)|Unfortunately,? (?:AutoIngest's? knowledge|I) (?:doesn'?t|does not|couldn'?t|could not) have)/i;

function checkProcessNarration({ finalText }) {
  const text = String(finalText || '').trim();
  if (!text) return null;
  if (NARRATION_LEAD_IN_RE.test(text)) {
    return { severity: 'HARD_SAFETY', code: 'process-narration', detail: 'Answer narrates internal search/tool-use process to the operator instead of just answering.' };
  }
  return null;
}

// --- checkStructuralRepetition: pathological repeated-content loop -----
// Deliberately conservative: a segment must carry real content (>= 6
// words) before comparison, and two segments must be near-duplicates
// (>= 80% shared vocabulary), not merely topically related.
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
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length >= 2) {
      dup = findNearDuplicateSegments(sentences);
      unit = 'sentence';
    }
  }
  if (dup) {
    return {
      severity: 'HARD_SAFETY',
      code: 'structural-repetition-loop',
      detail: `Final answer repeats near-identical content across two different ${unit}s (word-overlap similarity ${dup.similarity.toFixed(2)}) -- a structural repetition-loop shape, not a legitimate restatement.`,
    };
  }
  // Complementary structural patterns this stage's own audit found
  // pathological-repetition testing should also cover, alongside the
  // near-duplicate-segment shape above: an EXACT sentence repeated 3+
  // times, a cyclic A-B-C-A-B-C block, or a runaway repeated word n-gram
  // that never forms clean sentence boundaries at all (a model emitting
  // fragments with no terminal punctuation). All three are purely
  // structural, never a phrase blacklist.
  const pathological = detectPathologicalRepetition(text);
  if (pathological.pathological) {
    const kinds = pathological.findings.map((f) => f.type).join(', ');
    return {
      severity: 'HARD_SAFETY',
      code: 'structural-repetition-loop',
      detail: `Final answer shows a pathological repetition pattern (${kinds}) -- a structural loop shape, not a legitimate restatement.`,
    };
  }
  return null;
}

// --- checkEmptyAnswer ----------------------------------------------------
// Section 25's own explicit list of mechanical conditions opens with
// "empty answer" -- not covered by any of the promoted Checkpoint 14
// checks above (which all assume real text to inspect), so added here
// directly rather than left as a silent gap.
function checkEmptyAnswer({ finalText }) {
  if (String(finalText || '').trim()) return null;
  return { severity: 'HARD_SAFETY', code: 'empty-answer', detail: 'Final answer text is empty or whitespace-only.' };
}

function validateFinalAnswer({ finalText, toolCalls, sessionToolLog }) {
  const findings = [];
  const empty = checkEmptyAnswer({ finalText });
  if (empty) findings.push(empty);
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
  validateFinalAnswer, containProtocolArtifacts, checkEmptyAnswer,
  checkStructuralLeak, checkResidualCodeSpanLeak, checkStructuralRepetition,
  checkCapabilityGrounding, checkUngroundedIdentityClaim,
  checkContradictedRelationshipAssertion, checkInvalidHandleConclusion,
  checkProcessNarration,
};
