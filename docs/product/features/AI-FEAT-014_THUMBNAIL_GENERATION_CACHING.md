# AI-FEAT-014 — Thumbnail Generation & Caching

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-014 |
| Category | Media Browsing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | None |
| Related roadmap milestone | None |
| Related technical docs | None dedicated |
| Evidence status | Verified from current code and `docs/history.md` |
| First-known implementation | v0.8.1 (video thumbnails) |
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

Two separate thumbnail pipelines: images (with an on-disk cache) and video (cached frame extraction with a play-badge overlay).

**Why this exists** (*Known from project history; repository evidence pending* — captured during the Product-Owner Purpose Capture interview, 2026-08-14): lets operators visually inspect selections inside AutoIngest itself, without relying on OS-level thumbnail rendering. This was a proactive design choice, not a response to Finder/Explorer being incapable of thumbnails — it exists to provide a self-contained, precise, convenient in-app browsing experience. Caching specifically exists so already-generated thumbnails don't have to regenerate every time an operator scrolls or revisits media, which would be slow at scale on large import sources.

## Current Behavior

Image pipeline: `services/thumbnailCache.js`, `services/thumbnailer.js`, `services/thumbWorker.js`. Video pipeline: `main/videoThumbService.js` generates cached video frame thumbnails; `thumbnail:getVideoThumb` IPC + preload exposure; video file tiles show a lazy-loaded frame thumbnail with a play-badge overlay.

## Original Plan / Intent

Video thumbnails introduced in v0.8.1 alongside Media Preview and Operator Identity (`docs/history.md`).

## Evolution / Implementation Journal

- **v0.8.1** — `main/videoThumbService.js` introduced: cached video frame thumbnails, `thumbnail:getVideoThumb` IPC, lazy-loaded tile thumbnails with play-badge overlay.
- **2026-08-14** — Purpose/history captured — Product-Owner Purpose Capture interview. Product-owner rationale for why in-app thumbnailing (and caching specifically) exists was recorded in Summary above. No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: v0.8.1 (video thumbnails) (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evolution / Implementation Journal above has exactly one entry (already reflected as Initial implementation, or see that section directly if it describes a later change).

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `services/thumbnailCache.js`, `services/thumbnailer.js`, `services/thumbWorker.js`
- `main/videoThumbService.js`
