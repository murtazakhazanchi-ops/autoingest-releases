namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System.Collections.Generic;
    using System.Linq;
    using System.Text.Json;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;
    using Xunit;

    /// <summary>
    /// AI-FEAT MX Console — Unified Contextual Keypad: tests for the pure,
    /// Logitech-free ContextualKeypadModel. State fixtures shaped exactly
    /// like AutoIngestState.cs's own types (mirror the real wire protocol).
    /// </summary>
    public class ContextualKeypadModelTests
    {
        private static GroupInfo Group(int id, int fileCount, string subEventId = null) => new()
        {
            Id = id,
            Label = $"G{id}",
            FileCount = fileCount,
            ColorIndex = id - 1,
            SubEventId = subEventId == null ? JsonSerializer.SerializeToElement((string)null) : JsonSerializer.SerializeToElement(subEventId),
        };

        private static TagInfo Tag(string label, string state) => new() { Id = $"eventTypes:{label}", Category = "eventTypes", Label = label, State = state };

        private static TagRefinementInfo Refinement(params TagInfo[] tags) => new() { Active = true, ScopeLabel = "G1", ComponentLabel = "Waaz", SelectedCount = 1, Status = "mixed", Tags = tags.ToList() };

        private static readonly string[] GroupCommands = { "group.assign", "group.unassign" };
        private static readonly string[] RefineCommands = { "tagRefinement.setTagState", "tagRefinement.useAllTags", "tagRefinement.clearSelected", "tagRefinement.applyToSelected", "tagRefinement.close" };

        // ── Browse ───────────────────────────────────────────────────────

        [Fact]
        public void BrowseBindings_NineFixedSlots_MatchTheApprovedLayout()
        {
            var b = ContextualKeypadModel.BrowseBindings;
            Assert.Equal(9, b.Count);
            Assert.Equal("G1", b[0].Label);
            Assert.Equal("G2", b[1].Label);
            Assert.Equal("G3", b[2].Label);
            Assert.Equal("GROUPS", b[3].Label);
            Assert.Equal("MAP GROUP", b[4].Label);
            Assert.Equal("REFINE TAGS", b[5].Label);
            Assert.Equal("CHANGE EVENT", b[6].Label);
            Assert.Equal("IMPORT", b[7].Label);
            Assert.Equal(SlotRole.Blank, b[8].Role); // Reserved
        }

        // ── Pagination (brief §16) ───────────────────────────────────────

        [Fact]
        public void ClampPage_NeverWraps_StaysAtBoundary()
        {
            Assert.Equal(0, ContextualKeypadModel.ClampPage(-1, 3));
            Assert.Equal(2, ContextualKeypadModel.ClampPage(5, 3));
            Assert.Equal(0, ContextualKeypadModel.ClampPage(0, 0)); // zero pages still clamps safely
        }

        [Fact]
        public void BackBinding_SinglePage_ShowsPlainBack()
        {
            var b = ContextualKeypadModel.BackBinding(1, 0);
            Assert.Equal("BACK", b.Label);
        }

        [Fact]
        public void BackBinding_MultiplePages_ShowsIndicator()
        {
            var b = ContextualKeypadModel.BackBinding(3, 1);
            Assert.Equal("BACK 2/3", b.Label);
        }

        [Fact]
        public void CloseBinding_SinglePage_ShowsPlainClose()
        {
            var b = ContextualKeypadModel.CloseBinding(1, 0);
            Assert.Equal("CLOSE", b.Label);
            Assert.Equal(SlotRole.CloseRefine, b.Role);
        }

        [Fact]
        public void CloseBinding_MultiplePages_ShowsIndicator()
        {
            var b = ContextualKeypadModel.CloseBinding(3, 1);
            Assert.Equal("CLOSE 2/3", b.Label);
        }

        // ── RefineTags: 5 tags/page, fewer/more than 5 (brief §15/§16).
        // Slot 9 is CLOSE, not BACK — an explicit operator decision: plain
        // navigation Back serves no purpose in Refine mode, since closing
        // the workspace (tagRefinement.close, the real on-screen panel's
        // own "Done Refining") already returns to Browse via the existing
        // OnStateChanged auto-revert. ───────────────────────────────────

        [Fact]
        public void BuildRefineBindings_FiveOrFewerTags_OnePage_UnusedSlotsBlank()
        {
            var refinement = Refinement(Tag("A", "unchecked"), Tag("B", "checked"), Tag("C", "indeterminate"));
            var bindings = ContextualKeypadModel.BuildRefineBindings(refinement, RefineCommands, page: 0);

            Assert.Equal(SlotRole.Tag, bindings[0].Role);
            Assert.Equal(SlotRole.Tag, bindings[1].Role);
            Assert.Equal(SlotRole.Tag, bindings[2].Role);
            Assert.Equal(SlotRole.Blank, bindings[3].Role); // unused tag slots
            Assert.Equal(SlotRole.Blank, bindings[4].Role);
            Assert.Equal(SlotRole.CloseRefine, bindings[8].Role); // slot 9 is CLOSE, not BACK, in Refine mode
            Assert.Equal("CLOSE", bindings[8].Label);
            Assert.Equal(1, bindings[1].SemanticState); // checked -> green
            Assert.Equal(2, bindings[2].SemanticState); // indeterminate -> amber
            Assert.Equal(0, bindings[0].SemanticState); // unchecked -> default
        }

        [Theory]
        [InlineData(6, 2)]
        [InlineData(10, 2)]
        [InlineData(11, 3)]
        [InlineData(15, 3)]
        public void BuildRefineBindings_PageCount_MatchesExpected(int tagCount, int expectedPages)
        {
            var tags = Enumerable.Range(1, tagCount).Select(i => Tag($"Tag{i}", "unchecked")).ToArray();
            var refinement = Refinement(tags);
            var pageCount = ContextualKeypadModel.RefinePageCount(refinement, RefineCommands);
            Assert.Equal(expectedPages, pageCount);
        }

        [Fact]
        public void BuildRefineBindings_FifteenTags_NoMissingOrDuplicatedAcrossAllPages()
        {
            var tags = Enumerable.Range(1, 15).Select(i => Tag($"Tag{i}", "unchecked")).ToArray();
            var refinement = Refinement(tags);
            var pageCount = ContextualKeypadModel.RefinePageCount(refinement, RefineCommands);
            Assert.Equal(3, pageCount);

            var seen = new List<string>();
            for (var page = 0; page < pageCount; page++)
            {
                var bindings = ContextualKeypadModel.BuildRefineBindings(refinement, RefineCommands, page);
                for (var i = 0; i < ContextualKeypadModel.ItemsPerPage; i++)
                {
                    if (bindings[i].Role == SlotRole.Tag) { seen.Add(bindings[i].Payload); }
                }
            }
            Assert.Equal(15, seen.Count);
            Assert.Equal(15, seen.Distinct().Count()); // no duplicates
            Assert.Equal(tags.Select(t => t.Id), seen); // authoritative order preserved
        }

        [Fact]
        public void BuildRefineBindings_PageOutOfRangeAfterListShrink_ClampsToLastValidPage()
        {
            var manyTags = Enumerable.Range(1, 11).Select(i => Tag($"Tag{i}", "unchecked")).ToArray();
            var refinement = Refinement(manyTags);
            // Request page 2 (valid: 3 pages for 11 tags) — then simulate the
            // list shrinking to 2 tags (1 page) and re-request the SAME page
            // index; it must clamp, not throw or return an empty/garbage result.
            var shrunk = Refinement(Tag("A", "unchecked"), Tag("B", "checked"));
            var bindings = ContextualKeypadModel.BuildRefineBindings(shrunk, RefineCommands, page: 2);
            Assert.Equal("CLOSE", bindings[8].Label); // clamped back to the single real page
            Assert.Equal(SlotRole.Tag, bindings[0].Role);
        }

        [Fact]
        public void BuildRefineBindings_FixedControls_OnEveryPage()
        {
            var tags = Enumerable.Range(1, 10).Select(i => Tag($"Tag{i}", "unchecked")).ToArray();
            var refinement = Refinement(tags);
            var page0 = ContextualKeypadModel.BuildRefineBindings(refinement, RefineCommands, 0);
            var page1 = ContextualKeypadModel.BuildRefineBindings(refinement, RefineCommands, 1);
            // ALL TAGS/RESET/APPLY are fixed controls, independent of
            // page/tag count, shown identically on every page; CLOSE
            // (slot 9) is asserted separately since it also carries the
            // page indicator in its own label.
            Assert.Equal(SlotRole.AllTags, page0[5].Role);
            Assert.Equal(SlotRole.Reset, page0[6].Role);
            Assert.Equal(SlotRole.Apply, page0[7].Role);
            Assert.Equal(SlotRole.CloseRefine, page0[8].Role);
            Assert.Equal(SlotRole.AllTags, page1[5].Role);
            Assert.Equal(SlotRole.Reset, page1[6].Role);
            Assert.Equal(SlotRole.Apply, page1[7].Role);
            Assert.Equal(SlotRole.CloseRefine, page1[8].Role);
        }

        [Fact]
        public void BuildRefineBindings_ControlsUnavailable_RenderBlank()
        {
            var refinement = Refinement(Tag("A", "unchecked"));
            var bindings = ContextualKeypadModel.BuildRefineBindings(refinement, availableCommands: System.Array.Empty<string>(), page: 0);
            // Slot 9 (index 8) is always a real CLOSE binding in Refine
            // mode regardless of other control availability — only the
            // AllTags/Reset/Apply slots (5/6/7) go blank when unavailable.
            Assert.Equal(SlotRole.Blank, bindings[5].Role);
            Assert.Equal(SlotRole.Blank, bindings[6].Role);
            Assert.Equal(SlotRole.Blank, bindings[7].Role);
            Assert.Equal(SlotRole.CloseRefine, bindings[8].Role);
        }

        // ── Groups ───────────────────────────────────────────────────────

        [Fact]
        public void BuildGroupsBindings_RealGroupsListedWithRealIds()
        {
            var groups = new List<GroupInfo> { Group(1, 2), Group(4, 1), Group(5, 3) };
            var bindings = ContextualKeypadModel.BuildGroupsBindings(groups, GroupCommands, page: 0);
            Assert.Equal(SlotRole.Group, bindings[0].Role);
            Assert.Equal("4", bindings[0].Payload); // G1/G2/G3 have their own fixed Browse keys — never duplicated here
            Assert.Equal("5", bindings[1].Payload);
        }

        [Fact]
        public void BuildGroupsBindings_NewGroupEntry_IncludedWhenBelowMax()
        {
            var groups = new List<GroupInfo> { Group(1, 1) };
            var bindings = ContextualKeypadModel.BuildGroupsBindings(groups, GroupCommands, page: 0);
            Assert.Contains(bindings.Take(5), b => b.Role == SlotRole.Group && b.Payload == GroupsWorkspaceModel.NewGroupActionParameter);
        }

        // ── MapGroup ─────────────────────────────────────────────────────

        [Fact]
        public void BuildMapGroupBindings_CurrentMapping_IsGreen_TakenByOther_IsAmber()
        {
            var subs = new List<SubEventInfo> { new() { Id = "a", Name = "A" }, new() { Id = "b", Name = "B" } };
            var groups = new List<GroupInfo> { Group(1, 1, "a"), Group(2, 1, "b") };
            var bindings = ContextualKeypadModel.BuildMapGroupBindings(subs, targetGroupId: 1, groups, page: 0);
            Assert.Equal(1, bindings.Single(b => b.Payload == "a").SemanticState); // current mapping -> green
            Assert.Equal(2, bindings.Single(b => b.Payload == "b").SemanticState); // taken by G2 -> amber
        }

        [Fact]
        public void BuildMapGroupBindings_AmbiguousSelection_RendersUnavailableOnlySlot()
        {
            var subs = new List<SubEventInfo> { new() { Id = "a", Name = "A" } };
            var bindings = ContextualKeypadModel.BuildMapGroupBindings(subs, targetGroupId: null, groups: new List<GroupInfo>(), page: 0);
            Assert.All(bindings.Take(5), b => Assert.Equal(SlotRole.Blank, b.Role)); // nothing resolvable — no stale binding shown
        }

        // ── Stale-binding safety (brief §16) ─────────────────────────────

        [Fact]
        public void BuildRefineBindings_NullState_AllBlankNotAStaleList()
        {
            var bindings = ContextualKeypadModel.BuildRefineBindings(null, null, page: 0);
            Assert.All(bindings.Take(5), b => Assert.Equal(SlotRole.Blank, b.Role));
        }

        [Fact]
        public void ContextSlotBinding_Blank_IsDisabledAndCarriesNoPayload()
        {
            Assert.False(ContextSlotBinding.Blank.Enabled);
            Assert.Null(ContextSlotBinding.Blank.Payload);
        }
    }
}
