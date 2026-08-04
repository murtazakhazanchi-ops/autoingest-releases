# AI-FEAT-007 — Telemetry Pipeline

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-007 |
| Category | Application Platform |
| Status | Implemented |
| Maturity | Operational |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-005 (settings-gated via `TELEMETRY_ENABLED`), AI-FEAT-006 (auto-updater is a consumer) |
| Related roadmap milestone | None |
| Related technical docs | None dedicated |
| Evidence status | Verified from current code (`autoingest-architect` review pass — missed by both initial research forks; added rather than silently excluded, per the review's explicit instruction) |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

A settings-gated telemetry pipeline: `services/telemetry.js` exports `init`/`enqueue`/`flush`/`isEnabled`. Consumed by the auto-updater (AI-FEAT-006) and potentially other main-process services. This entry exists specifically so the capability isn't silently undocumented — it was flagged by `autoingest-architect` as needing an explicit decision (document or explicitly exclude), not omission.

## Current Behavior

Gated behind `TELEMETRY_ENABLED` (settings-controlled, see AI-FEAT-005). Provides `init()`, `enqueue()`, `flush()`, `isEnabled()`. Full scope of what is enqueued, retention, and transport destination is evidence pending beyond the function signatures found.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **v0.7.4-dev** — `docs/history.md` records `debug:telemetry` and `debug:flush` as *removed* dead IPC channels at this point, implying an earlier, different telemetry surface existed and was cleaned up before the current `services/telemetry.js` shape. Whether the current pipeline is a direct descendant of that earlier surface or a separate rebuild is evidence pending.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evolution / Implementation Journal above has exactly one entry (already reflected as Initial implementation, or see that section directly if it describes a later change).

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

A full function-level audit of what data is collected, how consent/opt-out works from the user's perspective, and retention policy has not been performed in this pass — flagged as a follow-up for whoever next touches this feature, given telemetry's inherent privacy sensitivity.

## Related Files

- `services/telemetry.js`
