#!/usr/bin/env node
'use strict';
// Run with: node scripts/product-docs/test/askKnowledge/capabilityStatus.test.js
// Ask AutoIngest — Stage 2, Section 23. Integration tests for
// lib/askKnowledge/capabilityStatus.js (Section 11: capability authority,
// separate from retrieval success).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { capabilityStatus } = require('../../lib/askKnowledge/capabilityStatus');
const { HandleSession } = require('../../lib/askKnowledge/handles');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  await t('an invalid handle is a protocol error, never a capability answer', async () => {
    const hs = new HandleSession();
    const result = await capabilityStatus('H999', ctx, hs);
    assert.equal(result.error, 'invalid_handle');
    assert.equal(result.status, undefined);
  });

  await t('a real, implemented feature (Source Detection) resolves to AVAILABLE, with sourceConsistency agreeing', async () => {
    const hs = new HandleSession();
    const h = hs.issue('AI-FEAT-011');
    const result = await capabilityStatus(h, ctx, hs);
    assert.equal(result.status, 'AVAILABLE');
    assert.ok(result.sourceConsistency.agree);
    assert.ok(typeof result.provenance_count === 'number');
  });

  await t('a real, planned feature (Archive Maintenance, AI-FEAT-049) resolves to PLANNED', async () => {
    const hs = new HandleSession();
    const h = hs.issue('AI-FEAT-049');
    const result = await capabilityStatus(h, ctx, hs);
    assert.equal(result.status, 'PLANNED');
  });

  await t('every returned limitation is leak-boundary-clean (no raw governance id)', async () => {
    const hs = new HandleSession();
    const h = hs.issue('AI-FEAT-045'); // has real linked decisions
    const result = await capabilityStatus(h, ctx, hs);
    for (const lim of result.limitations) {
      assert.ok(!/\b(?:DEC|BUG|PM|KM)-[A-Za-z0-9-]+\b/.test(lim), `limitation leaked an id: ${lim}`);
    }
  });

  await t('never touches or reports a real internal id in the response shape (handle-only boundary)', async () => {
    const hs = new HandleSession();
    const h = hs.issue('AI-FEAT-011');
    const result = await capabilityStatus(h, ctx, hs);
    const serialized = JSON.stringify(result);
    assert.ok(!/AI-FEAT-\d+/.test(serialized));
  });

  await t('capability status is reachable only via a resolved handle -- never re-derived from free text (no NL interpretation in this module)', () => {
    // Structural check: capabilityStatus's own exported function arity is
    // (handle, ctx, handleSession) -- there is no query/question parameter.
    assert.equal(capabilityStatus.length, 3);
  });

  await t('deterministic: repeated calls with the same handle return identical results', async () => {
    const hs = new HandleSession();
    const h = hs.issue('AI-FEAT-011');
    const a = await capabilityStatus(h, ctx, hs);
    const b = await capabilityStatus(h, ctx, hs);
    assert.deepEqual(a, b);
  });

  summarize('askKnowledge/capabilityStatus.test.js');
}

main();
