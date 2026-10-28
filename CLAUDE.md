## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Current priority & standing guardrails

The authoritative roadmap and priority order live in `docs/product/02_MASTER_ROADMAP.md` (§ Priority Order); live status is in `docs/product/04_PROJECT_DASHBOARD.md`. This section only points there. If the two ever disagree, the roadmap wins — update this pointer, don't fork the roadmap here.

1. **Next priority: AI-RM-014 Quick Ingest & Desktop Experience.** The immediate scope is the macOS menu-bar / Windows system-tray companion plus the backend needed to support it (plan, contract, risks, test matrix: `docs/product/features/AI-FEAT-061_QUICK_INGEST_DESKTOP_COMPANION.md`). Do not start a phase without owner approval of that phase.
2. **Existing main-window UI is frozen** (`docs/product/decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md`). No change to its appearance, layout or behavior, and no new widgets, banners, buttons or panels there, unless explicitly authorized. New UI goes only in the companion, native notifications and approved companion windows. Exactly two exceptions are approved as future design scope (`docs/product/decisions/DEC-028_SHARED_PHOTOGRAPHER_CAMERA_LEARNING_AND_APPROVED_UI_EXCEPTIONS.md`): a Photographer Registry tab beside Keyword Registry in Metadata Management, and suggestions + inline Add Photographer in the Confirm Event Import photographer field. Photographer↔camera learning is a shared service (`docs/product/features/AI-FEAT-063_PHOTOGRAPHER_CAMERA_IDENTITY_REGISTRY.md`), not Quick-Ingest-only.
3. **Backup Intelligence (AI-RM-015) comes later.** Never label anything "Verified" from filename, size or import-index history.
4. **Preserve Ask AutoIngest and every existing feature worktree.** Do not merge, rewrite, reset, clean or delete them.
5. **`stable/0.9` is the production branch.** Verify against `origin/stable/0.9`, because the local ref can lag. `main` is not a production development base until reconciled.
6. **Use a separate feature worktree per task** (one Claude Code session per worktree), cut from the verified Stable HEAD. Promotion goes Preview RC → packaged physical validation → explicit approval → Stable. Never merge to Stable, push or publish without explicit approval.
