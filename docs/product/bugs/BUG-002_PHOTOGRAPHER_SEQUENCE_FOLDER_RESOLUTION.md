# BUG-002 — Photographer Sequence Folder Resolution Discards Existing Sequenced Folders

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-022, AI-FEAT-018 |
| Status | Fixed |
| Severity | Medium |
| Discovered | 2026-06-24 |
| Fixed | 2026-06-24 |
| Evidence status | Verified from Git history (commit `0d7e0b3`) and code |

## Symptom

Importing new files for a photographer whose folder had already been sequenced (e.g. renamed to `PC06-Aliasger Suleimanji` via AI-FEAT-022's sequencing) created a **new**, duplicate, plain-name folder (`Aliasger Suleimanji`) alongside the existing sequenced one, instead of routing the import into the sequenced folder. This happened whenever `event.json`'s `photographerSequences` field was absent for that photographer — pre-feature events, manually renamed folders, or sync lag between the sequence assignment and the next import.

## Root Cause

`ImportRouter` builds destination paths for photographer folders from `event.json`'s `photographerSequences` field. When that field is absent for a given photographer, the router fell back to the plain photographer name — with no check for whether a sequenced folder for that same photographer already existed on disk. The fallback path only consulted `event.json`; it never consulted the filesystem's own existing structure before deciding to create a new folder.

## Investigation Log

- **2026-06-24** — Traced to `ImportRouter`'s photographer-folder path construction: `photographerSequences` absent → plain name used → new folder created, even when a `PCxx-`/`PCxx_`-prefixed sequenced folder for the same (stripped, normalized) photographer name already existed as a sibling.

## Fix

Commit `0d7e0b3` — "fix(import): reuse sequenced photographer folders" (`main/main.js`, +87/-1). Added `_resolveSeqPhotographerFolders()`, a pre-flight step in `importFileJobs` that runs after path normalization and before `copyFileJobs`:

- For each unique photographer destination directory that does **not** yet exist on disk, scans the parent directory for `PCxx-`/`PCxx_`-prefixed folders whose stripped and normalized name matches.
- **Exactly one match** → destination paths are rewritten to the sequenced folder.
- **Zero matches** → a new folder is created as normal (unchanged behavior).
- **Two or more matches** → ambiguous; the plain name is kept and a warning is logged — the resolver never guesses.

VIDEO sub-directory handling mirrors `_extractPhotographerLockScopes`; `_Selected` and other system directories are excluded from match candidates.

## Prevention / Reusable Lesson

A fallback path triggered by missing structured data (`photographerSequences` absent) must actively check for pre-existing authoritative structure on disk before creating new structure — a silent fallback with no reuse check will produce duplicate folders whenever the structured data and the filesystem drift out of sync (which they will, given manual renames and sync lag are both normal operating conditions, not edge cases). When more than one plausible match exists, refuse to guess and surface the ambiguity instead of silently picking one — the same principle recurring elsewhere in this codebase's resolver logic (see [BUG-003](BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md), [DEC-012](../decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md)).

## Related

- [AI-FEAT-022 — Photographer-Folder Resolution](../features/AI-FEAT-022_PHOTOGRAPHER_FOLDER_RESOLUTION.md)
- [AI-FEAT-018 — Event-Component Import Routing](../features/AI-FEAT-018_EVENT_COMPONENT_IMPORT_ROUTING.md)
- [DEC-012 — Archive Root Resolution Requires Evidence](../decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md) (same "never guess, require confirming evidence" principle)
