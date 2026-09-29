import { CommandAction } from '@logitech/plugin-sdk';
import { autoIngestClient } from '../sharedClient.js';

/**
 * Preview — optional second LCD key (Phase 3A §9), mapped to
 * `preview.toggle`. Same authority rules as Toggle Selection: AutoIngest's
 * result decides, this action never guesses preview state itself.
 */
export class PreviewAction extends CommandAction {
  name = 'preview_toggle';
  displayName = 'Preview';
  description = 'Toggles the file preview overlay in AutoIngest';

  async onKeyDown(): Promise<void> {
    const result = await autoIngestClient.executeCommand('preview.toggle');
    if (!result.ok) {
      autoIngestClient.logMessage('debug', `preview_toggle: not executed (${result.reason ?? 'unknown'})`);
    }
  }
}
