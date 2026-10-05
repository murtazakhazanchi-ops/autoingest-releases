namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System;
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;
    using Xunit;

    public class ResilienceTests : IAsyncLifetime
    {
        private readonly string _home = TestFixtures.MakeTempHome();
        public Task InitializeAsync() => Task.CompletedTask;
        public Task DisposeAsync() { TestFixtures.Cleanup(this._home); return Task.CompletedTask; }

        private static async Task<ClientSnapshot> WaitForState(AutoIngestClient client, Func<ClientSnapshot, bool> predicate, TimeSpan? timeout = null)
        {
            var tcs = new TaskCompletionSource<ClientSnapshot>(TaskCreationOptions.RunContinuationsAsynchronously);
            using var sub = client.Subscribe(s => { if (predicate(s)) tcs.TrySetResult(s); });
            return await tcs.Task.WaitAsync(timeout ?? TimeSpan.FromSeconds(10)).ConfigureAwait(false);
        }

        [Fact]
        public async Task MalformedServerMessage_IsIgnored_ClientStaysConnected()
        {
            await using var server = new MockAutoIngestServer();
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server);
            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected);

                await server.SendRawAsync("{ this is not valid JSON at all ]]]");
                await Task.Delay(300); // give the (bad) frame a chance to be mishandled, if it were going to be

                Assert.Equal(ConnectionState.Connected, client.GetConnectionState());
                // And the connection genuinely still works afterward — not just "state unchanged by accident".
                var result = await client.ExecuteCommandAsync("navigation.nextFile");
                Assert.True(result.Ok);
            }
            finally { await client.DisconnectAsync(); }
        }

        [Fact]
        public async Task UnknownJsonFields_DoNotBreakStateDeserialization()
        {
            await using var server = new MockAutoIngestServer();
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server);
            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected);

                var pushTask = WaitForState(client, s => s.State?.SelectedCount == 42);
                // A future AutoIngest field ("futureFeatureFromV2") this client has
                // never heard of, alongside every known field.
                await server.PushStateAsync(new
                {
                    context = "browse",
                    activeFile = (string)null,
                    selectedCount = 42,
                    hasSelection = true,
                    previewOpen = false,
                    availableCommands = Array.Empty<string>(),
                    futureFeatureFromV2 = new { someNewThing = true, nested = new[] { 1, 2, 3 } },
                });
                var snapshot = await pushTask;

                Assert.Equal(42, snapshot.State.SelectedCount);
                Assert.True(snapshot.State.HasSelection);
            }
            finally { await client.DisconnectAsync(); }
        }

        [Fact]
        public async Task PluginShutdownWhileReconnecting_CompletesCleanlyWithoutHanging()
        {
            // No server at all — the client sits in a discover/backoff loop forever otherwise.
            var client = new AutoIngestClient(homeOverride: this._home);
            client.Connect();
            await Task.Delay(300); // let it reach the discovering/backoff state for real

            var disconnectTask = client.DisconnectAsync();
            var completed = await Task.WhenAny(disconnectTask, Task.Delay(TimeSpan.FromSeconds(8)));
            Assert.Same(disconnectTask, completed);
            Assert.Equal(ConnectionState.Disconnected, client.GetConnectionState());
        }

        [Fact]
        public async Task TransportLossDuringOutstandingCommand_ResolvesRatherThanHangingForever()
        {
            await using var server = new MockAutoIngestServer();
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server);
            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected);

                // The server receives the command but is told to suppress its
                // reply AND the connection is torn down before any reply could
                // arrive — the command must still resolve (not hang until the
                // 8s timeout, and definitely not forever).
                server.SuppressReplyFor.Add("selection.toggleCurrent");
                var commandTask = client.ExecuteCommandAsync("selection.toggleCurrent");
                await Task.Delay(200); // let the request actually reach the server first
                await server.CloseActiveConnectionAsync();

                var result = await commandTask.WaitAsync(TimeSpan.FromSeconds(9));
                Assert.False(result.Ok);
                Assert.Equal("not-connected", result.Reason);
            }
            finally { await client.DisconnectAsync(); }
        }
    }
}
