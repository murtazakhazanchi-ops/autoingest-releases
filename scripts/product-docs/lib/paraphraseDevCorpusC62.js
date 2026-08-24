'use strict';

// Phase C6.2 — paraphrase-to-concept development corpus. Companion to
// lib/retrievalEvalCorpusC6.js (C6.1's identity-mention corpus) but
// deliberately disjoint in purpose: every question here is written in
// ordinary operator language that does NOT name a real record's exact
// title/alias — the opposite of what C6.1 targeted. This is the TRAIN/
// DEVELOPMENT + INTERNAL HOLDOUT corpus (Section Q) — never confused with
// the separate, frozen, external 17-question paraphrase holdout (owned
// outside this repo, in the job's own scratch directory — see the C6.2
// report for its location/checksum). That external set was NOT consulted
// while writing any question or gold label below.
//
// Gold labels were assigned by reading each candidate record's own
// canonical summary/title BEFORE running the question through the engine
// — never adjusted after seeing what the engine currently returns. Where
// a question is genuinely ambiguous between two real records, goldLabel
// is 'NO_SINGLE_PRIMARY' with both allowed. Where no record actually
// documents the claim, goldLabel is 'SHOULD_WITHHOLD'.
//
// paraphraseClass values (Section F): SYNONYM, OPERATOR_ACTION,
// OBJECT_FIRST, OUTCOME_FIRST, FAILURE_FIRST, UI_INTENT, DOMAIN_SHORTHAND,
// NON_CANONICAL_VERB, PRONOUN_LIGHT, MULTI_WORD_DESCRIPTION.
//
// split: 'dev' (~70%, tunable against) | 'holdout' (~30%, internal —
// never tuned against; a second, harder gate before the external frozen
// set is ever run).

const PARAPHRASE_CORPUS_C62 = [

  // ======================================================================
  // Event creation / editing / maintenance
  // ======================================================================
  { id: 'P-EVT-01', split: 'dev', domain: 'Event creation', paraphraseClass: 'OPERATOR_ACTION',
    question: 'I need to set up a brand new shoot before I can bring in any photos.',
    goldLabel: 'AI-WF-002', allowedMemberIds: ['AI-WF-002', 'AI-FEAT-009'] },
  { id: 'P-EVT-02', split: 'dev', domain: 'Event creation', paraphraseClass: 'MULTI_WORD_DESCRIPTION',
    question: 'What information does the wizard ask for when I start a fresh archive entry?',
    goldLabel: 'AI-FEAT-009', allowedMemberIds: ['AI-FEAT-009', 'AI-WF-002'] },
  { id: 'P-EVT-03', split: 'holdout', domain: 'Event editing', paraphraseClass: 'OUTCOME_FIRST',
    question: "I got the location wrong and need to correct it after the fact.",
    goldLabel: 'AI-FEAT-010', allowedMemberIds: ['AI-FEAT-010'] },
  { id: 'P-EVT-04', split: 'dev', domain: 'Event editing', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'How do I fix the details on a shoot that already exists?',
    goldLabel: 'AI-FEAT-010', allowedMemberIds: ['AI-FEAT-010'] },
  { id: 'P-EVT-05', split: 'holdout', domain: 'Event maintenance', paraphraseClass: 'UI_INTENT',
    question: 'Where would I go to tidy up an event once the shoot is long finished?',
    goldLabel: 'AI-FEAT-050', allowedMemberIds: ['AI-FEAT-050'] },

  // ======================================================================
  // Import — general / SD card / Quick Import
  // ======================================================================
  { id: 'P-IMP-01', split: 'dev', domain: 'Import general', paraphraseClass: 'OPERATOR_ACTION',
    question: 'How do I bring photos in from a memory card?',
    goldLabel: 'AI-WF-001', allowedMemberIds: ['AI-WF-001'] },
  { id: 'P-IMP-02', split: 'dev', domain: 'Import general', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'What is the process for pulling files off an external drive into the archive?',
    goldLabel: 'AI-WF-001', allowedMemberIds: ['AI-WF-001', 'AI-FEAT-012'] },
  { id: 'P-IMP-03', split: 'holdout', domain: 'Import general', paraphraseClass: 'FAILURE_FIRST',
    question: "The card isn't showing up as something I can pick from at all.",
    goldLabel: 'AI-FEAT-011', allowedMemberIds: ['AI-FEAT-011'] },
  { id: 'P-IMP-04', split: 'dev', domain: 'Quick Import', paraphraseClass: 'OUTCOME_FIRST',
    question: 'I just want to dump a handful of files somewhere without building out a whole event first.',
    goldLabel: 'AI-WF-003', allowedMemberIds: ['AI-WF-003', 'AI-FEAT-023'] },
  { id: 'P-IMP-05', split: 'holdout', domain: 'Quick Import', paraphraseClass: 'OBJECT_FIRST',
    question: 'A small handful of photos — is there a faster path than the full import wizard?',
    goldLabel: 'AI-WF-003', allowedMemberIds: ['AI-WF-003', 'AI-FEAT-023'] },

  // ======================================================================
  // Source detection / selection
  // ======================================================================
  { id: 'P-SRC-01', split: 'dev', domain: 'Source detection', paraphraseClass: 'FAILURE_FIRST',
    question: "The app doesn't seem to notice the drive I just plugged in.",
    goldLabel: 'AI-FEAT-011', allowedMemberIds: ['AI-FEAT-011'] },
  { id: 'P-SRC-02', split: 'holdout', domain: 'Source detection', paraphraseClass: 'MULTI_WORD_DESCRIPTION',
    question: 'How does the software figure out which connected devices actually have photos worth importing?',
    goldLabel: 'AI-FEAT-011', allowedMemberIds: ['AI-FEAT-011'] },
  { id: 'P-SRC-03', split: 'dev', domain: 'Source selection', paraphraseClass: 'OPERATOR_ACTION',
    question: 'How do I pick a plain folder on my computer as the place to import from?',
    goldLabel: 'AI-FEAT-012', allowedMemberIds: ['AI-FEAT-012'] },
  { id: 'P-SRC-04', split: 'holdout', domain: 'Source selection', paraphraseClass: 'SYNONYM',
    question: 'Can I choose a local drive instead of a memory card as my starting point?',
    goldLabel: 'AI-FEAT-012', allowedMemberIds: ['AI-FEAT-012'] },

  // ======================================================================
  // Grouping / photographer routing / event-component routing
  // ======================================================================
  { id: 'P-GRP-01', split: 'dev', domain: 'Grouping', paraphraseClass: 'OBJECT_FIRST',
    question: 'These files belong to two different parts of the same event — how do I split them apart during import?',
    goldLabel: 'AI-FEAT-017', allowedMemberIds: ['AI-FEAT-017'] },
  { id: 'P-GRP-02', split: 'holdout', domain: 'Grouping', paraphraseClass: 'MULTI_WORD_DESCRIPTION',
    question: 'Is there a way to sort files into their sub-event before they get copied anywhere?',
    goldLabel: 'AI-FEAT-017', allowedMemberIds: ['AI-FEAT-017'] },
  { id: 'P-GRP-03', split: 'dev', domain: 'Photographer routing', paraphraseClass: 'MULTI_WORD_DESCRIPTION',
    question: "How does the app know which photographer's folder a picture should land in?",
    goldLabel: 'AI-FEAT-022', allowedMemberIds: ['AI-FEAT-022'] },
  { id: 'P-GRP-04', split: 'holdout', domain: 'Event-component routing', paraphraseClass: 'OUTCOME_FIRST',
    question: 'I want to know exactly what folder path my files end up at once the copy finishes.',
    goldLabel: 'AI-FEAT-018', allowedMemberIds: ['AI-FEAT-018'] },

  // ======================================================================
  // RAW / JPEG / video handling
  // ======================================================================
  { id: 'P-RAW-01', split: 'dev', domain: 'RAW/JPEG handling', paraphraseClass: 'OBJECT_FIRST',
    question: 'These RAW files — do they get copied any differently than the JPEGs next to them?',
    goldLabel: 'AI-FEAT-019', allowedMemberIds: ['AI-FEAT-019'] },
  { id: 'P-RAW-02', split: 'holdout', domain: 'RAW/JPEG handling', paraphraseClass: 'SYNONYM',
    question: 'Does the copy engine treat camera-native files any differently from compressed ones?',
    goldLabel: 'AI-FEAT-019', allowedMemberIds: ['AI-FEAT-019'] },
  { id: 'P-RAW-03', split: 'dev', domain: 'Video handling', paraphraseClass: 'UI_INTENT',
    question: 'Where do video clips end up compared to still photos after an import?',
    goldLabel: 'AI-FEAT-018', allowedMemberIds: ['AI-FEAT-018', 'AI-FEAT-019'] },

  // ======================================================================
  // Metadata application / audit / repair / verification
  // ======================================================================
  { id: 'P-MET-01', split: 'dev', domain: 'Metadata application', paraphraseClass: 'OBJECT_FIRST',
    question: 'The keyword tags that end up baked into my photos — where do those actually come from?',
    goldLabel: 'AI-FEAT-029', allowedMemberIds: ['AI-FEAT-029'] },
  { id: 'P-MET-02', split: 'holdout', domain: 'Metadata audit', paraphraseClass: 'MULTI_WORD_DESCRIPTION',
    question: 'Is there a tool that checks the whole archive for metadata that got written wrong?',
    goldLabel: 'AI-FEAT-033', allowedMemberIds: ['AI-FEAT-033'] },
  { id: 'P-MET-03', split: 'dev', domain: 'Metadata repair', paraphraseClass: 'FAILURE_FIRST',
    question: "Some of my files came out with the wrong keywords on them — can that be corrected after the fact?",
    goldLabel: 'AI-FEAT-033', allowedMemberIds: ['AI-FEAT-033', 'AI-WF-004'] },
  { id: 'P-MET-04', split: 'holdout', domain: 'Metadata verification', paraphraseClass: 'OUTCOME_FIRST',
    question: 'I need confidence that the tags actually got written correctly, not just that the file copied.',
    goldLabel: 'AI-FEAT-032', allowedMemberIds: ['AI-FEAT-032'] },
  { id: 'P-MET-05', split: 'dev', domain: 'Metadata management UI', paraphraseClass: 'UI_INTENT',
    question: 'Where in the app do I go to review metadata problems across an event?',
    goldLabel: 'AI-FEAT-034', allowedMemberIds: ['AI-FEAT-034', 'AI-FEAT-033'] },

  // ======================================================================
  // QMZ
  // ======================================================================
  { id: 'P-QMZ-01', split: 'dev', domain: 'QMZ', paraphraseClass: 'DOMAIN_SHORTHAND',
    question: 'How do I get the Qadam and Majlis photos into their right order after the event?',
    goldLabel: 'AI-FEAT-047', allowedMemberIds: ['AI-FEAT-047', 'AI-WF-007'] },
  { id: 'P-QMZ-02', split: 'holdout', domain: 'QMZ', paraphraseClass: 'DOMAIN_SHORTHAND',
    question: 'Is there a dedicated way to sequence Ziyafat photography separately from a normal import?',
    goldLabel: 'AI-FEAT-047', allowedMemberIds: ['AI-FEAT-047', 'AI-WF-007'] },

  // ======================================================================
  // Transfer Export / Transfer Import / Scan for New Data / Update Backup / resume
  // ======================================================================
  { id: 'P-TRX-01', split: 'dev', domain: 'Transfer Export', paraphraseClass: 'OPERATOR_ACTION',
    question: 'How do I send an event to another drive so it can travel to the main office?',
    goldLabel: 'AI-WF-005', allowedMemberIds: ['AI-WF-005', 'AI-FEAT-038'] },
  { id: 'P-TRX-02', split: 'holdout', domain: 'Transfer Export', paraphraseClass: 'UI_INTENT',
    question: 'Where do I go to make a portable copy of an event for physical transport?',
    goldLabel: 'AI-WF-005', allowedMemberIds: ['AI-WF-005', 'AI-FEAT-038'] },
  { id: 'P-TRX-03', split: 'dev', domain: 'Transfer Import', paraphraseClass: 'OPERATOR_ACTION',
    question: 'Once a drive physically arrives at the office, how do those files actually get into the main archive?',
    goldLabel: 'AI-WF-009', allowedMemberIds: ['AI-WF-009', 'AI-FEAT-039'] },
  { id: 'P-TRX-04', split: 'holdout', domain: 'Scan for New Data', paraphraseClass: 'MULTI_WORD_DESCRIPTION',
    question: 'Can the app tell me what has changed on a drive since I last copied from it, without recopying everything?',
    goldLabel: 'AI-WF-005', allowedMemberIds: ['AI-WF-005', 'AI-WF-009', 'AI-FEAT-040'] },
  { id: 'P-TRX-05', split: 'dev', domain: 'Update Backup', paraphraseClass: 'SYNONYM',
    question: 'How do I refresh an existing backup drive with whatever is new since last time?',
    goldLabel: 'AI-FEAT-040', allowedMemberIds: ['AI-FEAT-040', 'AI-WF-005'] },
  { id: 'P-TRX-06', split: 'holdout', domain: 'Interrupted transfer', paraphraseClass: 'FAILURE_FIRST',
    question: 'The copy to the transfer drive died halfway — what happens now?',
    goldLabel: 'AI-WF-009', allowedMemberIds: ['AI-WF-009', 'AI-WF-005', 'BUG-005'] },
  { id: 'P-TRX-07', split: 'dev', domain: 'Interrupted transfer', paraphraseClass: 'OUTCOME_FIRST',
    question: 'I need to know whether I have to start the whole export over if it gets cut off partway.',
    goldLabel: 'AI-WF-005', allowedMemberIds: ['AI-WF-005', 'AI-WF-009'] },

  // ======================================================================
  // Archive diagnostics / health / maintenance / root config / lock
  // ======================================================================
  { id: 'P-ARC-01', split: 'dev', domain: 'Archive diagnostics', paraphraseClass: 'MULTI_WORD_DESCRIPTION',
    question: 'Is there something that checks the archive for missing or broken files across the board?',
    goldLabel: 'AI-FEAT-043', allowedMemberIds: ['AI-FEAT-043'] },
  { id: 'P-ARC-02', split: 'holdout', domain: 'Archive health', paraphraseClass: 'UI_INTENT',
    question: 'Where can I see an overall picture of how healthy the archive currently is?',
    goldLabel: 'AI-FEAT-043', allowedMemberIds: ['AI-FEAT-043'] },
  { id: 'P-ARC-03', split: 'dev', domain: 'Archive maintenance', paraphraseClass: 'OUTCOME_FIRST',
    question: 'Beyond fixing metadata, is there a bigger cleanup pass planned for the whole archive?',
    goldLabel: 'AI-FEAT-049', allowedMemberIds: ['AI-FEAT-049'] },
  { id: 'P-ARC-04', split: 'holdout', domain: 'Archive root configuration', paraphraseClass: 'OPERATOR_ACTION',
    question: 'How do I tell the app which server or NAS should be treated as the permanent archive?',
    goldLabel: 'AI-FEAT-042', allowedMemberIds: ['AI-FEAT-042'] },
  { id: 'P-ARC-05', split: 'dev', domain: 'Archive lock', paraphraseClass: 'FAILURE_FIRST',
    question: "I can't import into this event, it says something else is already writing to it.",
    goldLabel: 'AI-FEAT-045', allowedMemberIds: ['AI-FEAT-045', 'AI-WF-008'] },
  { id: 'P-ARC-06', split: 'holdout', domain: 'Duplicate detection', paraphraseClass: 'OUTCOME_FIRST',
    question: "I don't want the same photo copied in twice by accident — does the app guard against that?",
    goldLabel: 'AI-FEAT-020', allowedMemberIds: ['AI-FEAT-020'] },
  { id: 'P-ARC-07', split: 'dev', domain: 'Checksum verification', paraphraseClass: 'OUTCOME_FIRST',
    question: 'How can I be sure a file actually made it across intact and wasn\'t corrupted in the copy?',
    goldLabel: 'AI-FEAT-025', allowedMemberIds: ['AI-FEAT-025'] },
  { id: 'P-ARC-08', split: 'holdout', domain: 'Source attribution', paraphraseClass: 'MULTI_WORD_DESCRIPTION',
    question: 'Does the archive keep a record of which memory card or drive a given photo originally came from?',
    goldLabel: 'AI-FEAT-028', allowedMemberIds: ['AI-FEAT-028'] },

  // ======================================================================
  // Online Registry / Team Live
  // ======================================================================
  { id: 'P-REG-01', split: 'dev', domain: 'Online Registry', paraphraseClass: 'OPERATOR_ACTION',
    question: "Someone else already made this event on their laptop — how do I get it onto mine without redoing it?",
    goldLabel: 'AI-WF-006', allowedMemberIds: ['AI-WF-006', 'AI-FEAT-048'] },
  { id: 'P-REG-02', split: 'holdout', domain: 'Online Registry', paraphraseClass: 'MULTI_WORD_DESCRIPTION',
    question: "How can two people working from different locations end up using the exact same event identity?",
    goldLabel: 'AI-WF-006', allowedMemberIds: ['AI-WF-006', 'AI-FEAT-048'] },
  { id: 'P-REG-03', split: 'dev', domain: 'Online Registry', paraphraseClass: 'UI_INTENT',
    question: 'Where do I check which other machines are currently active?',
    goldLabel: 'AI-FEAT-048', allowedMemberIds: ['AI-FEAT-048', 'AI-WF-006'] },

  // ======================================================================
  // Operator / login, settings, auto-update, telemetry, roadmap
  // ======================================================================
  { id: 'P-OPS-01', split: 'dev', domain: 'Operator/login', paraphraseClass: 'MULTI_WORD_DESCRIPTION',
    question: 'How does the app know which person is currently doing the importing?',
    goldLabel: 'AI-FEAT-002', allowedMemberIds: ['AI-FEAT-002'] },
  { id: 'P-OPS-02', split: 'holdout', domain: 'Settings', paraphraseClass: 'OUTCOME_FIRST',
    question: 'Will my preferences carry over the next time I open the application?',
    goldLabel: 'AI-FEAT-005', allowedMemberIds: ['AI-FEAT-005'] },
  { id: 'P-OPS-03', split: 'dev', domain: 'Auto-update', paraphraseClass: 'OPERATOR_ACTION',
    question: 'What do I do to get the latest version of the software once one is out?',
    goldLabel: 'AI-FEAT-006', allowedMemberIds: ['AI-FEAT-006'] },
  { id: 'P-OPS-04', split: 'holdout', domain: 'Telemetry/status', paraphraseClass: 'OUTCOME_FIRST',
    question: 'Does using this app send any information about my usage back to anyone?',
    goldLabel: 'SHOULD_WITHHOLD' },
  { id: 'P-OPS-05', split: 'dev', domain: 'Roadmap', paraphraseClass: 'OUTCOME_FIRST',
    question: "What's actually being built next for this app?",
    goldLabel: 'roadmap-dashboard', allowedMemberIds: ['roadmap-dashboard'] },

  // ======================================================================
  // Capability / not-supported boundary questions (natural phrasing)
  // ======================================================================
  { id: 'P-CAP-01', split: 'dev', domain: 'Capability boundary', paraphraseClass: 'OUTCOME_FIRST',
    question: 'Can the software recognize which people are in a photo automatically?',
    goldLabel: 'SHOULD_WITHHOLD', allowedMemberIds: ['face-recognition'] },
  { id: 'P-CAP-02', split: 'holdout', domain: 'Capability boundary', paraphraseClass: 'OUTCOME_FIRST',
    question: 'Is there a way to push my archive up into Dropbox or a similar cloud service?',
    goldLabel: 'SHOULD_WITHHOLD', allowedMemberIds: ['cloud-storage'] },
  { id: 'P-CAP-03', split: 'dev', domain: 'Capability boundary', paraphraseClass: 'OUTCOME_FIRST',
    question: 'Am I able to browse through everything already sitting in the archive with a proper viewer?',
    goldLabel: 'AI-FEAT-051', allowedMemberIds: ['AI-FEAT-051'] },

  // ======================================================================
  // Additional cross-domain paraphrase variety (thumbnails, preview, file browser, atomic import)
  // ======================================================================
  { id: 'P-MISC-01', split: 'dev', domain: 'Thumbnails/preview', paraphraseClass: 'OUTCOME_FIRST',
    question: 'Can I get a look at the photos before they actually get copied anywhere?',
    goldLabel: 'AI-FEAT-015', allowedMemberIds: ['AI-FEAT-015', 'AI-FEAT-014'] },
  { id: 'P-MISC-02', split: 'holdout', domain: 'File browser', paraphraseClass: 'UI_INTENT',
    question: 'Where do I go to look through everything already in a folder as a grid instead of a list?',
    goldLabel: 'AI-FEAT-013', allowedMemberIds: ['AI-FEAT-013'] },
  { id: 'P-MISC-03', split: 'dev', domain: 'Atomic import safety', paraphraseClass: 'OUTCOME_FIRST',
    question: 'If the app crashes in the middle of copying, could I end up with half an import sitting in the archive?',
    goldLabel: 'AI-FEAT-021', allowedMemberIds: ['AI-FEAT-021'] },
  { id: 'P-MISC-04', split: 'holdout', domain: 'Global search', paraphraseClass: 'OUTCOME_FIRST',
    question: 'Can I just type a plain-language question and have it search across the whole archive for me?',
    goldLabel: 'AI-FEAT-053', allowedMemberIds: ['AI-FEAT-053'] },

  // ======================================================================
  // Ambiguous / competing-concept cases (honest NO_SINGLE_PRIMARY)
  // ======================================================================
  { id: 'P-AMBIG-01', split: 'dev', domain: 'Ambiguous', paraphraseClass: 'OUTCOME_FIRST',
    question: 'I need another copy of the whole archive somewhere else, just in case.',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-038', 'AI-FEAT-040', 'AI-FEAT-044'] },
  { id: 'P-AMBIG-02', split: 'holdout', domain: 'Ambiguous', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'How do I move a bunch of files into the archive quickly without much setup?',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-WF-001', 'AI-WF-003', 'AI-FEAT-023'] },
  { id: 'P-AMBIG-03', split: 'dev', domain: 'Ambiguous', paraphraseClass: 'OUTCOME_FIRST',
    question: 'I want to check that everything is okay with a batch of files after copying them.',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-025', 'AI-FEAT-026', 'AI-FEAT-032'] },

  // ======================================================================
  // Short / colloquial fragments
  // ======================================================================
  { id: 'P-SHORT-01', split: 'dev', domain: 'Short', paraphraseClass: 'DOMAIN_SHORTHAND', question: 'sd card import?', goldLabel: 'AI-WF-001', allowedMemberIds: ['AI-WF-001'] },
  { id: 'P-SHORT-02', split: 'holdout', domain: 'Short', paraphraseClass: 'DOMAIN_SHORTHAND', question: 'raw vs jpeg?', goldLabel: 'AI-FEAT-019', allowedMemberIds: ['AI-FEAT-019'] },
  { id: 'P-SHORT-03', split: 'dev', domain: 'Short', paraphraseClass: 'DOMAIN_SHORTHAND', question: 'metadata fix tool', goldLabel: 'AI-FEAT-033', allowedMemberIds: ['AI-FEAT-033'] },
  { id: 'P-SHORT-04', split: 'holdout', domain: 'Short', paraphraseClass: 'DOMAIN_SHORTHAND', question: 'send to backup drive', goldLabel: 'AI-WF-005', allowedMemberIds: ['AI-WF-005', 'AI-FEAT-038', 'AI-FEAT-040'] },
  { id: 'P-SHORT-05', split: 'dev', domain: 'Short', paraphraseClass: 'DOMAIN_SHORTHAND', question: 'archive locked, help', goldLabel: 'AI-FEAT-045', allowedMemberIds: ['AI-FEAT-045', 'AI-WF-008'] },

  // ======================================================================
  // "is there a way to..." / "can I..." intent forms
  // ======================================================================
  { id: 'P-CANI-01', split: 'dev', domain: 'Can I', paraphraseClass: 'UI_INTENT', question: 'Is there a way to see who else is working right now without calling them?', goldLabel: 'AI-WF-006', allowedMemberIds: ['AI-WF-006', 'AI-FEAT-048'] },
  { id: 'P-CANI-02', split: 'holdout', domain: 'Can I', paraphraseClass: 'UI_INTENT', question: 'Can I undo a group assignment once I have made it during import?', goldLabel: 'AI-FEAT-017', allowedMemberIds: ['AI-FEAT-017'] },
  { id: 'P-CANI-03', split: 'dev', domain: 'Can I', paraphraseClass: 'UI_INTENT', question: 'Is there a way to check whether a photographer folder already exists before I import into it?', goldLabel: 'AI-FEAT-022', allowedMemberIds: ['AI-FEAT-022'] },

  // ======================================================================
  // "why..." intent forms
  // ======================================================================
  { id: 'P-WHY-01', split: 'dev', domain: 'Why', paraphraseClass: 'OUTCOME_FIRST', question: 'Why would the app skip copying a file instead of just overwriting the old one?', goldLabel: 'AI-FEAT-019', allowedMemberIds: ['AI-FEAT-019', 'DEC-005'] },
  { id: 'P-WHY-02', split: 'holdout', domain: 'Why', paraphraseClass: 'OUTCOME_FIRST', question: 'Why does a stale lock get released automatically instead of needing to be cleared by hand?', goldLabel: 'AI-FEAT-045', allowedMemberIds: ['AI-FEAT-045'] },

  // ======================================================================
  // Batch 2 — reaching the 80+ minimum, correcting dev/holdout ratio toward
  // 70/30, filling underrepresented paraphrase classes (NON_CANONICAL_VERB,
  // SYNONYM) and a few more domain areas.
  // ======================================================================
  { id: 'P-EXT-01', split: 'dev', domain: 'Import general', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'What is the correct way to grab files off a card without breaking anything on it?',
    goldLabel: 'AI-WF-001', allowedMemberIds: ['AI-WF-001'] },
  { id: 'P-EXT-02', split: 'dev', domain: 'Transfer Export', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'How do I move a finished event over to a drive I can carry with me?',
    goldLabel: 'AI-WF-005', allowedMemberIds: ['AI-WF-005', 'AI-FEAT-038'] },
  { id: 'P-EXT-03', split: 'dev', domain: 'Metadata repair', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'What tool would I use to check and mend metadata that came out wrong?',
    goldLabel: 'AI-FEAT-033', allowedMemberIds: ['AI-FEAT-033'] },
  { id: 'P-EXT-04', split: 'dev', domain: 'Duplicate detection', paraphraseClass: 'SYNONYM',
    question: 'Does the app catch it if the exact same picture already exists at the destination?',
    goldLabel: 'AI-FEAT-020', allowedMemberIds: ['AI-FEAT-020'] },
  { id: 'P-EXT-05', split: 'dev', domain: 'Event creation', paraphraseClass: 'SYNONYM',
    question: 'What is the first screen for beginning a brand-new archival record?',
    goldLabel: 'AI-FEAT-009', allowedMemberIds: ['AI-FEAT-009', 'AI-WF-002'] },
  { id: 'P-EXT-06', split: 'dev', domain: 'Archive lock', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'How do I clear a lock that got left behind after a crash?',
    goldLabel: 'AI-FEAT-045', allowedMemberIds: ['AI-FEAT-045', 'AI-WF-008'] },
  { id: 'P-EXT-07', split: 'dev', domain: 'Checksum verification', paraphraseClass: 'SYNONYM',
    question: 'Is the file hash checked to confirm nothing got damaged during the transfer?',
    goldLabel: 'AI-FEAT-025', allowedMemberIds: ['AI-FEAT-025'] },
  { id: 'P-EXT-08', split: 'dev', domain: 'Grouping', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'How would I separate one photographer\'s files from another\'s during the same import?',
    goldLabel: 'AI-FEAT-017', allowedMemberIds: ['AI-FEAT-017', 'AI-FEAT-022'] },
  { id: 'P-EXT-09', split: 'dev', domain: 'Source detection', paraphraseClass: 'SYNONYM',
    question: 'Will a Sony camera\'s odd folder layout still get picked up correctly?',
    goldLabel: 'AI-FEAT-011', allowedMemberIds: ['AI-FEAT-011'] },
  { id: 'P-EXT-10', split: 'dev', domain: 'Update Backup', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'How do I top up an older backup drive with only what has changed?',
    goldLabel: 'AI-FEAT-040', allowedMemberIds: ['AI-FEAT-040', 'AI-WF-005'] },
  { id: 'P-EXT-11', split: 'dev', domain: 'QMZ', paraphraseClass: 'MULTI_WORD_DESCRIPTION',
    question: 'What review step happens after the initial sort in the Qadam/Majlis/Ziyafat workflow?',
    goldLabel: 'AI-WF-007', allowedMemberIds: ['AI-WF-007', 'AI-FEAT-047'] },
  { id: 'P-EXT-12', split: 'dev', domain: 'Online Registry', paraphraseClass: 'FAILURE_FIRST',
    question: "The team panel still shows a device as online even though it clearly isn't anymore.",
    goldLabel: 'AI-FEAT-048', allowedMemberIds: ['AI-FEAT-048', 'AI-WF-006'] },
  { id: 'P-EXT-13', split: 'dev', domain: 'Event editing', paraphraseClass: 'OBJECT_FIRST',
    question: "An event's country field is wrong — what's the process for correcting it?",
    goldLabel: 'AI-FEAT-010', allowedMemberIds: ['AI-FEAT-010'] },
  { id: 'P-EXT-14', split: 'dev', domain: 'Thumbnails/preview', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'How does the app generate the small preview images shown in the grid?',
    goldLabel: 'AI-FEAT-014', allowedMemberIds: ['AI-FEAT-014'] },
  { id: 'P-EXT-15', split: 'dev', domain: 'Archive root configuration', paraphraseClass: 'MULTI_WORD_DESCRIPTION',
    question: 'What is the difference between the working drive I use day-to-day and the permanent office server?',
    goldLabel: 'AI-FEAT-042', allowedMemberIds: ['AI-FEAT-042'] },
  { id: 'P-EXT-16', split: 'dev', domain: 'Metadata application', paraphraseClass: 'SYNONYM',
    question: 'Is there one shared engine responsible for writing tags no matter which workflow triggered it?',
    goldLabel: 'AI-FEAT-029', allowedMemberIds: ['AI-FEAT-029'] },
  { id: 'P-EXT-17', split: 'dev', domain: 'Transfer Import', paraphraseClass: 'SYNONYM',
    question: 'When merging content from a portable drive back into the main archive, are duplicate folder structures avoided?',
    goldLabel: 'AI-WF-009', allowedMemberIds: ['AI-WF-009', 'AI-FEAT-039'] },
  { id: 'P-EXT-18', split: 'dev', domain: 'Capability boundary', paraphraseClass: 'OUTCOME_FIRST',
    question: 'Could two different people log into this application with separate permission levels?',
    goldLabel: 'SHOULD_WITHHOLD', allowedMemberIds: ['multi-user-roles'] },
  { id: 'P-EXT-19', split: 'dev', domain: 'Archive health', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'How would I confirm nothing is missing after a big import session?',
    goldLabel: 'AI-FEAT-043', allowedMemberIds: ['AI-FEAT-043', 'AI-FEAT-026'] },
  { id: 'P-EXT-20', split: 'dev', domain: 'Photographer routing', paraphraseClass: 'OBJECT_FIRST',
    question: "A photographer's name folder — what decides how that gets spelled inside the archive?",
    goldLabel: 'AI-FEAT-022', allowedMemberIds: ['AI-FEAT-022'] },
  { id: 'P-EXT-21', split: 'dev', domain: 'Quick Import', paraphraseClass: 'SYNONYM',
    question: 'Is there a lightweight copy mode that skips the usual event setup entirely?',
    goldLabel: 'AI-WF-003', allowedMemberIds: ['AI-WF-003', 'AI-FEAT-023'] },
  { id: 'P-EXT-22', split: 'dev', domain: 'Roadmap', paraphraseClass: 'SYNONYM',
    question: 'Which of the planned milestones has the team already finished?',
    goldLabel: 'roadmap-dashboard', allowedMemberIds: ['roadmap-dashboard'] },
  { id: 'P-EXT-23', split: 'dev', domain: 'Ambiguous', paraphraseClass: 'OUTCOME_FIRST',
    question: 'I just want everything confirmed correct before I consider this event finished.',
    goldLabel: 'NO_SINGLE_PRIMARY', allowedMemberIds: ['AI-FEAT-043', 'AI-FEAT-025', 'AI-FEAT-026', 'AI-FEAT-032'] },
  { id: 'P-EXT-24', split: 'dev', domain: 'RAW/JPEG handling', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'Does bringing in camera-native image files require any special handling on my part?',
    goldLabel: 'AI-FEAT-019', allowedMemberIds: ['AI-FEAT-019'] },
  { id: 'P-EXT-25', split: 'dev', domain: 'Login', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'How do I switch which operator profile is active before starting work?',
    goldLabel: 'AI-FEAT-002', allowedMemberIds: ['AI-FEAT-002'] },
  { id: 'P-EXT-26', split: 'dev', domain: 'Auto-update', paraphraseClass: 'SYNONYM',
    question: 'Is there a way to try an early build before it becomes the official release?',
    goldLabel: 'AI-FEAT-006', allowedMemberIds: ['AI-FEAT-006', 'AI-FEAT-057'] },
  { id: 'P-EXT-27', split: 'dev', domain: 'Global search', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'Is there a single box where I can look something up across every event at once?',
    goldLabel: 'AI-FEAT-053', allowedMemberIds: ['AI-FEAT-053'] },
  { id: 'P-EXT-28', split: 'dev', domain: 'Event-component routing', paraphraseClass: 'SYNONYM',
    question: 'For an event made up of several parts, does each part get its own folder inside the archive?',
    goldLabel: 'AI-FEAT-018', allowedMemberIds: ['AI-FEAT-018'] },
  { id: 'P-EXT-29', split: 'dev', domain: 'Source attribution', paraphraseClass: 'NON_CANONICAL_VERB',
    question: 'Can I trace a photo back to the exact card it was pulled from later on?',
    goldLabel: 'AI-FEAT-028', allowedMemberIds: ['AI-FEAT-028'] },

];

const seenIds = new Set();
for (const e of PARAPHRASE_CORPUS_C62) {
  if (seenIds.has(e.id)) throw new Error(`Duplicate C6.2 corpus id: ${e.id}`);
  seenIds.add(e.id);
  if (e.split !== 'dev' && e.split !== 'holdout') throw new Error(`${e.id}: invalid split "${e.split}"`);
}

module.exports = { PARAPHRASE_CORPUS_C62 };
