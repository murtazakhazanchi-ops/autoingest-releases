import { AdjustmentAction, type AdjustmentActionExecuteEvent } from '@logitech/plugin-sdk';
import { autoIngestClient } from '../sharedClient.js';

/**
 * Navigate Files — main dial, an Adjustment (not a fake keyboard shortcut).
 * Clockwise (tick > 0) -> navigation.nextFile; counter-clockwise (tick < 0)
 * -> navigation.previousFile.
 *
 * Deliberately holds NO numeric "current file" position — the adjustment is
 * relative. AutoIngest alone determines boundaries and returns whether the
 * move actually happened (executed:true/false); this plugin never guesses.
 *
 * One detent = one command, always — no acceleration, no batching several
 * moves per detent. `event.tick`'s magnitude is intentionally ignored, only
 * its sign is used, so behavior stays predictable regardless of how the SDK
 * reports multi-detent ticks.
 */
export class NavigateFilesAction extends AdjustmentAction {
  name = 'navigate_files';
  displayName = 'Navigate Files';
  description = 'Moves the active file forward or backward in AutoIngest';
  // Phase 3B investigated AdjustmentAction's hasReset/resetCommandName as a
  // possible dial-press mechanism (real, public, JSDoc'd SDK API — see
  // docs/mxLogitechPlugin.md "Dial-press experiment"), but the physical MX
  // Creative Console's main dial has no press/click mechanism at all
  // (confirmed on real hardware) — moot regardless of SDK support. SELECT
  // stays on the keypad, per the task brief's own explicit fallback.
  hasReset = false;

  async execute(event: AdjustmentActionExecuteEvent): Promise<void> {
    if (event.tick === 0) return;
    const commandId = event.tick > 0 ? 'navigation.nextFile' : 'navigation.previousFile';
    const result = await autoIngestClient.executeCommand(commandId);
    if (!result.ok) {
      autoIngestClient.logMessage('debug', `navigate_files: ${commandId} not executed (${result.reason ?? 'unknown'})`);
    }
  }
}
