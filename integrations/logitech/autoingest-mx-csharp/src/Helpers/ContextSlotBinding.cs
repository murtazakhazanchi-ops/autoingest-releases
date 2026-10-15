namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    /// <summary>
    /// AI-FEAT MX Console — Unified Contextual Keypad. The one binding shape
    /// every physical slot renders from, regardless of which
    /// ContextualKeypadMode currently owns it. Pure data — no Logitech type
    /// involved, fully unit-testable, same discipline every pure model in
    /// this project already follows.
    ///
    /// SemanticState (0=default/unchecked, 1=checked/green,
    /// 2=indeterminate/amber) is only meaningful for Role.Tag and
    /// Role.Component — every other role always renders default/neutral;
    /// state is never color-only on its own (the label is always shown too,
    /// via the SDK's own native caption — see each ContextSlotN's doc
    /// comment).
    /// </summary>
    public enum SlotRole
    {
        Blank,          // inert — renders empty, does nothing when pressed
        StaticAction,   // G1/G2/G3, Change Event, Import — unchanged existing commands
        ModeEntry,      // GROUPS / MAP GROUP / REFINE TAGS — enters that contextual mode
        BackWithPage,   // exits the current contextual mode back to Browse; label shows "BACK" + page indicator
        AllTags,
        Reset,
        Apply,
        CloseRefine,    // RefineTags only — calls tagRefinement.close (the real on-screen panel's own "Done Refining"); distinct from BACK, which never touches AutoIngest's own session
        Tag,
        Group,
        Component,
    }

    public sealed record ContextSlotBinding(
        SlotRole Role,
        string Label,
        string Payload,
        int SemanticState = 0,
        bool Enabled = true)
    {
        // Found during physical migration: an empty-string GetCommandDisplayName
        // does NOT render as blank — the SDK falls back to the command's own
        // static display name (e.g. "Context Slot A3") instead. A single
        // space suppresses that fallback while still looking empty on the
        // physical key.
        public static readonly ContextSlotBinding Blank = new(SlotRole.Blank, " ", null, 0, Enabled: false);
    }
}
