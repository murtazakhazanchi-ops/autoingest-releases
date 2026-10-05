namespace Loupedeck.AutoIngestMxCsDevPlugin
{
    using System;

    /// <summary>Refine Tags — maps to tagRefinement.open. C# parity port of
    /// refineTagsAction.ts. Enters Tag Refinement for whichever scope
    /// AutoIngest itself resolves from the current selection — never picks a
    /// scope itself, never constructs or guesses a tag combination.
    /// Context-gated to "browse". Dynamic per-tag state
    /// (tagRefinement.setTagState/applyToSelected, PluginDynamicFolder) is
    /// explicitly Phase 4B scope, not this parity phase — see
    /// docs/mxLogitechCSharp.md.</summary>
    public class RefineTagsCommand : PluginDynamicCommand
    {
        public RefineTagsCommand()
            : base(displayName: "Refine Tags", description: "Opens Tag Refinement for the current selection in AutoIngest", groupName: "Browse")
        {
        }

        protected override void RunCommand(String actionParameter) =>
            ActionRunner.FireAndForget(() => GatedCommand.RunAsync("tagRefinement.open", "refine_tags", requiredContext: "browse"), "refine_tags");
    }
}
