namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;

    /// <summary>Change Event — maps to event.openChooser. C# parity port of
    /// changeEventAction.ts. Opens AutoIngest's real event chooser/creator;
    /// the operator still picks the target event from the real on-screen
    /// list — this action never names a target event itself. Context-gated
    /// to "browse" (mirrors group.assign/unassign's own !isQmzOpen() gate —
    /// QMZ is a separate full-screen overlay this is already unreachable
    /// from).</summary>
    public class ChangeEventCommand : PluginDynamicCommand
    {
        public ChangeEventCommand()
            : base(displayName: "Change Event", description: "Opens the Change Event chooser in AutoIngest", groupName: "Browse")
        {
        }

        protected override void RunCommand(String actionParameter) =>
            ActionRunner.FireAndForget(() => GatedCommand.RunAsync("event.openChooser", "change_event", requiredContext: "browse"), "change_event");
    }
}
