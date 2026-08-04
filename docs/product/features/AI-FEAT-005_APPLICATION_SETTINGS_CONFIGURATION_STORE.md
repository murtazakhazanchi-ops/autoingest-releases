# AI-FEAT-005 — Application Settings & Configuration Store

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-005 |
| Category | Application Platform |
| Status | Implemented |
| Maturity | Foundational |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | None |
| Related roadmap milestone | None |
| Related technical docs | None dedicated — cross-cutting |
| Evidence status | Verified from current code (`autoingest-architect` review pass) |
| First-known implementation | Evidence pending |
| Latest major update | 2026-05-21 ("v0.8.8 RC: Settings Atomic-Write Race, Save Error Handling, Staging Wording" — learning-log) |

## Summary

`services/settings.js` is the general-purpose persistence layer for application configuration — distinct from `event.json` (AI-FEAT-004), which is per-event archival data. This was missed by both initial research passes and added after `autoingest-architect` review flagged it as a foundational entry other features silently depend on.

## Current Behavior

Exposes getters/setters for archive roots (`getArchiveRoot`, `getNasRoot`, `getMainArchiveRoot`, `getLocalStagingRoot`, `getTransferRoot` — consumed by AI-FEAT-042), window bounds (`getWindowBounds`/`setWindowBoundsSync` — consumed by AI-FEAT-001/003), last active operator (`getLastActiveUserId` — consumed by AI-FEAT-002), the auto-metadata toggle (`getAutoMetadataEnabled` — consumed by AI-FEAT-029/037), default import mode, and realtime connection settings (`getRealtimeEnabled`, `getRealtimeServerUrl`, `getRealtimeServerKey`, `getDeviceId`, `getDeviceDisplayName` — consumed by AI-FEAT-048).

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **2026-05-21** — "v0.8.8 RC: Settings Atomic-Write Race, Save Error Handling, Staging Wording" (learning-log) — a race condition in settings persistence was found and fixed.

## Known Bugs / Troubleshooting

None recorded in `docs/product/bugs/` yet — the 2026-05-21 atomic-write race fix predates this system and has not been backfilled into a bug record.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `services/settings.js` (not `main/settings.js` — corrected path per `autoingest-architect` review)
