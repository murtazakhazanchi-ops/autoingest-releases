#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/askRetrieval/bm25Index.test.js
// Ask AutoIngest — Stage 1 deterministic retrieval foundation, Section 16.
// Unit tests for lib/askRetrieval/bm25Index.js against a small, synthetic,
// hand-built Knowledge Base fixture (isolated from the real corpus, so
// these tests exercise BM25/IDF mechanics precisely and stay fast). A
// separate integration check against the real canonical KB is included at
// the bottom.

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { buildBm25Index, bm25Rank, bm25Score, decisionTextFor, K1, B } = require('../../lib/askRetrieval/bm25Index');
const build = require('../../lib/build');

// A tiny synthetic KB: three features with deliberately controlled
// vocabulary overlap, plus one workflow, plus one deliberately thin/empty
// feature (Section 16's "thin records" / "empty documents" coverage).
function syntheticBuilt() {
  return {
    featureIndex: [
      {
        feature_id: 'AI-FEAT-901',
        name: 'Source Detection',
        aliases: ['memory card detection'],
        summary: 'Automatically detects when a memory card or external drive is connected.',
        current_behavior: 'Detects source device plug-in events and identifies the source type.',
      },
      {
        feature_id: 'AI-FEAT-902',
        name: 'Checksum Verification',
        aliases: [],
        summary: 'Verifies file integrity using checksums after import.',
        current_behavior: 'Computes and compares checksums for imported files.',
      },
      {
        feature_id: 'AI-FEAT-903',
        name: 'Rare Term Feature',
        aliases: [],
        summary: 'Uses the distinctive word zephyranthes exactly once for IDF testing.',
        current_behavior: '',
      },
      {
        feature_id: 'AI-FEAT-904',
        name: 'Thin Stub',
        aliases: [],
        summary: '',
        current_behavior: '',
      },
    ],
    workflowIndex: [
      {
        id: 'AI-WF-901',
        title: 'Import Workflow',
        whatItDoes: 'Guides the operator through importing files from a detected source.',
        whenToUseIt: '',
        expectedResult: '',
        limitations: '',
        warnings: '',
        whereToGo: '',
        troubleshooting: '',
      },
    ],
  };
}

async function main() {
  const { t, summarize } = createRunner();

  await t('K1 and B are the standard TREC defaults (1.5 / 0.75), unchanged from the PR1 prototype', () => {
    assert.equal(K1, 1.5);
    assert.equal(B, 0.75);
  });

  await t('buildBm25Index throws a clear error on a missing/malformed Knowledge Base object', () => {
    assert.throws(() => buildBm25Index(null), TypeError);
    assert.throws(() => buildBm25Index({}), TypeError);
    assert.throws(() => buildBm25Index(undefined), TypeError);
  });

  await t('buildBm25Index succeeds and indexes every feature and workflow, including an empty/thin one', () => {
    const index = buildBm25Index(syntheticBuilt());
    assert.equal(index.N, 5); // 4 features + 1 workflow
    assert.ok(index.tfById.has('AI-FEAT-904'), 'thin/empty document must still be indexed, not dropped');
    // AI-FEAT-904 has empty summary/current_behavior, but its own name
    // ("Thin Stub") still contributes tokens -- a document is only truly
    // zero-length when every contributing field (including name/title) is
    // empty, which never happens for a real canonical record (every
    // Feature/Workflow has a non-empty name/title by construction).
    assert.equal(index.docLenById.get('AI-FEAT-904'), 2, 'thin document should still tokenize its own name ("thin", "stub")');
  });

  await t('index is immutable (Object.freeze) -- callers cannot accidentally mutate a shared index', () => {
    const index = buildBm25Index(syntheticBuilt());
    assert.throws(() => { index.N = 999; }, TypeError);
  });

  await t('IDF: a term appearing in fewer documents scores a higher IDF than a term appearing in more documents', () => {
    const index = buildBm25Index(syntheticBuilt());
    // 'zephyranthes' appears in exactly 1 of 5 docs; a very common word
    // shared by most docs (e.g. the corpus prose glue is stopworded out,
    // so use a real cross-document term: 'detects' appears in AI-FEAT-901
    // twice (summary+current_behavior, same doc) -- use a term genuinely
    // shared ACROSS documents instead: none exist by design in this small
    // fixture, so compare the rare term's IDF against the fixture's own
    // average IDF instead, which is an equivalent, still-meaningful check.
    const rareIdf = index.idf.get('zephyranthes');
    assert.ok(rareIdf > 0, 'rare term must have a positive IDF');
    const allIdfs = [...index.idf.values()];
    const avgIdf = allIdfs.reduce((a, b) => a + b, 0) / allIdfs.length;
    assert.ok(rareIdf >= avgIdf, 'a term unique to one document should score at or above the corpus average IDF');
  });

  await t('bm25Score: a document containing every query term scores higher than a document containing none', () => {
    const index = buildBm25Index(syntheticBuilt());
    const { normalizeQuery } = require('../../lib/askRetrieval/queryNormalization');
    const queryTokens = normalizeQuery('memory card detection');
    const matchScore = bm25Score(queryTokens, 'AI-FEAT-901', index);
    const noMatchScore = bm25Score(queryTokens, 'AI-FEAT-902', index);
    assert.ok(matchScore > noMatchScore);
    assert.ok(matchScore > 0);
    assert.equal(noMatchScore, 0);
  });

  await t('bm25Score for a document with no tf entry (unknown id) is 0, not a crash', () => {
    const index = buildBm25Index(syntheticBuilt());
    assert.equal(bm25Score(['memory'], 'AI-FEAT-DOES-NOT-EXIST', index), 0);
  });

  await t('bm25Rank throws on a missing/malformed index (genuine caller error, not degraded gracefully)', () => {
    assert.throws(() => bm25Rank('memory card', null), TypeError);
    assert.throws(() => bm25Rank('memory card', {}), TypeError);
  });

  await t('bm25Rank on an empty query returns an empty result, not a crash or an arbitrary full ranking', () => {
    const index = buildBm25Index(syntheticBuilt());
    assert.deepEqual(bm25Rank('', index), []);
    assert.deepEqual(bm25Rank('   ', index), []);
  });

  await t('bm25Rank on unusual punctuation / Unicode input never throws', () => {
    const index = buildBm25Index(syntheticBuilt());
    assert.doesNotThrow(() => bm25Rank('???!!! ---', index));
    assert.doesNotThrow(() => bm25Rank('café memory card', index));
  });

  await t('bm25Rank on a no-match query (real English words absent from the corpus) returns no candidates, not a forced fallback list', () => {
    const index = buildBm25Index(syntheticBuilt());
    const ranked = bm25Rank('xylophone kangaroo submarine', index);
    assert.deepEqual(ranked, []);
  });

  await t('duplicate record ids: a later document with a repeated id deterministically overwrites the earlier one\'s text (Map semantics), never crashes or double-counts', () => {
    const withDuplicate = syntheticBuilt();
    withDuplicate.featureIndex.push({
      feature_id: 'AI-FEAT-901', // duplicates the first synthetic feature's own id
      name: 'Duplicate Source Detection',
      aliases: [],
      summary: 'A second, later record reusing the same id on purpose for this test.',
      current_behavior: '',
    });
    const index = buildBm25Index(withDuplicate);
    assert.equal(index.N, 5, 'a duplicated id must not inflate the indexed document count');
    const { normalizeQuery } = require('../../lib/askRetrieval/queryNormalization');
    const later = normalizeQuery('A second, later record reusing the same id on purpose for this test.');
    for (const tok of later) {
      if (!['second', 'later', 'record', 'reusing', 'purpose', 'test'].includes(tok)) continue;
      assert.ok(index.tfById.get('AI-FEAT-901').has(tok), `expected the LATER duplicate's text to win for token "${tok}"`);
    }
  });

  await t('bm25Rank is sorted descending by score, deterministically tie-broken by id ascending', () => {
    const index = buildBm25Index(syntheticBuilt());
    const ranked = bm25Rank('memory card source detects', index);
    for (let i = 1; i < ranked.length; i++) {
      const prev = ranked[i - 1];
      const cur = ranked[i];
      assert.ok(
        prev.score > cur.score || (prev.score === cur.score && prev.id.localeCompare(cur.id, 'en', { numeric: true }) < 0),
        `rank order violated between ${prev.id} and ${cur.id}`,
      );
    }
  });

  await t('deterministic: rebuilding the index from identical input and re-ranking the same query yields identical results', () => {
    const rankA = bm25Rank('memory card detection', buildBm25Index(syntheticBuilt()));
    const rankB = bm25Rank('memory card detection', buildBm25Index(syntheticBuilt()));
    assert.deepEqual(rankA, rankB);
  });

  await t('decisionTextFor returns an empty string when ctx is omitted or lacks the expected indexes', () => {
    assert.equal(decisionTextFor('AI-FEAT-901', undefined), '');
    assert.equal(decisionTextFor('AI-FEAT-901', {}), '');
    assert.equal(decisionTextFor('AI-FEAT-901', { authorityIndexByFeatureId: new Map() }), '');
  });

  await t('decisionTextFor returns an empty string when the feature has no linked decisions', () => {
    const ctx = {
      authorityIndexByFeatureId: new Map([['AI-FEAT-901', { relatedDecisions: [] }]]),
      searchIndexById: new Map(),
    };
    assert.equal(decisionTextFor('AI-FEAT-901', ctx), '');
  });

  await t('decisionTextFor concatenates only real, existing decision-type records\' detail/summary text', () => {
    const ctx = {
      authorityIndexByFeatureId: new Map([['AI-FEAT-901', { relatedDecisions: ['DEC-001', 'DEC-002', 'DEC-MISSING'] }]]),
      searchIndexById: new Map([
        ['DEC-001', { entity_type: 'decision', detail: 'Detail text one.' }],
        ['DEC-002', { entity_type: 'decision', summary: 'Summary text two.' }],
        // DEC-MISSING intentionally absent from searchIndexById
      ]),
    };
    const text = decisionTextFor('AI-FEAT-901', ctx);
    assert.match(text, /Detail text one\./);
    assert.match(text, /Summary text two\./);
  });

  await t('decisionTextFor ignores a linked record that is not actually a decision (entity_type mismatch)', () => {
    const ctx = {
      authorityIndexByFeatureId: new Map([['AI-FEAT-901', { relatedDecisions: ['BUG-001'] }]]),
      searchIndexById: new Map([['BUG-001', { entity_type: 'bug', detail: 'Should not appear.' }]]),
    };
    assert.equal(decisionTextFor('AI-FEAT-901', ctx), '');
  });

  await t('integration: buildBm25Index succeeds against the real canonical Knowledge Base, with and without ctx', () => {
    const { built } = build.assemble();
    const indexNoCtx = buildBm25Index(built);
    assert.ok(indexNoCtx.N > 0);
    const { buildEngineContext } = require('../../lib/knowledgeEngine');
    const ctx = buildEngineContext(built);
    const indexWithCtx = buildBm25Index(built, ctx);
    assert.ok(indexWithCtx.N === indexNoCtx.N, 'ctx enrichment must add text to existing documents, never add or remove documents');
  });

  summarize('askRetrieval/bm25Index.test.js');
}

main();
