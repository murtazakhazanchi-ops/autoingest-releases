namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;

    /// <summary>Preview — maps to preview.toggle. C# parity port of
    /// previewAction.ts. Not context-gated.</summary>
    public class PreviewCommand : PluginDynamicCommand
    {
        public PreviewCommand()
            : base(displayName: "Preview", description: "Toggles the file preview overlay in AutoIngest", groupName: "Browse")
        {
        }

        protected override void RunCommand(String actionParameter) =>
            ActionRunner.FireAndForget(() => GatedCommand.RunAsync("preview.toggle", "preview_toggle"), "preview_toggle");
    }
}
