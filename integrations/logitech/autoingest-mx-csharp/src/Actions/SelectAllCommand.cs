namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;

    /// <summary>Select All — maps to selection.selectAll. C# parity port of
    /// selectAllAction.ts. Not context-gated (same reasoning as Select).</summary>
    public class SelectAllCommand : PluginDynamicCommand
    {
        public SelectAllCommand()
            : base(displayName: "Select All", description: "Selects every currently visible file in AutoIngest", groupName: "Browse")
        {
        }

        protected override void RunCommand(String actionParameter) =>
            ActionRunner.FireAndForget(() => GatedCommand.RunAsync("selection.selectAll", "select_all"), "select_all");
    }
}
