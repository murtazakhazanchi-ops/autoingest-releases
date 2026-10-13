namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;

    /// <summary>
    /// Phase 4B — the real dynamic Tag Refinement workspace. A thin shell:
    /// every state/identity/transition decision lives in
    /// RefinementWorkspaceModel (pure, unit-tested); every pixel lives in
    /// RefinementButtonImageRenderer (Logitech-API-only). This class owns
    /// only SDK lifecycle wiring and the AutoIngestClient subscription — see
    /// docs/mxLogitechCSharp.md "Dynamic Tag Refinement workspace" for the
    /// full architecture writeup.
    ///
    /// Does NOT replace RefineTagsCommand.cs (the static action from Phase
    /// 4A) — that class is left exactly as-is, reference-compatible, per the
    /// brief. Only the physical REFINE TAGS key's Options+ mapping changes
    /// (a manual profile edit, done once physical testing begins), pointing
    /// the key at THIS folder's own entry action instead.
    /// </summary>
    public class RefineTagsFolder : PluginDynamicFolder
    {
        // How long Activate() waits for AutoIngest's own tagRefinement.open
        // push before giving up and closing safely (brief §5's "do not
        // fabricate an empty editor" case) — generous for a local WS round
        // trip, short enough the operator never wonders if the key did
        // anything.
        private static readonly TimeSpan OpenWaitTimeout = TimeSpan.FromSeconds(4);

        private IDisposable _stateSubscription;
        // Keyed by ActionParameter — the one place this class remembers what
        // it last told the host about, purely to compute a minimal diff
        // (full list refresh vs. single-image refresh, brief §16/§17). Never
        // consulted for validation — RunCommand always re-resolves against
        // SharedClient.Instance.GetLatestState() fresh, never this cache.
        private Dictionary<string, RefinementButtonSpec> _lastSpecsByParam = new();

        public RefineTagsFolder()
        {
            this.DisplayName = "Refine Tags";
            this.GroupName = "Browse";
        }

        public override string GetButtonDisplayName(PluginImageSize imageSize) => "Refine Tags";

        // Preferred first implementation per brief §14 — Logitech supplies the
        // Back button automatically on touch pages. Revisit only if physical
        // testing (brief §26) shows this costs too much usable button space on
        // the MX Creative Keypad. (The `Navigation` property setter used in an
        // earlier draft is obsolete in this SDK version — GetNavigationArea is
        // the supported mechanism.)
        public override PluginDynamicFolderNavigation GetNavigationArea(DeviceType deviceType) =>
            PluginDynamicFolderNavigation.ButtonArea;

        // ── Lifecycle (brief §3) ────────────────────────────────────────────

        public override bool Load() => true; // plugin-lifetime only — nothing to prepare

        public override bool Unload() => true;

        public override bool Activate()
        {
            this.SubscribeToStateChanges();
            ActionRunner.FireAndForget(this.EnsureOpenAndPopulateAsync, "refine_tags_folder_activate");
            return true;
        }

        public override bool Deactivate()
        {
            this._stateSubscription?.Dispose();
            this._stateSubscription = null;
            this._lastSpecsByParam = new Dictionary<string, RefinementButtonSpec>();
            // Deliberately does NOT call tagRefinement.close — brief §3: "do
            // not mutate AutoIngest refinement state merely because the
            // folder closes." Leaving the hardware workspace is not the same
            // action as the real panel's own "Done Refining" button; AutoIngest's
            // own refinement session (and the operator's unsaved draft) stays
            // exactly as it was, resumable from the real on-screen panel or by
            // re-entering this folder.
            return true;
        }

        private void SubscribeToStateChanges()
        {
            this._stateSubscription?.Dispose();
            this._stateSubscription = SharedClient.Instance.Subscribe(this.OnStateChanged);
        }

        private async Task EnsureOpenAndPopulateAsync()
        {
            var state = SharedClient.Instance.GetLatestState();
            if (state?.TagRefinement?.Active != true)
            {
                // Brief §5: ensure AutoIngest's own refinement mode is active
                // before populating anything — never assume stale cached state.
                await GatedCommand.RunAsync("tagRefinement.open", "refine_tags_folder_open").ConfigureAwait(false);
                var opened = await this.WaitForRefinementActiveAsync(OpenWaitTimeout).ConfigureAwait(false);
                if (!opened)
                {
                    PluginLog.Info("[autoingest-mx-cs] refine_tags_folder: no refinable selection — closing");
                    this.Close();
                    return;
                }
            }
            this.RefreshButtonList();
        }

        private Task<bool> WaitForRefinementActiveAsync(TimeSpan timeout)
        {
            var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            IDisposable sub = null;
            sub = SharedClient.Instance.Subscribe(snapshot =>
            {
                if (snapshot.ConnectionState != ConnectionState.Connected)
                {
                    tcs.TrySetResult(false);
                }
                else if (snapshot.State?.TagRefinement?.Active == true)
                {
                    tcs.TrySetResult(true);
                }
            });
            // Check synchronously too — Subscribe may or may not replay the
            // current snapshot immediately; this guards either behavior.
            var current = SharedClient.Instance.GetLatestState();
            if (current?.TagRefinement?.Active == true) { tcs.TrySetResult(true); }

            return tcs.Task.WaitAsync(timeout)
                .ContinueWith(t =>
                {
                    sub.Dispose();
                    return !t.IsFaulted && !t.IsCanceled && t.Result;
                }, TaskScheduler.Default);
        }

        // ── State → workspace (brief §16/§17/§18/§19/§20) ──────────────────

        private void OnStateChanged(ClientSnapshot snapshot)
        {
            if (snapshot.ConnectionState != ConnectionState.Connected || snapshot.State == null)
            {
                // Brief §20: AutoIngest offline/disconnected while the folder is
                // open — never pretend edits are valid, never crash. Closing is
                // the simplest safe behavior; on reconnect the operator can
                // re-enter and the folder re-reads fresh state from scratch.
                PluginLog.Info("[autoingest-mx-cs] refine_tags_folder: AutoIngest unavailable — closing");
                this.Close();
                return;
            }

            var tagRefinement = snapshot.State.TagRefinement;
            if (tagRefinement?.Active != true)
            {
                // Brief §18: selection/scope changed underneath the open
                // folder and refinement is no longer active at all (e.g. the
                // operator cleared selection, or Change Event moved things).
                // Close rather than show a stale/empty editor.
                PluginLog.Info("[autoingest-mx-cs] refine_tags_folder: refinement no longer active — closing");
                this.Close();
                return;
            }

            this.RefreshButtonList(snapshot.State);
        }

        private void RefreshButtonList(AutoIngestState state = null)
        {
            state ??= SharedClient.Instance.GetLatestState();
            var specs = RefinementWorkspaceModel.BuildButtonSpecs(state?.TagRefinement, state?.AvailableCommands);
            var newByParam = specs.ToDictionary(s => s.ActionParameter);
            var oldByParam = this._lastSpecsByParam;

            var listChanged = oldByParam.Count != newByParam.Count || !oldByParam.Keys.All(newByParam.ContainsKey);

            this._lastSpecsByParam = newByParam;

            if (listChanged)
            {
                // Brief §16: the action list itself changed (tags
                // appeared/disappeared/changed identity) — full refresh.
                this.ButtonActionNamesChanged();
                return;
            }

            // Brief §17: same buttons, only some states changed — redraw only
            // the ones whose rendered content actually differs, never the
            // whole list. Compared against the PRE-replacement snapshot
            // (captured above as oldByParam) — comparing against the already-
            // updated dictionary would trivially find no differences.
            foreach (var spec in specs)
            {
                if (oldByParam.TryGetValue(spec.ActionParameter, out var previous) && previous.State == spec.State)
                {
                    continue; // unchanged — no redraw needed for this button
                }
                this.CommandImageChanged(this.CreateCommandName(spec.ActionParameter));
            }
        }

        // ── Folder content (brief §6/§15) ───────────────────────────────────

        // The base class's parameterless overload is [Obsolete] (confirmed by
        // the compiler) — only the DeviceType-aware overload is overridden;
        // this plugin has no per-device button-set differentiation to make.
        public override IEnumerable<string> GetButtonPressActionNames(DeviceType deviceType) =>
            this._lastSpecsByParam.Keys.Select(this.CreateCommandName);

        public override string GetCommandDisplayName(string actionParameter, PluginImageSize imageSize) =>
            this._lastSpecsByParam.TryGetValue(actionParameter, out var spec) ? spec.Label : actionParameter;

        public override BitmapImage GetCommandImage(string actionParameter, PluginImageSize imageSize) =>
            this._lastSpecsByParam.TryGetValue(actionParameter, out var spec)
                ? RefinementButtonImageRenderer.Render(spec, imageSize)
                : null;

        // ── Press handling (brief §9/§10/§11/§12/§13) ──────────────────────

        public override void RunCommand(string actionParameter) =>
            ActionRunner.FireAndForget(() => this.HandlePressAsync(actionParameter), "refine_tags_folder_press");

        private Task HandlePressAsync(string actionParameter)
        {
            if (RefinementWorkspaceModel.IsControlAction(actionParameter))
            {
                var commandId = actionParameter switch
                {
                    RefinementWorkspaceModel.ApplyActionParameter => "tagRefinement.applyToSelected",
                    RefinementWorkspaceModel.AllTagsActionParameter => "tagRefinement.useAllTags",
                    RefinementWorkspaceModel.ResetTagsActionParameter => "tagRefinement.clearSelected",
                    _ => null,
                };
                return commandId == null
                    ? Task.CompletedTask
                    : GatedCommand.RunAsync(commandId, $"refine_tags_folder_{actionParameter}");
            }

            // A tag press — re-validate against the LATEST state fresh, never
            // the cached _lastSpecsByParam dictionary (brief §6/§18/§19: a
            // stale/unknown tag id must be rejected, never guessed at).
            var latest = SharedClient.Instance.GetLatestState();
            var tag = RefinementWorkspaceModel.ResolveTag(latest?.TagRefinement, actionParameter);
            if (tag == null)
            {
                PluginLog.Verbose($"[autoingest-mx-cs] refine_tags_folder: stale/unknown tag id \"{actionParameter}\" — ignored");
                return Task.CompletedTask;
            }

            var nextChecked = RefinementWorkspaceModel.ComputeNextChecked(tag.State);
            return GatedCommand.RunAsync(
                "tagRefinement.setTagState",
                "refine_tags_folder_set_tag_state",
                payload: new { tagId = tag.Id, @checked = nextChecked });
            // Deliberately no optimistic local redraw here (brief §10) — the
            // next state push (handled by OnStateChanged above) is what
            // triggers the real redraw, from AutoIngest's own confirmed
            // authoritative state, never a locally-guessed one.
        }
    }
}
