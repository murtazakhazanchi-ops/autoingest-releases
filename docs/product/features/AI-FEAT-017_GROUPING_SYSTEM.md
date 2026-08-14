# AI-FEAT-017 — Grouping System

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-017 |
| Category | Grouping and Routing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-004 (must remain consistent with event.json mappings) |
| Related roadmap milestone | None |
| Related technical docs | `docs/group-manager.md`, `docs/features.md` #3 |
| Evidence status | Verified from current code and docs |
| First-known implementation | v0.7.x |
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
| Documentation completeness | Mostly complete — 1 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Assigns selected files into logical groups mapped to sub-events. A transient renderer state layer (`renderer/groupManager.js`) that must always sync with `event.json` and reset on event change.

**Why this exists** (*Known from project history; repository evidence pending* — captured during the Product-Owner Purpose Capture interview, 2026-08-14; one of the most detailed, best-evidenced accounts captured in that interview): makes correct archival organization feasible *during* high-pressure live ingestion, rather than forcing error-prone cleanup later. Before this existed, multi-component events required extensive manual folder preparation: manually create the main event folder, manually create component/sub-event folders, manually create photographer folders within those, inspect source media, separately copy subsets into each destination, and repeat per component. During live events this was too slow — photographers could be waiting to hand over cards while an ingester was still manually constructing/sorting structures. As a practical workaround, ingesters sometimes dumped entire photographer datasets temporarily and postponed proper sorting, which created a *second* workflow later (reopen the dumped data, inspect it again, separate it into components, create the appropriate structures, move/copy it into final locations) — sometimes extending work beyond the event/day itself.

Grouping collapses this: the operator selects media, assigns logical groups, maps groups to event components/sub-events, provides photographer identity, and starts the import — AutoIngest then performs the structural bifurcation and photographer-folder placement automatically, eliminating the need to run separate import/copy passes for each component. The objective is to make correct archival organization feasible during live ingestion itself, not something deferred to cleanup afterward. What became automated: structural bifurcation and photographer-folder placement from operator-assigned groups. What remains manual: the operator still selects the media, assigns it to groups/components, and supplies photographer identity — those judgment calls stay human; only the mechanical folder-creation and placement work is automated. Steps removed/consolidated are described qualitatively, not as a specific count: eliminated repeated folder creation and duplicate copy passes across components, and removed the "dump now, sort later" second workflow entirely when Grouping is used as intended.

## Current Behavior

Group shape: `{id, label, colorIdx, files: Set, subEventId, metadataTags}`. Rules: groups never empty (auto-removed when empty), one group → one sub-event, files must belong to exactly one group (structural exclusivity via `_fileGroupMap`, one groupId per filePath — not a keyboard-shortcut mechanism), groups must have a valid `subEventId` before import. Operations: `createGroup`, `assignFiles`, `unassignFiles`, `setSubEvent` — invalid operations are rejected, never silently corrected. 10 pastel colors keyed to `--group-N` CSS vars, derived at render time from array position (no drift after deletions).

**Evidence-pending note**: a "group shortcuts" keyboard-assignment mechanism (numeric-key group assignment) was searched for directly in `renderer/renderer.js` and not found. Do not assume this exists — the one-group-per-file *exclusivity* constraint is real and structural (`_fileGroupMap`), but a dedicated keyboard-shortcut UI for it is evidence-pending / possibly not implemented.

## Original Plan / Intent

Introduced as part of the v0.7.x "Core System Architecture" milestone (`docs/history.md`).

## Evolution / Implementation Journal

- **v0.7.x** — grouping system introduced.
- **2026-08-14** — Purpose/history captured — Product-Owner Purpose Capture interview. Detailed pre-AutoIngest manual multi-step workflow (and the "dump now, sort later" workaround it replaced) recorded in Summary above, grounded in real live-event operational experience. No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: v0.7.x (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evolution / Implementation Journal above has exactly one entry (already reflected as Initial implementation, or see that section directly if it describes a later change).

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #7 (Groups Behaving Incorrectly) for the documented symptom→cause map for this feature.

## Decisions

None recorded.

## Future Enhancements

Whether a keyboard-shortcut group-assignment mechanism should be added is an open question — not currently scoped in any roadmap milestone.

## Related Files

- `renderer/groupManager.js`
