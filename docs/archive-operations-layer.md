# Archive Operations Layer

End-to-end architecture and workflow documentation for the AutoIngest archive operations layer (Phases 13D-1, 13D-2, 13D-4, and 13D-5).

---

## Overview

The archive operations layer governs how media files move between storage roots, how archive state is validated, and how operators can review archive health. It sits above the core ingestion engine and below the renderer UI, communicating exclusively through the IPC bridge.

All operations in this layer are non-destructive. No file is ever overwritten. The layer only reads, copies, and validates — it never renames, deletes, or restructures existing archive content.

---

## Three-Root Model

AutoIngest tracks four distinct storage roots:

| Root | Purpose | Typical Medium |
|------|---------|---------------|
| **Active Archive Root** | Live working archive used on-location during or after an event | Portable NAS |
| **Local Staging Root** | Operator's local staging area for Local First imports | Operator SSD |
| **Main Archive Root** | Permanent office archive | Office NAS or server |
| **Transfer Drive Root** | Migration carrier between Active and Main archive | External drive |

Roots are configured in Settings and persisted across sessions. The system only operates on a root that is currently mounted and readable.

---

## Import Workflows

### Local First

Used when the operator imports to a local staging area first and syncs to the Active Archive later.

```
Memory Card
    │
    ▼
Local Staging Root
    │  (copy + group + metadata write)
    ▼
event.sync.json manifest written
    │
    ▼
Background Archive Sync  ──▶  Active Archive Root
```

**Key properties:**
- Metadata is written to the Local Staging Root before sync begins.
- `event.sync.json` is the handoff manifest that drives background sync.
- The renderer shows sync status per event; the operator can review before and after.
- Sync is idempotent: re-running sync on an already-synced event is safe.

### Direct Archive

Used when the operator imports directly into the Active Archive Root without a local staging step.

```
Memory Card
    │
    ▼
Active Archive Root  (photographer-level lock held during copy)
    │
    ▼
Metadata write (post-copy, still under lock)
    │
    ▼
Lock released
```

**Key properties:**
- A photographer-level lock is acquired at import start and held until metadata is written.
- No intermediate staging file is created.
- Metadata is written after copy completes, not before — this is the only workflow where metadata follows rather than precedes the archive write.
- Lock prevents concurrent imports into the same event folder.

---

## Transfer Workflow

Moves content from the Active Archive Root to the Main Archive Root via a physical transfer drive.

```
Active Archive Root
    │
    ▼  (Transfer Export)
Transfer Drive Root
    │  (.autoingest-transfer/exports.audit.jsonl written)
    │
    [drive physically moved to office]
    │
    ▼  (Transfer Import)
Main Archive Root
    │  (.autoingest/transfer-imports/imports.audit.jsonl written)
```

**Key properties:**
- Export writes a clean mirror of selected events to the transfer drive.
- The transfer drive is a self-contained archive snapshot — it can be validated independently before import.
- Import at the Main Archive Root is idempotent: re-importing the same drive does not duplicate files.
- Both export and import write dedicated JSONL audit files for traceability.
- Country is never part of folder names generated in either step.

---

## Reporting Layer

Four reporting surfaces expose archive health. All are read-only — they do not mutate any file or service state.

### 1. Consistency Report (Phase 13D-1)

Checks structural consistency of the active archive: event.json presence, folder naming, group mapping integrity, orphan detection.

- IPC: `archive:generateConsistencyReport`, `archive:getConsistencyReport`
- Backed by: `archiveConsistencyService.js`
- Output: sectioned report with per-section pass/warning/error counts

### 2. Completeness Checklist (Phase 13D-2)

Evaluates readiness of the active archive for transfer or long-term storage. Checks metadata completeness, sync status, pending imports, and unreviewed issues. Produces an overall readiness verdict (`ready` / `needs-attention` / `blocked`) used as the go / no-go signal before initiating a transfer. There is no separate readiness service — the verdict is derived entirely within this checklist.

- IPC: `archive:generateCompletenessChecklist`, `archive:getCompletenessChecklist`
- Backed by: `archiveCompletenessService.js`
- Output: checklist with per-item status; overall readiness verdict (`ready` / `needs-attention` / `blocked`)

### 3. Archive Diagnostics (Phase 13D-4)

Deep structural diagnostics: cross-validates event.json against filesystem, checks for stale locks, verifies sidecar integrity, and reports anomalies not surfaced by the consistency report.

- IPC: `archive:runDiagnostics`, `archive:getDiagnosticsStatus`
- Backed by: `archiveDiagnosticsService.js`
- Output: error/warning counts with per-check detail

### 4. Audit Timeline (Phase 13D-5)

Aggregates recent operational history across the archive operations layer into a chronological timeline. Covers transfer exports, transfer imports, sync queue terminal states, sync review acknowledgements, and in-memory session state from diagnostics/consistency/completeness.

- IPC: `archive:generateAuditTimeline`, `archive:getAuditTimeline`
- Backed by: `archiveAuditTimelineService.js`
- Sources:
  - `{transferRoot}/.autoingest-transfer/exports.audit.jsonl`
  - `{mainArchiveRoot}/.autoingest/transfer-imports/imports.audit.jsonl`
  - `syncQueueService.getQueue()` — terminal states only (`synced`, `sync-failed`, `needs-attention`)
  - `syncReviewService.getReviews()` — acknowledged issues
  - In-memory: last diagnostics run, last consistency report, last completeness checklist
- Output: sorted-newest-first timeline, capped at 150 entries; per-source errors reported without failing the whole timeline

---

## Service Contracts

### Never-throw-to-IPC

Every `generate*()` method in the reporting layer wraps its top-level logic in try/catch and returns an error-shaped object rather than throwing. The IPC layer never sees an unhandled rejection from these services.

### Per-source isolation

Each reporting service uses per-source try/catch. A single failing source (e.g., a JSONL file missing on a network mount) does not fail the entire report. The failure is recorded in `sourceErrors[]` and returned alongside available data.

### `_inFlight` guard

All generate services use an `_inFlight` boolean to prevent concurrent generation. A second call while generation is in progress returns the last result immediately with `busy: true`.

### Synchronous last-result accessor

Every service exposes a synchronous `getLastX()` method that returns the most recent result or `null`. This is used by the renderer to populate modals without waiting for a fresh generation on every open.

### File descriptor safety

The JSONL tail reader in `archiveAuditTimelineService` uses a `try/finally` block to guarantee `fd.close()` is called even if the read throws (e.g., `ESTALE` on a disconnected NFS/SMB mount). This prevents fd leaks in the long-running Electron main process.

### XSS safety

`sourceErrors[].message` may contain user-controlled path fragments. It must never be injected into `innerHTML` directly. Only `.source` (a hardcoded constant string) is safe for use in HTML rendering without escaping.

---

## Safety Guarantees

- **No overwrite ever.** Same file → skip. Conflict → rename with suffix.
- **event.json is the single source of truth.** All archive identity, import history, and event metadata is stored in `event.json`.
- **Renderer has no filesystem access.** All archive reads and writes go through `main/services/` via IPC. The renderer only receives data payloads.
- **Archive writes only through main/services.** No renderer-side file mutations.
- **Photographer-level locks** prevent concurrent Direct Archive imports into the same event folder.
- **Metadata before sync** (Local First workflow): metadata is always written before sync begins, so the archive copy is never metadata-less.
- **Transfer drive as clean mirror**: transfer export validates before writing; import is idempotent.
- **Hidden internal files** (`.autoingest*`, `.autoingest-transfer*`) are included in operations that need full archive state, not stripped.

---

## Known Limitations

- Full beta validation with real NAS hardware is pending.
- Adoption (`archive-adoption-workflow.md`) supports ready candidates only — folders already following naming conventions.
- No bulk adoption: events are adopted one at a time.
- No automatic Local Staging Root cleanup after sync completes.
- No portable NAS wipe/reset tool for post-transfer teardown.
- No broad repair automation: the diagnostics layer reports issues but does not auto-fix them.
- Some reporting sections depend on metadata availability. Events with missing or incomplete metadata may produce incomplete report sections rather than errors.
- The audit timeline sources JSONL files from transfer operations only. Adoption history and direct-archive lock history have no persistent JSONL log and are not included.

---

## Related Documents

- `docs/archive-adoption-workflow.md` — manual folder adoption operator guide
- `docs/system-contracts.md` — IPC and service contracts
- `docs/data-model.md` — event.json schema
- `docs/ingestion-flow.md` — core ingestion engine
- `docs/metadata-system.md` — metadata write pipeline
- `docs/failure-patterns.md` — known failure modes and mitigations
