'use strict';
// PRODUCTION READINESS PHASE 1, Section 5 — frozen deterministic retrieval
// benchmark. 250+ queries, manually verified against canonical product
// knowledge (see the record summaries pulled directly from build.assemble()
// output this benchmark was authored against). Covers all 58 features + 9
// workflows. Style tags: 'direct' (contains title/near-title), 'partial'
// (contains part of the title or a real alias), 'paraphrase' (natural
// rephrasing, no title words), 'indirect' (deliberately hard, operator-
// voice, no title words, minimal keyword overlap), 'no-answer' (nothing in
// the KB should satisfy this), 'multi-relevant' (more than one record is
// legitimately relevant). `containsTitle` is computed, not asserted, by the
// scoring script (case-insensitive substring/word check against the
// expected record's own title) so the >=30%-without-title requirement is
// verified mechanically, not by self-report.
//
// NOT built solely around historical failures -- RB58/RB44/RB27/QI05 are
// not privileged subjects here; each of the 67 records gets comparable
// coverage regardless of whether it was ever involved in a prior defect.
module.exports = [
  // ===== AI-FEAT-001 Electron Application Shell & Security Model =====
  { id: 'R001', q: 'What is the Electron Application Shell & Security Model?', expect: ['AI-FEAT-001'], style: 'direct' },
  { id: 'R002', q: 'Does the app run with Node integration enabled in the renderer?', expect: ['AI-FEAT-001'], style: 'paraphrase' },
  { id: 'R003', q: 'What security restrictions does the main app window run under?', expect: ['AI-FEAT-001'], style: 'indirect' },

  // ===== AI-FEAT-002 Login & Operator Identity =====
  { id: 'R004', q: 'What is Login & Operator Identity?', expect: ['AI-FEAT-002'], style: 'direct' },
  { id: 'R005', q: 'How does the app know which person is currently using it?', expect: ['AI-FEAT-002'], style: 'indirect' },
  { id: 'R006', q: 'Is there a splash screen for picking a saved profile at startup?', expect: ['AI-FEAT-002'], style: 'partial' },

  // ===== AI-FEAT-003 Dashboard & System Status =====
  { id: 'R007', q: 'What does Dashboard & System Status show?', expect: ['AI-FEAT-003'], style: 'direct' },
  { id: 'R008', q: 'What is the very first screen an operator sees after logging in?', expect: ['AI-FEAT-003'], style: 'indirect' },
  { id: 'R009', q: 'Is there a hero card showing recent import counts?', expect: ['AI-FEAT-003'], style: 'partial' },

  // ===== AI-FEAT-004 event.json Data Model & Persistence Contract =====
  { id: 'R010', q: 'What is the event.json Data Model & Persistence Contract?', expect: ['AI-FEAT-004'], style: 'direct' },
  { id: 'R011', q: 'What single file holds the authoritative structure of an event?', expect: ['AI-FEAT-004'], style: 'indirect' },
  { id: 'R012', q: 'Where does AutoIngest store sub-events and group mappings for an event?', expect: ['AI-FEAT-004'], style: 'paraphrase' },

  // ===== AI-FEAT-005 Application Settings & Configuration Store =====
  { id: 'R013', q: 'What is the Application Settings & Configuration Store?', expect: ['AI-FEAT-005'], style: 'direct' },
  { id: 'R014', q: 'Where does the app keep general preferences that are not tied to any one event?', expect: ['AI-FEAT-005'], style: 'indirect' },

  // ===== AI-FEAT-006 Application Auto-Update =====
  { id: 'R015', q: 'What is Application Auto-Update?', expect: ['AI-FEAT-006'], style: 'direct' },
  { id: 'R016', q: 'Does the app check GitHub for new releases on its own?', expect: ['AI-FEAT-006'], style: 'paraphrase' },
  { id: 'R017', q: 'How soon after launch does the app look for a newer version?', expect: ['AI-FEAT-006'], style: 'indirect' },

  // ===== AI-FEAT-007 Telemetry Pipeline =====
  { id: 'R018', q: 'What is the Telemetry Pipeline?', expect: ['AI-FEAT-007'], style: 'direct' },
  { id: 'R019', q: 'Does AutoIngest record anonymous usage or crash data anywhere?', expect: ['AI-FEAT-007'], style: 'paraphrase' },

  // ===== AI-FEAT-008 Design System & UI Consistency Framework =====
  { id: 'R020', q: 'What is the Design System & UI Consistency Framework?', expect: ['AI-FEAT-008'], style: 'direct' },
  { id: 'R021', q: 'Is there a shared visual style every screen in the app has to follow?', expect: ['AI-FEAT-008'], style: 'indirect' },

  // ===== AI-FEAT-009 Event Creation =====
  { id: 'R022', q: 'What is Event Creation?', expect: ['AI-FEAT-009'], style: 'direct' },
  { id: 'R023', q: 'How do I set up a brand-new shoot in the system?', expect: ['AI-FEAT-009'], style: 'indirect' },
  { id: 'R024', q: 'Is there a wizard for building a Collection and Event structure from scratch?', expect: ['AI-FEAT-009'], style: 'paraphrase' },

  // ===== AI-FEAT-010 Event Management & Editing =====
  { id: 'R025', q: 'What is Event Management & Editing?', expect: ['AI-FEAT-010'], style: 'direct' },
  { id: 'R026', q: 'Can I go back and change the details of an event I already made?', expect: ['AI-FEAT-010'], style: 'indirect' },

  // ===== AI-FEAT-011 Source Detection =====
  { id: 'R027', q: 'What is Source Detection (Drives, DCIM, Sony PRIVATE)?', expect: ['AI-FEAT-011'], style: 'direct' },
  { id: 'R028', q: 'Does the app automatically notice a memory card being plugged in?', expect: ['AI-FEAT-011'], style: 'paraphrase' },
  { id: 'R029', q: 'How does the app recognize a Sony camera card by its folder layout?', expect: ['AI-FEAT-011'], style: 'indirect' },

  // ===== AI-FEAT-012 Source Selection =====
  { id: 'R030', q: 'What is Source Selection (Local Folder / External Drive)?', expect: ['AI-FEAT-012'], style: 'direct' },
  { id: 'R031', q: 'How does an operator pick which drive to import from?', expect: ['AI-FEAT-012'], style: 'indirect' },

  // ===== AI-FEAT-013 File Browser & Media Grid/List Viewing =====
  { id: 'R032', q: 'What is File Browser & Media Grid/List Viewing?', expect: ['AI-FEAT-013'], style: 'direct' },
  { id: 'R033', q: 'Can files be shown as a grid of thumbnails instead of a list before import?', expect: ['AI-FEAT-013'], style: 'paraphrase' },

  // ===== AI-FEAT-014 Thumbnail Generation & Caching =====
  { id: 'R034', q: 'What is Thumbnail Generation & Caching?', expect: ['AI-FEAT-014'], style: 'direct' },
  { id: 'R035', q: 'Are video preview thumbnails cached, or regenerated every time?', expect: ['AI-FEAT-014'], style: 'indirect' },

  // ===== AI-FEAT-015 Media Preview =====
  { id: 'R036', q: 'What is Media Preview?', expect: ['AI-FEAT-015'], style: 'direct' },
  { id: 'R037', q: 'Can I hit the space bar to see a photo full-screen before importing?', expect: ['AI-FEAT-015'], style: 'paraphrase' },

  // ===== AI-FEAT-016 Preview Focus / Selection Separation =====
  { id: 'R038', q: 'What is Preview Focus / Selection Separation?', expect: ['AI-FEAT-016'], style: 'direct' },
  { id: 'R039', q: 'Is the file I am previewing always the same as the files I have selected?', expect: ['AI-FEAT-016'], style: 'indirect' },

  // ===== AI-FEAT-017 Grouping System =====
  { id: 'R040', q: 'What is the Grouping System?', expect: ['AI-FEAT-017'], style: 'direct' },
  { id: 'R041', q: 'How do operators sort files into batches before they get imported?', expect: ['AI-FEAT-017'], style: 'indirect' },
  { id: 'R042', q: 'Is there a way to assign selected photos to a sub-event before running import?', expect: ['AI-FEAT-017'], style: 'paraphrase' },

  // ===== AI-FEAT-018 Event-Component Import Routing =====
  { id: 'R043', q: 'What is Event-Component Import Routing?', expect: ['AI-FEAT-018'], style: 'direct' },
  { id: 'R044', q: 'What actually decides the destination folder path for an imported file?', expect: ['AI-FEAT-018'], style: 'indirect' },

  // ===== AI-FEAT-019 Import Pipeline & Copy Engine =====
  { id: 'R045', q: 'What is the Import Pipeline & Copy Engine?', expect: ['AI-FEAT-019'], style: 'direct' },
  { id: 'R046', q: 'What actually performs the file copy during an import?', expect: ['AI-FEAT-019'], style: 'indirect' },
  { id: 'R047', q: 'Does the copy step ever overwrite an existing file?', expect: ['AI-FEAT-019'], style: 'paraphrase' },

  // ===== AI-FEAT-020 Duplicate Detection =====
  { id: 'R048', q: 'What is Duplicate Detection?', expect: ['AI-FEAT-020'], style: 'direct' },
  { id: 'R049', q: 'What stops the same photo from being copied in twice?', expect: ['AI-FEAT-020'], style: 'indirect' },

  // ===== AI-FEAT-021 Atomic Import Transaction =====
  { id: 'R050', q: 'What is the Atomic Import Transaction?', expect: ['AI-FEAT-021'], style: 'direct' },
  { id: 'R051', q: 'Does event.json ever get left half-updated if an import fails partway through?', expect: ['AI-FEAT-021'], style: 'paraphrase' },

  // ===== AI-FEAT-022 Photographer-Folder Resolution =====
  { id: 'R052', q: 'What is Photographer-Folder Resolution?', expect: ['AI-FEAT-022'], style: 'direct' },
  { id: 'R053', q: 'What decides which photographer subfolder a file ends up in?', expect: ['AI-FEAT-022'], style: 'indirect' },

  // ===== AI-FEAT-023 Quick Import =====
  { id: 'R054', q: 'What is Quick Import?', expect: ['AI-FEAT-023'], style: 'direct' },
  { id: 'R055', q: 'Is there a fast way to copy a handful of files without setting up an event?', expect: ['AI-FEAT-023'], style: 'indirect' },
  { id: 'R056', q: 'Does the fast staging-only import path create an event record?', expect: ['AI-FEAT-023'], style: 'paraphrase' },

  // ===== AI-FEAT-024 Source Cleanup =====
  { id: 'R057', q: 'What is Source Cleanup?', expect: ['AI-FEAT-024'], style: 'direct' },
  { id: 'R058', q: 'When is it actually safe to delete files off the original memory card?', expect: ['AI-FEAT-024'], style: 'indirect' },

  // ===== AI-FEAT-025 Checksum-Based File Verification =====
  { id: 'R059', q: 'What is Checksum-Based File Verification?', expect: ['AI-FEAT-025'], style: 'direct' },
  { id: 'R060', q: 'Is there a hash-based check that a copied file was not corrupted?', expect: ['AI-FEAT-025'], style: 'paraphrase' },

  // ===== AI-FEAT-026 Audit Integrity Verification (Count-Based) =====
  { id: 'R061', q: 'What is Audit Integrity Verification (Count-Based)?', expect: ['AI-FEAT-026'], style: 'direct' },
  { id: 'R062', q: 'Is there a button that compares expected file counts against what is actually on disk?', expect: ['AI-FEAT-026'], style: 'paraphrase' },

  // ===== AI-FEAT-027 Activity Log =====
  { id: 'R063', q: 'What is the Activity Log?', expect: ['AI-FEAT-027'], style: 'direct' },
  { id: 'R064', q: 'Where can I see a history of past imports for an event?', expect: ['AI-FEAT-027'], style: 'indirect' },

  // ===== AI-FEAT-028 Import Source Attribution =====
  { id: 'R065', q: 'What is Import Source Attribution?', expect: ['AI-FEAT-028'], style: 'direct' },
  { id: 'R066', q: 'Does the app remember which memory card a given import came from?', expect: ['AI-FEAT-028'], style: 'paraphrase' },

  // ===== AI-FEAT-029 Metadata Writing Engine =====
  { id: 'R067', q: 'What is the Metadata Writing Engine?', expect: ['AI-FEAT-029'], style: 'direct' },
  { id: 'R068', q: 'What actually writes the metadata tags onto a file?', expect: ['AI-FEAT-029'], style: 'indirect' },

  // ===== AI-FEAT-030 Metadata Durable Queue & Crash Recovery =====
  { id: 'R069', q: 'What is the Metadata Durable Queue & Crash Recovery?', expect: ['AI-FEAT-030'], style: 'direct' },
  { id: 'R070', q: 'If the app is force-quit mid metadata-write, is that work recoverable?', expect: ['AI-FEAT-030'], style: 'paraphrase' },

  // ===== AI-FEAT-031 Metadata Event-State Derivation =====
  { id: 'R071', q: 'What is Metadata Event-State Derivation?', expect: ['AI-FEAT-031'], style: 'direct' },
  { id: 'R072', q: 'Is an event’s metadata status a stored flag, or worked out fresh each time?', expect: ['AI-FEAT-031'], style: 'indirect' },

  // ===== AI-FEAT-032 Metadata Verification =====
  { id: 'R073', q: 'What is Metadata Verification?', expect: ['AI-FEAT-032'], style: 'direct' },
  { id: 'R074', q: 'Is there a check for files that came in through a copy-only path and never got their metadata checked?', expect: ['AI-FEAT-032'], style: 'indirect' },

  // ===== AI-FEAT-033 Metadata Audit & Repair =====
  { id: 'R075', q: 'What is Metadata Audit & Repair?', expect: ['AI-FEAT-033'], style: 'direct' },
  { id: 'R076', q: 'Is there an archive-wide scan that can be paused and resumed to check metadata correctness?', expect: ['AI-FEAT-033'], style: 'paraphrase' },

  // ===== AI-FEAT-034 Metadata Management Modal =====
  { id: 'R077', q: 'What is the Metadata Management Modal?', expect: ['AI-FEAT-034'], style: 'direct' },
  { id: 'R078', q: 'Is there one place that pulls together all the different metadata tools instead of opening several separate windows?', expect: ['AI-FEAT-034'], style: 'indirect' },
  { id: 'R079', q: 'Are the metadata-related screens spread across separate windows, or combined into one?', expect: ['AI-FEAT-034'], style: 'indirect' },

  // ===== AI-FEAT-035 Dashboard Metadata Health =====
  { id: 'R080', q: 'What is Dashboard Metadata Health?', expect: ['AI-FEAT-035'], style: 'direct' },
  { id: 'R081', q: 'Is there a dashboard tile that honestly reflects whether metadata is really complete?', expect: ['AI-FEAT-035'], style: 'paraphrase' },

  // ===== AI-FEAT-036 Keyword Registry =====
  { id: 'R082', q: 'What is the Keyword Registry?', expect: ['AI-FEAT-036'], style: 'direct' },
  { id: 'R083', q: 'Where does the controlled list of approved cities and event types live?', expect: ['AI-FEAT-036'], style: 'indirect' },

  // ===== AI-FEAT-037 Metadata Reapply / Sync =====
  { id: 'R084', q: 'What is Metadata Reapply / Sync?', expect: ['AI-FEAT-037'], style: 'direct' },
  { id: 'R085', q: 'If I fix a typo in the event location after import, does that get pushed onto the already-imported files?', expect: ['AI-FEAT-037'], style: 'indirect' },

  // ===== AI-FEAT-038 Transfer Export =====
  { id: 'R086', q: 'What is Transfer Export?', expect: ['AI-FEAT-038'], style: 'direct' },
  { id: 'R087', q: 'How do I get a copy of an event onto a portable drive to physically move it?', expect: ['AI-FEAT-038'], style: 'indirect' },

  // ===== AI-FEAT-039 Transfer Import =====
  { id: 'R088', q: 'What is Transfer Import?', expect: ['AI-FEAT-039'], style: 'direct' },
  { id: 'R089', q: 'What picks up an exported drive and merges its contents into the main archive?', expect: ['AI-FEAT-039'], style: 'indirect' },
  { id: 'R090', style: 'multi-relevant', q: 'What is the general process for moving an event from one archive location to another using a physical drive?', expect: ['AI-FEAT-038', 'AI-FEAT-039'] },

  // ===== AI-FEAT-040 Backup Update Scanning =====
  { id: 'R091', q: 'What is Backup Update Scanning?', expect: ['AI-FEAT-040'], style: 'direct' },
  { id: 'R092', q: 'Is there a read-only preview of what an update-backup run would copy, before it actually runs?', expect: ['AI-FEAT-040'], style: 'paraphrase' },

  // ===== AI-FEAT-041 Transfer Background/Minimize Operation =====
  { id: 'R093', q: 'What is Transfer Background/Minimize Operation?', expect: ['AI-FEAT-041'], style: 'direct' },
  { id: 'R094', q: 'Can I keep working in the app while an export runs instead of being stuck on a modal?', expect: ['AI-FEAT-041'], style: 'paraphrase' },

  // ===== AI-FEAT-042 Archive Root Configuration & Resolution =====
  { id: 'R095', q: 'What is Archive Root Configuration & Resolution?', expect: ['AI-FEAT-042'], style: 'direct' },
  { id: 'R096', q: 'How does the app decide which of several possible folders is the real archive location?', expect: ['AI-FEAT-042'], style: 'indirect' },

  // ===== AI-FEAT-043 Archive Health Reporting =====
  { id: 'R097', q: 'What is Archive Health Reporting?', expect: ['AI-FEAT-043'], style: 'direct' },
  { id: 'R098', q: 'Is there a running check of overall archive health, not tied to just one event?', expect: ['AI-FEAT-043'], style: 'paraphrase' },

  // ===== AI-FEAT-044 Local-First Background Archive Sync =====
  { id: 'R099', q: 'What is Local-First Background Archive Sync?', expect: ['AI-FEAT-044'], style: 'direct' },
  { id: 'R100', q: 'If I import onto my laptop first, does it quietly push that up to the shared archive later?', expect: ['AI-FEAT-044'], style: 'indirect' },

  // ===== AI-FEAT-045 Archive Lock Handling & Stale-Lock Recovery =====
  { id: 'R101', q: 'What is Archive Lock Handling & Stale-Lock Recovery?', expect: ['AI-FEAT-045'], style: 'direct' },
  { id: 'R102', q: 'What stops two people from writing into the same event folder at once?', expect: ['AI-FEAT-045'], style: 'indirect' },
  { id: 'R103', style: 'multi-relevant', q: 'What happens when an archive write lock goes stale and needs recovering?', expect: ['AI-FEAT-045', 'AI-WF-008'] },

  // ===== AI-FEAT-046 Archive Folder Adoption =====
  { id: 'R104', q: 'What is Archive Folder Adoption?', expect: ['AI-FEAT-046'], style: 'direct' },
  { id: 'R105', q: 'Can I tell the app "this folder is already part of my archive, just start tracking it"?', expect: ['AI-FEAT-046'], style: 'indirect' },

  // ===== AI-FEAT-047 QMZ Sequencing Workspace =====
  { id: 'R106', q: 'What is the QMZ Sequencing Workspace?', expect: ['AI-FEAT-047'], style: 'direct' },
  { id: 'R107', q: 'Is there a separate workspace for numbering Qadam/Majlis/Ziyafat photos after import?', expect: ['AI-FEAT-047'], style: 'paraphrase' },
  { id: 'R108', style: 'multi-relevant', q: 'What lets an archivist assign sequence numbers to already-imported event photos?', expect: ['AI-FEAT-047', 'AI-WF-007'] },

  // ===== AI-FEAT-048 Realtime Team Presence & Online Registry =====
  { id: 'R109', q: 'What is Realtime Team Presence & Online Registry?', expect: ['AI-FEAT-048'], style: 'direct' },
  { id: 'R110', q: 'Can I see which other operators are currently online and working?', expect: ['AI-FEAT-048'], style: 'paraphrase' },

  // ===== AI-FEAT-049 Archive Maintenance =====
  { id: 'R111', q: 'What is Archive Maintenance?', expect: ['AI-FEAT-049'], style: 'direct' },
  { id: 'R112', q: 'Is there a planned way to restructure an existing archive event after the fact?', expect: ['AI-FEAT-049'], style: 'paraphrase' },

  // ===== AI-FEAT-050 Event Maintenance =====
  { id: 'R113', q: 'What is Event Maintenance?', expect: ['AI-FEAT-050'], style: 'direct' },
  { id: 'R114', q: 'Is event-level upkeep planned as its own separate capability?', expect: ['AI-FEAT-050'], style: 'indirect' },

  // ===== AI-FEAT-051 Archive Browser =====
  { id: 'R115', q: 'What is Archive Browser?', expect: ['AI-FEAT-051'], style: 'direct' },
  { id: 'R116', q: 'Will there be a way to browse the whole archive without going through the import workflow?', expect: ['AI-FEAT-051'], style: 'paraphrase' },

  // ===== AI-FEAT-052 Archive Repair =====
  { id: 'R117', q: 'What is Archive Repair?', expect: ['AI-FEAT-052'], style: 'direct' },
  { id: 'R118', q: 'Is there a planned feature that automatically fixes problems the diagnostics layer only reports today?', expect: ['AI-FEAT-052'], style: 'indirect' },

  // ===== AI-FEAT-053 Global Search =====
  { id: 'R119', q: 'What is Global Search?', expect: ['AI-FEAT-053'], style: 'direct' },
  { id: 'R120', q: 'Will operators be able to search across the entire archive, not just the current event?', expect: ['AI-FEAT-053'], style: 'paraphrase' },

  // ===== AI-FEAT-054 Integrity Verification — Archive-Wide =====
  { id: 'R121', q: 'What is Integrity Verification — Archive-Wide?', expect: ['AI-FEAT-054'], style: 'direct' },
  { id: 'R122', q: 'Is there a planned scheduled check of the whole archive’s integrity, not just one event?', expect: ['AI-FEAT-054'], style: 'paraphrase' },

  // ===== AI-FEAT-055 Archive Analytics =====
  { id: 'R123', q: 'What is Archive Analytics?', expect: ['AI-FEAT-055'], style: 'direct' },
  { id: 'R124', q: 'Is there a planned reporting dashboard for archive growth and storage trends?', expect: ['AI-FEAT-055'], style: 'paraphrase' },

  // ===== AI-FEAT-056 AI Archive Intelligence =====
  { id: 'R125', q: 'What is AI Archive Intelligence?', expect: ['AI-FEAT-056'], style: 'direct' },
  { id: 'R126', q: 'Is there a planned AI-assisted capability layered over the archive as the final roadmap milestone?', expect: ['AI-FEAT-056'], style: 'paraphrase' },

  // ===== AI-FEAT-057 Multi-Channel Release & Update System =====
  { id: 'R127', q: 'What is the Multi-Channel Release & Update System?', expect: ['AI-FEAT-057'], style: 'direct' },
  { id: 'R128', q: 'Does the app ship internal engineering builds separately from tester and public releases?', expect: ['AI-FEAT-057'], style: 'paraphrase' },

  // ===== AI-FEAT-058 Knowledge Engine =====
  { id: 'R129', q: 'What is the Knowledge Engine (Stage 1 Prototype)?', expect: ['AI-FEAT-058'], style: 'direct' },
  { id: 'R130', q: 'Is there a prototype that answers product questions using the existing documentation system, without an LLM?', expect: ['AI-FEAT-058'], style: 'paraphrase' },

  // ===== AI-WF-001 Import Photographs From a Memory Card or Folder =====
  { id: 'R131', q: 'What is the workflow for Importing Photographs From a Memory Card or Folder?', expect: ['AI-WF-001'], style: 'direct' },
  { id: 'R132', q: 'Walk me through bringing photos in from a card for the first time.', expect: ['AI-WF-001'], style: 'indirect' },

  // ===== AI-WF-002 Create a New Event =====
  { id: 'R133', q: 'What is the workflow for Creating a New Event?', expect: ['AI-WF-002'], style: 'direct' },
  { id: 'R134', q: 'What are the steps to set up the Collection/Event/Component structure before importing?', expect: ['AI-WF-002'], style: 'paraphrase' },

  // ===== AI-WF-003 Use Quick Import for a Small Batch =====
  { id: 'R135', q: 'What is the workflow for Using Quick Import for a Small Batch?', expect: ['AI-WF-003'], style: 'direct' },
  { id: 'R136', q: 'What are the steps for a simple destination-based copy without an event?', expect: ['AI-WF-003'], style: 'paraphrase' },

  // ===== AI-WF-004 Repair Missing or Incorrect Metadata =====
  { id: 'R137', q: 'What is the workflow for Repairing Missing or Incorrect Metadata?', expect: ['AI-WF-004'], style: 'direct' },
  { id: 'R138', q: 'What are the steps to audit and fix drifted metadata across the archive?', expect: ['AI-WF-004'], style: 'paraphrase' },

  // ===== AI-WF-005 Export or Update a Transfer Drive =====
  { id: 'R139', q: 'What is the workflow for Exporting or Updating a Transfer Drive?', expect: ['AI-WF-005'], style: 'direct' },
  { id: 'R140', q: 'What are the steps to write a mirror of events onto a portable drive?', expect: ['AI-WF-005'], style: 'paraphrase' },

  // ===== AI-WF-006 See Who Else Is Online... =====
  { id: 'R141', q: 'What is the workflow for coordinating with teammates working from separate locations?', expect: ['AI-WF-006'], style: 'paraphrase' },
  { id: 'R142', q: 'How do operators without a shared NAS coordinate shared events?', expect: ['AI-WF-006'], style: 'indirect' },

  // ===== AI-WF-007 Sort QMZ Photographs =====
  { id: 'R143', q: 'What is the workflow for Sorting QMZ Photographs?', expect: ['AI-WF-007'], style: 'direct' },
  { id: 'R144', q: 'What are the steps for numbering Qadam/Majlis/Ziyafat event photos?', expect: ['AI-WF-007'], style: 'paraphrase' },

  // ===== AI-WF-008 Recover From an Archive Lock Error =====
  { id: 'R145', q: 'What is the workflow for Recovering From an Archive Lock Error?', expect: ['AI-WF-008'], style: 'direct' },
  { id: 'R146', q: 'What are the steps when an operator hits a stale photographer-folder lock?', expect: ['AI-WF-008'], style: 'paraphrase' },

  // ===== AI-WF-009 Import or Update From a Transfer Drive =====
  { id: 'R147', q: 'What is the workflow for Importing or Updating From a Transfer Drive?', expect: ['AI-WF-009'], style: 'direct' },
  { id: 'R148', q: 'What are the steps to consolidate a transfer drive’s contents into the main archive?', expect: ['AI-WF-009'], style: 'paraphrase' },

  // ===== Additional partial-name / abbreviation / UI-description queries =====
  { id: 'R149', q: 'source detection', expect: ['AI-FEAT-011'], style: 'partial' },
  { id: 'R150', q: 'grouping', expect: ['AI-FEAT-017'], style: 'partial' },
  { id: 'R151', q: 'checksum verification', expect: ['AI-FEAT-025'], style: 'partial' },
  { id: 'R152', q: 'archive root resolution', expect: ['AI-FEAT-042'], style: 'partial' },
  { id: 'R153', q: 'stale lock recovery', expect: ['AI-FEAT-045'], style: 'partial' },
  { id: 'R154', q: 'QMZ workspace', expect: ['AI-FEAT-047'], style: 'partial' },
  { id: 'R155', q: 'team presence', expect: ['AI-FEAT-048'], style: 'partial' },
  { id: 'R156', q: 'keyword registry', expect: ['AI-FEAT-036'], style: 'partial' },
  { id: 'R157', q: 'metadata reapply', expect: ['AI-FEAT-037'], style: 'partial' },
  { id: 'R158', q: 'transfer export', expect: ['AI-FEAT-038'], style: 'partial' },

  // ===== Recovery / problem-description scenarios =====
  { id: 'R159', q: 'My import stopped halfway through — what happens to the event record?', expect: ['AI-FEAT-021'], style: 'indirect' },
  { id: 'R160', q: 'A drive got unplugged mid-copy — does the app know something went wrong?', expect: ['AI-FEAT-024'], style: 'indirect' },
  { id: 'R161', q: 'The app crashed while writing metadata — is that work lost?', expect: ['AI-FEAT-030'], style: 'indirect' },
  { id: 'R162', q: 'Two operators tried to import into the same folder at once — what happened?', expect: ['AI-FEAT-045'], style: 'indirect' },
  { id: 'R163', q: 'A transfer export got interrupted — can it be resumed?', expect: ['AI-FEAT-038'], style: 'indirect' },
  { id: 'R164', q: 'The main archive server went offline mid-import — what does the app fall back to?', expect: ['AI-FEAT-042'], style: 'indirect' },

  // ===== Operator-vocabulary / capability questions =====
  { id: 'R165', q: 'Can I browse files by grid instead of a list before I import them?', expect: ['AI-FEAT-013'], style: 'paraphrase' },
  { id: 'R166', q: 'Does the app support both light and dark visual themes?', expect: ['AI-FEAT-008'], style: 'indirect' },
  { id: 'R167', q: 'Is there a way to see storage capacity trends over time?', expect: ['AI-FEAT-055'], style: 'paraphrase' },
  { id: 'R168', q: 'Can the app run a repair pass on damaged archive folders automatically?', expect: ['AI-FEAT-052'], style: 'paraphrase' },
  { id: 'R169', q: 'Is there a search bar that looks across every event in the archive?', expect: ['AI-FEAT-053'], style: 'paraphrase' },
  { id: 'R170', q: 'Can operators leave the transfer running and keep working on something else?', expect: ['AI-FEAT-041'], style: 'paraphrase' },

  // ===== Decision-backed concepts (grounded in real DEC-### links) =====
  { id: 'R171', q: 'Why does the app rebuild from source instead of just relabeling a release candidate as stable?', expect: ['AI-FEAT-006'], style: 'indirect' },
  { id: 'R172', q: 'Is there a documented reason the app never overwrites a file during copy?', expect: ['AI-FEAT-019'], style: 'indirect' },
  { id: 'R173', q: 'Why does the copy engine skip a file that already exists instead of replacing it?', expect: ['AI-FEAT-020'], style: 'indirect' },
  { id: 'R174', q: 'Is there a formal reason folder structure and embedded metadata are both kept, not just one?', expect: ['AI-FEAT-004'], style: 'indirect' },
  { id: 'R175', q: 'Why does the archive root system require positive evidence instead of just trusting a reachable folder?', expect: ['AI-FEAT-042'], style: 'indirect' },
  { id: 'R176', q: 'Is there a documented reason a transfer destination can only be claimed by one ingester at a time?', expect: ['AI-FEAT-038'], style: 'indirect' },

  // ===== Import/export/metadata/grouping/archive/maintenance/roadmap concept sweep =====
  { id: 'R177', q: 'What handles moving an event from a local machine up to shared storage automatically?', expect: ['AI-FEAT-044'], style: 'indirect' },
  { id: 'R178', q: 'What tracks who imported which files for later auditing?', expect: ['AI-FEAT-028'], style: 'indirect' },
  { id: 'R179', q: 'What decides whether an event still needs metadata work done?', expect: ['AI-FEAT-031'], style: 'indirect' },
  { id: 'R180', q: 'What is next on the product roadmap after Metadata Audit & Repair?', expect: ['AI-FEAT-049'], style: 'indirect' },
  { id: 'R181', q: 'What is planned right after Archive Repair on the roadmap?', expect: ['AI-FEAT-055'], style: 'indirect' },
  { id: 'R182', q: 'What comes before Global Search in the canonical roadmap order?', expect: ['AI-FEAT-051'], style: 'indirect' },

  // ===== Relationship-flavored retrieval (asking to find the record, not the relation itself) =====
  { id: 'R183', q: 'What feature does the Metadata Writing Engine depend on for crash safety?', expect: ['AI-FEAT-030'], style: 'indirect' },
  { id: 'R184', q: 'What feature actually enforces the no-overwrite guarantee during copying?', expect: ['AI-FEAT-019'], style: 'indirect' },
  { id: 'R185', q: 'What feature does Photographer-Folder Resolution run after in the ingestion pipeline?', expect: ['AI-FEAT-018'], style: 'indirect' },

  // ===== Technical-concept queries (still answerable from canonical corpus text) =====
  { id: 'R186', q: 'What uses updateEventJsonAtomic to persist its writes?', expect: ['AI-FEAT-029'], style: 'indirect' },
  { id: 'R187', q: 'What service exports init/enqueue/flush/isEnabled?', expect: ['AI-FEAT-007'], style: 'indirect' },
  { id: 'R188', q: 'What feature is backed by services/settings.js?', expect: ['AI-FEAT-005'], style: 'indirect' },

  // ===== Harder paraphrases (indirect, deliberately low keyword overlap) =====
  { id: 'R189', q: 'What keeps two archive locations from ending up with conflicting copies of the same event?', expect: ['AI-FEAT-042'], style: 'indirect' },
  { id: 'R190', q: 'What actually stamps a photo with who took it?', expect: ['AI-FEAT-029'], style: 'indirect' },
  { id: 'R191', q: 'What figures out that a location got typed wrong after files already went out the door?', expect: ['AI-FEAT-037'], style: 'indirect' },
  { id: 'R192', q: 'What tells you months later which card a specific photo actually came off of?', expect: ['AI-FEAT-028'], style: 'indirect' },
  { id: 'R193', q: 'What is the lightweight way to grab just a few files without the usual event setup?', expect: ['AI-FEAT-023'], style: 'indirect' },
  { id: 'R194', q: 'What makes sure an operator never sees a half-finished import reported as successful?', expect: ['AI-FEAT-021'], style: 'indirect' },
  { id: 'R195', q: 'What is responsible for making sure a renamed source folder is not mistaken for brand-new content?', expect: ['AI-FEAT-040'], style: 'indirect' },
  { id: 'R196', q: 'What decides whose folder a photo lands in when several photographers are shooting the same event?', expect: ['AI-FEAT-022'], style: 'indirect' },
  { id: 'R197', q: 'What is the running total that shows how healthy the whole archive is, not just one event?', expect: ['AI-FEAT-043'], style: 'indirect' },
  { id: 'R198', q: 'What is the mechanism that lets a manually-created folder become a tracked event without re-copying anything?', expect: ['AI-FEAT-046'], style: 'indirect' },

  // ===== "No relevant record" queries (nothing in the KB should satisfy these) =====
  { id: 'R199', q: 'Can AutoIngest translate photo captions into other languages?', expect: [], style: 'no-answer' },
  { id: 'R200', q: 'Does the app support printing photo albums directly to a local printer?', expect: [], style: 'no-answer' },
  { id: 'R201', q: 'Is there a built-in video editor for trimming clips before import?', expect: [], style: 'no-answer' },
  { id: 'R202', q: 'Can operators send SMS notifications to clients when an event is ready?', expect: [], style: 'no-answer' },
  { id: 'R203', q: 'Does AutoIngest have a mobile app companion for iOS or Android?', expect: [], style: 'no-answer' },
  { id: 'R204', q: 'Can the app automatically generate an invoice for a completed shoot?', expect: [], style: 'no-answer' },
  { id: 'R205', q: 'Is there a built-in facial recognition feature for tagging people in photos?', expect: [], style: 'no-answer' },
  { id: 'R206', q: 'Does AutoIngest support live-streaming an event as it happens?', expect: [], style: 'no-answer' },
  { id: 'R207', q: 'Can I pay for cloud storage upgrades directly inside the app?', expect: [], style: 'no-answer' },
  { id: 'R208', q: 'Is there a built-in calendar for scheduling upcoming shoots?', expect: [], style: 'no-answer' },
  { id: 'R209', q: 'Does the app support importing directly from a drone’s live video feed?', expect: [], style: 'no-answer' },
  { id: 'R210', q: 'Can AutoIngest automatically color-grade RAW photos on import?', expect: [], style: 'no-answer' },
  { id: 'R211', q: 'Is there a client-facing portal where customers can view their own photos?', expect: [], style: 'no-answer' },
  { id: 'R212', q: 'Does AutoIngest integrate with QuickBooks for accounting?', expect: [], style: 'no-answer' },
  { id: 'R213', q: 'Can the app detect blurry photos and flag them automatically for review?', expect: [], style: 'no-answer' },

  // ===== More multi-relevant queries =====
  { id: 'R214', q: 'What handles both checking a memory card for a Sony PRIVATE folder and then activating it as the import source?', expect: ['AI-FEAT-011', 'AI-FEAT-012'], style: 'multi-relevant' },
  { id: 'R215', q: 'What covers both writing metadata and making sure that write survives a crash?', expect: ['AI-FEAT-029', 'AI-FEAT-030'], style: 'multi-relevant' },
  { id: 'R216', q: 'What handles both auditing archive-wide metadata and actually repairing what it finds?', expect: ['AI-FEAT-033'], style: 'multi-relevant' },
  { id: 'R217', q: 'What covers both detecting a stale archive lock and the workflow for clearing it?', expect: ['AI-FEAT-045', 'AI-WF-008'], style: 'multi-relevant' },
  { id: 'R218', q: 'What handles both writing an export to a transfer drive and reading it back into the main archive?', expect: ['AI-FEAT-038', 'AI-FEAT-039'], style: 'multi-relevant' },
  { id: 'R219', q: 'What covers checking archive health across consistency, completeness, diagnostics, and a timeline all at once?', expect: ['AI-FEAT-043'], style: 'multi-relevant' },
  { id: 'R220', q: 'What handles both the dashboard-level metadata indicator and the deeper archive-wide metadata audit?', expect: ['AI-FEAT-035', 'AI-FEAT-033'], style: 'multi-relevant' },

  // ===== Final round: more partial/paraphrase/indirect for even coverage =====
  { id: 'R221', q: 'operator identity', expect: ['AI-FEAT-002'], style: 'partial' },
  { id: 'R222', q: 'atomic transaction', expect: ['AI-FEAT-021'], style: 'partial' },
  { id: 'R223', q: 'thumbnail caching', expect: ['AI-FEAT-014'], style: 'partial' },
  { id: 'R224', q: 'audit integrity', expect: ['AI-FEAT-026'], style: 'partial' },
  { id: 'R225', q: 'dashboard metadata health', expect: ['AI-FEAT-035'], style: 'partial' },
  { id: 'R226', q: 'realtime presence', expect: ['AI-FEAT-048'], style: 'partial' },
  { id: 'R227', q: 'Is there a way to keep local imports isolated until the network share comes back?', expect: ['AI-FEAT-044'], style: 'indirect' },
  { id: 'R228', q: 'What confirms a written tag actually landed correctly by reading the file back?', expect: ['AI-FEAT-029'], style: 'indirect' },
  { id: 'R229', q: 'What generates the color-coded consistency/completeness/diagnostics/timeline reports for an archive?', expect: ['AI-FEAT-043'], style: 'indirect' },
  { id: 'R230', q: 'Is there a controlled vocabulary an operator must draw keywords from, rather than free text?', expect: ['AI-FEAT-036'], style: 'indirect' },
  { id: 'R231', q: 'What decides whether a capability is implemented, planned, or unsupported when an operator asks?', expect: ['AI-FEAT-058'], style: 'indirect' },
  { id: 'R232', q: 'Is there a per-device coordination signal so operators know who else is currently importing?', expect: ['AI-FEAT-048'], style: 'indirect' },
  { id: 'R233', q: 'What handles the case where an archive folder was created outside the app entirely?', expect: ['AI-FEAT-046'], style: 'indirect' },
  { id: 'R234', q: 'Is there a mode that scans a backup destination without actually copying anything yet?', expect: ['AI-FEAT-040'], style: 'indirect' },
  { id: 'R235', q: 'What tracks the difference between which files were selected versus which one is currently focused in preview?', expect: ['AI-FEAT-016'], style: 'indirect' },
  { id: 'R236', q: 'What resolves which archive root should be treated as authoritative when more than one is reachable?', expect: ['AI-FEAT-042'], style: 'indirect' },
  { id: 'R237', q: 'What system formalizes shipping internal builds separately from what testers and the public receive?', expect: ['AI-FEAT-057'], style: 'indirect' },
  { id: 'R238', q: 'What holds the four-storage-root model together — active, local staging, main, and one more?', expect: ['AI-FEAT-042'], style: 'indirect' },
  { id: 'R239', q: 'What lets a photographer number their own shots into batches after the shoot is already imported?', expect: ['AI-FEAT-047'], style: 'indirect' },
  { id: 'R240', q: 'What is the read-only, non-mutating way to check archive-wide health across multiple report types?', expect: ['AI-FEAT-043'], style: 'indirect' },
  { id: 'R241', q: 'What is the persistence layer distinct from event.json that holds cross-event application settings?', expect: ['AI-FEAT-005'], style: 'indirect' },
  { id: 'R242', q: 'What logs a chronological, date-grouped history of everything imported for an event?', expect: ['AI-FEAT-027'], style: 'indirect' },
  { id: 'R243', q: 'What identifies files by their source device, kept independent of who is logged in?', expect: ['AI-FEAT-028'], style: 'indirect' },
  { id: 'R244', q: 'What is the eligibility check for whether a connected device even qualifies as an import source?', expect: ['AI-FEAT-011'], style: 'indirect' },
  { id: 'R245', q: 'What lets an operator activate a specific folder, drive, or card as the current thing being imported?', expect: ['AI-FEAT-012'], style: 'indirect' },
  { id: 'R246', q: 'What computes destination folder paths from event structure without any dynamic logic at import time?', expect: ['AI-FEAT-018'], style: 'indirect' },
  { id: 'R247', q: 'What guarantees the same input always produces the same output when copying files?', expect: ['AI-FEAT-019'], style: 'indirect' },
  { id: 'R248', q: 'What tracks whether a group of selected files has been mapped to a sub-event yet?', expect: ['AI-FEAT-017'], style: 'indirect' },
  { id: 'R249', q: 'What shares getFileHash() across two distinct verification mechanisms scoped differently?', expect: ['AI-FEAT-025'], style: 'indirect' },
  { id: 'R250', q: 'What determines whether a capability the operator is asking about is even real yet?', expect: ['AI-FEAT-058'], style: 'indirect' },
  { id: 'R251', q: 'What is the shared backend contract that Quick Import deliberately does not use?', expect: ['AI-FEAT-023', 'AI-FEAT-009'], style: 'multi-relevant' },
  { id: 'R252', q: 'What surfaces a truthful, derived health indicator instead of a simple binary applied/not-applied flag?', expect: ['AI-FEAT-035'], style: 'indirect' },
];
