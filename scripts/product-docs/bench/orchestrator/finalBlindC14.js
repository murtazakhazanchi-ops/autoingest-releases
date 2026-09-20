'use strict';
// ASK AUTOINGEST — CHECKPOINT 14, PHASE 16. Final independent blind set,
// authored AFTER the Phase 14 freeze, run ONCE. Broad product coverage,
// fresh wording throughout (does not reuse dev75C14.js's or any earlier
// checkpoint's exact phrasing, though some real directional/decision edges
// are necessarily reused -- the Tier-1 corpus has a finite, small set of
// typed relationship edges and Decision links; freshness here means
// wording, not manufacturing edges that don't exist). None of RB58/RB44/
// RB27/QI05 used as a primary subject. Category tags (cat) may overlap.
// Required minimums: total >=100, directional >=20, decisionBacked >=15,
// paraphrase >=15, unknownRelation >=10, falsePremise >=10, multiTurn >=20,
// ordinary >=10.
module.exports = [
  // --- Directional relationships (20+) ---
  { id: 'FB01', cat: ['directional'], turns: ['Before a device can be picked as an import source, does AutoIngest need to have already noticed it was plugged in?'] },
  { id: 'FB02', cat: ['directional'], turns: ['Once files are sorted into groups, is that grouping information already in place by the time copying starts, or does copying trigger the grouping?'] },
  { id: 'FB03', cat: ['directional'], turns: ['If I turn off checksum verification, does the Import Pipeline still have its own way of avoiding duplicate copies?'] },
  { id: 'FB04', cat: ['directional'], turns: ['Is the file-count check that Audit Integrity Verification does something that can only happen after the Import Pipeline has finished copying?'] },
  { id: 'FB05', cat: ['directional'], turns: ['When someone uses Quick Import, is the duplicate-prevention logic borrowed from the standard pipeline, or built fresh for Quick Import?'] },
  { id: 'FB06', cat: ['directional'], turns: ['If the Metadata Durable Queue went away entirely, would the Metadata Writing Engine still be able to survive a crash mid-write?'] },
  { id: 'FB07', cat: ['directional'], turns: ['Does a metadata write actually land inside event.json, or does it go into some other file first?'] },
  { id: 'FB08', cat: ['directional'], turns: ['Is Metadata Audit & Repair able to resume a batch that got interrupted, or does that resilience only belong to the Writing Engine?'] },
  { id: 'FB09', cat: ['directional'], turns: ['When Metadata Audit & Repair builds its evidence for a file, does it pull the live event.json, or a cached snapshot?'] },
  { id: 'FB10', cat: ['directional'], turns: ['In the physical drive transfer workflow, is exporting to the drive always the very first step?'] },
  { id: 'FB11', cat: ['directional'], turns: ['Under the hood, does Backup Update Scanning reuse the export machinery, or is it a completely separate code path?'] },
  { id: 'FB12', cat: ['directional'], turns: ['When a QMZ file gets moved into a sequence, does that automatically queue up a metadata write, or is that a manual follow-up step?'] },
  { id: 'FB13', cat: ['directional'], turns: ['Is Event Maintenance a broader capability that Archive Maintenance sits underneath, or is it the other way around?'] },
  { id: 'FB14', cat: ['directional'], turns: ['Does the auto-updater pull any information from the Telemetry Pipeline, or are those two things unrelated?'] },
  { id: 'FB15', cat: ['directional'], turns: ['If you plug in an external drive, does AutoIngest notice it before or after you manually pick it from a list?'] },
  { id: 'FB16', cat: ['directional'], turns: ['Do grouped file assignments get read once at the start of an import, or continuously throughout the copy?'] },
  { id: 'FB17', cat: ['directional'], turns: ['Is the per-file size check during copying the same automatic check that Audit Integrity Verification performs, or a separate, earlier one?'] },
  { id: 'FB18', cat: ['directional'], turns: ['Does Transfer Import expect the drive to already have a completed Transfer Export on it, or can it work with a raw, unrelated folder?'] },
  { id: 'FB19', cat: ['directional'], turns: ['Between the durable queue and the audit/repair batching, which one actually depends on the other for its resume capability?'] },
  { id: 'FB20', cat: ['directional'], turns: ['Does writing to event.json for metadata purposes go through the same engine every other metadata write uses, or does Audit & Repair have its own separate write path?'] },
  { id: 'FB21', cat: ['directional'], turns: ['Is source selection something an operator does before or after AutoIngest has already scanned what is on the device?'] },

  // --- Decision-backed / nuanced behavior (15+, fresh Decision links not used in dev75) ---
  { id: 'FB22', cat: ['decisionBacked'], turns: ['If a Stable release and its Release Candidate came from the exact same commit, would AutoIngest just relabel the RC build, or does it rebuild from scratch?'] },
  { id: 'FB23', cat: ['decisionBacked'], turns: ['Can an operator directly rename or restructure an event after it has already been created?'] },
  { id: 'FB24', cat: ['decisionBacked'], turns: ['Does the routing that decides which event a file belongs to ever change after the event has already been set up?'] },
  { id: 'FB25', cat: ['decisionBacked'], turns: ['If a checksum verification pass finds a mismatch, is the bad file automatically replaced from the source?'] },
  { id: 'FB26', cat: ['decisionBacked'], turns: ['Once a metadata verification pass finds an issue, does the fix happen automatically, or does an operator have to act?'] },
  { id: 'FB27', cat: ['decisionBacked'], turns: ['Is there any situation where AutoIngest would export files to a Transfer Drive without keeping a record of what was copied?'] },
  { id: 'FB28', cat: ['decisionBacked'], turns: ['When Transfer Import matches folders back to the archive, does it always trust the folder name, or does it look deeper?'] },
  { id: 'FB29', cat: ['decisionBacked'], turns: ['Can QMZ sequence numbers be reused once a sequence has been removed?'] },
  { id: 'FB30', cat: ['decisionBacked'], turns: ['Is Archive Maintenance something an operator can trigger today, or is that ability still being built?'] },
  { id: 'FB31', cat: ['decisionBacked'], turns: ['Does AI Archive Intelligence currently make any automated decisions about the archive on its own?'] },
  { id: 'FB32', cat: ['decisionBacked'], turns: ['If a release needs to go out on two different channels at once, does AutoIngest handle that as one combined release process or two separate ones?'] },
  { id: 'FB33', cat: ['decisionBacked'], turns: ['Was the Knowledge Engine prototype built as a completely new search system, or does it lean on search AutoIngest already had?'] },
  { id: 'FB34', cat: ['decisionBacked'], turns: ['Is there a specific, deliberate reason AutoIngest keeps folder structure AND embedded metadata instead of picking just one?'] },
  { id: 'FB35', cat: ['decisionBacked'], turns: ['If an operator tries to import into an event that is missing required structural information, does the system stop them or let it through with a warning?'] },
  { id: 'FB36', cat: ['decisionBacked'], turns: ['Does resolving the archive root ever just fall back to trusting a folder because nothing better is available?'] },

  // --- Difficult natural-language / paraphrase (15+, indirect phrasing) ---
  { id: 'FB37', cat: ['paraphrase'], turns: ['Is there a way to tell the app "this folder is already part of my archive, just start tracking it" without re-copying anything?'] },
  { id: 'FB38', cat: ['paraphrase'], turns: ['What keeps the app from thinking an import finished successfully when it actually only got halfway?'] },
  { id: 'FB39', cat: ['paraphrase'], turns: ['If my laptop dies mid-import, will I have to start the whole thing over from scratch?'] },
  { id: 'FB40', cat: ['paraphrase'], turns: ['What figures out that a location got typed wrong after the files already went out the door?'] },
  { id: 'FB41', cat: ['paraphrase'], turns: ['Is there something that tells me a coworker is already working on the event I just opened?'] },
  { id: 'FB42', cat: ['paraphrase'], turns: ['What decides how many photos get put in one folder before it splits things up by photographer?'] },
  { id: 'FB43', cat: ['paraphrase'], turns: ['Can I tell it to just grab everything off a card without picking an event first?'] },
  { id: 'FB44', cat: ['paraphrase'], turns: ['Is there something watching to make sure a NAS coming back online doesn\'t silently break an in-progress sync?'] },
  { id: 'FB45', cat: ['paraphrase'], turns: ['What actually stamps a photo with who took it?'] },
  { id: 'FB46', cat: ['paraphrase'], turns: ['If a drive gets unplugged partway through copying files off it, does the app know something went wrong?'] },
  { id: 'FB47', cat: ['paraphrase'], turns: ['What is the thing that lets a photographer sort their own shots into numbered batches after the event?'] },
  { id: 'FB48', cat: ['paraphrase'], turns: ['Is there a running total anywhere of how healthy the whole archive is, not just one event?'] },
  { id: 'FB49', cat: ['paraphrase'], turns: ['What tells you which memory card a specific photo actually came off of, months later?'] },
  { id: 'FB50', cat: ['paraphrase'], turns: ['Is there a lightweight way to grab just a few files without setting up all the usual event structure?'] },
  { id: 'FB51', cat: ['paraphrase'], turns: ['What makes sure two different archive locations do not end up with conflicting copies of the same event?'] },

  // --- UNKNOWN / ambiguous relationships (10+, no documented edge) ---
  { id: 'FB52', cat: ['unknownRelation'], turns: ['Does the Electron Application Shell security model have any documented effect on how Archive Analytics displays data?'] },
  { id: 'FB53', cat: ['unknownRelation'], turns: ['Is there a documented connection between Login & Operator Identity and Realtime Team Presence?'] },
  { id: 'FB54', cat: ['unknownRelation'], turns: ['Does Thumbnail Generation & Caching have any documented tie to the Multi-Channel Release & Update System?'] },
  { id: 'FB55', cat: ['unknownRelation'], turns: ['Is Source Cleanup connected to Archive Analytics in any documented way?'] },
  { id: 'FB56', cat: ['unknownRelation'], turns: ['Does the Telemetry Pipeline have a documented relationship with Archive Repair?'] },
  { id: 'FB57', cat: ['unknownRelation'], turns: ['Is there a documented link between File Browser & Media Grid/List Viewing and AI Archive Intelligence?'] },
  { id: 'FB58', cat: ['unknownRelation'], turns: ['Does Import Source Attribution connect to the Design System framework in any documented way?'] },
  { id: 'FB59', cat: ['unknownRelation'], turns: ['Is Checksum-Based File Verification tied to Realtime Team Presence at all?'] },
  { id: 'FB60', cat: ['unknownRelation'], turns: ['Does Event Creation have a documented relationship with the Knowledge Engine prototype?'] },
  { id: 'FB61', cat: ['unknownRelation'], turns: ['Is there a documented connection between Archive Folder Adoption and Archive Analytics?'] },
  { id: 'FB62', cat: ['unknownRelation'], turns: ['Does Dashboard & System Status connect to the Multi-Channel Release & Update System in any documented way?'] },

  // --- False-premise / adversarial (10+, confidently wrong assumption baked into the question) ---
  { id: 'FB63', cat: ['falsePremise'], turns: ['Since Global Search already shipped, does it search file contents or just titles?'] },
  { id: 'FB64', cat: ['falsePremise'], turns: ['Given that Archive Browser replaced the old File Browser, does the old one still exist anywhere?'] },
  { id: 'FB65', cat: ['falsePremise'], turns: ['Now that AI Archive Intelligence makes import decisions automatically, can an operator turn that off?'] },
  { id: 'FB66', cat: ['falsePremise'], turns: ['Since the Keyword Registry lets anyone add keywords freely, how does it stop duplicates from piling up?'] },
  { id: 'FB67', cat: ['falsePremise'], turns: ['Because Archive Maintenance already lets operators restructure events, does it also handle renaming photographers?'] },
  { id: 'FB68', cat: ['falsePremise'], turns: ['Given that Duplicate Detection compares actual file content, how long does that hashing usually take?'] },
  { id: 'FB69', cat: ['falsePremise'], turns: ['Since Quick Import creates a full event record like normal import does, can it be audited the same way?'] },
  { id: 'FB70', cat: ['falsePremise'], turns: ['Now that Archive Analytics is live, what metrics does its dashboard show first?'] },
  { id: 'FB71', cat: ['falsePremise'], turns: ['Because the Metadata Management Modal writes metadata itself, does it need its own crash-recovery mechanism separate from the Writing Engine?'] },
  { id: 'FB72', cat: ['falsePremise'], turns: ['Given that Event Maintenance already ships today, what is the fastest way to reach it from the dashboard?'] },
  { id: 'FB73', cat: ['falsePremise'], turns: ['Since Transfer Export automatically verifies checksums as part of the copy, why would anyone need to run verification separately?'] },

  // --- Multi-turn conversations (20+) ---
  { id: 'FB74', cat: ['multiTurn'], turns: [
    'What does the Design System & UI Consistency Framework actually cover?',
    'Does every new feature have to follow it, or is that optional?',
  ] },
  { id: 'FB75', cat: ['multiTurn', 'directional'], turns: [
    'Does source detection run continuously, or only when I open the import screen?',
    'And is that detection what triggers source selection, or are they unrelated?',
  ] },
  { id: 'FB76', cat: ['multiTurn'], turns: [
    'What does Realtime Team Presence actually track?',
    'Is that visible to every operator, or only to whoever is working on the same event?',
  ] },
  { id: 'FB77', cat: ['multiTurn', 'decisionBacked'], turns: [
    'What happens if a Transfer Export gets interrupted partway through?',
    'Can it pick back up where it left off, or does it start the whole export over?',
  ] },
  { id: 'FB78', cat: ['multiTurn'], turns: [
    'What is Archive Repair meant to fix?',
    'Is it available to use right now, or still on the roadmap?',
  ] },
  { id: 'FB79', cat: ['multiTurn', 'unknownRelation'], turns: [
    'What does Dashboard & System Status actually show?',
    'Does that pull anything from the Telemetry Pipeline?',
  ] },
  { id: 'FB80', cat: ['multiTurn'], turns: [
    'What is the difference between the Active Archive Root and the Main Archive Root?',
    'If the Main Archive Root goes offline, what happens to new imports?',
  ] },
  { id: 'FB81', cat: ['multiTurn'], turns: [
    'What does Source Cleanup actually remove?',
    'Does it ever run automatically, or does an operator always have to trigger it?',
  ] },
  { id: 'FB82', cat: ['multiTurn', 'paraphrase'], turns: [
    'Is there a way to know which files came from which specific card during a multi-card import?',
    'Does that record survive if the card gets reformatted afterward?',
  ] },
  { id: 'FB83', cat: ['multiTurn'], turns: [
    'What is the QMZ Sequencing Workspace actually for?',
    'Can more than one archivist work in it at the same time?',
  ] },
  { id: 'FB84', cat: ['multiTurn'], turns: [
    'What does the Metadata Durable Queue actually store?',
    'If two metadata writes for the same file are queued, what happens?',
  ] },
  { id: 'FB85', cat: ['multiTurn', 'decisionBacked'], turns: [
    'What triggers a metadata reapply?',
    'Does it reapply to every file in the event, or only the ones affected by the change?',
  ] },
  { id: 'FB86', cat: ['multiTurn'], turns: [
    'What does Import Source Attribution actually protect against?',
    'Would deleting the source card early break anything it depends on?',
  ] },
  { id: 'FB87', cat: ['multiTurn'], turns: [
    'What is the difference between Event Creation and Event Management & Editing?',
    'Can an operator jump straight to editing without going through creation first?',
  ] },
  { id: 'FB88', cat: ['multiTurn'], turns: [
    'What does Archive Health Reporting check for?',
    'How often does it run — is it continuous or on-demand?',
  ] },
  { id: 'FB89', cat: ['multiTurn', 'falsePremise'], turns: [
    'What is Archive Analytics used for today?',
    'Since it is already tracking storage trends, does it alert operators when space is running low?',
  ] },
  { id: 'FB90', cat: ['multiTurn'], turns: [
    'What does the Grouping System actually let an operator do?',
    'Once files are grouped, can that grouping be changed before import runs?',
  ] },
  { id: 'FB91', cat: ['multiTurn'], turns: [
    'What is the point of the Metadata Management Modal?',
    'Does closing it partway through a tab switch lose any unsaved changes?',
  ] },
  { id: 'FB92', cat: ['multiTurn'], turns: [
    'What does Photographer-Folder Resolution actually name the folder after?',
    'What happens if two photographers have the exact same name?',
  ] },
  { id: 'FB93', cat: ['multiTurn'], turns: [
    'What is Backup Update Scanning meant to catch?',
    'Does it ever delete anything, or only copy?',
  ] },
  { id: 'FB94', cat: ['multiTurn'], turns: [
    'What does Checksum-Based File Verification actually verify?',
    'Is it something that runs by default on every import?',
  ] },

  // --- Ordinary, straightforward product questions (10+) ---
  { id: 'FB95', cat: ['ordinary'], turns: ['What is the very first thing an operator does when starting a new import session?'] },
  { id: 'FB96', cat: ['ordinary'], turns: ['What does the Activity Log actually show for a completed import?'] },
  { id: 'FB97', cat: ['ordinary'], turns: ['Can I preview a video file before importing it, the same way I can with photos?'] },
  { id: 'FB98', cat: ['ordinary'], turns: ['What information gets tracked about who is logged into AutoIngest?'] },
  { id: 'FB99', cat: ['ordinary'], turns: ['What does the Application Auto-Update system actually check before installing a new version?'] },
  { id: 'FB100', cat: ['ordinary'], turns: ['What is the purpose of the Keyword Registry?'] },
  { id: 'FB101', cat: ['ordinary'], turns: ['What does Event-Component Import Routing actually decide?'] },
  { id: 'FB102', cat: ['ordinary'], turns: ['What is stored in the Application Settings & Configuration Store?'] },
  { id: 'FB103', cat: ['ordinary'], turns: ['What does Archive Folder Adoption let an operator do?'] },
  { id: 'FB104', cat: ['ordinary'], turns: ['What does the Metadata Writing Engine actually write onto a file?'] },
];
