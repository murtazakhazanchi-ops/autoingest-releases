namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    /// <summary>
    /// Renders one GroupMappingButtonSpec (pure data, see
    /// GroupMappingWorkspaceModel) into an actual BitmapImage. The only file
    /// in this feature that touches BitmapBuilder/BitmapColor directly —
    /// same split RefinementButtonImageRenderer established for Phase 4B.
    ///
    /// Design mirrors the tag-refinement renderer's own rules (brief §9):
    /// never color-only. The current mapping gets a filled check badge
    /// (same visual language as a checked tag); a component already taken
    /// by a different group gets a small "x" badge so the operator can see
    /// why it is effectively unselectable, rather than it silently doing
    /// nothing when pressed.
    /// </summary>
    internal static class GroupMappingButtonImageRenderer
    {
        private static readonly BitmapColor Background = new(28, 28, 30);
        private static readonly BitmapColor TextColor = new(240, 240, 240);
        private static readonly BitmapColor CurrentColor = new(60, 200, 90);  // filled green badge — same as a checked tag
        private static readonly BitmapColor TakenColor = new(200, 70, 60);    // filled red "x" badge

        public static BitmapImage Render(GroupMappingButtonSpec spec, PluginImageSize imageSize)
        {
            var builder = new BitmapBuilder(imageSize);
            builder.Clear(Background);

            var label = RefinementWorkspaceModel.TruncateForDisplay(spec.Label, builder.Width);
            builder.DrawText(label, TextColor, fontSize: 16, lineHeight: 18, spaceHeight: 2);

            if (spec.Kind == GroupMappingButtonKind.Component)
            {
                DrawStateBadge(builder, spec);
            }

            return builder.ToImage();
        }

        private static void DrawStateBadge(BitmapBuilder builder, GroupMappingButtonSpec spec)
        {
            if (!spec.IsCurrent && !spec.IsTakenByOtherGroup) { return; } // plain, selectable, unmarked — nothing to draw

            var size = System.Math.Max(10, builder.Width / 5);
            var x = builder.Width - size - 2;
            var y = 2;

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
