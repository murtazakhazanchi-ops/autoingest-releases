namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    /// <summary>
    /// Renders one GroupMappingButtonSpec (pure data, see
    /// GroupMappingWorkspaceModel) into an actual BitmapImage. The only file
    /// in this feature that touches BitmapBuilder/BitmapColor directly —
    /// same split RefinementButtonImageRenderer established for Phase 4B.
    ///
    /// Revised during Phase 4C physical testing: no longer draws the label
    /// text — the SDK renders its own native caption (from
    /// GetCommandDisplayName) above this image regardless, and drawing the
    /// label a second time here produced two independently-truncated
    /// copies of the same real component name, confirmed overflowing on
    /// real hardware (see RefinementButtonImageRenderer's own updated doc
    /// comment for the full finding). GroupMappingFolder.GetCommandDisplayName
    /// now truncates for that native caption instead — the single source of
    /// the name shown. This image's only remaining job is the state badge:
    /// a filled check for the current mapping (same visual language as a
    /// checked tag), a filled "x" for a component already taken by a
    /// different group (so the operator can see why it is effectively
    /// unselectable, rather than it silently doing nothing when pressed),
    /// never color-only (brief §9).
    /// </summary>
    internal static class GroupMappingButtonImageRenderer
    {
        private static readonly BitmapColor Background = new(28, 28, 30);
        private static readonly BitmapColor CurrentColor = new(60, 200, 90);  // filled green badge — same as a checked tag
        private static readonly BitmapColor TakenColor = new(200, 70, 60);    // filled red "x" badge

        public static BitmapImage Render(GroupMappingButtonSpec spec, PluginImageSize imageSize)
        {
            var builder = new BitmapBuilder(imageSize);
            builder.Clear(Background);

            if (spec.Kind == GroupMappingButtonKind.Component)
            {
                DrawStateBadge(builder, spec);
            }

            return builder.ToImage();
        }

        private static void DrawStateBadge(BitmapBuilder builder, GroupMappingButtonSpec spec)
        {
            if (!spec.IsCurrent && !spec.IsTakenByOtherGroup) { return; } // plain, selectable, unmarked — nothing to draw

            // Large, centered badge — ~60% of the canvas's shorter side —
            // since the name itself is shown once, by the SDK's own native
            // caption, not here.
            var size = System.Math.Min(builder.Width, builder.Height) * 3 / 5;
            var x = (builder.Width - size) / 2;
            var y = (builder.Height - size) / 2;

            if (spec.IsCurrent)
            {
                builder.DrawText("✓", x, y, size, size, CurrentColor, fontSize: size, lineHeight: size, spaceHeight: 0);
            }
            else // IsTakenByOtherGroup
            {
                builder.DrawText("✕", x, y, size, size, TakenColor, fontSize: size, lineHeight: size, spaceHeight: 0);
            }
        }
    }
}
