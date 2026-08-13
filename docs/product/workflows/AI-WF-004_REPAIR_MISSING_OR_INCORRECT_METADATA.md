# AI-WF-004 — Repair Missing or Incorrect Metadata

| Field | Value |
|---|---|
| Workflow ID | AI-WF-004 |
| Domain | Metadata |
| Related capabilities | AI-FEAT-033, AI-FEAT-034, AI-FEAT-031 |
| Related roadmap milestone | AI-RM-001 (Completed) |
| Navigation verified | Yes |
| Evidence status | Verified from `renderer/index.html` (`#ovMetadataSync` aria-label, `#msTitle`, lines 7241, 7358) |

## What It Does

Audits archive-wide metadata correctness and repairs drift, without ever blocking or rolling back the original import copy (AI-FEAT-033's own canonical Summary — this workflow does not restate it differently).

## When To Use It

When an event shows a metadata warning/status badge, or after noticing metadata (keywords, photographer field, dates) looks wrong or missing on already-imported files.

## Before You Start

Files must already be imported into an event (this repairs existing archive metadata; it is not part of the import step itself).

## Where To Go

An overview tile labeled for opening **"Open Metadata Management"** (`#ovMetadataSync`, `renderer/index.html:7241`) opens the **Metadata Management** modal (`#msTitle`, `renderer/index.html:7358`) — a single tabbed modal consolidating three previously-separate metadata surfaces (AI-FEAT-034's own record).

## Steps

1. Open **Metadata Management** from the overview tile.
2. Review the event's metadata status — AI-FEAT-031 derives a 9-state event-level status; the exact tab/label an operator uses to trigger a repair scan was **not individually re-verified in this pass** beyond the modal's confirmed existence.
3. Run the audit/repair action for the affected event.

## What Happens Next / Expected Result

Metadata drift is corrected without touching or re-copying the original imported file (the core guarantee stated in AI-FEAT-033's Summary).

## Important Limitations

One documented, non-blocking limitation exists on this exact workflow (from AI-FEAT-033's own Known Bugs section): a preview-session identifier does not survive the Preview→Confirm round trip in some cases — cited here rather than re-derived, see that record directly for the current detail.

## Warnings

None evidenced beyond the limitation above.

## Troubleshooting

None recorded as a dedicated Troubleshooting Entry yet.

## Related Actions

AI-FEAT-036 (Keyword Registry) if the repair concerns keywords specifically; AI-WF-001 if the real issue is that a re-import is actually needed.

## Source

`renderer/index.html:7241,7358`; `docs/product/features/AI-FEAT-033,034,031_*.md`.
