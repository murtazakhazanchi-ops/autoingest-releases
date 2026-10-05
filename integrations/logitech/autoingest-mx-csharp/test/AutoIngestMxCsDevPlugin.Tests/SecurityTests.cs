namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System;
    using System.Collections.Concurrent;
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;
    using Xunit;

    public class SecurityTests : IAsyncLifetime
    {
        private readonly string _home = TestFixtures.MakeTempHome();
        public Task InitializeAsync() => Task.CompletedTask;
        public Task DisposeAsync() { TestFixtures.Cleanup(this._home); return Task.CompletedTask; }

        [Fact]
        public async Task TokenIsNeverIncludedInAnyLoggedMessage()
        {
            await using var server = new MockAutoIngestServer();
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server);

            var loggedLines = new ConcurrentBag<string>();
            var client = new AutoIngestClient((level, message) => loggedLines.Add($"[{level}] {message}"), this._home);
            try
            {
                client.Connect();

                var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                using var sub = client.Subscribe(s => { if (s.ConnectionState == ConnectionState.Connected) tcs.TrySetResult(); });
                await tcs.Task.WaitAsync(TimeSpan.FromSeconds(10));

                // Exercise a full session: connect, authenticate, run a command,
                // get a state push, disconnect — the token must appear in NONE
                // of the resulting log lines.
                await client.ExecuteCommandAsync("navigation.nextFile");
                await server.PushStateAsync(new { context = "browse", activeFile = (string)null, selectedCount = 1, hasSelection = true, previewOpen = false, availableCommands = Array.Empty<string>() });
                await Task.Delay(200);
            }
            finally { await client.DisconnectAsync(); }

            Assert.DoesNotContain(loggedLines, line => line.Contains(server.Token, StringComparison.Ordinal));
        }

        [Fact]
        public async Task InvalidTokenAttempt_DoesNotLogTheAttemptedToken()
        {
            await using var server = new MockAutoIngestServer();
            server.Start();
            var descriptorPath = TestFixtures.WriteDescriptorForServer(this._home, server);
            const string fakeToken = "0000000000000000000000000000000000000000000000000000000000ff";
            System.IO.File.WriteAllText(descriptorPath, System.Text.Json.JsonSerializer.Serialize(new { port = server.Port, token = fakeToken, pid = Environment.ProcessId, protocolVersion = 1 }));

            var loggedLines = new ConcurrentBag<string>();
            var client = new AutoIngestClient((level, message) => loggedLines.Add(message), this._home);
            try
            {
                client.Connect();
                await Task.Delay(1500);
            }
            finally { await client.DisconnectAsync(); }

            Assert.DoesNotContain(loggedLines, line => line.Contains(fakeToken, StringComparison.Ordinal));
        }
    }
}
