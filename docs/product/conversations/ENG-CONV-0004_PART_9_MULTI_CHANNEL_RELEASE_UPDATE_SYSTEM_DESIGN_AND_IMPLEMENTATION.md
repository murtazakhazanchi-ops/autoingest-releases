# ENG-CONV-0004 — Part 9 — Multi-Channel Release & Update System: design and implementation

## Identity

| Field | Value |
|---|---|
| Conversation ID | ENG-CONV-0004 |
| Title | Part 9 — Multi-Channel Release & Update System: design and implementation |
| Status | Imported |
| Conversation type | mixed |
| Source tool | claude-code |
| Source format | ecp |
| Date started | 2026-08-12T00:00:00Z |
| Date completed | 2026-08-12T00:00:00Z |
| Participants/roles | Evidence pending — not present in imported packet |
| Import date | 2026-08-12T13:02:11.222Z |
| Import session | imp-1786539731130-b78d8e |
| Provenance classification | Imported packet — no secret pattern detected |
| Redaction status | Applied — automatic secret-pattern scan (no matches) |
| Integrity checksum | 89fa2c3dd11ee3ec8e0986a553704b3759041f449fc9479ffc99f41d7b982553 |

## Repository Context

| Field | Value |
|---|---|
| Repository | AutoIngest |
| Branch | main |
| Base commit | 942bce1273aea97ea52d2879ff843e9cf0425c5c |
| Head/final commit | Evidence pending — not present in imported packet |
| Implementation state at time of discussion | Evidence pending — not present in imported packet |

## Relationships

| Field | Value |
|---|---|
| Primary feature IDs | AI-FEAT-057, AI-FEAT-006, AI-FEAT-005 |
| Secondary feature IDs | AI-FEAT-008 |
| Roadmap milestone IDs | AI-RM-010 |
| Related bugs | None |
| Related decisions | DEC-017, DEC-018 |
| Related postmortems | None |
| Related memory capsules | None |
| Related releases | None |
| Related conversations | None |
| Related technical docs | None |
| Related source files | None |
| Related tests | None |

## Original Request

- **Why this discussion happened**: Design and implement a formal multi-channel release architecture (Development / RC-Preview / Stable) for AutoIngest, replacing the single-path release process that produced the v0.9.11 empty-release incident (PM-002), so a tester-facing build can exist without ever risking exposure to Stable users, and so a verified RC has an auditable, gated promotion path to Stable.
- **User goal**: Design and implement a formal multi-channel release architecture (Development / RC-Preview / Stable) for AutoIngest, replacing the single-path release process that produced the v0.9.11 empty-release incident (PM-002), so a tester-facing build can exist without ever risking exposure to Stable users, and so a verified RC has an auditable, gated promotion path to Stable.
- **Explicit requirements**: 
  - Three clearly isolated channels, each with explicit rules for source commit, build trigger, artifact naming, git tag, GitHub Release behavior, updater visibility, retention, signing, documentation, QA, promotion, and rollback.
  - Stable users must never accidentally receive RC or Development builds.
  - Do not begin by editing workflows — audit and design the release/update model first, implement only after the architecture is justified.
  - Verify actual SemVer and electron-updater/electron-builder behavior directly rather than assuming; package.json version, release tag, updater metadata, and artifact version must never diverge.
  - Investigate whether the exact built RC artifact can safely be promoted to Stable, or whether electron-builder requires a rebuild — document why, either way.
  - Before RC publication and before Stable publication, run hard, blocking release gates (no warning-only path for a release-critical mismatch).
  - Do not delete/recreate releases automatically without explicit authorization; provide a safe, documented rollback procedure informed by PM-002.
  - Run security-reviewer, code-reviewer, performance-auditor, and documentation-update-specialist (and autoingest-architect) against the actual implementation diff and address all CRITICAL/HIGH findings.
  - No application runtime file outside Part 9 scope should change; do not break existing Stable v* release behavior until the replacement path is proven.
  - Do not publish a new Stable AutoIngest version as part of this work; the live pilot (an actual workflow_dispatch RC run) requires separate, explicit authorization — stop before production activation.
  - Do not begin Part 9 before v0.9.11 is released and verified, and do not begin it automatically — wait for explicit approval to start.
- **Constraints**: 
  - Must not invent a versioning/channel scheme electron-updater or electron-builder cannot actually support — verify against the installed package versions' real source, not memory or external docs.
  - Prefer explicit channel configuration over relying on naming convention alone.
  - Use the existing Settings architecture for the channel toggle rather than a large redesign; Development does not need to be user-facing.
  - Reuse the existing Part 7 release-intelligence infrastructure for the release gate rather than creating a disconnected script.
  - This repository has no code signing configured for either platform today — any promotion design must account for that as the actual current state, not a hypothetical.

## Initial Understanding

- **Inferred requirements**: Evidence pending — not present in imported packet — not distinguished from explicit requirements by this importer's adapters; see Original Request
- **Evidence-pending items**: None recorded
- **Uncertainties / questions raised at the start**: Whether release gate should eventually also be wired into a pre-tag local git hook, not only CI — not pursued in this session, consistent with Part 5's existing hook-installation being a separate, explicit, human-approved step.

## Initial Proposal

- **First proposed direction**: Formal audit of the current release system, then a design phase (channel contracts, versioning model, update-channel mechanics verified from installed library source) presented for explicit approval via plan mode before any implementation.
- **Expected behavior**: Three isolated channels with electron-updater's own GitHub-provider mechanics (not custom code) providing the actual Stable/RC isolation guarantee; RC promotion investigated and decided (rebuild-from-source, not exact-binary promotion) with a hard gate enforcing it.
- **Expected architecture**: Evidence pending — not present in imported packet
- **Acceptance criteria**: A logic-level pilot (regression tests covering all 9 required isolation/gate scenarios) as part of this pass; the live CI pilot deferred to a separate authorized step.

## Discussion Evolution

- **Revision 1**
  - Trigger: Scope and blast-radius assessment after the initial audit/design research
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Consider implementing all 20 phases directly in one pass without an explicit approval checkpoint.
  - Revised approach: Enter plan mode after the audit and channel-mechanics research, present a concrete architecture (contracts, versioning, CI job structure, promotion decision) for explicit user approval before writing any code.
  - Rationale: Release/CI infrastructure and auto-update behavior are high-blast-radius, hard-to-reverse changes affecting real production users; the task's own instruction was 'do not begin by editing workflows, design first.'
  - Disposition: accepted
- **Revision 2**
  - Trigger: Investigating exact-binary RC-to-Stable promotion (explicitly required by the task)
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Considered re-uploading the verified RC's already-built artifacts under the Stable tag/release, to guarantee the Stable binary is byte-identical to what QA tested.
  - Revised approach: Rejected in favor of rebuilding from the RC's exact source commit with only the version string changed, enforced by a release-gate source-drift check.
  - Rationale: electron-builder embeds the app's own version string into the shipped artifact (asar-bundled package.json, Windows version resource, macOS Info.plist) at build time only — re-uploading RC bytes under a Stable tag would leave the running app permanently reporting itself as the RC version, breaking allowPrerelease's own version-based default. Verified directly from electron-builder/electron-updater source, not assumed. Recorded as DEC-017.
  - Disposition: accepted
- **Revision 3**
  - Trigger: architecture review (autoingest-architect subagent) of the completed implementation
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: release gate existed and was correctly invoked on the RC CI path, but the Stable CI path (create-release/build-mac/build-windows, triggered by a plain push: tags: v* event) never invoked it at all.
  - Revised approach: Added a stable-release-gate CI job that runs release gate --channel stable --auto-rc-commit before create-release (create-release gained exactly one line, needs: stable-release-gate); added git-tag-history-based auto-discovery of the prior RC commit (--auto-rc-commit) since the tag-push trigger has no workflow_dispatch input to carry an explicit --rc-commit; added a git-native override mechanism (an Override-Drift-Check: line in the pushed tag's own annotated message) for the legitimate no-preceding-RC case.
  - Rationale: Without this, PM-002's exact failure mode (a version/tag mismatch reaching a real Stable release) was still possible whenever a human forgot to run the gate manually — the architect flagged this as the single biggest remaining risk in the feature, correctly.
  - Disposition: accepted
- **Revision 4**
  - Trigger: code review (code-reviewer subagent) of the completed implementation
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: applyChannelSetting() set autoUpdater.channel unconditionally in both the Preview and Stable branches, without addressing the channel setter's own side effect of setting allowDowngrade=true on every assignment.
  - Revised approach: Explicitly reset autoUpdater.allowDowngrade=false in the Stable/else branch immediately after setting channel, restoring electron-updater's pre-existing default for the entire non-Preview install base; kept the setter's true side effect only in the Preview branch, where it is genuinely needed.
  - Rationale: electron-updater's own AppUpdater.js setter comment literally instructs 'If this behavior is not suitable for you, simply set allowDowngrade explicitly after' — missed on first implementation. Verified directly against the setter source and isUpdateAvailable()'s use of the flag. Without this fix, every Stable install (not just Preview opt-ins) would have silently gained a permanent auto-downgrade code path that did not exist before this feature.
  - Disposition: accepted
- **Revision 5**
  - Trigger: code review — checkChannelReleaseGate's stable branch called build.assemble() purely to read parsed.bugs
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: Used the full build.assemble() pipeline (which also runs the roadmap-dashboard consistency check and can throw an unrelated DashboardDisagreementError) inside the release gate.
  - Revised approach: Switched to parseProductDocs.loadAll() directly, which returns the same parsed.bugs data without the unrelated full-build cost or failure mode.
  - Rationale: This file's own prior comment already documented this exact anti-pattern as fixed once before ('doubling release-draft cost for no reason, found in Part 7 performance review') — the new stable-gate code had reintroduced an equivalent issue for a much smaller need.
  - Disposition: accepted
- **Revision 6**
  - Trigger: documentation review (documentation-update-specialist subagent) — fabricated citation and a generated-index bug
  - Feedback: Evidence pending — not present in imported packet
  - Previous approach: AI-FEAT-057's Original Plan / Intent section cited an ENG-CONV-0004 record that had never actually been imported — a real violation of this project's strongest non-negotiable rule against fabricating a record ID. Separately, AI-RM-010's Dependencies field wrote out 'None on AI-RM-001…009 — a parallel infrastructure track...', which the documentation system's own ID-extraction regex greedily matched as a real dependency on AI-RM-001, contradicting the roadmap's own stated intent.
  - Revised approach: This ENG-CONV record (imported via the real conversation import pipeline, replacing the fabricated citation) and a rewording of AI-RM-010's Dependencies field to avoid embedding any milestone-ID-shaped text in that specific field.
  - Rationale: Evidence discipline is this documentation system's own strongest rule; a citation to a record that doesn't exist is exactly the failure mode it exists to prevent. The dependency-extraction bug is a real, narrow tooling gap (the regex has no way to distinguish a real ID reference from one mentioned inside explanatory prose) — fixed at the content level rather than the generator, consistent with 'the individual record wins, regenerate the index' authority ordering.
  - Disposition: accepted

## Alternatives

- **Proposal**: Exact-binary promotion: re-upload the verified RC's already-built artifacts under the Stable tag/release.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: The app's own version string is embedded in the artifact at build time only (asar package.json, Windows version resource, macOS Info.plist) — the running app would permanently misreport its own version, breaking allowPrerelease's version-based default and misleading support/telemetry. See DEC-017.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: Rely on naming convention alone (e.g. file/tag naming) for channel isolation, without explicit electron-updater channel/allowPrerelease configuration.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: The task explicitly required preferring explicit channel configuration; naming convention alone would not provide the structural (API-level) isolation guarantee electron-updater's GitHub provider already offers for free.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

- **Proposal**: Let electron-builder auto-create the RC's GitHub release/tag itself (its own getOrCreateRelease() fallback) rather than having the CI workflow create and push the tag explicitly.
- **Advantages**: Evidence pending — not present in imported packet
- **Disadvantages**: Evidence pending — not present in imported packet
- **Risks**: Evidence pending — not present in imported packet
- **Accepted or rejected**: Rejected
- **Reason**: Verified from electron-publish's createRelease() source that it omits target_commitish entirely — a newly-created release would attach to the repository's default branch, not necessarily the exact commit the RC workflow ran against.
- **Evidence source**: Imported Engineering Conversation Packet (`rejected_approaches`)

## User Feedback

None recorded.

## Engineering Decisions

- **Accepted**: 
  - Isolation between Stable and RC/Preview channels relies on electron-updater's own GitHub-provider mechanics (allowPrerelease + channel), not custom application logic — verified as structurally sufficient directly from the installed library's source.
  - RC promotion to Stable rebuilds from the verified RC's exact source commit, changing only the version string, rather than promoting the RC's already-built binaries — see DEC-017.
  - The release gate's checks (version/tag/lockfile alignment, channel-shape validation, source drift, blocking bugs) are all hard-blocking with no warning-only outcome for a release-critical mismatch.
  - The Stable CI path must invoke the release gate automatically (stable-release-gate job with needs: on create-release) rather than relying on a human to run it manually — added after architecture review identified this as the single biggest remaining risk.
  - The live CI pilot (an actual workflow_dispatch RC run) is explicitly deferred to a separate, later-authorized activation step, not performed as part of this implementation pass.
- **Rejected**: 
  - Exact-binary promotion: re-upload the verified RC's already-built artifacts under the Stable tag/release.
  - Rely on naming convention alone (e.g. file/tag naming) for channel isolation, without explicit electron-updater channel/allowPrerelease configuration.
  - Let electron-builder auto-create the RC's GitHub release/tag itself (its own getOrCreateRelease() fallback) rather than having the CI workflow create and push the tag explicitly.
- **Deferred**: 
  - The live CI pilot (an actual workflow_dispatch rc-build run, confirming a real Preview-opted-in install discovers it while a Stable install does not) — requires separate, explicit authorization to trigger real CI/CD; not performed in this session.
  - Wiring a repo-level secret/variable alternative to the tag-message Override-Drift-Check convention was considered but not pursued — the git-native tag-message approach was judged sufficient and simpler.
- **Undecided**: Whether release gate should eventually also be wired into a pre-tag local git hook, not only CI — not pursued in this session, consistent with Part 5's existing hook-installation being a separate, explicit, human-approved step.
- **Decision-intelligence linkage**: draft (DEC-018) — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10 for how this is decided.

## Bug / Investigation Evidence

Not applicable — no bug discussed.

## Visual Evidence

None recorded — this importer does not yet accept binary image attachments; see docs/product/conversations/README.md.

## Open Questions

- **Unresolved**: Whether release gate should eventually also be wired into a pre-tag local git hook, not only CI — not pursued in this session, consistent with Part 5's existing hook-installation being a separate, explicit, human-approved step.
- **Deferred**: 
  - The live CI pilot (an actual workflow_dispatch rc-build run, confirming a real Preview-opted-in install discovers it while a Stable install does not) — requires separate, explicit authorization to trigger real CI/CD; not performed in this session.
  - Wiring a repo-level secret/variable alternative to the tag-message Override-Drift-Check convention was considered but not pursued — the git-native tag-message approach was judged sufficient and simpler.
- **Evidence pending**: None recorded

## Implementation Handoff

- **Work requested**: Add Development/RC/Stable channel jobs to .github/workflows/release.yml, leaving the existing Stable build jobs' behavior unchanged.
- **Expected feature IDs**: AI-FEAT-057
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: Evidence pending — not present in imported packet
- **Explicit non-goals**: Evidence pending — not present in imported packet

- **Work requested**: Add a Stable/Preview update-channel setting to Settings, backed by the existing settings.js get/set convention, applied by autoUpdater.js before the first update check.
- **Expected feature IDs**: AI-FEAT-057, AI-FEAT-005, AI-FEAT-006
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: Evidence pending — not present in imported packet
- **Explicit non-goals**: Evidence pending — not present in imported packet

- **Work requested**: Extend the Part 7 release-intelligence tooling with a channel-aware, hard-blocking release gate and QA-checklist/promotion-readiness additions, reusing existing infrastructure rather than creating a new disconnected script.
- **Expected feature IDs**: AI-FEAT-057
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: Evidence pending — not present in imported packet
- **Explicit non-goals**: Evidence pending — not present in imported packet

- **Work requested**: Add a full regression test matrix (updateChannel.test.js) covering all 9 required isolation/gate scenarios, and address every CRITICAL/HIGH finding from the code/security/performance/architecture/documentation review pass before considering the work complete.
- **Expected feature IDs**: AI-FEAT-057
- **Expected roadmap IDs**: Evidence pending — not present in imported packet
- **Implementation constraints**: Evidence pending — not present in imported packet
- **Expected tests**: scripts/product-docs/test/automation/updateChannel.test.js
- **Explicit non-goals**: Evidence pending — not present in imported packet

## Outcome

- **2026-08-12** — Imported. Canonicalized from a "ecp"-format packet claiming source_tool "claude-code".

## Provenance

- **Source file**: .autoingest-docs/conversations/inbox/eng-conv-part9-design.json
- **Packet checksum**: 89fa2c3dd11ee3ec8e0986a553704b3759041f449fc9479ffc99f41d7b982553
- **Importer**: ecp
- **Source tool (as claimed by the packet)**: claude-code — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 13 (a claim, not proof)
- **Source conversation metadata**: Evidence pending — not present in imported packet
- **Transformation method**: ecp adapter (scripts/product-docs/automation/conversation/adapters.js)
- **Fields unavailable from source**: None — packet was complete for this adapter
- **Evidence classifications**: Imported packet — no secret pattern detected
- **Evidence-pending items**: Identity, Repository Context, Initial Understanding, Initial Proposal, Discussion Evolution, Alternatives, Implementation Handoff
