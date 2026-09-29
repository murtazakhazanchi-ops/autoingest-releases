import { CommandAction } from '@logitech/plugin-sdk';
import { autoIngestClient } from '../sharedClient.js';

/**
 * Select (Toggle Selection) — one LCD key, mapped to AutoIngestCommands'
 * `selection.toggleCurrent`. Duplicates no selection rules: AutoIngest's
 * own command result is the sole authority on whether anything happened
 * (see docs/commandLayer.md). On failure (not connected, no active file,
 * etc.) this does nothing destructive — it just logs a concise reason.
 *
 * `name` stays `toggle_selection` (Phase 3A's original identity — renaming
 * it would break any existing hardware assignment); only `displayName`
 * changed, from "Toggle Selection" to "Select", to fit the Phase 3B Browse
 * page's compact keypad label.
 */
export class ToggleSelectionAction extends CommandAction {
  name = 'toggle_selection';
  displayName = 'Select';
  description = 'Selects or deselects the active file in AutoIngest';

  async onKeyDown(): Promise<void> {
    const state = autoIngestClient.getLatestState();
    if (state && Array.isArray(state.availableCommands) && !state.availableCommands.includes('selection.toggleCurrent')) {
      autoIngestClient.logMessage('debug', 'toggle_selection: skipped — currently unavailable');
      return;
    }
    const result = await autoIngestClient.executeCommand('selection.toggleCurrent');
    if (!result.ok) {
      autoIngestClient.logMessage('debug', `toggle_selection: not executed (${result.reason ?? 'unknown'})`);
    }
  }
}
