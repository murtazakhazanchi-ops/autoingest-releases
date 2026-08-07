# Validation Specification

This defines the rules `docs/product/` must satisfy, and how to check each one. It is a **specification**, not a script — no executable tooling is checked in here; each rule below states its check precisely enough that a human or an AI agent can run it by hand (grep/read), or a future maintainer can implement it as a script without inventing what "pass" means. Every rule listed here has already been run at least once by hand during this system's own construction (Part 2 and Part 3) — the "Verified in practice" line on each rule cites when.

**Part 4 note (added when `scripts/product-docs/` was built)**: all 13 rules below now have a first real, runnable implementation in `scripts/product-docs/lib/validators.js`, invoked via `node scripts/product-docs/cli.js validate`. This document remains the specification — the executable checker is downstream of it, not a replacement; if the checker's behavior and this document's stated rule ever diverge, this document is correct and the checker has a bug. The checker also implements Part 4's own tooling-integrity checks (schema validity, dependency-graph edge integrity, generated-output freshness, registry/file mismatches, alias ambiguity) beyond these original 13 — see [scripts/product-docs/README.md](../../scripts/product-docs/README.md) and that file's `documentation-health.md` output for the full, current rule set and each rule's severity.

Run these checks after any change to `docs/product/`, and always before a documentation commit — see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) § Documentation Lifecycle Enforcement.

---

## 1. Duplicate IDs

**Checks**: every `AI-FEAT-###`, `AI-RM-###`, `BUG-###`, `DEC-###`, and `PM-###` is assigned to exactly one file/row.

**How**: for each ID family, extract the ID from filenames (`bugs/`, `decisions/`, `postmortems/`, `features/`) and from `01_FEATURE_REGISTRY.md`'s / `02_MASTER_ROADMAP.md`'s table rows; group by ID; flag any group with more than one distinct file or row.

**Fail condition**: any ID maps to more than one file, or more than one registry/roadmap row.

**Verified in practice**: run during Part 2 commit validation (all `BUG`/`DEC`/`PM`/`AI-FEAT` IDs confirmed unique) and re-run after Part 3's mass edits (56/56 feature files, one `AI-FEAT-###` row each in the registry).

## 2. Broken links

**Checks**: every relative Markdown link (bracketed link text followed by a parenthesized path) under `docs/product/` resolves to an existing file, and every `#anchor` fragment resolves to an actual heading in the target file (GitHub-style slug: lowercase, non-alphanumeric characters other than hyphens/spaces stripped, spaces to hyphens).

**How**: for every `.md` file under `docs/product/` (excluding `exports/`), extract every Markdown link via a standard `\[...\]\(...\)` regex; skip `http(s)://` links; resolve the path part relative to the linking file's directory; if a `#anchor` is present, extract all heading lines from the resolved file, slugify them, and confirm the anchor matches one.

**Fail condition**: any resolved path does not exist as a file, or any anchor does not match a heading slug in the resolved file.

**Verified in practice**: run after every documentation pass in this system's history (Part 2: 348 links, 0 broken; after Part 3 Phase 1: 554 links including new anchors, 0 broken; after Phase 3: 705 links, 1 broken — a legitimate forward-reference to this file before it existed, resolved once this file was created).

## 3. Missing roadmap references

**Checks**: every `AI-RM-###` cited in a feature file's header table (`Related roadmap milestone`) actually exists as a `## AI-RM-###` section in `02_MASTER_ROADMAP.md`, and vice versa — every milestone's `Included AI-FEAT IDs` cites a real `AI-FEAT-###` row in `01_FEATURE_REGISTRY.md`.

**How**: extract the milestone ID set from `02_MASTER_ROADMAP.md`'s section headers; extract every `AI-RM-###` mentioned across `features/*.md`; set-difference in both directions.

**Fail condition**: a feature cites a milestone that doesn't exist, or a milestone's included-feature list cites a feature ID with no registry row.

**Verified in practice**: [12_DEPENDENCY_MODEL.md](12_DEPENDENCY_MODEL.md) § Milestone → Features was built directly from this cross-reference and found zero unresolvable IDs across all 9 milestones.

## 4. Missing feature references

**Checks**: every `AI-FEAT-###` mentioned anywhere in `bugs/`, `decisions/`, `postmortems/`, or `11_ARCHITECTURAL_EVOLUTION.md` corresponds to a real row in `01_FEATURE_REGISTRY.md` and a real file in `features/`.

**How**: extract every `AI-FEAT-\d+` pattern from those directories/file; confirm each has both a registry row and a `features/AI-FEAT-###_*.md` file.

**Fail condition**: any citation with no matching registry row or file.

**Verified in practice**: `11_ARCHITECTURAL_EVOLUTION.md`'s own § 5 states "each ID below was confirmed directly against `01_FEATURE_REGISTRY.md` before inclusion" — this rule formalizes that same check for the record types added since.

## 5. Orphan bugs

**Checks**: every `bugs/BUG-###_*.md` file's `Related feature(s)` field cites at least one `AI-FEAT-###` that exists.

**How**: parse the header table field; if empty or citing no valid `AI-FEAT-###`, flag as orphaned.

**Fail condition**: a bug record with no valid feature citation.

**Verified in practice**: all 10 `BUG-###` records were confirmed to cite at least one valid feature during Part 2's evidence review; re-confirmed via [12_DEPENDENCY_MODEL.md](12_DEPENDENCY_MODEL.md)'s Bug→Decision/Bug→Bug tables, which required parsing every bug's header successfully.

## 6. Orphan decisions

**Checks**: same as Orphan Bugs, for `decisions/DEC-###_*.md`'s `Related feature(s) / roadmap milestone` field — must cite at least one valid `AI-FEAT-###` or `AI-RM-###`.

**Fail condition**: a decision record with no valid feature or milestone citation.

**Verified in practice**: all 15 `DEC-###` records confirmed during Part 2; the reverse-lookup used to build each feature's Lifecycle Metadata section (Part 3 Phase 1) independently re-validated every decision's citation by construction — a decision with an unparseable or empty field would have silently produced zero reverse links, and none did.

## 7. Orphan postmortems

**Checks**: same, for `postmortems/PM-###_*.md`'s `Related feature(s)` field.

**Fail condition**: a postmortem with no valid feature citation.

**Verified in practice**: `PM-001` confirmed to cite 6 valid features (`AI-FEAT-029`, `030`, `031`, `032`, `033`, `047`) during Part 2 and re-verified in [12_DEPENDENCY_MODEL.md](12_DEPENDENCY_MODEL.md) § Feature → Postmortem.

## 8. Missing architecture links

**Checks**: every `AI-FEAT-###` cited in `11_ARCHITECTURAL_EVOLUTION.md` § 5's relationship map exists; conversely, flag (as an informational note, not a failure) any Implemented feature with zero architectural-evolution placement, since not every feature needs one.

**Fail condition (hard)**: a relationship-map citation to a nonexistent feature ID.
**Informational (soft)**: a feature with no §5 row — not a defect by itself, since `11_ARCHITECTURAL_EVOLUTION.md` intentionally covers major transitions, not every feature (`05_DOCUMENTATION_WORKFLOW.md` § When to Update the Architectural-Evolution Document).

**Verified in practice**: [12_DEPENDENCY_MODEL.md](12_DEPENDENCY_MODEL.md) § Coverage Summary reports the soft count directly: 32/56 features currently have an architectural-evolution placement.

## 9. Missing changelog references

**Checks**: every dated `docs/product/` change described in a commit message has a corresponding `10_CHANGELOG.md` entry (append-only, newest-first).

**How**: this one is not fully mechanizable from content alone — it requires comparing `git log` for commits touching `docs/product/` against `10_CHANGELOG.md`'s entries and confirming each documentation-affecting commit is represented.

**Fail condition**: a `docs(product): ...` commit with no corresponding changelog entry.

**Verified in practice**: all three documentation commits to date (`da45c65` Part 1, `7c67aab` architectural evolution, `b67f415` Part 2) each have a matching `10_CHANGELOG.md` entry; this Part 3 pass must add its own entry before commit, per this same rule.

## 10. Implemented features without documentation

**Checks**: every feature with `Status: Implemented` (or `Implemented — evolving`) in `01_FEATURE_REGISTRY.md` has a non-trivial `features/AI-FEAT-###_*.md` file — specifically, its `Current Behavior` and `Related Files` sections are not both "Evidence pending"/empty.

**Fail condition**: an Implemented feature whose file describes no actual current behavior or related files.

**Verified in practice**: all 48 Implemented-family features (`01_FEATURE_REGISTRY.md` § Totals) have populated `Current Behavior` and `Related Files` sections — confirmed by construction during Part 1's original audit, and the Lifecycle Metadata "Documentation completeness" field (Part 3 Phase 1) now makes any regression here mechanically visible per file.

## 11. Planned features missing roadmap entries

**Checks**: every feature with `Status: Planned` in `01_FEATURE_REGISTRY.md` has a corresponding `AI-RM-###` entry in `02_MASTER_ROADMAP.md`.

**Fail condition**: a Planned feature with no roadmap milestone, or citing a milestone that doesn't exist.

**Verified in practice**: `01_FEATURE_REGISTRY.md` § Totals states directly: "Planned: 8 (all mapped 1:1 to AI-RM-002 through AI-RM-009... except AI-RM-001 which has no dedicated 'planned' row because it is already complete)" — confirmed 8/8 via [12_DEPENDENCY_MODEL.md](12_DEPENDENCY_MODEL.md) § Milestone → Features.

## 12. Roadmap inconsistencies

**Checks**: `02_MASTER_ROADMAP.md`'s milestone statuses agree with `04_PROJECT_DASHBOARD.md`'s "Completed roadmap milestones"/"Current roadmap milestone" fields and with the `01_FEATURE_REGISTRY.md` status of every feature that milestone includes (a milestone marked Completed should not include a feature marked anything other than Implemented-family).

**Fail condition**: any disagreement between these three sources about a milestone's status, or a Completed milestone including a non-Implemented feature.

**Verified in practice**: re-confirmed directly during the post-Part-2 review pass — `AI-RM-001` marked Completed in both `02_MASTER_ROADMAP.md` and `04_PROJECT_DASHBOARD.md`, and every one of its 9 included features (`AI-FEAT-029`–`037`) is `Implemented` or `Implemented — evolving` in the registry.

## 13. Documentation completeness gaps

**Checks**: the count of literal `"Evidence pending"` (and equivalent markers: `"Not yet documented as fact"`, `"Known from project history; repository evidence pending"`) strings per feature file, decision record, bug record, and postmortem — surfaced, not eliminated. This is a visibility rule, not a zero-tolerance rule; see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) § Definition of "documentation complete."

**Fail condition**: none by itself — this rule produces a report, not a pass/fail gate. It fails only in combination with Rule 10 (an Implemented feature whose gaps cover its *entire* Current Behavior/Related Files sections, i.e. it has nothing but gaps).

**Verified in practice**: this is exactly the mechanism behind each feature file's Lifecycle Metadata "Documentation completeness" field (Part 3 Phase 1) — computed per-file, already live across all 56 feature files.

---

## 14. Evidence Packet integrity (Part 5)

**Checks**: every Engineering Evidence Packet (`.autoingest-docs/sessions/*.json`) carries every required field with the correct type/enum value before it may be persisted or finalized.

**Fail condition**: a packet failing `automation/evidencePacket.js`'s `validatePacket()` blocks `automation finalize` in every autonomy mode (not just STRICT) — a structurally invalid packet is never allowed to drive a canonical update, regardless of how permissive the mode is otherwise.

**Verified in practice**: `scripts/product-docs/test/automation/evidencePacket.test.js`.

## 15. Record-allocation atomicity (Part 5)

**Checks**: no two `BUG-###`/`DEC-###`/`PM-###` IDs are ever allocated to different content, even under concurrent sessions — `recordAllocator.js`'s lock-then-rescan-then-write critical section.

**Fail condition**: a duplicate ID allocated by two concurrent processes would itself be caught by Rule 1 (Duplicate IDs) on the next `validate` — Rule 15 is the mechanism that prevents it from occurring in the first place, not a separate detection rule.

**Verified in practice**: `scripts/product-docs/test/automation/orchestrator.integration.test.js`'s concurrent-allocation scenario (5 simultaneous child processes, zero collisions).

## 16. Canonical-update idempotency (Part 5)

**Checks**: repeating `automation finalize` against an already-completed session (or re-running the same justified plan twice) never duplicates a changelog entry or an evolution-journal line — `markdownSections.js`'s append/insert primitives are no-ops when the exact content already exists.

**Fail condition**: a duplicate entry from a repeated run is itself visible as ordinary Markdown content, not a distinct validator finding — Rule 16 is a determinism guarantee the automation layer must uphold, verified by test rather than by a runtime check.

**Verified in practice**: `scripts/product-docs/test/automation/markdownSections.test.js` and the "deterministic repeated finalize" integration scenario.

## 17. Roadmap/dashboard transitions are never automatic (Part 5)

**Checks**: no code path in `scripts/product-docs/automation/` writes `02_MASTER_ROADMAP.md` or `04_PROJECT_DASHBOARD.md` narrative prose without an explicit, separately-supplied human/agent confirmation — `documentationPlanner.planRoadmapTransition` always returns `justified: false`; `lifecycleUpdater.applyRoadmapTransition` refuses to write even when confirmed (see `docs/product/05_DOCUMENTATION_WORKFLOW.md`'s Automation and the Update Rule section).

**Fail condition**: this is a structural guarantee (there is no bypass argument, env var, or mode that changes this), verified by code review rather than a runtime check — see the Part 5 final report's Security/Non-Goals sections for the review record.

**Verified in practice**: `scripts/product-docs/test/automation/documentationPlanner.test.js`'s roadmap-transition test.

---

## 18. Decision-draft evidence (Part 7B)

**Checks**: every `decisions/DEC-###_*.md` with `Status: Draft — auto-detected architectural signal...` carries an `Evidence status` field citing the originating session or detected signals.

**Fail condition**: a Draft decision with no such citation — indistinguishable from a hand-typed placeholder.

**Verified in practice**: `scripts/product-docs/lib/decisionValidators.js`'s `checkDecisionDraftsHaveEvidence`, `scripts/product-docs/test/decisionValidators.test.js`.

## 19. Accepted-decision evidence (Part 7B)

**Checks**: an `Accepted` decision's Options Considered section is not still the literal evidence-pending placeholder `decisionIntelligence.js`/`canonicalUpdater.js` write when no alternatives were recorded.

**Fail condition**: none by itself — this is an `evidence_gap`-level finding (visibility only, same policy as Rule 13), not a blocking error.

**Verified in practice**: `checkAcceptedDecisionsHaveEvidence`, `scripts/product-docs/test/decisionValidators.test.js`.

## 20. Superseded-decision reciprocal links (Part 7B)

**Checks**: a `Superseded by DEC-###` status resolves to a real decision, and that target decision's own body mentions the superseded ID back.

**Fail condition (hard)**: the superseding decision doesn't exist. **Warning (soft)**: it exists but doesn't reference back.

**Verified in practice**: `checkSupersededReciprocalLinks`, `scripts/product-docs/test/decisionValidators.test.js`.

## 21. Overlapping active decisions (Part 7B, informational)

**Checks**: two or more `Accepted` decisions governing the exact same feature/roadmap set — not necessarily a contradiction, but worth a human glance.

**Fail condition**: none — information-level only, never asserts the two actually disagree.

**Verified in practice**: `checkContradictoryActiveDecisions`, `scripts/product-docs/test/decisionValidators.test.js`.

---

## Running these checks together

None of these rules depend on executing application code, running the test suite, or any tool beyond text search/parsing over `docs/product/` and `git log`. A future maintainer implementing this as an actual script should implement rules 1–8 and 13 as pure static analysis over the Markdown files (as this specification's authors did by hand, using the same logic described above), and rules 9, 11, and 12 as a combination of static analysis plus `git log` cross-reference. No rule here requires network access, a database, or any state external to this Git repository.

## What this specification deliberately does not cover

- Application code correctness (see `docs/failure-patterns.md`, `docs/system-contracts.md`, and the actual test suite under `test/` instead).
- Prose quality or writing style — this specification checks structural/referential integrity, not whether an explanation is well-written.
- Whether a decision was the *right* decision — only whether it's recorded with the required fields and valid citations.
