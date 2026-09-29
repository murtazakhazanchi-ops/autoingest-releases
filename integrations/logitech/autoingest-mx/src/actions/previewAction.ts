import { CommandAction } from '@logitech/plugin-sdk';
import { autoIngestClient } from '../sharedClient.js';

/**
 * Preview — now a permanent Browse-page LCD key (Phase 3A §9 introduced it
 * as optional; Phase 3B's layout makes it a standing key), mapped to
 * `preview.toggle`. Same authority rules as Select: AutoIngest's result
 * decides, this action never guesses preview state itself.
 */
export class PreviewAction extends CommandAction {
  name = 'preview_toggle';
  displayName = 'Preview';
  description = 'Toggles the file preview overlay in AutoIngest';

  async onKeyDown(): Promise<void> {
    const state = autoIngestClient.getLatestState();
    if (state && Array.isArray(state.availableCommands) && !state.availableCommands.includes('preview.toggle')) {
      autoIngestClient.logMessage('debug', 'preview_toggle: skipped — currently unavailable');
      return;
    }
    const result = await autoIngestClient.executeCommand('preview.toggle');
    if (!result.ok) {
      autoIngestClient.logMessage('debug', `preview_toggle: not executed (${result.reason ?? 'unknown'})`);
    }
  }
}
