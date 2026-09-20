'use strict';

// ASK AUTOINGEST — CHECKPOINT 9, PHASE 12. EXPERIMENTAL. Frozen before
// running. 18 conversations covering every behavior the checkpoint brief
// names: search->read->answer, search->ambiguity->clarification,
// clarification->read->answer, follow-up using previous knowledge, topic
// change, unsupported capability, roadmap, interruption/recovery, "yes",
// "why?", "what happens after that?", "does it do this automatically?",
// competing records, first search insufficient -> second search, technical
// question, nontechnical version of the same question.

module.exports = [
  { id: 'P01_search_read_answer', turns: ['What is Transfer Export?'] },
  { id: 'P02_search_ambiguity_clarify', turns: ['How do I import?'] },
  { id: 'P03_clarify_then_read_answer', turns: ['How do I import?', 'From a memory card.'] },
  { id: 'P04_followup_prior_knowledge', turns: ['What is Transfer Export?', 'Can it resume if interrupted?'] },
  { id: 'P05_topic_change', turns: ['What is Transfer Export?', 'Actually, what is Quick Import?'] },
  { id: 'P06_unsupported_capability', turns: ['Can AutoIngest do face recognition on photos automatically?'] },
  { id: 'P07_roadmap_openended', turns: ["What's coming next on the roadmap?"] },
  { id: 'P08_interruption_recovery', turns: ['My Transfer Export stopped halfway through. What happened, and can I pick up where it left off?'] },
  { id: 'P09_bare_yes', turns: ['Does AutoIngest detect duplicate files automatically?', 'Yes, tell me more about that.'] },
  { id: 'P10_why_question', turns: ['Why is QMZ handled separately from normal event import?'] },
  { id: 'P11_what_happens_after', turns: ['What is Transfer Export?', 'What happens after that, once it finishes?'] },
  { id: 'P12_does_it_automatically', turns: ['Does it write metadata onto photos automatically, or do I have to trigger it myself?'] },
  { id: 'P13_competing_subjects', turns: ['How do I move an event onto a portable drive and later bring it back into the archive?'] },
  { id: 'P14_weak_search_then_retry', turns: ['my copy job is stuck and wont finish'] },
  { id: 'P15_technical_question', turns: ['Where does Transfer Export store its resume checkpoint, technically?'] },
  { id: 'P16_nontechnical_same_question', turns: ['If my Transfer Export gets interrupted, will it remember where it left off?'] },
  { id: 'P17_invalid_reference_recovery', turns: ['What is Transfer Export?', 'What about the thing you mentioned three questions ago?'] },
  { id: 'P18_multiturn_recovery_chain', turns: ['My transfer stopped.', "I'm not sure what happened, I was just copying yesterday's event.", 'The NAS disconnected, I think.'] },
];
