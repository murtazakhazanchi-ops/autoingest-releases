# BUG-020 — Label truncation silently dropped when GetCommandDisplayName migrated off PluginDynamicFolder to the ContextSlot architecture

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-060 |
| Status | Fixed |
| Severity | Evidence pending — not yet documented as fact. |
| Discovered | 2026-10-15 |
| Fixed | 2026-10-15 |
| Evidence status | Recorded by automated documentation orchestration from session `sess-2026-10-15T12-14-59-369Z-d5ac2a`; evidence source(s): code-diff, test-output, canonical-docs, ai-session-summary, explicit-user-statement, git |

## Symptom

Long Map Group component names (and, less visibly, Groups/Refine Tags labels) overflowed on the physical key after the Unified Contextual Keypad migration.

## Root Cause

RefineTagsFolder/GroupsFolder/GroupMappingFolder's own GetCommandDisplayName overrides always truncated via RefinementWorkspaceModel.TruncateForDisplay(label, ImageSizeHelper.GetWidthPixels(imageSize)), but the new ContextSlotA1-A9 actions' GetCommandDisplayName overrides returned the raw ContextSlotBinding.Label directly — the truncation call was never carried over during the migration, and short tag/group labels in prior testing never happened to be long enough to expose the regression.

## Investigation Log

- **2026-10-15** — Evidence pending — not yet documented as fact.

## Fix

Added the identical RefinementWorkspaceModel.TruncateForDisplay(..., ImageSizeHelper.GetWidthPixels(imageSize)) call to all 9 ContextSlotN.GetCommandDisplayName overrides uniformly.

## Prevention / Reusable Lesson

When migrating a PluginDynamicFolder's GetCommandDisplayName truncation logic to a new action class, explicitly verify the truncation call itself carried over — it is easy to drop silently since short labels never visibly overflow until a long one appears.

## Related

None recorded.
