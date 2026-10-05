namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System;
    using System.Linq;
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;
    using Xunit;

    public class CommandTests : IAsyncLifetime
    {
        private readonly string _home = TestFixtures.MakeTempHome();
        private MockAutoIngestServer _server;
        private AutoIngestClient _client;

        public async Task InitializeAsync()
        {
            this._server = new MockAutoIngestServer();
            this._server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, this._server);
            this._client = new AutoIngestClient(homeOverride: this._home);
            this._client.Connect();
            await WaitForConnected(this._client);
        }

        public async Task DisposeAsync()
        {
            await this._client.DisconnectAsync();
            await this._server.DisposeAsync();
            TestFixtures.Cleanup(this._home);
        }

        private static async Task WaitForConnected(AutoIngestClient client)
        {
            var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            using var sub = client.Subscribe(s => { if (s.ConnectionState == ConnectionState.Connected) tcs.TrySetResult(); });
            await tcs.Task.WaitAsync(TimeSpan.FromSeconds(10));
        }

        [Fact]
        public async Task RequestIdCorrelation_EachCallGetsItsOwnMatchingResult()
        {
            var r1 = await this._client.ExecuteCommandAsync("navigation.nextFile");
            var r2 = await this._client.ExecuteCommandAsync("navigation.previousFile");

            Assert.Equal("navigation.nextFile", r1.CommandId);
            Assert.Equal("navigation.previousFile", r2.CommandId);
            Assert.Equal(2, this._server.ReceivedCommands.Count);
            Assert.NotEqual(this._server.ReceivedCommands[0].RequestId, this._server.ReceivedCommands[1].RequestId);
        }

        [Fact]
        public async Task ExecutedTrue_IsPreservedFromTheRealResult()
        {
            this._server.ReplyBuilder = cmd => new { ok = true, commandId = cmd, executed = true };
            var result = await this._client.ExecuteCommandAsync("selection.toggleCurrent");
            Assert.True(result.Ok);
            Assert.True(result.Executed);
        }

        [Fact]
        public async Task ExecutedFalse_IsPreservedFromTheRealResult_NotCollapsedToTruthy()
        {
            this._server.ReplyBuilder = cmd => new { ok = true, commandId = cmd, executed = false };
            var result = await this._client.ExecuteCommandAsync("navigation.nextFile");
            Assert.True(result.Ok);
            Assert.False(result.Executed);
        }

        [Fact]
        public async Task RejectedCommand_PreservesReason()
        {
            this._server.ReplyBuilder = cmd => new { ok = false, commandId = cmd, reason = "unknown-command" };
            var result = await this._client.ExecuteCommandAsync("__proto__");
            Assert.False(result.Ok);
            Assert.Equal("unknown-command", result.Reason);
        }

        [Fact]
        public async Task ConcurrentRequests_EachResolvesIndependently()
        {
            this._server.ReplyBuilder = cmd => new { ok = true, commandId = cmd, executed = true, detail = cmd };
            var tasks = Enumerable.Range(0, 20)
                .Select(i => this._client.ExecuteCommandAsync($"cmd-{i}"))
                .ToArray();
            var results = await Task.WhenAll(tasks);

            Assert.Equal(20, results.Length);
            Assert.All(results, r => Assert.True(r.Ok));
            Assert.Equal(20, this._server.ReceivedCommands.Select(c => c.RequestId).Distinct().Count());
        }

        [Fact]
        public async Task Timeout_ResolvesSafelyWithoutThrowing_WhenServerNeverReplies()
        {
            this._server.SuppressReplyFor.Add("navigation.nextFile");
            var result = await this._client.ExecuteCommandAsync("navigation.nextFile");
            Assert.False(result.Ok);
            Assert.Equal("plugin-timeout", result.Reason);
        }
    }
}
