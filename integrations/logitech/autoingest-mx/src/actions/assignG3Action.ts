import { CommandAction } from '@logitech/plugin-sdk';
import { assignToGroupSlot } from '../groupSlotHelper.js';

/** Assign G3 — see assignG1Action.ts for the shared-helper rationale. */
export class AssignG3Action extends CommandAction {
  name = 'assign_g3';
  displayName = 'G3';
  description = 'Assigns the current selection to group G3 in AutoIngest';

  async onKeyDown(): Promise<void> {
    await assignToGroupSlot(3);
  }
}
