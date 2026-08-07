# scripts/product-docs/ — Documentation Intelligence Tooling

Part 4 of AutoIngest's `docs/product/` system: a repository-local, offline, dependency-free tool that turns the canonical Markdown under `docs/product/` into a queryable index for humans and AI agents. It is developer tooling only — it never runs as part of the AutoIngest Electron application and ships no runtime dependency.

## Authority model (read this first)

Three tiers, in order:

1. **Technical docs under `docs/`** — authoritative for runtime behavior, contracts, and architecture. Always wins.
2. **Canonical Markdown under `docs/product/`** (`00`–`14`, `features/`, `bugs/`, `decisions/`, `postmortems/`) — authoritative for product planning, feature history, and roadmap progress. Never contradicts tier 1; if it does, tier 1 wins and the reconciliation is recorded per `docs/product/05_DOCUMENTATION_WORKFLOW.md` § Authority Boundary.
3. **`docs/product/generated/`** (this tool's output) — a locator/index layer only. It is regenerated from tier 2, never hand-edited, and never treated as a source of new facts. If generation detects tier-2 sources disagreeing with each other (e.g. the roadmap and the dashboard disagreeing about a milestone's completion status), it **fails with a diagnostic** rather than silently picking a side — see `lib/roadmapDashboard.js`'s `DashboardDisagreementError`.

`docs/product/12_DEPENDENCY_MODEL.md` remains the curated, hand-authored ID-relationship narrative; `generated/dependency-graph.*` is a separate, mechanically-derived subsystem/code-level view built from feature files' `Related Files` sections and the subsystem locator. They are not duplicates and neither supersedes the other.

**Freshness is enforced, not assumed.** `docs/product/generated/` is committed to git (unlike `docs/product/exports/`, which is gitignored) because a rebuild-free browse of the generated indexes is worth more than the discipline cost — but `validate` rebuilds everything in memory and diffs it byte-for-byte against what's on disk; any difference is an `error`-level `stale-generated-output` finding that fails the build. Never trust a `docs/product/generated/` file without having just run `validate`.

## Why this location

`scripts/` is the repository's only existing convention for standalone developer tooling (`scripts/validate-event-metadata.js`, `scripts/parse-lists.js` — both plain Node CommonJS, no build step). `docs/product/generated/` was considered and rejected as the tooling's own home (it's the *output* location, not the source location) — see the three suggested locations in the original Part 4 brief; this repository already had a working answer.

## Language and dependencies

Plain Node.js (CommonJS, `'use strict'`, no build step, no bundler) — matches 100% of existing repository tooling. **No npm dependencies were added.** `package.json` was intentionally left untouched; there is no `npm run product-docs` script. Invoke the CLI directly:

```bash
node scripts/product-docs/cli.js <command> [args]
```

JSON-shape validation for generated artifacts is a small hand-rolled check (see `lib/validators.js` and the `schemas/*.schema.json` files), not `ajv` or any other package — per the brief's "implement a focused standard-library validator... rather than adding a package casually."

## Commands

| Command | Purpose |
|---|---|
| `build` | Regenerate every file under `docs/product/generated/` |
| `validate` | Run the documentation health checks; writes `documentation-health.md`/`.json`; exits 1 on any `error`-level finding |
| `query <text>` | Offline search over the index. Also: `--feature ID`, `--bug ID`, `--decision ID`, `--roadmap ID`, `--subsystem NAME`, `--file PATH`, `--impact PATH` |
| `impact <input>` | Advisory impact analysis for a feature ID, roadmap ID, subsystem name/alias, or source path |
| `changes <fromRef> [toRef=HEAD]` | "What changed?" report between two git refs, written to `generated/change-reports/` |
| `all` | `build` then `validate` |
| `automation <sub>` | Part 5/7 engineering-documentation orchestration — see § Part 5 |
| `memory <sub>` | Part 6 engineering memory layer — see § Part 6 |
| `release <sub>` | Part 7D release intelligence (drafts only) — see § Part 7 |
| `context <sub>` | Part 7E universal repository context assistant — see § Part 7 |
| `conversation <sub>` | Part 8 multi-AI engineering conversation integration — see § Part 8 |

Every command supports `--help`, exits non-zero on invalid use or on validation failure, and never performs a destructive filesystem operation outside `docs/product/generated/`.

## Query ranking (deterministic, documented)

Scores, highest wins, ties broken by `stable_id` ascending (numeric-aware):

| Match | Score |
|---|---|
| Exact `stable_id` match | 1000 |
| Exact alias match (case-insensitive) | 900 |
| Exact title match (case-insensitive) | 850 |
| Title substring match | 500 + up to 200 × (query length / title length) |
| Keyword token overlap | 100 × distinct matched keyword tokens |
| Summary substring match | 10 |

No embeddings, no external search service, no network access, no AI model calls — see `lib/query.js`.

## Ownership resolution (impact analysis, change reports, subsystem locator)

Source-path ownership is resolved **only** from evidence already authored in `docs/product/features/*.md`'s own `Related Files` section:

- **`explicit`** — the exact path is listed in some feature's `Related Files`.
- **`inferred`** — the path falls under a directory that is itself derived from the union of a subsystem's member features' `Related Files` directories (still evidence-grounded, just one level less specific — always labeled, never silently upgraded to `explicit`).
- **`unknown`** — neither of the above. Never guessed from filename or keyword similarity; an unmapped path stays `unknown` rather than being assigned a plausible-looking owner.

## Known parser limitations

- **Markdown table parsing is lenient, not strict.** `lib/markdown.js`'s `parseFirstTable`/`extractHeaderTable` silently skips any row with fewer than 2 cells rather than raising a parse error — a malformed header-table row (a missing `|`) reads as a missing field ("Evidence pending") rather than a caught failure. Acceptable given how consistently `docs/product/` is authored today; revisit if this ever produces a real silent gap (a `validate` finding that turns out to trace back to a malformed row, not a genuine documentation gap).
- **ID range expansion is capped at a 500-ID span.** `lib/ids.js`'s `extractIds` expands the "`AI-FEAT-049 – AI-FEAT-056`" / "`AI-RM-002 through AI-RM-009`" prose-range convention used throughout `docs/product/` (without this, only the two endpoints would be captured and every interior ID would silently disappear from generated indexes — this was a real bug caught by code review before the first commit). A malformed range citing an implausibly large span is silently ignored past the cap rather than raising an error; this has not been observed in practice.

## Directory layout

```
scripts/product-docs/
├── README.md               — this file
├── cli.js                  — command dispatcher (thin; all logic lives in lib/)
├── lib/                    — parsing, index-building, rendering, validation
├── schemas/                — JSON Schema references for generated artifacts (documentation, not enforced by a schema library)
└── test/                   — node:assert-based tests (see below)

docs/product/generated/     — output; see docs/product/generated/README.md
```

## Testing

`test/` lives under `scripts/product-docs/` rather than the repository's top-level `test/` directory. That top-level directory tests application runtime modules (`main/`, `services/`) and is a plausible target for whatever discovers/runs the app's test suite; this tooling's tests are for a standalone dev tool with synthetic fixture trees under `test/fixtures/` and have no relationship to the Electron app. Keeping them adjacent to the tool they test — and clearly out of the application test suite's path — was judged clearer than forcing one shared `test/` convention across two unrelated systems.

Run all tests (including `test/automation/` — the Part 5/6/7 automation/orchestration suite, previously and easy to forget since it's one directory deeper):

```bash
node --test scripts/product-docs/test/*.test.js scripts/product-docs/test/automation/*.test.js
```

Tests never mutate the real `docs/product/` tree. `test/fixtures/broken-product-docs/` is a small, intentionally-imperfect synthetic tree used only by `validators.test.js`; `integration.test.js` reads the real `docs/product/` tree read-only to assert whole-repository invariants (56 features present, deterministic rebuild, zero dangling graph edges, zero error-level health findings against the real content).

## Documentation-system version

`DOCSYS_VERSION` (see `lib/version.js` for the current value and its per-bump history) tracks the shape of this tooling's generated output — distinct from `package.json`'s application version and from the `AI-FEAT-###`/`AI-RM-###` ID systems. Bump it when a generated file's field shape changes in a way a consumer needs to know about; bump `GENERATOR_VERSION` for internal logic changes that don't change output shape. See `docs/product/README.md` for where this is cross-referenced.

## Non-goals

No network calls, no external AI API calls, no cloud dependency, no database, no web server, no UI inside the Electron app, no embeddings/semantic search, no scanning of real user archives, no auto-editing of canonical `docs/product/` Markdown from generated output or inference. Every one of `docs/product/generated/`'s files is disposable and reproducible — delete the whole directory and `build` recreates it byte-for-byte from the same source commit.

## Part 5 — Automation

`automation/` (see [automation/README.md](automation/README.md) for the module map) extends this tool with an orchestration layer that keeps `docs/product/` current alongside normal engineering work, without requiring manual Markdown edits, ID assignment, or index updates. It never treats `docs/product/generated/` as a source (same rule as everywhere else in this tool) and never invents a bug, decision, or postmortem record from a diff alone — see `automation/documentationPlanner.js`'s evidence-gated "when to create a record" rules.

```bash
node scripts/product-docs/cli.js automation start --type feature --title "Archive Maintenance"
node scripts/product-docs/cli.js automation update  # append discoveries as work happens
node scripts/product-docs/cli.js automation finalize
node scripts/product-docs/cli.js automation status
node scripts/product-docs/cli.js automation recover
node scripts/product-docs/cli.js automation dry-run HEAD~1 HEAD
node scripts/product-docs/cli.js automation reconcile
node scripts/product-docs/cli.js automation release-draft v0.9.9 HEAD
node scripts/product-docs/cli.js automation install-hooks   # not run automatically — see below
```

Three autonomy modes (STRICT/STANDARD/OBSERVE — default STANDARD) govern how much `finalize` blocks on; see `automation/README.md` for the exact gating rules. Version-controlled hooks live at `hooks/{pre-commit,post-commit,pre-push}` with an idempotent, hook-chaining installer (`hooks/install-hooks.js`) — **not installed into this repository's `.git/hooks/` by default**; installing them is a separate, explicit step (`automation install-hooks`), never invoked automatically by any other command. Automation run state lives under the repository-local, gitignored `.autoingest-docs/` — never canonical, never committed.

## Part 6 — Engineering Memory

`automation/memory/` (see [automation/memory/README.md](automation/memory/README.md) and [docs/product/16_ENGINEERING_MEMORY_POLICY.md](../../docs/product/16_ENGINEERING_MEMORY_POLICY.md)) extends Part 5 with a durable record of the engineering conversation and reasoning behind meaningful work — the original request, plan revisions, rejected alternatives, investigations, user feedback, and final outcome. Capsules (`docs/product/memory/AI-MEM-####_*.md`) are historical evidence, not a technical contract — they sit below every canonical record in the authority order. Reuses this tool's existing infrastructure rather than duplicating it: ID allocation via `automation/recordAllocator.js`, redaction via `automation/redact.js`, atomic writes via `automation/atomicWrite.js`, and the same `finding()`-shaped validator rules (`lib/memoryValidators.js`) wired into the existing `validate` command.

```bash
node scripts/product-docs/cli.js memory start --title "..."
node scripts/product-docs/cli.js memory event --type plan_revised --summary "..."
node scripts/product-docs/cli.js memory finalize
node scripts/product-docs/cli.js memory query --feature AI-FEAT-033
node scripts/product-docs/cli.js memory show AI-MEM-0001
```

A capsule is only created when the work meets an evidence-gated significance bar (`automation/memory/significance.js`) — most sessions produce none, matching the "not for every session" rule. `automation/orchestrator.js`'s own `finalize()` calls this automatically for every finalized Evidence Packet; a memory session can also stand alone with no linked packet.

## Part 7 — Autonomous Engineering Intelligence

Five milestones extending Parts 4-6 into a zero-touch layer (see [docs/product/README.md](../../docs/product/README.md) § Autonomous Engineering Intelligence (Part 7) for the authority-model summary and [docs/product/CLAUDE.md](../../docs/product/CLAUDE.md) § 20 for what this obligates an AI agent to do). Introduces no new evidence-discipline rule of its own — every new capability reuses Part 4/5's existing parsers, atomic writes, record allocator, and evidence-gated "when to create a record" predicates.

```bash
# 7A — zero-touch git integration (the JS behind hooks/{pre-commit,post-commit,pre-push})
node scripts/product-docs/cli.js automation pre-commit-gate     # normally run by the installed hook, not directly
node scripts/product-docs/cli.js automation pre-push-gate
node scripts/product-docs/cli.js automation post-commit-link
node scripts/product-docs/cli.js automation install-hooks --dry-run   # non-mutating readiness report

# 7B — architectural decision intelligence
node scripts/product-docs/cli.js automation decision-scan [sessionId]
node scripts/product-docs/cli.js automation decision-candidates       # local, non-canonical, review-required

# 7C — evidence-based feature ownership (multi-signal, weighted, deterministic)
node scripts/product-docs/cli.js automation ownership <path>

# 7D — autonomous release intelligence (drafts only, never publishes)
node scripts/product-docs/cli.js release prepare --to <ref> [--from <ref>|auto] [--dry-run] [--output-dir <dir>]
node scripts/product-docs/cli.js release status

# 7E — universal repository context assistant (tool-neutral, deterministic, no embeddings)
node scripts/product-docs/cli.js context feature AI-FEAT-###
node scripts/product-docs/cli.js context file <path>
node scripts/product-docs/cli.js context task "<natural-language task>" [--json]
node scripts/product-docs/cli.js context explain "<question>"
```

**Security**: identical non-goals to Parts 4-6 — no network calls, no external AI API, no `eval`, every git invocation uses `execFileSync` with argument arrays (never shell interpolation), every write is constrained inside the repository root (`automation/atomicWrite.js`'s existing `assertInsideRepo`), no automatic push/merge/release-publish, hooks are never installed into the real `.git/hooks/` except via the explicit, human-approved `automation install-hooks`.

**A pre-existing bug found and fixed during Part 7's own verification**: `lib/validators.js`'s `checkGeneratedFreshness` used to compare `manifest.json` byte-for-byte including its own `source_commit` field, which can never correctly self-reference the commit that first introduces a given rebuild (a commit's hash is a function of its own tree). This made a freshly-committed `manifest.json` perpetually fail `validate` on the very next clean checkout — verified directly against this repository's real history. Fixed by excluding only that one field from the strict comparison (see `10_CHANGELOG.md`'s Part 7 entry for the full account); every other field, and every other generated file, remains a full byte-for-byte comparison.

## Part 8 — Multi-AI Engineering Conversation Integration

Brings engineering discussions that happen **outside** an active local Claude Code session — ChatGPT, an external Claude conversation, Codex, Gemini, human meeting notes, imported Markdown/JSON, or any future tool — into the same evidence/memory/feature/decision/bug pipelines Parts 5-7 already maintain (see [docs/product/18_ENGINEERING_CONVERSATION_POLICY.md](../../docs/product/18_ENGINEERING_CONVERSATION_POLICY.md) for the governing policy and [automation/conversation/README.md](automation/conversation/README.md) for the module map). A vendor-neutral **Engineering Conversation Packet** (ECP 1.0, `schemas/engineering-conversation-packet.schema.json`) is the single handoff format; `source_tool` is metadata only, never a trust or ownership signal.

```bash
# Import / preview / validate a packet
node scripts/product-docs/cli.js conversation import --format ecp|markdown|json --file <path> [--mode strict|standard|observe]
node scripts/product-docs/cli.js conversation preview --format ecp --file <path>     # dry run, no writes
node scripts/product-docs/cli.js conversation validate --format ecp --file <path>    # schema + secret scan only

# Local inbox (gitignored .autoingest-docs/conversations/inbox/)
node scripts/product-docs/cli.js conversation inbox
node scripts/product-docs/cli.js conversation process-inbox

# Query / read / maintain
node scripts/product-docs/cli.js conversation query "<text>" | --feature AI-FEAT-###
node scripts/product-docs/cli.js conversation show ENG-CONV-####
node scripts/product-docs/cli.js conversation redact ENG-CONV-#### --text "<span>"
node scripts/product-docs/cli.js conversation supersede ENG-CONV-#### --summary "..."

# Context assistant integration
node scripts/product-docs/cli.js context conversation ENG-CONV-####
```

New generated artifacts: `generated/conversation-index.{json,jsonl}`, `generated/CONVERSATION_INDEX.md`, `generated/CONVERSATION_TIMELINE.md`, and `generated/UNIMPLEMENTED_CONVERSATION_REQUIREMENTS.md` (`unimplemented-conversation-requirements.json`) — every conversation whose Implementation Handoff named concrete work and whose Outcome log hasn't recorded "Implemented" from real repository evidence. A missing keyword in source code is never used as evidence there; only feature/commit/memory relationships are.

**Trust boundary (the one place Part 8 deliberately diverges from Part 7's live-session automation)**: conversation-import evidence is structurally isolated from the `evidencePacket`/`decisionIntelligence.scanPacket` auto-finalize pipeline `hookAutomation.js` drives at commit/push time. `automation/conversation/decisionLink.js`/`bugLink.js`/`memoryLink.js` are only ever reached from an explicit `conversation import`/`conversation finalize` CLI invocation — never from a git hook — so an untrusted external transcript can never indirectly shape a canonical `DEC-###` purely by entering the same automatic stream live-session evidence already uses. See [docs/product/18_ENGINEERING_CONVERSATION_POLICY.md](../../docs/product/18_ENGINEERING_CONVERSATION_POLICY.md) § 10 for the full rationale (a finding from this Part's own architecture review).

**Security**: identical non-goals to Parts 4-7, extended for a stronger trust boundary (imported text originates entirely outside this repository) — no network calls, no external AI API, no `eval`, no code/Markdown/HTML execution over imported content, path-traversal- and symlink-escape-safe file loading, size- and JSON-depth-capped imports, automatic secret-pattern redaction before any write (canonical or raw), and data minimization (an unrecognized vendor-specific field never reaches the canonical record).

**A bug found and fixed during this Part's own E2E testing**: an early version of `automation/conversation/decisionLink.js` could draft a canonical `Status: Draft` decision record from conversation evidence that named no feature or roadmap ownership, producing an `orphan-decision` validation error the moment `validate` ran (every canonical decision must cite at least one feature/milestone). Fixed by requiring resolved feature/roadmap ownership as part of the evidence bar for canonical drafting — with no ownership, the same evidence now becomes a local, non-canonical, review-required candidate instead.
