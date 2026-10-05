namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;
    using System.Threading.Tasks;

    /// <summary>
    /// Fires an async action from a SYNCHRONOUS SDK callback (RunCommand(),
    /// ApplyAdjustment()) without ever blocking the calling thread — the
    /// threading concern the migration brief explicitly flags. Logitech's
    /// plugin host calls these callbacks synchronously; using .Result/.Wait()
    /// inside them to bridge to async AutoIngestClient calls risks deadlocking
    /// the host's own callback thread. Task.Run + observed exceptions is the
    /// safe async boundary instead — every exception is logged, never
    /// silently swallowed (the migration brief's "exceptions in background
    /// tasks are observed/logged").
    /// </summary>
    internal static class ActionRunner
    {
        public static void FireAndForget(Func<Task> work, string actionNameForLog)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await work().ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    PluginLog.Error(ex, $"[autoingest-mx-cs] {actionNameForLog}: unhandled exception");
                }
            });
        }
    }
}
