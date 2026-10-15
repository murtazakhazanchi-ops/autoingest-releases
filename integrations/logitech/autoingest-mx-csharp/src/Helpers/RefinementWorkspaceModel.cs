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
        ClearSelected,      // tagRefinement.clearSelected — "Reset Tags" (see its own doc comment below)
        SelectCurrent,      // selection.toggleCurrent — added after physical testing, see BuildButtonSpecs' doc comment
        ClearFileSelection, // selection.clear — same
        Unavailable,        // informational only, maps to no command — see BuildButtonSpecs' doc comment
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
        public const string SelectActionParameter = "__select__";
        public const string ClearSelectionActionParameter = "__clearSelection__";
        public const string UnavailableActionParameter = "__unavailable__";

        /// <summary>
        /// Builds the full, ordered button list for the current state.
        ///
        /// SELECT/CLEAR SELECTION come FIRST (added after physical testing
        /// found a real gap, not anticipated in the original design): entering
        /// refinement mode always clears the outer file-grid selection — this
        /// is pre-existing, documented AutoIngest behavior
        /// (_enterRefinementMode()'s own selectedFiles.clear(), unrelated to
        /// Phase 4B) — and the dynamic folder REPLACES the entire Keypad
        /// button grid, including the normal profile's own SELECT key.
        /// Phase 4A's own proven workflow (select files from WITHIN the
        /// refinement view, via dial+SELECT) depended on SELECT staying
        /// reachable because REFINE TAGS was a flat action back then, never
        /// taking over the Keypad. Once it became a dynamic folder, that
        /// path silently disappeared: the operator could see tags but had no
        /// way to attach them to any file. Exposing selection.toggleCurrent/
        /// selection.clear as workspace buttons restores exactly that same
        /// proven workflow — zero new AutoIngest commands, reusing the exact
        /// ones the static SelectCommand/ClearCommand actions already call.
        ///
        /// Then tags (AutoIngest's own array order — never resorted, so tag
        /// order stays stable across redraws), then Apply/All Tags/Reset Tags
        /// at the end (brief §15's own stated order for those three). Every
        /// button is included only when `availableCommands` actually allows
        /// it right now — the same availableCommands-gating rule every other
        /// action in this plugin already uses (GatedCommand), never a
        /// locally-reinvented eligibility rule. Returns an empty list (not
        /// null) when refinement isn't active or there is nothing to show —
        /// callers decide what an empty list means (brief §5: show
        /// unavailable, or close safely).
        ///
        /// Changed after physical testing (not the original design): when
        /// refinement isn't active, this returns a single informational
        /// "Unavailable" entry rather than an empty list. The original design
        /// had RefineTagsFolder call Close() reactively from a background
        /// state-push callback in this situation; physically, that produced a
        /// zombie-session bug (repeated, ineffective Close() calls while the
        /// device kept routing presses to the same stale instance, and the
        /// physical REFINE TAGS key then appeared not to open anything on the
        /// next press) — see RefineTagsFolder.cs's own doc comment. Showing a
        /// clear, inert "Unavailable" button and letting the operator use the
        /// real hardware Back button to exit is both simpler and avoids
        /// depending on a self-close mechanism that turned out not to behave
        /// as assumed from a background thread.
        /// </summary>
        public static IReadOnlyList<RefinementButtonSpec> BuildButtonSpecs(
            TagRefinementInfo tagRefinement,
            IReadOnlyCollection<string> availableCommands)
        {
            if (tagRefinement == null || !tagRefinement.Active || tagRefinement.Tags == null)
            {
                return new[] { new RefinementButtonSpec(UnavailableActionParameter, RefinementButtonKind.Unavailable, "Unavailable") };
            }

            var commands = availableCommands ?? System.Array.Empty<string>();
            var specs = new List<RefinementButtonSpec>(tagRefinement.Tags.Count + 5);
            if (commands.Contains("selection.toggleCurrent"))
            {
                specs.Add(new RefinementButtonSpec(SelectActionParameter, RefinementButtonKind.SelectCurrent, "Select"));
            }
            if (commands.Contains("selection.clear"))
            {
                specs.Add(new RefinementButtonSpec(ClearSelectionActionParameter, RefinementButtonKind.ClearFileSelection, "Clear"));
            }
            foreach (var tag in tagRefinement.Tags)
            {
                specs.Add(new RefinementButtonSpec(
                    ActionParameter: tag.Id,
                    Kind: RefinementButtonKind.Tag,
                    Label: tag.Label,
                    Category: tag.Category,
                    State: tag.State));
            }

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

        /// <summary>True for every fixed control action (Select/Clear/All
        /// Tags/Reset Tags/Apply), false for anything else (including a real
        /// tag id) — the one place that distinguishes "this press is a
        /// control button" from "this press claims to be a tag", so
        /// RunCommand never has to string-match sentinels twice.</summary>
        public static bool IsControlAction(string actionParameter) =>
            actionParameter == ApplyActionParameter
            || actionParameter == AllTagsActionParameter
            || actionParameter == ResetTagsActionParameter
            || actionParameter == SelectActionParameter
            || actionParameter == ClearSelectionActionParameter
            || actionParameter == UnavailableActionParameter;

        /// <summary>Simple, deterministic truncation for a small LCD key — the
        /// brief explicitly forbids replacing a real tag name with a
        /// placeholder, so this only ever shortens the REAL label (never
        /// substitutes it), and only when it is long enough that it would
        /// otherwise not fit at all. Pure/testable — no Logitech type
        /// involved.
        ///
        /// Corrected after physical long-label testing (brief §14) found the
        /// original version broken: it assumed ~7px/char AND that
        /// BitmapBuilder.DrawText always wraps across two lines regardless of
        /// word boundaries. Neither held up. Measured the real font via a
        /// SkiaSharp.MeasureText probe against the actually-installed
        /// PluginApi.dll (same discipline as the rest of this project — never
        /// guess at SDK behavior): ~9.3px/char at this button's fontSize (16).
        /// More importantly, DrawText only wraps at whitespace — a label with
        /// no spaces (e.g. a hyphenated keyword) renders as a single
        /// unbroken, massively overflowing line that gets clipped at both
        /// edges, confirmed by rendering it and visually inspecting the
        /// output. So a label with a real wrap point (contains a space) is
        /// still trusted for up to two lines' worth of budget (DrawText does
        /// the wrapping correctly, confirmed the same way), but a label with
        /// none only ever gets ONE line's worth before truncating — the exact
        /// case that physically overflowed.
        ///
        /// Second round, found during Phase 4C (revised) physical testing of
        /// GroupMappingButtonImageRenderer's real component/folder-name
        /// labels (e.g. "01-Ziyarat-Mawkib-Mazar e Saifee"): the first
        /// fix's "has a wrap point → grant a 2-line budget" check looked
        /// only at whether the label contained a space ANYWHERE, not
        /// whether that space survived the actual truncation cut. That
        /// label's first (and only reachable) space sits at index 23 — past
        /// the 15-character cutoff the granted budget produced — so the
        /// truncated result ("01-Ziyarat-Mawk…") had no space in it at all,
        /// landing right back in the original unbroken-overflow bug.
        /// Confirmed by rendering the actual truncated output and visually
        /// inspecting it, not guessed. Fixed: the wrap point only counts as
        /// usable when it occurs AT OR BEFORE the single-line budget — i.e.
        /// DrawText's own real first wrapped line (everything up to that
        /// space) must itself fit in one line, or granting a larger overall
        /// budget is meaningless. A label whose first word alone exceeds one
        /// line's budget now correctly falls back to the single-line
        /// budget, same as a label with no space at all.</summary>
        public static string TruncateForDisplay(string label, int canvasWidthPixels)
        {
            if (string.IsNullOrEmpty(label)) { return label; }
            // Third round, found during the same Phase 4C (revised) physical
            // round: 9.3px/char was measured against a mixed-case sample,
            // but a real capital-letter-heavy word ("Mubarak…") measures
            // ~9.8px/char — at 9.3 the resulting truncated line
            // ("Mubarak…", 78.2px) left only 1.8px of margin inside an 80px
            // canvas, which overflowed in practice (anti-aliasing/glyph
            // bounds are not pixel-exact to MeasureText's own advance
            // width). Measured several realistic component-name words
            // (SkiaSharp.MeasureText against this exact installed font) and
            // confirmed 10.5px/char keeps every wrapped line comfortably
            // under budget (~15-19px margin) without over-truncating
            // shorter labels — not guessed, verified by re-rendering both
            // real failing component names and checking their actual
            // per-line measured width before raising this constant.
            const double PixelsPerChar = 10.5;
            var perLineBudget = System.Math.Max(4, (int)(canvasWidthPixels / PixelsPerChar));
            var spaceIndex = label.IndexOf(' ');
            var hasUsableWrapPoint = spaceIndex >= 0 && spaceIndex <= perLineBudget;
            var budget = hasUsableWrapPoint ? perLineBudget * 2 : perLineBudget;
            return label.Length <= budget ? label : label.Substring(0, System.Math.Max(1, budget - 1)) + "…";
        }
    }
}
