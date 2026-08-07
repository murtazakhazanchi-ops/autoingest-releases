# Engineering Memory Timeline

> Generated artifact — docsys version 1.2.0. A chronological project-level narrative index over docs/product/memory/, not a duplicate of any individual capsule — open the canonical capsule (linked below) for the full record. Never edit this file by hand — regenerate with `node scripts/product-docs/cli.js build`.

## 2026-08-02 — AI-MEM-0001 — Metadata Management Modal Consolidation and Audit & Repair Tab Evolution

- **Feature(s)**: AI-FEAT-008, AI-FEAT-033, AI-FEAT-034
- **Accepted approach**: Evidence pending
- **Rejected alternative(s)**: Accepted or rejected**: Rejected, in favor of extending the existing shared class in place with a scoped modifier (`.adopt-section--inline`, Revision 5) rather than a new file or a base-rule edit.; Accepted or rejected**: Rejected as the fix for `#maRunBtn` specifically — confirmed insufficient because `#diagRunBtn` still exhibits the bug today despite having received exactly this fix previously.
- **Related commit(s)**: 4446a30, 6349c62, 2c2090a, c5d200f
- **Unresolved follow-up**: fixing Archive Diagnostics' `#diagRunBtn` with the same `.ma-run-row`-style wrapper pattern (or, alternatively, reconsidering whether `.diag-actions` itself should gain an `align-items` override once every current child's reliance on the stretch default is audited) is recorded here as unresolved, not scheduled against any roadmap milestone.
- **Capsule**: [AI-MEM-0001](../memory/AI-MEM-0001_METADATA_MANAGEMENT_MODAL_AUDIT_REPAIR_EVOLUTION.md)

## 2026-08-07T08:36:21.929Z — AI-MEM-0002 — Part 8 — Multi-AI Engineering Conversation Integration: design and implementation (from ENG-CONV-0001)

- **Feature(s)**: None
- **Accepted approach**: At least one alternative explicitly accepted — see capsule §Alternatives Considered
- **Rejected alternative(s)**: None recorded
- **Related commit(s)**: Evidence pending — source conversation unavailable
- **Unresolved follow-up**: - Implement the full Part 8 pipeline: ECP schema, ENG-CONV identity/allocator, import pipeline (redaction, sanitization, dedup, significance gate, ownership resolution, decision/bug/memory linkage), CLI, generated indexes, dependency graph edges, context assistant integration, hook reconciliation, tests, and documentation.
- **Capsule**: [AI-MEM-0002](../memory/AI-MEM-0002_PART_8_MULTI_AI_ENGINEERING_CONVERSATION_INTEGRATION_DESIGN_AND_IMPLEMENTATION_F.md)
