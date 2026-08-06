# docs/product/memory/ — Engineering Memory Capsules

Part 6 of AutoIngest's `docs/product/` system. Each `AI-MEM-####_*.md` file here is one durable **Memory Capsule** — the preserved engineering conversation and reasoning behind a meaningful piece of work: the original request, the plan and its revisions, rejected alternatives, investigations, user feedback, and the final outcome. See [../16_ENGINEERING_MEMORY_POLICY.md](../16_ENGINEERING_MEMORY_POLICY.md) for the full governing policy and [../15_MEMORY_TEMPLATE.md](../15_MEMORY_TEMPLATE.md) for the file structure.

## Authority

Memory is historical evidence, not a technical contract — it sits below canonical `docs/product/` records in the authority order (`16_ENGINEERING_MEMORY_POLICY.md` § 3). It explains *why* a canonical record changed; it never overrides *what* the canonical record says is currently true.

## Files

- [INDEX.md](INDEX.md) — human-readable index of every capsule (hand-authored pointer; see `docs/product/generated/MEMORY_INDEX.md` for the machine-generated equivalent, which is the one kept mechanically fresh by `node scripts/product-docs/cli.js build`).
- `AI-MEM-####_*.md` — one capsule per ID, permanent once created.
- `assets/AI-MEM-####/` — committed screenshots/visual evidence for that capsule, only when they carry durable engineering value (`16_ENGINEERING_MEMORY_POLICY.md` § 10).

## How capsules are created

Automatically, alongside normal engineering work, via `node scripts/product-docs/cli.js memory <sub>` — see [scripts/product-docs/automation/memory/README.md](../../../scripts/product-docs/automation/memory/README.md). A capsule is only created when the work meets the significance bar in `16_ENGINEERING_MEMORY_POLICY.md` § 8 — not for every session.

## Regenerating the index

```
node scripts/product-docs/cli.js build      # rebuilds docs/product/generated/memory-index.* and MEMORY_INDEX.md
node scripts/product-docs/cli.js validate    # checks memory consistency alongside everything else
```
