# AI-FEAT-007 — Telemetry Pipeline

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-007 |
| Category | Application Platform |
| Status | Implemented |
| Maturity | Operational |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-005 (settings-gated via `TELEMETRY_ENABLED`), AI-FEAT-006 (auto-updater is a consumer) |
| Related roadmap milestone | None |
| Related technical docs | None dedicated |
| Evidence status | Verified from current code — full 10-point forensic investigation, 2026-08-14 (see Current Behavior) |
| First-known implementation | Evidence pending |
| Latest major update | 2026-08-14 — purpose captured, full behavior forensically verified, BUG-017/BUG-018 recorded |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | None recorded |
| Related bugs | [BUG-017](../bugs/BUG-017_TELEMETRY_HARDCODED_BUNDLED_SERVICE_ACCOUNT_CREDENTIAL.md), [BUG-018](../bugs/BUG-018_TELEMETRY_IMPORT_FAILURE_REPORT_INCLUDES_ARCHIVE_DESTINATION_PATH.md) |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

A settings-gated telemetry pipeline: `services/telemetry.js` exports `init`/`enqueue`/`flush`/`isEnabled`. Consumed by the auto-updater (AI-FEAT-006) and potentially other main-process services. **Why this exists** (product-owner intent, captured during the Product-Owner Purpose Capture interview, 2026-08-14 — *Known from project history; repository evidence pending*): a technical system-of-record for AutoIngest itself — recording/tracing errors, crashes, reliability problems, and performance problems so significant field issues can be investigated later rather than disappearing after an operator encounters them. The product owner treats telemetry as part of the managed institutional archival environment, with no current requirement for per-operator consent/opt-out, and is not opposed in principle to future diagnostic evidence (e.g., a screenshot) if genuinely required for troubleshooting — the product owner was explicit that this does **not** mean the current implementation transmits photographs or screenshots; see the fully forensically-verified Current Behavior below for what the implementation actually does today, independent of that stated intent.

## Current Behavior

Gated behind `TELEMETRY_ENABLED` (settings-controlled, see AI-FEAT-005). Provides `init()`, `enqueue()`, `flush()`, `isEnabled()`.

**Fully forensically verified, 2026-08-14** (10-point code investigation during the Product-Owner Purpose Capture pass — supersedes the earlier "full scope... evidence pending" note below for everything this section covers):

- **What's collected** — four categories through one `enqueue()` pipeline into a single Google Sheet: crash reports (main/renderer/GPU crashes, JS errors — `services/crashReporter.js`), performance reports (event-loop lag >200ms, thumbnail stalls >15s, slow imports, high heap usage — `services/performanceMonitor.js`), import-failure reports (auto-fired whenever an import completes with `errors > 0` — `main/main.js`, two call sites), and explicit user feedback (operator-initiated only, via an in-app modal). The first three are passive/automatic; only feedback requires operator action.
- **Identifiers** — the `reporter` field defaults to `'Auto-report'` for all passive reports; **no linkage to AI-FEAT-002's operator identity was found anywhere in the telemetry code path**. Device is inferred generically from `process.platform` (Mac/Windows) plus app version — no device ID, session ID, or event ID.
- **Archive-identifying information** — the import-failure report's `context.destination` field includes the real archive destination path (event/component/photographer folder structure). This is the one confirmed instance of archive-identifying data anywhere in the pipeline; no source file paths are included, only a file count. **Tracked as [BUG-018](../bugs/BUG-018_TELEMETRY_IMPORT_FAILURE_REPORT_INCLUDES_ARCHIVE_DESTINATION_PATH.md).**
- **Screenshots/media** — **none are captured or transmitted anywhere in the pipeline**, confirming the product owner's own stated caveat. The only "screenshot" reference in the codebase is manual onboarding text instructing a human tester to send one separately, outside the app.
- **Transport** — a real, active destination: Google Sheets via the `googleapis` package (`spreadsheets.values.append`). The Sheet ID is hardcoded; authentication uses a service-account JSON key **bundled inside the packaged app**, which the code's own comments already flag as an accepted risk requiring rotation before any public/open-source release. **Tracked as [BUG-017](../bugs/BUG-017_TELEMETRY_HARDCODED_BUNDLED_SERVICE_ACCOUNT_CREDENTIAL.md)** — both findings are implementation/security items requiring follow-up investigation and remediation; runtime remediation was explicitly out of scope for the documentation pass that discovered them.
- **Local storage / retry** — a local JSON queue file, capped at 500 entries, flushed every 30s with backoff (5 consecutive failures → 5-minute pause, not a silent drop).
- **Consent/opt-out** — **none exists anywhere in the app.** The only control is a hardcoded `TELEMETRY_ENABLED` constant in source — an engineering kill switch, not an operator-facing setting. This matches the product owner's stated position that no per-operator consent requirement currently applies.
- **Match to stated intent** — implementation matches the product owner's system-of-record intent well: genuine, deduplicated (60-second window) crash/performance/import-failure/feedback reporting, no screenshots/media, no operator-identity linkage. The two flagged findings (destination-path inclusion; bundled credential) are real implementation/security items, not contradictions of intent — see BUG-017/BUG-018 for recommended follow-up direction.

## Original Plan / Intent

Evidence pending — not yet documented as fact regarding this feature's originally-scoped requirements. The product-owner intent captured 2026-08-14 (see Summary above) describes the currently-understood purpose, not necessarily the original scoping.

## Evolution / Implementation Journal

- **v0.7.4-dev** — `docs/history.md` records `debug:telemetry` and `debug:flush` as *removed* dead IPC channels at this point, implying an earlier, different telemetry surface existed and was cleaned up before the current `services/telemetry.js` shape. Whether the current pipeline is a direct descendant of that earlier surface or a separate rebuild is evidence pending.
- **2026-08-14 — Purpose captured; full 10-point forensic verification performed; two findings tracked as bugs.** A Product-Owner Purpose Capture interview supplied the system-of-record intent now recorded in Summary above. In the same pass, a complete code-level forensic investigation (10 questions: what's collected, triggers, identifiers, archive-identifying info, screenshots/media, transport destination, local storage, retry behavior, consent/opt-out, match to intent) resolved every "evidence pending" item this file previously carried about current behavior. Two findings — a bundled, hardcoded service-account credential, and archive-destination-path inclusion in one report type — were formally recorded as [BUG-017](../bugs/BUG-017_TELEMETRY_HARDCODED_BUNDLED_SERVICE_ACCOUNT_CREDENTIAL.md) and [BUG-018](../bugs/BUG-018_TELEMETRY_IMPORT_FAILURE_REPORT_INCLUDES_ARCHIVE_DESTINATION_PATH.md) rather than left as informal notes. Neither finding blocks purpose canonicalization for this feature, per explicit product-owner instruction. No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evolution / Implementation Journal above has exactly one entry (already reflected as Initial implementation, or see that section directly if it describes a later change).

## Known Bugs / Troubleshooting

[BUG-017 — Telemetry Pipeline Bundles a Hardcoded Google Service-Account Credential](../bugs/BUG-017_TELEMETRY_HARDCODED_BUNDLED_SERVICE_ACCOUNT_CREDENTIAL.md) (Open, High). [BUG-018 — Telemetry Import-Failure Report Includes the Real Archive Destination Path](../bugs/BUG-018_TELEMETRY_IMPORT_FAILURE_REPORT_INCLUDES_ARCHIVE_DESTINATION_PATH.md) (Open, Medium).

## Decisions

None recorded.

## Future Enhancements

Follow-up investigation/remediation for BUG-017 (move the credential out of the packaged bundle, rotate it, confirm `TELEMETRY_ENABLED = false` before any public/open-source release) and BUG-018 (explicit product-owner decision on whether the destination path is intended or should be scrubbed) — see those records for detail. Both are runtime changes, explicitly out of scope for this documentation pass. A full function-level audit of retention policy has not been performed in this pass.

## Related Files

- `services/telemetry.js`
