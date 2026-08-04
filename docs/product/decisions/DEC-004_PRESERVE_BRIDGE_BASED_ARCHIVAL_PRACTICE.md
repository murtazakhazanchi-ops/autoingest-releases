# DEC-004 — Preserve Established Bridge-Based Archival Practice

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-029, AI-FEAT-036 |
| Status | Accepted |
| Date | Pre-AutoIngest origin (§3A); Bridge-import continuity point implemented by 2026-05-09 (AI-FEAT-036 first-known implementation) |
| Evidence status | Known from project history for the pre-codebase origin (recorded as stated by the project owner during `docs/product/11_ARCHITECTURAL_EVOLUTION.md`'s creation, 2026-08-04, marked there as not independently verifiable from repository artifacts since it predates the codebase); repository-verified for AutoIngest's own continuity mechanism (`AI-FEAT-036`, `renderer/index.html` UI copy) |

## Context

Before AutoIngest existed, photographs were imported and organized manually using Adobe Bridge: photographer details, event information, location, city, keywords, copyright, and other metadata were applied directly to files, and the approved folder structure reflected that applied metadata by manual convention. Professional review and correction remained a human process. Building an automated ingestion system risked either replacing this established practice wholesale or silently redefining what it meant.

## Options Considered

Only the chosen direction is evidenced in the repository. No commit, doc, or code path evidences an alternative where AutoIngest was built to replace Adobe Bridge, the controlled vocabulary, or human review entirely. Full alternatives-considered detail: **Evidence pending** beyond the chosen direction.

1. **Automate and standardize the existing Bridge-based workflow, without replacing Bridge, embedded/XMP metadata conventions, structured foldering, or human review** — the option that was built.

## Decision

AutoIngest automates and standardizes the established Aljamea-tus-Saifiyah archival workflow rather than replacing it. The Collection/Event/SubEvent/Photographer folder hierarchy, the Creator/Copyright/Keywords/Location/City/Country metadata fields, and the "folder structure mirrors applied metadata" principle are automations of a workflow that already existed, not new inventions (`docs/product/11_ARCHITECTURAL_EVOLUTION.md` §3A, §3B). Adobe Bridge remains relevant for registry management, inspection, verification, correction, and professional review; AutoIngest does not claim Bridge or human review is obsolete. The concrete, current point of continuity is the Keyword Registry's (AI-FEAT-036) direct support for importing an Adobe Bridge keyword export (`.txt`) to expand its controlled vocabulary — existing keywords are never deleted by this import (`renderer/index.html` UI copy, cited in `docs/product/11_ARCHITECTURAL_EVOLUTION.md` §3C).

## Consequences

- Future metadata or vocabulary features must treat the Bridge-established controlled vocabulary as authoritative to extend, not replace — see [DEC-014](DEC-014_CONTROLLED_KEYWORD_REGISTRY.md).
- AutoIngest documentation (including this documentation system) must not represent AutoIngest as the sole or originating archival workflow, or represent Adobe Bridge and human review as legacy/obsolete — this is an explicit, enforced framing (`docs/product/11_ARCHITECTURAL_EVOLUTION.md` §3H, §4).
- Forecloses building a competing/parallel vocabulary or foldering convention that diverges from the Bridge-established one without an explicit, separately-recorded decision to do so.

## Reconciliation Note

None recorded — no known divergence between this decision and current technical or product documentation.
