#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/askRetrieval/canonicalAliases.test.js
// Ask AutoIngest — Stage 1 deterministic retrieval foundation, Section 16.
// Unit tests for lib/askRetrieval/canonicalAliases.js's structured-provenance
// architecture (Section 9), plus one integration check (every alias id must
// resolve to a real record in the canonical Knowledge Base -- catches drift
// if a referenced record is ever renamed or removed).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { CANONICAL_ALIASES, aliasHintFor, aliasEntryFor } = require('../../lib/askRetrieval/canonicalAliases');
const build = require('../../lib/build');

async function main() {
  const { t, summarize } = createRunner();

  await t('CANONICAL_ALIASES is a small, non-empty, deliberately-curated list (not exhaustive, not empty)', () => {
    assert.ok(Array.isArray(CANONICAL_ALIASES));
    assert.ok(CANONICAL_ALIASES.length > 0);
    assert.ok(CANONICAL_ALIASES.length < 50, 'expected a small curated list, not a comprehensive synonym dictionary');
  });

  await t('every entry has an id, a non-empty hint, and structured provenance {field, quote}', () => {
    for (const entry of CANONICAL_ALIASES) {
      assert.equal(typeof entry.id, 'string');
      assert.ok(entry.id.length > 0);
      assert.equal(typeof entry.hint, 'string');
      assert.ok(entry.hint.trim().length > 0, `entry ${entry.id} must have a non-empty hint`);
      assert.ok(entry.provenance && typeof entry.provenance === 'object', `entry ${entry.id} must carry a provenance object`);
      assert.equal(typeof entry.provenance.field, 'string');
      assert.ok(entry.provenance.field.length > 0, `entry ${entry.id} provenance.field must be non-empty`);
      assert.equal(typeof entry.provenance.quote, 'string');
      assert.ok(entry.provenance.quote.length > 0, `entry ${entry.id} provenance.quote must be non-empty`);
    }
  });

  await t('no duplicate ids in the curated list', () => {
    const ids = CANONICAL_ALIASES.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  await t('every entry id matches the canonical AI-FEAT-### / AI-WF-### id shape', () => {
    for (const entry of CANONICAL_ALIASES) {
      assert.match(entry.id, /^AI-(FEAT|WF)-\d+$/, `unexpected id shape: ${entry.id}`);
    }
  });

  await t('aliasHintFor returns the curated hint for a known id, and an empty string for an unknown id', () => {
    const known = CANONICAL_ALIASES[0];
    assert.equal(aliasHintFor(known.id), known.hint);
    assert.equal(aliasHintFor('AI-FEAT-999999'), '');
    assert.equal(aliasHintFor('not-a-real-id'), '');
    assert.equal(aliasHintFor(undefined), '');
  });

  await t('aliasEntryFor returns the full entry (hint + provenance) for a known id, and null for an unknown id', () => {
    const known = CANONICAL_ALIASES[0];
    const entry = aliasEntryFor(known.id);
    assert.deepEqual(entry, known);
    assert.equal(aliasEntryFor('AI-FEAT-999999'), null);
  });

  await t('integration: every curated alias id resolves to a real Feature or Workflow record in the canonical Knowledge Base', () => {
    const { built } = build.assemble();
    const featureIds = new Set((built.featureIndex || []).map((f) => f.feature_id));
    const workflowIds = new Set((built.workflowIndex || []).map((w) => w.id));
    for (const entry of CANONICAL_ALIASES) {
      const isFeature = entry.id.startsWith('AI-FEAT-');
      const exists = isFeature ? featureIds.has(entry.id) : workflowIds.has(entry.id);
      assert.ok(exists, `alias id ${entry.id} no longer resolves to a real canonical record -- alias is stale and must be updated or removed`);
    }
  });

  summarize('askRetrieval/canonicalAliases.test.js');
}

main();
