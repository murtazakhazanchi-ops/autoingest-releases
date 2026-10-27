# AI-FEAT-062 — Backup Intelligence Foundation

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-062 |
| Category | Reliability and Recovery |
| Status | Planned |
| Maturity | Planned |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-019 (Import Pipeline & Copy Engine), AI-FEAT-020 (Duplicate Detection), AI-FEAT-025 (Checksum-Based File Verification — existing narrower prior art), AI-FEAT-042 (Archive Root Configuration & Resolution) |
| Related roadmap milestone | AI-RM-015 |
| Related technical docs | None — no implementation exists yet |
| Evidence status | Confirmed zero implementation (2026-10-27 audit of `origin/stable/0.9` @ `0eb9c43`). Today's related mechanisms are narrower. The global import index (`main/main.js` `importIndex`) is keyed by lowercase filename + size, capped at 5000 entries and local to one computer. SHA-256 at copy time is disabled (`main/fileManager.js` `ENABLE_CHECKSUM = false`; size check only). A user-triggered `checksum:run` hashes only the current session's `lastImportedFiles`. |
| First-known implementation | Not started |
| Latest major update | 2026-10-27 — scope recorded from owner direction |

## Lifecycle Metadata

| Field | Value |
|---|---|
| Related features | AI-FEAT-061 (Quick Ingest & Desktop Companion — consumes this feature's evidence through capability flags, and must work without it); AI-FEAT-054 (Integrity Verification — Archive-Wide — overlapping scope, see Decisions) |
| Related decisions | [DEC-027](../decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md) |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | None yet |
| Related release notes | Not applicable — not released |
| Testing coverage | Not applicable — feature not yet implemented |
| Documentation completeness | Scope only; design pending |

## Summary

Planned foundation for knowing, with evidence rather than inference, **which content** was imported, **where every copy lives**, and **whether each copy was verified**. It is the prerequisite for honest "Checksum verified" and per-card history in the Quick Ingest companion (AI-FEAT-061), and for later Archive Maintenance and Archive Browser work.

## Current Behavior

Not implemented. See Evidence status above for the narrower existing mechanisms this would supersede or extend.

## Original Plan / Intent

Owner-stated scope (2026-10-27):

- Unified SHA-256 content identity.
- Source-content and final-archive identity.
- Card/source session identity.
- Archive-instance tracking across NAS roots (Surat and Marol are both valid Main Archive Roots — see `docs/archive-operations-layer.md`).
- Durable verification evidence.
- Verification receipts.
- Per-card import history.
- Safe cross-device reconciliation.

Design, storage location, migration from the name+size import index, and acceptance criteria are evidence pending and not yet documented as fact.

## Evolution / Implementation Journal

- **2026-10-27** — Registered as AI-FEAT-062 / AI-RM-015, sequenced after AI-RM-014 per [DEC-027](../decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md). No code.

## Engineering Evolution

**Initial implementation**: Not applicable — feature not yet implemented.

**Architectural / workflow decisions**: [DEC-027](../decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md).

**Reliability / correctness fixes**: None recorded.

**Other dated milestones**: 2026-10-27 — scope registered.

## Known Bugs / Troubleshooting

Not applicable.

## Decisions

- **Resolved 2026-10-27:** the owner placed the remaining AI-RM-006 / AI-FEAT-054 scope under this foundation (DEC-027 Addendum). Both records are retained. *Original open question, kept for history:* how this relates to AI-RM-006 / AI-FEAT-054 (Integrity Verification — Archive-Wide). The owner can choose to fold AI-FEAT-054 into this foundation, keep it as a consumer of it, or keep the two separate. Neither record is superseded until that decision is made.

## Future Enhancements

Not recorded beyond the scope above.

## Related Files

None — no implementation exists.
