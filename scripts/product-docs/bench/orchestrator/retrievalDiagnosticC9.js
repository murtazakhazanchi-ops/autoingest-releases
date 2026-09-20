'use strict';

// ASK AUTOINGEST — CHECKPOINT 9, PHASE 11. EXPERIMENTAL, FROZEN before
// running (Phase 13's "no tuning after freeze" applies to the acceptance
// sets, not this diagnostic -- but this list itself is written once, in
// full, before any run, and not edited afterward to chase a better score).
//
// 42 single-turn natural-operator queries, covering every category the
// checkpoint brief names: exact terminology, paraphrases, incomplete
// wording, casual English, wrong terminology, overlapping feature names,
// workflow-vs-feature ambiguity, recovery questions, metadata, duplicate
// detection, Transfer Export, Transfer Import, Quick Import, QMZ, Archive
// Maintenance, roadmap, unsupported concepts.
//
// `expected: null` means there is no single correct subject id -- either a
// genuinely open-ended roadmap question (no "search subject" exists) or a
// genuinely unsupported concept where the right behavior is "search
// legitimately finds nothing convincing, then capability_status/roadmap
// establishes UNKNOWN/NOT_SUPPORTED/PLANNED", not "search recall failure".

module.exports = [
  // --- exact terminology ---
  { id: 'D01', query: 'What is Transfer Export?', expected: 'AI-FEAT-038', category: 'exact-terminology' },
  { id: 'D02', query: 'Tell me about Duplicate Detection.', expected: 'AI-FEAT-020', category: 'exact-terminology' },
  { id: 'D03', query: 'What is Quick Import?', expected: 'AI-FEAT-023', category: 'exact-terminology' },
  { id: 'D04', query: 'Explain the QMZ Sequencing Workspace.', expected: 'AI-FEAT-047', category: 'exact-terminology' },

  // --- paraphrases (no shared literal terminology) ---
  { id: 'D05', query: 'Can it detect duplicate files automatically?', expected: 'AI-FEAT-020', category: 'paraphrase' },
  { id: 'D06', query: 'How do I copy a batch of events to a drive so I can physically carry them to the main archive?', expected: 'AI-FEAT-038', category: 'paraphrase' },
  { id: 'D07', query: 'How do I bring content back from a portable drive into the archive?', expected: 'AI-FEAT-039', category: 'paraphrase' },
  { id: 'D08', query: 'Is there a fast way to bring in just a couple of photos without the full process?', expected: 'AI-FEAT-023', category: 'paraphrase' },

  // --- incomplete wording ---
  { id: 'D09', query: 'transfer stopped halfway', expected: 'AI-FEAT-038', category: 'incomplete-wording' },
  { id: 'D10', query: 'duplicate files', expected: 'AI-FEAT-020', category: 'incomplete-wording' },
  { id: 'D11', query: 'archive lock', expected: 'AI-FEAT-045', category: 'incomplete-wording' },

  // --- casual English ---
  { id: 'D12', query: "yo my import thing keeps making copies of the same pic, is that normal", expected: 'AI-FEAT-020', category: 'casual' },
  { id: 'D13', query: 'how do i just grab a couple pics real quick without the whole rigamarole', expected: 'AI-FEAT-023', category: 'casual' },
  { id: 'D14', query: 'drive disconnected mid copy, what now', expected: 'AI-FEAT-038', category: 'casual' },

  // --- wrong/informal terminology ---
  { id: 'D15', query: 'does it dedupe photos', expected: 'AI-FEAT-020', category: 'wrong-terminology' },
  { id: 'D16', query: 'can it sync my folder to a backup drive', expected: 'AI-FEAT-040', category: 'wrong-terminology' },
  { id: 'D17', query: 'the QMZ sorter thing', expected: 'AI-WF-007', category: 'wrong-terminology' },

  // --- overlapping feature names ---
  { id: 'D18', query: 'What does Archive Maintenance do?', expected: 'AI-FEAT-049', category: 'overlapping-names' },
  { id: 'D19', query: 'What does Event Maintenance do?', expected: 'AI-FEAT-050', category: 'overlapping-names' },
  { id: 'D20', query: 'How do I import from a transfer drive?', expected: 'AI-FEAT-039', category: 'overlapping-names' },
  { id: 'D21', query: 'How do I import photos from a memory card?', expected: 'AI-WF-001', category: 'overlapping-names' },

  // --- workflow vs feature ambiguity ---
  { id: 'D22', query: 'How do I sort QMZ photos?', expected: 'AI-WF-007', category: 'workflow-vs-feature' },
  { id: 'D23', query: 'How do I recover from an archive lock error?', expected: 'AI-WF-008', category: 'workflow-vs-feature' },
  { id: 'D24', query: 'How do I export or update a transfer drive?', expected: 'AI-WF-005', category: 'workflow-vs-feature' },

  // --- recovery questions ---
  { id: 'D25', query: 'Can I resume a Transfer Export after a power cut?', expected: 'AI-FEAT-038', category: 'recovery' },
  { id: 'D26', query: 'What happens if metadata writing crashes halfway through?', expected: 'AI-FEAT-030', category: 'recovery' },
  { id: 'D27', query: 'Does the app pick back up if it crashes during import?', expected: 'AI-FEAT-021', category: 'recovery' },

  // --- metadata ---
  { id: 'D28', query: 'How does metadata get written onto the photos?', expected: 'AI-FEAT-029', category: 'metadata' },
  { id: 'D29', query: 'Can I fix wrong metadata after the fact?', expected: 'AI-FEAT-033', category: 'metadata' },
  { id: 'D30', query: 'Does it write keywords onto files automatically?', expected: 'AI-FEAT-036', category: 'metadata' },

  // --- more duplicate detection / transfer coverage ---
  { id: 'D31', query: 'Does it stop me from overwriting an existing file that has the same name?', expected: 'AI-FEAT-020', category: 'duplicate-detection' },
  { id: 'D32', query: 'How do I move an event to another computer physically?', expected: 'AI-FEAT-038', category: 'transfer-export' },
  { id: 'D33', query: 'How do I bring photos back after taking them offsite on a drive?', expected: 'AI-FEAT-039', category: 'transfer-import' },
  { id: 'D34', query: 'Is there a shortcut for importing a small batch?', expected: 'AI-FEAT-023', category: 'quick-import' },
  { id: 'D35', query: 'What does QMZ actually stand for?', expected: 'AI-FEAT-047', category: 'qmz' },

  // --- other features, sanity coverage ---
  { id: 'D36', query: 'Is there a way to search across the whole archive?', expected: 'AI-FEAT-053', category: 'other' },
  { id: 'D37', query: 'Does it verify the integrity of the whole archive?', expected: 'AI-FEAT-054', category: 'other' },
  { id: 'D38', query: 'Can I see who else is online right now?', expected: 'AI-FEAT-048', category: 'other' },

  // --- roadmap (open-ended, no single subject) ---
  { id: 'D39', query: "What's coming next?", expected: null, category: 'roadmap' },
  { id: 'D40', query: 'Has the Archive Browser shipped yet?', expected: 'AI-FEAT-051', category: 'roadmap' },

  // --- unsupported concepts ---
  { id: 'D41', query: 'Can AutoIngest do face recognition on photos?', expected: null, category: 'unsupported' },
  { id: 'D42', query: 'Does it back up automatically to Google Drive or Dropbox?', expected: null, category: 'unsupported' },
];
