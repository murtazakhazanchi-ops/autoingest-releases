# DEC-002 — Folder Structure Plus Embedded Metadata

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-004, AI-FEAT-018, AI-FEAT-029 |
| Status | Accepted |
| Date | Established pre-AutoIngest (§3A, project-owner context); automated from v0.7.x onward |
| Evidence status | Known from project history (pre-codebase Adobe Bridge workflow, per project owner, recorded in `docs/product/11_ARCHITECTURAL_EVOLUTION.md` §3A) for the origin; repository-verified for AutoIngest's own implementation (`docs/metadata-system.md`, `docs/event-system.md`) |

## Context

An archive needs to be both humanly navigable (an operator or reviewer browsing a shared drive) and machine/metadata-searchable (fields embedded in the files themselves, portable across tools). Neither alone is sufficient: folders alone give no field-level searchability inside a file, and metadata alone gives no human-navigable structure without opening every file.

## Options Considered

Only the chosen direction is evidenced. The pre-existing Adobe Bridge workflow already used both folder structure and embedded metadata together, so this was not a novel choice AutoIngest weighed against alternatives — it's an inherited principle. No repository evidence exists of a considered "metadata-only, no folder convention" or "folder-only, no embedded metadata" alternative. Full alternatives-considered detail: **Evidence pending**.

1. **Folders and embedded metadata as complementary, neither replacing the other** — the option that was inherited from the pre-existing manual workflow and automated.

## Decision

The folder hierarchy (Collection → Event → SubEvent → Photographer → media, `docs/event-system.md`) remains a deliberate, human-legible encoding of archival context — not an arbitrary storage detail. The same underlying context (who, what event, where) is *also* written directly into file metadata (EXIF/IPTC direct write for JPEG/TIFF, an XMP sidecar for RAW — `docs/metadata-system.md`). Neither replaces the other: folder structure gives human/filesystem navigability; embedded metadata gives field-level, tool-portable searchability that survives a file being moved out of its folder context. This mirrors the "folder structure mirrors applied metadata" principle already established in the pre-AutoIngest Adobe Bridge workflow (`docs/product/11_ARCHITECTURAL_EVOLUTION.md` §3A, §3B).

## Consequences

- Any future search/browse capability (AI-RM-004 Archive Browser, AI-RM-005 Global Search) can rely on *either* signal being present and should treat neither as optional — a file discovered by folder path should still carry correct embedded metadata, and vice versa.
- Folder-naming rules and metadata field rules must be kept in sync deliberately — they encode the same facts through two different mechanisms, so a change to one (e.g. a new component type) generally implies a corresponding change to the other.
- Forecloses collapsing to a database-only or metadata-only model without a folder convention, since that would break the human-navigability half of the decision, and forecloses a folder-only convention without embedded metadata, since that would break tool-portability and field-level searchability.

## Reconciliation Note

None recorded — this decision matches the current technical contract (`docs/metadata-system.md`, `docs/event-system.md`) with no known divergence.
