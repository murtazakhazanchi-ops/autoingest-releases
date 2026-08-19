#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/askSynthesis/sourceHandles.test.js
// Ask AutoIngest Phase A.2 (Track 2.A) -- locks in that assignHandles() never
// exposes a raw ID to anything downstream of it and that every legitimate ID
// gets exactly one stable handle.

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { buildEvidencePackage } = require('../../lib/askSynthesis/evidencePackage');
const { assignHandles } = require('../../lib/askSynthesis/sourceHandles');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  await t('every legitimate source ID gets exactly one handle, and the mapping is bidirectionally consistent', () => {
    const pkg = buildEvidencePackage('How do I import photographs from an SD card?', ctx);
    const hm = assignHandles(pkg);
    assert.equal(hm.validHandles.length, pkg.legitimateSourceIds.length);
    for (const id of pkg.legitimateSourceIds) {
      const handle = hm.handleById.get(id);
      assert.ok(handle, `no handle assigned for ${id}`);
      assert.equal(hm.idByHandle.get(handle), id, 'handle must resolve back to the exact same ID');
    }
  });

  await t('handles are the opaque "S<n>" shape, never resembling a real ID', () => {
    const pkg = buildEvidencePackage('My transfer stopped halfway, what happens now?', ctx);
    const hm = assignHandles(pkg);
    for (const h of hm.validHandles) assert.match(h, /^S\d+$/);
  });

  await t('every handle has a real, non-empty display name, never the bare ID as a fallback for a resolvable record', () => {
    const pkg = buildEvidencePackage('How do I import photographs from an SD card?', ctx);
    const hm = assignHandles(pkg);
    for (const h of hm.validHandles) {
      const name = hm.displayNameByHandle.get(h);
      assert.ok(name && name.length > 0);
    }
    // the primary's own handle must resolve to its real title, not its ID
    const primaryHandle = hm.handleById.get(pkg.primary.id);
    assert.equal(hm.displayNameByHandle.get(primaryHandle), pkg.primary.displayName);
  });

  await t('a question with zero legitimate sources still produces a well-formed (empty) handle map', () => {
    const pkg = buildEvidencePackage('Does AutoIngest support blockchain chain-of-custody tracking?', ctx);
    const hm = assignHandles(pkg);
    assert.equal(hm.validHandles.length, pkg.legitimateSourceIds.length);
  });

  summarize('askSynthesis/sourceHandles.test.js');
}

main();
