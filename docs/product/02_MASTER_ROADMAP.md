# Master Roadmap

Canonical, ordered implementation roadmap. Do not reorder unless the project owner explicitly reprioritizes — see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md).

**Roadmap IDs (`AI-RM-###`) are milestone identities, not feature identities.** A milestone may introduce one feature, expand several existing features, depend on multiple features, or consolidate multiple feature areas — see [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) for the actual product-capability inventory (`AI-FEAT-###`).

**Current position**: Completed milestone: **AI-RM-001**. Next milestone: **AI-RM-002**. Active implementation of AI-RM-002: **Not started** (confirmed — see AI-FEAT-049's evidence status). Following milestone: **AI-RM-003**. Overall milestone progress (AI-RM-001…009 archive-capability sequence): **1/9 complete**.

**AI-RM-010** (Multi-Channel Release & Update System) is a separate, parallel release-infrastructure track, not a continuation of the sequence above — see its own entry below. Status: **Completed** — verified on real Windows hardware (2026-08-13).

**AI-RM-012** (AutoIngest Knowledge & Onboarding Portal — Stage 1) is also a separate, parallel track — a documentation/tooling initiative, not a continuation of the AI-RM-001…009 archive-capability sequence. Status: **In Progress** — Stage 1 (prototype) complete, Stage 2 not started (see AI-FEAT-059; the full multi-stage portal is not scheduled here as a single milestone, see that milestone's own entry for why).

**AI-RM-011** (Multi-Event Import) is likewise a separate track, not a continuation of the AI-RM-001…009 archive-capability sequence: an ingestion-workflow enhancement. Status: **In progress** — implemented and verified on branch `feature/multi-event-import`; merge and release pending. See its own entry below.

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

## AI-RM-011 — Multi-Event Import

| Field | Value |
|---|---|
| Status | **In progress** (implemented and verified on `feature/multi-event-import`; not yet merged to `stable/0.9` or released) |
| Objective | Let an operator open one import source (card, drive, USB, local folder — source-agnostic), assign its files to several events, and import them in ONE pass, with every file routed and tagged by its own event, without weakening any copy-safety, naming, metadata or transaction rule. |
| Included AI-FEAT IDs | AI-FEAT-058 |
| Existing features extended | AI-FEAT-017 (Grouping System — per-event instances), AI-FEAT-019 (Import Pipeline & Copy Engine), AI-FEAT-021 (Atomic Import Transaction — orchestrated per event), AI-FEAT-009 / AI-FEAT-010 (event picker/creator reused), AI-FEAT-024 (Source Cleanup — eligibility unchanged), AI-FEAT-025 (Deep Verify accumulation), AI-FEAT-044 (Local First sync manifests per event) |
| Dependencies | None — a parallel ingestion-workflow track (deliberately not written as a range of milestone IDs, per the note on AI-RM-010). |
| Deliverables | `renderer/importSession.js`, `renderer/importSessionRunner.js`, `renderer/importSessionUI.js`, `renderer/metadataBatchTracker.js`; `createGroupManager()` factory + facade; EventCreator snapshot/capture/guard APIs; two additive `main/main.js` changes; `docs/multi-event-import.md`; 7 test files (unit + live). |
| Acceptance criteria | Live verification with synthetic fixtures: camera-card-style and plain-folder sources; A→B→C→A switching without rescanning; one combined review and one import; exact per-event routing and per-event metadata isolation (real ExifTool); event-local failure continues and retries; source removal resets the session; exact cleanup list; new-event creation from inside the workspace; multi-event Local First; the original single-event path unchanged; no Tag Refinement code reintroduced. |
| Planned estimate | Single implementation session (2026-09-20) |
| Current risks | Merge and release verification not yet performed. Two import code paths coexist (transitional). Known limitations in `docs/multi-event-import.md` §11. Per-Photo Tag Refinement is held out of Stable and is not part of this milestone. |
| Next action | Owner review of the final report; commit breakdown approval; merge decision. |

---

## AI-RM-012 — AutoIngest Knowledge & Onboarding Portal (Stage 1 + Stage 2)

| Field | Value |
|---|---|
| Status | **Completed — Stage 1 + Stage 2 merged to `main`** (merge commit `765e9b8`, 2026-08-14). Stage 1 (prototype) and Stage 2 Phases 4–27 (concept/intent retrieval layer, Workflow record type, roadmap routing, Online Registry/teamwork coverage, 119-question eval corpus, hallucination/grounding + adversarial suites, 9-tab portal UX + directory/onboarding mode, mandatory final-report sections, and a pre-merge acceptance pass) all complete and verified from the actual merged `main` state. Stage 3 has not begun and requires separate approval. |
| Objective | Stage 1: prove that AutoIngest's existing `docs/product/` documentation system can power a grounded, citation-honest, natural-language operator answer engine without an LLM, embeddings, or a hosted service. Stage 2 (approved after Stage 1 + a dedicated Phase 1-3 audit): extend that engine with real operator-workflow knowledge, natural-language concept/synonym retrieval, roadmap-aware answers, and substantial, carefully-bounded Online Registry/teamwork coverage — still with no LLM, embeddings, or live service integration. |
| Included AI-FEAT IDs | AI-FEAT-059 |
| Existing features extended | None — reads the existing feature registry generically; no existing `AI-FEAT` record's own behavior changed |
| Dependencies | None — a parallel documentation/tooling track, not a continuation of the AI-RM-001…009 archive-capability sequence above (deliberately not spelled out as a range in this field — see AI-RM-010's own note above for why) |
| Deliverables | Stage 1: `docs/product/generated/knowledge-index.json`, `lib/knowledgeIndex.js`, `lib/statusResolution.js`, `lib/knowledgeEngine.js`, `lib/knowledgeCli.js`, `lib/knowledgeEval.js`, `lib/knowledgeTestCorpus.js`, `knowledge <sub>` CLI, minimal local static+API portal, [DEC-021](decisions/DEC-021_KNOWLEDGE_ENGINE_REUSES_EXISTING_RETRIEVAL_NO_NEW_SEARCH_SYSTEM.md). Stage 2: `lib/intentConcepts.js`, `lib/questionClassifier.js`, `lib/workflowIndex.js`, 8 authored `AI-WF-###` Workflow records (`docs/product/workflows/`), `docs/product/generated/workflow-index.json`, [DEC-020](decisions/DEC-020_STAGE_2_KNOWLEDGE_ARCHITECTURE_WORKFLOW_RECORDS_AND_CONCEPT_LAYER.md), `lib/knowledgeTestCorpusV2.js` (99-question expanded corpus), `test/knowledgeHallucinationV2.test.js`, `test/knowledgeAdversarialPhase24.test.js`, 6 new curated `KNOWN_BOUNDARIES` entries (5 Registry-scope + `hardOverride` extended to all 11), portal extended from 3 tabs to 9 (`/api/status`, `/api/troubleshooting`, `/api/directory`). |
| Acceptance criteria | Stage 1: `knowledge.test.js` 17/17, full 33-file suite unaffected, `validate` clean, 20-question corpus 18/20 exact. Stage 2 (final, verified from merged `main`): `knowledge.test.js` 18/18, `knowledgeHallucinationV2.test.js` 10/10, `knowledgeAdversarialPhase24.test.js` 8/8, `knowledgeMergeReadiness.test.js` 7/7, 354 total assertions across 35 test files green, `validate` 0 errors, combined 119-question corpus 99/119 exact pass + 20/119 documented known limitations + 0/119 unexplained, live Online Registry/Teamwork acceptance script 13/13. |
| Planned estimate | Stage 1: single implementation session (2026-08-13). Stage 2: single extended implementation session spanning 2026-08-13 to 2026-08-14 (Phases 1-27 plus a user-directed pre-merge acceptance pass and merge). |
| Current risks | Retrieval-precision gaps inherent to reusing `lib/query.js` unchanged remain for cases with no curated concept/boundary coverage (no stemming, no typo tolerance, no compound-claim verification) — disclosed per-question in both eval corpora's `knownLimitation` fields rather than silently patched; see AI-FEAT-059's Future Enhancements. No blocking risk to what has shipped — every disclosed gap resolves to an honest hedge or `UNKNOWN`, never a confident false claim, verified specifically by the Phase 21/24/merge-readiness hallucination/adversarial suites. |
| Next action | None for this milestone — complete and merged. Deferred future-work items (true rendered-browser verification, remaining Workflow-record coverage, a production-integration decision, a semantic/AI-assisted-retrieval necessity review, a separate live-Registry-integration architecture decision, UX polish from real operator use, and an automatic-discoverability maintenance process) are recorded, not scheduled — see AI-FEAT-059's Future Enhancements. Any Stage 3 work requires separate review and authorization. |

---

## AI-RM-013 — MX Creative Console Hardware Integration (Unified Contextual Keypad)

| Field | Value |
|---|---|
| Status | **In progress** (implemented and physically verified on `feature/mx-creative-console-v2`; not yet merged to `main` or `stable/0.9`) |
| Objective | Let an operator drive AutoIngest's core Browse/Groups/Map Group/Refine Tags workflows directly from the physical Logitech MX Creative Console Keypad and dial, without the software UI, as a hardware control surface that stays in sync with AutoIngest's own authoritative state. |
| Included AI-FEAT IDs | AI-FEAT-060 |
| Existing features extended | None recorded as independently touched — the plugin is a separate C# process (`integrations/logitech/autoingest-mx-csharp/`) that talks to AutoIngest over its existing local WebSocket command layer ([docs/commandLayer.md](../commandLayer.md)); it does not modify any existing AutoIngest renderer/main feature's own code. |
| Dependencies | None — a parallel hardware-integration track, not a continuation of the AI-RM-001…009 archive-capability sequence (deliberately not written as a range of milestone IDs, per the note on AI-RM-010). |
| Deliverables | `integrations/logitech/autoingest-mx-csharp/` — the C# Logitech plugin itself, including `src/Helpers/ContextualKeypadController.cs`/`ContextualKeypadModel.cs`/`ContextSlotBinding.cs`, nine `src/Actions/ContextSlotA1.cs`–`ContextSlotA9.cs` native multistate actions, and the retained (not deleted) `RefineTagsFolder.cs`/`GroupsFolder.cs`/`GroupMappingFolder.cs`; `integrations/logitech/autoingest-mx-csharp/docs/mxLogitechCSharp.md`/`mxLogitechPlugin.md`; `integrations/logitech/autoingest-mx-csharp/test/AutoIngestMxCsDevPlugin.Tests/` (116 tests as of this session). |
| Acceptance criteria | Physically verified end-to-end on the real MX Creative Keypad: Browse layout (G1/G2/G3, GROUPS/MAP GROUP/REFINE TAGS mode entry, CHANGE EVENT/IMPORT); Groups mode (real groups listed, dial paging, assignment via press, Back); Map Group mode (real components, current-mapping/taken-by-other coloring, remapping, dial paging, ambiguous-selection safety); Refine Tags mode (real tag labels, default/checked/indeterminate color states, Apply/All Tags/Reset Tags, CLOSE replacing BACK per an explicit operator decision); label truncation; 116/116 `dotnet test` passing. User-confirmed final verification: "i have done all the tests alls working fine." |
| Planned estimate | Evidence pending for phases predating this session (Phase 1A/3A-D/4A/4B — see AI-FEAT-060's Original Plan / Intent). This session's own Unified Contextual Keypad migration (native multistate spike → contextual keypad spike → production migration → three physical bug fixes) ran in a single extended session (2026-10-15). |
| Current risks | `RefineTagsFolder`/`GroupsFolder`/`GroupMappingFolder` (the retired `PluginDynamicFolder`-based implementation) are kept as source/reference, not deleted — a future session should decide whether to remove them now that the native replacement is physically proven. Not yet merged to `main`/`stable/0.9`; a merge/release decision is a separate, not-yet-made step. |
| Next action | Owner decision on whether/when to merge `feature/mx-creative-console-v2`; optionally, a follow-up session to remove the retired `PluginDynamicFolder` source now that it is superseded. |
