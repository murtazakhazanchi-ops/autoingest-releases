# AI-FEAT-042 — Archive Root Configuration & Resolution

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-042 |
| Category | Archive Operations |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | AI-FEAT-005 |
| Subfeatures | None |
| Dependencies | AI-FEAT-005 |
| Related roadmap milestone | None |
| Related technical docs | `docs/archive-operations-layer.md` § Three-Root Model |
| Evidence status | Verified from docs (already fully read as required context) and release notes |
| First-known implementation | Phase 12A (per learning-log Phase numbering) |
| Latest major update | v0.9.8 (2026-06-16) |

## Summary

Configuration and automatic resolution of AutoIngest's four storage roots — Active Archive Root (portable NAS), Local Staging Root (operator SSD), Main Archive Root (permanent office server), Transfer Drive Root (migration carrier) — including auto-resolution, temporary override, and re-resolution when a saved root goes offline.

## Current Behavior

Per `docs/archive-operations-layer.md`: roots are configured in Settings (AI-FEAT-005) and persisted across sessions; the system only operates on a root that is currently mounted and readable. Active Archive Root auto-resolves from Main Archive Root when reachable (status: "Auto: Using Main Archive Root"); a temporary override can be chosen and persists across Save/reopen/restart; a redundant-override guard treats a chosen root equal to Main Archive Root as auto/no-override; Main Archive Root itself is never silently overwritten by a temporary override. On startup, if the last active event's stored path belongs to a now-offline root, the system re-resolves the same collection/event under the currently active (online) archive root **before** falling back to local staging — a reachable NAS always wins over a stale local-staging copy.

## Original Plan / Intent

Evidence pending beyond the release-notes trail below.

## Evolution / Implementation Journal

- **2026-05-12** — "Phase 12A: Main Archive Root Setting and Validation Foundation" (learning-log).
- **v0.9.4 (2026-05-29)** — "Archive Root & Realtime Stability Tester Build": auto-resolution and temporary override introduced (`docs/release-notes-v0.9.4.md`).
- **v0.9.8 (2026-06-16)** — "Archive Root Detection & Event Restore Fix": NAS root detection on startup event restore fixed (a reachable NAS now always wins over stale local-staging); "Adopt active root as Main Archive Root" action added to the Archive Locations panel when the saved Main Archive Root is offline but the active root is a valid online archive (`docs/release-notes-v0.9.8.md`).

## Known Bugs / Troubleshooting

The v0.9.8 fix directly addresses a real prior bug: the last active event could be restored from a stale local-staging copy even when a valid online archive root held the same event. See `docs/release-notes-v0.9.8.md` for the full symptom/fix description, documented as [BUG-003 — Stale Local-Staging Restore Wins Over Reachable Archive Root](../bugs/BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md).

## Decisions

See [DEC-012 — Archive Root Resolution Requires Evidence](../decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md).

## Future Enhancements

None recorded.

## Related Files

- `services/settings.js` (root getters)
- `services/nasEventCache.js`
- `services/offlineCollectionRegistryService.js` (`collection.link.json`)
