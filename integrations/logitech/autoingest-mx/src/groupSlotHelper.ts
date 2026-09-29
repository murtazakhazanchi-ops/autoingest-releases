/**
 * groupSlotHelper.ts — resolves a keypad "G1"/"G2"/"G3" slot to AutoIngest's
 * real group id, and issues the group.assign command through it. Shared by
 * the three thin Assign-G{n} actions (see "Group label resolution" in
 * docs/mxLogitechPlugin.md for why three actions exist instead of one
 * configurable one).
 *
 * Label resolution, not a hardcoded id: renderer/groupManager.js's own
 * header comment documents `id` as a MUTABLE display/order identity,
 * renumbered on every removeGroup() — but `createGroup()` and
 * removeGroup()'s renumbering always keep `label` in lockstep as `G${id}`
 * (verified by reading groupManager.js directly), so "the group currently
 * labeled G1" and "the group whose id is 1" are always the same group at
 * any given moment. Resolving by label (from AutoIngest's own pushed
 * state) rather than assuming a fixed id is still the correct approach:
 * it reads what AutoIngest actually reports rather than encoding this
 * invariant into the plugin, and costs nothing extra.
 *
 * If the labeled slot does not exist yet: this plugin does NOT invent new
 * grouping semantics. AutoIngestCommands' existing `group.assign` already
 * safely expresses "assign to this existing group, or create-and-assign
 * the next sequential one" — this is the EXACT same behavior the real
 * Cmd+G digit-chord already has (renderer.js's own chord handler shows its
 * toast using whatever group id assignment actually returned, not the
 * digit pressed — see the "Known gap" note in docs/mxLogitechPlugin.md).
 * No new AutoIngest command was needed or added for Phase 3B.
 */

import { autoIngestClient } from './sharedClient.js';
import type { AutoIngestState } from './autoIngestClient.js';

/** Finds the real, current groupId for a "G<n>" label from AutoIngest's own
 *  pushed state. Returns null if no such group currently exists — the
 *  caller decides what to do (see assignToGroupSlot below). */
export function resolveGroupIdByLabel(state: AutoIngestState | null, label: string): number | null {
  if (!state || !Array.isArray(state.groups)) return null;
  const found = state.groups.find((g) => g.label === label);
  return found ? found.id : null;
}

/**
 * Assigns the current selection to the group labeled "G<slotNumber>".
 * - Context-gated (UX convenience only, never authoritative — AutoIngest's
 *   own check() still runs server-side regardless).
 * - availableCommands-gated the same way.
 * - If the slot doesn't currently exist, passes the slot number itself as
 *   groupId anyway: AutoIngestCommands' group.assign treats any
 *   nonexistent groupId identically to omitting it (both fall through to
 *   "create the next sequential group") — see the file header. This is
 *   NOT guaranteed to create a group actually labeled G<slotNumber> if
 *   slots are filled out of order; that is existing, authoritative
 *   AutoIngest behavior (the same as the keyboard chord), not a plugin
 *   defect — documented in docs/mxLogitechPlugin.md.
 */
export async function assignToGroupSlot(slotNumber: number): Promise<void> {
  const label = `G${slotNumber}`;
  const state = autoIngestClient.getLatestState();

  if (state && state.context !== 'browse') {
    autoIngestClient.logMessage('debug', `assign_${label}: skipped — context is "${state.context}", not "browse"`);
    return;
  }
  if (state && Array.isArray(state.availableCommands) && !state.availableCommands.includes('group.assign')) {
    autoIngestClient.logMessage('debug', `assign_${label}: skipped — group.assign currently unavailable`);
    return;
  }

  const resolvedId = resolveGroupIdByLabel(state, label);
  const targetGroupId = resolvedId ?? slotNumber;
  const result = await autoIngestClient.executeCommand('group.assign', { groupId: targetGroupId });
  if (!result.ok) {
    autoIngestClient.logMessage('debug', `assign_${label}: not executed (${result.reason ?? 'unknown'})`);
  }
}
