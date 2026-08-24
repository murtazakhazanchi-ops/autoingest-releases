'use strict';

// Phase C6.3 (Section N) — the original 27-question Product Owner
// acceptance-trial's 22 TYPED questions (Q1-13, N1-9), promoted to a
// DURABLE retrieval regression gate. This never existed as a regression
// gate before — the trial that produced these questions was a one-time
// inspection (ASK_AUTOINGEST_ACCEPTANCE_TRIAL_REPORT.md), and neither C6.1
// nor C6.2 ran against it as a pass/fail check. Building this gate for
// C6.3 is itself how N1's original regression (a Product Owner-visible
// question, outside every prior formal corpus) went uncaught until now —
// and, in the process of building it, surfaced Q3/Q6/N4 as three FURTHER
// wrong-primary cases neither C6.1 nor C6.2 introduced: independently
// verified (this file's own header investigation, C6.3 checkpoint) against
// a scratch checkout of commit e2c3c1b (C6.1's own commit) that these three
// were ALREADY wrong at that commit, unrelated to any C6.2/C6.3 work — a
// pre-existing gap this gate closes going forward, not a new regression.
//
// Excludes the 5 Related-topic pill clicks (R-011/R-012/R-017/R-018/R-038)
// per the checkpoint brief's explicit instruction — those resolve via
// answerForKnownRecord()'s direct exact-ID lookup (see knowledgeEngine.js's
// own header comment on that function), never through runQuery()/
// searchCandidates(), so they carry no fuzzy-retrieval risk this gate is
// for.
//
// goldLabel/allowedMemberIds were derived independently, from each
// candidate record's own canonical title/summary (current build), before
// re-running this corpus — not by copying whatever the engine currently
// returns. Where the original acceptance trial's own report already
// established the correct evidence for a question (e.g. N4 -> DEC-005,
// explicitly named in the report's §15), that finding is used as the gold
// label. Where a question is genuinely, defensibly answerable by more than
// one real record, goldLabel is 'NO_SINGLE_PRIMARY' with every defensible
// id listed — never a single id picked merely for test convenience.
//
// priorAcceptance/priorRootCause: the ORIGINAL acceptance trial's own
// verdict and root-cause classification (§5-6, §25 of the report) — kept
// for context, never used as the gold label itself (the trial predates
// C6.1 entirely; several of its "root cause: not retrieval" questions are
// independently re-verified WRONG at the retrieval layer today, see
// rationale per entry).
//
// Two questions (Q8, Q11) do not reduce to a clean single-record pass/fail
// by their nature (Q8 is a genuine knowledge-gap/boundary case with no
// GPS-specific record to name; Q11 is ROADMAP-routed, never a searchIndex
// record at all) — flagged via `specialCase` rather than forced into
// allowedMemberIds.

const PRODUCT_OWNER_GATE_22 = [
  { id: 'Q1', question: 'How do I import photographs from an SD card?',
    goldLabel: 'AI-WF-001', allowedMemberIds: ['AI-WF-001'],
    priorAcceptance: 'NEEDS_REFINEMENT', priorRootCause: 'C (synthesis prompt dropped steps) — retrieval already correct',
    rationale: 'AI-WF-001 is literally titled "Import Photographs From a Memory Card or Folder" — the direct HOW_TO match.' },

  { id: 'Q2', question: 'What is QMZ?',
    goldLabel: 'AI-FEAT-047', allowedMemberIds: ['AI-FEAT-047'],
    priorAcceptance: 'NEEDS_REFINEMENT', priorRootCause: 'C (synthesis documentation-dump) — retrieval already correct',
    rationale: 'AI-FEAT-047 (QMZ Sequencing Workspace) is QMZ\'s own canonical feature record; a definitional "what is" question is a Feature-primary EXPLANATION case.' },

  { id: 'Q3', question: 'How do I sort QMZ photos?',
    goldLabel: 'AI-WF-007', allowedMemberIds: ['AI-WF-007'],
    priorAcceptance: 'INCORRECT', priorRootCause: 'C (synthesis dropped the 3-step list) — original report describes retrieval as having found "the correct 3-step list"',
    rationale: 'AI-WF-007 is literally titled "Sort QMZ Photographs" — the direct HOW_TO workflow match. Independently verified (this checkpoint) that the CURRENT primary, AI-FEAT-047 (the general QMZ feature, not the sorting workflow), is ALREADY the result at commit e2c3c1b (C6.1\'s own commit) — a pre-existing wrong-primary this gate did not previously catch, not something C6.2/C6.3 introduced.' },

  { id: 'Q4', question: 'What should I do if a transfer stops halfway?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-040', 'AI-WF-005', 'AI-WF-009', 'BUG-005'],
    priorAcceptance: 'NEEDS_REFINEMENT', priorRootCause: 'B (evidence selection: mismatched directAnswer vs. correct steps)',
    rationale: 'Genuinely underspecified (export or import direction unstated); any of the transfer-resume-relevant records is defensible. Secondary finding (not fixed, out of C6.3 scope): "stops" does not match questionClassifier.js\'s TROUBLESHOOTING regex (which requires "stopped", past tense only) — this question classifies UNKNOWN, a pre-existing classifier gap.' },

  { id: 'Q5', question: 'How do I create a Transfer Export?',
    goldLabel: 'AI-FEAT-038', allowedMemberIds: ['AI-FEAT-038'],
    priorAcceptance: 'INCORRECT', priorRootCause: 'A (retrieval) — fixed by C6.1\'s identity-mention tier',
    rationale: 'Exact title/alias mention. C6.1\'s own headline fix; must never regress.' },

  { id: 'Q6', question: 'Why was Transfer Export locking kept process-local?',
    goldLabel: 'DEC-021', allowedMemberIds: ['DEC-021'],
    priorAcceptance: 'NEEDS_REFINEMENT', priorRootCause: 'B (stray "Option 2." artifact leaked from DEC-021\'s own text) — retrieval already correct (DEC-021 primary)',
    rationale: 'A legitimate governance-primary WHY question about a specific documented decision. Independently verified (this checkpoint) that the CURRENT primary, AI-FEAT-038 (the feature, not the decision explaining its locking design), is ALREADY the result at commit e2c3c1b — pre-existing, not C6.2/C6.3-introduced. Secondary finding: "kept" does not match the EXPLANATION regex\'s purpose-word list (exist/created/designed/built/architected/...), so this question classifies UNKNOWN, a pre-existing classifier gap contributing to why the governance-primary path is never reached.' },

  { id: 'Q7', question: 'Does AutoIngest support face recognition?',
    goldLabel: 'SHOULD_WITHHOLD', allowedMemberIds: [],
    priorAcceptance: 'ACCEPT', priorRootCause: 'none — correct curated NOT_SUPPORTED boundary',
    rationale: 'No face-recognition capability is documented anywhere; the curated boundary correctly declines.' },

  { id: 'Q8', question: 'Does AutoIngest support drone footage or GPS metadata?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: [],
    specialCase: 'knowledge-gap', priorAcceptance: 'NEEDS_REFINEMENT', priorRootCause: 'E (knowledge gap — no GPS-specific record exists at all)',
    rationale: 'Explicitly out of C6.3\'s retrieval-scoring scope: no record documents GPS/drone handling one way or the other, so no candidate id can be "correct." Graded leniently — pass if capabilityStatus is PLANNED or NOT_SUPPORTED (an honest non-affirmative outcome), fail only on a false AVAILABLE claim.' },

  { id: 'Q9', question: 'Does AutoIngest support system status monitoring?',
    goldLabel: 'AI-FEAT-003', allowedMemberIds: ['AI-FEAT-003'],
    priorAcceptance: 'CORRECTLY_WITHHELD', priorRootCause: 'none at the retrieval layer — the C5.1 local-judge synthesis gate (a separate layer, see Section X) downgraded this to withheld after retrieval already found real evidence',
    rationale: 'AI-FEAT-003 (Dashboard & System Status) is real, on-topic AVAILABLE/PARTIALLY_AVAILABLE evidence at the retrieval layer — this gate measures retrieval, not the downstream C5.1 authority gate, which may still legitimately withhold the final synthesized answer.' },

  { id: 'Q10', question: 'Does AutoIngest collect telemetry?',
    goldLabel: 'SHOULD_WITHHOLD', allowedMemberIds: [],
    priorAcceptance: 'CORRECTLY_WITHHELD', priorRootCause: 'none — correctly withheld at the retrieval layer itself (matchQuality none)',
    rationale: 'Retrieval itself declines (not merely a downstream judge downgrade) — must remain withheld.' },

  { id: 'Q11', question: "What's coming next in AutoIngest?",
    goldLabel: 'ROADMAP', allowedMemberIds: [],
    specialCase: 'roadmap', priorAcceptance: 'ACCEPT', priorRootCause: 'none (D: presentation-only "Uncertain" badge mislabel, not a content defect)',
    rationale: 'Routes via roadmapAnswer() directly from the dashboard, never through searchCandidates() — pass/fail is "classification === ROADMAP", not a record id.' },

  { id: 'Q12', question: 'What is the Online Registry?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-048', 'AI-WF-006'],
    priorAcceptance: 'ACCEPT', priorRootCause: 'none',
    rationale: 'Defensible either way: AI-FEAT-048 (the feature) for a technical explanation, AI-WF-006 (the workflow) for practical collaboration-purpose content — knowledgeEngine.js\'s own TEAM_ACTIVITY comment (search "sync-slot coordination") documents this exact tension for closely related wording ("What is the Online Registry FOR?").' },

  { id: 'Q13', question: 'Why does Transfer Import exist?',
    goldLabel: 'AI-FEAT-039', allowedMemberIds: ['AI-FEAT-039'],
    priorAcceptance: 'INCORRECT', priorRootCause: 'A (retrieval) — fixed by C6.1\'s identity-mention tier',
    rationale: 'C6.1\'s own second headline fix; must never regress.' },

  { id: 'N1', question: 'Where do my photos actually end up after an import finishes?',
    goldLabel: 'AI-WF-001', allowedMemberIds: ['AI-WF-001'],
    priorAcceptance: 'NEEDS_REFINEMENT', priorRootCause: 'A (retrieval) — C6.2 hint injection made this WORSE (AI-FEAT-011 -> AI-FEAT-002), fully forensically traced in this checkpoint\'s report',
    rationale: 'AI-WF-001 ("Import Photographs From a Memory Card or Folder") is the objectively best-scoring real candidate in the whole pool (verified: raw 600, adjusted 470.2 — see this checkpoint\'s N1 forensic trace) but is structurally excluded from NAVIGATION-classified primary selection today. The single most important entry in this gate.' },

  { id: 'N2', question: "How does AutoIngest decide which photographer's folder a file belongs in?",
    goldLabel: 'AI-FEAT-022', allowedMemberIds: ['AI-FEAT-022'],
    priorAcceptance: 'CORRECTLY_WITHHELD', priorRootCause: 'none at the retrieval layer — C5.1 judge downgrade (claim unmatched), a separate layer',
    rationale: 'AI-FEAT-022 (Photographer-Folder Resolution) is the exact, on-topic record; retrieval itself finds it correctly, independent of whatever the downstream judge later does with it.' },

  { id: 'N3', question: 'Can I start a new event partway through an import?',
    goldLabel: 'SHOULD_WITHHOLD', allowedMemberIds: [],
    forbiddenMemberIds: ['AI-FEAT-045'],
    priorAcceptance: 'CORRECTLY_WITHHELD', priorRootCause: 'none reported at the retrieval layer originally',
    rationale: 'No record documents mid-import event-creation sequencing one way or the other. Independently verified (this checkpoint) that retrieval currently returns AI-FEAT-045 (Archive Lock Handling) with matchQuality "strong" (unhedged) — topically unrelated to the question asked, a real finding surfaced by this gate\'s construction, disclosed but not fixed (outside C6.3\'s scoring-competition scope; no concept cluster targets this phrasing).' },

  { id: 'N4', question: 'Does AutoIngest keep the original file dates when it renames files?',
    goldLabel: 'DEC-005', allowedMemberIds: ['DEC-005'],
    priorAcceptance: 'CORRECTLY_WITHHELD', priorRootCause: 'none at the retrieval layer — the original report\'s own §15 explicitly names DEC-005 ("Original Preservation and Non-Destructive Ingest") as the real evidence retrieval found, before the C5.1 judge separately downgraded it',
    rationale: 'Independently verified (this checkpoint) that the CURRENT primary, AI-FEAT-024 (Source Cleanup, topically unrelated), is ALREADY the result at commit e2c3c1b — pre-existing, not C6.2/C6.3-introduced. DEC-005 is real, on-topic, previously-confirmed evidence that has silently stopped being the primary.' },

  { id: 'N5', question: 'What happens to RAW files versus JPEGs during ingest — are they treated differently?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-019', 'DEC-006'],
    priorAcceptance: 'NEEDS_REFINEMENT', priorRootCause: 'none flagged (not in the root-cause-A list)',
    rationale: 'AI-FEAT-019 (Import Pipeline & Copy Engine) covers copy-time RAW/JPEG handling; DEC-006 ("RAW Files Use XMP Sidecars") is the specific decision behind it — both are defensible for a COMPARISON-classified question.' },

  { id: 'N6', question: 'I exported a Transfer yesterday — can I export the same event again today?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-038', 'AI-FEAT-040', 'DEC-010'],
    priorAcceptance: 'NEEDS_REFINEMENT', priorRootCause: 'A (retrieval) — still wrong today',
    rationale: 'A repeat-export/idempotency question; AI-FEAT-038 (Transfer Export itself), AI-FEAT-040 (Backup Update Scanning\'s update-mode semantics), and DEC-010 ("Transfer Update Is Missing-Files-Only") are all directly on-topic. Independently verified (this checkpoint) that the current primary, AI-FEAT-041 (Transfer Background/Minimize Operation — merely about running non-blockingly), is topically unrelated to the question asked.' },

  { id: 'N7', question: 'Will AutoIngest overwrite my archive if I run an update?',
    goldLabel: 'AI-FEAT-019', allowedMemberIds: ['AI-FEAT-019'],
    priorAcceptance: 'ACCEPT', priorRootCause: 'none',
    rationale: 'The original report\'s own quoted answer text ("AutoIngest does not overwrite files; it renames conflicts") is AI-FEAT-019\'s same-file-skip/conflict-rename copy-engine behavior — already correct.' },

  { id: 'N8', question: "My QMZ folder looks empty even though I know there are photos in it — what's going on?",
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-047', 'AI-WF-007'],
    priorAcceptance: 'INCORRECT', priorRootCause: 'A (retrieval) per the root-cause table, though the report\'s own narrative (defect #4) frames this as symptom-acknowledgment/synthesis-prompt failure (identical essay regardless of framing), not a wrong TOPIC',
    rationale: 'Graded leniently here (both the general QMZ feature and the sorting workflow accepted) because the underlying topic (QMZ) IS correctly retrieved; the documented defect is that troubleshooting-specific framing produces the same generic essay as a definition question — a synthesis-prompt issue, out of C6.3\'s retrieval-scoring scope.' },

  { id: 'N9', question: 'Why do some imported files show up with a warning icon next to them?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-032', 'AI-FEAT-020', 'AI-FEAT-026'],
    forbiddenMemberIds: ['AI-FEAT-054'],
    priorAcceptance: 'INCORRECT', priorRootCause: 'A (retrieval) — still wrong today',
    rationale: 'A warning icon after import most plausibly indicates a verification failure (AI-FEAT-032), a detected duplicate (AI-FEAT-020), or an audit count mismatch (AI-FEAT-026) — all real, AVAILABLE, on-topic candidates. AI-FEAT-054 (Integrity Verification — Archive-Wide) is explicitly wrong: it is a PLANNED-status record, and the question\'s own premise ("some imported files show up with a warning icon") establishes this behavior already happens today, which a PLANNED capability cannot be the true explanation for.' },
];

const seenIds = new Set();
for (const e of PRODUCT_OWNER_GATE_22) {
  if (seenIds.has(e.id)) throw new Error(`Duplicate Product Owner gate id: ${e.id}`);
  seenIds.add(e.id);
}
if (PRODUCT_OWNER_GATE_22.length !== 22) throw new Error(`Expected exactly 22 entries, found ${PRODUCT_OWNER_GATE_22.length}`);

module.exports = { PRODUCT_OWNER_GATE_22 };
