namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System.Collections.Generic;
    using System.Linq;
    using System.Text.Json;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;
    using Xunit;

    /// <summary>
    /// AI-FEAT MX Console Phase 4C (revised) — tests for the pure, Logitech-
    /// free GROUPS workspace model. State fixtures shaped exactly like
    /// AutoIngestState.cs's own GroupInfo (mirrors the real wire protocol).
    /// </summary>
    public class GroupsWorkspaceModelTests
    {
        private static GroupInfo Group(int id, int fileCount) => new()
        {
            Id = id,
            Label = $"G{id}",
            FileCount = fileCount,
            ColorIndex = id - 1,
            SubEventId = JsonSerializer.SerializeToElement((string)null),
        };

        private static readonly string[] AssignAvailable = { "group.assign", "group.unassign" };

        [Fact]
        public void BuildButtonSpecs_NoGroupAssignAvailable_ReturnsSingleUnavailableEntry()
        {
            var specs = GroupsWorkspaceModel.BuildButtonSpecs(new List<GroupInfo>(), availableCommands: System.Array.Empty<string>());
            var spec = Assert.Single(specs);
            Assert.Equal(GroupsButtonKind.Unavailable, spec.Kind);
        }

        [Fact]
        public void BuildButtonSpecs_NullState_ReturnsSingleUnavailableEntry()
        {
            var specs = GroupsWorkspaceModel.BuildButtonSpecs(null, null);
            Assert.Single(specs);
            Assert.Equal(GroupsButtonKind.Unavailable, specs[0].Kind);
        }

        [Fact]
        public void BuildButtonSpecs_OnlyG1ThroughG3Exist_ShowsOnlyNewGroupEntry()
        {
            var groups = new List<GroupInfo> { Group(1, 2), Group(2, 1), Group(3, 4) };
            var specs = GroupsWorkspaceModel.BuildButtonSpecs(groups, AssignAvailable);
            var spec = Assert.Single(specs); // G1/G2/G3 deliberately never duplicated here — they have their own fixed keys
            Assert.Equal(GroupsButtonKind.NewGroup, spec.Kind);
        }

        [Fact]
        public void BuildButtonSpecs_G4AndG5Exist_ListedInOrderWithRealFileCounts()
        {
            var groups = new List<GroupInfo> { Group(1, 1), Group(4, 3), Group(5, 2) };
            var specs = GroupsWorkspaceModel.BuildButtonSpecs(groups, AssignAvailable);
            Assert.Equal(3, specs.Count); // G4, G5, + New Group
            Assert.Equal("4", specs[0].ActionParameter);
            Assert.Equal("G4", specs[0].Label);
            Assert.Equal(3, specs[0].FileCount);
            Assert.Equal("5", specs[1].ActionParameter);
            Assert.Equal(2, specs[1].FileCount);
            Assert.Equal(GroupsButtonKind.NewGroup, specs[2].Kind);
        }

        [Fact]
        public void BuildButtonSpecs_MaxGroupsReached_NoNewGroupEntryOffered()
        {
            // The real, authoritative max — see this model's own doc comment
            // for where "9" comes from (the real Cmd+G chord's own digit
            // handler, not invented here).
            var groups = Enumerable.Range(1, GroupsWorkspaceModel.MaxGroups).Select(i => Group(i, 1)).ToList();
            var specs = GroupsWorkspaceModel.BuildButtonSpecs(groups, AssignAvailable);
            Assert.DoesNotContain(specs, s => s.Kind == GroupsButtonKind.NewGroup);
            Assert.Equal(GroupsWorkspaceModel.MaxGroups - 3, specs.Count); // G4..G9, no New Group
        }

        [Fact]
        public void BuildButtonSpecs_OneBelowMax_StillOffersNewGroupEntry()
        {
            var groups = Enumerable.Range(1, GroupsWorkspaceModel.MaxGroups - 1).Select(i => Group(i, 1)).ToList();
            var specs = GroupsWorkspaceModel.BuildButtonSpecs(groups, AssignAvailable);
            Assert.Contains(specs, s => s.Kind == GroupsButtonKind.NewGroup);
        }

        [Fact]
        public void BuildButtonSpecs_StaleGroupRemoved_FullyReplacedNotCarriedOver()
        {
            var first = GroupsWorkspaceModel.BuildButtonSpecs(new List<GroupInfo> { Group(4, 1), Group(5, 1) }, AssignAvailable);
            Assert.Equal(3, first.Count);

            var second = GroupsWorkspaceModel.BuildButtonSpecs(new List<GroupInfo> { Group(4, 1) }, AssignAvailable); // G5 emptied/removed elsewhere
            Assert.Equal(2, second.Count);
            Assert.DoesNotContain(second, s => s.ActionParameter == "5");
        }

        [Fact]
        public void BuildButtonSpecs_NeverCreatesAnEmptyGroupJustByListing()
        {
            // Pure function — calling it twice with the same input never
            // mutates anything or grows the list on its own; this is really
            // a documentation-as-test pin for "do not create empty groups"
            // (brief §7/§8), since BuildButtonSpecs has no side effects at
            // all to begin with.
            var groups = new List<GroupInfo> { Group(1, 1) };
            var a = GroupsWorkspaceModel.BuildButtonSpecs(groups, AssignAvailable);
            var b = GroupsWorkspaceModel.BuildButtonSpecs(groups, AssignAvailable);
            Assert.Equal(a.Count, b.Count);
        }

        [Fact]
        public void IsControlAction_NewGroupAndUnavailable_True()
        {
            Assert.True(GroupsWorkspaceModel.IsControlAction(GroupsWorkspaceModel.NewGroupActionParameter));
            Assert.True(GroupsWorkspaceModel.IsControlAction(GroupsWorkspaceModel.UnavailableActionParameter));
        }

        [Fact]
        public void IsControlAction_RealGroupId_False()
        {
            Assert.False(GroupsWorkspaceModel.IsControlAction("4"));
        }
    }
}
