'use strict';

// ASK AUTOINGEST — CHECKPOINT 13, PHASE 7. EXPERIMENTAL. Baseline
// relationship diagnostic, 58 conversations, run against the UNTOUCHED,
// frozen Checkpoint-12 system (engineC12/validatorC12/knowledgeAccessC12,
// unmodified) to measure how the current architecture handles questions
// about RELATIONSHIPS between two or more real AutoIngest concepts, as
// opposed to Checkpoint 12's blind set, which mostly tested single-entity
// identification/capability questions.
//
// Deliberately does NOT include the QX03 pair (Metadata Reapply vs
// Metadata Management Modal) -- Checkpoint 13 must generalize beyond that
// one already-diagnosed pair, not just retest it.
//
// No expected-answer field anywhere in this file by design -- ground
// truth for scoring lives only in the researcher's own separate notes,
// never in runtime-loaded fixtures.
//
// Category tags overlap by design, same convention as devSetC12.js:
//   positive        -- a real, canonically-documented relation holds
//   negative        -- the asked relationship is false / explicitly contradicted
//   unknown         -- genuinely undetermined from canonical evidence
//   unrelated       -- two real entities with no documented relationship at all
//   presupposition  -- the question presupposes something false
//   three           -- three-or-more-entity comparison
//   indirect        -- entities described, not named
//   multi           -- multi-turn, later turns depend on earlier context

module.exports = [
  // === POSITIVE — real, documented relations (broad areas) ===
  { id: 'RD01', cat: 'positive', turns: ['If I start a Transfer Export and someone else tries to kick off a Transfer Import into the same archive at the same time, does the app let both run?'] },
  { id: 'RD02', cat: ['positive', 'indirect'], turns: ["Does the thing that guarantees an import never gets left half-written also record who did the import and where it came from?"] },
  { id: 'RD03', cat: 'positive', turns: ['Does the Keyword Registry feed both the Metadata Management Modal and Metadata Reapply, or just one of them?'] },
  { id: 'RD04', cat: 'positive', turns: ['Are the four archive roots something I set up through the regular Settings screen, or somewhere else entirely?'] },
  { id: 'RD05', cat: ['positive', 'multi'], turns: ['What is the Grouping System?', 'Does the routing that builds sub-event and photographer folders actually depend on what I did in Grouping?'] },
  { id: 'RD06', cat: 'positive', turns: ["Does Photographer-Folder Resolution use the same operator-identity information that Import Source Attribution logs?"] },
  { id: 'RD07', cat: 'positive', turns: ['Is the automatic count-based integrity check something that runs as part of a normal import, or only if I ask for it separately?'] },
  { id: 'RD08', cat: 'positive', turns: ['When I run a Local-First sync job, does it get its own checksum verification pass, the same underlying mechanism as the import-batch one?'] },
  { id: 'RD09', cat: 'positive', turns: ['Does Archive Health Reporting surface stale-lock problems, or is that a totally separate area I have to check on my own?'] },
  { id: 'RD10', cat: 'positive', turns: ['Is Application Auto-Update tied into the same release/channel system that ships new AutoIngest builds, or does it work independently?'] },
  { id: 'RD11', cat: ['positive', 'multi'], turns: ['What is Media Preview?', 'And does that connect to the click-vs-selection separation you mentioned for the file browser?'] },
  { id: 'RD12', cat: 'positive', turns: ['Does the Dashboard pull in metadata-health information, or would I need to go look at that somewhere else?'] },

  // === NEGATIVE — explicit, documented contradictions ===
  { id: 'RD13', cat: 'negative', turns: ["Can I minimize a regular Event Import the same way I can run Transfer Export or Transfer Import in the background?"] },
  { id: 'RD14', cat: ['negative', 'presupposition'], turns: ["Checksum-Based File Verification and Audit Integrity Verification are basically the same check under two names, right?"] },
  { id: 'RD15', cat: 'negative', turns: ['Once Archive-Wide Integrity Verification eventually ships, will it just be a bigger version of the existing Checksum-Based File Verification, reusing the exact same mechanism?'] },
  { id: 'RD16', cat: ['negative', 'multi'], turns: ['What is the File Browser?', 'So does that let me look back through everything already sitting in my archive too?'] },
  { id: 'RD17', cat: 'negative', turns: ['Is the planned Archive Browser basically the same thing as Global Search once both ship, just under a different name?'] },
  { id: 'RD18', cat: ['negative', 'presupposition'], turns: ['If I start a Transfer Export in the background, can I then also start a Transfer Import at the same time since both are just background jobs?'] },
  { id: 'RD19', cat: 'negative', turns: ['Does enabling Application Auto-Update also turn on background sync for my archive, since they both happen automatically in the background?'] },

  // === UNKNOWN — genuinely undetermined from canonical evidence ===
  { id: 'RD20', cat: 'unknown', turns: ['Does Thumbnail Generation share its on-disk cache with Media Preview, or does Preview regenerate its own images separately?'] },
  { id: 'RD21', cat: 'unknown', turns: ['If I re-run Metadata Reapply after already running Archive Repair on the same event, do they coordinate, or could they conflict?'] },
  { id: 'RD22', cat: 'unknown', turns: ['Does the Activity Log get notified immediately when Local-First Background Sync finishes moving files up to the archive, or only after some delay?'] },
  { id: 'RD23', cat: 'unknown', turns: ['Would enabling Archive Analytics eventually require Global Search to already be built, or are they independent of each other?'] },
  { id: 'RD24', cat: 'unknown', turns: ["Does Source Cleanup wait for Checksum-Based File Verification to finish before it's allowed to delete anything, if I've run both?"] },
  { id: 'RD25', cat: ['unknown', 'indirect'], turns: ['Is there any connection between the thing that resolves which physical photographer folder a file lands in and the live who-else-is-online panel?'] },

  // === UNRELATED — two real entities, no documented relationship at all ===
  { id: 'RD26', cat: 'unrelated', turns: ['Does turning on Application Auto-Update change how Archive Root Configuration resolves which storage location to use?'] },
  { id: 'RD27', cat: 'unrelated', turns: ['Does the Activity Log pull any of its data from the Keyword Registry?'] },
  { id: 'RD28', cat: 'unrelated', turns: ["Is Thumbnail Generation's caching behavior configured anywhere in Application Settings & Configuration Store?"] },
  { id: 'RD29', cat: 'unrelated', turns: ['Does the Electron shell security model have anything to do with how Photographer-Folder Resolution picks a folder?'] },
  { id: 'RD30', cat: 'unrelated', turns: ['Does Multi-Channel Release & Update System have any effect on Grouping behavior during ingestion?'] },

  // === THREE-OR-MORE-ENTITY comparisons ===
  { id: 'RD31', cat: 'three', turns: ["I keep hearing about three different verification checks -- one automatic count check, one deeper checksum check, and a future archive-wide one. How do those three actually relate to each other?"] },
  { id: 'RD32', cat: 'three', turns: ['Archive Browser, Global Search, and AI Archive Intelligence -- are those three planned features actually one combined effort, or genuinely separate capabilities?'] },
  { id: 'RD33', cat: ['three', 'multi'], turns: ['What is Transfer Background/Minimize Operation?', 'Does that same minimize behavior apply to Transfer Export, Transfer Import, and Backup Update Scanning equally, or does one of those three work differently?'] },
  { id: 'RD34', cat: 'three', turns: ['Between the Metadata Management Modal, Metadata Reapply, and the Keyword Registry, which of those three actually share a user interface and which are just conceptually related?'] },
  { id: 'RD35', cat: 'three', turns: ['Do Event Creation, Event Management, and Event-Component Import Routing all read from the same underlying event data, or does each keep its own separate copy?'] },

  // === PRESUPPOSITION — question assumes something false ===
  { id: 'RD36', cat: 'presupposition', turns: ["Since Archive Analytics already tracks storage growth, can I pull up that trend chart right now?"] },
  { id: 'RD37', cat: 'presupposition', turns: ['The Dashboard and Archive Health Reporting are the same screen under two names, right -- which one should I stop calling by the old name?'] },
  { id: 'RD38', cat: ['presupposition', 'indirect'], turns: ["Now that Global Search exists, do I still need to open individual events one at a time, or can I search across everything at once?"] },
  { id: 'RD39', cat: 'presupposition', turns: ["Archive Repair already runs automatically in the background whenever corruption is detected, right?"] },
  { id: 'RD40', cat: 'presupposition', turns: ['Since Photographer-Folder Resolution and Grouping are just two names for the same step, does changing one setting affect both?'] },

  // === INDIRECT identification feeding into a relationship question ===
  { id: 'RD41', cat: 'indirect', turns: ["The screen that shows overall system status when I open the app -- does that pull in anything from the report on archive structural soundness?"] },
  { id: 'RD42', cat: 'indirect', turns: ['Does the thing that lets two people see who else is currently working affect how folders get assigned to photographers?'] },
  { id: 'RD43', cat: 'indirect', turns: ["The feature that writes event.json in one atomic step -- does that also cover the piece that records which memory card or drive a file came from?"] },
  { id: 'RD44', cat: 'indirect', turns: ['Is the screen for correcting an event after it already exists the same one used for building a brand-new event from scratch?'] },

  // === MULTI-TURN, relationship-heavy follow-ups ===
  { id: 'RD45', cat: 'multi', turns: ['What is Archive Health Reporting?', 'Does it depend on Archive Root Configuration being set up correctly first?'] },
  { id: 'RD46', cat: 'multi', turns: ['What is the Keyword Registry?', 'If I change a keyword there, does that retroactively change anything Metadata Reapply already wrote to already-imported files?'] },
  { id: 'RD47', cat: ['multi', 'negative'], turns: ['What is Backup Update Scanning?', 'Can I also minimize that one to the background the same way as Transfer Export?'] },
  { id: 'RD48', cat: 'multi', turns: ['What is Import Source Attribution?', 'Is that the same underlying record Photographer-Folder Resolution reads to figure out whose folder a file belongs in?'] },
  { id: 'RD49', cat: ['multi', 'unknown'], turns: ['What is Dashboard Metadata Health?', 'Does fixing something there automatically clear anything flagged in the Activity Log?'] },

  // === Additional broad-category coverage: recovery, configuration, dependency, ordering ===
  { id: 'RD50', cat: 'positive', turns: ['Does resolving which archive root to use happen before or after AutoIngest decides whether Local-First sync is needed for this session?'] },
  { id: 'RD51', cat: 'negative', turns: ['If Archive Root Configuration ever fails to resolve a valid root, does Local-First Background Sync just proceed anyway using whatever was last used?'] },
  { id: 'RD52', cat: 'unknown', turns: ['Does recovering from a stale archive lock also re-check file checksums as part of the same recovery step, or are those two completely separate actions?'] },
  { id: 'RD53', cat: 'positive', turns: ['Is Application Settings & Configuration Store the same place where Application Auto-Update keeps its own settings, or does Auto-Update manage its own configuration?'] },
  { id: 'RD54', cat: 'presupposition', turns: ['Since Event Maintenance is already available, can I queue up maintenance work on an event right now?'] },
  { id: 'RD55', cat: 'three', turns: ['If I look at Duplicate Detection, Checksum-Based File Verification, and Audit Integrity Verification together, do all three run automatically on every import, or does only one of them?'] },
  { id: 'RD56', cat: 'indirect', turns: ["Does the report on whether the archive is structurally sound also tell me about stale locks left behind, or is that a different report entirely?"] },
  { id: 'RD57', cat: ['negative', 'multi'], turns: ['What is Event-Component Import Routing?', 'Does that also handle deleting the source files off the memory card once they are safely copied?'] },
  { id: 'RD58', cat: 'unrelated', turns: ['Does the Electron Application Shell & Security Model have any bearing on which files Duplicate Detection considers a match?'] },
];
