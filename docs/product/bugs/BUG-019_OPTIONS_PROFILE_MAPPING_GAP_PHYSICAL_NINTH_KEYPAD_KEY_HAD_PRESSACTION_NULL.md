# BUG-019 — Options+ profile mapping gap — physical ninth Keypad key had pressAction: null

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-060 |
| Status | Fixed |
| Severity | Evidence pending — not yet documented as fact. |
| Discovered | 2026-10-15 |
| Fixed | 2026-10-15 |
| Evidence status | Recorded by automated documentation orchestration from session `sess-2026-10-15T12-14-59-369Z-d5ac2a`; evidence source(s): code-diff, test-output, canonical-docs, ai-session-summary, explicit-user-statement, git |

## Symptom

After migrating BACK to the ninth physical key, that key never showed its resolved label (stayed blank/dark) and pressing it did nothing, in every contextual mode — despite the plugin's own OnRefreshRequested/GetBinding resolving the correct binding (role=BackWithPage, label="BACK") every single time, confirmed via log instrumentation, and despite trying moving the refresh off the triggering call stack, pacing the nine-slot refresh with delays, and reversing the refresh invocation order so that slot refreshed first instead of last.

## Root Cause

The physical ninth key's pressAction was literally null in the real Options+ profile (~/Library/Application Support/Logi/LogiPluginService/Applications/Loupedeck70/<app-id>/Profiles/<profile-guid>/ProfileInfo.json) — it had never actually been assigned to the ContextSlotA9 action at the SDK/host level, so no image/caption requery or press ever reached it, independent of anything the plugin code did.

## Investigation Log

- **2026-10-15** — Evidence pending — not yet documented as fact.

## Fix

User re-assigned Context Slot A9 to the physical ninth key directly in Options+; no code change was needed or possible for this specific defect.

## Prevention / Reusable Lesson

When a single physical key's display/press is dead while every other key on the same unified multistate architecture works, check the Options+ profile mapping JSON for that control's pressAction FIRST, before spending time on redraw-timing/threading/SDK theories for code that log evidence already shows is correct.

## Related

None recorded.
