namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;

    /// <summary>Unassign — maps to group.unassign. C# parity port of
    /// unassignGroupAction.ts. The Phase 1A/1B production side effects (Tag
    /// Refinement cleanup, group badge sync, Multi-Event Import claim
    /// behavior where applicable) all happen inside AutoIngest's own shared
    /// _unassignSelectionFromGroup() primitive this command already calls —
    /// nothing new is needed here, and this action never touches
    /// GroupManager directly. Context-gated to "browse" (GroupManager has no
    /// QMZ concept).</summary>
    public class UnassignCommand : PluginDynamicCommand
    {
        public UnassignCommand()
            : base(displayName: "Unassign", description: "Removes the current selection from its group in AutoIngest", groupName: "Browse")
        {
        }

        protected override void RunCommand(String actionParameter) =>
            ActionRunner.FireAndForget(() => GatedCommand.RunAsync("group.unassign", "unassign_group", requiredContext: "browse"), "unassign_group");
    }
}
