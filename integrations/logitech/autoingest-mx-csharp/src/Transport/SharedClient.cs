namespace Loupedeck.AutoIngestMxCsDevPlugin.Transport
{
    using Loupedeck.AutoIngestMxCsDevPlugin; // PluginLog lives in the parent namespace

    /// <summary>
    /// The single AutoIngestClient instance every action uses — C# port of
    /// sharedClient.ts. Logging conventions (see docs/mxLogitechCSharp.md
    /// "Logging"): concise, one line per event, never the token, never a full
    /// descriptor, never a continuous state snapshot dump. Routed through
    /// PluginLog (the generated plugin's own logging helper), matching the
    /// brief's "use Logitech's supported C# plugin logging facilities."
    /// </summary>
    public static class SharedClient
    {
        public static readonly AutoIngestClient Instance = new(LogToPluginLog);

        private static void LogToPluginLog(string level, string message)
        {
            var line = $"[autoingest-mx-cs] {message}";
            switch (level)
            {
                case "error": PluginLog.Error(line); break;
                case "warn": PluginLog.Warning(line); break;
                default: PluginLog.Info(line); break; // "info" and "debug" both go to the plugin's info log
            }
        }
    }
}
