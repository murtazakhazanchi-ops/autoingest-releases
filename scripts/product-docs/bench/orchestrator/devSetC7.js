'use strict';

// ASK AUTOINGEST — CHECKPOINT 7, PHASE 9. EXPERIMENTAL.
// New development diagnostic set for the three fixed mechanisms
// (mechanical completion, hybrid retrieval, protocol containment) plus the
// simplified prompt. Deliberately new wording -- does not reuse sentences
// from frozen-19, generalization-14, blind-15, finalBlind25, or
// Checkpoint 6's devSetC6. Used only to debug before freezing.

module.exports = [
  // tool-required factual question
  { id: 'D7_01_tool_required', turns: ['What happens to files that are already partway copied if AutoIngest crashes?'] },
  // multi-tool question (search + status + knowledge across two subjects)
  { id: 'D7_02_multi_tool', turns: ['Can I run a metadata repair while an import is still going, or do they conflict?'] },
  // ambiguous feature selection (two plausible candidates)
  { id: 'D7_03_ambiguous_selection', turns: ['How does AutoIngest keep my files organized by photographer?'] },
  // confusable features (paraphrase, not verbatim benchmark wording, of a
  // duplicate-style capability -- a NEW confusable pair, not B15 itself)
  { id: 'D7_04_confusable_pair', turns: ['Is there something that stops two people editing the same event at once?'] },
  // retrieval miss / re-search needed
  { id: 'D7_05_retrieval_miss', turns: ['does the app notice when a card has the exact same shots as one I already brought in'] },
  // short follow-ups, natural continuation
  { id: 'D7_06_short_followups', turns: ['What is Archive Diagnostics?', 'How often should I run it?', 'And if it finds something?'] },
  // unsupported capability
  { id: 'D7_07_unsupported', turns: ['Can AutoIngest sync my archive straight to a NAS backup service in the cloud?'] },
  // roadmap
  { id: 'D7_08_roadmap', turns: ['whats left before archive maintenance ships'] },
  // topic change
  { id: 'D7_09_topic_change', turns: ['How do I export a transfer drive?', 'actually different question -- can I search my whole archive for missing keywords?'] },
  // deliberately weak first retrieval (vague, low-signal phrasing) then
  // expect a re-search or clarification, not a guess
  { id: 'D7_10_weak_first_retrieval', turns: ['the thing with the numbers is off again'] },
  // stalling-prone shape (bare status update, invites "let me check")
  { id: 'D7_11_stall_shape', turns: ['My export just sits there.'] },
  // yes/no + short reply chain
  { id: 'D7_12_yesno_chain', turns: ['Getting an error on import.', 'Is it about duplicate files?', 'yes'] },
  // pronoun chain across 3 turns, different subject than devSetC6 used
  { id: 'D7_13_pronoun_chain', turns: ['What does Checksum-Based File Verification do?', 'Is it automatic?', 'Can I turn it on for every transfer?'] },
  // "why" question
  { id: 'D7_14_why', turns: ['Why does Source Cleanup wait until after the copy is fully verified before deleting anything?'] },
  // casual/incomplete phrasing, technical subject
  { id: 'D7_15_casual_technical', turns: ['where duplicate check keep its list of files'] },
];
