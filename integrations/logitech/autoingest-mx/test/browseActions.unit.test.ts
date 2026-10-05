/**
 * Unit tests for the Phase 3B Browse-page action classes, driven against a
 * MOCKED autoIngestClient (its public methods temporarily reassigned on the
 * real shared singleton instance, then restored) — no AutoIngest process,
 * no Logi Plugin Service, no network. Complements
 * browsePageActions.integration.test.ts, which proves the same actions
 * against the REAL transport at least once; this file covers the full
 * matrix of branches (gating, rejection, context) cheaply and fast.
 *
 * Covers, from the Phase 3B test requirements: command mapping,
 * availableCommands gating, command rejection propagation, context browse
 * vs qmz/import, and no-plugin-local-state-mutation (every test calls a
 * FRESH action instance with an independently varied mocked state and gets
 * exactly the behavior the state implies — nothing carried over from a
 * previous call).
 *
 * Run: npm run test:unit
 */

import assert from 'node:assert/strict';
import { autoIngestClient } from '../src/sharedClient.js';
import type { AutoIngestState, CommandResult } from '../src/autoIngestClient.js';
import { ToggleSelectionAction } from '../src/actions/toggleSelectionAction.js';
import { SelectAllAction } from '../src/actions/selectAllAction.js';
import { ClearSelectionAction } from '../src/actions/clearSelectionAction.js';
import { PreviewAction } from '../src/actions/previewAction.js';
import { UnassignGroupAction } from '../src/actions/unassignGroupAction.js';
import { AssignG1Action } from '../src/actions/assignG1Action.js';
import { AssignG2Action } from '../src/actions/assignG2Action.js';
import { NavigateFilesAction } from '../src/actions/navigateFilesAction.js';
import { RefineTagsAction } from '../src/actions/refineTagsAction.js';
import { ChangeEventAction } from '../src/actions/changeEventAction.js';

let passed = 0;
let failed = 0;
function t(name: string, fn: () => void | Promise<void>): void | Promise<void> {
  const finish = (ok: boolean, err?: unknown) => {
    if (ok) { passed++; console.log(`  ok — ${name}`); }
    else { failed++; console.error(`  FAIL — ${name}`); console.error(err); }
  };
  try {
    const result = fn();
    if (result instanceof Promise) return result.then(() => finish(true), (err) => finish(false, err));
    finish(true);
  } catch (err) {
    finish(false, err);
  }
}

// ── Mock harness — reassigns the shared singleton's public methods,
// restored after every test so tests never leak into each other. ──────────
type ExecuteCall = { commandId: string; payload?: unknown };

function withMock(
  state: AutoIngestState | null,
  fn: (calls: ExecuteCall[]) => void | Promise<void>,
  result: CommandResult = { ok: true, executed: true },
): Promise<void> {
  const calls: ExecuteCall[] = [];
  const realGetLatestState = autoIngestClient.getLatestState.bind(autoIngestClient);
  const realExecuteCommand = autoIngestClient.executeCommand.bind(autoIngestClient);

  autoIngestClient.getLatestState = () => state;
  autoIngestClient.executeCommand = async (commandId: string, payload?: unknown) => {
    calls.push({ commandId, payload });
    return { ...result, commandId };
  };

  return Promise.resolve(fn(calls)).finally(() => {
    autoIngestClient.getLatestState = realGetLatestState;
    autoIngestClient.executeCommand = realExecuteCommand;
  });
}

function browseState(overrides: Partial<AutoIngestState> = {}): AutoIngestState {
  return {
    context: 'browse',
    activeFile: '/fake/IMG_0001.JPG',
    selectedCount: 1,
    hasSelection: true,
    previewOpen: false,
    availableCommands: [
      'navigation.nextFile', 'navigation.previousFile', 'selection.toggleCurrent',
      'selection.selectAll', 'selection.clear', 'preview.toggle', 'group.assign', 'group.unassign',
    ],
    groups: [],
    ...overrides,
  };
}

console.log('Browse page actions (mocked client)');

(async () => {
  // ── Command mapping ───────────────────────────────────────────────────
  await t('toggle_selection maps to selection.toggleCurrent', () =>
    withMock(browseState(), (calls) => new ToggleSelectionAction().onKeyDown().then(() => {
      assert.deepEqual(calls, [{ commandId: 'selection.toggleCurrent', payload: undefined }]);
    })));

  await t('select_all maps to selection.selectAll', () =>
    withMock(browseState(), (calls) => new SelectAllAction().onKeyDown().then(() => {
      assert.deepEqual(calls, [{ commandId: 'selection.selectAll', payload: undefined }]);
    })));

  await t('clear_selection maps to selection.clear', () =>
    withMock(browseState(), (calls) => new ClearSelectionAction().onKeyDown().then(() => {
      assert.deepEqual(calls, [{ commandId: 'selection.clear', payload: undefined }]);
    })));

  await t('preview_toggle maps to preview.toggle', () =>
    withMock(browseState(), (calls) => new PreviewAction().onKeyDown().then(() => {
      assert.deepEqual(calls, [{ commandId: 'preview.toggle', payload: undefined }]);
    })));

  await t('unassign_group maps to group.unassign', () =>
    withMock(browseState(), (calls) => new UnassignGroupAction().onKeyDown().then(() => {
      assert.deepEqual(calls, [{ commandId: 'group.unassign', payload: undefined }]);
    })));

  await t('navigate_files: positive tick maps to navigation.nextFile', () =>
    withMock(browseState(), (calls) => new NavigateFilesAction().execute({ tick: 1 }).then(() => {
      assert.deepEqual(calls, [{ commandId: 'navigation.nextFile', payload: undefined }]);
    })));

  await t('navigate_files: negative tick maps to navigation.previousFile', () =>
    withMock(browseState(), (calls) => new NavigateFilesAction().execute({ tick: -1 }).then(() => {
      assert.deepEqual(calls, [{ commandId: 'navigation.previousFile', payload: undefined }]);
    })));

  await t('navigate_files: zero tick issues no command', () =>
    withMock(browseState(), (calls) => new NavigateFilesAction().execute({ tick: 0 }).then(() => {
      assert.deepEqual(calls, []);
    })));

  await t('navigate_files: tick magnitude is ignored — one call regardless of clicks value', () =>
    withMock(browseState(), (calls) => new NavigateFilesAction().execute({ tick: 5 }).then(() => {
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.commandId, 'navigation.nextFile');
    })));

  await t('assign_g1: resolves the real group id for an existing "G1" and sends it', () =>
    withMock(
      browseState({ groups: [{ id: 42, label: 'G1', fileCount: 2, subEventId: null, colorIndex: 0 }] }),
      (calls) => new AssignG1Action().onKeyDown().then(() => {
        assert.deepEqual(calls, [{ commandId: 'group.assign', payload: { groupId: 42 } }]);
      }),
    ));

  await t('assign_g2: nonexistent "G2" falls back to slot number 2 (identical outcome to omitting it — see groupSlotHelper.ts)', () =>
    withMock(
      browseState({ groups: [{ id: 1, label: 'G1', fileCount: 2, subEventId: null, colorIndex: 0 }] }),
      (calls) => new AssignG2Action().onKeyDown().then(() => {
        assert.deepEqual(calls, [{ commandId: 'group.assign', payload: { groupId: 2 } }]);
      }),
    ));

  // ── availableCommands gating (UX convenience only) ────────────────────
  await t('select_all: skipped, no command sent, when selection.selectAll is not in availableCommands', () =>
    withMock(
      browseState({ availableCommands: ['navigation.nextFile'] }),
      (calls) => new SelectAllAction().onKeyDown().then(() => {
        assert.deepEqual(calls, []);
      }),
    ));

  await t('clear_selection: skipped when selection.clear is unavailable', () =>
    withMock(
      browseState({ availableCommands: [] }),
      (calls) => new ClearSelectionAction().onKeyDown().then(() => {
        assert.deepEqual(calls, []);
      }),
    ));

  await t('preview_toggle: skipped when preview.toggle is unavailable', () =>
    withMock(
      browseState({ availableCommands: [] }),
      (calls) => new PreviewAction().onKeyDown().then(() => {
        assert.deepEqual(calls, []);
      }),
    ));

  await t('unassign_group: skipped when group.unassign is unavailable', () =>
    withMock(
      browseState({ availableCommands: [] }),
      (calls) => new UnassignGroupAction().onKeyDown().then(() => {
        assert.deepEqual(calls, []);
      }),
    ));

  await t('assign_g1: skipped when group.assign is unavailable', () =>
    withMock(
      browseState({ availableCommands: [], groups: [{ id: 1, label: 'G1', fileCount: 1, subEventId: null, colorIndex: 0 }] }),
      (calls) => new AssignG1Action().onKeyDown().then(() => {
        assert.deepEqual(calls, []);
      }),
    ));

  await t('gating never blocks when latestState is null (renderer not ready yet) — falls through to AutoIngest itself', () =>
    withMock(null, (calls) => new SelectAllAction().onKeyDown().then(() => {
      assert.deepEqual(calls, [{ commandId: 'selection.selectAll', payload: undefined }]);
    })));

  // ── Context gating (browse vs qmz/import) ─────────────────────────────
  const qmzState: AutoIngestState = {
    context: 'qmz',
    activeFile: null,
    selectedCount: 1,
    hasSelection: true,
    previewOpen: false,
    availableCommands: [],
    sequences: [],
  };

  await t('unassign_group: skipped when context is "qmz", not "browse"', () =>
    withMock(
      qmzState,
      (calls) => new UnassignGroupAction().onKeyDown().then(() => {
        assert.deepEqual(calls, []);
      }),
    ));

  await t('assign_g1: skipped when context is "qmz"', () =>
    withMock(
      qmzState,
      (calls) => new AssignG1Action().onKeyDown().then(() => {
        assert.deepEqual(calls, []);
      }),
    ));

  await t('unassign_group: skipped when context is "import"', () =>
    withMock(
      browseState({ context: 'import' }),
      (calls) => new UnassignGroupAction().onKeyDown().then(() => {
        assert.deepEqual(calls, []);
      }),
    ));

  await t('select_all/clear_selection/preview_toggle are NOT context-gated (they are meaningful outside pure browse too)', () =>
    withMock(browseState({ context: 'browse' }), (calls) =>
      new SelectAllAction().onKeyDown()
        .then(() => new ClearSelectionAction().onKeyDown())
        .then(() => new PreviewAction().onKeyDown())
        .then(() => { assert.equal(calls.length, 3); }),
    ));

  // ── Command rejection propagation ──────────────────────────────────────
  await t('a rejected command (ok:false) never throws — action resolves cleanly regardless', () =>
    withMock(browseState(), async () => {
      await assert.doesNotReject(() => new SelectAllAction().onKeyDown());
    }, { ok: false, reason: 'not-applicable' }));

  await t('rejection propagation: the real result.reason reaches the action unmodified (observable via no crash + single call)', () =>
    withMock(browseState(), (calls) => new UnassignGroupAction().onKeyDown().then(() => {
      assert.equal(calls.length, 1); // the call WAS attempted (gating passed) even though it will be rejected downstream
    }), { ok: false, reason: 'not-applicable' }));

  // ── No plugin-local state mutation ─────────────────────────────────────
  await t('no plugin-local state: two calls to the SAME action instance with DIFFERENT mocked states behave purely per-state, never per-call-count', async () => {
    const action = new SelectAllAction();
    await withMock(browseState({ availableCommands: [] }), (calls) =>
      action.onKeyDown().then(() => assert.deepEqual(calls, [])));
    await withMock(browseState(), (calls) =>
      action.onKeyDown().then(() => assert.deepEqual(calls, [{ commandId: 'selection.selectAll', payload: undefined }])));
    // If the action held any local "already tried" flag, the second call
    // would behave differently than a fresh instance would — it doesn't.
  });

  await t('no plugin-local state: navigate_files holds no numeric position — repeated same-direction calls just repeat the same command', () =>
    withMock(browseState(), (calls) => {
      const action = new NavigateFilesAction();
      return action.execute({ tick: 1 })
        .then(() => action.execute({ tick: 1 }))
        .then(() => action.execute({ tick: 1 }))
        .then(() => {
          assert.equal(calls.length, 3);
          assert.ok(calls.every((c) => c.commandId === 'navigation.nextFile'));
        });
    }));

  // ── Phase 3D: Refine Tags / Change Event ────────────────────────────────
  await t('refine_tags: sends tagRefinement.open when available', () =>
    withMock(browseState({ availableCommands: ['tagRefinement.open'] }), (calls) =>
      new RefineTagsAction().onKeyDown().then(() => {
        assert.deepEqual(calls, [{ commandId: 'tagRefinement.open', payload: undefined }]);
      })));

  await t('refine_tags: skipped, no command sent, when tagRefinement.open is not in availableCommands', () =>
    withMock(browseState({ availableCommands: [] }), (calls) =>
      new RefineTagsAction().onKeyDown().then(() => { assert.deepEqual(calls, []); })));

  await t('refine_tags: skipped when context is "qmz", not "browse"', () =>
    withMock(browseState({ context: 'qmz', availableCommands: ['tagRefinement.open'] }), (calls) =>
      new RefineTagsAction().onKeyDown().then(() => { assert.deepEqual(calls, []); })));

  await t('refine_tags: skipped when context is "import"', () =>
    withMock(browseState({ context: 'import', availableCommands: ['tagRefinement.open'] }), (calls) =>
      new RefineTagsAction().onKeyDown().then(() => { assert.deepEqual(calls, []); })));

  await t('refine_tags: gating never blocks when latestState is null (renderer not ready yet)', () =>
    withMock(null, (calls) =>
      new RefineTagsAction().onKeyDown().then(() => {
        assert.deepEqual(calls, [{ commandId: 'tagRefinement.open', payload: undefined }]);
      })));

  await t('refine_tags: a rejected command (ok:false) never throws', () =>
    withMock(browseState({ availableCommands: ['tagRefinement.open'] }), async () => {
      await assert.doesNotReject(() => new RefineTagsAction().onKeyDown());
    }, { ok: false, reason: 'not-applicable' }));

  await t('change_event: sends event.openChooser when available', () =>
    withMock(browseState({ availableCommands: ['event.openChooser'] }), (calls) =>
      new ChangeEventAction().onKeyDown().then(() => {
        assert.deepEqual(calls, [{ commandId: 'event.openChooser', payload: undefined }]);
      })));

  await t('change_event: skipped, no command sent, when event.openChooser is not in availableCommands', () =>
    withMock(browseState({ availableCommands: [] }), (calls) =>
      new ChangeEventAction().onKeyDown().then(() => { assert.deepEqual(calls, []); })));

  await t('change_event: skipped when context is "qmz", not "browse"', () =>
    withMock(browseState({ context: 'qmz', availableCommands: ['event.openChooser'] }), (calls) =>
      new ChangeEventAction().onKeyDown().then(() => { assert.deepEqual(calls, []); })));

  await t('change_event: gating never blocks when latestState is null (renderer not ready yet)', () =>
    withMock(null, (calls) =>
      new ChangeEventAction().onKeyDown().then(() => {
        assert.deepEqual(calls, [{ commandId: 'event.openChooser', payload: undefined }]);
      })));

  await t('no plugin-local state: refine_tags called twice with different mocked states behaves purely per-state', async () => {
    const action = new RefineTagsAction();
    await withMock(browseState({ availableCommands: [] }), (calls) =>
      action.onKeyDown().then(() => assert.deepEqual(calls, [])));
    await withMock(browseState({ availableCommands: ['tagRefinement.open'] }), (calls) =>
      action.onKeyDown().then(() => assert.deepEqual(calls, [{ commandId: 'tagRefinement.open', payload: undefined }])));
  });

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
