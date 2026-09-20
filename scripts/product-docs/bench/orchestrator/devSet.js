'use strict';

// ASK AUTOINGEST — ARCHITECTURE-RESET CHECKPOINT (Phase 11). EXPERIMENTAL.
// Small architecture-DEVELOPMENT set -- generic scenarios, deliberately NOT
// frozen-19 wording, used only to shake out orchestrator bugs (tool-arg
// hallucination, infinite tool loops, no-answer stalls) before the
// prototype is frozen. Never scored as an acceptance result; not reused
// after freezing.

module.exports = [
  { id: 'D01_vague_transfer', turns: ['My transfer stopped halfway.', 'I was exporting to my NAS.'] },
  { id: 'D02_pronoun_followup', turns: ['What is Duplicate Detection?', 'Does it work the same way for Quick Import?'] },
  { id: 'D03_yesno_clarify', turns: ['My archive lock is stuck.', 'Yes, it happened during an import.'] },
  { id: 'D04_unsupported', turns: ['Can I upload my photos to Instagram automatically?'] },
  { id: 'D05_technical', turns: ['Where does AutoIngest store QMZ sequencing state on disk?'] },
];
