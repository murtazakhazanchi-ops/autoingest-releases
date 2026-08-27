'use strict';

// Candidate C Knowledge Model — Source Acquisition & Import records.
// Experimental only. extractionTier is 'forensic-verified' for every record
// here: this checkpoint re-read the actual current source (main/*, renderer/*,
// services/*) and either confirmed or corrected the prior capability-registry
// snapshots (registry_AI-FEAT-011/012/017/019/020/023.json), specifically to
// fill the RECOVERY (interruption/crash/resume) and TECHNICAL (state-storage
// location) gaps those snapshots left open. No claim below is inferred merely
// from the presence of checkpoints/locks/temp files elsewhere in the codebase
// — recovery is left null unless this feature's own code establishes it.

const { STATUS, EXTRACTION_TIERS } = require('../schema');

const RECORDS = [
  // ── AI-FEAT-011 — Source Detection ─────────────────────────────────────────
  {
    id: 'KM-source-detection',
    featureId: 'AI-FEAT-011',
    title: 'Source Detection (Drives, DCIM, Sony PRIVATE)',
    aliases: ['memory card', 'SD card', 'camera card', 'DCIM', 'connected drives', 'source detection', 'drive detection', 'Sony PRIVATE folder'],
    purpose: 'Continuously detects storage devices connected to the computer that are eligible to import from — memory cards (DCIM-bearing) and external drives — so the operator never has to manually refresh a device list.',
    operatorWorkflow: [
      'Connect a memory card or external drive to the computer.',
      'AutoIngest checks all connected drives automatically every 5 seconds in the background — no manual refresh action exists or is needed.',
      'Eligible devices appear automatically under the Memory Card list (DCIM present) or External Drive list (removable/USB volume) in the source panel.',
      'A drive with no DCIM folder and no recognizable removable-drive signal (e.g. a Thunderbolt drive on Windows) will not appear in either list — the operator must use Browse Manually / Select Local Folder instead.',
    ],
    preconditions: [
      'Volume must be mounted and visible to the OS.',
      'A memory card is recognized once AutoIngest finds a DCIM folder at the top level of the card.',
      'External-drive recognition differs by operating system: on macOS, any mounted volume is treated as an external drive; on Windows, only drives AutoIngest can positively identify as removable/external are recognized, which conservatively excludes some drive types such as Thunderbolt drives.',
    ],
    actions: [
      { label: 'Automatic memory-card detection', description: 'Any mounted volume with a DCIM folder at its root is listed as a Memory Card.' },
      { label: 'Automatic external-drive detection', description: 'Any mounted volume passing the platform-specific removable-drive signal check is listed as an External Drive.' },
      { label: 'Browse Manually / Select Local Folder', description: 'Escape hatch for drives that detection conservatively excludes (e.g. Thunderbolt on Windows) — bypasses detection entirely via a native folder picker.' },
    ],
    behavior: 'AutoIngest checks every connected drive on each poll and sorts them into memory cards or external drives in a single pass. Once a device is selected as the source (see Source Selection), AutoIngest separately scans that device\'s full folder structure, up to 12 folder levels deep, skipping hidden/system folders, junk files, and very small files, and keeping only recognized photo/video files. Because this scan walks the entire folder tree rather than looking for a specific camera brand\'s folder layout, it naturally finds media inside Sony\'s PRIVATE folder structure and similar camera-specific layouts too — coverage comes from scanning everything, not from Sony-specific handling.',
    recovery: null,
    relationships: [
      { type: 'precedesInWorkflow', targetId: 'KM-source-selection', note: 'A device must be detected (or manually browsed to) before it can be activated as the import source.' },
      { type: 'distinctFrom', targetId: 'KM-source-selection', note: 'Detection is main-process device polling + filesystem heuristics with no operator action; Selection is the renderer-side act of activating one of the detected (or manually browsed) paths.' },
    ],
    limitations: [
      'Thunderbolt-connected drives on Windows have no recognizable positive external signal under the current classification rules and are excluded from the External Drive list by default; reachable only via Browse Manually.',
      'Files smaller than 50KB (MIN_FILE_BYTES, main/fileBrowser.js:173) are silently excluded from every scan, including the memory-card scan — this affects thumbnail/metadata-stub files, not typical photo/video files.',
      'An earlier, narrower Sony-specific folder scanner exists elsewhere in the codebase but is no longer used anywhere — it has been superseded by the full folder-tree scan described above. Documentation describing that older, narrower mechanism as how Sony camera folders are found is out of date.',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'Polling interval: POLL_INTERVAL_MS = 5000 (main/main.js:69), driven by startDrivePolling() (main/main.js:237-256) calling driveDetector.listAllDrives() (main/driveDetector.js:161-195), itself wrapped in a 4-second timeout (withTimeout(), lines 148-153). No detection state is persisted anywhere — each poll re-derives the full device list from drivelist.list() and fs.promises.stat() checks; there is nothing to "resume" because nothing is cached across polls. Post-selection recursive file scan lives in main/fileBrowser.js scanMediaRecursive() (lines 172-259: SKIP_DIRS, MIN_FILE_BYTES=50KB, BATCH_SIZE=50, MAX_SCAN_DEPTH=12), wired at main/main.js:408-448 (files:get handler; comment at line 413 explicitly states "Replaces getDCIMPath + readDirectory + scanPrivateFolder"). The older Sony-specific scanner (scanPrivateFolder(), main/fileBrowser.js:380-416, checked only two hardcoded Sony subdirectories with a >500KB size floor) has zero call sites anywhere in main/, renderer/, or services/ outside its own definition/export — confirmed dead code, superseded by scanMediaRecursive()\'s unconditional full-tree walk.',
    provenance: [
      { claim: 'drive polling interval and mechanism', source: 'main/main.js:69,237-256', type: 'code', confidence: 'high' },
      { claim: 'DCIM/external-drive classification', source: 'main/driveDetector.js:33-195', type: 'code', confidence: 'high' },
      { claim: 'stateless detection, nothing to resume', source: 'main/driveDetector.js (no persisted state anywhere in module); main/main.js:237-256 (poll() re-derives from scratch every 5s)', type: 'code', confidence: 'high' },
      { claim: 'current recursive-scan mechanism replaces scanPrivateFolder', source: 'main/fileBrowser.js:172-259; main/main.js:408-448 (comment at line 413: "Replaces getDCIMPath + readDirectory + scanPrivateFolder")', type: 'code', confidence: 'high' },
      { claim: 'scanPrivateFolder is unused (dead code)', source: 'grep for "scanPrivateFolder(" across main/, renderer/, services/ — zero call sites outside its own definition (main/fileBrowser.js:380) and module.exports (line 418)', type: 'code', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },

  // ── AI-FEAT-012 — Source Selection ─────────────────────────────────────────
  {
    id: 'KM-source-selection',
    featureId: 'AI-FEAT-012',
    title: 'Source Selection (Local Folder / External Drive)',
    aliases: ['select source', 'choose drive', 'activate source', 'select local folder', 'browse manually', 'continue button'],
    purpose: 'Activates one detected device or manually-chosen folder as the current import source, whether it is a memory card, external drive, or local folder — after this, the workspace shows that source\'s files.',
    operatorWorkflow: [
      'Click a listed Memory Card / External Drive card, or click "Select Local Folder" to open a native OS folder picker.',
      'This click only PREVIEWS the choice: it highlights the card and enables the "Continue →" button, but does not yet open the workspace or scan anything.',
      'Click "Continue" — this is what actually activates the source, opens the workspace, and (for memory cards) triggers the recursive media scan.',
      'For External Drive / Local Folder sources, the workspace opens instantly with a shallow folder-only tree; a full media scan of a specific folder only fires once the operator drills into that folder.',
    ],
    preconditions: [
      'A device must already be detected (AI-FEAT-011) or a folder manually chosen via the native picker.',
      'No source is currently mid-load — selecting a second source while one is already loading is rejected, to avoid a stale concurrent scan race.',
    ],
    actions: [
      { label: 'Select a detected card/drive', description: 'Clicking a card previews it; clicking Continue activates it as the working source.' },
      { label: 'Select Local Folder', description: 'Opens a native folder picker and previews the chosen path — the same preview-then-Continue flow as a detected drive.' },
    ],
    behavior: 'Selection is genuinely a two-step flow, not one combined action. Step 1 (preview): clicking a source-list item or choosing a local folder only highlights that choice and enables the Continue button — it does not reset any in-progress grouping, does not clear caches, and does not open the workspace yet. Step 2 (activate): clicking Continue is what actually commits to that source — it resets any in-progress grouping, clears prior file/view state, and either opens the workspace immediately with a shallow folder tree (external drive or local folder) or scans the full card before opening (memory card). Choosing "Select Local Folder" only performs the Step 1 preview by itself; the operator still has to click Continue to activate it.',
    recovery: null,
    relationships: [
      { type: 'precedesInWorkflow', targetId: 'AI-FEAT-017', note: 'A source must be selected (and, for Event Import, an event chosen) before files can be assigned to groups.' },
      { type: 'distinctFrom', targetId: 'KM-source-detection', note: 'Selection is the renderer-side act of activating a path; Detection is the main-process background polling that makes a path available to select.' },
    ],
    limitations: [
      'If the selected external drive is unmounted while an operation is already running, AutoIngest could otherwise lose track of which source was active mid-operation — the app specifically guards against this by locking in the source path up front before starting, rather than re-checking it partway through.',
      'Only one source can be active at a time; selecting a new one clears the prior selection\'s files, groups, and caches.',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'Two distinct functions write to the single module-level `activeSource` variable (renderer/renderer.js:291): _setActiveSource() (line 1285, preview-only — 4 call sites: 3058 external-drive-picker, 3065 local-folder, 5702 memory-card list click, 5775 external-drive list click) and selectSource() (line 5794, the actual activation entry point, invoked only from the Continue button handlers at lines 1438 and 3192). This corrects the prior registry claim that selectLocalFolder() is "a thin wrapper calling the same _setActiveSource() used by selectSource()" — selectSource() does not call _setActiveSource() at all; it assigns `activeSource` inline (line 5815). The broader architectural point the registry drew from this — that local-folder, external-drive, and memory-card selection share one `activeSource` state shape with no independent backend per type — remains accurate.',
    provenance: [
      { claim: 'two-step preview/activate selection flow', source: 'renderer/renderer.js:1285-1300 (_setActiveSource), renderer/renderer.js:5794-5847 (selectSource), renderer/renderer.js:1430-1444 (Continue button handler)', type: 'code', confidence: 'high' },
      { claim: 'selectLocalFolder calls _setActiveSource, not selectSource', source: 'renderer/renderer.js:3061-3066', type: 'code', confidence: 'high' },
      { claim: 'selectSource assigns activeSource directly, not via _setActiveSource', source: 'renderer/renderer.js:5815; grep for "_setActiveSource(" — 4 call sites, none inside selectSource()', type: 'code', confidence: 'high' },
      { claim: 'Cleanup Root Capture Rule race guard', source: 'docs/system-contracts.md §4 "Cleanup Root Capture Rule"; docs/failure-patterns.md #16', type: 'doc', confidence: 'medium' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },

  // ── AI-FEAT-017 — Grouping System ──────────────────────────────────────────
  {
    id: 'KM-grouping-system',
    featureId: 'AI-FEAT-017',
    title: 'Grouping System',
    aliases: ['groups', 'grouping', 'group panel', 'assign to group', 'sub-event mapping', 'photographer grouping'],
    purpose: 'Lets the operator sort selected files into logical groups (mapped to event sub-events) during live ingestion, so AutoIngest can perform structural bifurcation and photographer-folder placement automatically at import time instead of the operator running a separate copy pass per component.',
    operatorWorkflow: [
      'With a source selected and files visible, create one or more groups.',
      'Assign selected files to a group — a file automatically leaves its previous group if reassigned to another one.',
      'Map each group to a sub-event and, optionally, metadata tags.',
      'AutoIngest blocks import if any group lacks a sub-event mapping, or if two groups map to the same sub-event.',
      'Start Import — grouping data is read once at that point to build the per-file destination jobs; after that, grouping\'s job is done for that batch.',
    ],
    preconditions: ['A source must be selected and files loaded.', 'Every group must have a non-null subEventId before import is allowed.'],
    actions: [
      { label: 'Create group', description: 'Adds a new empty group, auto-numbered G1, G2, ... and made the active tab.' },
      { label: 'Assign / unassign files', description: 'Moves files into exactly one group at a time; a group that becomes empty is automatically removed and remaining groups renumber sequentially.' },
      { label: 'Map group to sub-event', description: 'Assigns a sub-event to a group — required before import can start.' },
      { label: 'Tag group with metadata', description: 'Optionally attaches metadata tags to a group; those tags are applied to the group\'s files after import.' },
    ],
    behavior: 'Grouping is held entirely in memory in the renderer while the operator works — the list of groups, which files belong to each, and their sub-event/metadata-tag assignments. Every change (creating a group, assigning or unassigning files) happens instantly with no background saving or network activity. Each group gets its own color, assigned by its position in the list, so colors stay stable even after a group is deleted. There is currently no keyboard-shortcut way to assign files to a group — only click/selection based assignment exists.',
    recovery: 'Grouping work is never saved anywhere while it is in progress — not to disk, not to any settings file, not into the event record — the event record is only written once, at the very end of a successful import. If the app crashes, is force-quit, the window reloads, or the operator changes source/event before starting Import, every group, sub-event mapping, and metadata tag assigned so far is lost with no way to recover it — the operator has to redo the grouping from scratch on the same (or a freshly re-scanned) set of files. This is a deliberate design choice, not an oversight: grouping is treated as disposable, in-progress work that only becomes permanent once Import actually runs.',
    relationships: [
      { type: 'precedesInWorkflow', targetId: 'AI-FEAT-019', note: 'Group/sub-event assignments are read once when Import starts to build the per-file destination job list; Grouping itself does no copying.' },
      { type: 'distinctFrom', targetId: 'AI-FEAT-019', note: 'Grouping is a renderer-only, in-memory sorting/mapping UI layer; the Import Pipeline is the main-process copy engine consuming its output.' },
    ],
    limitations: [
      'No persistence of any kind — an interruption before Import starts discards all grouping work with no recovery path.',
      'A dedicated keyboard-shortcut group-assignment mechanism does not currently exist in the codebase, despite being referenced as a possibility in project history; not scoped in any roadmap milestone.',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'All grouping state lives in renderer/groupManager.js module-level closure variables (_groups, _fileGroupMap, _activeTabId) — there is no persisted state file, database row, or event.json field for in-progress grouping; GroupManager.reset() (lines 166-168) is the only "clear" operation and simply reassigns those three variables to empty values. Grouping data first touches disk only inside the import-commit path (AI-FEAT-019), when groups[] is read to build fileJobs and, if present, metadataTags is written into event.json\'s metadataGroups field.',
    provenance: [
      { claim: 'in-memory-only state, no persistence, lost on interruption/reset', source: 'renderer/groupManager.js:13-194 (no fs/localStorage/IPC calls anywhere in the module)', type: 'code', confidence: 'high' },
      { claim: 'reset() call sites confirm disposable-per-session treatment', source: 'grep "GroupManager.reset(" renderer/renderer.js — 8 call sites (lines 1231, 1240, 1264, 3158, 5824, 5951, 11110, 11132)', type: 'code', confidence: 'high' },
      { claim: 'one-file-one-group structural exclusivity via _fileGroupMap', source: 'renderer/groupManager.js:65-103 (assignFiles/unassignFiles)', type: 'code', confidence: 'high' },
      { claim: 'no keyboard-shortcut group-assignment mechanism found', source: 'grep across renderer/renderer.js for a numeric-key group-assignment handler — none found', type: 'code', confidence: 'medium' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },

  // ── AI-FEAT-019 — Import Pipeline & Copy Engine ────────────────────────────
  {
    id: 'KM-import-pipeline',
    featureId: 'AI-FEAT-019',
    title: 'Import Pipeline & Copy Engine',
    aliases: ['import', 'copy files', 'start import', 'event import', 'archive import', 'copy engine'],
    purpose: 'Copies grouped files from the selected source into the archive structure, with no file ever overwritten, and reports live progress with speed/ETA.',
    operatorWorkflow: [
      'With groups mapped to sub-events (AI-FEAT-017), click Start Import.',
      'AutoIngest marks the event as "in-progress" and begins copying, showing a live per-file progress bar with ETA and transfer speed.',
      'If an error interrupts the copy (source disconnected, archive lock lost, operator abort), the event is rolled back to "created" — never left claiming "complete" with partial data — and the operator is told how many files copied and to retry.',
      'On retry, the operator re-triggers the same import; files already fully copied are detected and skipped automatically, so retrying is safe and does not duplicate work.',
    ],
    preconditions: ['Every group has a sub-event mapping.', 'Destination archive path is reachable and writable.'],
    actions: [
      { label: 'Start Import', description: 'Commits the current groups/files to the archive via commitImportTransaction (event-based) or importFiles (Quick Import, see AI-FEAT-023).' },
      { label: 'Pause / Resume copy', description: 'setPaused(true/false) — event-driven wait via a promise queue (fileManager.js:32-48); pauses/resumes the in-flight copy, does not affect already-queued file order.' },
      { label: 'Abort copy', description: 'Stops the import; files already in flight are allowed to finish, and files that hadn\'t started yet are simply dropped rather than counted as errors.' },
    ],
    behavior: 'AutoIngest copies files using a small number of parallel transfers at once, chosen automatically based on file size and destination type (an SSD gets more parallel transfers than a spinning HDD), and can step up to more parallelism partway through if the destination is proving fast. Before writing any file, it checks whether a file with the same name and size already exists at the destination — if so, it\'s skipped as already-copied; if a same-named file exists with a different size, the new one is saved under a numbered name instead of overwriting it. Every file is also verified by size immediately after copying. If an individual file fails, the rest of the import keeps going; the final summary reports how many files copied, were skipped, or errored.',
    recovery: 'Import is designed so an interrupted attempt can always be safely retried, in three ways. First, at the file level: retrying the same import does not re-copy or overwrite files that already finished — only files that are missing or incomplete are copied again. Second, for a full Event Import: if the copy is interrupted (source disconnected, connection to the archive lost, or the operator cancels), the event is explicitly told it is not "complete" — it is rolled back to its pre-import state and the operator is shown how many files copied before the interruption, with instructions to retry (already-copied files will be skipped automatically on that retry). Third, if the app itself is force-quit or crashes outright mid-copy, so neither of the above safeguards gets a chance to run, AutoIngest checks for any event left in an inconsistent "still importing" state the next time it starts up and automatically resets it back to a normal, retryable state — so the operator never finds a permanently stuck event. In every case, the operator has to manually start the import again — there is no automatic resume — but doing so is always safe and never duplicates or overwrites already-copied files.',
    relationships: [
      { type: 'uses', targetId: 'KM-duplicate-detection', note: 'resolveDestPath() IS the duplicate-detection/no-overwrite logic; not a separate call.' },
      { type: 'precedesInWorkflow', targetId: 'AI-FEAT-026', note: 'The per-file size check here (verifyFile) is automatic and always-on; it is distinct from AI-FEAT-026\'s separate, manually-triggered count-based integrity audit.' },
      { type: 'distinctFrom', targetId: 'KM-quick-import', note: 'Quick Import uses the flat-destination copyFiles() path and never touches event.json/commitImportTransaction; full Event Import uses copyFileJobs() + commitImportTransaction with its status-rollback and crash-recovery guarantees.' },
    ],
    limitations: [
      'No auto-resume: an interrupted import is not automatically retried by AutoIngest — the operator must manually re-trigger it (the retry is merely made safe/non-duplicating by resolveDestPath).',
      'The crash-recovery in-progress→created reset (main.js:1811-1823) only runs the next time events are scanned (e.g. on next app launch) — it is not an active watchdog during the session.',
      'ENABLE_CHECKSUM is hardcoded false (fileManager.js:27) — only a file-size check runs on every copy; SHA-256 verification is not part of this automatic path (see AI-FEAT-025 for manual SHA-256 verification).',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'Interruption/resume state is carried entirely by two things, neither a dedicated checkpoint file: (a) event.json\'s own `status` field (values observed in source: "created" → "in-progress" → "complete", or rolled back to "created" on any failure) at <eventFolder>/event.json, read/written exclusively through updateEventJsonAtomic() to avoid concurrent-writer races; and (b) the destination folder\'s own current contents, re-derived fresh on every retry via buildDestIndex() (fileManager.js:91-109, one fsp.readdir + per-entry fsp.stat pass) and resolveDestPath() (fileManager.js:157-190, per-file fsp.stat). There is no separate transaction log, job queue file, or database recording which individual files were copied — "what\'s already done" is always re-derived by looking at the destination folder\'s actual contents at retry time, not read from a persisted progress record.',
    provenance: [
      { claim: 'copy engine core functions and no-overwrite contract', source: 'main/fileManager.js:1-190 (resolveDestPath), 207-434 (copyFiles), 459-664 (copyFileJobs)', type: 'code', confidence: 'high' },
      { claim: 'recovery: resolveDestPath/buildDestIndex skip already-copied files on retry', source: 'main/fileManager.js:91-109 (buildDestIndex comment), 157-190 (resolveDestPath), 309-318 (copyFiles resume fast-path)', type: 'code', confidence: 'high' },
      { claim: 'recovery: explicit retry-after-abort messaging, no partial "complete" commit', source: 'main/main.js:1150-1175 (heartbeat-abort and wasAborted rollback blocks with operator-facing retry message)', type: 'code', confidence: 'high' },
      { claim: 'recovery: restoreCreatedStatus rollback on any commit failure', source: 'main/main.js:1041-1058 (restoreCreatedStatus), 1377-1384 (catch block invoking it)', type: 'code', confidence: 'high' },
      { claim: 'recovery: startup crash-recovery resets stuck in-progress status', source: 'main/main.js:1811-1823 (_scanEventsCore, comment: "Patch 3: crash recovery — reset stuck in-progress status on next startup")', type: 'code', confidence: 'high' },
      { claim: 'event.json status set to in-progress before copy starts', source: 'renderer/renderer.js:10365', type: 'code', confidence: 'high' },
      { claim: 'ENABLE_CHECKSUM disabled by default, size-only verification', source: 'main/fileManager.js:27, 130-144 (verifyFile)', type: 'code', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },

  // ── AI-FEAT-020 — Duplicate Detection ──────────────────────────────────────
  {
    id: 'KM-duplicate-detection',
    featureId: 'AI-FEAT-020',
    title: 'Duplicate Detection',
    aliases: ['duplicate files', 'skip duplicates', 'already imported', 'duplicate warning'],
    purpose: 'Prevents the same file from being imported (and any destination file from being overwritten) twice, and — for Quick Import specifically — warns the operator up front when files they are about to import already exist at the destination.',
    operatorWorkflow: [
      'This is largely automatic and invisible during full Event Import: every file copy is checked against the destination before it happens, with no operator prompt.',
      'During Quick Import specifically, before the copy starts AutoIngest additionally compares the selected files against a pre-loaded cache of the destination folder\'s contents; if any match by filename+size, a modal lists up to 5 of them and offers Skip duplicates / Import All Anyway / Cancel.',
      'Whichever choice is made, the backend copy engine still applies its own no-overwrite rule underneath — choosing "Import All Anyway" does not force an overwrite of an identical file, it only bypasses the warning.',
    ],
    preconditions: ['A destination path must be set.', 'For the Quick-Import pre-check specifically: AutoIngest must have already scanned the destination folder\'s current contents for that destination.'],
    actions: [
      { label: 'Automatic skip/rename (all import paths)', description: 'A file matching an existing file\'s name and size at the destination is skipped as already imported; a same-named file with a different size is saved under a numbered name instead of being overwritten.' },
      { label: 'Pre-import duplicate warning (Quick Import only)', description: 'Skip duplicates / Import All Anyway / Cancel, shown before any copying starts.' },
    ],
    behavior: 'Two layers exist, and only one of them is present in the prior registry snapshot. Layer 1 (automatic, applies to every import path): built directly into the copy engine\'s destination check — a mechanical name-and-size comparison against the destination folder, applied per file, with no operator visibility. Layer 2 (a pre-check shown to the operator, Quick Import only): before copying starts, AutoIngest compares each selected file\'s name and size against an already-scanned snapshot of the destination folder\'s contents; if any match, an interactive warning is shown. This second layer only appears during Quick Import — the full grouped Event Import path has no equivalent advance-warning step and relies solely on Layer 1\'s silent automatic handling at copy time.',
    recovery: null,
    relationships: [
      { type: 'uses', targetId: 'KM-import-pipeline', note: 'Layer 1 (the actual no-overwrite guarantee) is resolveDestPath(), which lives inside and is exercised by the Import Pipeline\'s copy functions.' },
      { type: 'distinctFrom', targetId: 'KM-import-pipeline', note: 'Layer 2 (the Quick-Import-only pre-import warning modal) is a separate renderer-side code path and state (destFileCache) not shared with the backend copy engine or with full Event Import.' },
    ],
    limitations: [
      'The pre-import warning modal (Layer 2) exists only for Quick Import; full Event Import gives the operator no advance notice of duplicates before the copy runs — they only appear afterward as "skipped" entries in the progress summary.',
      'Duplicate matching is filename+size only in both layers — a renamed file with identical bytes, or a same-named file with different (but overlapping) content that happens to match size, are the two edge cases this comparison cannot distinguish; no content hash is compared unless ENABLE_CHECKSUM is manually enabled (it is false by default, see AI-FEAT-019).',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'Layer 1 state: none persisted — resolveDestPath() (main/fileManager.js:157-190) issues a live fsp.stat() per candidate filename at call time. Layer 2 state: renderer/renderer.js module-level `destFileCache` (Map<"filename_size", true>, declared line 377), rebuilt by refreshDestCache() (lines 1107-1126) any time the destination changes; consumed only by detectDuplicates() (lines 7838-7851), whose only call site is the Quick Import handler (line 10469).',
    provenance: [
      { claim: 'Layer 1: automatic skip/rename inside resolveDestPath, no independent state', source: 'main/fileManager.js:157-190', type: 'code', confidence: 'high' },
      { claim: 'Layer 2: Quick-Import-only pre-check with its own state and UI', source: 'renderer/renderer.js:377 (destFileCache decl), 1107-1126 (refreshDestCache), 7838-7879 (detectDuplicates/showDupWarning), 10469-10474 (sole call site, inside Quick Import handler)', type: 'code', confidence: 'high' },
      { claim: 'grep confirms Layer 2 not called from full Event Import path', source: 'grep "detectDuplicates(\\|showDupWarning(" renderer/renderer.js — only 1 call site each, both inside the Quick Import block starting at line 10460', type: 'code', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },

  // ── AI-FEAT-023 — Quick Import ─────────────────────────────────────────────
  {
    id: 'KM-quick-import',
    featureId: 'AI-FEAT-023',
    title: 'Quick Import',
    aliases: ['quick import', 'staging import', 'fast import', 'non-archival import'],
    purpose: 'A fast, staging-only, non-archival import path for circumstances where full Event Import is not appropriate at that moment (wrong event active, no time to sort, a queue of photographers waiting) — reduces data-loss risk from delay, at the cost of no event.json / no metadata-audit coverage.',
    operatorWorkflow: [
      'With files selected and a Quick Import destination folder chosen (or previously remembered), click the Quick Import action.',
      'If any selected file appears to already exist at the destination (filename+size match), a duplicate warning modal appears first (AI-FEAT-020 Layer 2) — Skip / Import All / Cancel.',
      'Enter/confirm a photographer name in the confirmation modal — files land in <destination>/<photographer>/.',
      'Files copy with the same live progress UI as full Event Import; no event.json is created, so this batch will never appear in Metadata Audit (AI-FEAT-033) or event-based Metadata Repair.',
    ],
    preconditions: ['At least one file selected.', 'A Quick Import destination is set (remembered across sessions via localStorage, or falls back to the current session archive root).'],
    actions: [
      { label: 'Set Quick Import destination', description: 'Persisted to localStorage under key "quickImportDest" so it survives app restarts (renderer/renderer.js:294, 3177-3179).' },
      { label: 'Run Quick Import', description: 'Copies the selected files straight into a folder named for the photographer inside the chosen destination, using the same flat-destination copy path any non-archival copy uses.' },
    ],
    behavior: 'Quick Import creates no event record for the archive — it is intentionally a staging-only drop that Metadata Audit and other event-based features never see (see Limitations). It uses the same underlying flat-destination copy function as any simple file copy, not the full Event Import path with its event-record bookkeeping. This means Quick Import automatically gets the same skip-already-copied behavior on retry that full Import gets, but does not get full Import\'s event-status rollback or crash-recovery safeguards, because there is no event record for those to apply to.',
    recovery: 'Because Quick Import creates no event record and has no transaction wrapper around it, there is nothing to roll back if it fails partway through — any files that already copied when an error occurs (source disconnected, unexpected error) simply remain on disk where they landed; AutoIngest surfaces an error message but does not clean up partial copies, by design, since Quick Import is meant to be a fast staging drop. The operator can safely re-run Quick Import to the same destination: because it reuses the same copy function full Import uses for its own resume behavior, already-copied files (matching name and size) are automatically skipped on retry rather than duplicated. No source establishes any more automated recovery behavior for Quick Import beyond this skip-already-copied-on-retry mechanism — it does not auto-resume on its own.',
    relationships: [
      { type: 'distinctFrom', targetId: 'KM-import-pipeline', note: 'Quick Import must never be documented as equivalent to full Event Import — it is a deliberate staging path using copyFiles() + files:import, not copyFileJobs()/commitImportTransaction, and creates no event.json.' },
      { type: 'uses', targetId: 'KM-duplicate-detection', note: 'Uses both duplicate-detection layers: the Quick-Import-only pre-check warning modal, and the underlying resolveDestPath() no-overwrite guarantee inside copyFiles().' },
    ],
    limitations: [
      'Files imported via Quick Import are permanently outside Metadata Audit (AI-FEAT-033) coverage — the audit scanner\'s traversal is gated on event.json presence at every level, and Quick Import never creates one.',
      'No automatic cleanup of partially-copied files on error — whatever copied before the failure stays where it landed.',
      'No event-based Metadata Repair eligibility for Quick-Imported files, for the same event.json-absence reason.',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'Destination persistence: localStorage key "quickImportDest" (renderer/renderer.js:294 read at load, 3177-3179 written on change) — this is the only piece of Quick Import state that survives an app restart; everything else (selected files, in-flight copy progress) is transient. Copy call path: renderer window.api.importFiles() → ipcRenderer.invoke("files:import") (main/preload.js:95-96) → main-process handler → fileManager.copyFiles() (main/fileManager.js:207-434), the flat-destination function with the buildDestIndex resume fast-path — confirmed distinct from the fileJobs/commitImportTransaction path used by full Event Import.',
    provenance: [
      { claim: 'Quick Import uses copyFiles()/files:import, not copyFileJobs()/commitImportTransaction', source: 'renderer/renderer.js:10499-10501 (window.api.importFiles call); main/preload.js:95-96 (files:import IPC mapping); main/fileManager.js:207-434 (copyFiles)', type: 'code', confidence: 'high' },
      { claim: 'quickImportDest persisted in localStorage, survives restart', source: 'renderer/renderer.js:294, 3177-3179', type: 'code', confidence: 'high' },
      { claim: 'recovery: no cleanup on error, safe retry via copyFiles resume fast-path', source: 'renderer/renderer.js:10506-10512 (error handler, no file cleanup); main/fileManager.js:91-109,157-190 (buildDestIndex/resolveDestPath resume mechanism reused from AI-FEAT-019)', type: 'code', confidence: 'high' },
      { claim: 'staging-only, no event.json, metadata-blind', source: 'docs/metadata-system.md § Non-Goals; renderer/renderer.js:10460-10484 (no event.json write anywhere in the Quick Import branch)', type: 'doc', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },
];

module.exports = { RECORDS };
