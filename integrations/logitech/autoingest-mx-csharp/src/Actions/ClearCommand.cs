namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;

    /// <summary>Clear — maps to selection.clear. C# parity port of
    /// clearSelectionAction.ts. Not context-gated.</summary>
    public class ClearCommand : PluginDynamicCommand
    {
        public ClearCommand()
            : base(displayName: "Clear", description: "Clears the current selection in AutoIngest", groupName: "Browse")
        {
        }

        protected override void RunCommand(String actionParameter) =>
            ActionRunner.FireAndForget(() => GatedCommand.RunAsync("selection.clear", "clear_selection"), "clear_selection");
    }
}
