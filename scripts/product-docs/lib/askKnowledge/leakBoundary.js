'use strict';
// Ask AutoIngest — Stage 2 deterministic knowledge/tool foundation, Section
// 8 (internal-reference resolution) + Section 20 (leak-safety boundary).
// Productionized, corpus-audited design, from the Checkpoint 9-14 lineage
// (sanitizeTechnicalDetail originated in knowledgeAccessC9.js; the
// resolve-before-redact wrapper and fence/orphan-punctuation repairs are
// Checkpoint 14 Phase 2-4 findings, verified here against real corpus text,
// not invented for this promotion).
//
// PRINCIPLE (Section 8): internal identifiers (AI-FEAT-###, AI-WF-###,
// KM-###, DEC-###, BUG-###, PM-###, AI-MEM-###, file paths, bare function
// calls, backtick-quoted code) may be necessary for deterministic joins
// inside this module tree, but must never reach MODEL-SAFE/PRESENTATION-
// SAFE output. `resolveThenSanitize` is the single point every operator-
// facing text field in this module tree passes through: RESOLVE an
// internal AI-FEAT-###/AI-WF-### reference to its human-readable title
// first (a real fact, not redaction), THEN strip everything that cannot be
// resolved to a human-readable referent (a genuine internal-only detail).

const { findAllByFeatureId } = require('../knowledgeModel/index');

// --- sanitizeTechnicalDetail (Checkpoint 9 origin) --------------------------
//
// Forensic origin (preserved from the original): 34 of 66 Knowledge Model
// records' own `technicalDetail` field contains raw source file paths,
// line-number ranges, and bare function-call references directly in prose
// -- a real corpus content-boundary gap, not a model hallucination. Leak
// prevention sits at this tool layer (information architecture first),
// never by relying on a downstream consumer to notice and withhold it.
function sanitizeTechnicalDetail(text) {
  if (!text) return text;
  let t = String(text);
  t = t.replace(/\b(?:services|main|renderer|test|docs)\/[\w./-]+\.(?:js|json|md)(?::[\d,-]+)?\b/g, '[internal reference removed]');
  t = t.replace(/\b[a-zA-Z_][A-Za-z0-9_]*\(\)/g, '[internal reference removed]');
  t = t.replace(/\b[a-z][a-zA-Z]*:[a-zA-Z][a-zA-Z0-9]*\b/g, '[internal reference removed]');
  t = t.replace(/`[a-zA-Z_][A-Za-z0-9_]*`/g, '[internal reference removed]');
  // Governance/decision ids (DEC-021, BUG-###, etc.) also turn up in
  // ordinary `limitations` prose, not only technicalDetail -- the same
  // redaction applies to every operator-facing dimension uniformly (see
  // read.js), not selectively.
  t = t.replace(/\b(?:KM|AI-FEAT|AI-WF|AI-MEM|AI-DEC|AI-BUG|AI-RM|DEC|BUG|PM)-[A-Za-z0-9-]+\b/g, '[internal reference removed]');
  t = t.replace(/\(\s*(?:\[internal reference removed\][\s,.;]*)+\)/g, '');
  t = t.replace(/(\[internal reference removed\][,.;]?\s*){2,}/g, '[internal implementation detail omitted] ');
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;)])/g, '$1').trim();
  return t;
}

// --- resolveThenSanitize (Checkpoint 14 Phase 2-4) --------------------------
//
// General runtime counterpart to reshapeRegistry.js's build-time
// resolve-before-redact principle, applied here to hand-authored text
// (relationship notes, Decision-linked facts) that build-time redaction
// never touches. Resolves a backtick-or-bare AI-FEAT-###/AI-WF-### token to
// its title FIRST (never destructive -- a title is exactly what a model-safe
// caller needs); everything else backtick-quoted, and any KM-###/DEC-###/
// BUG-###/PM-### id, is left for sanitizeTechnicalDetail's catch-all.
function titleForFeatureId(id) {
  const records = findAllByFeatureId(id);
  return (records[0] && records[0].title) || null;
}

const RUNTIME_FEATURE_REF_RE = /`?(AI-FEAT-\d+|AI-WF-\d+)`?/g;

// A markdown triple-backtick fenced code block (e.g. a shell command) must
// be stripped whole, BEFORE any single-backtick pairing runs -- its 3+3
// backtick delimiters otherwise mis-pair against unrelated single-backtick
// spans elsewhere in the same text (corpus-wide finding, AI-FEAT-006/
// AI-FEAT-057).
const FENCED_CODE_BLOCK_RE = /```[\s\S]*?```/g;
// A dangling/unterminated fence (a trailing run of 3+ backticks with no
// matching close -- a source data-quality issue, not caused by the regex
// above) must never reach operator-facing text either.
const DANGLING_FENCE_MARKER_RE = /`{3,}/g;
// Final catch-all: any backtick span still standing after feature-id
// resolution is, by construction, internal (a code identifier, a
// multi-token expression, a leading-digit token like a commit hash that
// sanitizeTechnicalDetail's own narrower `` `[a-zA-Z_][A-Za-z0-9_]*` ``
// pattern does not catch).
const ANY_REMAINING_BACKTICK_SPAN_RE = /`[^`]+`/g;

function resolveThenSanitize(text) {
  if (typeof text !== 'string' || !text) return text;
  const noFences = text.replace(FENCED_CODE_BLOCK_RE, '[internal reference removed]')
    .replace(DANGLING_FENCE_MARKER_RE, '');
  const resolved = noFences.replace(RUNTIME_FEATURE_REF_RE, (whole, id) => {
    const title = titleForFeatureId(id);
    if (title) return title;
    return whole.startsWith('`') ? whole : '[internal reference removed]';
  });
  const sanitized = sanitizeTechnicalDetail(resolved);
  const finalPass = sanitized.replace(ANY_REMAINING_BACKTICK_SPAN_RE, '[internal reference removed]');
  // Re-run the same cleanup rules sanitizeTechnicalDetail applies, since
  // the pass above can introduce fresh instances of exactly what those
  // rules exist to tidy (orphaned parens, consecutive markers).
  const cleaned = finalPass
    .replace(/\(\s*(?:\[internal reference removed\][\s,.;]*)+\)/g, '')
    .replace(/(\[internal reference removed\][,.;]?\s*){2,}/g, '[internal implementation detail omitted] ')
    .replace(/\s{2,}/g, ' ').replace(/\s+([,.;)])/g, '$1').trim();
  // Final safety net: any backtick character still present at this point
  // could not be matched as part of a valid pair -- by definition either
  // truncated source data or markdown noise, never a live reference.
  return cleaned.replace(/`/g, '').replace(/\s{2,}/g, ' ').trim();
}

// --- Structural handle-leak detection (Section 13's own leak requirement) --
//
// A handle string ("H3") never collides with any real internal id shape
// (AI-FEAT-###/AI-WF-###/KM-###/DEC-###/BUG-###/PM-###/AI-MEM-###) by
// construction. This lets a corpus/output audit detect an accidental
// internal-id leak structurally, without needing to enumerate every real id.
const INTERNAL_ID_LEAK_RE = /\b(?:KM|AI-FEAT|AI-WF|AI-MEM|AI-DEC|AI-BUG|AI-RM|DEC|BUG|PM)-[A-Za-z0-9-]+\b/;

// True when `text` still contains a raw, unresolved internal identifier or
// a leftover backtick span -- i.e. resolveThenSanitize's own leak-boundary
// contract was violated somewhere upstream. Used by validators.js (Section
// 21) and the corpus audit (Section 22), never by the tool operations
// themselves (which always call resolveThenSanitize proactively, not
// reactively).
function containsUnresolvedInternalReference(text) {
  if (typeof text !== 'string' || !text) return false;
  return INTERNAL_ID_LEAK_RE.test(text) || /`/.test(text);
}

module.exports = {
  sanitizeTechnicalDetail, resolveThenSanitize, titleForFeatureId,
  containsUnresolvedInternalReference, INTERNAL_ID_LEAK_RE,
};
