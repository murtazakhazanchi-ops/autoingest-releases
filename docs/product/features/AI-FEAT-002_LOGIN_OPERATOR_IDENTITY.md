# AI-FEAT-002 — Login & Operator Identity

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-002 |
| Category | Application Platform |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-005 (Application Settings & Configuration Store — profiles persisted in settings) |
| Related roadmap milestone | None |
| Related technical docs | `docs/history.md` v0.8.1 |
| Evidence status | Verified from current code and `docs/history.md` |
| First-known implementation | v0.8.1 |
| Latest major update | v0.8.1 |

## Summary

Operator identity for AutoIngest: a dedicated splash screen for login/profile selection, an operator profile store, and attribution of imports to the operator who triggered them. Distinct from Photographer-Folder Resolution (AI-FEAT-022, archive folder naming) and Import Source Attribution (AI-FEAT-028, which memory card/drive/folder supplied the files) — three separate identity concepts that must not be collapsed into one (per `autoingest-architect` review).

## Current Behavior

Dedicated frameless `BrowserWindow` (980×480, `renderer/splash.html` + `renderer/splash.js`) with three states: "Welcome back" (returning operator), operator picker, create-profile form. `main/userManager.js` is the operator profile store (list, create, get/set active user; persisted via `services/settings.js`). `splash:complete` IPC fades the splash out and the main window in (200ms CSS transition). In-app operator dropdown and add-user modal replace what was previously a `#loginSplash` overlay. Renderer holds `_activeUser: {id, name, role, initials}`. Each `imports[]` entry in `event.json` optionally carries `importedBy: {id, name}` — backward-compatible; older entries display "Imported by: Not recorded" in the Activity Log (AI-FEAT-027).

## Original Plan / Intent

Evidence pending beyond what `docs/history.md`'s v0.8.1 entry documents (introduced together with Media Preview and Import Source Attribution in the same release).

## Evolution / Implementation Journal

- **v0.8.1** — introduced: splash screen states, `userManager.js`, in-app operator dropdown replacing the old `#loginSplash` overlay, `importedBy` attribution added to `imports[]` (backward-compatible). (`docs/history.md`)

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

`docs/features.md`'s "Planned Features" § Multi-User Handling ("Support concurrent users or roles... Must prevent conflicting writes... Must maintain deterministic behavior") remains genuinely unimplemented — `services/settings.js`'s `getLastActiveUserId()` returns a single value, confirming operator identity today is single-active-user, not concurrent or role-based. No AI-RM milestone currently targets this.

## Related Files

- `renderer/splash.html`, `renderer/splash.js`
- `main/userManager.js`
- `services/settings.js` (`getLastActiveUserId`/`setLastActiveUserId`)
