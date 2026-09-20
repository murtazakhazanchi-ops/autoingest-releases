'use strict';

// ASK AUTOINGEST — ARCHITECTURE-RESET CHECKPOINT (Phase 11, "C"). EXPERIMENTAL.
//
// 15 NEW blind conversations, written ONLY after the orchestrator prototype
// was frozen (see this checkpoint's report for the frozen prototype's
// content hash). Deliberately NOT reusing frozen-19 or generalization-14
// wording, subjects, or phrasing patterns -- new scenarios written from the
// required-category list only. Never tuned against afterward.
//
// Category coverage (每 category appears at least once across the set):
//   vague, clear, pronoun follow-up, yes/no clarification reply,
//   interruption, user correction, topic change, unsupported capability,
//   roadmap, troubleshooting, technical, "I don't understand",
//   terminology misunderstanding, multi-step recovery,
//   clarification genuinely required, clarification NOT required.

module.exports = [
  { id: 'B01_vague_stuck', category: 'vague; clarification required', turns: ['it just sits there and does nothing'] },
  { id: 'B02_clear_howto', category: 'clear; clarification not required', turns: ['How do I import photos from an external hard drive?'] },
  { id: 'B03_pronoun_chain', category: 'pronoun follow-up; multi-turn context', turns: ['What is Metadata Audit & Repair?', 'Can I undo it after running it?', 'Does it touch RAW files too?'] },
  { id: 'B04_yesno_reply', category: 'yes/no clarification reply', turns: ['I got an error during my import.', 'Was it a duplicate file warning?', 'No, something about a lock.'] },
  { id: 'B05_interruption_recovery', category: 'interruption; multi-step recovery', turns: ['The app crashed while I was in the middle of a big import. What happens to the files that already copied?'] },
  { id: 'B06_user_correction', category: 'user correction', turns: ['Can AutoIngest email me when an import finishes?', "No wait, I meant can it just show a desktop notification, not email."] },
  { id: 'B07_topic_change_midflow', category: 'topic change', turns: ['What is Archive Diagnostics for?', 'Actually never mind -- can I run two imports from two different cards at the same time?'] },
  { id: 'B08_unsupported_direct', category: 'unsupported capability; clarification not required', turns: ['Does AutoIngest support importing directly from a phone over WiFi?'] },
  { id: 'B09_roadmap_specific', category: 'roadmap', turns: ['Is there a global search feature planned for AutoIngest?'] },
  { id: 'B10_troubleshooting_vague', category: 'troubleshooting; vague', turns: ['my export keeps failing near the end every time'] },
  { id: 'B11_technical_direct', category: 'technical', turns: ['What triggers a checksum verification during Transfer Export, and is it automatic?'] },
  { id: 'B12_dont_understand', category: '"I don\'t understand"', turns: ['What does "stale lock" mean?', "I still don't get what makes a lock stale versus just active."] },
  { id: 'B13_terminology_confusion', category: 'terminology misunderstanding', turns: ["What's the difference between an Event and a Session in AutoIngest?"] },
  { id: 'B14_multiturn_drift_correction', category: 'topic change + user correction combined', turns: ['How do groups work when importing a multi-photographer event?', 'Sorry, actually I meant sub-events, not photographer groups specifically.'] },
  { id: 'B15_capability_then_howto', category: 'clear capability question then how-to follow-up', turns: ['Can AutoIngest detect duplicate files automatically?', 'Good -- how do I turn that on?'] },
];
