import { CommandAction } from '@logitech/plugin-sdk';
import { autoIngestClient } from '../sharedClient.js';

/**
 * Refine Tags — maps to tagRefinement.open. Enters Tag Refinement for
 * whichever scope AutoIngest itself resolves from the current selection
 * (the single-component event's EVENT_SCOPE, or the one group every selected
 * file belongs to) — this action never picks a scope itself, and never
 * constructs or guesses a tag combination; it only opens the same real
 * refinement session a mouse click would. See
 * docs/mxLogitechPlugin.md "Tag Refinement — Refine Tags action" and
 * docs/commandLayer.md "Tag Refinement commands" for the full investigation.
 *
 * One of the two Phase 3D reserved-ninth-key candidates (see
 * docs/mxLogitechPlugin.md "Reserved ninth key evaluation") — NOT assigned
 * to any physical key by this change; registering it only makes it
 * available in the Options+ Action Picker for temporary assignment during
 * physical testing.
 */
export class RefineTagsAction extends CommandAction {
  name = 'refine_tags';
  displayName = 'Refine Tags';
  description = 'Opens Tag Refinement for the current selection in AutoIngest';

  async onKeyDown(): Promise<void> {
    const state = autoIngestClient.getLatestState();
    if (state && state.context !== 'browse') {
      autoIngestClient.logMessage('debug', `refine_tags: skipped — context is "${state.context}", not "browse"`);
      return;
    }
    if (state && Array.isArray(state.availableCommands) && !state.availableCommands.includes('tagRefinement.open')) {
      autoIngestClient.logMessage('debug', 'refine_tags: skipped — currently unavailable');
      return;
    }
    const result = await autoIngestClient.executeCommand('tagRefinement.open');
    if (!result.ok) {
      autoIngestClient.logMessage('debug', `refine_tags: not executed (${result.reason ?? 'unknown'})`);
    }
  }
}
