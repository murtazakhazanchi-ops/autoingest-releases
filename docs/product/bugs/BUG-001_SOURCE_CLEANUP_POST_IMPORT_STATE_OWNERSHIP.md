# BUG-001 — Source Cleanup / Post-Import State Ownership Race

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-024, AI-FEAT-012, AI-FEAT-010 |
| Status | Fixed |
| Severity | Medium |
| Discovered | 2026-05-08 |
| Fixed | 2026-05-08 (v0.8.8) |
| Evidence status | Verified from Git history, code, and docs (`docs/failure-patterns.md` #16, `docs/system-contracts.md` §4, `.claude/learning-log.md` 2026-05-08 entries) |

## Symptom

Two related symptoms traced to the same underlying weakness, both surfacing around the Source Cleanup / post-import completion flow:

1. After importing from a dialog-chosen sub-folder of an external drive, the Source Cleanup button was visible but every file deletion failed with `"Path outside source root"` — even though the files had imported correctly. This did not occur when importing from a memory card or a local folder (`docs/failure-patterns.md` #16).
2. The dynamically-injected `#postImportActions` panel could reappear stale after an abnormal re-entry into the import flow (e.g. card disconnect or IPC abort mid-import), because it was only ever removed in the normal modal-close path, not the re-entry path (`.claude/learning-log.md`, 2026-05-08, "Post-Import Completion Flow: Source-Aware Action Chooser").

## Root Cause

Both symptoms trace to the same architectural mistake: state that should be owned by the **import session** (what to clean up, whether the import succeeded) was instead being read from sources that don't reliably persist across the session — a module-level renderer variable subject to background polling, or DOM state, or a UI-modal's own open/close lifecycle.

Specifically for (1): `activeSource` is a module-level renderer variable. `renderExtDrives()` polls on a fixed interval and sets `activeSource = null` whenever its `.path` (a sub-folder) is not found among currently-polled drive mountpoints — which can happen while `commitImportTransaction` is still `await`ing. If the post-import summary reads `activeSource?.path` *after* that await, `sourceRoot` resolves to `null`/`undefined`, and the `realpath` containment check in `files:deleteFromSource` then rejects every source file as outside the root.

For (2): import success was previously inferred from DOM state instead of an authoritative flag, and the injected action panel's cleanup lived only in the "normal" teardown path, not the session re-entry path — so anything that skipped the normal close (a disconnect, an abort) left stale UI state for the next import.

## Investigation Log

- **2026-05-08** — Root cause for symptom (1) identified: `activeSource` nulled by drive polling during the `commitImportTransaction` await; `_csqSourceRoot` resolves to `undefined`; containment check fails for entirely valid imported files (`.claude/learning-log.md`).
- **2026-05-08** — Same-day, adjacent investigation ("Post-Import Completion Flow: Source-Aware Action Chooser") found the broader pattern: import success being inferred from DOM state instead of a dedicated flag, and dynamically-injected panels needing cleanup in two places (normal teardown *and* re-entry), not one.

## Fix

- `sourceRoot` (renamed `_importCleanupRoot`) is now captured from `activeSource.path` **synchronously before the first `await`** in the import path (Event Import and Quick Import) — not read from `activeSource` at post-import summary time. The early-return guard changed from `!activeSource` to `!activeSource && !_importCleanupRoot`, so the post-import summary can still proceed correctly when polling has transiently cleared `activeSource`. Codified as a standing rule in `docs/system-contracts.md` §4 ("Cleanup Root Capture Rule") and `docs/failure-patterns.md` #16.
- A dedicated `_postImportSucceeded` boolean, set only in `showProgressSummary()` when `errors === 0`, gates post-import UX instead of DOM-state inference.
- `#postImportActions` cleanup is now duplicated into **both** `_closeProgressModal()` (normal close) **and** `showProgress()` (re-entry point at the start of each new import) — the "two-place cleanup" rule.

## Prevention / Reusable Lesson

Session-scoped state — what should be cleaned up, whether an operation succeeded — must be captured or reset at **session-lifecycle boundaries** (import start, import re-entry), never solely at **UI-modal-lifecycle boundaries** (modal open/close) or from a variable a background poller can mutate mid-`await`. When a value needs to survive an `await`, capture it synchronously before that `await`, not read it lazily afterward. See `docs/failure-patterns.md` #16 for the specific technical symptom→cause→fix mapping this generalizes from.

## Related

- `docs/failure-patterns.md` #16
- [AI-FEAT-024 — Source Cleanup](../features/AI-FEAT-024_SOURCE_CLEANUP.md)
- [AI-FEAT-012 — Source Selection](../features/AI-FEAT-012_SOURCE_SELECTION.md)
