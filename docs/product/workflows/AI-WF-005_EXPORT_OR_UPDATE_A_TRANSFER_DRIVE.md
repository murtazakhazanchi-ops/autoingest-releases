# AI-WF-005 — Export or Update a Transfer Drive

| Field | Value |
|---|---|
| Workflow ID | AI-WF-005 |
| Domain | Transfer & Backup |
| Related capabilities | AI-FEAT-038, AI-FEAT-039, AI-FEAT-040, AI-FEAT-041 |
| Related roadmap milestone | None |
| Navigation verified | Yes |
| Evidence status | Verified from `renderer/index.html` (`#alocTransferExportBtn`, `#txTitle`, `#txScanBtn`, lines 8332, 8430, 8575) |

## What It Does

Writes a clean mirror of selected events to a portable drive (Transfer Export, AI-FEAT-038), or scans an existing transfer drive for what's changed since the last copy (Backup Update Scanning, AI-FEAT-040, a `backupUpdate` mode whose own record lists AI-FEAT-038 as its Parent feature) — these are two distinct capabilities sharing this one entry point (`#alocTransferExportBtn` → the Transfer Export modal), with different conflict semantics (Backup Update never overwrites or renames on conflict; Transfer Export's own record should be consulted for its exact behavior rather than assumed identical). This workflow is outbound only (Active Archive Root → Transfer Drive) — for the inbound direction (Transfer Drive → Main Archive Root), see [AI-WF-009](AI-WF-009_IMPORT_OR_UPDATE_FROM_A_TRANSFER_DRIVE.md).

## When To Use It

Moving events to a portable drive for the first time (Export), or refreshing a drive that already has some of the same events on it (Update/Scan).

## Before You Start

A destination drive must be connected and selected.

## Where To Go

A **"Transfer Export…"** button (`#alocTransferExportBtn`, `renderer/index.html:8332`) opens the **Transfer Export** modal (`#txTitle`, line 8430), which contains a **"Scan for New Data"** button (`#txScanBtn`, line 8575) for the update/comparison path.

## Steps

1. Select **Transfer Export…**.
2. Choose the destination drive and the events to include.
3. To update an existing transfer drive instead of a fresh export, use **Scan for New Data** to compare against what's already there before copying.
4. Confirm to begin the copy. Transfer/sync can run in the background without blocking the rest of the app while it copies (AI-FEAT-041 — confirmed as a real, distinct capability from standard Import, which does not have this background/minimize behavior).

## What Happens Next / Expected Result

A verified copy is written to the destination (checksum verification, AI-FEAT-025). If interrupted, resume-state handling exists (AI-FEAT-041) — the exact operator-visible resume prompt was not independently re-verified in this pass.

## Important Limitations

A real, historical divergence between displayed resume state and actual backend progress was found and fixed (BUG-005) — cited as evidence this path has real edge-case history, not to imply it's currently broken.

## Warnings

Per `CLAUDE.md`'s File Copy Rules: no overwrite, ever, applies here too.

## Troubleshooting

If a transfer appears stuck or resume state looks wrong, BUG-005's record documents the historical root cause and fix — consult it directly.

## Related Actions

AI-FEAT-043 (Archive Health Reporting) to confirm the source archive is healthy before a large transfer. [AI-WF-009](AI-WF-009_IMPORT_OR_UPDATE_FROM_A_TRANSFER_DRIVE.md) — the inbound counterpart (Transfer Import).

## Source

`renderer/index.html:8332,8430,8575`; `docs/product/features/AI-FEAT-038,039,040,041_*.md`; `docs/product/bugs/BUG-005_*.md`.
