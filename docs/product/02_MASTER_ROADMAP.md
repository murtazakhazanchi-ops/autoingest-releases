# Master Roadmap

Canonical, ordered implementation roadmap. Do not reorder unless the project owner explicitly reprioritizes — see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md).

**Roadmap IDs (`AI-RM-###`) are milestone identities, not feature identities.** A milestone may introduce one feature, expand several existing features, depend on multiple features, or consolidate multiple feature areas — see [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) for the actual product-capability inventory (`AI-FEAT-###`).

**Current position**: Completed milestone: **AI-RM-001**. Next milestone: **AI-RM-002**. Active implementation of AI-RM-002: **Not started** (confirmed — see AI-FEAT-049's evidence status). Following milestone: **AI-RM-003**. Overall milestone progress (AI-RM-001…009 archive-capability sequence): **1/9 complete**.

**AI-RM-010** (Multi-Channel Release & Update System) is a separate, parallel release-infrastructure track, not a continuation of the sequence above — see its own entry below. Status: **Completed** — verified on real Windows hardware (2026-08-13).

**AI-RM-011** (AutoIngest Knowledge & Onboarding Portal — Stage 1 + Stage 2) is also a separate, parallel track — a documentation/tooling initiative, not a continuation of the AI-RM-001…009 archive-capability sequence. Status: **Completed** — Stage 1 (prototype), Stage 2 (merged to `main` 2026-08-14), and two post-merge remediation passes (Part 2, closed 2026-08-14; Part 3 Knowledge Neighborhood Remediation, closed 2026-08-18) are all complete (see AI-FEAT-058; the full multi-stage portal is not scheduled here as a single milestone, see that milestone's own entry for why). Stage 3 has not begun and requires separate approval.

---

## AI-RM-001 — Metadata Audit & Repair

| Field | Value |
|---|---|
| Status | **Completed** |
| Objective | Give operators a way to audit archive-wide metadata correctness and repair drift, without ever blocking or rolling back the original import copy. |
| Included AI-FEAT IDs | AI-FEAT-029, AI-FEAT-030, AI-FEAT-031, AI-FEAT-032, AI-FEAT-033, AI-FEAT-034, AI-FEAT-035, AI-FEAT-036, AI-FEAT-037 |
| Existing features extended | AI-FEAT-004 (event.json's `metadataState` block), AI-FEAT-003 (Dashboard Metadata Health tile) |
| Dependencies | None — foundational for all later metadata-adjacent work |
| Deliverables | Shared write engine, durable crash-recoverable queue, 9-state event-level derivation, streaming resumable audit scanner, frozen-snapshot repair, consolidated Metadata Management modal, Dashboard health card |
| Acceptance criteria | Live-verified end-to-end through the real UI (not only unit tests) — the original root-cause bug this system was built to fix (QMZ silently dropping keywords/Hijri date) confirmed fixed via real ExifTool read-back (`docs/metadata-system.md`) |
| Planned estimate | Evidence pending (predates this documentation system) |
| Current risks | None blocking — see AI-FEAT-033's Known Bugs section for the one documented, non-blocking limitation (preview-session identifier does not survive the Preview→Confirm round trip) |
| Next action | None — complete. Recent work (2026-08-02 through 2026-08-04) has been UI polish on the already-delivered Metadata Management Modal, not new scope. |

---

## AI-RM-002 — Archive Maintenance

| Field | Value |
|---|---|
| Status | Planned — not started |
| Objective | Evidence pending — not yet documented as fact |
| Included AI-FEAT IDs | AI-FEAT-049 |
| Existing features extended | Evidence pending |
| Dependencies | AI-RM-001 (complete) |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 3–5 weeks (see [03_IMPLEMENTATION_TIMELINE.md](03_IMPLEMENTATION_TIMELINE.md)) |
| Current risks | Scope not yet defined |
| Next action | Discovery and specification |

---

## AI-RM-003 — Event Maintenance

| Field | Value |
|---|---|
| Status | Planned — not started |
| Objective | Evidence pending — not yet documented as fact |
| Included AI-FEAT IDs | AI-FEAT-050 |
| Existing features extended | Evidence pending |
| Dependencies | AI-RM-002 |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 4–6 weeks |
| Current risks | Scope not yet defined |
| Next action | Not started — follows AI-RM-002 |

---

## AI-RM-004 — Archive Browser

| Field | Value |
|---|---|
| Status | Planned — not started |
| Objective | Evidence pending — not yet documented as fact |
| Included AI-FEAT IDs | AI-FEAT-051 |
| Existing features extended | Evidence pending |
| Dependencies | AI-RM-003 |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 5–7 weeks |
| Current risks | Scope not yet defined |
| Next action | Not started — follows AI-RM-003 |

---

## AI-RM-005 — Global Search

| Field | Value |
|---|---|
| Status | Planned — not started |
| Objective | Evidence pending — not yet documented as fact |
| Included AI-FEAT IDs | AI-FEAT-053 |
| Existing features extended | Evidence pending |
| Dependencies | AI-RM-004 (search scope likely follows browser scope) |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 3–5 weeks |
| Current risks | Scope not yet defined |
| Next action | Not started — follows AI-RM-004 |

---

## AI-RM-006 — Integrity Verification

| Field | Value |
|---|---|
| Status | Planned — not started |
| Objective | Evidence pending — not yet documented as fact. Narrower prior art exists: AI-FEAT-025 (import-batch and sync-job checksum verification) — this milestone's scope is expected to be broader (archive-wide), not merely a rename of that existing capability. |
| Included AI-FEAT IDs | AI-FEAT-054 |
| Existing features extended | AI-FEAT-025 (prior art, narrower scope) |
| Dependencies | AI-RM-005 |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 3–4 weeks |
| Current risks | Scope overlap with AI-FEAT-025 needs explicit disambiguation before implementation starts, to avoid duplicating the existing `getFileHash()`-based mechanism without a clear reason |
| Next action | Not started — follows AI-RM-005 |

---

## AI-RM-007 — Archive Repair

| Field | Value |
|---|---|
| Status | Planned — not started |
| Objective | Close the documented gap in AI-FEAT-043: "the diagnostics layer reports issues but does not auto-fix them" (`docs/archive-operations-layer.md`). |
| Included AI-FEAT IDs | AI-FEAT-052 |
| Existing features extended | AI-FEAT-043 (Archive Health Reporting — this milestone is expected to act on what that feature detects) |
| Dependencies | AI-RM-006 |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 4–6 weeks |
| Current risks | **Naming collision**: `services/archiveRepairService.js` already exists but implements an unrelated narrow temp-file-cleanup utility (Phase 13B-2, `.autoingest-sync-tmp`/`.autoingest-tx-tmp` only) — see AI-FEAT-052's Decisions section. Whoever scopes this milestone should resolve the naming collision before adding code to that file. |
| Next action | Not started — follows AI-RM-006 |

---

## AI-RM-008 — Archive Analytics

| Field | Value |
|---|---|
| Status | Planned — not started |
| Objective | Evidence pending — not yet documented as fact |
| Included AI-FEAT IDs | AI-FEAT-055 |
| Existing features extended | AI-FEAT-043 (expected data source) |
| Dependencies | AI-RM-007 |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 2–4 weeks |
| Current risks | Scope not yet defined |
| Next action | Not started — follows AI-RM-007 |

---

## AI-RM-009 — AI Archive Intelligence

| Field | Value |
|---|---|
| Status | Planned — not started |
| Objective | Evidence pending — not yet documented as fact |
| Included AI-FEAT IDs | AI-FEAT-056 |
| Existing features extended | AI-FEAT-055 (expected foundation) |
| Dependencies | AI-RM-008 |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 6–10 weeks |
| Current risks | Least-scoped item in the entire roadmap — nothing about its eventual shape should be assumed from its name alone |
| Next action | Not started — follows AI-RM-008; final milestone in the AI-RM-001…009 archive-capability sequence (AI-RM-010 is a separate, parallel release-infrastructure track — see below, not a continuation of this sequence) |

---

## AI-RM-010 — Multi-Channel Release & Update System

| Field | Value |
|---|---|
| Status | **Completed** — verified on real Windows hardware (2026-08-13) |
| Objective | Formalize AutoIngest's release process into three isolated channels (Development, RC/Preview, Stable) so a tester-facing build can never reach Stable users, and a verified RC has an auditable, gated promotion path to Stable. |
| Included AI-FEAT IDs | AI-FEAT-057 |
| Existing features extended | AI-FEAT-006 (Application Auto-Update), AI-FEAT-005 (Application Settings & Configuration Store) |
| Dependencies | None — a parallel infrastructure track, not a continuation of the numbered archive-capability sequence above (deliberately not spelled out as a range in this field, since this system's ID-extraction treats any milestone-ID-shaped text here as a real dependency reference — see the roadmap's own intro note above). Motivated directly by the v0.9.11 stabilization release and its release-process incident ([PM-002](postmortems/PM-002_V0_9_11_FIRST_PUBLICATION_ATTEMPT_PRODUCED_AN_EMPTY_GITHUB_RELEASE.md)). |
| Deliverables | Development/RC/Stable CI jobs in `.github/workflows/release.yml` (including a `stable-release-gate` job so the gate runs automatically before every real Stable publish, not only when a human remembers to run it manually); `services/autoUpdater.js` channel awareness; a Stable/Preview Settings toggle; a channel-aware `release gate` (version/tag/lockfile/source-drift/blocking-bug checks, all hard-blocking, with automatic prior-RC-tag discovery for the Stable CI path); QA-checklist and promotion-readiness additions to the existing release-intelligence draft builder; [DEC-017](decisions/DEC-017_STABLE_RELEASES_REBUILD_FROM_VERIFIED_RC_SOURCE_NEVER_PROMOTE_EXACT_BINARIES.md) (rebuild-from-verified-source promotion model) |
| Acceptance criteria | Fully verified across all four evidence tiers: 19 regression assertions (`scripts/product-docs/test/automation/updateChannel.test.js`) verified directly against `electron-updater`/`electron-builder`'s installed source; three real `workflow_dispatch` RC publications against the live GitHub repository (`v0.9.12-rc.1`, `rc.2`, `rc.3`) with Stable metadata independently re-verified untouched after each; and real-Windows-client evidence for the full lifecycle — Stable isolation, manual first-time Preview bootstrap, in-place install with data/settings preservation, Preview↔Stable channel switching, Preview→Preview automatic discovery/download/install, and no downgrade to older Stable. See AI-FEAT-057's Acceptance Matrix for the full evidence-tier breakdown. |
| Planned estimate | Single implementation session (2026-08-12), plus a three-part live-pilot verification arc (2026-08-13) |
| Current risks | None blocking. Two CI-only bugs were found and fixed during the pilot ([BUG-015](bugs/BUG-015_WINDOWS_RUNNER_DEFAULT_POWERSHELL_SHELL_MANGLES_ELECTRON_BUILDER_DOT_NOTATION_CLI_OVERRIDES.md), [BUG-016](bugs/BUG-016_UNDECLARED_NPM_DEPENDENCY_IN_PRODUCT_DOCS_TOOLING_MASKED_BY_LOCALLY_HOISTED_NODE_MODULES.md)) — both closed. One accepted (non-blocking) structural note: `rc-build-windows`/`rc-build-mac` have no atomic dual-platform publish gate (see AI-FEAT-057's Decisions section). One non-blocking UX candidate identified (exact running version, including prerelease suffix, not confidently visible to a tester in-app — see AI-FEAT-057's Future Enhancements). |
| Next action | None — complete. A future real Stable release (whenever separately authorized) will automatically carry the Update Channel selector to the entire existing Stable install base as an ordinary update; no further migration work is required for that transition. |

---

## AI-RM-011 — AutoIngest Knowledge & Onboarding Portal (Stage 1 + Stage 2)

| Field | Value |
|---|---|
| Status | **Completed — Stage 1 + Stage 2 merged to `main`, plus two post-merge remediation passes.** Stage 1 (prototype) and Stage 2 Phases 4–27 (concept/intent retrieval layer, Workflow record type, roadmap routing, Online Registry/teamwork coverage, 119-question eval corpus, hallucination/grounding + adversarial suites, 9-tab portal UX + directory/onboarding mode, mandatory final-report sections, and a pre-merge acceptance pass) merged to `main` via commit `765e9b8` (2026-08-14). **Part 2 Knowledge Architecture Remediation** (cross-type retrieval, semantic keyword indexing, Transfer Import workflow, hybrid dependency model — 5 approved decisions) closed 2026-08-14. **Part 3 Knowledge Neighborhood Remediation** (retrieval-hardening, relationship visibility, minimum-sufficient neighborhoods, bounded historical context, decomposition-necessity gate — Decisions 1–7 of 8, plus a separately-gated RF-5.4-005 authority-scope investigation, closed unimplemented) closed 2026-08-18. All four stages verified from the actual repository state at their own closure, not assumed equivalent to an earlier pass. Stage 3 has not begun and requires separate approval. |
| Objective | Stage 1: prove that AutoIngest's existing `docs/product/` documentation system can power a grounded, citation-honest, natural-language operator answer engine without an LLM, embeddings, or a hosted service. Stage 2 (approved after Stage 1 + a dedicated Phase 1-3 audit): extend that engine with real operator-workflow knowledge, natural-language concept/synonym retrieval, roadmap-aware answers, and substantial, carefully-bounded Online Registry/teamwork coverage — still with no LLM, embeddings, or live service integration. Part 2 and Part 3: post-merge remediation and hardening of retrieval/relationship/neighborhood/historical-context correctness against findings from dedicated audits — not new operator-facing capability, and governed by the same no-LLM/no-embeddings/no-live-service constraints. |
| Included AI-FEAT IDs | AI-FEAT-058 |
| Existing features extended | None — reads the existing feature registry generically; no existing `AI-FEAT` record's own behavior changed |
| Dependencies | None — a parallel documentation/tooling track, not a continuation of the AI-RM-001…009 archive-capability sequence above (deliberately not spelled out as a range in this field — see AI-RM-010's own note above for why) |
| Deliverables | Stage 1: `docs/product/generated/knowledge-index.json`, `lib/knowledgeIndex.js`, `lib/statusResolution.js`, `lib/knowledgeEngine.js`, `lib/knowledgeCli.js`, `lib/knowledgeEval.js`, `lib/knowledgeTestCorpus.js`, `knowledge <sub>` CLI, minimal local static+API portal, [DEC-019](decisions/DEC-019_KNOWLEDGE_ENGINE_REUSES_EXISTING_RETRIEVAL_NO_NEW_SEARCH_SYSTEM.md). Stage 2: `lib/intentConcepts.js`, `lib/questionClassifier.js`, `lib/workflowIndex.js`, 8 authored `AI-WF-###` Workflow records (`docs/product/workflows/`), `docs/product/generated/workflow-index.json`, [DEC-020](decisions/DEC-020_STAGE_2_KNOWLEDGE_ARCHITECTURE_WORKFLOW_RECORDS_AND_CONCEPT_LAYER.md), `lib/knowledgeTestCorpusV2.js` (99-question expanded corpus), `test/knowledgeHallucinationV2.test.js`, `test/knowledgeAdversarialPhase24.test.js`, 6 new curated `KNOWN_BOUNDARIES` entries (5 Registry-scope + `hardOverride` extended to all 11), portal extended from 3 tabs to 9 (`/api/status`, `/api/troubleshooting`, `/api/directory`). Part 2: cross-type retrieval (`answerFromGovernanceRecord()`), `lib/textKeywords.js`, `lib/dependencyModelFragments.js`, `workflows/AI-WF-009_IMPORT_OR_UPDATE_FROM_A_TRANSFER_DRIVE.md` (9th Workflow record). Part 3: `lib/knowledgeSurfaceNormalization.js`, `lib/knowledgeNeighborhood.js`, `lib/knowledgeHistoricalContext.js`, `lib/knowledgeEvalClassification.js`, `lib/knowledgeRegressionCorpusV3.js` (46-entry hardened baseline-comparison corpus), further Post-Decision Evolution entries on DEC-020 — see AI-FEAT-058's own Evolution Journal for the complete Part 2/Part 3 file lists. |
| Acceptance criteria | Stage 1: `knowledge.test.js` 17/17, full 33-file suite unaffected, `validate` clean, 20-question corpus 18/20 exact. Stage 2 (final, verified from merged `main`): `knowledge.test.js` 18/18, `knowledgeHallucinationV2.test.js` 10/10, `knowledgeAdversarialPhase24.test.js` 8/8, `knowledgeMergeReadiness.test.js` 7/7, 354 total assertions across 35 test files green, `validate` 0 errors, combined 119-question corpus 99/119 exact pass + 20/119 documented known limitations + 0/119 unexplained, live Online Registry/Teamwork acceptance script 13/13. Part 2: `validate` 0 errors throughout, 99-question V2 corpus 80/99 exact + 19/99 documented acceptable deviations + 0/99 unexplained, `git diff --check` clean. Part 3: each of its 7 decisions verified against a dedicated hardened, baseline-compared harness (`classifyRun()`/`knowledgeRegressionCorpusV3.js`) with zero unexplained harmful regressions at every closure checkpoint; `validate` 0 errors at this closure (re-confirmed 2026-08-18). **Disclosed, not hidden: as of this closure, `scripts/product-docs/test/knowledge.test.js`'s pre-existing "plausible-but-nonexistent capabilities are not confidently affirmed" negative test fails** — this is the already-known, Product-Owner-reviewed, intentionally-open `RF-4.3-EXT-001` confidence-safety gap (see AI-FEAT-058's Part 3 Evolution Journal) surfacing in an older Stage 1/2-era standalone test that was never updated to match that accepted tradeoff; it predates this documentation closure (confirmed via `git log`) and was not introduced by it. The full suite is therefore not 100% green at this milestone's completion — the one failure is disclosed, understood, and deliberately not silently presented as passing. |
| Planned estimate | Stage 1: single implementation session (2026-08-13). Stage 2: single extended implementation session spanning 2026-08-13 to 2026-08-14 (Phases 1-27 plus a user-directed pre-merge acceptance pass and merge). Part 2: single session, 2026-08-14. Part 3: 2026-08-17 to 2026-08-18 (Decisions 1–7 of 8, plus the separately-gated RF-5.4-005 investigation). |
| Current risks | Retrieval-precision gaps inherent to reusing `lib/query.js` unchanged remain for cases with no curated concept/boundary coverage (no stemming, no typo tolerance, no compound-claim verification) — disclosed per-question in both eval corpora's `knownLimitation` fields rather than silently patched; see AI-FEAT-058's Future Enhancements. No blocking risk to what has shipped — every disclosed gap resolves to an honest hedge or `UNKNOWN`, never a confident false claim, verified specifically by the Phase 21/24/merge-readiness hallucination/adversarial suites. Part 3 leaves a substantial, explicitly-named set of disclosed residuals unresolved by design (`RF-5.3-001`, `RF-4.3-EXT-001`, the `AI-WF-006` keyword-surface false-positive family, `RF-5.4-001`/`004`/`005`/`009`/`010`, the Memory chronology-placeholder weakness, the Phase 5.2 companion-Workflow guidance/admission disagreement, and others) — full list in AI-FEAT-058's Part 3 Evolution Journal section; none are hidden, none block current operation (every disclosed gap still resolves to an honest hedge, never a confident false claim). `RF-4.3-EXT-001` additionally now surfaces as a failing assertion in the older `knowledge.test.js` file (see Acceptance criteria above) — a real, currently-red standalone test, not merely a corpus-internal `known-baseline-failure` marker; reconciling that test file with the accepted tradeoff is unresolved. **Decision 8 of 8 has no definition anywhere in this repository** — not scheduled, not inferred, disclosed as a genuine gap. |
| Next action | None for this milestone — complete, merged, and its two post-merge remediation passes (Part 2, Part 3) both closed. Deferred future-work items (true rendered-browser verification, remaining Workflow-record coverage, a production-integration decision, a semantic/AI-assisted-retrieval necessity review, a separate live-Registry-integration architecture decision, UX polish from real operator use, an automatic-discoverability maintenance process, and Part 3's own disclosed residuals listed above) are recorded, not scheduled — see AI-FEAT-058's Future Enhancements and Part 3 Evolution Journal section. Any Stage 3 work, any further Knowledge Engine remediation phase, or a Decision 8 definition all require separate, explicit review and authorization — none is implied or scheduled by this closure. This milestone remains fully independent of the main `AI-RM-001…009` sequence: it neither blocks nor is blocked by `AI-RM-002` (Archive Maintenance), the roadmap's own next active milestone (see this file's own "Current position" note above) — the two tracks proceed on separate authorization paths. |
