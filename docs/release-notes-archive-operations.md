# Release Notes — Archive Operations Layer

Milestone release notes for the Archive Operations Layer (Phases 13D-1, 13D-2, 13D-4, and 13D-5).

---

## Archive Operations Layer — Phase 13D

This milestone introduces the full archive operations reporting layer: four read-only diagnostic and audit surfaces that give operators visibility into archive health before transfer, during validation, and after operations complete.

No ingestion behavior was changed. No file-copy or routing logic was modified. The changes are additive: new services, new IPC handlers, new preload entries, and new UI modals attached to the existing diagnostics modal footer.

---

### Phase 13D-1 — Consistency Report

**What it does:**
Scans the active archive root and checks structural consistency: event.json presence per folder, folder naming convention compliance, group-mapping integrity, and orphan detection. Results are presented in a sectioned modal accessible from the diagnostics footer.

**New files:**
- `services/archiveConsistencyService.js`

**Modified files:**
- `main/main.js` — IPC handlers: `archive:generateConsistencyReport`, `archive:getConsistencyReport`
- `main/preload.js` — contextBridge entries
- `renderer/index.html` — modal HTML + CSS
- `renderer/renderer.js` — modal open/close/render logic

---

### Phase 13D-2 — Completeness Checklist

**What it does:**
Evaluates archive readiness for transfer. Checks metadata completeness, sync status, pending imports, unreviewed sync issues, and overall readiness. Returns a `ready` / `needs-attention` / `blocked` verdict.

**New files:**
- `services/archiveCompletenessService.js`

**Modified files:**
- `main/main.js` — IPC handlers: `archive:generateCompletenessChecklist`, `archive:getCompletenessChecklist`
- `main/preload.js` — contextBridge entries
- `renderer/index.html` — modal HTML + CSS
- `renderer/renderer.js` — modal open/close/render logic

---

### Phase 13D-4 — Archive Diagnostics

**What it does:**
Deep structural diagnostics that cross-validate event.json records against filesystem state. Checks for stale locks, missing sidecar files, metadata anomalies, and structural inconsistencies not caught by the lighter consistency report.

**New files:**
- `services/archiveDiagnosticsService.js`

**Modified files:**
- `main/main.js` — IPC handlers: `archive:runDiagnostics`, `archive:getDiagnosticsStatus`
- `main/preload.js` — contextBridge entries
- `renderer/index.html` — diagnostics modal with footer buttons for 13D-1 through 13D-5
- `renderer/renderer.js` — diagnostics modal logic

---

### Phase 13D-5 — Audit Timeline

**What it does:**
Aggregates recent operational history across the archive operations layer into a chronological timeline. Shows transfer exports, transfer imports, sync queue outcomes, sync review acknowledgements, and in-memory session state from the current diagnostics/consistency/completeness runs — all sorted newest-first in a single modal.

**New files:**
- `services/archiveAuditTimelineService.js`

**Modified files:**
- `main/main.js` — IPC handlers: `archive:generateAuditTimeline`, `archive:getAuditTimeline`
- `main/preload.js` — contextBridge entries
- `renderer/index.html` — audit timeline modal HTML + CSS
- `renderer/renderer.js` — audit timeline modal open/close/render logic

**Design decisions:**
- JSONL files are tail-read with a 4 MB cap and a 75-line limit per file to avoid reading entire audit logs into memory on large archives.
- The tail reader uses `try/finally` on the file descriptor to prevent fd leaks on network mount errors (`ESTALE`).
- Sync queue history uses terminal states only (`synced`, `sync-failed`, `needs-attention`). Non-terminal states (`ready-for-sync`, `blocked`) reflect current queue state and are not included in history.
- `sourceErrors[].message` is never injected into `innerHTML` — only the hardcoded `.source` constant is rendered as HTML, preventing XSS from path fragments in error messages.
- Per-source `try/catch` isolation: one failing source does not fail the full timeline. Failures are reported in a `sourceErrors[]` array alongside available entries.
- `event.json` `imports[]` arrays are intentionally excluded from timeline aggregation — scanning them on large archives with many events would be prohibitively expensive.

---

## Architecture Notes

### Service pattern

All four reporting services follow the same contract:

- `generate*()` is async, never throws to the IPC layer, wraps top-level logic in try/catch.
- `getLast*()` is synchronous, returns the most recent result or `null`.
- `_inFlight` guard prevents concurrent generation; second call returns last result with `busy: true`.
- Per-source `try/catch` isolates individual source failures from the aggregate result.

### IPC surface

New IPC channels added (all main-process only, never exposed to web content):

```
archive:generateConsistencyReport   → archiveConsistencyService.generateReport()
archive:getConsistencyReport        → archiveConsistencyService.getLastReport()
archive:generateCompletenessChecklist → archiveCompletenessService.generateChecklist()
archive:getCompletenessChecklist    → archiveCompletenessService.getLastChecklist()
archive:runDiagnostics              → archiveDiagnosticsService.runDiagnostics()
archive:getDiagnosticsStatus        → archiveDiagnosticsService.getDiagnosticsStatus()
archive:generateAuditTimeline       → archiveAuditTimelineService.generateTimeline()
archive:getAuditTimeline            → archiveAuditTimelineService.getLastTimeline()
```

### Non-changes

The following were explicitly not changed during this milestone:

- Import routing logic
- Ingestion engine
- Metadata sync pipeline
- Keyword registry
- event.json schema
- Group mapping behavior
- Folder naming logic (Country exclusion rule unchanged)
- Placement dropdown behavior in Event Creator

---

## Validation Checklist

Before treating this milestone as production-ready:

- [ ] Consistency report runs to completion on a real NAS archive (not just local filesystem)
- [ ] Completeness checklist correctly identifies events with missing metadata
- [ ] Completeness checklist readiness verdict correctly reports `blocked` when the consistency report has errors
- [ ] Diagnostics modal opens and closes without state leak across sessions
- [ ] Audit timeline renders all five source types when all sources have data
- [ ] Audit timeline renders gracefully when one or more sources are unavailable
- [ ] `sourceErrors[]` are visible in the timeline modal when sources fail
- [ ] JSONL tail-read correctly handles files larger than 4 MB
- [ ] File descriptor is closed on ESTALE / network disconnect mid-read
- [ ] No `innerHTML` injection of `sourceErrors[].message`
- [ ] All modals accessible via keyboard (Escape closes, focus returns to trigger)
- [ ] `node --check` passes on all new service files
