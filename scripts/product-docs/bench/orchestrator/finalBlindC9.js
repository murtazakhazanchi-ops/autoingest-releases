'use strict';

// ASK AUTOINGEST — CHECKPOINT 9, PHASE 13. EXPERIMENTAL. The ONE new blind
// acceptance set for this checkpoint, 25 conversations, written in full and
// hashed BEFORE any run against it -- no tuning after freeze. Mirrors the
// breadth (natural phrasing, multi-turn follow-ups, casual/messy wording,
// topic changes, unsupported concepts, roadmap, recovery) of Checkpoints
// 5-8's own historical blind sets, on different concrete questions so this
// is a genuinely new test, not a re-labelled old one.

module.exports = [
  { id: 'N01_simple_explanation', turns: ['What does Duplicate Detection actually do?'] },
  { id: 'N02_howto', turns: ['How do I export a transfer drive?'] },
  { id: 'N03_troubleshooting', turns: ['My import seems to be stuck, nothing is happening.'] },
  { id: 'N04_multiturn_recovery', turns: ['My transfer stopped.', 'The drive got unplugged, I think.'] },
  { id: 'N05_followup_no_repeat', turns: ['How do I create a Transfer Export?', 'And if it stops halfway?'] },
  { id: 'N06_followup_after_answer', turns: ['How do I recover from a stale archive lock error?', 'What should I do after that?'] },
  { id: 'N07_topic_change', turns: ['How do I create a Transfer Export?', 'Actually, how do I sort QMZ photos?'] },
  { id: 'N08_user_corrects', turns: ['Does AutoIngest back up automatically?', 'Sorry, I meant cloud backup specifically -- Google Drive or Dropbox, not local copies.'] },
  { id: 'N09_dont_understand', turns: ['What is QMZ?', "I don't understand what that means."] },
  { id: 'N10_concise_question', turns: ['Can AutoIngest do face recognition?'] },
  { id: 'N11_roadmap', turns: ["What's coming next?"] },
  { id: 'N12_why_question', turns: ['Why is QMZ separate from normal Event Import?'] },
  { id: 'N13_technical_question', turns: ['Where does QMZ store its sequencing state?'] },
  { id: 'N14_unsupported_feature', turns: ['Does AutoIngest automatically tag people in photos using AI?'] },
  { id: 'N15_messy_shorthand', turns: ['yo qmz thing not working right, sequence #s messed up'] },
  { id: 'N16_messy_grammar', turns: ['import from sd card how'] },
  { id: 'N17_messy_vague', turns: ['it stopped again ugh, same drive as last time'] },
  { id: 'N18_messy_casual', turns: ['can i resume the export or do i gotta start over'] },
  { id: 'N19_wrong_feature_risk', turns: ['does it automatically detect duplicate files so I dont get the same photo twice'] },
  { id: 'N20_competing_candidates', turns: ['I need to move an event to a drive and later bring it back -- what are those called?'] },
  { id: 'N21_yes_no_reply', turns: ['Can I resume a Transfer Import if it gets interrupted?', 'Yes, tell me more.'] },
  { id: 'N22_pronoun_followup', turns: ['What is Quick Import?', 'Is it different from a normal import?'] },
  { id: 'N23_first_search_weak', turns: ['the sequencing numbers for the special event photos are wrong'] },
  { id: 'N24_capability_denial_check', turns: ['Can multiple operators have different permission levels in AutoIngest?'] },
  { id: 'N25_archive_maintenance', turns: ['What does Archive Maintenance cover, and is it available yet?'] },
];
