namespace Loupedeck.AutoIngestMxCsDevPlugin.Transport
{
    using System;
    using System.IO;
    using System.Runtime.InteropServices;
    using System.Text.Json;

    /// <summary>
    /// Discovers and validates AutoIngest's Phase 2 control transport descriptor
    /// (&lt;userData&gt;/mx-control.json). Ported semantics-for-semantics from the
    /// proven Node plugin's src/descriptor.ts (integrations/logitech/autoingest-mx)
    /// — same candidate paths, same validation rules, same error taxonomy — not a
    /// different algorithm.
    ///
    /// Owns ONLY discovery/validation — never opens a socket, never assumes
    /// AutoIngest is running. Every failure mode is a typed <see cref="DescriptorError"/>
    /// so <see cref="AutoIngestClient"/> treats it as ordinary "AutoIngest
    /// unavailable", never a crash.
    ///
    /// userData folder name (same reasoning as the Node client's own comment):
    /// AutoIngest's Electron main process never calls app.setName(), so
    /// app.getPath('userData') resolves from app.getName(), which resolves from
    /// package.json's "name" ("auto-ingest") for a dev run, or electron-builder's
    /// "productName" ("AutoIngest") for a packaged build. Both are tried, dev
    /// first, on every platform — see candidateUserDataDirs below.
    /// </summary>
    public sealed record Descriptor(Int32 Port, String Token, Int32 Pid, Int32 ProtocolVersion);

    public enum DescriptorErrorCode
    {
        Missing,
        InvalidJson,
        InvalidShape,
        StalePid,
        Unreadable,
    }

    public sealed class DescriptorException : Exception
    {
        public DescriptorErrorCode Code { get; }

        public DescriptorException(DescriptorErrorCode code, String message) : base(message) => this.Code = code;
    }

    public static class DescriptorDiscovery
    {
        private const String AppNameDev = "auto-ingest"; // package.json "name" — unpackaged/dev run
        private const String AppNamePackaged = "AutoIngest"; // electron-builder "productName" — packaged build
        private const String DescriptorFileName = "mx-control.json";

        /// <summary>
        /// Candidate AutoIngest userData directories for the current OS, dev name
        /// first — exactly mirrors descriptor.ts's candidateUserDataDirs().
        /// </summary>
        /// <param name="homeOverride">Test-only seam — a fake home directory
        /// instead of the real user profile dir, so tests never touch real user
        /// settings.</param>
        public static String[] CandidateUserDataDirs(String homeOverride = null)
        {
            var names = new[] { AppNameDev, AppNamePackaged };

            if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
            {
                var home = homeOverride ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                return Array.ConvertAll(names, n => Path.Combine(home, "Library", "Application Support", n));
            }
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                var appData = homeOverride ?? Environment.GetEnvironmentVariable("APPDATA")
                    ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "AppData", "Roaming");
                return Array.ConvertAll(names, n => Path.Combine(appData, n));
            }
            // Linux is not an official SDK target per current Logitech docs (macOS
            // and Windows only) — kept so discovery never throws outright if ever
            // run there in dev, mirroring descriptor.ts's own fallback.
            var home2 = homeOverride ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var xdgConfig = Environment.GetEnvironmentVariable("XDG_CONFIG_HOME") ?? Path.Combine(home2, ".config");
            return Array.ConvertAll(names, n => Path.Combine(xdgConfig, n));
        }

        /// <summary>True if <paramref name="pid"/> refers to a currently-running
        /// process this user can see — mirrors descriptor.ts's isProcessAlive
        /// (process.kill(pid, 0) / EPERM-still-alive semantics) using .NET's own
        /// process table instead of a raw signal, since .NET has no direct kill(0)
        /// equivalent; behaviorally identical for the cases that matter (alive,
        /// exited, no permission).</summary>
        private static Boolean IsProcessAlive(Int32 pid)
        {
            try
            {
                using var proc = System.Diagnostics.Process.GetProcessById(pid);
                return !proc.HasExited;
            }
            catch (ArgumentException)
            {
                return false; // no process with this id
            }
            catch (System.ComponentModel.Win32Exception)
            {
                return true; // exists but we lack permission to query it — still alive, same as Node's EPERM branch
            }
            catch (InvalidOperationException)
            {
                return false; // already exited between GetProcessById and HasExited
            }
        }

        /// <summary>Validates the parsed JSON has exactly the shape Phase 2's
        /// transport writes — mirrors isValidDescriptorShape() exactly.</summary>
        public static Boolean IsValidShape(JsonElement root, out Descriptor descriptor)
        {
            descriptor = null;
            if (root.ValueKind != JsonValueKind.Object) return false;

            if (!root.TryGetProperty("port", out var portEl) || portEl.ValueKind != JsonValueKind.Number) return false;
            if (!portEl.TryGetInt32(out var port) || port <= 0 || port >= 65536) return false;

            if (!root.TryGetProperty("token", out var tokenEl) || tokenEl.ValueKind != JsonValueKind.String) return false;
            var token = tokenEl.GetString();
            if (String.IsNullOrEmpty(token)) return false;

            if (!root.TryGetProperty("pid", out var pidEl) || pidEl.ValueKind != JsonValueKind.Number) return false;
            if (!pidEl.TryGetInt32(out var pid) || pid <= 0) return false;

            if (!root.TryGetProperty("protocolVersion", out var protoEl) || protoEl.ValueKind != JsonValueKind.Number) return false;
            if (!protoEl.TryGetInt32(out var protocolVersion)) return false;

            descriptor = new Descriptor(port, token, pid, protocolVersion);
            return true;
        }

        /// <summary>Finds the first candidate descriptor path that actually
        /// exists on disk — mirrors findDescriptorPath().</summary>
        public static String FindDescriptorPath(String homeOverride = null)
        {
            foreach (var dir in CandidateUserDataDirs(homeOverride))
            {
                var candidate = Path.Combine(dir, DescriptorFileName);
                if (File.Exists(candidate)) return candidate;
            }
            return null;
        }

        /// <summary>Reads and validates a descriptor file at a known path. Throws
        /// <see cref="DescriptorException"/> (never a raw IO/JSON exception) for
        /// every failure mode — mirrors readDescriptor() exactly.</summary>
        public static Descriptor ReadDescriptor(String descriptorPath)
        {
            String raw;
            try
            {
                raw = File.ReadAllText(descriptorPath);
            }
            catch (FileNotFoundException)
            {
                throw new DescriptorException(DescriptorErrorCode.Missing, "Descriptor file does not exist");
            }
            catch (DirectoryNotFoundException)
            {
                throw new DescriptorException(DescriptorErrorCode.Missing, "Descriptor file does not exist");
            }
            catch (Exception ex)
            {
                throw new DescriptorException(DescriptorErrorCode.Unreadable, $"Cannot read descriptor: {ex.Message}");
            }

            JsonElement root;
            try
            {
                using var doc = JsonDocument.Parse(raw);
                root = doc.RootElement.Clone(); // Clone: safe to use after `doc` is disposed
            }
            catch (JsonException)
            {
                throw new DescriptorException(DescriptorErrorCode.InvalidJson, "Descriptor file is not valid JSON");
            }

            if (!IsValidShape(root, out var descriptor))
            {
                throw new DescriptorException(DescriptorErrorCode.InvalidShape, "Descriptor is missing required fields");
            }

            if (!IsProcessAlive(descriptor.Pid))
            {
                throw new DescriptorException(DescriptorErrorCode.StalePid, $"Descriptor pid {descriptor.Pid} is not a running process");
            }

            return descriptor;
        }

        /// <summary>Full discovery: find the descriptor across every candidate
        /// userData location, then read and validate it — the single entry point
        /// <see cref="AutoIngestClient"/> calls on every (re)connect attempt.
        /// Mirrors discoverDescriptor() exactly.</summary>
        public static Descriptor Discover(String homeOverride = null)
        {
            var path = FindDescriptorPath(homeOverride);
            if (path == null)
            {
                throw new DescriptorException(DescriptorErrorCode.Missing, "AutoIngest control descriptor not found — is AutoIngest running?");
            }
            return ReadDescriptor(path);
        }
    }
}
