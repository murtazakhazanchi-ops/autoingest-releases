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
    status: 'control', category: 'trigger-safety',
    question: 'If my transfer drive mirrors the Collection/Event folder structure, will Transfer Import still recognize renamed events correctly?',
    rationale: 'FIXED at Phase 4.2 implementation time: the bare word "recognize" (along with "face" and "recognition") was removed from face-recognition\'s KNOWN_BOUNDARIES keyword list and replaced with specific multi-word phrases, verified corpus-wide to introduce zero new collisions while preserving exact coverage for every real corpus case the boundary must still fire on. This question no longer triggers the boundary and correctly falls through to AI-FEAT-039 (which scores 800-900 on this exact question, matching AI-FEAT-039\'s own documented "recognized as the same archival event" content). Promoted to a control so later phases cannot silently regress it.',
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
    rationale: 'EVALUATED at Phase 4.2 implementation time: "two operators" was added to team-collaboration\'s CONCEPT_CLUSTERS triggers and verified corpus-wide to introduce zero collisions. Effect on THIS question: moved the top match from AI-FEAT-002 (Login & Operator Identity, clearly irrelevant) to a 500-point tie between AI-FEAT-027 (Activity Log) and AI-FEAT-048 (Realtime Team Presence & Online Registry, genuinely on-topic), decided by ascending-ID tiebreak to AI-FEAT-027. This is a genuine but PARTIAL recall improvement -- it does not reach AI-WF-006 (the workflow with the actual relevant coordination content) or fire the registry-conflict-detection boundary, and the ascending-ID tiebreak between AI-FEAT-027/048 is itself an unresolved fairness question, not something Phase 4.2 is scoped to fix. The trigger addition is kept (net positive, zero collision cost, no regression anywhere else in the 153-question corpus) but this case is deliberately left WITHOUT a committed pass/fail assertion, since R15 is not cleanly resolved -- full resolution likely needs Decision 2\'s ranking normalization (Phase 4.3) and/or a registry-conflict-detection trigger addition, both out of Phase 4.2\'s scope.',
  },
  {
    id: 'RF-4.2-006', targetPhase: '4.2', decisionRef: 'Decision 1 of 8', auditRef: 'Audit R16 (activity-feed recall gap)',
    status: 'control', category: 'trigger-recall-candidate',
    question: "My QMZ sorting isn't showing up in the activity feed, why not?",
    rationale: 'RESOLVED at Phase 4.2 implementation time: "qmz sorting isn\'t showing up" and "metadata audit isn\'t showing up" were added to registry-activity-scope\'s BOUNDARY_CONCEPT_CLUSTERS triggers (deliberately anchored to QMZ/metadata-audit context, not a bare "isn\'t showing up in the activity feed" phrase, since Import/Transfer activity legitimately DOES publish per this same boundary\'s own definition and an unanchored phrase would have incorrectly blocked that legitimate case). Verified: this question now correctly fires the registry-activity-scope boundary (matchQuality: boundary, confidence: 1.0, capabilityStatus: NOT_SUPPORTED, exact correct explanatory text) with zero corpus-wide collisions found. A clean, complete fix -- promoted to a control so later phases cannot silently regress it.',
    requiredMemberIds: ['registry-activity-scope'], expectedMatchQuality: 'boundary',
  },

  // ---------------------------------------------------------------------
  // Phase 4.3 — keyword-surface-size normalization (Decision 2 of 8)
  // ---------------------------------------------------------------------
  {
    id: 'RF-4.3-000', targetPhase: '4.3', decisionRef: 'Decision 2 of 8 / E1-B (Approach D)', auditRef: 'The sync-slot legitimate-large-record control -- the case central to the E1 conservative-damping decision, and the exact case whose cross-type failure (DEC-003 displacing AI-WF-006) motivated E1-B',
    status: 'control', category: 'cross-type-authority-gating',
    question: 'What is the sync-slot and which workflow documents it?',
    rationale: "AI-WF-006 is large (surface 223) but genuinely, uniquely authoritative for this question -- 'sync-slot' exists exclusively in its own text. Before E1-B (Approach D), surface-size dampening reduced AI-WF-006's score enough that DEC-003 (Local-First and On-Premises Architecture, a decision whose raw score was never touched by normalization) wrongly displaced it as primary -- the exact regression that exposed the cross-entity comparability gap. Approach D (raw-score cross-type gating, adjusted-score intra-type ordering) restores AI-WF-006 as primary. Asserted via primary-record identity, not status/quality alone, so a future change cannot silently reintroduce this exact regression while still passing a looser assertion.",
    allowedMemberIds: ['AI-WF-006'], forbiddenMemberIds: ['DEC-003'],
  },
  {
    id: 'RF-4.3-001', targetPhase: '4.3', decisionRef: 'Decision 2 of 8', auditRef: 'Gap C — Audit R01',
    status: 'known-baseline-failure', category: 'ranking-normalization',
    question: 'Why does Transfer Import exist?',
    rationale: 'AI-WF-006 (large keyword surface) beats AI-WF-009 (correctly relevant, smaller surface) 300 to 200 via incidental token overlap. The canonical Gap C reproduction.',
    allowedMemberIds: ['AI-FEAT-039', 'AI-WF-009'], forbiddenMemberIds: ['AI-WF-006'],
  },
  {
    id: 'RF-4.3-002', targetPhase: '4.3', decisionRef: 'Decision 2 of 8', auditRef: 'Gap C — Audit R02 (exact Remediation Plan / brief phrasing)',
    status: 'control', category: 'ranking-normalization',
    question: 'Why does Transfer Import exist, what limitation does Collection-nested import have, and what should I do operationally?',
    rationale: 'FIXED as a side effect of the Part 4 closure / Phase 4.3 extension (absolute-evidence-first ordering, Product Owner approved): AI-WF-009/AI-FEAT-039 both carry 4 matched tokens versus AI-WF-006\'s same 4 -- previously decided by adjusted score alone (which favored AI-WF-006\'s smaller-delta damping); now AI-FEAT-039 (on the allowedMemberIds list) wins outright once the ascending-ID tiebreak among the equal-token group applies AFTER token parity is confirmed, no longer distorted by the unrelated AI-FEAT-041 (3 tokens) intruding above the 4-token group. Promoted to a control so a later phase cannot silently regress it. Originally: live reproduction of the brief\'s own flagship worked example — AI-WF-006 ties AI-WF-009 at 400, decided by ascending-ID tiebreak, not relevance.',
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
    status: 'control', category: 'classifier-hygiene',
    question: 'Why does Transfer Import exist?',
    rationale: 'FIXED at Phase 4.4 implementation time: narrowed questionClassifier.js\'s TROUBLESHOOTING rule from "why (can\'?t|won\'?t|does(n\'?t)?)" to "why (can\'?t|won\'?t|doesn\'?t)" (dropping the bare "does" alternative) and added a "why is/was/does ... exist/design/create/.../authoritative" alternative to the EXPLANATION rule. Classifies EXPLANATION now, matching this assertion. Per the interview correction: fixing this does NOT change routing (EXPLANATION is already workflowPreferredType too) -- this assertion checks the classification LABEL only. The retrieval outcome for this same question is separately covered by RF-4.3-001, which remains a known-baseline-failure (Gap C itself is unaffected -- this is a label-hygiene fix, not a ranking fix). Promoted to a control so a later phase cannot silently regress the classification.',
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
    status: 'control', category: 'relationship-visibility',
    question: 'What went wrong with the same-size skip and metadata verification?',
    rationale: 'FIXED at Phase 5.1 (Decision 4) implementation time: DEC-009 (the decision that actually created the same-size-skip rule) now correctly appears in AI-FEAT-032\'s sources, alongside the pre-existing BUG-009 and the newly-visible PM-001 -- governanceRelationshipsForFeature() reads authorityIndex\'s relatedDecisions/relatedPostmortems (a direct, fidelity-audited projection of AI-FEAT-032\'s own canonical Lifecycle Metadata table), never a second parse. Visibility only -- AI-FEAT-032 remains primary at the identical score it had before this phase; DEC-009 never became a scored candidate. Promoted to a control so a later phase cannot silently regress it.',
    requiredMemberIds: ['DEC-009'],
  },
  {
    id: 'RF-5.1-002', targetPhase: '5.1', decisionRef: 'Decision 4 of 8', auditRef: 'Audit R21',
    status: 'control', category: 'relationship-visibility',
    question: 'What is the current status of the QMZ dedicated domain workflow decision?',
    rationale: 'FIXED at Phase 5.1 (Decision 4) implementation time, same mechanism and same visibility-only proof as RF-5.1-001: DEC-011 now correctly appears in AI-FEAT-047\'s sources alongside pre-existing BUG-007 and newly-visible PM-001. AI-FEAT-047 remains primary at the identical score. Promoted to a control.',
    requiredMemberIds: ['DEC-011'],
  },
  {
    id: 'RF-5.1-003', targetPhase: '5.1', decisionRef: 'Decision 4 of 8', auditRef: "Decision 4's 'no score boosting from edge existence' rule",
    status: 'control', category: 'relationship-visibility',
    question: 'What is the current status of the QMZ dedicated domain workflow decision?',
    rationale: 'GIVEN A REAL ASSERTION at Phase 5.1 implementation time (mechanism now exists to probe): AI-FEAT-047 confidence pinned to exactly 0.85 (= min(1, 850/1000), pure function of query.js/Phase 4.3\'s own score, computed and finalized entirely before governanceRelationshipsForFeature() ever runs). sourcesForRecord() appends relationship citations strictly after quality/confidence are already decided in answerFromRecord() -- there is no code path by which a visible DEC-011/PM-001 relationship could feed back into this number. Same mechanism proven for AI-FEAT-032 at RF-5.1-001 (confidence 0.4, also unaffected).',
    requiredMemberIds: ['DEC-011'], expectedConfidenceRange: [0.85, 0.85],
  },
  {
    id: 'RF-5.1-004', targetPhase: '5.1', decisionRef: 'Decision 4 of 8', auditRef: "Decision 4's 'no recursive graph expansion' rule",
    status: 'control', category: 'relationship-visibility',
    question: 'What went wrong with the same-size skip and metadata verification?',
    rationale: 'GIVEN A REAL ASSERTION at Phase 5.1 implementation time: DEC-009 (visible via AI-FEAT-032, per RF-5.1-001) itself cites TWO related features in its own canonical header (AI-FEAT-019, AI-FEAT-032) -- the schema itself has no decision-to-decision or decision-to-bug field to recurse into (governance records only ever cite Feature(s), never each other), but this proves the one cross-feature edge that DOES exist (DEC-009 -> AI-FEAT-019) is never followed. The real (legitimate, non-recursive) source list is exactly 6: AI-FEAT-032 + AI-RM-001 (roadmap) + BUG-009 + DEC-009 + PM-001 + AI-WF-009 (companion workflow). expectedMaxSources pins this exact count -- if AI-FEAT-019 were incorrectly pulled in transitively via DEC-009\'s own citation, the count would be 7 and this control would fail. (forbiddenMemberIds cannot express this -- it only checks the PRIMARY position, and AI-FEAT-019 was never at risk of becoming primary; the real risk is a silent extra SOURCE, which only expectedMaxSources catches.) governanceRelationshipsForFeature() only ever reads the PRIMARY record\'s own relatedDecisions/relatedPostmortems list -- it never inspects what those decisions/postmortems themselves cite.',
    requiredMemberIds: ['DEC-009'], expectedMaxSources: 6,
  },

  // ---------------------------------------------------------------------
  // Phase 5.2 — minimum-sufficient multi-record neighborhoods (Decision 3)
  // ---------------------------------------------------------------------
  {
    id: 'RF-5.2-001', targetPhase: '5.2', decisionRef: 'Decision 3 of 8', auditRef: "Decision 3's 'single-record stays default' requirement",
    status: 'control', category: 'neighborhood-admission',
    question: 'How do I recover from an archive lock error?',
    rationale: 'A clean, currently-correct answer must NOT gain an unnecessary member once neighborhoods ship -- guards Decision 3\'s "minimum sufficient neighborhood," not "more records = better." Corrected at Phase 4.1 baseline time: sourcesForRecord() already, correctly, cites every linked bug regardless of status, not just open ones -- the real baseline then was 3 sources (AI-FEAT-045 + BUG-004 [Fixed, cited for traceability] + AI-WF-008 companion workflow). Corrected AGAIN at Phase 5.1 (Decision 4, relationship visibility): AI-FEAT-045\'s own canonical "Related decisions" field cites DEC-013 (Lock Clearing Must Be Constrained) -- directly on-topic for this exact question, not neighborhood bloat, the same legitimate-citation reasoning already applied to BUG-004 above. New baseline is 4 sources (AI-FEAT-045 + BUG-004 + DEC-013 + AI-WF-008). The cap still guards against a FIFTH, unrelated member appearing.',
    requiredMemberIds: ['AI-FEAT-045'], expectedMaxSources: 4,
  },
  {
    id: 'RF-5.2-002', targetPhase: '5.2', decisionRef: 'Decision 3 of 8', auditRef: 'The Transfer Import flagship compound case -- category 7 of Decision 6\'s 10-category acceptance set',
    status: 'control', category: 'neighborhood-admission',
    question: 'Why does Transfer Import exist, what limitation does Collection-nested import have, and what should I do operationally?',
    rationale: 'FIXED at Phase 5.2 (Decision 3) implementation time: findCompanionWorkflow() now prefers the independently-highest-scoring candidate (in the SAME single retrieval pass, no decomposition) when a Feature has more than one real candidate companion Workflow -- found: AI-FEAT-039 is cited by both AI-WF-005 ("Export...") and AI-WF-009 ("Import..."), and the old lowest-ID tiebreak picked AI-WF-005 (wrong direction) purely because "05" < "09". AI-WF-009 (raw 400/4 tokens, adjusted 243.4) now correctly wins over AI-WF-005 (raw 200/2 tokens, adjusted 133.7) for this import-focused question. Purpose+limitation are both already answered by AI-FEAT-039\'s own existing canonical Summary/Current-Behavior text (the direct-Event-vs-Collection-nested distinction is already explicit there, unchanged) -- no Decision/Bug was required or fabricated for the "limitation" aspect. Current real neighborhood: AI-FEAT-039 (primary) + DEC-012 (Phase 5.1 visibility, Archive Root Resolution Requires Evidence -- a real but tangential related decision; disclosed known imprecision of the classification-based materiality gate, see DEC-020) + AI-WF-009 (procedure). Promoted to a control; expectedMaxSources guards against further, unrelated growth.',
    requiredMemberIds: ['AI-FEAT-039', 'AI-WF-009'], expectedMaxSources: 3,
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
    rationale: 'What-it-is (AI-FEAT-039) and how-to-use-it (AI-WF-009) are materially distinct aspects a single record cannot both authoritatively supply. STRENGTHENED at Phase 4.3 (E1-B): the original requiredMemberIds-only assertion passed even though the real primary is AI-FEAT-032 (Metadata Verification, unrelated) -- a Decision 7 harness-coverage gap exposed by Phase 4.3, not a Phase 4.3 regression itself (this is the same pre-existing feature-vs-feature near-tie limitation as Gap-C-short, unaffected by the E1-B governance fix since no governance record is involved here). AI-FEAT-039/AI-WF-009 are both still present as required (AI-FEAT-039 in matchedCapabilities, AI-WF-009 in sources), but the assertion now also confirms the wrong primary is not silently accepted.',
    requiredMemberIds: ['AI-FEAT-039', 'AI-WF-009'], forbiddenMemberIds: ['AI-FEAT-032'],
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
    status: 'control', category: 'compound-question',
    question: 'How do I import from a transfer drive, and what is the current constraint with Collection-nested transfers?',
    rationale: 'FIXED as a side effect of Phase 5.2\'s findCompanionWorkflow() improvement (see RF-5.2-002): AI-WF-009 now correctly appears (this question\'s primary is AI-FEAT-038 via the pre-existing, disclosed, out-of-scope Gap-A/R05 concept-hint mechanism -- unaffected by, and unrelated to, this fix; AI-FEAT-039 was already independently present in matchedCapabilities at score 436, satisfying its own requirement). Operational procedure (AI-WF-009) plus the current documented limitation (already in AI-FEAT-039\'s own Summary) both reachable together. Promoted to a control.',
    requiredMemberIds: ['AI-WF-009', 'AI-FEAT-039'],
  },
  {
    id: 'RF-5.4-007', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 7: three-aspect flagship -- cross-references RF-5.2-002',
    status: 'control', category: 'compound-question',
    question: 'Why does Transfer Import exist, what limitation does Collection-nested import have, and what should I do operationally?',
    rationale: 'FIXED at Phase 5.2 -- identical question and identical fix as RF-5.2-002 (see that entry for the full account). The named flagship acceptance case for the whole Part 5 effort. Promoted to a control.',
    requiredMemberIds: ['AI-FEAT-039', 'AI-WF-009'], expectedMaxSources: 3,
  },
  {
    id: 'RF-5.4-008', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 8: simple control -- cross-references RF-5.2-001',
    status: 'control', category: 'compound-question',
    question: 'How do I recover from an archive lock error?',
    rationale: 'A single-aspect question must remain single-record even inside the compound-question acceptance run -- see RF-5.2-001 for the corrected 4-source baseline (Feature + a Fixed-but-still-cited Bug + a directly on-topic related Decision, DEC-013, visible since Phase 5.1 + companion Workflow).',
    requiredMemberIds: ['AI-FEAT-045'], expectedMaxSources: 4,
  },
  {
    id: 'RF-5.4-009', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 9: compound wording, only one aspect evidenced',
    status: 'control', category: 'compound-question',
    question: 'Why does Transfer Import exist, and what AI-based auto-tagging does it apply to imported photos?',
    rationale: 'EVALUATED at Phase 5.2 implementation time (the assertion vocabulary now exists; promoted from schema-placeholder to a real, passing assertion): the boundary-precedence check in answerQuestion() (Phase 4.2 territory) runs before Feature-primary resolution, so this question\'s top-level directAnswer/capabilityStatus is the ai-auto-tagging NOT_SUPPORTED boundary decline -- correctly honest, never manufactures a tagging capability. AI-FEAT-039 IS present (boundaryAnswer() passes the full scored featureMatches through as matchedCapabilities, unchanged Phase 4.2 behavior), satisfying this assertion\'s presence-only bar. DISCLOSED, NOT FIXED, genuinely narrower finding: the directAnswer PROSE itself narrates only the boundary decline, never surfacing AI-FEAT-039\'s own "why Transfer Import exists" content in the user-facing text, even though the record is structurally present in the data. The corpus\'s requiredMemberIds vocabulary checks structural presence, not prose narration, and does not capture this gap -- recorded here honestly rather than silently assumed solved. Fixing the boundary-answer\'s own directAnswer synthesis to layer in a co-supported aspect is Phase-4.2-adjacent, tested, protected logic, out of Decision 3\'s narrow remit -- left open for a future, separately-authorized phase.',
    requiredMemberIds: ['AI-FEAT-039'],
  },
  {
    id: 'RF-5.4-010', targetPhase: '5.4', decisionRef: 'Decision 6 of 8', auditRef: 'Decision 6 category 10: current/planned conflict -- cross-references RF-4.3-004',
    status: 'known-baseline-failure', category: 'compound-question',
    question: 'What is Global Search and how does it relate to the Knowledge Engine?',
    rationale: "Mixes a Planned record (AI-FEAT-053, Global Search) and an Available one (AI-FEAT-058, Knowledge Engine) -- Decision 3's lifecycle-distinction preservation requirement must hold even inside the compound-question acceptance run, not just the ranking-only Phase 4.3 check in RF-4.3-004.",
    allowedMemberIds: ['AI-FEAT-058'],
  },

  // ---------------------------------------------------------------------
  // Phase 4.3 extension investigation (Part 4 closure / standalone-test
  // reconciliation) — PROPOSED controls only, reproducing the two genuine
  // regressions surfaced by the four standalone-test failures. Not yet
  // authorized: these currently FAIL (status: known-baseline-failure) and
  // must remain failing until a Product-Owner-approved safety guard is
  // implemented. Added so the hardened harness — not only the four
  // standalone unit tests, which V1/V2's coarser status/quality-only
  // schema had already proven insufficient to catch C/D — has a permanent,
  // committed reproduction of both regressions going forward.
  // ---------------------------------------------------------------------
  {
    id: 'RF-4.3-EXT-001', targetPhase: '4.3-ext', decisionRef: 'Decision 2 of 8 (extension, Product Owner reviewed 2026-08-17)', auditRef: 'Part 4 closure reconciliation — standalone test A (knowledge.test.js drone-footage hallucination guard)',
    status: 'known-baseline-failure', category: 'normalization-safety',
    question: 'Does AutoIngest support drone footage import with GPS flight paths?',
    rationale: 'HIGH-PRIORITY DEFERRED RETRIEVAL-SAFETY DEFECT — explicitly reviewed and left OPEN by Product Owner decision (2026-08-17), not accepted as correct behavior. No canonical Feature/Workflow documents drone footage or GPS flight-path import. Phase 4.2 baseline: AI-FEAT-032/AI-FEAT-018 raw-tied at 200 (2 tokens each, equal absolute evidence), matchQuality correctly "weak". Phase 4.3 normalization breaks the tie (AI-FEAT-032 surface 18, at/below REF, undamped at 200; AI-FEAT-018 surface 27, damped to ~180) into a confident, untied "strong" AVAILABLE — a hallucination-guard violation: an untied normalized winner is being read as stronger evidence when the underlying absolute evidence was, and remains, equal. The Part 4 closure investigation proved this cannot be fixed by blanket raw-tie-preserves-quality (Approach A) without an unacceptable trade: doing so also fixes this case but creates 3 new unexplained V2 regressions (P01a, R01, R08) and reverts three already-accepted improvements (Q18, R15, R23) — proven, not assumed, because raw score is always exactly 100x matchedTokenCount for this tier, so "raw tie" and "equal-token tie" are the identical, structurally indistinguishable condition in both the bad case (this one) and the good cases. Open architectural question for a future, separately-authorized retrieval-safety phase: "How should Ask AutoIngest determine that an untied normalized winner has enough topical evidence to justify STRONG AVAILABLE, rather than merely being the least-bad member of an originally ambiguous evidence set?" Do not weaken this assertion, add a knownLimitation to mask it, or mark it resolved without a new Product Owner-approved mechanism. (Note: the numeric `confidence` field is NOT a usable proxy for this check — at raw score 200 it computes to 0.2 regardless of quality label; matchQuality is the correct, and only, reliable signal here.)',
    expectedMatchQuality: 'weak',
  },
  {
    id: 'RF-4.3-EXT-002', targetPhase: '4.3-ext', decisionRef: 'Decision 2 of 8 (extension, Product Owner approved)', auditRef: 'Part 4 closure reconciliation — standalone tests C/D (knowledgeEventCoordination.test.js, knowledgeHallucinationV2.test.js)',
    status: 'control', category: 'normalization-safety',
    question: 'How does archive locking differ from the Online Registry?',
    rationale: 'FIXED by the Part 4 closure / Phase 4.3 extension (absolute-evidence-first ordering, Product Owner approved 2026-08-17): AI-WF-006 (4 matched tokens) now correctly outranks AI-FEAT-048 (3 tokens) regardless of surface-size damping, both in searchCandidates()\'s ordering and in the workflowClearlyBeaten cross-type-but-same-calibration comparison. AI-WF-006 is primary again (213.9), matchQuality strong, matching this assertion. History: Phase 4.2 baseline had AI-WF-006 cleanly winning (raw 400/4 tokens vs AI-FEAT-048\'s raw 300/3 tokens, the only record whose own text draws this exact distinction — AI-FEAT-048 has zero occurrences of "lock"/"locking"). Phase 4.3\'s surface-size normalization alone (pre-extension) suppressed that genuine absolute-evidence advantage purely because AI-WF-006\'s surface (223) is larger than AI-FEAT-048\'s (40) — a real, previously-undisclosed regression, also present unasserted in V2\'s own R16 entry (which does not check primary identity). Promoted to a control so a later phase cannot silently regress it.',
    allowedMemberIds: ['AI-WF-006'], forbiddenMemberIds: ['AI-FEAT-048'], expectedMatchQuality: 'strong',
  },
  // RF-4.3-000 (sync-slot, "What is the sync-slot and which workflow
  // documents it?") is RETAINED UNCHANGED as the control proving any
  // extension guard must not regress the already-approved Approach D
  // behavior — see its own entry above, not duplicated here.
];

module.exports = { REGRESSION_CORPUS_V3 };
