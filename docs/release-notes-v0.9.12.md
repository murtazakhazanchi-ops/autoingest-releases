# AutoIngest v0.9.12 — Event Sequence, QMZ, and Windows Network-Archive Metadata Fixes

**Release date:** 2026-09-20
**Build type:** Stable release
**Base:** v0.9.11
**Source commit:** `7f72e51` (identical to `v0.9.12-rc.14`; application content identical to the validated `v0.9.12-rc.13`)

---

## Overview

v0.9.12 is a correctness release. It fixes three reported problems — event sequence numbers being reassigned during folder repair, the QMZ sorter losing or mis-showing photographers and media, and metadata (XMP) failing on Windows network (UNC) archives — and adds three smaller event-naming and card-browsing fixes.

---

## 1. Event Sequence

- **Sequence numbers are no longer reassigned during folder repair.** Repairing an event folder whose name could not be parsed (for example a stray character in the name) used to assign it a brand-new "next" sequence number instead of recovering the sequence it already had. Two distinct events on the same Hijri date could end up relabeled with the same wrong sequence. Repair now recovers the event's original, already-saved sequence from its own folder name.

## 2. QMZ Sorter

- **`_Unsequenced` is no longer disturbed.** Running "Sequence Photographer Folders" on a QMZ structure could treat QMZ's reserved `_Unsequenced` holding folder as an ordinary photographer folder and rename it; the next QMZ open would then nest it, leaving real media two levels deeper than the sorter looked. This is fixed, and events already affected recover their media.
- **Photographers and media recover on Windows/NAS.** Events that had been opened in the earlier, affected workspace could still show zero photographers and media even though everything was present on disk, because directory entry types were misreported on some Windows/NAS shares. The sorter now verifies those entries directly.
- **No more contradictory QMZ panels after a refresh.** After a refresh, the sidebar, header, and center grid could each show a different photographer. A stale photographer selection is now cleared when the underlying folder is renamed, merged, or removed.
- **Faster QMZ open on network archives.** The QMZ workspace no longer waits on per-file capture-date reads (ExifTool) before becoming usable, and the remaining reads are bounded to the metadata engine's real capacity. On a real NAS event this had previously taken minutes.

## 3. Metadata on Windows Network (UNC) Archives

- **RAW XMP metadata now writes and reads reliably on `\\server\share\…` archives.** Two causes were fixed: UNC paths reaching the metadata engine in forward-slash form (which ExifTool cannot open), and ExifTool's file I/O not handling these paths on real Windows machines. Import-time metadata writing, Metadata Maintenance, and the immediate Metadata Audit read-back all use the corrected path handling.

## 4. Event Naming and Card Browsing

- **Consecutive same-city components are named once.** A multi-component event whose consecutive components share a city no longer has that city repeated once per component in the overall event name; the city now appears once per consecutive run. Component sub-folder names remain self-describing (city shown unless every component is in the same city).
- **Empty folders now appear when browsing a card.** Card browsing built its folder tree only from media files, so a folder with no media anywhere beneath it (including a whole card or a camera folder beside a populated one) never appeared. Directory structure now comes from directory listing, combined with the media scan.

---

## Release Artifacts (Stable)

| Artifact | SHA-256 |
|---|---|
| `AutoIngest-Setup-0.9.12.exe` (Windows) | `f14ffac17cc04032402c4e45b07b019c6aa546ab2b34b7c20ce1d3a7926df3cb` |
| `AutoIngest-0.9.12-arm64.dmg` (macOS arm64) | `caf98431a759bfc62d0494339e45d2bc8a5f041b681bfdf38eb61cb3d63e2fa9` |
| `AutoIngest-0.9.12-arm64-mac.zip` (macOS arm64) | `ac9c9babc034d8c122f8882090685e53efa8a3e31d3741b5040e33f4bb2d9f30` |
| `AutoIngest-0.9.12.dmg` (macOS x64) | `b581eb15eae709a5d053308f6b893435858a82895e6a0fdfd1a1d849fa23cd8e` |
| `AutoIngest-0.9.12-mac.zip` (macOS x64) | `64cd924adcd05f19b7efaf7afeba48d886d7b7e120cb4eb8a409a42ac9a7546b` |

---

## Release Engineering Notes (internal)

- **Promotion path (DEC-017).** The three fixes were validated separately in Preview builds, then together in `v0.9.12-rc.13`. `v0.9.12` was promoted from `v0.9.12-rc.14` (same source commit `7f72e51`); the Stable gate ran with no drift override.
- **Per-photo tag refinement is intentionally excluded.** The feature (`8ab045c`, `92885f2`) had been merged into `stable/0.9` (`9ae32ac`) but is still under development, so it was removed from this release with a normal revert (`ac75466`) — release-scope control, not a statement that the feature is defective. Because the merge and its revert are both now in `stable/0.9` and `main` history, merging an old refinement branch again will **not** restore the feature; it must be reintroduced deliberately (revert the revert, or re-cut the branch as new commits).
- **Release-workflow bug found and fixed.** v0.9.12 was the first Stable tag to exercise the "Extract override reason from the tag message" step of `release.yml`. Under GitHub's `bash -e -o pipefail`, `grep` returning "no match" (the normal case, since the `Override-Drift-Check:` trailer is optional) aborted the gate job before the gate ran. The first `v0.9.12` tag (on `9e4fdab`) failed this way before anything was published, was deleted, and was recreated on the rc.14 commit after the fix (`7f72e51`). An absent, empty, or whitespace-only trailer now selects the normal gate; only a non-empty reason enables the documented override.
- **Version bump.** `package.json` / `package-lock.json` were bumped to `0.9.12` in `9e4fdab`, since Stable artifacts take their version from `package.json` (see PM-002); RC builds only set it in CI.
