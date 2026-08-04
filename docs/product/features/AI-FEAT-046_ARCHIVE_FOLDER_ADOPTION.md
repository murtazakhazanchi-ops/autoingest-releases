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

## Summary

Registers a pre-existing, manually-created archive folder as an AutoIngest-managed event by writing a minimal `event.json` into it — without moving, renaming, or restructuring any media. Reversible by deleting the written `event.json`. Conceptually distinct from AI-FEAT-047's QMZ-internal unsequenced-folder adoption (which adopts folders into QMZ's own `_Unsequenced` bucket, not the archive-wide event registry).

## Current Behavior

`docs/archive-adoption-contract.md` states: "Phase 13C-7 — Implemented. Adoption write contract is complete." 16 dry-run validation checks; readiness classifications (Ready / Needs review / Blocked / Not adoptable); writes are atomic (tmp→rename); the written `event.json` deliberately has `components: []` by design. Supports ready candidates only — folders already following naming conventions (`docs/archive-operations-layer.md` § Known Limitations). No bulk adoption — events are adopted one at a time.

## Original Plan / Intent

Evidence pending beyond the Phase 13C-7 contract statement.

## Evolution / Implementation Journal

- **2026-05-13** — "Phase 13C-5: Dry-Run Check List Completeness" (learning-log).
- **2026-05-13** — "Phase 13C-7: Manual Folder Adoption Write" (learning-log) — the write contract itself.
- **2026-05-14** — "Phase 13C-8: Post-Adoption Managed Event Integration Validation" (learning-log).
- **2026-05-14** — "Phase 13C-7.1: Refresh Event List After Adoption" (learning-log).
- **2026-05-14** — "Phase 13C-9: Adoption Block Silent Drop on Full-Payload Save" (learning-log) — a real bug (a silent data-loss risk on save) found and fixed.
- **2026-05-14** — "Phase 13C-11: Adopted Event 0→Multi Component Structure Warning" (learning-log).

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
