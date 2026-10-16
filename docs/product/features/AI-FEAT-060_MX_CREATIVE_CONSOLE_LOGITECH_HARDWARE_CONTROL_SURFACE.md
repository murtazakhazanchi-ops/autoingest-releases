# AI-FEAT-060 — MX Creative Console — Logitech Hardware Control Surface

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-060 |
| Category | Hardware & Peripheral Integration |
| Status | Implemented — evolving |
| Maturity | Evolving |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | None recorded — talks to AutoIngest over the existing local WebSocket command layer (`docs/commandLayer.md`), not a dependency on any specific `AI-FEAT-###`'s internal code. |
| Related roadmap milestone | AI-RM-013 |
| Related technical docs | `docs/mxLogitechCSharp.md`, `docs/mxLogitechPlugin.md`, `docs/commandLayer.md` |
| Evidence status | Verified from current code, tests, and a live physical hardware session (2026-10-15); earlier phases (1A/3A-D/4A/4B) are "Known from project history; repository evidence pending" beyond what this plugin's own `docs/mxLogitechCSharp.md`/`mxLogitechPlugin.md` already record. |
| First-known implementation | Evidence pending — not yet documented as fact (Phase 1A predates this record; earliest commit touching `integrations/logitech/autoingest-mx-csharp/` on `feature/mx-creative-console-v2` not yet dated here). |
| Latest major update | 2026-10-15 — Unified Contextual Keypad migration (this record's own Evolution entry below). |

## Summary

A separate C# plugin for the Logitech MX Creative Console (Keypad + dial) that lets an operator drive AutoIngest's Browse/Groups/Map Group/Refine Tags workflows directly from physical hardware, talking to the running AutoIngest Electron app over its existing local WebSocket command layer (`docs/commandLayer.md`) rather than through the on-screen UI. It exists under `integrations/logitech/autoingest-mx-csharp/`, outside the Electron app's own source tree, and is developed entirely on `feature/mx-creative-console-v2` (not yet merged to `main` or `stable/0.9`).

## Current Behavior

As of this record (2026-10-15), the plugin's nine physical Keypad keys are permanently mapped, once, in Logi Options+ to nine native `PluginMultistateDynamicCommand` actions (`ContextSlotA1`–`ContextSlotA9`, `integrations/logitech/autoingest-mx-csharp/src/Actions/`). Which workspace is "active" — Browse, Groups, Map Group, or Refine Tags — is pure application state inside `ContextualKeypadController`/`ContextualKeypadModel` (`src/Helpers/`); each key's current label/image/press-behavior is resolved fresh from that state on every redraw and every press, never cached or guessed. The main dial (`NavigateFilesAdjustment`) is similarly context-sensitive, routing to real file navigation in Browse mode or page-forward/back in the other three modes.

- **Browse mode**: G1/G2/G3 (assign current file to group slot 1/2/3), GROUPS/MAP GROUP/REFINE TAGS (enter that contextual mode), CHANGE EVENT, IMPORT, one reserved/blank key.
- **Groups mode**: real groups listed with dial paging; assignment via press; BACK returns to Browse.
- **Map Group mode**: real sub-event components listed, current-mapping/taken-by-other-group coloring, remapping via press, dial paging, ambiguous-selection safety (renders blank rather than a stale guess); BACK returns to Browse.
- **Refine Tags mode**: real tag labels with default/checked/indeterminate color states (green/default/amber), ALL TAGS/RESET/APPLY controls, dial paging. The ninth key shows **CLOSE** (not BACK) — an explicit operator decision, since this mode is the only one with an AutoIngest-side session to end (`tagRefinement.close`); closing it returns to Browse automatically once AutoIngest confirms the session closed.
- Label truncation (`RefinementWorkspaceModel.TruncateForDisplay` + `ImageSizeHelper.GetWidthPixels`) is applied uniformly across all nine `ContextSlotN.GetCommandDisplayName` overrides.
- The pre-existing `PluginDynamicFolder`-based implementation (`RefineTagsFolder.cs`, `GroupsFolder.cs`, `GroupMappingFolder.cs`) is retained as source/reference, not deleted, but is no longer actively mapped to any physical key.

## Original Plan / Intent

Evidence pending for the full original scope of Phase 1A/3A-D/4A/4B beyond what `docs/mxLogitechCSharp.md` and `mxLogitechPlugin.md` already record from those phases directly. What is verified from this session: the user requested fixing real physical bugs in the then-current Dynamic Tag Refinement workspace, then a visual redesign (plain tag label, whole-button color per state), then — once the folder-rendering redraw mechanism proved physically unreliable — two deliberately scoped architecture spikes (native multistate action state, then a contextual native keypad) before any production migration, each required to pass physical hardware testing before the next step was authorized.

## Evolution / Implementation Journal

- **Phase 1A/3A-D/4A/4B** (dates evidence-pending beyond what `mxLogitechCSharp.md`/`mxLogitechPlugin.md` record directly): initial C# plugin parity migration, Dynamic Tag Refinement workspace, and its physical-closure bug-fixing round — predates this record; see those documents' own histories.
- **2026-10-15 — Visual redesign**: Tag Refinement buttons changed from a badge/icon-based indicator to a whole-button background color per state (green=checked, default=unchecked, amber=indeterminate), matching the main AutoIngest profile's own button style, per explicit user request. Label drawing was removed from the custom-rendered bitmap entirely in favor of the SDK's own native caption, after discovering the two had been rendering two independently-truncated copies of the same name.
- **2026-10-15 — Native Multistate spike (REJECTED as the final architecture, but its finding was accepted)**: confirmed, via reflection against the actually-installed `PluginApi.dll` (v6.4.2.3414) and a 3-action physical test, that `PluginDynamicFolder`'s `ButtonActionNamesChanged()`/`CommandImageChanged()` redraw mechanism is fundamentally unreliable (see BUG record below), while `PluginMultistateDynamicCommand.SetCurrentState()` + `PluginDynamicAction.ActionImageChanged()` is reliable. Explicitly scoped as a 3-action spike only — production code was not touched in this step.
- **2026-10-15 — Contextual Native Keypad spike**: a 5-action physical test confirmed that a single physical key's label/behavior can be reliably switched between multiple real AutoIngest workspace representations via `ActionImageChanged()`, including real tag data end-to-end. Still not production.
- **2026-10-15 — Unified Contextual Keypad production migration** (the decision record below has the full alternatives/rationale): migrated Groups, Map Group, and Refine Tags off `PluginDynamicFolder` rendering onto nine permanently-mapped `ContextSlotA1`–`ContextSlotA9` native multistate actions, after confirming via reflection that no SDK-supported programmatic folder-navigation API exists (ruling out a Refine-Tags-only migration that would have left Groups/Map Group unreachable from the native Keypad). `RefineTagsFolder`/`GroupsFolder`/`GroupMappingFolder` retained as source/reference, not deleted.
- **2026-10-15 — Three physical bugs found and fixed during the migrated build's own hardware verification** (each has its own BUG record, linked below): an Options+ profile mapping gap on the physical ninth key; label truncation silently dropped during the `ContextSlotN` migration; and — following a design request, not a bug — the ninth key's role in Refine Tags mode specifically changed from BACK to CLOSE (`tagRefinement.close`), since that mode is the only one with an AutoIngest-side session to end.
- **2026-10-15 — User-confirmed physical verification**: "i have done all the tests alls working fine" — Groups, Map Group, and Refine Tags modes, plus the remaining physical test matrix items from the migration brief (dial paging, remapping via press, cross-mode switching, label truncation, the CLOSE-vs-BACK layout), all confirmed working on the real device.
- **2026-10-15** — Migrated the AutoIngest MX Creative Console Logitech C# plugin's Groups/Map Group/Refine Tags workspaces off PluginDynamicFolder rendering onto a native 9-slot PluginMultistateDynamicCommand architecture (ContextSlotA1-A9), after confirming the folder-rendering mechanism (ButtonActionNamesChanged/CommandImageChanged) was fundamentally unreliable under physical testing (pagination resets, cross-button color contamination, phantom colors). Physically verified end-to-end on the real MX Creative Keypad. (evidence: cb4a2d489015e6fc3411d156b0edece5b7d77fec)

## Known Bugs / Troubleshooting

- [BUG-018](../bugs/BUG-018_PLUGINDYNAMICFOLDER_REDRAW_MECHANISM_BUTTONACTIONNAMESCHANGED_COMMANDIMAGECHANGE.md) — `PluginDynamicFolder` redraw mechanism (`ButtonActionNamesChanged`/`CommandImageChanged`) unreliable on the installed SDK; the root cause that motivated this entire migration.
- [BUG-019](../bugs/BUG-019_OPTIONS_PROFILE_MAPPING_GAP_PHYSICAL_NINTH_KEYPAD_KEY_HAD_PRESSACTION_NULL.md) — Options+ profile mapping gap; the physical ninth Keypad key had `pressAction: null`.
- [BUG-020](../bugs/BUG-020_LABEL_TRUNCATION_SILENTLY_DROPPED_WHEN_GETCOMMANDDISPLAYNAME_MIGRATED_OFF_PLUGIN.md) — label truncation silently dropped when `GetCommandDisplayName` migrated off the retired `PluginDynamicFolder` commands.

## Decisions

- [DEC-023](../decisions/DEC-023_MX_CREATIVE_CONSOLE_UNIFIED_CONTEXTUAL_KEYPAD_MIGRATION.md) — Unified Contextual Keypad: migrate Groups/Map Group/Refine Tags together onto the native `ContextSlotA1`–`A9` architecture, after confirming no SDK-supported programmatic folder-navigation API exists.

## Future Enhancements

- Remove the retired `PluginDynamicFolder`-based `RefineTagsFolder.cs`/`GroupsFolder.cs`/`GroupMappingFolder.cs` source now that the native replacement is physically proven (currently kept as source/reference only, per the migration brief's own "do not delete first" instruction).
- A native parameterized-action mechanism (`PluginDynamicAction.AddParameter`/`RemoveParameter`/`GetParameters`/`ParametersChanged`/`UpdateParameters`) was found via reflection during this session but deliberately not pursued — noted for a future architecture review, since it contradicts this codebase's earlier assumption that the C# SDK has no parameterized-action mechanism.
- Merge/release decision for `feature/mx-creative-console-v2` into `main`/`stable/0.9` — not yet made.

## Related Files

- `integrations/logitech/autoingest-mx-csharp/src/Helpers/ContextualKeypadController.cs`
- `integrations/logitech/autoingest-mx-csharp/src/Helpers/ContextualKeypadModel.cs`
- `integrations/logitech/autoingest-mx-csharp/src/Helpers/ContextSlotBinding.cs`
- `integrations/logitech/autoingest-mx-csharp/src/Helpers/ContextSlotImageRenderer.cs`
- `integrations/logitech/autoingest-mx-csharp/src/Helpers/ImageSizeHelper.cs`
- `integrations/logitech/autoingest-mx-csharp/src/Helpers/RefinementWorkspaceModel.cs`
- `integrations/logitech/autoingest-mx-csharp/src/Helpers/RefinementButtonImageRenderer.cs`
- `integrations/logitech/autoingest-mx-csharp/src/Helpers/GroupsWorkspaceModel.cs`
- `integrations/logitech/autoingest-mx-csharp/src/Helpers/GroupMappingWorkspaceModel.cs`
- `integrations/logitech/autoingest-mx-csharp/src/Actions/ContextSlotA1.cs` through `ContextSlotA9.cs`
- `integrations/logitech/autoingest-mx-csharp/src/Actions/RefineTagsFolder.cs` (retired from active mapping, retained as source)
- `integrations/logitech/autoingest-mx-csharp/src/Actions/GroupsFolder.cs` (retired from active mapping, retained as source)
- `integrations/logitech/autoingest-mx-csharp/src/Actions/GroupMappingFolder.cs` (retired from active mapping, retained as source)
- `integrations/logitech/autoingest-mx-csharp/src/Actions/NavigateFilesAdjustment.cs`
- `integrations/logitech/autoingest-mx-csharp/test/AutoIngestMxCsDevPlugin.Tests/ContextualKeypadModelTests.cs`
- `docs/mxLogitechCSharp.md`
- `docs/mxLogitechPlugin.md`
