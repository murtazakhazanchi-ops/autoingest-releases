# AI-FEAT-002 — Login & Operator Identity

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-002 |
| Category | Application Platform |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-005 (Application Settings & Configuration Store — profiles persisted in settings) |
| Related roadmap milestone | None |
| Related technical docs | `docs/history.md` v0.8.1 |
| Evidence status | Verified from current code and `docs/history.md` |
| First-known implementation | v0.8.1 |
| Latest major update | v0.8.1 |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-022](AI-FEAT-022_PHOTOGRAPHER_FOLDER_RESOLUTION.md), [AI-FEAT-027](AI-FEAT-027_ACTIVITY_LOG.md), [AI-FEAT-028](AI-FEAT-028_IMPORT_SOURCE_ATTRIBUTION.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Mostly complete — 1 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Operator identity for AutoIngest: a dedicated splash screen for login/profile selection, an operator profile store, and attribution of imports to the operator who triggered them. Distinct from Photographer-Folder Resolution (AI-FEAT-022, archive folder naming) and Import Source Attribution (AI-FEAT-028, which memory card/drive/folder supplied the files) — three separate identity concepts that must not be collapsed into one (per `autoingest-architect` review).

**Why this exists** (*Known from project history; repository evidence pending* — captured during the Product-Owner Purpose Capture interview, 2026-08-14): serves a dual purpose, not merely UI personalization or role permissions. First, historical accountability/provenance/traceability — the archive should retain evidence of who performed an ingestion, so that if missing/corrupt/problematic data is discovered later, it can be traced back to the responsible operator and investigated. Second, live multi-user coordination — the system needs to know both which person and which device/session is operating, so other connected operators can see who is working on which event during Team Live collaboration (AI-FEAT-027, AI-FEAT-048). Operator identity was conceived as part of AutoIngest itself from the start, not built to replace a prior manual attribution process. Note: this identity system is unrelated to the `reporter` field in AI-FEAT-007's telemetry pipeline — forensic verification confirmed telemetry has no linkage to this operator-identity system, defaulting to `'Auto-report'` for all passive reports.

## Current Behavior

Dedicated frameless `BrowserWindow` (980×480, `renderer/splash.html` + `renderer/splash.js`) with three states: "Welcome back" (returning operator), operator picker, create-profile form. `main/userManager.js` is the operator profile store (list, create, get/set active user; persisted via `services/settings.js`). `splash:complete` IPC fades the splash out and the main window in (200ms CSS transition). In-app operator dropdown and add-user modal replace what was previously a `#loginSplash` overlay. Renderer holds `_activeUser: {id, name, role, initials}`. Each `imports[]` entry in `event.json` optionally carries `importedBy: {id, name}` — backward-compatible; older entries display "Imported by: Not recorded" in the Activity Log (AI-FEAT-027).

## Original Plan / Intent

Evidence pending beyond what `docs/history.md`'s v0.8.1 entry documents (introduced together with Media Preview and Import Source Attribution in the same release).

## Evolution / Implementation Journal

- **v0.8.1** — introduced: splash screen states, `userManager.js`, in-app operator dropdown replacing the old `#loginSplash` overlay, `importedBy` attribution added to `imports[]` (backward-compatible). (`docs/history.md`)
- **2026-08-14** — Purpose/history captured — Product-Owner Purpose Capture interview. Added the dual provenance/live-coordination rationale in Summary above, and the boundary note distinguishing this identity system from AI-FEAT-007's unrelated telemetry `reporter` field. No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: v0.8.1 (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evolution / Implementation Journal above has exactly one entry (already reflected as Initial implementation, or see that section directly if it describes a later change).

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

`docs/features.md`'s "Planned Features" § Multi-User Handling ("Support concurrent users or roles... Must prevent conflicting writes... Must maintain deterministic behavior") remains genuinely unimplemented — `services/settings.js`'s `getLastActiveUserId()` returns a single value, confirming operator identity today is single-active-user, not concurrent or role-based. No AI-RM milestone currently targets this.

## Related Files

- `renderer/splash.html`, `renderer/splash.js`
- `main/userManager.js`
- `services/settings.js` (`getLastActiveUserId`/`setLastActiveUserId`)
