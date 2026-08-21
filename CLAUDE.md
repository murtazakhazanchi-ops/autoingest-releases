## Development Branch, Worktree & Release Workflow

**Adopted 2026-08-21, revised same day once the actual repository topology was inspected.** This is the permanent branch/worktree/release process for AutoIngest going forward. Every future session — Claude or human — must inspect current branch/worktree context (`git branch --show-current`, `git worktree list`, `git status`) before editing code, and must **never assume `main` is clean/stable/release-ready without checking** — see the important exception below, which is why this section exists in its current (not the originally-intended simpler) shape.

### IMPORTANT: `main` is not yet the released-Stable line

`main` (and `origin/main`) currently contains ~22 commits of unreleased knowledge-engine/Ask-AutoIngest foundation work, merged via an old PR before this branch policy existed, never cut into a release. The last commit that genuinely represents what production/Stable users are running is tag **`v0.9.12-rc.3`** (commit `dd959c6`) — the last-shipped Preview build, which itself sits exactly at the boundary immediately before the knowledge-engine work begins (verified: zero knowledge-engine content in or before it). **Do not treat current `main` as the production bugfix base.** This is a one-time historical situation (not fixed by rewriting shared history, which is forbidden) that resolves itself once `main`'s existing unreleased content is eventually promoted to Stable through the normal lifecycle below.

Until that happens, production maintenance uses a dedicated branch:

```
v0.9.11
  └── v0.9.12-rc.3  (Part 9 Multi-Channel Release & Update System, tester-validated, zero knowledge-engine content)
        └── stable/0.9   ← current production maintenance line
              ├── fix/<bug>
              ├── fix/<bug>
              └── hotfix/<bug>
```

**Invariant:** a Preview build intended to validate a production bug must be based on the current Stable maintenance lineage (`stable/0.9` or a `fix/*`/`hotfix/*` branch cut from it) and must **never** accidentally contain unreleased Ask AutoIngest/knowledge-engine work. Building a Preview from `main` or `feature/ask-autoingest` for a production bug would violate this.

### Branches

- **`main`** — will represent only the latest stable/release-ready AutoIngest once its current unreleased content is promoted (see lifecycle below). Never develop major features directly on it.
- **`stable/0.9`** — the actual current production maintenance line, until `main` catches up. Branch production `fix/*`/`hotfix/*` work from here, not from `main`.
- **`feature/*`** — one branch per long-running major roadmap feature, each in its own dedicated Git worktree. The active roadmap feature is **Ask AutoIngest**, developed on `feature/ask-autoingest`, in its own worktree, continuing from its present state.
- **`fix/<descriptive-name>`** — short-lived, created from **`stable/0.9`** (not `main`, while the above exception holds), one per tester/production bug, each in its own dedicated worktree.
- **`hotfix/<descriptive-name>`** — same as `fix/*` but for P0 data-safety/archive-integrity bugs requiring immediate release.
- Never troubleshoot a production bug inside the Ask AutoIngest worktree unless investigation proves it's a regression caused only by Ask AutoIngest.

### Bug classification

| Severity | Definition | Branch |
|---|---|---|
| P0 | data safety / deletion / overwrite / corruption / wrong archive routing | immediate `hotfix/*` |
| P1 | workflow blocked / crash / import unusable | priority `fix/*` |
| P2 | incorrect function but workaround exists | normal `fix/*` queue |
| P3 | cosmetic / minor UX | backlog unless explicitly prioritized |

### Preview → Stable → forward-sync lifecycle (current, while `stable/0.9` is authoritative)

1. Fix is committed on its `fix/*` (or `hotfix/*`) branch, cut from `stable/0.9`.
2. A **Preview** build is generated from that branch: GitHub Actions → "Build and Release AutoIngest" → *Run workflow* → select the `fix/*`/`hotfix/*` branch → `build_type: rc` → `rc_version` continuing the `0.9.12-rc.N` sequence (e.g. `0.9.12-rc.4`) — published as a GitHub prerelease, visible only to Preview-opted-in clients (`allowPrerelease=true`, `channel: rc`).
3. If the tester reports the issue remains: continue on the **same** fix branch, issue another Preview build (next `rc.N`). Do not merge into `stable/0.9` until tester validation succeeds.
4. Once confirmed: merge the fix branch into `stable/0.9` → cut the Stable release from `stable/0.9` (`git tag v0.9.12` — or the next patch version — then `git push origin v0.9.12`, which triggers the tag-push Stable path in `release.yml`, gated by `release gate --channel stable`).
5. **Forward-sync, mandatory:** merge `stable/0.9` into `main`, and then merge the updated `main` into `feature/ask-autoingest`, so both inherit every production fix. (Once `main`'s own unreleased content is eventually promoted to Stable and `stable/0.9`/`main` converge, this two-branch maintenance model collapses back to the originally-intended `main`-is-always-stable shape — update this section when that happens.)
6. Only after successful verification should the temporary bugfix worktree/branch be removed.

### Isolation

- Never run two Claude Code sessions against the same working directory — one session per worktree.
- Never mix unfinished Ask AutoIngest changes into a production bug Preview.
- Never mix unrelated bugfixes together unless explicitly approved.

### Creating a worktree (template)

```bash
# from the main checkout, not from inside another worktree
git fetch origin
git worktree add ../worktrees/fix-<short-name> -b fix/<short-name> stable/0.9
```

Substitute `hotfix/<short-name>` for P0s. `feature/*` worktrees branch from the feature's own current tip, not `stable/0.9` or `main`.

### Intended worktree layout

```
AutoIngest stable worktree     branch: stable/0.9        (production maintenance base — create when first needed)
Ask AutoIngest worktree        branch: feature/ask-autoingest   (this repo's .claude/worktrees/knowledge-portal-stage2)
fix/hotfix worktrees           branch: fix/<name> or hotfix/<name>, cut from stable/0.9, one per bug, temporary
```

### Release configuration

`.github/workflows/release.yml` (Part 9, `AI-FEAT-057`) already implements this fully and required **no changes**: Stable ships only from a `v*` tag push (gated by `release gate --channel stable`); Preview/RC ships from a manual `workflow_dispatch` on any selected branch/commit, tagged `vX.Y.Z-rc.N`, published as an isolated prerelease. It works identically whether the selected branch is `stable/0.9`, a `fix/*`/`hotfix/*` branch, or (once relevant again) `main`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
