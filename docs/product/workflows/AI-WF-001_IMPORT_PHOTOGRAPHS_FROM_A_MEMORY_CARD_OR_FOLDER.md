# AI-WF-001 — Import Photographs From a Memory Card or Folder

| Field | Value |
|---|---|
| Workflow ID | AI-WF-001 |
| Domain | Import |
| Related capabilities | AI-FEAT-011, AI-FEAT-012, AI-FEAT-017, AI-FEAT-018, AI-FEAT-019, AI-FEAT-022 |
| Related roadmap milestone | None |
| Navigation verified | Partial |
| Evidence status | Verified from `renderer/renderer.js`'s onboarding overlay text (`OB_SCREENS`, lines 11678–11710) — this is the app's own real first-run instructions, not a paraphrase of engineering docs |

## What It Does

Copies photographs (and other supported media) from a connected source — a memory card, external drive, or local folder — into the correct archive folder structure for an event, routing multi-photographer or multi-component imports automatically.

## When To Use It

Whenever new photographs need to enter the archive under a real event (as opposed to a quick, un-structured copy — see AI-WF-003 for Quick Import instead).

## Before You Start

An event must already exist or be created as part of this flow (see AI-WF-002). None beyond that is evidenced in this pass.

## Where To Go

The app's home screen offers an **Event Import** mode, distinct from Quick Import (onboarding screen 1: *"Choose Event Import or Quick Import"*). The exact button/menu label for entering Event Import mode was **not independently re-verified in this pass** beyond the onboarding overlay's own framing — see AI-WF-003 for the confirmed Quick Import card entry point.

## Steps

Verbatim from the app's own onboarding screen 3 ("Select and route files"), the only place these steps are actually written down for an operator:

1. Connect or choose your source (card, drive, or folder).
2. Select the files you want to import.
3. For multi-component events, assign files to groups/sub-events.
4. Choose photographer and click Import.

## What Happens Next / Expected Result

Files are routed into the event's archive folder structure by photographer (AI-FEAT-022) and component/group (AI-FEAT-017, AI-FEAT-018), then queued for metadata writing (AI-FEAT-029) automatically — evidenced by those features' own canonical records, not independently re-verified live in this pass.

## Important Limitations

- Duplicate files are detected during import (AI-FEAT-020); the exact skip/rename operator-facing behavior is not spelled out in onboarding text.
- No step-by-step guidance exists beyond the four onboarding lines above — anything more granular (e.g. exactly which UI element to click for "choose your source") is not evidenced in this pass and is not stated here.

## Warnings

Per `CLAUDE.md`'s File Copy Rules (repository-wide, not workflow-specific): no file is ever overwritten; a same-name conflict is renamed, not replaced.

## Troubleshooting

None recorded as a dedicated Troubleshooting Entry yet. If an import is interrupted, AI-FEAT-021 (Atomic Import Transaction) is the relevant capability — see that record directly; this workflow does not restate its guarantees.

## Related Actions

AI-WF-002 (Create a New Event), AI-WF-003 (Quick Import), AI-FEAT-026 (Audit Integrity Verification) as a natural next step after a large import.

## Source

`renderer/renderer.js` (`OB_SCREENS`, lines 11678–11710); `docs/product/features/AI-FEAT-011,012,017,018,019,022_*.md`.
