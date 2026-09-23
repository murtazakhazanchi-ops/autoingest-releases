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

// Eligibility rule CHANGED (was: more than one total refinable tag). Tag Refinement is now
// a general per-photo override system: any component offering at least ONE refinable tag
// (Event Type or Additional Keyword) is eligible; only a component with nothing to refine
// is not. A lone Event Type is eligible so operators can drop it from individual photos.
t('isEligible requires at least ONE refinable tag (Event Types + Additional Keywords)', () => {
  assert.equal(TagRefinementManager.isEligible(null), false);
  assert.equal(TagRefinementManager.isEligible({ eventTypes: [{ label: 'Waaz' }], additionalKeywords: [] }), true);
  assert.equal(TagRefinementManager.isEligible({ eventTypes: [], additionalKeywords: [{ label: 'Children' }] }), true);
  assert.equal(TagRefinementManager.isEligible({ eventTypes: [{ label: 'Waaz' }], additionalKeywords: [{ label: 'Children' }] }), true);
  assert.equal(TagRefinementManager.isEligible({ eventTypes: [{ label: 'Waaz' }, { label: 'Majlis' }], additionalKeywords: [] }), true);
  assert.equal(TagRefinementManager.isEligible({ eventTypes: [], additionalKeywords: [] }), false);
  assert.equal(TagRefinementManager.isEligible({}), false);
});

t('isEligible ignores blank labels — nothing real to refine means ineligible', () => {
  assert.equal(TagRefinementManager.isEligible({ eventTypes: [{ label: '  ' }], additionalKeywords: [{ label: '' }] }), false);
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

// ── getSelectionState (mixed-selection safety) ──────────────────────────────

const ALL_ET = ['Waaz', 'Bayan', 'Dua'];
const ALL_AK = ['Children', 'Outdoor'];

t('getSelectionState: empty selection', () => {
  const s = TagRefinementManager.getSelectionState(1, [], ALL_ET, ALL_AK);
  assert.equal(s.status, 'empty');
});

t('getSelectionState: uniform default (no override) — every tag reads checked, status default', () => {
  const s = TagRefinementManager.getSelectionState(1, ['/a.jpg', '/b.jpg'], ALL_ET, ALL_AK);
  assert.equal(s.status, 'default');
  assert.equal(s.sampleOverride, null);
  assert.deepEqual(s.eventTypes, { Waaz: 'checked', Bayan: 'checked', Dua: 'checked' });
  assert.deepEqual(s.additionalKeywords, { Children: 'checked', Outdoor: 'checked' });
});

t('getSelectionState: uniform explicit subset — only that subset checked, status refined', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg', '/b.jpg'], { eventTypes: ['Waaz'], additionalKeywords: ['Children'] });
  const s = TagRefinementManager.getSelectionState(1, ['/a.jpg', '/b.jpg'], ALL_ET, ALL_AK);
  assert.equal(s.status, 'refined');
  assert.deepEqual(s.sampleOverride, { eventTypes: ['Waaz'], additionalKeywords: ['Children'] });
  assert.deepEqual(s.eventTypes, { Waaz: 'checked', Bayan: 'unchecked', Dua: 'unchecked' });
  assert.deepEqual(s.additionalKeywords, { Children: 'checked', Outdoor: 'unchecked' });
});

t('getSelectionState: uniform explicit-none — every tag unchecked, status none', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg', '/b.jpg'], { eventTypes: [], additionalKeywords: [] });
  const s = TagRefinementManager.getSelectionState(1, ['/a.jpg', '/b.jpg'], ALL_ET, ALL_AK);
  assert.equal(s.status, 'none');
  assert.deepEqual(s.eventTypes, { Waaz: 'unchecked', Bayan: 'unchecked', Dua: 'unchecked' });
  assert.deepEqual(s.additionalKeywords, { Children: 'unchecked', Outdoor: 'unchecked' });
});

t('getSelectionState: default + refined mix → status mixed, per-tag indeterminate where they disagree', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  // /b.jpg has no override → default (inherits all tags)
  const s = TagRefinementManager.getSelectionState(1, ['/a.jpg', '/b.jpg'], ALL_ET, ALL_AK);
  assert.equal(s.status, 'mixed');
  assert.equal(s.sampleOverride, null);
  // Waaz: both effectively have it (explicit + inherited) → checked
  assert.equal(s.eventTypes.Waaz, 'checked');
  // Bayan/Dua: only the default file effectively has them → indeterminate
  assert.equal(s.eventTypes.Bayan, 'indeterminate');
  assert.equal(s.eventTypes.Dua, 'indeterminate');
  assert.equal(s.additionalKeywords.Children, 'indeterminate');
});

t('getSelectionState: refined + explicit-none mix → status mixed, disjoint tags indeterminate', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  TagRefinementManager.setOverride(1, ['/b.jpg'], { eventTypes: [], additionalKeywords: [] });
  const s = TagRefinementManager.getSelectionState(1, ['/a.jpg', '/b.jpg'], ALL_ET, ALL_AK);
  assert.equal(s.status, 'mixed');
  assert.equal(s.eventTypes.Waaz, 'indeterminate');
  assert.equal(s.eventTypes.Bayan, 'unchecked');
  assert.equal(s.additionalKeywords.Children, 'unchecked');
});

t('getSelectionState: default + explicit-none mix → status mixed', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg'], { eventTypes: [], additionalKeywords: [] });
  // /b.jpg default
  const s = TagRefinementManager.getSelectionState(1, ['/a.jpg', '/b.jpg'], ALL_ET, ALL_AK);
  assert.equal(s.status, 'mixed');
  assert.equal(s.eventTypes.Waaz, 'indeterminate');
});

t('getSelectionState: three different refined subsets → all mixed, no false uniform tag', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  TagRefinementManager.setOverride(1, ['/b.jpg'], { eventTypes: ['Bayan'], additionalKeywords: [] });
  TagRefinementManager.setOverride(1, ['/c.jpg'], { eventTypes: ['Dua'], additionalKeywords: [] });
  const s = TagRefinementManager.getSelectionState(1, ['/a.jpg', '/b.jpg', '/c.jpg'], ALL_ET, ALL_AK);
  assert.equal(s.status, 'mixed');
  assert.equal(s.eventTypes.Waaz, 'indeterminate');
  assert.equal(s.eventTypes.Bayan, 'indeterminate');
  assert.equal(s.eventTypes.Dua, 'indeterminate');
});

t('getSelectionState: mixed Event Types but identical Additional Keywords — categories are independent', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: ['Children'] });
  TagRefinementManager.setOverride(1, ['/b.jpg'], { eventTypes: ['Bayan'], additionalKeywords: ['Children'] });
  const s = TagRefinementManager.getSelectionState(1, ['/a.jpg', '/b.jpg'], ALL_ET, ALL_AK);
  assert.equal(s.status, 'mixed'); // overall still mixed (eventTypes differ)
  assert.equal(s.eventTypes.Waaz, 'indeterminate');
  assert.equal(s.eventTypes.Bayan, 'indeterminate');
  // Additional Keywords agree across the selection — reflected precisely per-tag despite overall mixed status
  assert.equal(s.additionalKeywords.Children, 'checked');
  assert.equal(s.additionalKeywords.Outdoor, 'unchecked');
});

t('getSelectionState: identical Event Types but mixed Additional Keywords — categories are independent', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: ['Children'] });
  TagRefinementManager.setOverride(1, ['/b.jpg'], { eventTypes: ['Waaz'], additionalKeywords: ['Outdoor'] });
  const s = TagRefinementManager.getSelectionState(1, ['/a.jpg', '/b.jpg'], ALL_ET, ALL_AK);
  assert.equal(s.status, 'mixed');
  assert.equal(s.eventTypes.Waaz, 'checked');
  assert.equal(s.eventTypes.Bayan, 'unchecked');
  assert.equal(s.additionalKeywords.Children, 'indeterminate');
  assert.equal(s.additionalKeywords.Outdoor, 'indeterminate');
});

t('getSelectionState never mutates stored overrides — pure read', () => {
  TagRefinementManager.setOverride(1, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  TagRefinementManager.getSelectionState(1, ['/a.jpg', '/b.jpg'], ALL_ET, ALL_AK);
  assert.deepEqual(TagRefinementManager.getOverride(1, '/a.jpg'), { eventTypes: ['Waaz'], additionalKeywords: [] });
  assert.equal(TagRefinementManager.getOverride(1, '/b.jpg'), null);
});

// ── Event scope (single-component events — no groups) ─────────────────────────────────

const EV = TagRefinementManager.EVENT_SCOPE;

t('EVENT_SCOPE is a reserved non-numeric scope id that can never collide with a GroupManager group id', () => {
  assert.equal(typeof EV, 'string');
  assert.equal(TagRefinementManager.isEventScope(EV), true);
  assert.equal(TagRefinementManager.isEventScope(1), false);
  assert.equal(TagRefinementManager.isEventScope(0), false);
  assert.equal(TagRefinementManager.isEventScope(null), false);
});

t('event scope stores tri-state overrides exactly like a group scope', () => {
  TagRefinementManager.setOverride(EV, ['/a.jpg'], { eventTypes: [], additionalKeywords: [] });
  assert.deepEqual(TagRefinementManager.getOverride(EV, '/a.jpg'), { eventTypes: [], additionalKeywords: [] });
  assert.equal(TagRefinementManager.getOverride(EV, '/b.jpg'), null);
  TagRefinementManager.resetToDefault(EV, ['/a.jpg']);
  assert.equal(TagRefinementManager.getOverride(EV, '/a.jpg'), null);
  assert.equal(TagRefinementManager.groupRefinementCount(EV), 0);
});

t('event scope and group scopes are independent (no cross-talk)', () => {
  TagRefinementManager.setOverride(EV, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  TagRefinementManager.setOverride(1,  ['/a.jpg'], { eventTypes: ['Majlis'], additionalKeywords: [] });
  assert.deepEqual(TagRefinementManager.getOverride(EV, '/a.jpg').eventTypes, ['Waaz']);
  assert.deepEqual(TagRefinementManager.getOverride(1,  '/a.jpg').eventTypes, ['Majlis']);
  TagRefinementManager.clearGroup(1);
  assert.notEqual(TagRefinementManager.getOverride(EV, '/a.jpg'), null);
});

t('enter(EVENT_SCOPE) activates event-scope mode; exit/reset deactivate it', () => {
  assert.equal(TagRefinementManager.isEventScopeActive(), false);
  TagRefinementManager.enter(EV);
  assert.equal(TagRefinementManager.isActive(), true);
  assert.equal(TagRefinementManager.isEventScopeActive(), true);
  TagRefinementManager.exit();
  assert.equal(TagRefinementManager.isEventScopeActive(), false);
  TagRefinementManager.enter(EV);
  TagRefinementManager.reset();
  assert.equal(TagRefinementManager.isActive(), false);
});

t('a group-scope session is never reported as event-scope', () => {
  TagRefinementManager.enter(3);
  assert.equal(TagRefinementManager.isActive(), true);
  assert.equal(TagRefinementManager.isEventScopeActive(), false);
});

t('reset clears event-scope overrides too (no leak across events/sources/workspaces)', () => {
  TagRefinementManager.setOverride(EV, ['/a.jpg'], { eventTypes: [], additionalKeywords: [] });
  TagRefinementManager.reset();
  assert.equal(TagRefinementManager.getOverride(EV, '/a.jpg'), null);
  assert.equal(TagRefinementManager.groupRefinementCount(EV), 0);
});

t('getSummary works for event scope', () => {
  TagRefinementManager.setOverride(EV, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  TagRefinementManager.setOverride(EV, ['/b.jpg'], { eventTypes: [], additionalKeywords: [] });
  assert.deepEqual(TagRefinementManager.getSummary(EV, ['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg']),
    { total: 4, default: 2, refined: 1, noTags: 1 });
});

// ── Effective defaults: "available" ≠ "inherited" ─────────────────────────────────────

t('getSelectionState with no defaults argument keeps the legacy behavior (default = every available tag)', () => {
  const s = TagRefinementManager.getSelectionState(1, ['/a.jpg'], ['Ziyarat', 'Waaz'], ['Children']);
  assert.equal(s.status, 'default');
  assert.equal(s.eventTypes.Ziyarat, 'checked');
  assert.equal(s.eventTypes.Waaz, 'checked');
  assert.equal(s.additionalKeywords.Children, 'checked');
});

t('getSelectionState honors explicit defaults: an untouched file shows only what the pipeline inherits', () => {
  // single-component Ziyarat + Waaz: both AVAILABLE, neither inherited; AK inherited.
  const s = TagRefinementManager.getSelectionState(EV, ['/a.jpg'], ['Ziyarat', 'Waaz'], ['Children'],
    { eventTypes: [], additionalKeywords: ['Children'] });
  assert.equal(s.status, 'default');
  assert.equal(s.eventTypes.Ziyarat, 'unchecked');
  assert.equal(s.eventTypes.Waaz, 'unchecked');
  assert.equal(s.additionalKeywords.Children, 'checked');
});

t('Default and explicit No Tags are NOT equivalent states even when they resolve identically', () => {
  const defaults = { eventTypes: [], additionalKeywords: [] }; // ambiguous: default already yields no Event Type
  const dflt = TagRefinementManager.getSelectionState(EV, ['/a.jpg'], ['Ziyarat', 'Waaz'], [], defaults);
  TagRefinementManager.setOverride(EV, ['/b.jpg'], { eventTypes: [], additionalKeywords: [] });
  const none = TagRefinementManager.getSelectionState(EV, ['/b.jpg'], ['Ziyarat', 'Waaz'], [], defaults);
  assert.equal(dflt.status, 'default');
  assert.equal(none.status, 'none');
  assert.deepEqual(dflt.eventTypes, none.eventTypes); // same checkboxes, different STATE
  // …and Reset deletes the override, returning to dynamic pipeline-default inheritance.
  TagRefinementManager.resetToDefault(EV, ['/b.jpg']);
  assert.equal(TagRefinementManager.getSelectionState(EV, ['/b.jpg'], ['Ziyarat', 'Waaz'], [], defaults).status, 'default');
});

t('an explicit override wins over defaults: Waaz explicitly selected shows Waaz checked, Ziyarat unchecked', () => {
  TagRefinementManager.setOverride(EV, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  const s = TagRefinementManager.getSelectionState(EV, ['/a.jpg'], ['Ziyarat', 'Waaz'], [], { eventTypes: [], additionalKeywords: [] });
  assert.equal(s.status, 'refined');
  assert.equal(s.eventTypes.Waaz, 'checked');
  assert.equal(s.eventTypes.Ziyarat, 'unchecked');
});

t('mixed selection across default + refined + explicit-none is Mixed with indeterminate chips (relative to defaults)', () => {
  const defaults = { eventTypes: ['Ziyarat'], additionalKeywords: [] }; // single-type event: Ziyarat inherited
  TagRefinementManager.setOverride(EV, ['/refined.jpg'], { eventTypes: ['Ziyarat'], additionalKeywords: ['Children'] });
  TagRefinementManager.setOverride(EV, ['/none.jpg'],    { eventTypes: [], additionalKeywords: [] });
  const s = TagRefinementManager.getSelectionState(EV, ['/default.jpg', '/refined.jpg', '/none.jpg'], ['Ziyarat'], ['Children'], defaults);
  assert.equal(s.status, 'mixed');
  assert.equal(s.eventTypes.Ziyarat, 'indeterminate');       // 2 of 3 carry it
  assert.equal(s.additionalKeywords.Children, 'indeterminate'); // 1 of 3
});

t('defaults may be a per-file function (files in different legacy metadata groups inherit differently)', () => {
  const perFile = p => (p === '/g1.jpg' ? { eventTypes: ['Waaz'], additionalKeywords: [] } : { eventTypes: [], additionalKeywords: [] });
  const s = TagRefinementManager.getSelectionState(EV, ['/g1.jpg', '/g2.jpg'], ['Ziyarat', 'Waaz'], [], perFile);
  assert.equal(s.status, 'default');                 // neither file carries an override
  assert.equal(s.eventTypes.Waaz, 'indeterminate');  // but their inherited defaults differ
  assert.equal(s.eventTypes.Ziyarat, 'unchecked');
});

t('getSelectionState with defaults stays a pure read — never mutates stored overrides', () => {
  TagRefinementManager.setOverride(EV, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  const before = TagRefinementManager.getRevision();
  TagRefinementManager.getSelectionState(EV, ['/a.jpg', '/b.jpg'], ['Waaz'], [], { eventTypes: [], additionalKeywords: [] });
  assert.equal(TagRefinementManager.getRevision(), before);
  assert.equal(TagRefinementManager.getOverride(EV, '/b.jpg'), null);
});

// ── Serialization for the import payload ──────────────────────────────────────────────

t('serializeGroupForImport(EVENT_SCOPE, files) returns only overrides for the payload group\'s own files', () => {
  TagRefinementManager.setOverride(EV, ['/a.jpg'], { eventTypes: [], additionalKeywords: [] });
  TagRefinementManager.setOverride(EV, ['/b.jpg'], { eventTypes: ['Waaz'], additionalKeywords: ['Children'] });
  TagRefinementManager.setOverride(EV, ['/not-imported.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  assert.deepEqual(TagRefinementManager.serializeGroupForImport(EV, ['/a.jpg', '/b.jpg', '/c.jpg']), {
    '/a.jpg': { eventTypes: [], additionalKeywords: [] },
    '/b.jpg': { eventTypes: ['Waaz'], additionalKeywords: ['Children'] },
  });
});

t('serialize returns null when nothing applies (filter excludes everything, or no overrides) — never {}', () => {
  assert.equal(TagRefinementManager.serializeGroupForImport(EV, ['/a.jpg']), null);
  TagRefinementManager.setOverride(EV, ['/x.jpg'], { eventTypes: [], additionalKeywords: [] });
  assert.equal(TagRefinementManager.serializeGroupForImport(EV, ['/a.jpg']), null);
});

t('serialize without a file filter is unchanged (multi-component group path)', () => {
  TagRefinementManager.setOverride(2, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  assert.deepEqual(TagRefinementManager.serializeGroupForImport(2), { '/a.jpg': { eventTypes: ['Waaz'], additionalKeywords: [] } });
  assert.equal(TagRefinementManager.serializeGroupForImport(99), null);
});

t('serialized overrides are detached copies (mutating the payload cannot corrupt manager state)', () => {
  TagRefinementManager.setOverride(EV, ['/a.jpg'], { eventTypes: ['Waaz'], additionalKeywords: [] });
  const out = TagRefinementManager.serializeGroupForImport(EV, ['/a.jpg']);
  out['/a.jpg'].eventTypes.push('HACK');
  assert.deepEqual(TagRefinementManager.getOverride(EV, '/a.jpg').eventTypes, ['Waaz']);
});

// ── Revision counter (lets the UI memoize O(n) summaries without per-click rescans) ────

t('getRevision increases on every mutation and is stable across pure reads', () => {
  const r0 = TagRefinementManager.getRevision();
  TagRefinementManager.setOverride(EV, ['/a.jpg'], { eventTypes: [], additionalKeywords: [] });
  const r1 = TagRefinementManager.getRevision();
  assert.ok(r1 > r0);
  TagRefinementManager.getSummary(EV, ['/a.jpg']);
  TagRefinementManager.getOverride(EV, '/a.jpg');
  assert.equal(TagRefinementManager.getRevision(), r1);
  TagRefinementManager.resetToDefault(EV, ['/a.jpg']);
  const r2 = TagRefinementManager.getRevision();
  assert.ok(r2 > r1);
  TagRefinementManager.setOverride(EV, ['/b.jpg'], { eventTypes: [], additionalKeywords: [] });
  TagRefinementManager.clearFiles(['/b.jpg']);
  assert.ok(TagRefinementManager.getRevision() > r2);
});

console.log(`${passed} passed`);
if (process.exitCode) console.log('SOME TESTS FAILED');
