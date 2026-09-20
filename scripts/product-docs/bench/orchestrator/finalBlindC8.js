'use strict';

// ASK AUTOINGEST — CHECKPOINT 8, PHASE "FULL ACCEPTANCE". FINAL BLIND SET
// FOR THE SURVIVING CANDIDATE (Llama-3.1-8B-Instruct).
//
// 21 NEW conversations, written after the candidate configuration was
// frozen (harness hashes recorded 2026-08-27T10:46:11Z). Does not reuse
// wording from frozen-19, generalization-14, blind-15, finalBlind25,
// finalBlindC7, or the reliabilityProbe. Never tuned against.

module.exports = [
  { id: 'H01_vague_investigate', category: 'vague->investigate', turns: ['it just hangs there', 'trying to bring in photos from a card'] },
  { id: 'H02_clear_howto', category: 'clear how-to', turns: ['What are the steps to adopt a folder I created outside AutoIngest?'] },
  { id: 'H03_followup_why', category: 'followup why', turns: ['What does Metadata Verification do?', 'Why does it only apply to files that came in via copy-only paths?'] },
  { id: 'H04_followup_afterthat', category: 'followup after', turns: ['How do I run a Backup Update Scan?', 'What do I do after I see the results?'] },
  { id: 'H05_dont_understand', category: 'dont understand', turns: ['What does it mean that Source Cleanup is "gated" by validation?', "I don't follow -- explain it a simpler way"] },
  { id: 'H06_automatic_check', category: 'automatic?', turns: ['Does file integrity get verified on its own, or do I have to ask for it?'] },
  { id: 'H07_wrong_assumption', category: 'wrong assumption', turns: ['I assume the app automatically emails the team lead a summary after each event -- how do I set the recipient?'] },
  { id: 'H08_unsupported', category: 'unsupported', turns: ['Can AutoIngest livestream the import progress to a shared dashboard site?'] },
  { id: 'H09_comparison', category: 'comparison', turns: ['What is the practical difference between Transfer Import and a plain Event Import?'] },
  { id: 'H10_interrupted', category: 'interrupted', turns: ['the app quit on its own mid export, is my data ok'] },
  { id: 'H11_removable_drive', category: 'removable drive', turns: ['the transfer drive disconnected right as it was finishing, what now'] },
  { id: 'H12_metadata', category: 'metadata', turns: ['Can I preview what a metadata repair would change before actually running it?'] },
  { id: 'H13_qmz', category: 'QMZ', turns: ['do I have to sequence every single QMZ photo, or can some stay unsequenced'] },
  { id: 'H14_archive_maintenance', category: 'archive maintenance', turns: ['Is there a go/no-go check before I do a transfer?'] },
  { id: 'H15_roadmap', category: 'roadmap', turns: ['has anything on the roadmap already shipped?'] },
  { id: 'H16_short_yesno', category: 'short yes/no', turns: ['My export failed.', 'Was it during the copy itself?', 'yes'] },
  { id: 'H17_abrupt_topic_change', category: 'abrupt topic change', turns: ['How does Source Cleanup decide what is safe to delete?', 'actually forget that -- can I see which operator is currently logged in?'] },
  { id: 'H18_pronoun_chain', category: 'pronoun chain', turns: ['What is Duplicate Detection?', 'Does it check file content or just names?', 'Can I make it stricter?'] },
  { id: 'H19_casual_incomplete', category: 'casual incomplete', turns: ['export stuck why'] },
  { id: 'H20_technical', category: 'legitimately technical', turns: ['What write pattern does AutoIngest use to avoid leaving a half-written state file if it crashes mid-save?'] },
  { id: 'H21_competing_records', category: 'competing records', turns: ['If the app crashes while writing metadata, what state is the file left in?'] },
];
