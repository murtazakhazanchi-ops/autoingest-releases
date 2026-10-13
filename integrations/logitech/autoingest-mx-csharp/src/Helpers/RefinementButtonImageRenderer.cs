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
    /// Design (brief §7/§8): label is the most important information, so it
    /// gets the full canvas width; the state indicator is a small, high-
    /// contrast badge in the top-right corner — never color-only (brief
    /// explicitly rules out "subtle color differences alone"). Checked =
    /// filled circle with a check mark; unchecked = a plain outlined ring
    /// (neutral, clearly "off"); indeterminate = a filled dash/bar badge,
    /// visually distinct from both. Simple, flat shapes only — no decorative
    /// complexity, per the brief's own instruction.
    /// </summary>
    internal static class RefinementButtonImageRenderer
    {
        // High-contrast, colorblind-safe-ish palette — shape carries the
        // meaning, color is secondary reinforcement only.
        private static readonly BitmapColor Background = new(28, 28, 30);
        private static readonly BitmapColor ControlBackground = new(45, 45, 90); // visually distinct from plain tag buttons
        private static readonly BitmapColor TextColor = new(240, 240, 240);
        private static readonly BitmapColor CheckedColor = new(60, 200, 90);     // filled green badge
        private static readonly BitmapColor IndeterminateColor = new(230, 170, 40); // filled amber badge
        private static readonly BitmapColor UncheckedRing = new(120, 120, 120);  // neutral outline only

        public static BitmapImage Render(RefinementButtonSpec spec, PluginImageSize imageSize)
        {
            var builder = new BitmapBuilder(imageSize);
            var isControl = spec.Kind != RefinementButtonKind.Tag;
            builder.Clear(isControl ? ControlBackground : Background);

            var label = RefinementWorkspaceModel.TruncateForDisplay(spec.Label, builder.Width);
            // Centered, wrapping label filling the canvas — the non-positioned
            // DrawText overload centers automatically; width/height are
            // implicit from the canvas itself, so no manual centering math is
            // needed or risked going wrong.
            builder.DrawText(label, TextColor, fontSize: 16, lineHeight: 18, spaceHeight: 2);

            if (!isControl)
            {
                DrawStateBadge(builder, spec.State);
            }

            return builder.ToImage();
        }

        private static void DrawStateBadge(BitmapBuilder builder, string state)
        {
            // Small square badge, top-right corner, ~22% of the canvas width —
            // large enough to read on a small LCD key, small enough to never
            // cover the label text underneath it.
            var size = System.Math.Max(10, builder.Width / 5);
            var x = builder.Width - size - 2;
            var y = 2;

            switch (state)
            {
                case "checked":
                    builder.DrawText("✓", x, y, size, size, CheckedColor, fontSize: size, lineHeight: size, spaceHeight: 0);
                    break;
                case "indeterminate":
                    builder.DrawText("—", x, y, size, size, IndeterminateColor, fontSize: size, lineHeight: size, spaceHeight: 0);
                    break;
                default: // "unchecked" (or missing/unknown — fail toward the neutral/off rendering)
                    builder.DrawText("○", x, y, size, size, UncheckedRing, fontSize: size, lineHeight: size, spaceHeight: 0);
                    break;
            }
        }

    }
}
