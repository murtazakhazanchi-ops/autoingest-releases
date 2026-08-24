'use strict';

// Phase C6.3 — candidate-scoring/competition-focused development corpus.
// Distinct in purpose from every prior corpus: C6.1's 81q corpus targets
// identity-mention recall, C6.2's 100q corpus targets concept-to-record
// paraphrase recall, the frozen 17q external set is a blind acceptance
// check. THIS corpus assumes concept resolution already fires (or a strong
// literal match already exists) and asks a narrower question: once the
// right record is IN the candidate pool, does it actually WIN against a
// keyword-adjacent Feature, Governance record, or Workflow competitor?
//
// Every question is NEW wording, not copied from the frozen 17-question
// external holdout or any other corpus (per the C6.3 checkpoint brief,
// Section D/U) — representative failure classes are reconstructed from
// scratch, not reverse-engineered from known holdout failures.
//
// Gold labels were assigned by reading each candidate record's own
// canonical title/summary (scripts/product-docs, current build) BEFORE
// this corpus was run through the engine — never adjusted afterward.
// Where a question is genuinely, legitimately answerable by more than one
// record (a real Governance-primary case, a real cross-workflow direction
// pair, a real multi-concept ambiguity), goldLabel is 'NO_SINGLE_PRIMARY'
// with every defensible id in allowedMemberIds — this is not a hedge to
// make the corpus easier, it reflects a genuine documentation reality
// (e.g. DEC-021 legitimately IS the best answer to a WHY question about
// Transfer Export's locking, even though AI-FEAT-038 is the best answer
// to a WHAT/HOW_TO question about the exact same feature).
//
// competitionType (Section D/M's failure-class taxonomy — informational,
// not consumed by the generic runner): the SPECIFIC kind of competitor
// this question is designed to test the winning record against.
//
// split: 'dev' (~70%, tunable against) | 'holdout' (~30%, internal —
// never tuned against, a harder gate before the frozen 17-question set is
// ever consulted).

const SCORING_CORPUS_C63 = [

  // ===== right concept / wrong Feature competitor =====
  { id: 'S-FEAT-01', split: 'dev', competitionType: 'wrong-feature-competitor',
    question: "Can AutoIngest tell me if I'm about to bring in a file I already imported before?",
    goldLabel: 'AI-FEAT-020', allowedMemberIds: ['AI-FEAT-020'] },
  { id: 'S-FEAT-02', split: 'dev', competitionType: 'wrong-feature-competitor',
    question: 'Does the app verify that files copied over correctly using their checksums?',
    goldLabel: 'AI-FEAT-025', allowedMemberIds: ['AI-FEAT-025'] },
  { id: 'S-FEAT-03', split: 'holdout', competitionType: 'wrong-feature-competitor',
    question: 'Is there a count check to make sure nothing went missing after a big import?',
    goldLabel: 'AI-FEAT-026', allowedMemberIds: ['AI-FEAT-026'] },
  { id: 'S-FEAT-04', split: 'dev', competitionType: 'wrong-feature-competitor',
    question: 'What keeps two photographers from writing into the same event folder at the same time?',
    goldLabel: 'AI-FEAT-045', allowedMemberIds: ['AI-FEAT-045'] },
  { id: 'S-FEAT-05', split: 'dev', competitionType: 'wrong-feature-competitor',
    question: 'Where does AutoIngest keep the record of every sub-event and how files map into them?',
    goldLabel: 'AI-FEAT-004', allowedMemberIds: ['AI-FEAT-004'] },
  { id: 'S-FEAT-06', split: 'holdout', competitionType: 'wrong-feature-competitor',
    question: 'How does the app decide which of my connected drives counts as the real archive root?',
    goldLabel: 'AI-FEAT-042', allowedMemberIds: ['AI-FEAT-042'] },
  { id: 'S-FEAT-07', split: 'dev', competitionType: 'wrong-feature-competitor',
    question: 'Can I register a folder I already organized by hand as a proper archive event?',
    goldLabel: 'AI-FEAT-046', allowedMemberIds: ['AI-FEAT-046'] },
  { id: 'S-FEAT-08', split: 'dev', competitionType: 'wrong-feature-competitor',
    question: 'Is there a dashboard view that tells me if my archive is generally in good shape?',
    goldLabel: 'AI-FEAT-043', allowedMemberIds: ['AI-FEAT-043'] },
  { id: 'S-FEAT-09', split: 'holdout', competitionType: 'wrong-feature-competitor',
    question: 'Does AutoIngest keep a controlled list of keywords so tagging stays consistent across events?',
    goldLabel: 'AI-FEAT-036', allowedMemberIds: ['AI-FEAT-036'] },
  { id: 'S-FEAT-10', split: 'dev', competitionType: 'wrong-feature-competitor',
    question: "Will the app notice if a file's metadata drifted after it was already imported and correct it?",
    goldLabel: 'AI-FEAT-037', allowedMemberIds: ['AI-FEAT-037'] },

  // ===== right concept / wrong Governance competitor (some legitimate governance wins included) =====
  { id: 'S-GOV-01', split: 'dev', competitionType: 'wrong-governance-competitor',
    question: 'What happens when I send an event out to a transfer drive?',
    goldLabel: 'AI-FEAT-038', allowedMemberIds: ['AI-FEAT-038'] },
  { id: 'S-GOV-02', split: 'dev', competitionType: 'legitimate-governance-explanation',
    question: 'Why is only one export from my archive allowed to run at a time?',
    goldLabel: 'DEC-021', allowedMemberIds: ['DEC-021'] },
  { id: 'S-GOV-03', split: 'holdout', competitionType: 'legitimate-governance-troubleshooting',
    question: 'What went wrong with the progress numbers during a past transfer export?',
    goldLabel: 'BUG-005', allowedMemberIds: ['BUG-005'] },
  { id: 'S-GOV-04', split: 'dev', competitionType: 'wrong-governance-competitor',
    question: 'How do I update a backup drive that already has some files sitting on it?',
    goldLabel: 'AI-FEAT-040', allowedMemberIds: ['AI-FEAT-040', 'AI-WF-005'] },
  { id: 'S-GOV-05', split: 'dev', competitionType: 'legitimate-governance-explanation',
    question: 'Why does updating a transfer drive skip files that are already there instead of copying everything again?',
    goldLabel: 'DEC-010', allowedMemberIds: ['DEC-010'] },
  { id: 'S-GOV-06', split: 'holdout', competitionType: 'workflow-vs-governance',
    question: "My archive is locked and nothing will import — how do I get past that?",
    goldLabel: 'AI-WF-008', allowedMemberIds: ['AI-WF-008'] },
  { id: 'S-GOV-07', split: 'dev', competitionType: 'legitimate-governance-troubleshooting',
    question: 'Every import on this one machine is blocked because of a lock left behind from before — what caused that?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['BUG-004', 'AI-WF-008'] },
  { id: 'S-GOV-08', split: 'dev', competitionType: 'wrong-governance-competitor',
    question: 'How does AutoIngest work out where my archive actually lives when the path looks ambiguous?',
    goldLabel: 'AI-FEAT-042', allowedMemberIds: ['AI-FEAT-042'] },

  // ===== right concept / wrong Workflow competitor =====
  { id: 'S-WF-01', split: 'dev', competitionType: 'wrong-workflow-competitor',
    question: 'What are the steps to get missing metadata fixed across my whole archive?',
    goldLabel: 'AI-WF-004', allowedMemberIds: ['AI-WF-004'] },
  { id: 'S-WF-02', split: 'dev', competitionType: 'wrong-workflow-competitor',
    question: "What's the process for sorting a big batch of Qadam Majlis Ziyafat photos into sequence order?",
    goldLabel: 'AI-WF-007', allowedMemberIds: ['AI-WF-007'] },
  { id: 'S-WF-03', split: 'holdout', competitionType: 'wrong-workflow-competitor',
    question: 'How do I bring in just a handful of photos without setting up a whole event first?',
    goldLabel: 'AI-WF-003', allowedMemberIds: ['AI-WF-003'] },
  { id: 'S-WF-04', split: 'dev', competitionType: 'wrong-workflow-competitor',
    question: 'What are the steps to send my archive events to a portable drive I can carry to another office?',
    goldLabel: 'AI-WF-005', allowedMemberIds: ['AI-WF-005'] },
  { id: 'S-WF-05', split: 'dev', competitionType: 'wrong-workflow-competitor',
    question: 'How do I bring the contents of a transfer drive into my main archive?',
    goldLabel: 'AI-WF-009', allowedMemberIds: ['AI-WF-009'] },
  { id: 'S-WF-06', split: 'holdout', competitionType: 'wrong-workflow-competitor',
    question: 'What should I do to set up a brand-new shoot before importing anything into it?',
    goldLabel: 'AI-WF-002', allowedMemberIds: ['AI-WF-002'] },
  { id: 'S-WF-07', split: 'dev', competitionType: 'wrong-workflow-competitor',
    question: 'How can I see who else is currently working and which event they are on?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-WF-006', 'AI-FEAT-048'] },
  { id: 'S-WF-08', split: 'dev', competitionType: 'wrong-workflow-competitor',
    question: "What's the recovery process when my archive shows a stale lock error?",
    goldLabel: 'AI-WF-008', allowedMemberIds: ['AI-WF-008'] },

  // ===== backup / export / sync multi-concept ambiguity =====
  { id: 'S-AMBIG-01', split: 'dev', competitionType: 'multi-concept-ambiguity',
    question: 'Does AutoIngest keep a backup of my archive automatically without me doing anything?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-040', 'AI-FEAT-044'] },
  { id: 'S-AMBIG-02', split: 'holdout', competitionType: 'multi-concept-ambiguity',
    question: "What's the difference between exporting events to a drive and just syncing in the background?",
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-038', 'AI-FEAT-044'] },
  { id: 'S-AMBIG-03', split: 'dev', competitionType: 'multi-concept-ambiguity',
    question: 'If I export once and later just want to refresh that same drive, is that a different process?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-040', 'AI-WF-005'] },
  { id: 'S-AMBIG-04', split: 'dev', competitionType: 'multi-concept-ambiguity',
    question: 'Can two operators work on the same event from different offices without a shared drive between them?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-WF-006', 'AI-FEAT-048'] },
  { id: 'S-AMBIG-05', split: 'holdout', competitionType: 'multi-concept-ambiguity',
    question: 'Is there a way to keep a secondary copy of my archive current without redoing a full export every time?',
    goldLabel: 'AI-FEAT-040', allowedMemberIds: ['AI-FEAT-040', 'AI-FEAT-044'] },
  { id: 'S-AMBIG-06', split: 'dev', competitionType: 'multi-concept-ambiguity',
    question: 'How does moving content onto a transfer drive relate to what happens when that drive comes back in later?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-038', 'AI-FEAT-039'] },

  // ===== generic operator verbs: send / check / tell / use / fix / see =====
  { id: 'S-VERB-01', split: 'dev', competitionType: 'generic-verb',
    question: 'How do I send my event off to another location for archiving?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-038', 'AI-WF-005'] },
  { id: 'S-VERB-02', split: 'dev', competitionType: 'generic-verb',
    question: 'Can AutoIngest check whether my files actually copied over safely?',
    goldLabel: 'AI-FEAT-025', allowedMemberIds: ['AI-FEAT-025'] },
  { id: 'S-VERB-03', split: 'holdout', competitionType: 'generic-verb',
    question: 'Does the app tell me who brought a particular photo into the archive?',
    goldLabel: 'AI-FEAT-028', allowedMemberIds: ['AI-FEAT-028'] },
  { id: 'S-VERB-04', split: 'dev', competitionType: 'generic-verb',
    question: 'What do I use to bring a small handful of files in quickly without the full event setup?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-WF-003', 'AI-FEAT-023'] },
  { id: 'S-VERB-05', split: 'dev', competitionType: 'generic-verb',
    question: 'How do I fix metadata that came out wrong after an import?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-WF-004', 'AI-FEAT-033'] },
  { id: 'S-VERB-06', split: 'holdout', competitionType: 'generic-verb',
    question: 'Where can I see what happened during a past import for one event?',
    goldLabel: 'AI-FEAT-027', allowedMemberIds: ['AI-FEAT-027'] },

  // ===== NAVIGATION with concept hints =====
  { id: 'S-NAV-01', split: 'dev', competitionType: 'navigation-concept',
    question: 'Where do I go to check whether my archive drive is generally healthy?',
    goldLabel: 'AI-FEAT-043', allowedMemberIds: ['AI-FEAT-043'] },
  { id: 'S-NAV-02', split: 'dev', competitionType: 'navigation-concept',
    question: 'Where would I look to find every photo across every event at once?',
    goldLabel: 'AI-FEAT-053', allowedMemberIds: ['AI-FEAT-053'] },
  { id: 'S-NAV-03', split: 'holdout', competitionType: 'navigation-concept',
    question: "Where does AutoIngest show me who's currently online right now?",
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-WF-006', 'AI-FEAT-048'] },
  { id: 'S-NAV-04', split: 'dev', competitionType: 'navigation-concept',
    question: 'Where can I find the import history for one specific event?',
    goldLabel: 'AI-FEAT-027', allowedMemberIds: ['AI-FEAT-027'] },
  { id: 'S-NAV-05', split: 'dev', competitionType: 'navigation-concept',
    question: 'Where do I configure which drive AutoIngest treats as the main archive?',
    goldLabel: 'AI-FEAT-042', allowedMemberIds: ['AI-FEAT-042'] },
  { id: 'S-NAV-06', split: 'holdout', competitionType: 'navigation-concept',
    question: 'Once an import finishes, where in the archive structure do the files actually land?',
    goldLabel: 'AI-WF-001', allowedMemberIds: ['AI-WF-001'] },

  // ===== exact-title present (regression anchor inside this new corpus) =====
  { id: 'S-TITLE-01', split: 'dev', competitionType: 'exact-title',
    question: 'What is a Transfer Export?',
    goldLabel: 'AI-FEAT-038', allowedMemberIds: ['AI-FEAT-038'] },
  { id: 'S-TITLE-02', split: 'dev', competitionType: 'exact-title',
    question: 'What is Archive Maintenance?',
    goldLabel: 'AI-FEAT-049', allowedMemberIds: ['AI-FEAT-049'] },
  { id: 'S-TITLE-03', split: 'holdout', competitionType: 'exact-title',
    question: 'What is Quick Import?',
    goldLabel: 'AI-FEAT-023', allowedMemberIds: ['AI-FEAT-023', 'AI-WF-003'] },
  { id: 'S-TITLE-04', split: 'dev', competitionType: 'exact-title',
    question: 'What is the Metadata Writing Engine?',
    goldLabel: 'AI-FEAT-029', allowedMemberIds: ['AI-FEAT-029'] },

  // ===== ambiguous questions =====
  { id: 'S-AMBIGQ-01', split: 'dev', competitionType: 'genuinely-ambiguous',
    question: 'How do I manage my archive?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-043', 'AI-FEAT-049', 'AI-FEAT-033', 'AI-FEAT-051'] },
  { id: 'S-AMBIGQ-02', split: 'dev', competitionType: 'genuinely-ambiguous',
    question: 'Tell me about imports.',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-WF-001', 'AI-FEAT-019', 'AI-FEAT-009'] },
  { id: 'S-AMBIGQ-03', split: 'holdout', competitionType: 'genuinely-ambiguous',
    question: 'What happens with events?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-009', 'AI-FEAT-010', 'AI-WF-002'] },
  { id: 'S-AMBIGQ-04', split: 'dev', competitionType: 'genuinely-ambiguous',
    question: 'How does backup work?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-040', 'AI-FEAT-044'] },

  // ===== CAPABILITY / STATUS =====
  { id: 'S-CAP-01', split: 'dev', competitionType: 'capability-status',
    question: 'Can AutoIngest verify my files were not corrupted during the copy?',
    goldLabel: 'AI-FEAT-025', allowedMemberIds: ['AI-FEAT-025'] },
  { id: 'S-CAP-02', split: 'dev', competitionType: 'capability-status',
    question: 'Does AutoIngest support recovering metadata work if the app crashes partway through?',
    goldLabel: 'AI-FEAT-030', allowedMemberIds: ['AI-FEAT-030'] },
  { id: 'S-CAP-03', split: 'holdout', competitionType: 'capability-status',
    question: "Is there a way to know if my archive's photo count actually matches what's on disk?",
    goldLabel: 'AI-FEAT-026', allowedMemberIds: ['AI-FEAT-026'] },
  { id: 'S-CAP-04', split: 'dev', competitionType: 'capability-status',
    question: 'Can I tag photos using a controlled, consistent set of keywords instead of free text?',
    goldLabel: 'AI-FEAT-036', allowedMemberIds: ['AI-FEAT-036'] },
  { id: 'S-CAP-05', split: 'dev', competitionType: 'capability-status',
    question: 'Does the app let me pause a metadata batch and pick it back up later without losing progress?',
    goldLabel: 'AI-FEAT-030', allowedMemberIds: ['AI-FEAT-030'] },
  { id: 'S-CAP-06', split: 'holdout', competitionType: 'capability-status',
    question: 'Will AutoIngest let more than one photographer import into the same event folder safely at once?',
    goldLabel: 'AI-FEAT-045', allowedMemberIds: ['AI-FEAT-045'] },

  // ===== TROUBLESHOOTING =====
  { id: 'S-TRB-01', split: 'dev', competitionType: 'troubleshooting',
    question: 'My metadata batch got interrupted by a crash — is that work lost?',
    goldLabel: 'AI-FEAT-030', allowedMemberIds: ['AI-FEAT-030'] },
  { id: 'S-TRB-02', split: 'dev', competitionType: 'troubleshooting',
    question: "The file counts on my archive audit don't match what I see on disk — what does that mean?",
    goldLabel: 'AI-FEAT-026', allowedMemberIds: ['AI-FEAT-026'] },
  { id: 'S-TRB-03', split: 'holdout', competitionType: 'legitimate-governance-troubleshooting',
    question: "A transfer export's progress bar showed impossible numbers — what happened there?",
    goldLabel: 'BUG-005', allowedMemberIds: ['BUG-005'] },
  { id: 'S-TRB-04', split: 'dev', competitionType: 'legitimate-governance-troubleshooting',
    question: 'Some keywords disappeared after a QMZ import — why would that happen?',
    goldLabel: 'BUG-007', allowedMemberIds: ['BUG-007'] },
  { id: 'S-TRB-05', split: 'dev', competitionType: 'legitimate-governance-troubleshooting',
    question: "An event I just created isn't showing up when I reopen the app — what's wrong?",
    goldLabel: 'BUG-012', allowedMemberIds: ['BUG-012'] },

];

const seenIds = new Set();
for (const e of SCORING_CORPUS_C63) {
  if (seenIds.has(e.id)) throw new Error(`Duplicate C6.3 corpus id: ${e.id}`);
  seenIds.add(e.id);
  if (e.split !== 'dev' && e.split !== 'holdout') throw new Error(`${e.id}: invalid split "${e.split}"`);
}

module.exports = { SCORING_CORPUS_C63 };
