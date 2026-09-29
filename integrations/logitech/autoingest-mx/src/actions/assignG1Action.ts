import { CommandAction } from '@logitech/plugin-sdk';
import { assignToGroupSlot } from '../groupSlotHelper.js';

/**
 * Assign G1 — one of three thin, near-identical action classes (see
 * assignG2Action.ts, assignG3Action.ts) all calling the same shared
 * assignToGroupSlot() helper. plugin-sdk 0.1.1 has no configurable/
 * parameterized action mechanism (confirmed by inspecting the full wire
 * protocol — see docs/mxLogitechPlugin.md's SDK capability matrix), so a
 * single reusable "Assign Group N" action with a configurable slot number
 * is not currently possible; three thin definitions is the correct
 * Phase 3B shape per the task brief's own fallback.
 */
export class AssignG1Action extends CommandAction {
  name = 'assign_g1';
  displayName = 'G1';
  description = 'Assigns the current selection to group G1 in AutoIngest';

  async onKeyDown(): Promise<void> {
    await assignToGroupSlot(1);
  }
}
