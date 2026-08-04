# Documentation Workflow — Mandatory Maintenance Rules

This defines how `docs/product/` must be kept alive alongside real engineering work. It is process, not reference — see [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) for the registry itself and [README.md](README.md) for the authority model.

---

## The Update Rule

Documentation must be updated **alongside** meaningful feature work, not after the fact from memory.

1. **Before implementation** — record original scope, goals, assumptions, dependencies, and acceptance criteria in the feature file's Original Plan / Intent section (or in a new [decisions/](decisions/) record if a real alternative was weighed).
2. **During implementation** — append design revisions, discovered constraints, bugs, troubleshooting evidence, and rejected alternatives as they happen, not reconstructed afterward.
3. **After verification** — record final architecture, files changed, tests added, commits, unresolved risks, and follow-up work in the feature file's Evolution / Implementation Journal.
4. **After completion** — update [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) status/maturity, [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md) if a milestone moved, [03_IMPLEMENTATION_TIMELINE.md](03_IMPLEMENTATION_TIMELINE.md) actual dates, [04_PROJECT_DASHBOARD.md](04_PROJECT_DASHBOARD.md), and [10_CHANGELOG.md](10_CHANGELOG.md).

## Append, Never Erase

Nothing in a feature's evolution history should be silently deleted. A superseded approach stays in the document, clearly marked **rejected**, **superseded**, or **deferred**, with a one-line reason. This is what makes the implementation journal useful six months later — the record of *why not* is often more valuable than the record of *what*.

## Evidence Discipline

Every factual claim in `docs/product/` must be traceable to one of:

- current source code (cite file/function/IPC channel)
- tests (cite test file)
- existing technical documentation under `docs/`
- Git history (cite commit/date)
- current UI (cite the surface observed)
- prior project knowledge not yet verified against the repo — mark explicitly as **"Known from project history; repository evidence pending."**

Never invent implementation dates, completion dates, bugs, architecture, performance numbers, decisions, ownership, or maturity. When evidence is incomplete, write the literal phrase **"Evidence pending — not yet documented as fact."** rather than a plausible-sounding guess.

## Stable IDs

- `AI-FEAT-###` — permanent feature identity. Never reused, never renumbered.
- `AI-RM-###` — permanent roadmap milestone identity. Never reused, never renumbered.

A roadmap milestone may introduce one feature, expand several existing features, depend on multiple features, or consolidate multiple feature areas. Roadmap IDs are not a feature registry and must not be treated as one.

## Authority Boundary

`docs/product/` is authoritative for product planning, history, and roadmap progress. It is **not** authoritative for runtime behavior, contracts, or architecture — those remain owned by the technical docs under `docs/` (see `docs/CLAUDE.md`). If a product document and a technical document disagree, the technical document is correct; fix the product document and record the reconciliation in the relevant feature or [decisions/](decisions/) record.

## When to Create a New Record

| Situation | Where |
|---|---|
| New durable product capability | New `AI-FEAT-###` entry in the registry + new file in `features/` |
| New planned implementation phase | New `AI-RM-###` entry in the roadmap |
| A bug worth remembering for future debugging | New file in `bugs/` |
| A real alternative was considered and one was chosen | New file in `decisions/` |
| A significant incident occurred and was resolved | New file in `postmortems/` |
| Small clarification to an existing feature | Edit the existing feature file's journal — no new record |

## When to Update the Architectural-Evolution Document

[11_ARCHITECTURAL_EVOLUTION.md](11_ARCHITECTURAL_EVOLUTION.md) records major architectural transitions, not day-to-day feature work. Update it when a change is a **major architectural transition** — one or more of:

- a new core architectural layer or model is introduced (e.g. a new source-of-truth boundary, a new top-level workflow shape like QMZ's, a new storage-root concept);
- archive ownership or source-of-truth boundaries change (what is authoritative over what);
- the metadata pipeline's fundamental design changes (not a new field — a change to the resolver/engine/queue architecture itself);
- import/transfer transaction semantics change (not a bug fix to existing semantics — a change to what "atomic" or "durable" means here);
- recovery architecture changes (a new class of crash/failure recovery is added, not a bug fix to an existing one);
- the relationship between established manual practice (Adobe Bridge, professional review) and AutoIngest's automation shifts;
- a roadmap milestone (`AI-RM-###`) is completed and represents an architectural transition, not just a feature ship.

**Do not update it for**: routine bug fixes, UI/styling changes, adding a field to an existing data structure, performance tuning, or any change that doesn't alter *how the pieces relate to each other* — those belong in the relevant `features/AI-FEAT-###` file's own journal instead. When in doubt, ask: "does this change what future architects need to understand about *why* the system is shaped this way, or just *what* it currently does?" Only the former belongs here.

When updating: append a new dated subsection to the relevant timeline stage (§3) rather than rewriting prior stages, add or update the relevant row in the relationship map (§5), and record any new durable lesson in §4 if one emerged. Verify every `AI-FEAT-###`/`AI-RM-###` citation against [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md)/[02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md) before adding it — the same evidence discipline as everywhere else in this system applies here.

## Exports Are Not Source

Anything under `exports/` (DOCX, PDF) is generated output for sharing outside the repository. It is never edited directly and never treated as authoritative — regenerate it from the Markdown source instead. `exports/` content is excluded from version control (see `.gitignore`); only the Markdown under `docs/product/` is tracked.
