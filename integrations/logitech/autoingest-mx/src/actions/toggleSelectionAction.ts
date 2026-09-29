import { CommandAction } from '@logitech/plugin-sdk';
import { autoIngestClient } from '../sharedClient.js';

/**
 * Toggle Selection — one LCD key, mapped to AutoIngestCommands'
 * `selection.toggleCurrent`. Duplicates no selection rules: AutoIngest's
 * own command result is the sole authority on whether anything happened
 * (see docs/commandLayer.md). On failure (not connected, no active file,
 * etc.) this does nothing destructive — it just logs a concise reason.
 */
export class ToggleSelectionAction extends CommandAction {
  name = 'toggle_selection';
  displayName = 'Toggle Selection';
  description = 'Selects or deselects the active file in AutoIngest';

  async onKeyDown(): Promise<void> {
    const result = await autoIngestClient.executeCommand('selection.toggleCurrent');
    if (!result.ok) {
      autoIngestClient.logMessage('debug', `toggle_selection: not executed (${result.reason ?? 'unknown'})`);
    }
  }
}
