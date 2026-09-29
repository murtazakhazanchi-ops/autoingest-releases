import { CommandAction } from '@logitech/plugin-sdk';
import { autoIngestClient } from '../sharedClient.js';

/** Clear — maps to selection.clear. availableCommands-gated as a UX
 *  convenience only; AutoIngest's own canExecute() remains authoritative. */
export class ClearSelectionAction extends CommandAction {
  name = 'clear_selection';
  displayName = 'Clear';
  description = 'Clears the current selection in AutoIngest';

  async onKeyDown(): Promise<void> {
    const state = autoIngestClient.getLatestState();
    if (state && Array.isArray(state.availableCommands) && !state.availableCommands.includes('selection.clear')) {
      autoIngestClient.logMessage('debug', 'clear_selection: skipped — currently unavailable');
      return;
    }
    const result = await autoIngestClient.executeCommand('selection.clear');
    if (!result.ok) {
      autoIngestClient.logMessage('debug', `clear_selection: not executed (${result.reason ?? 'unknown'})`);
    }
  }
}
