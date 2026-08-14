# AI-WF-002 — Create a New Event

| Field | Value |
|---|---|
| Workflow ID | AI-WF-002 |
| Domain | Events |
| Related capabilities | AI-FEAT-009 |
| Related roadmap milestone | None |
| Navigation verified | Yes |
| Evidence status | Verified from `renderer/index.html` (home-screen button text, lines 7077–7081) and `renderer/renderer.js`'s onboarding screen 2 |

## What It Does

Establishes the event context — Collection → Event → Components — that AutoIngest uses to route every subsequently-imported file into the correct archive folder, without manual path entry (onboarding screen 2: *"Set the event context"*).

## When To Use It

Before importing photographs for a new event that doesn't already exist in the archive.

## Before You Start

None identified beyond having archive access configured (AI-FEAT-042).

## Where To Go

Home screen: **"Create New Event"** pretitle above a **"Create Event →"** primary button (`renderer/index.html:7077-7081`, `#heroPrimaryBtn`). This opens the Event Creator wizard (`#eventCreatorPanel`, `renderer/eventCreator.js`).

## Steps

1. From the home screen, select **Create Event →**.
2. Choose or create a Collection.
3. Enter the event's identifying details. The wizard is real and present in code (`eventCreator.js`), but the exact field-by-field prompts (event type, location, city, country) were **not individually re-verified in this pass** beyond their presence — described generically here rather than inventing exact field labels.
4. Confirm to create the event. AutoIngest then uses this event structure to route future imports (onboarding screen 2's own stated guarantee).

## What Happens Next / Expected Result

The event becomes available as a destination for Import (AI-WF-001) and appears in Event Management for later editing (AI-FEAT-010).

## Important Limitations

Editing an existing event's fields has a known, documented edge case (BUG-006 — full-payload save can silently drop untracked fields; recorded as a recurring pattern) — relevant if this workflow leads into an edit, not creation itself.

## Warnings

None evidenced specific to event creation itself.

## Troubleshooting

None recorded as a dedicated Troubleshooting Entry.

## Related Actions

AI-WF-001 (Import Photographs), AI-FEAT-010 (Event Management & Editing) for changes after creation.

## Source

`renderer/index.html:7077-7081`; `renderer/renderer.js` (`OB_SCREENS[1]`); `docs/product/features/AI-FEAT-009_*.md`.
