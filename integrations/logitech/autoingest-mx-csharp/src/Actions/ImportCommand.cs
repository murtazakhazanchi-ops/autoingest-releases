namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;

    /// <summary>
    /// AI-FEAT MX Console Phase 4C (revised) — Import. Maps to
    /// import.openConfirmation, which dispatches a real click on AutoIngest's
    /// own #importBtn element rather than reimplementing any of its
    /// validation/confirmation logic — see commandManager.js's own doc
    /// comment on 'import.openConfirmation' for the full trace. This is
    /// deliberately NOT "start the import": AutoIngest's own real
    /// validation (missing sub-event mappings, unassigned files, duplicate
    /// sub-event mappings, photographer requirement) and its real
    /// confirmation modal both still run exactly as they do for a mouse
    /// click, requiring an explicit operator action on the computer before
    /// any file copy begins. There is no "execute import now" command in
    /// this plugin — the operator retains final confirmation authority.
    /// </summary>
    public class ImportCommand : PluginDynamicCommand
    {
        public ImportCommand()
            : base(displayName: "Import", description: "Opens AutoIngest's real Import review/confirmation flow — does not start copying files", groupName: "Browse")
        {
        }

        protected override void RunCommand(String actionParameter) =>
            ActionRunner.FireAndForget(() => GatedCommand.RunAsync("import.openConfirmation", "import_open_confirmation", requiredContext: "browse"), "import_open_confirmation");
    }
}
