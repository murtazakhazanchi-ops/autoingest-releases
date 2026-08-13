# Architectural Evolution

## 1. Purpose and Authority

This document records the major architectural transitions in AutoIngest's history and the reasoning behind them — the chronological narrative connecting the individual records that already exist elsewhere in this system.

It is deliberately **not** a duplicate of anything else in `docs/product/`:

- Authoritative technical contracts under `docs/` (`system-contracts.md`, `data-model.md`, `event-system.md`, `ingestion-flow.md`, `metadata-system.md`, `archive-operations-layer.md`, etc.) remain the source of truth for **current behavior**. This document explains how the architecture got to where those contracts describe it, not what the contracts currently require.
- Feature-specific implementation detail belongs in [features/](features/) (`AI-FEAT-###`). This document links to those files rather than restating their content.
- Formal accepted/rejected decisions belong in [decisions/](decisions/). This document narrates the arc; individual tradeoffs with options-considered detail belong there.
- The milestone-by-milestone forward plan belongs in [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md) (`AI-RM-###`). This document explains *why* the roadmap is shaped the way it is, not its current status — see that document for status.

**Evidence discipline for this document specifically**: most of AutoIngest's own architectural history (Sections 3B–3I below) is grounded in the same evidence base as the rest of `docs/product/` — source code, tests, `docs/history.md`, `.claude/learning-log.md`, git commit history, and the existing technical docs — and is cited accordingly. Section 3A (the pre-AutoIngest institutional workflow) predates the codebase entirely and cannot be verified from repository artifacts; it is recorded as stated directly by the project owner during this document's creation (2026-08-04), marked as such, and any further specifics not provided are marked **Evidence pending** rather than inferred or invented. No date, intention, or historical detail in this document is invented — where a claim cannot be traced to one of the sources above, it says so explicitly.

## 2. Architectural Principles

These principles recur across every stage in the timeline below and explain *why* AutoIngest is shaped the way it is, not merely *what* it does:

- **Preservation of the established Aljamea-tus-Saifiyah photo-archive workflow.** AutoIngest automates an existing institutional practice; it did not invent the archival conventions it encodes (see §3A).
- **Transition from repetitive manual processing toward controlled automation.** Tasks that were previously done by hand, consistently, every time (foldering, tagging) were automated without changing what the correct result looks like.
- **Metadata embedded in files or XMP sidecars.** Metadata travels with the file itself (EXIF/IPTC direct write, or an XMP sidecar for RAW) rather than living only in an external database — see AI-FEAT-029.
- **Structured folders as human-readable representations of archival context.** The folder hierarchy (Collection/Event/SubEvent/Photographer) is not an arbitrary storage detail — it is a deliberate, human-legible encoding of the same context also written into metadata. See AI-FEAT-004, AI-FEAT-018.
- **Local-first and on-premises operation.** The archive lives on local/NAS storage the institution controls, not a third-party cloud service — see AI-FEAT-042, AI-FEAT-044.
- **Deterministic event and component routing.** Same `event.json` input always produces the same folder output — no dynamic path computation, no hidden state (`docs/system-contracts.md` §5, §10).
- **Preservation of originals.** No file is ever overwritten; conflicts rename, duplicates skip — see AI-FEAT-019, AI-FEAT-020.
- **Explicit validation and auditability.** Every write is validated before it happens, and every import leaves an audit trail — see AI-FEAT-021, AI-FEAT-027, AI-FEAT-028.
- **Resumable and recoverable operations.** Long-running or interruptible work (metadata batches, transfers, sync) is designed to survive a crash or restart without corruption or duplication — see AI-FEAT-030, AI-FEAT-040/041's checkpoint behavior.
- **Separation of archive truth from UI presentation.** The UI is a pure reflection of backend/`event.json` state; it never originates or corrects archival truth (`docs/ui-system.md`, `docs/system-contracts.md` §6).
- **Backward compatibility and non-destructive evolution.** New fields and capabilities are added so that older `event.json` entries remain valid — see `docs/data-model.md`'s optional `source`/`importedBy` fields as a concrete example.

## 3. Evolution Timeline

### A. Established Adobe Bridge Workflow (pre-AutoIngest)

**Evidence status**: recorded as stated by the project owner during this document's creation (2026-08-04); not verifiable from repository artifacts, since this predates the codebase. Specific dates and the exact scope of the historical workflow are **Evidence pending**.

Before AutoIngest existed, photographs were imported and organized manually. Adobe Bridge was the tool used to apply photographer details, event information, location, city, keywords, copyright, and other metadata directly to the files. The approved folder structure reflected the metadata that had been applied to the photographs — the same underlying archival context (who, what event, where) was expressed both in the metadata and in the folder path, by manual convention. Professional review and correction of both the metadata and the folder placement remained a manual, human process.

**AutoIngest did not create Aljamea's foldering or metadata principles.** It was developed from this existing archival practice — the Collection/Event/SubEvent/Photographer folder hierarchy, the Creator/Copyright/Keywords/Location/City/Country metadata fields, and the "folder structure mirrors applied metadata" principle in AutoIngest (AI-FEAT-004, AI-FEAT-018, AI-FEAT-029) are an automation of a workflow that already existed, not a new invention.

### B. Initial AutoIngest Foundation

Evidence: `docs/history.md` v0.5.1–v0.7.x, `docs/README.md`.

The foundation established the Electron desktop application (AI-FEAT-001) with an event-based ingestion model: source detection for memory cards and drives (AI-FEAT-011), controlled archive routing derived deterministically from an event/component data model (AI-FEAT-004, AI-FEAT-018), photographer-folder creation (AI-FEAT-022), and original-file preservation as a hard rule from the start (AI-FEAT-019, AI-FEAT-020). The security model (context isolation, sandboxing, no direct filesystem access from the renderer) and local, on-premises archive operation were both foundational choices, not later hardening.

### C. Metadata Automation

Evidence: `docs/metadata-system.md`, `.claude/learning-log.md` (2026-05-05 through 2026-06-22 metadata-architecture entries), AI-FEAT-029 through AI-FEAT-037.

AutoIngest migrated the archive from exclusively manual Adobe Bridge tagging toward automated metadata writing applied at import time, while reusing the same controlled vocabulary Bridge had already established — the Keyword Registry (AI-FEAT-036) explicitly supports importing an Adobe Bridge keyword export (`.txt`) to expand its vocabulary, adding new keywords safely without deleting existing ones (`renderer/index.html`'s own UI copy: "Import keywords from an Adobe Bridge keyword export (.txt) to expand the controlled vocabulary... existing keywords are never deleted"). This is continuity with the established registry, not a replacement of it.

The automation covers direct IPTC/XMP writing for JPEG/TIFF, XMP-sidecar handling for RAW formats, photographer attribution, and event/component-specific metadata (all AI-FEAT-029), metadata verification for copy-only paths (AI-FEAT-032), a durable crash-recoverable metadata queue (AI-FEAT-030), archive-wide audit and frozen-snapshot repair (AI-FEAT-033), and metadata reapplication/synchronization when event details change after import (AI-FEAT-037).

**Adobe Bridge remains relevant** for registry management, inspection, verification, correction, and professional review — AutoIngest is an automation and control layer over an established practice, not a claim that Bridge or human review is obsolete. The Bridge-import path inside the Keyword Registry (AI-FEAT-036) is the concrete, current point of continuity between the two.

The shared metadata engine/resolver (DEC-007) and the durable crash-recoverable queue (DEC-008) were both direct corrections to real defects found during this stage's own hardening — see [BUG-007](bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md) and [BUG-010](bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md), and the combined remediation narrative in [PM-001](postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md).

### D. Archive Integrity and Transaction Safety

Evidence: `docs/system-contracts.md`, `docs/history.md` v0.7.4-dev, AI-FEAT-019 through AI-FEAT-028.

Import behavior was hardened into a single atomic transaction (`import → logs → lastImport → status`, AI-FEAT-021) so that `event.json` can never be left in a partially-updated state. Duplicate handling (AI-FEAT-020), checksum-based file verification (AI-FEAT-025), and source-cleanup safeguards with an explicit 8-step validation order (AI-FEAT-024) protect against data loss on both sides of a copy. Activity and audit logs (AI-FEAT-027) and import attribution (AI-FEAT-028) make every import traceable after the fact. Crash recovery (most fully realized in the metadata queue, AI-FEAT-030) and explicit, named failure states (the 9-state metadata derivation, AI-FEAT-031) replaced implicit or silent failure with states an operator can actually see and act on.

### E. Transfer and Distributed Working

Evidence: `docs/archive-operations-layer.md` § Transfer Workflow, Phase 13D (2026-05-14), commit history for `feat(backup)`/`fix(backup)` and `848c867`.

As the archive grew beyond a single machine, AutoIngest added Transfer Export and Transfer Import (AI-FEAT-038, AI-FEAT-039) to move content between a portable Active Archive Root and a permanent Main Archive Root via a physical transfer drive, plus a stricter never-overwrite Backup Update Scanning mode (AI-FEAT-040) for keeping a mirror current. Resume/checkpoint behavior was implemented independently across these transfer paths and the metadata queue (documented as a cross-cutting pattern in [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md), not a single shared feature). Background operation (AI-FEAT-041) let transfers run without blocking the operator's other work. A narrow cross-device validation guard inside Backup Update Scanning, and the separate Realtime Team Presence system (AI-FEAT-048), address parts of what "distributed working" requires, but there is no single unified cross-device-continuation feature — see AI-FEAT-040's and AI-FEAT-048's own documentation for the precise, non-overlapping scope of each. Photographer-level lock handling (AI-FEAT-045) and Local-First background archive sync (AI-FEAT-044) round out safe multi-step, multi-location operation.

### F. Specialized Archival Workflows

Evidence: `main/qmzService.js`, `docs/metadata-system.md` § Import Path Coverage, commits `b56f6ba`/`a2e3b7a`.

Not every archival event fits the generic single/multi-component model. QMZ (Qadam/Majlis/Ziyafat) sequencing was built as an explicitly separate workspace (AI-FEAT-047) — its own root, its own state file, its own IPC surface, its own renderer namespace — rather than forcing this workflow's sequencing/unsequenced-adoption needs into the generic Event Import model. Photographer-based routing (AI-FEAT-022) is shared infrastructure both the generic and QMZ workflows build on. This is a deliberate architectural choice: give a genuinely different workflow shape a real domain model of its own instead of overloading one generic model to cover every case.

### G. Archive Operations Layer

Evidence: `docs/archive-operations-layer.md`, Phase 13D/13C (2026-05-11 through 2026-05-14), AI-FEAT-042 through AI-FEAT-046.

As archives matured beyond "actively being imported into," a layer of operations above the core ingestion engine emerged: archive-root resolution and auto-resolution across the three/four-root model (AI-FEAT-042), read-only archive-health reporting — Consistency, Completeness, Diagnostics, Audit Timeline (AI-FEAT-043), folder adoption for pre-existing folders not created through AutoIngest (AI-FEAT-046), Local-First background archive sync (AI-FEAT-044), and stale-lock recovery (AI-FEAT-045, a subfeature of AI-FEAT-045's own lock handling). This layer maintains the same separation-of-truth principle as the rest of the app: it observes and reports archive state, but archive state itself — never the application's own UI or in-memory state — remains the thing being observed.

### H. Current Architectural Position

AutoIngest is still evolving and is **not the entirety** of the Aljamea photo-archive workflow. As of this document's creation (2026-08-04), the current archival workflow consists of:

- established institutional procedures (§3A) that predate and continue alongside AutoIngest;
- Adobe Bridge, still in active use for registry management, inspection, verification, correction, and professional review (§3C);
- professional human review, which AutoIngest automates *around*, not *away*;
- structured storage — the archive roots and folder hierarchy (§3B, §3G);
- AutoIngest itself — the ingestion, metadata, transfer, and archive-operations automation documented across AI-FEAT-001 through AI-FEAT-048;
- preservation and backup infrastructure (Transfer/Backup, §3E);
- and future archive-management capabilities not yet built (§3I).

No claim is made here about any other institutional system, tool, or platform beyond what is directly evidenced in this repository. This document does not describe any archival access, metadata, preservation, or discovery platform other than AutoIngest and Adobe Bridge, because no other such system appears anywhere in the codebase, tests, or existing documentation consulted for this audit.

### I. Planned Architectural Direction

The canonical roadmap ([02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md)) is the authority for status; this section only explains how each planned milestone continues the architectural arc above. **All of the following are planned, not implemented** — see each linked feature file's own "Confirmed zero implementation" evidence status.

- **Archive Maintenance** (AI-FEAT-049, AI-RM-002) — extends §3G's archive-operations layer from reporting into upkeep.
- **Event Maintenance** (AI-FEAT-050, AI-RM-003) — extends event-level review beyond the current create/edit model (§3B).
- **Archive Browser** (AI-FEAT-051, AI-RM-004) — extends media browsing (currently source-scoped) to full-archive scope.
- **Global Search** (AI-FEAT-053, AI-RM-005) — expected to build on whatever scope Archive Browser establishes.
- **Integrity Verification — Archive-Wide** (AI-FEAT-054, AI-RM-006) — extends the existing narrower checksum verification (AI-FEAT-025, §3D) to full-archive scope; explicitly not the same feature at a bigger size, per AI-FEAT-054's own scope note.
- **Archive Repair** (AI-FEAT-052, AI-RM-007) — closes the "reports but does not fix" gap explicitly documented in AI-FEAT-043 (§3G).
- **Archive Analytics** (AI-FEAT-055, AI-RM-008) — expected to build on Archive Health Reporting's data (AI-FEAT-043).
- **AI Archive Intelligence** (AI-FEAT-056, AI-RM-009) — the least-scoped, furthest-out item in the entire roadmap; nothing about its eventual architecture should be assumed from its name.

### Multi-Channel Release Architecture

Part 9, AI-RM-010 — a parallel track, not part of §3A–§3I's archive-capability sequence. Formalized 2026-08-12, directly motivated by the v0.9.11 release-process incident ([PM-002](postmortems/PM-002_V0_9_11_FIRST_PUBLICATION_ATTEMPT_PRODUCED_AN_EMPTY_GITHUB_RELEASE.md)): a `v0.9.11` git tag was pushed while `package.json` still read the prior version, and `electron-builder` — which derives its publish target and artifact names from `package.json`'s version, never the git tag — built real artifacts but silently failed to publish any of them, because its own overwrite-protection guard refused to touch the already-published prior release. The resulting empty, public GitHub Release exposed a structural gap: AutoIngest's release process had exactly one path (a `v*` tag → a real, public, non-draft, non-prerelease release) and no way to get a build in front of a real tester without either publishing it as genuine Stable or using an ad-hoc, update-channel-invisible artifact-only build (the `windows-tester-build` workflow job added during the BUG-011 investigation).

AI-FEAT-057 replaced this with three structurally isolated channels — Development (internal, never published), RC/Preview (real tester acceptance, opt-in, a GitHub `prerelease:true` release with its own `rc.yml`/`rc-mac.yml` update-channel files), and Stable (the pre-existing path, unchanged). Isolation is enforced by `electron-updater`'s own GitHub-provider mechanics rather than convention: a Stable client resolves updates via `GET {repo}/releases/latest`, which by definition excludes every prerelease release — a Stable install cannot discover an RC release through the normal update-check path regardless of any channel setting. Promotion from a verified RC to Stable rebuilds from the RC's exact source commit rather than re-uploading its binaries (see [DEC-017](decisions/DEC-017_STABLE_RELEASES_REBUILD_FROM_VERIFIED_RC_SOURCE_NEVER_PROMOTE_EXACT_BINARIES.md) for why exact-binary promotion is unsafe), and a channel-aware `release gate` makes the version/tag/lockfile/source-drift preconditions PM-002 lacked into hard, blocking checks rather than tribal knowledge.

This is deliberately not folded into §3A–§3I's lettering or the AI-RM-001…009 archive-capability sequence — it is release/CI infrastructure the whole application depends on, not an archive-management capability, and AI-RM-010 has no dependency relationship to that sequence.

**Live-pilot confirmation (2026-08-13).** The isolation claim above was verified against real GitHub state, not only against installed-library source: a real `v0.9.12-rc.1`/`v0.9.12-rc.2` RC publication (triggered via `workflow_dispatch`) confirmed `/releases/latest` never stopped resolving to Stable's `v0.9.11` and Stable's `latest.yml`/`latest-mac.yml` remained byte-identical throughout — including during a real partial-publish failure on the Windows platform ([BUG-015](bugs/BUG-015_WINDOWS_RUNNER_DEFAULT_POWERSHELL_SHELL_MANGLES_ELECTRON_BUILDER_DOT_NOTATION_CLI_OVERRIDES.md), a Windows-runner default-shell/CLI-argument-parsing bug unrelated to the isolation mechanism itself, found and fixed the same day). This is the first real evidence that the isolation design holds under an actual failure condition, not only in the designed happy path. Real-installed-client verification (an actual Windows machine's updater, not just the GitHub-side publication) remains outstanding — see [AI-FEAT-057](features/AI-FEAT-057_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM.md)'s Future Enhancements.

## 4. Architectural Lessons

Durable lessons this history has produced, worth preserving independent of any single feature's own documentation:

- **Automation must preserve established archival meaning.** AutoIngest's folder and metadata conventions were inherited from the pre-existing Adobe Bridge workflow (§3A), not invented — automating a process is not license to redefine what that process means.
- **Metadata writing requires verification.** A write is never trusted just because the write call succeeded — the shared engine's `Expected → Write → Read Back → Compare → Result` shape (AI-FEAT-029) exists because of this lesson.
- **Copying is not equivalent to preservation.** Checksum verification (AI-FEAT-025), source-cleanup validation order (AI-FEAT-024), and copy-verification-gated deletion all exist because a successful-looking copy is not the same guarantee as a verified one.
- **Resumability must be designed across workflows, not assumed to generalize from one.** The metadata queue, transfer checkpoints, and sync queue each implement their own resume logic independently — no single mechanism covers all of them (see [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md)'s Cross-Cutting Patterns section).
- **Archive evidence must survive application restarts.** The durable manifest+journal design (AI-FEAT-030), proven against a real `SIGKILL` test rather than only a simulation, reflects this directly.
- **UI state must not be treated as archival truth.** `docs/ui-system.md`'s and `docs/system-contracts.md`'s UI-as-pure-reflection contract is a hard rule precisely because early architecture (§3B onward) made `event.json` the sole source of truth from the start.
- **Special workflows require explicit domain models.** QMZ (§3F) was given its own root/state/IPC/namespace rather than being force-fit into the generic Event Import model — a repeated architectural preference, not a one-off.
- **Human review remains essential.** Adobe Bridge and professional review are not legacy artifacts being phased out (§3C, §3H) — they remain the correction and verification layer automation does not replace.
- **Application architecture must not make the archive dependent on one person or interface.** Local-first, on-premises operation (§2), `event.json` as the sole source of truth independent of any specific UI session, and multi-operator attribution (AI-FEAT-002, AI-FEAT-028) all reflect a deliberate avoidance of single points of dependency.

## 5. Relationship Map

Only verified links — each ID below was confirmed directly against [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) before inclusion.

| Architectural stage | Related AI-FEAT IDs | Related technical docs | Related bug/decision/postmortem records |
|---|---|---|---|
| §3A Adobe Bridge workflow (continuity point) | AI-FEAT-029, AI-FEAT-036 | `docs/metadata-system.md` | [DEC-004](decisions/DEC-004_PRESERVE_BRIDGE_BASED_ARCHIVAL_PRACTICE.md), [DEC-014](decisions/DEC-014_CONTROLLED_KEYWORD_REGISTRY.md) |
| §3B Initial foundation | AI-FEAT-001, AI-FEAT-004, AI-FEAT-009, AI-FEAT-011, AI-FEAT-018, AI-FEAT-019, AI-FEAT-020, AI-FEAT-022 | `docs/architecture.md`, `docs/event-system.md`, `docs/ingestion-flow.md` | [DEC-001](decisions/DEC-001_EVENT_DATA_AS_DURABLE_ARCHIVE_TRUTH.md), [DEC-002](decisions/DEC-002_FOLDER_STRUCTURE_PLUS_EMBEDDED_METADATA.md), [DEC-005](decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md), [BUG-002](bugs/BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md) |
| §3C Metadata automation | AI-FEAT-029, AI-FEAT-030, AI-FEAT-031, AI-FEAT-032, AI-FEAT-033, AI-FEAT-036, AI-FEAT-037 | `docs/metadata-system.md` | [BUG-007](bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md), [BUG-008](bugs/BUG-008_LASTMETADATARUN_EISDIR_SILENT_FAILURE.md), [BUG-009](bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md), [BUG-010](bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md), [DEC-006](decisions/DEC-006_RAW_FILES_USE_XMP_SIDECARS.md), [DEC-007](decisions/DEC-007_SHARED_METADATA_ENGINE_RESOLVER.md), [DEC-008](decisions/DEC-008_DURABLE_METADATA_SURVIVES_RESTART.md), [DEC-009](decisions/DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md), [PM-001](postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) |
| §3D Archive integrity & transaction safety | AI-FEAT-019, AI-FEAT-020, AI-FEAT-021, AI-FEAT-024, AI-FEAT-025, AI-FEAT-027, AI-FEAT-028 | `docs/system-contracts.md` | [BUG-001](bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md), [DEC-005](decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md) |
| §3E Transfer & distributed working | AI-FEAT-038, AI-FEAT-039, AI-FEAT-040, AI-FEAT-041, AI-FEAT-044, AI-FEAT-045 | `docs/archive-operations-layer.md` | [BUG-004](bugs/BUG-004_SAME_DEVICE_STALE_ARCHIVE_LOCK.md), [BUG-005](bugs/BUG-005_TRANSFER_EXPORT_RESUME_STATE_DIVERGENCE.md), [DEC-010](decisions/DEC-010_TRANSFER_UPDATE_MISSING_FILES_ONLY.md), [DEC-013](decisions/DEC-013_LOCK_CLEARING_MUST_BE_CONSTRAINED.md) |
| §3F Specialized workflows (QMZ) | AI-FEAT-022, AI-FEAT-047 | `docs/metadata-system.md` § Import Path Coverage | [BUG-007](bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md), [DEC-011](decisions/DEC-011_QMZ_DEDICATED_DOMAIN_WORKFLOW.md) |
| §3G Archive Operations layer | AI-FEAT-042, AI-FEAT-043, AI-FEAT-044, AI-FEAT-045, AI-FEAT-046 | `docs/archive-operations-layer.md` | [BUG-003](bugs/BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md), [BUG-004](bugs/BUG-004_SAME_DEVICE_STALE_ARCHIVE_LOCK.md), [DEC-012](decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md), [DEC-013](decisions/DEC-013_LOCK_CLEARING_MUST_BE_CONSTRAINED.md) |
| §3I Planned direction | AI-FEAT-049 – AI-FEAT-056 | [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md) | [DEC-015](decisions/DEC-015_PLANNED_ARCHITECTURE_SEPARATE_FROM_IMPLEMENTED.md) |
| Multi-Channel Release Architecture (parallel track, not §3-lettered) | AI-FEAT-057, AI-FEAT-006 | `.github/workflows/release.yml`, `scripts/product-docs/README.md` | [PM-002](postmortems/PM-002_V0_9_11_FIRST_PUBLICATION_ATTEMPT_PRODUCED_AN_EMPTY_GITHUB_RELEASE.md), [DEC-017](decisions/DEC-017_STABLE_RELEASES_REBUILD_FROM_VERIFIED_RC_SOURCE_NEVER_PROMOTE_EXACT_BINARIES.md) |
