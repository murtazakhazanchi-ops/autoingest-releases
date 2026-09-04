'use strict';

// Candidate C Knowledge Model — Transfer & Archive cluster. Experimental only.
// FORENSIC PASS (2026-08-25): every record in this file was produced by
// re-reading the actual current source of services/transferExportService.js,
// services/transferImportService.js, services/archiveLockService.js, and the
// adoption services directly (not by reshaping the prior registry's prose
// unread) — see each record's provenance for exact file:line citations. This
// cluster is the highest-value one in the checkpoint: the benchmark question
// "Can I resume the export or do I have to start over?" is answered here with
// a verified, precise `recovery` field for Transfer Export, plus an explicit
// per-feature recovery finding (present or absent) for the other four
// features in this cluster — never inferred by analogy to Transfer Export.

const { STATUS, EXTRACTION_TIERS } = require('../schema');

const RECORDS = [
  // ── AI-FEAT-038 — Transfer Export ──────────────────────────────────────────
  {
    id: 'KM-transfer-export',
    featureId: 'AI-FEAT-038',
    title: 'Transfer Export',
    aliases: ['export to transfer drive', 'export transfer', 'transfer to office', 'copy to transfer drive', 'backup export'],
    purpose: 'Writes a clean, archive-aware mirror of selected events from the Active Archive Root to a Transfer Drive, for physical transport to the Main Archive Root — replacing blind manual copying (Finder/Explorer/TeraCopy) with a managed workflow that tracks what has and has not been copied and can resume after an interruption.',
    operatorWorkflow: [
      'Select collections, event-root folders, or photographer folders to export (or use custom-source mode for an arbitrary folder pair).',
      'Preview the export scope (file/folder/event counts) before running.',
      'Run the export; it proceeds in batches (one batch per event or per selected folder), showing live progress (copied/skipped/renamed/errors) and can be paused and resumed within the same run.',
      'If the app is closed or crashes mid-export, reopen it and resume from the on-disk checkpoint rather than starting over.',
      'Optionally run a separate verify step afterward (checksum-level, not automatic during copy).',
    ],
    preconditions: [
      'Active Archive Root (source) and Transfer Drive Root (destination) are both configured and mounted.',
      'Source and destination roots must not be the same directory or nested inside one another.',
      'Only one export may run at a time within the same running app process.',
    ],
    actions: [
      { label: 'Run Export', description: 'Starts a new export for the selected scope.' },
      { label: 'Pause / Resume (in-run)', description: 'Pauses or resumes an export while it is running, in the current app session; takes effect between files or between batches.' },
      { label: 'Resume from Checkpoint', description: 'Resumes an export that was interrupted (for example, by an app restart) by picking up from its saved on-disk progress instead of starting over. Custom-source exports have their own separate resume/clear option.' },
      { label: 'Verify Export', description: 'Runs a separate checksum verification pass comparing copied files against the source. This is not automatic during the copy itself — the copy step only checks file size for speed.' },
      { label: 'Scan for Backup Update (Backup Update Scanning)', description: 'A distinct read-only pre-copy diff mode — see KM-backup-update-scanning.' },
    ],
    behavior: 'AutoIngest never overwrites a file that already exists at the destination with matching size — it skips it. A same-named file with a different size is safely renamed instead of overwritten, unless the export is running in backup-update mode (see Backup Update Scanning), where a size mismatch is left untouched and flagged for review instead. AutoIngest\'s own internal working files and locks are never included in the exported mirror. A traceability log of the export is kept for later reference. Checksum-level verification is a separate, manually-run step, not automatic during the copy itself — the copy step only checks file size, a deliberate speed tradeoff.',
    recovery: 'Yes — Transfer Export can resume after an interruption (app crash, forced quit, power loss), picking up from its own saved on-disk progress rather than starting the whole export over. Progress is tracked per batch (roughly, per event or per selected folder) rather than per individual file: on resume, any batch that had already fully finished is skipped outright, while a batch that was in progress or hadn\'t started yet when the interruption happened is re-checked from the start of that batch. That re-check is not wasted work, though — files within that batch that had already finished copying are recognized as done and are not re-copied; only files that hadn\'t finished yet are actually copied again. Resume also confirms the source being resumed from still matches the one the export originally started from, so it won\'t resume against the wrong drive. A separate, in-run pause/resume (pausing a currently-running export mid-session) is unrelated to this crash-recovery behavior — it only works while the app keeps running, and is lost if the app is closed.',
    relationships: [
      { type: 'precedesInWorkflow', targetId: 'AI-FEAT-039', note: 'Transfer Export writes to the Transfer Drive; Transfer Import (AI-FEAT-039) later reads that drive into the Main Archive Root — physically decoupled by the drive being moved between sites.' },
      { type: 'relatedTo', targetId: 'AI-FEAT-040', note: 'Backup Update Scanning is a distinct mode (backupUpdate) of this same service/checkpoint mechanism, not a separate service.' },
      { type: 'distinctFrom', targetId: 'AI-FEAT-045', note: 'Confirmed per DEC-021: the transfer-running guard (_state.running, services/transferExportService.js:43-69,828-829) is an in-memory, process-local flag preventing overlapping exports within one app instance. It shares no mechanism with archiveLockService.js\'s durable, SHA1-keyed, TTL+heartbeat lock. Two independent AutoIngest instances on two machines could run Transfer Export against the same destination simultaneously without this guard preventing it — an accepted limitation for the current one-operator-per-destination operational model, not a bug.' },
    ],
    limitations: [
      'The single-export-at-a-time guard is process-local only, not a durable cross-device lock (DEC-021) — two AutoIngest instances on different machines are not prevented from exporting to the same destination simultaneously.',
      'Checkpoint/resume granularity is per-batch (per event/folder), not per-file — an interrupted batch is re-walked in full on resume, though already-copied files within it are not re-copied due to the same-size-skip rule.',
      'Checksum verification is a separate, manually-invoked step, not automatic during the copy.',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'Checkpoint file: {transferRoot}/.autoingest-transfer/export-checkpoint.json (services/transferExportService.js:31-34,340-361). Written before batch loop, after each batch, and at completion. resumeExportFromCheckpoint() (services/transferExportService.js:875-940) validates nasRoot equality (archive mode) or source-identity sampling (custom mode, _validateCustomSource, services/transferExportService.js:274-308) before resuming; batches with status==="complete" are skipped (services/transferExportService.js:598).',
    provenance: [
      { claim: 'recovery: per-batch checkpoint/resume mechanism, granularity, and idempotent re-walk', source: 'services/transferExportService.js:31-34 (CHECKPOINT_JSON const), :340-361 (_writeCheckpoint/_readCheckpoint), :437-554 (batch construction), :565-666 (checkpoint written before/after each batch/at completion), :598 (skip completed batches on resume), :875-940 (resumeExportFromCheckpoint), :123-127 (_copyFileSafe same-size skip = idempotent re-walk)', type: 'code', confidence: 'high' },
      { claim: 'resume source-identity validation (archive vs custom mode)', source: 'services/transferExportService.js:883-890 (archive-mode exact-path check), :274-308 (_validateCustomSource)', type: 'code', confidence: 'high' },
      { claim: 'process-local (not durable/cross-device) concurrency guard, distinct from AI-FEAT-045 lock', source: 'docs/product/decisions/DEC-021_TRANSFER_EXPORT_PROCESS_LOCAL_LOCK_ACCEPTED_FOR_PRESENT_OPERATIONAL_MODEL.md; services/transferExportService.js:43-69 (_state.running), :828-829 (busy check)', type: 'doc', confidence: 'high' },
      { claim: 'checksum verification is separate/manual, copy only checks size', source: 'services/transferExportService.js:942-1072 (verifyExport), :151-158 (_copyFileSafe size-only check on copy)', type: 'code', confidence: 'high' },
      { claim: 'IPC surface for run/pause/resume/checkpoint operations', source: 'main/main.js:4564 (runExport), :4610-4613 (status/pause/resume), :4618-4655 (checkpoint get/clear/resume, incl. custom-source variant), :4666 (verifyExport)', type: 'code', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },

  // ── AI-FEAT-039 — Transfer Import ──────────────────────────────────────────
  {
    id: 'KM-transfer-import',
    featureId: 'AI-FEAT-039',
    title: 'Transfer Import',
    aliases: ['import from transfer drive', 'transfer import', 'import transfer drive', 'consolidate transfer drive'],
    purpose: 'Imports content from a Transfer Drive into the Main Archive Root — the receiving/consolidating counterpart to Transfer Export, designed to recognize corresponding archival events by identity and merge their contents rather than blindly duplicating folders.',
    operatorWorkflow: [
      'Connect the Transfer Drive containing exported content to the machine with the Main Archive Root.',
      'Review the scope tree (direct-Event folders, Collection-nested folders, and any unresolved/external items).',
      'Preview or scan-for-update the import to see what will copy, what already exists, and what changed.',
      'Run the import; it proceeds in batches with live progress and can be paused/resumed within the same run.',
      'If interrupted (app closed or crashed), reopen and resume from the on-disk checkpoint rather than starting over.',
      'Optionally verify afterward (checksum-level).',
    ],
    preconditions: [
      'Transfer Drive Root (source) and Main Archive Root (destination) are both configured and mounted.',
      'Source and destination roots must not be the same directory or nested inside one another.',
      'For Update Import, a prior scan for what changed must have already run and its results must still be current — if the archive has changed since that scan, AutoIngest refuses to proceed on outdated results rather than silently falling back to a plain import.',
      'Only one import may run at a time within the same running app process.',
    ],
    actions: [
      { label: 'Run Import', description: 'Starts a new import for the given scope, either a plain import or an update/backup import of only what changed.' },
      { label: 'Pause / Resume (in-run)', description: 'Pauses or resumes a currently-running import within the same app session.' },
      { label: 'Resume from Checkpoint', description: 'Resumes an interrupted import from its own saved on-disk progress after an app restart, instead of starting over.' },
      { label: 'Verify Import', description: 'Separately-invoked checksum verification of imported files against source.' },
    ],
    behavior: 'A missing file at the destination is copied; an identical-size match is skipped as already present; a same-named file with a different size is safely renamed in a plain import, or left untouched and flagged as changed in an Update Import. A durable record of what happened to every file is kept, which later feeds AutoIngest\'s post-transfer metadata verification. How AutoIngest matches an incoming event folder to its destination differs by transfer layout: loose event folders sitting directly on the transfer drive are matched by their actual content identity against the whole main archive, so a renamed folder is still recognized correctly, and an ambiguous match is excluded rather than guessed at. Folders that mirror the archive\'s own nested Collection/Event structure, however, are currently matched by folder name only and do not benefit from that same content-identity matching — a confirmed gap against the intended behavior for that specific case, not a documentation error.',
    recovery: 'Yes — Transfer Import has its own independent resume mechanism, symmetric with Transfer Export\'s and equally real, not merely inherited from it. If interrupted (app crash, forced quit, power loss), it can resume from its own saved on-disk progress rather than starting the whole import over. Progress is tracked per batch: on resume, batches that already fully finished are skipped, and the import continues from the first batch that hadn\'t completed. Resume also confirms it is resuming against the same transfer source it originally started from, refusing to resume against a mismatched one. AutoIngest also keeps track of whether its own progress-saving is currently working correctly; if a progress save fails, that specific import may not be safely resumable from exactly where it left off if interrupted right after (files that already finished copying are unaffected either way), and a repeated save failure is recorded once, not repeatedly.',
    relationships: [
      // Stage 2.1 correction (2026-09-04, see DEC-024): this edge previously
      // read `type: 'precedesInWorkflow'`, independently asserting "Import
      // precedes Export" under this corpus's own established
      // subject-first-ordering convention for that edge type -- directly
      // contradicting Export's own correctly-encoded precedesInWorkflow
      // edge (AI-FEAT-038 -> AI-FEAT-039) and this record's own note text
      // ("Import reads what Export wrote", i.e. Export happens first).
      // Corrected to `relatedTo`, matching this corpus's own established
      // single-edge convention for precedesInWorkflow (the temporal fact is
      // asserted once, on the earlier record -- see AI-FEAT-019/AI-FEAT-026
      // for the same pattern) -- a non-directional back-reference to the
      // SAME fact Export's own edge already establishes, never a second,
      // independent (and here, backwards) ordering claim.
      { type: 'relatedTo', targetId: 'AI-FEAT-038', note: 'Import reads what Export wrote to the Transfer Drive. The temporal ordering (Export happens before Import) is asserted once, on Export\'s own precedesInWorkflow edge; this is a non-directional back-reference to that same fact, not an independent ordering claim.' },
      { type: 'distinctFrom', targetId: 'AI-FEAT-040', note: 'Transfer Import is a separate service (transferImportService.js) from Backup Update Scanning, which lives inside transferExportService.js as a mode of export/scan — Update Import (scope.backupUpdate within transferImportService.js) consumes a prior scan\'s approved worklist but is not the same code as AI-FEAT-040.' },
    ],
    limitations: [
      'Collection-nested transfers resolve destination by folder name only, not by the content-based identity key that direct-Event transfers use — a confirmed gap against stated product intent, not yet fixed.',
      'event.json itself is never field-merged in either resolution path: if source and destination both have an event.json for the same event, the destination\'s always wins; a differing incoming one is skipped (if byte-identical) or side-tracked as skipped-changed, never reconciled field-by-field.',
      'Update Import refuses to run if the reviewed scan is stale (fingerprint mismatch) rather than falling back to plain-import behavior.',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'Checkpoint file: {mainArchiveRoot}/.autoingest/transfer-imports/import-checkpoint.json (services/transferImportService.js:44-45,280-282). resumeImportFromCheckpoint() (services/transferImportService.js:1264-1311) requires checkpoint.transferRoot === transferRoot and checkpoint.status !== "complete"; batches with status==="complete" are skipped. Destination identity resolution: _resolveEventDestination / _eventIdentityKey (services/transferImportService.js:393-401,456-545).',
    provenance: [
      { claim: 'recovery: independent per-batch checkpoint/resume mechanism for Transfer Import, symmetric with Transfer Export', source: 'services/transferImportService.js:44-45,280-282 (checkpoint path/const), :284-314 (_writeCheckpoint incl. checkpointHealthy tracking), :848-862 (_finishImport writes complete checkpoint), :951-989 (plain-mode per-batch checkpoint writes), :963 (skip completed batches), :1050-1112 (update-mode per-batch checkpoint writes), :1074 (skip completed batches), :1264-1311 (resumeImportFromCheckpoint)', type: 'code', confidence: 'high' },
      { claim: 'checkpoint write-health tracking (checkpointHealthy/checkpointError)', source: 'services/transferImportService.js:72-79 (_state fields), :294-313 (set on write success/failure)', type: 'code', confidence: 'high' },
      { claim: 'identity-based destination resolution for direct-Event vs Collection-nested transfers, and the confirmed gap for Collection-nested', source: 'services/transferImportService.js:393-401 (_eventIdentityKey), :420-440 (_buildArchiveIndex), :456-545 (_resolveEventDestination), :666-755 (_resolveImportUnits, folder-name-only path for Collection-nested via _resolveLegacyCollectionUnits, :643-664)', type: 'code', confidence: 'high' },
      { claim: 'per-file outcome manifest feeding post-transfer metadata verification', source: 'test/transferImportOutcomeManifest.test.js; services/transferImportService.js:125-150,909-922', type: 'test', confidence: 'high' },
      { claim: 'IPC surface for run/pause/resume/checkpoint operations', source: 'main/main.js:4702 (runImport), :4714-4717 (status/pause/resume), :4722-4736 (checkpoint get/clear/resume)', type: 'code', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },

  // ── AI-FEAT-040 — Backup Update Scanning ───────────────────────────────────
  {
    id: 'KM-backup-update-scanning',
    featureId: 'AI-FEAT-040',
    title: 'Backup Update Scanning',
    aliases: ['scan for backup update', 'backup sync scan', 'update backup', 'backup update mode'],
    purpose: 'A read-only pre-copy diff mode that compares a selected source scope against a connected external backup destination by relative path, classifying every file (new / existing-same / changed / incomplete / destination-only / error) without copying anything — so an operator can review exactly what an "Update Backup" run would do before running it.',
    operatorWorkflow: [
      'Select source scope and connect the backup destination.',
      'Run the scan (scanBackupSync) to see counts and per-item detail for new, changed, up-to-date, incomplete, and destination-only files, plus any detected folder renames.',
      'Review the scan results, including any suggested rename matches (sequence-prefix or content-overlap based).',
      'Run "Update Backup" (backupUpdate mode of Transfer Export/Import) to copy only what the scan identified as missing.',
    ],
    preconditions: [
      'Source and destination roots configured, mounted, and not overlapping.',
      'Destination root must exist and be a readable directory (or the scan reports transfer-root-unavailable).',
    ],
    actions: [
      { label: 'Scan for Backup Update', description: 'A read-only comparison scan; it never copies or changes anything.' },
      { label: 'Run Update Backup', description: 'Copies only what the scan identified as missing, using the reviewed results from the scan.' },
    ],
    behavior: 'The update/backup copy step is deliberately more cautious than a standard Transfer Export or Import: it never overwrites a file and never creates a renamed duplicate — a file with the same path but a different size is left completely untouched and flagged as "changed" for the operator to review manually; only files that are genuinely missing at the destination are copied. It supports custom source/destination folder pairs, not only the standard archive-to-transfer-drive path. It also detects likely folder renames (so a renamed source folder isn\'t mistaken for new content when a matching folder already exists at the destination), and confirms a resumed scan is still working against the same source device it started from.',
    recovery: 'The scan itself has nothing to checkpoint or resume — it is read-only and simply re-runs from scratch each time it\'s invoked, so an interrupted scan just means running it again. The copy step that follows ("Update Backup") is not a separate mechanism — it is the same underlying copy process Transfer Export and Transfer Import use, so it gets the exact same resume-after-interruption behavior described for those features.',
    relationships: [
      { type: 'uses', targetId: 'KM-transfer-export', note: 'Backup Update Scanning\'s copy step is literally backupUpdate mode inside transferExportService.js — same checkpoint mechanism, same file.' },
      { type: 'relatedTo', targetId: 'KM-transfer-import', note: 'Update Import (scope.backupUpdate in transferImportService.js) is the import-side counterpart consuming a prior scan\'s approved worklist.' },
    ],
    limitations: [
      'Item lists returned by the scan are capped at 500 items per group for the IPC payload (SCAN_ITEM_CAP); counts and byte totals remain exact beyond the cap, but the item array is truncated.',
      'Rename detection only suggests a match when exactly one candidate clears the scoring threshold — ambiguous matches (more than one candidate above threshold) are never auto-suggested.',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'IPC: archive:scanBackupSync (main/main.js:4547) → transferExportService.scanBackupSync() (services/transferExportService.js:1201). backupUpdate branch in _copyFileSafe: services/transferExportService.js:128-141 (export) and services/transferImportService.js:181-188 (Update Import). Rename-match scoring: services/transferExportService.js:1107-1167 (_scoreSubfolderMatch), :1316-1448 (rename-match orchestration in scanBackupSync).',
    provenance: [
      { claim: 'scanBackupSync is stateless/read-only with no checkpoint of its own; the copy step reuses Transfer Export/Import\'s own checkpoint mechanism', source: 'services/transferExportService.js:1201-1464 (scanBackupSync — no checkpoint writes present), :128-141 (backupUpdate branch of _copyFileSafe, same _doExport/checkpoint path as standard export)', type: 'code', confidence: 'high' },
      { claim: 'stricter no-mutation conflict semantics for backupUpdate mode', source: 'services/transferExportService.js:57,128-141; services/transferImportService.js:181-188', type: 'code', confidence: 'high' },
      { claim: 'backupUpdate mode identity and IPC channel', source: 'main/main.js:4547 (archive:scanBackupSync); features/AI-FEAT-040_BACKUP_UPDATE_SCANNING.md', type: 'code', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },

  // ── AI-FEAT-045 — Archive Lock Handling & Stale-Lock Recovery ─────────────
  {
    id: 'KM-archive-lock-handling',
    featureId: 'AI-FEAT-045',
    title: 'Archive Lock Handling & Stale-Lock Recovery',
    aliases: ['archive lock', 'stale lock', 'lock error', 'archive locked', 'stuck lock', 'clear lock'],
    purpose: 'Photographer-level write locks for Direct Archive imports, preventing two concurrent imports from writing into the same event/photographer folder simultaneously, with automatic detection and operator-facing recovery when a lock is stale (its owning process crashed or was killed without releasing it).',
    operatorWorkflow: [
      'Normal operation is invisible: a lock is acquired automatically at the start of a Direct Archive import into a given photographer folder and released automatically when the import completes.',
      'If an operator sees a "locked" error, it means an active, non-stale lock is currently held (by this device or another) for that exact collection+event+photographer combination.',
      'If the lock is genuinely stale (its owning process is gone), the Archive Diagnostics repair UI (AI-FEAT-043) surfaces it and offers a release action.',
      'For a lock this same device created, "clear own stale lock" can be used, but only after a heartbeat-recency guard confirms no process is still actively renewing it.',
    ],
    preconditions: [
      'A lock is scoped to exactly one (collection, event, photographer folder) triple — locks on other photographer folders in the same event are unaffected.',
      'A lock is considered active (blocking) only while its TTL has not expired; once expiresAt has passed it is stale and eligible for recovery.',
    ],
    actions: [
      { label: 'Check locks', description: 'A quick, non-disruptive check of whether an active lock currently blocks writing to a given collection/event/photographer folder.' },
      { label: 'Clear own stale lock', description: 'Clears a lock that this same device created, but only once AutoIngest has confirmed the lock is genuinely stale and no longer being actively renewed by a live process on this device.' },
      { label: 'Release stale lock (Diagnostics repair)', description: 'From Archive Diagnostics, releases a stale lock regardless of which device created it, double-checking right before removal that it hasn\'t become active again in the meantime.' },
    ],
    behavior: 'Each lock is scoped to one specific collection/event/photographer combination, so locking one photographer\'s folder never blocks work on a different photographer in the same event. A lock automatically expires after 30 minutes unless it is actively renewed, which happens roughly every 5 minutes while the import holding it is still running — so a lock only outlives its own import if that import genuinely crashed or was killed. Acquiring a lock is a safe, all-or-nothing operation: an active lock always blocks a conflicting new import outright rather than being silently overwritten, while an expired (stale) lock can be safely claimed by a new attempt. Releasing a lock is safe to attempt even if it\'s already gone — that is simply treated as already released, not an error.',
    recovery: 'Yes — this is precisely the recovery an operator uses for a stale archive lock error. There are two ways to recover, and both refuse to act on a lock that is still genuinely active (a live lock is always left alone): first, if the lock was created by this same device, the operator can clear it directly, but only once AutoIngest has confirmed the device isn\'t still actively using it — recently-active locks are refused unless the operator explicitly confirms no job is actually running. Second, Archive Diagnostics can release a stale lock regardless of which device created it, and double-checks immediately before removing it that the lock hasn\'t become active again in the meantime, so a lock that starts being used again right as it\'s being cleared is never pulled out from under a real, running job. A lock is never automatically deleted just because it expired — expiring only means a new import is now allowed to claim it; the old lock record stays in place until one of these two recovery actions (or a fresh successful lock) replaces it.',
    relationships: [
      { type: 'distinctFrom', targetId: 'AI-FEAT-038', note: 'Confirmed per DEC-021: Transfer Export\'s process-local _state.running guard shares no mechanism with this durable, SHA1-keyed, TTL+heartbeat lock. This lock governs Direct Archive photographer-folder writes, not Transfer Export.' },
      { type: 'uses', targetId: 'AI-FEAT-043', note: 'Stale locks are surfaced and released through the Archive Diagnostics repair UI.' },
    ],
    limitations: [
      'Lock scope is photographer-folder-level only — it does not protect at the event or collection level beyond that.',
      'The "clear own stale lock" action only ever clears locks created by this exact device — it cannot force-clear another device\'s lock; only the Archive Diagnostics release action (which still requires the lock to be genuinely stale) can do that.',
      'A lock file that never becomes stale (its owning process keeps renewing the heartbeat) cannot be released by either recovery path while it remains active — this is by design, not a bug.',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'Lock key: SHA1(collection + "\\x00" + eventFolderName + "\\x00" + photographerFolderName).slice(0,16) (services/archiveLockService.js:36-39). Lock file path: {activeArchiveRoot}/.autoingest/locks/<lockKey>.json (services/archiveLockService.js:28,44-47). TTL = 30 min, heartbeat interval = 5 min (services/archiveLockService.js:29-30). clearSelfLock: services/archiveLockService.js:177-211. releaseStaleLock: services/archiveLockService.js:227-252. Path-safety guard: services/archiveLockService.js:259-274. IPC: main/main.js:3665 (checkDirectArchiveLocks), :3686 (clearSelfStaleLock), :4808 (releaseStaleLock).',
    provenance: [
      { claim: 'lock key derivation, TTL, heartbeat interval, atomic acquire', source: 'services/archiveLockService.js:28-39 (constants, _lockKey), :56-107 (acquireLock)', type: 'code', confidence: 'high' },
      { claim: 'recovery: two distinct stale-lock release paths (own-device clearSelfLock vs any-device releaseStaleLock via Diagnostics), their exact ownership/heartbeat/TOCTOU guards, and idempotent release semantics', source: 'services/archiveLockService.js:143-149 (releaseLock idempotency), :163-211 (clearSelfLock), :213-252 (releaseStaleLock), :259-274 (_isValidLockPath)', type: 'code', confidence: 'high' },
      { claim: 'IPC surface for lock check/clear/release, and Diagnostics repair UI surfacing', source: 'main/main.js:3665,3686,4808; main/preload.js:243-244,296', type: 'code', confidence: 'high' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },

  // ── AI-FEAT-046 — Archive Folder Adoption ──────────────────────────────────
  {
    id: 'KM-archive-folder-adoption',
    featureId: 'AI-FEAT-046',
    title: 'Archive Folder Adoption',
    aliases: ['adopt folder', 'adopt existing folder', 'manual folder adoption', 'register manual folder', 'bring folder under management'],
    purpose: 'Registers a single pre-existing, manually-created archive folder as an AutoIngest-managed event by writing a minimal event.json into it — without moving, renaming, or restructuring any media. Serves both legacy-archive migration (folders that predate AutoIngest) and ongoing adoption of externally-created event folders.',
    operatorWorkflow: [
      'Identify a manually-created folder inside a configured archive root that is not yet AutoIngest-managed (no event.json).',
      'The folder name must already follow the naming convention (parseable as "<hijriDate> <sequence> <rest>") — folders that don\'t are not adoptable candidates.',
      'Confirm/adjust the hijriDate and sequence values presented for adoption.',
      'Adopt the folder; AutoIngest writes a minimal event.json into it, at which point it becomes a normal managed event.',
      'Adoption is reversible by deleting the written event.json (returns the folder to its pre-adoption, unmanaged state).',
      'Repeat one folder at a time for additional candidates — there is no bulk/batch adoption action.',
    ],
    preconditions: [
      'The folder must exist, be a directory, and be located under a currently-configured archive root (Active Archive, Main Archive, or Transfer Root).',
      'The folder must not already have an event.json (adoption is blocked outright if one is present).',
      'The folder name must match the AutoIngest naming pattern via FULL_RE (services/adoptionWriteService.js:30): "<YYYY-MM-DD> <sequence> <rest>".',
      'The folder name must not be a protected internal name (_Selected, .autoingest, etc.) or a recognized external/non-event name (To-Give, Exports, Clients, etc.).',
      'collectionPath supplied by the caller must be the immediate parent directory of folderPath.',
    ],
    actions: [
      { label: 'Adopt Folder', description: 'Validates one candidate folder and writes its event record, one folder per action — there is currently no way to adopt several folders in a single action.' },
      { label: 'Dry-run adoption preview', description: 'Checks a candidate folder against every adoption requirement and reports a readiness classification (Ready / Needs review / Blocked / Not adoptable) without writing anything.' },
    ],
    behavior: 'The event record is written safely in one atomic step, so it either ends up fully written or not written at all — never left half-written. The newly-adopted event starts with no file components populated (adoption does not scan the folder\'s contents at that point). Everything the operator provides is independently re-checked against the actual folder on disk before anything is written, including a last check that no event record already exists right before the write happens. AutoIngest also checks nearby folders for another one already claiming the same date and sequence, and blocks the adoption if it finds one, to avoid creating two events that claim to be the same thing.',
    recovery: 'There is nothing to resume here, and the reason is structural: adoption is a single, safe, all-or-nothing write to one file, not a multi-step or multi-file operation the way Transfer Export or Import are. If interrupted before that write finishes, the folder is left exactly as it was — with no event record — so it simply remains a normal, un-adopted candidate and the operator can retry the same adoption action with no cleanup needed. If interrupted after the write finishes, adoption has already fully completed. Because adoption never has partial, in-progress state the way a multi-file transfer does, "resuming" isn\'t a meaningful concept here — retrying (if needed at all) is always safe.',
    relationships: [
      { type: 'distinctFrom', targetId: 'AI-FEAT-047', note: 'Conceptually distinct from QMZ-internal unsequenced-folder adoption (AI-FEAT-047), which adopts folders into QMZ\'s own _Unsequenced bucket, not the archive-wide event registry.' },
    ],
    limitations: [
      'No bulk adoption — events are adopted one at a time; there is no way to select and adopt multiple folders in a single action. This is also a documented, known limitation, not just an implementation detail.',
      'Supports ready candidates only — folders already following the naming convention; a folder whose name does not match FULL_RE is not adoptable through this path at all.',
      'The written event.json\'s components: [] is not populated from an actual content scan at adoption time.',
    ],
    status: STATUS.IMPLEMENTED,
    technicalDetail: 'IPC: archive:adoptManualFolder (main/main.js:4845, single-object input with one folderPath — main/preload.js:295) → adoptionWriteService.adoptFolder() (services/adoptionWriteService.js:63-257). Atomic write: services/adoptionWriteService.js:225-254 (tmp write, second absence check, rename). Folder-name pattern: FULL_RE, services/adoptionWriteService.js:30.',
    provenance: [
      { claim: 'single-folder-at-a-time adoption call shape confirms "no bulk adoption"', source: 'main/preload.js:295 (adoptManualFolder: (input) => ...); main/main.js:4845 (ipcMain.handle(\'archive:adoptManualFolder\', async (_event, input = {}) => ...)); services/adoptionWriteService.js:63-70 (adoptFolder(input, ...) destructures a single folderPath)', type: 'code', confidence: 'high' },
      { claim: '"No bulk adoption: events are adopted one at a time" documented limitation', source: 'docs/archive-operations-layer.md § Known Limitations', type: 'doc', confidence: 'high' },
      { claim: 'recovery: atomic single-file write with no batch/checkpoint concept — interruption before rename leaves the folder unadopted and retryable; after rename, adoption is already complete', source: 'services/adoptionWriteService.js:225-254 (atomic tmp-write/second-check/rename sequence, no batching or checkpoint code present anywhere in this file)', type: 'code', confidence: 'high' },
      { claim: 'atomic write and components:[] by design', source: 'services/adoptionWriteContract.js:27 ("Write atomically: write to jsonPath + \'.tmp\', then fsp.rename(tmp, jsonPath)"); docs/archive-adoption-contract.md ("Phase 13C-7 — Implemented... the written event.json deliberately has components: [] by design")', type: 'code', confidence: 'medium' },
    ],
    extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
  },
];

module.exports = { RECORDS };
