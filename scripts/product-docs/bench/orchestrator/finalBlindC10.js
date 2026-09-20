'use strict';

// ASK AUTOINGEST — CHECKPOINT 10, PART 11/13. EXPERIMENTAL. The ONE new
// blind acceptance set for this checkpoint, 30 conversations, written in
// full and hashed BEFORE running against any candidate -- no tuning after
// freeze. Does not reuse wording from agenticGateC10.js or any historical
// set (frozen19/generalization14/blindSet/finalBlind25/finalBlindC7/
// finalBlindC8/finalBlindC9).

module.exports = [
  { id: 'Z01_named_feature', turns: ['What does Duplicate Detection do?'] },
  { id: 'Z02_named_workflow', turns: ['Walk me through exporting a transfer drive.'] },
  { id: 'Z03_stuck_troubleshoot', turns: ['Nothing is happening -- my import seems frozen.'] },
  { id: 'Z04_recovery_chain', turns: ['My export just stopped.', 'I think the drive came loose.'] },
  { id: 'Z05_followup_dimension', turns: ['How do I set up a Transfer Export?', 'And if it dies partway through?'] },
  { id: 'Z06_followup_after_hedge', turns: ['How do I clear a stuck archive lock?', 'What comes after that?'] },
  { id: 'Z07_topic_switch', turns: ['How do I set up a Transfer Export?', 'Never mind that -- how are QMZ photos sequenced?'] },
  { id: 'Z08_user_clarifies_scope', turns: ['Does AutoIngest do backups on its own?', 'I specifically mean cloud storage, not a second local drive.'] },
  { id: 'Z09_bare_term_confusion', turns: ['What is QMZ?', "I'm still not following -- what does that mean?"] },
  { id: 'Z10_short_yesno', turns: ['Can AutoIngest recognize faces in photos?'] },
  { id: 'Z11_roadmap_openended', turns: ['What is the team working on right now?'] },
  { id: 'Z12_why', turns: ['Why does QMZ get its own separate process instead of going through normal import?'] },
  { id: 'Z13_technical', turns: ['Technically, where does the QMZ sequencing state live on disk?'] },
  { id: 'Z14_unsupported', turns: ['Does AutoIngest auto-tag people it recognizes in photos?'] },
  { id: 'Z15_shorthand', turns: ['qmz sequence numbers all messed up, ugh'] },
  { id: 'Z16_grammar_broken', turns: ['sd card import how do'] },
  { id: 'Z17_vague_repeat', turns: ['same problem as before, same drive too'] },
  { id: 'Z18_casual_resume', turns: ['can i pick the export back up or do i start fresh'] },
  { id: 'Z19_wrong_feature_risk', turns: ['will it stop me from importing the same photo twice by accident'] },
  { id: 'Z20_two_features_named', turns: ['I need to send an event out on a drive and pull it back in later -- what are those two things called?'] },
  { id: 'Z21_yes_continue', turns: ['If a Transfer Import gets interrupted, can it pick back up?', 'Yes, go on.'] },
  { id: 'Z22_pronoun_chain', turns: ['What is Quick Import for?', 'How is it different from a regular import?'] },
  { id: 'Z23_weak_first_search', turns: ['the numbering on the special event photos looks wrong'] },
  { id: 'Z24_boundary_check', turns: ['Is there a way to give different operators different access levels?'] },
  { id: 'Z25_maintenance_status', turns: ['What would Archive Maintenance let me do, and can I use it today?'] },
  { id: 'Z26_general_smalltalk', turns: ['Good morning! Hope your day is going well.'] },
  { id: 'Z27_thanks_no_search_needed', turns: ['What is Transfer Export?', 'Perfect, that answers it, thank you.'] },
  { id: 'Z28_competing_similar', turns: ['What is the difference between Archive Maintenance and Event Maintenance?'] },
  { id: 'Z29_informal_synonym', turns: ['does it back up my folder to a backup drive automatically'] },
  { id: 'Z30_multi_turn_full_chain', turns: ['My Transfer Export died halfway.', 'Power went out actually.', 'So will it just pick up where it left off when I restart?'] },
];
