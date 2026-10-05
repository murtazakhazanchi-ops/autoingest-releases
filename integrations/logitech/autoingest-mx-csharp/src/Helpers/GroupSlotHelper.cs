namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;

    /// <summary>
    /// Resolves a keypad "G1"/"G2"/"G3" slot to AutoIngest's real group id, and
    /// issues the group.assign command through it. C# port of the Node
    /// plugin's src/groupSlotHelper.ts — same label-resolution semantics,
    /// same fallback behavior, same reasoning. Shared by the three thin
    /// AssignG{n}Command classes (see docs/mxLogitechCSharp.md "Group
    /// resolution parity" for why three actions exist instead of one
    /// configurable one — the C# SDK has no parameterized-action mechanism
    /// either, same constraint as the Node SDK).
    ///
    /// Label resolution, not a hardcoded id: a group's mutable display `id`
    /// and its `label` ("G{id}") are always kept in lockstep by AutoIngest's
    /// own GroupManager — resolving by label (from AutoIngest's own pushed
    /// state) rather than assuming a fixed id reads what AutoIngest actually
    /// reports rather than encoding that invariant into the plugin.
    ///
    /// If the labeled slot does not exist yet: this plugin does NOT invent
    /// new grouping semantics. AutoIngestCommands' existing group.assign
    /// already safely expresses "assign to this existing group, or
    /// create-and-assign the next sequential one" — the exact same behavior
    /// the real Cmd+G digit-chord already has. No new AutoIngest command was
    /// needed for this port, exactly as none was needed for the Node plugin.
    /// </summary>
    public static class GroupSlotHelper
    {
        /// <summary>Finds the real, current groupId for a "G&lt;n&gt;" label from
        /// AutoIngest's own pushed state. Returns null if no such group
        /// currently exists — the caller decides what to do (see
        /// AssignToGroupSlotAsync below).</summary>
        public static int? ResolveGroupIdByLabel(AutoIngestState state, string label)
        {
            if (state?.Groups == null) return null;
            foreach (var g in state.Groups)
            {
                if (g.Label == label) return g.Id;
            }
            return null;
        }

        /// <summary>
        /// Assigns the current selection to the group labeled "G&lt;slotNumber&gt;".
        /// Context-gated and availableCommands-gated as UX convenience only —
        /// never authoritative; AutoIngest's own check() still runs
        /// server-side regardless. If the slot doesn't currently exist, passes
        /// the slot number itself as groupId anyway: group.assign treats any
        /// nonexistent groupId identically to omitting it (both fall through
        /// to "create the next sequential group"). This is NOT guaranteed to
        /// create a group actually labeled G&lt;slotNumber&gt; if slots are
        /// filled out of order — existing, authoritative AutoIngest behavior
        /// (the same as the keyboard chord), not a plugin defect.
        /// </summary>
        public static async Task AssignToGroupSlotAsync(int slotNumber)
        {
            var label = $"G{slotNumber}";
            var state = SharedClient.Instance.GetLatestState();

            if (state != null && state.Context != "browse")
            {
                PluginLog.Verbose($"[autoingest-mx-cs] assign_{label}: skipped — context is \"{state.Context}\", not \"browse\"");
                return;
            }
            if (state != null && state.AvailableCommands != null && !state.AvailableCommands.Contains("group.assign"))
            {
                PluginLog.Verbose($"[autoingest-mx-cs] assign_{label}: skipped — group.assign currently unavailable");
                return;
            }

            var resolvedId = ResolveGroupIdByLabel(state, label);
            var targetGroupId = resolvedId ?? slotNumber;
            var result = await SharedClient.Instance.ExecuteCommandAsync("group.assign", new { groupId = targetGroupId }).ConfigureAwait(false);
            if (!result.Ok)
            {
                PluginLog.Verbose($"[autoingest-mx-cs] assign_{label}: not executed ({result.Reason ?? "unknown"})");
            }
        }
    }
}
