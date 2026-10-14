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
    ///
    /// Never calls Close() on itself. An earlier revision did, reactively,
    /// from the background state-subscription callback whenever refinement
    /// became unavailable — physical testing found this produced a real
    /// zombie-session bug: repeated, apparently-ineffective Close() calls
    /// while the device kept routing presses to the same stale instance,
    /// and the physical REFINE TAGS key then appeared not to open anything
    /// on the next press. See RefinementWorkspaceModel.BuildButtonSpecs'
    /// own doc comment: when refinement isn't active, it now returns a
    /// single informational "Unavailable" button instead of an empty list,
    /// and the operator exits via the real hardware Back button.
    /// </summary>
    public class RefineTagsFolder : PluginDynamicFolder
    {
        // How long Activate()'s own open attempt waits for AutoIngest's
        // tagRefinement.open push before giving up — generous for a local WS
        // round trip. On timeout, this simply stays on the "Unavailable"
        // rendering (see RefinementWorkspaceModel.BuildButtonSpecs) rather
        // than attempting to self-close — see that method's own doc comment
        // for why a reactive Close() was removed after physical testing.
        private static readonly TimeSpan OpenWaitTimeout = TimeSpan.FromSeconds(4);

        private IDisposable _stateSubscription;
        // Keyed by ActionParameter — the one place this class remembers what
        // it last told the host about, purely to compute a minimal diff
        // (full list refresh vs. single-image refresh, brief §16/§17). Never
        // consulted for validation — RunCommand always re-resolves against
        // SharedClient.Instance.GetLatestState() fresh, never this cache.
        private Dictionary<string, RefinementButtonSpec> _lastSpecsByParam = new();

        // Found during physical testing: a background state-subscription
        // callback (OnStateChanged) must never act — especially never call
        // back into the SDK — once this instance no longer believes itself
        // to be the active, on-device folder. Set true only inside
        // Activate(), set false as the very first thing Deactivate() does.
        private volatile bool _isActive;

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
            this._isActive = true;
            this.SubscribeToStateChanges();
            ActionRunner.FireAndForget(this.EnsureOpenAndPopulateAsync, "refine_tags_folder_activate");
            return true;
        }

        public override bool Deactivate()
        {
            this._isActive = false; // first — see the field's own doc comment
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
                if (!this._isActive) { return; } // Deactivate() already fired while we were waiting — do nothing
                if (!opened)
                {
                    // No refinable selection within the timeout — leave the
                    // "Unavailable" rendering in place (RefreshButtonList
                    // below already shows it; nothing further to do). Does
                    // NOT call Close() — see RefinementWorkspaceModel
                    // .BuildButtonSpecs' doc comment for why a reactive
                    // self-close was removed after physical testing.
                    PluginLog.Info("[autoingest-mx-cs] refine_tags_folder: no refinable selection — showing unavailable");
                }
            }
            if (!this._isActive) { return; }
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
            if (!this._isActive)
            {
                // See the field's own doc comment — a stray callback that
                // outlives (or precedes) this instance's real active window
                // must be a pure no-op, never call back into the SDK.
                return;
            }

            // Brief §18/§20: offline/disconnected, or refinement no longer
            // active (selection/scope changed underneath the open folder,
            // Change Event, AutoIngest unavailable) — in every case,
            // RefreshButtonList below renders the "Unavailable" state
            // (RefinementWorkspaceModel.BuildButtonSpecs returns it for a
            // null/inactive tagRefinement) rather than self-closing. See
            // that method's own doc comment: a reactive Close() from this
            // background callback produced a real zombie-session bug during
            // physical testing (repeated ineffective Close() calls while the
            // device kept routing presses to the same stale instance) — the
            // operator uses the real hardware Back button to exit instead.
            var state = snapshot.ConnectionState == ConnectionState.Connected ? snapshot.State : null;

            // AutoIngestClient.Subscribe()'s callback runs SYNCHRONOUSLY,
            // inline, on whatever thread the WebSocket receive loop is on —
            // a different execution context than EnsureOpenAndPopulateAsync's
            // Task.Run (via ActionRunner.FireAndForget), which is the only
            // path confirmed by physical testing to make the SDK's own
            // ButtonActionNamesChanged() notification actually take visible
            // effect. Dispatching through the exact same proven path here
            // too, rather than calling back into the SDK directly from the
            // WS thread — found live: tag ticks never updated on a same-
            // session selection change (this method's own direct call) until
            // routed through this same mechanism.
            ActionRunner.FireAndForget(() => { this.RefreshButtonListFrom(state); return Task.CompletedTask; }, "refine_tags_folder_state_changed");
        }

        /// <summary>Fetches the latest state itself — for the call site that
        /// has no snapshot already in hand (EnsureOpenAndPopulateAsync).</summary>
        private void RefreshButtonList() => this.RefreshButtonListFrom(SharedClient.Instance.GetLatestState());

        /// <summary>Uses EXACTLY the given state, including a genuine `null`
        /// (disconnected) — never falls back to GetLatestState(), so a caller
        /// that already resolved "disconnected" can't have that signal
        /// silently overwritten by a possibly-stale re-fetch.</summary>
        private void RefreshButtonListFrom(AutoIngestState state)
        {
            var specs = RefinementWorkspaceModel.BuildButtonSpecs(state?.TagRefinement, state?.AvailableCommands);
            var newByParam = specs.ToDictionary(s => s.ActionParameter);
            var oldByParam = this._lastSpecsByParam;

            var listChanged = oldByParam.Count != newByParam.Count || !oldByParam.Keys.All(newByParam.ContainsKey);

            // Confirmed from physical diagnostic logging across three
            // separate attempts: CommandImageChanged() does not cause ANY
            // GetCommandImage requery in this installed SDK (v6.4.2.3414).
            // An earlier revision worked around this for a same-list,
            // state-only change (e.g. a tag's checked state flipping) by
            // forcing the list to "change" twice via ButtonActionNamesChanged()
            // (drop to empty, notify, restore, notify again) so every name
            // looked "new" and got a real image requery. Physical pagination
            // testing (brief §13) found that trick has a confirmed, 100%-
            // reproducible cost worse than the problem it solved: ANY tag
            // press on page 2+ of a multi-page scope snapped the device back
            // to page 1, making multi-page refinement unusable — while the
            // live-redraw benefit it bought was already only inconsistent/
            // racy (see the RefinementButtonImageRenderer/GetCommandImage
            // diagnostic history). Confirmed with the user as the deliberate
            // trade-off (brief §24): never fight pagination to chase a
            // partially-working redraw. So a state-only change is now a
            // genuine no-op here — only a real list-membership change
            // (listChanged) ever calls ButtonActionNamesChanged(). The
            // operator sees a tag's current state correctly on every fresh
            // Activate()/list-changing redraw; it just does not flip live
            // in place while the same list stays on screen.
            if (!listChanged) { return; }

            this._lastSpecsByParam = newByParam;
            this.ButtonActionNamesChanged();
        }

        // ── Folder content (brief §6/§15) ───────────────────────────────────

        // The base class's parameterless overload is [Obsolete] (confirmed by
        // the compiler) — only the DeviceType-aware overload is overridden;
        // this plugin has no per-device button-set differentiation to make.
        public override IEnumerable<string> GetButtonPressActionNames(DeviceType deviceType) =>
            this._lastSpecsByParam.Keys.Select(this.CreateCommandName);

        public override string GetCommandDisplayName(string actionParameter, PluginImageSize imageSize) =>
            this._lastSpecsByParam.TryGetValue(actionParameter, out var spec) ? spec.Label : actionParameter;

        public override BitmapImage GetCommandImage(string actionParameter, PluginImageSize imageSize)
        {
            var found = this._lastSpecsByParam.TryGetValue(actionParameter, out var spec);
            return found ? RefinementButtonImageRenderer.Render(spec, imageSize) : null;
        }

        // ── Press handling (brief §9/§10/§11/§12/§13) ──────────────────────

        public override void RunCommand(string actionParameter) =>
            ActionRunner.FireAndForget(() => this.HandlePressAsync(actionParameter), "refine_tags_folder_press");

        private Task HandlePressAsync(string actionParameter)
        {
            if (actionParameter == RefinementWorkspaceModel.UnavailableActionParameter)
            {
                // Found during physical closure testing (brief §18/§22):
                // Activate() is not reliably called again by this SDK build
                // on a later re-entry to the same folder instance — confirmed
                // via diagnostic logging to fire exactly once for an entire
                // session, including across an AutoIngest quit/relaunch
                // cycle. Without this, a press that lands on "Unavailable"
                // for a reason that has since resolved (a file is now
                // selected, AutoIngest has reconnected) was a dead end — the
                // only recovery was restarting the Logi Plugin Service. This
                // lets the operator retry the open attempt in-band instead.
                ActionRunner.FireAndForget(this.EnsureOpenAndPopulateAsync, "refine_tags_folder_retry_from_unavailable");
                return Task.CompletedTask;
            }

            if (RefinementWorkspaceModel.IsControlAction(actionParameter))
            {
                var commandId = actionParameter switch
                {
                    RefinementWorkspaceModel.ApplyActionParameter => "tagRefinement.applyToSelected",
                    RefinementWorkspaceModel.AllTagsActionParameter => "tagRefinement.useAllTags",
                    RefinementWorkspaceModel.ResetTagsActionParameter => "tagRefinement.clearSelected",
                    // Added after physical testing — see BuildButtonSpecs' own
                    // doc comment on why these two exist at all: the exact
                    // same commands the static SelectCommand/ClearCommand
                    // actions already call, reused unmodified.
                    RefinementWorkspaceModel.SelectActionParameter => "selection.toggleCurrent",
                    RefinementWorkspaceModel.ClearSelectionActionParameter => "selection.clear",
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
