'use strict';
// ASK AUTOINGEST — CHECKPOINT 14, PHASE 11. Development qualification set,
// built AFTER the general fixes (Phases 2-9), covering different features
// from RB58 (Photographer-Folder Resolution / Event-Component Import
// Routing), RB44 (Archive Lock Handling / DEC-013), RB27 (Archive Folder
// Adoption / Application Settings), and QI05 (Metadata Management Modal) --
// none of those four subjects are used as a PRIMARY test subject below.
// Category tags (cat) may overlap a conversation across more than one
// required category, per the checkpoint's own "categories may overlap"
// allowance. Minimum quotas required: directional >=15, decisionBacked
// >=10, loopPressure >=10, paraphrase >=10, unknownRelation >=10,
// multiTurn >=10, ordinary >=10.
module.exports = [
  // --- Directional relationships (real Tier-1 edges, verified against the
  // corpus this checkpoint's own forensic query, not invented) ---
  { id: 'DEV01', cat: ['directional'], turns: ['Does source detection happen before or after source selection?'] },
  { id: 'DEV02', cat: ['directional'], turns: ['Is the Grouping System used before or after the Import Pipeline runs?'] },
  { id: 'DEV03', cat: ['directional'], turns: ['Does the Import Pipeline use Duplicate Detection, or is it the other way around?'] },
  { id: 'DEV04', cat: ['directional'], turns: ['Where does the no-overwrite guarantee actually live -- inside Duplicate Detection, or somewhere else?'] },
  { id: 'DEV05', cat: ['directional'], turns: ['Does Audit Integrity Verification run before or after the Import Pipeline copies files?'] },
  { id: 'DEV06', cat: ['directional'], turns: ['Does Quick Import rely on Duplicate Detection at all?'] },
  { id: 'DEV07', cat: ['directional'], turns: ['Does the Metadata Writing Engine depend on the Metadata Durable Queue, or does the queue depend on the writing engine?'] },
  { id: 'DEV08', cat: ['directional'], turns: ['Does the Metadata Writing Engine write into event.json directly, or go through something else?'] },
  { id: 'DEV09', cat: ['directional'], turns: ['Does Metadata Audit & Repair use the Metadata Durable Queue?'] },
  { id: 'DEV10', cat: ['directional'], turns: ['Does Metadata Audit & Repair read from event.json?'] },
  { id: 'DEV11', cat: ['directional'], turns: ['Between Transfer Export and Transfer Import, which one happens first in the normal workflow?'] },
  { id: 'DEV12', cat: ['directional'], turns: ['Does Backup Update Scanning use Transfer Export under the hood?'] },
  { id: 'DEV13', cat: ['directional'], turns: ['Does the QMZ Sequencing Workspace feed into the Metadata Writing Engine?'] },
  { id: 'DEV14', cat: ['directional'], turns: ['Does Archive Maintenance run before Event Maintenance, or after?'] },
  { id: 'DEV15', cat: ['directional'], turns: ['Does the Telemetry Pipeline feed data to the Application Auto-Update system, or the reverse?'] },
  { id: 'DEV16', cat: ['directional'], turns: ['Is Event Management & Editing built directly on top of event.json, or is there something in between?'] },

  // --- Decision-backed behavior questions (real DEC-### links, not DEC-013) ---
  { id: 'DEV17', cat: ['decisionBacked'], turns: ['If Duplicate Detection finds a file that already exists, does it ever overwrite the original?'] },
  { id: 'DEV18', cat: ['decisionBacked'], turns: ['Does Source Cleanup ever delete files from the source before the operator has verified the import succeeded?'] },
  { id: 'DEV19', cat: ['decisionBacked'], turns: ['If the app crashes mid-way through a metadata write, is that work lost or recovered on restart?'] },
  { id: 'DEV20', cat: ['decisionBacked'], turns: ['Can an operator add any keyword they want to the Keyword Registry, or is it more controlled than that?'] },
  { id: 'DEV21', cat: ['decisionBacked'], turns: ['Does Backup Update Scanning copy every file every time, or only what changed?'] },
  { id: 'DEV22', cat: ['decisionBacked'], turns: ['How does Archive Root Configuration decide which folder is the authoritative archive root -- does it just trust whatever is configured?'] },
  { id: 'DEV23', cat: ['decisionBacked'], turns: ['Is Local-First Background Archive Sync something that happens on a remote server, or locally?'] },
  { id: 'DEV24', cat: ['decisionBacked'], turns: ['Does re-running a copy that already succeeded once ever suppress a metadata repair that still needs to happen?'] },
  { id: 'DEV25', cat: ['decisionBacked'], turns: ['Why does the Metadata Writing Engine handle RAW files differently -- does it write metadata directly into them?'] },
  { id: 'DEV26', cat: ['decisionBacked'], turns: ['Is there a formal decision on record for why event.json uses folder structure plus embedded metadata instead of a database?'] },

  // --- Repeated-tool / loop-pressure questions (leading/false-presupposition
  // style, different subjects from RB27's own Archive Folder Adoption pair) ---
  { id: 'DEV27', cat: ['loopPressure'], turns: ['Global Search reads its index directly from the Keyword Registry, correct?'] },
  { id: 'DEV28', cat: ['loopPressure'], turns: ['Archive Analytics and Archive Health Reporting are really the same feature under two names, right?'] },
  { id: 'DEV29', cat: ['loopPressure'], turns: ['Realtime Team Presence is what decides whether an archive lock can be cleared, correct?'] },
  { id: 'DEV30', cat: ['loopPressure'], turns: ['The Design System & UI Consistency Framework is what controls which folder AutoIngest treats as the archive root, right?'] },
  { id: 'DEV31', cat: ['loopPressure'], turns: ['Dashboard Metadata Health and Metadata Verification are just two names for the same underlying check, correct?'] },
  { id: 'DEV32', cat: ['loopPressure'], turns: ['Event Maintenance is really just a renamed version of Event Creation, right?'] },
  { id: 'DEV33', cat: ['loopPressure'], turns: ['Checksum-Based File Verification is what the Activity Log actually uses to build its history, correct?'] },
  { id: 'DEV34', cat: ['loopPressure'], turns: ['Preview Focus / Selection Separation is the feature that generates thumbnails, right?'] },
  { id: 'DEV35', cat: ['loopPressure'], turns: ['Archive Repair and Archive Maintenance are triggered by the exact same button, correct?'] },
  { id: 'DEV36', cat: ['loopPressure'], turns: ['The Knowledge Engine prototype is what powers Global Search results, right?'] },

  // --- Natural-language retrieval / paraphrase questions (indirect phrasing,
  // testing Phase 8/9's retrieval; different subjects from QI05) ---
  { id: 'DEV37', cat: ['paraphrase'], turns: ['What stops the app from double-counting the same photo as two different files during import?'] },
  { id: 'DEV38', cat: ['paraphrase'], turns: ['Is there something that watches for a card or drive being plugged in without me telling it?'] },
  { id: 'DEV39', cat: ['paraphrase'], turns: ['What lets me flip through photos roughly by time instead of hunting through folders?'] },
  { id: 'DEV40', cat: ['paraphrase'], turns: ['Where would an operator go to see whether the whole archive checks out, not just today\'s import?'] },
  { id: 'DEV41', cat: ['paraphrase'], turns: ['What actually decides whose folder a photo lands in when multiple photographers are shooting the same event?'] },
  { id: 'DEV42', cat: ['paraphrase'], turns: ['Is there a fast path for grabbing just a handful of files without going through the whole event setup?'] },
  { id: 'DEV43', cat: ['paraphrase'], turns: ['What keeps two people from clobbering each other if they both try to touch the same archive at once?'] },
  { id: 'DEV44', cat: ['paraphrase'], turns: ['What is responsible for quietly pushing a local import up to the real archive later on?'] },
  { id: 'DEV45', cat: ['paraphrase'], turns: ['Is there a way to see what everyone else on the team is currently doing?'] },
  { id: 'DEV46', cat: ['paraphrase'], turns: ['What handles bringing files back in from a drive that already has a partial transfer on it?'] },

  // --- UNKNOWN / ambiguous relationships (pairs with NO documented edge --
  // correct answer is UNKNOWN, not a guess in either direction) ---
  { id: 'DEV47', cat: ['unknownRelation'], turns: ['Does the Design System & UI Consistency Framework control how Archive Analytics renders its charts?'] },
  { id: 'DEV48', cat: ['unknownRelation'], turns: ['Is Realtime Team Presence connected to the Telemetry Pipeline in any documented way?'] },
  { id: 'DEV49', cat: ['unknownRelation'], turns: ['Does QMZ Sequencing Workspace share any code with Event-Component Import Routing?'] },
  { id: 'DEV50', cat: ['unknownRelation'], turns: ['Is there a documented relationship between Login & Operator Identity and the Keyword Registry?'] },
  { id: 'DEV51', cat: ['unknownRelation'], turns: ['Does Archive Repair depend on the Design System framework in any way?'] },
  { id: 'DEV52', cat: ['unknownRelation'], turns: ['Is AI Archive Intelligence connected to Realtime Team Presence?'] },
  { id: 'DEV53', cat: ['unknownRelation'], turns: ['Does Checksum-Based File Verification feed into Archive Analytics?'] },
  { id: 'DEV54', cat: ['unknownRelation'], turns: ['Is there a documented link between Preview Focus / Selection Separation and Global Search?'] },
  { id: 'DEV55', cat: ['unknownRelation'], turns: ['Does Event Maintenance use the Telemetry Pipeline?'] },
  { id: 'DEV56', cat: ['unknownRelation'], turns: ['Is the Multi-Channel Release & Update System connected to Archive Health Reporting?'] },

  // --- Multi-turn conversations (2+ turns; several deliberately span more
  // than one required category too) ---
  { id: 'DEV57', cat: ['multiTurn', 'directional'], turns: [
    'Does Source Selection happen before or after the Grouping System?',
    'And does the Grouping System feed directly into the Import Pipeline?',
  ] },
  { id: 'DEV58', cat: ['multiTurn', 'decisionBacked'], turns: [
    'What does Checksum-Based File Verification actually check?',
    'If a checksum mismatch is found, does it automatically delete or replace the bad file?',
  ] },
  { id: 'DEV59', cat: ['multiTurn', 'loopPressure'], turns: [
    'Does Archive Browser let me browse events without touching the import workflow at all?',
    'So Archive Browser and Event Creation are basically the same screen just in different modes, right?',
  ] },
  { id: 'DEV60', cat: ['multiTurn'], turns: [
    'What is Quick Import for?',
    'How is that different from the normal import workflow?',
  ] },
  { id: 'DEV61', cat: ['multiTurn', 'unknownRelation'], turns: [
    'What does Archive Analytics show an operator?',
    'Is that connected to the Design System framework at all?',
  ] },
  { id: 'DEV62', cat: ['multiTurn'], turns: [
    'What happens if two operators try to clear the same archive lock at the same time?',
    'And what if the process that created the lock is still actually running?',
  ] },
  { id: 'DEV63', cat: ['multiTurn', 'paraphrase'], turns: [
    'Is there anything that checks whether metadata actually finished applying, not just whether the write was attempted?',
    'What would an operator see if it found a problem?',
  ] },
  { id: 'DEV64', cat: ['multiTurn'], turns: [
    'What is the Keyword Registry for?',
    'Can an operator add a brand-new keyword on the fly during import, or does it have to already exist in the registry?',
  ] },
  { id: 'DEV65', cat: ['multiTurn'], turns: [
    'What does Transfer Export actually do?',
    'And what picks that transfer back up on the other end?',
  ] },
  { id: 'DEV66', cat: ['multiTurn'], turns: [
    'What is Archive Folder Adoption for?',
    'What happens if the folder someone tries to adopt already has an event.json in it?',
  ] },

  // --- Ordinary, straightforward product questions ---
  { id: 'DEV67', cat: ['ordinary'], turns: ['What does the Dashboard show when the app first opens?'] },
  { id: 'DEV68', cat: ['ordinary'], turns: ['How do I create a brand new event?'] },
  { id: 'DEV69', cat: ['ordinary'], turns: ['What information does the Activity Log keep track of?'] },
  { id: 'DEV70', cat: ['ordinary'], turns: ['Can I preview a photo or video before it gets imported?'] },
  { id: 'DEV71', cat: ['ordinary'], turns: ['What does Import Source Attribution actually record?'] },
  { id: 'DEV72', cat: ['ordinary'], turns: ['Is there a way to search across the entire archive, not just the current event?'] },
  { id: 'DEV73', cat: ['ordinary'], turns: ['What does the Application Settings & Configuration Store actually hold?'] },
  { id: 'DEV74', cat: ['ordinary'], turns: ['What is the QMZ Sequencing Workspace used for?'] },
  { id: 'DEV75', cat: ['ordinary'], turns: ['How does AutoIngest check for and install its own software updates?'] },
  { id: 'DEV76', cat: ['ordinary'], turns: ['What does Archive Maintenance actually do?'] },
];
