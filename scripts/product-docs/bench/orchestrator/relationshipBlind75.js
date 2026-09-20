'use strict';

// ASK AUTOINGEST — CHECKPOINT 13, PHASE 17. EXPERIMENTAL. POST-FREEZE
// blind qualification set. Built and run exactly ONCE against the frozen
// engineC13/validatorC13/knowledgeAccessC13 system -- no tuning against
// this set is permitted.
//
// Independent of relationshipDiagnostic50.js (Phase 7, 58 conversations)
// and relationshipDev40.js (Phase 11, 44 conversations) -- every pair here
// is a feature/workflow combination NOT used as a primary subject in
// either prior set. Grounded in real Knowledge Model relationship edges
// (Tier 1 hand-authored: uses/distinctFrom/precedesInWorkflow/relatedTo in
// records/{metadata,transferAndArchive,sourceAndImport,specialAndPlatform}.js;
// Tier 2 registry-reshaped: relatedTo only, records/registryReshaped.generated.js)
// and, where the typed-edge supply for a category was exhausted by the two
// prior sets, in canonical prose (docs/product/features/*.md,
// docs/product/workflows/*.md, and Tier 1 records' own behavior/recovery
// text) -- disclosed per-category below, not silently substituted.
//
// KNOWN GAP under test: relationshipDev40.js found ONE confirmed failure
// (RV14) on a temporal/ordering-shaped question ("does X have to finish
// before Y, or can they overlap") where check_relationship was never
// invoked. This set deliberately includes 9 fresh temporal/ordering
// questions (exceeding the required 8) on feature pairs never used for
// that purpose before, specifically to test whether that gap generalizes
// or was isolated to the one case found.
//
// No expected-answer field anywhere -- ground truth lives only in the
// researcher's own separate notes, never in runtime-loaded fixtures.
//
// Category tags (same convention as the two prior sets; overlap by design):
//   positive        -- a real, documented relation holds
//   negative        -- the asked relationship is false (CONTRADICTED via a
//                       real distinctFrom edge, OR corrected via UNKNOWN/
//                       wrong-direction -- both are "the asked claim is
//                       false", distinguished in the researcher's own
//                       ground-truth notes, not in this file)
//   unknown         -- no documented edge either direction
//   partial         -- a simple yes/no would be misleading; nuance required
//   temporal        -- ordering/overlap/dependency-in-time question
//   three           -- three-or-more-entity comparison
//   indirect        -- entity described, not named
//   presupposition  -- question assumes something false
//   multi           -- multi-turn, later turns depend on earlier context
//   plain           -- ordinary, non-relational (control group)

module.exports = [
  // === POSITIVE — real documented relations (>=15), fresh pairs ===
  { id: 'RB01', cat: 'positive', turns: ['Does the File Browser connect at all to the Grouping System, or are those two totally unrelated parts of the workflow?'] },
  { id: 'RB02', cat: 'positive', turns: ['Is Preview Focus tied into the visual Design System at all, or is that purely its own separate thing?'] },
  { id: 'RB03', cat: 'positive', turns: ["Does Metadata Verification actually rely on the Metadata Writing Engine for anything, or does it check files completely on its own?"] },
  { id: 'RB04', cat: 'positive', turns: ['Is Metadata Verification connected to Transfer Import in any documented way?'] },
  { id: 'RB05', cat: ['positive', 'multi'], turns: ['What is Event Creation?', 'Does that connect to Event-Component Import Routing at all, or are those two unrelated?'] },
  { id: 'RB06', cat: 'positive', turns: ['Is Event Management & Editing connected to the Activity Log in any way, or completely separate?'] },
  { id: 'RB07', cat: ['positive', 'multi'], turns: ['What is Archive Repair?', 'Does that tie into Archive Health Reporting at all?'] },
  { id: 'RB08', cat: 'positive', turns: ['Is Archive Analytics connected to Archive Health Reporting, or are those two totally separate reporting efforts?'] },
  { id: 'RB09', cat: 'positive', turns: ['Does Local-First Background Sync actually connect to the Metadata Writing Engine, or does it just move already-tagged files around?'] },
  { id: 'RB10', cat: 'positive', turns: ['Is Source Cleanup connected to Source Selection in any documented way?'] },
  { id: 'RB11', cat: 'positive', turns: ['Does Audit Integrity Verification feed anything into the Activity Log, or do those stay separate?'] },
  { id: 'RB12', cat: 'positive', turns: ['Is the Activity Log connected to event.json itself, or does it keep its own totally independent record?'] },
  { id: 'RB13', cat: 'positive', turns: ['Does Photographer-Folder Resolution connect to Event-Component Import Routing, or do those work completely independently of each other?'] },
  { id: 'RB14', cat: 'positive', turns: ['Is Multi-Channel Release & Update System connected to the Application Settings & Configuration Store?'] },
  { id: 'RB15', cat: ['positive', 'indirect'], turns: ["The read-only preview mode that shows what a backup run would change -- does that actually depend on the same drive-writing mechanism Transfer Import uses, or is it built completely independently?"] },
  { id: 'RB16', cat: 'positive', turns: ['Does Event Management & Editing connect to Event Maintenance at all, once Event Maintenance eventually ships?'] },

  // === NEGATIVE — asked relationship is false (>=15) ===
  // RB17-RB19: real, explicit distinctFrom edges (true CONTRADICTED cases)
  { id: 'RB17', cat: 'negative', turns: ["Transfer Import and Backup Update Scanning are really the same underlying mechanism with two different labels, aren't they?"] },
  { id: 'RB18', cat: 'negative', turns: ['Does the QMZ Sequencing Workspace use the same click-vs-selection separation logic that the file browser uses for preview focus?'] },
  { id: 'RB19', cat: ['negative', 'presupposition'], turns: ['Login & Operator Identity and Photographer-Folder Resolution both track the same photographer field, right?'] },
  // RB20-RB31: no documented edge either direction -- the asked positive/
  // same-mechanism claim is false because it is simply not established
  // (resolves UNKNOWN, not a stored negative edge -- ground-truth notes
  // distinguish this from RB17-19 for the researcher's own scoring)
  { id: 'RB20', cat: ['negative', 'presupposition'], turns: ['Thumbnail Generation and Multi-Channel Release & Update System both pull from the same background-task scheduler, correct?'] },
  { id: 'RB21', cat: ['negative', 'presupposition'], turns: ['The Electron Application Shell & Security Model is basically what powers Archive Analytics under the hood, right?'] },
  { id: 'RB22', cat: ['negative', 'presupposition'], turns: ["Source Cleanup and Duplicate Detection are actually the same safety check, just described two different ways, aren't they?"] },
  { id: 'RB23', cat: ['negative', 'presupposition'], turns: ['The Telemetry Pipeline directly writes into Archive Health Reporting, correct?'] },
  { id: 'RB24', cat: ['negative', 'presupposition'], turns: ["Archive Folder Adoption and Event Maintenance are the same capability under two different roadmap names, right?"] },
  { id: 'RB25', cat: ['negative', 'presupposition'], turns: ['AI Archive Intelligence is what currently powers Duplicate Detection behind the scenes, correct?'] },
  { id: 'RB26', cat: ['negative', 'presupposition'], turns: ['The Keyword Registry and Global Search are the same underlying lookup index, just exposed two different ways, right?'] },
  { id: 'RB27', cat: ['negative', 'presupposition'], turns: ['Archive Folder Adoption reads its configuration from the Application Settings & Configuration Store, correct?'] },
  { id: 'RB28', cat: ['negative', 'presupposition'], turns: ['Media Preview and Archive Browser are the same viewing surface, just at different points in the workflow, right?'] },
  { id: 'RB29', cat: ['negative', 'presupposition'], turns: ['Does Duplicate Detection get its list of already-known files from the Keyword Registry?'] },
  { id: 'RB30', cat: ['negative', 'presupposition'], turns: ['Event Creation and QMZ Sequencing Workspace are really the same entry point into AutoIngest, just for different event types, right?'] },
  { id: 'RB31', cat: ['negative', 'presupposition'], turns: ['The Application Auto-Update system is what schedules when Local-First Background Sync runs, correct?'] },

  // === UNKNOWN — no documented edge either direction (>=10) ===
  { id: 'RB32', cat: 'unknown', turns: ['Is there any documented connection between Thumbnail Generation and the Telemetry Pipeline?'] },
  { id: 'RB33', cat: 'unknown', turns: ['Does Preview Focus / Selection Separation have any documented tie to Import Source Attribution?'] },
  { id: 'RB34', cat: 'unknown', turns: ['Is Archive Analytics connected in any documented way to Duplicate Detection?'] },
  { id: 'RB35', cat: 'unknown', turns: ['Does the Design System have any documented connection to Archive Lock Handling?'] },
  { id: 'RB36', cat: 'unknown', turns: ['Is there a documented link between Global Search and the Metadata Durable Queue?'] },
  { id: 'RB37', cat: 'unknown', turns: ['Does Event Maintenance have any documented connection to Thumbnail Generation?'] },
  { id: 'RB38', cat: 'unknown', turns: ['Is Source Detection connected in any documented way to Archive Analytics?'] },
  { id: 'RB39', cat: ['unknown', 'indirect'], turns: ["The tool that adopts an already-existing archive folder -- does that have any documented link to the trend-tracking capability that's still on the roadmap?"] },
  { id: 'RB40', cat: 'unknown', turns: ['Does AI Archive Intelligence have any documented connection to the Electron Application Shell & Security Model?'] },
  { id: 'RB41', cat: 'unknown', turns: ['Is there a documented connection between Backup Update Scanning and the Keyword Registry?'] },

  // === PARTIAL-COVERAGE / nuanced (>=10) ===
  { id: 'RB42', cat: 'partial', turns: ["Once Archive-Wide Integrity Verification ships, will it directly build on Checksum-Based File Verification's own hashing code, or is that still an open question?"] },
  { id: 'RB43', cat: 'partial', turns: ['Does the whole Backup Update Scanning process share Transfer Import\'s resume-after-crash mechanism, or does that only apply to part of it?'] },
  { id: 'RB44', cat: 'partial', turns: ["When you clear a stale archive lock yourself versus using Archive Diagnostics to clear one from a different device, is that exactly the same recovery path, or does it work a bit differently?"] },
  { id: 'RB45', cat: ['partial', 'three'], turns: ['Multi-Channel Release & Update System connects to both the Settings Store and Application Auto-Update -- is it equally tied to both, or is one connection more central than the other?'] },
  { id: 'RB46', cat: 'partial', turns: ["Does Metadata Audit & Repair read from event.json, does event.json read from it, or does information actually flow both directions between them?"] },
  { id: 'RB47', cat: 'partial', turns: ['Is Archive Repair fully built on Archive Health Reporting, or does it only use part of what that feature provides?'] },
  { id: 'RB48', cat: ['partial', 'three'], turns: ['Archive Analytics is connected to both Archive Health Reporting and AI Archive Intelligence -- do all three of those actually feed into each other, or is it more of a one-way chain?'] },
  { id: 'RB49', cat: 'partial', turns: ["Local-First Background Sync touches both the Import Pipeline and the Metadata Writing Engine -- does it depend on both equally, or is one just incidental?"] },
  { id: 'RB50', cat: 'partial', turns: ['Is Photographer-Folder Resolution something Event-Component Import Routing fully depends on, or just something it loosely touches?'] },
  { id: 'RB51', cat: ['partial', 'indirect'], turns: ["The wizard for setting up a brand-new event -- once Event Maintenance exists, will that wizard be the same entry point used for maintenance work, or just a related-but-separate one?"] },

  // === TEMPORAL / ORDERING (>=8, deliberately stress-testing the known gap) ===
  { id: 'RB52', cat: 'temporal', turns: ["Do you have to actually create an event first, or can Quick Import get files into the archive without an event existing yet?"] },
  { id: 'RB53', cat: 'temporal', turns: ["When clearing your own stale archive lock, does AutoIngest confirm no process is still actively renewing it before letting you clear it, or does the clear happen first and get checked after?"] },
  { id: 'RB54', cat: 'temporal', turns: ['Does Archive Folder Adoption check for a conflicting duplicate event before it writes the new event.json, or does it write first and check afterward?'] },
  { id: 'RB55', cat: 'temporal', turns: ["During a Transfer Export, does the checkpoint file only get written once at the very end, or does it update as the export progresses?"] },
  { id: 'RB56', cat: 'temporal', turns: ["Does Local-First Background Sync wait for the local import to fully finish before it starts moving anything to the archive, or can the two overlap?"] },
  { id: 'RB57', cat: 'temporal', turns: ['Can you start using Event Maintenance on an event before that event has gone through Event Management at all, or does it have to be edited there first?'] },
  { id: 'RB58', cat: 'temporal', turns: ["Does Photographer-Folder Resolution run before Event-Component Import Routing decides the destination folder, or after?"] },
  { id: 'RB59', cat: 'temporal', turns: ['Can Source Cleanup run at any time, or does a new source have to be selected again first before it will do anything?'] },
  { id: 'RB60', cat: ['temporal', 'multi'], turns: ['What is Metadata Event-State Derivation?', "Does that get computed before a metadata write happens, or only after, or is it continuous?"] },

  // === THREE-OR-MORE ENTITY comparisons ===
  { id: 'RB61', cat: 'three', turns: ['Metadata Verification, Metadata Writing Engine, and Metadata Event-State Derivation -- how do those three actually connect, if at all?'] },
  { id: 'RB62', cat: 'three', turns: ['Event Creation, Event Management, and Event Maintenance -- do all three read and write the same event data, or does each own something separate?'] },
  { id: 'RB63', cat: 'three', turns: ['Archive Health Reporting, Archive Repair, and Archive Analytics -- are those three genuinely connected to each other, or just three unrelated planned reports?'] },

  // === MULTI-TURN relationship follow-ups (>=10) ===
  { id: 'RB64', cat: 'multi', turns: ['What is Metadata Verification?', 'Does it depend on the Metadata Writing Engine to do its checks?'] },
  { id: 'RB65', cat: 'multi', turns: ['What is Source Cleanup?', 'Is that tied to Source Selection at all?'] },
  { id: 'RB66', cat: 'multi', turns: ['What is Archive Analytics?', 'Does it connect to AI Archive Intelligence once both exist?'] },
  { id: 'RB67', cat: 'multi', turns: ['What is Event-Component Import Routing?', 'Does that depend on Photographer-Folder Resolution to do its job?'] },
  { id: 'RB68', cat: 'multi', turns: ['What is the Activity Log?', 'Does it read anything from event.json directly?'] },
  { id: 'RB69', cat: ['multi', 'negative'], turns: ['What is Archive Repair?', 'Is that the exact same thing as Archive Health Reporting, just an older name for it?'] },
  { id: 'RB70', cat: ['multi', 'unknown'], turns: ['What is the Design System?', 'Does that have any documented connection to how Archive Lock Handling behaves?'] },
  { id: 'RB71', cat: ['multi', 'temporal'], turns: ['What is Event Maintenance?', "Does an event need to already exist in the archive before Event Maintenance can be used on it, or can it apply to anything?"] },
  { id: 'RB72', cat: ['multi', 'positive'], turns: ['What is Multi-Channel Release & Update System?', 'Does the Application Settings & Configuration Store keep track of anything for it?'] },
  { id: 'RB73', cat: ['multi', 'partial'], turns: ['What is Audit Integrity Verification?', 'Does it feed its results into the Activity Log directly, or just log them somewhere separate?'] },

  // === ORDINARY, non-relational (>=5, control group) ===
  { id: 'RB74', cat: 'plain', turns: ['What is Metadata Event-State Derivation?'] },
  { id: 'RB75', cat: 'plain', turns: ['What is Source Cleanup?'] },
  { id: 'RB76', cat: 'plain', turns: ['What does Archive Repair do once it ships?'] },
  { id: 'RB77', cat: 'plain', turns: ['What is Archive Analytics for?'] },
  { id: 'RB78', cat: 'plain', turns: ['What does the Multi-Channel Release & Update System actually manage?'] },
  { id: 'RB79', cat: 'plain', turns: ['Can I already use Event Maintenance on my events?'] },
];
