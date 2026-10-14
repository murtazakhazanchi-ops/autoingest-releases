namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System.Collections.Generic;
    using System.Linq;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;

    /// <summary>Which real AutoIngest command a mapping-workspace button maps to.</summary>
    public enum GroupMappingButtonKind
    {
        Component,
        Unavailable, // informational only, maps to no command
    }

    /// <summary>
    /// One mapping-workspace button, as pure data — no Logitech/BitmapBuilder
    /// type anywhere in this file. ActionParameter IS the wire value a press
    /// sends back: for Kind == Component, it is the component's own real
    /// "id" field from EventCreator.getSubEventNames() (the real folder
    /// name), passed through completely unmodified — same "already
    /// canonical, no custom encoding" rule RefinementWorkspaceModel
    /// established, for the same reason (a real folder name never starts
    /// with "__", so it can never collide with the Unavailable sentinel).
    /// </summary>
    public sealed record GroupMappingButtonSpec(
        string ActionParameter,
        GroupMappingButtonKind Kind,
        string Label,
        bool IsCurrent,
        bool IsTakenByOtherGroup);

    /// <summary>
    /// The testable group→sub-event mapping logic (AI-FEAT MX Console Phase
    /// 4C — group.setSubEvent) — everything kept separate from Logitech's
    /// own rendering/lifecycle APIs, same split as RefinementWorkspaceModel/
    /// RefineTagsFolder. GroupMappingFolder (the actual PluginDynamicFolder)
    /// is a thin shell that calls these and does nothing else itself.
    ///
    /// Target-group resolution ("which group is this console press trying to
    /// map") is NOT reimplemented here — it is resolved authoritatively by
    /// the renderer (AutoIngestState.TargetGroupIdForMapping, via
    /// _resolveTargetGroupForMapping's own "every selected file must resolve
    /// to the SAME group" rule, the exact rule tagRefinement.open's own
    /// group-scope resolution already uses) and simply read here — brief
    /// §15's "no C# business-rule duplication".
    /// </summary>
    public static class GroupMappingWorkspaceModel
    {
        public const string UnavailableActionParameter = "__unavailable__";

        /// <summary>
        /// Builds the full button list for the current state. Returns a
        /// single informational "Unavailable" entry (never an empty list,
        /// same convention RefinementWorkspaceModel.BuildButtonSpecs
        /// established and physical testing confirmed is the right shape
        /// for this SDK — see that method's own doc comment) when:
        ///   - the active event has no sub-event/component concept at all
        ///     (single-component event — availableSubEvents is empty), or
        ///   - the current console selection does not unambiguously resolve
        ///     to exactly one group (targetGroupId is null) — never guesses.
        /// Otherwise one button per real available component, in
        /// EventCreator's own order (never resorted — stable across
        /// redraws), each one marked IsCurrent against the TARGET group's
        /// own subEventId (not just "any" group), and IsTakenByOtherGroup
        /// when a DIFFERENT group already owns that subEventId — the same
        /// "disabled" rule the real Group Panel dropdown enforces (an
        /// already-taken item is unclickable there too). A taken button is
        /// still included (so the operator can see what owns it), not
        /// hidden — pressing it is rejected by RunCommand's own fresh
        /// re-validation regardless, the same defense-in-depth every other
        /// press in this plugin already has.
        /// </summary>
        public static IReadOnlyList<GroupMappingButtonSpec> BuildButtonSpecs(
            IReadOnlyList<SubEventInfo> availableSubEvents,
            int? targetGroupId,
            IReadOnlyList<GroupInfo> groups)
        {
            if (availableSubEvents == null || availableSubEvents.Count == 0 || targetGroupId == null)
            {
                return new[] { new GroupMappingButtonSpec(UnavailableActionParameter, GroupMappingButtonKind.Unavailable, "Unavailable", false, false) };
            }

            var targetGroup = groups?.FirstOrDefault(g => g.Id == targetGroupId.Value);
            var currentSubEventId = ResolveSubEventId(targetGroup);
            var takenIds = (groups ?? new List<GroupInfo>())
                .Where(g => g.Id != targetGroupId.Value)
                .Select(ResolveSubEventId)
                .Where(id => id != null)
                .ToHashSet();

            return availableSubEvents
                .Select(s => new GroupMappingButtonSpec(
                    ActionParameter: s.Id,
                    Kind: GroupMappingButtonKind.Component,
                    Label: s.Name,
                    IsCurrent: s.Id == currentSubEventId,
                    IsTakenByOtherGroup: takenIds.Contains(s.Id)))
                .ToList();
        }

        /// <summary>
        /// GroupInfo.SubEventId is a raw JsonElement (its real shape varies —
        /// string | null | other, see AutoIngestState.cs's own doc comment);
        /// this is the one place that safely reads it as a plain string or
        /// null, so callers never touch System.Text.Json types directly.
        /// </summary>
        public static string ResolveSubEventId(GroupInfo group)
        {
            if (group == null) { return null; }
            var el = group.SubEventId;
            return el.ValueKind == System.Text.Json.JsonValueKind.String ? el.GetString() : null;
        }

        public static bool IsControlAction(string actionParameter) => actionParameter == UnavailableActionParameter;
    }
}
