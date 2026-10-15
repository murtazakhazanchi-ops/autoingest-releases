namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    /// <summary>
    /// Renders one GroupsButtonSpec into an actual BitmapImage — the only
    /// file in this feature that touches BitmapBuilder/BitmapColor, same
    /// split every other Phase 4B/4C workspace uses.
    ///
    /// Revised during Phase 4C physical testing: no longer draws the group's
    /// own label/name — the SDK renders its own native caption (from
    /// GetCommandDisplayName) above this image regardless, and drawing it a
    /// second time here produced the same duplicate-name problem found on
    /// Map Group and Refine Tags (see RefinementButtonImageRenderer's own
    /// updated doc comment for the full finding). GroupsFolder.GetCommandDisplayName
    /// now truncates for that native caption instead — the single source of
    /// the name shown. This image's only remaining content is the real file
    /// count (genuinely supplementary, not a second copy of the name) for
    /// an existing group; "+ New Group" is visually distinct (a different
    /// background) so it is never mistaken for an existing group with zero
    /// files.
    /// </summary>
    internal static class GroupsButtonImageRenderer
    {
        private static readonly BitmapColor Background = new(28, 28, 30);
        private static readonly BitmapColor NewGroupBackground = new(45, 45, 90);
        private static readonly BitmapColor CountColor = new(220, 220, 220);

        public static BitmapImage Render(GroupsButtonSpec spec, PluginImageSize imageSize)
        {
            var builder = new BitmapBuilder(imageSize);
            builder.Clear(spec.Kind == GroupsButtonKind.NewGroup ? NewGroupBackground : Background);

            if (spec.Kind == GroupsButtonKind.ExistingGroup && spec.FileCount.HasValue)
            {
                var countText = spec.FileCount.Value == 1 ? "1 file" : $"{spec.FileCount.Value} files";
                // Large, centered — since it is the only thing this image
                // draws for an existing group now.
                var size = System.Math.Max(10, builder.Width / 4);
                builder.DrawText(countText, 0, (builder.Height - size) / 2, builder.Width, size, CountColor, fontSize: size, lineHeight: size, spaceHeight: 0);
            }

            return builder.ToImage();
        }
    }
}
