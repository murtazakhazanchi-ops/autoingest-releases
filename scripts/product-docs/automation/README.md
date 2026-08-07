# scripts/product-docs/automation/ — Part 5 Documentation Orchestration

Extends Part 4's `scripts/product-docs/` tooling into an event-driven orchestration layer so `docs/product/` updates itself alongside normal engineering work — see [docs/product/README.md](../../../docs/product/README.md) § Automation (Part 5) for the authority-model summary and [docs/product/CLAUDE.md](../../../docs/product/CLAUDE.md) § 18 for what this obligates an AI agent to do before declaring work complete.

## The core idea: Engineering Evidence Packets

Every meaningful engineering task gets a structured **Engineering Evidence Packet** (`evidencePacket.js`, schema at [`../schemas/evidence-packet.schema.json`](../schemas/evidence-packet.schema.json)) — the bridge between an AI session's implementation activity and this documentation system. It distinguishes three kinds of information, per the governing safety model:

1. **Deterministic facts** (git branch/commits/changed files) — collected automatically, never disputed.
2. **AI-observed engineering context** (bugs found, alternatives considered, the accepted solution, root cause, tests run) — supplied explicitly by the caller via `automation update`; never inferred from a diff alone.
3. **Unknown/ambiguous information** — recorded as `evidence_pending`; never guessed into a confident-sounding fact.

A packet is append-only-journaled (`*.journal.jsonl`, written before every atomic snapshot rewrite) so a crash never silently loses engineering history, and it lives under the repository-local, gitignored `.autoingest-docs/` — never canonical, never committed.

## Module map

| Module | Responsibility |
|---|---|
| `paths.js` | `.autoingest-docs/` layout constants |
| `atomicWrite.js` | Repo-root-constrained atomic file writes and append-only journal lines |
| `redact.js` | Best-effort secret/token redaction before anything is written to disk |
| `evidencePacket.js` | Packet schema, creation, validation, journal-then-snapshot persistence |
| `eventCollector.js` | Deterministic git facts only (branch, commits, changed files) |
| `featureResolver.js` | Wraps Part 4's `lib/impact.js`/`lib/changeReport.js` — no new ownership logic |
| `changeClassifier.js` | Deterministic-first classification with an explicit confidence level |
| `documentationPlanner.js` | Evidence-gated "when to create a record" rules — the single source of truth for what's justified |
| `canonicalUpdater.js` | Executes only justified plan items; section-aware, idempotent, atomic Markdown edits |
| `recordAllocator.js` | Race-resistant `BUG-###`/`DEC-###`/`PM-###` ID allocation (lock files, no library) |
| `lifecycleUpdater.js` | Rebuilds `generated/` and gates roadmap/dashboard transitions (see below) |
| `releaseIntelligence.js` | Release-note **drafts** only — never publishes |
| `validationGate.js` | Mode-aware pass/fail decision for `automation finalize` |
| `recovery.js` | Stale-base-commit and stale-lock detection |
| `auditLog.js` | Append-only, secret-redacted run log |
| `orchestrator.js` | Wires the above into `start`/`update`/`finalize`/`status`/`recover`/`dry-run`/`reconcile` — also invokes Part 7B's `decisionIntelligence.scanPacket` as a best-effort step during `finalize()`, same non-blocking contract as Part 6's memory compilation |
| `markdownSections.js` | Two primitives: append-within-a-section, insert-after-changelog's-first-rule — both idempotent |
| `cli.js` | Thin dispatcher for `automation <sub>`, mirroring the parent `cli.js` convention |
| `hookAutomation.js` (Part 7A) | JS logic behind the version-controlled git hooks — `preCommitGate`/`prePushGate`/`postCommitLink`, kept out of the shell scripts so it's unit-testable |
| `decisionIntelligence.js` (Part 7B) | Structural-signal detection + evidence-gated `Status: Draft` decision drafting or local candidate creation |
| `ownershipEngine.js` (Part 7C) | Deterministic, weighted, multi-signal ownership scoring for paths Part 4's explicit/inferred resolution can't answer |
| `releaseIntelligence.js` (Part 5, extended Part 7D) | Release-note **drafts** only — now with auto prior-tag discovery and evidence-gated breaking-change/migration/known-issues/roadmap-impact/risk sections |
| `contextEngine.js` / `contextCli.js` (Part 7E) | Bounded, authority-ordered context bundles for `context <sub>` — reuses `lib/query.js`, `lib/impact.js`, `ownershipEngine.js` |

## Autonomy modes

- **STRICT** — blocks `finalize` on any unjustified/unmet documentation requirement. Set with `--mode strict` on `automation start`.
- **STANDARD** (default) — updates docs for justified actions, blocks only on a hard `validate` error or a malformed packet.
- **OBSERVE** — produces the full classification/plan/gate report; `canonicalUpdater`/`lifecycleUpdater` are never invoked (gated structurally in `orchestrator.runFinalizeSequence`, not by convention).

## Roadmap/dashboard transitions are deliberately non-automatic

`documentationPlanner.planRoadmapTransition` always returns `justified: false`; `lifecycleUpdater.applyRoadmapTransition` records an explicit confirmation but never writes `02_MASTER_ROADMAP.md`/`04_PROJECT_DASHBOARD.md` narrative prose itself. A commit touching a roadmap-mapped feature is not evidence a milestone completed — see `docs/product/05_DOCUMENTATION_WORKFLOW.md`'s Definition of "documentation complete."

## Commands

See `node scripts/product-docs/cli.js automation --help`, or [scripts/product-docs/README.md](../README.md) § Part 5 — Automation.

## Security

- Every write is constrained to the repository root (`atomicWrite.js`'s `assertInsideRepo`) — no path traversal.
- All git shell-outs reuse Part 4's `lib/gitInfo.js` (`execFileSync` with argument arrays, ref-safety guards) — never shell-string interpolation.
- No network calls, no external AI API, no `eval`/dynamic code execution of documentation or commit content.
- Obvious secrets/tokens are redacted before any write to `.autoingest-docs/` (`redact.js`).
- Never auto-pushes, never auto-publishes a release, never auto-merges a PR, never rewrites Git history.

## Testing

`test/automation/*.test.js` — unit tests run in-process; integration tests (`orchestrator.integration.test.js`, `installHooks.test.js`) run against a fully disposable git fixture repository built by `test/automation/tmpRepoHarness.js`, which copies this whole tooling tree plus a small clean `docs/product/` fixture into a fresh temp directory with its own `.git`. Never mutates the real `docs/product/` tree — see each test file's own header comment.
