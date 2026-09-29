/**
 * Integration tests for the Phase 3B Browse-page group mechanism against
 * the REAL, running AutoIngest Phase 2 transport — not a second mock
 * protocol. Proves the mechanism src/groupSlotHelper.ts's
 * assignToGroupSlot() depends on is real, stable, and matches this
 * file's own assumptions: label/id are always in sync, a nonexistent
 * groupId safely creates the next sequential group, and group.unassign's
 * real side effects (Tag Refinement cleanup, badge sync — already proven
 * exhaustively by the AutoIngest repo's own Phase 1A/1B live tests, since
 * this command is unchanged) are reachable through this exact usage path.
 *
 * Architectural note on scope: the action classes (AssignG1Action etc.)
 * import the shared `autoIngestClient` singleton directly (see
 * sharedClient.ts) — a deliberate simplicity choice matching the
 * generated SDK example's own pattern, not dependency-injected. That
 * singleton always uses REAL discovery (no test homeOverride), so it
 * cannot safely be pointed at an isolated synthetic AutoIngest instance
 * without either touching real user settings or a larger DI refactor.
 * This file therefore drives a FRESH AutoIngestClient (exactly like
 * autoIngestClient.integration.test.ts does) plus the real, exported
 * resolveGroupIdByLabel() against it — the same real mechanism and real
 * pure function the action classes use, proven against the real
 * transport, while the thin action-class glue itself (mapping, gating,
 * rejection propagation) is already fully covered by
 * browseActions.unit.test.ts's mocked-client tests.
 *
 * Run: npm run test:integration
 */

import assert from 'node:assert/strict';

import { AutoIngestClient } from '../src/autoIngestClient.js';
import { resolveGroupIdByLabel } from '../src/groupSlotHelper.js';
import { launchAutoIngest, mkFakeHome, mkSyntheticCard, waitFor } from './testHarness.js';
import type { ElectronApplication } from 'playwright-core';

let passed = 0;
let failed = 0;
async function t(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL — ${name}`);
    console.error(err);
  }
}

console.log('Browse page group mechanism integration tests (real Phase 2 transport)');

const fakeHome = await mkFakeHome();
const card = await mkSyntheticCard();
let app: ElectronApplication | null = null;
let client: AutoIngestClient | null = null;

try {
  ({ app } = await launchAutoIngest(fakeHome, card));
  client = new AutoIngestClient(() => {}, fakeHome);
  await client.connect();
  await waitFor(() => client!.getConnectionState() === 'connected', 15000);
  await waitFor(() => client!.getLatestState() !== null, 5000);

  await t('select all files, so there is something real to assign', async () => {
    const result = await client!.executeCommand('selection.selectAll');
    assert.equal(result.ok, true);
    await waitFor(() => (client!.getLatestState()?.selectedCount ?? 0) >= 2, 5000);
  });

  await t('resolveGroupIdByLabel("G1") is null before any group exists — group missing behavior, real state', () => {
    const state = client!.getLatestState();
    assert.deepEqual(state?.groups, []);
    assert.equal(resolveGroupIdByLabel(state, 'G1'), null);
  });

  await t('assignToGroupSlot(1)\'s mechanism: group.assign({groupId:1}) with no existing groups creates a REAL new group labeled "G1"', async () => {
    // Exactly what groupSlotHelper.ts's assignToGroupSlot() does when
    // resolution fails: passes the slot number itself as groupId.
    const result = await client!.executeCommand('group.assign', { groupId: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.executed, true);
    await waitFor(() => (client!.getLatestState()?.groups?.length ?? 0) === 1, 5000);
    const group = client!.getLatestState()!.groups![0]!;
    assert.equal(group.label, 'G1');
    assert.equal(group.fileCount, 2);
  });

  await t('resolveGroupIdByLabel now finds the real id for "G1" from live AutoIngest state', () => {
    const state = client!.getLatestState();
    const resolvedId = resolveGroupIdByLabel(state, 'G1');
    assert.equal(resolvedId, state!.groups![0]!.id);
  });

  await t('re-selecting the same files and assigning to the RESOLVED G1 id reassigns to the existing group, not a new one', async () => {
    // selection.selectAll is a real TOGGLE (see renderer.js's
    // _selectAllVisible: if every visible file is already selected, it
    // DESELECTS them instead) — and the prior test's group.assign never
    // clears selection, so the files are still selected here. Explicitly
    // clear first so "select all" is deterministic regardless of what
    // selection state earlier tests left behind.
    //
    // The commandResult reply and the state-changed push it triggers are
    // also two INDEPENDENT messages with no ordering guarantee between
    // them (same lesson as the AutoIngest repo's own
    // test/mxControlTransportLive.test.js) — must wait for the state
    // itself to reflect each change, not just for executeCommand's own
    // promise to resolve, before trusting getLatestState() here.
    await client!.executeCommand('selection.clear');
    await waitFor(() => (client!.getLatestState()?.selectedCount ?? 0) === 0, 5000);
    await client!.executeCommand('selection.selectAll');
    await waitFor(() => (client!.getLatestState()?.selectedCount ?? 0) >= 2, 5000);
    const gid = resolveGroupIdByLabel(client!.getLatestState(), 'G1')!;
    const result = await client!.executeCommand('group.assign', { groupId: gid });
    assert.equal(result.ok, true);
    await waitFor(() => (client!.getLatestState()?.groups?.length ?? 0) === 1, 5000); // still exactly one group
    assert.equal(client!.getLatestState()!.groups![0]!.label, 'G1');
  });

  await t('unassign real round-trip: group.unassign empties and auto-removes the group (real GroupManager behavior, unchanged command)', async () => {
    // The previous test's group.assign leaves the just-assigned files
    // selected in AutoIngest (assignment doesn't clear selection — see
    // groupSlotHelper.ts's header/renderer.js's _assignSelectionToGroup),
    // but again wait for the real pushed state rather than assuming.
    await waitFor(() => (client!.getLatestState()?.selectedCount ?? 0) >= 2, 5000);
    const result = await client!.executeCommand('group.unassign');
    assert.equal(result.ok, true);
    assert.equal(result.executed, true);
    await waitFor(() => (client!.getLatestState()?.groups?.length ?? 0) === 0, 5000);
    assert.equal(resolveGroupIdByLabel(client!.getLatestState(), 'G1'), null);
  });

  await t('a fresh group created after full unassign is labeled "G1" again — id/label resync from a clean slate', async () => {
    // Same selectAll-is-a-toggle reasoning as the previous test.
    await client!.executeCommand('selection.clear');
    await waitFor(() => (client!.getLatestState()?.selectedCount ?? 0) === 0, 5000);
    await client!.executeCommand('selection.selectAll');
    await waitFor(() => (client!.getLatestState()?.selectedCount ?? 0) >= 2, 5000);
    const result = await client!.executeCommand('group.assign', { groupId: 1 });
    assert.equal(result.ok, true);
    await waitFor(() => (client!.getLatestState()?.groups?.length ?? 0) === 1, 5000);
    assert.equal(client!.getLatestState()!.groups![0]!.label, 'G1');
    assert.equal(client!.getLatestState()!.groups![0]!.id, 1);
  });
} finally {
  client?.disconnect();
  await app?.close().catch(() => {});
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
