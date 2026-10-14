namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System.Collections.Generic;
    using System.Linq;
    using System.Text.Json;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;
    using Xunit;

    /// <summary>
    /// AI-FEAT MX Console Phase 4C — tests for the pure, Logitech-free
    /// group→sub-event mapping model (GroupMappingWorkspaceModel). State
    /// fixtures are shaped exactly like AutoIngestState.cs's own
    /// GroupInfo/SubEventInfo (which mirror the real wire protocol) — never
    /// a hand-invented shape, same discipline RefinementWorkspaceModelTests
    /// established.
    /// </summary>
    public class GroupMappingWorkspaceModelTests
    {
        private static SubEventInfo Sub(string id, string name) => new() { Id = id, Name = name };

        private static GroupInfo Group(int id, string label, string subEventId) => new()
        {
            Id = id,
            Label = label,
            FileCount = 1,
            ColorIndex = id - 1,
            SubEventId = subEventId == null
                ? JsonSerializer.SerializeToElement((string)null)
                : JsonSerializer.SerializeToElement(subEventId),
        };

        private static readonly List<SubEventInfo> TwoComponents = new()
        {
            Sub("01-Waaz-Hall A", "Waaz — Hall A"),
            Sub("02-Ziyafat-Hall A", "Ziyafat — Hall A"),
        };

        // ── Unavailable cases ───────────────────────────────────────────────

        [Fact]
        public void BuildButtonSpecs_NoAvailableSubEvents_ReturnsSingleUnavailableEntry()
        {
            var specs = GroupMappingWorkspaceModel.BuildButtonSpecs(new List<SubEventInfo>(), targetGroupId: 1, groups: new List<GroupInfo> { Group(1, "G1", null) });
            var spec = Assert.Single(specs);
            Assert.Equal(GroupMappingButtonKind.Unavailable, spec.Kind);
            Assert.Equal(GroupMappingWorkspaceModel.UnavailableActionParameter, spec.ActionParameter);
        }

        [Fact]
        public void BuildButtonSpecs_NullAvailableSubEvents_ReturnsSingleUnavailableEntry()
        {
            var specs = GroupMappingWorkspaceModel.BuildButtonSpecs(null, targetGroupId: 1, groups: new List<GroupInfo> { Group(1, "G1", null) });
            Assert.Single(specs);
            Assert.Equal(GroupMappingButtonKind.Unavailable, specs[0].Kind);
        }

        [Fact]
        public void BuildButtonSpecs_NoTargetGroupResolved_ReturnsSingleUnavailableEntry()
        {
            // Mirrors an empty/ambiguous/ungrouped console selection — the
            // renderer resolves this to null, never a guess (brief §7).
            var specs = GroupMappingWorkspaceModel.BuildButtonSpecs(TwoComponents, targetGroupId: null, groups: new List<GroupInfo> { Group(1, "G1", null) });
            Assert.Single(specs);
            Assert.Equal(GroupMappingButtonKind.Unavailable, specs[0].Kind);
        }

        // ── Real component list ──────────────────────────────────────────────

        [Fact]
        public void BuildButtonSpecs_MapsEveryComponentInOrder()
        {
            var specs = GroupMappingWorkspaceModel.BuildButtonSpecs(TwoComponents, targetGroupId: 1, groups: new List<GroupInfo> { Group(1, "G1", null) });
            Assert.Equal(2, specs.Count);
            Assert.Equal("01-Waaz-Hall A", specs[0].ActionParameter);
            Assert.Equal("Waaz — Hall A", specs[0].Label);
            Assert.Equal("02-Ziyafat-Hall A", specs[1].ActionParameter);
            Assert.Equal(GroupMappingButtonKind.Component, specs[0].Kind);
        }

        [Fact]
        public void BuildButtonSpecs_UsesRealDisplayNameNeverRebuiltFromOtherFields()
        {
            // The label must be exactly what EventCreator provided — brief §8:
            // "do not independently rebuild names ... use AutoIngest-provided
            // display names." A deliberately weird real name should pass
            // through completely unmodified.
            var subs = new List<SubEventInfo> { Sub("03-Qadam Mubarak-Mazar", "QADAM MUBARAK — Mazar e Saifee (Surat)") };
            var specs = GroupMappingWorkspaceModel.BuildButtonSpecs(subs, targetGroupId: 1, groups: new List<GroupInfo> { Group(1, "G1", null) });
            Assert.Equal("QADAM MUBARAK — Mazar e Saifee (Surat)", specs[0].Label);
        }

        // ── Current-mapping rendering ────────────────────────────────────────

        [Fact]
        public void BuildButtonSpecs_MarksTheTargetGroupsOwnCurrentMapping()
        {
            var groups = new List<GroupInfo> { Group(1, "G1", "02-Ziyafat-Hall A") };
            var specs = GroupMappingWorkspaceModel.BuildButtonSpecs(TwoComponents, targetGroupId: 1, groups: groups);
            Assert.False(specs[0].IsCurrent); // Waaz — not mapped
            Assert.True(specs[1].IsCurrent);  // Ziyafat — the real current mapping
        }

        [Fact]
        public void BuildButtonSpecs_UnmappedTargetGroup_NothingMarkedCurrent()
        {
            var groups = new List<GroupInfo> { Group(1, "G1", null) };
            var specs = GroupMappingWorkspaceModel.BuildButtonSpecs(TwoComponents, targetGroupId: 1, groups: groups);
            Assert.All(specs, s => Assert.False(s.IsCurrent));
        }

        // ── Duplicate / taken-by-another-group rendering ─────────────────────

        [Fact]
        public void BuildButtonSpecs_ComponentTakenByAnotherGroup_IsMarkedTaken()
        {
            // G2 already owns Waaz — the same "disabled" rule the real Group
            // Panel dropdown enforces for the TARGET group (G1) attempting
            // the same mapping (brief §12).
            var groups = new List<GroupInfo> { Group(1, "G1", null), Group(2, "G2", "01-Waaz-Hall A") };
            var specs = GroupMappingWorkspaceModel.BuildButtonSpecs(TwoComponents, targetGroupId: 1, groups: groups);
            Assert.True(specs.Single(s => s.ActionParameter == "01-Waaz-Hall A").IsTakenByOtherGroup);
            Assert.False(specs.Single(s => s.ActionParameter == "02-Ziyafat-Hall A").IsTakenByOtherGroup);
        }

        [Fact]
        public void BuildButtonSpecs_OwnCurrentMapping_IsNotMarkedTakenByAnother()
        {
            // The target group's OWN existing mapping must never show as
            // "taken by another group" — it is taken by ITSELF, which is
            // exactly IsCurrent's job, not IsTakenByOtherGroup's.
            var groups = new List<GroupInfo> { Group(1, "G1", "01-Waaz-Hall A") };
            var specs = GroupMappingWorkspaceModel.BuildButtonSpecs(TwoComponents, targetGroupId: 1, groups: groups);
            var waaz = specs.Single(s => s.ActionParameter == "01-Waaz-Hall A");
            Assert.True(waaz.IsCurrent);
            Assert.False(waaz.IsTakenByOtherGroup);
        }

        // ── Stale-state replacement / dynamic list changes ───────────────────

        [Fact]
        public void BuildButtonSpecs_FullyReplacesComponentSetOnEachCall_NoStaleCarryover()
        {
            var groups = new List<GroupInfo> { Group(1, "G1", null) };
            var first = GroupMappingWorkspaceModel.BuildButtonSpecs(TwoComponents, targetGroupId: 1, groups: groups);
            Assert.Equal(2, first.Count);

            var oneComponent = new List<SubEventInfo> { Sub("01-Waaz-Hall A", "Waaz — Hall A") };
            var second = GroupMappingWorkspaceModel.BuildButtonSpecs(oneComponent, targetGroupId: 1, groups: groups);
            Assert.Single(second); // Ziyafat genuinely gone, not stale-cached
        }

        // ── ResolveSubEventId ────────────────────────────────────────────────

        [Fact]
        public void ResolveSubEventId_StringValue_ReturnsIt()
        {
            Assert.Equal("01-Waaz-Hall A", GroupMappingWorkspaceModel.ResolveSubEventId(Group(1, "G1", "01-Waaz-Hall A")));
        }

        [Fact]
        public void ResolveSubEventId_NullValue_ReturnsNull()
        {
            Assert.Null(GroupMappingWorkspaceModel.ResolveSubEventId(Group(1, "G1", null)));
        }

        [Fact]
        public void ResolveSubEventId_NullGroup_ReturnsNull()
        {
            Assert.Null(GroupMappingWorkspaceModel.ResolveSubEventId(null));
        }

        // ── Long component names (truncation reuse) ──────────────────────────

        [Fact]
        public void BuildButtonSpecs_LongComponentName_IsNeverPlaceholderedOnlyShortenedAtRenderTime()
        {
            // The MODEL never truncates — RefinementButtonImageRenderer-style
            // truncation happens only at render time (GroupMappingButtonImageRenderer
            // reuses RefinementWorkspaceModel.TruncateForDisplay, same as Phase
            // 4B's own tag labels) — pin that the real, full label survives
            // all the way through this layer unmodified.
            var longName = "Qadam Mubarak-E-Mawlana-Saiyedna-Mazar-E-Saifee-Surat-Multi-Word-Component";
            var subs = new List<SubEventInfo> { Sub("x", longName) };
            var specs = GroupMappingWorkspaceModel.BuildButtonSpecs(subs, targetGroupId: 1, groups: new List<GroupInfo> { Group(1, "G1", null) });
            Assert.Equal(longName, specs[0].Label);
        }

        // ── IsControlAction ──────────────────────────────────────────────────

        [Fact]
        public void IsControlAction_UnavailableSentinel_True()
        {
            Assert.True(GroupMappingWorkspaceModel.IsControlAction(GroupMappingWorkspaceModel.UnavailableActionParameter));
        }

        [Fact]
        public void IsControlAction_RealComponentId_False()
        {
            Assert.False(GroupMappingWorkspaceModel.IsControlAction("01-Waaz-Hall A"));
        }
    }
}
