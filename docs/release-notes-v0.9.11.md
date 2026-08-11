# AutoIngest v0.9.11 — Windows/Event Management Reliability & Stability Hardening

**Release date:** 2026-08-11
**Build type:** Stable release
**Base:** v0.9.10

---

## Overview

v0.9.11 is a reliability and stability release focused on Windows/NAS Event Management. It fixes the root cause of existing events intermittently failing to appear in Event Management, along with three related reliability issues surfaced during real-hardware testing, and closes a set of latent consistency gaps found during a follow-up repository-wide stabilization review. No new user-facing features in this release.

---

## 1. Windows / Event Management Reliability Fixes

- **Existing events failing to appear.** A collection with valid, correctly-saved events could show "Existing Events (0)" in Event Management even though every event actually existed on disk. This was caused by an internal type mismatch during event sorting that could abort the entire event list before it was returned — it has been fixed so a collection's full, correct event list is always returned. Confirmed on real Windows/NAS hardware: a 36-event collection that previously reported zero events now lists all of them correctly.
- **Newly-created events now refresh correctly.** Creating a new event and returning to Event Management for the same collection now reliably shows the new event immediately, without needing to reselect the collection first.
- **Windows/UNC path handling made consistent.** Path comparisons involving Windows network paths (`\\server\share\...`) are now handled consistently across Event Management, closing a gap where a previously-selected collection could intermittently disappear and fall back to "Create Collection" even though it still existed.
- **Create Event action button sync.** The primary action button (Create/Continue) on the Create Event form now always reflects the current screen correctly, closing a gap where it could be missing under certain navigation sequences.
- **NAS scan now distinguishes "empty" from "could not check."** A NAS archive or collection scan that fails to read (e.g. a transient network hiccup) is no longer shown as if it were genuinely empty — it now shows a clear "could not read right now" state with a retry option, and never overwrites a previously-successful list with an error result.

## 2. Stability Improvements

- Checkpoint progress values loaded from disk are now defensively validated before use, preventing an unexpected value type from corrupting resumed transfer/import progress.
- Photographer sequence ordering is now validated consistently wherever it is read, preventing a bad value from silently affecting sort order.
- Path-containment and sequence-normalization logic has been consolidated into single, shared implementations used consistently across the app, removing several duplicated implementations that could previously drift out of sync with each other.
- Internal-only metadata status fields are no longer exposed through the metadata status API surface.
- Expanded automated regression coverage across path handling, sequence handling, checkpoint handling, and event discovery — no behavior changes beyond what's described above; existing functionality is unaffected.

---

## Notes

- No file-copy, routing, or event.json contract changed in this release — all fixes are corrective within existing contracts (`docs/system-contracts.md`).
- No archive or settings migration is required for this release. All fixes normalize values at read/runtime; nothing is rewritten on disk (see `docs/product/bugs/BUG-011_*.md` and the transfer checkpoint fix for the underlying detail, if needed).
- This release closes the Windows/NAS Event Management reliability incident tracked as `BUG-011` through `BUG-014` in `docs/product/bugs/`.
