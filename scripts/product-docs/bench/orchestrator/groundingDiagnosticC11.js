'use strict';

// ASK AUTOINGEST — CHECKPOINT 11, PHASE 3. EXPERIMENTAL. Frozen before
// running -- run against the UNTOUCHED Checkpoint-10 system FIRST, as a
// baseline, before any correction is designed or implemented. 44 new
// prompts, none reusing historical wording. Each is tagged with the
// checkpoint-brief category and whether search is actually required, so
// Phase 3's 6 named metrics can be computed precisely.

module.exports = [
  // --- INDIRECT IDENTIFICATION (pronoun/reference-based, no exact feature name) ---
  { id: 'I01_two_things_called', cat: 'indirect', needsSearch: true, turns: ['What are the two features called for sending an event out to a drive and later bringing it back?'] },
  { id: 'I02_the_one_that_sends', cat: 'indirect', needsSearch: true, turns: ["What's the one that sends a copy of my event out to a portable drive?"] },
  { id: 'I03_the_opposite_one', cat: 'indirect', needsSearch: true, turns: ['What is Transfer Export?', 'And what is the opposite one called -- bringing it back in?'] },
  { id: 'I04_feature_we_use_for', cat: 'indirect', needsSearch: true, turns: ['What was that feature we use for grabbing a few photos without a whole event setup?'] },
  { id: 'I05_pronoun_chain', cat: 'indirect', needsSearch: true, turns: ['What is Quick Import?', 'And does it warn me before it does that duplicate thing?'] },
  { id: 'I06_vague_workflow_ref', cat: 'indirect', needsSearch: true, turns: ['Which workflow handles sorting the special event photos into their numbered order?'] },
  { id: 'I07_this_vs_that', cat: 'indirect', needsSearch: true, turns: ['Is the thing that scans for backup changes different from the thing that actually copies to a drive?'] },

  // --- TECHNICAL QUESTIONS ---
  { id: 'T01_where_state_lives', cat: 'technical', needsSearch: true, turns: ['Where does the archive lock information actually get written?'] },
  { id: 'T02_what_file_stores', cat: 'technical', needsSearch: true, turns: ['What file keeps track of an event once it has been created?'] },
  { id: 'T03_survives_restart', cat: 'technical', needsSearch: true, turns: ['If AutoIngest crashes mid metadata-write, what actually survives the restart?'] },
  { id: 'T04_checkpoint_location', cat: 'technical', needsSearch: true, turns: ['Technically, where does a Transfer Import keep its resume checkpoint?'] },
  { id: 'T05_controls_sequencing', cat: 'technical', needsSearch: true, turns: ['What controls the sequencing codes assigned during QMZ sorting?'] },
  { id: 'T06_plausible_wrong_answer', cat: 'technical', needsSearch: true, turns: ['Does AutoIngest use a SQLite database to track import state?'] },
  { id: 'T07_storage_mechanism', cat: 'technical', needsSearch: true, turns: ['How does the app know which files were already checked for duplicates?'] },

  // --- BEHAVIOR QUESTIONS ---
  { id: 'BH01_resumes', cat: 'behavior', needsSearch: true, turns: ['If my metadata repair job gets interrupted, does it pick back up automatically?'] },
  { id: 'BH02_backs_up', cat: 'behavior', needsSearch: true, turns: ['Does AutoIngest keep an automatic backup of my archive somewhere else?'] },
  { id: 'BH03_synchronizes', cat: 'behavior', needsSearch: true, turns: ['Does it keep the Active Archive Root and Main Archive Root in sync automatically?'] },
  { id: 'BH04_detects', cat: 'behavior', needsSearch: true, turns: ['Will it notice if I accidentally connect the wrong memory card?'] },
  { id: 'BH05_repairs', cat: 'behavior', needsSearch: true, turns: ['Can it fix metadata that got corrupted after the fact?'] },

  // --- NAMING QUESTIONS ---
  { id: 'NM01_exact_feature_name', cat: 'naming', needsSearch: true, turns: ['What is the exact name of the feature that stops duplicate imports?'] },
  { id: 'NM02_report_names', cat: 'naming', needsSearch: true, turns: ['What are the different sub-reports available under Archive Health Reporting?'] },
  { id: 'NM03_workflow_name', cat: 'naming', needsSearch: true, turns: ['What is the official name of the workflow for recovering from a stuck archive lock?'] },
  { id: 'NM04_ui_terminology', cat: 'naming', needsSearch: true, turns: ['What does the confirmation modal ask for during Quick Import?'] },

  // --- CAPABILITY QUESTIONS ---
  { id: 'C01_can_it', cat: 'capability', needsSearch: true, turns: ['Can AutoIngest email me a report after every import finishes?'] },
  { id: 'C02_does_it', cat: 'capability', needsSearch: true, turns: ['Does AutoIngest let two operators be logged in with different roles at once?'] },
  { id: 'C03_is_there', cat: 'capability', needsSearch: true, turns: ['Is there a way to preview what a backup update would do before running it?'] },
  { id: 'C04_what_happens_if', cat: 'capability', needsSearch: true, turns: ['What happens if two operators try to adopt the same manually-created folder at the same time?'] },
  { id: 'C05_can_it_unsupported', cat: 'capability', needsSearch: true, turns: ['Can AutoIngest livestream import progress to a public dashboard?'] },

  // --- CONVERSATION-ONLY (tool use should NOT be required) ---
  { id: 'CO01_why', cat: 'conversation-only', needsSearch: false, turns: ['What is Transfer Export?', 'Why does it work that way?'] },
  { id: 'CO02_explain_simpler', cat: 'conversation-only', needsSearch: false, turns: ['What is Quick Import?', 'Can you explain that more simply?'] },
  { id: 'CO03_what_do_you_mean', cat: 'conversation-only', needsSearch: false, turns: ['Archive Maintenance is planned but not started yet.', 'What do you mean by that?'] },
  { id: 'CO04_thanks', cat: 'conversation-only', needsSearch: false, turns: ['What is Duplicate Detection?', 'Thanks, that clears it up.'] },
  { id: 'CO05_so_basically', cat: 'conversation-only', needsSearch: false, turns: ['What is Transfer Export?', 'So basically it just copies things to a drive?'] },
  { id: 'CO06_smalltalk', cat: 'conversation-only', needsSearch: false, turns: ['Good to see you again.'] },
  { id: 'CO07_grounded_followup', cat: 'conversation-only', needsSearch: false, turns: ['What is Quick Import?', 'And how is that different from what you just described for regular imports, in one sentence?'] },

  // --- AMBIGUOUS / GENUINELY UNCLEAR ---
  { id: 'A01_ambiguous_stopped', cat: 'ambiguous', needsSearch: false, turns: ['It stopped.'] },
  { id: 'A02_ambiguous_import', cat: 'ambiguous', needsSearch: false, turns: ['How do I import?'] },
  { id: 'A03_ambiguous_broken', cat: 'ambiguous', needsSearch: false, turns: ["Something's broken."] },

  // --- UNKNOWN / UNDOCUMENTED CONCEPTS (should investigate, not fabricate) ---
  { id: 'U01_undocumented', cat: 'unknown', needsSearch: true, turns: ['Does AutoIngest support tagging photos by GPS location automatically?'] },
  { id: 'U02_undocumented2', cat: 'unknown', needsSearch: true, turns: ['Can I set up a custom naming template for exported files?'] },
  { id: 'U03_undocumented3', cat: 'unknown', needsSearch: true, turns: ['Is there a dark mode setting?'] },

  // --- MULTI-TURN NAMING/GROUNDING CHAINS ---
  { id: 'M01_name_then_technical', cat: 'multi', needsSearch: true, turns: ['What handles moving photos off a portable drive back into the archive?', 'Where does that store its progress on disk?'] },
  { id: 'M02_capability_then_detail', cat: 'multi', needsSearch: true, turns: ['Can a Transfer Export resume after a crash?', 'How does it know which files to skip?'] },
  { id: 'M03_topic_change_then_technical', cat: 'multi', needsSearch: true, turns: ['What is Archive Lock Handling?', 'Actually, switching topics -- where does QMZ store its sequence numbers?'] },
  { id: 'M04_naming_then_capability', cat: 'multi', needsSearch: true, turns: ['What is the workflow called for sorting QMZ photos?', 'Is it fully available right now, or still being built?'] },
  { id: 'M05_reference_prior_answer', cat: 'multi', needsSearch: false, turns: ['Does AutoIngest verify checksums during import?', 'Is that automatic or do I have to trigger it?'] },

  // --- MORE INDIRECT / NAMING EDGE CASES (bringing total past 40) ---
  { id: 'I08_role_based_reference', cat: 'indirect', needsSearch: true, turns: ['What lets an archivist see who else is currently working in AutoIngest?'] },
  { id: 'NM05_terminology_check', cat: 'naming', needsSearch: true, turns: ['Is "Event" the right term, or does AutoIngest call it something else?'] },
  { id: 'BH06_repairs2', cat: 'behavior', needsSearch: true, turns: ['If two people edit the same event at once, does AutoIngest merge their changes automatically?'] },
  { id: 'C06_boundary', cat: 'capability', needsSearch: true, turns: ['Can I give a specific operator read-only access to the archive?'] },
  { id: 'CO08_yes_no_reply', cat: 'conversation-only', needsSearch: false, turns: ['Does AutoIngest detect duplicate files automatically?', 'Yes, go on.'] },
];
