'use strict';

// Phase C8 — deterministic clarification-decision layer. Decides, from
// ALREADY-COMPUTED bounded evidence (never a new retrieval pass, never an
// LLM call), whether Ask AutoIngest should answer directly or ask the
// operator a clarifying question. This is the seam the C7-era architecture
// map identified: it runs between answerQuestionWithAuthority()'s already-
// decided answer + assessPrimaryFit()'s already-computed primaryFit
// (retrievalConfidence.js) and the existing evaluateSynthesisEligibility()
// gate (synthesisEligibility.js, UNCHANGED) -- it reuses that gate's own
// signals rather than inventing new detection logic, per the checkpoint's
// own instruction that a clarification-worthy case and a synthesis-refusal
// case are already conceptually adjacent.
//
// FOUR decisions (checkpoint Section 3):
//   CLEAR                  -> proceed to authority/synthesis as today.
//   AMBIGUOUS               -> two or more materially DIFFERENT subjects
//                              are plausible (different subject groups).
//   MISSING_REQUIRED_DETAIL -> the subject/domain is known, but which
//                              specific record answers it depends on an
//                              operational detail not yet given.
//   UNSUPPORTED             -> already-curated boundary/authority already
//                              decided this deterministically; answer as
//                              today (matchQuality 'boundary', or a
//                              downgraded-to-UNKNOWN authority result --
//                              this layer never re-litigates that).
//
// MEASURED, NOT INVENTED thresholds (checkpoint Section 3: "Do NOT invent
// arbitrary thresholds without measuring them"): SEMANTIC_RELEVANCE_FLOOR
// and SEMANTIC_AGREEMENT_GAP below were derived from a real corpus
// measurement (C7/C8 own diagnostic sweep across the C6.1/C6.2/C6.3 DEV
// corpora, never the frozen holdouts) of the local embedding model's own
// cosine-similarity score distributions -- see this file's own comments
// at each constant for the exact measured numbers that justify them.

const { subjectGroupOf, areCompanions } = require('../candidateGrouping');
const { CONFIDENCE_FLOOR, STRONG_MATCH_FLOOR } = require('../knowledgeEngine');
const { QUESTION_TYPES } = require('../questionClassifier');

// Measured (C8 sweep against the existing 40-question expectedMatchQuality:
// 'strong' corpus, knowledgeTestCorpus.js + knowledgeTestCorpusV2.js, with
// real semantic retrieval): the same-group-rival/cross-group escalation
// logic below, unconstrained, produced clarification for 12/40 previously-
// direct questions -- several were genuine (the transfer-family cases this
// mechanism exists for), but several were clear false positives:
// "What is a Collection in AutoIngest?" (EXPLANATION -- a single concept
// asked about, not a choice between records), "What's the difference
// between Quick Import and regular import?" (COMPARISON -- the question
// already names both things and wants them compared, not disambiguated),
// "Can I see who else is currently working on the archive?" (TEAM_ACTIVITY
// -- a presence question, not a feature-selection question), "Can I use
// AutoIngest without an archive root configured?" (CAPABILITY -- wants a
// yes/no answer about a precondition, not a menu of unrelated records).
// Reuses the EXISTING, already-computed classifyQuestion() type (never a
// new classifier) to restrict escalation to the question types where
// "which specific record answers this" is actually a coherent thing to
// ask: TROUBLESHOOTING/HOW_TO/STATUS (operational, can genuinely resolve
// to different specific procedures) and UNKNOWN (unclassified vague
// phrasing -- the class the checkpoint's own worked example falls into
// when phrased as a bare statement). EXPLANATION, COMPARISON, CAPABILITY,
// TEAM_ACTIVITY, CONNECTIVITY, NAVIGATION, ROADMAP are excluded --
// candidate scoring noise in the SAME subject group is common for these
// question shapes without representing genuine operator-facing ambiguity.
const ESCALATION_ELIGIBLE_TYPES = new Set([
  QUESTION_TYPES.TROUBLESHOOTING,
  QUESTION_TYPES.HOW_TO,
  QUESTION_TYPES.STATUS,
  QUESTION_TYPES.UNKNOWN,
]);

// Measured (C8 diagnostic sweep, n=236 non-withheld dev-corpus questions):
// the semantic model's own top-1 score when it POINTS AT THE CORRECT
// record has median 0.833 (p25 0.778); when it points at a WRONG record,
// median 0.777 (p25 0.747). The two distributions overlap (this is
// evidence, not proof, consistent with C7's own finding that semantic
// retrieval is a candidate-generation signal, not a final-answer signal)
// but a genuine floor exists below which a semantic candidate is not
// treated as meaningfully asserting a competing subject at all: 0.75,
// just below the WRONG-case median (0.777) and comfortably below the
// CORRECT-case p25 (0.778) -- a candidate scoring under this essentially
// never represents confident semantic evidence either way in the measured
// data.
const SEMANTIC_RELEVANCE_FLOOR = 0.75;

// Measured (same sweep): the gap between the semantic model's own top-1
// and top-2 scores has median 0.067 when semantic agrees with the
// deterministic engine's own top choice, vs. median 0.019 when they
// disagree -- semantic's own internal ranking is markedly less decisive
// exactly when it's about to point somewhere different. Used only as a
// tie-breaking signal (a small gap makes semantic's OWN disagreement
// weaker evidence of genuine ambiguity, not a hard gate on its own).
const SEMANTIC_DECISIVE_GAP = 0.05;

function topId(list) {
  return list && list.length ? list[0].id : null;
}

// decideClarification(answer, primaryFit, semanticTop, ctx) -> {
//   decision: 'CLEAR'|'AMBIGUOUS'|'MISSING_REQUIRED_DETAIL'|'UNSUPPORTED',
//   candidates: [{id,title,entityType}] (only for AMBIGUOUS/MISSING_REQUIRED_DETAIL),
//   reason: string (diagnostic only, never operator-facing),
// }
function decideClarification(answer, primaryFit, semanticTop, ctx) {
  // UNSUPPORTED: existing curated-boundary/authority decision already
  // stands -- this layer never re-litigates it. A 'boundary' match is
  // always a curated, already-evidenced NOT_SUPPORTED/limited-scope
  // answer; 'roadmap' is deterministic dashboard data, not a retrieval
  // ranking at all. Both are exactly as trustworthy today as they were
  // before C8 and need no clarification.
  if (answer.matchQuality === 'boundary' || answer.matchQuality === 'roadmap') {
    return { decision: 'UNSUPPORTED', candidates: [], reason: 'curated-boundary-or-roadmap' };
  }

  const detCandidates = answer.matchedCapabilities || [];
  const detTop = detCandidates[0] || null;
  const semList = (semanticTop || []).filter((s) => s.score >= SEMANTIC_RELEVANCE_FLOOR);
  const semTopEntry = semList[0] || null;
  const semGap = semList.length >= 2 ? semList[0].score - semList[1].score : (semList.length === 1 ? 1 : 0);

  // Nothing usable anywhere (deterministic found nothing worth trusting
  // AND semantic found nothing above the measured relevance floor): this
  // is a genuine "no evidence" case, not ambiguity -- asking a
  // clarification question would not help, since there is no candidate
  // set to narrow. Let the existing honest UNKNOWN/weak-hedge answer
  // stand rather than starting a clarification loop with nothing to
  // clarify toward.
  if ((!detTop || answer.matchQuality === 'none') && !semTopEntry) {
    return { decision: 'CLEAR', candidates: [], reason: 'no-evidence-anywhere' };
  }

  const detGroup = subjectGroupOf(detTop && detTop.id, ctx);
  const semGroup = subjectGroupOf(semTopEntry && semTopEntry.id, ctx);

  const detStrong = answer.matchQuality === 'strong' && !(primaryFit && primaryFit.fit === 'MISMATCHED');
  const agreeOnRecord = detTop && semTopEntry && (detTop.id === semTopEntry.id || areCompanions(detTop.id, semTopEntry.id, ctx));
  const agreeOnGroup = detGroup && semGroup && detGroup === semGroup;
  const escalationEligible = ESCALATION_ELIGIBLE_TYPES.has(answer.classification);

  // Even when deterministic is independently 'strong', the engine's own
  // TF-style scoring can separate two genuinely different, both-plausible
  // SAME-GROUP records by a wide margin without either being a fluke --
  // measured directly against the checkpoint's own worked example ("My
  // transfer stopped halfway.") where "Export or Update a Transfer Drive"
  // (score 334) and "Import or Update From a Transfer Drive" (score 183)
  // are both real, different operations that vague phrasing cannot itself
  // distinguish, yet both comfortably clear the engine's own
  // CONFIDENCE_FLOOR (100) -- reused here unchanged rather than inventing
  // a new number. A same-group, non-companion rival that clears it is a
  // real competing candidate, not scoring noise.
  //
  // BUT this signal alone over-triggers: measured counter-example, "How do
  // I import photographs from an SD card?" -- "Import Photographs From a
  // Memory Card or Folder" (470) vs. "Use Quick Import for a Small Batch"
  // (357, same group, clears CONFIDENCE_FLOOR) are NOT two different
  // interpretations of the question, they're a primary workflow and a
  // specialized variant of the SAME operation. Deterministic scores alone
  // cannot tell "genuinely different goal" (transfer stopped: export vs.
  // import vs. backup-scan) apart from "same goal, different method"
  // (import: general vs. quick-batch) -- so a same-group rival is only
  // trusted as real ambiguity when the independent semantic signal is
  // ALSO indecisive. Measured: for the SD-card question, semantic's own
  // RAW (unfiltered) top score is 0.927 with a 0.219 gap to #2, decisively
  // agreeing with deterministic's own top pick -- an independent, decisive
  // vote FOR the single record, not a competing one. For "transfer stopped
  // halfway", semantic's own raw top score is only 0.69 among several
  // closely-clustered candidates -- no decisive opinion, so it cannot
  // corroborate the single pick and the rival stands. When NO semantic
  // evidence is available at all (checkpoint's own required
  // deterministic-only fallback -- offline, model not loaded), this layer
  // never invents a new, uncorroborated ambiguity signal from deterministic
  // scores alone -- it degrades to the pre-C8 default of trusting
  // matchQualityFor()'s own 'strong' verdict exactly as it always has.
  const semRaw = semanticTop || [];
  const semRawTop = semRaw[0] || null;
  const semRawGap = semRaw.length >= 2 ? semRaw[0].score - semRaw[1].score : (semRaw.length === 1 ? 1 : 0);
  const semanticConfirmsSingleWinner = !!(semRawTop
    && semRawTop.score >= SEMANTIC_RELEVANCE_FLOOR
    && semRawGap >= SEMANTIC_DECISIVE_GAP
    && detTop
    && (semRawTop.id === detTop.id || areCompanions(detTop.id, semRawTop.id, ctx) || subjectGroupOf(semRawTop.id, ctx) === detGroup));

  // Measured counter-example (multi-turn: "My transfer stopped halfway." ->
  // "Transfer Export."): once the operator names the operation explicitly,
  // deterministic's own top score can jump from the 100-500 "gray zone"
  // default-strong range into genuinely OVERWHELMING territory (565 vs.
  // 169 for the next candidate -- over 3x, and >= STRONG_MATCH_FLOOR
  // itself, not merely clearing it by elimination). A same-group rival
  // sitting far below CONFIDENCE_FLOOR's neighborhood at that point is
  // realistically scoring noise, not a live alternative interpretation --
  // re-asking here would ignore the very answer the operator just gave.
  // Reuses STRONG_MATCH_FLOOR unchanged from knowledgeEngine.js (the
  // engine's own existing "no elimination needed, decisively separated"
  // bar) rather than inventing a new number -- the same-group-rival veto
  // only applies in the gray zone below it, where matchQualityFor()'s own
  // 'strong' verdict is reached by elimination, not by a clear margin.
  const detTopOverwhelming = !!(detTop && detTop.score >= STRONG_MATCH_FLOOR);

  const sameGroupDetRival = (escalationEligible && !detTopOverwhelming && semRaw.length > 0 && !semanticConfirmsSingleWinner)
    ? detCandidates.slice(1).find((c) => c.score >= CONFIDENCE_FLOOR
        && subjectGroupOf(c.id, ctx) === detGroup
        && !areCompanions(detTop.id, c.id, ctx))
    : null;

  // Measured counter-example (single-candidate, not a rival case at all):
  // "It didn't copy everything." -- deterministic top score is 118, barely
  // above CONFIDENCE_FLOOR (100), classified 'strong' only because
  // matchQualityFor()'s own elimination rule (not tied, not <= the weak
  // ceiling) defaults to 'strong' there -- not because the evidence is
  // actually decisive. No same-group rival exists (the only real rival is
  // in a DIFFERENT group), so sameGroupDetRival above never catches it.
  // Semantic DID run and found real candidates, but NONE cleared
  // SEMANTIC_RELEVANCE_FLOOR (best: 0.714) -- an independent signal that
  // ALSO couldn't confirm this specific record, not merely silence. A
  // gray-zone 'strong' verdict with genuine (not absent) semantic
  // disagreement-by-indecision is exactly the situation matchQualityFor()
  // is least reliable in -- treated the same as a weak match for the
  // REST of this function (falls through to the existing single-
  // candidate confirmation path below), never CLEAR outright. Distinct
  // from the true offline/no-semantic-at-all case (semRaw.length === 0),
  // which still trusts matchQualityFor()'s verdict fully, per the
  // checkpoint's own required deterministic-only fallback.
  const semanticRanAndFoundNothingRelevant = semRaw.length > 0 && !semTopEntry;
  const grayZoneNeedsCorroboration = !detTopOverwhelming && semanticRanAndFoundNothingRelevant;
  const detConfident = detStrong && !grayZoneNeedsCorroboration;

  // CLEAR: deterministic is confidently untied/strong (and, if only
  // gray-zone strong, semantic didn't actively fail to corroborate it),
  // no same-group rival is independently plausible, and semantic either
  // has nothing to say, or affirms the same record/companion, or
  // (disagrees but only weakly/indecisively -- small internal gap, below
  // SEMANTIC_DECISIVE_GAP -- treated as noise, not a competing subject).
  if (detConfident && !sameGroupDetRival && (!semTopEntry || agreeOnRecord || (semGroup && detGroup === semGroup) || semGap < SEMANTIC_DECISIVE_GAP)) {
    return { decision: 'CLEAR', candidates: [], reason: 'deterministic-strong-no-material-disagreement' };
  }

  // Build the candidate set for whichever clarification shape applies.
  // Deterministic candidates are restricted to detTop's OWN subject group
  // first -- a record from a genuinely unrelated area (e.g. "See Who Else
  // Is Online..." showing up purely on shared keyword surface) is noise
  // for a same-subject clarification, not a real choice the operator
  // would recognize as plausible. The cross-group AMBIGUOUS path below
  // still gets its own different-group representative via the semantic
  // loop, unaffected by this restriction.
  const candidateMap = new Map();
  const sameGroupDetCandidates = detCandidates.filter((c) => subjectGroupOf(c.id, ctx) === detGroup);
  for (const c of sameGroupDetCandidates.slice(0, 3)) candidateMap.set(c.id, { id: c.id, title: c.title, entityType: c.entityType });
  for (const c of semList.slice(0, 3)) {
    const already = [...candidateMap.keys()].some((id) => areCompanions(id, c.id, ctx) || id === c.id);
    if (!already) candidateMap.set(c.id, { id: c.id, title: c.title, entityType: c.type });
  }
  const candidates = [...candidateMap.values()];

  if (escalationEligible && detGroup && semGroup && detGroup !== semGroup && semTopEntry.score >= SEMANTIC_RELEVANCE_FLOOR) {
    // Two independent mechanisms point at genuinely different subject
    // areas -- the strongest, least-arbitrary signal this layer has for
    // real ambiguity (not a single invented score threshold; it's
    // agreement/disagreement BETWEEN two independently-computed signals).
    return { decision: 'AMBIGUOUS', candidates, reason: 'deterministic-and-semantic-disagree-on-subject-group' };
  }

  if (escalationEligible && candidates.length >= 2) {
    // Same subject area (or one signal silent), but more than one
    // distinct real record remains plausible within it -- the operator
    // knows roughly what they're asking about, the assistant needs one
    // more operational detail to pick the right specific record.
    return { decision: 'MISSING_REQUIRED_DETAIL', candidates, reason: 'multiple-distinct-records-same-subject-area' };
  }

  // Measured (same sweep as above): ungated, this branch newly asked for
  // single-candidate confirmation on CAPABILITY ("Can I tell if a
  // teammate is online right now?") and TEAM_ACTIVITY ("Do I need to log
  // in to use the Online Registry?") questions once grayZoneNeedsCorroboration
  // started reaching it -- the same false-positive shape as the other two
  // escalation paths above, for the same reason (a yes/no-style CAPABILITY
  // question or a presence question is never "which record do you mean",
  // and the pre-existing weak-match hedge already handles low confidence
  // for these types honestly). Gated for consistency with the other two
  // escalation paths.
  if (escalationEligible && !detConfident) {
    // Weak/tied/mismatched deterministic evidence (or gray-zone 'strong'
    // that semantic actively failed to corroborate -- see
    // grayZoneNeedsCorroboration above), and semantic didn't add a second
    // distinct candidate either -- still not confident enough to answer
    // as a fact, but there is exactly one real candidate to ask the
    // operator to confirm rather than guess silently.
    return { decision: 'MISSING_REQUIRED_DETAIL', candidates: candidates.length ? candidates : (detTop ? [{ id: detTop.id, title: detTop.title, entityType: detTop.entityType }] : []), reason: 'single-weak-candidate-needs-confirmation' };
  }

  return { decision: 'CLEAR', candidates: [], reason: 'default-clear' };
}

module.exports = { decideClarification, SEMANTIC_RELEVANCE_FLOOR, SEMANTIC_DECISIVE_GAP };
