# BUG-013 — setSessionArchiveRoot() Windows/UNC path prefix check silently drops the active collection and all session collections

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-009, AI-FEAT-010, AI-FEAT-005 |
| Status | Fixed |
| Severity | Critical |
| Discovered | 2026-08-07 |
| Fixed | 2026-08-07 |
| Evidence status | Recorded by automated documentation orchestration from session `sess-2026-08-07T13-53-49-871Z-1bbbe4`; evidence source(s): explicit-user-statement, code-diff, test-output |

## Symptom

While using the app (specifically: at every app startup, and whenever Archive Locations is saved), a previously-selected/existing collection intermittently disappeared from Event Management, and the app fell back to showing the "Create Collection" screen even though the collection physically existed on the archive. It sometimes reappeared later. Reported as especially relevant because Working Root and Main Archive Root pointed to the same NAS/UNC path.

## Root Cause

renderer/eventCreator.js's EventCreator.setSessionArchiveRoot(path) — called from renderer.js's initApp() on every startup and from the Archive Locations Save handler — tested whether the active collection and each session collection still lived under the new archive root using a literal `somePath.startsWith(root + '/')`. On Windows, real archive paths from fs/path APIs (including UNC paths like \\FQ_PhotoArchive\02-Working-AJSS\1448\...) use backslash separators, so appending a literal forward slash to `root` produced a string that could never match a genuinely-nested backslash path. The check therefore always concluded "no longer belongs to this root" for every collection on Windows, wiping activeMaster/selectedCollection and then dropping every entry from sessionCollections (the same broken check gated which collections were "kept"). buildMasterHTML() then renders the empty-state "Create Collection" form whenever sessionCollections.length === 0. On macOS/POSIX the same expression works by coincidence (paths are already forward-slash separated), which is why this was invisible in prior testing and only surfaced for the Windows/UNC tester.

## Investigation Log

- **2026-08-07** — Grepped for the exact `startsWith(root + '/')` / `startsWith(... + '/')` pattern across renderer/eventCreator.js and renderer/renderer.js; found two occurrences inside setSessionArchiveRoot() and confirmed via git log -p that eventMgmt.js and this code region were introduced together, ruling out an unrelated intentional design. Wrote path.win32-fixture unit tests (test/pathUtils.test.js) reproducing the exact tester-reported UNC shape (\\FQ_PhotoArchive\02-Working-AJSS\1448) and proved the OLD expression (coll.startsWith(root + '/')) returns false for a genuinely-nested path on that shape — a direct, reproducible confirmation of the defect, independent of a live Windows machine. The one other similar-looking call site found (renderer.js line ~10286, Local First transfer routing) was already correctly normalizing both operands to forward slashes first and was left untouched as out of scope.

## Fix

Added renderer/pathUtils.js exposing isPathUnderRoot(childPath, rootPath): normalizes both paths to forward slashes and strips trailing separators before doing the segment-boundary-aware prefix check. renderer/eventCreator.js's setSessionArchiveRoot() now calls this helper at both call sites instead of the raw startsWith(root + '/') expression. Covered by 14 unit tests in test/pathUtils.test.js using path.win32-shaped fixtures (UNC roots, trailing separators, mixed separators, case differences, sibling-collection false-positive guard, and a literal regression-guard test asserting the OLD expression fails on the same fixture the NEW helper passes).

**Post-review refinement (same session)**: `code-reviewer` flagged that an unconditional case-insensitive comparison is a real correctness gap for `isPathUnderRoot()`'s *other* callers — `setSessionArchiveRoot()` also runs against Local Staging paths, which can live on a genuinely case-sensitive filesystem (Linux, case-sensitive-formatted APFS), where two differently-cased directories are different collections. Case-insensitivity is now applied only when either path is Windows/UNC-shaped (detected by string shape — `\\\\server\...` or `C:\...` — since the renderer has no `process.platform`), never for POSIX-shaped paths. Added negative-case tests confirming a differently-cased root is correctly rejected on a POSIX-shaped path while still matching on a Windows-shaped one.

## Prevention / Reusable Lesson

Never build a path-containment check with a literal '/' concatenation; every "is X under root Y" comparison in this codebase should go through a single normalizing helper (now renderer/pathUtils.js's isPathUnderRoot) rather than each call site reimplementing string concatenation. Any new path-comparison code must be exercised with path.win32 fixtures in its unit test, since a macOS/POSIX dev machine cannot surface this class of bug by construction.

## Related

None recorded.
