# Master Roadmap

Canonical, ordered implementation roadmap. Do not reorder unless the project owner explicitly reprioritizes — see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md).

**Roadmap IDs (`AI-RM-###`) are milestone identities, not feature identities.** A milestone may introduce one feature, expand several existing features, depend on multiple features, or consolidate multiple feature areas — see [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) for the actual product-capability inventory (`AI-FEAT-###`).

**Design decisions (2026-10-28)**: six owner design decisions for AI-RM-014 approved in [DEC-029](decisions/DEC-029_PHOTOGRAPHER_REGISTRY_AND_QUICK_INGEST_DESIGN_DECISIONS.md) — four final (single photographer list, rename keeps alias, multi-photographer handoff, calendar date + optional cross-midnight range), two approved with investigations pending (Q8 dependency audit; per-manufacturer camera tags). No implementation phase is approved by this.

**Current position (2026-11-14)**: Active milestone: **AI-RM-016** — CAM-001 (photographer recognised on card detection before any import; Keychain work isolated from the main process) released as RC Preview `v0.9.18-rc.4` (`0a95901`), awaiting owner feedback before EQI-2; not Stable. *(2026-11-13:* EQI-1 released as RC Preview `v0.9.18-rc.1` and used at a live event; EQI-1.1 (adaptive menu-bar companion) RC Preview `v0.9.18-rc.2` (`000f103`); EQI-1.2 (visual hierarchy, camera-aware photographer suggestions) released as RC Preview `v0.9.18-rc.3` (`cdeb0ea`), awaiting owner feedback; not Stable. EQI-2 to EQI-5 not started; AI-RM-014 Q5e still paused.)*

**Previous position (2026-11-12)**: Active milestone: **AI-RM-016 — Event Quick Import & Dump Sorting** (owner direction 2026-11-12, PRIORITY 1, for use during a live event) — [AI-FEAT-064](features/AI-FEAT-064_EVENT_QUICK_IMPORT_AND_DUMP_SORTING.md). EQI-0 done; EQI-1 (menu-bar Event Dump Quick Import) implemented and verified on `feature/event-quick-import-dump`, awaiting owner review at the EQI-1 release gate. AI-RM-014's remaining Q5e work (META, S3, COMP, S2–S8, live photographer renaming) is **paused** — not cancelled, not completed.

*Previous position statement (2026-10-28, kept per Append, Never Erase):* **Current position (2026-10-28)**: Active milestone: **AI-RM-014 — Quick Ingest & Desktop Experience**. Q1 (menu-bar/tray foundation) is implemented on `feature/menu-bar-companion-q1` @ `dd9493f` — Status Ladder rung 1 only, local, unmerged, owner review pending. On 2026-10-28 the owner expanded AI-RM-014 to phases Q0–Q9 (smart date-based assessment, camera identification, a shared photographer↔camera learning system, a Photographer Registry, merge-safe registry exchange, photographer suggestions in the Confirm Event Import modal, one-step Quick Ingest) — [DEC-028](decisions/DEC-028_SHARED_PHOTOGRAPHER_CAMERA_LEARNING_AND_APPROVED_UI_EXCEPTIONS.md), [AI-FEAT-063](features/AI-FEAT-063_PHOTOGRAPHER_CAMERA_IDENTITY_REGISTRY.md). Q2 has not started. Following milestone unchanged: AI-RM-015.

*Previous position statement (2026-10-27, kept per Append, Never Erase):* **Current position (2026-10-27)**: Next active milestone: **AI-RM-014 — Quick Ingest & Desktop Experience** (owner reprioritization, [DEC-027](decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md)). Its Q0 phase (audit, architecture, test matrix) is recorded in AI-FEAT-061. Q1 implementation has **not started** and awaits owner approval. Following new milestone: **AI-RM-015 — Backup Intelligence Foundation**. AI-RM-002 (Archive Maintenance) is no longer next; it keeps its record and moves later in the Priority Order below.

*Superseded position statement (kept per Append, Never Erase):* "Completed milestone: AI-RM-001. Next milestone: AI-RM-002. Active implementation of AI-RM-002: Not started. Following milestone: AI-RM-003. Overall milestone progress (AI-RM-001…009 archive-capability sequence): 1/9 complete." — superseded 2026-10-27 by DEC-027.

## Priority Order (authoritative, owner-directed 2026-10-27)

Milestone sections below remain in ID order, so existing links and other branches' edits keep working. **This list, not the section order, is the working priority.**

| # | Milestone | Status (see Status Ladder) |
|---|---|---|
| 1 | AI-RM-001 — Metadata Audit & Repair | Completed — Stable promoted. Preserve implementation and regression coverage. |
| 2 | AI-RM-013 — Logitech MX Creative Console Integration | Completed — Stable promoted in v0.9.14 (tag `v0.9.14` @ `093c721`, 2026-10-16), carried forward in v0.9.16. Production validation: evidence pending. |
| 3 | **AI-RM-014 — Quick Ingest & Desktop Experience** | **ACTIVE — PRIORITY 1.** Q1 foundation implemented on `feature/menu-bar-companion-q1` (review pending). Expanded 2026-10-28 to Q0–Q9, including the shared Photographer & Camera Identity Registry (AI-FEAT-063, DEC-028). The menu-bar/tray companion is the main new surface; the main window gets only the two DEC-028 exceptions. |
| 4 | Ask AutoIngest — Knowledge & Assistance (continuation of AI-RM-012's knowledge track) | Existing in-progress work on `feature/ask-autoingest`. Do not interrupt, merge, rewrite or discard it. No new AI-RM ID is allocated here (that branch still uses pre-DEC-022 numbering; reconcile IDs at its merge). |
| 5 | AI-RM-015 — Backup Intelligence Foundation | Planned. Also hosts AI-RM-006. |
| 6 | AI-RM-002 — Archive Maintenance & AutoIngest Archive Node | Planned. Also hosts AI-RM-007 and AI-RM-008. |
| 7 | AI-RM-003 — Event Maintenance | Planned |
| 8 | AI-RM-004 — Archive Browser & Discovery | Planned. Also hosts AI-RM-005 and, long-horizon, AI-RM-009. |

### Workstreams (owner-directed placement, 2026-10-27)

Each remaining milestone now sits in a workstream. No record was renumbered, deleted or marked superseded. A milestone placed under another one keeps its own ID, its history and its section below; its *remaining* scope is delivered as part of the host workstream.

| Workstream (host milestone) | Placed milestones | Basis for placement |
|---|---|---|
| Backup Intelligence (AI-RM-015) | AI-RM-006 Integrity Verification — Archive-Wide | Owner direction. AI-FEAT-054's archive-wide verification is the durable-verification/receipt scope of AI-FEAT-062 |
| Archive Maintenance & Archive Node (AI-RM-002) | AI-RM-007 Archive Repair; AI-RM-008 Archive Analytics | Owner direction for Repair. Analytics is placed here because AI-FEAT-055's only recorded dependency is AI-FEAT-043 archive health data, the same foundation AI-FEAT-049 builds on |
| Archive Browser & Discovery (AI-RM-004) | AI-RM-005 Global Search; AI-RM-009 AI Archive Intelligence (long-horizon, last) | AI-FEAT-053 depends on AI-FEAT-051 (Archive Browser). AI-FEAT-056's recorded dependency (AI-FEAT-055) is kept as a cross-workstream dependency. It is **not** placed under Ask AutoIngest: that track answers questions about AutoIngest itself, while AI-FEAT-056 concerns archive content |

*Superseded paragraph (kept per Append, Never Erase):* "Not yet placed by the owner (records unchanged, not cancelled): AI-RM-005 Global Search, AI-RM-006 Integrity Verification (overlaps AI-RM-015 — decision pending), AI-RM-007 Archive Repair (overlaps AI-RM-002 — decision pending), AI-RM-008 Archive Analytics, AI-RM-009 AI Archive Intelligence. Parallel tracks AI-RM-010, AI-RM-011 and AI-RM-012 are complete." — superseded 2026-10-27 by the owner's placement decision (DEC-027 Addendum).

### Standing guardrails for this priority period

- **Main-window UI is frozen** for AI-RM-014 ([DEC-027](decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md)). New UI is limited to the menu-bar/tray companion, native notifications and explicitly approved companion windows. **Two approved exceptions** ([DEC-028](decisions/DEC-028_SHARED_PHOTOGRAPHER_CAMERA_LEARNING_AND_APPROVED_UI_EXCEPTIONS.md), 2026-10-28, design scope only): (1) a Photographer Registry tab beside Keyword Registry in Metadata Management; (2) suggestions and inline Add Photographer in the Confirm Event Import modal's photographer field. Neither window is redesigned; any other main-window change needs separate approval.
- `stable/0.9` (verify against `origin/stable/0.9`; the local ref can lag) is the production baseline. `main` is not a production development base until reconciled.
- New work happens in a dedicated worktree + feature branch cut from the verified Stable HEAD, with one Claude Code session per worktree. Existing feature worktrees are never reset, cleaned, rebased or deleted.
- Preview RC → packaged physical validation → explicit approval → Stable. No merge to Stable and no publish without explicit approval.

### Status Ladder

A milestone is not "Completed" merely because a Preview exists. Statuses use these rungs, in order:

1. **Implementation complete** — built and tested on its feature branch.
2. **Preview verified** — shipped in a Preview/RC build and verified there.
3. **Stable promoted** — merged into `stable/0.9` and released under a Stable tag.
4. **Production validated** — confirmed in real operator use after Stable release, with recorded evidence.

The `Status` field keeps the word **Completed** only for milestones that reached at least rung 3 (the tooling's roadmap/dashboard agreement check keys on that word).

**AI-RM-010** (Multi-Channel Release & Update System) is a separate, parallel release-infrastructure track, not a continuation of the sequence above — see its own entry below. Status: **Completed** — verified on real Windows hardware (2026-08-13).

**AI-RM-012** (AutoIngest Knowledge & Onboarding Portal — Stage 1) is also a separate, parallel track — a documentation/tooling initiative, not a continuation of the AI-RM-001…009 archive-capability sequence. Status: **In Progress** — Stage 1 (prototype) complete, Stage 2 not started (see AI-FEAT-059; the full multi-stage portal is not scheduled here as a single milestone, see that milestone's own entry for why).

**AI-RM-011** (Multi-Event Import) is likewise a separate track, not a continuation of the AI-RM-001…009 archive-capability sequence: an ingestion-workflow enhancement. Status: **Completed** — Stable promoted in v0.9.13 (tag `v0.9.13` @ `a1223ad`, 2026-09-28, contains `feature/multi-event-import`). See its own entry below.

**AI-RM-014** (Quick Ingest & Desktop Experience) and **AI-RM-015** (Backup Intelligence Foundation) were added 2026-10-27 — see the Priority Order above and their own entries below.

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
| Status | Planned — not started. Priority Order #6 (moved behind AI-RM-014 and AI-RM-015 on 2026-10-27, DEC-027). |
| Objective | Owner-stated scope (2026-10-27): archive-health checks covering missing copies, sidecars, duplicates, orphan files, broken event structures, folder integrity and `event.json` issues, plus long-running archive operations. Also covers the **AutoIngest Archive Node**: the existing NAS server PC runs long-running archive work. **No Raspberry Pi requirement.** Detailed design: evidence pending. |
| Included AI-FEAT IDs | AI-FEAT-049 |
| Existing features extended | AI-FEAT-042, AI-FEAT-043 (expected — see AI-FEAT-049) |
| Dependencies | AI-RM-001 (complete). Sequenced after AI-RM-015 by owner priority; content identity is expected to inform the missing-copy and duplicate checks. |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 3–5 weeks (see [03_IMPLEMENTATION_TIMELINE.md](03_IMPLEMENTATION_TIMELINE.md)) — original estimate, predates the Archive Node scope addition |
| Current risks | Hosts the remaining scope of AI-RM-007 (Archive Repair) and AI-RM-008 (Archive Analytics) since 2026-10-27; the `services/archiveRepairService.js` naming collision (see AI-RM-007) must be resolved here |
| Next action | Not started — follows AI-RM-015 in the Priority Order |

---

## AI-RM-003 — Event Maintenance

| Field | Value |
|---|---|
| Status | Planned — not started. Priority Order #7. |
| Objective | Owner-stated scope (preserved from prior agreement, restated 2026-10-27): event renaming, editing, splitting, merging, relocation and metadata reconciliation. Detailed design: evidence pending. |
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
| Status | Planned — not started. Priority Order #8. |
| Objective | Owner-stated scope (2026-10-27): collection / event / photographer browsing, later extended with verification receipts, content identity, import history and archive-copy status from AI-RM-015. Detailed design: evidence pending. |
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
| Status | Planned — not started. Workstream: Archive Browser & Discovery (host AI-RM-004), placed 2026-10-27. |
| Objective | Evidence pending — not yet documented as fact |
| Included AI-FEAT IDs | AI-FEAT-053 |
| Existing features extended | Evidence pending |
| Dependencies | AI-RM-004 (search scope likely follows browser scope) |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 3–5 weeks |
| Current risks | Scope not yet defined |
| Next action | Not started — delivered within the Archive Browser & Discovery workstream after AI-RM-004 |

---

## AI-RM-006 — Integrity Verification

| Field | Value |
|---|---|
| Status | Planned — not started. **Remaining scope placed under AI-RM-015 (Backup Intelligence Foundation)** on 2026-10-27 per owner direction. This record, its ID and AI-FEAT-054 are retained for history. |
| Objective | Evidence pending — not yet documented as fact. Narrower prior art exists: AI-FEAT-025 (import-batch and sync-job checksum verification) — this milestone's scope is expected to be broader (archive-wide), not merely a rename of that existing capability. |
| Included AI-FEAT IDs | AI-FEAT-054 |
| Existing features extended | AI-FEAT-025 (prior art, narrower scope) |
| Dependencies | AI-RM-015 (host workstream). *Prior value (superseded 2026-10-27): followed the Global Search milestone in the original sequence.* |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 3–4 weeks |
| Current risks | Scope overlap with AI-FEAT-025 needs explicit disambiguation before implementation starts, to avoid duplicating the existing `getFileHash()`-based mechanism without a clear reason. **Added 2026-10-27:** also overlaps AI-RM-015 (Backup Intelligence Foundation — durable verification evidence/receipts); **resolved 2026-10-27: remaining scope placed under AI-RM-015** (record retained, not superseded). |
| Next action | Not started — scope is designed and delivered inside AI-RM-015. Its AI-FEAT-025 disambiguation risk carries over there. |

---

## AI-RM-007 — Archive Repair

| Field | Value |
|---|---|
| Status | Planned — not started. **Remaining scope placed under AI-RM-002 (Archive Maintenance & Archive Node)** on 2026-10-27 per owner direction. This record, its ID and AI-FEAT-052 are retained for history. |
| Objective | Close the documented gap in AI-FEAT-043: "the diagnostics layer reports issues but does not auto-fix them" (`docs/archive-operations-layer.md`). |
| Included AI-FEAT IDs | AI-FEAT-052 |
| Existing features extended | AI-FEAT-043 (Archive Health Reporting — this milestone is expected to act on what that feature detects) |
| Dependencies | AI-RM-002 (host workstream). *Prior value (superseded 2026-10-27): followed the Integrity Verification milestone in the original sequence.* |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 4–6 weeks |
| Current risks | **Naming collision**: `services/archiveRepairService.js` already exists but implements an unrelated narrow temp-file-cleanup utility (Phase 13B-2, `.autoingest-sync-tmp`/`.autoingest-tx-tmp` only) — see AI-FEAT-052's Decisions section. Whoever scopes this milestone should resolve the naming collision before adding code to that file. |
| Next action | Not started — scope is designed and delivered inside AI-RM-002. The `archiveRepairService.js` naming collision must still be resolved there. |

---

## AI-RM-008 — Archive Analytics

| Field | Value |
|---|---|
| Status | Planned — not started. Workstream: Archive Maintenance & Archive Node (host AI-RM-002), placed 2026-10-27. |
| Objective | Evidence pending — not yet documented as fact |
| Included AI-FEAT IDs | AI-FEAT-055 |
| Existing features extended | AI-FEAT-043 (expected data source) |
| Dependencies | AI-RM-002 (host workstream; AI-FEAT-043 health data). *Prior value (superseded 2026-10-27): followed the Archive Repair milestone in the original sequence.* |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 2–4 weeks |
| Current risks | Scope not yet defined |
| Next action | Not started — follows AI-RM-002 within its workstream |

---

## AI-RM-009 — AI Archive Intelligence

| Field | Value |
|---|---|
| Status | Planned — not started. Workstream: Archive Browser & Discovery (host AI-RM-004), long-horizon last item, placed 2026-10-27. |
| Objective | Evidence pending — not yet documented as fact |
| Included AI-FEAT IDs | AI-FEAT-056 |
| Existing features extended | AI-FEAT-055 (expected foundation) |
| Dependencies | AI-RM-008 |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | 6–10 weeks |
| Current risks | Least-scoped item in the entire roadmap — nothing about its eventual shape should be assumed from its name alone |
| Next action | Not started — follows AI-RM-008 (dependency unchanged). Still the least-scoped item; whether it should relate to Ask AutoIngest's model runtime is an open design question, not an assumption. |

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
| Status | **Completed** — Stable promoted in v0.9.13 (tag `v0.9.13` @ `a1223ad`, 2026-09-28; `git merge-base --is-ancestor feature/multi-event-import v0.9.13` confirmed 2026-10-27). Production validated: evidence pending. *Prior status (superseded 2026-10-27): "In progress (implemented and verified on `feature/multi-event-import`; not yet merged to `stable/0.9` or released)".* |
| Objective | Let an operator open one import source (card, drive, USB, local folder — source-agnostic), assign its files to several events, and import them in ONE pass, with every file routed and tagged by its own event, without weakening any copy-safety, naming, metadata or transaction rule. |
| Included AI-FEAT IDs | AI-FEAT-058 |
| Existing features extended | AI-FEAT-017 (Grouping System — per-event instances), AI-FEAT-019 (Import Pipeline & Copy Engine), AI-FEAT-021 (Atomic Import Transaction — orchestrated per event), AI-FEAT-009 / AI-FEAT-010 (event picker/creator reused), AI-FEAT-024 (Source Cleanup — eligibility unchanged), AI-FEAT-025 (Deep Verify accumulation), AI-FEAT-044 (Local First sync manifests per event) |
| Dependencies | None — a parallel ingestion-workflow track (deliberately not written as a range of milestone IDs, per the note on AI-RM-010). |
| Deliverables | `renderer/importSession.js`, `renderer/importSessionRunner.js`, `renderer/importSessionUI.js`, `renderer/metadataBatchTracker.js`; `createGroupManager()` factory + facade; EventCreator snapshot/capture/guard APIs; two additive `main/main.js` changes; `docs/multi-event-import.md`; 7 test files (unit + live). |
| Acceptance criteria | Live verification with synthetic fixtures: camera-card-style and plain-folder sources; A→B→C→A switching without rescanning; one combined review and one import; exact per-event routing and per-event metadata isolation (real ExifTool); event-local failure continues and retries; source removal resets the session; exact cleanup list; new-event creation from inside the workspace; multi-event Local First; the original single-event path unchanged; no Tag Refinement code reintroduced. |
| Planned estimate | Single implementation session (2026-09-20) |
| Current risks | Merge and release verification not yet performed. Two import code paths coexist (transitional). Known limitations in `docs/multi-event-import.md` §11. Per-Photo Tag Refinement is held out of Stable and is not part of this milestone. |
| Next action | None — Stable promoted. *Prior next action (superseded 2026-10-27): "Owner review of the final report; commit breakdown approval; merge decision."* |

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
| Status | **Completed** — released in AutoIngest v0.9.14 Stable (commit `093c721`, tag `v0.9.14`, 2026-10-16) |
| Objective | Let an operator drive AutoIngest's core Browse/Groups/Map Group/Refine Tags workflows directly from the physical Logitech MX Creative Console Keypad and dial, without the software UI, as a hardware control surface that stays in sync with AutoIngest's own authoritative state. |
| Included AI-FEAT IDs | AI-FEAT-060 |
| Existing features extended | None recorded as independently touched — the plugin is a separate C# process (`integrations/logitech/autoingest-mx-csharp/`) that talks to AutoIngest over its existing local WebSocket command layer ([docs/commandLayer.md](../commandLayer.md)); it does not modify any existing AutoIngest renderer/main feature's own code. |
| Dependencies | None — a parallel hardware-integration track, not a continuation of the AI-RM-001…009 archive-capability sequence (deliberately not written as a range of milestone IDs, per the note on AI-RM-010). |
| Deliverables | `integrations/logitech/autoingest-mx-csharp/` — the C# Logitech plugin itself, including `src/Helpers/ContextualKeypadController.cs`/`ContextualKeypadModel.cs`/`ContextSlotBinding.cs`, nine `src/Actions/ContextSlotA1.cs`–`ContextSlotA9.cs` native multistate actions, and the retained (not deleted) `RefineTagsFolder.cs`/`GroupsFolder.cs`/`GroupMappingFolder.cs`; `docs/mxLogitechCSharp.md`/`mxLogitechPlugin.md`; `integrations/logitech/autoingest-mx-csharp/test/AutoIngestMxCsDevPlugin.Tests/` (116 tests as of this session). |
| Acceptance criteria | Physically verified end-to-end on the real MX Creative Keypad: Browse layout (G1/G2/G3, GROUPS/MAP GROUP/REFINE TAGS mode entry, CHANGE EVENT/IMPORT); Groups mode (real groups listed, dial paging, assignment via press, Back); Map Group mode (real components, current-mapping/taken-by-other coloring, remapping, dial paging, ambiguous-selection safety); Refine Tags mode (real tag labels, default/checked/indeterminate color states, Apply/All Tags/Reset Tags, CLOSE replacing BACK per an explicit operator decision); label truncation; 116/116 `dotnet test` passing. User-confirmed final verification: "i have done all the tests alls working fine." |
| Planned estimate | Evidence pending for phases predating this session (Phase 1A/3A-D/4A/4B — see AI-FEAT-060's Original Plan / Intent). This session's own Unified Contextual Keypad migration (native multistate spike → contextual keypad spike → production migration → three physical bug fixes) ran in a single extended session (2026-10-15). |
| Current risks | `RefineTagsFolder`/`GroupsFolder`/`GroupMappingFolder` (the retired `PluginDynamicFolder`-based implementation) are kept as source/reference, not deleted — a future session should decide whether to remove them now that the native replacement is physically proven and released. macOS Stable distribution remains ad-hoc signed, not notarized (Apple Developer signing credentials not available) — same disclosed limitation as v0.9.13, not specific to this milestone. |
| Next action | None for this milestone — complete and released. Optional follow-up: remove the retired `PluginDynamicFolder` source now that it is superseded and shipped. |

---

## AI-RM-014 — Quick Ingest & Desktop Experience

| Field | Value |
|---|---|
| Status | **Active — PRIORITY 1.** Q0 done (2026-10-27). Q1 foundation implemented and verified on `feature/menu-bar-companion-q1` @ `dd9493f` (Status Ladder rung 1; macOS only; local, unmerged, unreleased), awaiting owner review. Phases re-planned 2026-10-28 as Q0–Q9 (DEC-028); six design decisions approved 2026-10-28 (DEC-029). Q2 not started. *(Prior value, superseded 2026-10-28: **Active — PRIORITY 1.** Q0 done (2026-10-27). Q1 foundation implemented and verified on `feature/menu-bar-companion-q1` @ `dd9493f` (Status Ladder rung 1; macOS only; local, unmerged, unreleased), awaiting owner review. Phases re-planned 2026-10-28 as Q0–Q9 (DEC-028). Q2 not started. *(Prior value, superseded 2026-10-28: **Active — PRIORITY 1.** Q0 complete (2026-10-27). **Q1 foundation implemented and verified on `feature/menu-bar-companion-q1` @ `dd9493f`** (2026-10-28), not merged and not released, awaiting owner review. Q2 not started. *(Prior value, superseded 2026-10-28: **Active — next milestone (Priority Order #3, PRIORITY 1).** Q0 (audit, architecture, UX specification, test matrix) recorded 2026-10-27. Q1 implementation not started; it awaits owner approval.)*)*)* |
| Objective | Give operators an always-available macOS menu-bar / Windows system-tray companion that assesses an inserted card by capture date, identifies the camera(s), suggests the photographer from confirmed history, and imports the selected date's files in one step when every mandatory input is already satisfied — otherwise hands off to the **existing** workspace. Photographer↔camera learning is a **shared** capability (AI-FEAT-063) also used by the standard Confirm Event Import modal and a new Photographer Registry. Main-window UI stays frozen except the two DEC-028 exceptions. *(Prior value, superseded 2026-10-28: Give operators an always-available macOS menu-bar / Windows system-tray companion that shows connected-card status, honest prior-import evidence and archive reachability, and opens the **existing** import workflow quickly. The existing main-window UI is not changed ([DEC-027](decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md)).)* |
| Included AI-FEAT IDs | AI-FEAT-061, AI-FEAT-063 *(Prior value, superseded 2026-10-28: AI-FEAT-061)* |
| Existing features extended | AI-FEAT-001 (app lifecycle / windows), AI-FEAT-005 (preferences), AI-FEAT-042 (read-only archive status), AI-FEAT-034 (Metadata Management modal — new Photographer Registry tab, DEC-028 exception 1), the photographer field of the Confirm Event Import modal (DEC-028 exception 2) — reused through new modules; AI-FEAT-019 / AI-FEAT-020 / AI-FEAT-022 / AI-FEAT-025 / AI-FEAT-029 / AI-FEAT-036 / AI-FEAT-058 are reused unchanged *(Prior value, superseded 2026-10-28: AI-FEAT-001 (app lifecycle / windows), AI-FEAT-005 (companion preferences), AI-FEAT-042 (read-only archive status) — reused through new modules; AI-FEAT-019 / AI-FEAT-020 / AI-FEAT-025 / AI-FEAT-058 are reused unchanged)* |
| Dependencies | None blocking. Does not depend on AI-RM-015: Q2–Q8 use existing metadata, import and verification services. AI-FEAT-063's schema (opaque permanent IDs, per-installation provenance, append-only history, schema versions) is kept compatible with AI-RM-015's future archive-wide identity, import history and multi-computer reconciliation. Only Q9's content-hash / verification-receipt hooks wait on AI-FEAT-062, behind capability flags. *(Prior value, superseded 2026-10-28: None blocking. It deliberately does not depend on AI-RM-015: the companion works without Backup Intelligence and gains confidence from it later through capability flags.)* |
| Deliverables | Unchanged Q0–Q9 sub-phases (each in its own worktree/branch, each owner-approved), with DEC-029 requirements: **Q2** calendar-date classification first, plus the **optional cross-midnight date-and-time range — an explicit planned requirement that must not be dropped** (AI-FEAT-061 test row 28); camera timestamps never change an event's Hijri date or naming · **Q3** evidence-based camera identification; per-manufacturer tag mappings measured on real files before Q3 approval · **Q4–Q7** registry links to the existing photographer list by stable ID (single list), rename keeps alias with pre-save collision check · **Q8** conditional: dependency audit, then a separate design review; multi-photographer cards hand off to the existing workspace · **Q0**, **Q1**, **Q9** as before. *(Prior value, superseded 2026-10-28: Sub-phases (each in its own worktree/branch, each owner-approved; full detail in AI-FEAT-061 § Expanded phase plan and AI-FEAT-063): **Q0** audit & spec (done) · **Q1** menu-bar/tray foundation (implemented, review pending) · **Q2** smart date-based card assessment · **Q3** automatic camera identification · **Q4** photographer & camera learning system (shared) · **Q5** Photographer Registry tab · **Q6** automatic photographer creation during import (Confirm Event Import modal + companion) · **Q7** registry import/export & intelligent merge · **Q8** streamlined one-step Quick Ingest · **Q9** notifications, verification integration, cross-platform validation, Preview RC → Stable. *(Prior value, superseded 2026-10-28: Sub-phases (each in its own worktree/branch, each owner-approved): **Q0** repository audit, architecture & UX spec · **Q1** menu-bar/tray foundation & lifecycle · **Q2** connected-card detection & compact card-status popover · **Q3** archive destination & import-index status · **Q4** launch Quick Ingest & full-workspace handoff · **Q5** native notifications & card activity indicators · **Q6** card-aware history entry points & verification hooks (capability-flagged) · **Q7** physical-device E2E, packaging (macOS x64/arm64, Windows x64) & Preview RC. Full plan: AI-FEAT-061.)*)* |
| Acceptance criteria | AI-FEAT-061 test matrix (rows 1–27) and AI-FEAT-063 test matrix green, including the main-window regression guarantee: the only main-window differences are the two DEC-028 exceptions. "Checksum verified" and per-card history never shown before genuinely available. A suggested photographer is never applied without operator confirmation. Registry import never deletes or silently overwrites local data. Preview RC first; Stable only after packaged physical validation and explicit approval. *(Prior value, superseded 2026-10-28: AI-FEAT-061 test matrix (17 rows) green, including the main-window visual and functional regression guarantee (no unexpected change to main-window UI, CSS, layout, event workflow or operator interactions). "Checksum verified" and per-card history are never shown before they are genuinely available. Preview RC first; Stable only after packaged physical validation and explicit approval.)* |
| Planned estimate | Evidence pending — not yet documented as fact (no owner estimate given) |
| Current risks | As before, with DEC-029 status: **R11** (one photographer vocabulary) resolved by decision — option (b), single list; **R12** (Q8 pipeline dependency) still open — audit required before any Q8 design review; **R8** video / per-manufacturer date and serial tags still open — measured on real files before Q3 approval; R4, R6, R9, R10, R13 unchanged. *(Prior value, superseded 2026-10-28: Q1 risks R1–R3 addressed on the feature branch (pending review); R4 (no volume UUID — labels are not identities) and R6 (ad-hoc macOS signing) remain. New (2026-10-28): **R8** capture-date reliability — wrong camera clocks, missing time zones, video container dates, RAW/JPEG disagreement; **R9** reading metadata for thousands of files on insert must stay bounded and cancellable; **R10** camera identity is not photographer identity — over-confident suggestions would misattribute Creator metadata and folders; **R11** one photographer vocabulary — the registry must not become a second list (AI-FEAT-063 open question 1); **R12** Q8 one-step import may need the import pipeline to run without the renderer's grouping state — not yet audited; **R13** registry merge across computers must never delete or silently overwrite. *(Prior value, superseded 2026-10-28: (R1) a companion `BrowserWindow` would be picked up by ≥7 `getAllWindows().find(...)` progress-routing sites and by the `activate` / `window-all-closed` window counts — a behavior-preserving fix must land first in Q1. (R2) drive polling currently starts with the main window; moving it to app lifetime must keep the single poller and the same broadcast contract. (R3) single-instance lock is a behavior change that needs approval. (R4) no volume UUID in `drivelist` output — labels are not identities. (R6) macOS builds are ad-hoc signed, not notarized; notification and login-item behavior must be physically verified.)*)* |
| Next action | Owner review of the Q1 report. Before Q2: Windows hardware tray run and the companion-default decision. Before Q3 approval: per-manufacturer camera-tag measurement on real files. Before Q8 design: import-pipeline dependency audit and a separate design review. No Q2 implementation, Preview RC or Stable merge without explicit approval. *(Prior value, superseded 2026-10-28: Owner review of the Q1 report and of this expanded plan (AI-FEAT-061 § Expanded phase plan, AI-FEAT-063, DEC-028). Before Q2: Windows hardware tray run and the companion-default decision. No Q2 implementation, Preview RC or Stable merge without explicit approval. *(Prior value, superseded 2026-10-28: Owner review of the Q1 report on `feature/menu-bar-companion-q1`. Before Q2: a Windows hardware tray run, and the owner decision on the companion default (on in Q1). No Preview RC, Stable merge or Q2 without approval. *(Prior value, superseded 2026-10-28: Owner review/approval of the AI-FEAT-061 plan (including R1 refactor, R3 single-instance, and the Q4 handoff listener as the only main-window code touch); then cut `feature/quick-ingest-companion-q1` worktree from the verified `origin/stable/0.9` HEAD.)*)*)* |

---

*AI-RM-014 status note (2026-11-12, appended):* the unfinished Q5e work — META, S3, COMP, S2–S8 and live photographer renaming — is **paused** behind AI-RM-016 by owner direction. It is neither cancelled nor complete; Q1–Q5 functionality, the S1 mapping-write gate and the Q5 rename gate stay exactly as they are.

---

## AI-RM-016 — Event Quick Import & Dump Sorting

| Field | Value |
|---|---|
| Status | **Active — PRIORITY 1 (from 2026-11-12).** EQI-0 done. EQI-1 RC Preview `v0.9.18-rc.1` (live-event used); EQI-1.1 RC Preview `v0.9.18-rc.2`; EQI-1.2 RC Preview `v0.9.18-rc.3`; CAM-001 startup recognition RC Preview `v0.9.18-rc.4` (macOS verified; Windows unverified). EQI-2 to EQI-5 not started. *(2026-11-12: EQI-1 implemented and verified, local, unmerged, unreleased.)* |
| Objective | Menu-bar Event Dump Quick Import into the selected event (`Event/Dump/<Photographer>/`, never PC-sequenced), optional division between events, sorting the Dump through the existing Import Workspace, and safe source-card cleanup — reusing existing services, UI and transactions. |
| Included AI-FEAT IDs | AI-FEAT-064 |
| Existing features extended | AI-FEAT-061 (companion), AI-FEAT-047 (multi-event import engine), Event Creator / Event Management, Sort QMZ (entry point only — behaviour unchanged), Delete from Source (EQI-4) |
| Dependencies | None blocking. Not dependent on AI-RM-014 Q5e META/S2–S8 or photographer renaming. |
| Deliverables | EQI-0 discovery/architecture/roadmap; EQI-1 menu-bar Event Dump Quick Import; EQI-2 multi-event manual time assignment; EQI-3 Sort Dump; EQI-4 safe source cleanup + repeated-session deletion fix; EQI-5 integrated regression, Windows verification, release readiness. Each stage separately validated and committed. |
| Acceptance criteria | The AI-FEAT-064 rules (§2) hold; per stage: unit, isolated live and packaged macOS tests green with the bundled ExifTool; an experimental macOS Preview RC only after EQI-1's safety gate, never a Stable release; no source deletion or photographer renaming silently enabled. |
| Planned estimate | Evidence pending — not yet documented as fact |
| Current risks | Live-event use before EQI-3 (Dump stays unsorted until then — by design); the AI-RM-014 Keychain/main-thread risk (a Keychain prompt can stall the app) is unchanged by EQI-1; Windows unverified. |
| Next action | Owner feedback on RC `v0.9.18-rc.4` (CAM-001); then EQI-2 when authorized. *(Earlier 2026-11-13: owner feedback on RC `v0.9.18-rc.3` (EQI-1.2).)* *(Earlier 2026-11-13: owner live-event feedback on RC `v0.9.18-rc.2`.)* *(2026-11-12: owner review at the EQI-1 release gate.)* |

---

## AI-RM-015 — Backup Intelligence Foundation

| Field | Value |
|---|---|
| Status | Planned — not started. Priority Order #5. |
| Objective | Owner-stated scope (2026-10-27): unified SHA-256 content identity; source-content and final-archive identity; card/source session identity; archive-instance tracking across NAS roots; durable verification evidence; verification receipts; per-card import history; safe cross-device reconciliation. Detailed design: evidence pending. |
| Included AI-FEAT IDs | AI-FEAT-062 |
| Existing features extended | AI-FEAT-020 (name+size import index — expected to be superseded or backed by content identity), AI-FEAT-025 (checksum verification — expected to become durable) |
| Dependencies | AI-RM-014 sequenced first by owner priority (not a technical dependency). AI-FEAT-063 (Photographer & Camera Identity Registry, delivered in AI-RM-014) does not depend on this milestone; this milestone should link future source-session and verification-receipt records to AI-FEAT-063 `deviceId`s and reuse its per-installation provenance concept rather than invent a parallel one. *(Prior value, superseded 2026-10-28: AI-RM-014 sequenced first by owner priority (not a technical dependency))* |
| Deliverables | Evidence pending |
| Acceptance criteria | Evidence pending |
| Planned estimate | Evidence pending — not yet documented as fact |
| Current risks | Hosts the remaining scope of AI-RM-006 (Integrity Verification — Archive-Wide) since 2026-10-27, including its AI-FEAT-025 disambiguation risk. Migration from the existing capped, per-computer name+size import index has to be designed so that history is not lost and confidence is not overstated. |
| Next action | Not started — follows AI-RM-014 (Ask AutoIngest continues in parallel on its own branch) |
