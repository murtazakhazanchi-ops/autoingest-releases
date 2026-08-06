# AI-MEM-0001 — Metadata Management Modal Consolidation and Audit & Repair Tab Evolution

## Identity

| Field | Value |
|---|---|
| Memory ID | AI-MEM-0001 |
| Title | Metadata Management Modal Consolidation and Audit & Repair Tab Evolution |
| Status | Compiled |
| Date started | 2026-08-02 |
| Date completed | 2026-08-04 |
| Source agents/tools | Claude Code (session identity not recorded by `.claude/learning-log.md` at the time) |
| Source session ID(s) | Evidence pending — source conversation unavailable; no Part 5 Evidence Packet exists for this pre-Part-5 work, and `.claude/learning-log.md` entries do not record a session ID field |
| Branch | `main` (all four commits below are on `main` per `git log`) |
| Base commit | `fa74845` (`4446a30`'s parent per `git rev-parse 4446a30^` — trivially recoverable, corrected in place per documentation-update-specialist review rather than left as the earlier draft's overly-cautious "Evidence pending") |
| Final commit(s) | `4446a30`, `6349c62`, `2c2090a`, `c5d200f` |
| Evidence classification | Reconstructed from repository evidence only — `.claude/learning-log.md`'s four dated entries (themselves agent-authored post-hoc summaries, not verbatim conversation transcripts) plus the commit history and `docs/product/features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md`/`AI-FEAT-034_METADATA_MANAGEMENT_MODAL.md`/`AI-FEAT-008_DESIGN_SYSTEM_UI_CONSISTENCY_FRAMEWORK.md`'s own citations of the same commits. This is Part 6's first pilot migration (`16_ENGINEERING_MEMORY_POLICY.md` § 17) — no original chat transcript was available to migrate from. |

## Scope

| Field | Value |
|---|---|
| Primary feature IDs | AI-FEAT-034 (Metadata Management Modal), AI-FEAT-033 (Metadata Audit & Repair) |
| Secondary feature IDs | AI-FEAT-008 (Design System / UI Consistency Framework) |
| Roadmap milestone IDs | AI-RM-001 (completed; AI-FEAT-033 is that milestone's core deliverable per its own header table) |
| Subsystems | Metadata UI (renderer), Design System (shared modal/button/layout rules) |
| Related bugs | None recorded — the two CSS root-cause issues found during the 2026-08-03 rebalance (see Investigation Journal) were fixed within the same session and were not promoted to standalone `BUG-###` records; they are preserved here and in `.claude/learning-log.md` instead |
| Related decisions | None recorded — no standalone `DEC-###` exists for this work; the "reuse a shared class vs. add a modifier class" and "extend in place vs. new shared file" judgment calls below were session-level implementation decisions, not architecture decisions of the kind this system's `decisions/` directory reserves for `DEC-###` |
| Related postmortems | None |
| Related releases | Evidence pending — no release-notes file matched these commits by filename (same gap already recorded in AI-FEAT-034's own Lifecycle Metadata) |
| Related technical docs | None dedicated (per AI-FEAT-034's own header table) |

## Original Request

- **User goal**: Evidence pending — source conversation unavailable. No transcript of the original request exists in this repository; `.claude/learning-log.md`'s entries begin from "What happened," already an agent-authored summary of completed work, not the request that preceded it.
- **Original wording summary**: Evidence pending — source conversation unavailable.
- **Explicit constraints**: Inferable only indirectly from the outcome: the 2026-08-03 rebalance's learning-log entry states the plan went through 6 rounds of `ExitPlanMode` revision because "the user repeatedly pushed back on drafts that described the visual hierarchy without specifying the actual space-distribution mechanism" — this implies an implicit constraint (a plan must name which element grows, which stays fixed, and how the parent enforces that) but the constraint's original wording is not recoverable.
- **Expected outcome**: Inferred from the shipped result: a single tabbed "Metadata Management" modal replacing three separate metadata UI surfaces, with its Audit & Repair tab keeping consistent spacing across window heights.

## Initial Understanding

- **How the agent understood the request**: Evidence pending — source conversation unavailable for the 2026-08-02 consolidation task specifically. The commit message (`4446a30` "consolidate metadata surfaces into a Metadata Management modal") and AI-FEAT-034's own "Summary" ("A single tabbed modal consolidating three previously-separate metadata UI surfaces") are the only surviving statements of scope.
- **Initial assumptions**: Evidence pending.
- **Uncertainties**: Evidence pending.
- **Questions raised**: Evidence pending.

## Initial Plan

- **Proposed architecture**: Evidence pending — the first plan draft for the 2026-08-02 consolidation is not preserved verbatim. What is recorded (`.claude/learning-log.md`, 2026-08-02 entry) is that **the first draft was rejected with 12 substantive corrections**, not wording nitpicks — it implied an archive-wide "Apply Metadata" action the backend does not support, under-specified event-context isolation between two now-parallel copies of the same controls (risk of `_alCurrentEventPath` bleeding between Activity Log's copy and the new modal's copy), mislabeled a Bridge/XMP pending-sync count as general "Metadata Status," and proposed entangling audit action-button visibility with the modal's shared footer/tab-switch logic.
- **Proposed files**: `renderer/index.html`, `renderer/renderer.js` (both already-existing large renderer files; no new files were part of the eventual approach — see Alternatives Considered).
- **Proposed tests**: `test/metadataManagementModalUI.test.js` (Playwright).
- **Proposed workflow**: Consolidate the old 2-tab "Metadata Sync" modal (Bridge/XMP review + Keyword Registry), a standalone "Metadata Audit" modal, and a duplicated copy of Activity Log's session-scoped "Metadata" filter tab controls into one 3-tab modal (Metadata / Audit & Repair / Keyword Registry).
- **Original acceptance criteria**: Evidence pending beyond "pure UI restructuring — zero changes to metadata/queue/repair/audit logic, IPC contracts, or ExifTool behavior" (commit message and AI-FEAT-034's Current Behavior section).

## Evolution Timeline

- **Revision 1** (2026-08-02, consolidation) — Trigger: first plan draft reviewed by the user. User feedback: 12 substantive corrections (see Initial Plan above) — not wording nitpicks. Discovered evidence: the backend has no archive-wide "Apply Metadata" action; `_alCurrentEventPath`-style event-context state exists in two now-parallel places. Prior approach: an unspecified first draft implying broader backend capability than exists. Revised approach: scope narrowed to pure UI restructuring, explicit event-context isolation between the two controls copies, corrected Bridge/XMP-vs-general-status labeling, and audit button visibility decoupled from the shared footer/tab-switch logic. Reason for revision: the four issues above, as recorded. Status: accepted — "the revised plan was approved and implemented without further correction cycles" (`.claude/learning-log.md`, 2026-08-02).
- **Revision 2** (2026-08-03, rebalance — round(s) 1–6) — Trigger: repeated user push-back during `ExitPlanMode` review. User feedback: drafts described the visual hierarchy without specifying the actual space-distribution mechanism (which element grows, which stays fixed, how the parent enforces that). Discovered evidence: none yet at plan stage — this was a plan-quality objection, not a code finding. Prior approach: Evidence pending — the specific rejected draft wording across the 6 rounds is not individually preserved, only the aggregate count and the nature of the objection. Revised approach: a plan that names the exact flex/grid mechanism. Reason for revision: per `.claude/learning-log.md`, this is a recurring pattern in this user's review style (also seen in this log's Transfer Import: 3 rounds, and Dashboard Metadata Health Card: 3 rounds entries) rather than something specific to this task. Status: accepted, eventually — round count itself was explicitly judged in the learning-log as "not... a controllable/verifiable input" and therefore not a durable lesson in itself; the durable lesson is Investigation Journal finding 1 below.
- **Revision 3** (2026-08-03, rebalance — during implementation) — Trigger: an automated test asserting the results-zone-to-footer gap numerically (not a screenshot eyeball) caught a `height: 100%` overflow bug. Discovered evidence: `#msBody`'s active tab panel overflowed its parent by exactly the height of the sibling tab bar. Prior approach: `height: 100%` on the active tab panel. Revised approach: `#msBody` converted to `display:flex; flex-direction:column`, `.ms-tabs` and inactive panels given `flex-shrink:0`, active panel changed to `flex:1`. Reason for revision: percentage height resolves against the parent's total content box, not "space left after visible siblings" — a flex/grid parent is required to distribute remaining space correctly. Status: accepted — shipped in commit `2c2090a`.
- **Revision 4** (2026-08-03, rebalance — during implementation) — Trigger: a scoped override (`#msTabAudit #maList`) intended to cancel `.diag-list`'s `flex:1`/`overflow-y:auto` produced a nested double-scrollbar instead. Discovered evidence: CSS cascade only overrides properties a more-specific rule explicitly re-declares; properties it omits still resolve from the highest-specificity rule that does declare them. Prior approach: the override declared `display:flex; flex-direction:column; gap:4px` but not `flex`/`overflow`. Revised approach: explicitly declaring `flex: none; overflow: visible;` in the override. Reason for revision: same cascade mechanism as above. Status: accepted — shipped in commit `2c2090a`.
- **Revision 5** (2026-08-03, rebalance — before reusing `.adopt-section` for Repair Preview) — Trigger: a grep confirmed `.adopt-section` was also used by the unrelated Orphan File Adoption feature (`#adoptionSection`), depending on the same properties Repair Preview needed relaxed (`max-height`/`overflow`). Discovered evidence: shared-class collision risk. Prior approach (considered, not shipped): edit `.adopt-section`'s base rule directly. Revised/accepted approach: a modifier class, `.adopt-section--inline`. Reason for revision: editing the base rule would have changed Orphan File Adoption's layout too. Status: accepted.
- **Revision 6** (2026-08-04, spacing polish) — Trigger: the documented minimum supported window height (700px) needed its own correctly-tuned spacing, beyond what the 2026-08-03 rebalance covered at typical/larger window sizes. Discovered evidence: Evidence pending — the specific measurement/regression that prompted this final pass is not detailed beyond the commit message ("polish Audit & Repair spacing across window heights"). Prior approach: the flex layout from Revision 3, without a dedicated small-height rule. Revised approach: added a media query tuning spacing specifically at the 700px minimum. Reason for revision: correctness at the documented minimum supported size. Status: accepted — shipped in commit `c5d200f`, and per AI-FEAT-033/034's own header tables this is each feature's "Latest major update" as of this capsule's compilation.
- **Revision 7** (2026-08-03, separate same-day task — Run Audit button + entry-point removal) — Trigger: user-directed root-cause investigation of a full-width Run Audit button, described in `.claude/learning-log.md` as done "via explicit systematic-debugging root-cause investigation before any change." Discovered evidence: `#maRunBtn` already used the correct `.emm-btn-primary` class with no width rule of its own — the actual cause was the container, `.diag-actions` (`flex-direction: column`, no `align-items` override, so flexbox's default `align-items: stretch` stretched every child including the button). Prior approach (rejected as insufficient, discovered to already exist from an earlier, separate, already-promoted agent rule): removing an explicit `.diag-actions #diagRunBtn { width: 100%; }` rule — this had been applied previously to Archive Diagnostics' `#diagRunBtn` and did **not** actually eliminate the bug there, because the container-driven stretch reproduces the same symptom independent of whether the button has its own width rule. Revised/accepted approach: wrap `#maRunBtn`/`#maCancelBtn` in a new scoped `.ma-run-row` (`display:flex; gap:8px`), mirroring the existing `.diag-actions-tools` row-wrapping mechanism but deliberately not inheriting that sibling class's font-size/padding override. Reason for revision: fixing the actual root cause (the container) rather than the previously-fixed-but-insufficient symptom (the button). Status: accepted — shipped in commit `6349c62`. **Explicitly deferred, not fixed**: the identical latent bug on Archive Diagnostics' `#diagRunBtn` (same `.diag-actions` class) was left untouched as out of scope for this task and documented as such rather than silently ignored.

## Investigation Journal

- **Symptoms**: (a) visual jumping across Metadata Management modal tab switches (2026-08-02, led to AI-FEAT-008's modal shell height rule); (b) results-zone/footer spacing inconsistency in the Audit & Repair tab after a redesign, plus a nested double-scrollbar (2026-08-03); (c) a full-width Run Audit button that looked wrong despite the button's own class being correct (2026-08-03).
- **Files inspected**: `renderer/index.html` (`.emm-box`, `#msBody`, `.ms-tabs`, `#msTabAudit`, `#maList`, `.diag-actions`, `.diag-actions-tools`, `.adopt-section`), `renderer/renderer.js` (large top-level IIFEs, `window._maStopPoll` bridging), `test/metadataManagementModalUI.test.js`, `test/metadataPipelineLive.test.js` (found independently broken — see Implementation Chronicle), `test/dashboardMetadataHealthCard.test.js`.
- **Commands run**: Evidence pending — exact commands are not preserved; `.claude/learning-log.md` states verification used `getBoundingClientRect()` numeric comparisons, `git stash`/`git stash pop` against the pre-change baseline (to confirm an unrelated console CSP warning was pre-existing, not introduced), and rendered-width measurement (97px button vs. 678px container).
- **Evidence**: percentage height resolving against total parent content box, not remaining space after siblings; CSS cascade only overriding explicitly-redeclared properties; flexbox `align-items: stretch` default on a `flex-direction: column` container with no override.
- **Hypotheses**: (Run Audit button) initially plausible that the button's own class was wrong or already-fixed-but-regressed; root-cause pass instead checked the *container's* flex properties and found the real cause there.
- **Experiments**: numeric `getBoundingClientRect()` diffing before/after; `canvas.measureText()`-style rendered-size checks are recorded elsewhere in the same learning-log for a sibling task, not this one specifically.
- **Findings**: two distinct, non-typo CSS root-cause bugs in the 2026-08-03 rebalance (percentage-height-vs-flex-parent; cascade-override-must-re-declare) and one CSS root-cause bug in the same day's separate Run Audit task (container stretch, not button width).
- **Root cause**: see Evolution Timeline Revisions 3, 4, and 7 above for each bug's specific root cause.
- **Uncertainty**: the exact measurement or regression that prompted Revision 6 (2026-08-04 spacing polish at the 700px minimum) is not detailed beyond the commit message — marked Evidence pending above rather than guessed.

## Alternatives Considered

- **Description**: A new shared file (implied by the "reduce blast radius"-style reasoning that motivated Revision 1's plan correction, and structurally similar to a rejected pattern recorded elsewhere in `.claude/learning-log.md` for a sibling task — extracting a UMD-lite `module.exports`-style helper file for testability). Not concretely proposed *in this specific capsule's* task, but the underlying judgment call (extend an existing shared surface in place vs. add a new file) recurs across this session's sibling tasks; recorded here for completeness since it shaped how Revision 5's modifier-class choice was made.
- **Benefits**: Would isolate new logic from existing shared classes/files entirely.
- **Drawbacks**: Risks duplicating logic already owned by an existing shared class/file; in the sibling task this pattern comes from, it was rejected because the existing renderer files don't actually share the property (`module.exports`) that would have made a new file testable in isolation.
- **Risks**: Divergence between the new file and the existing shared surface over time.
- **Accepted or rejected**: Rejected, in favor of extending the existing shared class in place with a scoped modifier (`.adopt-section--inline`, Revision 5) rather than a new file or a base-rule edit.
- **Reason**: A grep-confirmed shared dependency (Orphan File Adoption also used `.adopt-section`) made a modifier class strictly safer than either a base-rule edit or an entirely new parallel implementation.
- **Supporting evidence**: `.claude/learning-log.md`, 2026-08-03 rebalance entry, lesson 3.

- **Description**: Removing the button's own explicit width rule to fix the Run Audit full-width bug (the fix pattern an earlier, separate, already-promoted agent rule had applied to the sibling `#diagRunBtn` button).
- **Benefits**: Simple, single-property fix; had appeared to work previously for a visually similar button.
- **Drawbacks**: Does not address the actual root cause (container `align-items: stretch`); leaves the bug latent and reproducible.
- **Risks**: A future regression on any button added to a `.diag-actions`-class container, since the container itself still stretches children by default.
- **Accepted or rejected**: Rejected as the fix for `#maRunBtn` specifically — confirmed insufficient because `#diagRunBtn` still exhibits the bug today despite having received exactly this fix previously.
- **Reason**: Root-cause investigation of the container's flex properties, not just the target button's class, revealed the width-rule removal only ever addressed one contributing cause, not the structural one.
- **Supporting evidence**: `.claude/learning-log.md`, 2026-08-03 "Run Audit Full-Width Fix" entry.

## Implementation Chronicle

- **Implementation stages**: (1) 2026-08-02 — modal consolidation, commit `4446a30`. (2) 2026-08-03 — Run Audit button fix + obsolete entry-point removal, commit `6349c62`. (3) 2026-08-03/04 — Audit & Repair tab rebalance, commit `2c2090a`, followed by spacing polish, commit `c5d200f`.
- **Files/modules changed**: `renderer/index.html`, `renderer/renderer.js`, `test/metadataManagementModalUI.test.js`, `test/metadataPipelineLive.test.js` (fixed as an unrelated pre-existing breakage found during the removal audit — see below).
- **Important design choices**: flex-based space distribution over percentage height (Revision 3); explicit property re-declaration in scoped overrides (Revision 4); modifier class over base-rule edit for shared class reuse (Revision 5); scoped flex-row wrapper over container-level `align-items` change, to avoid affecting other children of the shared `.diag-actions` class that may depend on the current stretch behavior (Revision 7).
- **Unexpected discoveries**: the entry-point removal audit's grep of `test/` (not just renderer JS) surfaced two pre-existing problems neither introduced by this task: `test/metadataPipelineLive.test.js` had been silently broken since an earlier Metadata Management consolidation (referenced a modal ID, `#metadataAuditModal`, that no longer existed) — fixed to use the current entry point; and removing the old `#alocMetadataAuditBtn`-click test block broke a later, unrelated-looking block ("backdrop click is a no-op while `_metaReapplyPending` is true") that had silently relied on the removed block leaving the modal open as a side effect — fixed by making that later block self-contained.
- **Corrections**: see Evolution Timeline Revisions 3, 4, and 7 (each a correction of an initial implementation attempt, discovered via automated test or root-cause investigation, not by a second review round).
- **Deviations from plan**: Revision 7's accepted fix (a new scoped `.ma-run-row` wrapper) was not itself present in any recorded initial plan for that day's work — it emerged directly from the root-cause investigation.

## User Feedback

- **Feedback summary**: 12 substantive corrections to the first Metadata Management Modal consolidation plan draft (2026-08-02) — not wording nitpicks.
- **Affected design area**: scope boundary (no archive-wide "Apply Metadata" action exists), event-context isolation between two parallel copies of the same controls, status-label accuracy (Bridge/XMP-specific vs. general "Metadata Status"), and coupling between audit action-button visibility and shared footer/tab-switch logic.
- **Action taken**: plan revised on all four points before implementation began.
- **Outcome**: "the revised plan was approved and implemented without further correction cycles" (`.claude/learning-log.md`).
- **Accepted / partially accepted / rejected**: all four corrections accepted into the revised plan.
- **Reasoning**: Evidence pending — the user's own stated reasoning for each of the 12 corrections is not preserved verbatim; only the corrected plan's resulting scope is recorded.

- **Feedback summary**: repeated push-back across 6 rounds of `ExitPlanMode` review on the 2026-08-03 Audit & Repair rebalance plan.
- **Affected design area**: the plan's description of the space-distribution mechanism (which element grows, which stays fixed, how the parent enforces that) — objected to as under-specified relative to the visual outcome alone.
- **Action taken**: plan iterated until it named the actual mechanism explicitly.
- **Outcome**: plan eventually approved; implementation proceeded and surfaced the two CSS bugs recorded in the Investigation Journal.
- **Accepted / partially accepted / rejected**: accepted, eventually — round count itself was not treated as a distinct piece of actionable feedback (see Evolution Timeline Revision 2's note on why round count wasn't promoted as a lesson).
- **Reasoning**: `.claude/learning-log.md` records this as a recurring pattern of this user's review style across multiple unrelated tasks in the same period, not specific reasoning tied to this task's plan alone.

## Visual Evidence

None recorded — no screenshot or image artifact from this period survives in this repository or in `.claude/learning-log.md` (which explicitly notes elsewhere, for a sibling task, that it does not paste screenshots or long chat history, per its own stated rules). Verification for this work was numeric (`getBoundingClientRect()`, rendered pixel widths), not screenshot-based, per the Investigation Journal above.

## Testing and Verification

- **Tests run**: `test/metadataManagementModalUI.test.js` (Playwright; updated for the entry-point removal and the backdrop-click self-containment fix); `test/metadataPipelineLive.test.js` (fixed as pre-existing breakage, not newly introduced).
- **Results**: Evidence pending exact pass/fail counts — `.claude/learning-log.md` does not record a numeric test summary for this specific work, only that the automated test assertion on results-zone-to-footer gap is what caught the `height:100%` overflow bug.
- **Manual verification**: numeric `getBoundingClientRect()` comparisons across the Run→Cancel button state transition (zero layout shift confirmed); rendered button width (97px) vs. container width (678px) confirmed via `getBoundingClientRect()`; `git stash`/`git stash pop` against the pre-change baseline used to confirm an unrelated console CSP warning was pre-existing.
- **Screenshots**: None (see Visual Evidence above).
- **Performance measurements**: Not applicable — this work was UI-layer CSS/markup only, no performance-sensitive path touched.
- **Unresolved gaps**: the identical latent full-width-button bug on Archive Diagnostics' `#diagRunBtn` (same `.diag-actions` container) was explicitly left unfixed as out of scope — see Evolution Timeline Revision 7 and Final Outcome below.

## Final Outcome

- **What shipped**: a single tabbed Metadata Management modal (Metadata / Audit & Repair / Keyword Registry) replacing three previously-separate UI surfaces (commit `4446a30`); a full-height flex layout for the Audit & Repair tab with a single scroll region, fixing two CSS root-cause bugs along the way (commit `2c2090a`); a compact, non-stretched Run Audit button plus removal of an obsolete Metadata Audit entry point (commit `6349c62`); and a window-height-aware spacing polish at the documented 700px minimum (commit `c5d200f`). A new standing design-system rule (AI-FEAT-008: multi-tab modals sharing a shell class must use a scoped height rule on the specific modal ID) was produced as a direct byproduct of the 2026-08-02 visual-jumping bug.
- **What did not**: the Archive Diagnostics `#diagRunBtn` full-width bug (same root cause as the Run Audit button fix, deliberately left unaddressed).
- **Final architecture**: `#msBody` as a flex column with `.ms-tabs`/inactive panels at `flex-shrink:0` and the active panel at `flex:1`; `.ma-run-row` as a small scoped flex-row wrapper pattern for buttons inside a `.diag-actions`-class container that must not stretch full-width.
- **Final user workflow**: Audit & Repair reached exclusively via Metadata Management → Audit & Repair (the standalone "Metadata Audit" entry point and its Archive Location Setup deep-link were removed).
- **Known limitations**: the `.diag-actions`/`align-items: stretch` root cause remains present and un-refactored at the container level — only this task's two affected buttons were wrapped; any future button added directly to a `.diag-actions`-class container without its own row wrapper will reproduce the same full-width symptom.
- **Follow-up work**: fixing Archive Diagnostics' `#diagRunBtn` with the same `.ma-run-row`-style wrapper pattern (or, alternatively, reconsidering whether `.diag-actions` itself should gain an `align-items` override once every current child's reliance on the stretch default is audited) is recorded here as unresolved, not scheduled against any roadmap milestone.

## Lessons

- **Reusable engineering lessons**: (1) a child meant to fill remaining space next to a fixed-size sibling needs a flex/grid parent distributing that space — percentage sizing on the child alone cannot account for space consumed by siblings; (2) a scoped CSS override only cancels a base class's conflicting properties if it explicitly re-declares them; (3) grep all usages of a shared class before repurposing it for a new feature's needs, not only before editing/removing its base rule; (4) a full-width button bug can exist with zero width rule anywhere on the button or its class — check the parent's flex layout before concluding a style class is already correct or already fixed; (5) entry-point removal audits must grep `test/`, not only renderer JS and markup, since a stale test reference can survive indefinitely undetected; (6) Playwright test blocks that assert on modal/DOM state must establish that state themselves, not rely on an earlier unrelated block's side effect. (All six are recorded, in more detail, in `.claude/learning-log.md`'s 2026-08-03 entries and were promoted to `ui-system-specialist.md`.)
- **Feature-specific lessons**: multi-tab modals sharing `.emm-box` must give the active tab panel a scoped height/flex rule, never rely on `height:100%` alone (now a standing rule — AI-FEAT-008).
- **Rejected patterns**: editing a shared base CSS class directly when only one consumer's presentation needs to change (rejected in favor of a modifier class); removing a button's own width rule as a full-width-bug fix without checking the parent container's `align-items` (rejected as previously insufficient, evidenced by the sibling `#diagRunBtn` bug still existing after receiving exactly that fix).
- **Future warnings**: the `.diag-actions` container's `align-items: stretch` default will reproduce the full-width-button symptom on any new child added without its own row wrapper — this is a latent, known, currently-undocumented-elsewhere trap outside this capsule.

## Provenance

- **Source Evidence Packets**: None — this work predates Part 5's Evidence Packet mechanism; no `.autoingest-docs/sessions/` record exists for it.
- **Commits**: `4446a30`, `6349c62`, `2c2090a`, `c5d200f` (all confirmed via `git log --format='%H %ad %s' --date=short -1 <hash>` against this repository's actual history as part of compiling this capsule).
- **Test reports**: Evidence pending — no committed CI/test-run artifact for this period was located; only the test *files* themselves (`test/metadataManagementModalUI.test.js`, `test/metadataPipelineLive.test.js`) and `.claude/learning-log.md`'s prose description of what they caught.
- **Screenshots**: None (see Visual Evidence).
- **Imported conversation artifacts**: None — no external transcript export was available to import for this migration.
- **Explicit user statements**: None captured verbatim; every user-feedback claim above is a paraphrase sourced from `.claude/learning-log.md`, itself an agent-authored summary — this is explicitly flagged, not presented as a direct quotation.
- **Evidence-pending items**: original request wording (both tasks); initial plan's first-draft text (2026-08-02) and each of its 6 rejected drafts (2026-08-03); base commit hash; session ID(s); exact commands run beyond those specifically named; numeric test pass/fail counts; committed test-report artifact; the specific trigger for Revision 6's 700px spacing polish beyond its commit message.
