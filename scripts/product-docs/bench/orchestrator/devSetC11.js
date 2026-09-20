'use strict';

// ASK AUTOINGEST — CHECKPOINT 11, PHASE 8. EXPERIMENTAL. Development set,
// 32 conversations, wording distinct from Phase 3's groundingDiagnosticC11
// and from any historical set. Covers: indirect feature identification,
// exact terminology, technical grounding, behavior/capability grounding,
// multi-turn pronouns, topic changes, already-grounded follow-ups, natural
// explanation without unnecessary retrieval, unknown/undocumented facts,
// ambiguous questions.

module.exports = [
  { id: 'D01_indirect_id', turns: ['Which feature keeps me from accidentally re-importing something I already brought in?'] },
  { id: 'D02_indirect_id2', turns: ['What lets me check a backup drive for changes without actually copying anything yet?'] },
  { id: 'D03_indirect_pair', turns: ['What handles sending a copy of an event out, and what handles bringing it back?'] },
  { id: 'D04_exact_terminology', turns: ['What is the precise name AutoIngest uses for the modal that appears during Quick Import?'] },
  { id: 'D05_technical_grounding', turns: ['What format is event.json written in, and how is it saved safely?'] },
  { id: 'D06_technical_grounding2', turns: ['Does the archive lock use a database row or a plain file?'] },
  { id: 'D07_behavior_grounding', turns: ['If the app is force-quit during a metadata write, does any data get lost?'] },
  { id: 'D08_capability_grounding', turns: ['Is there a way to see everyone currently active in AutoIngest?'] },
  { id: 'D09_multiturn_pronoun', turns: ['What is Backup Update Scanning?', 'Does it ever copy files on its own?'] },
  { id: 'D10_topic_change', turns: ['What is Duplicate Detection?', "Let's switch gears -- what is Quick Import?"] },
  { id: 'D11_already_grounded_followup', turns: ['Can a Transfer Import resume after being interrupted?', 'Got it -- and does it check the source is the same drive?'] },
  { id: 'D12_explain_naturally', turns: ['What is Quick Import?', 'Why would I ever use that instead of a normal import?'] },
  { id: 'D13_unknown_fact', turns: ['Can AutoIngest automatically rotate photos based on EXIF orientation?'] },
  { id: 'D14_unknown_fact2', turns: ['Is there a way to export just the metadata without the actual photo files?'] },
  { id: 'D15_ambiguous', turns: ['Nothing happened.'] },
  { id: 'D16_ambiguous2', turns: ['Can you help me with the import thing?'] },
  { id: 'D17_naming_report', turns: ['What are the individual reports that make up Archive Health Reporting?'] },
  { id: 'D18_naming_workflow', turns: ['What is the workflow called for bringing content back from a transfer drive?'] },
  { id: 'D19_capability_unsupported', turns: ['Can I assign a color label to an event for quick visual sorting?'] },
  { id: 'D20_capability_planned', turns: ['Is Global Search something I can use today?'] },
  { id: 'D21_capability_supported', turns: ['Can I verify file integrity after an import using checksums?'] },
  { id: 'D22_conversation_only_thanks', turns: ['What is Transfer Import?', 'Perfect, appreciate it.'] },
  { id: 'D23_conversation_only_smalltalk', turns: ["Hope you're having a good one."] },
  { id: 'D24_conversation_only_why', turns: ['Does AutoIngest check file size instead of a full checksum during copy?', 'Why size instead of a full hash?'] },
  { id: 'D25_multiturn_recovery', turns: ['My Quick Import seems stuck.', 'It just sits there after I enter the photographer name.'] },
  { id: 'D26_technical_vs_plain', turns: ['Where on disk does the archive lock actually live, technically?'] },
  { id: 'D27_technical_vs_plain_nontech', turns: ['If two people try to import the same folder at once, does one of them get blocked?'] },
  { id: 'D28_indirect_workflow_ref', turns: ['What do I use to fix metadata that got messed up after an event was already imported?'] },
  { id: 'D29_return_to_topic', turns: ['What is Transfer Export?', 'What is Duplicate Detection?', 'Back to the first one -- does it verify checksums automatically?'] },
  { id: 'D30_naming_exact_vs_paraphrase', turns: ['Is "Event" the term AutoIngest actually uses, or is it called something else internally?'] },
  { id: 'D31_boundary_permissions', turns: ['Could I set up a second operator account with fewer permissions than mine?'] },
  { id: 'D32_grounded_multi_dimension', turns: ['What is Archive Lock Handling?', 'What happens if the lock never gets released?'] },
];
