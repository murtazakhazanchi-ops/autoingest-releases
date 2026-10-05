namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;

    // This class contains the plugin-level logic of the Loupedeck plugin.

    public class AutoIngestMxCsDevPlugin : Plugin
    {
        // Gets a value indicating whether this is an API-only plugin.
        // Matches the Node plugin's architecture exactly: this plugin never
        // sends OS-level input to a specific target application — it talks
        // only to AutoIngest's own Phase 2 WebSocket transport.
        public override Boolean UsesApplicationApiOnly => true;

        // Gets a value indicating whether this is a Universal plugin or an Application plugin.
        // true: this plugin does not declare a native ClientApplication link
        // (see AutoIngestMxCsDevApplication.cs, unused) — AutoIngest's
        // foreground-profile switching is handled entirely by Logi Options+'s
        // own generic bundle-ID "Adapt to App" mechanism (Phase 3C), not by
        // this plugin declaring itself tied to one process/bundle.
        public override Boolean HasNoApplication => true;

        // Initializes a new instance of the plugin class.
        public AutoIngestMxCsDevPlugin()
        {
            // Initialize the plugin log.
            PluginLog.Init(this.Log);

            // Initialize the plugin resources.
            PluginResources.Init(this.Assembly);
        }

        // This method is called when the plugin is loaded. Starts the shared
        // AutoIngestClient's connect/reconnect loop — independent of the Logi
        // Plugin Service connection itself, exactly as the Node plugin's
        // index.ts does. Never blocks: Connect() kicks off a background Task
        // and returns immediately.
        public override void Load()
        {
            PluginLog.Info("[autoingest-mx-cs] plugin loaded");
            SharedClient.Instance.Connect();
        }

        // This method is called when the plugin is unloaded. Stops reconnect
        // attempts and closes any open connection cleanly — awaited (bounded)
        // so no background work survives the plugin host unloading this
        // assembly.
        public override void Unload()
        {
            SharedClient.Instance.DisconnectAsync().GetAwaiter().GetResult();
            PluginLog.Info("[autoingest-mx-cs] plugin unloaded");
        }
    }
}
