# Engineering Memory Policy (Part 6)

This is the governing policy for `docs/product/memory/` — the durable record of the engineering conversation and reasoning around a piece of work, not just its resulting code. It originates no facts of its own about AutoIngest's product or architecture; every claim inside an individual `AI-MEM-####` capsule must trace to one of the evidence sources listed in § Evidence Discipline below, exactly as [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) requires everywhere else in this system. See [15_MEMORY_TEMPLATE.md](15_MEMORY_TEMPLATE.md) for the file structure this policy governs, and [scripts/product-docs/automation/memory/README.md](../../scripts/product-docs/automation/memory/README.md) for the tooling that produces it.

## 1. Purpose

Parts 1–5 preserve *what* AutoIngest's product is, *what* happened (bugs, decisions, postmortems, releases), and *that* it happened (Evidence Packets, audit logs). None of them preserve *why the engineering conversation went the way it did*: the original request, the plan that was first proposed, the rounds of revision a plan went through before a human accepted it, the alternatives that were seriously considered and rejected, and the reasoning that connects one to the next. That connective reasoning is what Part 6 exists to keep from being lost the first time someone runs `/clear`, closes a laptop, or moves to a different AI tool.

## 2. Scope Boundary — What a Capsule Is and Is Not

A Memory Capsule records **one meaningful engineering episode**: a feature's evolution, a bug's investigation, a review-and-correction cycle, an architecture discussion. It is not a chat log and not a diary entry per message — see § 8 (Significance Rules) for exactly when one is warranted. It is also not a second implementation record: a capsule may narrate the same commits and files a `features/AI-FEAT-###` journal entry already cites, but the journal entry remains the authoritative statement of *what changed*; the capsule is the authoritative statement of *why the conversation arrived there*. Neither supersedes the other — see § 3.

## 3. Authority Model

Memory is **historical evidence, not a runtime or technical contract**, and sits below every other authority tier in this system:

1. Authoritative technical documents under `docs/` (`docs/CLAUDE.md`'s routing).
2. Canonical product records under `docs/product/` (`00`–`14`, `features/`, `bugs/`, `decisions/`, `postmortems/`).
3. Accepted bug, decision, postmortem, and feature records specifically.
4. **Engineering Memory records** (`docs/product/memory/AI-MEM-####_*.md`) — this tier.
5. Generated indexes and summaries (`docs/product/generated/memory-index.*`, `MEMORY_INDEX.md`, `ENGINEERING_MEMORY_TIMELINE.md`) — locators only, same rule as every other `generated/` artifact in this system (see [scripts/product-docs/README.md](../../scripts/product-docs/README.md) § Authority model).
6. Agent inference.

A Memory Capsule may *explain* why a canonical document changed (a capsule's Evolution Timeline can narrate the reasoning behind a decision record's Options Considered section). It must never *silently override* a canonical record. If a capsule and a canonical document disagree — say, a capsule remembers a rejected approach that a decision record doesn't mention — flag the conflict in both places (the capsule's own text, plus a note in the decision record if one exists) and require a human or a future documentation pass to reconcile them explicitly. Never resolve the disagreement by quietly editing one to match the other.

## 4. ID Model

`AI-MEM-####` — four digits, not three like every other family in this system (`AI-FEAT-###`, `AI-RM-###`, `BUG-###`, `DEC-###`, `PM-###`). This is a deliberate divergence: a mature engineering memory corpus is expected to accumulate far faster than product features or roadmap milestones (potentially one capsule per significant session, over years), and three digits caps out at 999. IDs are permanent, unique, sequential, never reused, never renumbered — identical rule to every other family (see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) § Stable IDs). Allocation reuses Part 5's existing race-resistant lock-then-scan-then-write mechanism (`scripts/product-docs/automation/recordAllocator.js`'s `FAMILY_CONFIG.memory`), not a new allocator — see [scripts/product-docs/automation/memory/README.md](../../scripts/product-docs/automation/memory/README.md) § Concurrency.

## 5. Canonical vs. Raw — What Gets Committed

Two distinct tiers, never conflated:

- **Canonical Memory Capsules** (`docs/product/memory/AI-MEM-####_*.md`) — curated, compiled, evidence-cited Markdown. Version-controlled. Permanent once created; changed only by an appended revision, a supersession record, or an explicit redaction (§ 11) — never a silent rewrite.
- **Raw session artifacts** (`.autoingest-docs/memory/{raw,pending,processed,failed,imports,audit}/`) — structured event streams, imported transcripts, screenshot metadata, tool-call summaries. Repository-local, gitignored, never canonical, exactly like Part 5's `.autoingest-docs/sessions/` — see [scripts/product-docs/automation/README.md](../../scripts/product-docs/automation/README.md) § The core idea.

Raw transcripts are **not** committed by default: full chat logs are noisy, may contain secrets or personal data, use unstable per-vendor formatting, and mostly restate what the compiled capsule already distills. A user may explicitly request archival of a redacted raw transcript (§ 11); this is opt-in, never automatic.

## 6. Evidence Discipline (Memory-Specific)

Every claim in a capsule must be one of:

- an explicit event captured during the session it describes (a `memory event`/`memory feedback`/`memory decide` call, etc. — see the event schema in [scripts/product-docs/automation/memory/README.md](../../scripts/product-docs/automation/memory/README.md));
- a Part 5 Engineering Evidence Packet field, if the capsule is linked to one;
- a Git fact (commit, diff, branch);
- a test result or report;
- a screenshot/asset manifest entry;
- an imported, redacted, schema-validated structured summary from another tool;
- an explicit user-provided historical statement, marked as such and distinguished from agent inference.

When none of these support a claim, the capsule must say **"Evidence pending — source conversation unavailable"** (this system's Part 6-specific variant of the existing "Evidence pending — not yet documented as fact" phrase) rather than a plausible-sounding reconstruction. Never invent a rejected alternative, a piece of user feedback, or a root cause merely because the shape of a template section expects one — see § 7.

## 7. Reality Boundary

The memory system captures context available to **the active local engineering agent and this repository** — Part 5 Evidence Packets, Git history, test output, screenshots, and whatever a session explicitly submits through the CLI. It must never claim automatic access to unrelated conversations in ChatGPT, Gemini, Codex, other Claude sessions, email, messaging platforms, or any other external system, unless that tool explicitly exports/submits/synchronizes a supported artifact through `memory import` (§ 9). The design is tool-neutral by construction — any agent can contribute through the same structured event schema — but "tool-neutral" means "no tool is privileged," not "every tool's history is automatically visible."

## 8. Significance Rules — When a Capsule Is Warranted

Create a durable capsule when one or more applies: a new product feature; a meaningful enhancement; a confirmed bug with real investigation; an architecture change; a persistence/data-model change; a security change; significant performance work; a major UI/UX redesign; multiple plan revisions; user feedback that materially changed the design; several alternatives genuinely evaluated; substantial troubleshooting; feature completion; release preparation; an incident/postmortem; a correction of a previously documented assumption.

Do not create one for: typo-only changes, formatting-only changes, generated-file refreshes, dependency lockfile churn, trivial comments, no-op runs, or mechanical refactors with no engineering relevance. `scripts/product-docs/automation/memory/significance.js`'s `planMemoryCapsule()` encodes this table as an executable predicate, in the same evidence-gated style as `documentationPlanner.js`'s `planDocumentation()` — see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) § When to Create a New Record for the sibling table this one extends.

An existing capsule may be **reopened** and appended when later work clearly continues the same engineering story (`Status: Reopened`, a new Evolution Timeline entry). Never rewrite prior entries — append and mark, per this system's universal Append, Never Erase rule.

## 9. Tool-Neutral Contribution and Import

Any agent contributes through the same structured event schema (`scripts/product-docs/automation/memory/README.md` § Event Schema) via `node scripts/product-docs/cli.js memory <sub>`. Supported import formats are Markdown and JSON only (`memory import --format markdown|json --file <path>`); an unrecognized format is rejected with a clear message, never guessed into a best-effort parse. Imports are size-capped, path-constrained to an explicit file argument (no directory traversal, no implicit repo-wide scan), schema-validated, and never executed as code — see § 12 (Security).

## 10. Visual Evidence

Screenshots are tracked via a manifest (asset ID, capture context, checksum, retention status — see [15_MEMORY_TEMPLATE.md](15_MEMORY_TEMPLATE.md) § Visual Evidence), not committed wholesale. An image is committed under `docs/product/memory/assets/AI-MEM-####/` only when it carries durable engineering value (a before/after redesign, a rendering bug, a layout regression, a theme issue) — a routine test screenshot stays in the ignored raw tier and is never promoted without that judgment being made explicitly.

## 11. Privacy, Redaction, and Correction

Memory ingestion handles untrusted, potentially sensitive text. `scripts/product-docs/automation/redact.js`'s existing secret-pattern detection (AWS/GitHub/OpenAI-style keys, Slack tokens, PEM blocks, generic `key=`/`token=` assignments) is applied to every event and import before it is written anywhere, canonical or raw — no new redaction engine, the same one Part 5 already uses for Evidence Packets and the audit log. `memory redact` lets an operator strip a specific matched span from a canonical capsule after the fact (recorded as an explicit redaction, never a silent edit); `memory supersede` marks a capsule's specific claim as corrected without deleting the original text (the record of "we used to believe X" stays, marked wrong, per Append, Never Erase); `memory forget-local` removes ignored raw artifacts only — it has no authority over anything already committed to `docs/product/memory/`. `memory verify` re-scans committed capsules for an obvious secret pattern that slipped through, as a safety net, not a guarantee.

## 12. Security

Every write is constrained to the repository root, reusing `automation/atomicWrite.js`'s `assertInsideRepo` — no new path-handling code, no path traversal. Imports are read from an explicit, caller-supplied file argument only (never a directory scan of an arbitrary location) and capped in size before being read into memory. No import content is ever executed, `eval`'d, or shelled out — Markdown and JSON are parsed as inert text/data. No network calls, no external AI API, no embeddings — identical non-goals to Parts 4/5 (see [scripts/product-docs/README.md](../../scripts/product-docs/README.md) § Non-goals).

## 13. Concurrency and Idempotency

Reuses Part 5's proven mechanisms rather than inventing new ones: `recordAllocator.js`'s lock-then-scan-then-write critical section for collision-free `AI-MEM-####` allocation (same stale-lock recovery, same TOCTOU-safe rename-then-unlink break), and `canonicalUpdater.js`'s idempotent-write pattern (a `{{RECORD_ID}}` placeholder rendered once, a `*_created_id` marker preventing a retried finalize from allocating a second capsule for the same session). Two sessions describing what looks like the same task are never silently merged into one capsule on low confidence — recorded as a pending-link candidate instead, for a human or a later pass to confirm.

## 14. Retention

- **Canonical capsules**: retained permanently unless explicitly superseded/redacted (§ 11); version-controlled.
- **Committed visual assets**: retained only while they carry durable engineering value (§ 10); not a blanket retention promise for every screenshot ever captured.
- **Raw local events**: retained long enough to support crash recovery and `memory recover`; `memory forget-local` is the explicit, operator-invoked cleanup path — there is no scheduled/cron cleanup in this repository (AutoIngest has no scheduler infrastructure to hang one on), so this is a manual-invocation policy, not an automatic timer.
- **Imported transcripts**: retained locally only until canonical compilation, unless the user explicitly approves longer archival with redaction already applied.

This is engineering-tool retention, not an institutional records-retention policy — nothing here should be read as a compliance or legal-hold statement.

## 15. Validation

`docs/product/memory/` is checked by the same `node scripts/product-docs/cli.js validate` command as everything else in this system — new rules live in `scripts/product-docs/lib/memoryValidators.js`, wired into the existing `runAllChecks` aggregator, using the identical `finding(level, rule, message, file, note)` shape and four-level severity (`error`/`warning`/`information`/`evidence_gap`) as every other rule in [14_VALIDATION_SPECIFICATION.md](14_VALIDATION_SPECIFICATION.md). See that file's own numbered rules for the pattern this policy's memory-specific rules extend, and `scripts/product-docs/automation/memory/README.md` § Validation Coverage for the current concrete rule list and — honestly — which rules from the original Part 6 brief are not yet implemented.

## 16. Automation Modes

Reuses Part 5's exact three-mode enum (`evidencePacket.js`'s `AUTOMATION_MODES`, `AUTOINGEST_DOCS_MODE` env var) rather than inventing a separate memory-specific mode — a session is either STRICT, STANDARD, or OBSERVE for its whole lifecycle, memory capsule creation included. In STRICT, an in-progress session with significant-looking events (§ 8) and no compiled capsule blocks `finalize` the same way an unmet documentation requirement already does. In STANDARD (default), a justified capsule is created/updated automatically and only a hard validation error blocks. In OBSERVE, capsule compilation is previewed but never written to `docs/product/memory/` — structurally gated in `orchestrator.js`, identical to how Part 5 already gates `canonicalUpdater`/`lifecycleUpdater` in OBSERVE.

## 17. Migration of Existing History

Historical engineering conversations that predate Part 6 are not reconstructed in one uncontrolled pass. `memory migrate` is a documented, evidence-grounded helper for producing capsules from **already-documented** history — existing feature files, bug/decision/postmortem records, the changelog, `.claude/learning-log.md`, and Git history — never fabricated dialogue. A migrated capsule's Original Request and Initial Plan sections are marked **"Evidence pending — source conversation unavailable"** whenever the underlying conversation itself (as opposed to its post-hoc documentation) isn't recoverable; the surrounding investigation/evolution/decision content is populated only from what those existing records already state as fact. See `AI-MEM-0001` for the first such pilot migration and its own explicit accounting of what could and could not be recovered.

## 18. What This Policy Deliberately Does Not Cover

Application code correctness, prose quality, or whether a documented decision was the *right* one — same disclaimer as [14_VALIDATION_SPECIFICATION.md](14_VALIDATION_SPECIFICATION.md) § What this specification deliberately does not cover. This document also does not create a new authority over AutoIngest's roadmap or feature status (§ 3) and does not gate an application release (same non-gating stance as [docs/product/CLAUDE.md](CLAUDE.md) § 16, applied to memory instead of the documentation system generally).
