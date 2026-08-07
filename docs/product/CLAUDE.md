# docs/product/ — AI Operating Manual

This file is the operating manual for every AI agent working on AutoIngest's product documentation system. Read it once at the start of significant work; it routes to the full rule for anything it only summarizes. See [README.md](README.md) for what this system is at a glance.

## 1. Documentation Hierarchy

```
docs/CLAUDE.md                          — repo-wide routing (which doc for which task)
  └─ docs/product/CLAUDE.md (this file) — operating manual for docs/product/ specifically
       ├─ 00_PROJECT_VISION.md          — product purpose, long-term direction
       ├─ 01_FEATURE_REGISTRY.md        — canonical AI-FEAT-### inventory
       ├─ 02_MASTER_ROADMAP.md          — canonical AI-RM-### milestone order
       ├─ 03_IMPLEMENTATION_TIMELINE.md — planned vs. actual dates
       ├─ 04_PROJECT_DASHBOARD.md       — live status snapshot
       ├─ 05_DOCUMENTATION_WORKFLOW.md  — mandatory maintenance rules (the process authority)
       ├─ 06–09_*_TEMPLATE.md           — copy-exactly templates for feature/bug/decision/postmortem records
       ├─ 10_CHANGELOG.md               — log of changes to this documentation system itself
       ├─ 11_ARCHITECTURAL_EVOLUTION.md — chronological narrative: how and why the architecture got here
       ├─ 12_DEPENDENCY_MODEL.md        — cross-cutting relationship index (Milestone→Features, Decision→Decision, Bug→Decision, etc.)
       ├─ 13_ENGINEERING_HANDBOOK.md    — philosophy/onboarding: why the system is shaped this way
       ├─ 14_VALIDATION_SPECIFICATION.md — the integrity rules this system must satisfy
       ├─ features/AI-FEAT-###_*.md     — one file per registered capability
       ├─ bugs/BUG-###_*.md             — reusable troubleshooting knowledge
       ├─ decisions/DEC-###_*.md        — accepted/rejected architectural & product decisions
       └─ postmortems/PM-###_*.md       — significant-incident records
```

Numbered top-level files (`00`–`14`) are the system's own spine and are never duplicated inside `features/`, `bugs/`, `decisions/`, or `postmortems/` — those subdirectories hold one record per ID, cross-linked back into the spine, not copies of it.

## 2. Authority Boundaries

`docs/product/` is authoritative for product planning, feature history, roadmap progress, bug investigations, decisions, implementation journals, and postmortems. It is **never** authoritative for runtime behavior, contracts, security, data model, or any current-behavior question — those remain owned by the technical docs under `docs/` (`docs/CLAUDE.md`, `docs/system-contracts.md`, etc.). **If a product document and a technical document ever disagree, the technical document is correct.** Fix the product document and record the reconciliation in the relevant feature or decision record (`08_DECISION_TEMPLATE.md`'s Reconciliation Note field exists precisely for this). Full rule: [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) § Authority Boundary.

Within `docs/product/` itself, there is a second authority order: an individual record (`features/AI-FEAT-###`, `bugs/BUG-###`, `decisions/DEC-###`, `postmortems/PM-###`) is authoritative over any aggregation of it. [12_DEPENDENCY_MODEL.md](12_DEPENDENCY_MODEL.md) is a navigational index, not a source — if it and an individual record disagree, regenerate the index, don't edit around the discrepancy (see that file's own opening note). [13_ENGINEERING_HANDBOOK.md](13_ENGINEERING_HANDBOOK.md) is downstream of every decision it cites — it originates no new facts (see that file's closing section).

A third, generated layer sits below both: [generated/](generated/) (built by `scripts/product-docs/`, see [scripts/product-docs/README.md](../../scripts/product-docs/README.md)) is a machine-queryable locator over everything above — feature index, authority index, subsystem locator, dependency graph, per-feature timelines, roadmap dashboard, documentation health report. It is a **locator, not a contract**: consult it to find the relevant canonical document quickly (`node scripts/product-docs/cli.js query "..."`, `impact <path>`), then read that canonical document directly before implementing anything. Never cite `generated/` content as evidence in a feature/bug/decision/postmortem record — cite the canonical source it points to instead.

## 3. Routing

### Before significant AutoIngest work, read:

- [README.md](README.md), [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md), [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md), [04_PROJECT_DASHBOARD.md](04_PROJECT_DASHBOARD.md)
- the relevant `features/AI-FEAT-###_*.md` file(s), including their **Lifecycle Metadata** and **Engineering Evolution** sections
- linked bug/decision/postmortem records surfaced from that feature file (forward-linked) and from [12_DEPENDENCY_MODEL.md](12_DEPENDENCY_MODEL.md) (reverse-linked)
- the routed authoritative technical docs under `docs/` (`docs/CLAUDE.md`'s Task Documentation Routing — this system supplements that routing, never replaces it)

"Significant" means: implementing or modifying a registered feature, starting work on a roadmap milestone, or investigating a bug/decision that already has (or should have) a record here. Trivial or purely technical tasks (a one-line bug fix with no reusable lesson, a styling tweak) don't require reading this system first — use judgment consistent with `.claude/learning-rules.md`'s own "when not to" guidance.

### Task-to-Doc Routing Table

| Task type | Read |
|---|---|
| Product feature registry / what capabilities exist | [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) |
| Roadmap / milestone progress / what's next | [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md), [04_PROJECT_DASHBOARD.md](04_PROJECT_DASHBOARD.md) |
| Implementation timeline / estimates vs. actuals | [03_IMPLEMENTATION_TIMELINE.md](03_IMPLEMENTATION_TIMELINE.md) |
| Feature evolution / implementation journal / lifecycle metadata | relevant `features/AI-FEAT-###_*.md` |
| Bug/troubleshooting knowledge base | [bugs/](bugs/) |
| Product/architecture decisions | [decisions/](decisions/) |
| Incident history | [postmortems/](postmortems/) |
| Architectural history / why things are shaped this way | [11_ARCHITECTURAL_EVOLUTION.md](11_ARCHITECTURAL_EVOLUTION.md) |
| Cross-cutting relationships (what depends on what) | [12_DEPENDENCY_MODEL.md](12_DEPENDENCY_MODEL.md) |
| Engineering philosophy / onboarding / "why do we do it this way" | [13_ENGINEERING_HANDBOOK.md](13_ENGINEERING_HANDBOOK.md) |
| Integrity/consistency checks on this documentation system | [14_VALIDATION_SPECIFICATION.md](14_VALIDATION_SPECIFICATION.md) — run via `node scripts/product-docs/cli.js validate` |
| Fast lookup by topic/feature/bug/decision/subsystem/code path; impact analysis; "what changed" reports | [scripts/product-docs/README.md](../../scripts/product-docs/README.md) (`query`/`impact`/`changes` commands) — locator only, see § 2 and § 14a |
| How to maintain this system / the update rules | [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) |

## 4. Feature Lifecycle

Every feature (new or modified) follows the 10-step lifecycle defined in [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) § Documentation Lifecycle Enforcement: roadmap milestone → implementation → architectural evolution (when it qualifies) → decisions → bugs → rejected approaches → accepted solution → feature status → roadmap progress → changelog. Steps 4–7 are conditional on whether the work actually produced a decision/bug/rejected-approach/distinct-solution; steps 1, 8, 9, 10 are close to universal. A feature is not "complete" until its documentation lifecycle is complete — see that document's own Definition of "documentation complete."

## 5. Documentation Lifecycle

Documentation is updated **alongside** the work, in the same session, not reconstructed from memory afterward (`05_DOCUMENTATION_WORKFLOW.md` § The Update Rule). Nothing is silently deleted — append and mark **rejected**/**superseded**/**deferred**, never erase (§ Append, Never Erase). This is not a release gate on application code — it governs when the *documentation* for a change is finished, which should lag a merge by at most the same work session.

## 6. Evidence Standards

Every factual claim must trace to one of: current source code (cite file/function/IPC channel), tests (cite test file), existing technical docs under `docs/`, Git history (cite commit/date), current UI (cite the observed surface), or prior project knowledge explicitly marked **"Known from project history; repository evidence pending."** When evidence is incomplete, write the literal phrase **"Evidence pending — not yet documented as fact"** — never a plausible-sounding guess. Full rule: [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) § Evidence Discipline. Never invent dates, bugs, architecture, decisions, ownership, or maturity — this is the single most important rule in this entire system, and every other rule here exists to support it.

## 7. Cross-Linking Rules

- Link forward from the source of a fact to what it relates to (a feature names its own bugs/decisions in its own `Known Bugs`/`Decisions` sections) — don't rely solely on the reverse lookup in [12_DEPENDENCY_MODEL.md](12_DEPENDENCY_MODEL.md) to make a relationship discoverable.
- Do not add a broad link to every record from every tangentially-related file — link only where the relationship is direct and useful (see `05_DOCUMENTATION_WORKFLOW.md`'s general economy-of-documentation stance and Part 2's own cross-linking pass, which deliberately updated 15 of 56 feature files, not all 56).
- A relative link must resolve, and a `#anchor` link must resolve to a real heading — see [14_VALIDATION_SPECIFICATION.md](14_VALIDATION_SPECIFICATION.md) Rule 2 for the exact check.
- Do not create speculative relationships. Only record a dependency/relationship that is supported by an existing citation or an explicit statement in the source record.

## 8. Planning Methodology

Before implementing: understand the requirement, identify affected systems (UI / `event.json` / ingestion logic / filesystem), and load only the relevant routed docs (`docs/development-protocol.md` §§ 1–2). Choose patch vs. refactor vs. redesign using `docs/decision-matrix.md`'s decision tree — a redesign-tier change must be explained and approved before code is written. High-risk changes (`event.json` structure, ingestion routing, filesystem operations, anything touching a system contract) require this explicitly, not as a courtesy. See [13_ENGINEERING_HANDBOOK.md](13_ENGINEERING_HANDBOOK.md) § 13 (Decision Philosophy) for how this connects to when a `decisions/DEC-###` record gets created.

## 9. Engineering Philosophy

Full detail, section by section (application, archival, metadata, folder, naming, UI, UX, performance, reliability, testing, release, documentation, decision, bug-documentation, and feature-lifecycle philosophy), lives in [13_ENGINEERING_HANDBOOK.md](13_ENGINEERING_HANDBOOK.md) — read it once per onboarding, not per task. The one-sentence version: `event.json` is the single source of truth, the UI is a pure reflection, nothing is ever overwritten, and every claim in this documentation system must be evidenced or explicitly marked as not yet evidenced.

## 10. Decision Philosophy

Create a `decisions/DEC-###` record only when a real alternative was weighed and one was chosen — not for routine implementation choices with no meaningful tradeoff (`08_DECISION_TEMPLATE.md`). If the full alternatives-considered discussion can't be evidenced beyond "this is what shipped," say so explicitly (`Evidence pending`) rather than inventing a plausible rejected alternative — see any existing `DEC-###`'s own "Options Considered" section for the pattern in practice. A decision's `Reconciliation Note` field is where you record a later-discovered conflict with an authoritative technical doc — the technical doc always wins (§ 2 above).

## 11. Historical Preservation

Nothing in a feature's evolution history, a decision's alternatives, or a bug's investigation log is ever silently deleted or rewritten. A superseded approach stays in the document, marked as such, with a one-line reason — the record of *why not* is often more valuable six months later than the record of *what*. IDs (`AI-FEAT-###`, `AI-RM-###`, `BUG-###`, `DEC-###`, `PM-###`) are permanent once assigned: never reused, never renumbered, even if the thing they name is merged, deprecated, or superseded.

## 12. Bug Documentation Standards

Create a `bugs/BUG-###` record only when the bug's root cause, symptom, or fix pattern would help diagnose something similar faster next time — not every fixed bug qualifies (`07_BUG_TEMPLATE.md`, `bugs/README.md`). It complements, and never replaces, `docs/failure-patterns.md`'s technical symptom→cause→fix map. A bug that recurs across different subsystems or different fields (see [BUG-006](bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md)) is more valuable to document as a pattern than either instance alone.

## 13. Postmortem Standards

Reserve `postmortems/PM-###` for significant incidents with a reconstructable timeline, impact, and systemic corrective action — not routine bug fixes (`09_POSTMORTEM_TEMPLATE.md`, `postmortems/README.md`). If the repository evidence doesn't support a specific named incident, don't force a postmortem to fit it — reframe around what's actually evidenced, or downgrade to bug records (see [PM-001](postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md)'s own framing note for exactly this situation, and record the discrepancy rather than silently choosing the more dramatic framing).

## 14. Validation Expectations

Run the checks in [14_VALIDATION_SPECIFICATION.md](14_VALIDATION_SPECIFICATION.md) after any change to `docs/product/`, and always before a documentation commit: duplicate IDs, broken links, missing roadmap/feature references, orphan bugs/decisions/postmortems, missing architecture/changelog references, implemented-without-documentation features, planned-without-roadmap features, roadmap inconsistencies, and documentation-completeness gaps. These are static-analysis checks over Markdown and `git log` — no application code execution required.

These 13 rules now have a first real, runnable implementation: `node scripts/product-docs/cli.js validate` (see [scripts/product-docs/README.md](../../scripts/product-docs/README.md)). Run it after any change to `docs/product/` and before a documentation commit — it writes `generated/documentation-health.md`/`.json` and exits non-zero only on `error`-level findings; warnings and evidence gaps are reported, not blocking, per that document's own severity policy.

## 14a. Required AI Workflow (Part 4 tooling)

Before significant work on AutoIngest (implementing/modifying a registered feature, starting a roadmap milestone, or investigating a bug/decision that should have a record here):

1. Query the authority index: `node scripts/product-docs/cli.js query "<topic>"` or open [generated/AUTHORITY_INDEX.md](generated/AUTHORITY_INDEX.md).
2. Identify the relevant `AI-FEAT-###` ID(s) from the result.
3. Open the canonical `features/AI-FEAT-###_*.md` file(s) — read directly, don't stop at the generated summary.
4. Open the authoritative technical docs under `docs/` that the feature cites (`docs/CLAUDE.md`'s Task Documentation Routing).
5. Inspect linked bugs, decisions, postmortems, and dependencies (the feature's own Lifecycle Metadata section, or `node scripts/product-docs/cli.js impact <AI-FEAT-### | path>`).
6. Run impact analysis for anything you're about to change: `node scripts/product-docs/cli.js impact <path-or-ID>` — advisory only, it does not authorize the change.
7. Plan the change.
8. Update canonical `docs/product/` records **during** implementation, per the Update Rule (§5 below) — never reconstruct them from memory afterward.
9. Rebuild generated indexes: `node scripts/product-docs/cli.js build`.
10. Run `node scripts/product-docs/cli.js validate` before calling the documentation lifecycle complete.

Generated indexes are a locator for step 1–2; they never replace reading the canonical documents in steps 3–5 for actual implementation work.

**Examples**:
- *Metadata task*: `query "metadata audit"` → `AI-FEAT-033` → read `features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md` and `docs/metadata-system.md` → `impact main/exifService.js` before touching the shared write engine.
- *QMZ task*: `query qmz` → `AI-FEAT-047` → read that feature file and `DEC-011` (dedicated domain workflow) → `impact AI-FEAT-047`.
- *Transfer task*: `query "transfer export"` → `AI-FEAT-038` → check `BUG-005` (resume-state divergence) before changing checkpoint logic.
- *event.json task*: `query "event.json"` → `AI-FEAT-004` → this is the foundational contract; read `docs/data-model.md` and `docs/event-system.md` directly, not only the feature summary.
- *Archive Maintenance planning*: `impact AI-RM-002` → surfaces `AI-FEAT-049`, its dependencies (`AI-FEAT-042`, `AI-FEAT-043`), and `DEC-015` — read all three before scoping.

## 15. Update Workflow

1. Make the documentation change.
2. Run the [14_VALIDATION_SPECIFICATION.md](14_VALIDATION_SPECIFICATION.md) checks: `node scripts/product-docs/cli.js validate`.
3. Rebuild generated indexes so they aren't stale at commit time: `node scripts/product-docs/cli.js build` (re-run `validate` afterward — it fails on any `stale-generated-output` finding).
4. Add or amend the [10_CHANGELOG.md](10_CHANGELOG.md) entry (newest-first, append-only, never edit a prior entry — add a correcting entry if something was wrong).
5. Confirm `git diff --check` is clean and only documentation files (plus `docs/product/generated/`) changed (see `05_DOCUMENTATION_WORKFLOW.md`'s git-validation expectations, applied identically across Part 2 and Part 3 of this system's construction).
6. Stage and commit as one cohesive documentation commit — do not mix documentation commits with application code changes. `docs/product/generated/` may be committed in the same commit as the canonical change, or regenerated in a immediate follow-up commit — never left stale across a commit boundary (see § 15a).

## 15a. When to commit generated output

Commit `docs/product/generated/` in the **same commit** as the canonical `docs/product/` change whenever practical — a documentation commit that leaves the index stale defeats the freshness guarantee `validate` exists to enforce. Regenerating in an immediate follow-up commit is acceptable only when the canonical change and the regeneration genuinely can't land atomically (e.g. a generated-tooling bugfix applied after the fact) — and even then, `validate` will fail until that follow-up lands, which is the intended signal, not a bug to work around.

## 16. Release Workflow

`docs/product/` does not gate an AutoIngest application release — release notes (`docs/release-notes-vX.Y.Z.md`) and version bumps are a separate, application-facing process (see [13_ENGINEERING_HANDBOOK.md](13_ENGINEERING_HANDBOOK.md) § 11). What this system *does* require at release time: if the release includes a completed roadmap milestone, [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md) and [04_PROJECT_DASHBOARD.md](04_PROJECT_DASHBOARD.md) must reflect that before or in the same session as the release, per the Feature Lifecycle (§ 4 above).

## 17. Future Feature Workflow

Every feature implemented from this point forward should: receive an `AI-FEAT-###` ID, be linked to an `AI-RM-###` milestone when applicable, and go through the full 10-step lifecycle in § 4 above — producing a continuously evolving engineering history, not a codebase with a changelog bolted on after the fact. This was adopted explicitly as standing process on 2026-08-04 (PR #1) and is not a one-time initiative — treat skipping it as incomplete work, the same way an untested change or an unreviewed PR would be treated as incomplete.

## When to consult the architectural-evolution document specifically

Before work that changes any of the following, also read [11_ARCHITECTURAL_EVOLUTION.md](11_ARCHITECTURAL_EVOLUTION.md):

- core architecture (the event-based model, the archive-root model, the security model);
- archive ownership or source-of-truth boundaries (what is authoritative over what — `event.json`, the archive filesystem, or the UI);
- metadata pipeline design (the shared write engine, the resolver, the durable queue);
- import/transfer transaction behavior (atomic commit semantics, checkpoint/resume mechanics);
- recovery architecture (crash recovery, stale-lock recovery, verification-after-copy);
- or the relationship between established manual practice (Adobe Bridge, professional review) and AutoIngest's automation of it.

**When a major architectural transition is implemented**, that document must be updated as part of the same work — see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) for the specific criteria distinguishing a major transition from routine work that doesn't require this.

## 18. AI Session Completion Contract (Part 5)

`scripts/product-docs/automation/` (see [scripts/product-docs/README.md](../../scripts/product-docs/README.md) § Part 5) automates most of §§4–5 above — it does not replace the evidence discipline in §6, only the manual labor of applying it. An AI agent doing significant AutoIngest work (§3's definition of "significant" applies here too) should not declare that work complete until it has, in the same session:

1. started an Engineering Evidence Packet (`automation start --type <type> --title "<title>"`) before implementation begins;
2. appended discoveries, bugs, alternatives, decisions, tests, and verification as they happen (`automation update`), not reconstructed afterward;
3. run `automation finalize`, which resolves affected features/milestones (reusing the same query/impact tooling §14a already requires), updates canonical records **only for evidence-gated-justified actions**, rebuilds `generated/`, and runs `validate`;
4. reported any `evidence_pending`/unjustified items the finalize gate surfaced, rather than silently treating them as done;
5. confirmed Git state (`git status --short`, `git diff --check`) before commit.

This is automation of the existing 10-step lifecycle (§4) and Update Rule (§5) — it does not create a new documentation standard, and it never fabricates a bug, decision, or postmortem record merely because a session touched a file. See [scripts/product-docs/automation/README.md](../../scripts/product-docs/automation/README.md) for the full Evidence Packet schema and the three autonomy modes (STRICT/STANDARD/OBSERVE). A trivial or purely technical task (§3's exemption) does not require starting a packet at all.

## 19. Engineering Memory Layer (Part 6)

`scripts/product-docs/automation/memory/` (see [scripts/product-docs/automation/memory/README.md](../../scripts/product-docs/automation/memory/README.md) and [16_ENGINEERING_MEMORY_POLICY.md](16_ENGINEERING_MEMORY_POLICY.md)) extends §18's completion contract with a durable record of *why* the work happened the way it did, not only *that* it happened. For work that meets [16_ENGINEERING_MEMORY_POLICY.md](16_ENGINEERING_MEMORY_POLICY.md) § 8's significance bar, an AI agent should not declare that work complete until, in the same session:

1. a memory session exists — either automatically (Part 5's `automation finalize` calls `maybeCompileFromPacket` for every finalized Evidence Packet) or explicitly started (`memory start --title "..."`) for work with no linked packet;
2. meaningful plan revisions, user feedback, investigations, rejected alternatives, and accepted decisions were recorded as they happened (`memory event`/`memory feedback`/`memory revise-plan`/`memory option`/`memory decide`/...), not reconstructed afterward;
3. `memory finalize` ran (automatically via the Part 5 hook, or explicitly), producing either a compiled `AI-MEM-####` capsule or an honest "not significant" result — never silently skipped for genuinely significant work;
4. any resulting capsule was cross-linked into its primary feature file(s)' Engineering Evolution section (automatic, idempotent — `lifecycle.js`'s `crossLinkFeatures`);
5. `node scripts/product-docs/cli.js build && node scripts/product-docs/cli.js validate` passed, including the memory-specific rules in `lib/memoryValidators.js`;
6. any evidence-pending item the compiler surfaced was reported, not silently treated as resolved.

The user must not need to say "document this," "record the feedback," or "save this decision" — for significant work, this is automatic, the same way §18's Evidence Packet capture already is. A trivial task (§3's exemption; also [16_ENGINEERING_MEMORY_POLICY.md](16_ENGINEERING_MEMORY_POLICY.md) § 8's "do not create one for" list) never requires a capsule. Memory is historical evidence, not a technical contract — see that policy document § 3 before citing a capsule as authority for a current-behavior claim; cite the canonical record it explains instead.

## 20. Zero-Touch Engineering Automation (Part 7)

`scripts/product-docs/` (see [README.md](README.md) § Autonomous Engineering Intelligence (Part 7) and [scripts/product-docs/README.md](../../scripts/product-docs/README.md) § Part 7) extends §§18-19's completion contract from "an agent should do this before declaring work complete" to "the project owner should never need to ask for this at all." For significant AutoIngest work (§3's definition):

1. **Before planning**, run the repository context command for the task — `node scripts/product-docs/cli.js context task "<what you're about to do>"` (or `context feature <ID>` / `context file <path>` once you know the target) — and read the canonical documents it points to, not just the bundle itself. This is the tool-neutral entry point §14a's "query the authority index" step now routes through; any agent (Claude, Codex, Gemini, ChatGPT) can use it.
2. **Start an Evidence Packet automatically** at the start of the task (`automation start --type <type> --title "<title>"`) without waiting to be asked — the same obligation §18 already states, restated here as the default, not an optional courtesy.
3. **Append evidence as it happens** (`automation update`) — plans, revisions, alternatives, bugs, tests — exactly as §18/§19 already require.
4. **Do not manually run `automation finalize` as a substitute for real completion signal** unless the task is genuinely done in this session — pre-push (§ below) auto-finalizes any pending session whose evidence gate would already pass cleanly; finalize is a terminal action, not a checkpoint.
5. **Let the git hooks do their job once installed.** Pre-commit blocks only two things: staged `docs/product/` content with stale `generated/` output, and a STRICT-mode session overlapping staged files that isn't finalized. Pre-push auto-finalizes eligible sessions, runs full validation, and reports a push-impact summary. Post-commit links the new commit hash into the matching session without amending the commit. None of this requires a manual `product-docs` invocation — but **hook installation itself remains a separate, explicit, human-approved step** (`automation install-hooks`; preview first with `automation install-hooks --dry-run`) — never run it unless the project owner has asked for it, and never install it into a repository whose owner hasn't seen the dry-run report first.
6. **Never fabricate an architectural decision.** `automation decision-scan` (also run automatically, best-effort, inside `automation finalize` — see `automation/decisionIntelligence.js`) only ever drafts a `Status: Draft` decision record when the session's own recorded evidence already clears the existing decision-record bar (§18's documentationPlanner rule, unchanged). If a structural signal is detected but evidence is incomplete, it becomes a local candidate, not a canonical record — surface its `review_question` to the project owner as **one focused engineering question** (see the example in the Part 7 brief), never a documentation questionnaire.
7. **Never force a single owner onto a shared file.** `node scripts/product-docs/cli.js automation ownership <path>` (or `context file <path>`) returns every plausible owner with a confidence score and cites its evidence — `main/main.js`, `renderer/renderer.js`, and other genuinely shared files are expected to resolve to many features; do not pick one arbitrarily.
8. **Release preparation never publishes.** `node scripts/product-docs/cli.js release prepare --to <ref>` produces a draft only — reviewing it, turning it into `docs/release-notes-*.md`, creating a Git tag, and publishing a GitHub release remain separate, explicitly authorized human actions, exactly as `automation release-draft` already established in Part 5.

The project owner must not need to say "start tracking this," "check who owns this file," "is this a breaking change," or "write the release notes" — for significant work, this is automatic, the same way §§18-19's Evidence Packet and Memory Capsule capture already are.

## 21. Multi-AI Engineering Conversation Integration (Part 8)

`scripts/product-docs/automation/conversation/` (see [scripts/product-docs/automation/conversation/README.md](../../scripts/product-docs/automation/conversation/README.md) and [18_ENGINEERING_CONVERSATION_POLICY.md](18_ENGINEERING_CONVERSATION_POLICY.md)) extends §19's memory layer to engineering discussions that happen **outside** this repository's own sessions — ChatGPT, an external Claude conversation, Codex, Gemini, a human meeting, or any future tool. The project owner never manually retypes a decision, requirement, or rejected approach from one of those discussions into Markdown:

1. When an external AutoIngest engineering discussion reaches a meaningful conclusion, the source tool (or the user, following [conversations/CHATGPT_HANDOFF.md](conversations/CHATGPT_HANDOFF.md)'s instruction) produces an Engineering Conversation Packet (ECP 1.0).
2. `node scripts/product-docs/cli.js conversation import --format ecp --file <path>` (or `conversation process-inbox` for the local, gitignored `.autoingest-docs/conversations/inbox/`) redacts, schema-validates, deduplicates, resolves likely feature/roadmap/bug/decision/memory ownership, and — only if the packet clears its own significance bar ([18_ENGINEERING_CONVERSATION_POLICY.md](18_ENGINEERING_CONVERSATION_POLICY.md) § 8) — allocates a permanent `ENG-CONV-####` and writes the canonical record.
3. `context conversation ENG-CONV-####` / `context task "<topic>"` surface that conversation the same way §20's `context <sub>` already surfaces canonical docs — below canonical authority, above generic inference (§ 3 of the policy).
4. When a later commit actually implements what the conversation requested, post-commit reconciliation transitions the conversation's `Outcome` to Implemented automatically — never inferred from the conversation text alone, always from real repository evidence (a linked commit).

**Never fabricate a canonical decision or bug from conversation text alone.** Decision/bug linkage from an imported conversation is deliberately isolated from §20's live Evidence Packet auto-finalize pipeline — a `Status: Draft` decision is only ever created via an explicit `conversation import`/`conversation finalize` invocation, never automatically inside a git hook, so an untrusted external transcript can never indirectly shape a canonical record through `git commit`/`git push` alone (see [18_ENGINEERING_CONVERSATION_POLICY.md](18_ENGINEERING_CONVERSATION_POLICY.md) § 10). A bug discussed in an imported conversation is linked to an existing `BUG-###` if one matches; it is never sufficient on its own to create a new canonical bug record or declare a defect fixed.

The project owner should never need to say "summarize that ChatGPT conversation into the docs" — for a conversation with real engineering content, importing the packet is the only manual step; everything downstream (linking, indexing, unimplemented-requirement tracking) is automatic, the same way §§18-20's automation already is.

## Non-negotiables (quick checklist)

- Preserve stable IDs — never reuse, never renumber.
- Update documentation alongside meaningful feature work, not after the fact from memory.
- Never silently erase original plans or superseded approaches — append and mark, don't delete.
- Never let a generated export (`exports/`) become authoritative — it is regenerated from the Markdown, never edited directly.
- Never contradict an authoritative technical doc under `docs/` — the technical doc always wins; fix this system and record the reconciliation.
- Never mark a feature `Implemented` (or a milestone `Complete`) without evidence — evidence-pending is honest; a fabricated-sounding "done" is not.
- Never invent a relationship, date, bug, decision, or incident that repository evidence doesn't support.
- Never treat `docs/product/generated/` as a source — it's a locator built from the canonical Markdown above; rebuild it (`node scripts/product-docs/cli.js build`) rather than hand-editing it, and run `validate` before trusting it.
- Never treat a `docs/product/memory/AI-MEM-####` capsule as authoritative over a canonical record — it explains *why*, never overrides *what* — and never fabricate its Original Request/plan-revision content when the source conversation is genuinely unavailable; write "Evidence pending — source conversation unavailable" instead (see [16_ENGINEERING_MEMORY_POLICY.md](16_ENGINEERING_MEMORY_POLICY.md)).
- Never treat a `docs/product/conversations/ENG-CONV-####` record as authoritative over a canonical record, and never claim automatic access to an external tool's history — only what was explicitly imported via `conversation import` (see [18_ENGINEERING_CONVERSATION_POLICY.md](18_ENGINEERING_CONVERSATION_POLICY.md)).
