# BUG-018 — Telemetry Import-Failure Report Includes the Real Archive Destination Path

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-007 (Telemetry Pipeline), AI-FEAT-019 (Import Pipeline & Copy Engine) |
| Status | Open |
| Severity | Medium |
| Discovered | 2026-08-14 (forensic code verification during Product-Owner Purpose Capture pass) |
| Fixed | Not yet fixed |
| Evidence status | Verified from current code (`main/main.js` import-failure telemetry call sites) |

## Symptom

Not a runtime symptom — a discovered privacy-scope finding. When an import completes with `errors > 0`, AutoIngest automatically fires a telemetry report (no operator action required). That report's `context.destination` field is the literal archive write path passed from the renderer — which includes the real event/component/photographer folder structure for that import, since `destination` is the actual archive-write path used by the import pipeline. This means real archive/event/photographer naming information can leave the machine as part of routine, automatic crash/error telemetry, not just in response to an explicit operator "send feedback" action.

## Root Cause

The import-failure telemetry call sites (`main/main.js`, two near-identical locations — one for direct imports, one for job-based imports) pass the renderer-supplied `destination` value straight into the telemetry `context` object without redaction. Individual source file paths (`filePaths`) are **not** included in this report — only a file count (`totalFiles`) plus the one destination path. No other telemetry call site (crash, performance) was found to include any file or folder path — this is confirmed to be scoped to the import-failure report type specifically, not a pipeline-wide behavior.

**What can actually leave the machine**: one destination folder path string per import-failure event, written into the same Google Sheet described in [BUG-017](BUG-017_TELEMETRY_HARDCODED_BUNDLED_SERVICE_ACCOUNT_CREDENTIAL.md). Whether this constitutes sensitive exposure depends on institutional judgment about archive/event naming conventions (e.g., whether event names alone could reveal identifying information about a private gathering or individual) — this record states the confirmed mechanism and data flow; it does not assert a severity conclusion beyond what the data itself demonstrably contains (a folder path, not file contents, not personal data fields, not media).

## Investigation Log

- **2026-08-14** — Forensic code investigation (Knowledge Purpose Audit, AI-FEAT-007 forensic check) confirmed: (1) `context.destination` in the import-failure report is the real archive write path, not a placeholder or redacted value; (2) this is the only confirmed instance of archive-identifying information anywhere in the telemetry pipeline — crash and performance reports carry no path/folder/event data; (3) no screenshots or media are captured or transmitted anywhere in the pipeline (confirmed separately, not part of this bug's scope but ruled out during the same investigation); (4) the `reporter` field on this and all other passive/automatic reports defaults to `'Auto-report'` — no linkage was found to AI-FEAT-002's operator-identity system, so this report does not currently attribute the destination path to a specific operator, only to the machine that generated it.

## Fix

Not yet fixed. Runtime remediation is explicitly out of scope for the documentation-canonicalization pass this bug record was created during (Product-Owner Purpose Capture, 2026-08-14). Recommended follow-up direction (not yet actioned): an explicit product-owner decision on whether the destination path is intended telemetry (useful for diagnosing *which kind* of import failed, e.g., transfer-destination class vs. archive-root class) or should be scrubbed/generalized (e.g., reduced to a path depth/category rather than the literal folder names) before continuing to collect it.

## Prevention / Reusable Lesson

When adding a new automatic telemetry call site, explicitly review every field passed into the report's `context` object for archive-identifying content (event names, photographer names, folder structures) before merging — this field was added without that review being evidenced anywhere in the codebase or documentation.

## Related

[AI-FEAT-007](../features/AI-FEAT-007_TELEMETRY_PIPELINE.md), [BUG-017](BUG-017_TELEMETRY_HARDCODED_BUNDLED_SERVICE_ACCOUNT_CREDENTIAL.md) (companion finding from the same forensic investigation).
