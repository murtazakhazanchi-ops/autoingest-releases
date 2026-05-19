# Graphify — Developer Architecture Tool

## Purpose

Graphify is a **developer-only** knowledge graph tool for architecture orientation, impact analysis, and refactor planning. It is not part of the AutoIngest runtime and must never become an Electron dependency, npm dependency, or app feature.

Graphify output is **advisory only**. It does not replace:
- `docs/CLAUDE.md` (permanent architecture rules)
- `docs/event.json` contracts and system contracts
- Routed documentation in `docs/`
- Any source-of-truth defined in the AutoIngest architecture

---

## Install (macOS)

```bash
uv tool install graphifyy
graphify install
```

---

## Generate the Project Graph

Run from the project root:

```bash
/graphify .
```

Output lands in `graphify-out/` which is `.gitignore`d and never committed.

---

## Optional: Always-On Claude Code Integration

```bash
graphify claude install
```

> **Review any automatic `CLAUDE.md` changes before committing.** Graphify may propose additions — evaluate them against the permanent architecture rules. Never allow Graphify to overwrite or weaken existing rules.

---

## Recommended Queries

After generating the graph, Claude may use these queries for architecture orientation:

```bash
/graphify query "How does EventCreator connect to GroupManager and import routing?"
/graphify query "Which modules touch file copy and destination path resolution?"
/graphify path "renderer/renderer.js" "main/fileManager.js"
/graphify explain "event.json persistence and import routing contracts"
```

---

## Rules of Use

1. **Advisory only.** Graphify output supplements understanding — it does not authorize code changes.
2. **Authoritative sources remain:** `docs/CLAUDE.md`, routed docs, `event.json` contracts, and the Electron security model.
3. **Never feed private institutional images or documents** to Graphify unless explicitly approved.
4. **Do not make runtime app changes** solely because Graphify suggests them.
5. **If Graphify contradicts `CLAUDE.md` or routed docs:** stop and report the conflict before proceeding.
6. **Graphify artifacts** (`graphify-out/`, `.graphify/`) are excluded from git via `.gitignore`.

---

## What Graphify Must NOT Affect

- Ingestion, metadata, NAS sync, UI, scanner, or archive logic
- `event.json` structure or persistence contracts
- File copy rules (no-overwrite, idempotency)
- Electron security model (`contextIsolation`, `sandbox`, `nodeIntegration`)
- `package.json` dependencies
- Any source-of-truth document
