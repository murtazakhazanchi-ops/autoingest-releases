namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;

    /// <summary>G3 — see AssignG1Command's doc comment; identical mechanism,
    /// slot 3.</summary>
    public class AssignG3Command : PluginDynamicCommand
    {
        public AssignG3Command()
            : base(displayName: "G3", description: "Assigns the current selection to group G3 in AutoIngest", groupName: "Browse")
        {
        }

        protected override void RunCommand(String actionParameter) =>
            ActionRunner.FireAndForget(() => GroupSlotHelper.AssignToGroupSlotAsync(3), "assign_g3");
    }
}
