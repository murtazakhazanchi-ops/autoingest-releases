# AI-FEAT-044 — Local-First Background Archive Sync

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-044 |
| Category | Archive Operations |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-042, AI-FEAT-019 (own copy engine, `archiveSyncService.js:_copyFile`) |
| Related roadmap milestone | None |
| Related technical docs | `docs/archive-operations-layer.md` § Local First |
| Evidence status | Verified from docs (already fully read as required context) |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-029](AI-FEAT-029_METADATA_WRITING_ENGINE.md), [AI-FEAT-043](AI-FEAT-043_ARCHIVE_HEALTH_REPORTING.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | [DEC-003](../decisions/DEC-003_LOCAL_FIRST_ON_PREMISES_ARCHITECTURE.md) *(found via reverse lookup — not yet cross-linked in the Decisions section above)* |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | [§3E — E. Transfer and Distributed Working](../11_ARCHITECTURAL_EVOLUTION.md#e-transfer-and-distributed-working); [§3G — G. Archive Operations Layer](../11_ARCHITECTURAL_EVOLUTION.md#g-archive-operations-layer) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Background sync from the Local Staging Root to the Active Archive Root, used when an operator imports locally first rather than directly to the archive.

**Why this exists** (product-owner history, captured 2026-08-14 — *Known from project history; repository evidence pending*): **this corrects an earlier assumption in this documentation system** — a prior audit pass had framed this feature as primarily a remote/offline-connectivity convenience. The product owner clarified that its primary motivation is a **high-volume, multi-operator live-event throughput problem**, not offline convenience: when 5 or more operators ingest directly to the same NAS simultaneously, network/NAS throughput becomes a bottleneck and photographer card-handover turnaround slows down. Before this capability existed, an operator working around that bottleneck would copy locally, then later have to manually locate that local data and manually copy/paste it into the archive as a separate operation — a step that could be forgotten or delayed. Local-first routes ingestion through the operator's fast local storage first, then syncs to the archive in the background, removing that manual second-copy step. Resilience to temporary NAS unavailability is a secondary benefit of the same mechanism, not the primary driver.

## Current Behavior

Metadata (AI-FEAT-029) is written to the Local Staging Root **before** sync begins — the archive copy is never metadata-less. `event.sync.json` is the handoff manifest that drives background sync. The renderer shows per-event sync status; the operator can review before and after. Sync is idempotent — re-running sync on an already-synced event is safe. This is the one workflow (contrasted with Direct Archive) where metadata precedes rather than follows the archive write.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries beyond the general Archive Operations Layer timeline (see AI-FEAT-043) were independently traced for this specific subsystem in this pass.

- **2026-08-14** — Purpose/history captured — Product-Owner Purpose Capture interview. The product owner corrected an earlier documentation-pass framing of this feature as primarily an offline-convenience capability, clarifying the primary motivation is multi-operator NAS-throughput at live events (see Summary above). No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: [DEC-003](../decisions/DEC-003_LOCAL_FIRST_ON_PREMISES_ARCHITECTURE.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

`docs/archive-operations-layer.md` § Known Limitations: "No automatic Local Staging Root cleanup after sync completes" and "No portable NAS wipe/reset tool for post-transfer teardown" are both documented gaps for this feature area.

## Related Files

- `services/archiveSyncService.js`
- `services/syncQueueService.js`
- `services/syncReviewService.js`
- `services/localSyncManifest.js`
