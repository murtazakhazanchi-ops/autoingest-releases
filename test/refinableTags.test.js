'use strict';

// Plain Node fixtures for the shared refinable-tag model — the ONE place that decides
// (a) which tags a component makes available for Per-Photo Tag Refinement and
// (b) which of them the metadata pipeline inherits by default for a file with no
// override. No framework, no DOM, no Electron. Run with: node test/refinableTags.test.js

const assert = require('node:assert/strict');
const RefinableTags = require('../renderer/refinableTags');

let passed = 0;
function t(name, fn) {
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

// UI-format component (EventCreator.getEventComps()) and disk-format component (event.json).
const ui   = (types, aks = []) => ({ eventTypes: types.map(label => ({ label })), additionalKeywords: aks.map(label => ({ label })) });
const disk = (types, aks = []) => ({ types, additionalKeywords: aks.map(label => ({ label })) });

console.log('refinableTags');

t('availableTags reads UI-format and disk-format components identically', () => {
  assert.deepEqual(RefinableTags.availableTags(ui(['Ziyarat', 'Waaz'], ['Children'])),
    { eventTypes: ['Ziyarat', 'Waaz'], additionalKeywords: ['Children'] });
  assert.deepEqual(RefinableTags.availableTags(disk(['Ziyarat', 'Waaz'], ['Children'])),
    { eventTypes: ['Ziyarat', 'Waaz'], additionalKeywords: ['Children'] });
});

t('availableTags drops blanks and duplicates, tolerates null/malformed input', () => {
  assert.deepEqual(RefinableTags.availableTags(null), { eventTypes: [], additionalKeywords: [] });
  assert.deepEqual(RefinableTags.availableTags({}), { eventTypes: [], additionalKeywords: [] });
  assert.deepEqual(RefinableTags.availableTags(ui(['Ziyarat', ' ', 'Ziyarat'], ['', 'Children'])),
    { eventTypes: ['Ziyarat'], additionalKeywords: ['Children'] });
});

t('countRefinable counts Event Types + Additional Keywords', () => {
  assert.equal(RefinableTags.countRefinable(null), 0);
  assert.equal(RefinableTags.countRefinable(ui([], [])), 0);
  assert.equal(RefinableTags.countRefinable(ui(['Ziyarat'])), 1);
  assert.equal(RefinableTags.countRefinable(ui(['Ziyarat'], ['Children'])), 2);
  assert.equal(RefinableTags.countRefinable(ui([], ['Children'])), 1);
});

// ── defaultEventTypeTokens: differential test against the ORIGINAL resolver logic ─────
// This oracle is a verbatim copy of the default-Event-Type branch of
// services/metadataExpectationService.js _buildKeywords as it existed on stable/0.9
// (61eba47) BEFORE it was refactored to delegate here. If the shared function ever
// drifts from it, the metadata pipeline's deliberate single-component ambiguity rule
// has been changed by accident.
function legacyDefaultEventTypes({ component, isMulti, explicitTags }) {
  if (Array.isArray(explicitTags)) return [...explicitTags];
  const typeArr = Array.isArray(component.types) ? component.types : [];
  const allTags = typeArr.join(',').split(',').map(x => x.trim()).filter(Boolean);
  if (isMulti) return allTags;
  if (allTags.length === 1) return [allTags[0]];
  return [];
}

t('defaultEventTypeTokens is identical to the original resolver logic across a full matrix', () => {
  const typeSets = [[], ['Ziyarat'], ['Ziyarat', 'Waaz'], ['Ziyarat, Waaz'], ['Ziyarat', 'Ziyarat'], [' Waaz '], ['A', 'B', 'C']];
  const explicits = [undefined, [], ['Waaz'], ['Ziyarat', 'Waaz']];
  for (const types of typeSets) for (const isMulti of [false, true]) for (const explicitTags of explicits) {
    const component = { types };
    assert.deepEqual(
      RefinableTags.defaultEventTypeTokens({ typeLabels: component.types, isMulti, explicitTags }),
      legacyDefaultEventTypes({ component, isMulti, explicitTags }),
      `types=${JSON.stringify(types)} isMulti=${isMulti} explicit=${JSON.stringify(explicitTags)}`
    );
  }
});

t('defaultEventTypeTokens tolerates non-array typeLabels', () => {
  assert.deepEqual(RefinableTags.defaultEventTypeTokens({ typeLabels: undefined, isMulti: false }), []);
  assert.deepEqual(RefinableTags.defaultEventTypeTokens({ typeLabels: null, isMulti: true }), []);
});

// ── effectiveDefaults: what the pipeline inherits (the panel must show THIS) ──────────

t('single-component, ONE Event Type: default inherits it', () => {
  const d = RefinableTags.effectiveDefaults({ component: ui(['Ziyarat']), isMulti: false });
  assert.deepEqual(d, { eventTypes: ['Ziyarat'], additionalKeywords: [] });
});

t('single-component, 2+ Event Types: default inherits NO Event Type (deliberate ambiguity rule)', () => {
  const d = RefinableTags.effectiveDefaults({ component: ui(['Ziyarat', 'Waaz']), isMulti: false });
  assert.deepEqual(d.eventTypes, []);
  // …yet both remain AVAILABLE as refinable choices — available ≠ default.
  assert.deepEqual(RefinableTags.availableTags(ui(['Ziyarat', 'Waaz'])).eventTypes, ['Ziyarat', 'Waaz']);
});

t('single-component, 2+ Event Types: Additional Keywords still inherit by default', () => {
  const d = RefinableTags.effectiveDefaults({ component: ui(['Ziyarat', 'Waaz'], ['Quran Tilawat', 'Children']), isMulti: false });
  assert.deepEqual(d, { eventTypes: [], additionalKeywords: ['Quran Tilawat', 'Children'] });
});

t('multi-component: default inherits every Event Type + Additional Keyword', () => {
  const d = RefinableTags.effectiveDefaults({ component: ui(['Ziyarat', 'Waaz'], ['Children']), isMulti: true });
  assert.deepEqual(d, { eventTypes: ['Ziyarat', 'Waaz'], additionalKeywords: ['Children'] });
});

t('legacy group.metadataTags (explicit tags) narrow the inherited Event Types; Additional Keywords unaffected', () => {
  const comp = ui(['Ziyarat', 'Waaz'], ['Children']);
  assert.deepEqual(RefinableTags.effectiveDefaults({ component: comp, isMulti: false, explicitTags: ['Waaz'] }),
    { eventTypes: ['Waaz'], additionalKeywords: ['Children'] });
  assert.deepEqual(RefinableTags.effectiveDefaults({ component: comp, isMulti: false, explicitTags: [] }),
    { eventTypes: [], additionalKeywords: ['Children'] });
});

t('a comma-containing label is inherited only when ALL its tokens are inherited (token-based, not label-based)', () => {
  const comp = ui(['Ziyarat, Waaz']);
  assert.deepEqual(RefinableTags.effectiveDefaults({ component: comp, isMulti: true }).eventTypes, ['Ziyarat, Waaz']);
  assert.deepEqual(RefinableTags.effectiveDefaults({ component: comp, isMulti: false }).eventTypes, []); // 2 tokens → ambiguous
});

t('effectiveDefaults returns fresh arrays (callers cannot mutate shared state)', () => {
  const a = RefinableTags.effectiveDefaults({ component: ui(['Ziyarat'], ['K']), isMulti: false });
  a.eventTypes.push('X'); a.additionalKeywords.push('Y');
  const b = RefinableTags.effectiveDefaults({ component: ui(['Ziyarat'], ['K']), isMulti: false });
  assert.deepEqual(b, { eventTypes: ['Ziyarat'], additionalKeywords: ['K'] });
});

console.log(`${passed} passed`);
if (process.exitCode) console.log('SOME TESTS FAILED');
