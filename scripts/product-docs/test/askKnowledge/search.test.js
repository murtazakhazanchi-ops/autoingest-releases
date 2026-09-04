#!/usr/bin/env node
'use strict';
// Run with: node scripts/product-docs/test/askKnowledge/search.test.js
// Ask AutoIngest — Stage 2, Section 23. Integration tests for
// lib/askKnowledge/search.js (Section 15/18/19: search_autoingest, Stage-1
// retrieval integration, multi-query support).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { buildRetrievalIndex } = require('../../lib/askRetrieval/retrieval');
const { searchAutoIngest } = require('../../lib/askKnowledge/search');
const { HandleSession } = require('../../lib/askKnowledge/handles');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);
  const index = buildRetrievalIndex(built); // Stage 2's own certified default -- see DEC-023

  await t('a well-formed query returns ranked candidates with the documented shape', () => {
    const hs = new HandleSession();
    const result = searchAutoIngest('sequencing workspace numbered sequences', ctx, built, index, hs);
    assert.ok(result.results.length > 0);
    const top = result.results[0];
    assert.equal(typeof top.title, 'string');
    assert.ok(top.kind === 'feature' || top.kind === 'workflow');
    assert.equal(typeof top.hasDetail, 'boolean');
    assert.match(top.handle, /^H\d+$/);
  });

  await t('every result carries a session handle, never a real internal id', () => {
    const hs = new HandleSession();
    const result = searchAutoIngest('archive lock recovery', ctx, built, index, hs);
    for (const r of result.results) {
      assert.match(r.handle, /^H\d+$/);
      assert.ok(!/^AI-(FEAT|WF)-\d+$/.test(r.handle));
    }
  });

  await t('empty query returns no candidates, never throws', () => {
    const hs = new HandleSession();
    const result = searchAutoIngest('', ctx, built, index, hs);
    assert.deepEqual(result.results, []);
    assert.equal(result.note, 'Empty query.');
  });

  await t('whitespace-only query returns no candidates', () => {
    const hs = new HandleSession();
    const result = searchAutoIngest('   ', ctx, built, index, hs);
    assert.deepEqual(result.results, []);
  });

  await t('unusual punctuation / Unicode never throws', () => {
    const hs = new HandleSession();
    assert.doesNotThrow(() => searchAutoIngest('???!!! café memory card??', ctx, built, index, hs));
  });

  await t('repeat search with different wording is noted, but never errors', () => {
    const hs = new HandleSession();
    searchAutoIngest('memory card', ctx, built, index, hs);
    const second = searchAutoIngest('external drive detection', ctx, built, index, hs);
    assert.ok(second.note);
  });

  await t('searching for the same real subject twice in one session returns the same handle both times', () => {
    const hs = new HandleSession();
    const a = searchAutoIngest('QMZ sequencing', ctx, built, index, hs);
    const b = searchAutoIngest('QMZ sequencing', ctx, built, index, hs);
    const aTop = a.results.find((r) => r.title.includes('QMZ'));
    const bTop = b.results.find((r) => r.title.includes('QMZ'));
    assert.ok(aTop && bTop);
    assert.equal(aTop.handle, bTop.handle);
  });

  await t('Section 19: multi-query fusion via alternateQuery recovers the documented PR1/Stage-1 finding through the Stage 2 API', () => {
    const hs = new HandleSession();
    const reformulated = 'memory card auto detect plug in';
    const original = 'Does the app automatically notice a memory card being plugged in?';
    const alone = searchAutoIngest(reformulated, ctx, built, index, hs);
    const fused = searchAutoIngest(reformulated, ctx, built, index, hs, { alternateQuery: original });
    const aloneHasSourceDetection = alone.results.some((r) => r.title.includes('Source Detection'));
    const fusedHasSourceDetection = fused.results.some((r) => r.title.includes('Source Detection'));
    assert.equal(aloneHasSourceDetection, false, 'precondition: reformulation alone must reproduce the known miss');
    assert.equal(fusedHasSourceDetection, true, 'fusing the original wording must recover the correct candidate');
  });

  await t('multi-query fusion never introduces duplicate handles for the same underlying subject', () => {
    const hs = new HandleSession();
    const result = searchAutoIngest('memory card auto detect plug in', ctx, built, index, hs, {
      alternateQuery: 'Does the app automatically notice a memory card being plugged in?',
    });
    const handles = result.results.map((r) => r.handle);
    assert.equal(new Set(handles).size, handles.length);
  });

  await t('an empty/whitespace alternateQuery is treated as absent, not as a second empty channel', () => {
    const hsA = new HandleSession();
    const hsB = new HandleSession();
    const withEmptyAlt = searchAutoIngest('checksum verification', ctx, built, index, hsA, { alternateQuery: '   ' });
    const withoutAlt = searchAutoIngest('checksum verification', ctx, built, index, hsB);
    assert.deepEqual(withEmptyAlt.results.map((r) => r.title), withoutAlt.results.map((r) => r.title));
  });

  await t('deterministic: repeated identical calls (fresh sessions) return the same candidate titles in the same order', () => {
    const hsA = new HandleSession();
    const hsB = new HandleSession();
    const a = searchAutoIngest('photographer write lock concurrent import', ctx, built, index, hsA);
    const b = searchAutoIngest('photographer write lock concurrent import', ctx, built, index, hsB);
    assert.deepEqual(a.results.map((r) => r.title), b.results.map((r) => r.title));
  });

  summarize('askKnowledge/search.test.js');
}

main();
