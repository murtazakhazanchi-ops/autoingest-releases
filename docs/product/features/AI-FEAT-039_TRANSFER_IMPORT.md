# AI-FEAT-039 — Transfer Import

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-039 |
| Category | Transfer and Backup |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-038 (mirror), AI-FEAT-042, AI-FEAT-032 (triggers post-transfer metadata verification) |
| Related roadmap milestone | None |
| Related technical docs | `docs/archive-operations-layer.md` § Transfer Workflow |
| Evidence status | Verified from docs and current code (`test/transferImportOutcomeManifest.test.js`) |
| First-known implementation | Phase 13D era |
| Latest major update | 2026-08-14 — Summary now states the direct-Event vs Collection-nested resolution distinction (already documented in Current Behavior below since the same date; propagated here per Part 2 Knowledge Architecture remediation so it is discoverable through the same bounded Summary surface Decision 2 indexes for retrieval — see 10_CHANGELOG.md) |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | [DEC-012](../decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md) *(found via reverse lookup — not yet cross-linked in the Decisions section above)* |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | [§3E — E. Transfer and Distributed Working](../11_ARCHITECTURAL_EVOLUTION.md#e-transfer-and-distributed-working) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Referenced in 1 test file(s) (mechanical name/import match, not a coverage percentage — the test suite was not executed for this documentation pass): `test/transferImportOutcomeManifest.test.js` |
| Documentation completeness | Mostly complete — 1 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Imports content from a Transfer Drive into the Main Archive Root. Idempotent — re-importing the same drive does not duplicate files. **Why this exists** (*Known from project history; repository evidence pending* — captured during the Product-Owner Purpose Capture interview, 2026-08-14): the receiving/consolidating counterpart to Transfer Export (AI-FEAT-038), designed broadly rather than as a narrow mirror-restore step — it consolidates event data accumulated on mobile drives during live events back into the main archive, and is also used for large datasets originating outside AutoIngest. **Stated product intent**: Transfer Import should recognize corresponding archival events based on reliable event identity and consolidate their contents without unnecessarily duplicating event/photographer structures, rather than relying on manual filesystem copying (Finder/Explorer/TeraCopy) with no awareness of what already exists at the destination. **Current behavior differs by transfer shape** (confirmed 2026-08-14, forensic code verification — see Current Behavior below for the full account): this intent is substantially realized for direct-Event transfers (loose event folders at the transfer-drive root), which resolve destinations via a content-based identity key immune to folder renames; Collection-nested transfers (a transfer drive mirroring the archive's own Collection/Event structure) currently resolve by folder name only and do not yet have equivalent identity-based resolution — a confirmed implementation gap against stated intent, not yet fixed.

## Current Behavior

`services/transferImportService.js`. Writes `.autoingest/transfer-imports/imports.audit.jsonl` for traceability. Files land via copy only; a durable per-file outcome manifest records what happened, feeding AI-FEAT-032's post-transfer metadata verification pass.

**Identity-based consolidation — INTENT vs. CURRENT vs. GAP** (confirmed 2026-08-14, forensic code verification against the product-owner intent stated in Summary above):

- **INTENT**: recognize corresponding archival events based on reliable event identity and consolidate their contents without unnecessarily duplicating event/photographer structures, regardless of which transfer shape is being imported.
- **CURRENT — direct-Event transfers** (loose event folders found at the transfer-drive root, not nested under a Collection folder): this intent is **substantially realized**. A 5-field composite identity key (`version`, `hijriDate`, `sequence`, `eventName`, `components`) is derived from each `event.json` and matched against an index built from the entire main archive — genuinely content-based, immune to folder renames. Ambiguous matches are explicitly excluded from the run (`destinationStatus: 'unresolved'`/`'ambiguous-archive-match'`) rather than guessed. Once a destination is resolved, new files merge into the existing folder via the standard no-overwrite rules (same-size skip, different-size rename/report) — never a parallel duplicate folder; photographer-folder consolidation falls out of this automatically.
- **CURRENT — Collection-nested transfers** (transfer drive mirrors the archive's own Collection/Event folder structure): this intent is **only partially realized**. Resolution here matches by Collection/Event folder **name only** — it does not consult the identity index at all. If an event folder's name diverged between the transfer drive and the main archive (e.g., a naming-convention correction applied on one side only), this path would not recognize them as the same event and would treat it as a new, unmatched unit instead of consolidating.
- **GAP**: Collection-nested transfers do not yet provide the identity-based resolution that direct-Event transfers already have. This is a confirmed implementation gap against stated product intent, not a documentation error — recorded here per product-owner instruction (2026-08-14) rather than fixed as part of this documentation pass. See Future Enhancements.
- **event.json itself is never field-merged** in either path: if both source and destination have an `event.json` for what's logically the same event, the destination's `event.json` always wins — an incoming one that differs is either skipped (if byte-identical) or side-tracked as a conflict/`skipped-changed` file, never reconciled field-by-field.

## Original Plan / Intent

Evidence pending beyond the Phase 13D documentation already read. The general product-owner rationale and stated consolidation intent (see Summary above) are documented as project history, not as this feature's specific originally-scoped requirements — those remain evidence-pending.

## Evolution / Implementation Journal

- **Phase 13D (2026-05-14)** — introduced alongside Transfer Export as part of the Archive Operations Layer milestone.
- **2026-07-22** — "Transfer Import: Structure-Aware Destination Resolution + Incremental Scan Fingerprint" (learning-log) — most recent dated change found; likely the origin of the direct-Event/Collection-nested path split later analyzed below, though this entry's own text does not itself describe that split in identity-matching terms.
- **2026-08-14 — Purpose/history captured; Collection-nested identity gap confirmed and recorded.** A Product-Owner Purpose Capture interview supplied the stated consolidation intent now recorded in Summary above. A forensic code check in the same pass established that this intent is substantially realized for direct-Event transfers but not for Collection-nested transfers (see Current Behavior). The product owner reviewed this finding and confirmed it should be treated as a real implementation gap, not a redefinition of intent — recorded in Future Enhancements below. No code changed; this gap does not block purpose canonicalization for this feature.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Phase 13D era (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: [DEC-012](../decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: 2 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

None recorded in `docs/product/bugs/` yet.

## Decisions

None recorded.

## Future Enhancements

**Identity-based consolidation for Collection-nested transfers** — confirmed gap (2026-08-14, see Current Behavior). Product intent is identity-based event consolidation regardless of transfer shape; Collection-nested transfers currently depend on folder-name matching where the stronger identity-based behavior direct-Event transfers already have is desired. Not scheduled; runtime remediation is explicitly out of scope for the documentation pass that recorded this gap.

## Related Files

- `services/transferImportService.js`
- `test/transferImportOutcomeManifest.test.js`
