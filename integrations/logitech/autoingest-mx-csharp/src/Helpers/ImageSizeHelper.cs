namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    /// <summary>
    /// Confirmed via reflection against the actually-installed PluginApi.dll
    /// (v6.4.2.3414), same discipline as the rest of this plugin: the real
    /// rendered pixel width <c>BitmapBuilder(imageSize)</c> actually
    /// produces is NOT the nominal name — <c>Width90</c> constructs an 80×80
    /// canvas, not 90×90; <c>Width60</c> constructs 50×50.
    ///
    /// Found during Phase 4C (revised) physical testing: every
    /// <c>GetCommandDisplayName</c> override in this plugin returned the raw,
    /// untruncated real label. Tag/group labels are short enough in
    /// practice that this never visibly overflowed in Phase 4B, but a real
    /// component folder name ("01-Ziyarat-Mawkib-Mazar e Saifee") does —
    /// the SDK renders that return value as its own separate text element
    /// from <c>GetCommandImage</c>'s own baked-in, already-correctly-
    /// truncated label, so the operator saw two different-length versions
    /// of the same name, one overflowing. This helper lets every
    /// <c>GetCommandDisplayName</c> override truncate with the exact same
    /// budget <c>GetCommandImage</c> already uses, instead of a second,
    /// untruncated copy of the real label.
    /// </summary>
    internal static class ImageSizeHelper
    {
        public static int GetWidthPixels(PluginImageSize imageSize) => imageSize switch
        {
            PluginImageSize.Width60 => 50,
            PluginImageSize.Width60Pixels => 50,
            PluginImageSize.Width90 => 80,
            PluginImageSize.Width90Pixels => 80,
            PluginImageSize.Width116 => 116,
            PluginImageSize.Width116Pixels => 116,
            PluginImageSize.PluginIcon => 256,
            // Safe default — matches this plugin's actual physical device
            // (the MX Creative Keypad renders at Width90/80px).
            _ => 80,
        };
    }
}
