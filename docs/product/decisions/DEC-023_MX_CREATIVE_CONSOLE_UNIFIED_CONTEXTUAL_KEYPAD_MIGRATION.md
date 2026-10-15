# DEC-023 — MX Creative Console: Unified Contextual Keypad migration

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-060, AI-RM-013 |
| Status | Accepted |
| Date | 2026-10-15 |
| Evidence status | Recorded by automated documentation orchestration from session `sess-2026-10-15T12-14-59-369Z-d5ac2a` |

## Context

Migrated the AutoIngest MX Creative Console Logitech C# plugin's Groups/Map Group/Refine Tags workspaces off PluginDynamicFolder rendering onto a native 9-slot PluginMultistateDynamicCommand architecture (ContextSlotA1-A9), after confirming the folder-rendering mechanism (ButtonActionNamesChanged/CommandImageChanged) was fundamentally unreliable under physical testing (pagination resets, cross-button color contamination, phantom colors). Physically verified end-to-end on the real MX Creative Keypad.

## Options Considered

1. **Option 1 — Refine-only migration, Groups/Map Group stay as PluginDynamicFolder** — Migrate only Tag Refinement off folder rendering onto the new native multistate mechanism; leave Groups and Map Group exactly as they were, reached via the SDK's existing folder-navigation affordances. Rejected: no SDK-supported way for a press on the native Keypad to programmatically enter a PluginDynamicFolder was ever found (confirmed via reflection), so this option had no real path to let an operator move from the native Keypad into the still-folder-based Groups/Map Group workspaces.
2. **Option 2 — Refine-only migration with a different folder-entry mechanism** — A variant of Option 1 attempting a different SDK affordance to bridge native-Keypad presses into the existing folders. Rejected for the same underlying reason as Option 1 once the reflection pass confirmed the blocker was architectural (no API), not a missing detail to work around.

## Decision

Option 3 — Unified Contextual Keypad. Confirmed via reflection against the actual installed PluginApi.dll that no SDK-supported programmatic folder-navigation API exists anywhere in Plugin/PluginDynamicFolder/PluginDynamicAction/INativeApi — a command press can never programmatically re-enter a different PluginDynamicFolder. This made a scoped Refine-Tags-only migration (keeping Groups/Map Group as PluginDynamicFolder) structurally impossible, since pressing a tag/group/component on the Keypad would have had no way to re-enter the corresponding folder. All 9 physical MX Creative Keypad keys are instead mapped once, permanently, in Options+ to nine PluginMultistateDynamicCommand actions (ContextSlotA1-A9); which workspace is active (Browse / Groups / Map Group / Refine Tags) is pure application state inside a new stateless ContextualKeypadController, which resolves each key's current label/image/press-behavior fresh on every redraw and every press. PluginDynamicFolder rendering for Groups/Map Group/Refine Tags was fully retired from active use; the three old folder classes (RefineTagsFolder, GroupsFolder, GroupMappingFolder) are kept as source/reference, not deleted.

## Consequences

RefineTagsFolder/GroupsFolder/GroupMappingFolder (PluginDynamicFolder-based) are retained as source/reference per the migration brief, not deleted — a future session should decide whether to remove them now that the native replacement is physically proven.; The remaining physical test matrix items from the original migration brief (Map Group remapping-via-press, cross-mode rapid-switching stress test, Dialpad/dial-restoration regression, a real-transport synthetic-fixture end-to-end test) were reported by the user as completed ('i have done all the tests alls working fine') but are not independently re-verified here beyond the user's own confirmation.; An earlier reflection pass found PluginDynamicAction's AddParameter/RemoveParameter/GetParameters/ParametersChanged/UpdateParameters — a native parameterized-action mechanism that contradicts this codebase's earlier assumption that the C# SDK has no parameterized-action mechanism — noted but deliberately not pursued in this migration (out of scope).

## Reconciliation Note

None recorded.
