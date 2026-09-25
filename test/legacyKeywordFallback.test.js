'use strict';

// D2 — keyword registry / Event-Type autocomplete integrity. Before this fix, the legacy
// fallback (used whenever a category has no registry entries — currently EVERY category,
// since data/keywords.registry.json is checked in with keywords: [] by design) flattened
// data/event-types.json / data/locations.json to only their TOP-LEVEL labels, discarding
// every real leaf underneath. A normal operator could select a resulting category header
// (e.g. "04 Majlis") via ordinary mouse or keyboard interaction, with zero validation —
// it propagated verbatim into event.json, the real archive folder name, and real written
// XMP/ExifTool metadata. Proven during the D2 forensic pass (real UI, real ExifTool
// readback) and confirmed pre-existing (predates D1/D4/RC.1/RC.2), present in Stable and
// in the actual published RC.1/RC.2 packages.
//
// Fixed via services/legacyKeywordFallback.js: collectLegacyLeaves (flat, leaf-only, for
// search) and pruneLegacyTree (keeps real nested shape, for browse) — one shared
// classification, no duplicated traversal. Tested here directly against the REAL checked-in
// data/event-types.json and data/locations.json (not synthetic-only), plus synthetic trees
// for the recursive-depth and malformed-node edge cases. Plain Node — no Electron needed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { collectLegacyLeaves, pruneLegacyTree } = require('../services/legacyKeywordFallback');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const eventTypes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'event-types.json'), 'utf8'));
const locations  = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'locations.json'), 'utf8'));

function allLabels(nodes) {
  const out = [];
  (function walk(list) { for (const n of list) { out.push(n.label); if (n.children) walk(n.children); } })(nodes);
  return out;
}
function allLeafLabels(nodes) {
  const out = [];
  (function walk(list) {
    for (const n of list) {
      if (Array.isArray(n.children) && n.children.length) walk(n.children);
      else out.push(n.label);
    }
  })(nodes);
  return out;
}

console.log('legacyKeywordFallback (D2 — real data/event-types.json + data/locations.json)');

(async () => {
  // ── Empty registry — Event Types ──
  t('collectLegacyLeaves: empty registry — event-types leaves include real examples from multiple categories', () => {
    const leaves = collectLegacyLeaves(eventTypes, new Set());
    for (const expected of ['Khushi Majlis', 'Nikah Majlis', 'Waaz Mubarak', 'Aqiqa']) {
      assert.ok(leaves.includes(expected), `expected leaf "${expected}" to be present`);
    }
    // Derived from the data structure itself, not hardcoded — every real leaf must be reachable.
    const expectedLeaves = allLeafLabels(eventTypes);
    assert.deepEqual([...leaves].sort(), [...new Set(expectedLeaves)].sort());
  });

  t('collectLegacyLeaves: category headers are never emitted (derived from the data, not hardcoded)', () => {
    const leaves = new Set(collectLegacyLeaves(eventTypes, new Set()));
    const categoryLabels = eventTypes.map(c => c.label); // all 14 top-level category headers
    for (const cat of categoryLabels) {
      assert.equal(leaves.has(cat), false, `category header "${cat}" must never be a selectable leaf`);
    }
    assert.equal(categoryLabels.length, 14); // sanity: confirms we're testing against the real 14-category shape
  });

  t('pruneLegacyTree: browse tree excludes every category header from becoming a top-level selectable leaf', () => {
    const pruned = pruneLegacyTree(eventTypes, new Set());
    // Top-level nodes must all still be category wrappers (have children) — none collapsed to a bare leaf.
    for (const node of pruned) {
      assert.ok(Array.isArray(node.children) && node.children.length > 0, `"${node.label}" must remain a category wrapper with children`);
    }
    assert.equal(pruned.length, 14);
  });

  // ── Recursive depth (real 3-level data: "04 Majlis" > "Misaq" > "Ahed al-Awliyah"/"Safqat") ──
  t('collectLegacyLeaves: real 3-level nesting — "Misaq" (intermediate) excluded, its real children included', () => {
    const leaves = collectLegacyLeaves(eventTypes, new Set());
    assert.equal(leaves.includes('Misaq'), false, 'an intermediate node with children must never be a leaf');
    assert.ok(leaves.includes('Ahed al-Awliyah'));
    assert.ok(leaves.includes('Safqat'));
  });

  t('collectLegacyLeaves: synthetic depth-3 tree — only the true leaf is emitted, not either category', () => {
    const tree = [{ label: 'Category A', children: [{ label: 'Category B', children: [{ label: 'Real Leaf' }] }] }];
    const leaves = collectLegacyLeaves(tree, new Set());
    assert.deepEqual(leaves, ['Real Leaf']);
  });

  t('pruneLegacyTree: synthetic depth-3 tree preserves the real nested shape', () => {
    const tree = [{ label: 'Category A', children: [{ label: 'Category B', children: [{ label: 'Real Leaf' }] }] }];
    const pruned = pruneLegacyTree(tree, new Set());
    assert.deepEqual(pruned, [{ label: 'Category A', children: [{ label: 'Category B', children: [{ label: 'Real Leaf' }] }] }]);
  });

  // ── Mixed registry + fallback ──
  t('collectLegacyLeaves: registry-covered leaf is not duplicated; uncovered siblings under the same category still appear', () => {
    const have = new Set(['nikah majlis']); // already in the registry (case-insensitive)
    const leaves = collectLegacyLeaves(eventTypes, have);
    assert.equal(leaves.includes('Nikah Majlis'), false, 'already-registry-covered leaf must not be duplicated');
    assert.ok(leaves.includes('Khushi Majlis'), 'uncovered sibling under the same category must still appear');
    assert.ok(leaves.includes('Waaz Mubarak'), 'uncovered sibling must still appear');
  });

  t('pruneLegacyTree: covering ALL of a category leaves (fully) drops the whole category, not an empty dead end', () => {
    const smallTree = [{ label: 'Cat', children: [{ label: 'Only Leaf' }] }];
    const pruned = pruneLegacyTree(smallTree, new Set(['only leaf']));
    assert.deepEqual(pruned, [], 'a category with zero surviving children must be dropped entirely');
  });

  t('pruneLegacyTree: partially covering a category keeps it with only the uncovered children', () => {
    const tree = [{ label: 'Cat', children: [{ label: 'A' }, { label: 'B' }] }];
    const pruned = pruneLegacyTree(tree, new Set(['a']));
    assert.deepEqual(pruned, [{ label: 'Cat', children: [{ label: 'B' }] }]);
  });

  // ── Location hierarchy (real data: 450 pure leaves, 3 real categories) ──
  t('collectLegacyLeaves: locations — ordinary top-level leaves remain available unchanged', () => {
    const leaves = collectLegacyLeaves(locations, new Set());
    assert.ok(leaves.includes('Aaliqadr Wadi'));
    assert.ok(leaves.includes('Accommodation'));
  });

  t('collectLegacyLeaves: locations — category parents (Jamrat/Kaaba/Raudat Tahera) excluded, their real children included', () => {
    const leaves = new Set(collectLegacyLeaves(locations, new Set()));
    for (const cat of ['Jamrat', 'Kaaba', 'Raudat Tahera']) {
      assert.equal(leaves.has(cat), false, `"${cat}" has children — must not be a selectable leaf itself`);
    }
    assert.ok(leaves.has('Al-Jamrah al-Kubra'));
    assert.ok(leaves.has('Al-Multazam'));
    assert.ok(leaves.has('Baab al-Fakhri'));
  });

  t('pruneLegacyTree: locations — 450 pure leaves pass through as bare {label} nodes, unchanged', () => {
    const pruned = pruneLegacyTree(locations, new Set());
    const bareLeafCount = pruned.filter(n => !n.children).length;
    assert.equal(bareLeafCount, 450);
    const categoryCount = pruned.filter(n => n.children).length;
    assert.equal(categoryCount, 3);
  });

  // ── Malformed / defensive ──
  t('malformed nodes are safely ignored, never synthesize a value', () => {
    const tree = [null, undefined, '', 42, { children: ['nope'] }, { label: 'Real', children: [] }, 'String Leaf'];
    const leaves = collectLegacyLeaves(tree, new Set());
    assert.deepEqual(leaves.sort(), ['Real', 'String Leaf']);
  });

  t('cities-style flat list of strings behaves as the degenerate zero-children case', () => {
    const flat = ['Mumbai', 'Surat', 'Pune'];
    assert.deepEqual(collectLegacyLeaves(flat, new Set()), flat);
  });

  console.log(`${passed} passed`);
  process.exit(process.exitCode || 0);
})();
