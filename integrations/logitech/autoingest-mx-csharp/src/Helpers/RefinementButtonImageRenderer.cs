namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    /// <summary>
    /// Renders one RefinementButtonSpec (pure data, see RefinementWorkspaceModel)
    /// into an actual BitmapImage. The ONLY file in Phase 4B that touches
    /// BitmapBuilder/BitmapColor directly — every state/identity/transition
    /// decision already happened in RefinementWorkspaceModel before a spec
    /// reaches here, matching the brief's "testable model separate from
    /// Logitech rendering" requirement (§23).
    ///
    /// Revised twice during Phase 4C physical testing:
    ///
    /// 1. This image no longer draws the label text at all. Confirmed on
    ///    real hardware that the SDK renders its own small native caption
    ///    (from GetCommandDisplayName) ABOVE this image regardless of what
    ///    this file draws — drawing the label here too produced two
    ///    independently-truncated copies of the same name on one button.
    ///    RefineTagsFolder.GetCommandDisplayName now truncates with
    ///    RefinementWorkspaceModel.TruncateForDisplay for that native
    ///    caption instead — the single source of the name shown.
    ///
    /// 2. State is now shown via the button's own BACKGROUND COLOR, not an
    ///    icon/badge — an explicit, physically-tested operator preference
    ///    to match the plain "just the tag" look of AutoIngest's other
    ///    static Keypad buttons, given directly after seeing the icon-badge
    ///    version live. All three real states remain visually distinct
    ///    (deliberately NOT collapsed to a two-color checked/unchecked
    ///    scheme, per the same explicit instruction — "mixed means some
    ///    selected files currently contain the tag and others do not,
    ///    which is semantically different from the tag being unchecked for
    ///    the whole selection"): checked = green, unchecked = the same
    ///    default/neutral background every other button uses, indeterminate
    ///    = amber/orange. Scoped to Refine Tags only per that same
    ///    instruction — Map Group/Groups keep their existing badge-based
    ///    rendering.
    /// </summary>
    internal static class RefinementButtonImageRenderer
    {
        // Base RGB values — kept as components, not pre-built BitmapColor
        // instances, so Render() can apply a per-button pixel-level
        // perturbation (see PerturbedColor's own doc comment) before
        // constructing the final color.
        private static readonly (byte R, byte G, byte B) Background = (28, 28, 30);          // default/neutral — unchecked, same as every other plain button
        private static readonly (byte R, byte G, byte B) ControlBackground = (45, 45, 90);    // visually distinct from plain tag buttons
        private static readonly (byte R, byte G, byte B) CheckedBackground = (46, 160, 67);   // solid green — applied
        private static readonly (byte R, byte G, byte B) IndeterminateBackground = (204, 136, 32); // solid amber — mixed across the selection

        public static BitmapImage Render(RefinementButtonSpec spec, PluginImageSize imageSize)
        {
            var builder = new BitmapBuilder(imageSize);
            var isControl = spec.Kind != RefinementButtonKind.Tag;
            var baseColor = isControl ? ControlBackground : TagBackgroundFor(spec.State);
            builder.Clear(PerturbedColor(baseColor, spec.ActionParameter));
            return builder.ToImage();
        }

        private static (byte R, byte G, byte B) TagBackgroundFor(string state) => state switch
        {
            "checked" => CheckedBackground,
            "indeterminate" => IndeterminateBackground,
            _ => Background, // "unchecked" (or missing/unknown — fail toward the neutral default)
        };

        /// <summary>
        /// Found during Phase 4C (revised) physical testing: once this image
        /// stopped drawing any per-button label text (brief revision 1
        /// above), two DIFFERENT buttons sharing the same state render
        /// byte-for-byte IDENTICAL images — and pressing one visibly
        /// recolored the other too, even though the plugin's own state
        /// computation was independently confirmed correct via diagnostic
        /// logging (each tag's own GetCommandImage call resolved its own
        /// correct, independent state). The SDK appears to cache/dedupe
        /// rendered images by content — the earlier label-based design
        /// never hit this because every button's text made its image
        /// unique regardless of shared state. Nudges one color channel by
        /// at most 1/255 based on a stable hash of the button's own
        /// identity (ActionParameter) — completely imperceptible to the
        /// human eye, but defeats exact-content deduplication.
        /// </summary>
        private static BitmapColor PerturbedColor((byte R, byte G, byte B) baseColor, string actionParameter)
        {
            // 0-3 per channel (64 combinations total) — still completely
            // imperceptible (at most ~1.5% change on one channel), but far
            // less likely to collide between two different real tag ids
            // than a single bit per channel would be.
            var hash = unchecked((uint)(actionParameter ?? string.Empty).GetHashCode());
            var rDelta = (byte)(hash & 0x3);
            var gDelta = (byte)((hash >> 2) & 0x3);
            var bDelta = (byte)((hash >> 4) & 0x3);
            return new BitmapColor(
                (byte)System.Math.Min(255, baseColor.R + rDelta),
                (byte)System.Math.Min(255, baseColor.G + gDelta),
                (byte)System.Math.Min(255, baseColor.B + bDelta));
        }
    }
}
