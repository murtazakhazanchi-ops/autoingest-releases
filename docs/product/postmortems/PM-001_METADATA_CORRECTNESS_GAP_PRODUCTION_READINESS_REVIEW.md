# PM-001 — Metadata Correctness Gap Found in Production-Readiness Review

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-029, AI-FEAT-030, AI-FEAT-031, AI-FEAT-032, AI-FEAT-033, AI-FEAT-047 |
| Severity | High |
| Date of incident | 2026-08-02 (detection and root-cause fixes); concentrated remediation through 2026-08-04 |
| Date resolved | 2026-08-04 (AI-RM-001 milestone complete) |
| Evidence status | Verified from Git history and code for the technical defects and their fixes; **NOT verified** for real-world/production impact — see Impact section |

## A note on framing (read before the rest of this record)

This documentation task was originally briefed with a working title referencing a specific named institutional event ("Ashara Mubaraka"). An exhaustive repository search — `grep -rni "ashara"` and `grep -rni "mubaraka"` across the entire codebase, plus `git log --all -i --grep="ashara"` and `--grep="mubaraka"` — found **zero commits, zero learning-log entries, zero release notes, and zero doc references** to any such named incident. The only hits anywhere in the repository are unrelated config labels (`data/event-types.json`'s "Ashara Mubarakah" as a selectable event-type category; `data/locations.json`'s "Qubba Mubaraka" as a location label). Per this system's evidence-discipline rule (`05_DOCUMENTATION_WORKFLOW.md` § Evidence Discipline: "Never invent implementation dates, completion dates, bugs... When evidence is incomplete, write the literal phrase 'Evidence pending'"), this record does **not** claim a specific named incident occurred. What follows is the real, well-evidenced defect-and-remediation story this system's evidence actually supports.

## Summary

A concentrated, multi-day engineering effort on 2026-08-02 through 2026-08-04 — framed in one commit's own message as arising from "the production-readiness review's Event Edit investigation" — surfaced and fixed several silent metadata-correctness and data-integrity defects: QMZ-routed files silently losing keyword and Hijri-date metadata due to a context-shape mismatch ([BUG-007](../bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md)), metadata batches with no durability across a crash or restart ([BUG-010](../bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md)), same-size-skip files whose metadata correctness was never checked ([BUG-009](../bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md)), and an Event Edit save path that could silently revert an event's status field ([BUG-006](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md)'s second instance). The remediation work directly produced the AI-RM-001 (Metadata Audit & Repair) roadmap milestone: a shared metadata resolver/write engine, a durable crash-recoverable queue, a nine-state event-level derivation that never reports partial work as complete, and a streaming, resumable, archive-wide audit-and-repair capability.

## Impact

**What is evidenced**: the defects listed above are real, confirmed via Git history and code (see each linked BUG record). `docs/metadata-system.md` states directly that the QMZ context-shape defect was "the original root-cause bug this entire [metadata] system was built to fix" — i.e., a defect judged serious enough to justify building an entire archive-wide audit-and-repair capability as a corrective and detective control.

**What is NOT evidenced — do not infer beyond this**: no commit, learning-log entry, or document in this repository states that these defects were discovered by, or affected, any specific real-world archival event, any specific count of files or events, or any named institutional occasion. QMZ was added to the codebase on 2026-07-02/03 (commits `b56f6ba`, `a2e3b7a`) and the context-shape fix landed 2026-08-02 — but no version-tagged release (`chore(release): prepare vX.Y.Z`) exists between those two dates (the prior tagged build was v0.9.9 on 2026-06-16; the next was v0.9.10 on 2026-08-04), so whether QMZ in its defective state ever reached a distributed build used on a real archive, versus being caught entirely pre-release, is **Evidence pending**. This record does not claim actual archive data was lost or that any real event's metadata was left permanently incomplete.

## Timeline

Reconstructed from `git log` (all times/dates from commit metadata, all on the `main` branch):

- **2026-08-02** — `7372239` "feat(metadata): centralize expectations and verified metadata writes" — introduces the single shared resolver and write engine; fixes the QMZ context-shape bug at both entry points ([BUG-007](../bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md)).
- **2026-08-02** — `95af167` "feat(metadata): add durable queue recovery and derived event states" — introduces the durable manifest+journal queue and crash recovery ([BUG-010](../bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md)), the nine-state derivation, and same-size-skip/Transfer Import metadata verification ([BUG-009](../bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md)).
- **2026-08-02** — `55903d5` "feat(metadata): add resumable archive audit and report export" — the audit scanner.
- **2026-08-02** — `7b7a1d1` "feat(metadata): add snapshot-guarded metadata repair" — the repair tool.
- **2026-08-02** — `5ac15eb` "fix(event): preserve status when editing event details" — commit message states this was "found during the production-readiness review's Event Edit investigation. Unrelated to this pass's metadata work" ([BUG-006](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md), second instance).
- **2026-08-02** — `77d9b66` "test(metadata): add pipeline, recovery, audit, repair, and live coverage."
- **2026-08-02** — `fa74845` "docs(metadata): document pipeline, recovery, audit, and repair" — produced the current `docs/metadata-system.md`.
- **2026-08-02** — `4446a30` "feat(ui): consolidate metadata surfaces into a Metadata Management modal."
- **2026-08-03** — `fc8fd39` "feat(ui): upgrade dashboard Metadata tile into a truthful Health card"; `6349c62` "fix(ui): compact Run Audit button; remove obsolete Metadata Audit entry point"; `2c2090a` "fix(ui): rebalance Audit & Repair tab into a full-height flex layout with a single scroll region."
- **2026-08-04** — `c5d200f` "fix(ui): polish Audit & Repair spacing across window heights" — final UI polish, no behavior change per its own commit message. AI-RM-001 marked complete (`docs/product/02_MASTER_ROADMAP.md`).

No commit or document evidences activity in the 10 days immediately prior (last commit before this cluster: `f3d1518`, 2026-07-22, unrelated Transfer Import work) — the "production-readiness review" referenced in `5ac15eb`'s message is the earliest evidenced trigger for this cluster, but its own start date/scope is not independently documented anywhere in the repository.

## Root Cause

Multiple independent root causes converged in the same review window, not one single defect:

1. QMZ's metadata entry points constructed their own metadata context independently of Standard Import's path, producing a context-shape mismatch that silently dropped fields ([BUG-007](../bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md)).
2. Metadata batch progress was tracked only in process memory, with no durable record surviving a crash ([BUG-010](../bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md)).
3. Copy-idempotency's same-size-skip was implicitly read as "no further processing needed," leaving metadata unverified for those files ([BUG-009](../bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md)).
4. Event Edit's full-payload save path silently dropped fields not in its hardcoded field list — a recurring architectural weakness independently found for a second field (`status`) in this same window ([BUG-006](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md)).

## Why Existing Safeguards Failed

Before this remediation, the system had no independent, archive-wide mechanism to detect metadata drift after the fact — the nine-state derivation existed in a simpler form that could report `metadata-complete` for a batch even when a downstream defect (context mismatch, unverified same-size-skip) meant the actual written metadata was wrong or absent. There was no audit capability to catch this class of defect independently of the write path that caused it. A file could look correctly imported (correct folder, correct size, present in `event.json`) while its metadata was silently wrong — the UI and the archive filesystem structure gave no visible signal of the problem.

## Resolution

- **Shared engine**: one resolver (`services/metadataExpectationService.js`) and one write engine (`main/exifService.js`) now serve every metadata-writing workflow — see [DEC-007](../decisions/DEC-007_SHARED_METADATA_ENGINE_RESOLVER.md).
- **Durable queue**: metadata batches now persist across crashes, proven via a real `SIGKILL` mid-batch test — see [DEC-008](../decisions/DEC-008_DURABLE_METADATA_SURVIVES_RESTART.md).
- **Post-hoc verification**: same-size-skip and Transfer Import files now get a dedicated read-only verification pass — see [DEC-009](../decisions/DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md).
- **Archive-wide audit and repair**: a streaming, resumable, cancellable audit scanner (`services/metadataAuditService.js`) and frozen-snapshot repair tool (`main/metadataRepairService.js`) — AI-FEAT-033, the core deliverable of AI-RM-001 — give the archive an independent way to detect and correct metadata drift after the fact, regardless of which write path produced it.

## Follow-up Actions

- AI-RM-001 (Metadata Audit & Repair) is complete — see `docs/product/02_MASTER_ROADMAP.md`. No further scoped follow-up work remains for this specific defect cluster.
- One documented, non-blocking limitation remains: the current UI does not preserve a preview-session identifier that survives the Preview→Confirm round trip in Metadata Repair, so `previewedInThisSession` cannot prove which specific UI click-through produced a given repair run (`docs/metadata-system.md` § Repair Traceability, `AI-FEAT-033`'s Known Bugs section).
- [BUG-006](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md)'s underlying architectural weakness (Event Edit's full-payload write path silently drops any field not in its hardcoded list) has been fixed twice for two specific fields but has **not** been structurally closed — a future field added to `event.json` that Event Edit's full-payload path touches remains at risk unless that path is converted to a spread-based writer. This is open follow-up work, not yet scheduled under any `AI-RM-###` milestone.

## Related

- [BUG-006](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md), [BUG-007](../bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md), [BUG-008](../bugs/BUG-008_LASTMETADATARUN_EISDIR_SILENT_FAILURE.md), [BUG-009](../bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md), [BUG-010](../bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md)
- [DEC-007](../decisions/DEC-007_SHARED_METADATA_ENGINE_RESOLVER.md), [DEC-008](../decisions/DEC-008_DURABLE_METADATA_SURVIVES_RESTART.md), [DEC-009](../decisions/DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md)
- [AI-FEAT-033 — Metadata Audit & Repair](../features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md), roadmap milestone AI-RM-001 (`docs/product/02_MASTER_ROADMAP.md`)
