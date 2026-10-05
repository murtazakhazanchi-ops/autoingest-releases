namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System;
    using System.Diagnostics;
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;
    using Xunit;

    public class DescriptorTests : IDisposable
    {
        private readonly string _home = TestFixtures.MakeTempHome();
        public void Dispose() => TestFixtures.Cleanup(this._home);

        [Fact]
        public async Task ValidDescriptor_IsDiscoveredAndParsedCorrectly()
        {
            await using var server = new MockAutoIngestServer();
            TestFixtures.WriteDescriptorForServer(this._home, server);

            var descriptor = DescriptorDiscovery.Discover(this._home);

            Assert.Equal(server.Port, descriptor.Port);
            Assert.Equal(server.Token, descriptor.Token);
            Assert.Equal(1, descriptor.ProtocolVersion);
            Assert.Equal(Environment.ProcessId, descriptor.Pid);
        }

        [Fact]
        public void InvalidJson_ThrowsInvalidJsonError()
        {
            TestFixtures.WriteRawDescriptor(this._home, "{ not valid json ]");

            var ex = Assert.Throws<DescriptorException>(() => DescriptorDiscovery.Discover(this._home));
            Assert.Equal(DescriptorErrorCode.InvalidJson, ex.Code);
        }

        [Theory]
        [InlineData("{}")] // every field missing
        [InlineData("{\"port\":49779}")] // missing token/pid/protocolVersion
        [InlineData("{\"port\":49779,\"token\":\"\",\"pid\":123,\"protocolVersion\":1}")] // empty token
        [InlineData("{\"port\":0,\"token\":\"abc\",\"pid\":123,\"protocolVersion\":1}")] // port out of range
        [InlineData("{\"port\":99999,\"token\":\"abc\",\"pid\":123,\"protocolVersion\":1}")] // port out of range (>65535)
        [InlineData("{\"port\":49779,\"token\":\"abc\",\"pid\":0,\"protocolVersion\":1}")] // pid must be positive
        public void MissingOrMalformedFields_ThrowsInvalidShapeError(string rawJson)
        {
            TestFixtures.WriteRawDescriptor(this._home, rawJson);

            var ex = Assert.Throws<DescriptorException>(() => DescriptorDiscovery.Discover(this._home));
            Assert.Equal(DescriptorErrorCode.InvalidShape, ex.Code);
        }

        [Fact]
        public async Task WrongProtocolVersion_StillParsesShapeCorrectly_RejectionHappensAtConnectTimeNotHere()
        {
            // The descriptor's own shape validation only checks protocolVersion
            // IS a number — a mismatch against this client's own expected
            // version (1) is a CONNECTION-time concern (the real transport's
            // own `ready` handshake), not a descriptor-validity concern. See
            // ConnectionTests.ProtocolMismatch_DisconnectsWithoutReportingConnected.
            await using var server = new MockAutoIngestServer { ProtocolVersion = 999 };
            TestFixtures.WriteDescriptorForServer(this._home, server, protocolVersionOverride: 999);

            var descriptor = DescriptorDiscovery.Discover(this._home);
            Assert.Equal(999, descriptor.ProtocolVersion);
        }

        [Fact]
        public async Task StalePid_ThrowsStalePidError()
        {
            // Find a pid that is genuinely not running: start and immediately
            // exit a trivial process, then use its (now-dead) pid.
            var deadPid = GetGuaranteedDeadPid();
            await using var server = new MockAutoIngestServer();
            TestFixtures.WriteDescriptorForServer(this._home, server, pidOverride: deadPid);

            var ex = Assert.Throws<DescriptorException>(() => DescriptorDiscovery.Discover(this._home));
            Assert.Equal(DescriptorErrorCode.StalePid, ex.Code);
        }

        [Fact]
        public void MissingDescriptorFile_ThrowsMissingError()
        {
            // No descriptor written at all for this fresh temp home.
            var ex = Assert.Throws<DescriptorException>(() => DescriptorDiscovery.Discover(this._home));
            Assert.Equal(DescriptorErrorCode.Missing, ex.Code);
        }

        [Fact]
        public void CandidateUserDataDirs_TriesDevNameBeforePackagedName()
        {
            var dirs = DescriptorDiscovery.CandidateUserDataDirs(this._home);
            Assert.Equal(2, dirs.Length);
            Assert.Contains("auto-ingest", dirs[0]);
            Assert.Contains("AutoIngest", dirs[1]);
        }

        [Fact]
        public async Task PackagedNameCandidate_IsFoundWhenDevNameAbsent()
        {
            await using var server = new MockAutoIngestServer();
            // Write directly to the PACKAGED candidate path, skipping the dev one.
            var appDir = System.IO.Path.Combine(this._home, "Library", "Application Support", "AutoIngest");
            System.IO.Directory.CreateDirectory(appDir);
            System.IO.File.WriteAllText(System.IO.Path.Combine(appDir, "mx-control.json"),
                System.Text.Json.JsonSerializer.Serialize(new { port = server.Port, token = server.Token, pid = Environment.ProcessId, protocolVersion = 1 }));

            var descriptor = DescriptorDiscovery.Discover(this._home);
            Assert.Equal(server.Port, descriptor.Port);
        }

        private static int GetGuaranteedDeadPid()
        {
            var psi = new ProcessStartInfo("true") { UseShellExecute = false, RedirectStandardOutput = true };
            using var proc = Process.Start(psi);
            proc.WaitForExit();
            return proc.Id;
        }
    }
}
