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
