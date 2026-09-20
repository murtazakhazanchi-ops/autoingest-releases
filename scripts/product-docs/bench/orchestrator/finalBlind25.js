'use strict';

// ASK AUTOINGEST — CHECKPOINT 6, PHASE 6. FINAL ACCEPTANCE SET.
//
// 25 NEW conversations, written AFTER the hardened prototype was frozen
// (hashes recorded 2026-08-27T08:55:20Z, see the report). Does not reuse
// wording, subjects-in-that-exact-phrasing, or scenario framing from
// frozen-19, generalization-14, Checkpoint-5 blind-15, or Checkpoint-6's
// own devSetC6. Written to read like realistic operator messages, not
// benchmark questions. Never tuned against -- run once, scored from the
// transcripts as they come out.

module.exports = [
  // vague problem -> assistant investigates -> resolution
  { id: 'F01_vague_investigate', category: 'vague->investigate->resolve', turns: ['nothing happens when I hit import', 'its a memory card, the little green light is on'] },
  // clear how-to
  { id: 'F02_clear_howto', category: 'clear how-to', turns: ['What are the steps to register an old folder I made by hand as a proper event?'] },
  // follow-up "why?"
  { id: 'F03_followup_why', category: 'followup why', turns: ['What does Source Detection do?', 'Why does it need to tell DCIM apart from a plain folder?'] },
  // follow-up "what happens after that?"
  { id: 'F04_followup_afterthat', category: 'followup what-happens-after', turns: ['How does an operator finish a Transfer Export?', 'And what happens after the copy finishes?'] },
  // "I don't understand"
  { id: 'F05_dont_understand', category: 'dont understand', turns: ['What is a checkpoint in a Transfer Export?', "Sorry, I still don't get it -- what does that actually mean for me?"] },
  // "does it do X automatically?"
  { id: 'F06_automatic_check', category: 'does it do X automatically', turns: ['Does the metadata get fixed automatically or do I have to do something?'] },
  // incorrect operator assumption
  { id: 'F07_wrong_assumption', category: 'incorrect assumption', turns: ["I assume AutoIngest deletes the memory card contents once it's safely imported?"] },
  // unsupported feature
  { id: 'F08_unsupported', category: 'unsupported feature', turns: ['Can I set up AutoIngest to text me when a job is done?'] },
  // comparison between two workflows
  { id: 'F09_comparison', category: 'comparison of workflows', turns: ['Whats the real difference between doing a Quick Import versus a normal Event Import?'] },
  // interrupted operation
  { id: 'F10_interrupted', category: 'interrupted operation', turns: ['power went out mid copy, is anything corrupted now?'] },
  // removable-drive/NAS scenario
  { id: 'F11_removable_nas', category: 'removable drive / NAS', turns: ['I pulled the drive out too early during an export, what do I do'] },
  // metadata question
  { id: 'F12_metadata', category: 'metadata', turns: ['Can I search for files with missing keywords across the whole archive?'] },
  // QMZ
  { id: 'F13_qmz', category: 'QMZ', turns: ['My QMZ sequence numbers look wrong after I moved some files around'] },
  // archive maintenance
  { id: 'F14_archive_maintenance', category: 'archive maintenance', turns: ['Is there a way to check the whole archive is healthy right now?'] },
  // roadmap/current-development
  { id: 'F15_roadmap', category: 'roadmap', turns: ['is global search something youre building?'] },
  // short yes/no response
  { id: 'F16_shortyesno', category: 'short yes/no', turns: ['My import is stuck.', 'Did it show any error text on screen?', 'no'] },
  // abrupt topic change
  { id: 'F17_abrupt_topic_change', category: 'abrupt topic change', turns: ['How do checksum verifications work on a transfer drive?', 'oh wait actually, can i just ask -- does the app tell me who else is currently importing?'] },
  // pronoun chain
  { id: 'F18_pronoun_chain', category: 'pronoun chain', turns: ['What is Photographer-Folder Resolution?', 'Does it run automatically or do I trigger it?', 'And can I undo what it does?'] },
  // casual/incomplete English
  { id: 'F19_casual_incomplete', category: 'casual incomplete English', turns: ['export not finish why'] },
  // one legitimately technical question
  { id: 'F20_technical', category: 'legitimately technical', turns: ['What triggers the atomic write-then-rename pattern when AutoIngest saves its state files?'] },
  // one question where search initially returns competing records
  { id: 'F21_competing_records', category: 'competing records', turns: ['How does AutoIngest keep two people from writing to the same archive folder at once?'] },
  // troubleshooting conversation
  { id: 'F22_troubleshooting', category: 'troubleshooting', turns: ['Ever since the last update my metadata repair fails on the same three files every time'] },
  // feature confusion / similar feature names
  { id: 'F23_feature_confusion', category: 'similar feature names', turns: ['Is Backup Update Scanning the same thing as Archive Health Reporting?'] },
  // unresolved-conversation risk check: user pushes back on a clarifying question
  { id: 'F24_pushback', category: 'operator pushes back on clarification', turns: ['My transfer is broken.', 'Can you just tell me how to fix a broken transfer in general?'] },
  // roadmap: what has already been completed
  { id: 'F25_roadmap_completed', category: 'roadmap completed-so-far', turns: ['What has actually shipped so far on the roadmap?'] },
];
