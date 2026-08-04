# AutoIngest v0.9.10 — Metadata Audit & Repair, QMZ Workspace, Transfer Hardening

**Release date:** 2026-08-04
**Build type:** Internal tester build
**Base:** v0.9.9

---

## Overview

v0.9.10 is a substantial capability and reliability release covering 51 commits since v0.9.9. It delivers the complete Metadata Audit & Repair system (streaming archive-wide audit, frozen-snapshot repair, consolidated Metadata Management modal, and a truthful Dashboard Metadata Health card), converts the QMZ Sequence Manager into a full sequencing workspace, adds structure-aware Transfer Import with incremental scanning, and hardens Transfer Export/Backup Update scanning with checkpoint/resume, background operation, and extensive UI polish. No architectural regressions from v0.9.9.

---

## 1. New Features

### Metadata Audit & Repair

- Centralized metadata expectations and verified metadata writes into a single shared resolver/engine (`services/metadataExpectationService.js`, `main/exifService.js`).
- Durable metadata queue recovery and derived event-level metadata states (9-state model, recovered automatically after an unclean exit).
- Resumable, streaming, archive-wide metadata audit scanner with JSON/JSONL/CSV report export.
- Snapshot-guarded metadata repair — consumes an audit's frozen snapshot only, with a staleness guard before any write.
- Three previously-separate metadata UI surfaces consolidated into a single tabbed Metadata Management modal.
- Dashboard Metadata tile upgraded into a truthful Health card reflecting real derived metadata state.
- Metadata collection scans now run as a background job rather than blocking the UI.

### QMZ Sequencing Workspace

- Added the QMZ Sequence Manager and an event-list entry point.
- Converted it into a full workspace with sequence review, timeline, and event context.

### Transfer Import / Export

- Transfer Import: structure-aware destination resolution with incremental scan fingerprinting.
- Transfer Export and Import can now run in the background — a persistent status pill shows progress, click-to-reopen — instead of blocking the modal.
- Backup Update scanning: custom source-folder export, checkpoint/resume for custom folder exports, cross-device source validation for resumed custom exports, folder-rename detection (both sequence-prefixed and reviewed nested folders), and external-drive sync scan support for transfer export.
- Transfer speed shown live in export/import progress cards; total-bytes walk added for accurate full-export and custom-folder size display.

## 2. Fixed

### Import / Event

- Stale archive-lock handling: same-device stale locks can now be cleared and the import continued, with clearSelfStaleLock failures surfaced via an inline dialog instead of failing silently.
- Photographer folder sequencing: sequenced photographer folders are now reused instead of duplicated; the currently-selected folder is correctly excluded from sequencing.
- Event editing no longer loses status when details are edited.
- Source Cleanup eligibility is now shown accurately after import.
- Keyword Registry bindings restored in the Event Creator.
- RAW peer lookup now uses the RAW extensions config instead of a hardcoded list.

### Transfer / Backup UI

- Numerous transfer and backup-scan UI corrections: accurate progress and queued-size display, corrected footer/summary layout, clarified status indicators and footer actions, valid markup in the scan summary, and prevention of footer overflow in the export modal.

### Dashboard

- System Overview stats now refresh correctly on startup.
- Global export status pill kept in sync with modal progress.

### Metadata Management Modal

- Run Audit button compacted; the obsolete standalone Metadata Audit entry point removed now that the modal consolidates all metadata surfaces.
- Audit & Repair tab rebalanced into a full-height flex layout with a single scroll region, then spacing/typography polished across window heights (including a dedicated rule for the documented 700px minimum window height).

## 3. Documentation

- Metadata pipeline, recovery, audit, and repair behavior documented in `docs/metadata-system.md`.
- Test coverage added for the metadata pipeline, recovery, audit, repair, and live end-to-end verification.
- Media extension counts updated in project documentation.

---

## Notes

- No file-copy, routing, or metadata-write contract changed in this release beyond what's described above — all changes are additive or corrective within existing contracts (`docs/system-contracts.md`).
- This release corresponds to `AI-RM-001` (Metadata Audit & Repair) in `docs/product/02_MASTER_ROADMAP.md`, now complete.
