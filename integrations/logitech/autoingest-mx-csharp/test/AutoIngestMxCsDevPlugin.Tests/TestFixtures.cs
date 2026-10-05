namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System;
    using System.IO;
    using System.Text.Json;

    /// <summary>
    /// Isolated temp "home" directories for descriptor discovery tests — never
    /// touches a real user's Application Support folder. Mirrors the Node
    /// plugin's own test convention (test/descriptor.test.ts's synthetic
    /// isolated home seam).
    /// </summary>
    internal static class TestFixtures
    {
        public static string MakeTempHome()
        {
            var dir = Path.Combine(Path.GetTempPath(), "ai-cs-test-home-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            return dir;
        }

        /// <summary>Writes a real descriptor at the dev-name candidate path
        /// (&lt;home&gt;/Library/Application Support/auto-ingest/mx-control.json on
        /// macOS) a MockAutoIngestServer's own port/token, with the CURRENT
        /// process id as the pid (so IsProcessAlive genuinely returns true —
        /// no need to fake process liveness).</summary>
        public static string WriteDescriptorForServer(string homeDir, MockAutoIngestServer server, int? pidOverride = null, int? protocolVersionOverride = null)
        {
            var appDir = Path.Combine(homeDir, "Library", "Application Support", "auto-ingest");
            Directory.CreateDirectory(appDir);
            var path = Path.Combine(appDir, "mx-control.json");
            var json = JsonSerializer.Serialize(new
            {
                port = server.Port,
                token = server.Token,
                pid = pidOverride ?? Environment.ProcessId,
                protocolVersion = protocolVersionOverride ?? server.ProtocolVersion,
            });
            File.WriteAllText(path, json);
            return path;
        }

        public static string WriteRawDescriptor(string homeDir, string rawContent)
        {
            var appDir = Path.Combine(homeDir, "Library", "Application Support", "auto-ingest");
            Directory.CreateDirectory(appDir);
            var path = Path.Combine(appDir, "mx-control.json");
            File.WriteAllText(path, rawContent);
            return path;
        }

        public static void Cleanup(string homeDir)
        {
            try { Directory.Delete(homeDir, recursive: true); } catch { /* best effort */ }
        }
    }
}
