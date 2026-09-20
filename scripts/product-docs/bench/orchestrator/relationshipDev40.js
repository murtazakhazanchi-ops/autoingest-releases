'use strict';

// ASK AUTOINGEST — CHECKPOINT 13, PHASE 11. EXPERIMENTAL. Post-
// implementation generalization dev set, built AFTER Phase 8's
// check_relationship tool existed, specifically on COMPLETELY DIFFERENT
// feature pairs than relationshipDiagnostic50.js (Phase 7's 58-conversation
// baseline set, already run against both the untouched Checkpoint-12
// system and the new Checkpoint-13 system in this same investigation).
//
// Every pair here is drawn from real, typed relationship edges already
// present in the Tier 1 (forensic-verified) Knowledge Model records
// (scripts/product-docs/lib/knowledgeModel/records/sourceAndImport.js,
// transferAndArchive.js, specialAndPlatform.js, metadata.js) -- the only
// tier with genuine `distinctFrom`/`uses`/`precedesInWorkflow` edges today
// (see this checkpoint's Phase 2 audit: Tier 2 registry-reshaped records
// are 100% generic `relatedTo`). Deliberately excludes the Metadata
// Reapply / Metadata Management Modal pair (QX03) and the Dashboard /
// Archive Health Reporting pair (RD37) -- both already covered by
// smokeTestC13.js and relationshipDiagnostic50.js.
//
// No expected-answer field anywhere in this file -- ground truth lives
// only in the researcher's own separate notes, never in runtime fixtures.
//
// Category tags (same convention as relationshipDiagnostic50.js):
//   containment   -- UI/screen containment or shared-interface question
//   dependency    -- workflow ordering / precedesInWorkflow question
//   archive       -- archive/import/metadata-subsystem relationship
//   unknown       -- no documented edge either direction
//   presupposition -- question assumes something false
//   three         -- three-or-more-entity comparison
//   multi         -- multi-turn
//   indirect      -- entity described, not named

module.exports = [
  // === CONTAINMENT / shared-UI (>=10) ===
  { id: 'RV01', cat: 'containment', turns: ['Does Source Selection show up as its own separate screen from Source Detection, or are they really the same view?'] },
  { id: 'RV02', cat: 'containment', turns: ["Is Duplicate Detection something with its own settings panel, or is it just built silently into the Import Pipeline's copy engine?"] },
  { id: 'RV03', cat: 'containment', turns: ['Does Quick Import use a completely separate import screen from the regular Import Pipeline, or do they share the same interface?'] },
  { id: 'RV04', cat: 'containment', turns: ['Is the QMZ Sequencing Workspace part of the same screen as Archive Folder Adoption, or a totally separate tool?'] },
  { id: 'RV05', cat: 'containment', turns: ['Does Metadata Audit & Repair share its interface with the Metadata Writing Engine, or does the Writing Engine not really have a UI of its own at all?'] },
  { id: 'RV06', cat: 'containment', turns: ['Is there a shared settings panel between the Telemetry Pipeline and Login & Operator Identity, or do those live in completely separate parts of the app?'] },
  { id: 'RV07', cat: 'containment', turns: ['Does Backup Update Scanning open inside the same modal as Transfer Export, or does it have its own separate window?'] },
  { id: 'RV08', cat: 'containment', turns: ['Is the QMZ workspace a tab inside some bigger sequencing tool, or does it stand entirely on its own as a screen?'] },
  { id: 'RV09', cat: ['containment', 'three'], turns: ['Between Source Detection, Source Selection, and Grouping, which of those three actually share one continuous workspace, and which are separate screens?'] },
  { id: 'RV10', cat: ['containment', 'multi'], turns: ['What is Archive Folder Adoption?', 'Does it use the same registration screen as the QMZ Sequencing Workspace?'] },
  { id: 'RV11', cat: ['containment', 'indirect'], turns: ["The workspace where you sort a photographer's already-ingested material into numbered sequences -- does that live inside the same window as the tool for adopting a pre-existing archive folder?"] },

  // === DEPENDENCY / workflow ordering (>=10) ===
  { id: 'RV12', cat: 'dependency', turns: ['Does Source Detection have to happen before I can use Source Selection, or can I select a source without it being detected first?'] },
  { id: 'RV13', cat: 'dependency', turns: ["Once I've picked a source in Source Selection, does Grouping happen before or after that step?"] },
  { id: 'RV14', cat: 'dependency', turns: ['Does Grouping have to be finished before the Import Pipeline starts actually copying files, or can the two overlap?'] },
  { id: 'RV15', cat: 'dependency', turns: ['Does the Import Pipeline run before or after Audit Integrity Verification during a normal import?'] },
  { id: 'RV16', cat: 'dependency', turns: ['Is Quick Import just an earlier stage that eventually hands off into the regular Import Pipeline, or is it a fully separate path?'] },
  { id: 'RV17', cat: 'dependency', turns: ['Does Transfer Export need to finish before Transfer Import can bring that same content into the Main Archive Root?'] },
  { id: 'RV18', cat: 'dependency', turns: ['Does Archive Maintenance need to be built before Event Maintenance, or are those two independent roadmap efforts?'] },
  { id: 'RV19', cat: ['dependency', 'multi'], turns: ['What is Quick Import?', 'Does it depend on Duplicate Detection running first, or does it have its own separate check for existing files?'] },
  { id: 'RV20', cat: 'dependency', turns: ['Once a metadata write is queued in the Metadata Durable Queue, does the Metadata Writing Engine have to finish first, or can the two run out of order?'] },
  { id: 'RV21', cat: ['dependency', 'three'], turns: ['Source Detection, Source Selection, and Grouping -- do those three always happen in that exact order, or can an operator jump around between them?'] },
  { id: 'RV22', cat: ['dependency', 'indirect'], turns: ["The step that notices a memory card is plugged in -- does that have to finish before I can actually activate it as my working source?"] },

  // === ARCHIVE / IMPORT / METADATA subsystem relationships (>=10) ===
  { id: 'RV23', cat: 'archive', turns: ['Does the Metadata Writing Engine write directly into event.json itself, or does something else own that write?'] },
  { id: 'RV24', cat: 'archive', turns: ['Is Metadata Audit & Repair the same mechanism as the Metadata Writing Engine, just running in a different mode?'] },
  { id: 'RV25', cat: 'archive', turns: ["Does Metadata Audit & Repair depend on the same durable queue that protects the Writing Engine's crash recovery?"] },
  { id: 'RV26', cat: 'archive', turns: ['Does event.json get read by Metadata Audit & Repair, or does Audit & Repair keep its own separate record of file state?'] },
  { id: 'RV27', cat: 'archive', turns: ['Is Archive Lock Handling built on top of Archive Health Reporting, or is it completely separate from it?'] },
  { id: 'RV28', cat: 'archive', turns: ['Does Archive Lock Handling share any mechanism with Transfer Export, or are those two kept deliberately apart?'] },
  { id: 'RV29', cat: 'archive', turns: ['Is Backup Update Scanning built using the same underlying mechanism as Transfer Export, or something else entirely?'] },
  { id: 'RV30', cat: 'archive', turns: ['Does Archive Maintenance touch the same archive roots that Archive Root Configuration manages, or is it scoped somewhere completely separate?'] },
  { id: 'RV31', cat: ['archive', 'multi'], turns: ['What is the Metadata Durable Queue?', 'Does Metadata Audit & Repair rely on that same queue mechanism, or does it have its own?'] },
  { id: 'RV32', cat: ['archive', 'three'], turns: ['Metadata Writing Engine, Metadata Durable Queue, and Metadata Audit & Repair -- how do those three actually connect to each other?'] },
  { id: 'RV33', cat: ['archive', 'indirect'], turns: ['The thing that makes sure a metadata batch survives a crash -- does the archive-wide audit tool that finds mismatched files use that same survival mechanism?'] },

  // === UNKNOWN / no documented edge, and false presuppositions (>=10) ===
  { id: 'RV34', cat: 'unknown', turns: ['Does the Telemetry Pipeline log anything related to QMZ sequencing activity specifically?'] },
  { id: 'RV35', cat: 'unknown', turns: ['Is there any documented connection between Login & Operator Identity and Duplicate Detection?'] },
  { id: 'RV36', cat: 'unknown', turns: ['Does Archive Folder Adoption feed any data into the Telemetry Pipeline?'] },
  { id: 'RV37', cat: 'unknown', turns: ["Would Quick Import's duplicate check share anything with Archive Lock Handling's stale-lock recovery?"] },
  { id: 'RV38', cat: ['presupposition', 'unknown'], turns: ['Since Archive Maintenance is already live, does it already coordinate with the Event Maintenance queue?'] },
  { id: 'RV39', cat: 'presupposition', turns: ['Login & Operator Identity and Import Source Attribution track the exact same underlying field, right?'] },
  { id: 'RV40', cat: 'presupposition', turns: ['The QMZ Sequencing Workspace and Archive Folder Adoption are really just two entry points into the same registration flow, aren\'t they?'] },
  { id: 'RV41', cat: 'unknown', turns: ['Does Source Detection ever talk directly to the Metadata Writing Engine?'] },
  { id: 'RV42', cat: 'unknown', turns: ['If Backup Update Scanning finds a problem, does it automatically trigger Metadata Audit & Repair?'] },
  { id: 'RV43', cat: 'presupposition', turns: ['The Telemetry Pipeline and Login & Operator Identity are basically the same accountability system, just named differently, right?'] },
  { id: 'RV44', cat: ['unknown', 'indirect'], turns: ['Is there any link between the panel showing who else is currently online and the archive-wide metadata audit tool?'] },
];
