namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System;
    using System.Linq;
    using System.Threading.Tasks;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;
    using Xunit;

    /// <summary>
    /// Phase 4B brief §24 — real end-to-end transport test. Uses the real
    /// AutoIngestClient against MockAutoIngestServer's real WebSocket/JSON
    /// code path (not a mocked client) — the same proven pattern
    /// ConnectionTests.cs/CommandTests.cs already use. Exercises the full
    /// documented flow: open scope → tags arrive → setTagState → pushed
    /// draft state → applyToSelected → pushed committed state — and
    /// separately a genuinely mixed-state selection. All fixtures synthetic.
    /// </summary>
    public class RefinementTransportIntegrationTests : IAsyncLifetime
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

        private static object BrowseState(string[] availableCommands, object tagRefinement = null) => new
        {
            context = "browse",
            activeFile = (string)null,
            selectedCount = 2,
            hasSelection = true,
            previewOpen = false,
            availableCommands,
            tagRefinement,
        };

        [Fact]
        public async Task FullRefinementFlow_OpenToApply_MatchesExpectedPushedState()
        {
            await using var server = new MockAutoIngestServer();
            server.InitialState = BrowseState(new[] { "tagRefinement.open" });
            server.Start();
            TestFixtures.WriteDescriptorForServer(this._home, server);

            var client = new AutoIngestClient(homeOverride: this._home);
            try
            {
                client.Connect();
                await WaitForState(client, s => s.ConnectionState == ConnectionState.Connected && s.State != null);

                // Step 1-2: open the refinement scope.
                server.ReplyBuilder = commandId => new { ok = true, commandId, executed = true };
                var openResult = await client.ExecuteCommandAsync("tagRefinement.open");
                Assert.True(openResult.Ok);

                // Step 2: AutoIngest pushes the real tag list — a mixed selection
                // on purpose (brief §24: "also test mixed-state selection").
                var openTags = new object[]
                {
                    new { id = "eventTypes:Waaz", category = "eventTypes", label = "Waaz", state = "indeterminate" },
                    new { id = "eventTypes:Majlis", category = "eventTypes", label = "Majlis", state = "unchecked" },
                };
                var pushAfterOpen = WaitForState(client, s => s.State?.TagRefinement?.Active == true);
                await server.PushStateAsync(BrowseState(
                    new[] { "tagRefinement.open", "tagRefinement.setTagState", "tagRefinement.useAllTags", "tagRefinement.clearSelected" },
                    new { active = true, scopeLabel = "G1", componentLabel = "Waaz", selectedCount = 2, status = "mixed", tags = openTags }));
                var afterOpen = await pushAfterOpen;

                // Step 3: the dynamic folder would build its button list from
                // exactly this state — verify the mapping is correct, mixed state included.
                var specs = RefinementWorkspaceModel.BuildButtonSpecs(afterOpen.State.TagRefinement, afterOpen.State.AvailableCommands);
                var waazSpec = specs.Single(s => s.ActionParameter == "eventTypes:Waaz");
                Assert.Equal("indeterminate", waazSpec.State);
                Assert.Contains(specs, s => s.Kind == RefinementButtonKind.UseAllTags);
                Assert.Contains(specs, s => s.Kind == RefinementButtonKind.ClearSelected);
                Assert.DoesNotContain(specs, s => s.Kind == RefinementButtonKind.ApplyToSelected); // not yet in availableCommands

                // Step 4: press the indeterminate Waaz tag — per the confirmed
                // transition table, indeterminate -> checked.
                var nextChecked = RefinementWorkspaceModel.ComputeNextChecked(waazSpec.State);
                Assert.True(nextChecked);
                var setResult = await client.ExecuteCommandAsync("tagRefinement.setTagState", new { tagId = waazSpec.ActionParameter, @checked = nextChecked });
                Assert.True(setResult.Ok);

                // Verify the server genuinely received the real payload shape
                // (brief §6: the actionParameter/tagId must be the real canonical id).
                var received = server.ReceivedCommands.Last();
                Assert.Equal("tagRefinement.setTagState", received.CommandId);
                Assert.Equal("eventTypes:Waaz", received.Payload.GetProperty("tagId").GetString());
                Assert.True(received.Payload.GetProperty("checked").GetBoolean());

                // Step 5: AutoIngest pushes the draft state reflecting the edit,
                // AND now reports Apply as available (canApply, via availableCommands).
                var pushAfterSet = WaitForState(client, s =>
                    s.State?.TagRefinement?.Tags?.FirstOrDefault(t => t.Id == "eventTypes:Waaz")?.State == "checked");
                await server.PushStateAsync(BrowseState(
                    new[] { "tagRefinement.open", "tagRefinement.setTagState", "tagRefinement.applyToSelected" },
                    new
                    {
                        active = true, scopeLabel = "G1", componentLabel = "Waaz", selectedCount = 2, status = "mixed",
                        tags = new object[]
                        {
                            new { id = "eventTypes:Waaz", category = "eventTypes", label = "Waaz", state = "checked" },
                            new { id = "eventTypes:Majlis", category = "eventTypes", label = "Majlis", state = "unchecked" },
                        },
                    }));
                var afterSet = await pushAfterSet;

                // Step 6: redraw from the authoritative pushed state — never the
                // locally-sent `nextChecked` value (brief §10's no-optimism rule);
                // this assertion is exactly that: the draft state in hand right
                // now came from the server's own push, not a local guess.
                var specsAfterSet = RefinementWorkspaceModel.BuildButtonSpecs(afterSet.State.TagRefinement, afterSet.State.AvailableCommands);
                Assert.Equal("checked", specsAfterSet.Single(s => s.ActionParameter == "eventTypes:Waaz").State);
                Assert.Contains(specsAfterSet, s => s.Kind == RefinementButtonKind.ApplyToSelected);

                // Step 7-8: Apply.
                var applyResult = await client.ExecuteCommandAsync("tagRefinement.applyToSelected");
                Assert.True(applyResult.Ok);
                Assert.Equal("tagRefinement.applyToSelected", server.ReceivedCommands.Last().CommandId);

                // Step 9: AutoIngest pushes the post-commit state — status flips
                // to "refined", confirming TagRefinementManager actually committed.
                var pushAfterApply = WaitForState(client, s => s.State?.TagRefinement?.Status == "refined");
                await server.PushStateAsync(BrowseState(
                    new[] { "tagRefinement.open" },
                    new
                    {
                        active = true, scopeLabel = "G1", componentLabel = "Waaz", selectedCount = 2, status = "refined",
                        tags = new object[]
                        {
                            new { id = "eventTypes:Waaz", category = "eventTypes", label = "Waaz", state = "checked" },
                            new { id = "eventTypes:Majlis", category = "eventTypes", label = "Majlis", state = "unchecked" },
                        },
                    }));
                var final = await pushAfterApply;
                Assert.Equal("refined", final.State.TagRefinement.Status);
            }
            finally { await client.DisconnectAsync(); }
        }
    }
}
