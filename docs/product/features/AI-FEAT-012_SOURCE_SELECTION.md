# AI-FEAT-012 — Source Selection (Local Folder / External Drive)

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-012 |
| Category | Source Acquisition |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-011 (consumes detected drives) |
| Related roadmap milestone | None |
| Related technical docs | `docs/failure-patterns.md` #16, `docs/system-contracts.md` §4 |
| Evidence status | Verified from current code (`autoingest-architect` review pass merged what was originally two proposed entries) |
| First-known implementation | Evidence pending |
| Latest major update | v0.8.7 (source card double-selection fix) |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-024](AI-FEAT-024_SOURCE_CLEANUP.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | None recorded |
| Related bugs | [BUG-001](../bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md) *(found via reverse lookup — not yet cross-linked in the Known Bugs section above)* |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Evidence pending — this feature's related files are shared, multi-feature modules (e.g. `main/main.js`, `renderer/renderer.js`); automated basename matching against test/ is unreliable for these and was not attempted |
| Documentation completeness | Mostly complete — 2 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Activating a source for import, whether a local folder, external drive, or memory card. Originally proposed as two separate registry entries ("Local Folder Source Selection" and "External Drive Source Selection"); merged into one after `autoingest-architect` review found `selectLocalFolder()` is a thin wrapper calling the same `_setActiveSource()` used by `selectSource()`, writing into the same `activeSource` state with only the `type` discriminator changing — no independent backend or state shape exists for local folders specifically.

## Current Behavior

`renderer/renderer.js:5690` `renderExtDrives()` renders polled drive cards; `renderer/renderer.js:5761` `selectSource({type, path, label, driveObj})` is the shared source-activation entry point used by local folder, external drive, and memory card paths alike. `renderer/renderer.js:3028` `selectLocalFolder()` opens a folder picker and delegates into the same activation path. The module-level `activeSource` variable (assigned at `renderer/renderer.js:1243`/`1267`) holds the active selection regardless of source type and is the variable at the center of the "Path Outside Source Root" race documented in `docs/failure-patterns.md` #16 and guarded against per `docs/system-contracts.md` §4's Cleanup Root Capture Rule.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **v0.8.7** — source card double-selection fix: clicking between source types previously left the old type's checkmark visible until the next polling cycle; each click handler now immediately clears the other list's checkmarks; `_pendingSourcePath` added so polling renders stay consistent during the async scan window in `selectSource()` (`docs/history.md`).
- **v0.8.8** — Source Cleanup root-capture race fixed (see `docs/failure-patterns.md` #16 and AI-FEAT-024) — root cause was `activeSource` being nulled by drive-polling disconnect detection during an in-flight import await.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: [BUG-001](../bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: 2 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #16 — the "Path Outside Source Root" bug is rooted in this feature's `activeSource` state management, even though its symptom surfaces in Source Cleanup (AI-FEAT-024).

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/renderer.js` (`selectSource`, `selectLocalFolder`, `renderExtDrives`, `activeSource`)
