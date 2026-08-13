# AI-WF-007 — Sort QMZ Photographs

| Field | Value |
|---|---|
| Workflow ID | AI-WF-007 |
| Domain | QMZ |
| Related capabilities | AI-FEAT-047 |
| Related roadmap milestone | None |
| Navigation verified | Partial |
| Evidence status | Verified from `renderer/index.html` (`#qmzTitle`, line 8135) for the workspace itself; the entry-point control that opens it was not located in this pass |

## What It Does

Sequences QMZ (Qadam/Majlis/Ziyafat) event photographs into numbered `01Q`/`02M`-style sequence codes, distinct from AutoIngest's standard Event Import grouping — its own dedicated workspace with its own root, state file, and IPC surface (AI-FEAT-047's own canonical Summary).

## When To Use It

For QMZ-type events specifically, which need explicit sequence modeling that the generic Event Import/grouping model does not provide (DEC-011's own stated rationale).

## Before You Start

None identified beyond having a QMZ-type event already established.

## Where To Go

The workspace itself is real and titled **"Sort QMZ Photos"** (`#qmzTitle`, `renderer/index.html:8135`) — a full-window overlay. **The specific button, menu item, or event-type condition that opens this overlay was not located during this pass** — this workflow does not guess it. If asked "where do I find QMZ," the honest answer is that the workspace exists and is titled "Sort QMZ Photos," but its exact entry point requires further verification before being stated as fact.

## Steps

Ordering evidenced directly from the UI's own visual-order lock (`renderer/index.html:2797`): **Sort QMZ Photos → Review Cleanup → Deep Verify**. Beyond this three-stage ordering, individual click-by-click steps within each stage were **not independently re-verified in this pass** and are not invented here.

1. Sort QMZ Photos — assign photos into Q/M/Z sequences.
2. Review Cleanup.
3. Deep Verify.

## What Happens Next / Expected Result

Sequence codes (e.g. `01Q`, `02M`) become the folder-naming convention for the sequence — confirmed these codes are never included in the keyword metadata set at any entry point (AI-FEAT-047's own record, itself verified live through the real UI per that record).

## Important Limitations

Unsequenced files can be adopted into a reserved bucket distinct from AutoIngest's separate, archive-wide Folder Adoption feature (AI-FEAT-046) — these two "adoption" concepts must not be conflated, per AI-FEAT-047's own explicit warning.

## Warnings

A real, historical metadata-loss bug existed in this exact workflow (BUG-007 — QMZ's early independent metadata-context construction silently dropped keywords/Hijri date) — fixed, and the fix is why QMZ now routes through the same shared metadata engine as every other workflow rather than a workflow-specific one (DEC-011's Consequences).

## Troubleshooting

If keywords or Hijri dates appear to be missing after a QMZ sequence, BUG-007 documents the historical root cause (now fixed) — consult it directly rather than assuming a new, different issue.

## Related Actions

AI-FEAT-046 (Archive Folder Adoption) — a different, archive-wide capability, not to be confused with QMZ's own Unsequenced-folder adoption.

## Source

`renderer/index.html:2797,8135`; `docs/product/features/AI-FEAT-047_*.md`; `docs/product/decisions/DEC-011_*.md`; `docs/product/bugs/BUG-007_*.md`.
