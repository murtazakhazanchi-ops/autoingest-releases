import { CommandAction } from '@logitech/plugin-sdk';
import { assignToGroupSlot } from '../groupSlotHelper.js';

/** Assign G2 — see assignG1Action.ts for the shared-helper rationale. */
export class AssignG2Action extends CommandAction {
  name = 'assign_g2';
  displayName = 'G2';
  description = 'Assigns the current selection to group G2 in AutoIngest';

  async onKeyDown(): Promise<void> {
    await assignToGroupSlot(2);
  }
}
