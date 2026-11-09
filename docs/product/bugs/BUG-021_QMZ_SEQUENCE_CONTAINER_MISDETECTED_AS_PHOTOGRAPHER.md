# BUG-021 — QMZ Sequence Container Misdetected as Photographer (Attribution + Folder Sequencing)

| Field | Value |
|---|---|
| Related feature(s) | [AI-FEAT-047](../features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md), [AI-FEAT-022](../features/AI-FEAT-022_PHOTOGRAPHER_FOLDER_RESOLUTION.md) |
| Status | Fixed |
| Severity | High |
| Discovered | 2026-11-06 (user report) |
| Fixed | 2026-11-06, commit `43737fc440338f46f72cb87f6b7a6ca2210e7bb1` |
| Evidence status | Verified from code, 203 passing regression assertions (89 re-verified fresh before release — see Fix), and one controlled live Electron session against disposable fixtures |

## Symptom

Two related symptoms, same root cause:

1. **Creator metadata corruption.** A photo's `XMP-dc:Creator`/`EXIF:Artist`/`IPTC:By-line` was written as a QMZ sequence code (e.g. `"27Z"`) instead of the real photographer name, whenever routine processing (QMZ auto-queue, reassignment, move, reapply, retry, or resume) resolved the photographer from a file path that passed directly through a QMZ sequence folder (`01Q`, `02M`, …) or a holding folder (`_Unsequenced`, `Enroute`).
2. **Photographer Folder Sequence dialog misdetection.** The same first-folder-below-root assumption made the "Sequence Photographer Folders" dialog list the QMZ container itself (e.g. `01Q`) as if it were a photographer, instead of the real photographer folder nested one level inside it.

## Root Cause

Both `services/eventEvidenceReconstruction.js`'s `resolvePhotographerFromPath()` and `services/photographerSequenceService.js`'s `scanPhotographerFolders()` assumed the first folder segment below the event (or component) root is always the photographer. That assumption breaks for any event using QMZ: the first segment is a sequence/holding container, and the real photographer folder is nested one level deeper inside it.

A second, independent defect compounded the corruption: even where the photographer *was* eventually resolved correctly, routine metadata processing had no read-before-write gate — it treated "folder resolves to a different photographer than what's already on the file" as authorization to overwrite the existing Creator/Artist/By-line, and Audit/Repair would silently "self-heal" an already-corrupted sequence-like Creator value back to the folder-derived name. Fixing only the path-resolution bug without this second fix would have left QMZ auto-queue and reassignment still able to silently overwrite legitimate existing attribution for non-QMZ reasons.

## Investigation Log

- **2026-11-06** — Traced both symptoms to the same first-folder-assumption bug via `resolvePhotographerFromPath`/`scanPhotographerFolders`.
- **2026-11-06** — While fixing, identified that attribution preservation needed to be unconditional (apply to *all* routine processing, not only the fully-unresolved case), that "capture" vs "routine" was a false distinction (QMZ auto-queue is routine processing, never an authorized name change), and that Audit/Repair's own self-healing of corrupted Creator values had to be removed — Audit must stay read-only; correction requires an explicit, currently-internal-only helper (`applyExplicitAttributionCorrection`), never automatic.
- **2026-11-06** — Found and closed an Audit-visibility gap: `intentDiagnostics` were computed but never rendered in the renderer, and a `photographerUnresolved` record could field-diff as "match" and vanish from the Audit exceptions list as falsely `'complete'`.
- **2026-11-06** — Found and closed a second visibility gap during final diff review: Audit's fail-soft RAW-embedded-tag read could let a clean-looking sidecar value classify as `'complete'` even when the RAW's own embedded tags were genuinely unverified — added `rawEmbeddedUnverified` + forced non-`'complete'` status.
- **2026-11-07** — Live-verified in one controlled Electron session against disposable sample fixtures (photographers nested inside `01Q` and `_Unsequenced`): sequencing dialog correctly listed the nested photographer folders; user independently confirmed this visually. Attempted, but could not reproduce live, the "RAW file's own embedded attribution is unreadable" sub-case — ExifTool does not throw on genuinely garbage RAW bytes, it returns an `errors` field instead; this sub-case remains unit-tested only.

## Fix

Commit `43737fc440338f46f72cb87f6b7a6ca2210e7bb1` (released as v0.9.17):

- `services/eventEvidenceReconstruction.js` — `resolvePhotographerFromPath()` now returns `{photographer, unresolved}`, recognizing QMZ sequence codes and holding folders (`_Unsequenced`, `Enroute`) as containers, never as the photographer; added `PHOTOGRAPHER_UNRESOLVED_QMZ` diagnostic.
- `services/photographerSequenceService.js` — added `isQmzContainerName()`; `scanPhotographerFolders()` rewritten to be nested-scope-aware (a QMZ container's real photographer folders are discovered as their own scope, never renamed as if the container itself were a photographer); `resolveScopeBaseDir()` added with path-traversal rejection.
- `main/exifService.js` — added `_readCurrentAttribution()` (checks sidecar **and** the RAW file's own embedded tags before treating attribution as absent; a read failure is never treated as "absent" and never authorizes a write) and an unconditional preserve gate in `_writeAndVerify()` covering every automatic write path uniformly (QMZ auto-queue, reassignment, move, reapply, retry, resume). Added `applyExplicitAttributionCorrection()` — the only function allowed to overwrite existing attribution, never called automatically; currently an internal helper, **not yet a completed user-facing approval workflow**.
- `services/metadataAuditService.js` — added `CREATOR_SUSPECTED_CORRUPTION`, `CREATOR_ATTRIBUTION_CONFLICT`, `CREATOR_RAW_EMBEDDED_UNVERIFIED` diagnostics; a file with unresolved photographer, conflicting Creator/Artist/By-line, or unverified RAW-embedded tags can never classify as `'complete'` (so it can't silently disappear from the Audit exceptions list).
- `renderer/renderer.js` — Audit exceptions list now renders `intentDiagnostics` text, so these warnings are actually visible, not just recorded internally.
- `scripts/qmz-attribution-repair-plan.js` — new preview-only tool that proposes photographer corrections for already-damaged attribution; it never writes, and applying a correction requires a separate, explicit, human-approved step.

Regression coverage: 26 (`qmzAttributionPreservationFix.test.js`) + 16 (`qmzCreatorAttributionFix.test.js`) + 20 (`qmzPhotographerFolderSequencingFix.test.js`) + 21 (`eventEvidenceReconstruction.test.js`) + 6 (`metadataAuditExport.test.js`) = 89 assertions, re-run clean immediately before this release; 203 assertions clean across the full pure-logic suite at commit time.

## Prevention / Reusable Lesson

A "first folder below a known root is the X" path-resolution assumption breaks silently whenever a domain-specific container folder (here, a QMZ sequence/holding folder) can occupy that position — the fix must make the resolver aware of every container convention that can appear there, not just validate the happy path. Separately: **routine, automatic processing must never be allowed to overwrite existing user-meaningful data (here, photographer attribution) just because its own derived value disagrees** — a "self-healing" write in response to suspected corruption is itself a silent overwrite and must be rejected in favor of visible reporting plus a separate, explicit, approved correction step. This is the same resolver-ambiguity principle as [BUG-002](BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md) (never guess when structure is ambiguous) applied to a new path-resolution context, plus a distinct new principle about read-before-write gating on anything already user-attributed.

## Related

[BUG-002](BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md), [BUG-007](BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md), [AI-FEAT-047](../features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md), [AI-FEAT-022](../features/AI-FEAT-022_PHOTOGRAPHER_FOLDER_RESOLUTION.md)
