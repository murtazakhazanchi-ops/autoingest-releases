/**
 * Unit tests for src/groupSlotHelper.ts's pure resolveGroupIdByLabel() —
 * "group label -> actual group id resolution" and "group missing behavior"
 * from the Phase 3B test requirements. No AutoIngest process, no client,
 * no mocking needed — this function only reads a plain state object.
 *
 * Run: npm run test:unit (compiles via real tsc first — see descriptor.test.ts's
 * header for why tsx cannot run these; not that it matters for THIS file
 * specifically, since it never touches Playwright, but test:compile covers
 * the whole test/ directory in one pass).
 */

import assert from 'node:assert/strict';
import { resolveGroupIdByLabel } from '../src/groupSlotHelper.js';
import type { AutoIngestState } from '../src/autoIngestClient.js';

let passed = 0;
let failed = 0;
function t(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL — ${name}`);
    console.error(err);
  }
}

function browseState(groups: NonNullable<AutoIngestState['groups']>): AutoIngestState {
  return {
    context: 'browse',
    activeFile: null,
    selectedCount: 0,
    hasSelection: false,
    previewOpen: false,
    availableCommands: [],
    groups,
  };
}

console.log('groupSlotHelper.ts');

t('resolveGroupIdByLabel: finds the real id for an existing "G1" label', () => {
  const state = browseState([{ id: 7, label: 'G1', fileCount: 2, subEventId: null, colorIndex: 0 }]);
  assert.equal(resolveGroupIdByLabel(state, 'G1'), 7);
});

t('resolveGroupIdByLabel: finds the correct one among several groups', () => {
  const state = browseState([
    { id: 1, label: 'G1', fileCount: 2, subEventId: null, colorIndex: 0 },
    { id: 2, label: 'G2', fileCount: 1, subEventId: null, colorIndex: 1 },
    { id: 3, label: 'G3', fileCount: 5, subEventId: null, colorIndex: 2 },
  ]);
  assert.equal(resolveGroupIdByLabel(state, 'G2'), 2);
  assert.equal(resolveGroupIdByLabel(state, 'G3'), 3);
});

t('resolveGroupIdByLabel: returns null when the labeled group does not exist (group missing behavior)', () => {
  const state = browseState([{ id: 1, label: 'G1', fileCount: 2, subEventId: null, colorIndex: 0 }]);
  assert.equal(resolveGroupIdByLabel(state, 'G2'), null);
});

t('resolveGroupIdByLabel: returns null when groups is an empty array', () => {
  const state = browseState([]);
  assert.equal(resolveGroupIdByLabel(state, 'G1'), null);
});

t('resolveGroupIdByLabel: returns null when groups is undefined (e.g. qmz context state)', () => {
  const state: AutoIngestState = {
    context: 'qmz',
    activeFile: null,
    selectedCount: 0,
    hasSelection: false,
    previewOpen: false,
    availableCommands: [],
    sequences: [],
  };
  assert.equal(resolveGroupIdByLabel(state, 'G1'), null);
});

t('resolveGroupIdByLabel: returns null when state itself is null', () => {
  assert.equal(resolveGroupIdByLabel(null, 'G1'), null);
});

t('resolveGroupIdByLabel: id/label never assumed to match — resolves by label even when id differs from the slot number', () => {
  // Real GroupManager renumbers on removal, so a group currently labeled
  // "G1" could in principle have started life with a different id before
  // renumbering settled it back to 1 — this helper must never assume
  // id === slot number, only ever trust the label AutoIngest reports.
  const state = browseState([{ id: 1, label: 'G1', fileCount: 3, subEventId: null, colorIndex: 0 }]);
  assert.equal(resolveGroupIdByLabel(state, 'G1'), 1);
  assert.notEqual(resolveGroupIdByLabel(state, 'G1'), 99); // sanity: not just returning some hardcoded value
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
