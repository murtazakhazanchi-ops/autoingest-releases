# AI-FEAT-063 — Photographer & Camera Identity Registry (Learning, Registry, Exchange)

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-063 |
| Category | Metadata |
| Status | Planned |
| Maturity | Planned |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-036 (Keyword Registry — precedent for a controlled vocabulary with additive, never-delete import), AI-FEAT-034 (Metadata Management Modal — hosts the new Photographer Registry tab), AI-FEAT-022 (Photographer Folder Resolution — photographer names drive archive folder naming; this feature must not change that), AI-FEAT-029 (Metadata Writing Engine — Creator fields are written from the selected photographer; unchanged), AI-FEAT-061 (Quick Ingest & Desktop Companion — first consumer, and owner of the source-metadata reader that supplies camera evidence) |
| Related roadmap milestone | AI-RM-014 |
| Related technical docs | `docs/metadata-system.md`, `docs/ingestion-flow.md`, `docs/data-model.md` — none yet describe this feature, because nothing is implemented |
| Evidence status | Confirmed zero implementation (2026-10-28 read-only audit of `origin/stable/0.9` @ `0eb9c43`): no camera make/model/serial extraction and no photographer↔device association anywhere under `main/`, `services/`, `renderer/`. Requirements below are owner direction recorded 2026-10-28; the data model is a **proposal for review**, not shipped behaviour. |
| First-known implementation | Not started |
| Latest major update | 2026-10-28 — six owner design decisions approved ([DEC-029](../decisions/DEC-029_PHOTOGRAPHER_REGISTRY_AND_QUICK_INGEST_DESIGN_DECISIONS.md)): option (b) single photographer list, rename keeps alias, multi-photographer handoff |

## Lifecycle Metadata

| Field | Value |
|---|---|
| Related features | AI-FEAT-061 (phases Q3–Q8 consume this feature); AI-FEAT-062 (Backup Intelligence — later archive-wide identity; this feature must not depend on it, see Dependency on AI-RM-015) |
| Related decisions | [DEC-029](../decisions/DEC-029_PHOTOGRAPHER_REGISTRY_AND_QUICK_INGEST_DESIGN_DECISIONS.md) (approved design decisions), [DEC-028](../decisions/DEC-028_SHARED_PHOTOGRAPHER_CAMERA_LEARNING_AND_APPROVED_UI_EXCEPTIONS.md), [DEC-027](../decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md) (main-window UI freeze; DEC-028 records the two approved exceptions) |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | None yet — will qualify when a persistent, app-wide identity store exists |
| Related release notes | Not applicable — not released |
| Testing coverage | Not applicable — feature not yet implemented (planned matrix below) |
| Documentation completeness | Requirements, proposed model and the approved design decisions (DEC-029) recorded; technical investigations (per-manufacturer tags) still pending |

## Summary

One shared backend capability that remembers which photographers use which cameras, so AutoIngest can **suggest** (never decide) the photographer for an import. Camera details are captured automatically from the media, confirmed once by the operator, and reused everywhere photographer identification is needed: the menu-bar Quick Ingest companion, the existing Confirm Event Import modal, and a new Photographer Registry tab in Metadata Management. Registries are portable between AutoIngest computers through a versioned export file whose import **merges, never replaces**.

## Current Behavior

Not implemented. Facts about the existing code this builds on (audit of `origin/stable/0.9` @ `0eb9c43`):

| Area | What exists today | Consequence |
|---|---|---|
| Photographer vocabulary | `data/photographers.json` — a flat array of 312 names. Local additions go to `<userData>/photographers.override.json` via `main/listManager.js` (`FLAT_LISTS` includes `photographers`; atomic tmp+rename writes). `main/main.js` IPC `lists:get` / `lists:match` / `lists:add` / `lists:learnAlias` route `photographers` through `listManager` + `main/aliasEngine.js` (aliases in `<userData>/photographers.aliases.json`, keyed by a slug `canonicalId`). | The canonical vocabulary is **names**, with slug-keyed aliases. There is no stable, rename-proof photographer ID today. The registry must adopt this vocabulary, not start a second list. |
| Photographer entry in the UI | `renderer/treeAutocomplete.js` (`ALLOW_ADD` includes `photographers`) powers the photographer field, including the Confirm Event Import modal (`renderer/index.html` "Confirm Event Import", container `#qiModalPhotographerContainer`, wired in `renderer/renderer.js`) and `renderer/importSessionUI.js`. Add New already writes through `lists:add`. | Q6's inline "create profile" is an enhancement of an existing add path, not a new field. |
| Where the photographer travels | The import job carries `job.photographer` as a name string (`main/main.js`), which reaches routing, folder naming (AI-FEAT-022, `services/photographerSequenceService.js`) and Creator metadata (AI-FEAT-029). | Registry edits (rename, merge) must never rewrite past imports, archive folders, media or `event.json`. |
| Metadata Management modal | `renderer/index.html` tabs `Metadata` · `Audit & Repair` · `Keyword Registry` (`#msTab-registry`). | The Photographer Registry tab goes immediately after `Keyword Registry` (DEC-028 exception 1). |
| Camera metadata | ExifTool (`exiftool-vendored`, `main/exifService.js`) and `exifr` (used by `main/qmzService.js` for `DateTimeOriginal`/`CreateDate`) are already dependencies. Nothing reads `Make`, `Model` or any serial-number tag today. | Extraction is new, read-only work (AI-FEAT-061 Q3). |

## Original Plan / Intent

Owner direction, 2026-10-28 (verbatim requirements condensed; see [DEC-028](../decisions/DEC-028_SHARED_PHOTOGRAPHER_CAMERA_LEARNING_AND_APPROVED_UI_EXCEPTIONS.md)).

### Learning system (AI-RM-014 Q4)

- Learns a photographer↔camera association **only after operator confirmation**.
- A photographer may have many cameras; a camera may be used by many photographers.
- Recognizes previously confirmed make/model/serial combinations and suggests the photographer on later imports.
- Corrections never silently delete history. Confirmation history and association confidence are recorded.
- Works when the serial number is missing, and never claims certainty when only the model matches.
- **Shared by every workflow** that identifies a photographer (Quick Ingest, the standard import modal, the registry). It is not a Quick Ingest private store.

### Photographer Registry tab (AI-RM-014 Q5)

New tab in the existing Metadata Management window, immediately beside Keyword Registry. View, search (by name, camera model, available device identifiers), view associated devices, add/edit profiles, manage confirmed associations, import/export, review conflicts and previous associations. Reuses the existing photographer vocabulary.

### Automatic profile creation during import (AI-RM-014 Q6)

In the existing Confirm Event Import modal (only the photographer field and its guidance change) and in the menu-bar companion, using the same service:

1. Validate the typed name. 2. Check normalized names, aliases and likely existing matches. 3. Offer inline "create photographer profile". 4. Ask the operator to confirm the name. 5. Capture available camera and card metadata automatically. 6. Save the profile and the confirmed device association durably. 7. Select the new photographer in the field. 8. Continue the established import.

The operator never types camera model or serial when they can be extracted. Unknown fields stay unknown. Recognized camera → prefill the suggestion, still require confirmation. Known photographer + new camera → offer to remember the camera. Choosing another photographer is always possible.

### Exchange & merge (AI-RM-014 Q7)

Portable, versioned export of the whole registry; import defaults to **merge, not replace**; preview-first conflict resolution; transactional apply with backup and a summary. Detailed rules below.

## Proposed data model (for review — not implemented)

Stored per computer under `<userData>/` as one schema-versioned JSON document written atomically (tmp + rename, the `listManager` pattern), with a timestamped backup before every import-merge or bulk change. IDs are generated, opaque and permanent (never reused, never derived from a name).

```js
PhotographerRegistry = {
  schemaVersion: 1,
  installId,                       // random per-installation id; provenance only, never a secret
  photographers: [Photographer],
  devices:       [CameraDevice],
  associations:  [Association],
  history:       [HistoryEntry],   // append-only
}

Photographer = {
  photographerId,                  // opaque, permanent
  displayName,                     // MUST equal a name in the existing photographer vocabulary
  vocabularyKey,                   // the aliasEngine canonicalId the name resolves to today (compatibility bridge)
  aliases: [string],
  status: 'active' | 'retired',    // retired is never deleted
  createdAt, createdBy: { installId, workflow },
}

CameraDevice = {
  deviceId,                        // opaque, permanent
  make, model,                     // normalized for matching; raw values kept for display
  serial: string | null,           // null = not available in the media — never guessed
  serialSourceTag: string | null,  // which metadata tag supplied it (e.g. EXIF BodySerialNumber)
  identityStrength: 'serial' | 'model-only',
  firstSeenAt, lastSeenAt,
}

Association = {
  associationId, photographerId, deviceId,
  state: 'confirmed' | 'disputed' | 'superseded' | 'retired',
  confirmations: [{ at, installId, workflow: 'quick-ingest' | 'import-modal' | 'registry' | 'registry-import' }],
  supersededBy: associationId | null,
  origin: 'local' | 'imported',    // provenance; imported records keep the source installId
}
```

**Confidence is derived, not stored as truth.** At suggestion time: *strong* = serial-identified device with exactly one active confirmed association; *possible* = model-only match, or a device with several active associations; *none* = no match. A *possible* suggestion is shown as a choice, never preselected as certain. Disputed associations are never suggested as strong.

**Device identity rule.** Two device records are the same device only when make, model and serial all match after normalization. Model alone never merges devices. A model-only device record is a separate, weaker record and is not upgraded automatically when a serial later appears — the operator confirms the link.

## Permanent association safety rules

1. A camera does not prove who the photographer is; cameras are borrowed and shared.
2. Make and model alone are never enough for a strong automatic attribution.
3. A serial number is useful evidence, but may be missing or inconsistent across file types.
4. The operator confirms or changes every suggested photographer.
5. An existing camera↔photographer association is never silently overwritten. Corrections create a new association and mark the old one `superseded`, with history.
6. Provenance and correction history are preserved (append-only `history`).
7. Different cameras in one selection are handled explicitly (per-camera suggestion, or one photographer applied deliberately to all).
8. Missing camera metadata never blocks manual photographer selection.
9. Every successful profile creation and association update is durably saved before the UI reports success.
10. Saving or editing a profile never alters archived media, archive folders or `event.json`.
11. Registry data stays portable and merge-safe.

## Registry exchange format & merge rules

**Export** (whole registry in v1): `{ format: 'autoingest-photographer-registry', formatVersion: 1, exportedAt, exportedBy: { installId, appVersion }, scope: 'full', photographers, devices, associations, history }`. A `since`/cursor field is reserved for future incremental exports; v1 does not implement it.

**Import default: MERGE, NOT REPLACE.** Computer B importing Computer A's file:

- adds photographers genuinely missing on B;
- keeps photographers, devices and associations that exist only on B;
- never creates a duplicate for an identical photographer (same `photographerId`, or same normalized name confirmed by the operator as the same person);
- never overwrites local data silently, and never deletes anything because it is absent from the file.

**Conflicts detected and shown in a preview before anything is written:**

| Conflict | Default | Other choices |
|---|---|---|
| Same `photographerId`, different data | keep local | accept incoming field; skip record |
| Same/similar name, different IDs | keep both as separate, flagged for review | operator marks them as the same person (the local ID wins; the incoming ID is recorded as an alias ID) |
| Same serial associated with different photographers | keep local association | keep both (incoming stored `disputed`, never strong); accept incoming (local becomes `superseded`); skip |
| Different serials for apparently identical device records | keep as separate devices | — (never merged automatically) |
| Conflicting association histories | union of history entries, de-duplicated | — |
| Duplicate records inside the incoming file | first valid occurrence, rest reported | skip all |
| Invalid / unsupported data (unknown `formatVersion`, schema errors, missing IDs) | reject that record | cancel the entire import |

The operator can also **cancel the entire import** at any point before apply. "Keep both" never produces two device records with the same make/model/serial, and never marks both associations as equally certain.

**Transaction:** validate file → build merge plan → preview with per-conflict choices → backup current registry → apply in memory → validate result → single atomic write → summary (added / kept / skipped / disputed counts). Any failure before the write leaves the registry untouched; the backup allows restore after a completed import.

This is a portable, operator-driven exchange. It is **not** an automatic or destructive synchronization mechanism.

## Open design questions (to resolve at the start of Q4, before code) — resolved 2026-10-28 by DEC-029

1. **One vocabulary, two stores?** The registry must not become a second photographer list. Options: (a) the registry becomes the source and `listManager`'s `photographers` list reads through it; (b) the registry references vocabulary names by `vocabularyKey` and every new profile is also written through the existing `lists:add` path. Needs an `autoingest-architect` review. Evidence pending — not yet decided.
   **Resolved 2026-10-28 (DEC-029 decision 1): option (b).**
2. **Rename semantics.** Renaming a profile changes future suggestions only. Whether a rename should also add the old name as an alias is to be decided; it must never rename folders or rewrite past `event.json`.
   **Resolved 2026-10-28 (DEC-029 decision 2): the old name is kept as a searchable alias.**
3. **Multi-photographer cards.** When one card holds several cameras with different suggested photographers, does the existing import (one photographer per import job today) need to split, or hand off to the workspace? Default until decided: hand off (AI-FEAT-061 Q8).
   **Resolved 2026-10-28 (DEC-029 decision 3): hand off to the existing full workspace.**

## Approved design decisions ([DEC-029](../decisions/DEC-029_PHOTOGRAPHER_REGISTRY_AND_QUICK_INGEST_DESIGN_DECISIONS.md), 2026-10-28)

Final architectural decisions — binding on Q4–Q7 design and implementation.

**Decision 1 — Unified Photographer Registry: option (b).**
- The existing photographer list (`data/photographers.json` + `photographers.override.json` via `main/listManager.js`; aliases via `main/aliasEngine.js`) remains the **authoritative source of photographer names**.
- Registry profiles link to existing photographer records by stable IDs (`vocabularyKey`).
- A new photographer is also created through the established add-photographer mechanism (`lists:add`).
- Existing names, IDs, aliases and autocomplete behaviour stay compatible. There are never two independently maintained photographer-name lists.
- Camera associations, device identities and learning history belong to the registry.

**Decision 2 — Renaming keeps the old name as an alias.**
- The permanent `photographerId` never changes; the new display name becomes the current canonical name; the previous name stays searchable as an alias.
- A rename never renames archive folders, changes media metadata or rewrites existing `event.json` files.
- Name collisions and ambiguous aliases are detected **before** saving.

**Decision 3 — Several photographers on one card: hand off.**
- Show the detected cameras and possible photographer associations; never assign every file to one photographer automatically; never split the import silently.
- Open the existing full workspace for normal selection, grouping and photographer assignment, keeping relevant source context where technically safe (AI-FEAT-061 Q8).

**Decision 6 (shared with AI-FEAT-061 Q3) — Evidence-based camera identification.** Manufacturer + model alone never establishes a unique photographer identity. Provenance is kept for each device field, and missing, ambiguous and conflicting metadata are distinguished. Per-manufacturer tag mappings are measured on real camera files before Q3 approval.

### Finalized vs pending (this feature)

| Item | Status |
|---|---|
| Single photographer-name list, registry links by stable ID | **Final** (decision 1) |
| Rename keeps alias; no archive side effects; pre-save collision check | **Final** (decision 2) |
| Multi-photographer cards hand off | **Final** (decision 3) |
| Exact integration mechanics within option (b) (how `vocabularyKey` maps to `listManager`/`aliasEngine` entries) | Design detail for the Q4 design review — Evidence pending |
| Which device tags each manufacturer writes | Technical investigation — Evidence pending (DEC-029 decision 6) |

## Dependency on AI-RM-015 (Backup Intelligence)

This feature does **not** depend on AI-RM-015 and can ship before it. Compatibility requirements so it does not need a later rewrite: opaque permanent IDs; `installId` provenance on every record and confirmation; append-only history; a schema version on both the store and the exchange file. AI-FEAT-062 may later link source sessions and import receipts to `deviceId`, and may use the same `installId` concept for archive-instance reconciliation. Neither feature may treat the other's absence as an error.

## Planned test matrix

| # | Area | Key assertions |
|---|---|---|
| 1 | Learning only after confirmation | an unconfirmed suggestion writes nothing; confirmation writes one association + history entry durably |
| 2 | Many-to-many | one photographer, several devices; one device, several photographers → suggestion is *possible*, not *strong* |
| 3 | Missing serial | model-only device stays model-only; never merged with a serial-identified device; suggestion *possible* |
| 4 | Correction | changing the photographer for a known device supersedes, never deletes; history shows both |
| 5 | Vocabulary reuse | no photographer name exists in the registry that the existing photographer field cannot select, and vice versa |
| 6 | No archive side effects | profile create/edit/rename leaves fixture archive folders, media and `event.json` byte-identical |
| 7 | Export round trip | export → import into an empty registry reproduces it exactly |
| 8 | Merge, not replace | local-only records survive; nothing deleted for absence; identical photographers not duplicated |
| 9 | Each conflict class | each row of the conflict table produces the documented default and honours each choice |
| 10 | Cancel & failure | cancel or an injected write failure leaves the registry byte-identical; backup restorable |
| 11 | Unsupported version / malformed file | rejected with a clear message; nothing written |
| 12 | Main-window freeze | the only main-window diffs are the Photographer Registry tab and the photographer-field enhancement (DEC-028); visual regression elsewhere unchanged |
| 13 | Rename keeps alias (DEC-029) | rename keeps `photographerId`; old name found by search and autocomplete as an alias; fixture folders, media and `event.json` byte-identical |
| 14 | Pre-save collision check (DEC-029) | a rename or new profile that collides with an existing name or alias, or makes an alias ambiguous, is reported before anything is written |
| 15 | Single list (DEC-029) | a profile created in the registry or the import modal appears in the existing photographer list through `lists:add`; no second name list exists on disk |

## Evolution / Implementation Journal

- **2026-10-28 — Requirements recorded.** Owner approved the Photographer & Camera Learning System, centralized Photographer Registry, safe registry import/export with conflict resolution, and photographer suggestions in the existing Confirm Event Import modal, as part of AI-RM-014 ([DEC-028](../decisions/DEC-028_SHARED_PHOTOGRAPHER_CAMERA_LEARNING_AND_APPROVED_UI_EXCEPTIONS.md)). Read-only audit of `origin/stable/0.9` @ `0eb9c43` established the Current Behavior table. Documentation only; no application code.
- **2026-10-28 — Design decisions approved ([DEC-029](../decisions/DEC-029_PHOTOGRAPHER_REGISTRY_AND_QUICK_INGEST_DESIGN_DECISIONS.md)).** Owner approved option (b) (the existing photographer list stays the single source of names; the registry links by stable ID and creates names through `lists:add`), rename-keeps-alias with a pre-save collision check, and workspace handoff for multi-photographer cards. Open design questions 1–3 marked resolved (original text kept). Test rows 13–15 added. Documentation only; no application code.

## Engineering Evolution

**Initial implementation**: Not applicable — feature not yet implemented.

**Architectural / workflow decisions**: [DEC-028](../decisions/DEC-028_SHARED_PHOTOGRAPHER_CAMERA_LEARNING_AND_APPROVED_UI_EXCEPTIONS.md), [DEC-029](../decisions/DEC-029_PHOTOGRAPHER_REGISTRY_AND_QUICK_INGEST_DESIGN_DECISIONS.md).

**Reliability / correctness fixes**: None recorded.

**Other dated milestones**: 2026-10-28 — requirements registered.

## Known Bugs / Troubleshooting

Not applicable.

## Decisions

- [DEC-028](../decisions/DEC-028_SHARED_PHOTOGRAPHER_CAMERA_LEARNING_AND_APPROVED_UI_EXCEPTIONS.md) — shared learning service; merge-not-replace exchange; two approved main-window exceptions.
- [DEC-029](../decisions/DEC-029_PHOTOGRAPHER_REGISTRY_AND_QUICK_INGEST_DESIGN_DECISIONS.md) — single photographer list (option b); rename keeps alias; multi-photographer handoff; evidence-based camera identification.

## Future Enhancements

- Incremental (delta) registry exports.
- Further consumers: Archive Browser (AI-RM-004), Event Maintenance (AI-RM-003), AutoIngest Archive Node (AI-RM-002).
- Linking devices to source sessions and verification receipts once AI-FEAT-062 provides them.

## Related Files

None — no implementation exists. Existing files the design builds on: `data/photographers.json`, `main/listManager.js`, `main/aliasEngine.js`, `renderer/treeAutocomplete.js`, `renderer/renderer.js` (Confirm Event Import photographer field), `renderer/index.html` (Metadata Management tabs), `main/exifService.js`, `main/qmzService.js`.
