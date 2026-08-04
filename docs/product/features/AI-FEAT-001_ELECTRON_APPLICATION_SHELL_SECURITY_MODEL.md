# AI-FEAT-001 — Electron Application Shell & Security Model

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-001 |
| Category | Application Platform |
| Status | Implemented |
| Maturity | Foundational |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | None |
| Related roadmap milestone | None |
| Related technical docs | `CLAUDE.md` § Security Model, `docs/README.md` § Security Model |
| Evidence status | Verified from current code |
| First-known implementation | Evidence pending (predates all documents read in this audit) |
| Latest major update | Evidence pending |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-003](AI-FEAT-003_DASHBOARD_SYSTEM_STATUS.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | [§3B — B. Initial AutoIngest Foundation](../11_ARCHITECTURAL_EVOLUTION.md#b-initial-autoingest-foundation) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

The Electron main-process shell that hosts AutoIngest's two `BrowserWindow` instances (main window, splash window) under a locked-down security model: no Node integration in the renderer, full context isolation, OS-level sandboxing, and a restrictive CSP. This is the platform every other feature runs inside.

## Current Behavior

Both `BrowserWindow` configurations in `main/main.js` (lines 196-198 for one, 218-220 for the other) set `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — matching `CLAUDE.md`'s documented security model exactly, no drift found. `contextBridge` is the only renderer↔main bridge (`main/preload.js`). CSP is `default-src 'self'`. No `<script>` tags execute inline (enforced by CSP; see AI-FEAT-003's theme-init.js extraction, which was a compliance fix for this exact rule).

## Original Plan / Intent

Evidence pending — not yet documented as fact. The security model appears to have been the baseline from the project's earliest Electron scaffold (see `docs/README.md`, which describes it as the starting "Electron Base App" template).

## Evolution / Implementation Journal

- Theme-detection inline `<script>` moved to `renderer/theme-init.js` (`docs/history.md` v0.8.6) specifically to satisfy `script-src 'self'` — a CSP-compliance fix to this feature's contract, not a new capability.
- `renderer` code accessing `process.platform`/`process.env` directly was a known failure mode under this sandbox model (`docs/failure-patterns.md` #15) — fixed by exposing platform via `contextBridge` and consuming `window.api.platform` instead. This is a durable constraint of this feature, not a one-off bug.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending (predates all documents read in this audit) (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: 2 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

None recorded in `docs/product/bugs/` yet. See `docs/failure-patterns.md` #15 for the `process is not defined` failure mode, which is a direct consequence of this feature's sandbox model.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/main.js` (BrowserWindow creation, CSP)
- `main/preload.js` (contextBridge surface)
- `renderer/theme-init.js`
