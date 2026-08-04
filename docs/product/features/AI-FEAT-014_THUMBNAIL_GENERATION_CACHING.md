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

## Summary

Two separate thumbnail pipelines: images (with an on-disk cache) and video (cached frame extraction with a play-badge overlay).

## Current Behavior

Image pipeline: `services/thumbnailCache.js`, `services/thumbnailer.js`, `services/thumbWorker.js`. Video pipeline: `main/videoThumbService.js` generates cached video frame thumbnails; `thumbnail:getVideoThumb` IPC + preload exposure; video file tiles show a lazy-loaded frame thumbnail with a play-badge overlay.

## Original Plan / Intent

Video thumbnails introduced in v0.8.1 alongside Media Preview and Operator Identity (`docs/history.md`).

## Evolution / Implementation Journal

- **v0.8.1** — `main/videoThumbService.js` introduced: cached video frame thumbnails, `thumbnail:getVideoThumb` IPC, lazy-loaded tile thumbnails with play-badge overlay.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `services/thumbnailCache.js`, `services/thumbnailer.js`, `services/thumbWorker.js`
- `main/videoThumbService.js`
