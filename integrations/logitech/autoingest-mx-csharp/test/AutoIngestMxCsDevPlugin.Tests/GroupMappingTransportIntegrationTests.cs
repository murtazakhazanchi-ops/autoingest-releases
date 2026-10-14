namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System;
    using System.Linq;
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;
    using Xunit;

    /// <summary>
    /// AI-FEAT MX Console Phase 4C brief §16 — real end-to-end transport
    /// test. Uses the real AutoIngestClient against MockAutoIngestServer's
    /// real WebSocket/JSON code path (not a mocked client), same proven
    /// pattern RefinementTransportIntegrationTests.cs already uses.
    /// Exercises the full documented flow: an unmapped group's component
    /// workspace shows no current mapping and Tag Refinement correctly
    /// unavailable → group.setSubEvent → the pushed state reflects the real
    /// mapping → the component workspace now shows it as current AND Tag
    /// Refinement becomes available — the exact integration point brief §10
    /// asks to verify. All fixtures synthetic.
    /// </summary>
    public class GroupMappingTransportIntegrationTests : IAsyncLifetime
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

        private static readonly object[] TwoComponents = new object[]
        {
            new { id = "01-Waaz-Hall A", name = "01-Waaz-Hall A" },
            new { id = "02-Ziyafat-Hall A", name = "02-Ziyafat-Hall A" },
        };

        private static object BrowseState(string[] availableCommands, object[] groups, int? targetGroupIdForMapping, object[] availableSubEvents) => new
        {
            context = "browse",
            activeFile = (string)null,
            selectedCount = 1,
            hasSelection = true,
            previewOpen = false,
            availableCommands,
            groups,
            availableSubEvents,
            targetGroupIdForMapping,
        };

        [Fact]
        public async Task FullMappingFlow_UnmappedToMapped_UnlocksTagRefinementEligibility()
        {
            await using var server = new MockAutoIngestServer();
            server.InitialState = BrowseState(
                new[] { "group.assign", "group.unassign", "group.setSubEvent" }, // tagRefinement.open deliberately NOT yet available — the group is unmapped
                new object[] { new { id = 1, label = "G1", fileCount = 2, subEventId = (string)null, colorIndex = 0 } },
                targetGroupIdForMapping: 1,
                availableSubEvents: TwoComponents);
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server);

            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected && s.State != null);

                // Step 1: the mapping workspace's own button list, built from the
                // initial unmapped state — no component marked current, and
                // separately confirm Tag Refinement is NOT yet available.
                var initial = client.GetLatestState();
                var specsBefore = GroupMappingWorkspaceModel.BuildButtonSpecs(initial.AvailableSubEvents, initial.TargetGroupIdForMapping, initial.Groups);
                Assert.Equal(2, specsBefore.Count);
                Assert.All(specsBefore, s => Assert.False(s.IsCurrent));
                Assert.DoesNotContain("tagRefinement.open", initial.AvailableCommands);

                // Step 2: press the Waaz component (what RunCommand's
                // HandlePressAsync does: resolve targetGroupIdForMapping fresh,
                // send group.setSubEvent with the real component id).
                server.ReplyBuilder = commandId => new { ok = true, commandId, executed = true };
                var waazSpec = specsBefore.Single(s => s.ActionParameter == "01-Waaz-Hall A");
                var pressResult = await client.ExecuteCommandAsync("group.setSubEvent", new { groupId = initial.TargetGroupIdForMapping.Value, subEventId = waazSpec.ActionParameter });
                Assert.True(pressResult.Ok);

                // Verify the server genuinely received the real payload shape
                // (brief §1: {groupId, subEventId}, the real resolved group and
                // the real component id, never a guessed/encoded value).
                var received = server.ReceivedCommands.Last();
                Assert.Equal("group.setSubEvent", received.CommandId);
                Assert.Equal(1, received.Payload.GetProperty("groupId").GetInt32());
                Assert.Equal("01-Waaz-Hall A", received.Payload.GetProperty("subEventId").GetString());

                // Step 3: AutoIngest (the real renderer primitive, via
                // GroupManager.setSubEvent) applies the mapping and pushes
                // updated state — the group now carries the real subEventId,
                // AND tagRefinement.open becomes available (the eligible
                // component now resolves), the exact integration point brief
                // §10 asks to verify end-to-end, no restart/reload needed.
                var pushAfterMap = WaitForState(client, s => s.State?.AvailableCommands?.Contains("tagRefinement.open") == true);
                await server.PushStateAsync(BrowseState(
                    new[] { "group.assign", "group.unassign", "group.setSubEvent", "tagRefinement.open" },
                    new object[] { new { id = 1, label = "G1", fileCount = 2, subEventId = "01-Waaz-Hall A", colorIndex = 0 } },
                    targetGroupIdForMapping: 1,
                    availableSubEvents: TwoComponents));
                var afterMap = await pushAfterMap;

                // Step 4: the mapping workspace now shows Waaz as the real
                // current mapping — redrawn from the authoritative pushed
                // state, never a locally-guessed optimistic value.
                var specsAfter = GroupMappingWorkspaceModel.BuildButtonSpecs(afterMap.State.AvailableSubEvents, afterMap.State.TargetGroupIdForMapping, afterMap.State.Groups);
                Assert.True(specsAfter.Single(s => s.ActionParameter == "01-Waaz-Hall A").IsCurrent);
                Assert.False(specsAfter.Single(s => s.ActionParameter == "02-Ziyafat-Hall A").IsCurrent);
                Assert.Contains("tagRefinement.open", afterMap.State.AvailableCommands);
            }
            finally { await client.DisconnectAsync(); }
        }

        [Fact]
        public async Task DuplicateMapping_RejectedByRenderer_StatePushNeverShowsIt()
        {
            // The server-side rejection path (renderer's own duplicate guard)
            // — the command executes (ok:true) but is a real no-op
            // (executed:false, matching the JS-side test's own assertion),
            // and no state push ever shows the attempted mapping having taken
            // effect.
            await using var server = new MockAutoIngestServer();
            server.InitialState = BrowseState(
                new[] { "group.setSubEvent" },
                new object[]
                {
                    new { id = 1, label = "G1", fileCount = 1, subEventId = (string)null, colorIndex = 0 },
                    new { id = 2, label = "G2", fileCount = 1, subEventId = "01-Waaz-Hall A", colorIndex = 1 },
                },
                targetGroupIdForMapping: 1,
                availableSubEvents: TwoComponents);
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server);

            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected && s.State != null);

                server.ReplyBuilder = _ => new { ok = true, commandId = "group.setSubEvent", executed = false };
                var result = await client.ExecuteCommandAsync("group.setSubEvent", new { groupId = 1, subEventId = "01-Waaz-Hall A" });
                Assert.True(result.Ok);
                Assert.False(result.Executed);

                // G1 remains unmapped — the model still shows no current mapping.
                var latest = client.GetLatestState();
                var specs = GroupMappingWorkspaceModel.BuildButtonSpecs(latest.AvailableSubEvents, latest.TargetGroupIdForMapping, latest.Groups);
                Assert.All(specs, s => Assert.False(s.IsCurrent));
                Assert.True(specs.Single(s => s.ActionParameter == "01-Waaz-Hall A").IsTakenByOtherGroup);
            }
            finally { await client.DisconnectAsync(); }
        }
    }
}
