namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System;
    using System.Threading;
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;
    using Xunit;

    public class ConnectionTests : IAsyncLifetime
    {
        private readonly string _home = TestFixtures.MakeTempHome();
        public Task InitializeAsync() => Task.CompletedTask;
        public Task DisposeAsync() { TestFixtures.Cleanup(this._home); return Task.CompletedTask; }

        private static async Task<ClientSnapshot> WaitForState(AutoIngestClient client, Func<ClientSnapshot, bool> predicate, TimeSpan? timeout = null)
        {
            var tcs = new TaskCompletionSource<ClientSnapshot>(TaskCreationOptions.RunContinuationsAsynchronously);
            IDisposable sub = null;
            sub = client.Subscribe(snapshot =>
            {
                if (predicate(snapshot)) tcs.TrySetResult(snapshot);
            });
            try
            {
                return await tcs.Task.WaitAsync(timeout ?? TimeSpan.FromSeconds(10)).ConfigureAwait(false);
            }
            finally
            {
                sub.Dispose();
            }
        }

        [Fact]
        public async Task SuccessfulAuthentication_ReachesConnectedWithRealInitialState()
        {
            await using var server = new MockAutoIngestServer();
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server);

            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                // "ready" (connectionState -> Connected) and the initial "state"
                // push are two SEPARATE messages, exactly like the real
                // transport (see docs/mxControlTransport.md's own "State flow" —
                // and the Node plugin's own documented "independent-message
                // race" finding) — wait for both, not just the first notification.
                var snapshot = await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected && s.State != null);

                Assert.Equal(ConnectionState.Connected, snapshot.ConnectionState);
                Assert.NotNull(snapshot.State);
                Assert.Equal("browse", snapshot.State.Context);
            }
            finally { await client.DisconnectAsync(); }
        }

        [Fact]
        public async Task InvalidCredentials_NeverReachesConnected()
        {
            await using var server = new MockAutoIngestServer();
            server.Start();
            // Write a descriptor with a DIFFERENT token than the server actually expects.
            var wrongDescriptorPath = TestFixtures.WriteDescriptorForServer(this._home, server);
            var json = System.Text.Json.JsonSerializer.Serialize(new { port = server.Port, token = "not-the-real-token-0000000000000000000000000000000000000000", pid = Environment.ProcessId, protocolVersion = 1 });
            System.IO.File.WriteAllText(wrongDescriptorPath, json);

            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                // Give it a real window to (wrongly) reach Connected, then assert it never did.
                await Task.Delay(1500);
                Assert.NotEqual(ConnectionState.Connected, client.GetConnectionState());
            }
            finally { await client.DisconnectAsync(); }
        }

        [Fact]
        public async Task StatePush_UpdatesGetLatestStateAndNotifiesSubscribers()
        {
            await using var server = new MockAutoIngestServer();
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server);

            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected);

                var pushTask = WaitForState(client, s => s.State?.SelectedCount == 7);
                await server.PushStateAsync(new { context = "browse", activeFile = (string)null, selectedCount = 7, hasSelection = true, previewOpen = false, availableCommands = Array.Empty<string>() });
                var snapshot = await pushTask;

                Assert.Equal(7, snapshot.State.SelectedCount);
                Assert.Equal(7, client.GetLatestState().SelectedCount);
            }
            finally { await client.DisconnectAsync(); }
        }

        [Fact]
        public async Task Disconnect_ClearsStateAndStopsReconnecting()
        {
            await using var server = new MockAutoIngestServer();
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server);

            var client = new AutoIngestClient(homeOverride: this._home);
            client.Connect();
            await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected);

            await client.DisconnectAsync();

            Assert.Equal(ConnectionState.Disconnected, client.GetConnectionState());
            Assert.Null(client.GetLatestState());

            // Give it a window where a buggy implementation might reconnect anyway.
            await Task.Delay(500);
            Assert.Equal(ConnectionState.Disconnected, client.GetConnectionState());
        }

        [Fact]
        public async Task ServerClosesConnection_ClientDetectsDisconnectAndReconnects()
        {
            await using var server = new MockAutoIngestServer();
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server);

            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected);

                var disconnectedTask = WaitForState(client, s => s.ConnectionState == ConnectionState.Disconnected);
                await server.CloseActiveConnectionAsync();
                await disconnectedTask;

                // The client should keep trying (it was never told to stop) —
                // reconnecting to the SAME still-running mock server succeeds again.
                var reconnectedTask = WaitForState(client, s => s.ConnectionState == ConnectionState.Connected, TimeSpan.FromSeconds(15));
                var reconnected = await reconnectedTask;
                Assert.Equal(ConnectionState.Connected, reconnected.ConnectionState);
            }
            finally { await client.DisconnectAsync(); }
        }

        [Fact]
        public async Task AutoIngestRestartWithNewPortAndToken_ClientRediscoversAndReconnects()
        {
            await using var server1 = new MockAutoIngestServer();
            server1.Start();
            var descriptorPath = TestFixtures.WriteDescriptorForServer(this._home, server1);

            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected);

                // "AutoIngest restarts": old server gone, descriptor removed, new
                // server with a genuinely different port/token, new descriptor
                // written — exactly what a real restart looks like on disk.
                var disconnectedTask = WaitForState(client, s => s.ConnectionState == ConnectionState.Disconnected);
                await server1.DisposeAsync();
                System.IO.File.Delete(descriptorPath);
                await disconnectedTask;

                await using var server2 = new MockAutoIngestServer();
                server2.Start();
                Assert.NotEqual(server1.Port, server2.Port);
                Assert.NotEqual(server1.Token, server2.Token);
                TestFixtures.WriteDescriptorForServer(this._home, server2);

                var reconnected = await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected, TimeSpan.FromSeconds(20));
                Assert.Equal(ConnectionState.Connected, reconnected.ConnectionState);
            }
            finally { await client.DisconnectAsync(); }
        }

        [Fact]
        public async Task ProtocolMismatch_NeverReportsConnected()
        {
            await using var server = new MockAutoIngestServer { ProtocolVersion = 999 };
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server, protocolVersionOverride: 999);

            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                await Task.Delay(1500);
                Assert.NotEqual(ConnectionState.Connected, client.GetConnectionState());
            }
            finally { await client.DisconnectAsync(); }
        }
    }
}
