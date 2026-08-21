'use strict';

// Phase C6 — dedicated retrieval-quality evaluation corpus. Built for the
// Product Owner's post-C5.2 acceptance trial finding that retrieval (not
// synthesis) is the dominant remaining answer-quality problem (~43% of all
// flagged acceptance cases). This corpus evaluates ONE thing: does
// answerQuestion() select the correct primary record BEFORE synthesis ever
// runs. It is deliberately separate from knowledgeTestCorpus.js/
// knowledgeTestCorpusV2.js/knowledgeRegressionCorpusV3.js (which stay
// byte-for-byte unchanged) — those corpora assert status/matchQuality/
// member-presence for many purposes; this one asserts PRIMARY IDENTITY
// specifically, with an explicit dev/holdout split so a retrieval fix's
// generalization (not just its fit to known failing cases) can be measured
// honestly.
//
// Every gold label below is derived from the real corpus (lib/searchIndex.js
// titles/summaries via lib/build.js), never from what the engine currently
// returns — see each entry's `rationale`. Three entries (C6-DEV-Q5,
// C6-DEV-Q13, C6-DEV-ARCHMAINT) were the exact cases used to diagnose and
// design the C6 fix (lib/query.js's identity-mention tier) and are
// DELIBERATELY placed in the `dev` split, never `holdout` — including them
// in holdout would be data leakage, since the fix's shape was derived
// directly from their score breakdowns (see lib/query.js's own header
// comment for the forensic trace).
//
// goldLabel vocabulary (Section F):
//   a real record id (feature/workflow/governance)      -> allowedMemberIds: [id]
//   more than one genuinely acceptable primary           -> allowedMemberIds: [id, id, ...]
//   no single correct primary exists in this corpus       -> 'NO_SINGLE_PRIMARY'
//   the system should decline rather than pick a primary  -> 'SHOULD_WITHHOLD'
//
// split: 'dev' (tunable against) | 'holdout' (never tuned against, honesty
// of the AFTER numbers depends on this discipline being real).

const CORPUS_C6 = [

  // ======================================================================
  // A. The 13 core Product Owner acceptance questions (verbatim, Section D.1)
  // ======================================================================
  { id: 'C6-CORE-Q1', split: 'dev', category: 'HOW_TO', question: 'How do I import photographs from an SD card?',
    goldLabel: 'AI-WF-001', allowedMemberIds: ['AI-WF-001', 'AI-FEAT-019'],
    rationale: 'AI-WF-001 is titled exactly "Import Photographs From a Memory Card or Folder" — the canonical workflow for this exact HOW_TO question.' },
  { id: 'C6-CORE-Q2', split: 'dev', category: 'EXPLANATION', question: 'What is QMZ?',
    goldLabel: 'AI-FEAT-047', allowedMemberIds: ['AI-FEAT-047'],
    rationale: 'AI-FEAT-047 "QMZ Sequencing Workspace" is the only record defining QMZ.' },
  { id: 'C6-CORE-Q3', split: 'dev', category: 'HOW_TO', question: 'How do I sort QMZ photos?',
    goldLabel: 'AI-WF-007', allowedMemberIds: ['AI-WF-007', 'AI-FEAT-047'],
    rationale: 'AI-WF-007 "Sort QMZ Photographs" is the exact procedural workflow.' },
  { id: 'C6-CORE-Q4', split: 'dev', category: 'TROUBLESHOOTING', question: 'What should I do if a transfer stops halfway?',
    goldLabel: 'AI-WF-009', allowedMemberIds: ['AI-WF-009', 'AI-FEAT-039'],
    rationale: 'AI-WF-009 "Import or Update From a Transfer Drive" documents Resume/Start Fresh after interruption — the operative recovery procedure. (Transfer EXPORT also has resume semantics via AI-WF-005/BUG-005; both are corpus-defensible, so AI-WF-005 is allowed too.)',
    allowedMemberIds2note: 'kept single-field above; see allowedMemberIds' },
  { id: 'C6-CORE-Q5', split: 'dev', category: 'HOW_TO', question: 'How do I create a Transfer Export?',
    goldLabel: 'AI-FEAT-038', allowedMemberIds: ['AI-FEAT-038', 'AI-WF-005'],
    rationale: 'AI-FEAT-038 is titled exactly "Transfer Export"; AI-WF-005 "Export or Update a Transfer Drive" is its companion how-to workflow. DIAGNOSED CASE — used to design the identity-mention fix. Forensic: pre-fix this ties at keyword-overlap:2 (raw 200) with 9+ unrelated records and loses to AI-WF-008 (Archive Lock Recovery) after surface-size damping, despite the record\'s own title being a verbatim substring of the query.' },
  { id: 'C6-CORE-Q6', split: 'dev', category: 'EXPLANATION', question: 'Why was Transfer Export locking kept process-local?',
    goldLabel: 'DEC-021', allowedMemberIds: ['DEC-021', 'AI-FEAT-038'],
    rationale: 'DEC-021 is the canonical decision record for this exact rationale; already a passing control (RF-5.4-002-equivalent) pre-fix.' },
  { id: 'C6-CORE-Q7', split: 'dev', category: 'CAPABILITY', question: 'Does AutoIngest support face recognition?',
    goldLabel: 'SHOULD_WITHHOLD', allowedMemberIds: ['face-recognition'], expectedStatus: 'NOT_SUPPORTED',
    rationale: 'Curated boundary — face recognition is explicitly not a documented capability.' },
  { id: 'C6-CORE-Q8', split: 'dev', category: 'CAPABILITY', question: 'Does AutoIngest support drone footage or GPS metadata?',
    goldLabel: 'NO_SINGLE_PRIMARY', expectedStatus: 'PLANNED',
    rationale: 'No GPS/drone-specific record exists in this corpus (confirmed by search); Archive Browser (AI-FEAT-051) is the nearest topically-loose PLANNED match, but no record actually addresses GPS metadata. A genuine knowledge gap, not a retrieval-fixable case — kept as a control that the fix must NOT force a false-confident single primary onto.' },
  { id: 'C6-CORE-Q9', split: 'dev', category: 'CAPABILITY', question: 'Does AutoIngest support system status monitoring?',
    goldLabel: 'AI-FEAT-003', allowedMemberIds: ['AI-FEAT-003'],
    rationale: 'AI-FEAT-003 "Dashboard & System Status" is the on-point record; authority gate may still downgrade to UNKNOWN if judge deems evidence insufficient — that is a capability-authority decision, not a retrieval failure, and is out of this corpus\'s scope to grade.' },
  { id: 'C6-CORE-Q10', split: 'dev', category: 'CAPABILITY', question: 'Does AutoIngest collect telemetry?',
    goldLabel: 'SHOULD_WITHHOLD',
    rationale: 'AI-FEAT-007 "Telemetry Pipeline" exists in the corpus by title, but per the prior acceptance trial no evidence establishes it as an active/shipped operator-facing capability — correctly withheld today; recorded as SHOULD_WITHHOLD rather than asserting a primary the corpus cannot actually support answering confidently.' },
  { id: 'C6-CORE-Q11', split: 'dev', category: 'ROADMAP', question: "What's coming next in AutoIngest?",
    goldLabel: 'roadmap-dashboard', allowedMemberIds: ['roadmap-dashboard'],
    rationale: 'ROADMAP-classified; correctly routes to the dashboard, not a feature/workflow record.' },
  { id: 'C6-CORE-Q12', split: 'dev', category: 'EXPLANATION', question: 'What is the Online Registry?',
    goldLabel: 'AI-FEAT-048', allowedMemberIds: ['AI-FEAT-048'],
    rationale: 'AI-FEAT-048 "Realtime Team Presence & Online Registry" — exact match, already a passing case pre-fix.' },
  { id: 'C6-CORE-Q13', split: 'dev', category: 'EXPLANATION', question: 'Why does Transfer Import exist?',
    goldLabel: 'AI-FEAT-039', allowedMemberIds: ['AI-FEAT-039', 'AI-WF-009'], forbiddenMemberIds: ['AI-WF-006', 'AI-FEAT-041'],
    rationale: 'AI-FEAT-039 is titled exactly "Transfer Import". DIAGNOSED CASE (= existing RF-4.3-001, a documented known-baseline-failure since Phase 4.3 — AI-FEAT-041 "Transfer Background/Minimize Operation" currently wins on raw absolute-token-count (3 vs 2, due to a query "exist" / indexed "exists" stemming gap) despite AI-FEAT-039\'s title being a verbatim substring of the query.' },

  // ======================================================================
  // B. The 9 novel Product Owner acceptance questions (verbatim, Section D.1)
  // ======================================================================
  { id: 'C6-NOVEL-N1', split: 'dev', category: 'STATUS', question: 'Where do my photos actually end up after an import finishes?',
    goldLabel: 'AI-FEAT-018', allowedMemberIds: ['AI-FEAT-018', 'AI-WF-001'],
    rationale: 'AI-FEAT-018 "Event-Component Import Routing" literally documents destination folder paths (Collection/Event/Photographer). Prior trial found this mis-retrieved to AI-FEAT-011 (Source Detection, about connecting devices, not destinations) — a genuine pre-existing retrieval gap this corpus should catch.' },
  { id: 'C6-NOVEL-N2', split: 'holdout', category: 'EXPLANATION', question: "How does AutoIngest decide which photographer's folder a file belongs in?",
    goldLabel: 'AI-FEAT-022', allowedMemberIds: ['AI-FEAT-022'],
    rationale: 'AI-FEAT-022 "Photographer-Folder Resolution" is the exact record.' },
  { id: 'C6-NOVEL-N3', split: 'holdout', category: 'CAPABILITY', question: 'Can I start a new event partway through an import?',
    goldLabel: 'SHOULD_WITHHOLD',
    rationale: 'No record establishes this specific mid-import event-switching behavior; correctly uncertain.' },
  { id: 'C6-NOVEL-N4', split: 'holdout', category: 'CAPABILITY', question: 'Does AutoIngest keep the original file dates when it renames files?',
    goldLabel: 'DEC-005', allowedMemberIds: ['DEC-005', 'AI-FEAT-024'],
    rationale: 'DEC-005 "Original Preservation and Non-Destructive Ingest" directly covers this.' },
  { id: 'C6-NOVEL-N5', split: 'dev', category: 'EXPLANATION', question: 'What happens to RAW files versus JPEGs during ingest — are they treated differently?',
    goldLabel: 'AI-FEAT-019', allowedMemberIds: ['AI-FEAT-019', 'DEC-009'],
    rationale: 'AI-FEAT-019 "Import Pipeline & Copy Engine" is the general ingest-handling record; no RAW-vs-JPEG-specific record exists (confirmed by search), so the general pipeline record is the correct honest primary.' },
  { id: 'C6-NOVEL-N6', split: 'dev', category: 'CAPABILITY', question: 'I exported a Transfer yesterday — can I export the same event again today?',
    goldLabel: 'AI-WF-005', allowedMemberIds: ['AI-WF-005', 'AI-FEAT-038'],
    rationale: 'AI-WF-005 "Export or Update a Transfer Drive" documents the Scan-for-New-Data/update path directly answering re-export behavior. Prior trial found this mis-retrieved to AI-FEAT-041 (Background/Minimize) — a real gap.' },
  { id: 'C6-NOVEL-N7', split: 'holdout', category: 'CAPABILITY', question: 'Will AutoIngest overwrite my archive if I run an update?',
    goldLabel: 'AI-FEAT-019', allowedMemberIds: ['AI-FEAT-019', 'DEC-005'],
    rationale: 'Same no-overwrite/rename-on-conflict guarantee documented in the Import Pipeline record; already correctly resolved pre-fix via the real local judge (authorityRan=true, SUPPORTS).' },
  { id: 'C6-NOVEL-N8', split: 'dev', category: 'TROUBLESHOOTING', question: "My QMZ folder looks empty even though I know there are photos in it — what's going on?",
    goldLabel: 'AI-FEAT-047', allowedMemberIds: ['AI-FEAT-047', 'AI-WF-007'],
    rationale: 'QMZ Sequencing Workspace/its workflow remain the correct topical primary even for a troubleshooting framing — this corpus grades PRIMARY IDENTITY only (Section AB); whether the SYNTHESIZED prose actually addresses "looks empty" is an answer-quality question for a later checkpoint, explicitly out of scope here.' },
  { id: 'C6-NOVEL-N9', split: 'holdout', category: 'TROUBLESHOOTING', question: 'Why do some imported files show up with a warning icon next to them?',
    goldLabel: 'AI-FEAT-032', allowedMemberIds: ['AI-FEAT-032', 'AI-FEAT-033'],
    rationale: 'AI-FEAT-032 "Metadata Verification" / AI-FEAT-033 "Metadata Audit & Repair" are the on-point records for a file-level warning-state icon (metadata-verification-required state); prior trial found this mis-retrieved to AI-FEAT-054 (a PLANNED, unbuilt archive-wide integrity feature) — a real gap.' },

  // ======================================================================
  // C. Confusable pairs (Section E) — both sides tested, real corpus titles
  // ======================================================================
  // C1. Transfer Import vs Transfer Export
  { id: 'C6-CONF-C1a', split: 'dev', category: 'HOW_TO', question: 'How do I export a Transfer Drive?',
    goldLabel: 'AI-WF-005', allowedMemberIds: ['AI-WF-005', 'AI-FEAT-038'], forbiddenMemberIds: ['AI-FEAT-039', 'AI-WF-009'] },
  { id: 'C6-CONF-C1b', split: 'holdout', category: 'HOW_TO', question: 'How do I import from a Transfer Drive?',
    goldLabel: 'AI-WF-009', allowedMemberIds: ['AI-WF-009', 'AI-FEAT-039'], forbiddenMemberIds: ['AI-FEAT-038', 'AI-WF-005'] },
  // C2. Archive Maintenance vs Event Maintenance
  { id: 'C6-CONF-C2a', split: 'dev', category: 'EXPLANATION', question: 'What is Archive Maintenance?',
    goldLabel: 'AI-FEAT-049', allowedMemberIds: ['AI-FEAT-049'], forbiddenMemberIds: ['AI-FEAT-050'],
    rationale: 'DIAGNOSED CASE. Forensic: pre-fix AI-FEAT-050 (Event Maintenance) beats AI-FEAT-049 (the actually-named record) 142.0 to 121.3, purely because AI-FEAT-050 has a smaller keyword surface and is dampened less.' },
  { id: 'C6-CONF-C2b', split: 'holdout', category: 'EXPLANATION', question: 'What is Event Maintenance?',
    goldLabel: 'AI-FEAT-050', allowedMemberIds: ['AI-FEAT-050'], forbiddenMemberIds: ['AI-FEAT-049'] },
  // C3. Source Selection vs Source Detection
  { id: 'C6-CONF-C3a', split: 'dev', category: 'EXPLANATION', question: 'What is Source Selection?',
    goldLabel: 'AI-FEAT-012', allowedMemberIds: ['AI-FEAT-012'], forbiddenMemberIds: ['AI-FEAT-011'] },
  { id: 'C6-CONF-C3b', split: 'holdout', category: 'EXPLANATION', question: 'What is Source Detection?',
    goldLabel: 'AI-FEAT-011', allowedMemberIds: ['AI-FEAT-011'], forbiddenMemberIds: ['AI-FEAT-012'] },
  // C4. Import vs Transfer (general)
  { id: 'C6-CONF-C4a', split: 'dev', category: 'HOW_TO', question: 'How do I import photos into a new event?',
    goldLabel: 'AI-WF-001', allowedMemberIds: ['AI-WF-001', 'AI-WF-002'], forbiddenMemberIds: ['AI-FEAT-038', 'AI-FEAT-039'] },
  { id: 'C6-CONF-C4b', split: 'holdout', category: 'HOW_TO', question: 'How do I move files to another AutoIngest machine using a Transfer Drive?',
    goldLabel: 'AI-WF-005', allowedMemberIds: ['AI-WF-005', 'AI-WF-009', 'AI-FEAT-038', 'AI-FEAT-039'], forbiddenMemberIds: ['AI-WF-001'] },
  // C5. Backup vs Transfer Export
  { id: 'C6-CONF-C5a', split: 'dev', category: 'EXPLANATION', question: 'What is Backup Update Scanning?',
    goldLabel: 'AI-FEAT-040', allowedMemberIds: ['AI-FEAT-040'], forbiddenMemberIds: ['AI-FEAT-038'] },
  { id: 'C6-CONF-C5b', split: 'holdout', category: 'STATUS', question: 'Is a Transfer Export the same thing as a backup?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-038', 'AI-FEAT-040'],
    rationale: 'A genuine COMPARISON question — both records are legitimately relevant; forcing one single primary would be wrong.' },
  // C6. Scan for New Data vs Update Backup
  { id: 'C6-CONF-C6a', split: 'dev', category: 'HOW_TO', question: 'How do I scan for new data before a Transfer Export?',
    goldLabel: 'AI-WF-005', allowedMemberIds: ['AI-WF-005', 'AI-FEAT-038'] },
  { id: 'C6-CONF-C6b', split: 'holdout', category: 'HOW_TO', question: 'How do I update an existing backup with new files?',
    goldLabel: 'AI-FEAT-040', allowedMemberIds: ['AI-FEAT-040', 'AI-WF-005', 'AI-WF-009'] },
  // C7. Metadata Audit vs Metadata Repair (same record) vs Metadata Verification
  { id: 'C6-CONF-C7a', split: 'dev', category: 'EXPLANATION', question: 'What does Metadata Audit and Repair do?',
    goldLabel: 'AI-FEAT-033', allowedMemberIds: ['AI-FEAT-033'], forbiddenMemberIds: ['AI-FEAT-032'] },
  { id: 'C6-CONF-C7b', split: 'holdout', category: 'EXPLANATION', question: 'How is Metadata Verification different from the Metadata Audit tool?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-032', 'AI-FEAT-033'],
    rationale: 'A genuine two-record COMPARISON; both are correct.' },
  // C8. QMZ vs general grouping
  { id: 'C6-CONF-C8a', split: 'dev', category: 'EXPLANATION', question: 'What is the Grouping System?',
    goldLabel: 'AI-FEAT-017', allowedMemberIds: ['AI-FEAT-017'], forbiddenMemberIds: ['AI-FEAT-047'] },
  { id: 'C6-CONF-C8b', split: 'holdout', category: 'COMPARISON', question: 'Is QMZ the same as the regular Grouping System used for multi-component events?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-047', 'AI-FEAT-017'] },
  // C9. Event creation vs event maintenance
  { id: 'C6-CONF-C9a', split: 'dev', category: 'HOW_TO', question: 'How do I create a new event?',
    goldLabel: 'AI-WF-002', allowedMemberIds: ['AI-WF-002', 'AI-FEAT-009'], forbiddenMemberIds: ['AI-FEAT-050'] },
  { id: 'C6-CONF-C9b', split: 'holdout', category: 'EXPLANATION', question: 'What does Event Maintenance let me do to an event after it already exists?',
    goldLabel: 'AI-FEAT-050', allowedMemberIds: ['AI-FEAT-050'], forbiddenMemberIds: ['AI-WF-002', 'AI-FEAT-009'] },
  // C10. Archive diagnostics vs archive maintenance
  { id: 'C6-CONF-C10a', split: 'dev', category: 'TROUBLESHOOTING', question: 'How do I recover from an archive lock error?',
    goldLabel: 'AI-WF-008', allowedMemberIds: ['AI-WF-008', 'AI-FEAT-045'], forbiddenMemberIds: ['AI-FEAT-049'] },
  { id: 'C6-CONF-C10b', split: 'holdout', category: 'EXPLANATION', question: 'What does the planned Archive Maintenance feature actually cover?',
    goldLabel: 'AI-FEAT-049', allowedMemberIds: ['AI-FEAT-049'], forbiddenMemberIds: ['AI-FEAT-045', 'AI-WF-008'] },
  // C11. Photographer folders vs event folders
  { id: 'C6-CONF-C11a', split: 'dev', category: 'EXPLANATION', question: 'How does AutoIngest resolve the photographer folder for a file?',
    goldLabel: 'AI-FEAT-022', allowedMemberIds: ['AI-FEAT-022'], forbiddenMemberIds: ['AI-FEAT-018'] },
  { id: 'C6-CONF-C11b', split: 'holdout', category: 'EXPLANATION', question: 'How does AutoIngest route files into the right event and sub-event folder structure?',
    goldLabel: 'AI-FEAT-018', allowedMemberIds: ['AI-FEAT-018'], forbiddenMemberIds: ['AI-FEAT-022'] },
  // C12. Quick Import vs normal Event Import
  { id: 'C6-CONF-C12a', split: 'dev', category: 'HOW_TO', question: 'How do I use Quick Import for a small batch of photos?',
    goldLabel: 'AI-WF-003', allowedMemberIds: ['AI-WF-003', 'AI-FEAT-023'], forbiddenMemberIds: ['AI-WF-001'] },
  { id: 'C6-CONF-C12b', split: 'holdout', category: 'COMPARISON', question: 'What is the difference between Quick Import and a normal Event Import?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-023', 'AI-WF-003', 'AI-WF-001'] },

  // ======================================================================
  // D. Exact-title-mentioned-in-a-longer-sentence (directly targets the fix)
  // ======================================================================
  { id: 'C6-TITLE-D1', split: 'dev', category: 'HOW_TO', question: 'I need to know exactly how the Import Pipeline and Copy Engine decides what to copy first.',
    goldLabel: 'AI-FEAT-019', allowedMemberIds: ['AI-FEAT-019'] },
  { id: 'C6-TITLE-D2', split: 'holdout', category: 'EXPLANATION', question: 'Can you walk me through what the Duplicate Detection feature actually checks for?',
    goldLabel: 'AI-FEAT-020', allowedMemberIds: ['AI-FEAT-020'] },
  { id: 'C6-TITLE-D3', split: 'dev', category: 'EXPLANATION', question: 'What exactly does Checksum-Based File Verification confirm after a copy?',
    goldLabel: 'AI-FEAT-025', allowedMemberIds: ['AI-FEAT-025'] },
  { id: 'C6-TITLE-D4', split: 'holdout', category: 'EXPLANATION', question: "I'm trying to understand the Archive Lock Handling and Stale-Lock Recovery mechanism before I trust it.",
    goldLabel: 'AI-FEAT-045', allowedMemberIds: ['AI-FEAT-045'] },
  { id: 'C6-TITLE-D5', split: 'dev', category: 'STATUS', question: 'Is Local-First Background Archive Sync something that runs automatically or do I have to trigger it?',
    goldLabel: 'AI-FEAT-044', allowedMemberIds: ['AI-FEAT-044'] },
  { id: 'C6-TITLE-D6', split: 'holdout', category: 'EXPLANATION', question: 'What does the Atomic Import Transaction guarantee actually protect me from?',
    goldLabel: 'AI-FEAT-021', allowedMemberIds: ['AI-FEAT-021'] },
  { id: 'C6-TITLE-D7', split: 'dev', category: 'EXPLANATION', question: 'Tell me about the Metadata Durable Queue and Crash Recovery system.',
    goldLabel: 'AI-FEAT-030', allowedMemberIds: ['AI-FEAT-030'] },
  { id: 'C6-TITLE-D8', split: 'holdout', category: 'HOW_TO', question: 'What steps does Import Source Attribution take to record which drive a file came from?',
    goldLabel: 'AI-FEAT-028', allowedMemberIds: ['AI-FEAT-028'] },

  // ======================================================================
  // E. No exact title mentioned — pure paraphrase/generalization test
  // ======================================================================
  { id: 'C6-PARA-E1', split: 'dev', category: 'HOW_TO', question: 'How do I make sure two people at the same event don\'t overwrite each other\'s work?',
    goldLabel: 'AI-WF-006', allowedMemberIds: ['AI-WF-006', 'AI-FEAT-048'] },
  { id: 'C6-PARA-E2', split: 'holdout', category: 'TROUBLESHOOTING', question: 'A photo I already imported seems to have gotten copied a second time — is that expected?',
    goldLabel: 'AI-FEAT-020', allowedMemberIds: ['AI-FEAT-020'] },
  { id: 'C6-PARA-E3', split: 'dev', category: 'HOW_TO', question: 'How do I find out how many photos have been archived this week?',
    goldLabel: 'AI-FEAT-003', allowedMemberIds: ['AI-FEAT-003'] },
  { id: 'C6-PARA-E4', split: 'holdout', category: 'STATUS', question: 'Can I preview a photo without it becoming the selected/active one?',
    goldLabel: 'AI-FEAT-016', allowedMemberIds: ['AI-FEAT-016'] },
  { id: 'C6-PARA-E5', split: 'dev', category: 'CAPABILITY', question: 'Does AutoIngest let me search across everything in the archive using plain language?',
    goldLabel: 'AI-FEAT-053', allowedMemberIds: ['AI-FEAT-053'] },
  { id: 'C6-PARA-E6', split: 'holdout', category: 'EXPLANATION', question: 'Where do the keyword tags that get written into my photos actually come from?',
    goldLabel: 'AI-FEAT-036', allowedMemberIds: ['AI-FEAT-036', 'AI-FEAT-029'] },
  { id: 'C6-PARA-E7', split: 'dev', category: 'HOW_TO', question: 'What do I do if AutoIngest itself needs to be updated to a newer version?',
    goldLabel: 'AI-FEAT-006', allowedMemberIds: ['AI-FEAT-006'] },
  { id: 'C6-PARA-E8', split: 'holdout', category: 'EXPLANATION', question: 'How does the app know who is currently logged in and doing the archiving?',
    goldLabel: 'AI-FEAT-002', allowedMemberIds: ['AI-FEAT-002'] },

  // ======================================================================
  // F. Ambiguous-but-reasonable operator wording
  // ======================================================================
  { id: 'C6-AMBIG-F1', split: 'dev', category: 'AMBIGUOUS', question: 'How do I send this event to backup?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-038', 'AI-FEAT-040', 'AI-WF-005'],
    rationale: '"backup" is genuinely ambiguous between Transfer Export (physical transport copy) and Backup Update Scanning (comparison/update) — any of the three is a reasonable primary; forcing exactly one would misrepresent real ambiguity.' },
  { id: 'C6-AMBIG-F2', split: 'holdout', category: 'AMBIGUOUS', question: 'Where do I go to make an export?',
    goldLabel: 'AI-FEAT-038', allowedMemberIds: ['AI-FEAT-038', 'AI-WF-005'] },
  { id: 'C6-AMBIG-F3', split: 'dev', category: 'AMBIGUOUS', question: 'Why is AutoIngest detecting this source as something I don\'t recognize?',
    goldLabel: 'AI-FEAT-011', allowedMemberIds: ['AI-FEAT-011'] },
  { id: 'C6-AMBIG-F4', split: 'holdout', category: 'AMBIGUOUS', question: 'What happens if a transfer gets interrupted partway through?',
    goldLabel: 'AI-WF-009', allowedMemberIds: ['AI-WF-009', 'AI-WF-005', 'BUG-005'] },
  { id: 'C6-AMBIG-F5', split: 'dev', category: 'AMBIGUOUS', question: 'How are RAW files handled compared to everything else?',
    goldLabel: 'AI-FEAT-019', allowedMemberIds: ['AI-FEAT-019'] },
  { id: 'C6-AMBIG-F6', split: 'holdout', category: 'AMBIGUOUS', question: 'Can I change an event after I\'ve already created it?',
    goldLabel: 'AI-FEAT-010', allowedMemberIds: ['AI-FEAT-010', 'AI-FEAT-050'] },
  { id: 'C6-AMBIG-F7', split: 'dev', category: 'AMBIGUOUS', question: 'What tells me a file is actually safe on the archive and not corrupted?',
    goldLabel: 'AI-FEAT-025', allowedMemberIds: ['AI-FEAT-025', 'AI-FEAT-026'] },
  { id: 'C6-AMBIG-F8', split: 'holdout', category: 'AMBIGUOUS', question: 'Does the app remember my settings between sessions?',
    goldLabel: 'AI-FEAT-005', allowedMemberIds: ['AI-FEAT-005'] },

  // ======================================================================
  // G. Short operator phrasing (2-6 words)
  // ======================================================================
  { id: 'C6-SHORT-G1', split: 'dev', category: 'SHORT', question: 'transfer export steps?',
    goldLabel: 'AI-FEAT-038', allowedMemberIds: ['AI-FEAT-038', 'AI-WF-005'] },
  { id: 'C6-SHORT-G2', split: 'holdout', category: 'SHORT', question: 'archive maintenance?',
    goldLabel: 'AI-FEAT-049', allowedMemberIds: ['AI-FEAT-049'], forbiddenMemberIds: ['AI-FEAT-050'] },
  { id: 'C6-SHORT-G3', split: 'dev', category: 'SHORT', question: 'source detection',
    goldLabel: 'AI-FEAT-011', allowedMemberIds: ['AI-FEAT-011'] },
  { id: 'C6-SHORT-G4', split: 'holdout', category: 'SHORT', question: 'quick import?',
    goldLabel: 'AI-FEAT-023', allowedMemberIds: ['AI-FEAT-023', 'AI-WF-003'] },
  { id: 'C6-SHORT-G5', split: 'dev', category: 'SHORT', question: 'duplicate detection',
    goldLabel: 'AI-FEAT-020', allowedMemberIds: ['AI-FEAT-020'] },

  // ======================================================================
  // H. Long conversational phrasing
  // ======================================================================
  { id: 'C6-LONG-H1', split: 'dev', category: 'LONG', question: "Okay so I'm new here — when I plug in a memory card, what actually happens, like does the app just grab everything automatically or do I need to tell it what to do first?",
    goldLabel: 'AI-WF-001', allowedMemberIds: ['AI-WF-001', 'AI-FEAT-011', 'AI-FEAT-012'] },
  { id: 'C6-LONG-H2', split: 'holdout', category: 'LONG', question: "I've got two laptops running AutoIngest at the same event and I'm honestly not sure if they know about each other at all, is there some way for them to coordinate so we don't both grab the same photographer's card?",
    goldLabel: 'AI-WF-006', allowedMemberIds: ['AI-WF-006', 'AI-FEAT-048'] },
  { id: 'C6-LONG-H3', split: 'dev', category: 'LONG', question: "So the QMZ workflow — I get that it's for sequencing, but what I really want to know is what happens after I do the initial sort, is there a review step or does it just go straight into the archive?",
    goldLabel: 'AI-WF-007', allowedMemberIds: ['AI-WF-007', 'AI-FEAT-047'] },

  // ======================================================================
  // I. WORKFLOW / NAVIGATION-shaped questions
  // ======================================================================
  { id: 'C6-WF-I1', split: 'dev', category: 'NAVIGATION', question: 'Where do I click to start a Transfer Export?',
    goldLabel: 'AI-WF-005', allowedMemberIds: ['AI-WF-005', 'AI-FEAT-038'] },
  { id: 'C6-WF-I2', split: 'holdout', category: 'NAVIGATION', question: 'Where in the app do I review metadata that failed to write?',
    goldLabel: 'AI-FEAT-034', allowedMemberIds: ['AI-FEAT-034', 'AI-FEAT-033'] },
  { id: 'C6-WF-I3', split: 'dev', category: 'WORKFLOW', question: 'Walk me through repairing missing or incorrect metadata on an already-imported event.',
    goldLabel: 'AI-WF-004', allowedMemberIds: ['AI-WF-004', 'AI-FEAT-033'] },

];

// Sanity assertion (structural, run at require-time — the corpus itself
// must never silently drift out of its own declared shape).
const seenIds = new Set();
for (const e of CORPUS_C6) {
  if (seenIds.has(e.id)) throw new Error(`Duplicate C6 corpus id: ${e.id}`);
  seenIds.add(e.id);
  if (e.split !== 'dev' && e.split !== 'holdout') throw new Error(`${e.id}: invalid split "${e.split}"`);
}

module.exports = { CORPUS_C6 };
