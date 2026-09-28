# DEC-022 — Main/Stable Reconciliation Canonical-ID Collision Resolution

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-059 (renumbered Knowledge Engine) / AI-RM-012 (renumbered Knowledge & Onboarding Portal) — and, unchanged, AI-FEAT-058 (Multi-Event Import) / AI-RM-011 (Multi-Event Import) on stable/0.9 |
| Status | Accepted |
| Date | 2026-09-28 |
| Evidence status | Verified from Git history — `git merge-base origin/main origin/stable/0.9` = `7f72e51`; `git merge-tree` between the two tips before this reconciliation; `git log` on both sides since that merge-base |

## Context

`main` and `stable/0.9` both diverged from the same commit, `7f72e51` (the v0.9.12 Stable source, forward-synced into `main` on 2026-09-20). From that point on, each line independently continued development without the other:

- **`main`** built out the Ask AutoIngest Knowledge Engine (Stage 1 prototype through Stage 2 Operator Knowledge Architecture) and, following `docs/product/CLAUDE.md` §17's "every feature receives an ID" rule, allocated the next free IDs at the time: **`AI-FEAT-058`**, **`DEC-019`** (its central "reuses existing retrieval, no new search system" decision), and **`AI-RM-011`** (its roadmap milestone).
- **`stable/0.9`** built out Multi-Event Single-Pass Import (plus the durable metadata-intent module, extended Per-Photo Tag Refinement, and v0.9.13 release stabilization) and, following the identical rule, independently allocated **the same three numbers** — `AI-FEAT-058`, `DEC-019`, `AI-RM-011` — to a completely different feature. This line shipped: v0.9.13-rc.1 through rc.4 were published, and `v0.9.13` was tagged, with this numbering.

Neither side could see the other's allocation; there was no shared "next ID" coordination point between the two long-lived branches. This surfaced only when reconciling the two lines (`integration/main-stable-reconcile`, branched from `main` at `45ce2eb`): `git merge-tree` against `origin/stable/0.9` (`a1223ad`) showed an add/add conflict on `docs/product/generated/feature-timelines/AI-FEAT-058_TIMELINE.md` and textual conflicts in every hand-maintained registry file that cited either meaning of the three IDs (`01_FEATURE_REGISTRY.md`, `02_MASTER_ROADMAP.md`, `04_PROJECT_DASHBOARD.md`, `10_CHANGELOG.md`) — the two features cannot both be `AI-FEAT-058` in one merged canonical history.

This directly meets `docs/product/CLAUDE.md`'s stated non-negotiable: *"Preserve stable IDs — never reuse, never renumber. IDs are permanent once assigned."* That rule exists to prevent renumbering-for-tidiness within a single lineage; it does not, and could not, anticipate two independent lineages allocating the identical ID to two different things before either was aware of the other. Reconciling them into one tree while literally preserving both is not possible — one of the two allocations must change.

## Options Considered

1. **Renumber stable/0.9's IDs (Multi-Event Import).** Rejected: this numbering is already shipped and public — referenced in v0.9.13-rc.1 through rc.4's published release history and the `v0.9.13` tag's own source tree. Renumbering an ID that has already reached real users is a stronger violation of the "permanent once assigned" spirit than renumbering one that has not shipped.
2. **Renumber main's IDs (Ask AutoIngest Knowledge Engine).** Chosen. This work has not been released in any tagged/published build; its IDs exist only in `main`'s Git history and in this repository's own documentation, never in a shipped artifact or external citation.
3. **Invent a disjoint numbering scheme (e.g. a branch-qualified prefix) instead of renumbering either side.** Rejected: `docs/product/CLAUDE.md`'s ID formats (`AI-FEAT-###`, `DEC-###`, `AI-RM-###`) are fixed, tooling (`scripts/product-docs/lib/ids.js` and every generated index) assumes them, and introducing a second ID grammar for exactly one historical incident would be a much larger, riskier, and more confusing change than a one-time renumber of unreleased IDs.
4. **Do not merge; keep the two lines permanently separate.** Rejected: this was the reconciliation's explicit goal — a single development base carrying both Ask AutoIngest and all Stable production work is required before Phase 1B of the MX Creative Console work (or any further shared development) can proceed safely.

## Decision

Renumber the three colliding IDs on `main`'s (unreleased) side only, before merging `stable/0.9` in:

| Old (main, Knowledge Engine) | New (main, Knowledge Engine) | Unchanged (stable/0.9, Multi-Event Import) |
|---|---|---|
| `AI-FEAT-058` | **`AI-FEAT-059`** | `AI-FEAT-058` |
| `DEC-019` | **`DEC-021`** (not `DEC-020` — `main` already has its own, unrelated `DEC-020`; `021` is the next number free on both sides combined) | `DEC-019` |
| `AI-RM-011` | **`AI-RM-012`** | `AI-RM-011` |

Applied in `ba634e15d4002eda8ea6fbd562451a44a416f6c6` (the rename: two files renamed via `git mv`, every hand-maintained cross-reference updated, including one GitHub-style markdown anchor slug — `#ai-rm-011-...` — that the plain ID-token substitution didn't catch since anchors are lowercased) and `580ea7c8a9cf1651fd7aea79ec024ee309e5534a` (removing `docs/product/generated/feature-timelines/AI-FEAT-058_TIMELINE.md`, a stale generated file `cli.js build` does not delete on its own when a source ID changes). `cli.js build && cli.js validate` passed (0 errors) on the renumbered tree before `stable/0.9` was merged in, and the resulting add/add conflict on the generated timeline file was confirmed resolved by a second `git merge-tree` dry run.

**Precedence rule applied** (for any future occurrence of this class of collision): an ID already shipped/published in a Stable release is authoritative and immutable; an ID that exists only on an unreleased development branch may be reassigned solely to resolve a genuine cross-branch collision, with the reassignment fully traceable (this record) and never applied opportunistically to unrelated IDs.

## Consequences

- Every citation of "AI-FEAT-058", "DEC-019", or "AI-RM-011" meaning the Knowledge Engine, anywhere in the reconciled tree, must read `AI-FEAT-059`/`DEC-021`/`AI-RM-012` instead. Verified by a repository-wide search after the merge (see the reconciliation report this decision accompanies).
- `stable/0.9`'s own history, its published v0.9.13-rc.1..4 / v0.9.13 release notes, and its tagged source trees are **not** rewritten or reinterpreted — they continue to say `AI-FEAT-058`/`DEC-019`/`AI-RM-011` meaning Multi-Event Import, exactly as shipped. This decision does not retroactively touch Stable release history.
- This is a **one-time collision-resolution exception**, not a change to the "never reuse, never renumber" policy itself. That rule remains the default for every other ID in the system.
- **Recurrence prevention**: going forward, a new canonical ID should be allocated from a single authoritative source, or from a reserved range agreed before two long-lived branches diverge, specifically so independent branches cannot silently allocate the same next-free number again. `docs/product/CLAUDE.md` §11 ("Historical Preservation") is amended with a short note to this effect (see that section) rather than introducing a new numbered rule, since it already owns the "IDs are permanent" statement this decision is an exception to.

## Reconciliation Note

Not applicable — this decision does not conflict with an authoritative technical doc under `docs/`; it resolves a conflict between two divergent instances of `docs/product/` itself.
