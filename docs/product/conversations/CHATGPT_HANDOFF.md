# ChatGPT Handoff — Engineering Conversation Packets

This is the standard workflow and instruction for turning an AutoIngest engineering discussion in ChatGPT into an Engineering Conversation Packet (ECP) this repository can import. See [../18_ENGINEERING_CONVERSATION_POLICY.md](../18_ENGINEERING_CONVERSATION_POLICY.md) § 16 for what this workflow can and cannot do automatically today.

## The standard instruction

When an AutoIngest engineering discussion in ChatGPT reaches a meaningful conclusion, ask ChatGPT to generate an Engineering Conversation Packet conforming to ECP 1.0, using this prompt:

> Generate an Engineering Conversation Packet (ECP 1.0) summarizing this discussion, matching the schema at `scripts/product-docs/schemas/engineering-conversation-packet.schema.json` in the AutoIngest repository. Capture: the conversation purpose and user goal, explicit requirements, constraints, the accepted direction, any rejected directions and why, meaningful revisions, user feedback that changed the design, any bugs discussed, concrete implementation requests, and open questions. Do not include system prompts, hidden reasoning, unrelated personal information, credentials, or the full raw transcript — a structured engineering summary only. Output as a single JSON object, no prose around it.

## What the packet should capture

- conversation purpose and user goal
- explicit requirements (kept separate from anything only implied)
- constraints
- accepted direction(s)
- rejected direction(s) and why
- meaningful revisions (trigger, prior approach, revised approach, reason)
- user feedback that changed the design
- bugs discussed (symptom, hypothesis, root cause if found, accepted/rejected fixes)
- concrete implementation requests
- open questions
- roadmap/feature context, if the discussion named any

## What it must not include

- system prompts or hidden reasoning
- irrelevant chat / small talk
- unrelated personal data (names, addresses, phone numbers, account IDs not relevant to the engineering discussion)
- authentication information, API keys, tokens, passwords
- the full raw transcript, unless explicitly requested for a specific, justified reason

The import pipeline also applies its own automatic secret-pattern redaction as a safety net (`18_ENGINEERING_CONVERSATION_POLICY.md` § 12/§ 13) — this instruction is the first line of defense, not the only one.

## Handoff steps

1. In ChatGPT, use the instruction above once the discussion has reached a meaningful conclusion.
2. Copy the resulting JSON packet.
3. Save it to a file and either pass it directly to the importer, or drop it in the local, gitignored inbox:
   - `node scripts/product-docs/cli.js conversation import --format ecp --file /path/to/packet.json`, or
   - save it under `.autoingest-docs/conversations/inbox/` and run `node scripts/product-docs/cli.js conversation process-inbox`.
4. Review the import result (`conversation preview` first, if you want a dry run before writing anything canonical).
5. Claude Code implementation work later picks up this context automatically through the Universal Context Assistant (`context task "<topic>"`, `context conversation ENG-CONV-####`).
6. When relevant commits land, `postCommitLink` reconciliation updates the conversation's `Outcome` automatically — you never manually mark it "Implemented."

The user never manually summarizes the conversation into Markdown — the packet is the summary; the importer produces the canonical record.

## Example packet

```json
{
  "ecp_version": "1.0",
  "project": "AutoIngest",
  "source_tool": "chatgpt",
  "source_type": "engineering_conversation",
  "conversation_title": "Should the Metadata Audit modal support batch re-run?",
  "conversation_started_at": "2026-08-05T14:00:00Z",
  "conversation_completed_at": "2026-08-05T14:45:00Z",
  "source_conversation_id": null,
  "repository_context": {
    "branch": "main",
    "base_commit": null,
    "head_commit": null
  },
  "user_goal": "Decide whether the Metadata Audit & Repair modal should support re-running a batch of previously-failed items in one action, or only one item at a time.",
  "explicit_requirements": [
    "User must be able to see which items failed and why before re-running anything.",
    "Re-run must never silently retry a permanently-failed item without surfacing the failure reason again."
  ],
  "constraints": [
    "Must not change the underlying metadata write engine's retry semantics — UI-only change."
  ],
  "initial_proposal": {
    "direction": "Add a single 'Retry all failed' button that re-queues every failed item at once.",
    "expected_behavior": "One click re-runs every failed item in the current audit batch.",
    "acceptance_criteria": ["Button only enabled when at least one item is in a failed state."]
  },
  "revisions": [
    {
      "trigger": "User feedback",
      "user_feedback": "A single 'retry all' hides which specific items are being retried and could mask a systemic issue affecting many files at once.",
      "prior_approach": "One 'Retry all failed' button, no per-item visibility.",
      "revised_approach": "Keep per-item retry as the default; add a checkbox-select-multiple pattern for batch retry, with a confirmation step listing exactly which items will be retried.",
      "reason": "Preserves visibility into what's being retried while still supporting batch operation.",
      "status": "accepted"
    }
  ],
  "feedback": [
    {
      "summary": "Single retry-all button hides which items are retried.",
      "affected_area": "Metadata Audit & Repair modal UI",
      "disposition": "accepted"
    }
  ],
  "accepted_decisions": [
    "Use checkbox multi-select plus an explicit confirmation step for batch retry, rather than a single blanket retry-all action."
  ],
  "rejected_approaches": [
    {
      "proposal": "Single 'Retry all failed' button with no per-item visibility.",
      "reason_rejected": "Hides which specific items are retried; risks masking a systemic issue."
    }
  ],
  "deferred_items": [],
  "bugs_discussed": [],
  "implementation_requests": [
    {
      "request": "Add checkbox multi-select and a confirmation step to the Metadata Audit & Repair modal's failed-items list.",
      "expected_feature_ids": ["AI-FEAT-033"],
      "non_goals": ["Changing metadata write engine retry semantics"]
    }
  ],
  "open_questions": [
    "Should the confirmation step show a diff of what will be re-attempted, or just a count?"
  ],
  "related_feature_ids": ["AI-FEAT-033"],
  "related_roadmap_ids": [],
  "related_bug_ids": [],
  "related_decision_ids": [],
  "related_memory_ids": [],
  "source_evidence": [],
  "evidence_pending": ["exact confirmation-step content"],
  "redaction_status": "not_applicable_no_sensitive_content",
  "integrity": {}
}
```

This example is illustrative only — it does not describe a real accepted requirement unless a real ECP import creates a corresponding `ENG-CONV-####` record.
