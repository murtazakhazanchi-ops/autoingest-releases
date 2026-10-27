# DEC-027 — Quick Ingest Prioritized; Main-Window UI Frozen; Companion as an Isolated Layer

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-061, AI-FEAT-062 / AI-RM-014, AI-RM-015 |
| Status | Accepted (direction); the Q1+ implementation plan in AI-FEAT-061 is still awaiting owner approval |
| Date | 2026-10-27 |
| Evidence status | Owner direction given in the 2026-10-27 planning session. Code facts verified from `origin/stable/0.9` @ `0eb9c43`. |

## Context

The project owner approved two new capability areas: Backup Intelligence and Quick Ingest. They made Quick Ingest & Desktop Experience the next active milestone, ahead of the previously-next AI-RM-002 (Archive Maintenance). Operators should be able to see card status and start an import without first navigating the full workspace. The existing main window is production-validated operator UI across v0.9.13–v0.9.16 Stable, and the owner does not want it destabilized during this milestone.

## Options Considered

1. **Add card-status widgets and a quick-import button to the existing main window.** Lowest new surface area. Rejected: it changes frozen, production-validated operator UI, and it does nothing when the main window is closed.
2. **Separate companion application/process** (its own Electron app or helper binary). Rejected for now: it would duplicate drive polling, settings, import-index and archive-root logic, or need a new IPC transport between two apps. It adds packaging and signing burden (macOS signing is already ad-hoc only).
3. **In-process menu-bar/tray companion** that reuses the existing main-process services through new, isolated modules, a dedicated preload, and its own popover window. **Chosen.**
4. **Defer Quick Ingest until Backup Intelligence exists**, so the companion could show verified status from the start. Rejected: it delays operator value. The companion can label existing evidence honestly (indicative vs verified) and gain confidence later through capability flags.

## Decision

- Roadmap priority order (see [02_MASTER_ROADMAP.md](../02_MASTER_ROADMAP.md) § Priority Order): AI-RM-001 (complete) → AI-RM-013 (Stable promoted) → **AI-RM-014 Quick Ingest & Desktop Experience (next active)** → Ask AutoIngest (existing branch work, uninterrupted) → AI-RM-015 Backup Intelligence Foundation → AI-RM-002 Archive Maintenance & Archive Node → AI-RM-003 Event Maintenance → AI-RM-004 Archive Browser.
- **Main-window UI freeze** for the duration of AI-RM-014. Any main-window change needs a separate proposal and explicit approval.
- The first delivery is Option 3: a presentation/control layer around existing services. It has no second copy engine and no parallel metadata pipeline. Quick Ingest starts as a handoff into the existing workspace.
- The status vocabulary separates detected / previously imported / copy recorded / verification pending / checksum verified / archive unavailable / unknown. "Verified" is never derived from name, size or history.

## Consequences

- Commits the project to a stable, versioned companion contract (AI-FEAT-061 § Stable companion contract) that AI-FEAT-062 later enriches without a UI rewrite.
- Requires a behavior-preserving main-process refactor first (main-window targeting, app-lifetime poller ownership) — see AI-FEAT-061 Risks R1/R2.
- Rules out, for this milestone, any operator-visible change to the main window, including companion-related banners or badges there.
- AI-RM-002/003/004 move later. Their scope is preserved and expanded with owner-stated items. Nothing is removed.
- AI-RM-005…009 keep their records unchanged and sit outside the priority list until the owner re-sequences them. Overlaps (AI-RM-006 vs AI-RM-015; AI-RM-007 vs AI-RM-002) are recorded as pending decisions, not silently merged.

## Addendum — 2026-10-27 (owner Q1 approval)

- **Workstream placement** (no renumbering, no deletion, nothing marked superseded): AI-RM-006 goes under AI-RM-015; AI-RM-007 and AI-RM-008 go under AI-RM-002; AI-RM-005 and AI-RM-009 (long-horizon) go under AI-RM-004. See 02_MASTER_ROADMAP.md § Workstreams. This resolves the overlaps that the Consequences section above listed as pending.
- **Q1 approved** for AI-RM-014: behavior-preserving main-window progress targeting, app-scope single drive poller, single-instance lock (second launch must focus/restore the main window and preserve launch arguments), and — architecturally only — the Q4 invisible handoff listener (not to be implemented in Q1). No launch-at-login. Main-window UI freeze reaffirmed.

## Reconciliation Note

None — no conflict with a technical doc under `docs/`.
