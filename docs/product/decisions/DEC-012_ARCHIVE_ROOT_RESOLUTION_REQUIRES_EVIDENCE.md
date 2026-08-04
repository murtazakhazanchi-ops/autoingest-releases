# DEC-012 — Archive Root Resolution Requires Evidence

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-042, AI-FEAT-039 |
| Status | Accepted |
| Date | 2026-06-16 (`a073485`, event-restore resolver); reinforced 2026-07-22 (Transfer Import `_resolveEventDestination` hardening) |
| Evidence status | Verified from Git history (commits `a073485`, `c49dddf`) and code (`.autoingest/root/archive-root.json` marker, referenced at 6+ call sites in `main/main.js` and 3 service files); `.claude/learning-log.md` 2026-07-22 entry |

## Context

Multiple resolution problems in this codebase share a shape: given an incomplete or ambiguous hint about where an archive item lives (a stored path, a checkpoint's recorded root, a reachable folder), decide whether to trust it. Mere reachability of a path or a name match is cheap to check but is not the same as confirming the resolved location actually holds current archive truth for the specific item in question — see [BUG-003](../bugs/BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md), where treating reachability as sufficient caused a stale local-staging copy to win over a current, online archive root.

## Options Considered

1. **Reachability/path-match alone is sufficient evidence to trust a resolved location** — the pre-existing behavior in `restoreLastEvent`'s flat-path check. Rejected: directly evidenced as producing a stale-restore bug (BUG-003).
2. **Require item-specific evidence (e.g. `event.json` presence, not just folder reachability) before trusting a resolved location, applied equivalently across every resolution branch** — the option that was built.

## Decision

Archive root and archive-item resolution requires positive, item-specific evidence, not mere reachability. Two concrete, current mechanisms embody this: (1) a persistent marker file (`.autoingest/root/archive-root.json`) establishes root identity itself, confirmed at 6+ call sites across `main/main.js` and archive-operations service files; (2) `settings:resolveArchiveEventPath` requires `event.json` presence at a candidate path before trusting it as the current record for a specific event, rather than accepting a merely-reachable folder or collection match. This principle was independently reinforced during Transfer Import's `_resolveEventDestination` hardening (2026-07-22): a post-implementation review caught that one resolver branch ("checkpoint unreachable") had been hardened to require an archive-identity match, while a sibling branch ("checkpoint reachable") still accepted a Collection match unconditionally — the fix required the *identical* evidence standard in both branches. The reusable principle, quoted directly from that review: "Destination recovery must require equivalent evidence across every resolver branch... never synthesize/guess a destination; when no branch confirms, mark the item unresolved."

## Consequences

- Any new or modified archive-location resolver (for events, collections, roots, or transfer destinations) must apply the same evidence standard to every branch — a resolver that hardens one path while leaving a sibling path trusting a weaker signal reintroduces this exact class of bug, and is easy to miss because each branch looks locally reasonable in isolation.
- "Mark unresolved and exclude from the operation" must remain an acceptable, correct outcome when no branch can confirm — a resolver must never be pressured into synthesizing or guessing a destination to avoid that outcome.
- This is the same principle underlying [BUG-002](../bugs/BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md)'s fix (ambiguous photographer-folder matches are never guessed) — future resolver code in this codebase should be reviewed against this decision as a checklist item, not treated as a one-off fix per subsystem.

## Reconciliation Note

None recorded — this decision was arrived at through incident correction (the pre-fix behavior is only visible as "what the code used to do before the fix," not as an explicitly documented prior decision) rather than being a decision made in advance. Recording it here is intended specifically to prevent it from being silently re-regressed in a future resolver.
