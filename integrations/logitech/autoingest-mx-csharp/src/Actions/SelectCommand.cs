namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;

    /// <summary>Select — maps to selection.toggleCurrent. C# parity port of
    /// the Node plugin's toggleSelectionAction.ts. Not context-gated:
    /// selection is meaningful on whichever screen (browse/qmz) is active —
    /// AutoIngest's own check() governs real eligibility either way.</summary>
    public class SelectCommand : PluginDynamicCommand
    {
        public SelectCommand()
            : base(displayName: "Select", description: "Toggles selection on the active file in AutoIngest", groupName: "Browse")
        {
        }

        protected override void RunCommand(String actionParameter) =>
            ActionRunner.FireAndForget(() => GatedCommand.RunAsync("selection.toggleCurrent", "select"), "select");
    }
}
