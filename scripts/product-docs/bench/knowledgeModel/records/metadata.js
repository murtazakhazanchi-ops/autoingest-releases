'use strict';

// Candidate C Knowledge Model — Metadata cluster records. Experimental only.
// Forensic-verified this checkpoint: each claim below was re-checked against the
// ACTUAL CURRENT source (main/exifService.js, services/metadataExpectationService.js,
// main/eventJsonStore.js, main/metadataQueueStore.js, main/metadataQueueRecovery.js,
// main/metadataRepairService.js, services/metadataAuditService.js, main/main.js),
// not merely reshaped from the prior registry snapshot. The prior registry snapshot
// (registry_AI-FEAT-029/033/004.json) was read first as prior evidence and used to
// scope what to verify; every recovery/technicalDetail claim here carries its own
// fresh file:line citation from this checkpoint's own read, per the schema's
// validator requirement.

const { STATUS, EXTRACTION_TIERS } = require('../schema');

const RECORDS = [
  {
    id: 'KM-metadata-writing-engine',
    featureId: 'AI-FEAT-029',
    title: 'Metadata Writing Engine',
    aliases: ['metadata engine', 'EXIF writer', 'IPTC/XMP writer', 'metadata write path', 'tag writer'],
    purpose: 'The single shared engine and resolver every metadata writer in the app consumes (Standard Import, QMZ, Reapply, crash-recovery resume, and Repair), so metadata is written the same verified way regardless of which workflow triggered it.',
    operatorWorkflow: [
      'Import files into an event as normal — metadata is written automatically after the copy succeeds; the operator does not trigger it separately during Standard Import.',
      'If metadata writing was interrupted (crash/quit), the operator does not need to manually resume it — AutoIngest resumes automatically on next launch (see recovery).',
      'For files already imported with wrong/missing metadata, use Metadata Audit & Repair (AI-FEAT-033) rather than re-importing.',
    ],
    preconditions: [
      'A file has already been copied into an event/sub-event folder (import happens first; metadata is always second and never blocks or rolls back the copy).',
      'The file is a JPEG/TIFF (direct tag write) or RAW (XMP sidecar write) — video files are never written to.',
    ],
    actions: [
      { label: 'Automatic write after import', description: 'Every import path (Standard Import, QMZ, Reapply) automatically queues a metadata write for each non-video file it copies.' },
    ],
    behavior: 'AutoIngest\'s metadata writing engine is the only path in the app allowed to perform a metadata write, so every workflow writes metadata the same verified way. Every write follows the same sequence: determine what the file\'s metadata should be, write it, read the file back, and compare the read-back value against what was expected — a write is never marked successful just because the write process ran; it is only "complete" if the read-back tags match the expectation, otherwise it is classified "partial" with the specific mismatched fields recorded. There is a single, versioned source of truth for "what metadata should this file have," so any future change to that logic can be told apart from what older files were written with. Fields owned: Photographer/Creator, Copyright (fixed "© Aljamea-tus-Saifiyah"), Keywords (component-derived, deduplicated case-insensitively), Location/City/Country, Hijri date, Description/Caption (event name only). Capture-date fields (the date/time a photo was originally taken) are never written or changed by AutoIngest. RAW files get their metadata written to an XMP sidecar file (created fresh or merged in place, never deleted and recreated); JPEG/TIFF files get their tags written directly; video files are never written to at all, and that is expected behavior, not a failure.',
    recovery: 'If AutoIngest is closed unexpectedly (crash, forced quit, power loss) while metadata is being written, no queued work is silently lost — every batch of metadata writes is tracked durably on disk as it happens, not only in memory. A few seconds after the app is next launched, AutoIngest automatically resumes any writes that were interrupted; the operator does not need to do anything. Before resuming a given file, AutoIngest re-checks whether anything about that file\'s expected metadata has changed since it was queued (for example, if the operator edited the event\'s location in between); if so, the file is flagged as needing a fresh check rather than being silently rewritten with different values. This crash-and-resume behavior has been verified with a real forced-kill-and-relaunch test, not only a simulated one — see Metadata Durable Queue & Crash Recovery for the full mechanism.',
    relationships: [
      { type: 'uses', targetId: 'KM-metadata-durable-queue', note: 'The writing engine\'s crash-recoverable durability comes entirely from the durable manifest+journal queue (AI-FEAT-030), not from logic inside exifService.js itself.' },
      { type: 'uses', targetId: 'KM-event-json-contract', note: 'Writes into event.json\'s metadataState block go exclusively through updateEventJsonAtomic (main/eventJsonStore.js), never an independent read-modify-write.' },
      { type: 'distinctFrom', targetId: 'KM-metadata-audit-repair', note: 'The Writing Engine is the single write path every workflow (including Repair) calls through; Metadata Audit is a separate, independent, read-only detector that never calls this engine at all — it exists specifically so a defect in the write path cannot also blind the check for that defect.' },
    ],
    limitations: [
      'Gregorian date field is deliberately deferred — no authoritative conversion utility or source field exists yet (docs/metadata-system.md line 31).',
      'Six independent codebase locations must currently agree on the field set by convention (resolver, tag builder, read-back comparator, resume staleness comparator, audit\'s field-diff classifier, audit CSV export\'s column list); only a defensive test (test/fieldSpecsConsistency.test.js) currently guards this — consolidating into one shared FIELD_SPECS table remains an open, documented follow-up, not yet done.',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'Write contract is Expected -> Write -> Read Back -> Compare -> Result, implemented in `_writeAndVerify` (main/exifService.js:403-416) and `_processFile` (main/exifService.js:431-489), which classifies each file as complete/partial/failed/ambiguous/excluded and journals every transition via `_journal`. RAW read-back deliberately reads the XMP sidecar path, not the RAW file\'s own embedded tags, per main/exifService.js:408-412 and verified in test/rawXmpReadback.test.js.',
    provenance: [
      { claim: 'write-verify contract shape', source: 'main/exifService.js:403-416 (_writeAndVerify)', type: 'code', confidence: 'high' },
      { claim: 'per-file classification and journaling', source: 'main/exifService.js:431-489 (_processFile)', type: 'code', confidence: 'high' },
      { claim: 'resolver is sole source of expected metadata, versioned', source: 'services/metadataExpectationService.js:25-26,107,179', type: 'code', confidence: 'high' },
      { claim: 'recovery: durable queue + startup resume + staleness re-check on resume', source: 'main/metadataQueueRecovery.js:83-156 (resumeInterruptedBatches, _expectationsEqual)', type: 'code', confidence: 'high' },
      { claim: 'recovery: 3-second post-launch scheduling of resume', source: 'main/main.js:278-297', type: 'code', confidence: 'high' },
      { claim: 'recovery: durable manifest/journal persistence, quarantine of corrupt lines, 90-day compaction retention', source: 'main/metadataQueueStore.js:19-283', type: 'code', confidence: 'high' },
      { claim: 'recovery verified via real SIGKILL + relaunch, not only a simulation', source: 'test/metadataCrashRelaunch.test.js', type: 'test', confidence: 'high' },
      { claim: 'startup resume behavior', source: 'test/metadataQueueResume.test.js', type: 'test', confidence: 'high' },
      { claim: 'field-set consistency across six sites is test-guarded, not structurally enforced', source: 'test/fieldSpecsConsistency.test.js; docs/product/features/AI-FEAT-029_METADATA_WRITING_ENGINE.md lines 51,76', type: 'test', confidence: 'medium' },
      { claim: 'prior registry snapshot corroboration', source: 'registry_AI-FEAT-029.json (currentBehavior, summary fields)', type: 'registry', confidence: 'medium' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },
  {
    id: 'KM-metadata-durable-queue',
    featureId: 'AI-FEAT-030',
    title: 'Metadata Durable Queue & Crash Recovery',
    aliases: ['metadata queue', 'crash recovery', 'metadata resume', 'metadata batch recovery'],
    purpose: 'Makes metadata writing batches durable on disk (not held only in memory) so a crash, forced quit, or unclean exit mid-batch never silently loses queued metadata work — this is the mechanism that gives the Metadata Writing Engine its recovery behavior.',
    operatorWorkflow: [
      'No direct operator action — this runs automatically on every app launch, 3 seconds after startup, non-blocking.',
      'If a batch was interrupted by a crash, the operator sees no special prompt; interrupted files are silently resumed or marked stale/re-audit-required as appropriate.',
    ],
    preconditions: ['At least one metadata batch was left in a non-terminal state (a file still "writing" or "queued") when AutoIngest last exited.'],
    actions: [],
    behavior: 'Every metadata batch is written to a durable, private application data location (never the archive root itself, which may be offline, read-only, or on external/network storage) as two pieces: a snapshot of what the batch intended to do, saved once before any file is touched, and a running, append-only log of every file\'s status as it changes. Together, these are replayed to work out the current state of every file in the batch without ever having to rewrite one large combined document every time a single file\'s status changes.',
    recovery: 'A few seconds after AutoIngest launches, it automatically checks for any metadata batch that was left mid-flight by the previous session and resumes it — no special prompt or operator action is required. Any file whose last recorded status wasn\'t a final one (still "writing" or "queued" when the app stopped) is treated as interrupted. For each interrupted file, AutoIngest re-checks the file\'s current expected metadata against what was recorded when the batch was originally queued; if they now differ (for example, the operator edited the event\'s location in the meantime), the file is flagged as needing a fresh check rather than being silently rewritten with a different value. Otherwise it resumes the write using the same verified write process used everywhere else, which is safe to repeat — a resumed write either completes for the first time or safely confirms it was already done, never duplicating work. A video file that was interrupted right at the point it should have been excluded from metadata writing is correctly marked excluded rather than left stuck as "interrupted." Once an event\'s outcome has been durably recorded, its batch record is archived out of the active queue — and only after that recording succeeds, so an already-archived batch is never made invisible to a future resume. A corrupted or cut-off trailing log entry is set aside and logged rather than silently discarded. This exact scenario — the app being forcibly killed mid-batch, then relaunched — has been verified with a real forced-kill test, not only a simulated one.',
    relationships: [
      { type: 'relatedTo', targetId: 'KM-metadata-writing-engine', note: 'This queue is what makes AI-FEAT-029\'s writes crash-recoverable; AI-FEAT-029\'s _writeAndVerify/_processFile is the same engine this queue resumes into via resumeFrozenFile.' },
      { type: 'uses', targetId: 'KM-metadata-audit-repair', note: 'Repair batches are queued and can themselves be interrupted and resumed through this exact same manifest+journal mechanism — repair is "indistinguishable from any other queued batch to this machinery" (main/metadataRepairService.js:138-139).' },
    ],
    limitations: [
      'Compacted/retention is a disk-growth concern only, not a correctness one — compacted/ is never rescanned by any recovery/audit/repair path (main/metadataQueueStore.js:213-220).',
      'Retention window (90 days, COMPACTED_RETENTION_MS) is a conservative default with no prior architectural specification cited in the code — the comment states no prior architecture in the codebase specifies a value (main/metadataQueueStore.js:213-220).',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'Manifest: `{batchId}.manifest.json` under userData/metadata-queue/, written once via temp-file + rename, immutable thereafter (main/metadataQueueStore.js:31-33,65-76). Journal: `{batchId}.journal.jsonl`, append-only, one line per status transition (main/metadataQueueStore.js:35-37,92-96). Resume concurrency is capped at RESUME_CONCURRENCY = 2 (main/metadataQueueRecovery.js:24). State persistence is batched once per distinct event (not once per batch) for performance — the original per-batch shape was measured at ~20s for 500 active batches vs. ~60ms when batched once per event (main/metadataQueueRecovery.js:132-137).',
    provenance: [
      { claim: 'manifest/journal durability model', source: 'main/metadataQueueStore.js:1-96', type: 'code', confidence: 'high' },
      { claim: 'recovery/resume/staleness-recheck/compaction sequencing', source: 'main/metadataQueueRecovery.js:1-156', type: 'code', confidence: 'high' },
      { claim: 'startup scheduling at 3000ms after launch, non-blocking', source: 'main/main.js:278-297', type: 'code', confidence: 'high' },
      { claim: 'real SIGKILL mid-batch + relaunch recovery test', source: 'test/metadataCrashRelaunch.test.js', type: 'test', confidence: 'high' },
      { claim: 'resume behavior test coverage', source: 'test/metadataQueueResume.test.js; test/metadataQueueStore.test.js', type: 'test', confidence: 'high' },
      { claim: 'compacted retention window and its correctness-vs-disk-growth scope', source: 'main/metadataQueueStore.js:213-267 (COMPACTED_RETENTION_MS, pruneCompactedBatches)', type: 'code', confidence: 'high' },
      { claim: 'canonical doc corroboration of manifest/journal/recovery shape', source: 'docs/product/features/AI-FEAT-030_METADATA_DURABLE_QUEUE_CRASH_RECOVERY.md lines 35-39', type: 'doc', confidence: 'medium' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },
  {
    id: 'KM-metadata-audit-repair',
    featureId: 'AI-FEAT-033',
    title: 'Metadata Audit & Repair',
    aliases: ['metadata audit', 'metadata repair', 'audit and repair', 'check metadata', 'fix metadata'],
    purpose: 'Lets an operator independently detect, across the whole archive, which files have metadata that does not match what the resolver says they should have, then optionally fix only that specific, exhaustively-previewed set of files — without ever re-running or depending on the original write path that might itself be defective.',
    operatorWorkflow: [
      'Run a Metadata Audit (archive-wide or scoped) — read-only, streaming, resumable, cancellable.',
      'Review the audit report (JSON/JSONL/CSV export available) for files with a "partial" or "read-error" status.',
      'Open Repair preview for that audit job — see the exact current value, expected value, and fields that would change for every repairable file, including which are stale (skipped, re-audit required).',
      'Explicitly confirm the repair to execute the write.',
      'If files show as stale on a second Repair attempt against the same snapshot, run a fresh Audit first rather than assuming Repair is broken.',
    ],
    preconditions: [
      'The target files were imported through a real archival event (event.json must exist at every level of the scanner\'s traversal) — Quick Import\'s staging-only files, which create no event.json, are permanently outside Audit\'s coverage.',
      'A completed Audit job exists before Repair (previously) or runMetadataRepair (currently) can act on it.',
    ],
    actions: [
      { label: 'Run Audit', description: 'Archive-wide (or scoped) read-only scan comparing actual file metadata against the resolver\'s expectation; never writes, never calls an ExifTool write operation.' },
      { label: 'Export Audit report', description: 'JSON/JSONL/CSV export, each streamed temp-then-rename, with reproducibility metadata (contract/resolver versions, archive-root identity, scan timestamp).' },
      { label: 'Preview Repair', description: 'Exhaustive per-file preview (current value, expected value, exact fields to change, stale/skip reasoning) with no writes.' },
      { label: 'Run Repair', description: 'Executes writes for the previewed, non-stale, repairable subset only, through the shared write engine.' },
    ],
    behavior: 'Audit never writes to a file — it only reads and compares. Results are reported incrementally as the scan runs, and progress is saved at safe checkpoints (each completed event), so if a scan is interrupted, resuming it re-scans at worst the one event that was in progress rather than starting over. Repair works only from a completed Audit\'s already-captured snapshot of each file, and never re-derives what a file\'s metadata "should" be at repair time — it only re-checks whether the file has changed on disk since the audit ran. If a file changed, disappeared, or newly appeared since the audit snapshot was taken, it is marked stale and skipped rather than silently overwritten. Only files the audit found to be genuinely incorrect or unreadable are ever eligible for repair. Repair writes go through the same shared, verified write process every other metadata write in AutoIngest uses, so a repair run gets the same crash-recovery/resume protection as any other metadata write.',
    recovery: 'An interrupted Audit resumes automatically from the last completed event rather than starting the whole archive scan over. An interrupted Repair is not a special case — it is queued the same way any other metadata write is, so it gets the exact same automatic crash-recovery and resume behavior described under Metadata Writing Engine and Metadata Durable Queue & Crash Recovery. Repair itself is deliberately "one-shot per audit snapshot": once files are successfully repaired, running Repair again against that same, now-outdated snapshot correctly shows the just-repaired files as stale and skips them — this is the staleness safeguard working as intended, not a bug; running a fresh Audit first is the correct way to repair again.',
    relationships: [
      { type: 'distinctFrom', targetId: 'KM-metadata-writing-engine', note: 'Audit is deliberately independent of the write path it is checking — it exists specifically because a write-path defect must not also blind the mechanism that detects it (see PM-001 framing in docs/product/postmortems).' },
      { type: 'uses', targetId: 'KM-metadata-durable-queue', note: 'Repair execution is queued through the same manifest+journal durable-queue machinery as any other metadata batch, one manifest per event.' },
      { type: 'uses', targetId: 'KM-event-json-contract', note: 'Repair reads each file\'s live event.json to build fresh evidence for context, and its outcome is persisted into event.json\'s metadataState block via the same shared metadataStateService path used by the durable queue.' },
    ],
    limitations: [
      'Quick Import content is permanently outside Metadata Audit\'s coverage because it creates no event.json (docs/metadata-system.md line 111); this is communicated in the Quick Import UI, not silently invisible.',
      'The app currently cannot confirm that a specific preview the operator looked at is the exact same one they then confirmed — it only knows that some preview was generated for that audit job at some point during the current app session, tracked only in memory (so it does not survive an app restart). This is a known, non-blocking limitation, confirmed still present.',
      'A repair run cannot be repeated against an unchanged snapshot without a fresh audit, because a successful write always advances the target\'s mtime (ExifTool behavior), which the staleness guard then correctly treats as drift.',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: '"Frozen-snapshot repair" means: Repair\'s write decision (the `expectation` object) comes exclusively from the audit job\'s per-file JSONL record captured at audit scan time, never from a fresh call to `resolveExpectedMetadata`. The only live filesystem check performed before writing is `_staleCheck`\'s size/mtime comparison (main/metadataRepairService.js:69-88) — a pure drift detector, not a re-resolution. `buildFileEvidence` is called against the LIVE event.json only to build the `evidence` field on the queued file entry for context/traceability (main/metadataRepairService.js:203); the actual write in `exifService.resumeFrozenFile` uses only the frozen `expectation`, never `evidence`, confirming the write itself never re-derives from live state (main/exifService.js:754-771). `snapshotIdentity` on every repair result records the source auditJobId plus the archive-root identity and METADATA_CONTRACT_VERSION/RESOLVER_VERSION the audit recorded at scan time, not read live (main/metadataRepairService.js:211-220).',
    provenance: [
      { claim: 'audit is read-only, streaming, event-boundary-committed, resumable, cancellable', source: 'services/metadataAuditService.js:1-60,401-,491-,521-', type: 'code', confidence: 'high' },
      { claim: 'frozen-snapshot repair: staleness guard vs. frozen expectation, repairable status set', source: 'main/metadataRepairService.js:24,69-88', type: 'code', confidence: 'high' },
      { claim: 'repair execution reuses the shared write engine and durable queue, one manifest per event', source: 'main/metadataRepairService.js:239-270', type: 'code', confidence: 'high' },
      { claim: 'repair write uses only frozen expectation, never re-resolves', source: 'main/exifService.js:754-771 (resumeFrozenFile)', type: 'code', confidence: 'high' },
      { claim: 'recovery: preview-session identifier does not survive Preview->Confirm round trip (verified real and current, not stale)', source: 'main/metadataRepairService.js:27-36,149-154,224-230', type: 'code', confidence: 'high' },
      { claim: 'recovery: repair run is queued and resumable via the same crash-recovery machinery as any metadata batch', source: 'main/metadataRepairService.js:1-13,239-243; main/metadataQueueRecovery.js:83-156', type: 'code', confidence: 'high' },
      { claim: 'one-shot-per-snapshot staleness behavior on re-run', source: 'main/metadataRepairService.js:69-88; docs/metadata-system.md line 96', type: 'doc', confidence: 'medium' },
      { claim: 'test coverage for audit/repair/export', source: 'test/metadataAuditService.test.js; test/metadataAuditExport.test.js; test/metadataRepairService.test.js', type: 'test', confidence: 'high' },
      { claim: 'preview-session-identifier limitation as stated in canonical roadmap-linked doc', source: 'docs/product/features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md lines 69, 149-154', type: 'doc', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },
  {
    id: 'KM-event-json-contract',
    featureId: 'AI-FEAT-004',
    title: 'event.json Data Model & Persistence Contract',
    aliases: ['event.json', 'event data file', 'event data model', 'event persistence', 'where is event data stored'],
    purpose: 'event.json is the single, authoritative representation of an event\'s structure, sub-events, group mappings, and ingestion/metadata state — the foundational contract every other AutoIngest feature (including the metadata system) reads and writes through.',
    operatorWorkflow: [],
    preconditions: [],
    actions: [],
    behavior: 'AutoIngest stores each event\'s data as a plain JSON file named event.json, located directly inside that event\'s own folder in the archive — one file per event, not a database and not a single archive-wide file. Key information it holds: the event\'s own metadata, its sub-events, its file groups and how they map to sub-events, its import history, its overall status, and feature-specific state such as metadata tracking. One group always maps to exactly one sub-event, with no orphaned groups and no duplicate mappings. The file must always be valid, structured JSON and stay compatible with older versions of itself.',
    recovery: 'Every write to event.json is atomic and crash-safe: AutoIngest never partially overwrites the file. It reads the current file, applies the intended change, writes the result to a temporary file first, then swaps that temporary file into place in one atomic step — if that final step is interrupted, the real file is never left half-written. On storage where that atomic swap isn\'t available (for example, some NAS or cloud-synced mounts), AutoIngest falls back to a safe copy-then-replace approach instead. If two parts of the app try to update the same event\'s file at nearly the same time (for example, an event edit and a metadata update happening together), AutoIngest queues those writes so they apply one after another rather than one silently overwriting the other. A failed write cleans up after itself rather than leaving a stray temporary file behind.',
    relationships: [
      { type: 'writesTo', targetId: 'KM-metadata-writing-engine', note: 'The Metadata Writing Engine\'s durable-state persistence writes into event.json\'s metadataState block exclusively through updateEventJsonAtomic.' },
      { type: 'writesTo', targetId: 'KM-metadata-durable-queue', note: 'metadataQueueRecovery.js persists each event\'s durable metadata outcome into event.json before compacting the corresponding queue batch.' },
      { type: 'readsFrom', targetId: 'KM-metadata-audit-repair', note: 'Repair reads each event\'s live event.json (via buildFileEvidence) for context/traceability, though its write decision itself comes from the frozen audit snapshot, not from this live read.' },
    ],
    limitations: [
      'A hardcoded field list in the full-payload Event Edit save path has caused two distinct silent field-drop bugs roughly three months apart (BUG-006, per docs/product/features/AI-FEAT-004); the underlying pattern is documented as not yet structurally closed, per the canonical feature doc (registry-level detail, not independently re-verified against current code in this checkpoint\'s source read).',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'File format: plain UTF-8 JSON (`JSON.stringify(updated, null, 2)`, main/eventJsonStore.js:51), not a database, not a binary or compressed format. Location: `<eventFolderPath>/event.json`, one file per event, directly inside that event\'s own archive folder — confirmed via path construction sites, e.g. main/main.js:2110 (`const jsonPath = path.join(eventFolderPath, \'event.json\')`) and services/localMirrorService.js:31 (`const EVENT_JSON = \'event.json\'`). Write path: temp-file-then-rename via `_runUpdate` (main/eventJsonStore.js:38-68), with EXDEV (cross-device rename) fallback to copy+unlink for network/cloud-mounted archive roots.',
    provenance: [
      { claim: 'file format is plain JSON, one file per event, at <eventFolderPath>/event.json', source: 'main/main.js:2110; main/metadataRepairService.js:250; services/localMirrorService.js:31; main/eventJsonStore.js:38-68', type: 'code', confidence: 'high' },
      { claim: 'atomic temp-file+rename write with EXDEV fallback', source: 'main/eventJsonStore.js:49-60', type: 'code', confidence: 'high' },
      { claim: 'recovery: per-path promise-chain serialization prevents concurrent-writer clobbering; tmp cleanup on failure', source: 'main/eventJsonStore.js:17-36,62-64', type: 'code', confidence: 'high' },
      { claim: 'no writer performs an independent read-modify-write; sole sanctioned path', source: 'docs/metadata-system.md line 8; docs/product/features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md line 49,77', type: 'doc', confidence: 'high' },
      { claim: 'top-level property contract and MUST/MUST NOT invariants', source: 'docs/system-contracts.md §1', type: 'doc', confidence: 'medium' },
      { claim: 'test coverage of eventJsonStore', source: 'test/eventJsonStore.test.js', type: 'test', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },
];

module.exports = { RECORDS };
