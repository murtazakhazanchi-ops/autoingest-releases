'use strict';

// Candidate C Knowledge Model — Special Workflows & Application Platform
// records. Experimental only. Forensically re-read (this checkpoint) from
// main/qmzService.js, renderer/renderer.js's `_qmz*` section, main/main.js's
// IPC surface, test/qmzLiveE2E.test.js, services/telemetry.js,
// services/crashReporter.js, services/performanceMonitor.js,
// main/userManager.js, renderer/splash.js, plus the canonical
// docs/product/features/AI-FEAT-###_*.md, docs/product/decisions/DEC-011,
// and docs/product/02_MASTER_ROADMAP.md AI-RM-002 for the four features:
// AI-FEAT-047 (QMZ), AI-FEAT-007 (Telemetry), AI-FEAT-002 (Login), and
// AI-FEAT-049 (Archive Maintenance, Planned).

const { STATUS, EXTRACTION_TIERS } = require('../schema');

const RECORDS = [
  // ── AI-FEAT-047 — QMZ Sequencing Workspace ────────────────────────────────
  {
    id: 'KM-qmz-sequencing',
    featureId: 'AI-FEAT-047',
    title: 'QMZ Sequencing Workspace',
    aliases: ['QMZ', 'Qadam Majlis Ziyafat', 'QMZ Sequence Manager', 'sort QMZ photos', 'QMZ workspace'],
    purpose: 'A standalone, post-import sequencing workspace an archivist uses to classify a photographer\'s already-ingested QMZ (Qadam/Majlis/Ziyafat) material into numbered real-world-occurrence sequences (e.g. 01Q, 02M), replacing what used to be manual folder creation and file-by-file sorting in Finder/Adobe Bridge.',
    operatorWorkflow: [
      'Open the QMZ Sequence Manager, either via the post-import "Sort QMZ Photos" button or the Event List entry point — both open the same workspace for that event.',
      'On open, any loose, pre-existing photographer folders are automatically adopted into a reserved "Unsequenced" bucket for that photographer.',
      'Select a photographer row in the left panel to view their files (defaults to the Unsequenced location).',
      'Select files in the center grid (checkbox tiles or list rows, with shift-range select).',
      'Create a sequence (e.g. number 1, letter Q) or type an existing sequence number into the assign input and press Enter — this moves the selected files (and any matching sidecar file) into that sequence\'s folder for that photographer, and automatically queues them for metadata writing.',
      'An empty sequence (no real files in any photographer subfolder) can have its type edited or be removed; a non-empty sequence blocks both operations with an explicit message.',
    ],
    preconditions: ['The event/component being sorted must already be imported, with a known location on disk to open the workspace against.'],
    actions: [
      { label: 'Create sequence', description: 'Creates one new sequence folder from a two-digit number and a Q/M/Z type letter (e.g. 01Q); several sequences can also be created at once.' },
      { label: 'Assign files to a sequence', description: 'Moves the selected files (plus any matching sidecar file) into the chosen sequence\'s folder for that photographer, and automatically queues them for metadata writing.' },
      { label: 'Return files to Unsequenced', description: 'The reverse/manual path back into the Unsequenced bucket for that photographer.' },
      { label: 'Edit or remove a sequence', description: 'Changes a sequence\'s type or removes it entirely — MVP scope: only permitted when AutoIngest can verify the sequence contains no files.' },
    ],
    behavior: 'QMZ reads each media file\'s original embedded capture date (from the photo or RAW file\'s own metadata) rather than the file\'s copy date on disk, because copying files during import does not reliably preserve the original date across drives (e.g. SD card to archive); the file\'s copy date on disk is used only as a last-resort fallback when no embedded date can be read. Sequence codes follow a fixed two-digit-number-plus-letter format (e.g. "01Q") with a maximum of 50 Qadam, 51 Majlis, and 52 Ziyafat sequences per event, and are a folder-naming convention only — verified live through the real UI that the sequence code is never written into the file\'s keyword metadata. QMZ keeps its own independent workspace state (grid sort order, view mode, selection, keyboard focus, thumbnail loading) completely separate from standard Import\'s equivalent state, so switching between the two workspaces never carries settings over from one to the other.',
    recovery: 'Moving files never overwrites existing content: if a file with the same name and size already exists at the destination, the move is treated as already done and skipped; if a same-named file with a different size exists there, the incoming file is renamed with a _1, _2, etc. suffix instead of overwriting anything. Removing a sequence only clears it from AutoIngest\'s saved state after confirming its folder is actually gone from disk, so the two never fall out of sync — if cleanup is interrupted partway through, both the leftover folder and its state entry are left in place rather than silently losing track of content.',
    relationships: [
      { type: 'distinctFrom', targetId: null, note: 'Distinct from standard Event Import: QMZ has its own root (qmzRoot), durable state file, renderer namespace, and IPC surface — not a reuse of Import\'s equivalents. See DEC-011.' },
      { type: 'distinctFrom', targetId: 'AI-FEAT-046', note: 'QMZ\'s _Unsequenced/<photographerName>/ adoption is folder-content adoption into QMZ\'s own bucket — unrelated to AI-FEAT-046\'s archive-wide Folder Adoption, which registers whole archive folders as AutoIngest events via event.json.' },
      { type: 'distinctFrom', targetId: 'AI-FEAT-016', note: 'QMZ\'s arrow-key grid navigation/preview-focus system is its own implementation, explicitly separated from Import\'s equivalent (AI-FEAT-016).' },
      { type: 'uses', targetId: 'AI-FEAT-029', note: 'File moves auto-queue into the shared metadata write engine/resolver (qmz:queueMetadata → applyBatch) rather than writing metadata independently.' },
    ],
    limitations: [
      'MVP scope: only an empty sequence (no real files in any photographer subfolder) may be edited or removed — no batch re-tagging or renumbering of a populated sequence.',
      'AutoIngest cannot yet read an embedded capture date from video files, so QMZ falls back to the file\'s copy date on disk for video.',
      'The product owner explicitly described this as an evolving, first-generation workflow, not a finished design (docs/product/features/AI-FEAT-047, 2026-08-14 capture).',
      'Only the primary flow (assign → auto-queue metadata) has been driven live through the real UI end to end; less common paths through the Sequence Manager have not each been individually live-verified (docs/metadata-system.md § Non-Goals).',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'Sequencing state is persisted as JSON at <qmzRoot>/qmz-sequences.json (STATE_FILE constant, main/qmzService.js:9), written via a tmp-file-then-rename atomic pattern in saveState() (main/qmzService.js:254-265) and read via readState() (main/qmzService.js:245-252), which returns a default { version: 1, qmzRoot, sequences: [] } shape if the file does not yet exist. The file records each sequence\'s { code, number, letter, type } — it does not itself store which files are in a sequence; that is derived by scanning the qmzRoot folder structure on demand (scanRoot(), main/qmzService.js:276-305). Codes are the folder names directly: <2-digit number padded><Q|M|Z> (formatCode(), main/qmzService.js:118-120), e.g. "01Q" = Qadam sequence 1. LETTER_TYPE = { Q: "Qadam", M: "Majlis", Z: "Ziyafat" } and LETTER_MAX = { Q: 50, M: 51, Z: 52 } (main/qmzService.js:12-13). The IPC surface is qmz:scanRoot / qmz:initRoot / qmz:createSequence / qmz:bulkCreate / qmz:editSequence / qmz:removeSequence / qmz:moveToSequence / qmz:moveToUnsequenced / qmz:queueMetadata, registered in main/main.js:5500-5544 and exposed via main/preload.js:388-398. Capture-date reads use the exifr library for photos and ExifTool for RAW files, reusing AI-FEAT-029\'s singleton process pool rather than spawning a process per file (main/qmzService.js:19-49, :88-97); this preference over filesystem mtime exists because fs.copyFile() during import does not reliably preserve source mtime across a cross-volume copy (e.g. SD card → archive). Sequence codes must match /^\\d{2}[QMZ]$/ (SEQ_RE, main/qmzService.js:11) before being accepted. QMZ\'s renderer state is fully namespaced under a `_qmz*` prefix (grid sort, view mode, selection, arrow-key focus, thumbnail queue), explicitly documented in code comments as never touching standard Import\'s `sortKey`/`viewMode` state (renderer/renderer.js:343-363). The no-overwrite move safety and state/filesystem consistency check on removal are implemented in safeMoveFile() (main/qmzService.js:148-163) and removeSequence() (main/qmzService.js:426-460).',
    provenance: [
      { claim: 'sequencing-state storage location and format', source: 'main/qmzService.js:9 (STATE_FILE), :245-265 (readState/saveState)', type: 'code', confidence: 'high' },
      { claim: 'sequence code format and letter/max tables', source: 'main/qmzService.js:11-13 (SEQ_RE, LETTER_TYPE, LETTER_MAX), :118-127 (formatCode/parseCode)', type: 'code', confidence: 'high' },
      { claim: 'QMZ IPC surface', source: 'main/main.js:5500-5544; main/preload.js:388-398', type: 'code', confidence: 'high' },
      { claim: 'capture-date preference over filesystem mtime', source: 'main/qmzService.js:19-49 (comment block), :88-97 (readCaptureDate)', type: 'code', confidence: 'high' },
      { claim: 'sequence code never written as a keyword', source: 'test/qmzLiveE2E.test.js:237 (real ExifTool read-back assertion)', type: 'test', confidence: 'high' },
      { claim: 'renderer state fully namespaced under _qmz* and never touches Import\'s sortKey/viewMode', source: 'renderer/renderer.js:343-363 (_qmz*-prefixed module state); docs/product/decisions/DEC-011_QMZ_DEDICATED_DOMAIN_WORKFLOW.md', type: 'code', confidence: 'high' },
      { claim: 'recovery: no-overwrite move safety and state/filesystem sync on removal', source: 'main/qmzService.js:148-163 (safeMoveFile), :426-460 (removeSequence)', type: 'code', confidence: 'high' },
      { claim: 'operator workflow — open, adopt unsequenced, select, assign', source: 'test/qmzLiveE2E.test.js:94-200 (real UI-driven E2E flow)', type: 'test', confidence: 'high' },
      { claim: 'why QMZ is architecturally distinct from Event Import', source: 'docs/product/decisions/DEC-011_QMZ_DEDICATED_DOMAIN_WORKFLOW.md § Decision', type: 'doc', confidence: 'high' },
      { claim: 'domain-specific rationale (10-50+ occurrences per event, fatigue-driven error reduction)', source: 'docs/product/features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md § Summary (product-owner history, captured 2026-08-14)', type: 'doc', confidence: 'medium' },
      { claim: 'MVP edit/remove-only-when-empty scope', source: 'main/qmzService.js:386-389 (comment), :391-424, :426-460', type: 'code', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },
  // ── AI-FEAT-047 — QMZ troubleshooting: sort order vs. sequence numbers ───
  {
    id: 'KM-qmz-sort-vs-sequence-numbers',
    featureId: 'AI-FEAT-047',
    // Follow-up checkpoint fix (multi-record dimension relevance): this is a
    // companion, symptom-specific record alongside KM-qmz-sequencing's own
    // core workflow record for the same featureId. 'scoped' + the question
    // types below mean it only contributes when a question is actually
    // shaped like a troubleshooting/connectivity report -- never for an
    // ordinary "what is QMZ" / "how do I sort QMZ photos" / "why is QMZ
    // separate from Import" question, where its own content previously
    // dominated and produced a misleading answer (frozen benchmark
    // conversation H, turn 2). See retrieval/conceptualRetrieve.js's
    // filterRecordsByRelevance() for the general mechanism this declares
    // into.
    recordRole: 'scoped',
    scopedQuestionTypes: ['TROUBLESHOOTING', 'CONNECTIVITY'],
    title: 'QMZ: File Grid Sorting Does Not Change Sequence Numbers',
    aliases: ['QMZ sequence numbers look wrong', 'QMZ sorting changed my sequence numbers', 'QMZ files out of order after sorting'],
    purpose: 'Clarifies that the QMZ file grid\'s date/name/size sort controls only change display order of thumbnails within the currently-selected photographer/location — they never renumber or reassign a QMZ sequence code.',
    operatorWorkflow: [],
    preconditions: [],
    actions: [],
    behavior: 'Two different things share the word "sequence" in QMZ and are easy to mix up: (1) the sequence code (e.g. 01Q) is a label an archivist assigns manually, either by creating a new sequence or typing an existing sequence number into the assign field — it never changes by itself. (2) the file grid\'s sort controls (sort by date, name, or size, ascending or descending) only change the display order of thumbnails within the currently active photographer/location view — sorting by date compares each file\'s embedded capture date, sorting by name does an alphabetical comparison, and sorting by size compares file size. None of these sort options save anything to disk or move any file between sequence folders.',
    recovery: null,
    relationships: [{ type: 'relatedTo', targetId: 'KM-qmz-sequencing', note: 'Same feature; this record isolates the specific troubleshooting confusion between grid sort order and sequence-code assignment.' }],
    limitations: ['If sequence numbers genuinely look wrong (e.g. files landed in the wrong 01Q/02M folder), that is a manual-assignment mistake, not a sorting side effect — the fix is to move the affected files back to Unsequenced and reassign them, not to change sort order.'],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'renderer/renderer.js:8945-8955 (_qmzSortGroup) implements the three sort keys purely as an in-memory Array.sort() over the files already returned by _qmzGetActiveFiles() (renderer/renderer.js:8921-8933) — it has no IPC call and does not touch main/qmzService.js\'s state or filesystem functions at all. The sort keys are _qmzSortKey values date/name/size with direction _qmzSortDir (asc/desc); date compares each file\'s EXIF-derived capturedAt value, name uses a locale-aware string compare, and size compares byte counts. Sequence assignment is a completely separate code path (moveFilesToSequence(), main/qmzService.js:464-479, invoked only via the qmz:moveToSequence IPC handler).',
    provenance: [
      { claim: 'grid sort implementation is purely local array sort with no persistence/move side effect', source: 'renderer/renderer.js:8945-8963 (_qmzSortGroup, _qmzGetRenderedPathOrder)', type: 'code', confidence: 'high' },
      { claim: 'sequence assignment is a separate move+state-write code path', source: 'main/qmzService.js:464-479 (moveFilesToSequence); main/main.js:5524-5526 (qmz:moveToSequence handler)', type: 'code', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },

  // ── AI-FEAT-007 — Telemetry Pipeline ──────────────────────────────────────
  {
    id: 'KM-telemetry-pipeline',
    featureId: 'AI-FEAT-007',
    title: 'Telemetry Pipeline',
    aliases: ['telemetry', 'crash reporting', 'diagnostics', 'bug tracker pipeline', 'does AutoIngest send data'],
    purpose: 'A technical system-of-record for AutoIngest itself: automatically records crashes, performance problems, and import failures (plus operator-submitted feedback) into an internal bug tracker, so field issues can be investigated later instead of disappearing after an operator encounters them.',
    operatorWorkflow: ['The only operator-initiated telemetry path is explicit feedback: an in-app modal lets an operator describe an issue, and that report is sent immediately rather than waiting for the normal batch cycle, so the operator sees prompt confirmation that it went through.'],
    preconditions: [],
    actions: [{ label: 'Send feedback', description: 'Operator-initiated report submitted through an in-app modal — the only telemetry path that requires operator action.' }],
    behavior: 'Four report categories flow through one internal pipeline into a single Google Sheet ("Bug Tracker" tab): crash reports (main app, renderer, or GPU crashes, and JS errors), performance reports (event-loop lag, thumbnail stalls, slow imports, high memory usage), import-failure reports (sent automatically whenever an import completes with one or more errors), and explicit feedback. The first three are passive/automatic; only feedback requires operator action. The reporter field defaults to \'Auto-report\' for all passive reports — there is no linkage anywhere in the telemetry pipeline to the operator-identity/login system. Device information is inferred generically as the operating system (Mac/Windows) plus the app version; no device ID, session ID, or event ID is recorded. No screenshots or media of any kind are captured or transmitted anywhere in the pipeline. Reports are deduplicated within a 60-second window so the same type of issue reported repeatedly in a short span is not sent multiple times.',
    recovery: 'Unsent reports are queued locally in a file on the operator\'s machine, capped at 500 entries (oldest dropped first if the cap is reached), and reloaded automatically the next time the app starts, so a crash before sending does not lose them. The queue is sent out every 30 seconds; after 5 consecutive failures to send (for example, during a sustained network outage), sending pauses for 5 minutes before automatically resuming, rather than retrying forever or silently dropping the queue.',
    relationships: [
      { type: 'uses', targetId: 'AI-FEAT-006', note: 'Consumed by the auto-updater for update-related telemetry.' },
      { type: 'distinctFrom', targetId: 'AI-FEAT-002', note: 'The reporter field is unrelated to operator identity — forensically confirmed no linkage exists; passive reports always default reporter to \'Auto-report\'.' },
    ],
    limitations: [
      'No operator-facing consent or opt-out exists anywhere in the app. The only control is a hardcoded switch in the source code — an engineering-only kill switch, not a settings toggle an operator can change.',
      'The import-failure report includes the real archive destination path (event/component/photographer folder structure) — the one confirmed instance of archive-identifying data anywhere in the pipeline (tracked as BUG-018, open).',
      'Authentication to Google Sheets uses a service-account credential file bundled inside the packaged app — the code\'s own comments flag this as an accepted internal-testing risk requiring rotation before any public/open-source release (tracked as BUG-017, open).',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'services/telemetry.js exports init()/enqueue()/flush()/isEnabled(). TELEMETRY_ENABLED is declared as a literal `const TELEMETRY_ENABLED = true;` at services/telemetry.js:21 — it is read directly from source, not from services/settings.js or any persisted operator preference; isEnabled() (services/telemetry.js:227) simply returns that constant. Transport is Google Sheets via the googleapis package\'s spreadsheets.values.append (services/telemetry.js:181-187), sheet ID hardcoded at services/telemetry.js:32. Passive call sites: main/main.js:552-565 (import-failure, includes context.destination), main/main.js:1487-1494 (feedback, flushed immediately), plus crash/performance call sites in services/crashReporter.js and services/performanceMonitor.js (each requiring telemetry.enqueue()). Device info is inferred from process.platform plus app version. Deduplication keys on a (type, description-prefix, source) hash within a 60-second window. The Google Sheets service-account credential is bundled inside the packaged app at config/service-account-key.json via electron-builder\'s extraResources mechanism.',
    provenance: [
      { claim: 'TELEMETRY_ENABLED is a hardcoded source constant, not settings-controlled', source: 'services/telemetry.js:21', type: 'code', confidence: 'high' },
      { claim: 'four report categories and enqueue pipeline', source: 'services/telemetry.js:84-117 (enqueue, dedup); main/main.js:552-565 (import-failure); main/main.js:1484-1499 (feedback); services/crashReporter.js (crash call sites); services/performanceMonitor.js (performance call sites)', type: 'code', confidence: 'high' },
      { claim: 'reporter defaults to Auto-report, no operator-identity linkage', source: 'services/telemetry.js:140 (buildRow, report.reporter || \'Auto-report\')', type: 'code', confidence: 'high' },
      { claim: 'local queue with 500-entry cap, 30s flush, 5-failure/5-minute backoff', source: 'services/telemetry.js:45-47 (constants), :161-215 (flush)', type: 'code', confidence: 'high' },
      { claim: 'recovery: queue persisted to disk atomically and reloaded on next start', source: 'services/telemetry.js:59-72 (init load), :218-225 (persistQueue, tmp-then-rename)', type: 'code', confidence: 'high' },
      { claim: 'import-failure report includes real archive destination path', source: 'main/main.js:552-564 (context.destination)', type: 'code', confidence: 'high' },
      { claim: 'no screenshots/media captured or transmitted', source: 'services/telemetry.js:120-157 (buildRow — no image/binary field in the row schema); docs/product/features/AI-FEAT-007_TELEMETRY_PIPELINE.md § Current Behavior (10-point forensic pass, 2026-08-14)', type: 'code', confidence: 'high' },
      { claim: 'bundled service-account credential and destination-path findings tracked as open bugs', source: 'docs/product/bugs/BUG-017_TELEMETRY_HARDCODED_BUNDLED_SERVICE_ACCOUNT_CREDENTIAL.md; docs/product/bugs/BUG-018_TELEMETRY_IMPORT_FAILURE_REPORT_INCLUDES_ARCHIVE_DESTINATION_PATH.md', type: 'doc', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },

  // ── AI-FEAT-002 — Login & Operator Identity ───────────────────────────────
  {
    id: 'KM-login-operator-identity',
    featureId: 'AI-FEAT-002',
    title: 'Login & Operator Identity',
    aliases: ['login', 'operator profile', 'who am I logged in as', 'splash screen', 'operator identity'],
    purpose: 'Lets an operator establish and switch identity before working, so that ingestion activity can later be attributed to the operator who performed it — historical accountability/traceability first, live multi-user coordination (who else is online/working on what) second.',
    operatorWorkflow: [
      'On launch, a dedicated splash screen checks whether an operator was previously active on this machine.',
      'If a last-active operator is found, a "Welcome back" panel shows and Continue re-activates that same profile.',
      'If no last-active operator is found but saved profiles exist, a picker panel lists them for selection, then Start session activates the chosen one.',
      'If no profiles exist at all, a create-profile form collects name and role (also reachable as "New Profile" from the picker panel); starting from there creates and activates the profile.',
      'Once complete, the splash screen smoothly fades out into the main app window.',
      'After login, an in-app operator dropdown and add-user modal (replacing the older #loginSplash overlay) let an operator switch/add profiles without relaunching.',
    ],
    preconditions: [],
    actions: [
      { label: 'Create profile', description: 'Creates a new operator profile from a name and role; the name must be unique, and initials are generated automatically from the name if not provided.' },
      { label: 'Switch active operator', description: 'Makes a different saved profile the active one and remembers when it was last used.' },
      { label: 'List profiles', description: 'Shows all saved profiles, most recently used first.' },
    ],
    behavior: 'AutoIngest can optionally record which operator triggered a given import, shown in the Activity Log — older imports made before this was tracked simply show as not recorded rather than guessing. Operator identity is kept distinct from two other, easily-confused concepts: the naming of photographer folders in the archive, and which memory card, drive, or folder actually supplied the imported files — neither of those is about who the logged-in operator is.',
    recovery: null,
    relationships: [
      { type: 'distinctFrom', targetId: 'AI-FEAT-022', note: 'Photographer-Folder Resolution names archive folders; unrelated to who the logged-in operator is.' },
      { type: 'distinctFrom', targetId: 'AI-FEAT-028', note: 'Import Source Attribution records which memory card/drive/folder supplied files; unrelated to operator identity.' },
      { type: 'relatedTo', targetId: 'AI-FEAT-027', note: 'Import attribution (importedBy) surfaces in the Activity Log.' },
      { type: 'distinctFrom', targetId: 'KM-telemetry-pipeline', note: 'Telemetry\'s reporter field has no linkage to this operator-identity system — always defaults to \'Auto-report\' for passive reports.' },
    ],
    limitations: [
      'Single active operator only, not concurrent multi-user or role-based access — see the separate note on multiple concurrent accounts for what this does and doesn\'t support.',
      'No passwords, emails, photos, or other sensitive identity data are stored — profiles are just a name, role, and initials, not authenticated accounts.',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'main/userManager.js is the operator-profile store: profiles persist to <userData>/users.json via an atomic tmp-file-then-rename write (main/userManager.js:45-56), matching the pattern used by importIndex.json/settings.json. The currently-active operator pointer (lastActiveUserId) is stored separately, via services/settings.js\'s getLastActiveUserId()/setLastActiveUserId(), not inside users.json itself (main/userManager.js:124-149). listUsers() sorts by lastUsedAt (falling back to createdAt) descending (main/userManager.js:78-85). createUser() rejects a duplicate name case-insensitively and auto-derives initials from the name\'s first/last word when not supplied (main/userManager.js:58-66, 92-117).',
    provenance: [
      { claim: 'operator profile store location and atomic write pattern', source: 'main/userManager.js:1-13 (header), :45-56 (_save)', type: 'code', confidence: 'high' },
      { claim: 'active-user pointer stored via services/settings.js, not inside users.json', source: 'main/userManager.js:124-149 (setActiveUser/getActiveUser)', type: 'code', confidence: 'high' },
      { claim: 'splash workflow states (welcome back / picker / create)', source: 'renderer/splash.js:15 (panel ids), :86-190 (_createUser, panel-selection logic); test/qmzLiveE2E.test.js:64-89 (live splash-state handling in an unrelated E2E test, confirms the three real panel ids)', type: 'code', confidence: 'high' },
      { claim: 'imports[].importedBy is optional/backward-compatible', source: 'docs/product/features/AI-FEAT-002_LOGIN_OPERATOR_IDENTITY.md § Current Behavior', type: 'doc', confidence: 'medium' },
      { claim: 'distinct from Photographer-Folder Resolution and Import Source Attribution', source: 'docs/product/features/AI-FEAT-002_LOGIN_OPERATOR_IDENTITY.md § Summary (autoingest-architect review)', type: 'doc', confidence: 'high' },
      { claim: 'no passwords/emails/photos stored', source: 'main/userManager.js:12 (header comment)', type: 'code', confidence: 'high' },
      { claim: 'single-active-user limitation', source: 'services/settings.js getLastActiveUserId() (single return value); docs/product/features/AI-FEAT-002_LOGIN_OPERATOR_IDENTITY.md § Known Limitations', type: 'code', confidence: 'medium' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },

  // ── AI-FEAT-049 — Archive Maintenance (Planned) ───────────────────────────
  {
    id: 'KM-archive-maintenance-planned',
    featureId: 'AI-FEAT-049',
    title: 'Archive Maintenance',
    aliases: ['archive maintenance', 'edit an archived event', 'change event date after import', 'reorganize archive folders', 'move photographer folder between components'],
    purpose: 'A planned (not yet started) capability that would bring controlled, AutoIngest-managed structural modification of already-existing archive events/collections — e.g. changing an event\'s date or sequence number, adding a component after creation, moving photographer folders between components, re-sorting existing archival structures — under the same safety model AutoIngest already applies to creation and import.',
    operatorWorkflow: [],
    preconditions: [],
    actions: [],
    behavior: 'Not implemented — no code exists. An exhaustive grep for "maintenance"/camelCase variants across main/, services/, renderer/ found no matches, and git log --all --oneline found no relevant commits (docs/product/features/AI-FEAT-049_ARCHIVE_MAINTENANCE.md § Evidence status). Today, AutoIngest can inspect/report/protect/verify various archive conditions (Health Reporting, Lock Handling, Backup Update Scanning, Audit/Integrity) but cannot perform structural modification of already-established archive material under its own safety model — that currently requires manual, unmanaged filesystem work outside AutoIngest.',
    recovery: null,
    relationships: [
      { type: 'precedesInWorkflow', targetId: 'AI-FEAT-050', note: 'Event Maintenance (AI-FEAT-050, roadmap milestone AI-RM-003) is an event-level scope within this broader Archive Maintenance capability, not a second independently-motivated concept — per explicit product-owner clarification.' },
      { type: 'relatedTo', targetId: 'AI-FEAT-042', note: 'Listed as a related feature in the canonical registry; specific relationship not yet elaborated (Evidence pending).' },
      { type: 'relatedTo', targetId: 'AI-FEAT-043', note: 'Archive Health Reporting — an existing inspect/report capability this planned feature would extend into actual structural modification.' },
    ],
    limitations: [
      'No architecture, scope, or design has been finalized — this record intentionally does not invent implementation detail for unbuilt work.',
      'AI-RM-002 (the roadmap milestone containing this feature) has status "Planned — not started"; its Objective, Deliverables, and Acceptance criteria are all explicitly "Evidence pending" in docs/product/02_MASTER_ROADMAP.md.',
      'Next action per the roadmap is "Discovery and specification" — scoping has not begun.',
    ],
    status: STATUS.PLANNED,
    technicalDetail: null,
    provenance: [
      { claim: 'zero implementation confirmed by exhaustive grep and git log search', source: 'docs/product/features/AI-FEAT-049_ARCHIVE_MAINTENANCE.md § Lifecycle Metadata / Evidence status', type: 'doc', confidence: 'high' },
      { claim: 'AI-RM-002 milestone status and unscoped fields', source: 'docs/product/02_MASTER_ROADMAP.md § AI-RM-002 — Archive Maintenance table', type: 'doc', confidence: 'high' },
      { claim: 'vision/scope description (future-tense, not current behavior)', source: 'docs/product/features/AI-FEAT-049_ARCHIVE_MAINTENANCE.md § Summary (product-owner intent, captured 2026-08-14)', type: 'doc', confidence: 'medium' },
      { claim: 'relationship to AI-FEAT-050 (Event Maintenance as an event-level scope within this capability)', source: 'docs/product/features/AI-FEAT-049_ARCHIVE_MAINTENANCE.md § Summary; docs/product/02_MASTER_ROADMAP.md § AI-RM-003', type: 'doc', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },
];

module.exports = { RECORDS };
