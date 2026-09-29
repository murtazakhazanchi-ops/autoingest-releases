import { CommandAction } from '@logitech/plugin-sdk';
import { autoIngestClient } from '../sharedClient.js';

/**
 * Unassign — maps to group.unassign. The Phase 1A/1B production side
 * effects (Tag Refinement cleanup, group badge sync, Multi-Event Import
 * claim behavior where applicable) all happen inside AutoIngest's own
 * shared _unassignSelectionFromGroup() primitive that this command already
 * calls — nothing new is needed here, and this action never touches
 * GroupManager directly.
 */
export class UnassignGroupAction extends CommandAction {
  name = 'unassign_group';
  displayName = 'Unassign';
  description = 'Removes the current selection from its group in AutoIngest';

  async onKeyDown(): Promise<void> {
    const state = autoIngestClient.getLatestState();
    if (state && state.context !== 'browse') {
      autoIngestClient.logMessage('debug', `unassign_group: skipped — context is "${state.context}", not "browse"`);
      return;
    }
    if (state && Array.isArray(state.availableCommands) && !state.availableCommands.includes('group.unassign')) {
      autoIngestClient.logMessage('debug', 'unassign_group: skipped — currently unavailable');
      return;
    }
    const result = await autoIngestClient.executeCommand('group.unassign');
    if (!result.ok) {
      autoIngestClient.logMessage('debug', `unassign_group: not executed (${result.reason ?? 'unknown'})`);
    }
  }
}
