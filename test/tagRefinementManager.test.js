'use strict';

// Plain Node fixtures for the Per-Photo Tag Refinement state module — no framework,
// no DOM, no Electron. Run with: node test/tagRefinementManager.test.js

const assert = require('node:assert/strict');
const TagRefinementManager = require('../renderer/tagRefinementManager');

let passed = 0;
function t(name, fn) {
  TagRefinementManager.reset();
  try {
    fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    console.error(`  FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('tagRefinementManager');

t('a file with no override returns null (inherit defaults)', () => {
  assert.equal(TagRefinementManager.getOverride(1, '/a.jpg'), null);
});

t('isEligible requires more than one total refinable tag (Event Types + Additional Keywords)', () => {
  assert.equal(TagRefinementManager.isEligible(null), false);
  assert.equal(TagRefinementManager.isEligible({ eventTypes: [{ label: 'Waaz' }], additionalKeywords: [] }), false);
  assert.equal(TagRefinementManager.isEligible({ eventTypes: [{ label: 'Waaz' }], additionalKeywords: [{ label: 'Children' }] }), true);
  assert.equal(TagRefinementManager.isEligible({ eventTypes: [{ label: 'Waaz' }, { label: 'Majlis' }], additionalKeywords: [] }), true);
  assert.equal(TagRefinementManager.isEligible({ eventTypes: [], additionalKeywords: [] }), false);
});

t('setOverride applies an explicit subset to a batch of files', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg', '/b.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  assert.deepEqual(TagRefinementManager.getOverride(1, '/a.jpg'), { eventTypes: ['Waaz'], additionalKeywords: [] });
  assert.deepEqual(TagRefinementManager.getOverride(1, '/b.jpg'), { eventTypes: ['Waaz'], additionalKeywords: [] });
  assert.equal(TagRefinementManager.getOverride(1, '/c.jpg'), null);
});

t('explicit-empty override (both arrays []) is distinguishable from no override', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg'], { eventTypes: [], additionalKeywords: [] });
  const o = TagRefinementManager.getOverride(1, '/a.jpg');
  assert.notEqual(o, null);
  assert.deepEqual(o, { eventTypes: [], additionalKeywords: [] });
});

t('resetToDefault removes the override entirely, not just clears the arrays', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  TagRefinementManager.resetToDefault(1, ['/a.jpg']);
  assert.equal(TagRefinementManager.getOverride(1, '/a.jpg'), null);
  assert.equal(TagRefinementManager.groupRefinementCount(1), 0);
});

t('clearGroup wipes every override in that group only', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  TagRefinementManager.setOverride(2, ['/b.jpg'], { eventTypes: ['Majlis'], additionalKeywords: [] });
  TagRefinementManager.clearGroup(1);
  assert.equal(TagRefinementManager.getOverride(1, '/a.jpg'), null);
  assert.notEqual(TagRefinementManager.getOverride(2, '/b.jpg'), null);
});

t('clearFiles removes overrides for those paths across all groups (move/unassign)', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg', '/b.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  TagRefinementManager.setOverride(2, ['/c.jpg'], { eventTypes: ['Majlis'], additionalKeywords: [] });
  TagRefinementManager.clearFiles(['/a.jpg', '/c.jpg']);
  assert.equal(TagRefinementManager.getOverride(1, '/a.jpg'), null);
  assert.notEqual(TagRefinementManager.getOverride(1, '/b.jpg'), null);
  assert.equal(TagRefinementManager.getOverride(2, '/c.jpg'), null);
});

t('clearFiles is a no-op for files with no override', () => {
  TagRefinementManager.clearFiles(['/never-touched.jpg']); // must not throw
  assert.equal(TagRefinementManager.groupRefinementCount(1), 0);
});

t('getSummary buckets a group into default/refined/noTags', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  TagRefinementManager.setOverride(1, ['/b.jpg'], { eventTypes: [], additionalKeywords: [] });
  const summary = TagRefinementManager.getSummary(1, ['/a.jpg', '/b.jpg', '/c.jpg']);
  assert.deepEqual(summary, { total: 3, default: 1, refined: 1, noTags: 1 });
});

t('serializeGroupForImport returns null when nothing to serialize, else a path-keyed object', () => {
  assert.equal(TagRefinementManager.serializeGroupForImport(1), null);
  TagRefinementManager.setOverride(1, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: ['Children'] });
  assert.deepEqual(TagRefinementManager.serializeGroupForImport(1), {
    '/a.jpg': { eventTypes: ['Waaz'], additionalKeywords: ['Children'] },
  });
});

t('refinement mode tracks the active group id independently of override data', () => {
  assert.equal(TagRefinementManager.isActive(), false);
  TagRefinementManager.enter(3);
  assert.equal(TagRefinementManager.isActive(), true);
  assert.equal(TagRefinementManager.getActiveGroupId(), 3);
  TagRefinementManager.exit();
  assert.equal(TagRefinementManager.isActive(), false);
});

t('reset clears all override data and active mode across every group', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  TagRefinementManager.setOverride(2, ['/b.jpg'], { eventTypes: [], additionalKeywords: [] });
  TagRefinementManager.enter(1);
  TagRefinementManager.reset();
  assert.equal(TagRefinementManager.getOverride(1, '/a.jpg'), null);
  assert.equal(TagRefinementManager.getOverride(2, '/b.jpg'), null);
  assert.equal(TagRefinementManager.isActive(), false);
});

console.log(`${passed} passed`);
if (process.exitCode) console.log('SOME TESTS FAILED');
