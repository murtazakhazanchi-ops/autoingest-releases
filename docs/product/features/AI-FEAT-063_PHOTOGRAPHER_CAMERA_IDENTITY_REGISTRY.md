# AI-FEAT-063 — Photographer & Camera Identity Registry (Learning, Registry, Exchange)

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-063 |
| Category | Metadata |
| Status | In active development |
| Maturity | Experimental |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-036 (Keyword Registry — precedent for a controlled vocabulary with additive, never-delete import), AI-FEAT-034 (Metadata Management Modal — hosts the new Photographer Registry tab), AI-FEAT-022 (Photographer Folder Resolution — photographer names drive archive folder naming; this feature must not change that), AI-FEAT-029 (Metadata Writing Engine — Creator fields are written from the selected photographer; unchanged), AI-FEAT-061 (Quick Ingest & Desktop Companion — first consumer, and owner of the source-metadata reader that supplies camera evidence) |
| Related roadmap milestone | AI-RM-014 |
| Related technical docs | `docs/metadata-system.md`, `docs/ingestion-flow.md`, `docs/data-model.md` — none yet describe this feature, because nothing is implemented |
| Evidence status | Q4a–Q4d implemented on `feature/photographer-camera-learning-q4` (Q4a `ccd97e7`, Q4b `200c814`, Q4c `4cfafba`, fix `2a7a593`, Q4d `6d3cc45`) — local, unmerged, unreleased. Learning records OBSERVATIONS from committed event imports, with bounded recovery of interrupted learning. No UI shows them (Q5/Q6). macOS verified (dev + isolated packaged arm64); Windows DPAPI NOT verified. Stable is unchanged. *(Prior value, superseded 2026-11-05: Confirmed zero implementation (2026-10-28 read-only audit of `origin/stable/0.9` @ `0eb9c43`): no camera make/model/serial extraction and no photographer↔device association anywhere under `main/`, `services/`, `renderer/`. Requirements below are owner direction recorded 2026-10-28; the data model is a **proposal for review**, not shipped behaviour.)* |
| First-known implementation | Q4a `ccd97e7` (2026-11-03), feature branch only *(Prior value, superseded 2026-11-05: Not started)* |
| Latest major update | 2026-11-04 — Q4d `6d3cc45`: bounded interrupted-learning recovery, verified archive evidence, newly-copied-only evidence, cross-process learning state (feature branch only) *(Prior value, superseded 2026-11-05: 2026-10-28 — six owner design decisions approved ([DEC-029](../decisions/DEC-029_PHOTOGRAPHER_REGISTRY_AND_QUICK_INGEST_DESIGN_DECISIONS.md)): option (b) single photographer list, rename keeps alias, multi-photographer handoff)* |

## Lifecycle Metadata

| Field | Value |
|---|---|
| Related features | AI-FEAT-061 (phases Q3–Q8 consume this feature); AI-FEAT-062 (Backup Intelligence — later archive-wide identity; this feature must not depend on it, see Dependency on AI-RM-015) |
| Related decisions | [DEC-029](../decisions/DEC-029_PHOTOGRAPHER_REGISTRY_AND_QUICK_INGEST_DESIGN_DECISIONS.md) (approved design decisions), [DEC-028](../decisions/DEC-028_SHARED_PHOTOGRAPHER_CAMERA_LEARNING_AND_APPROVED_UI_EXCEPTIONS.md), [DEC-027](../decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md) (main-window UI freeze; DEC-028 records the two approved exceptions) |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | None yet — will qualify when a persistent, app-wide identity store exists |
| Related release notes | Not applicable — not released |
| Testing coverage | Feature branch: unit tests `test/photographerCameraLearningQ4a.test.js` (29), `test/identityRegistryStoreQ4b.test.js` (21), `test/photographerLearningQ4c.test.js` (17), `test/photographerLearningQ4d.test.js` (25); live `test/photographerLearningQ4cLive.test.js`, `test/photographerLearningQ4dLive.test.js` (34 checks); isolated packaged macOS run 75/75. Windows not tested. *(Prior value, superseded 2026-11-05: Not applicable — feature not yet implemented (planned matrix below))* |
| Documentation completeness | Requirements, approved decisions (DEC-029), Q3 multi-identifier amendment and implemented Q4a–Q4d behaviour recorded; Q5–Q7 not started; technical docs under `docs/` not yet updated (feature unmerged) *(Prior value, superseded 2026-11-05: Requirements, proposed model and the approved design decisions (DEC-029) recorded; technical investigations (per-manufacturer tags) still pending)* |

## Summary

One shared backend capability that remembers which photographers use which cameras, so AutoIngest can **suggest** (never decide) the photographer for an import. Camera details are captured automatically from the media, confirmed once by the operator, and reused everywhere photographer identification is needed: the menu-bar Quick Ingest companion, the existing Confirm Event Import modal, and a new Photographer Registry tab in Metadata Management. Registries are portable between AutoIngest computers through a versioned export file whose import **merges, never replaces**.

## Current Behavior

**On Stable: not implemented.** Q4a–Q4d exist only on `feature/photographer-camera-learning-q4` — see [§ Implemented behaviour](#implemented-behaviour-ai-rm-014-q4aq4d-feature-branch-only). Facts about the existing code this builds on (audit of `origin/stable/0.9` @ `0eb9c43`):

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

## Implemented behaviour — AI-RM-014 Q4a–Q4d (feature branch only)

Evidence: `feature/photographer-camera-learning-q4` — Q4a `ccd97e7`, Q4b `200c814`, Q4c `4cfafba`, Q4c fix `2a7a593`, Q4d `6d3cc45` (2026-11-03/04). Local, unmerged, unreleased. macOS verified; Windows NOT verified. This section is the authority for implemented behaviour; § Proposed data model below is kept for history.

### Persistent identities

- **Registry.** `<userData>/identity-registry/registry.json` — append-only, event-sourced (schema 1). Photographers, camera devices, associations and conflicts are derived. Merge = union by eventId (additive, order-independent, idempotent); same eventId with different content is an integrity conflict (local kept, other held, neither used).
- **Photographers.** Shipped names: UUIDv5(fixed namespace, normalised name). Local additions: random UUIDv4, persisted once. Same name from two computers = two IDs, flagged `same-name-different-ids`; only an explicit `photographer-linked` decision joins them.
- **Camera devices.** Several namespaced identifiers per body (the Q3 namespaces in the 2026-11 amendment under § Proposed data model below), stored only as HMAC-SHA256(key, namespace|make|value). Matching only within a namespace; model mismatch or an identifier spanning two devices is a conflict; explicit `device-linked` decisions only. Raw serials are never stored.
- **Identifier privacy (resolves the open choice in that amendment):** option 2, keyed digests, implemented with a per-registry key (§ Secure storage). A shared organisation key for cross-computer matching is Q7.

### Learning eligibility

- Hook: end of a successful `import:commitTransaction` (`main/main.js`), after event.json `imports[]` is written and every rollback path has passed. It only queues work; it never throws, never changes or delays the import result.
- Eligible: normal event imports and each committed event of a multi-event import. Not eligible: staging / Quick Import, Transfer, QMZ moves, metadata audit/repair, failed / cancelled / rolled-back imports, imports that copied nothing new. Opt-out: `"photographerLearningEnabled": false` in settings.json (no UI).
- Laziness: nothing (registry, key, Keychain item, journal, pending list) is created at launch or card insert — only at the first eligible committed import. At launch, recovery is scheduled only if a pending list exists.

### Evidence and duplicate handling

- **Evidence = the files this import newly copied.** Same-size duplicates the engine skipped were counted by the import that copied them (and may come from another source with the same name and size) — they are not evidence. Copy/skip/rename/routing semantics of the import engine are unchanged.
- **Renamed re-copies.** After AutoIngest writes metadata into an archive JPEG/HEIC/TIFF, its size no longer equals the card file, so re-importing the same card copies the same picture again as `NAME_1.JPG` (existing engine behaviour, unchanged). Learning compares the image-data hash (ExifTool `ImageDataHash`, metadata excluded) of such a copy with the file it was renamed away from; a repeat is not counted (`duplicateCaptures`). Cost: one stat per `_N`-named file; a hash only when the un-suffixed original exists.
- **Live evidence:** the companion's Q2/Q3 assessment when every file matches by volume identity + path + size; otherwise one bounded re-read of the copied source files (concurrency 2, paused during imports / sync / transfer / checksum, ≤ 5,000 files). A source that cannot be read leaves the import pending for recovery.
- **Rules:** one identified body → `import-observed`; several cameras → `import-cooccurred` only; model-only → `model-observed`; any unknown-camera or unread file → no association (identified bodies are still registered as equipment); a RAW/JPEG pair counts once; no import ever writes `association-confirmed`.
- Retrying the same import entries is idempotent: importId = `imp-` + sha256(deviceId | sorted entry IDs)[0..32]; event and device IDs are UUIDv5 of it; an importId already in the registry is never processed again.

### Association confidence

confirmed / observed / disputed / rejected / retired, derived. Explicit decisions carry `resolves` (the decisions they were made with knowledge of); unsettled opposite decisions are disputed. Suggestion levels: strong (one explicit confirmation, the only preselectable level) · likely (≥ 3 observed import days; evidence stays "observed") · possible · alternatives (shared camera) · weak (model only) · none. Recovered observations keep the ORIGINAL import day, so recovery never manufactures an extra observation day.

### Interrupted-learning recovery (Q4d)

- **Durable pending record.** Accepted imports are written to `identity-registry/learning/learning-pending.json` (mode 600) before any work starts: importId, entry IDs, event folder, photographer, workflow, operator, import day, and the newly copied files (source path, archive path, committed size). Internal state — it holds names and paths, so it is never logged, exported or sent to a renderer. Removed on any final outcome.
- **What stays pending:** quit before the job started or during evidence reading; registry locked / corrupt / unavailable; archive unreachable; registry write failure; a live source that could not be read; the queue full.
- **When it runs:** never at launch itself — a delayed pass (90 s) only if a pending list exists, again after learning jobs drain, never while an import / sync / transfer / checksum runs. Retry spacing 5 minutes.
- **Bounds:** 3 attempts per import (counted when an attempt starts, so a crash loop is bounded), 7 days from the commit, 20 pending imports, 5 per pass. Exhausted → `abandoned`; too old → `expired`. Registry unavailable does not consume an attempt (nothing can be recorded); the 7-day limit still applies.
- **Verification before anything is recorded:**
  1. the pending record belongs to THIS computer (deviceId equal, importId recomputes from the entry IDs);
  2. event.json still lists every entry ID with the same photographer (and operator, when recorded) — entries exist only after a successful commit; a rollback restores the pre-import snapshot;
  3. every committed file lies inside that event folder;
  4. per file: archive copy present with exactly the committed size → read the archive copy (RAW files only get .xmp sidecars; videos are never written); archive copy rewritten (different size) → read the card original only if it is still at its committed path with the committed size AND its image-data hash equals the archive copy's; otherwise the file is uncertain and unread. Missing copy → unread. A rewritten JPEG whose RAW partner verified is covered by that partner (one capture).
  5. Unread files keep attribution incomplete — no association is inferred from the files that could be read. Equal file size is the import engine's own duplicate rule, not a byte hash; final archive bytes are never compared with source bytes.
- **Outcomes:** `recorded` / `nothing-to-record` (normal rules), `evidence-unavailable` (nothing trustworthy; after waiting up to 3 attempts for a removed card), `abandoned` (`commit-not-verified:*`, attempts exhausted), `expired`, `duplicate` (already in the registry — e.g. quit after the append, before the pending record was cleared). Recovered events are identical to what the live run would have written.

### Diagnostic and registry persistence

- `identity-registry/` — `registry.json`, `keys.json`, `registry.lock` (held for the process lifetime), `backups/`, `quarantine/`.
- `identity-registry/learning/` — `learning-journal.json` (last 200 imports, one entry per import: status, reason, counts, attempt; never names, paths, serials, digests or keys; entries of still-pending imports are never trimmed), `learning-pending.json`, `state.lock`.
- **Concurrency.** Journal and pending updates are serialised in-process and across processes by `state.lock` (pid + token + time), held only for one read-modify-write and never while waiting for the registry, so the two locks cannot deadlock. Writes are temp + fsync + rename; a crashed writer leaves the previous document, and its temp file is removed by the next writer. A lock whose owner is gone, or older than 30 s, is taken over by an atomic rename (one winner); a writer waits up to 35 s, longer than the stale age, so an update is never silently lost. A damaged document is copied to `quarantine/` and restarted. In-flight entries of a process that is gone are reported as `interrupted`. In practice Electron's single-instance lock already keeps a second AutoIngest off the same profile; the state lock is defence in depth.

### Secure storage

- One 32-byte HMAC key per registry, generated only when a brand-new registry is initialised, stored only as OS secure-storage ciphertext in `keys.json` (mode 600, SHA-256 checksum).
- macOS: Electron safeStorage → login Keychain item "<app name> Safe Storage". Development runs and packaged builds both report app name "auto-ingest" (productName lives only in the electron-builder config) and share userData `~/Library/Application Support/auto-ingest` and the item "auto-ingest Safe Storage". Each key records its protecting identity and is decrypted only under it (`key-protection-identity-mismatch` otherwise).
- Missing / damaged / undecryptable / foreign key → body matching off, learning continues at model level, key never regenerated. Applies to recovery as well.
- Windows: DPAPI (per Windows user) — documented, NOT verified on Windows hardware.

### Multi-computer reconciliation — limitations

- Each computer has its own key: digests from two computers do not match until Q7 (organisation keys) provides a shared key. Same photographer name on two computers → two IDs until explicitly linked.
- Pending learning is per computer: another computer never recovers it (deviceId check), even with a shared archive. Moving a profile to another computer makes its pending records unrecoverable (abandoned).
- Registry exchange / merge is designed (Q4a merge planning) but not wired (Q7).

### Test isolation (production safety)

- `--user-data-dir` alone does NOT isolate: the Keychain item, `~/Library/Logs/<name>` and `~/Library/Preferences/<bundleId>.plist` follow the app name / bundle id.
- Dev live tests: a wrapper app with its own package.json name (`autoingest-q4c-livetest`, `autoingest-q4d-livetest`). Packaged tests: a throwaway build with CLI-only overrides `-c.extraMetadata.name/productName -c.productName -c.appId -c.directories.output` (package.json untouched), `--user-data-dir` to a temp profile, and a pre-run proof (Keychain service list, production profile/prefs/caches/logs fingerprint) that aborts before any learning step. `AUTOINGEST_LEARNING_RECOVERY_DELAY_MS` (1 s – 1 h) shortens the launch delay for such tests.

## Proposed data model (for review — not implemented)

*Superseded 2026-11-05 as the authority by § Implemented behaviour above (event-sourced registry, HMAC identifier digests). Kept per Append, Never Erase.*

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
  modelDisplay,                    // e.g. Canon maker model id "EOS R6 Mark II" for EXIF "Canon EOS R6m2"
  identifiers: [DeviceIdentifier], // [] = no body identifier in the media — never guessed
  identityStrength: 'serial' | 'model-only',   // 'serial' = at least one trusted identifier
  firstSeenAt, lastSeenAt,
}

DeviceIdentifier = {               // amended 2026-11 (AI-FEAT-061 Q3 measurements) — replaces serial/serialSourceTag
  namespace,                       // metadata origin: 'exif.bodySerial', 'canon.internal', 'sony.internal', 'nikon.serial', 'dng.cameraSerial', …
  value,                           // as written by the camera (sensitive equipment data — see "Identifier privacy")
  sourceTags: [string],            // e.g. ['ExifIFD:SerialNumber'] or ['Nikon:SerialNumber', 'XMP-aux:SerialNumber']
  trusted: boolean,                // false for namespaces not yet verified on real files (Fujifilm, Olympus, Panasonic, Pentax …)
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

**Amendment (2026-11, proposed with AI-FEAT-061 Q3 — awaiting approval): several identifiers per device.** Real camera files carry more than one body identifier, and different files of one body carry different subsets (measured on real Canon, Sony and Nikon media):
- Canon originals carry the EXIF body serial (`ExifIFD:SerialNumber`) **and** a different maker-note value (`Canon:InternalSerialNumber` / `InternalSerialNumber2`); exported JPEGs usually keep only the EXIF one. Sony carries only `Sony:InternalSerialNumber` (no EXIF body serial). Nikon originals carry `Nikon:SerialNumber`; Adobe exports copy the same value into `ExifIFD:SerialNumber` and `XMP-aux:SerialNumber`. Some Canon videos write an all-zero EXIF serial placeholder.
- A device therefore holds a set of `DeviceIdentifier`s. A file matches a device when normalized make + model match **and** at least one trusted identifier matches **in the same namespace**. Values are never compared across namespaces (Canon's two identifiers are different numbers); the measured Nikon equivalence is modelled as one namespace.
- Identifiers seen together on one camera-original (not editor-rewritten) file may be added to the same device. If that would join two existing devices, it is a conflict for the operator — never an automatic merge.
- Two devices never share a (namespace, value). An identifier observed with two different models is a conflict.
- `identityStrength: 'serial'` requires at least one `trusted` identifier; untrusted namespaces are kept as evidence only until real files verify them.

**Identifier privacy and cross-computer recognition (proposed; decision required before Q4).** Q3 shows cameras with per-process opaque keys (an HMAC under a random secret that lives only as long as the process). Those keys are display-only: never persisted, never exported, never used to recognise a camera later. The registry (Q4–Q7) needs an identity that survives restarts and works on another AutoIngest computer after an explicit, operator-confirmed registry exchange. Options:
1. Store `value` as written, inside the per-installation registry file and its versioned export — exact matching on every computer; the registry and its exports become sensitive files.
2. Store a keyed digest per identifier (`HMAC(organizationKey, namespace|make|model|value)`) with the organization key distributed alongside registry exchange — raw serials never leave the media; matching works across computers that share the key; short identifiers (Nikon: 7 digits) are protected only while the key stays secret.
3. An unkeyed hash — **not recommended**: short serials are trivially recoverable by brute force.
Whichever is chosen: raw identifiers never appear in UI, ordinary logs or committed fixtures, and every recognition remains a suggestion the operator confirms (association rules above).

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
| 16 | Keys at rest (Q4b) | ciphertext only; restart continuity; missing/undecryptable/foreign/renamed identity → body matching off, never replaced (real Keychain) |
| 17 | Store safety (Q4b) | atomic write + backup; corrupt → quarantine + disabled; explicit recovery; lock; ENOSPC/EACCES/EPERM |
| 18 | Import hook (Q4c) | committed only; rollback/fail/copied-0 → nothing; result unchanged; returns < 20 ms |
| 19 | Exactly-once (Q4c) | duplicate callbacks, reversed entry order, restart → no duplicates |
| 20 | Attribution (Q4c) | single body / mixed / multi-event / model-only / unknown minority / source removed / pairs once |
| 21 | Laziness & opt-out (Q4c) | nothing created at launch or card insert; opt-out creates nothing |
| 22 | Pending durability (Q4d) | quit before start / mid-read → pending kept; next run recovers exactly once |
| 23 | Commit verification (Q4d) | other computer, forged entry IDs, rolled-back / corrupt / missing event.json, file outside event → abandoned |
| 24 | Archive evidence (Q4d) | unmodified copy → archive; rewritten copy → card original only with equal image-data hash; replaced / missing / card gone → unread |
| 25 | Bounds (Q4d) | 3 attempts, 7 days, 20 pending, busy operator, scheduler never loops |
| 26 | Duplicates (Q4d) | skipped files excluded; renamed re-copies of archived pictures excluded; partial resume counts new files only |
| 27 | State concurrency (Q4d) | 3 writers × 60 updates lose nothing; writer killed mid-write; stale/live locks; damaged journal |

## Evolution / Implementation Journal

- **2026-10-28 — Requirements recorded.** Owner approved the Photographer & Camera Learning System, centralized Photographer Registry, safe registry import/export with conflict resolution, and photographer suggestions in the existing Confirm Event Import modal, as part of AI-RM-014 ([DEC-028](../decisions/DEC-028_SHARED_PHOTOGRAPHER_CAMERA_LEARNING_AND_APPROVED_UI_EXCEPTIONS.md)). Read-only audit of `origin/stable/0.9` @ `0eb9c43` established the Current Behavior table. Documentation only; no application code.
- **2026-10-28 — Design decisions approved ([DEC-029](../decisions/DEC-029_PHOTOGRAPHER_REGISTRY_AND_QUICK_INGEST_DESIGN_DECISIONS.md)).** Owner approved option (b) (the existing photographer list stays the single source of names; the registry links by stable ID and creates names through `lists:add`), rename-keeps-alias with a pre-save collision check, and workspace handoff for multi-photographer cards. Open design questions 1–3 marked resolved (original text kept). Test rows 13–15 added. Documentation only; no application code.
- **2026-11-02 — Multi-identifier amendment proposed (AI-FEAT-061 Q3, `b2da537`).** Real Canon, Sony and Nikon files carry several body identifiers in different namespaces; `CameraDevice.serial` replaced by a set of `DeviceIdentifier`s, matched only within a namespace. Applied to this record 2026-11-05.
- **2026-11-03 — Q4a** pure identity, association, suggestion and merge-planning foundation (`ccd97e7`). **Q4b** persistent registry + OS-protected key store (`200c814`), not wired. **Q4c** learning connected to committed event imports — observations only, no UI (`4cfafba`); queued/dropped jobs journaled (`2a7a593`).
- **2026-11-04 — Q4d** bounded interrupted-learning recovery, verified archive evidence, newly-copied-only evidence and renamed-duplicate exclusion, cross-process learning state (`6d3cc45`). All on `feature/photographer-camera-learning-q4`, local and unmerged; Q5 not authorized.
- **2026-11-05 — Record updated for Q4a–Q4d.** Status Planned → In active development; Maturity Planned → Experimental (feature branch only — Stable unchanged). Added § Implemented behaviour, test rows 16–27, and applied the 2026-11-02 multi-identifier amendment. Documentation only.

## Engineering Evolution

**Initial implementation**: Q4a `ccd97e7` (2026-11-03) on `feature/photographer-camera-learning-q4` — not merged. *(Prior value, superseded 2026-11-05: Not applicable — feature not yet implemented.)*

**Architectural / workflow decisions**: [DEC-028](../decisions/DEC-028_SHARED_PHOTOGRAPHER_CAMERA_LEARNING_AND_APPROVED_UI_EXCEPTIONS.md), [DEC-029](../decisions/DEC-029_PHOTOGRAPHER_REGISTRY_AND_QUICK_INGEST_DESIGN_DECISIONS.md).

**Reliability / correctness fixes**: `2a7a593` (2026-11-03) — queued and dropped learning jobs journaled durably. `6d3cc45` (2026-11-04, Q4d) — skipped duplicates no longer counted as evidence; interrupted learning recovered instead of lost; last-writer-wins journal updates replaced by a cross-process lock. *(Prior value, superseded 2026-11-05: None recorded.)*

**Other dated milestones**: 2026-10-28 — requirements registered. 2026-11-03 — Q4a/Q4b/Q4c. 2026-11-04 — Q4d.

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

Feature branch `feature/photographer-camera-learning-q4` only: `services/photographerIdentity.js`, `services/identityEvents.js`, `services/cameraDeviceIdentity.js`, `services/associationModel.js`, `services/identityLearningPlan.js`, `services/photographerSuggestion.js`, `services/identityMergePlan.js` (Q4a); `services/identityFileOps.js`, `services/identityKeyStore.js`, `services/identityKeyring.js`, `services/identityRegistryStore.js`, `services/electronSecureStorage.js` (Q4b); `services/photographerLearningService.js`, `services/photographerLearningRuntime.js` (Q4c); `services/learningStateStore.js`, `services/learningRecoveryEvidence.js` (Q4d). Touched: `main/main.js` (import hook passes copied files + event folder; will-quit; launch recovery scheduling), `services/companionService.js` (`findAssessedRecords`), `services/settings.js` (opt-out getter), `services/captureDateReader.js` (`readImageDataHash`).

*(Prior value, superseded 2026-11-05: None — no implementation exists.)* Existing files the design builds on: `data/photographers.json`, `main/listManager.js`, `main/aliasEngine.js`, `renderer/treeAutocomplete.js`, `renderer/renderer.js` (Confirm Event Import photographer field), `renderer/index.html` (Metadata Management tabs), `main/exifService.js`, `main/qmzService.js`.
