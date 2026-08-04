# BUG-003 — Stale Local-Staging Restore Wins Over Reachable Archive Root

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-042, AI-FEAT-004 |
| Status | Fixed |
| Severity | High |
| Discovered | 2026-05-02 (first related symptom); root cause isolated 2026-06-15/16 |
| Fixed | 2026-06-16 (v0.9.8) |
| Evidence status | Verified from Git history (commits `a073485`, `c49dddf`), `docs/release-notes-v0.9.8.md`, and `docs/product/features/AI-FEAT-042_ARCHIVE_ROOT_CONFIGURATION_RESOLUTION.md` |

## Symptom

On application startup, the last active event was sometimes restored from a **stale Local Staging Root copy**, even when a valid, online archive root held the same event with a current `event.json`. The application logged "archive offline" even while the archive root was actually reachable (`docs/release-notes-v0.9.8.md`).

## Root Cause

`restoreLastEvent` (`renderer/eventCreator.js`) originally checked only the flat `<root>/<collection>/<event>` path against the stored `lastEvent`. Once that path matched (or the collection/root was merely reachable), the resolution stopped — path/collection **reachability** was treated as sufficient proof of "this is the current record for this event," without verifying that `event.json` was actually present and current at that path. A stale Local Staging copy is reachable too, so it could win over a genuinely current NAS copy that the resolver never got as far as checking.

An earlier, narrower instance of the same function had a related but distinct defect: on 2026-05-02, `restoreLastEvent`'s stale-path branch was found to return early without resetting `selectedCollection`, `activeMaster`, `_viewingExisting`, or `_scannedEvents` — leaving session state desynced even when the resolution itself was otherwise correct. This shows the same function was a recurring source of stale-vs-real-archive-evidence problems across multiple passes.

## Investigation Log

- **2026-05-02** — `restoreLastEvent`'s stale-path branch found returning early without a full state reset, leaving `selectedCollection`/`activeMaster`/`_viewingExisting`/`_scannedEvents` desynced (`.claude/learning-log.md`, "Three Bug Fixes: Activity Log OOM, CSP Inline Script, Event State Restoration").
- **2026-06-15** — Commit `c49dddf` — "resolve NAS root detection and prevent stale local event restore" (touches `renderer/eventCreator.js`, `renderer/renderer.js`) — an initial, narrower fix.
- **2026-06-16** — Commit `a073485` — "resolve NAS event via bounded search and list NAS collections in Step 1" — the full fix matching the symptom described above.
- **2026-06-16** — Shipped as v0.9.8, documented directly in `docs/release-notes-v0.9.8.md` as "Archive Root Detection & Event Restore Fix."

## Fix

New `settings:resolveArchiveEventPath` IPC handler: a bounded resolver that checks the archive root plus one intermediate (year/date) level, capped at 64 intermediate directories, and explicitly reports whether `event.json` is present at each candidate path — not just whether the path/collection is reachable. A NAS event **with** `event.json` now wins over any staging copy; a JSON-less NAS folder is instead routed into the existing pending-sync fallback path rather than being trusted outright. `setSessionArchiveRoot` was also guarded so it can never drop the currently-active restored `selectedCollection` during an archive-root sync (which previously could make `getActiveEventData()` return `null` and show "Create or Select Event" despite a successful restore).

## Prevention / Reusable Lesson

Path or collection **reachability** is not proof that a resolved location holds the *current* archive truth for a specific event — only event-specific evidence (`event.json` presence at that exact path, not just its parent folder existing) is sufficient. An "equal-path shortcut" in a resolver can silently disable the "keep searching for better evidence" branch it was meant to guard. This is the same principle later reinforced independently in Transfer Import's `_resolveEventDestination` hardening (`.claude/learning-log.md`, 2026-07-22) — see [DEC-012](../decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md).

## Related

- [AI-FEAT-042 — Archive Root Configuration & Resolution](../features/AI-FEAT-042_ARCHIVE_ROOT_CONFIGURATION_RESOLUTION.md)
- [AI-FEAT-004 — event.json Data Model & Persistence Contract](../features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md)
- [DEC-012 — Archive Root Resolution Requires Evidence](../decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md)
- [BUG-002 — Photographer Sequence Folder Resolution](BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md) (same "never guess, require confirming evidence" principle)
