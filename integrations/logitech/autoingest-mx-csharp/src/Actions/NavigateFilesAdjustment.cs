namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;

    /// <summary>
    /// Navigate Files — main dial, a real PluginDynamicAdjustment (not a
    /// fake keyboard shortcut). C# parity port of the Node plugin's
    /// navigateFilesAction.ts. positive diff (clockwise) -&gt;
    /// navigation.nextFile; negative diff (counter-clockwise) -&gt;
    /// navigation.previousFile.
    ///
    /// Deliberately holds NO numeric "current file" position — the
    /// adjustment is relative. AutoIngest alone determines boundaries and
    /// returns whether the move actually happened; this plugin never
    /// guesses. GetAdjustmentValue() returns an empty string deliberately —
    /// there is no local counter to display (same "no plugin-local state"
    /// rule the Node action's own tests prove).
    ///
    /// One detent = one command, always — no acceleration, no batching. The
    /// C# SDK's ApplyAdjustment(diff) already gives the per-call tick count
    /// directly (unlike the Node SDK's event.tick, whose magnitude Phase 3A
    /// deliberately ignored) — diff's sign alone is still used, its
    /// magnitude ignored, for identical behavior regardless of how many
    /// ticks the host reports per callback.
    ///
    /// hasReset is left at its default (false) — Phase 3B's real hardware
    /// test found the physical MX Creative Console's main dial has no
    /// press/click mechanism at all, independent of SDK support (see
    /// docs/mxLogitechPlugin.md "Dial-press experiment"). Not re-tested here
    /// since it is a hardware fact, not an SDK-specific one.
    /// </summary>
    public class NavigateFilesAdjustment : PluginDynamicAdjustment
    {
        public NavigateFilesAdjustment()
            : base(displayName: "Navigate Files", description: "Moves the active file forward or backward in AutoIngest", groupName: "Browse", hasReset: false)
        {
        }

        protected override void ApplyAdjustment(String actionParameter, Int32 diff)
        {
            if (diff == 0) return;
            var commandId = diff > 0 ? "navigation.nextFile" : "navigation.previousFile";
            ActionRunner.FireAndForget(async () =>
            {
                var result = await SharedClient.Instance.ExecuteCommandAsync(commandId).ConfigureAwait(false);
                if (!result.Ok)
                {
                    PluginLog.Verbose($"[autoingest-mx-cs] navigate_files: {commandId} not executed ({result.Reason ?? "unknown"})");
                }
            }, "navigate_files");
        }

        protected override String GetAdjustmentValue(String actionParameter) => String.Empty;
    }
}
