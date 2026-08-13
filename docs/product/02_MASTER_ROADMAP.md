# Master Roadmap

Canonical, ordered implementation roadmap. Do not reorder unless the project owner explicitly reprioritizes — see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md).

**Roadmap IDs (`AI-RM-###`) are milestone identities, not feature identities.** A milestone may introduce one feature, expand several existing features, depend on multiple features, or consolidate multiple feature areas — see [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) for the actual product-capability inventory (`AI-FEAT-###`).

**Current position**: Completed milestone: **AI-RM-001**. Next milestone: **AI-RM-002**. Active implementation of AI-RM-002: **Not started** (confirmed — see AI-FEAT-049's evidence status). Following milestone: **AI-RM-003**. Overall milestone progress (AI-RM-001…009 archive-capability sequence): **1/9 complete**.

**AI-RM-010** (Multi-Channel Release & Update System) is a separate, parallel release-infrastructure track, not a continuation of the sequence above — see its own entry below. Status: **Completed** — verified on real Windows hardware (2026-08-13).

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
