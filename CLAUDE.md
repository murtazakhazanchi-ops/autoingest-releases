## Development Branch, Worktree & Release Workflow

**Adopted 2026-08-21.** This is the permanent branch/worktree/release process for AutoIngest going forward. Every future session — Claude or human — must inspect current branch/worktree context (`git branch --show-current`, `git worktree list`, `git status`) before editing code, and must not assume `main` is clean/stable without checking.

### Branches

- **`main`** — represents only the latest stable/release-ready AutoIngest. Normal users receive Stable builds from this line. **Never develop major features directly on `main`.**
- **`feature/*`** — one branch per long-running major roadmap feature, each in its own dedicated Git worktree. The active roadmap feature is **Ask AutoIngest**, developed on `feature/ask-autoingest`, in its own worktree, continuing from its present state.
- **`fix/<descriptive-name>`** — short-lived, created from stable `main`, one per tester/production bug, each in its own dedicated worktree.
- **`hotfix/<descriptive-name>`** — same as `fix/*` but for P0 data-safety/archive-integrity bugs requiring immediate release.
- Never troubleshoot a production bug inside the Ask AutoIngest worktree unless investigation proves it's a regression caused only by Ask AutoIngest.

### Bug classification

| Severity | Definition | Branch |
|---|---|---|
| P0 | data safety / deletion / overwrite / corruption / wrong archive routing | immediate `hotfix/*` |
| P1 | workflow blocked / crash / import unusable | priority `fix/*` |
| P2 | incorrect function but workaround exists | normal `fix/*` queue |
| P3 | cosmetic / minor UX | backlog unless explicitly prioritized |

### Preview → Stable lifecycle

1. Fix is committed on its `fix/*` (or `hotfix/*`) branch.
2. A **Preview** build is generated from that branch (`.github/workflows/release.yml`'s `workflow_dispatch` → `build_type: rc`, any branch/commit, tag `vX.Y.Z-rc.N`, published as a GitHub prerelease — only Preview-opted-in clients see it) and released to Preview testers.
3. If the tester reports the issue remains: continue on the **same** fix branch, issue another Preview build. Do not merge into `main` until tester validation succeeds.
4. Once confirmed: merge the fix branch into `main` → cut the Stable release from `main` (`git tag vX.Y.Z` push, triggers the Stable path in `release.yml`, gated by `release gate --channel stable`) → merge the updated `main` into `feature/ask-autoingest` so Ask AutoIngest inherits every production fix.
5. Only after successful verification should the temporary bugfix worktree/branch be removed.

### Isolation

- Never run two Claude Code sessions against the same working directory — one session per worktree.
- Never mix unfinished Ask AutoIngest changes into a production bug Preview.
- Never mix unrelated bugfixes together unless explicitly approved.

### Creating a worktree (template)

```bash
# from the main checkout, not from inside another worktree
git fetch origin
git worktree add ../worktrees/fix-<short-name> -b fix/<short-name> main
```

Substitute `hotfix/<short-name>` for P0s. `feature/*` worktrees follow the same pattern but branch from the feature's own current tip, not `main`.

### Release configuration

`.github/workflows/release.yml` (Part 9, `AI-FEAT-057`) already implements this fully: Stable ships only from a `v*` tag push; Preview/RC ships from a manual `workflow_dispatch` on any branch/commit. No additional release-tooling implementation is required for this workflow.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
