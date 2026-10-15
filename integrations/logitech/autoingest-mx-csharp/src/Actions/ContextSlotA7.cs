namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;

    /// <summary>AI-FEAT MX Console — Unified Contextual Keypad, slot 7
    /// (bottom-left). See ContextSlotA1's own doc comment for the full
    /// architecture explanation.</summary>
    public class ContextSlotA7 : PluginMultistateDynamicCommand
    {
        private const int SlotIndex = 6;

        public ContextSlotA7()
            : base("Context Slot A7", "AutoIngest MX unified contextual keypad — slot 7", "Browse")
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
