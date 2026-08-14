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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | [DEC-003](../decisions/DEC-003_LOCAL_FIRST_ON_PREMISES_ARCHITECTURE.md) *(found via reverse lookup — not yet cross-linked in the Decisions section above)*; [DEC-012](../decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md) |
| Related bugs | [BUG-003](../bugs/BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md) |
| Related postmortems | None |
| Related architectural evolution sections | [§3G — G. Archive Operations Layer](../11_ARCHITECTURAL_EVOLUTION.md#g-archive-operations-layer) |
| Related release notes | `docs/release-notes-v0.9.8.md` |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Mostly complete — 1 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Configuration and automatic resolution of AutoIngest's four storage roots — Active Archive Root (portable NAS), Local Staging Root (operator SSD), Main Archive Root (permanent office server), Transfer Drive Root (migration carrier) — including auto-resolution, temporary override, and re-resolution when a saved root goes offline.

**Why this exists** (product-owner history, captured 2026-08-14 — *Known from project history; repository evidence pending*, combined below with fully forensically-verified current behavior): support operation across multiple possible archive locations — remote/worldwide events, portable NAS, temporary drives, environments where the primary NAS is unavailable — without the system ever silently writing to an inappropriate location. Multi-root operation was intentional from AutoIngest's design; real root-selection problems (see BUG-003 below) later clarified the need for a clean Main Archive Root vs. Active Archive Root distinction, matching what this file already documents as auto-resolution/override behavior. **Forensically re-confirmed 2026-08-14** (code investigation, `_resolveEffectiveArchiveRoot()` in `main/main.js`): the described precedence — Main Archive Root used automatically when valid and reachable, unless the operator has deliberately set a different active root as an explicit override; falling back to the active root when Main is unavailable; blocking with an explicit "not set" state (never a silent write) when neither is available — was independently verified against the live resolver code and matches this file's existing Current Behavior description exactly. One of the cleanest confirmed intent-matches-implementation cases found across the whole registry.

## Current Behavior

Per `docs/archive-operations-layer.md`: roots are configured in Settings (AI-FEAT-005) and persisted across sessions; the system only operates on a root that is currently mounted and readable. Active Archive Root auto-resolves from Main Archive Root when reachable (status: "Auto: Using Main Archive Root"); a temporary override can be chosen and persists across Save/reopen/restart; a redundant-override guard treats a chosen root equal to Main Archive Root as auto/no-override; Main Archive Root itself is never silently overwritten by a temporary override. On startup, if the last active event's stored path belongs to a now-offline root, the system re-resolves the same collection/event under the currently active (online) archive root **before** falling back to local staging — a reachable NAS always wins over a stale local-staging copy.

## Original Plan / Intent

Evidence pending beyond the release-notes trail below.

## Evolution / Implementation Journal

- **2026-05-12** — "Phase 12A: Main Archive Root Setting and Validation Foundation" (learning-log).
- **v0.9.4 (2026-05-29)** — "Archive Root & Realtime Stability Tester Build": auto-resolution and temporary override introduced (`docs/release-notes-v0.9.4.md`).
- **v0.9.8 (2026-06-16)** — "Archive Root Detection & Event Restore Fix": NAS root detection on startup event restore fixed (a reachable NAS now always wins over stale local-staging); "Adopt active root as Main Archive Root" action added to the Archive Locations panel when the saved Main Archive Root is offline but the active root is a valid online archive (`docs/release-notes-v0.9.8.md`).
- **2026-08-14** — Purpose/history captured — Product-Owner Purpose Capture interview, cross-verified by forensic code investigation. The product owner supplied the multi-site design rationale now recorded in Summary above; the resolver precedence description was independently re-confirmed against `_resolveEffectiveArchiveRoot()` in the same pass. No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Phase 12A (per learning-log Phase numbering) (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: [DEC-003](../decisions/DEC-003_LOCAL_FIRST_ON_PREMISES_ARCHITECTURE.md); [DEC-012](../decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: [BUG-003](../bugs/BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: 3 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

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
