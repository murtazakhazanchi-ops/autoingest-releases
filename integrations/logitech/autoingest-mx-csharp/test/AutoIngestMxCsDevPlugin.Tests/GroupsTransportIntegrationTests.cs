namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System;
    using System.Linq;
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;
    using Xunit;

    /// <summary>
    /// AI-FEAT MX Console Phase 4C (revised) brief §25A — real end-to-end
    /// transport test for the GROUPS workspace. Uses the real
    /// AutoIngestClient against MockAutoIngestServer's real WebSocket/JSON
    /// path, same pattern every other Phase 4B/4C transport test uses.
    /// </summary>
    public class GroupsTransportIntegrationTests : IAsyncLifetime
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
            var current = new ClientSnapshot(client.GetConnectionState(), client.GetLatestState());
            if (predicate(current)) { tcs.TrySetResult(current); }
            try { return await tcs.Task.WaitAsync(timeout ?? TimeSpan.FromSeconds(10)).ConfigureAwait(false); }
            finally { sub.Dispose(); }
        }

        private static object BrowseState(string[] availableCommands, object[] groups) => new
        {
            context = "browse",
            activeFile = (string)null,
            selectedCount = 1,
            hasSelection = true,
            previewOpen = false,
            availableCommands,
            groups,
        };

        [Fact]
        public async Task PressingAnExistingG4_SendsRealGroupAssignAndReflectsTheResultingState()
        {
            await using var server = new MockAutoIngestServer();
            server.InitialState = BrowseState(
                new[] { "group.assign", "group.unassign" },
                new object[]
                {
                    new { id = 1, label = "G1", fileCount = 2, subEventId = (string)null, colorIndex = 0 },
                    new { id = 4, label = "G4", fileCount = 1, subEventId = (string)null, colorIndex = 3 },
                });
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server);

            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected && s.State != null);

                var initial = client.GetLatestState();
                var specs = GroupsWorkspaceModel.BuildButtonSpecs(initial.Groups, initial.AvailableCommands);
                Assert.Equal(2, specs.Count); // G4, + New Group
                var g4Spec = specs.Single(s => s.Kind == GroupsButtonKind.ExistingGroup);
                Assert.Equal("4", g4Spec.ActionParameter);
                Assert.Equal(1, g4Spec.FileCount);

                server.ReplyBuilder = commandId => new { ok = true, commandId, executed = true };
                var result = await client.ExecuteCommandAsync("group.assign", new { groupId = 4 });
                Assert.True(result.Ok);

                var received = server.ReceivedCommands.Last();
                Assert.Equal("group.assign", received.CommandId);
                Assert.Equal(4, received.Payload.GetProperty("groupId").GetInt32());

                // AutoIngest pushes the real resulting state — G4 now has 2 files.
                var pushAfterAssign = WaitForState(client, s => s.State?.Groups?.FirstOrDefault(g => g.Id == 4)?.FileCount == 2);
                await server.PushStateAsync(BrowseState(
                    new[] { "group.assign", "group.unassign" },
                    new object[]
                    {
                        new { id = 1, label = "G1", fileCount = 1, subEventId = (string)null, colorIndex = 0 },
                        new { id = 4, label = "G4", fileCount = 2, subEventId = (string)null, colorIndex = 3 },
                    }));
                var afterAssign = await pushAfterAssign;
                var specsAfter = GroupsWorkspaceModel.BuildButtonSpecs(afterAssign.State.Groups, afterAssign.State.AvailableCommands);
                Assert.Equal(2, specsAfter.Single(s => s.ActionParameter == "4").FileCount);
            }
            finally { await client.DisconnectAsync(); }
        }

        [Fact]
        public async Task PressingNewGroup_SendsGroupAssignWithNoGroupId_NeverInventsItsOwnNumbering()
        {
            await using var server = new MockAutoIngestServer();
            server.InitialState = BrowseState(
                new[] { "group.assign", "group.unassign" },
                new object[] { new { id = 1, label = "G1", fileCount = 1, subEventId = (string)null, colorIndex = 0 } });
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server);

            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected && s.State != null);

                var specs = GroupsWorkspaceModel.BuildButtonSpecs(client.GetLatestState().Groups, client.GetLatestState().AvailableCommands);
                Assert.Contains(specs, s => s.Kind == GroupsButtonKind.NewGroup);

                server.ReplyBuilder = commandId => new { ok = true, commandId, executed = true };
                // Mirrors GroupsFolder.HandlePressAsync's own real dispatch for
                // the NewGroup sentinel — no payload at all.
                var result = await client.ExecuteCommandAsync("group.assign");
                Assert.True(result.Ok);
                var received = server.ReceivedCommands.Last();
                Assert.True(
                    received.Payload.ValueKind == System.Text.Json.JsonValueKind.Null
                    || received.Payload.ValueKind == System.Text.Json.JsonValueKind.Undefined,
                    $"expected no groupId payload for a new-group press, got {received.Payload}");
            }
            finally { await client.DisconnectAsync(); }
        }
    }
}
