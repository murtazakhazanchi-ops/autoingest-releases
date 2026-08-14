# AI-MEM-0004 — Knowledge Portal Stage 2: Operator Knowledge Architecture, Online Registry Coverage, and Merge

## Identity

| Field | Value |
|---|---|
| Memory ID | AI-MEM-0004 |
| Title | Knowledge Portal Stage 2 — full arc from Stage 1 audit through Stage 2 implementation, adversarial verification, and merge to main |
| Status | Compiled |
| Date started | 2026-08-13 |
| Date completed | 2026-08-14 |
| Source agents/tools | Claude Code (background session), reconstructed from this session's own direct conversation record — not an imported external-tool packet |
| Source session ID(s) | Evidence pending — not tracked by this repository's session-ID convention for this engagement |
| Branch | knowledge-portal-stage2 (merged), closure commit on main |
| Base commit | 56cfd1bd5ac266a1fe686140368182eadbe3d7b6 (origin/main before merge) |
| Final commit(s) | 765e9b83fba64593d07422f390f8b3a41046dc8b (merge commit); knowledge-portal-stage2 tip d89440bbd1576e4c2530fa76b4b791c9fe226997 |
| Evidence classification | Full session capture — this capsule was compiled directly from the session's own conversation record, not reconstructed after the fact from repository artifacts alone |

## Scope

| Field | Value |
|---|---|
| Primary feature IDs | AI-FEAT-058 |
| Secondary feature IDs | AI-FEAT-048 (Online Registry — referenced extensively, not modified), AI-FEAT-045 (Archive-level locking — referenced, not modified) |
| Roadmap milestone IDs | AI-RM-011 |
| Subsystems | Knowledge & Onboarding (product-docs tooling) |
| Related bugs | None — every defect found during this engagement was caught and fixed pre-commit, recorded in AI-FEAT-058's own Evolution log per this system's established convention for that situation, not as standalone BUG-### records |
| Related decisions | DEC-019, DEC-020 |
| Related postmortems | None |
| Related releases | None — no AutoIngest application release was published as part of this work |
| Related technical docs | scripts/product-docs/README.md |

## Original Request

- **User goal**: Turn AutoIngest's engineering documentation into an accurate, teachable, operator-facing "Ask AutoIngest" system — deterministic, grounded, citation-honest — without adding an LLM, embeddings, vector DB, live Registry dashboard integration, or production Electron integration, unless a prior audit proved deterministic retrieval genuinely could not work.
- **Original wording summary**: The user's Stage 2 brief (paraphrased, not verbatim) specified a large, phased plan: a read-only Phase 0-3 audit with an explicit STOP-FOR-REVIEW boundary, then — only after explicit approval — natural-language retrieval via a concept/synonym layer, question classification, operator Workflow knowledge as a major deliverable, an extremely detailed Online Registry/teamwork architecture treatment (explicitly named a first-class capability, not reducible to static lookup), a 100+ question expanded evaluation corpus, expanded hallucination/grounding tests, a portal UX prototype with a named set of screens, a directory/onboarding browsing mode, a fresh adversarial review, and two mandatory final-report sections.
- **Explicit constraints**: No LLM, no embeddings, no vector DB, no live Online Registry dashboard integration, no production Electron integration, no new AutoIngest release, no Stage 3 work without separate approval. `conflict:warning` must never be presented as an available operator capability unless end-to-end evidence proves an emitting path exists. The Online Registry's four distinctions (presence / activity-progress / conflict detection / archive-level locking) must remain separate concepts in retrieval and answers, never blurred. Registry authority boundaries (no media bytes through the relay, relay state is not archive storage, import/sync never block on relay unavailability, no-authentication-by-default described accurately) must be preserved.
- **Expected outcome**: A working, tested, evidence-grounded Stage 2 system matching the above scope, presented as a final report, with the user retaining the merge decision.

## Initial Understanding

- **How the agent understood the request**: A large, multi-week-scale engagement compressed into continuous session work, following the existing Stage 1 prototype's own architecture (`lib/query.js`'s deterministic ranker, reused unchanged) rather than replacing it.
- **Initial assumptions**: That the Phase 0-3 audit's findings (Capability-vs-Workflow architecture, the four Registry distinctions, the dormant-`conflict:warning` finding) were correct and durable — later verified repeatedly under adversarial testing pressure, never contradicted.
- **Uncertainties**: Whether a purely keyword/concept-based retrieval layer (no embeddings) could realistically achieve acceptable answer quality across 100+ diverse questions including natural Registry phrasing — resolved affirmatively, with disclosed, bounded exceptions (no stemming, no typo tolerance, no compound-claim verification).
- **Questions raised**: None requiring user clarification during the build itself — ambiguities were resolved by following the audit's own findings and the established "evidence pending" convention rather than guessing.

## Initial Plan

- **Proposed architecture**: Concept/intent layer (`lib/intentConcepts.js`) and question classifier (`lib/questionClassifier.js`), both routed through the existing `lib/query.js` ranker; a new Workflow record type distinct from Capability; roadmap/status routing; curated boundary table extension for Registry-specific facts.
- **Proposed files**: See AI-FEAT-058's own Related Files sections (Stage 2, Phase 20/21, Phase 22/23, Phase 24, and Pre-Merge Acceptance Pass subsections) — not repeated here to avoid duplicating the canonical record.
- **Proposed tests**: An expanded eval corpus (100+ questions), a dedicated hallucination/grounding suite, a dedicated adversarial-review suite.
- **Proposed workflow**: Phases 4-19 (architecture) → Phase 20-21 (corpus + hallucination tests) → Phase 22-23 (portal UX + directory mode) → Phase 24 (adversarial review) → Phase 25 (documentation integration) → Phase 26-27 (mandatory report sections) → user review → merge-readiness pass → merge → historical closure.
- **Original acceptance criteria**: Zero unexplained corpus deviations, zero fabricated IDs, zero invented navigation, `conflict:warning` never presented as active, full regression suite green, `validate` clean.

## Evolution Timeline

- **Revision 1** (2026-08-13, mid-engagement)
  - Trigger: User approval message following the presented Phase 0-3 audit.
  - User feedback: Explicit, detailed approval preserving the Capability-vs-Workflow architecture, the four Registry distinctions, the `conflict:warning` dormancy constraint, and the Registry authority boundaries; explicit instruction to proceed through Phases 4+ and stop at the final-report boundary.
  - Discovered evidence: N/A — this was the transition from audit to implementation.
  - Prior approach: Read-only audit only.
  - Revised approach: Full Stage 2 implementation authorized.
  - Reason for revision: Explicit user approval.
  - Status: accepted.

- **Revision 2** (2026-08-13, during Phase 20 corpus construction)
  - Trigger: Building the expanded 119-question corpus surfaced that several Online Registry questions — including whether a conflict warning would fire — resolved confidently `AVAILABLE`, directly contradicting the approved `conflict:warning` constraint.
  - User feedback: None — agent-initiated, caught by the corpus's own testing discipline before being shown to the user.
  - Discovered evidence: A `team-authority` concept cluster existed specifically to recognize Registry-authority questions but its hints boosted confidence toward `AVAILABLE` instead of routing to a boundary — backwards from its own evident purpose.
  - Prior approach: Boundary table covered six general exclusions from Stage 1; no Registry-specific boundaries existed yet.
  - Revised approach: Removed the mis-aimed cluster; added five new curated Registry-scope boundaries citing `AI-WF-006` verbatim; later (Phase 24) extended a `hardOverride` precedence flag to all boundaries after finding a strong raw match on the Registry's own parent feature could still suppress even the new boundaries.
  - Reason for revision: A real, serious grounding defect, found through the engagement's own testing discipline, directly threatening the highest-stakes explicit user constraint.
  - Status: accepted — this became the load-bearing safety mechanism for the rest of the engagement.

- **Revision 3** (2026-08-13, Phase 24 adversarial review)
  - Trigger: 36 newly-invented adversarial questions, deliberately distinct from both corpora.
  - User feedback: None — agent-initiated per the brief's own instruction to conduct a fresh adversarial pass.
  - Discovered evidence: Compound "since X, does that mean Y?" questions bypassed even the new Registry boundaries via a strong match on an unrelated real feature; a concept-hint trigger word substring-matched an unrelated inflected word; an EXPLANATION-classified question about a Workflow-only term (`sync-slot`) was structurally unreachable.
  - Prior approach: `hardOverride` applied only to the five Registry-scope boundaries; workflow-preference routing covered only HOW_TO/TROUBLESHOOTING.
  - Revised approach: `hardOverride` extended to all eleven boundaries; workflow-preference gate broadened to include EXPLANATION.
  - Reason for revision: Adversarial testing is only useful if findings are acted on — six real defects were fixed, not merely logged.
  - Status: accepted — re-verified against the full corpus to confirm the broadening was a net improvement, not a regression (it legitimately fixed three pre-existing weak/missing answers as a side effect).

- **Revision 4** (2026-08-14, user-directed merge-readiness pass)
  - Trigger: User instruction: "perform one final MERGE READINESS AND USER-EXPERIENCE ACCEPTANCE PASS... Test it as a normal operator, not as the developer who knows how it works."
  - User feedback: A detailed, itemized 13-point audit instruction — branch/diff review, browser click-through, Registry acceptance testing with natural phrasing, Node 18 investigation, Workflow-gap classification (explicitly: do not auto-author more Workflow records), corpus re-run, security review.
  - Discovered evidence: Interactive browser access was unavailable in this session's environment (no live Chrome extension connection) — substituted with HTTP-level operator simulation and static code audit, which found and fixed three real UI defects (dark-mode contrast, missing form labels/ARIA, table overflow). Separately, operator-phrased Registry acceptance testing found that "Team Live" — the actual UI-facing toggle name per `AI-WF-006`'s own text — was never recognized as a synonym for "Online Registry" in any boundary trigger, causing two natural questions to resolve a false `AVAILABLE`.
  - Prior approach: Registry boundary triggers used only "registry"/"relay" terminology.
  - Revised approach: Added "Team Live" phrasing across the affected boundary triggers, plus two more natural-phrasing widenings found the same way.
  - Reason for revision: Testing "as an operator, not as the developer" is precisely what surfaced a gap that document-vocabulary-only testing had missed throughout the entire engagement to that point — a genuinely valuable methodological finding, not a rubber-stamp pass.
  - Status: accepted — locked in with a new 7-test regression suite (`knowledgeMergeReadiness.test.js`).

- **Revision 5** (2026-08-14, merge)
  - Trigger: User message: "Approved. Stage 2 is accepted as READY TO MERGE. Proceed with the Stage 2 merge and historical/documentation closure only."
  - User feedback: Explicit, phased, detailed merge instruction — fetch and verify base, confirm branch scope, push, merge with history preserved (no squash), push main, verify from the actual merged state, then close out documentation/history.
  - Discovered evidence: The local `main` ref in the working worktree was stale and checked out in a separate, unrelated worktree — could not be checked out directly. Resolved via git plumbing (`commit-tree` with two parents, pushed directly to `origin/main`) rather than disrupting either worktree's checkout.
  - Prior approach: N/A — first merge of this branch.
  - Revised approach: A genuine two-parent merge commit (`765e9b8`, parents `56cfd1b` and `d89440b`), matching the repository's own established convention from the Stage 1 PR #5 merge.
  - Reason for revision: Explicit user authorization for exactly this action, following a full review cycle (Merge Readiness Report) the user had already approved.
  - Status: accepted — verified independently from a fresh temporary worktree checked out at the new `origin/main` tip before this capsule was compiled.

- **Revision 6** (2026-08-14, mid-closure product-owner clarification)
  - Trigger: User message, sent mid-turn during Phase 4 documentation closure: an explicit product-owner clarification that the Online Registry's PRIMARY purpose is distributed event coordination between separated operators without a shared NAS — not merely presence — with an explicit instruction to forensically trace 20 specific implementation questions before writing any operator instructions, and to stop and report if a real discrepancy (not just missing coverage) surfaced.
  - User feedback: A very detailed, structured clarification distinguishing a "physical data plane" from a "collaboration/control plane," requiring a fifth first-class Registry concept (Shared Event Discovery / Event Coordination) alongside the existing four, and explicitly warning against promoting intended behavior to `AVAILABLE` without runtime evidence.
  - Discovered evidence: A forensic trace of `main/main.js` (`event:write`'s auto-registration, `event:publishRegistry`, `collection:prepareFromRegistry`, `event:prepareFromRegistry`), `services/realtimeOperationsService.js` (`emitRegistryEvent`/`emitRegistryCollection`, `registry:register`/`registry:snapshot` handling), `realtime-server/server.js` (`registry.json` persistence, live broadcast, reconnect snapshot), `main/preload.js`, and `renderer/eventCreator.js` (a real "Online Registry" UI tab with prepare/adopt buttons) found this capability to be **substantially VERIFIED IMPLEMENTED end-to-end** — considerably more complete than AI-WF-006's own prior (2026-08-13) version had documented. AI-WF-006 had never mentioned event coordination at all — a real coverage gap in this session's own earlier Stage 2 work, not a case of previously-documented behavior being contradicted. A related, narrower documentation gap was also found in `11_ARCHITECTURAL_EVOLUTION.md`'s pre-existing text about AI-FEAT-048, which understated its own scope.
  - Prior approach: AI-WF-006 documented only presence/activity/conflict-detection/archive-locking (four concepts); no concept cluster or eval coverage existed for event discovery/adoption.
  - Revised approach: Added event coordination as AI-WF-006's fifth first-class concept, with a full 20-question forensic classification table and an evidence-marked operator workflow diagram; added a `team-event-coordination` concept cluster; widened the `registry-media-storage`/`registry-not-source-of-truth` boundaries for phrasings this investigation's own adversarial testing found uncovered ("copy/sync the photos," "sharing the same storage," "replace the NAS"); broadened the TEAM_ACTIVITY question-type workflow-preference gate (low-risk given that classifier regex's narrow scope, unlike the earlier EXPLANATION broadening); added `test/knowledgeEventCoordination.test.js` (22 tests, covering all 15 user-supplied example questions plus the 6 required "must not confuse X with Y" adversarial distinctions).
  - Reason for revision: Direct, explicit product-owner instruction, discovered via genuine forensic investigation rather than assumed from the stated intent — exactly as instructed ("Do not infer any of these from product-owner intent alone").
  - Status: accepted — full regression suite re-verified after every change in this revision (three real regressions were found and fixed mid-revision: a coincidental "make"/"event" keyword collision from the AI-WF-006 expansion that briefly mis-ranked a "how do i make an event" question, and the three new adversarial distinction checks initially failing until the boundary triggers were widened — all caught by this revision's own testing discipline before being accepted, not shipped and found later).

## Investigation Journal

- **Symptoms**: See Revisions 2-4 above for the specific defect-finding investigations; not restated here.
- **Files inspected**: `realtime-server/server.js`, `services/realtimeOperationsService.js`, `main/main.js` (emitter call sites — read-only architecture trace, never modified), `lib/query.js` (read to confirm reuse, never modified), every file listed in AI-FEAT-058's own Related Files sections.
- **Commands run**: `node cli.js build`/`validate`, the full product-docs test suite (standalone + automation), direct HTTP acceptance scripts against a live local portal server instance, `git diff`/`git log`/`git merge-base` for branch/divergence verification.
- **Evidence**: Every defect finding in this capsule traces to a specific, reproducible question run against the real engine, not inference.
- **Root cause**: See the per-revision entries above; no unresolved root cause remains at capsule-compile time.
- **Uncertainty**: Whether the disclosed structural limitations (no stemming, no typo tolerance, no compound-claim verification in the shared `lib/query.js` ranker) will need addressing in a future stage remains an open question, deliberately not resolved here — see Follow-up work below.

## Alternatives Considered

- **Description**: Embeddings-based or LLM-assisted retrieval instead of a curated concept layer.
  - **Benefits**: Potentially better recall for genuinely novel phrasings.
  - **Drawbacks**: Violates the explicit no-LLM/no-embeddings constraint; non-deterministic; harder to audit/cite.
  - **Risks**: Loss of the citation-honest, grounded-answer guarantee that is this system's core value proposition.
  - **Accepted or rejected**: Rejected, per explicit user constraint, at every phase — never seriously reconsidered.
  - **Reason**: The user's own stop condition ("unless the audit proves deterministic retrieval genuinely cannot work") was never triggered — deterministic retrieval, once its real gaps were found and fixed, performed well.
  - **Supporting evidence**: 99/119 exact corpus pass, 0/119 unexplained, across a corpus deliberately including adversarial and natural-language edge cases.

- **Description**: A giant per-question lookup table instead of a small curated concept-cluster map.
  - **Benefits**: Perfect recall for exactly-anticipated phrasings.
  - **Drawbacks**: Doesn't generalize; explicitly named as a failure mode to avoid in the original brief.
  - **Accepted or rejected**: Rejected.
  - **Reason**: See DEC-020's own fuller account of this choice.
  - **Supporting evidence**: DEC-020.

## Implementation Chronicle

- **Implementation stages**: Phases 4-19 (architecture) → 20-21 (corpus + hallucination) → 22-23 (portal + directory) → 24 (adversarial) → 25 (documentation) → 26-27 (mandatory reports, presented as artifacts) → user review → merge-readiness pass (browser-substitute testing, Node 18, Workflow-gap classification) → merge → this closure pass.
- **Files/modules changed**: See AI-FEAT-058's own Related Files sections in full — not duplicated here.
- **Important design choices**: The `hardOverride` boundary-precedence mechanism (see DEC-020 and AI-FEAT-058's Phase 20/24 evolution entries) is the single most consequential design decision to emerge from this engagement — it was not part of the original plan, was discovered necessary only through the engagement's own adversarial testing discipline, and directly protects the highest-stakes explicit user constraint (`conflict:warning` dormancy).
- **Unexpected discoveries**: That testing "as an operator" (merge-readiness pass) found a real gap ("Team Live" terminology) that testing "as the documentation's own vocabulary" (all prior phases, including the 119-question corpus and the 36-question adversarial review) had missed entirely — a genuine methodological lesson, not just a bug.
- **Corrections**: See Evolution Timeline; none required rewriting prior work, all were additive fixes.
- **Deviations from plan**: None material — Phases 4-27 were completed largely as originally scoped, with the merge-readiness pass added as a user-directed final gate not present in the original Stage 2 brief's own phase numbering.

## User Feedback

- **Feedback summary**: Approval of the Phase 0-3 audit with explicit preservation constraints (Capability/Workflow architecture, four Registry distinctions, `conflict:warning` dormancy, Registry authority boundaries).
  - **Affected design area**: Overall Stage 2 architecture.
  - **Action taken**: Proceeded through Phases 4-27 honoring every named constraint.
  - **Outcome**: No constraint was ever found violated in final state; one was found violated mid-construction (Revision 2) and fixed before being shown to the user.
  - **Accepted / partially accepted / rejected**: Accepted in full.
  - **Reasoning**: N/A — direct instruction.

- **Feedback summary**: "Stage 2 implementation is accepted as complete. Before merging... perform one final MERGE READINESS AND USER-EXPERIENCE ACCEPTANCE PASS... This is not another architecture phase and not Stage 3. Do not add new scope unless you find a genuine defect."
  - **Affected design area**: Scope discipline for the final pre-merge pass.
  - **Action taken**: Distinguished genuine defects (fixed: dark-mode contrast, form labels, table overflow, Team Live terminology gap) from missing features (documented, not built: hash-routing/back-forward navigation).
  - **Outcome**: Three UI defects and one significant terminology gap fixed; no new scope added.
  - **Accepted / partially accepted / rejected**: Accepted in full.
  - **Reasoning**: The instruction's own framing ("do not add new scope unless you find a genuine defect") required judgment calls at several points (e.g., whether missing ARIA tab semantics was a "defect" — judged yes, a real WCAG omission — versus missing hash-routing — judged no, a missing feature) — documented explicitly rather than applied silently.

- **Feedback summary**: "Approved. Stage 2 is accepted as READY TO MERGE. Proceed with the Stage 2 merge and historical/documentation closure only. Do NOT begin Stage 3 or add new Knowledge Portal functionality."
  - **Affected design area**: Merge execution and post-merge documentation scope.
  - **Action taken**: Merged via git plumbing (two-parent commit, history preserved, no squash), pushed to `origin/main`, verified independently from the actual merged state, and is now performing documentation closure only — this capsule is part of that closure, not new functionality.
  - **Outcome**: In progress at capsule-compile time — see Final Outcome for the state as of this writing.
  - **Accepted / partially accepted / rejected**: Accepted in full.
  - **Reasoning**: N/A — direct instruction.

## Visual Evidence

None recorded — no screenshots were captured (interactive browser access was unavailable in this session's environment for the entire engagement; see AI-FEAT-058's Pre-Merge Acceptance Pass section for the disclosed substitute-verification approach used instead).

## Testing and Verification

- **Tests run**: `knowledge.test.js`, `knowledgeHallucinationV2.test.js`, `knowledgeAdversarialPhase24.test.js`, `knowledgeMergeReadiness.test.js`, `knowledgeEventCoordination.test.js`, `integration.test.js`, `markdown.test.js`, `memory.test.js`, `ownershipManifest.test.js`, `query.test.js`, `validators.test.js`, `decisionValidators.test.js`, `generatedFreshness.test.js`, `impactAndDeterminism.test.js`, plus 22 `test/automation/*.test.js` files — re-run from the actual merged main state in an independent temporary worktree for the merge itself, then again after every change during the Revision 6 event-coordination reconciliation.
- **Results**: 376 individual assertions passing (155 standalone across 14 files + 221 automation across 22 files), 0 failures, at final state.
- **Manual verification**: Direct HTTP requests against a live local portal server instance (multiple ports across the engagement as the server was restarted after each fix); a 26-check operator-simulation script; a 13-question live Registry-acceptance script; a 15-question event-coordination acceptance script (all 15 user-supplied examples); `git diff --check`; two-consecutive-build determinism hash comparison.
- **Screenshots**: None.
- **Performance measurements**: Not applicable — this is a documentation/retrieval tool, not a performance-sensitive system.
- **Unresolved gaps**: True rendered-browser visual/interactive verification was never performed in this engagement (environment constraint) — disclosed at every relevant checkpoint (Stage 2 final report, Merge Readiness Report, AI-FEAT-058) rather than silently assumed complete.

## Final Outcome

- **What shipped**: A deterministic, local, citation-grounded Knowledge Engine — concept/intent retrieval layer, question classifier, 8 authored Workflow records (one, `AI-WF-006`, substantially expanded mid-closure to document distributed event coordination as a fifth first-class Registry concept), roadmap/status routing, 11 curated boundaries (6 general + 5 Registry-scope, all with `hardOverride`), a 119-question evaluation corpus, four dedicated regression suites (hallucination, adversarial, merge-readiness, event-coordination), and a 9-tab local portal with directory/onboarding browsing mode. Merged to `main` at commit `765e9b8`; event-coordination reconciliation committed as a direct follow-up commit on `main` in the same closure pass.
- **What did not**: No LLM, no embeddings, no live Registry dashboard integration, no production Electron integration, no new AutoIngest release, no Stage 3 work.
- **Final architecture**: See AI-FEAT-058's own Stage 2 sections in full — this capsule does not restate the technical architecture, only the narrative of how it came to be.
- **Final user workflow**: `node scripts/product-docs/cli.js knowledge ask "<question>"`, `knowledge eval`/`eval-v2`, `knowledge serve` (local portal at `127.0.0.1`).
- **Known limitations**: See AI-FEAT-058's Pre-Merge Acceptance Pass § Remaining Limitations and this capsule's Follow-up work below.
- **Follow-up work**: True rendered-browser verification; remaining Workflow-record coverage (Class A: event editing/finding); a production-integration decision (standalone vs. AutoIngest-integrated); a decision on whether semantic/AI-assisted retrieval is actually needed given observed deterministic-retrieval quality; a live-Registry-integration decision (explicitly separate from this documentation portal); UX polish from real operator use; a maintenance process to keep new capabilities/workflows automatically discoverable; and — newly identified in Revision 6 — a full evidence review of `AI-FEAT-048`'s own canonical record, which this pass found to understate its actual implemented scope but deliberately did not rewrite (out of this investigation's mandate).

## Lessons

- **Reusable engineering lessons**: (1) A "strong raw match on a real, correctly-matched parent feature" is not competing evidence against a narrower boundary claim about that same feature's scope — this distinction, once identified, generalizes beyond this specific system. (2) Testing in the target audience's own vocabulary (operator phrasing) surfaces gaps that testing in the documentation's own internal vocabulary does not — even a large, deliberately-adversarial corpus (36 new questions, verified distinct) still missed the "Team Live" naming gap, because it was still authored by someone who already knew the internal term "Online Registry." (3) A concept-hint trigger word must be checked for accidental substring collisions with unrelated common words (`coordinate` inside `coordinates`) — short, generic trigger words are a real, recurring risk class in this kind of system, not a one-off.
- **Feature-specific lessons**: The five Registry-scope boundaries and the `hardOverride` mechanism are the load-bearing safety mechanism for this entire feature's highest-stakes constraint — any future work touching `lib/statusResolution.js` or `lib/intentConcepts.js` should re-run `knowledgeHallucinationV2.test.js` and `knowledgeMergeReadiness.test.js` specifically, not just the general suite.
- **Rejected patterns**: A "team-authority" concept cluster that recognized a question family but boosted confidence toward the wrong answer instead of routing to a boundary — the pattern of "recognize the topic, then guess the polarity" is fragile; explicit boundary routing is more reliable than hoping a strong match implies the right answer.
- **Future warnings**: Any future Stage should re-verify the full 119-question corpus (or its successor) before and after any change to the concept layer, boundary table, or question classifier — this engagement's own history shows that even well-intentioned broadening (EXPLANATION gate) can have non-obvious side effects across the corpus, both positive and negative, that only a full re-run reveals.

## Provenance

- **Source Evidence Packets**: None — not linked to a Part 5 Evidence Packet; this engagement's commits were made directly via `git commit`, not through the `automation` CLI's Evidence Packet workflow.
- **Commits**: `e33f290`, `74297d2`, `696f25f`, `5e25b9e`, `0277cd9`, `00f0480`, `607b0d2`, `f566788`, `9e15788`, `bcc29ce`, `efc8553`, `7f180e9`, `d89440b` (knowledge-portal-stage2, 13 commits), `765e9b8` (merge commit on main).
- **Test reports**: See Testing and Verification above.
- **Screenshots**: None.
- **Imported conversation artifacts**: None — this work was performed natively across this session's own turns, not imported from an external AI tool via the Part 8 conversation-import pipeline. No existing `ENG-CONV-####` record covers this work, and none was created for it — creating one would misrepresent native session work as an imported external-tool conversation, which this system's own evidence-discipline rules (§18_ENGINEERING_CONVERSATION_POLICY.md) do not support. This memory capsule is the correct mechanism instead.
- **Explicit user statements**: The three approval messages quoted/paraphrased in User Feedback above are explicit user statements, distinguished from agent inference throughout this capsule.
- **Evidence-pending items**: Source session ID(s) (this repository's session-ID convention was not applied to this engagement); the exact date/time boundaries between phases (recorded only as "2026-08-13"/"2026-08-14" — the engagement spanned parts of both dates without more precise timestamps captured contemporaneously).
