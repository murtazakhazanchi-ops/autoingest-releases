'use strict';

// Phase C6.5 — recall-only candidate-generation surface, deliberately
// separate from lib/searchIndex.js's `record.keywords` (the SCORING
// surface). Existence and rationale:
//
// C6.4's own forensic finding: 56.8% of wrong-primary cases across the
// C6.1/C6.2/C6.3/PO-22 corpora had ZERO matching concept cluster and no
// keyword-overlap candidate at all — the correct record never entered the
// candidate pool. C6.4 also found rich, canonical, evidence-cited
// vocabulary already parsed onto every Feature (`current_behavior`) and
// Workflow (`expectedResult`, `limitations`, `warnings`, `whereToGo`,
// `troubleshooting`) record that was never fed into retrieval at all.
//
// C6.4 tried feeding that text into `record.keywords` directly and found a
// real, measured, broad regression: `record.keywords.length` IS
// `surfaceSize`, the exact quantity lib/knowledgeSurfaceNormalization.js's
// keyword-surface-size damping divides by — inflating it changes how
// EVERY existing keyword-overlap match for that record (and, via
// corpus-wide collision, for OTHER unrelated questions) gets scored. That
// is a scoring-mechanism side effect, not a candidate-generation one, and
// C6.3/C6.4 both independently found broad scoring changes dangerous.
//
// This module exists to answer C6.5's own core question: can a record be
// ADMITTED to the candidate pool using this richer vocabulary WITHOUT
// touching `record.keywords`/`surfaceSize` at all? The answer implemented
// here: build a SEPARATE per-record token set (`recallSurfaceById`) from
// exactly the canonical, evidence-cited fields C6.4 identified, using the
// SAME already-proven `keywordsFrom()` tokenizer (identical stopword/
// evidence-marker guards, no new filtering logic) — but never merge it
// into `record.keywords`, never let it change `surfaceSize`, and never let
// it feed lib/query.js's `scoreRecord()` at all. It is consulted by
// exactly one seam: `searchCandidates()` in knowledgeEngine.js, as an
// ADDITIONAL, LAST-RESORT admission check for records the existing
// hint-injected `runQuery()` pool didn't already find — see that call
// site's own comment for the admission rule and its score, both reused
// from EXISTING codebase constants, not invented for this purpose.

const { keywordsFrom } = require('./textKeywords');

// FORENSIC FINDING (this checkpoint's own diagnostic run): a 2-distinct-
// token admission threshold, using keywordsFrom()'s own exact-string
// tokens unmodified, admits almost nothing in practice — e.g. "recovering
// metadata work if the app crashes" shares only 'metadata' with
// AI-FEAT-030's recall surface, which contains 'crash' but not 'crashes',
// purely ordinary English inflection, not a missing concept. A minimal,
// standard light-stem (same conservative shape C6.4 already evaluated and
// found SAFE when scoped narrowly — see that checkpoint's own report,
// Strategy C — but there applied broadly to intentConcepts.js's trigger
// matching, used by every concept cluster at real competitive scores,
// where it caused a small measured regression) is applied HERE ONLY: this
// module's own token comparison, feeding exclusively the fixed-score-10,
// below-CONFIDENCE_FLOOR admission channel that can never itself win
// primary selection. Scoped this narrowly, its only possible effect is
// whether a record appears in the candidate pool at all — never how any
// candidate is scored or ranked once present.
function lightStem(word) {
  if (word.length > 6 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith('ed')) return word.slice(0, -2);
  // Standard English "-es" plural (crash->crashes, box->boxes) — only
  // after a sibilant/affricate ending (s/x/z/ch/sh), the same rule every
  // basic English spelling guide states; not tied to any specific word.
  if (word.length > 5 && word.endsWith('es') && /(?:[sxz]|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}
function stemAll(tokens) {
  return tokens.map(lightStem);
}

// Fields intentionally excluded: `steps` (Workflow) — already fed into
// `record.keywords` since Stage 2 (lib/searchIndex.js), so including it
// here again would be redundant, not new coverage. `whereToGo` IS
// included — unlike `steps`, it was never in `record.keywords`
// (lib/searchIndex.js's own workflow keywords list omits it) and C6.4's
// own audit found it carries real, distinct UI-label vocabulary no other
// field repeats.
function buildRecallSurfaceIndex(built) {
  const recallSurfaceById = new Map();
  for (const f of built.featureIndex || []) {
    const tokens = stemAll(keywordsFrom(f.current_behavior || ''));
    if (tokens.length) recallSurfaceById.set(f.feature_id, new Set(tokens));
  }
  for (const w of built.workflowIndex || []) {
    const tokens = stemAll(keywordsFrom(w.expectedResult || '', w.limitations || '', w.warnings || '', w.whereToGo || '', w.troubleshooting || ''));
    if (tokens.length) recallSurfaceById.set(w.id, new Set(tokens));
  }
  return recallSurfaceById;
}

// Reuses keywordsFrom's own tokenizer for the QUESTION side too — same
// stopword list, same >2-char-length filter, same evidence-marker strip
// (harmless no-op for ordinary question text) — so both sides of the
// comparison are tokenized identically, not two different rules.
function questionTokens(question) {
  return new Set(stemAll(keywordsFrom(question)));
}

// Same class of guard as lib/intentConcepts.js's own GENERIC_DOMAIN_WORDS
// (independently defined here, not imported, to keep this module decoupled
// from the concept-cluster layer) — words this codebase has ALREADY found,
// by measurement, to be unsafe as one half of a 2-token match: generic
// enough to co-occur with almost anything, carrying no real topical
// signal. Found necessary here too by direct measurement (this
// checkpoint's own diagnostic run): 'app' and 'through' inflated
// AI-FEAT-007's (Telemetry Pipeline) shared-token count on a metadata-
// crash-recovery question that has nothing to do with telemetry.
const GENERIC_RECALL_WORDS = new Set(['app', 'autoingest', 'application', 'through', 'file', 'files']);

function meaningfulTokens(tokens) {
  return tokens.filter((t) => !GENERIC_RECALL_WORDS.has(t));
}

// admissionThreshold: minimum distinct shared tokens required — reuses
// lib/knowledgeSurfaceNormalization.js's own ABSOLUTE_EVIDENCE_FLOOR_TOKENS
// (2), the codebase's EXISTING definition of "this is real, specific
// evidence, not a coincidence" (used there to protect a keyword-overlap
// match from being damped below the confidence floor) — not a new number
// invented for this purpose. A single shared generic word (the exact
// failure mode STOPWORDS/EVIDENCE_MARKERS already guard against
// elsewhere) can never admit a candidate on its own.
function admitRecallCandidates(question, recallSurfaceById, admissionThreshold) {
  const qTokens = new Set(meaningfulTokens([...questionTokens(question)]));
  const admitted = [];
  for (const [id, surface] of recallSurfaceById) {
    let shared = 0;
    for (const t of qTokens) if (surface.has(t)) shared++;
    if (shared >= admissionThreshold) admitted.push({ id, sharedTokenCount: shared });
  }
  return admitted;
}

module.exports = { buildRecallSurfaceIndex, admitRecallCandidates, questionTokens };
