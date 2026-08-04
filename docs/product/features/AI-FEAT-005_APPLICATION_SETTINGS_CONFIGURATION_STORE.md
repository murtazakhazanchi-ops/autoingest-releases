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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-001](AI-FEAT-001_ELECTRON_APPLICATION_SHELL_SECURITY_MODEL.md), [AI-FEAT-002](AI-FEAT-002_LOGIN_OPERATOR_IDENTITY.md), [AI-FEAT-004](AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md), [AI-FEAT-029](AI-FEAT-029_METADATA_WRITING_ENGINE.md), [AI-FEAT-042](AI-FEAT-042_ARCHIVE_ROOT_CONFIGURATION_RESOLUTION.md), [AI-FEAT-048](AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Mostly complete — 2 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

`services/settings.js` is the general-purpose persistence layer for application configuration — distinct from `event.json` (AI-FEAT-004), which is per-event archival data. This was missed by both initial research passes and added after `autoingest-architect` review flagged it as a foundational entry other features silently depend on.

## Current Behavior

Exposes getters/setters for archive roots (`getArchiveRoot`, `getNasRoot`, `getMainArchiveRoot`, `getLocalStagingRoot`, `getTransferRoot` — consumed by AI-FEAT-042), window bounds (`getWindowBounds`/`setWindowBoundsSync` — consumed by AI-FEAT-001/003), last active operator (`getLastActiveUserId` — consumed by AI-FEAT-002), the auto-metadata toggle (`getAutoMetadataEnabled` — consumed by AI-FEAT-029/037), default import mode, and realtime connection settings (`getRealtimeEnabled`, `getRealtimeServerUrl`, `getRealtimeServerKey`, `getDeviceId`, `getDeviceDisplayName` — consumed by AI-FEAT-048).

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **2026-05-21** — "v0.8.8 RC: Settings Atomic-Write Race, Save Error Handling, Staging Wording" (learning-log) — a race condition in settings persistence was found and fixed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evolution / Implementation Journal above has exactly one entry (already reflected as Initial implementation, or see that section directly if it describes a later change).

## Known Bugs / Troubleshooting

None recorded in `docs/product/bugs/` yet — the 2026-05-21 atomic-write race fix predates this system and has not been backfilled into a bug record.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `services/settings.js` (not `main/settings.js` — corrected path per `autoingest-architect` review)
