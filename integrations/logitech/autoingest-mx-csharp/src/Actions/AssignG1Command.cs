namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;

    /// <summary>G1 — resolves the real group labeled "G1" via GroupSlotHelper
    /// and assigns the current selection to it. C# parity port of
    /// assignG1Action.ts.</summary>
    public class AssignG1Command : PluginDynamicCommand
    {
        public AssignG1Command()
            : base(displayName: "G1", description: "Assigns the current selection to group G1 in AutoIngest", groupName: "Browse")
        {
        }

        protected override void RunCommand(String actionParameter) =>
            ActionRunner.FireAndForget(() => GroupSlotHelper.AssignToGroupSlotAsync(1), "assign_g1");
    }
}
