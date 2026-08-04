# AI-FEAT-004 — event.json Data Model & Persistence Contract

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-004 |
| Category | Application Platform |
| Status | Implemented |
| Maturity | Foundational |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | None |
| Related roadmap milestone | None |
| Related technical docs | `docs/data-model.md`, `docs/system-contracts.md` §1-2, `docs/event-system.md` |
| Evidence status | Verified from current code and docs |
| First-known implementation | v0.7.x ("Major architectural shift... Introduced event.json as source of truth" — `docs/history.md`) |
| Latest major update | v0.7.4-dev (atomic transaction write introduced; see AI-FEAT-021) |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-021](AI-FEAT-021_ATOMIC_IMPORT_TRANSACTION.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | [DEC-001](../decisions/DEC-001_EVENT_DATA_AS_DURABLE_ARCHIVE_TRUTH.md) *(found via reverse lookup — not yet cross-linked in the Decisions section above)*; [DEC-002](../decisions/DEC-002_FOLDER_STRUCTURE_PLUS_EMBEDDED_METADATA.md) *(found via reverse lookup — not yet cross-linked in the Decisions section above)* |
| Related bugs | [BUG-003](../bugs/BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md) *(found via reverse lookup — not yet cross-linked in the Known Bugs section above)*; [BUG-006](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md) *(found via reverse lookup — not yet cross-linked in the Known Bugs section above)* |
| Related postmortems | None |
| Related architectural evolution sections | [§3B — B. Initial AutoIngest Foundation](../11_ARCHITECTURAL_EVOLUTION.md#b-initial-autoingest-foundation) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Referenced in 2 test file(s) (mechanical name/import match, not a coverage percentage — the test suite was not executed for this documentation pass): `test/eventJsonStore.test.js`, `test/metadataStateService.test.js` |
| Documentation completeness | Complete — no unresolved "Evidence pending" markers in this file |

## Summary

`event.json` is the single, authoritative representation of event structure, sub-events, group mappings, and ingestion state for every AutoIngest event. All system behavior — UI, routing, metadata, archive operations — derives from it. This is the foundational contract every other feature in this registry is built on top of.

## Current Behavior

Must always be valid JSON, pass schema validation before write, remain backward compatible, and never contain derived or UI-only state. Key top-level properties: `event` (metadata), `subEvents[]`, `groups[]`, `mappings[]`, `imports[]`, `status`. One group maps to exactly one sub-event; no orphan groups; no duplicate mappings. Writes are atomic, crash-safe, and idempotently reconciled. See `docs/system-contracts.md` §1 for the full MUST/MUST NOT list — these are non-negotiable invariants, not guidelines.

## Original Plan / Intent

Introduced as part of the v0.7.x "Core System Architecture" milestone alongside the Dashboard rebuild, Event system, Grouping system, and Import routing (`docs/history.md`).

## Evolution / Implementation Journal

- **v0.7.x** — event.json introduced as source of truth; ingestion pipeline structure established.
- **v0.7.4-dev** — `import:commitTransaction` replaces multi-step event.json writes (see AI-FEAT-021); `isValidEventJson` made non-mutating; dead code removed (`markEventImportComplete`, standalone `appendImports`).
- Ongoing — every feature that touches `event.json` (metadata's `metadataState` block, QMZ's sequence state, sync's `event.sync.json` manifest) writes exclusively through `main/eventJsonStore.js`'s `updateEventJsonAtomic`, never an independent read-modify-write (`docs/metadata-system.md`).

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: v0.7.x ("Major architectural shift... Introduced event.json as source of truth" — `docs/history.md`) (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: [DEC-001](../decisions/DEC-001_EVENT_DATA_AS_DURABLE_ARCHIVE_TRUTH.md); [DEC-002](../decisions/DEC-002_FOLDER_STRUCTURE_PLUS_EMBEDDED_METADATA.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: [BUG-003](../bugs/BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md); [BUG-006](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: 3 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

None recorded in `docs/product/bugs/` yet. `docs/failure-patterns.md` #5 and #9 map DATA-layer symptoms back to this contract.

## Decisions

None recorded.

## Future Enhancements

`docs/features.md`'s "Planned Features" § Persistence Enhancements ("Improve state persistence across sessions... event.json must remain source of truth") is too vague to map to a durable capability as currently documented — no specific mechanism, scope, or acceptance criteria exists in any doc read during this audit. Recorded here rather than invented as a new AI-FEAT.

## Related Files

- `main/eventJsonStore.js` (the only sanctioned read-modify-write path)
