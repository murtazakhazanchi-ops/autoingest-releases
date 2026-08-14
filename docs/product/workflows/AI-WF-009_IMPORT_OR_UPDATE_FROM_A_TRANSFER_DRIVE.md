# AI-WF-009 — Import or Update From a Transfer Drive

| Field | Value |
|---|---|
| Workflow ID | AI-WF-009 |
| Domain | Transfer & Backup |
| Related capabilities | AI-FEAT-039, AI-FEAT-038, AI-FEAT-042, AI-FEAT-032, AI-FEAT-025 |
| Related roadmap milestone | None |
| Navigation verified | Yes |
| Evidence status | Verified from `renderer/index.html` (`#alocTransferImportBtn`, `#transferImportModal`, lines 8333, 8589) and `renderer/renderer.js` (`_tiOpen`, `_tiScanImport`, `_tiStartImport`, `_tiResumeFromCheckpoint`, `_tiPause`/`_tiResumeInline`, `_tiVerify`, `_tiMinimize`, lines 14360–15075) |

## What It Does

Consolidates content from a Transfer Drive into the Main Archive Root (Transfer Import, AI-FEAT-039) — matching corresponding archival events by identity where possible and merging their contents without duplicating structures, rather than a blind file copy.

## When To Use It

Bringing event data accumulated on a mobile/portable drive during a live event back into the main archive, or refreshing an already-partially-imported drive with what's new since the last import.

## Before You Start

Both a Transfer Drive (Transfer Root) and a Main Archive Root must already be configured elsewhere in Archive Operations — this workflow's modal only displays them read-only (`_tiOpen`, `renderer/renderer.js:14421-14443`); it does not offer a picker to set them here. A Transfer Export must not currently be running against the same drive: Import is blocked with "A Transfer Export is currently running. Wait for it to finish before importing." if one is (`_tiStartImport`, checking `window.api.getTransferExportStatus()`).

## Where To Go

A **"Transfer Import…"** button (`#alocTransferImportBtn`, `renderer/index.html:8333`) opens the **Transfer Import** modal (`#tiTitle`, line 8592).

## Steps

1. Select **Transfer Import…**. The modal shows the configured Transfer Drive and Main Archive Root (both read-only) and loads the Import Scope tree — Collection folders with their Events nested, direct Event folders at the root level, and any unresolved external folders (`_tiLoadTree`).
2. Choose which folders to import, using **Select all** / **Select none** or checking individual items in the scope tree.
3. Optionally click **Preview** to see counts before committing (Collections/Events/External/Files), or **Scan for New Data** (`window.api.scanImportSync`) to compare the selection against what the Main Archive Root already has. A scan reports new files, already-imported files, and files changed on both sides needing review, and turns the primary action into **Update Import** — copies only the missing files; changed files are never copied automatically.
4. Click **Import** (or **Update Import** after a scan) to begin. If a previous import was interrupted, the modal instead offers **Resume Import** (continues from the saved checkpoint) or **Start Fresh** (`#tiResumeOffer`) the next time it's opened.
5. While running, **Pause** / **Resume** are available, and **Run in Background** hides the modal without cancelling the job — it keeps running in the main process and stays visible via the transfer monitor.
6. After completion, **Verify Checksum** (`window.api.verifyTransferImport`) is available to independently confirm the copied files against source, and **Done** closes the modal.

## What Happens Next / Expected Result

Files land via copy only, recorded in a durable per-file outcome manifest and an audit trail (`.autoingest/transfer-imports/imports.audit.jsonl` — see AI-FEAT-039's Current Behavior) rather than a silent partial state. A successful import also triggers AI-FEAT-032's post-transfer metadata verification pass.

## Important Limitations

Identity-based event matching — the mechanism that lets a renamed folder still be recognized as the same archival event — is substantially realized for direct-Event transfers (loose event folders at the transfer-drive root) but only partially realized for Collection-nested transfers (a drive mirroring the archive's own Collection/Event structure), which currently match by folder name only. This is a confirmed, not-yet-fixed implementation gap against stated product intent, not a documentation error — see [AI-FEAT-039](../features/AI-FEAT-039_TRANSFER_IMPORT.md)'s own Current Behavior and Future Enhancements for the full account. `event.json` itself is never field-merged: when both source and destination have an `event.json` for what's logically the same event, the destination's always wins.

## Warnings

Per `CLAUDE.md`'s File Copy Rules: no overwrite, ever, applies here too. Starting an Import while a Transfer Export is running against the same drive is blocked, not queued.

## Troubleshooting

None recorded in `docs/product/bugs/` yet specific to Transfer Import — see [AI-FEAT-039](../features/AI-FEAT-039_TRANSFER_IMPORT.md)'s own Known Bugs / Troubleshooting section.

## Related Actions

[AI-WF-005](AI-WF-005_EXPORT_OR_UPDATE_A_TRANSFER_DRIVE.md) — the outbound counterpart (Transfer Export). AI-FEAT-043 (Archive Health Reporting) to confirm the destination archive is healthy before a large import.

## Source

`renderer/index.html:8333,8589-8681`; `renderer/renderer.js` (`_tiOpen`, `_tiLoadTree`, `_tiScanImport`, `_tiRenderScanReview`, `_tiStartImport`, `_tiResumeFromCheckpoint`, `_tiStartFresh`, `_tiPause`, `_tiResumeInline`, `_tiVerify`, `_tiMinimize`, `_tiSetButtonPhase`, lines 14360–15075); `docs/product/features/AI-FEAT-039_TRANSFER_IMPORT.md`.
