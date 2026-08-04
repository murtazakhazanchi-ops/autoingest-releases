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

## Documentation Lifecycle Enforcement

This formalizes the update rule above into an explicit, checkable sequence. It applies to every feature implementation, extension, or milestone going forward — not only large features. A feature is **not complete** until every applicable step below is done; skipping steps 3–10 is incomplete work, not optional polish.

### The 10-step lifecycle

| # | Step | Where |
|---|---|---|
| 1 | Create/update the roadmap milestone | [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md) — new `AI-RM-###` or updated status/objective on an existing one |
| 2 | Implement the feature | Application code (out of scope for `docs/product/` itself) |
| 3 | Record architectural evolution | [11_ARCHITECTURAL_EVOLUTION.md](11_ARCHITECTURAL_EVOLUTION.md) — **only** if the change meets the "major architectural transition" bar above; otherwise this step is a no-op, not a skip |
| 4 | Document key engineering decisions | New file in [decisions/](decisions/) when a real alternative was weighed |
| 5 | Record important bugs encountered | New file in [bugs/](bugs/) when the bug is reusable/architectural, per [07_BUG_TEMPLATE.md](07_BUG_TEMPLATE.md)'s selection criteria — not every fix qualifies |
| 6 | Record rejected approaches | Inside the decision record's "Options Considered" section, or the feature file's journal marked **rejected**/**superseded** — never deleted, per Append, Never Erase above |
| 7 | Record the accepted solution | The feature file's Evolution / Implementation Journal, and the decision record's "Decision" section |
| 8 | Update feature status | [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) row + the feature's own `AI-FEAT-###` file (header table, Lifecycle Metadata, Engineering Evolution sections) |
| 9 | Update roadmap progress | [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md) milestone status, [04_PROJECT_DASHBOARD.md](04_PROJECT_DASHBOARD.md) |
| 10 | Update changelog | [10_CHANGELOG.md](10_CHANGELOG.md), newest-first, append-only |

Steps 4–7 are conditional — not every feature change produces a decision, a bug, a rejected approach, or a distinct "accepted solution" worth recording beyond the journal entry itself. Steps 1, 8, 9, and 10 are close to universal: almost any feature work touches roadmap/registry/dashboard/changelog in some way, even if only to confirm nothing moved.

### Per-feature fields this obligates you to keep current

Since Part 3 (`docs/product/features/*.md`'s **Lifecycle Metadata** and **Engineering Evolution** sections), completing step 8 above means more than editing prose — it means these mechanically-checkable fields stay accurate:

- **Current maturity / implementation status** (header table) — must reflect the real current state, not the state at feature inception.
- **Related decisions / bugs / postmortems** (Lifecycle Metadata) — when you create a new `DEC-###`/`BUG-###`/`PM-###` naming this feature, add the forward link in *both* places: the new record's own `Related feature(s)` field, and this feature's `Known Bugs`/`Decisions` section (or, at minimum, its existence becomes visible via the reverse lookup in [12_DEPENDENCY_MODEL.md](12_DEPENDENCY_MODEL.md) — but forward-linking at the source is preferred and should not be skipped just because the reverse lookup will eventually surface it).
- **Testing coverage** — if you add a test file for this feature, that becomes discoverable evidence the next time this field is regenerated; there is no separate manual field to hand-edit.
- **Documentation completeness** — a mechanical count of `"Evidence pending"` markers in the file. Resolving a real evidence gap (finding the actual date, the actual commit, the actual root cause) is what improves this field — never resolve it by deleting the marker without replacing it with verified fact.

### Definition of "documentation complete" for a feature

A feature's documentation lifecycle is complete when **all** of the following hold:

1. Its `01_FEATURE_REGISTRY.md` row and its own file's header table agree on Status and Maturity.
2. Every bug/decision/postmortem that names this feature in its own `Related feature(s)` field is discoverable from the feature's own file (forward-linked, or at minimum surfaced via [12_DEPENDENCY_MODEL.md](12_DEPENDENCY_MODEL.md)'s reverse-lookup tables).
3. If the feature was part of a completed `AI-RM-###` milestone, that milestone's status in [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md) and [04_PROJECT_DASHBOARD.md](04_PROJECT_DASHBOARD.md) says so.
4. [10_CHANGELOG.md](10_CHANGELOG.md) has an entry for the documentation work itself (not the application release — see that file's own scope note).
5. No newly-introduced fact contradicts an existing record without an explicit **Reconciliation Note** (for decisions) or an appended, marked-superseded journal entry (for features) — see Append, Never Erase above.

A feature is allowed to be documentation-complete while still carrying real "Evidence pending" markers for genuinely unknown history (e.g., a pre-2026-05 implementation date nothing in the repo can recover) — completeness means *nothing knowable was left undocumented*, not that every field is filled in.

### Do not treat this checklist as a gate that blocks shipping

This is a documentation discipline, not a release gate. Application code ships on its own schedule; this checklist governs when the *documentation* for that work is considered finished, which may lag a merge by the time it takes to write it up — but per the Update Rule above, that lag should be measured in the same work session, not a future cleanup pass.

## Exports Are Not Source

Anything under `exports/` (DOCX, PDF) is generated output for sharing outside the repository. It is never edited directly and never treated as authoritative — regenerate it from the Markdown source instead. `exports/` content is excluded from version control (see `.gitignore`); only the Markdown under `docs/product/` is tracked.
