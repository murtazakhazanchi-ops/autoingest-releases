namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;

    /// <summary>
    /// AI-FEAT MX Console Phase 4C — the real dynamic workspace for mapping
    /// an existing group to one of the active (multi-component) event's real
    /// sub-events/components. Built after Phase 4B closure found a genuine
    /// workflow gap: the console could assign files to G1/G2/G3
    /// (group.assign) but had no way to map a group to a component, so Tag
    /// Refinement correctly stayed unavailable until the operator used the
    /// computer. Same three-layer split Phase 4B established:
    /// GroupMappingWorkspaceModel (pure, unit-tested), GroupMappingButtonImageRenderer
    /// (the only file here touching BitmapBuilder/BitmapColor), this class
    /// (SDK lifecycle + AutoIngestClient subscription only).
    ///
    /// Every lesson physical Phase 4B closure testing found for
    /// RefineTagsFolder is applied here from the start, not rediscovered:
    /// never call Close() (see that class's own doc comment for the
    /// zombie-session bug this avoids); an "Unavailable" informational
    /// button instead of an empty list, with a press that forces a fresh
    /// recompute (this SDK does not reliably call Activate() again on a
    /// later re-entry to the same folder instance); only a real list-
    /// membership change calls ButtonActionNamesChanged() (a same-list
    /// IsCurrent/IsTaken flip is not live-redrawn in place — see
    /// RefineTagsFolder's own "List refresh" doc comment for why that
    /// trade-off was made); every mutating press re-resolves fresh against
    /// SharedClient.Instance.GetLatestState(), never a cached spec.
    ///
    /// Target-group resolution is NOT done here — AutoIngestState.TargetGroupIdForMapping
    /// is resolved authoritatively by the renderer (brief §15: no C#
    /// business-rule duplication) using the exact same "every selected file
    /// must resolve to the SAME group" rule tagRefinement.open's own group-
    /// scope resolution already uses.
    /// </summary>
    public class GroupMappingFolder : PluginDynamicFolder
    {
        private IDisposable _stateSubscription;
        private Dictionary<string, GroupMappingButtonSpec> _lastSpecsByParam = new();
        private volatile bool _isActive;

        public GroupMappingFolder()
        {
            this.DisplayName = "Map Group";
            this.GroupName = "Browse";
        }

        public override string GetButtonDisplayName(PluginImageSize imageSize) => "Map Group";

        public override PluginDynamicFolderNavigation GetNavigationArea(DeviceType deviceType) =>
            PluginDynamicFolderNavigation.ButtonArea;

        public override bool Load() => true;

        public override bool Unload() => true;

        public override bool Activate()
        {
            this._isActive = true;
            this._stateSubscription?.Dispose();
            this._stateSubscription = SharedClient.Instance.Subscribe(this.OnStateChanged);
            // No "open" step needed (unlike tagRefinement.open) — this
            // workspace only ever reads already-authoritative state, so it
            // populates immediately from whatever the latest snapshot is.
            this.RefreshButtonList();
            return true;
        }

        public override bool Deactivate()
        {
            this._isActive = false; // first — mirrors RefineTagsFolder's own field doc comment
            this._stateSubscription?.Dispose();
            this._stateSubscription = null;
            this._lastSpecsByParam = new Dictionary<string, GroupMappingButtonSpec>();
            return true;
        }

        private void OnStateChanged(ClientSnapshot snapshot)
        {
            if (!this._isActive) { return; }
            var state = snapshot.ConnectionState == ConnectionState.Connected ? snapshot.State : null;
            // Dispatched through ActionRunner.FireAndForget, not called
            // directly from the WS receive-loop thread — the same threading
            // fix RefineTagsFolder needed for ButtonActionNamesChanged() to
            // reliably take effect.
            ActionRunner.FireAndForget(() => { this.RefreshButtonListFrom(state); return Task.CompletedTask; }, "group_mapping_folder_state_changed");
        }

        private void RefreshButtonList() => this.RefreshButtonListFrom(SharedClient.Instance.GetLatestState());

        private void RefreshButtonListFrom(AutoIngestState state)
        {
            var specs = GroupMappingWorkspaceModel.BuildButtonSpecs(state?.AvailableSubEvents, state?.TargetGroupIdForMapping, state?.Groups);
            var newByParam = specs.ToDictionary(s => s.ActionParameter);
            var oldByParam = this._lastSpecsByParam;
            var listChanged = oldByParam.Count != newByParam.Count || !oldByParam.Keys.All(newByParam.ContainsKey);
            if (!listChanged) { return; }
            this._lastSpecsByParam = newByParam;
            this.ButtonActionNamesChanged();
        }

        public override IEnumerable<string> GetButtonPressActionNames(DeviceType deviceType) =>
            this._lastSpecsByParam.Keys.Select(this.CreateCommandName);

        public override string GetCommandDisplayName(string actionParameter, PluginImageSize imageSize) =>
            this._lastSpecsByParam.TryGetValue(actionParameter, out var spec)
                ? RefinementWorkspaceModel.TruncateForDisplay(spec.Label, ImageSizeHelper.GetWidthPixels(imageSize))
                : actionParameter;

        public override BitmapImage GetCommandImage(string actionParameter, PluginImageSize imageSize)
        {
            var found = this._lastSpecsByParam.TryGetValue(actionParameter, out var spec);
            return found ? GroupMappingButtonImageRenderer.Render(spec, imageSize) : null;
        }

        public override void RunCommand(string actionParameter) =>
            ActionRunner.FireAndForget(() => this.HandlePressAsync(actionParameter), "group_mapping_folder_press");

        private Task HandlePressAsync(string actionParameter)
        {
            if (actionParameter == GroupMappingWorkspaceModel.UnavailableActionParameter)
            {
                // Retry lever — same fix RefineTagsFolder's own Unavailable
                // button needed (brief §22/Phase 4B physical closure
                // finding): Activate() is not reliably re-invoked by this
                // SDK build on a later re-entry, so a press that lands on
                // Unavailable for a reason that has since resolved (a group
                // now exists, a selection now resolves unambiguously) needs
                // an in-band way to force a fresh recompute.
                this.RefreshButtonList();
                return Task.CompletedTask;
            }

            // A component press — re-resolve BOTH the target group id and
            // the real component fresh against the LATEST state, never the
            // cached button list (brief §7/§15: never guess, never trust a
            // stale cache for a mutating action).
            var latest = SharedClient.Instance.GetLatestState();
            var groupId = latest?.TargetGroupIdForMapping;
            if (groupId == null)
            {
                PluginLog.Verbose("[autoingest-mx-cs] group_mapping_folder: no resolved target group at press time — ignored");
                return Task.CompletedTask;
            }

            return GatedCommand.RunAsync(
                "group.setSubEvent",
                "group_mapping_folder_set_sub_event",
                payload: new { groupId = groupId.Value, subEventId = actionParameter });
            // Deliberately no optimistic local redraw here — the next state
            // push (handled by OnStateChanged above) is what triggers the
            // real redraw, from AutoIngest's own confirmed authoritative
            // state, including the real "clear refinements?" confirmation
            // outcome, never a locally-guessed one.
        }
    }
}
