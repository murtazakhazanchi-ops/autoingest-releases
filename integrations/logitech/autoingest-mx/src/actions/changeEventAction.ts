import { CommandAction } from '@logitech/plugin-sdk';
import { autoIngestClient } from '../sharedClient.js';

/**
 * Change Event — maps to event.openChooser. Opens AutoIngest's real event
 * chooser/creator (the same modal `#ctxChangeEventBtn` opens); the operator
 * still picks the target event from the real on-screen list — this action
 * never names a target event itself, and never encodes the event list on
 * hardware (no dynamic text/list affordance exists in plugin-sdk 0.1.1 — see
 * the SDK capability matrix in docs/mxLogitechPlugin.md). The console is a
 * launcher here, not a replacement picker. See
 * docs/commandLayer.md "Change Event — event.openChooser" for why no command
 * encodes a specific target event.
 *
 * One of the two Phase 3D reserved-ninth-key candidates (see
 * docs/mxLogitechPlugin.md "Reserved ninth key evaluation") — NOT assigned
 * to any physical key by this change; registering it only makes it
 * available in the Options+ Action Picker for temporary assignment during
 * physical testing.
 */
export class ChangeEventAction extends CommandAction {
  name = 'change_event';
  displayName = 'Change Event';
  description = 'Opens the Change Event chooser in AutoIngest';

  async onKeyDown(): Promise<void> {
    const state = autoIngestClient.getLatestState();
    if (state && state.context !== 'browse') {
      autoIngestClient.logMessage('debug', `change_event: skipped — context is "${state.context}", not "browse"`);
      return;
    }
    if (state && Array.isArray(state.availableCommands) && !state.availableCommands.includes('event.openChooser')) {
      autoIngestClient.logMessage('debug', 'change_event: skipped — currently unavailable');
      return;
    }
    const result = await autoIngestClient.executeCommand('event.openChooser');
    if (!result.ok) {
      autoIngestClient.logMessage('debug', `change_event: not executed (${result.reason ?? 'unknown'})`);
    }
  }
}
