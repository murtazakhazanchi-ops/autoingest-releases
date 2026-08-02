# AutoIngest Metadata System

## Purpose
Metadata is applied after successful import only, never before copy. Copy failures never block on metadata; metadata failures never block or roll back a copy.

## Core Rules
- Import first, metadata second.
- event.json remains source of truth. Metadata state lives in its own `metadataState` block inside event.json, written exclusively through `updateEventJsonAtomic` (`main/eventJsonStore.js`) — no writer performs an independent read-modify-write.
- Metadata writes are idempotent — guaranteed jointly by this app's logic (the resolver produces the same, already-deduplicated keyword array from the same evidence every time) and by ExifTool's own tag-assignment semantics (a plain tag write replaces the value, it does not append). Re-running a write never duplicates keywords.
- Never block file copy because metadata failed.
- Failed metadata jobs are retryable and durably recorded — an unclean exit is recovered from automatically on next launch (see Durable Queue below).
- A metadata write's own mtime bump is expected, not a bug — see Repair One-Shot Behavior below.

## Supported File Types
- JPEG/TIFF and other direct-writable formats — tags written directly (`-overwrite_original`).
- RAW formats — tags written to an XMP sidecar placed beside the RAW file, created if missing, updated in place (merged, never deleted/recreated) if present.
- Videos — intentionally excluded from tagging entirely. Never counted as a failure; classified `excluded` everywhere (queue, audit, state counts).

## Metadata Fields Owned by AutoIngest
The complete, current field set — the single authority for this list is `services/metadataExpectationService.js`'s resolver output, which every other stage (write, verify, audit, repair) must stay in sync with (see Field Consistency below):

- **Photographer / Creator** — `EXIF:Artist`, `IPTC:By-line`, `XMP-dc:Creator`
- **Copyright** — fixed value `© Aljamea-tus-Saifiyah`, written to `XMP-dc:Rights` and (direct images only) `IPTC:CopyrightNotice`/`IPTC:Credit`
- **Keywords** — component type(s) + location + city + country, deduplicated case-insensitively; `XMP-dc:Subject` always, `IPTC:Keywords` for direct images only (ExifTool silently drops IPTC writes to standalone `.xmp` sidecars, which have no IPTC binary segment)
- **Location, City, Country** — `XMP-iptcCore:Location`/`XMP-photoshop:City`/`XMP-photoshop:Country`, and (direct images only) `IPTC:Sub-location`/`IPTC:City`/`IPTC:Country-PrimaryLocationName`
- **Hijri date** — `XMP-ajs:HijriDate` (custom namespace, registered via `main/exiftool-config.pl`), written only when present on the event
- **Description / Caption** — the event's `eventName` (never the full folder name, never the Collection name), written to `XMP-dc:Description` always and `IPTC:Caption-Abstract` for direct images only

**Explicitly never written by any AutoIngest metadata path:** `DateTimeOriginal`, `CreateDate`, `ModifyDate`, or any other capture-date/timestamp field. No AutoIngest metadata operation — write, repair, resume, or otherwise — modifies a file's capture date, ever. This is enforced by construction: the tag-building function (`exifService.js`'s `_buildTags`) never includes a date field in the map it hands to ExifTool.

**Not currently implemented:** Gregorian date. The spec previously listed this as an expected field; it is deliberately deferred (no authoritative conversion utility or Gregorian-date source field currently exists in event.json) rather than guessed. Adding it is a real, documented gap — see Non-Goals.

**Sequence codes are never keywords.** QMZ sequence-folder codes (e.g. `01Q`, `02M`, `03Z`) are folder-naming convention only — they are never included in the keyword set, at any entry point, by construction (the resolver never reads folder-sequence-code segments as evidence). Verified live, through the real UI, reading real ExifTool tags back.

## Keyword Rules
- Component-derived keywords only (event type(s) + location + city + country).
- No collection name, no full event folder name, no photographer name as a keyword, no QMZ sequence code as a keyword.
- Deduplicated case-insensitively at write time. A pre-existing on-disk duplicate (e.g. a leftover from before this system existed) is detected and reported by the audit scanner, not silently masked by a naive set comparison.

## Multi-Component Rules
- Each group/sub-event gets its own metadata (component-specific location/city/country/type keywords).
- Files are matched to their sub-event via `event.json`'s `diskComponents`/`group.subEventId` ↔ `component.folderName`, or (for files that never passed through a renderer-built group selection — Transfer Import, resume, audit) via folder-structure reconstruction (`services/eventEvidenceReconstruction.js`).
- A file that cannot be matched to exactly one component in a multi-component event is `ambiguous` — never guessed, never auto-repaired, always surfaced for manual review.

## RAW + Sidecar Rules
- XMP sidecar created only if the destination RAW file exists; created fresh if missing, merged into in place if present — never deleted and recreated.
- Pre-existing unrelated sidecar fields (e.g. `Rating`, `Instructions`) survive every write path, including repair specifically (proven by a dedicated repair-path regression test, not only the original import write path).
- Reading a RAW file's own embedded tags never shows sidecar-only content, and verification always reads the sidecar path it actually wrote to — this distinction is proven by a dedicated test (`test/rawXmpReadback.test.js`), not assumed.
- Sidecar filename matches the RAW filename (same base name, `.xmp` extension).

## The Shared Write Engine
There is exactly one code path in this codebase allowed to call an ExifTool write operation: `main/exifService.js`. Every writer — Standard Import, QMZ (both entry points), Reapply, crash-recovery resume, and Repair — is a consumer of that one engine (`applyBatch` for a fresh resolve, `resumeFrozenFile` for a previously-frozen expectation). No workflow implements its own write call. The engine's shape is always `Expected → Write → Read Back → Compare → Result`: a resolved expectation is turned into an ExifTool tag map, written, then a bounded read-back of only the fields just written is compared against the expectation, producing a `complete`/`partial`/`failed` classification — a write is never marked successful merely because the ExifTool process launched.

`services/metadataExpectationService.js` is the only place "what metadata should this file have" is computed (the resolver). It is versioned (`METADATA_CONTRACT_VERSION`, `RESOLVER_VERSION`) so future field/logic changes are traceable in every durable record that carries these versions (queue manifests, audit reports, repair results).

## Durable Queue Storage and Recovery Behavior
Metadata batches are durable, not in-memory-only. Under `app.getPath('userData')/metadata-queue/`:
- **`{batchId}.manifest.json`** — written once, atomically (temp-file + rename), before any file in the batch is processed. Immutable thereafter — the frozen record of what should happen, including each file's frozen expectation.
- **`{batchId}.journal.jsonl`** — append-only, one line per per-file status transition (`writing` → `complete`/`partial`/`failed`/`excluded`/`stale`). Small atomic appends, never a full-document rewrite. A corrupt/torn trailing line (e.g. from a crash mid-append) is quarantined to a sibling `.quarantine` file and logged — never silently dropped, never fatal to reading the rest.

**Startup recovery**: `main/metadataQueueRecovery.js`'s `resumeInterruptedBatches()` runs once, 3 seconds after app launch (deliberately after the splash screen, non-blocking). It replays every active batch's manifest+journal, normalizes any file left in a non-terminal `writing` state to `interrupted`, and resumes it via the same shared write engine (`resumeFrozenFile`) — a resumed write is always a safe, verifiable no-op or a genuine completion, never a duplicate. Before resuming, it runs one safety comparison: it rebuilds the file's evidence from the *current* `event.json` (not a replay of the frozen evidence, which would trivially always match itself) and compares the freshly-resolved expectation against the frozen one. If they materially differ — e.g. an operator edited the event's component location between queuing and the crash — the file is marked `stale` (re-audit required) rather than silently rewritten with a different value. This exact scenario (real crash-and-relaunch via a genuine process kill, not only a hand-constructed simulation) has been verified live: a real `SIGKILL` mid-batch, followed by a fresh app launch, correctly recovers every interrupted file with zero duplicate keywords and zero lost work.

**Compaction and retention**: once an event's `metadataState` durably reflects a batch's outcome, that batch's manifest+journal are moved to `metadata-queue/compacted/` — never deleted before that point, so an interruption between "batch finished" and "state persisted" never loses visibility of the outcome. Compacted files are retained for **90 days** (`metadataQueueStore.COMPACTED_RETENTION_MS`, the single named constant defining this) and then best-effort pruned by a background sweep that runs after the startup resume pass — bounded to the `compacted/` directory only, never touching active manifests/journals, never blocking startup, logging (not throwing on) any individual deletion failure.

## Event-Level Metadata State
An event's `metadataState.state` is always a pure derivation from durable per-file counts (`metadataState.counts`) — recomputed fresh every time it's needed, never a field one callback happens to overwrite last. The nine mutually-exclusive states, evaluated in this fixed order (each condition, given the ones before it were false, is exclusive of them by construction):

1. `metadata-not-required` — no eligible files at all (e.g. a video-only import, or an event that predates this system with nothing ever queued for it).
2. `metadata-interrupted` — unfinished work recovered after an unclean exit.
3. `metadata-in-progress` — work actively writing right now.
4. `metadata-complete` — every eligible file read-back-verified complete.
5. `metadata-partial` — at least one file complete and at least one incomplete/failed/ambiguous/stale/unverified. (A file whose write succeeded but whose read-back found a field mismatch — `partial` — is folded into this "incomplete" bucket for state purposes; it never counts toward `metadata-complete`, so a batch with real field mismatches is never reported as fully compliant.)
6. `metadata-failed` — no file complete, at least one failed.
7. `metadata-verification-required` — nothing complete/failed/queued, but something unverified remains. This is where Transfer Import and same-size-skip files land until their post-hoc read-only verification pass runs.
8. `metadata-queued` — durably queued but not yet active.
9. `metadata-not-attempted` — eligible files exist, nothing attempted at all.

Video-excluded files never contribute to any count above `excluded`.

## Import Path Coverage
| Path | Metadata behavior |
|---|---|
| Standard Import (single/multi-component) | Synchronous write via the shared engine as part of the same import transaction |
| QMZ (auto-assign and manual "Queue Metadata", both entry points) | Synchronous write via the shared engine |
| Reapply | Synchronous write via the shared engine |
| Transfer Import / Update Import | Files land via copy only; a durable per-file outcome manifest records what happened, and a post-transfer read-only verification pass (never a destination-folder walk, which can't distinguish this transfer's files from unrelated pre-existing content) classifies each `copied`/`same-size-skipped`/`renamed`/`resumed` file — `failed`/`changed-skipped` outcomes are excluded from verification entirely. Auto-repair of anything found incomplete is gated on the metadata setting; otherwise it lands in `metadata-verification-required` with a "Verify Metadata" action |
| Same-size-skip (Standard Import) | The pre-existing destination file's metadata was never checked by the copy step itself — read-only verification runs regardless of whether this import's own copy batch had metadata enabled |
| Resume after app restart | Durable queue replay, see Durable Queue Storage above |
| Metadata Repair | See Repair below |
| **Quick Import** | **Intentionally metadata-blind — see Non-Goals** |

## Repair
`main/metadataRepairService.js` consumes a Metadata Audit job's **frozen snapshot only** — it never re-resolves against live state. Before any write, a real staleness guard compares the current file's size/mtime against what the snapshot recorded at audit time; a drifted file is skipped with a "re-audit required" note, never silently overwritten. Preview is exhaustive (current value, expected value, exact fields to change) and requires an explicit operator confirmation before any write. Execution goes through the shared write engine (`resumeFrozenFile`), so it inherits the same durable manifest+journal crash recovery as every other batch, and the same keyword-non-duplication guarantee.

### Repair Is One-Shot Per Audit Snapshot
A successful metadata write — including a repair write — always updates the target file/sidecar's mtime, even when the values written are unchanged from a prior write. This is ExifTool's own behavior (a tag write is a full write+rename of the file), not an AutoIngest choice. Consequence: **running Repair a second time against the same audit snapshot will correctly show the just-repaired files as stale** ("file changed since the audit ran") and skip them — that is the staleness check protecting against a duplicate/blind write, not a repair failure. To repair the same scope again, run a fresh audit first. This is stated directly in the Repair Preview UI (`#maRepairSnapshotNote`) at the point of use.

### Repair Traceability
Every repair result (returned synchronously and durably persisted, retrievable via `getMetadataRepairResult`) records: the source `auditJobId`; a `snapshotIdentity` (archive-root identity plus the contract/resolver versions the audit recorded at scan time — the exact ground truth the write decisions trace back to); `startedAt`/`completedAt`; `approved`/`stale`/`eventUnreadable`/`written` counts; and `complete`/`partial`/`failed` outcome counts. It also records `previewGeneratedAt`/`previewedInThisSession` — honest, not fabricated: `previewedInThisSession` is true only if `previewMetadataRepair` was actually called for this exact audit job earlier in the current process's lifetime. **Known limitation**: the current UI does not preserve a preview-session identifier that survives the round trip from Preview to Confirm, so this cannot prove which specific UI click-through produced a given repair run — only that a preview was generated for this job at some point in this session. Closing this fully would require a UI-level preview-session token, not implemented here.

## Field Consistency Across Stages
Six independent places in the codebase must agree on the metadata field set: the resolver's output (`metadataExpectationService.js`), the tag builder (`exifService.js`'s `_buildTags`), the read-back comparator (`exifService.js`'s `_compareReadback`), the resume staleness comparator (`metadataQueueRecovery.js`'s `_expectationsEqual`), the audit's field-diff classifier (`metadataAuditService.js`'s `classifyOneFile`), and the audit CSV export's column list (`metadataAuditExport.js`'s `CSV_FIELD_COLUMNS`). Nothing currently *structurally* enforces these six stay in sync — a `test/fieldSpecsConsistency.test.js` defensive test behaviorally verifies all six against the resolver's real field set and fails if a future field is added to one stage but forgotten in another. This is an interim guardrail, not a structural fix; consolidating all six into one shared field-specification table is a documented follow-up (see Non-Goals).

## Metadata Audit
`services/metadataAuditService.js` — read-only, streaming, resumable, cancellable. Never writes a file, never calls an ExifTool write operation. Results stream to JSONL incrementally (never fully buffered in memory); a small state file commits only at event boundaries, so a resume at worst re-scans the one event in flight when the process stopped (safe — read-only and idempotent) and never duplicates or omits a fully-scanned event, including when the interruption lands mid-event rather than at a clean boundary. Per-file classification is duplicate/case/whitespace-aware for keywords (a naive set comparison cannot detect an on-disk duplicate; this scanner retains the original array). Exports to JSON, JSONL, or CSV (RFC 4180-correct escaping), each streamed with a temp-then-rename write and carrying reproducibility metadata (contract/resolver versions, archive-root identity, scan timestamp).

Live-verified: the original root-cause bug this entire system was built to fix (QMZ silently dropping keywords/Hijri date due to a context-shape mismatch) has been proven fixed end-to-end through the real UI, not only via unit tests — Creator, Copyright, keywords, location/city/country, and Hijri date all confirmed correct via real ExifTool read-back, with sequence codes confirmed absent from keywords.

## Non-Goals
This system intentionally does not solve:
- **Quick Import metadata coverage.** Quick Import is deliberately staging-only, non-archival: it creates no `event.json`, so its files are permanently outside Metadata Audit's coverage (the scanner's traversal is gated on `event.json` presence at every level) and are never eligible for event-based Metadata Repair. This is communicated directly in the Quick Import UI. If Quick Import content is ever intended as final archival ingest, that requires a deliberate design decision, not a Quick Import change.
- **Scheduled or automatic background auditing.** Audits are always explicitly operator-triggered over an explicitly-selected scope; nothing scans the archive on a timer.
- **Metadata rollback/history.** Repair overwrites forward; there is no undo beyond re-auditing and re-repairing with corrected inputs.
- **Gregorian date.** Deferred pending an authoritative conversion utility or source field — see Metadata Fields above.
- **A structural fix for the six-site field-consistency problem.** A `FIELD_SPECS`-style shared table (one definition, six consumers map over it) is the correct long-term fix; only a defensive test exists today (see Field Consistency above).
- **Distributed/multi-machine metadata processing.** The queue, audit, and repair systems all assume a single desktop app instance and one local ExifTool process pool.
- **True archive-scale (10,000+ event) end-to-end timing verification.** Performance characteristics have been measured and extrapolated from smaller synthetic scales (hundreds of events/files) with real ExifTool round-trips, not run against a true production-scale archive.
- **QMZ driven live through every possible UI variation.** The primary QMZ flow (assign → auto-queue metadata) has been verified live through the real UI; less common paths through the QMZ Sequence Manager have not each been individually driven live.

## UI States
- Metadata pending / not attempted
- Metadata applying (in progress)
- Metadata complete
- Metadata partial (with per-field mismatch detail available via audit)
- Metadata failed
- Metadata interrupted (recovering)
- Metadata verification required (with a "Verify Metadata" action)
- Metadata queued
- Retry failed button

## Audit Log
- Who applied metadata (photographer/operator attribution, where applicable)
- When metadata was applied (`lastMetadataRun`, queue journal timestamps)
- Which files succeeded/partial/failed/ambiguous/excluded, with the underlying ExifTool error where relevant
- Full field-level diff (expected vs. actual) available via the Metadata Audit report, not just a pass/fail flag

## Implementation Files
- `services/metadataExpectationService.js` — the resolver (only place expectations are computed)
- `main/exifService.js` — the shared write engine (only place ExifTool write operations happen)
- `main/eventJsonStore.js` — the only sanctioned `event.json` read-modify-write
- `main/metadataQueueStore.js` — durable manifest+journal persistence and retention pruning
- `main/metadataQueueRecovery.js` — startup crash recovery
- `main/metadataStateService.js` — event-level state derivation
- `main/metadataVerificationService.js` — read-only verification for Transfer Import / same-size-skip
- `services/eventEvidenceReconstruction.js` — shared folder-structure evidence reconstruction
- `services/metadataAuditService.js` — the audit scanner
- `services/metadataAuditExport.js` — audit report export
- `main/metadataRepairService.js` — the repair tool
- `main/preload.js` — IPC bridge
- Renderer metadata status UI, Metadata Audit modal, Repair preview (`renderer/renderer.js`, `renderer/index.html`)
- `event.json`'s `metadataState` block
