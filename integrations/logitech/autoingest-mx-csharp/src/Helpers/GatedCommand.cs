namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;

    /// <summary>
    /// The shared "check availableCommands (and optionally context), then
    /// execute" pattern every simple parity action uses — ports the identical
    /// per-action gating logic the Node plugin repeats in each of its action
    /// files (toggleSelectionAction.ts, selectAllAction.ts, previewAction.ts,
    /// unassignGroupAction.ts, changeEventAction.ts, refineTagsAction.ts),
    /// factored into one place here rather than duplicated nine times. This
    /// is a UX convenience only — never reproduces canExecute()'s business
    /// rules locally; if GetLatestState() is null (renderer not ready yet)
    /// the gate falls through and lets AutoIngest itself decide.
    /// </summary>
    internal static class GatedCommand
    {
        /// <param name="commandId">The AutoIngest command to execute.</param>
        /// <param name="requiredContext">If non-null, the action is skipped
        /// unless state.Context equals this value exactly (mirrors
        /// unassign_group/assign_G{n}/change_event/refine_tags's own
        /// context-gating in the Node plugin). Null means "not context-gated"
        /// (select_all/clear_selection/preview_toggle's own behavior).</param>
        /// <param name="payload">Optional command payload (Phase 4B:
        /// tagRefinement.setTagState's {tagId, checked}). Forwarded to
        /// ExecuteCommandAsync completely opaquely — this helper never
        /// inspects or validates payload shape itself, same "opaque payload"
        /// rule the Node/renderer transport already follows.</param>
        public static async Task RunAsync(string commandId, string actionNameForLog, string requiredContext = null, object payload = null)
        {
            var state = SharedClient.Instance.GetLatestState();
            if (state != null && requiredContext != null && state.Context != requiredContext)
            {
                PluginLog.Verbose($"[autoingest-mx-cs] {actionNameForLog}: skipped — context is \"{state.Context}\", not \"{requiredContext}\"");
                return;
            }
            if (state != null && state.AvailableCommands != null && !state.AvailableCommands.Contains(commandId))
            {
                PluginLog.Verbose($"[autoingest-mx-cs] {actionNameForLog}: skipped — currently unavailable");
                return;
            }
            var result = await SharedClient.Instance.ExecuteCommandAsync(commandId, payload).ConfigureAwait(false);
            if (!result.Ok)
            {
                PluginLog.Verbose($"[autoingest-mx-cs] {actionNameForLog}: not executed ({result.Reason ?? "unknown"})");
            }
        }
    }
}
