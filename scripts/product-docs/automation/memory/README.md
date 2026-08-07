# scripts/product-docs/automation/memory/ — Part 6 Engineering Memory Layer

Extends Part 5's orchestration with a durable, repository-backed record of the engineering conversation and reasoning around a piece of work — not just its resulting canonical documentation. See [docs/product/16_ENGINEERING_MEMORY_POLICY.md](../../../../docs/product/16_ENGINEERING_MEMORY_POLICY.md) for the governing policy and [docs/product/15_MEMORY_TEMPLATE.md](../../../../docs/product/15_MEMORY_TEMPLATE.md) for the capsule structure this module produces.

## Module map

| Module | Responsibility |
|---|---|
| `paths.js` | `.autoingest-docs/memory/{raw,pending,processed,failed,imports,audit,locks}/` layout constants |
| `events.js` | The 21-type event schema, append-only journaling per session (`appendEvent`/`loadEvents`), session metadata |
| `significance.js` | `planMemoryCapsule(packet, events)` — the evidence-gated "is a capsule warranted" predicate (§ 8 of the policy document) |
| `allocator.js` | Thin wrapper over `automation/recordAllocator.js`'s `FAMILY_CONFIG.memory` — reuses Part 5's lock-then-scan-then-write allocation, plus the `{{RECORD_ID}}` placeholder/substitution idiom `canonicalUpdater.js` already established |
| `compiler.js` | Deterministic events+packet → capsule Markdown compiler (`compileCapsule`) — pure function, no randomness, no invented prose |
| `lifecycle.js` | `start`/`finalize`/`maybeCompileFromPacket` — the session lifecycle, and the hook `automation/orchestrator.js`'s own `finalize()` calls |
| `importAdapter.js` | Tool-neutral Markdown/JSON import — explicit file argument only, size-capped, schema-validated, never executed |
| `redactor.js` | Read-only secret-pattern *scan* over already-committed capsule text (Part 5's `redact.js` only ever runs on data about to be written) |
| `query.js` | `memory query`'s richer filters (`--feature`/`--bug`/`--decision`/`--commit`/`--rejected`/`--feedback`) on top of Part 4's generic offline query |

`../memoryCli.js` is the thin `memory <sub>` command dispatcher, mirroring `../cli.js`'s own convention.

## Event Schema

Every event (`events.js`'s `buildEvent`) carries: `event_id`, `session_id`, `timestamp`, `source_tool`, `source_type`, `task_id`, `type`, `related_ids[]`, `summary`, `evidence_refs[]`, `confidence`, `redaction_status`, `detail` (a type-specific free-form object). `type` is one of the 21 values in `EVENT_TYPES` (`task_started` through `follow_up_created` — see the module for the full list, matching the Part 6 brief's event taxonomy exactly). `source_type` is one of `native-lifecycle`, `evidence-packet`, `agent-session-summary`, `imported-transcript`, `explicit-user-statement`, `repository-evidence` — the tool-neutral contribution paths from the policy document's § 9. Every event is `redactDeep()`'d before it ever touches disk.

## Part 5 Integration

`automation/orchestrator.js`'s `finalize()` calls `lifecycle.maybeCompileFromPacket(packet)` immediately after a passing validation gate and before the packet is moved to `completed/`. This is **best-effort and never blocking** in STANDARD/OBSERVE — a thrown error inside memory compilation is caught inside `maybeCompileFromPacket` itself and never propagates to break Part 5's own finalize. `significance.js` decides whether the packet's own evidence (bugs/decisions/alternatives/risks) plus any raw events explicitly recorded on the same `session_id` via `memory <sub>` clear the significance bar; if so, `lifecycle.finalize()` compiles, allocates the `AI-MEM-####` ID, cross-links the capsule into every primary feature file's Engineering Evolution section (idempotently, via `markdownSections.js`), and re-runs `rebuildGeneratedArtifacts()` so the newly-created capsule file never leaves `docs/product/generated/` stale relative to what's on disk.

A memory session does not require a linked Part 5 Evidence Packet at all — `memory start`/`memory event`/... work standalone for investigation-only or import-driven capsules.

## Autonomy Modes

Reuses Part 5's exact `AUTOMATION_MODES` enum (`strict`/`standard`/`observe`) and `AUTOINGEST_DOCS_MODE` env var — no separate memory-specific mode. OBSERVE never writes a canonical capsule (`lifecycle.finalize()`'s own structural `mode === 'observe'` gate, not a convention). See the policy document § 16.

## Validation Coverage

`scripts/product-docs/lib/memoryValidators.js` implements a genuine subset of the full ~25-rule battery described in the original Part 6 brief, wired into the existing `runAllChecks` aggregator in `lib/validators.js` (same `finding()` shape, same four severities). Implemented today: duplicate `AI-MEM-####` IDs, broken feature/bug/decision/roadmap citations from a capsule, invalid `Status`/`Evidence classification` vocabulary, missing Provenance section, an unredacted-secret-pattern scan (via `redactor.js`), orphan screenshot-manifest references, and stale-generated-index freshness (covered for free by the existing `checkGeneratedFreshness`, once memory artifacts are part of `build.js`'s `assemble()` output). See § Deferred Work below for what's intentionally not yet implemented.

## Testing

`test/automation/memory*.test.js` — unit tests for allocator/events/significance/compiler/redactor/importAdapter, following the same `testHarness.js` convention as every other Part 4/5 test file. `test/memory.test.js` (top-level, alongside `integration.test.js`) verifies the real `docs/product/memory/` tree parses, indexes, and validates cleanly. See § Deferred Work for the disposable-worktree end-to-end scenarios this substitutes for.

## Deferred Work

Recorded here — the canonical, permanent home for this accounting — rather than only in a chat-session report, so a future maintainer can find it without relying on session history:

- **Disposable-worktree end-to-end scenarios (A–H)**: the original Part 6 brief specified eight live scenarios (feature evolution, bug troubleshooting, UI feedback with screenshots, interrupted-session recovery, concurrent sessions, an unsupported-format import rejection, an evidence-poor task, and a historical migration) run against fully disposable Git worktrees, mirroring `test/automation/tmpRepoHarness.js`'s pattern for Part 5's own `orchestrator.integration.test.js`. These were **not** built as standalone worktree-based end-to-end tests. Instead, `test/automation/memoryLifecycle.test.js`, `memoryImportAdapter.test.js`, and `memorySignificance.test.js` cover the same underlying guarantees (idempotent finalize, OBSERVE never writing canonical memory, significance gating, import format rejection, path-traversal/symlink-escape rejection, an evidence-poor session producing an honest "not significant" result rather than a fabricated capsule) as scratch-directory unit/integration tests rather than full multi-process worktree scenarios. A future pass extending `tmpRepoHarness.js`-style coverage specifically to the memory lifecycle (particularly true concurrent-`finalize`-on-one-session and crash-mid-compile recovery, which scratch-directory tests can't fully exercise) remains open work.
- **Asset checksum verification**: `checkMemoryOrphanAssetReferences` (`lib/memoryValidators.js`) checks that a Visual Evidence asset ID has a *matching filename* under `docs/product/memory/assets/AI-MEM-####/`, but does not verify a checksum against the manifest the way [16_ENGINEERING_MEMORY_POLICY.md](../../../../docs/product/16_ENGINEERING_MEMORY_POLICY.md) § 10's manifest schema implies. Deferred — no committed asset exists yet to validate against (docs/product/memory/assets/ is currently empty).
- **Cross-session duplicate-fingerprint detection**: [16_ENGINEERING_MEMORY_POLICY.md](../../../../docs/product/16_ENGINEERING_MEMORY_POLICY.md) § 13 states two sessions describing the same task should never be silently merged on low confidence, and should instead be recorded as a pending-link candidate. The "never silently merge" half is true by construction (nothing in `lifecycle.js` merges two sessions), but the "record a pending-link candidate" detection mechanism itself — comparing task/session fingerprints across `finalize` calls to flag a likely duplicate — is not implemented.
- **Repeated full-corpus parsing on every invocation** (performance-auditor finding): `parseProductDocs.loadAll()` re-parses every capsule from scratch on every `build`/`validate`/`memory query` call, with no cross-invocation cache; `lifecycle.finalize()` additionally triggers up to two full `build.assemble()` passes per capsule creation (an in-memory sanity check, then `orchestrator.js`'s own `rebuildGeneratedArtifacts()`). At the current corpus size (1 capsule) every measured command (`build` ~85ms, `validate` ~140ms, `memory query` ~40ms) is 1–2 orders of magnitude under its stated target, so this is **not a current problem** — but it is the first thing expected to matter as the corpus grows into the hundreds of capsules, since cost scales linearly with total `docs/product/` tree size and is re-paid on every single invocation rather than incrementally. Left as documented future scalability work rather than fixed now, since a fix (passing an already-computed `assemble()` result across the `execFileSync` process boundary `rebuildGeneratedArtifacts()` uses) would mean changing Part 5's shared rebuild contract for a problem that doesn't yet exist.

## Non-goals

Same as Parts 4/5: no network calls, no external AI API, no embeddings, no database. Additionally, per the Part 6 brief specifically: no automatic access to unrelated conversations in other tools (ChatGPT, Gemini, Codex, other Claude sessions) without an explicit `memory import`; no scheduled/cron retention cleanup (this repository has no scheduler infrastructure — `memory forget-local` is an explicit, operator-invoked command); no fabricated historical dialogue during migration (`memory migrate`).

**Part 8 note**: `memory import`'s own `--format markdown|json` remains the tool-neutral, own-session-scoped import path this file documents. A conversation that happened *outside* this repository's own sessions entirely (a full ChatGPT/Codex/Gemini/external-Claude discussion) now has a dedicated, richer pipeline instead — `../conversation/` (`node scripts/product-docs/cli.js conversation import --format ecp ...`, see [../conversation/README.md](../conversation/README.md) and [docs/product/18_ENGINEERING_CONVERSATION_POLICY.md](../../../../docs/product/18_ENGINEERING_CONVERSATION_POLICY.md)). That pipeline may itself create or continue an `AI-MEM-####` capsule via this module's own `lifecycle.js`/`significance.js` (`conversation/memoryLink.js` calls them directly, unchanged) — it never bypasses or duplicates this module's own significance gate.
