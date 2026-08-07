# docs/product/conversations/ — Engineering Conversation Records

Part 8 of AutoIngest's `docs/product/` system. Each `ENG-CONV-####_*.md` file here is one durable **Engineering Conversation record** — a meaningful engineering discussion that happened *outside* an active local Claude Code session (ChatGPT, an external Claude conversation, Codex, Gemini, a human design-review meeting, an engineering email thread, or any future tool), imported and normalized through the vendor-neutral Engineering Conversation Packet (ECP) format. See [../18_ENGINEERING_CONVERSATION_POLICY.md](../18_ENGINEERING_CONVERSATION_POLICY.md) for the full governing policy and [../17_ENGINEERING_CONVERSATION_TEMPLATE.md](../17_ENGINEERING_CONVERSATION_TEMPLATE.md) for the file structure.

## Authority

An Engineering Conversation is historical evidence, not a technical contract — it sits below canonical `docs/product/` records in the authority order, at the same tier as Engineering Memory (`18_ENGINEERING_CONVERSATION_POLICY.md` § 3). It explains *why* a requirement exists, why an approach was rejected, or what a user intended at a point in time; it never overrides *what* a canonical record currently says.

## Files

- [INDEX.md](INDEX.md) — human-readable index of every conversation record (hand-authored pointer; see `docs/product/generated/CONVERSATION_INDEX.md` for the machine-generated equivalent, kept mechanically fresh by `node scripts/product-docs/cli.js build`).
- `ENG-CONV-####_*.md` — one record per ID, permanent once created.
- `assets/ENG-CONV-####/` — committed screenshots/visual evidence for that conversation, only when they carry durable engineering value.
- [CHATGPT_HANDOFF.md](CHATGPT_HANDOFF.md) — the standard instruction and example packet for handing an AutoIngest ChatGPT discussion into this system.

## Engineering Conversation Packet (ECP)

The vendor-neutral JSON handoff format any tool (or a human, by hand) can produce. Schema: `scripts/product-docs/schemas/engineering-conversation-packet.schema.json`. Minimum required fields: `ecp_version`, `project`, `source_tool`, `conversation_title`, a `user_goal` or summary, and provenance/redaction-status fields. Every other field is optional — unknown fields stay unknown, nothing is fabricated to fill a gap.

Supported source tools (metadata only — never privileged, see policy § 6/§ 13): `chatgpt`, `claude-code`, `claude`, `codex`, `gemini`, `human-meeting`, `engineering-review`, `email`, `markdown-notes`, `json`, `manual-import`, `unknown`.

## How conversations become canonical records

1. Produce or receive an ECP (see `CHATGPT_HANDOFF.md` for the ChatGPT workflow; other tools' adapter profiles are documented in `scripts/product-docs/automation/conversation/README.md`).
2. Save it to a file, or drop it in the local inbox: `.autoingest-docs/conversations/inbox/` (gitignored, repository-local).
3. Import: `node scripts/product-docs/cli.js conversation import --format ecp --file <path>`, or `conversation process-inbox` for everything currently in the inbox.
4. The pipeline redacts, schema-validates, deduplicates, resolves likely feature/roadmap/memory/decision/bug ownership, and — only if the packet clears the significance bar (`18_ENGINEERING_CONVERSATION_POLICY.md` § 8) — allocates an `ENG-CONV-####` ID and writes the canonical record.
5. Generated indexes rebuild automatically as part of `conversation finalize` / `node scripts/product-docs/cli.js build`.

A conversation that doesn't clear the significance bar is retained in the raw local tier only, never allocated a canonical ID.

## Querying

```
node scripts/product-docs/cli.js conversation query "<text>"
node scripts/product-docs/cli.js conversation query --feature AI-FEAT-###
node scripts/product-docs/cli.js conversation show ENG-CONV-####
node scripts/product-docs/cli.js context conversation ENG-CONV-####
```

## Regenerating the index

```
node scripts/product-docs/cli.js build      # rebuilds docs/product/generated/conversation-index.* and CONVERSATION_INDEX.md
node scripts/product-docs/cli.js validate    # checks conversation consistency alongside everything else
```
