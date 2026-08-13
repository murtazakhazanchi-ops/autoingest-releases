# AI-WF-003 — Use Quick Import for a Small Batch

| Field | Value |
|---|---|
| Workflow ID | AI-WF-003 |
| Domain | Import |
| Related capabilities | AI-FEAT-023 |
| Related roadmap milestone | None |
| Navigation verified | Yes |
| Evidence status | Verified from `renderer/index.html` (`.qi-title`, lines 520, 7090, 7118) and onboarding screen 1 |

## What It Does

Simple, destination-based copying without setting up an event first (onboarding screen 1: *"Quick Import — simple destination-based copying without event setup"*).

## When To Use It

For a fast, small, one-off copy where full event-structured archiving isn't needed or wanted.

## Before You Start

None identified.

## Where To Go

A **"Quick Import"** card on the home screen (`renderer/index.html:7090`, `.qi-title`), separate from the Event Import mode used by AI-WF-001.

## Steps

1. Select the **Quick Import** card on the home screen.
2. Choose a destination folder.
3. Select and copy the files.

Step 2–3 wording is inferred from the capability's own name and onboarding screen 1's one-line description ("simple destination-based copying") — the exact in-modal button sequence was **not independently re-verified in this pass**; treat steps 2–3 as a reasonable paraphrase of the capability's stated behavior, not a verified click-by-click transcript.

## What Happens Next / Expected Result

Files are copied to the chosen destination directly — no `event.json` is created for a Quick Import (per AI-FEAT-023's own canonical record).

## Important Limitations

**This is the single most important thing an operator should know before choosing Quick Import over Event Import**: a Quick Import is permanently excluded from AutoIngest's metadata audit coverage (AI-FEAT-033) because no event.json exists to audit against. This limitation is evidenced directly in AI-FEAT-023's own canonical record, not previously stated anywhere in the onboarding UI itself.

## Warnings

Per `CLAUDE.md`'s File Copy Rules: no file is ever overwritten regardless of import mode.

## Troubleshooting

None recorded.

## Related Actions

AI-WF-001 (full Event Import, if archival structure is actually needed).

## Source

`renderer/index.html:520,7090,7118`; `renderer/renderer.js` (`OB_SCREENS[0]`); `docs/product/features/AI-FEAT-023_*.md`.
