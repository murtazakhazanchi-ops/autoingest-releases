namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;

    /// <summary>G2 — see AssignG1Command's doc comment; identical mechanism,
    /// slot 2.</summary>
    public class AssignG2Command : PluginDynamicCommand
    {
        public AssignG2Command()
            : base(displayName: "G2", description: "Assigns the current selection to group G2 in AutoIngest", groupName: "Browse")
        {
        }

        protected override void RunCommand(String actionParameter) =>
            ActionRunner.FireAndForget(() => GroupSlotHelper.AssignToGroupSlotAsync(2), "assign_g2");
    }
}
