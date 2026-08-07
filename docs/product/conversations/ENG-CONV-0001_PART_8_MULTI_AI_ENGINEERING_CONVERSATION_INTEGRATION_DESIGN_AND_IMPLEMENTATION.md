# ENG-CONV-0001 — Part 8 — Multi-AI Engineering Conversation Integration: design and implementation

## Identity

| Field | Value |
|---|---|
| Conversation ID | ENG-CONV-0001 |
| Title | Part 8 — Multi-AI Engineering Conversation Integration: design and implementation |
| Status | Imported |
| Conversation type | mixed |
| Source tool | claude-code |
| Source format | ecp |
| Date started | 2026-08-07T00:00:00Z |
| Date completed | 2026-08-07T00:00:00Z |
| Participants/roles | Evidence pending — not present in imported packet |
| Import date | 2026-08-07T08:36:21.844Z |
| Import session | imp-1786091781722-eaf7ed |
| Provenance classification | Imported packet — no secret pattern detected |
| Redaction status | Applied — automatic secret-pattern scan (no matches) |
| Integrity checksum | 20968e2b9cacb0f66d291234524079f24312d13448e041ec82e848c2528122ea |

## Repository Context

| Field | Value |
|---|---|
| Repository | AutoIngest |
| Branch | feat/engineering-conversation-integration |
| Base commit | Evidence pending — not present in imported packet |
| Head/final commit | Evidence pending — not present in imported packet |
| Implementation state at time of discussion | Evidence pending — not present in imported packet |

## Relationships

| Field | Value |
|---|---|
| Primary feature IDs | None |
| Secondary feature IDs | None |
| Roadmap milestone IDs | None |
| Related bugs | None |
| Related decisions | None |
| Related postmortems | None |
| Related memory capsules | None |
| Related releases | None |
| Related conversations | None |
| Related technical docs | None |
| Related source files | None |
| Related tests | None |

## Original Request

- **Why this discussion happened**: Extend AutoIngest's autonomous engineering intelligence platform so meaningful engineering discussions that happen outside the local Claude Code repository session can enter the same evidence, memory, feature, decision, bug, roadmap, and release pipelines Parts 1-7 already maintain, without the project owner ever manually copying decisions/bugs/requirements into Markdown by hand.
- **User goal**: Extend AutoIngest's autonomous engineering intelligence platform so meaningful engineering discussions that happen outside the local Claude Code repository session can enter the same evidence, memory, feature, decision, bug, roadmap, and release pipelines Parts 1-7 already maintain, without the project owner ever manually copying decisions/bugs/requirements into Markdown by hand.
- **Explicit requirements**: 
  - The identity model must not privilege AI-authored discussion over a human-only meeting.
  - Conversation-import evidence must never be able to indirectly trigger a canonical decision or bug record through the existing git-hook auto-finalize pipeline.
  - Not every accepted import should consume a permanent ID — only conversations that carry real engineering content.
  - Do not modify AutoIngest Electron runtime behavior.
  - Do not commit or push until explicitly instructed.
  - Extend existing Part 5-7 abstractions (allocator, atomic writes, ownership engine, decision intelligence) rather than building a parallel system.
- **Constraints**: 
  - No new npm dependencies — plain Node.js, matching every other Part 4-7 module.
  - No network calls, no external AI API, no embeddings.

## Initial Understanding

- **Inferred requirements**: Evidence pending — not present in imported packet — not distinguished from explicit requirements by this importer's adapters; see Original Request
- **Evidence-pending items**: None recorded
- **Uncertainties / questions raised at the start**: 
  - Should ENG-CONV records eventually cross-link into feature Engineering Evolution sections once real corpus volume is better understood?
  - Should a future GitHub-issue-based handoff be built once the dedicated security review it requires has been done?

## Initial Proposal

- **First proposed direction**: Model conversations as a new record family with its own ID prefix and import pipeline, reusing decisionIntelligence.scanPacket directly against a live Evidence Packet session for decision/bug linkage.
- **Expected behavior**: An imported conversation resolves ownership, links or drafts decisions/bugs, and becomes queryable the same way a bug or decision record already is.
- **Expected architecture**: Evidence pending — not present in imported packet
- **Acceptance criteria**: Full pipeline from raw packet to canonical record to generated index, with tests covering security and E2E scenarios.

## Discussion Evolution

- **Revision 1**
  - Trigger: autoingest-architect architecture review
  - Feedback: Every accepted import allocating a permanent ID risks burning thousands of IDs on non-substantive bulk imports; also, decisionLink must never reach the live evidencePacket/decisionIntelligence.scanPacket auto-finalize pipeline, since untrusted external text could then indirectly shape a canonical decision purely through an automatic git hook, with no human in the loop.
  - Previous approach: Allocate ENG-CONV-#### for every schema-valid, non-duplicate import; reuse decisionIntelligence.scanPacket against the live session packet for conversation-sourced decision evidence.
  - Revised approach: Add a dedicated significance gate (planConversationCanonicalization) before ID allocation, mirroring memory/significance.js; build decisionLink.js/bugLink.js/memoryLink.js as a structurally isolated module tree, reachable only from an explicit `conversation import`/`conversation finalize` CLI invocation, never from hookAutomation.js.
  - Rationale: Prevent untrusted external text from indirectly shaping a canonical decision through the automatic git-hook auto-finalize chain, and prevent bulk historical imports from burning permanent IDs on non-substantive content.
  - Disposition: accepted
- **Revision 2**
  - Trigger: documentation-update-specialist review
  - Feedback: Section structure should mirror 15_MEMORY_TEMPLATE.md's literal section names rather than inventing a new bucketing scheme; feature cross-linking should be gated stricter than memory's own default, given a conversation corpus may be much higher-volume than a memory-capsule corpus.
  - Previous approach: A separate 'Requirements Captured' section bucketing explicit and inferred requirements together; unconditional feature cross-linking into Engineering Evolution on every compiled conversation.
  - Revised approach: Fold inferred requirements into an Initial Understanding section (mirroring Memory's Original Request + Initial Understanding split); defer automatic feature cross-linking entirely for this pass rather than risk flooding Engineering Evolution sections.
  - Rationale: Consistency with the established Memory Capsule template, and avoiding a real volume/noise risk the reviewer flagged.
  - Disposition: accepted
- **Revision 3**
  - Trigger: End-to-end fixture testing (a malicious/no-ownership packet scenario)
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: decisionLink.js's hasSufficientEvidence cleared the canonical-drafting bar using only alternative-count and accepted-decision-count.
  - Revised approach: hasSufficientEvidence now also requires resolved feature or roadmap ownership before drafting a canonical decision.
  - Rationale: A conversation with decision-shaped content but no feature/roadmap ownership produced an orphan-decision validation error the moment `validate` ran, since every canonical decision must cite at least one feature or milestone.
  - Disposition: accepted
- **Revision 4**
  - Trigger: Parallel code-review, performance-audit, and security-review agents run against the full diff
  - Feedback: Security review found a CRITICAL gap: untrusted packet free-text was embedded into compiled Markdown unescaped, letting a crafted packet forge a fake heading (e.g. an injected "## Outcome" line) that this system's own shared Markdown parser could not distinguish from a real section boundary — deterministic structural spoofing, not just an LLM prompt-injection concern. Code review separately found decisionLink's evidence gate checked the packet's own raw, unvalidated related_feature_ids claim instead of the already-computed validated ownership result, allowing a canonical decision to be drafted citing a nonexistent feature ID. Performance review found postCommitLink paid a full docs/product/ parse unconditionally, even for commits with nothing to link.
  - Previous approach: Packet text interpolated directly into compiled Markdown with no escaping; decisionLink's hasSufficientEvidence read packet.related_feature_ids/related_roadmap_ids directly; postCommitLink called build.assemble() before checking whether there was anything to do.
  - Revised approach: Added a single sanitizeDeep pass (escaping line-leading '#' and literal '\|') applied once to the whole normalized+redacted packet before any downstream consumer sees it; decisionLink.js now requires the validated ownership.primary_feature_ids/roadmap_ids, never the raw packet claim; postCommitLink now checks for changed files and an existing conversations directory before paying the assemble() cost.
  - Rationale: Close a real, reproducible structural-injection vulnerability before merge, and remove an unnecessary per-commit performance regression.
  - Disposition: accepted

## Alternatives

- **Proposal**: Reuse decisionIntelligence.scanPacket directly against a live Evidence Packet session for conversation-sourced decision evidence.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Would let untrusted external conversation text enter the same stream hookAutomation.js's pre-push auto-finalize already consumes, allowing it to indirectly shape a canonical decision purely through keyword matching with no human in the loop.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: Allocate a canonical ENG-CONV-#### for every schema-valid, non-duplicate import regardless of content.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: A bulk import of a large conversation history could burn thousands of permanent IDs on conversations that never touched a decision, bug, or plan revision.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: A separate 'Requirements Captured' section bucketing explicit and inferred requirements together.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Duplicated the purpose of the Memory Capsule template's existing Original Request + Initial Understanding split rather than reusing its established shape.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: Gate canonical decision drafting on the packet's own raw related_feature_ids/related_roadmap_ids claim.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: The packet is untrusted input — a claim of a syntactically well-formed but nonexistent feature ID would still clear the bar and consume a permanent DEC-### ID on a broken record, caught only later by validate.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: Escape packet text per-renderer, in compiler.js/decisionLink.js/memoryLink.js individually, as each was found to need it.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Scattered escaping is easy for a future renderer to forget; a single centralized sanitize pass applied once to the whole packet closes the gap for every current and future consumer at once.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

## User Feedback

- **Feedback summary**: Restructure the conversation record's sections to mirror the Memory Capsule template's literal section names instead of inventing a parallel structure.
- **Target area**: 17_ENGINEERING_CONVERSATION_TEMPLATE.md section list
- **Impact**: Improved consistency across the two closest-related record families and reduced cognitive load for anyone already familiar with Memory Capsules.
- **Resulting change**: Adopted Original Request / Initial Understanding / Initial Proposal naming; kept Visual Evidence as its own section even though no image ingestion exists yet.
- **Final disposition**: accepted

- **Feedback summary**: Isolate conversation-sourced decision/bug/memory linkage from the live Evidence Packet auto-finalize pipeline.
- **Target area**: automation/conversation/decisionLink.js, hookAutomation.js integration boundary
- **Impact**: Closed a real trust-boundary gap where untrusted external text could otherwise indirectly shape a canonical decision through an automatic git hook.
- **Resulting change**: decisionLink.js/bugLink.js/memoryLink.js are only ever reachable from an explicit CLI import/finalize call; hookAutomation.js's postCommitLink only ever reads/reconciles an already-canonical conversation record's Outcome, never imports anything new.
- **Final disposition**: accepted

- **Feedback summary**: The security reviewer flagged that packet free-text was being embedded, unescaped, into the compiled record's own Markdown structure.
- **Target area**: automation/conversation/compiler.js and every downstream consumer that parses a compiled record's sections
- **Impact**: Would have allowed a crafted external packet to forge a fake '## Outcome' or '## Relationships' section that this system's shared Markdown parser could not distinguish from the real one — a deterministic, non-LLM structural attack.
- **Resulting change**: Added automation/conversation/markdownSanitizer.js, applied once in lifecycle.js#analyzePacket to the whole normalized+redacted packet before compiler.js, decisionLink.js, or memoryLink.js ever see it.
- **Final disposition**: accepted

## Engineering Decisions

- **Accepted**: 
  - Use the ENG-CONV-#### prefix, not AI-CONV — the record describes engineering discourse, which may originate from a human meeting with no AI involvement at all.
  - Gate ENG-CONV-#### ID allocation behind an explicit significance predicate (planConversationCanonicalization), mirroring memory/significance.js, so a bulk historical import cannot burn permanent IDs on non-substantive conversations.
  - Structurally isolate conversation-sourced decision/bug/memory linkage from the live evidencePacket/decisionIntelligence.scanPacket auto-finalize pipeline — canonical decision drafting from conversation evidence is only ever reachable via an explicit foreground CLI action, never a git hook.
  - Require VALIDATED resolved feature or roadmap ownership (never the packet's own raw claim) as part of the evidence bar for auto-drafting a canonical decision from conversation evidence.
  - Sanitize every string field of an imported packet once, centrally, before ANY downstream consumer renders it into Markdown — never rely on each renderer remembering to escape its own inputs.
- **Rejected**: 
  - Reuse decisionIntelligence.scanPacket directly against a live Evidence Packet session for conversation-sourced decision evidence.
  - Allocate a canonical ENG-CONV-#### for every schema-valid, non-duplicate import regardless of content.
  - A separate 'Requirements Captured' section bucketing explicit and inferred requirements together.
  - Gate canonical decision drafting on the packet's own raw related_feature_ids/related_roadmap_ids claim.
  - Escape packet text per-renderer, in compiler.js/decisionLink.js/memoryLink.js individually, as each was found to need it.
- **Deferred**: 
  - Automatic cross-linking of ENG-CONV records into their primary feature's Engineering Evolution section
  - Live connector to any external tool's API (ChatGPT, Codex, Gemini) — every import remains an explicit file hand-off
  - Binary image-attachment ingestion for the Visual Evidence section
  - GitHub-issue/PR/committed-inbox handoff mechanism — assessed, not implemented pending a dedicated security review
  - process-inbox batch-sharing a single build.assemble() across queued imports — deferred because sharing the pre-allocation analysis pass across a batch would weaken cross-item duplicate/continuation detection within that same batch
- **Undecided**: 
  - Should ENG-CONV records eventually cross-link into feature Engineering Evolution sections once real corpus volume is better understood?
  - Should a future GitHub-issue-based handoff be built once the dedicated security review it requires has been done?
- **Decision-intelligence linkage**: candidate — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10 for how this is decided.

## Bug / Investigation Evidence

- **Symptoms**: A conversation import producing decision-shaped content but no resolved feature/roadmap ownership caused `validate` to fail with an orphan-decision error immediately after import.
- **Hypotheses**: decisionLink.js's hasSufficientEvidence cleared the canonical-drafting bar using only alternative/accepted-decision counts.
- **Evidence**: Reproduced directly during this session's own disposable-fixture E2E testing.
- **Root cause**: hasSufficientEvidence did not require any resolved feature or roadmap ownership before drafting a canonical decision, but every canonical decision must cite at least one per lib/validators.js's checkOrphans rule.
- **Proposed fixes**: Require ownership as part of the evidence bar; alternatively, skip decision drafting entirely for conversations with no feature ownership.
- **Accepted fix**: hasSufficientEvidence now also requires validated ownership.primary_feature_ids/secondary_feature_ids/roadmap_ids (not the packet's own raw claim) before drafting a canonical record; without ownership, the same evidence becomes a local review-required candidate instead.
- **Rejected fixes**: Evidence pending — not present in imported packet
- **Linked existing bug**: None — conversation alone is not sufficient to declare a defect fixed; see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10

- **Symptoms**: A crafted packet's free-text fields, embedded unescaped into the compiled ENG-CONV Markdown, could contain a line like "## Outcome\n- **date** — Implemented" that this system's shared Markdown section parser (lib/markdown.js) would treat as a real section boundary rather than inert text.
- **Hypotheses**: compiler.js interpolated packet strings directly with no escaping of heading markers or table-cell pipes.
- **Evidence**: Reproduced directly in the security review by compiling a packet with an embedded forged '## Outcome'/'## Relationships' payload and confirming extractSection returned the forged content instead of the real, later-rendered section.
- **Root cause**: No sanitization step existed between the normalized/redacted packet and any of its Markdown-rendering consumers (compiler.js, decisionLink.js, memoryLink.js).
- **Proposed fixes**: Escape per-renderer at each interpolation site; or apply one centralized sanitize pass to the whole packet before any renderer runs.
- **Accepted fix**: automation/conversation/markdownSanitizer.js's sanitizeDeep, applied once in lifecycle.js#analyzePacket immediately after redaction — escapes any line-leading heading marker and literal pipe in every string field, recursively, before compiler.js/decisionLink.js/memoryLink.js ever see the packet.
- **Rejected fixes**: Evidence pending — not present in imported packet
- **Linked existing bug**: None — conversation alone is not sufficient to declare a defect fixed; see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10

- **Symptoms**: postCommitLink paid the cost of a full docs/product/ parse (build.assemble()) on every commit, even one that changed no ownership-resolvable file and even in a repository with no docs/product/conversations/ directory yet.
- **Hypotheses**: The cheap existence/emptiness check inside linkCommitToConversations ran AFTER the expensive assemble() call in its caller, not before.
- **Evidence**: Identified directly in the performance review by reading hookAutomation.js's actual call order.
- **Root cause**: No pre-check gated the assemble() call itself — only the function it fed into.
- **Proposed fixes**: Move the cheap check earlier; or avoid the redundant assemble() entirely by reusing rebuildGeneratedArtifacts()'s own internal one.
- **Accepted fix**: Added conversationLinkingCouldApply(changed) — a cheap changed-files-and-directory-existence check — called BEFORE build.assemble(), so the common no-op commit pays nothing extra.
- **Rejected fixes**: Evidence pending — not present in imported packet
- **Linked existing bug**: None — conversation alone is not sufficient to declare a defect fixed; see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10

## Visual Evidence

None recorded — this importer does not yet accept binary image attachments; see docs/product/conversations/README.md.

## Open Questions

- **Unresolved**: 
  - Should ENG-CONV records eventually cross-link into feature Engineering Evolution sections once real corpus volume is better understood?
  - Should a future GitHub-issue-based handoff be built once the dedicated security review it requires has been done?
- **Deferred**: 
  - Automatic cross-linking of ENG-CONV records into their primary feature's Engineering Evolution section
  - Live connector to any external tool's API (ChatGPT, Codex, Gemini) — every import remains an explicit file hand-off
  - Binary image-attachment ingestion for the Visual Evidence section
  - GitHub-issue/PR/committed-inbox handoff mechanism — assessed, not implemented pending a dedicated security review
  - process-inbox batch-sharing a single build.assemble() across queued imports — deferred because sharing the pre-allocation analysis pass across a batch would weaken cross-item duplicate/continuation detection within that same batch
- **Evidence pending**: None recorded

## Implementation Handoff

- **Work requested**: Implement the full Part 8 pipeline: ECP schema, ENG-CONV identity/allocator, import pipeline (redaction, sanitization, dedup, significance gate, ownership resolution, decision/bug/memory linkage), CLI, generated indexes, dependency graph edges, context assistant integration, hook reconciliation, tests, and documentation.
- **Expected feature IDs**: None
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Extend existing Part 5-7 machinery; no new npm dependencies; no runtime app changes.
- **Expected tests**: Unit tests (ECP schema, significance, fingerprint, Markdown-injection sanitization, dedupe exact-match), security tests (path traversal, symlink escape, size/depth caps, injection inertness, secret redaction, structural-injection regression), and end-to-end scenario tests against a disposable fixture repository.
- **Explicit non-goals**: 
  - Modifying AutoIngest Electron runtime behavior
  - Committing or pushing without explicit instruction
  - A live connector to any external AI tool

## Outcome

- **2026-08-07** — Imported. Canonicalized from a "ecp"-format packet claiming source_tool "claude-code".

## Provenance

- **Source file**: .autoingest-docs/conversations/inbox/part8-pilot.json
- **Packet checksum**: 20968e2b9cacb0f66d291234524079f24312d13448e041ec82e848c2528122ea
- **Importer**: ecp
- **Source tool (as claimed by the packet)**: claude-code — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 13 (a claim, not proof)
- **Source conversation metadata**: Evidence pending — not present in imported packet
- **Transformation method**: ecp adapter (scripts/product-docs/automation/conversation/adapters.js)
- **Fields unavailable from source**: None — packet was complete for this adapter
- **Evidence classifications**: Imported packet — no secret pattern detected
- **Evidence-pending items**: Identity, Repository Context, Initial Understanding, Initial Proposal, Discussion Evolution, Alternatives, Bug / Investigation Evidence, Implementation Handoff
