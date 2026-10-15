# BUG-018 — PluginDynamicFolder redraw mechanism (ButtonActionNamesChanged/CommandImageChanged) unreliable on the installed SDK

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-060 |
| Status | Fixed |
| Severity | Evidence pending — not yet documented as fact. |
| Discovered | 2026-10-15 |
| Fixed | 2026-10-15 |
| Evidence status | Recorded by automated documentation orchestration from session `sess-2026-10-15T12-14-59-369Z-d5ac2a`; evidence source(s): code-diff, test-output, canonical-docs, ai-session-summary, explicit-user-statement, git |

## Symptom

Tag Refinement buttons showed stale colors after a re-press, a tag press sometimes visibly recolored a DIFFERENT tag's button, and — under the interim double-notification workaround built to force a redraw — any tag press on page 2+ of a multi-page scope snapped the device back to page 1, making multi-page refinement practically unusable.

## Root Cause

CommandImageChanged() does not cause any GetCommandImage requery at all on this installed SDK build (confirmed across three separate diagnostic-logging attempts, both CreateCommandName()-wrapped and raw-actionParameter forms); the only working redraw trigger (ButtonActionNamesChanged(), via a drop-to-empty/restore trick) reset the folder's pagination to page 1 as a side effect, and separately, diagnostic logging proved the plugin's own state computation was correct every time a cross-button contamination was observed — the device was displaying content the plugin never sent.

## Investigation Log

- **2026-10-15** — Evidence pending — not yet documented as fact.

## Fix

Retired PluginDynamicFolder-based rendering for Groups/Map Group/Refine Tags entirely, migrating to PluginMultistateDynamicCommand.SetCurrentState()/ActionImageChanged(), proven reliable across two dedicated physical spikes (native multistate action state, then a contextual native keypad) before the production migration.

## Prevention / Reusable Lesson

On this SDK, prefer PluginMultistateDynamicCommand + ActionImageChanged() for any live, state-driven redraw; do not rely on PluginDynamicFolder's ButtonActionNamesChanged()/CommandImageChanged() for anything beyond a one-time list render.

## Related

None recorded.
