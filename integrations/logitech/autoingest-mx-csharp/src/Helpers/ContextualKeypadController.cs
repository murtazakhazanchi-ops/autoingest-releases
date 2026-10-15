namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;

    public enum ContextualKeypadMode { Browse, Groups, MapGroup, RefineTags }

    /// <summary>
    /// AI-FEAT MX Console — Unified Contextual Keypad (production). The
    /// single authority for what all nine physical Keypad slots currently
    /// mean and do. Replaces PluginDynamicFolder-based rendering for
    /// Groups/MapGroup/RefineTags with the physically-proven native
    /// mechanism (PluginMultistateDynamicCommand.SetCurrentState() +
    /// PluginDynamicAction.ActionImageChanged() — see the two prior spikes'
    /// own history in docs/mxLogitechCSharp.md for why: CommandImageChanged()/
    /// ButtonActionNamesChanged()-based redraw tricks were confirmed, across
    /// extensive physical testing, to reset pagination, cross-contaminate
    /// button colors, and show phantom colors never requested by the
    /// plugin — SetCurrentState(sameIndex) does not redraw at all;
    /// ActionImageChanged() does, reliably, with none of those failure
    /// modes).
    ///
    /// This class is a thin SDK shell: every real decision (what a slot
    /// shows, how many pages exist) lives in ContextualKeypadModel (pure,
    /// unit-tested, no SharedClient dependency). This class owns only
    /// mutable runtime state (current mode, per-mode page cursor) and the
    /// SharedClient subscription/dispatch wiring — same split every other
    /// workspace in this plugin already uses.
    /// </summary>
    public static class ContextualKeypadController
    {
        public static ContextualKeypadMode Mode { get; private set; } = ContextualKeypadMode.Browse;

        private static int _groupsPage;
        private static int _mapGroupPage;
        private static int _refinePage;

        private static AutoIngestState _latestState;
        private static IDisposable _subscription;
        private static readonly object _lifecycleLock = new();

        /// <summary>Fired whenever every slot should re-resolve its binding
        /// and redraw — always via ActionImageChanged() on the subscriber's
        /// own instance (see each ContextSlotN's own doc comment for why a
        /// controller/event-driven design, not a direct cross-instance call,
        /// is required here).</summary>
        public static event Action RefreshRequested;

        /// <summary>Invokes RefreshRequested one subscriber at a time,
        /// isolating failures. A plain multicast Invoke() would let one
        /// throwing subscriber abort every subscriber registered after it —
        /// since the nine ContextSlotN instances subscribe in construction
        /// order (A1..A9), a single bad binding resolution earlier in that
        /// list would silently starve the later slots (A9 — BACK — worst of
        /// all) of their redraw, with nothing in the log to show why. Each
        /// slot's own exception is logged and the rest still run.</summary>
        private static void SafeRaiseRefresh()
        {
            foreach (var handler in RefreshRequested?.GetInvocationList() ?? Array.Empty<Delegate>())
            {
                try
                {
                    ((Action)handler).Invoke();
                }
                catch (Exception ex)
                {
                    PluginLog.Error(ex, "[autoingest-mx-cs] contextual_keypad_controller: a slot's RefreshRequested handler threw — isolated, other slots still refreshed");
                }
            }
        }

        // ── Lifecycle ────────────────────────────────────────────────────

        public static void EnsureStarted()
        {
            lock (_lifecycleLock)
            {
                if (_subscription != null) { return; }
                _subscription = SharedClient.Instance.Subscribe(OnStateChanged);
            }
        }

        private static void OnStateChanged(ClientSnapshot snapshot)
        {
            _latestState = snapshot.ConnectionState == ConnectionState.Connected ? snapshot.State : null;

            // brief §19/§22 "Apply exiting refinement returns to Browse
            // automatically" and "do not preserve an artificial hardware-only
            // refinement session" — if AutoIngest itself says refinement is
            // no longer active while we are showing RefineTags mode (Apply
            // committed and exited, selection/scope changed underneath us,
            // disconnected), return to Browse rather than show a stale or
            // fabricated workspace.
            if (Mode == ContextualKeypadMode.RefineTags && _latestState?.TagRefinement?.Active != true)
            {
                Mode = ContextualKeypadMode.Browse;
                PluginLog.Info("[autoingest-mx-cs] contextual_keypad_controller: refinement no longer active — auto-returning to Browse");
            }

            ClampAllPages();
            SafeRaiseRefresh();
        }

        // ── Mode transitions ─────────────────────────────────────────────

        public static void EnterGroups()
        {
            Mode = ContextualKeypadMode.Groups;
            _groupsPage = 0;
            PluginLog.Info("[autoingest-mx-cs] contextual_keypad_controller: entered Groups");
            SafeRaiseRefresh();
        }

        public static void EnterMapGroup()
        {
            Mode = ContextualKeypadMode.MapGroup;
            _mapGroupPage = 0;
            PluginLog.Info("[autoingest-mx-cs] contextual_keypad_controller: entered MapGroup");
            SafeRaiseRefresh();
        }

        public static void EnterRefineTags()
        {
            Mode = ContextualKeypadMode.RefineTags;
            _refinePage = 0;
            PluginLog.Info("[autoingest-mx-cs] contextual_keypad_controller: entered RefineTags");
            SafeRaiseRefresh();
            ActionRunner.FireAndForget(EnsureRefinementOpenAsync, "contextual_keypad_enter_refine");
        }

        private static async Task EnsureRefinementOpenAsync()
        {
            // brief §3/§9: execute the existing authoritative tagRefinement.open;
            // AutoIngest's own subsequent state push (handled by OnStateChanged
            // above) is what actually populates real tags — never assume
            // stale cached state, never fabricate a session locally.
            var state = SharedClient.Instance.GetLatestState();
            if (state?.TagRefinement?.Active == true) { return; }
            await GatedCommand.RunAsync("tagRefinement.open", "contextual_keypad_refine_open").ConfigureAwait(false);
        }

        /// <summary>brief §7/§13 — BACK from any contextual mode. Restores
        /// Browse bindings and normal dial navigation immediately; clears no
        /// AutoIngest state itself (RefineTags' own draft/session semantics
        /// are untouched, same as the retired RefineTagsFolder's own
        /// documented "leaving the hardware workspace is not Done
        /// Refining" rule).</summary>
        public static void Back()
        {
            Mode = ContextualKeypadMode.Browse;
            PluginLog.Info("[autoingest-mx-cs] contextual_keypad_controller: Back -> Browse");
            SafeRaiseRefresh();
        }

        // ── Dial (brief §9) ──────────────────────────────────────────────

        /// <param name="direction">+1 clockwise, -1 counter-clockwise.</param>
        public static void DialRotate(int direction)
        {
            if (direction == 0) { return; }
            switch (Mode)
            {
                case ContextualKeypadMode.Browse:
                    var commandId = direction > 0 ? "navigation.nextFile" : "navigation.previousFile";
                    ActionRunner.FireAndForget(async () =>
                    {
                        var result = await SharedClient.Instance.ExecuteCommandAsync(commandId).ConfigureAwait(false);
                        if (!result.Ok) { PluginLog.Verbose($"[autoingest-mx-cs] contextual_keypad_controller: {commandId} not executed ({result.Reason ?? "unknown"})"); }
                    }, "contextual_keypad_dial_browse");
                    return;
                case ContextualKeypadMode.Groups:
                    _groupsPage = ContextualKeypadModel.ClampPage(_groupsPage + direction, ContextualKeypadModel.GroupsPageCount(_latestState?.Groups, _latestState?.AvailableCommands));
                    break;
                case ContextualKeypadMode.MapGroup:
                    _mapGroupPage = ContextualKeypadModel.ClampPage(_mapGroupPage + direction, ContextualKeypadModel.MapGroupPageCount(_latestState?.AvailableSubEvents, _latestState?.TargetGroupIdForMapping, _latestState?.Groups));
                    break;
                case ContextualKeypadMode.RefineTags:
                    _refinePage = ContextualKeypadModel.ClampPage(_refinePage + direction, ContextualKeypadModel.RefinePageCount(_latestState?.TagRefinement, _latestState?.AvailableCommands));
                    break;
            }
            SafeRaiseRefresh();
        }

        private static void ClampAllPages()
        {
            _groupsPage = ContextualKeypadModel.ClampPage(_groupsPage, ContextualKeypadModel.GroupsPageCount(_latestState?.Groups, _latestState?.AvailableCommands));
            _mapGroupPage = ContextualKeypadModel.ClampPage(_mapGroupPage, ContextualKeypadModel.MapGroupPageCount(_latestState?.AvailableSubEvents, _latestState?.TargetGroupIdForMapping, _latestState?.Groups));
            _refinePage = ContextualKeypadModel.ClampPage(_refinePage, ContextualKeypadModel.RefinePageCount(_latestState?.TagRefinement, _latestState?.AvailableCommands));
        }

        // ── Binding resolution ───────────────────────────────────────────

        public static ContextSlotBinding GetBinding(int slotIndex) => Mode switch
        {
            ContextualKeypadMode.Groups => ContextualKeypadModel.BuildGroupsBindings(_latestState?.Groups, _latestState?.AvailableCommands, _groupsPage)[slotIndex],
            ContextualKeypadMode.MapGroup => ContextualKeypadModel.BuildMapGroupBindings(_latestState?.AvailableSubEvents, _latestState?.TargetGroupIdForMapping, _latestState?.Groups, _mapGroupPage)[slotIndex],
            ContextualKeypadMode.RefineTags => ContextualKeypadModel.BuildRefineBindings(_latestState?.TagRefinement, _latestState?.AvailableCommands, _refinePage)[slotIndex],
            _ => ContextualKeypadModel.BrowseBindings[slotIndex],
        };

        // ── Press routing (brief §8/§10) ─────────────────────────────────

        /// <summary>Always re-resolves the CURRENT binding fresh before
        /// acting — never trusts whatever a slot last rendered — the same
        /// stale-payload-prevention rule every other press handler in this
        /// plugin already follows.</summary>
        public static void ExecuteSlotPress(int slotIndex)
        {
            var binding = GetBinding(slotIndex);
            switch (binding.Role)
            {
                case SlotRole.Blank:
                    return;
                case SlotRole.StaticAction:
                    ExecuteStaticAction(binding.Payload);
                    return;
                case SlotRole.ModeEntry:
                    switch (binding.Payload)
                    {
                        case "mode:groups": EnterGroups(); break;
                        case "mode:mapgroup": EnterMapGroup(); break;
                        case "mode:refine": EnterRefineTags(); break;
                    }
                    return;
                case SlotRole.BackWithPage:
                    Back();
                    return;
                case SlotRole.AllTags:
                    ActionRunner.FireAndForget(() => GatedCommand.RunAsync("tagRefinement.useAllTags", "contextual_keypad_all_tags"), "contextual_keypad_all_tags");
                    return;
                case SlotRole.Reset:
                    // brief §18: real tagRefinement.clearSelected semantics —
                    // reverts to inherited defaults, NOT "remove every tag".
                    ActionRunner.FireAndForget(() => GatedCommand.RunAsync("tagRefinement.clearSelected", "contextual_keypad_reset"), "contextual_keypad_reset");
                    return;
                case SlotRole.Apply:
                    ActionRunner.FireAndForget(() => GatedCommand.RunAsync("tagRefinement.applyToSelected", "contextual_keypad_apply"), "contextual_keypad_apply");
                    return;
                case SlotRole.CloseRefine:
                    // The real on-screen panel's own distinct "Done
                    // Refining" action — ends AutoIngest's own refinement
                    // session. No local Mode flip here: wait for the
                    // resulting state push, same "never optimistic" rule
                    // every other press in this plugin follows; the
                    // existing OnStateChanged auto-revert (Mode==RefineTags
                    // && TagRefinement.Active != true -> Browse) returns the
                    // Keypad to Browse once AutoIngest confirms it closed.
                    ActionRunner.FireAndForget(() => GatedCommand.RunAsync("tagRefinement.close", "contextual_keypad_close_refine"), "contextual_keypad_close_refine");
                    return;
                case SlotRole.Tag:
                    ExecuteTagPress(binding.Payload);
                    return;
                case SlotRole.Group:
                    ExecuteGroupPress(binding.Payload);
                    return;
                case SlotRole.Component:
                    ExecuteComponentPress(binding.Payload);
                    return;
            }
        }

        private static void ExecuteStaticAction(string payload)
        {
            switch (payload)
            {
                case "assign:1": ActionRunner.FireAndForget(() => GroupSlotHelper.AssignToGroupSlotAsync(1), "contextual_keypad_g1"); break;
                case "assign:2": ActionRunner.FireAndForget(() => GroupSlotHelper.AssignToGroupSlotAsync(2), "contextual_keypad_g2"); break;
                case "assign:3": ActionRunner.FireAndForget(() => GroupSlotHelper.AssignToGroupSlotAsync(3), "contextual_keypad_g3"); break;
                case "changeevent": ActionRunner.FireAndForget(() => GatedCommand.RunAsync("event.openChooser", "contextual_keypad_change_event", requiredContext: "browse"), "contextual_keypad_change_event"); break;
                case "import": ActionRunner.FireAndForget(() => GatedCommand.RunAsync("import.openConfirmation", "contextual_keypad_import", requiredContext: "browse"), "contextual_keypad_import"); break;
            }
        }

        private static void ExecuteTagPress(string tagId)
        {
            // Re-resolve against the LATEST state fresh, never the binding
            // that was rendered — a stale/unknown tag id is rejected, never
            // guessed at (same rule RefineTagsFolder's own tag presses used).
            var latest = SharedClient.Instance.GetLatestState();
            var tag = RefinementWorkspaceModel.ResolveTag(latest?.TagRefinement, tagId);
            if (tag == null)
            {
                PluginLog.Verbose($"[autoingest-mx-cs] contextual_keypad_controller: stale/unknown tag id \"{tagId}\" — ignored");
                return;
            }
            var nextChecked = RefinementWorkspaceModel.ComputeNextChecked(tag.State);
            ActionRunner.FireAndForget(
                () => GatedCommand.RunAsync("tagRefinement.setTagState", "contextual_keypad_set_tag", payload: new { tagId = tag.Id, @checked = nextChecked }),
                "contextual_keypad_set_tag");
        }

        private static void ExecuteGroupPress(string actionParameter)
        {
            if (actionParameter == GroupsWorkspaceModel.NewGroupActionParameter)
            {
                ActionRunner.FireAndForget(() => GatedCommand.RunAsync("group.assign", "contextual_keypad_new_group"), "contextual_keypad_new_group");
                return;
            }
            if (!int.TryParse(actionParameter, out var groupId))
            {
                PluginLog.Verbose($"[autoingest-mx-cs] contextual_keypad_controller: unparseable group actionParameter \"{actionParameter}\" — ignored");
                return;
            }
            ActionRunner.FireAndForget(() => GatedCommand.RunAsync("group.assign", "contextual_keypad_assign_group", payload: new { groupId }), "contextual_keypad_assign_group");
        }

        private static void ExecuteComponentPress(string subEventId)
        {
            // Re-resolve the target group fresh too — a group reassignment
            // elsewhere between redraw and press must never apply to the
            // wrong group.
            var latest = SharedClient.Instance.GetLatestState();
            var groupId = latest?.TargetGroupIdForMapping;
            if (groupId == null)
            {
                PluginLog.Verbose("[autoingest-mx-cs] contextual_keypad_controller: no resolved target group at press time — ignored");
                return;
            }
            ActionRunner.FireAndForget(
                () => GatedCommand.RunAsync("group.setSubEvent", "contextual_keypad_set_subevent", payload: new { groupId = groupId.Value, subEventId }),
                "contextual_keypad_set_subevent");
        }
    }
}
