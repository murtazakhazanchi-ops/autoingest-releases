#!/usr/bin/env node
'use strict';

// Part 7C — unit tests for lib/ownershipManifest.js's generated projection.
// Synthetic in-memory built.featureIndex/subsystems/sourceIndex — never
// reads or mutates the real docs/product/ tree.
// Run with: node scripts/product-docs/test/ownershipManifest.test.js

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const { buildOwnershipManifest } = require('../lib/ownershipManifest');

function fakeBuilt() {
  const featureIndex = [
    { feature_id: 'AI-FEAT-001', related_code_paths: ['main/x.js'], related_tests: ['test/x.test.js'] },
    { feature_id: 'AI-FEAT-002', related_code_paths: ['services/y.js'], related_tests: [] },
  ];
  const subsystems = [
    { id: 'SUBSYS-A', primaryFeatures: ['AI-FEAT-001'], sourceDirectories: ['main'] },
    { id: 'SUBSYS-B', primaryFeatures: ['AI-FEAT-002'], sourceDirectories: ['services'] },
  ];
  const sourceIndex = {
    byFile: new Map([
      ['main/x.js', ['SUBSYS-A']],
      ['services/y.js', ['SUBSYS-B']],
    ]),
  };
  return { featureIndex, subsystems, sourceIndex };
}

async function main() {
  const { t, summarize } = createRunner();

  await t('feature_to_code_paths / code_path_to_features are exact inverses of the explicit evidence', () => {
    const manifest = buildOwnershipManifest({}, fakeBuilt());
    assert.deepEqual(manifest.feature_to_code_paths['AI-FEAT-001'], ['main/x.js']);
    assert.deepEqual(manifest.code_path_to_features['main/x.js'].features, ['AI-FEAT-001']);
    assert.equal(manifest.code_path_to_features['main/x.js'].confidence, 'explicit');
  });

  await t('feature_to_tests / test_to_features are exact inverses', () => {
    const manifest = buildOwnershipManifest({}, fakeBuilt());
    assert.deepEqual(manifest.feature_to_tests['AI-FEAT-001'], ['test/x.test.js']);
    assert.deepEqual(manifest.test_to_features['test/x.test.js'], ['AI-FEAT-001']);
    assert.deepEqual(manifest.feature_to_tests['AI-FEAT-002'], []);
  });

  await t('subsystem_to_features lists every subsystem, including ones with no derived IPC/service directory', () => {
    const manifest = buildOwnershipManifest({}, fakeBuilt());
    assert.deepEqual(manifest.subsystem_to_features['SUBSYS-A'], ['AI-FEAT-001']);
    assert.deepEqual(manifest.subsystem_to_features['SUBSYS-B'], ['AI-FEAT-002']);
  });

  await t('ipc_to_features / service_to_features are derived only from a subsystem\'s own main/ or services/ source directories', () => {
    const manifest = buildOwnershipManifest({}, fakeBuilt());
    assert.deepEqual(Object.keys(manifest.ipc_to_features), ['SUBSYS-A']);
    assert.deepEqual(manifest.ipc_to_features['SUBSYS-A'].features, ['AI-FEAT-001']);
    assert.deepEqual(Object.keys(manifest.service_to_features), ['SUBSYS-B']);
    assert.deepEqual(manifest.service_to_features['SUBSYS-B'].features, ['AI-FEAT-002']);
  });

  await t('an unmapped path never appears in code_path_to_features — unresolved, not guessed', () => {
    const manifest = buildOwnershipManifest({}, fakeBuilt());
    assert.equal(manifest.code_path_to_features['totally/unmapped.js'], undefined);
    assert.ok(manifest.note.includes('unresolved'));
  });

  summarize('ownershipManifest.test.js');
}

main();
