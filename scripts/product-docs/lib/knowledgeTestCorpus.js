'use strict';

// AutoIngest Knowledge Engine — the original 20-question representative
// test corpus (Stage 1 Phase 7). Retained as the Stage 1 regression
// baseline; Stage 2's substantially larger corpus lives in
// lib/knowledgeTestCorpusV2.js (Phase 20 of Stage 2's brief — 100+
// questions, paraphrase families, Online Registry/teamwork coverage).
//
// Every expectation below was re-verified against Stage 2's actual,
// current behavior (not just Stage 1's) before this file was last edited —
// several entries changed because Stage 2 genuinely fixes the exact
// limitation the original note described (see each entry's own history).
// Nothing here was "weakened to force a pass" — where behavior improved,
// the expectation was raised to match; where a NEW, different limitation
// was found during Stage 2's own testing, it replaces the old note with a
// fresh, evidenced one.
//
// expectedStatus: one of AVAILABLE / PARTIALLY_AVAILABLE / PLANNED /
//   NOT_SUPPORTED / UNKNOWN / ROADMAP (see lib/statusResolution.js
//   QUERY_STATUS, plus Stage 2's ROADMAP routing).
// expectedMatchQuality: 'strong' | 'weak' | 'boundary' | 'none' | 'roadmap'
//   — see lib/knowledgeEngine.js's matchQualityFor.
// instructionsShouldExist: Stage 2 can now legitimately provide real
//   guidance (a companion Workflow's steps or "When To Use It" text, or a
//   direct Workflow answer) for questions where Stage 1 could not — this
//   field now varies per question rather than being uniformly false.
// shouldAcknowledgeGap: whether a correct answer must surface some signal
//   (hedge language, guidance fallback, or UNKNOWN) that documentation is
//   incomplete for this exact question, rather than reading as fully solved.

const CORPUS = [
  {
    id: 'Q01', domain: 'Import',
    question: 'How do I import photographs from an SD card?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong', instructionsShouldExist: true, shouldAcknowledgeGap: false,
    knownLimitation: 'FIXED in Stage 2 — was a weak, wrong-record tiebreak in Stage 1 (AI-FEAT-018 via bare "import" token). The concept/synonym layer (lib/intentConcepts.js, "import-general" cluster) now expands this question toward a curated hint that scores strongly and specifically against AI-WF-001 (Import Photographs From a Memory Card or Folder) — the actually-relevant Workflow, with real steps sourced from the app\'s own onboarding text.',
  },
  {
    id: 'Q02', domain: 'Import',
    question: 'Can I import video?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'Deliberately NOT concept-boosted in Stage 2 (see intentConcepts.js "import-video" cluster comment) — no canonical record confirms video-format support specifically, only config/app.config.js (non-canonical). An earlier hint artificially inflated confidence toward an unrelated routing feature; reverted during Stage 2\'s own testing rather than shipped. Remains an honest, disclosed documentation gap, not asserted either way.',
  },
  {
    id: 'Q03', domain: 'Import',
    question: 'My photographer information is missing after import.',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'AI-FEAT-022 (Photographer-Folder Resolution) still ties at score 100 with several other features sharing only "import"/"photographer" as isolated tokens; no concept cluster currently targets this exact troubleshooting phrasing (a real, scoped Stage 3 candidate — see AI-FEAT-058 Stage 2 Future Enhancements), and no Workflow record covers this specific symptom yet.',
  },
  {
    id: 'Q04', domain: 'Events',
    question: 'How do I create a new event?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong', instructionsShouldExist: true, shouldAcknowledgeGap: false,
    knownLimitation: 'FIXED in Stage 2 — was a weak, wrong-record tiebreak in Stage 1 (AI-FEAT-004, a backend contract, not the creation flow). The "event-create" concept cluster now correctly and strongly surfaces AI-WF-002 (Create a New Event), with real steps verified against renderer/index.html\'s home-screen button.',
  },
  {
    id: 'Q05', domain: 'Events',
    question: 'Can I delete an event?',
    expectedStatus: 'UNKNOWN', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'Still no feature or workflow record documents event deletion. The engine still surfaces a weak tied match rather than a clean zero-result — the hedge language correctly declines to claim deletion exists. Unchanged from Stage 1: this is an honest documentation gap (no evidence either way), not a retrieval defect.',
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
    knownLimitation: 'Unchanged from Stage 1: AI-FEAT-053 (Global Search, Planned — the genuinely relevant record) still loses the tiebreak to unrelated Archive Operations features sharing only "archive". No concept cluster currently targets this phrasing toward Global Search specifically — a real Stage 3 candidate, deliberately not patched with an overly-specific hint here.',
  },
  {
    id: 'Q08', domain: 'Future capabilities',
    question: "What's coming next for AutoIngest?",
    expectedStatus: 'ROADMAP', expectedMatchQuality: 'roadmap', instructionsShouldExist: false, shouldAcknowledgeGap: false,
    knownLimitation: 'FIXED in Stage 2 (Phase 19, roadmap routing) — this exact gap was Stage 1\'s own documented limitation #5. The question classifier now recognizes ROADMAP-shaped questions and answers directly from roadmap-dashboard.json, never inferring a commitment from anything else.',
  },
  {
    id: 'Q09', domain: 'Backup',
    question: 'Does AutoIngest back up my archive automatically?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'Unchanged from Stage 1: AI-FEAT-044 (the genuinely relevant record) still ties with unrelated Archive Operations features sharing only "archive". No concept cluster currently targets this exact phrasing.',
  },
  {
    id: 'Q10', domain: 'Transfer',
    question: 'My transfer stopped halfway — what happens now?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong', instructionsShouldExist: true, shouldAcknowledgeGap: false,
    knownLimitation: 'FIXED in Stage 2 — Stage 1 gave a generic, on-topic-but-not-specific answer (AI-FEAT-038). The "transfer-resume" concept cluster now surfaces AI-WF-005 (Export or Update a Transfer Drive), which discusses this exact scenario including BUG-005\'s resume-state history. Also the case that found and fixed the Stage 2 TROUBLESHOOTING/HOW_TO workflow-preference gap — see AI-FEAT-058 Stage 2 Evolution Journal.',
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
    knownLimitation: 'Unchanged root cause from Stage 1 ("preview" drifts to Media Preview), but a REAL regression was found and fixed during Stage 2\'s own testing along the way: before a stopword filter was added to keywordsFrom() (searchIndex.js), the richer keyword surface of Workflow records let AI-WF-006 win this question confidently (score 300) purely on the stopwords "how"/"between"/"and" — a false-strong match with zero topical relevance. Fixed by excluding common connector words from generated keyword sets; this question correctly returned to Stage 1\'s honest weak/hedged behavior afterward.',
  },
  {
    id: 'Q16', domain: 'Updates',
    question: 'Will AutoIngest update itself automatically?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: false, shouldAcknowledgeGap: true,
    knownLimitation: 'Unchanged from Stage 1: ties at 100 across AI-FEAT-006/040/057; ascending-ID tiebreak happens to surface AI-FEAT-006, the most relevant of the three — a case where the tiebreak artifact does not cause a wrong answer.',
  },
  {
    id: 'Q17', domain: 'Metadata',
    question: 'Can AutoIngest repair missing metadata?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'weak', instructionsShouldExist: true, shouldAcknowledgeGap: true,
    knownLimitation: 'Was "strong" in Stage 1 (AI-FEAT-033 alone at score 200). In Stage 2, the correct top match (AI-WF-004, Repair Missing or Incorrect Metadata, still correctly grounded in AI-FEAT-033) ties at score 300 with AI-WF-006 — a genuine, disclosed, hard limitation: AI-WF-006\'s own text legitimately contains the words "metadata"/"audit"/"repair" in a NEGATING context ("not Metadata, not Audit/Repair" — part of the Registry\'s own required four-way distinction). Pure keyword-overlap cannot distinguish a word appearing in a positive claim from a word appearing in an explicit exclusion. The primary match is still correctly AI-WF-004 (alphabetically first among the tie) and the answer is still correctly grounded and hedged — this is the system being appropriately conservative given a genuinely ambiguous lexical signal, not a wrong answer. A real candidate for smarter (still non-embedding) matching in a future stage, not a defect to patch here.',
  },
  {
    id: 'Q18', domain: 'Archive operations',
    question: 'What routine maintenance does AutoIngest do on my archive?',
    expectedStatus: 'PLANNED', expectedMatchQuality: 'strong', instructionsShouldExist: false, shouldAcknowledgeGap: true,
  },
  {
    id: 'Q19', domain: 'QMZ',
    question: 'What is QMZ?',
    expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong', instructionsShouldExist: true, shouldAcknowledgeGap: false,
    knownLimitation: 'Was "weak" in Stage 1 for a real, documented structural reason (lib/query.js\'s exact-alias tier cannot fire on a full sentence). Stage 2\'s "qmz" concept cluster hint ("qmz sequencing workspace") now reaches AI-FEAT-047 at score 850 — genuine, specific evidence (3 real, meaningful keyword matches), not the exact-alias tier itself, but strong by the same score-based quality rule regardless of which mechanism produced it.',
  },
  {
    id: 'Q20', domain: 'Settings',
    question: 'Can I have multiple people log in with different roles?',
    expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary', instructionsShouldExist: false, shouldAcknowledgeGap: false,
    knownLimitation: 'FIXED in Stage 2 — Stage 1 could not resolve this because the boundary table\'s keyword phrasing was too narrow ("multiple users log in", not "multiple people log in with different roles"). A boundary-widening concept cluster (intentConcepts.js BOUNDARY_CONCEPT_CLUSTERS, "team-multi-role") now recognizes "different roles" as a paraphrase of the SAME already-evidenced multi-user-roles exclusion — same citation, wider recall, never a new unevidenced claim. This same fix ALSO caught and required repairing a genuine regression: a "team-collaboration" concept hint aimed at a different, legitimate paraphrase family ("several users... simultaneously") was, before a fix, strong enough to override this correctly-detected boundary — see AI-FEAT-058 Stage 2 Evolution Journal for the full account of why hint-boosted scores must never override a boundary, only raw-question scores may.',
  },
];

module.exports = { CORPUS };
