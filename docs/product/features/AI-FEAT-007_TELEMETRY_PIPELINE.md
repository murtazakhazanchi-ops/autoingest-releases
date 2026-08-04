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

## Summary

A settings-gated telemetry pipeline: `services/telemetry.js` exports `init`/`enqueue`/`flush`/`isEnabled`. Consumed by the auto-updater (AI-FEAT-006) and potentially other main-process services. This entry exists specifically so the capability isn't silently undocumented — it was flagged by `autoingest-architect` as needing an explicit decision (document or explicitly exclude), not omission.

## Current Behavior

Gated behind `TELEMETRY_ENABLED` (settings-controlled, see AI-FEAT-005). Provides `init()`, `enqueue()`, `flush()`, `isEnabled()`. Full scope of what is enqueued, retention, and transport destination is evidence pending beyond the function signatures found.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **v0.7.4-dev** — `docs/history.md` records `debug:telemetry` and `debug:flush` as *removed* dead IPC channels at this point, implying an earlier, different telemetry surface existed and was cleaned up before the current `services/telemetry.js` shape. Whether the current pipeline is a direct descendant of that earlier surface or a separate rebuild is evidence pending.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

A full function-level audit of what data is collected, how consent/opt-out works from the user's perspective, and retention policy has not been performed in this pass — flagged as a follow-up for whoever next touches this feature, given telemetry's inherent privacy sensitivity.

## Related Files

- `services/telemetry.js`
