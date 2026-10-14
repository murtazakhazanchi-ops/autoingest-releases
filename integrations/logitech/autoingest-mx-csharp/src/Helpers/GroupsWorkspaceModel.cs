namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System.Collections.Generic;
    using System.Linq;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;

    public enum GroupsButtonKind
    {
        ExistingGroup,
        NewGroup,
        Unavailable,
    }

    /// <summary>One GROUPS-workspace button, as pure data. ActionParameter is
    /// the real group's own "id" as a string for an existing group, or the
    /// NewGroup sentinel — never a custom encoding (a real group id is
    /// always a positive integer string, so it can never collide with the
    /// sentinels).</summary>
    public sealed record GroupsButtonSpec(string ActionParameter, GroupsButtonKind Kind, string Label, int? FileCount);

    /// <summary>
    /// AI-FEAT MX Console Phase 4C (revised) — the GROUPS dynamic workspace,
    /// giving access to groups beyond the fixed G1/G2/G3 keys. Same split as
    /// every other Phase 4B/4C workspace: pure here, SDK-only in
    /// GroupsButtonImageRenderer/GroupsFolder.
    ///
    /// Reuses group.assign's own already-authoritative semantics exactly —
    /// no new grouping business logic (brief §6/§8). G1/G2/G3's own
    /// GroupSlotHelper already established the pattern this follows: an
    /// EXISTING group is assigned to directly by its real id; a brand-new
    /// group is created by calling group.assign with NO groupId at all
    /// (GroupManager.assignFiles' own fallback — "existing ? existing.id :
    /// GroupManager.createGroup()" — the exact mechanism the real Cmd+G
    /// chord and G1/G2/G3 both already rely on). This file never invents a
    /// second grouping model.
    ///
    /// Max group count (9) is the REAL, authoritative limit — confirmed by
    /// reading the real Cmd+G chord's own digit handler
    /// (renderer.js: "const n = parseInt(e.key, 10); if (isNaN(n) || n &lt; 1
    /// || n &gt; 9) return;"), not guessed or invented here (brief §7: "Do
    /// not hardcode a fixed maximum of G9 unless AutoIngest itself has such
    /// a limit").
    /// </summary>
    public static class GroupsWorkspaceModel
    {
        public const string NewGroupActionParameter = "__newGroup__";
        public const string UnavailableActionParameter = "__unavailable__";

        // The real, authoritative max group count — see this class's own
        // doc comment for where this number comes from.
        public const int MaxGroups = 9;

        /// <summary>
        /// Lists every EXISTING group beyond G3 (G1/G2/G3 already have their
        /// own fixed keys — this workspace deliberately does not duplicate
        /// them), in id order, plus exactly one "+ New Group" entry when
        /// fewer than MaxGroups currently exist. Never pre-lists empty
        /// placeholder slots (G5/G6/G7/.../G9) as if they were independently
        /// selectable — pressing a nonexistent slot number does not
        /// literally create a group with THAT number (GroupManager always
        /// auto-labels sequentially), so showing them as distinct choices
        /// would misrepresent real behavior (brief §7: never create empty
        /// groups, never invent semantics the real UI doesn't have — the
        /// real Cmd+G chord has no "pick a specific empty slot" UI either).
        /// A single informational "Unavailable" entry (same convention
        /// RefinementWorkspaceModel/GroupMappingWorkspaceModel both
        /// established) when group.assign itself is not currently available
        /// at all (e.g. QMZ open, no selection).
        /// </summary>
        public static IReadOnlyList<GroupsButtonSpec> BuildButtonSpecs(
            IReadOnlyList<GroupInfo> groups,
            IReadOnlyCollection<string> availableCommands)
        {
            var commands = availableCommands ?? System.Array.Empty<string>();
            if (!commands.Contains("group.assign"))
            {
                return new[] { new GroupsButtonSpec(UnavailableActionParameter, GroupsButtonKind.Unavailable, "Unavailable", null) };
            }

            var all = groups ?? new List<GroupInfo>();
            var specs = all
                .Where(g => g.Id > 3)
                .OrderBy(g => g.Id)
                .Select(g => new GroupsButtonSpec(g.Id.ToString(System.Globalization.CultureInfo.InvariantCulture), GroupsButtonKind.ExistingGroup, g.Label, g.FileCount))
                .ToList();

            if (all.Count < MaxGroups)
            {
                specs.Add(new GroupsButtonSpec(NewGroupActionParameter, GroupsButtonKind.NewGroup, "+ New Group", null));
            }

            return specs;
        }

        public static bool IsControlAction(string actionParameter) =>
            actionParameter == NewGroupActionParameter || actionParameter == UnavailableActionParameter;
    }
}
