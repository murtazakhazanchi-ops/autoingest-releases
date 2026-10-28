# DEC-028 — Shared Photographer & Camera Learning; Merge-Not-Replace Registry Exchange; Two Approved Main-Window Exceptions

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-061, AI-FEAT-063, AI-FEAT-034 / AI-RM-014 |
| Status | Accepted (direction and scope). Implementation of each phase still needs separate owner approval. |
| Date | 2026-10-28 |
| Evidence status | Owner direction given in the 2026-10-28 planning brief ("Consolidate Quick Ingest Roadmap & Photographer Intelligence"). Code facts verified read-only from `origin/stable/0.9` @ `0eb9c43` (see AI-FEAT-063 § Current Behavior). |

## Context

The owner expanded AI-RM-014 beyond the Q0 plan: smart date-based card assessment, automatic camera identification, a photographer↔camera learning system, a centralized Photographer Registry, safe registry import/export across AutoIngest computers, photographer suggestions in the existing Confirm Event Import modal, and a streamlined one-step Quick Ingest. Two of these need the main window, which [DEC-027](DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md) froze.

## Options Considered

1. **Quick-Ingest-private learning store** inside the companion. Rejected by the owner: photographer identification would then differ between the companion and the standard import, and camera details would be entered twice.
2. **Shared backend learning service + registry**, used by every workflow that identifies a photographer. **Chosen.**
3. **Registry import replaces the local registry** (simple file sync). Rejected: AutoIngest runs on several computers; replace would silently delete local profiles and associations.
4. **Registry import merges, with preview-first conflict resolution and local-wins defaults.** **Chosen.**
5. **Keep the main window fully frozen** and put the registry and suggestions only in the companion. Rejected: the standard import flow would not benefit, and the registry needs a management surface beside the existing Keyword Registry.
6. **Two narrowly scoped main-window exceptions** (below), everything else stays frozen. **Chosen.**

## Decision

- **Photographer & Camera Learning is one shared backend capability** (AI-FEAT-063), not exclusive to Quick Ingest. Initial integration points: menu-bar Quick Ingest, the standard Confirm Event Import modal, Photographer Registry management. Future consumers: Archive Browser, Event Maintenance, AutoIngest Archive Node. A photographer's camera details are recorded once and reused consistently.
- **Approved main-window exceptions to DEC-027** (design scope for future implementation — not permission to implement during a documentation task):
  1. A **Photographer Registry** tab in the existing Metadata Management window, immediately beside the Keyword Registry tab.
  2. The **photographer field** of the existing Confirm Event Import modal gains automatic suggestions and inline Add Photographer (profile creation with automatic camera capture). The modal's layout, workflow and other controls are preserved.
  Neither window is redesigned. Every other main-window surface (layout, navigation, styling, grouping, Event Creator, source browser, tag refinement, QMZ, Transfer) stays frozen; any further change needs separate approval. The companion may receive its own new UI.
- **Registry exchange merges, never replaces.** Default choice always preserves local data. "Keep both" never creates contradictory device identities nor marks both associations equally certain. Preview-first, transactional, with backup and a summary.
- **Association safety rules** recorded permanently in AI-FEAT-063 § Permanent association safety rules (a camera is evidence, not proof; operator confirms; no silent overwrite; no archive side effects).
- **Sequencing:** the registry and learning system do not depend on AI-RM-015 Backup Intelligence, but their schemas (opaque permanent IDs, per-installation provenance, append-only history, schema versions) stay compatible with it.
- **AI-RM-014 phases re-planned** as Q0–Q9 (AI-FEAT-061 § Expanded phase plan). The Q0 plan's Q2–Q7 rows are kept, marked superseded, with a mapping.
- **Independent one-step Quick Ingest is now in scope (Q8)**, superseding the Q0 deferral, on the condition that it reuses the existing import routing, metadata tagging, duplicate handling and verification services, and hands off to the existing workspace whenever event, photographer, destination or grouping requirements are not already satisfied. No parallel copy engine.

## Consequences

- Two main-window files will eventually change in Q5/Q6 (`renderer/index.html` Metadata Management tabs; the photographer field wiring in `renderer/renderer.js` / `renderer/treeAutocomplete.js`). The Q1 UI-freeze guard test must be narrowed to allow exactly those surfaces when those phases start, and visual regression must stay clean elsewhere.
- A new persistent per-computer store (`<userData>/`) appears; it must be atomic, backed up before merges, and never touch `event.json` or archived media.
- The photographer vocabulary gains stable IDs without a second list; the integration choice is an open design question recorded in AI-FEAT-063.
- Q8 requires an audit of whether the existing import IPC can be driven without the renderer's grouping state before any design is approved (evidence pending).

## Addendum — 2026-10-28 (owner: six design decisions)

The open questions listed under § Consequences (one photographer vocabulary; and, in AI-FEAT-063/AI-FEAT-061, rename semantics, multi-photographer cards, the shoot-day boundary, the Q8 pipeline audit and per-manufacturer camera tags) were answered by the owner and recorded in [DEC-029](DEC-029_PHOTOGRAPHER_REGISTRY_AND_QUICK_INGEST_DESIGN_DECISIONS.md). DEC-028 is not superseded; DEC-029 refines it. Decisions 1–4 are final; decision 5 (Q8) remains conditional on a dependency audit and a separate design review; decision 6 (camera tags) remains subject to measurement on real camera files before Q3 approval.

## Reconciliation Note

None — no conflict with a technical doc under `docs/`. DEC-027 remains in force except for the two exceptions above (see DEC-027 Addendum 2026-10-28).
