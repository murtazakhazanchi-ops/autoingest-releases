namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;

    /// <summary>
    /// AI-FEAT MX Console Phase 4C (revised) — the GROUPS dynamic workspace:
    /// access to groups beyond the fixed G1/G2/G3 keys. Same three-layer
    /// split and every Phase 4B/4C physical-closure lesson applied from the
    /// start (never calls Close(); Unavailable is a retry lever; only a
    /// real list-membership change redraws; every mutating press re-
    /// resolves fresh state) — see RefineTagsFolder.cs's own doc comment for
    /// the full physical-testing history these rules come from.
    ///
    /// Decision (brief §8): stays OPEN after a successful assignment, not
    /// auto-closed. Calling Close() reactively from a background callback is
    /// the exact zombie-session risk Phase 4B physical testing confirmed —
    /// never repeated here. Whether staying open "feels right" for a quick-
    /// assignment workflow is for physical testing to confirm, not assumed;
    /// the operator uses the real hardware Back button either way.
    /// </summary>
    public class GroupsFolder : PluginDynamicFolder
    {
        private IDisposable _stateSubscription;
        private Dictionary<string, GroupsButtonSpec> _lastSpecsByParam = new();
        private volatile bool _isActive;

        public GroupsFolder()
        {
            this.DisplayName = "Groups";
            this.GroupName = "Browse";
        }

        public override string GetButtonDisplayName(PluginImageSize imageSize) => "Groups";

        public override PluginDynamicFolderNavigation GetNavigationArea(DeviceType deviceType) =>
            PluginDynamicFolderNavigation.ButtonArea;

        public override bool Load() => true;

        public override bool Unload() => true;

        public override bool Activate()
        {
            this._isActive = true;
            this._stateSubscription?.Dispose();
            this._stateSubscription = SharedClient.Instance.Subscribe(this.OnStateChanged);
            this.RefreshButtonList();
            return true;
        }

        public override bool Deactivate()
        {
            this._isActive = false;
            this._stateSubscription?.Dispose();
            this._stateSubscription = null;
            this._lastSpecsByParam = new Dictionary<string, GroupsButtonSpec>();
            return true;
        }

        private void OnStateChanged(ClientSnapshot snapshot)
        {
            if (!this._isActive) { return; }
            var state = snapshot.ConnectionState == ConnectionState.Connected ? snapshot.State : null;
            ActionRunner.FireAndForget(() => { this.RefreshButtonListFrom(state); return Task.CompletedTask; }, "groups_folder_state_changed");
        }

        private void RefreshButtonList() => this.RefreshButtonListFrom(SharedClient.Instance.GetLatestState());

        private void RefreshButtonListFrom(AutoIngestState state)
        {
            var specs = GroupsWorkspaceModel.BuildButtonSpecs(state?.Groups, state?.AvailableCommands);
            var newByParam = specs.ToDictionary(s => s.ActionParameter);
            var oldByParam = this._lastSpecsByParam;
            var listChanged = oldByParam.Count != newByParam.Count || !oldByParam.Keys.All(newByParam.ContainsKey);
            // A same-list change (e.g. an existing group's file count ticking
            // up) is a no-op here too — same confirmed pagination-safety
            // trade-off as every other Phase 4B/4C workspace (see
            // RefineTagsFolder.cs's own "List refresh" doc comment).
            if (!listChanged) { return; }
            this._lastSpecsByParam = newByParam;
            this.ButtonActionNamesChanged();
        }

        public override IEnumerable<string> GetButtonPressActionNames(DeviceType deviceType) =>
            this._lastSpecsByParam.Keys.Select(this.CreateCommandName);

        public override string GetCommandDisplayName(string actionParameter, PluginImageSize imageSize) =>
            this._lastSpecsByParam.TryGetValue(actionParameter, out var spec) ? spec.Label : actionParameter;

        public override BitmapImage GetCommandImage(string actionParameter, PluginImageSize imageSize)
        {
            var found = this._lastSpecsByParam.TryGetValue(actionParameter, out var spec);
            return found ? GroupsButtonImageRenderer.Render(spec, imageSize) : null;
        }

        public override void RunCommand(string actionParameter) =>
            ActionRunner.FireAndForget(() => this.HandlePressAsync(actionParameter), "groups_folder_press");

        private Task HandlePressAsync(string actionParameter)
        {
            if (actionParameter == GroupsWorkspaceModel.UnavailableActionParameter)
            {
                this.RefreshButtonList();
                return Task.CompletedTask;
            }

            if (actionParameter == GroupsWorkspaceModel.NewGroupActionParameter)
            {
                // No groupId at all — GroupManager.assignFiles' own real
                // fallback (existing ? existing.id : GroupManager.createGroup())
                // is what actually creates the brand-new sequential group;
                // this plugin never invents its own numbering.
                return GatedCommand.RunAsync("group.assign", "groups_folder_new_group");
            }

            // An existing group press — re-resolve fresh against the LATEST
            // state, never the cached spec (same "never trust a stale cache
            // for a mutating action" rule every other press in this plugin
            // already follows). A group that disappeared between redraw and
            // press (e.g. emptied and auto-removed elsewhere) is rejected
            // safely by AutoIngest's own group.assign, not guessed at here.
            if (!int.TryParse(actionParameter, out var groupId))
            {
                PluginLog.Verbose($"[autoingest-mx-cs] groups_folder: unparseable actionParameter \"{actionParameter}\" — ignored");
                return Task.CompletedTask;
            }

            return GatedCommand.RunAsync("group.assign", "groups_folder_assign", payload: new { groupId });
        }
    }
}
