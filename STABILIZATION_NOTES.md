# AutoIngest Stabilization — Notes & Observations

Issues found during the stabilization pass that are NOT in the patch list.
Log here; do not fix unless a patch is added.

---

## Remaining sync fs usage (not patched — intentional or out-of-scope)

| File | Line | Usage | Assessment |
|------|------|-------|------------|
| `main/fileBrowser.js` | 141 | `fs.statSync(dcim)` in `getDCIMPath()` | Called once per browse, low risk. Should be async in a future pass. |
| `main/main.js` | 494 | `fs.existsSync` in `debug:telemetry` handler | Temporary debug handler — intentional. Remove when debug handlers are removed. |
| `services/telemetry.js` | 60 | `fs.existsSync(queuePath)` in `init()` | Runs at startup before event loop is busy — intentional. |
| `services/telemetry.js` | 158 | `fs.existsSync(KEY_PATH)` in `flush()` | Credentials guard before network call — acceptable sync. |
| `services/telemetry.js` | 214 | `fs.writeFileSync` in `persistQueue()` | Must stay sync (before-quit handler) — intentional per spec. |

## Debug IPC handlers still present

`debug:telemetry` and `debug:flush` in `main/main.js` are marked `// TEMPORARY DEBUG`. They were not touched in this stabilization pass (out of scope). Remove them in a future cleanup.

## `getDCIMPath` still sync

`main/fileBrowser.js:getDCIMPath` uses `fs.statSync`. This is called from the `files:get` IPC handler. Low priority but could be async. Not in patch list.

---

*Last updated: 2026-04-18*

---

## Additional Observations (Post v0.7.4-dev)

### event.json write model is now single-writer (implicit contract)

All writes to event.json are now funneled through `import:commitTransaction` using a single atomic write.

- No other code path should perform partial updates (e.g. only `lastImport`, only `status`, etc.)
- Any future feature modifying event.json must:
  - read full document
  - merge all required changes
  - write once via tmp→rename

This is now an implicit system contract.

---

### Double-read pattern preserved for NAS safety

The event.json write still uses a double-read before merge to handle concurrent writers on network storage.

- This behavior must be preserved for any future write paths
- Removing it may introduce stale-write overwrites on NAS

---

### Cache invalidation strategy is explicit (no partial cache updates)

`_scannedEvents` is now treated as:

- disposable cache
- invalidated on mutation
- never partially patched

Future rules:
- NEVER mutate `_scannedEvents` in-place after disk changes
- ALWAYS invalidate and rehydrate from disk

---

### Transaction boundary exists only at event.json layer

The system now has a safe transaction boundary for metadata (event.json), but:

- File copy (importFileJobs) is still independent
- There is no full cross-layer transaction (files + metadata)

Implication:
- Files may exist on disk even if metadata write fails
- Current design accepts this as recoverable state

---

### Import index remains non-transactional

`importIndex.json` is updated independently from event.json.

- No atomic coupling between:
  - copied files
  - event.json audit
  - importIndex

This is consistent with current design, but means:
- index may lag or diverge after crash
- system relies on duplicate detection at import time

---

### Renderer state still multi-source (intentional)

State exists across:
- `selectedFiles`
- `currentFiles`
- `GroupManager`
- `EventCreator`
- `destFileCache`

No central state orchestrator exists (by design).

Implication:
- Resets must remain explicit and coordinated
- Future changes must be careful about partial state resets

---

### Synchronous writes allowed only in shutdown-safe paths

Sync fs usage remains acceptable ONLY in:
- app shutdown (window bounds)
- pre-event-loop init
- before-quit handlers

Future rule:
- No sync fs in hot paths (scanner, import, IPC handlers)

---

### Debug IPC handlers still present (intentional)

`debug:telemetry` and `debug:flush` remain in codebase.

- Must be removed in cleanup phase before production release
- Should not be extended or reused

---

### Sequence normalization contract clarified

- event.json stores `sequence` as string (zero-padded)
- validation does NOT coerce
- normalization layer is responsible for format consistency

Future rule:
- All sequence formatting must pass through normalization layer only

---

### Import log integrity depends on ID uniqueness

Audit merge relies on:

```js
Map.set(entry.id, entry)
```

Entries with duplicate IDs are silently de-duplicated (last writer wins). ID generation must remain collision-resistant.

---

## Post-Cleanup Notes (2026-05-01)

### Activity Log is read-only by design

The Activity Log modal reads `event.json` lazily and renders it — it never writes to it. The active event selection in the dashboard is never changed by picker navigation inside the modal. Closing the modal clears `_alCurrentEventPath` and `_alEventList` is kept (lightweight; safe to retain).

### `source` field is backward-compatible and non-validating

- `isValidImportEntry` does not check `source`
- `_hasEntryIssue` does not check `source`
- Old entries without `source` are valid and display "Source: Not recorded"
- A missing or malformed `source` never triggers a Check badge
- This contract must be preserved in any future audit schema changes

### D-class exports deferred (not removed)

Some symbols in `fileBrowser.js` and `fileManager.js` are exported but not called by `main.js`. These are D-class (exported but uncalled). Removal was deferred — exports are not harmful and the fix-only pass scope was limited to A-class (completely uncalled code paths). Track for a future cleanup pass.

### `debug:telemetry` and `debug:flush` still present

`ping` was removed in the 2026-05-01 cleanup pass. `debug:telemetry` and `debug:flush` remain — marked `// TEMPORARY DEBUG` in `main/main.js`. Remove before production release. Do not extend or reuse them.

### `audit:verifyEvent` uses no minimum file size filter

`scanMediaRecursive` in `fileBrowser.js` has a 50 KB minimum size guard (`MIN_FILE_BYTES`). The `audit:verifyEvent` handler intentionally does not apply this filter — all media files of any size are counted. This ensures small test files and zero-byte edge cases are included in the verification count. If the minimum size guard is ever added to `audit:verifyEvent`, it must be documented here and the expected/actual counts must use the same filter.

---

*Last updated: 2026-05-01*