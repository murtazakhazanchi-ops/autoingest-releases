namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;

    /// <summary>
    /// AI-FEAT MX Console — Unified Contextual Keypad. The pure,
    /// Logitech-free decision logic ContextualKeypadController (the
    /// stateful SDK shell — mode, page cursors, SharedClient subscription,
    /// dial/press dispatch) delegates to. Every function here takes
    /// explicit state and returns a plain answer — no SDK type, no mutable
    /// field, no I/O — so it is directly unit-testable without
    /// SharedClient.Instance, which is a hardcoded singleton with no test
    /// seam (confirmed: no existing test in this project touches it
    /// directly — every other transport test constructs its own
    /// AutoIngestClient instead).
    ///
    /// Reuses — never forks — the existing pure business-logic models:
    /// RefinementWorkspaceModel.BuildButtonSpecs,
    /// GroupMappingWorkspaceModel.BuildButtonSpecs,
    /// GroupsWorkspaceModel.BuildButtonSpecs. This file is a pagination +
    /// adapter layer on top of those, never a second implementation of
    /// their decisions.
    /// </summary>
    public static class ContextualKeypadModel
    {
        public const int ItemsPerPage = 5;
        // Moved to the bottom-right (slot 9) during physical migration —
        // an explicit operator preference after seeing the original
        // middle-right (slot 6) position live. Shared by every contextual
        // mode (brief's own "shared pagination model").
        public const int BackSlotIndex = 8;

        public static readonly IReadOnlyList<ContextSlotBinding> BrowseBindings = new[]
        {
            new ContextSlotBinding(SlotRole.StaticAction, "G1", "assign:1"),
            new ContextSlotBinding(SlotRole.StaticAction, "G2", "assign:2"),
            new ContextSlotBinding(SlotRole.StaticAction, "G3", "assign:3"),
            new ContextSlotBinding(SlotRole.ModeEntry, "GROUPS", "mode:groups"),
            new ContextSlotBinding(SlotRole.ModeEntry, "MAP GROUP", "mode:mapgroup"),
            new ContextSlotBinding(SlotRole.ModeEntry, "REFINE TAGS", "mode:refine"),
            new ContextSlotBinding(SlotRole.StaticAction, "CHANGE EVENT", "changeevent"),
            new ContextSlotBinding(SlotRole.StaticAction, "IMPORT", "import"),
            ContextSlotBinding.Blank, // Reserved
        };

        public static int PageCountFor(int itemCount, int itemsPerPage = ItemsPerPage) => Math.Max(1, (int)Math.Ceiling(itemCount / (double)itemsPerPage));

        /// <summary>No wrap — clamps to [0, pageCount-1] (brief §9: at the
        /// first/last page, next/previous is a no-op, never cycles).</summary>
        public static int ClampPage(int page, int pageCount) => Math.Max(0, Math.Min(page, Math.Max(0, pageCount - 1)));

        public static ContextSlotBinding BackBinding(int pageCount, int currentPage) =>
            new(SlotRole.BackWithPage, pageCount > 1 ? $"BACK {currentPage + 1}/{pageCount}" : "BACK", null);

        /// <summary>RefineTags-only replacement for BackBinding at slot 9 —
        /// an explicit operator decision: plain navigation Back serves no
        /// purpose in Refine mode specifically, since closing the
        /// workspace (tagRefinement.close) already returns to Browse via
        /// the existing OnStateChanged auto-revert once AutoIngest confirms
        /// it closed. One button, not two, at that position. Groups/MapGroup
        /// keep plain BackBinding — they have no session to close.</summary>
        public static ContextSlotBinding CloseBinding(int pageCount, int currentPage) =>
            new(SlotRole.CloseRefine, pageCount > 1 ? $"CLOSE {currentPage + 1}/{pageCount}" : "CLOSE", null);

        public static int GroupsPageCount(IReadOnlyList<GroupInfo> groups, IReadOnlyCollection<string> availableCommands) =>
            PageCountFor(GroupsWorkspaceModel.BuildButtonSpecs(groups, availableCommands).Count(s => s.Kind != GroupsButtonKind.Unavailable));

        public static int MapGroupPageCount(IReadOnlyList<SubEventInfo> availableSubEvents, int? targetGroupId, IReadOnlyList<GroupInfo> groups) =>
            PageCountFor(GroupMappingWorkspaceModel.BuildButtonSpecs(availableSubEvents, targetGroupId, groups).Count(s => s.Kind != GroupMappingButtonKind.Unavailable));

        public static int RefinePageCount(TagRefinementInfo tagRefinement, IReadOnlyCollection<string> availableCommands) =>
            PageCountFor(RefinementWorkspaceModel.BuildButtonSpecs(tagRefinement, availableCommands).Count(s => s.Kind == RefinementButtonKind.Tag));

        public static IReadOnlyList<ContextSlotBinding> BuildGroupsBindings(IReadOnlyList<GroupInfo> groups, IReadOnlyCollection<string> availableCommands, int page)
        {
            var specs = GroupsWorkspaceModel.BuildButtonSpecs(groups, availableCommands)
                .Where(s => s.Kind != GroupsButtonKind.Unavailable).ToList();
            var pageCount = PageCountFor(specs.Count);
            page = ClampPage(page, pageCount);
            var pageItems = specs.Skip(page * ItemsPerPage).Take(ItemsPerPage).ToList();

            var bindings = new ContextSlotBinding[9];
            for (var i = 0; i < ItemsPerPage; i++)
            {
                bindings[i] = i < pageItems.Count
                    ? new ContextSlotBinding(SlotRole.Group, pageItems[i].Label, pageItems[i].ActionParameter)
                    : ContextSlotBinding.Blank;
            }
            bindings[5] = ContextSlotBinding.Blank;
            bindings[6] = ContextSlotBinding.Blank;
            bindings[7] = ContextSlotBinding.Blank;
            bindings[BackSlotIndex] = BackBinding(pageCount, page); // slot 9 — assigned last, never overwritten
            return bindings;
        }

        public static IReadOnlyList<ContextSlotBinding> BuildMapGroupBindings(IReadOnlyList<SubEventInfo> availableSubEvents, int? targetGroupId, IReadOnlyList<GroupInfo> groups, int page)
        {
            var specs = GroupMappingWorkspaceModel.BuildButtonSpecs(availableSubEvents, targetGroupId, groups)
                .Where(s => s.Kind != GroupMappingButtonKind.Unavailable).ToList();
            var pageCount = PageCountFor(specs.Count);
            page = ClampPage(page, pageCount);
            var pageItems = specs.Skip(page * ItemsPerPage).Take(ItemsPerPage).ToList();

            var bindings = new ContextSlotBinding[9];
            for (var i = 0; i < ItemsPerPage; i++)
            {
                bindings[i] = i < pageItems.Count
                    ? new ContextSlotBinding(SlotRole.Component, pageItems[i].Label, pageItems[i].ActionParameter, pageItems[i].IsCurrent ? 1 : pageItems[i].IsTakenByOtherGroup ? 2 : 0)
                    : ContextSlotBinding.Blank;
            }
            bindings[5] = ContextSlotBinding.Blank;
            bindings[6] = ContextSlotBinding.Blank;
            bindings[7] = ContextSlotBinding.Blank;
            bindings[BackSlotIndex] = BackBinding(pageCount, page); // slot 9 — assigned last, never overwritten
            return bindings;
        }

        public static IReadOnlyList<ContextSlotBinding> BuildRefineBindings(TagRefinementInfo tagRefinement, IReadOnlyCollection<string> availableCommands, int page)
        {
            var specs = RefinementWorkspaceModel.BuildButtonSpecs(tagRefinement, availableCommands);
            var tags = specs.Where(s => s.Kind == RefinementButtonKind.Tag).ToList();
            var hasApply = specs.Any(s => s.Kind == RefinementButtonKind.ApplyToSelected);
            var hasAllTags = specs.Any(s => s.Kind == RefinementButtonKind.UseAllTags);
            var hasReset = specs.Any(s => s.Kind == RefinementButtonKind.ClearSelected);

            var pageCount = PageCountFor(tags.Count);
            page = ClampPage(page, pageCount);
            var pageItems = tags.Skip(page * ItemsPerPage).Take(ItemsPerPage).ToList();

            var bindings = new ContextSlotBinding[9];
            for (var i = 0; i < ItemsPerPage; i++)
            {
                bindings[i] = i < pageItems.Count
                    ? new ContextSlotBinding(SlotRole.Tag, pageItems[i].Label, pageItems[i].ActionParameter, SemanticIndexForTagState(pageItems[i].State))
                    : ContextSlotBinding.Blank;
            }
            // Explicit operator decision: Refine mode has no use for plain
            // navigation Back — CLOSE (tagRefinement.close, the real
            // on-screen panel's own "Done Refining") is the only exit this
            // mode needs, since closing the session already returns to
            // Browse via the existing OnStateChanged auto-revert. CLOSE
            // takes slot 9 (BackSlotIndex) instead of BACK — Groups/
            // MapGroup are unaffected, they still use BackBinding there.
            bindings[5] = hasAllTags ? new ContextSlotBinding(SlotRole.AllTags, "ALL TAGS", null) : ContextSlotBinding.Blank;
            bindings[6] = hasReset ? new ContextSlotBinding(SlotRole.Reset, "RESET", null) : ContextSlotBinding.Blank;
            bindings[7] = hasApply ? new ContextSlotBinding(SlotRole.Apply, "APPLY", null) : ContextSlotBinding.Blank;
            bindings[BackSlotIndex] = CloseBinding(pageCount, page); // slot 9 — assigned last, never overwritten
            return bindings;
        }

        public static int SemanticIndexForTagState(string state) => state switch
        {
            "checked" => 1,
            "indeterminate" => 2,
            _ => 0,
        };
    }
}
