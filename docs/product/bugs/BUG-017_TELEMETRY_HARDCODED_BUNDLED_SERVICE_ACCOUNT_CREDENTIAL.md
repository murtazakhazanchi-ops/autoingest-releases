# BUG-017 — Telemetry Pipeline Bundles a Hardcoded Google Service-Account Credential

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-007 (Telemetry Pipeline) |
| Status | Open |
| Severity | High |
| Discovered | 2026-08-14 (forensic code verification during Product-Owner Purpose Capture pass) |
| Fixed | Not yet fixed |
| Evidence status | Verified from current code (`services/telemetry.js`) |

## Symptom

Not a runtime symptom — a discovered security/operational-hygiene exposure. `services/telemetry.js` authenticates to Google Sheets using a service-account JSON key file, bundled inside the packaged application via `extraResources`. The Sheet ID it writes to is also hardcoded in source.

## Root Cause

The credential file is shipped inside every packaged build rather than being supplied at runtime (environment variable, secrets manager, or per-install configuration). Anyone with access to a packaged AutoIngest build can, in principle, extract the bundled credential file from the application resources.

**What the credential authorizes** (established from code, not assumed): `services/telemetry.js` uses it only to call `spreadsheets.values.append` against one specific, hardcoded Google Sheet (the "Bug Tracker" sheet referenced in the telemetry pipeline) — i.e., write-access scoped to that one sheet via the `googleapis` package, not a broader Google Cloud credential with wider account permissions. This distinguishes a **confirmed, scoped exposure** (write access to one internal tracking sheet) from a **hypothetical, broader risk** (e.g., account-wide cloud credentials) — the latter is not evidenced and must not be assumed.

The code's own author already flagged this as a known, accepted risk in an inline comment (`services/telemetry.js`, near the `extraResources`/service-account loading block): explicitly described as an **"ACCEPTED RISK"** for internal/pre-release use, with an explicit instruction to **rotate the key and set `TELEMETRY_ENABLED = false` before any public or open-source release**. This bug record formalizes that pre-existing code comment into canonical tracking rather than leaving it as an inline note only the next reader of that specific file would see.

## Investigation Log

- **2026-08-14** — Forensic code investigation (Knowledge Purpose Audit, AI-FEAT-007 forensic check) confirmed: (1) the credential is a real, bundled service-account JSON key, not a placeholder; (2) it is actively used — if present and network-reachable, `flush()` writes real telemetry rows to the live sheet, this is not staged/inert code; (3) the Sheet ID is hardcoded in source; (4) the exposure is scoped to one sheet's write access via the service account's own grant, not a broader credential, based on how the credential is used in code — the credential's own IAM-level permission scope was not independently verified (that would require inspecting the Google Cloud project directly, outside this repository's evidence).

## Fix

Not yet fixed. Runtime remediation is explicitly out of scope for the documentation-canonicalization pass this bug record was created during (Product-Owner Purpose Capture, 2026-08-14) — see that pass's governing instructions. Recommended follow-up direction (not yet actioned): move the credential out of the packaged bundle (environment variable or a secrets-delivery mechanism resolved at runtime), rotate the existing key once it is removed from distribution, and confirm the `TELEMETRY_ENABLED = false` / key-rotation step the code comment already specifies actually happens before any public or open-source release.

## Prevention / Reusable Lesson

Before any public/open-source release preparation (see `docs/product/README.md` § Autonomous Engineering Intelligence and the opensource-* tooling), explicitly check `services/telemetry.js` for this credential and confirm it has been rotated and removed from the distributed bundle — do not rely on the inline code comment alone being noticed. This is exactly the kind of secret-in-bundled-resources risk the opensource-sanitizer tooling's secret-scanning patterns are meant to catch; confirm it's covered there.

## Related

[AI-FEAT-007](../features/AI-FEAT-007_TELEMETRY_PIPELINE.md), [BUG-018](BUG-018_TELEMETRY_IMPORT_FAILURE_REPORT_INCLUDES_ARCHIVE_DESTINATION_PATH.md) (companion finding from the same forensic investigation).
