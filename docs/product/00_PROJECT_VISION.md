# AutoIngest — Project Vision

Evidence status: grounded in `CLAUDE.md`, `docs/architecture.md`, `docs/features.md`, `docs/event-system.md`, `docs/metadata-system.md`, `docs/archive-operations-layer.md`, and `package.json`. Where the underlying docs are silent, this file says so rather than inventing intent.

---

## What AutoIngest is

AutoIngest (`package.json` name `auto-ingest`, description "AutoIngest — AJS Photo Archive Ingest System") is an Electron-based desktop application for macOS and Windows that ingests media from memory cards, external drives, and local folders, structures it into a deterministic archival folder hierarchy, and writes archival metadata into the files themselves.

It is built for **structured archival workflows**, not general-purpose photo management: every import is driven by an explicit event definition, every output path is derived deterministically from that event, and every file operation is designed to be safe to re-run.

## Target users

Evidence pending — no document read so far names a specific user role, organization structure, or operating context beyond the recurring phrase "multi-photographer workflows" (`docs/architecture.md`) and Creator/Copyright metadata defaulting to `© Aljamea-tus-Saifiyah` (`docs/metadata-system.md`). This suggests an institutional/organizational photography operation with multiple photographers contributing to a shared archive, but the specific organizational context beyond that inference is not documented here and should not be assumed further.

## Principal workflows

Derived from `docs/archive-operations-layer.md` and `docs/features.md`:

1. **Event-based Import** — an operator defines an Event (Collection → Event → SubEvent → Photographer → media), selects a source (memory card / external drive / local folder), groups files, and commits a single atomic import transaction that writes files to the archive and appends to `event.json`.
2. **Quick Import** — a staging-only, non-archival import path, intentionally outside the event/metadata system (see `docs/metadata-system.md` Non-Goals).
3. **Local First vs. Direct Archive** — two import topologies: stage locally then sync to the Active Archive Root in the background, or write directly to the Active Archive Root under a photographer-level lock.
4. **Transfer** — physically moving content from a portable Active Archive Root to a permanent Main Archive Root via a Transfer Drive, with export/import audit trails at each end.
5. **Post-import Metadata** — EXIF/IPTC/XMP tagging applied after copy succeeds, never blocking or gating the copy itself, with a durable crash-recoverable queue and an explicit audit-then-repair correction path.
6. **Archive Health Reporting** — read-only Consistency, Completeness, Diagnostics, and Audit Timeline surfaces that tell an operator the state of the archive without mutating it.

## Long-term product direction

The canonical forward roadmap is tracked in [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md) (`AI-RM-001` through `AI-RM-009`). At a high level, the direction moves from *ingest and tag correctly* (delivered) toward *maintain, browse, search, verify, repair, and eventually reason over* an archive that keeps growing — see the roadmap for specifics. This document does not restate roadmap detail; it exists to explain *why* that direction was chosen, and that reasoning is evidence-pending beyond what the roadmap itself documents.

## Reliability principles

These are enforced, not aspirational — see `docs/system-contracts.md` for the full non-negotiable list:

- **event.json is the single source of truth.** All system state derives from it; nothing else is authoritative.
- **No file overwrites, ever.** Same file → skip. Conflict → rename. This is a hard contract, not a default.
- **Determinism.** Same input + same `event.json` → same output, every time.
- **Idempotency.** Re-running an operation (import, sync, transfer, metadata write) must be safe.
- **Transactional ingestion.** `import → logs → lastImport → status` commits as one unit or not at all — no partial `event.json` states.

## Preservation and data-integrity principles

- Metadata failures never block or roll back a copy, and copy failures never block metadata retry — the two are decoupled by design (`docs/metadata-system.md`).
- Metadata repair only ever consumes a frozen audit snapshot and re-verifies staleness before writing — it never re-resolves against live state blindly.
- Archive health reporting (Consistency, Completeness, Diagnostics, Audit Timeline) is strictly read-only; it observes and reports, it does not repair.
- Renderer has no direct filesystem access — all archive reads/writes go through `main/`/`services/` via IPC (`docs/archive-operations-layer.md` Safety Guarantees).

## Role of metadata

Metadata is treated as a first-class, durable archival property of every eligible file — not an optional enhancement. It is tracked per-event as a 9-state derivation (`docs/metadata-system.md`), recoverable across crashes, and independently auditable and repairable against the live archive at any time. Video files are an explicit, permanent exception (`excluded`, never a failure).

## Role of archive maintenance (forward-looking)

Import and metadata are the delivered foundation (`AI-RM-001` and earlier). The roadmap's next phases (`AI-RM-002` onward) extend the same reliability principles — read before write, never silently mutate, always report what changed — into ongoing maintenance of an archive that already exists: cleanup, event-level review, browsing, search, verification, and repair of drift discovered after the fact.

## Future browsing / search / analytics / intelligence direction

Per the canonical roadmap order, browsing (`AI-RM-004`), search (`AI-RM-005`), integrity verification (`AI-RM-006`), repair (`AI-RM-007`), analytics (`AI-RM-008`), and AI-assisted archive intelligence (`AI-RM-009`) are planned, in that order, as extensions built on top of the same `event.json`-is-truth foundation. None of these have been implemented as of this document's creation — see [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md) for current status and [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) for what evidence (if any) exists in the codebase today.

---

*This document records product purpose and direction. It is not authoritative for runtime behavior, contracts, or architecture — those remain owned by the technical docs under `docs/` (see `docs/CLAUDE.md`).*
