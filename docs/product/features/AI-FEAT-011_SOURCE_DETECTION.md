# AI-FEAT-011 — Source Detection (Drives, DCIM, Sony PRIVATE)

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-011 |
| Category | Source Acquisition |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | None |
| Related roadmap milestone | None |
| Related technical docs | `docs/architecture.md` § Drive Detection |
| Evidence status | Verified from current code |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-012](AI-FEAT-012_SOURCE_SELECTION.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | [§3B — B. Initial AutoIngest Foundation](../11_ARCHITECTURAL_EVOLUTION.md#b-initial-autoingest-foundation) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Detects connected storage devices eligible for import: polls for drives, filters by DCIM presence, and recognizes Sony camera folder conventions (PRIVATE/M4ROOT/CLIP for photos, PRIVATE/AVCHD/BDMV/STREAM for video). This is the backend detection layer consumed by Source Selection (AI-FEAT-012) — detection and selection are deliberately kept as separate registry entries because detection is genuinely distinct backend infrastructure (device polling, filesystem heuristics), while selection is a thin UI layer over the same underlying `activeSource` state regardless of source type.

**Why this exists** (*Known from project history; repository evidence pending* — captured during the Product-Owner Purpose Capture interview, 2026-08-14): ensures all legitimate media on a connected source is discoverable, regardless of which folder convention a given camera or card uses — not a Sony-specific feature (Sony is the concrete, evidenced example, not the whole scope). Early AutoIngest intentionally narrowed source browsing primarily to DCIM to simplify ingestion and reduce clutter; that assumption later proved too narrow, since some cameras (Sony being the documented example) store video outside DCIM entirely, and operators may receive cards/drives with legitimate media in non-obvious folders. This is a reactive refinement — an internal AutoIngest evolution (an earlier, narrower DCIM-only mechanism replaced by the current broader one) rather than a manual pre-AutoIngest process being automated. The goal is to avoid the application silently hiding legitimate media merely because it isn't in the expected folder.

## Current Behavior

`main/driveDetector.js` uses `drivelist`, polls every 5 seconds, filters by DCIM presence. IPC: `drives:get` / `drives:updated` / `drives:allUpdated`. `main/fileBrowser.js`'s `scanPrivateFolder()` (lines 376-410) checks exactly two known Sony subdirectory shapes — `PRIVATE/M4ROOT/CLIP` and `PRIVATE/AVCHD/BDMV/STREAM` — never recurses the full `PRIVATE` tree, filters junk files, applies a >500KB size floor, and tags results `source: 'private'`. A code comment in `main/main.js:406` notes this "naturally covers Sony PRIVATE/M4ROOT/CLIP, AVCHD/STREAM, any user-created subdirs."

## Original Plan / Intent

Evidence pending regarding this feature's originally-scoped requirements. See Summary above for the product-owner rationale captured 2026-08-14 (broadened from an earlier DCIM-only scope after that assumption proved too narrow).

## Evolution / Implementation Journal

No dated entries found in this pass beyond the 2026-08-14 entry below. Sony PRIVATE folder support is referenced in current renderer UI copy (`renderer/renderer.js:11551`) but not dated.

- **2026-08-14** — Purpose/history captured — Product-Owner Purpose Capture interview. Added the DCIM-only → universal-discovery evolution rationale in Summary above, with explicit correction that this must not be documented as Sony-only. No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/driveDetector.js`
- `main/fileBrowser.js` (`scanPrivateFolder`)
