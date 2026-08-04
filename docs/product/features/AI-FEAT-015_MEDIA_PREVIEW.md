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

## Summary

Space-bar opens a full-screen preview overlay for the focused file: full-resolution image via `file://` URL for JPEG/PNG, high-quality extracted preview for RAW, and a native `<video>` player for MP4/MOV.

## Current Behavior

RAW preview extraction: macOS uses `qlmanage` (QuickLook) at 1200px → PNG; Windows uses PowerShell + `System.Drawing` at 1200px → PNG (requires OS RAW codec support, with a thumbnail fallback when extraction fails or codecs are absent — see `docs/failure-patterns.md` #13). Persistent disk cache at `userData/raw-preview-cache/`, 30-day TTL, keyed by path+size+mtime. Caption text distinguishes "extracted preview" / "thumbnail preview" / "thumbnail preview (RAW codec not available)" on Windows. Arrow keys navigate between files in current rendered order; Esc/Space closes. Object URLs are revoked on close; video `src` is cleared to release memory.

## Original Plan / Intent

Introduced in v0.8.1 alongside Operator Identity and video thumbnails (`docs/history.md`).

## Evolution / Implementation Journal

- **v0.8.1** — `main/rawPreviewService.js` introduced; `files:getPreviewUrl` and `preview:getRawPreview` IPC handlers.

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #13 — Windows RAW codec absence causes thumbnail-only preview; fix is installing OS-level RAW codec support, not an application change.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/rawPreviewService.js`
