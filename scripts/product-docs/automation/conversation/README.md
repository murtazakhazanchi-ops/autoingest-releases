# scripts/product-docs/automation/conversation/ — Part 8 Engineering Conversation Integration

Imports external engineering discussions (ChatGPT, an external Claude conversation, Codex, Gemini, human meeting notes, imported Markdown/JSON, or any future tool) into `docs/product/conversations/ENG-CONV-####_*.md`. See [docs/product/18_ENGINEERING_CONVERSATION_POLICY.md](../../../../docs/product/18_ENGINEERING_CONVERSATION_POLICY.md) for the governing policy and [docs/product/conversations/README.md](../../../../docs/product/conversations/README.md) for the user-facing workflow.

## Module map

| File | Responsibility |
|---|---|
| `paths.js` | Local, gitignored state layout under `.autoingest-docs/conversations/{inbox,processing,imported,rejected,duplicates,failed,audit,decision-candidates}/`. |
| `ecp.js` | Engineering Conversation Packet (ECP) 1.0 schema constants, `validateEcp`, `normalizeEcp`. |
| `fileLoader.js` | Path-traversal-safe, size/depth-capped file loading — mirrors `automation/memory/importAdapter.js`'s `resolveWithinRepo`. |
| `adapters.js` | Vendor-format -> normalized ECP: `ecp` (native), `json` (generic best-effort), `markdown` (generic notes). Never executes imported content. |
| `redactor.js` | Secret-pattern scan/redaction (reuses `automation/redact.js`) plus data-minimization (`minimizeToRecognizedFields`) so an unrecognized vendor field never reaches the canonical record. |
| `fingerprint.js` | Deterministic content fingerprint for exact-duplicate detection. |
| `dedupe.js` | `findExactDuplicate` (fingerprint/`source_conversation_id`) and `findPossibleContinuation` (fuzzy search, same pattern as `decisionIntelligence.js`'s `findPossibleContinuation`). |
| `significance.js` | `planConversationCanonicalization` — the Part 8 sibling of `automation/memory/significance.js`'s `planMemoryCapsule`; gates ID allocation on real engineering content. |
| `ownership.js` | Feature/roadmap/bug/decision/memory ownership resolution — explicit packet-cited IDs plus deterministic keyword-match inference (`lib/query.js`), never `source_tool`-weighted. |
| `allocator.js` | Thin wrapper over `recordAllocator.js`'s `FAMILY_CONFIG.conversation` — same lock-then-scan-then-write mechanism as every other family. |
| `compiler.js` | Deterministic ECP -> canonical Markdown, matching `docs/product/17_ENGINEERING_CONVERSATION_TEMPLATE.md`. |
| `decisionLink.js` | Read-only link to an existing `DEC-###`, or — only via an explicit CLI call, never a git hook — a canonical `Status: Draft` record when the packet's own evidence clears the two-alternatives-plus-accepted bar. See § Part 5/7 Integration below. |
| `bugLink.js` | Read-only link to an existing `BUG-###` only — never auto-creates a canonical bug record from conversation text alone. |
| `memoryLink.js` | Reuses Part 6's own event schema/significance gate/lifecycle to link or create an `AI-MEM-####` capsule from the packet's revisions/feedback/decisions. |
| `lifecycle.js` | The end-to-end orchestration: `analyzePacket`, `previewPacket`, `validatePacket`, `importPacket`, `processInbox`. |
| `query.js` | `conversation query` — mirrors `automation/memory/query.js`. |

## Engineering Conversation Packet (ECP)

Schema: `scripts/product-docs/schemas/engineering-conversation-packet.schema.json`. Minimum required: `ecp_version`, `project`, `source_tool`, `conversation_title`, and a `user_goal` (or the title alone, if that's all that's known). `source_tool` is metadata only — never a trust or ownership signal (§ 6/§ 13 of the policy).

## Adapter Profiles

Only two real parsers exist in `adapters.js`: `ecp` (the file already matches the schema) and generic `json`/`markdown` best-effort extraction. "Claude Code," "Claude," "Codex," and "Gemini" adapter profiles are **documentation, not separate code paths** — every one of those tools is expected to hand this importer either a native ECP packet (preferred; see `docs/product/conversations/CHATGPT_HANDOFF.md` for the ChatGPT instruction, adaptable verbatim to any other tool) or fall back to the generic JSON/Markdown adapters. No tool has a live API connector today — see the policy § 16/§ 17 for exactly what that would require and why it isn't implemented yet.

## Part 5/7 Integration Boundary

**Deliberately isolated** from the live `evidencePacket`/`decisionIntelligence.scanPacket` auto-finalize pipeline — see `docs/product/18_ENGINEERING_CONVERSATION_POLICY.md` § 10 for the full rationale (a Part 8 architecture-review finding: untrusted external text must never be able to indirectly shape a canonical decision purely by entering the same stream `hookAutomation.js`'s pre-push auto-finalize already consumes). Concretely:

- `decisionLink.js`/`bugLink.js`/`memoryLink.js` are only ever called from `lifecycle.importPacket` — a foreground, explicit CLI action.
- None of `hookAutomation.js`'s `preCommitGate`/`prePushGate`/`postCommitLink` call anything in this directory to *import* a conversation. `postCommitLink` may (best-effort) link a just-made commit into a conversation's Outcome log the same way it already links commits into Evidence Packet sessions — see that module's own comments.
- `decisionLink.js`'s canonical `Draft` creation reuses `recordAllocator.js` directly (the same primitive `decisionIntelligence.js` uses), never a live Evidence Packet's own arrays.

## Autonomy Modes

Reuses `evidencePacket.js`'s exact `AUTOMATION_MODES` enum (`strict`/`standard`/`observe`) — see policy § 18.

## Validation Coverage

`lib/conversationValidators.js`, wired into `lib/validators.js`'s `runAllChecks`: broken relationship references, invalid Status vocabulary, missing Provenance/Outcome sections, filename/Identity ID-mismatch, unredacted-secret scan, and an "Implemented with no linked evidence" warning. Duplicate-ID / broken-link / registry-mismatch checks for `ENG-CONV-####` are already covered for free by `lib/validators.js`'s existing generic `checkDuplicateIds`/`checkLinks`, since `parsed.idFilesSeen.conversation` and `docs/product/conversations/*.md` (`parsed.allFiles`) are wired the same way every other family already is.

## Testing

`scripts/product-docs/test/automation/conversation*.test.js` — see that directory for identity/ECP/import/security/linking/lifecycle/index/determinism coverage.

## Deferred Work

- No live connector to any external tool (ChatGPT/Codex/Gemini/Claude) exists — every import is a deliberate, explicit file hand-off (policy § 16/§ 17).
- No binary image-attachment ingestion for Visual Evidence yet — a conversation's Visual Evidence section is always "None recorded" today; a future pass would extend `compiler.js` and the ECP schema.
- `conversation link`'s manual relationship-append is a simple table-cell edit, not a full re-derivation of the record — sufficient for the common case, not a general-purpose Markdown editor.
- **`process-inbox` re-parses the full `docs/product/` corpus per queued file** (performance-auditor finding, same shape as `automation/memory/README.md`'s own documented "Repeated full-corpus parsing" item): `lifecycle.processInbox` calls `importPacket` per file with no shared `build.assemble()` across the batch, unlike `prePushGate`'s already-fixed shared-assemble pattern. Not fixed here because sharing the PRE-allocation analysis pass across a batch would weaken cross-item duplicate/continuation detection within that same batch (item 2 wouldn't see item 1's just-written record) — a correctness tradeoff, not a free win. At the current corpus size this is not a measured problem; left as documented future work rather than risked in this pass.

## Non-goals

Same as every other Part 4-8 module: no embeddings, no external AI API, no network calls, no code execution over imported content. See `scripts/product-docs/README.md` § Non-goals.
