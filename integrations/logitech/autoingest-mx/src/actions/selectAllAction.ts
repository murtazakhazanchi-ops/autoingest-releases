import { CommandAction } from '@logitech/plugin-sdk';
import { autoIngestClient } from '../sharedClient.js';

/** Select All — maps to selection.selectAll. availableCommands-gated as a
 *  UX convenience only; AutoIngest's own canExecute() remains authoritative. */
export class SelectAllAction extends CommandAction {
  name = 'select_all';
  displayName = 'Select All';
  description = 'Selects every currently visible file in AutoIngest';

  async onKeyDown(): Promise<void> {
    const state = autoIngestClient.getLatestState();
    if (state && Array.isArray(state.availableCommands) && !state.availableCommands.includes('selection.selectAll')) {
      autoIngestClient.logMessage('debug', 'select_all: skipped — currently unavailable');
      return;
    }
    const result = await autoIngestClient.executeCommand('selection.selectAll');
    if (!result.ok) {
      autoIngestClient.logMessage('debug', `select_all: not executed (${result.reason ?? 'unknown'})`);
    }
  }
}
