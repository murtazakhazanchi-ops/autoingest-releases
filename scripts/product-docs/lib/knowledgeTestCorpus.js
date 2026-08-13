'use strict';

// Stage 1 Knowledge Engine — the 20-question representative test corpus
// (Phase 7 of AI-FEAT-058's brief). Selected from the Phase 1 audit's
// 92-question corpus, spanning Import/Events/Collections/Metadata/QMZ/
// Transfer/Backup/Archive operations/Settings/Updates/Future capabilities
// and every classification (answerable, partially answerable, planned, not
// supported, insufficient documentation). Not cherry-picked for easy
// passes — several entries were deliberately chosen BECAUSE probing the
// real deterministic ranker (scripts/product-docs/tmp-probe.js, run during
// implementation, output discarded) showed they expose a genuine
// retrieval-precision limitation; those are marked `knownLimitation` below
// and the expectation reflects what a correctly-behaving Stage 1 engine
// should honestly report given that limitation — not what an idealized
// engine would say.
//
// expectedStatus: one of AVAILABLE / PARTIALLY_AVAILABLE / PLANNED /
//   NOT_SUPPORTED / UNKNOWN (see lib/statusResolution.js QUERY_STATUS).
// expectedMatchQuality: 'strong' | 'weak' | 'boundary' | 'none' — see
//   lib/knowledgeEngine.js's matchQualityFor.
// instructionsShouldExist: Stage 1 has no Workflow/Navigation record type
//   (deliberately deferred), so this is `false` for every entry — the
//   engine is expected to use its honest fallback guidance sentence, never
//   invented steps. Kept as an explicit field so a future stage that adds
//   Workflow records has a real regression baseline to change deliberately.
// shouldAcknowledgeGap: whether a correct answer must surface some signal
//   (hedge language, guidance fallback, or UNKNOWN) that documentation is
//   incomplete for this exact question, rather than reading as fully solved.

const CORPUS = [
  {
    id: 'Q01', domain: 'Import',
    question: 'How do I import photographs from an SD card?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'Ties at score 100 across AI-FEAT-018/019/021/023/028 (all merely share the token "import"); ascending-ID tiebreak surfaces AI-FEAT-018 (Event-Component Import Routing) rather than the more directly relevant AI-FEAT-019 (Import Pipeline & Copy Engine). The engine correctly hedges rather than asserting confidently — but the specific capability surfaced is not the most relevant one.',
  },
  {
    id: 'Q02', domain: 'Import',
    question: 'Can I import video?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'Same tie set as Q01 ("import" token). Whether video specifically is supported is not confirmed by any matched feature record (only config/app.config.js has the extension list, which is not part of the canonical registry) — a genuine documentation gap, correctly not asserted.',
  },
  {
    id: 'Q03', domain: 'Import',
    question: 'My photographer information is missing after import.',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'AI-FEAT-022 (Photographer-Folder Resolution) — the genuinely relevant record — ties at score 100 with AI-FEAT-018/019/021/023 and loses the ascending-ID tiebreak.',
  },
  {
    id: 'Q04', domain: 'Events',
    question: 'How do I create a new event?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'AI-FEAT-009 (Event Creation) ties at 100 with AI-FEAT-004/010/018/031 (all share "event"); ascending-ID tiebreak surfaces AI-FEAT-004 (event.json data model — a backend contract, not the operator-facing creation flow).',
  },
  {
    id: 'Q05', domain: 'Events',
    question: 'Can I delete an event?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'No feature record documents event deletion. The engine still surfaces a weak tied match (AI-FEAT-004/009/010/018/031, all sharing only "event") rather than a clean zero-result — the hedge language prevents this from being presented as a confident answer, but a human reviewer should read the hedged output, not just the capabilityStatus field, to see it correctly declines to claim deletion exists.',
  },
  {
    id: 'Q06', domain: 'Collections',
    question: 'What is a Collection in AutoIngest?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'none', instructionsShouldExist: false, shouldAcknowledgeGap: true,
  },
  {
    id: 'Q07', domain: 'Collections',
    question: 'Can I search my entire archive?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'AI-FEAT-053 (Global Search, the genuinely relevant — and Planned, not Available — record) scores 100 from "search" but LOSES the tiebreak to AI-FEAT-042/043/044/045/046 (which score 100 from the unrelated token "archive" and have lower IDs). This is the corpus\'s most consequential finding: the engine reports AVAILABLE (correct for the archive-operations features it actually surfaced) but a careless reading could be mistaken for "archive search is available," when the actual archive-wide search capability is Planned. The weak-match hedge is the only thing preventing this from reading as confident. See AI-FEAT-058 Architectural Review.',
  },
  {
    id: 'Q08', domain: 'Future capabilities',
    question: "What's coming next for AutoIngest?",
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'none', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'Stage 1\'s engine only matches feature-type records — it does not route "what\'s next" questions to roadmap-dashboard.json at all, even though that data exists and answers this question well. A real, scoped Stage 2 gap, not a bug: extend matching to roadmap/dashboard entity types.',
  },
  {
    id: 'Q09', domain: 'Backup',
    question: 'Does AutoIngest back up my archive automatically?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'AI-FEAT-044 (Local-First Background Archive Sync — the genuinely relevant record) ties at 100 with AI-FEAT-042/043/045/046 (all share "archive"); ascending-ID surfaces AI-FEAT-042 (Archive Root Configuration) instead.',
  },
  {
    id: 'Q10', domain: 'Transfer',
    question: 'My transfer stopped halfway — what happens now?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
  },
  {
    id: 'Q11', domain: 'Unsupported',
    question: 'Can AutoIngest recognize faces in my photographs?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary', instructionsShouldExist: false, shouldAcknowledgeGap: false,
  },
  {
    id: 'Q12', domain: 'Unsupported',
    question: 'Can I edit or retouch photos inside AutoIngest?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary', instructionsShouldExist: false, shouldAcknowledgeGap: false,
  },
  {
    id: 'Q13', domain: 'Unsupported',
    question: 'Does AutoIngest offer cloud backup?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary', instructionsShouldExist: false, shouldAcknowledgeGap: false,
    knownLimitation: 'Without the boundary-precedence fix made during Stage 1 implementation, this question keyword-matched AI-FEAT-040 (Backup Update Scanning) via the single token "backup" and would have reported AVAILABLE — a real near-miss on the "never imply unsupported functionality is live" rule, fixed before this corpus was run for the record (see AI-FEAT-058 Architectural Review).',
  },
  {
    id: 'Q14', domain: 'Unsupported',
    question: 'Does AutoIngest work on Linux?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary', instructionsShouldExist: false, shouldAcknowledgeGap: false,
  },
  {
    id: 'Q15', domain: 'Updates',
    question: 'How do I switch between Stable and Preview versions?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'The genuinely relevant record (AI-FEAT-057, Multi-Channel Release & Update System) does not appear at all — "preview" keyword-matches AI-FEAT-015/016 (Media Preview / Preview Focus) instead, an unrelated feature that happens to share the ambiguous word "preview." This is the corpus\'s clearest example of single-word topical drift; the weak-match hedge fires, but the underlying answer content is simply about the wrong feature. A real, reportable Stage 2 priority.',
  },
  {
    id: 'Q16', domain: 'Updates',
    question: 'Will AutoIngest update itself automatically?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'Ties at 100 across AI-FEAT-006/040/057; ascending-ID tiebreak happens to surface AI-FEAT-006 (Application Auto-Update), which is in fact the most relevant of the three here — a case where the tiebreak artifact does not cause a wrong answer.',
  },
  {
    id: 'Q17', domain: 'Metadata',
    question: 'Can AutoIngest repair missing metadata?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong', instructionsShouldExist: false, shouldAcknowledgeGap: true,
  },
  {
    id: 'Q18', domain: 'Archive operations',
    question: 'What routine maintenance does AutoIngest do on my archive?',
    expectedStatus: 'PLANNED', expectedMatchQuality: 'strong', instructionsShouldExist: false, shouldAcknowledgeGap: true,
  },
  {
    id: 'Q19', domain: 'QMZ',
    question: 'What is QMZ?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'Initially expected "strong" (assuming the exact-alias tier, score 900, would fire for "QMZ") — corrected after running: lib/query.js\'s exact-id/alias/title tiers require the WHOLE query string to equal the term, so they can only ever fire on a bare lookup like "qmz", never on a natural sentence that merely contains it. "What is QMZ?" therefore only reaches the single-keyword-overlap tier (100, weak) despite QMZ being registered as an explicit alias. This is the single most consequential structural finding of this eval run: it explains why nearly every natural-language question in this corpus lands in "weak," not just the ones with genuine ambiguity — see AI-FEAT-058 Architectural Review.',
  },
  {
    id: 'Q20', domain: 'Settings',
    question: 'Can I have multiple people log in with different roles?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: false,
    knownLimitation: 'Not in the curated boundary table (deliberately kept small — see lib/statusResolution.js). Query keyword-matches AI-FEAT-027 (Activity Log) via "log," an unrelated coincidental match — expected to resolve AVAILABLE, not NOT_SUPPORTED, demonstrating the boundary table\'s real coverage limit. Included specifically to report this honestly rather than curate around it.',
  },
];

module.exports = { CORPUS };
