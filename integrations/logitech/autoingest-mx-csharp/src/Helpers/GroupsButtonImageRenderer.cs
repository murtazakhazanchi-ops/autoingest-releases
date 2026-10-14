namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    /// <summary>
    /// Renders one GroupsButtonSpec into an actual BitmapImage — the only
    /// file in this feature that touches BitmapBuilder/BitmapColor, same
    /// split every other Phase 4B/4C workspace uses. An existing group shows
    /// its real label plus its real file count; "+ New Group" is visually
    /// distinct (a different background) so it is never mistaken for an
    /// existing group with zero files.
    /// </summary>
    internal static class GroupsButtonImageRenderer
    {
        private static readonly BitmapColor Background = new(28, 28, 30);
        private static readonly BitmapColor NewGroupBackground = new(45, 45, 90);
        private static readonly BitmapColor TextColor = new(240, 240, 240);
        private static readonly BitmapColor CountColor = new(150, 150, 150);

        public static BitmapImage Render(GroupsButtonSpec spec, PluginImageSize imageSize)
        {
            var builder = new BitmapBuilder(imageSize);
            builder.Clear(spec.Kind == GroupsButtonKind.NewGroup ? NewGroupBackground : Background);

            var label = RefinementWorkspaceModel.TruncateForDisplay(spec.Label, builder.Width);
            builder.DrawText(label, TextColor, fontSize: 16, lineHeight: 18, spaceHeight: 2);

            if (spec.Kind == GroupsButtonKind.ExistingGroup && spec.FileCount.HasValue)
            {
                var countText = spec.FileCount.Value == 1 ? "1 file" : $"{spec.FileCount.Value} files";
                var size = System.Math.Max(10, builder.Width / 6);
                builder.DrawText(countText, 0, builder.Height - size - 2, builder.Width, size, CountColor, fontSize: size, lineHeight: size, spaceHeight: 0);
            }

            return builder.ToImage();
        }
    }
}
