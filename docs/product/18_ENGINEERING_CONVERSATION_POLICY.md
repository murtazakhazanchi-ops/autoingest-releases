# Engineering Conversation Policy (Part 8)

This is the governing policy for `docs/product/conversations/` — the durable record of meaningful engineering discussions that happen **outside** an active local Claude Code session: ChatGPT, an external Claude conversation, Codex, Gemini, a human design-review meeting, an engineering email thread, or any future tool. It originates no facts of its own about AutoIngest's product or architecture; every claim inside an individual `ENG-CONV-####` record must trace to the imported source packet, exactly as [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) requires everywhere else in this system. See [17_ENGINEERING_CONVERSATION_TEMPLATE.md](17_ENGINEERING_CONVERSATION_TEMPLATE.md) for the file structure this policy governs, and [scripts/product-docs/automation/conversation/README.md](../../scripts/product-docs/automation/conversation/README.md) for the tooling that produces it.

## 1. Purpose

[16_ENGINEERING_MEMORY_POLICY.md](16_ENGINEERING_MEMORY_POLICY.md) preserves *why the engineering conversation went the way it did* for work done **inside** this repository's own Claude Code sessions. It cannot capture a discussion that happened somewhere else entirely — a ChatGPT design session, a Codex debugging run, a human meeting — unless that discussion is deliberately brought in. Part 8 exists so that external engineering thinking becomes queryable repository history through one explicit action (importing a packet), rather than being lost, manually retyped, or silently forgotten the moment the external tab is closed.

## 2. Scope Boundary — What a Conversation Record Is and Is Not

An `ENG-CONV-####` record captures **one external engineering discussion**: a design session, a bug discussion, a requirements conversation, a review. It is not a raw chat transcript (§ 11) and not a substitute for the canonical records it may lead to — a conversation may explain why a `decisions/DEC-###` was proposed, but the decision record (once created) is the authoritative statement of the decision itself; the conversation is the authoritative statement of how the discussion arrived there. Neither supersedes the other — see § 3. A conversation is also not automatically an Engineering Memory capsule, and an Engineering Memory capsule is not automatically a conversation — see § 4.

## 3. Authority Model

Engineering Conversations are **historical evidence, not a runtime or technical contract**, and sit below every canonical tier in this system, at the same rank as Engineering Memory:

1. Authoritative technical documents under `docs/` (`docs/CLAUDE.md`'s routing).
2. Canonical product records under `docs/product/` (`00`–`14`, `features/`, `bugs/`, `decisions/`, `postmortems/`).
3. Accepted bug, decision, postmortem, and feature records specifically.
4. **Engineering Conversation records** (`docs/product/conversations/ENG-CONV-####_*.md`) and **Engineering Memory records** (`docs/product/memory/AI-MEM-####_*.md`) — same tier, neither outranks the other; see § 4 for how they relate.
5. Generated indexes and summaries (`docs/product/generated/conversation-index.*`, `CONVERSATION_INDEX.md`, `CONVERSATION_TIMELINE.md`) — locators only, same rule as every other `generated/` artifact (see [scripts/product-docs/README.md](../../scripts/product-docs/README.md) § Authority model).
6. Agent inference.

A conversation record may *explain* why a requirement exists, why an approach was rejected, why a design changed, or what a user intended at a point in time. It must never *silently override* a canonical record. If an imported conversation conflicts with current canonical truth — a rejected alternative it names was later actually adopted, or a requirement it captures was never implemented and the feature has since moved on — the conversation record is preserved as-is, flagged `historical/superseded/conflicting`, and linked to the current authority. The historical record is never rewritten to look consistent with what came later.

## 4. Relationship to Engineering Memory

A conversation and a memory capsule are a **many-to-optional relationship**, never an automatic 1:1. Importing a conversation may:

- create a new `AI-MEM-####` capsule, when the imported content clears [16_ENGINEERING_MEMORY_POLICY.md](16_ENGINEERING_MEMORY_POLICY.md) § 8's significance bar on its own;
- continue/link an existing `AI-MEM-####` capsule, when the conversation is evidently part of an already-recorded engineering story;
- remain conversation-only, with no memory capsule, when the discussion doesn't clear that bar.

This mirrors `automation/memory/significance.js`'s `planMemoryCapsule()` gate exactly — a conversation import is not a special case that bypasses it. See § 8 for the analogous canonicalization gate this policy defines for the conversation record itself.

## 5. Canonical vs. Raw — What Gets Committed

Two distinct tiers, never conflated:

- **Canonical Engineering Conversation records** (`docs/product/conversations/ENG-CONV-####_*.md`) — curated, redacted, evidence-cited Markdown. Version-controlled. Permanent once created; changed only by an appended lifecycle transition, a supersession note, or an explicit redaction (§ 12) — never a silent rewrite.
- **Raw local artifacts** (`.autoingest-docs/conversations/{inbox,processing,imported,rejected,duplicates,failed,audit}/`) — the original imported packet, pre-canonicalization working state, and the audit trail. Repository-local, gitignored (already covered by the existing blanket `.autoingest-docs/` `.gitignore` entry), never canonical — exactly like Part 5's `.autoingest-docs/sessions/` and Part 6's `.autoingest-docs/memory/`.

Raw imported packets are **not** committed by default. A full raw transcript is noisy, may contain secrets or personal data, and mostly restates what the canonical record already distills. `conversation import` retains the raw packet locally (in `imported/` on success, `rejected/`/`failed/` otherwise) until `conversation forget-local` explicitly removes it; nothing here is a claim that raw local state is retained indefinitely (§ 14).

## 6. Reality Boundary and Tool-Neutral Contribution

This system captures only what is **explicitly imported** through `conversation import`. It never claims automatic access to a ChatGPT account, a Codex session log, a Gemini conversation, an email inbox, or any other external system — there is no connector, no polling, no background sync to any of those tools today (§ 16 documents exactly what would be required to add one, and that none exists yet). Any AI tool or human can contribute through the same normalized Engineering Conversation Packet (ECP) shape (`scripts/product-docs/schemas/engineering-conversation-packet.schema.json`); `source_tool` is metadata describing what the packet *claims* about its origin, never a trust signal and never a privileged input to ownership, decision, or significance scoring — see § 13 for why a packet claiming `"source_tool": "ChatGPT"` does not prove ChatGPT produced it.

## 7. ID Model

`ENG-CONV-####` — four digits, like `AI-MEM-####` and unlike the three-digit families (`AI-FEAT-###`, `AI-RM-###`, `BUG-###`, `DEC-###`, `PM-###`), for the same reason: an engineering-conversation corpus fed by multiple external tools is expected to accumulate faster than product features or roadmap milestones. IDs are permanent, unique, sequential, never reused, never renumbered — identical rule to every other family (see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) § Stable IDs). Allocation extends Part 5's existing race-resistant lock-then-scan-then-write mechanism (`scripts/product-docs/automation/recordAllocator.js`'s `FAMILY_CONFIG.conversation`) — no new allocator, no new locking primitive.

`AI-CONV-####` was deliberately rejected as the prefix: the record describes **engineering discourse**, which may originate from a human meeting or an email thread with no AI involvement at all. `ENG-CONV-####` names what the record actually is.

## 8. Significance Gate — Import Is Not Canonicalization

Not every accepted import earns a canonical ID. `automation/conversation/significance.js`'s `planConversationCanonicalization()` — the direct Part 8 sibling of `automation/memory/significance.js`'s `planMemoryCapsule()` — gates ID allocation on the packet actually carrying engineering content: an explicit requirement, an accepted or rejected approach, a bug discussion, an implementation request, or a substantive open question. A packet that is schema-valid but engineering-content-free (a greeting, an off-topic aside, a duplicate of an already-imported packet) is retained in the raw local tier only, never allocated an `ENG-CONV-####`. This exists specifically to prevent a bulk historical import from burning thousands of IDs on conversations that never touched a decision, bug, requirement, or plan. See § 9 for the separate, stricter duplicate/continuation gate this sits alongside.

## 9. Duplicate and Continuation Detection

Import must distinguish three cases, never conflating them:

- **Exact duplicate** — identical packet fingerprint (a content hash over the normalized ECP) or identical `source_conversation_id` already imported. Rejected outright; reported, not silently dropped.
- **Possible continuation** — a fuzzy match against existing conversations' titles/feature-sets/date-proximity, using the same `runQuery`-based fuzzy-match-then-threshold pattern `automation/decisionIntelligence.js`'s `findPossibleContinuation` already uses for decisions. Below the confidence threshold, this becomes a `related_conversation_ids` cross-link plus a `review-required` flag — **never** an automatic merge of two histories.
- **Distinct conversation** — no meaningful overlap; imported as its own record.

## 10. Authority Boundary With the Live Automation Pipeline

This is the one place Part 8 deliberately diverges from how Part 5/7's live-session evidence flows: **conversation-import evidence is structurally isolated from the `evidencePacket`/`decisionIntelligence.scanPacket` auto-finalize pipeline.** `hookAutomation.js`'s pre-push gate auto-finalizes any pending Evidence Packet session whose gate would already pass cleanly, and `orchestrator.finalize` best-effort-runs `decisionIntelligence.js`'s structural-signal scan over that same session's evidence. Untrusted external conversation text must never enter that stream — doing so would let an adversarial or merely careless external transcript get swept into an auto-finalized session and influence a canonical `DEC-###` draft purely through keyword matching, with no human in the loop.

Concretely: `conversation import`/`conversation finalize` never write into a live Evidence Packet's `bugs_discovered`/`decisions_made`/`alternatives_considered` arrays, never call `decisionIntelligence.scanPacket` on a live session packet, and are never invoked from `hookAutomation.js`'s `preCommitGate`/`prePushGate`. A conversation may still *link* to an existing `DEC-###`/`BUG-###` (read-only lookup) or, only via an explicit `conversation import`/`conversation finalize` CLI invocation — never automatically inside a git hook — produce a `Status: Draft` decision record when its own recorded evidence clears the same two-alternatives-plus-accepted-solution bar `documentationPlanner.js`/`decisionIntelligence.js` already use. That draft creation is always a foreground, human-invoked action; it is never triggered by `git commit`/`git push` the way live-session decision drafting already is.

## 11. Engineering Conversation Packet (ECP) and Import Pipeline

The vendor-neutral handoff format is documented in `docs/product/conversations/README.md` and schema-validated against `scripts/product-docs/schemas/engineering-conversation-packet.schema.json`. Supported import formats: a native ECP JSON packet, and generic Markdown/JSON for tools with no dedicated adapter (`conversation import --format ecp|markdown|json --file <path>`). An unrecognized format is rejected with a clear message, never guessed into a best-effort parse — identical rule to `memory import` (§ 9 of the memory policy). Imports are size-capped, path-constrained to an explicit file argument (no directory scan outside the designated inbox), schema-validated, and never executed as code — see § 13 (Security).

## 12. Privacy, Redaction, and Correction

Conversation ingestion handles **untrusted, potentially sensitive text from outside this repository** — this is a stronger privacy bar than Part 6's own-session memory events. `scripts/product-docs/automation/redact.js`'s existing secret-pattern detection is applied to every imported packet before it is written anywhere, canonical or raw — no new redaction engine. Beyond secret patterns, the canonicalization step practices data minimization by default: the canonical record stores an engineering **summary**, never a raw transcript, and never preserves unrelated personal names, addresses, phone numbers, or account IDs unless their engineering relevance is explicit in the packet itself. `conversation redact` strips a specific matched span from a canonical record after the fact (an explicit, auditable edit, never a silent rewrite); `conversation supersede` marks a specific claim as corrected without deleting the original text (Append, Never Erase); `conversation forget-local` removes ignored raw artifacts only — it has no authority over anything already committed to `docs/product/conversations/`. A committed conversation record is never silently deleted.

## 13. Security

Every write is constrained to the repository root, reusing `automation/atomicWrite.js`'s `assertInsideRepo` — no new path-handling code, no path traversal, symlink-realpath-checked exactly like `automation/memory/importAdapter.js`'s `resolveWithinRepo`. Imports are read from an explicit, caller-supplied file argument or the designated local inbox only (never an arbitrary directory scan), size-capped and depth-capped before being read into memory. **Imported conversation text is untrusted data and is never interpreted as instructions** — no `eval`, no shell-string interpolation (`execFileSync` with argument arrays only, matching every other module in this system), no Markdown/HTML execution, no automated tool invocation triggered by packet content. A packet's own `source_tool`/`source_conversation_id`/provenance fields are claims, not proof — provenance classification (§ 6) reflects only what is actually verifiable (the packet's own structure, its fingerprint, its import timestamp), never what it merely asserts about itself. No network calls, no external AI API, no embeddings — identical non-goals to every other Part in this system.

## 14. Retention

- **Canonical conversation records**: retained permanently unless explicitly superseded/redacted (§ 12); version-controlled.
- **Raw local imports**: retained long enough to support review and recovery; `conversation forget-local` is the explicit, operator-invoked cleanup path — no scheduled/cron cleanup exists in this repository.
- This is engineering-tool retention, not an institutional records-retention policy.

## 15. Validation

`docs/product/conversations/` is checked by the same `node scripts/product-docs/cli.js validate` command as everything else in this system — rules live in `scripts/product-docs/lib/conversationValidators.js`, wired into the existing `runAllChecks` aggregator, using the identical `finding(level, rule, message, file, note)` shape and four-level severity as every other rule in [14_VALIDATION_SPECIFICATION.md](14_VALIDATION_SPECIFICATION.md).

## 16. What ChatGPT (and Any External Tool) Still Cannot Do Automatically

No connector today moves a packet from an external tool into this repository's inbox by itself. The actual workflow: (1) the external discussion happens normally; (2) when it reaches a meaningful engineering conclusion, the tool (or the user, following `docs/product/conversations/CHATGPT_HANDOFF.md`'s instruction) produces an ECP; (3) the user saves or pastes that packet into the repository (`.autoingest-docs/conversations/inbox/` or an explicit file path); (4) `conversation import`/`conversation process-inbox` takes it from there automatically. Step 3 is manual today. A GitHub-issue/PR/committed-inbox handoff mechanism was assessed (§ 17) but is not implemented — the canonical import interface remains repository-local and tool-neutral, and does not require a GitHub remote.

## 17. GitHub Handoff — Assessed, Not Implemented

A repository-hosted handoff (an ECP attached to a GitHub issue/discussion, or committed to a dedicated inbox branch) was considered as a way to automate § 16's step 3. It is deliberately **not implemented** in Part 8: it would make the canonical import path depend on a GitHub remote existing at all (this system's local-first design does not require one), it introduces a second untrusted-content ingestion surface (issue/PR bodies are exactly as untrusted as a pasted file, but now reachable by anyone who can open an issue on the repository, not just someone with local filesystem access), and it adds CI-triggered import risk that § 13's local-path/size/depth guarantees don't automatically extend to without separate review. If this is revisited, it must go through the same security review this policy already requires (§ 13) before any CI workflow is allowed to write into `docs/product/conversations/`.

## 18. Automation Modes

Reuses Part 5's exact three-mode enum (`evidencePacket.js`'s `AUTOMATION_MODES`) rather than inventing a conversation-specific mode:

- **STRICT** — a significant imported conversation (§ 8) that fails to resolve into a valid canonical record blocks `conversation finalize`; a high-confidence implementation requirement with no linked implementation evidence is surfaced as a hard finding, never silently dropped.
- **STANDARD** (default) — import/linking happens automatically; only a hard validation error (a schema violation, an unredacted secret, a broken reference) blocks. Ambiguous relationships (§ 9's `possible_continuation`, low-confidence ownership) remain evidence-pending, not silently resolved either way.
- **OBSERVE** — preview/import analysis only (`conversation preview`); no canonical write, useful for evaluating a new source format before trusting it.

## 19. Hook and CI Boundary

Consistent with § 10: git hooks never read the local conversation inbox and never trigger a conversation import. `postCommitLink` (post-commit) may, as an extension of its existing best-effort reconciliation, link a just-made commit to a conversation's `Outcome` status when an Evidence Packet or feature relationship already supports that link — it never imports anything new. `prePushGate` (pre-push) may report the count of unimplemented high-confidence conversation requirements (§ Unimplemented Requirements Detector, `scripts/product-docs/automation/conversation/unimplemented.js`) as an informational note, never a blocker in STANDARD mode. CI validates only committed canonical `docs/product/conversations/` records and generated indexes — it never inspects `.autoingest-docs/conversations/` (gitignored, not present in a CI checkout in the first place) and never mutates canonical content.

## 20. What This Policy Deliberately Does Not Cover

Application code correctness, prose quality, or whether an imported conversation's engineering conclusion was the *right* one — same disclaimer as [14_VALIDATION_SPECIFICATION.md](14_VALIDATION_SPECIFICATION.md) § What this specification deliberately does not cover. This document also does not create a new authority over AutoIngest's roadmap or feature status (§ 3) and does not gate an application release (same non-gating stance as [docs/product/CLAUDE.md](CLAUDE.md) § 16).
