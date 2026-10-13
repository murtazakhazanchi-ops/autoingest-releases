namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System.Collections.Generic;
    using System.Linq;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;

    /// <summary>Which real AutoIngest command a workspace button maps to.</summary>
    public enum RefinementButtonKind
    {
        Tag,
        ApplyToSelected,
        UseAllTags,
        ClearSelected,
    }

    /// <summary>
    /// One dynamic-folder button, as pure data — no Logitech/BitmapBuilder
    /// type anywhere in this file. ActionParameter IS the wire value a press
    /// sends back (for Kind == Tag, it is the tag's own canonical "id" field
    /// from AutoIngest, passed through completely unmodified — see
    /// RefinementWorkspaceModel's class doc for why no custom encoding is
    /// needed at all).
    /// </summary>
    public sealed record RefinementButtonSpec(
        string ActionParameter,
        RefinementButtonKind Kind,
        string Label,
        string Category = null, // "eventTypes" | "additionalKeywords" — Tag only
        string State = null);   // "checked" | "unchecked" | "indeterminate" — Tag only

    /// <summary>
    /// The testable refinement-workspace logic — everything Phase 4B's brief
    /// asked to keep separate from Logitech's own rendering/lifecycle APIs.
    /// Every function here is pure: AutoIngestState in, a plain answer out,
    /// no I/O, no SDK type, no mutable field. RefineTagsFolder (the actual
    /// PluginDynamicFolder) is a thin shell that calls these and does nothing
    /// else itself — see that class's own doc comment.
    ///
    /// Tag identity note (brief §6, "do not rely on array position, use a
    /// reversible deterministic encoding"): no custom encoding is introduced
    /// here. AutoIngest's own tagRefinement.tags[].id is ALREADY the one
    /// canonical identity ("&lt;category&gt;:&lt;label&gt;", e.g.
    /// "eventTypes:Waaz" — see renderer.js's _getTagRefinementCompact()/
    /// AutoIngestState.cs's TagInfo.Id). It is a plain Loupedeck actionParameter
    /// string already, so it is used completely unmodified as the wire value —
    /// introducing a SEPARATE encoding on top of an already-canonical, already
    /// collision-free string would be the thing to avoid, not the thing to add.
    /// The three control buttons (Apply/All Tags/Clear Tags) use fixed sentinel
    /// strings (ApplyActionParameter etc.) that can never collide with a real
    /// tag id, because every real tag id always starts with "eventTypes:" or
    /// "additionalKeywords:" (the only two categories AutoIngest's own
    /// commandManager.js validates — see docs/commandLayer.md), and the
    /// sentinels deliberately do not.
    /// </summary>
    public static class RefinementWorkspaceModel
    {
        public const string ApplyActionParameter = "__apply__";
        public const string AllTagsActionParameter = "__allTags__";
        public const string ResetTagsActionParameter = "__resetTags__"; // tagRefinement.clearSelected — see below

        /// <summary>
        /// Builds the full, ordered button list for the current state — tags
        /// first (in AutoIngest's own array order — never resorted, so tag
        /// order stays stable across redraws), then Apply/All Tags/Clear Tags
        /// at the end (brief §15's own stated order), each included only when
        /// `availableCommands` actually allows it right now — the same
        /// availableCommands-gating rule every other action in this plugin
        /// already uses (GatedCommand), never a locally-reinvented eligibility
        /// rule. Returns an empty list (not null) when refinement isn't
        /// active or there is nothing to show — callers decide what an empty
        /// list means (brief §5: show unavailable, or close safely).
        /// </summary>
        public static IReadOnlyList<RefinementButtonSpec> BuildButtonSpecs(
            TagRefinementInfo tagRefinement,
            IReadOnlyCollection<string> availableCommands)
        {
            if (tagRefinement == null || !tagRefinement.Active || tagRefinement.Tags == null)
            {
                return System.Array.Empty<RefinementButtonSpec>();
            }

            var specs = new List<RefinementButtonSpec>(tagRefinement.Tags.Count + 3);
            foreach (var tag in tagRefinement.Tags)
            {
                specs.Add(new RefinementButtonSpec(
                    ActionParameter: tag.Id,
                    Kind: RefinementButtonKind.Tag,
                    Label: tag.Label,
                    Category: tag.Category,
                    State: tag.State));
            }

            var commands = availableCommands ?? System.Array.Empty<string>();
            if (commands.Contains("tagRefinement.useAllTags"))
            {
                specs.Add(new RefinementButtonSpec(AllTagsActionParameter, RefinementButtonKind.UseAllTags, "All Tags"));
            }
            if (commands.Contains("tagRefinement.clearSelected"))
            {
                // Verified against the real implementation before labeling this
                // (brief §13 explicitly requires it): tagRefinement.clearSelected
                // runs _resetRefinementSelectionToDefault(), the exact effect of
                // the real panel's "Reset Selected to Defaults" button (#rpResetBtn)
                // — it reverts to INHERITING the mapped component's defaults, which
                // may still leave some tags checked. It is NOT "no tags"/"clear all"
                // — labeling it that way would misrepresent what actually happens,
                // which is exactly the mistake §13 warns against. "Reset Tags"
                // mirrors the real button's own wording, shortened for the LCD.
                specs.Add(new RefinementButtonSpec(ResetTagsActionParameter, RefinementButtonKind.ClearSelected, "Reset Tags"));
            }
            if (commands.Contains("tagRefinement.applyToSelected"))
            {
                specs.Add(new RefinementButtonSpec(ApplyActionParameter, RefinementButtonKind.ApplyToSelected, "Apply"));
            }
            return specs;
        }

        /// <summary>
        /// The one authoritative press-to-target-state rule (brief §9) — NOT
        /// a three-state cycle. Confirmed from renderer.js's own
        /// _refinementTagDisplayState()/_setRefinementDraftTag(): a native
        /// checkbox click always resolves to a definite boolean, and an
        /// untouched "indeterminate" tag's underlying .checked is already
        /// false, so a press on it sets checked=true — same bucket as
        /// "unchecked". Only a currently-"checked" tag presses to false.
        /// </summary>
        public static bool ComputeNextChecked(string currentDisplayState) =>
            currentDisplayState != "checked";

        /// <summary>
        /// Re-validates a pressed tag's actionParameter against the CURRENT
        /// state fresh — never trusts a previously-fetched/cached button list
        /// (brief §6, §18, §19). Returns null when the id no longer exists in
        /// the live tag set — the stale-rejection case the brief requires;
        /// callers must treat null as "do nothing, log it", never fall back
        /// to a guessed tag.
        /// </summary>
        public static TagInfo ResolveTag(TagRefinementInfo tagRefinement, string tagId)
        {
            if (tagRefinement?.Tags == null || string.IsNullOrEmpty(tagId)) { return null; }
            foreach (var tag in tagRefinement.Tags)
            {
                if (tag.Id == tagId) { return tag; }
            }
            return null;
        }

        /// <summary>True for the three fixed control actions, false for anything
        /// else (including a real tag id) — the one place that distinguishes
        /// "this press is a control button" from "this press claims to be a
        /// tag", so RunCommand never has to string-match sentinels twice.</summary>
        public static bool IsControlAction(string actionParameter) =>
            actionParameter == ApplyActionParameter
            || actionParameter == AllTagsActionParameter
            || actionParameter == ResetTagsActionParameter;

        /// <summary>Simple, deterministic truncation for a small LCD key — the
        /// brief explicitly forbids replacing a real tag name with a
        /// placeholder, so this only ever shortens the REAL label (never
        /// substitutes it), and only when it is long enough that it would
        /// otherwise not fit at all. Rough character budget tied to canvas
        /// width, generous enough that normal-length labels pass through
        /// unmodified. Pure/testable — no Logitech type involved.</summary>
        public static string TruncateForDisplay(string label, int canvasWidthPixels)
        {
            if (string.IsNullOrEmpty(label)) { return label; }
            // ~1 readable character per 7px at the chosen font size, times two
            // wrapped lines worth of budget before truncating — generous on
            // purpose; real tag labels in this product are short English/
            // transliterated words, not sentences.
            var budget = System.Math.Max(8, (canvasWidthPixels / 7) * 2);
            return label.Length <= budget ? label : label.Substring(0, budget - 1) + "…";
        }
    }
}
