# Archive Adoption Write Contract

**Phase 13C-7 — Implemented. Adoption write contract is complete.**

This document defines the exact contract that a future adoption write must satisfy before any event.json is created. It is the authoritative reference for all adoption implementation work.

---

## 1. Purpose and Scope

Adoption converts a manually-created folder (no event.json) into an AutoIngest-managed event by writing a minimal event.json into the existing folder. The folder structure is preserved unchanged.

This document covers:

- A. Future adoption IPC input shape
- B. Main-process pre-write validation sequence
- C. Proposed event.json shape
- D. Component strategy for adopted events
- E. Rollback/failure model
- F. Audit and logging
- G. Post-write actions
- H. UI readiness gates for a future Adopt button
- I. Locked rules

---

## 2. Core Invariants (Never Violate)

- event.json is the single source of truth. Adoption creates it — it does not modify anything else.
- A folder without event.json is not an AutoIngest-managed event. Adoption changes exactly this.
- The renderer-generated plan (Phase 13C-3) and the dry-run report (Phase 13C-5) are advisory only. They are never trusted as write-ready data.
- The future adoption write IPC MUST re-read and re-validate from disk. It does not reuse cached renderer data.
- No folder rename. No media move. No metadata write during adoption.
- Renderer must not access Node/Electron directly. All FS operations in main process via IPC.

---

## A. Future Adoption IPC Input Shape

```
IPC channel: archive:adoptManualFolder        (Phase 13C-7, adoptionWriteService.js)
Dry-run IPC: archive:dryRunAdoptionCandidate  (Phase 13C-5, adoptionDryRunService.js)
```

```javascript
{
  folderPath:     string,   // absolute path to the candidate folder
  collectionPath: string,   // absolute path to the parent collection folder
  rootType:       string,   // 'activeArchiveRoot' | 'mainArchiveRoot' | 'transferRoot'
  candidateId:    string,   // adoption preview item ID (e.g. 'adopt-0001') — audit only
  operatorConfirmation: {
    hijriDate:                    string,   // confirmed YYYY-MM-DD
    sequence:                     number,   // confirmed integer >= 1 (NOT 0)
    photographerFoldersConfirmed: boolean,  // true = operator has reviewed list
    selectedFolderConfirmed:      boolean,  // true = _Selected confirmed as external output
    externalFoldersConfirmed:     boolean,  // optional acknowledgement — not enforced by validateAdoptionInput();
                                            // external folders are preserved unconditionally by components:[]
    noMediaChangeConfirmed:       boolean,  // true = operator accepts no media moves
    manualReviewNotes:            string[], // optional operator notes
  }
}
```

**Security:** folderPath and collectionPath are validated by the main process. The renderer-supplied values are only used as references to locate the candidate — the main process independently resolves and validates the canonical paths.

**Helper:** `validateAdoptionInput(input)` in `services/adoptionWriteContract.js` validates this shape and returns `{ ok: true }` or `{ ok: false, reason }`.

---

## B. Main-Process Pre-Write Validation Sequence

The future write IPC handler MUST run these steps in order. Any failure → return `{ ok: false, reason }` without touching disk.

```
1.  Validate params
    └─ folderPath, collectionPath: present, typeof string
    └─ rootType: in { 'activeArchiveRoot', 'mainArchiveRoot', 'transferRoot' }

2.  Run validateAdoptionInput(input) from adoptionWriteContract.js
    └─ Returns { ok: false } → block immediately

3.  Path containment check (main process, not renderer)
    └─ path.normalize(folderPath) starts with path.normalize(root) + path.sep
    └─ Check against all configured roots (nas, main, tx)
    └─ Block if outside all roots or no roots configured

4.  Folder still exists
    └─ fsp.stat(folderPath).isDirectory()
    └─ Block on ENOENT or isFile()

5.  event.json still absent   ← CRITICAL
    └─ fsp.access(path.join(folderPath, 'event.json'))
    └─ Block if present (return { ok: false, reason: 'event-json-appeared' })
    └─ ENOENT = pass; other errors = block

6.  Folder is not a protected internal name
    └─ Not '_Selected', not '.autoingest', not '.autoingest-transfer', not '__MACOSX'
    └─ Not in KNOWN_EXTERNAL_NAMES (same set as adoptionDryRunService.js)

7.  Folder is under a valid collection
    └─ collectionPath must be parent of folderPath
    └─ path.dirname(path.normalize(folderPath)) === path.normalize(collectionPath)

8.  Re-parse folder name
    └─ Must match FULL_RE: /^(\d{4}-\d{2}-\d{2})\s+(\d{1,3})\s+([\s\S]+)$/
    └─ Block if no match
    └─ parsedSequence must be integer >= 1 (sequence 00 → integer 0 → blocked)

9.  Validate operator-confirmed Hijri date matches parse
    └─ Warn (do not block) if operator hijriDate != parsed hijriDate
    └─ Use operator-confirmed value (operator may correct a mis-parsed date)

10. Validate operator-confirmed sequence
    └─ parseInt(operatorConfirmation.sequence, 10) >= 1
    └─ Block if < 1

11. Check for duplicate managed events at same date+sequence
    └─ Scan collectionPath for siblings with same date+sequence
    └─ A matching sibling that HAS event.json → block (conflict)
    └─ A matching sibling without event.json → warn (still allow — operator confirmed)

12. Build payload
    └─ buildAdoptionEventJson(params) from adoptionWriteContract.js

13. Validate payload with isValidEventJson(payload)   ← Must return true
    └─ Block if false (should not happen if steps 1-12 passed; fail-safe)
```

---

## C. Proposed event.json Shape

The adoption write creates a minimal, valid event.json. Components are intentionally empty — see Section D.

```javascript
{
  "version":      1,
  "hijriDate":    "1447-11-24",            // from operator confirmation
  "sequence":     2,                        // from operator confirmation (integer >= 1)
  "eventName":    "1447-11-24 02 Urs Majlis Maghrib Isha Namaz",  // exact folder name on disk
  "safeEventName": "1447-11-24 02 Urs Majlis Maghrib Isha Namaz", // sanitized (folder already safe)
  "status":       "created",
  "components":   [],                       // empty — see Section D
  "adoption": {
    "source":              "manual-folder-adoption",
    "adoptedAt":           "2026-05-13T14:30:00.000Z",
    "candidateId":         "adopt-0012",
    "operatorId":          "user-uuid",
    "operatorName":        "Operator Name",
    "photographerFolders": ["Photographer1", "Photographer2"],
    "hasSelectedFolder":   true,
    "externalFolders":     [],
    "warnings":            [],
    "manualReviewNotes":   []
  },
  "updatedAt":    1747145400000
}
```

**Schema compliance:** Passes `isValidEventJson()` (main.js) and `dataValidator.validateEventJson()`. The `adoption` block is an advisory provenance record not read by any ingestion, routing, or grouping path.

**Write path:** Identical to existing `event:write` IPC (line 1343, main.js):
```
write to event.json.tmp → fsp.rename(tmp, event.json)
```

---

## D. Component Strategy — Why components: []

Normal AutoIngest folder structure:
```
Collection / Event / SubEvent / Photographer / VIDEO
```

Manual folder structure targeted by adoption:
```
Collection / Event / Photographer   ← no SubEvent layer
```

**The problem:** event.json components map to sub-event sub-folders. Writing synthetic component `folderName` values for existing photographer folders would require renaming those folders to match — which is prohibited.

**The solution:** Write `components: []`. The event is registered as `status: 'created'` with known identity (hijriDate, sequence, eventName) but no routing structure. The operator then opens the event in EventCreator to define components and set up import routing before any import is run.

**What `adoption.photographerFolders` records:** The folders discovered at adoption time are stored in the advisory `adoption` block. This gives EventCreator (or a future migration tool) context about what already exists when the operator defines components.

**isValidEventJson compatibility:** The validator in main.js accepts `components: []`. `dataValidator.validateEventJson()` also accepts it. This is the only compliant path that does not rename existing folders.

---

## E. Rollback / Failure Model

| Stage | Failure | Action |
|---|---|---|
| Any pre-write validation | Any check fails | Return `{ ok: false, reason }` — disk untouched |
| `fsp.writeFile(tmp)` | I/O error | No tmp file or partial tmp — disk unchanged |
| `fsp.rename(tmp, jsonPath)` | Failure | `fsp.unlink(tmp)` — folder unchanged |
| `event.json` appears during write | Race condition | Return `{ ok: false, reason: 'event-json-appeared' }` — do not overwrite |

**Atomicity:** Only event.json is written. No other files are touched. Folder layout, media, photographer folders, and _Selected are untouched on any failure.

**Re-run safety:** Failed adoption is fully retriable. The folder is still a valid adoption candidate. The dry-run (Phase 13C-5) can be re-run to confirm nothing changed.

---

## F. Audit and Logging

The `adoption` block inside event.json IS the adoption audit record:

```javascript
adoption.adoptedAt        // ISO timestamp of write
adoption.candidateId      // which preview item triggered it
adoption.operatorId       // who performed it (from session user)
adoption.operatorName     // display name
adoption.photographerFolders  // what was found on disk at adoption time
adoption.warnings         // any dry-run warnings carried forward
adoption.manualReviewNotes    // operator-supplied notes
```

No separate audit file is required. The event.json itself is the record.

If `userManager` provides the current operator, the IPC handler should populate `operatorId` and `operatorName` at write time (not from renderer input).

---

## G. Post-Write Actions (Caller Responsibility)

The adoption write handler returns `{ ok: true, data: writtenPayload }` and nothing more.

The **caller** (the IPC handler's calling context or the UI flow) is responsible for:

1. **Triggering a `scanEvents` refresh** for the collection so the event appears in the event list.
2. **Returning the written payload** to the renderer for confirmation display.
3. **Renderer navigates** from adoption candidate view to the newly-managed event view.

The write handler must NOT bake a scan trigger internally — that would couple persistence to UI refresh timing, violating the state-flow contract (`event.json → logic → filesystem → UI`).

---

## H. UI Readiness Gates

Before a future Adopt button may be shown (or enabled) for a candidate:

```
1.  candidate.readiness === 'ready-to-adopt-later'
2.  dryRun was run (dryRunResult is not null)
3.  dryRun.okForFutureAdoption === true
4.  dryRun.blockers.length === 0
5.  dryRun.checks show no 'fail' status
6.  parsedSequence is an integer >= 1 (not 0)
7.  Operator has confirmed: photographerFoldersConfirmed
8.  Operator has confirmed: selectedFolderConfirmed
9.  Operator has confirmed: noMediaChangeConfirmed
```

A button that is rendered but disabled pending confirmation is acceptable. A button that is entirely absent until all gates pass is also acceptable. An enabled Adopt button must never appear without all 9 gates satisfied.

---

## I. Locked Rules

These rules apply to all phases from 13C-6 onwards and must never be relaxed:

| Rule | Rationale |
|---|---|
| Future write IPC runs only in main process | Electron security model: contextIsolation, sandbox |
| Renderer-supplied paths are references, not trust | Path traversal risk; main process must re-validate |
| Renderer plan / dry-run result is advisory only | Cached data may be stale; main process re-reads disk |
| Sequence 00 is blocked at write layer | isValidEventJson requires sequence >= 1 as integer |
| components: [] on adoption | No sub-event layer in manual folders; no rename permitted |
| Photographer folders never renamed | Folder rename is outside adoption scope |
| _Selected classified as output, not photographer | Invariant from Phase 13C-1 onwards |
| External/manual child folders preserved | Adoption does not restructure existing layout |
| Atomic write only (tmp → rename) | Matches existing event:write pattern in main.js |
| No overwrite if event.json exists at write time | isValidEventJson run at write time, not before |
| adoption block is advisory — never read by routing | import router and GroupManager must not key on adoption |

---

## J. Helper Module Reference

`services/adoptionWriteContract.js` exports:

| Export | Type | Purpose |
|---|---|---|
| `ADOPTION_BLOCKED_CONDITIONS` | string[] | Human-readable list of what blocks adoption |
| `ADOPTION_REQUIRED_OPERATOR_FIELDS` | object[] | Fields operator must confirm |
| `ADOPTION_MANUAL_REVIEW_FIELDS` | object[] | Optional fields for operator notes |
| `ADOPTION_NO_CHANGE_GUARANTEES` | string[] | What adoption never touches |
| `ADOPTION_POST_WRITE_ACTIONS` | string[] | What caller must do after write |
| `ADOPTION_ROLLBACK_MODEL` | object | Rollback behavior spec |
| `ADOPTION_UI_READINESS_GATES` | string[] | Conditions for Adopt button |
| `validateAdoptionInput(input)` | function | Validates operator confirmation shape |
| `buildAdoptionEventJson(params)` | function | Builds event.json payload (pure, no I/O) |

---

## K. Phase 13C-7 Implementation (Completed)

Phase 13C-7 implemented the adoption write as follows:

1. Registered `archive:adoptManualFolder` IPC handler in `main/main.js`.
2. Exposed `adoptManualFolder(input)` in `main/preload.js`.
3. New service `services/adoptionWriteService.js` — `adoptFolder(input, isValidEventJsonFn, activeUser)`:
   - 16-step validation sequence (Section B) — isValidEventJsonFn injected from main.js to avoid circular dep.
   - Steps: type checks → `validateAdoptionInput` → rootType → path containment → stat → event.json absence (CRITICAL) → protected names → collection parent → FULL_RE parse → sequence ≥ 1 → cross-checks (warn) → duplicate scan → child folder re-read → build payload → validate payload → atomic write (tmp + second access check + rename).
4. Payload built via `buildAdoptionEventJson()`.
5. Validated via injected `isValidEventJson()`.
6. Written atomically (tmp → second absence check → rename).
7. Returns `{ ok: true, data, warnings }` or `{ ok: false, reason }`.
8. Renderer shows Adopt button only after dry-run returns `okForFutureAdoption: true` and `item.readiness === 'ready-to-adopt-later'`.
9. In-app two-step confirmation UI (no OS `confirm()` dialog — unreliable under `sandbox:true`).
10. On success: refreshes adoption candidate list via `diagAdoptBtn.click()`.
11. On success (Phase 13C-7.1): calls `_refreshNasEventsCard(false)` to refresh the Active Archive overview tile. Refresh errors are swallowed — they do not affect adoption success.

**Note:** The Active Archive overview tile auto-refreshes after a successful adoption (Phase 13C-7.1). No manual refresh is required for that surface.

---

*This document is the design contract only. No event.json files are written by anything in this phase.*
