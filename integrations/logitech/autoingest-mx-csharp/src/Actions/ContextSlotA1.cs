namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;

    /// <summary>
    /// AI-FEAT MX Console — Unified Contextual Keypad (production), physical
    /// slot 1 (top-left of the 3×3 Keypad grid). All nine ContextSlotA{n}
    /// classes are deliberately near-identical thin shells — every real
    /// decision (what this slot currently means, what pressing it does)
    /// lives in ContextualKeypadController, never here. Nine separate
    /// classes exist because this codebase already confirmed (the G1/G2/G3
    /// investigation, GroupSlotHelper.cs's own doc comment) that the C# SDK
    /// has no parameterized-action mechanism for operator-assignable
    /// commands — each physical Keypad position needs its own registered
    /// class.
    ///
    /// Subscribes to ContextualKeypadController.RefreshRequested and
    /// refreshes only ITSELF (via `this`) — SetCurrentState/ActionImageChanged
    /// are `protected`, confirmed via a real build failure during the
    /// Contextual Native Keypad spike that a separate class cannot call them
    /// on another instance. SetCurrentState(semanticState) keeps the SDK's
    /// own native state index in sync (brief's own instruction); the actual
    /// redraw is ActionImageChanged() — SetCurrentState alone was
    /// physically confirmed NOT to force a requery in this installed SDK.
    /// </summary>
    public class ContextSlotA1 : PluginMultistateDynamicCommand
    {
        private const int SlotIndex = 0;

        public ContextSlotA1()
            : base("Context Slot A1", "AutoIngest MX unified contextual keypad — slot 1", "Browse")
        {
            this.AddState("default", "Default");
            this.AddState("checked", "Checked");
            this.AddState("indeterminate", "Indeterminate");
            ContextualKeypadController.EnsureStarted();
            ContextualKeypadController.RefreshRequested += this.OnRefreshRequested;
        }

        private void OnRefreshRequested()
        {
            var binding = ContextualKeypadController.GetBinding(SlotIndex);
            this.SetCurrentState(binding.SemanticState);
            this.ActionImageChanged();
        }

        protected override void RunCommand(String actionParameter) =>
            ContextualKeypadController.ExecuteSlotPress(SlotIndex);

        protected override string GetCommandDisplayName(String actionParameter, Int32 stateIndex, PluginImageSize imageSize) =>
            RefinementWorkspaceModel.TruncateForDisplay(ContextualKeypadController.GetBinding(SlotIndex).Label, ImageSizeHelper.GetWidthPixels(imageSize));

        protected override BitmapImage GetCommandImage(String actionParameter, Int32 stateIndex, PluginImageSize imageSize) =>
            ContextSlotImageRenderer.Render(ContextualKeypadController.GetBinding(SlotIndex), imageSize);
    }
}
