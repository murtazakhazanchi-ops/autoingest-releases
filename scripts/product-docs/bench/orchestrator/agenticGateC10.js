'use strict';

// ASK AUTOINGEST — CHECKPOINT 10, PART 7. EXPERIMENTAL. Frozen before
// running against any candidate. 35 conversations, none reusing exact
// wording from any historical set. Each conversation is tagged with the
// checkpoint-brief category it targets (A-E) so the agentic-gate metrics
// in Part 8 can be computed per category, not just in aggregate.
//
// Deliberately targets the SPECIFIC failure patterns Checkpoint 9 found in
// Gemma-4-E4B-it under this exact architecture: open-ended roadmap
// questions producing zero tool calls / fabrication; technical questions
// answered without fetching the needed dimension; the duplicate-detection
// paraphrase recall gap; short, context-free named-subject questions
// (the "QMZ alone" pattern); multi-turn recovery/troubleshooting chains
// never searching at all; and wrong-dimension fetches causing
// self-contradiction across turns.

module.exports = [
  // --- A. KNOWLEDGE DECISION ---
  { id: 'A01_obvious_named_feature', cat: 'A', turns: ['What does Transfer Export do?'] },
  { id: 'A02_obvious_named_feature2', cat: 'A', turns: ['Tell me about the Archive Lock Handling feature.'] },
  { id: 'A03_paraphrased_feature', cat: 'A', turns: ['Is there something that automatically catches files I already have so I dont end up with two of the same photo?'] },
  { id: 'A04_paraphrased_feature2', cat: 'A', turns: ['Can I grab a handful of photos quickly without setting up a whole event first?'] },
  { id: 'A05_conversational_from_history', cat: 'A', turns: ['What is Quick Import?', 'Got it, thanks -- that makes sense.'] },
  { id: 'A06_general_conversation', cat: 'A', turns: ['Hey, how are you doing today?'] },
  { id: 'A07_general_conversation2', cat: 'A', turns: ['Thanks for the help earlier.'] },
  { id: 'A08_unknown_concept_investigate', cat: 'A', turns: ['Does AutoIngest support voice-tagging photos while I import them?'] },

  // --- B. MULTI-STEP KNOWLEDGE USE ---
  { id: 'B01_search_handle_read_answer', cat: 'B', turns: ['Where does the checkpoint file for Transfer Export get stored?'] },
  { id: 'B02_multiple_candidates_inspect', cat: 'B', turns: ['I want to move a whole event onto a drive and later bring it back into the archive -- what handles that?'] },
  { id: 'B03_insufficient_evidence_research', cat: 'B', turns: ['does it automatically detect duplicate files so I dont get the same photo twice'] },
  { id: 'B04_genuine_ambiguity_clarify', cat: 'B', turns: ['How do I import?'] },
  { id: 'B05_clarify_reply_continue', cat: 'B', turns: ['How do I import?', 'From a memory card.'] },

  // --- C. CAPABILITY QUESTIONS ---
  { id: 'C01_supported', cat: 'C', turns: ['Can AutoIngest resume a Transfer Export after a power cut?'] },
  { id: 'C02_unsupported', cat: 'C', turns: ['Can multiple operators be logged in with different permission levels at the same time?'] },
  { id: 'C03_planned', cat: 'C', turns: ['Is Archive Browser available yet?'] },
  { id: 'C04_unknown', cat: 'C', turns: ['Does AutoIngest support real-time collaborative photo tagging with other archivists?'] },
  { id: 'C05_search_miss_not_unsupported', cat: 'C', turns: ['does it dedupe photos automatically'] },

  // --- D. CONVERSATION ---
  { id: 'D01_bare_yes', cat: 'D', turns: ['Does AutoIngest detect duplicate files automatically?', 'Yes, tell me more.'] },
  { id: 'D02_bare_no', cat: 'D', turns: ['Do I need to manually verify checksums after every import?', 'No, I mean is there an automatic option?'] },
  { id: 'D03_why', cat: 'D', turns: ['Why is QMZ handled separately from normal Event Import?'] },
  { id: 'D04_what_happens_next', cat: 'D', turns: ['What is Transfer Export?', 'What happens after it finishes running?'] },
  { id: 'D05_pronoun', cat: 'D', turns: ['What is Quick Import?', 'Is it different from a regular import?'] },
  { id: 'D06_correction', cat: 'D', turns: ['Does AutoIngest back up automatically?', 'Sorry, I meant to the cloud specifically, not local drives.'] },
  { id: 'D07_topic_change', cat: 'D', turns: ['How do I create a Transfer Export?', 'Actually, forget that -- how do I sort QMZ photos?'] },
  { id: 'D08_return_to_previous', cat: 'D', turns: ['What is Transfer Export?', 'Actually, what is Quick Import?', 'Going back to the first one -- can it resume if interrupted?'] },
  { id: 'D09_multiturn_troubleshooting', cat: 'D', turns: ['My transfer stopped partway through.', 'The drive got disconnected, I think.', 'So can I just plug it back in and pick up where it left off?'] },

  // --- E. AGENT DISCIPLINE (deliberately stress-testing patterns found in Checkpoint 9) ---
  { id: 'E01_short_context_free_named_subject', cat: 'E', turns: ['What is QMZ?'] },
  { id: 'E02_short_context_free_named_subject2', cat: 'E', turns: ['What is Archive Maintenance?'] },
  { id: 'E03_open_ended_roadmap', cat: 'E', turns: ["What's coming next for AutoIngest?"] },
  { id: 'E04_open_ended_roadmap2', cat: 'E', turns: ['What has the team finished so far on the roadmap?'] },
  { id: 'E05_technical_question_needs_dimension', cat: 'E', turns: ['Where does QMZ store its sequencing state, technically?'] },
  { id: 'E06_resume_question_needs_recovery_dim', cat: 'E', turns: ['Can I resume a Transfer Import if it gets interrupted?'] },
  { id: 'E07_messy_shorthand', cat: 'E', turns: ['yo transfer export thing died halfway, what now'] },
  { id: 'E08_messy_vague', cat: 'E', turns: ['it stopped again ugh, same drive as last time'] },
  { id: 'E09_named_subject_casual', cat: 'E', turns: ['can i resume the export or do i gotta start over'] },
  { id: 'E10_technical_vs_nontechnical_pair', cat: 'E', turns: ['If my Transfer Export gets interrupted, will it remember where it left off?'] },
  { id: 'E11_competing_similar_names', cat: 'E', turns: ['What does Archive Maintenance cover, versus Event Maintenance?'] },
  { id: 'E12_wrong_terminology', cat: 'E', turns: ['can it sync my folder to a backup drive'] },
];
