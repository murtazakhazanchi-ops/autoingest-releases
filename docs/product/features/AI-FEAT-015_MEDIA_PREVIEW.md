# AI-FEAT-015 — Media Preview

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-015 |
| Category | Media Browsing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-016 (preview focus is the trigger mechanism) |
| Related roadmap milestone | None |
| Related technical docs | `docs/features.md` #12 |
| Evidence status | Verified from `docs/features.md` and `docs/history.md` |
| First-known implementation | v0.8.1 |
| Latest major update | v0.8.1 |

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
| Documentation completeness | Complete — no unresolved "Evidence pending" markers in this file |

## Summary

Space-bar opens a full-screen preview overlay for the focused file: full-resolution image via `file://` URL for JPEG/PNG, high-quality extracted preview for RAW, and a native `<video>` player for MP4/MOV.

## Current Behavior

RAW preview extraction: macOS uses `qlmanage` (QuickLook) at 1200px → PNG; Windows uses PowerShell + `System.Drawing` at 1200px → PNG (requires OS RAW codec support, with a thumbnail fallback when extraction fails or codecs are absent — see `docs/failure-patterns.md` #13). Persistent disk cache at `userData/raw-preview-cache/`, 30-day TTL, keyed by path+size+mtime. Caption text distinguishes "extracted preview" / "thumbnail preview" / "thumbnail preview (RAW codec not available)" on Windows. Arrow keys navigate between files in current rendered order; Esc/Space closes. Object URLs are revoked on close; video `src` is cleared to release memory.

## Original Plan / Intent

Introduced in v0.8.1 alongside Operator Identity and video thumbnails (`docs/history.md`).

## Evolution / Implementation Journal

- **v0.8.1** — `main/rawPreviewService.js` introduced; `files:getPreviewUrl` and `preview:getRawPreview` IPC handlers.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: v0.8.1 (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evolution / Implementation Journal above has exactly one entry (already reflected as Initial implementation, or see that section directly if it describes a later change).

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #13 — Windows RAW codec absence causes thumbnail-only preview; fix is installing OS-level RAW codec support, not an application change.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/rawPreviewService.js`
