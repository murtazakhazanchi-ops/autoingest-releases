'use strict';

// ASK AUTOINGEST — CHECKPOINT 7, PHASE 10. FINAL ACCEPTANCE SET.
//
// 22 NEW conversations, written AFTER the Checkpoint-7 hardened prototype
// was frozen (hashes recorded 2026-08-27T09:40:02Z, see the report). Does
// not reuse wording, subjects-in-that-exact-phrasing, or scenario framing
// from frozen-19, generalization-14, Checkpoint-5 blind-15, Checkpoint-6
// finalBlind25, or this checkpoint's own devSetC7. Never tuned against --
// run once, scored from the transcripts as they come out.

module.exports = [
  { id: 'G01_vague_investigate', category: 'vague->investigate', turns: ['the import screen is just blank', 'nothing loaded even though I plugged in a card'] },
  { id: 'G02_clear_howto', category: 'clear how-to', turns: ['What are the steps for exporting an event to a portable drive?'] },
  { id: 'G03_followup_why', category: 'followup why', turns: ['What does Import Source Attribution do?', 'Why does it need to know which device supplied the files?'] },
  { id: 'G04_followup_afterthat', category: 'followup after', turns: ['How do I recover a stale archive lock?', 'What should I check after that?'] },
  { id: 'G05_dont_understand', category: 'dont understand', turns: ['What is a "same-size-skip" during import?', "I'm lost -- can you explain that differently?"] },
  { id: 'G06_automatic_check', category: 'automatic?', turns: ['Does AutoIngest verify my files are intact on its own, or do I have to trigger that?'] },
  { id: 'G07_wrong_assumption', category: 'wrong assumption', turns: ["I figured AutoIngest emails a report after every import finishes -- where do I find that setting?"] },
  { id: 'G08_unsupported', category: 'unsupported', turns: ['Can AutoIngest publish my imported photos straight to a shared online gallery?'] },
  { id: 'G09_comparison', category: 'comparison', turns: ['How is a Transfer Export different from just copying the archive folder manually?'] },
  { id: 'G10_interrupted', category: 'interrupted', turns: ['my laptop died in the middle of an export, did I lose anything'] },
  { id: 'G11_removable_drive', category: 'removable drive', turns: ['I unplugged the card before the import said it was done, is that a problem'] },
  { id: 'G12_metadata', category: 'metadata', turns: ['Can I bulk-fix metadata across every event at once, or only one at a time?'] },
  { id: 'G13_qmz', category: 'QMZ', turns: ['can I move photos between two different QMZ sequences after they are already assigned'] },
  { id: 'G14_archive_maintenance', category: 'archive maintenance', turns: ['Is there a single place to see if anything in the archive needs attention?'] },
  { id: 'G15_roadmap', category: 'roadmap', turns: ['is event maintenance next after archive maintenance, or is something else first'] },
  { id: 'G16_short_yesno', category: 'short yes/no', turns: ['Import keeps failing on the same file.', 'Does it show a specific error code?', 'yeah'] },
  { id: 'G17_abrupt_topic_change', category: 'abrupt topic change', turns: ['How does the archive decide where a new event folder goes?', 'actually forget that, does AutoIngest tell me if someone else is mid-import on the same event?'] },
  { id: 'G18_pronoun_chain', category: 'pronoun chain', turns: ['What is Source Cleanup?', 'When does it actually run?', 'Can I turn it off?'] },
  { id: 'G19_casual_incomplete', category: 'casual incomplete', turns: ['card wont show up in list why not'] },
  { id: 'G20_technical', category: 'legitimately technical', turns: ['What determines the batch size AutoIngest uses when writing progress checkpoints during a Transfer Export?'] },
  { id: 'G21_competing_records', category: 'competing records', turns: ['If two operators try to adopt the same manually-created folder at the same time, what happens?'] },
  { id: 'G22_troubleshooting', category: 'troubleshooting', turns: ['My archive health report has shown the same warning for two weeks and it wont clear'] },
];
