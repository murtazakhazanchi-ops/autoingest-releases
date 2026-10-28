# DEC-029 — Photographer Registry & Quick Ingest Design Decisions (Six Owner Approvals)

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-061, AI-FEAT-063 / AI-RM-014 |
| Status | Accepted. Decisions 1–4 are final architectural decisions. Decisions 5 and 6 are approved rules whose technical investigations are still pending (see § Finalized vs pending). Implementation of every phase still needs separate owner approval. |
| Date | 2026-10-28 |
| Evidence status | Owner approval given 2026-10-28 ("Final Approval of Six Architectural Decisions"), resolving the open questions recorded in AI-FEAT-063 § Open design questions and AI-FEAT-061 § Expanded phase plan (Q2, Q3, Q8). Code facts referenced are the read-only audit of `origin/stable/0.9` @ `0eb9c43` (AI-FEAT-063 § Current Behavior). No implementation exists. |

## Context

[DEC-028](DEC-028_SHARED_PHOTOGRAPHER_CAMERA_LEARNING_AND_APPROVED_UI_EXCEPTIONS.md) expanded AI-RM-014 to Q0–Q9 and left six questions open: how the registry relates to the existing photographer list, what a rename does, how cards with several photographers are handled, how shoots crossing midnight are classified, what Q8 one-step Quick Ingest must prove first, and how camera metadata is read across manufacturers. The owner approved an answer to each on 2026-10-28.

## Options Considered

1. **Vocabulary.** (a) The registry becomes the source of photographer names and the existing list reads through it. (b) The existing list stays the source of names and the registry links to it. **(b) chosen.**
2. **Rename.** Replace the name only, or keep the old name as an alias. **Keep as alias chosen.**
3. **Several photographers on one card.** Assign everything to one photographer, split the import automatically, or hand off to the existing workspace. **Hand-off chosen.**
4. **Midnight.** Calendar date only, a fixed shoot-day boundary hour, or calendar date by default plus an optional explicit date-and-time range. **Calendar date + optional range chosen.**
5. **Q8.** Approve a design now, or make Q8 conditional on a dependency audit. **Conditional chosen.**
6. **Camera tags.** Assume a common tag set, or establish per-manufacturer mappings from real files. **Evidence-based chosen.**

## Decision

### 1 — Unified Photographer Registry: Option (b) (final)

- The existing photographer list (`data/photographers.json` + `<userData>/photographers.override.json` via `main/listManager.js`, aliases via `main/aliasEngine.js`) **remains the authoritative source of photographer names**.
- The Photographer Registry links profiles to existing photographer records by stable IDs (`vocabularyKey` in the AI-FEAT-063 proposed model).
- A new photographer is also created through the established add-photographer mechanism (`lists:add`), so autocomplete and folder naming see it exactly as today.
- Existing names, IDs, aliases and autocomplete behaviour stay compatible.
- There are never two independently maintained photographer-name lists.
- Camera associations, device identities and learning history belong to the new registry.

### 2 — Photographer renaming: keep the old name as an alias (final)

- The photographer's permanent ID never changes.
- The new display name becomes the current canonical name; the previous name is kept as a searchable alias.
- A rename never renames archive folders, changes media metadata or rewrites existing `event.json` files.
- Name collisions and ambiguous aliases are detected **before** saving.

### 3 — Several photographers on one card: hand off to the existing workspace (final)

When several photographers are identified or strongly suspected on one card:

- Show the detected cameras and their possible photographer associations.
- Never assign every file to one photographer automatically, and never split the import silently.
- Open the existing full workspace for normal file selection, grouping and photographer assignment, keeping relevant source context during the handoff where technically safe.

### 4 — Shoots crossing midnight: calendar date by default, optional cross-midnight range (final)

- Files are classified by their original capture **calendar date** by default; today's files are preselected; files captured after midnight appear under the next calendar date.
- An **optional date-and-time range** is provided for shoots that continue past midnight. When a range is explicitly selected, files captured within it are included even across two dates.
- Uncertain capture dates stay separate for manual review.
- Camera timestamps never automatically change an event's Hijri date or naming.
- The first Q2 implementation may ship calendar-date classification only. **The cross-midnight range is an explicit planned requirement of AI-RM-014 and must not be dropped from the roadmap.**

### 5 — One-step Quick Ingest (Q8): conditional requirement, not an approved design

Before Q8 is implemented:

- Audit whether the existing import pipeline can run safely without the main window's grouping state.
- Confirm event, component, photographer and archive routing requirements.
- Reuse the existing copy, metadata and verification services; never create a second import engine.
- When mandatory information is missing, hand off to the existing workspace.

Q8's detailed technical design needs a **separate review after the dependency audit**.

### 6 — Camera metadata by manufacturer: evidence-based identification only

- Use the existing ExifTool infrastructure (`exiftool-vendored`, `main/exifService.js`) where appropriate.
- Investigate actual manufacturer / model / serial / date availability on representative Canon, Sony, Nikon and other supported camera files.
- Never assume every manufacturer exposes the same tags.
- Preserve provenance (which tag supplied each value) and distinguish **missing**, **ambiguous** and **conflicting** metadata.
- Manufacturer + model alone never establishes a unique photographer identity.
- Exact per-manufacturer tag mappings remain subject to testing with real camera files **before Q3 implementation approval**.

## Finalized vs pending

| # | Decision | Architectural status | Technical work still pending | Gate |
|---|---|---|---|---|
| 1 | Unified registry, option (b) | **Final** | Integration design detail within option (b) | Q4 design review |
| 2 | Rename keeps alias | **Final** | None beyond implementation | — |
| 3 | Multi-photographer → handoff | **Final** | Which source context can safely travel with the handoff | Q8 / Q9 |
| 4 | Calendar date + optional range | **Final** | Range selection may follow the first Q2 implementation | Tracked in AI-RM-014 Deliverables; must not be dropped |
| 5 | Q8 conditional | **Approved requirement; design not approved** | Import-pipeline dependency audit (Evidence pending — not yet audited) | Separate design review before Q8 |
| 6 | Evidence-based camera identification | **Approved rule** | Per-manufacturer tag measurement on real files (Evidence pending) | Before Q3 implementation approval |

## Consequences

- AI-FEAT-063 open design questions 1–3 are resolved; the proposed data model's `vocabularyKey` and `aliases` fields are confirmed in direction. New test rows cover rename-as-alias, pre-save collision detection and single-list registration.
- AI-FEAT-061 Q2 gains the optional cross-midnight range as a tracked requirement and the Hijri-date safeguard; Q3 gains the evidence-and-provenance rule; Q8 stays conditional.
- Roadmap risk R11 (one vocabulary) is resolved by decision; R12 (Q8 audit) and the camera-tag evidence gap remain open as investigations.
- No application code, UI or branch changes. DEC-027 and DEC-028 remain in force.

## Reconciliation Note

None — no conflict with a technical doc under `docs/`. Resolves the open questions recorded in DEC-028 § Consequences and AI-FEAT-063; DEC-028 itself is not superseded.
