# BUG-008 — lastMetadataRun Never Written Due to EISDIR Silent Failure

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-029, AI-FEAT-031, AI-FEAT-035 |
| Status | Fixed |
| Severity | Medium |
| Discovered | 2026-05-06 |
| Fixed | 2026-05-06 |
| Evidence status | Verified from `.claude/learning-log.md` (2026-05-06 entry, "Metadata Summary Persistence: Folder-vs-File Path and EISDIR Silent Failure") |

## Symptom

After an otherwise-successful import-triggered metadata run, `lastMetadataRun` and `metadataSummary` were never written to `event.json` — with no user-visible error and no crash. The actual metadata write to the file/sidecar succeeded; only the *durable record that a run had happened* silently failed to persist.

## Root Cause

`_writeLastMetadataRun(eventJsonPath, ...)` was called from the import-triggered metadata path with `eventJsonPath` holding the **event folder path**, not the `event.json` file path. Inside `_writeLastMetadataRun`, `fsp.readFile(eventJsonFilePath, 'utf8')` received the folder path and threw `EISDIR`. That error was silently caught by the surrounding try/catch with only a log line — the caller received no indication that anything had failed. The reapply path (a separate, correct call site) already passed `path.join(folderPath, 'event.json')` — the divergence was specific to the import-triggered call site.

A second, compounding issue: `_writeLastMetadataRun` used a non-atomic `fsp.writeFile`, inconsistent with every other `event.json` writer in the codebase.

## Investigation Log

- **2026-05-06** — Root cause isolated: `main/main.js` (~line 801) passed the event **folder** path where `_writeLastMetadataRun` expected the event.json **file** path; `EISDIR` was thrown and silently swallowed (`.claude/learning-log.md`).

## Fix

- **Call site correction**: `main/main.js` (~line 801) now passes `path.join(eventJsonPath, 'event.json')` — a file path — instead of the bare folder path.
- **Atomic write**: `_writeLastMetadataRun` upgraded from non-atomic `fsp.writeFile` to the tmp-file-then-rename pattern used by every other `event.json` writer.

## Prevention / Reusable Lesson

**EISDIR silent-failure pattern**: any persistence function that opens a file path will silently fail if given a directory instead. The symptom is specific and recognizable: a field that should be present in `event.json` after a successful operation is simply absent, with no crash and no visible error. When diagnosing "expected field missing after a successful-looking operation," check whether the call site passed a folder path to a function expecting a file path — a variable named `eventJsonPath` or `eventFolderPath` at the IPC-handler level is easy to mistake for the file itself. A function parameter should be named to signal file-vs-folder explicitly (`eventJsonFilePath`, not `eventJsonPath`) to make this class of mismatch visible at the call site. Every `event.json` writer must use the atomic tmp/rename pattern — a non-atomic write is always wrong here.

## Related

- [AI-FEAT-029 — Metadata Writing Engine](../features/AI-FEAT-029_METADATA_WRITING_ENGINE.md)
- [AI-FEAT-031 — Metadata Event-State Derivation](../features/AI-FEAT-031_METADATA_EVENT_STATE_DERIVATION.md)
- [AI-FEAT-035 — Dashboard Metadata Health](../features/AI-FEAT-035_DASHBOARD_METADATA_HEALTH.md)
- [BUG-007 — QMZ Metadata Context-Shape Mismatch](BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md) (related "metadata status not reflecting reality" class of bug)
- [PM-001 — Metadata Correctness Gap Found in Production-Readiness Review](../postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md)
