namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    /// <summary>
    /// AI-FEAT MX Console — Unified Contextual Keypad. Renders one
    /// ContextSlotBinding into an actual BitmapImage — the only file in
    /// this feature that touches BitmapBuilder/BitmapColor. No label text
    /// drawn here — the SDK's own native caption (GetCommandDisplayName)
    /// is the single source of the displayed name, same lesson Phase 4C's
    /// physical testing already established for Refine Tags (drawing it in
    /// both places produced two independently-truncated copies of the same
    /// name). This image draws only the semantic-state background color —
    /// default/checked/indeterminate — plus a distinct background for a
    /// Blank slot so an unused position is visibly, unambiguously inert.
    /// </summary>
    internal static class ContextSlotImageRenderer
    {
        private static readonly BitmapColor Default = new(28, 28, 30);
        private static readonly BitmapColor Checked = new(46, 160, 67);
        private static readonly BitmapColor Indeterminate = new(204, 136, 32);
        private static readonly BitmapColor BlankBackground = new(16, 16, 17); // visibly darker/flatter than Default — unambiguously inert

        public static BitmapImage Render(ContextSlotBinding binding, PluginImageSize imageSize)
        {
            var builder = new BitmapBuilder(imageSize);
            builder.Clear(binding.Role == SlotRole.Blank ? BlankBackground : ColorFor(binding.SemanticState));
            return builder.ToImage();
        }

        private static BitmapColor ColorFor(int semanticState) => semanticState switch
        {
            1 => Checked,
            2 => Indeterminate,
            _ => Default,
        };
    }
}
