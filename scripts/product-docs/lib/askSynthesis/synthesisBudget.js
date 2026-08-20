'use strict';

// Ask AutoIngest — Phase C5.2: synthesis output-length (maxTokens) budget.
//
// Root cause (checkpoint Section B/C): the committed C5/C5.1 synthesis path
// used a single fixed maxTokens=500 for every eligible question. A real,
// forensic diagnostic run (bench/synthesisTruncationDiagnostic.mjs, real
// Phi-4-mini-instruct, real tokenizer, the full existing 34-question
// bench/questions.mjs corpus plus 5 known-record cases -- 25 of the 39 were
// synthesis-eligible; results in
// bench/results/phase-c5.2-truncation-diagnostic.json) found 6/25 (24%)
// truncated at 500 tokens. Every one of those 6 fell into exactly one of
// four question CLASSIFICATIONS (evidencePackage.classification, already
// computed deterministically before synthesis is ever attempted -- no new
// signal needed): EXPLANATION, TEAM_ACTIVITY, UNKNOWN, or
// KNOWN_RECORD_BROWSE (3 of the 4 real known-record/Related-topic cases in
// the sample truncated). Every other classification (STATUS, CAPABILITY,
// HOW_TO, TROUBLESHOOTING, ROADMAP, ...) stayed comfortably under 500 in
// every observed case (max 478 tokens).
//
// Policy chosen (Section H: smallest-justified representation, Option B --
// deterministic per-classification budget, not a continuous evidence-size
// formula): the four classes above get a real, measured EXTENDED budget;
// everything else keeps the existing, already-proven STANDARD budget
// unchanged. This was preferred over a continuous evidence-size-derived
// budget (Option C) because classification alone already separates the
// population cleanly in the real sample, and a fixed ceiling costs nothing
// extra for a case that finishes early -- grammar-constrained decoding
// stops at natural JSON completion, never pads to fill the budget (Section
// G: a higher ceiling is not the same thing as a longer answer).
//
// EXTENDED = 1200, derived from real measurements, not invented (Section
// F/I): the real observed maximum true completion length in the sample was
// 1102 tokens (M9, "What is the Online Registry's current purpose...").
// 1200 covers that with margin and, critically, fits the runtime constraint
// (Section I: "derive [the hard max] from real measurements AND
// model/runtime constraints") -- real measured throughput across the 6
// truncating cases' full-length regenerations was 35.6-39.2 tokens/sec;
// 1200 tokens at the WORST observed rate (35.6 tok/s) takes ~33.7s
// generation time, leaving ~9-10s of margin under the existing, unmodified
// PRODUCTION_SYNTHESIS_TIMEOUT_MS=45000 (synthesisService.js) even before
// first-token/setup overhead is counted. All 6/6 real truncating cases in
// the sample complete successfully at this budget (their true completion
// lengths were 537-1102, all <= 1200). This checkpoint deliberately does
// NOT touch PRODUCTION_SYNTHESIS_TIMEOUT_MS -- 1200 was chosen specifically
// so it wouldn't need to be.
//
// STANDARD = 500 unchanged: real data shows it is already sufficient for
// every other classification (max observed need: 478) -- Section A's
// explicit instruction ("do NOT simply change 500 -> 1000 without
// investigation") is honored by leaving it alone where it already works.

const STANDARD_MAX_TOKENS = 500;
const EXTENDED_MAX_TOKENS = 1200;

const EXTENDED_CLASSIFICATIONS = new Set([
  'EXPLANATION',
  'TEAM_ACTIVITY',
  'UNKNOWN',
  'KNOWN_RECORD_BROWSE',
]);

function resolveMaxTokens(classification) {
  return EXTENDED_CLASSIFICATIONS.has(classification) ? EXTENDED_MAX_TOKENS : STANDARD_MAX_TOKENS;
}

module.exports = { resolveMaxTokens, STANDARD_MAX_TOKENS, EXTENDED_MAX_TOKENS, EXTENDED_CLASSIFICATIONS };
