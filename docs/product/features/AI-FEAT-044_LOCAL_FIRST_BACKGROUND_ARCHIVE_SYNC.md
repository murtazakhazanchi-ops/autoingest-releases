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

## Summary

Background sync from the Local Staging Root to the Active Archive Root, used when an operator imports locally first rather than directly to the archive.

## Current Behavior

Metadata (AI-FEAT-029) is written to the Local Staging Root **before** sync begins — the archive copy is never metadata-less. `event.sync.json` is the handoff manifest that drives background sync. The renderer shows per-event sync status; the operator can review before and after. Sync is idempotent — re-running sync on an already-synced event is safe. This is the one workflow (contrasted with Direct Archive) where metadata precedes rather than follows the archive write.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries beyond the general Archive Operations Layer timeline (see AI-FEAT-043) were independently traced for this specific subsystem in this pass.

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
