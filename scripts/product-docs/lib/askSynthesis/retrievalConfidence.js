'use strict';

// Ask AutoIngest — Phase C5.1: retrieval-confidence / primary-selection-fit.
//
// Defense-in-depth signal for evaluateSynthesisEligibility() (never for
// answerQuestion() itself — see the header of answerWithSynthesis.js and
// this checkpoint's Section H: "leave deterministic retrieval untouched;
// refuse LLM synthesis when confidence is insufficient" was chosen over a
// primary-selection rewrite, because answerQuestion()'s dispatch is shared
// by every existing caller — CLI, portal, docs generation, historical
// context — and a change there is a broad-blast-radius rewrite this
// checkpoint's Section I/U.1 explicitly warns against).
//
// ROOT CAUSE (Section C forensic trace): "How do I create a Transfer
// Export?" deterministically selects AI-WF-008 ("Recover From an Archive
// Lock Error") over AI-WF-005 ("Export or Update a Transfer Drive") by a
// score of 150 to 134 — both are genuine keyword-overlap-tier matches, and
// AI-WF-008 happens to share slightly more generic tokens ("transfer",
// "create", "export"-adjacent workflow vocabulary) with the raw question
// text. Crucially, the QUESTION ITSELF names the real feature this is
// about — "Transfer Export" — verbatim, and that feature record
// (AI-FEAT-038, literally titled "Transfer Export") is a real, retrieved
// candidate that lost anyway because query.js's title-substring bonus tier
// (see lib/query.js's scoreRecord — `record.title.includes(q)`) requires
// the RECORD's title to contain the WHOLE question text, never the
// reverse. A natural-language question essentially never satisfies that
// direction, so an exact, unambiguous named-entity mention inside a real
// question earns no more credit than any other keyword-overlap collision.
// The identical shape reproduces for "Why does Transfer Import exist?"
// (AI-FEAT-039 "Transfer Import" itself scores lower than the unrelated
// AI-FEAT-041 "Transfer Background/Minimize Operation") and for "What is
// archive maintenance?" (AI-FEAT-049 "Archive Maintenance" itself scores
// lower than the unrelated AI-FEAT-050 "Event Maintenance").
//
// SIGNAL CHOSEN: does the question, verbatim (normalized), name some OTHER
// real feature/workflow's exact title (2+ words, to exclude single-word
// generic titles) that is NOT the record answerQuestion() actually chose
// as primary, and that record is not already part of the answer's own
// cited `sources` (see the exemption below)? If so, the primary is
// MISMATCHED — a competing, more specific, explicitly-named record was
// available and lost on generic scoring. Validated against the checkpoint
// Section D/E evaluation set (32 questions spanning HOW_TO, EXPLANATION,
// TROUBLESHOOTING, CAPABILITY/STATUS, ROADMAP, and 8 deliberately
// confusable pairs): 5 true positives (the three defects above, plus "What
// is Transfer Import?" and "What is Transfer Export?", both previously
// undetected because their matchQuality was 'strong' — not just the
// already-'weak'-gated cases), 0 false positives (see the sources
// exemption), 0 observed false negatives in that set.
//
// ALTERNATIVE REJECTED: a same-entity-type top1-vs-top2 SCORE MARGIN signal
// was also built and tested against the same evaluation set. It genuinely
// catches the Transfer Export case (10.6% margin) but directly conflicts
// with "How does the Online Registry work?" — a CORRECT primary
// (AI-WF-006, matching this codebase's own existing, deliberate Phase-2
// TEAM_ACTIVITY routing decision) with an even NARROWER 6.8% margin against
// the same generically-high-scoring AI-WF-008 competitor. No single
// threshold separates the wrong 10.6% case from the correct 6.8% one — any
// threshold low enough to catch Transfer Export also falsely rejects a
// valid, already-correct answer. Per Section J ("a confidence gate that
// rejects everything is not successful") and Section U.2/U.3, this
// alternative was not shipped. Documented here, not silently discarded, so
// a future checkpoint doesn't re-derive and re-reject the same idea from
// scratch.
//
// EXEMPTION: a competing title already present in `answer.sources` is not
// an overlooked competitor — it is evidence the answer already legitimately
// incorporates (e.g. a governance-primary answer like "Why was Transfer
// Export locking kept process-local?" correctly cites AI-FEAT-038 as
// supporting context per answerFromGovernanceRecord's own design; without
// this exemption the signal would falsely flag that correct answer, since
// the query names "Transfer Export" too). Found and fixed during this
// checkpoint's own validation pass, not shipped as a false positive.

const MIN_TITLE_TOKENS = 2;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// question: the raw operator question text (answerQuestion()'s own input —
// never re-derived, never re-typed).
// answer: the already-authority-resolved answer object (matchedCapabilities,
// sources — read-only, never mutated).
// ctx: the same engine context answerQuestion() itself uses (only
// ctx.searchIndex is read here — the full corpus of feature/workflow
// titles, never a second retrieval pass).
function assessPrimaryFit(question, answer, ctx) {
  const primary = answer && answer.matchedCapabilities && answer.matchedCapabilities[0];
  if (!primary || !ctx || !Array.isArray(ctx.searchIndex)) {
    // No primary (roadmap/curated-boundary answers carry no retrieval-
    // ranked matchedCapabilities at all) or no corpus to check against —
    // nothing to distrust.
    return { fit: 'SAFE', reason: null };
  }

  const citedIds = new Set((answer.sources || []).map((s) => s.id));
  const qNorm = normalize(question);
  if (!qNorm) return { fit: 'SAFE', reason: null };

  for (const record of ctx.searchIndex) {
    if (record.entity_type !== 'feature' && record.entity_type !== 'workflow') continue;
    if (record.stable_id === primary.id) continue;
    if (citedIds.has(record.stable_id)) continue;
    const titleNorm = normalize(record.title);
    if (titleNorm.split(' ').filter(Boolean).length < MIN_TITLE_TOKENS) continue;
    if (qNorm.includes(titleNorm)) {
      return {
        fit: 'MISMATCHED',
        reason: 'competing-title-named-in-query',
        competingId: record.stable_id,
        competingTitle: record.title,
      };
    }
  }
  return { fit: 'SAFE', reason: null };
}

module.exports = { assessPrimaryFit };
