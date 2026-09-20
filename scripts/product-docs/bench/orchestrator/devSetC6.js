'use strict';

// ASK AUTOINGEST — CHECKPOINT 6, PHASE 4. EXPERIMENTAL.
// Development set specifically targeting the five corrected mechanisms.
// Deliberately new wording -- does not reuse sentences from frozen-19,
// generalization-14, blind-15, or Checkpoint 5's devSet/blindSet. Used only
// to debug before freezing; deleted from the acceptance story afterward.

module.exports = [
  // targets 1A: id-leak backstop, on a DIFFERENT ambiguous-sort question
  // than the frozen B_simple_howto case
  { id: 'DC6_01_id_leak_prone', turns: ['How can I get my QMZ pictures in the right order?'] },
  // targets 1B: paraphrase retrieval uncertainty (different phrasing than
  // any diagnostic case used to design the fix)
  { id: 'DC6_02_paraphrase_uncertain', turns: ['is there a way to catch photos I already brought in twice'] },
  // targets 1C: open-ended roadmap, casual phrasing
  { id: 'DC6_03_roadmap_open', turns: ['what are you all working on these days?'] },
  // targets 1C: named-subject roadmap
  { id: 'DC6_04_roadmap_named', turns: ['has the archive browser shipped yet?'] },
  // targets 1D: enough info given up front, should not over-clarify
  { id: 'DC6_05_no_overclarify', turns: ['My Transfer Export to the NAS died halfway through, what now?'] },
  // targets 1D: yes/no reply resolving a pending clarification
  { id: 'DC6_06_yesno_reply', turns: ['Something is wrong with my import.', 'Is it about a locked folder?', 'Yeah, that.'] },
  // targets 1D + memory: pronoun chain across 3 turns
  { id: 'DC6_07_pronoun_chain', turns: ['What does Metadata Verification do?', 'Can it fix problems too, or just find them?', 'What about for RAW files specifically?'] },
  // targets 1A/Phase 9: legitimate technical disclosure should still work
  { id: 'DC6_08_technical', turns: ['What file format does the archive use to track duplicate checks?'] },
  // "why" question
  { id: 'DC6_09_why', turns: ['Why does AutoIngest keep a separate Quick Import mode instead of just one import flow?'] },
  // topic change mid-conversation
  { id: 'DC6_10_topic_change', turns: ['How do I recover from a stale archive lock?', 'Actually, forget that -- can two people import into the same event at once?'] },
  // unsupported capability, should be a confident, non-hedging denial
  { id: 'DC6_11_unsupported', turns: ['Can AutoIngest post my photos straight to a client website?'] },
  // similar-sounding feature names -- a genuine disambiguation test
  { id: 'DC6_12_similar_names', turns: ['Whats the difference between Source Cleanup and Archive Repair?'] },
];
