# AI-FEAT-046 — Archive Folder Adoption

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-046 |
| Category | Archive Operations |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-004 (writes a minimal event.json), AI-FEAT-042 |
| Related roadmap milestone | None (delivered pre-dating the AI-RM numbering) |
| Related technical docs | `docs/archive-adoption-contract.md`, `docs/archive-adoption-workflow.md` |
| Evidence status | Verified from current code and both dedicated docs (full read) |
| First-known implementation | Phase 13C-7 |
| Latest major update | Phase 13C-9 (2026-05-14, adoption-block silent-drop fix) |

## Discovery Note

**Not on the original 63-item feature checklist** — independently discovered by both research passes conducted for this audit, which is why it's included despite the absence of an explicit prompt to look for it.

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-047](AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | None recorded |
| Related bugs | [BUG-006](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md) |
| Related postmortems | None |
| Related architectural evolution sections | [§3G — G. Archive Operations Layer](../11_ARCHITECTURAL_EVOLUTION.md#g-archive-operations-layer) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Mostly complete — 1 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Registers a pre-existing, manually-created archive folder as an AutoIngest-managed event by writing a minimal `event.json` into it — without moving, renaming, or restructuring any media. Reversible by deleting the written `event.json`. Conceptually distinct from AI-FEAT-047's QMZ-internal unsequenced-folder adoption (which adopts folders into QMZ's own `_Unsequenced` bucket, not the archive-wide event registry).

**Why this exists** (product-owner history, captured 2026-08-14 — *Known from project history; repository evidence pending*): serves two purposes, both now confirmed — legacy-archive migration (AutoIngest was introduced into an archive that already contained many historical, manually-created folders, and the archive shouldn't have to discard or rebuild that history just to become AutoIngest-managed) and ongoing adoption of externally-created event folders (contributors organizing folders outside AutoIngest still need a path to bring that material under management). This resolves what was previously an entirely unstated motivating scenario for this feature.

## Current Behavior

`docs/archive-adoption-contract.md` states: "Phase 13C-7 — Implemented. Adoption write contract is complete." 16 dry-run validation checks; readiness classifications (Ready / Needs review / Blocked / Not adoptable); writes are atomic (tmp→rename); the written `event.json` deliberately has `components: []` by design. Supports ready candidates only — folders already following naming conventions (`docs/archive-operations-layer.md` § Known Limitations). No bulk adoption — events are adopted one at a time.

## Original Plan / Intent

Evidence pending beyond the Phase 13C-7 contract statement, regarding this feature's specific originally-scoped requirements. See Summary above for the now-captured motivating scenario (project history, not a repository-verified original scoping document).

## Evolution / Implementation Journal

- **2026-05-13** — "Phase 13C-5: Dry-Run Check List Completeness" (learning-log).
- **2026-05-13** — "Phase 13C-7: Manual Folder Adoption Write" (learning-log) — the write contract itself.
- **2026-05-14** — "Phase 13C-8: Post-Adoption Managed Event Integration Validation" (learning-log).
- **2026-05-14** — "Phase 13C-7.1: Refresh Event List After Adoption" (learning-log).
- **2026-05-14** — "Phase 13C-9: Adoption Block Silent Drop on Full-Payload Save" (learning-log) — a real bug (a silent data-loss risk on save) found and fixed.
- **2026-05-14** — "Phase 13C-11: Adopted Event 0→Multi Component Structure Warning" (learning-log).
- **2026-08-14** — Purpose/history captured — Product-Owner Purpose Capture interview. The product owner confirmed the dual legacy-migration/ongoing-onboarding motivation now recorded in Summary above, resolving what the original Knowledge Purpose Audit had flagged as an entirely unknown motivating scenario. No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Phase 13C-7 (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: [BUG-006](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: 6 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

Phase 13C-9's "Adoption Block Silent Drop on Full-Payload Save" (2026-05-14) is now documented as [BUG-006 — Event-Edit Full-Payload Save Silently Drops Untracked Fields](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md).

## Decisions

None recorded.

## Future Enhancements

`docs/archive-operations-layer.md` § Known Limitations: "No bulk adoption: events are adopted one at a time" is a documented, standing gap.

## Related Files

- `services/adoptionDryRunService.js`
- `services/adoptionPreviewService.js`
- `services/adoptionWriteContract.js`
- `services/adoptionWriteService.js`
