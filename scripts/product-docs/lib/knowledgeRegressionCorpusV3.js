'use strict';

// Part 3 Phase 4.1 (Decision 7) — decision-specific regression families for
// the hardened evaluation harness. Superset ON TOP of, never a replacement
// for, the existing 119-question corpus (knowledgeTestCorpus.js's 20 +
// knowledgeTestCorpusV2.js's 99, both left byte-for-byte unchanged). Every
// entry here cites the specific Part 3 audit reproduction or Decision-
// interview finding that motivated it — nothing here is a guessed answer.
//
// Schema (all fields beyond id/question/status/targetPhase/rationale are
// OPTIONAL — an entry only declares what it can meaningfully assert today):
//   id                  stable id, prefixed RF-<targetPhase>-<n>
//   targetPhase         which Remediation Plan phase is expected to make
//                       this pass (e.g. '4.2', '4.3', '5.1') — cross-
//                       references the published Neighborhood Remediation
//                       Plan artifact 1:1
//   decisionRef         'Decision N of 8' — which interview decision this
//                       traces to
//   auditRef            the specific Gap/R-number this reproduces
//   status              'known-baseline-failure' — currently fails this
//                          entry's own assertions; expected, will be fixed
//                          in targetPhase; NOT a regression to chase now
//                       'control' — currently passes; guards against a
//                          future phase silently breaking it
//                       'schema-placeholder' — the assertion vocabulary
//                          needed to check this doesn't exist yet in the
//                          runtime (e.g. no admission/role concept before
//                          Phase 5.2); recorded so the requirement isn't
//                          lost, not evaluated for pass/fail yet
//   category            free-text grouping (matches Decision 6's 10-
//                       category compound-question taxonomy where relevant)
//   question            the natural-language question run through
//                       answerQuestion()
//   rationale           why this case exists, evidence-first
//   expectedStatus / expectedMatchQuality   reuse the existing V1/V2
//                       vocabulary (lib/statusResolution.js QUERY_STATUS /
//                       lib/knowledgeEngine.js matchQualityFor)
//   expectedClassification   optional exact QUESTION_TYPES check
//   allowedMemberIds    acceptable primary-record id(s) — more than one
//                       may be evidence-valid; presence of ANY satisfies it
//   requiredMemberIds   record id(s) that must appear SOMEWHERE in
//                       matchedCapabilities or sources (not necessarily as
//                       primary) — today's architecture has no per-member
//                       role, so this checks presence only, not role
//   forbiddenMemberIds  record/boundary id(s) that must NOT be the primary
//                       (matchedCapabilities[0] or sources[0])
//   expectedMaxSources  guards against unnecessary members appearing once
//                       Phase 5.2 ships (Decision 3's "minimum sufficient
//                       neighborhood", not "more records = better")
//   mustNotContainMemoryRecord   boolean — guards Decision 5's "simple
//                       questions don't gain historical-context members"
//   expectedConfidenceRange   [min, max] — ranges/bands only, never an
//                       exact float, per Decision 7's explicit instruction

const REGRESSION_CORPUS_V3 = [

  // ---------------------------------------------------------------------
  // Phase 4.2 — hard-override trigger specificity (Decision 1 of 8)
  // ---------------------------------------------------------------------
  {
    id: 'RF-4.2-001', targetPhase: '4.2', decisionRef: 'Decision 1 of 8', auditRef: 'Audit R05 / the recognize collision',
    status: 'known-baseline-failure', category: 'trigger-safety',
    question: 'If my transfer drive mirrors the Collection/Event folder structure, will Transfer Import still recognize renamed events correctly?',
    rationale: 'Confirmed severe defect: the bare word "recognize" in face-recognition\'s KNOWN_BOUNDARIES keyword list hard-overrides genuinely on-topic evidence (AI-FEAT-039 scores 800-900 on this exact question) at maximum confidence (1.0), directly contradicting AI-FEAT-039\'s own documented "recognized as the same archival event" content.',
    forbiddenMemberIds: ['face-recognition'],
    requiredMemberIds: ['AI-FEAT-039'],
  },
  {
    id: 'RF-4.2-002', targetPhase: '4.2', decisionRef: 'Decision 1 of 8', auditRef: 'Original V1 corpus Q11, re-verified as a narrowing-safety control',
    status: 'control', category: 'trigger-safety',
    question: 'Does AutoIngest have facial recognition to identify people in photos?',
    rationale: 'The genuine face-recognition exclusion must keep firing after the recognize keyword is narrowed to multi-word phrases — this is the positive control proving the fix narrows, not disables, the boundary.',
    requiredMemberIds: ['face-recognition'], expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'RF-4.2-003', targetPhase: '4.2', decisionRef: 'Decision 1 of 8', auditRef: 'cloud-storage boundary, narrowing-safety control',
    status: 'control', category: 'trigger-safety',
    question: 'Can I sync my archive to Dropbox or Google Drive?',
    rationale: 'A different existing boundary that already uses multi-word phrases (per statusResolution.js:151-153\'s own stated discipline) — must remain unaffected by any Phase 4.2 change to other boundaries.',
    requiredMemberIds: ['cloud-storage'], expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'RF-4.2-004', targetPhase: '4.2', decisionRef: 'Decision 1 of 8', auditRef: 'linux boundary, single-generic-token risk control',
    status: 'control', category: 'trigger-safety',
    question: 'Is there a Linux version of AutoIngest?',
    rationale: 'linux\'s own keyword list (["linux", "ubuntu"]) is exactly the same single-generic-token SHAPE as the recognize collision, even though "linux" itself is unlikely to collide in this corpus\'s vocabulary. Recorded as a control so Phase 4.2\'s per-boundary audit has a concrete before/after check for this specific boundary, not just an assumption it is safe.',
    requiredMemberIds: ['linux'], expectedStatus: 'NOT_SUPPORTED', expectedMatchQuality: 'boundary',
  },
  {
    id: 'RF-4.2-005', targetPhase: '4.2', decisionRef: 'Decision 1 of 8', auditRef: 'Audit R15 (two-operators recall gap)',
    status: 'schema-placeholder', category: 'trigger-recall-candidate',
    question: 'Can two operators safely import into the same event at the same time?',
    rationale: 'Recorded per Decision 1\'s explicit instruction that R15/R16 are recall CANDIDATES, evaluated separately from the recognize correctness fix, and only added as a real assertion after regression-corpus verification shows the widened trigger helps without new collisions. Not yet a pass/fail assertion — a documented gap for Phase 4.2\'s own audit to consider. Candidate trigger phrase: "two operators" (currently team-collaboration\'s cluster lists "two laptops/computers/devices" but not "two operators").',
  },
  {
    id: 'RF-4.2-006', targetPhase: '4.2', decisionRef: 'Decision 1 of 8', auditRef: 'Audit R16 (activity-feed recall gap)',
    status: 'schema-placeholder', category: 'trigger-recall-candidate',
    question: "My QMZ sorting isn't showing up in the activity feed, why not?",
    rationale: 'Same discipline as RF-4.2-005 — the registry-activity-scope boundary already says exactly this, but its trigger requires literal word-order "qmz sorting show up as activity" and misses natural phrasing. Candidate, not a committed assertion, pending Phase 4.2\'s own corpus-verified widening.',
  },

  // ---------------------------------------------------------------------
  // Phase 4.3 — keyword-surface-size normalization (Decision 2 of 8)
  // ---------------------------------------------------------------------
  {
    id: 'RF-4.3-001', targetPhase: '4.3', decisionRef: 'Decision 2 of 8', auditRef: 'Gap C — Audit R01',
    status: 'known-baseline-failure', category: 'ranking-normalization',
    question: 'Why does Transfer Import exist?',
    rationale: 'AI-WF-006 (large keyword surface) beats AI-WF-009 (correctly relevant, smaller surface) 300 to 200 via incidental token overlap. The canonical Gap C reproduction.',
    allowedMemberIds: ['AI-FEAT-039', 'AI-WF-009'], forbiddenMemberIds: ['AI-WF-006'],
  },
  {
    id: 'RF-4.3-002', targetPhase: '4.3', decisionRef: 'Decision 2 of 8', auditRef: 'Gap C — Audit R02 (exact Remediation Plan / brief phrasing)',
    status: 'known-baseline-failure', category: 'ranking-normalization',
    question: 'Why does Transfer Import exist, what limitation does Collection-nested import have, and what should I do operationally?',
    rationale: 'Live reproduction of the brief\'s own flagship worked example — AI-WF-006 ties AI-WF-009 at 400, decided by ascending-ID tiebreak, not relevance.',
    allowedMemberIds: ['AI-FEAT-039', 'AI-WF-009'], forbiddenMemberIds: ['AI-WF-006'],
  },
  {
    id: 'RF-4.3-003', targetPhase: '4.3', decisionRef: 'Decision 2 of 8', auditRef: 'Gap A / Gap B interaction — Audit R06',
    status: 'known-baseline-failure', category: 'ranking-normalization',
    question: 'Does Transfer Import handle Collection-nested transfer drives the same way as direct-Event transfers?',
    rationale: 'AI-FEAT-038 wins at 900 via the transfer-export concept cluster\'s hint injection ("transfer drive(s)" phrasing), beating AI-FEAT-039\'s genuinely higher raw relevance (800, 8 real keyword-token matches on the actual question). Shows Part 2\'s F9 "Collection-nested case fixed" claim is phrasing-dependent, not durably fixed.',
    allowedMemberIds: ['AI-FEAT-039'], forbiddenMemberIds: ['AI-FEAT-038'],
  },
  {
    id: 'RF-4.3-004', targetPhase: '4.3', decisionRef: 'Decision 2 of 8', auditRef: 'Audit R23',
    status: 'known-baseline-failure', category: 'ranking-normalization',
    question: 'What is Global Search and how does it relate to the Knowledge Engine?',
    rationale: 'AI-FEAT-053 ties AI-FEAT-056 at 400, both beating AI-FEAT-058 (the actually Available half of the compound question) at 300 -- reports PLANNED for a question that is genuinely half-Available. Ranking normalization should let AI-FEAT-058 compete on its real relevance; full resolution of the current+planned conflation itself may also need Phase 5.2\'s neighborhood combination -- recorded here as a ranking-tier partial fix, cross-referenced to Phase 5.2.',
    allowedMemberIds: ['AI-FEAT-058'],
  },
  {
    id: 'RF-4.3-005', targetPhase: '4.3', decisionRef: 'Decision 2 of 8', auditRef: 'Audit R29',
    status: 'known-baseline-failure', category: 'ranking-normalization',
    question: 'What is the Archive Health Reporting feature planned to include that is not built yet?',
    rationale: 'AI-FEAT-049 (a different, larger Planned feature) wins at 500, beating the actually-named AI-FEAT-043 at 300 -- a third independent instance of the same keyword-surface-size mechanism as Gap C.',
    allowedMemberIds: ['AI-FEAT-043'], forbiddenMemberIds: ['AI-FEAT-049'], expectedStatus: 'PLANNED',
  },
  {
    id: 'RF-4.3-006', targetPhase: '4.3', decisionRef: 'Decision 2 of 8', auditRef: 'Audit R09, title-substring tier control (out of Phase 4.3\'s declared scope)',
    status: 'control', category: 'ranking-normalization',
    question: 'How do I recover from an archive lock error?',
    rationale: 'Wins via the title-substring tier (500), not the keyword-overlap tier Phase 4.3 is scoped to touch -- must remain completely unaffected, proving the normalization stayed bounded to the tier Decision 2 actually authorized.',
    requiredMemberIds: ['AI-FEAT-045'], expectedStatus: 'AVAILABLE', expectedMatchQuality: 'strong',
  },
  {
    id: 'RF-4.3-007', targetPhase: '4.3', decisionRef: 'Decision 2 of 8', auditRef: 'Decision 2\'s explicit "measure whether the correction creates a new small-record bias" acceptance criterion',
    status: 'schema-placeholder', category: 'ranking-normalization',
    question: '(no single fixed question -- see rationale)',
    rationale: 'Decision 2 requires an explicit small-record-bias guard as its own acceptance criterion, not just a noted risk, but the exact formula (coverage ratio? dampened normalization? a minimum-evidence floor?) is still an open empirical choice for Phase 4.3\'s own implementation. A precise adversarial small-record probe cannot be authored blind against an unchosen formula -- Phase 4.3\'s implementation must construct and run this probe itself, against whichever formula is actually chosen, before that phase can close. Recorded here so the requirement is not lost, not answered prematurely.',
  },

  // ---------------------------------------------------------------------
  // Phase 4.4 — classifier hygiene only (Decision 6 of 8, hygiene half)
  // ---------------------------------------------------------------------
  {
    id: 'RF-4.4-001', targetPhase: '4.4', decisionRef: 'Decision 6 of 8', auditRef: 'Corrected audit finding -- label accuracy only, NOT a routing/outcome fix',
    status: 'known-baseline-failure', category: 'classifier-hygiene',
    question: 'Why does Transfer Import exist?',
    rationale: 'Classifies TROUBLESHOOTING today despite no failure/problem signal present. Per the interview correction: fixing this does NOT change routing (EXPLANATION is already workflowPreferredType too) -- this assertion checks the classification LABEL only. The retrieval outcome for this same question is separately covered by RF-4.3-001.',
    expectedClassification: 'EXPLANATION',
  },
  {
    id: 'RF-4.4-002', targetPhase: '4.4', decisionRef: 'Decision 6 of 8', auditRef: 'Genuine-failure-form control',
    status: 'control', category: 'classifier-hygiene',
    question: "Why can't I import photos from this drive?",
    rationale: 'A genuine failure-form "why" question must keep classifying TROUBLESHOOTING both before and after the narrow regex correction -- proves the fix narrows, not breaks, the pattern.',
    expectedClassification: 'TROUBLESHOOTING',
  },
  {
    id: 'RF-4.4-003', targetPhase: '4.4', decisionRef: 'Decision 6 of 8', auditRef: 'Genuine-failure-form control',
    status: 'control', category: 'classifier-hygiene',
    question: "Why won't the metadata audit complete?",
    rationale: 'Second genuine failure-form control, different verb form ("won\'t" vs "can\'t"), same purpose as RF-4.4-002.',
    expectedClassification: 'TROUBLESHOOTING',
  },

  // ---------------------------------------------------------------------
  // Phase 5.1 — relationship-visibility plumbing (Decision 4 of 8)
  // ---------------------------------------------------------------------
  {
    id: 'RF-5.1-001', targetPhase: '5.1', decisionRef: 'Decision 4 of 8', auditRef: 'Audit R14',
    status: 'known-baseline-failure', category: 'relationship-visibility',
    question: 'What went wrong with the same-size skip and metadata verification?',
    rationale: 'DEC-009 (the decision that actually created the same-size-skip rule) never surfaces for AI-FEAT-032 today -- no feature-to-decision edge exists in the live path, only feature-to-bug (BUG-009 is cited).',
    requiredMemberIds: ['DEC-009'],
  },
  {
    id: 'RF-5.1-002', targetPhase: '5.1', decisionRef: 'Decision 4 of 8', auditRef: 'Audit R21',
    status: 'known-baseline-failure', category: 'relationship-visibility',
    question: 'What is the current status of the QMZ dedicated domain workflow decision?',
    rationale: 'DEC-011 never surfaces for AI-FEAT-047 today, for the same structural reason as RF-5.1-001.',
    requiredMemberIds: ['DEC-011'],
  },
  {
    id: 'RF-5.1-003', targetPhase: '5.1', decisionRef: 'Decision 4 of 8', auditRef: "Decision 4's 'no score boosting from edge existence' rule",
    status: 'schema-placeholder', category: 'relationship-visibility',
    question: '(invariant, not a single question)',
    rationale: 'Once relationship visibility exists, a case is needed proving a record\'s ranking score is unaffected by whether a relationship edge to it exists -- cannot be constructed until Phase 5.1 introduces the mechanism this would probe.',
  },
  {
    id: 'RF-5.1-004', targetPhase: '5.1', decisionRef: 'Decision 4 of 8', auditRef: "Decision 4's 'no recursive graph expansion' rule",
    status: 'schema-placeholder', category: 'relationship-visibility',
    question: '(invariant, not a single question)',
    rationale: 'Once relationship visibility exists, a case is needed proving traversal stays single-hop (a Decision\'s own further-related records must not also become visible transitively) -- cannot be constructed until Phase 5.1 exists.',
  },

  // ---------------------------------------------------------------------
  // Phase 5.2 — minimum-sufficient multi-record neighborhoods (Decision 3)
  // ---------------------------------------------------------------------
  {
    id: 'RF-5.2-001', targetPhase: '5.2', decisionRef: 'Decision 3 of 8', auditRef: "Decision 3's 'single-record stays default' requirement",
    status: 'control', category: 'neighborhood-admission',
    question: 'How do I recover from an archive lock error?',
    rationale: 'A clean, currently-correct answer must NOT gain an unnecessary member once neighborhoods ship -- guards Decision 3\'s "minimum sufficient neighborhood," not "more records = better." Corrected at Phase 4.1 baseline time: sourcesForRecord() already, correctly, cites every linked bug regardless of status, not just open ones -- the real current baseline is 3 sources (AI-FEAT-045 + BUG-004 [Fixed, cited for traceability] + AI-WF-008 companion workflow), not 2. This is legitimate citation, not neighborhood bloat -- the cap guards against a FOURTH, unrelated member appearing.',
    requiredMemberIds: ['AI-FEAT-045'], expectedMaxSources: 3,
  },
  {
    id: 'RF-5.2-002', targetPhase: '5.2', decisionRef: 'Decision 3 of 8', auditRef: 'The Transfer Import flagship compound case -- category 7 of Decision 6\'s 10-category acceptance set',
    status: 'known-baseline-failure', category: 'neighborhood-admission',
    question: 'Why does Transfer Import exist, what limitation does Collection-nested import have, and what should I do operationally?',
    rationale: 'The flagship three-aspect worked example named throughout the interview: purpose+limitation should be answered by AI-FEAT-039, operational procedure by AI-WF-009 -- both must be admitted with distinct authority roles, neither absorbing the other\'s voice.',
    requiredMemberIds: ['AI-FEAT-039', 'AI-WF-009'],
  },

  // ---------------------------------------------------------------------
  // Phase 5.3 — Memory / Architectural Evolution historical context (Decision 5)
  // ---------------------------------------------------------------------
  {
    id: 'RF-5.3-001', targetPhase: '5.3', decisionRef: 'Decision 5 of 8', auditRef: 'AI-MEM-0004 reproduction, gathered live during the interview',
    status: 'known-baseline-failure', category: 'memory-context',
    question: "What product-owner feedback changed the design of the Online Registry's event coordination purpose?",
    rationale: "AI-MEM-0004 answers this correctly via the separate `memory query` command but is structurally excluded from Ask AutoIngest's candidate pool entirely -- today resolves to an unrelated AI-FEAT-027 at score 600, confidence 0.6. Required-but-not-sufficient acceptance case per Decision 5 -- passing this alone does not mean Phase 5.3 is complete.",
    requiredMemberIds: ['AI-MEM-0004'],
  },
  {
    id: 'RF-5.3-002', targetPhase: '5.3', decisionRef: 'Decision 5 of 8', auditRef: "Decision 5's 'simple questions must not gain Memory members' requirement",
    status: 'control', category: 'memory-context',
    question: 'Is Archive Folder Adoption available yet?',
    rationale: 'A clean, simple current-capability question must not gain a historical Memory/Architecture member merely from keyword overlap once Phase 5.3 ships.',
    requiredMemberIds: ['AI-FEAT-046'], mustNotContainMemoryRecord: true, expectedStatus: 'AVAILABLE',
  },

  // ---------------------------------------------------------------------
  // Phase 5.4 — decomposition-necessity acceptance gate (Decision 6, second half)
  // Decision 6's own required 10-category compound-question corpus.
  // ---------------------------------------------------------------------
  {
    id: 'RF-5.4-001', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 1: Feature + Workflow',
    status: 'known-baseline-failure', category: 'compound-question',
    question: 'What does Transfer Import do and how do I use it?',
    rationale: 'What-it-is (AI-FEAT-039) and how-to-use-it (AI-WF-009) are materially distinct aspects a single record cannot both authoritatively supply.',
    requiredMemberIds: ['AI-FEAT-039', 'AI-WF-009'],
  },
  {
    id: 'RF-5.4-002', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 2: Feature + Decision',
    status: 'control', category: 'compound-question',
    question: 'What does Transfer Export do and why was its locking kept process-local?',
    rationale: 'RECLASSIFIED at Phase 4.1 baseline time -- originally authored as known-baseline-failure on the assumption this needed Phase 5.2, but verified: today DEC-021 wins outright (governance-primary, score 400, untied) with AI-FEAT-038 already cited as Context via the EXISTING answerFromGovernanceRecord mechanism. Both required members are already present. A genuine, valuable finding for the Phase 5.4 gate: the existing single-primary-plus-citation architecture already covers this specific Feature+Decision shape when the Decision wins outright -- not every category in Decision 6\'s 10-category set actually requires Phase 5.2 to pass. Kept in the corpus as a control so Phase 5.2/5.4 cannot silently regress an already-working case while building the new one.',
    requiredMemberIds: ['AI-FEAT-038', 'DEC-021'],
  },
  {
    id: 'RF-5.4-003', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 3: Feature + Bug',
    status: 'control', category: 'compound-question',
    question: 'What should Transfer Export resume behavior be, and is there a known defect affecting it?',
    rationale: 'RECLASSIFIED at Phase 4.1 baseline time, same reason as RF-5.4-002: verified that today AI-FEAT-038 wins as primary (feature, score 500) with BUG-005 already present in sources via sourcesForRecord()\'s existing openBugs citation, alongside companion workflow AI-WF-005. Both required members already present -- another case where the existing feature-primary-plus-linked-citations mechanism already covers this Feature+Bug shape without needing Phase 5.2. Kept as a control to guard against regression.',
    requiredMemberIds: ['AI-FEAT-038', 'BUG-005'],
  },
  {
    id: 'RF-5.4-004', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 4: Feature + Postmortem',
    status: 'known-baseline-failure', category: 'compound-question',
    question: 'What does metadata audit and repair do today, and what incident led to it existing?',
    rationale: 'Current behavior (AI-FEAT-033) and the incident-derived lesson (PM-001) are distinct authority claims.',
    requiredMemberIds: ['AI-FEAT-033', 'PM-001'],
  },
  {
    id: 'RF-5.4-005', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 5: Feature + historical Memory/Architecture -- cross-references RF-5.3-001',
    status: 'known-baseline-failure', category: 'compound-question',
    question: "What is the Online Registry's current purpose, and how/why did that purpose get clarified over time?",
    rationale: "Current canonical state (a Registry Feature/Workflow anchor) plus historical context (AI-MEM-0004), grounded per Decision 5's canonical-anchor requirement -- distinct from RF-5.3-001's pure-historical phrasing, this tests the combined current+historical case specifically.",
    requiredMemberIds: ['AI-MEM-0004'],
  },
  {
    id: 'RF-5.4-006', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 6: Workflow + limitation/status',
    status: 'known-baseline-failure', category: 'compound-question',
    question: 'How do I import from a transfer drive, and what is the current constraint with Collection-nested transfers?',
    rationale: 'Operational procedure (AI-WF-009) plus the current documented limitation (already in AI-FEAT-039\'s own Summary per Part 2) -- both must be reachable together.',
    requiredMemberIds: ['AI-WF-009', 'AI-FEAT-039'],
  },
  {
    id: 'RF-5.4-007', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 7: three-aspect flagship -- cross-references RF-5.2-002',
    status: 'known-baseline-failure', category: 'compound-question',
    question: 'Why does Transfer Import exist, what limitation does Collection-nested import have, and what should I do operationally?',
    rationale: 'The named flagship acceptance case for the whole Part 5 effort -- see RF-5.2-002 and RF-4.3-002 for the same question tested at earlier phases.',
    requiredMemberIds: ['AI-FEAT-039', 'AI-WF-009'],
  },
  {
    id: 'RF-5.4-008', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 8: simple control -- cross-references RF-5.2-001',
    status: 'control', category: 'compound-question',
    question: 'How do I recover from an archive lock error?',
    rationale: 'A single-aspect question must remain single-record even inside the compound-question acceptance run -- see RF-5.2-001 for the corrected 3-source baseline (Feature + a Fixed-but-still-cited Bug + companion Workflow).',
    requiredMemberIds: ['AI-FEAT-045'], expectedMaxSources: 3,
  },
  {
    id: 'RF-5.4-009', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 9: compound wording, only one aspect evidenced',
    status: 'schema-placeholder', category: 'compound-question',
    question: 'Why does Transfer Import exist, and what AI-based auto-tagging does it apply to imported photos?',
    rationale: 'The second half has no supporting evidence at all -- AI-based tagging is an explicit NOT_SUPPORTED boundary (ai-auto-tagging). A correct answer supplies the first half honestly (AI-FEAT-039) without manufacturing a tagging capability for the second. Genuinely complex interaction between Phase 4.2\'s boundary handling and Phase 5.2\'s neighborhood construction -- deferred as schema-placeholder pending both phases landing, not evaluated for pass/fail yet.',
    requiredMemberIds: ['AI-FEAT-039'],
  },
  {
    id: 'RF-5.4-010', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 10: current/planned conflict -- cross-references RF-4.3-004',
    status: 'known-baseline-failure', category: 'compound-question',
    question: 'What is Global Search and how does it relate to the Knowledge Engine?',
    rationale: "Mixes a Planned record (AI-FEAT-053, Global Search) and an Available one (AI-FEAT-058, Knowledge Engine) -- Decision 3's lifecycle-distinction preservation requirement must hold even inside the compound-question acceptance run, not just the ranking-only Phase 4.3 check in RF-4.3-004.",
    allowedMemberIds: ['AI-FEAT-058'],
  },
];

module.exports = { REGRESSION_CORPUS_V3 };
