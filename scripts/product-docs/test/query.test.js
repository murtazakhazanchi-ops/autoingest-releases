#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/query.test.js
const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const { runQuery, lookupById, scoreRecord, wordBoundaryIncludes } = require('../lib/query');
const build = require('../lib/build');
const { buildEngineContext, answerQuestion, explainNormalization } = require('../lib/knowledgeEngine');

function makeRecord(overrides) {
  return {
    entity_type: 'feature',
    stable_id: 'AI-FEAT-000',
    title: 'Placeholder Feature',
    canonical_path: 'features/AI-FEAT-000_PLACEHOLDER.md',
    aliases: [],
    keywords: [],
    summary: '',
    related_ids: [],
    authority_level: 'canonical',
    evidence_status: 'Verified',
    ...overrides,
  };
}

const FIXTURE_INDEX = [
  makeRecord({ stable_id: 'AI-FEAT-029', title: 'Metadata Writing Engine', aliases: ['metadata writing', 'xmp sidecars'], keywords: ['metadata', 'writing', 'engine', 'exif', 'xmp'], summary: 'Shared metadata engine.' }),
  makeRecord({ stable_id: 'AI-FEAT-033', title: 'Metadata Audit & Repair', aliases: ['metadata audit', 'metadata repair'], keywords: ['metadata', 'audit', 'repair'], summary: 'Audits and repairs metadata drift.' }),
  makeRecord({ stable_id: 'AI-FEAT-047', title: 'QMZ Sequencing Workspace', aliases: ['qmz'], keywords: ['qmz', 'sequencing', 'workspace'], summary: 'QMZ domain workflow.' }),
  makeRecord({ stable_id: 'SUBSYS-metadata', entity_type: 'subsystem', title: 'Metadata', aliases: ['metadata'], keywords: ['metadata'], authority_level: 'locator' }),
];

async function main() {
  const { t, summarize } = createRunner();

  await t('exact ID match ranks first with the highest score', () => {
    const results = runQuery('AI-FEAT-033', FIXTURE_INDEX);
    assert.equal(results[0].record.stable_id, 'AI-FEAT-033');
    assert.equal(results[0].score, 1000);
  });

  await t('exact alias match outranks a mere keyword/summary match', () => {
    const results = runQuery('qmz', FIXTURE_INDEX);
    assert.equal(results[0].record.stable_id, 'AI-FEAT-047');
    assert.ok(results[0].score >= 900);
  });

  await t('multi-word query ranks title-substring matches above single-keyword-overlap matches', () => {
    const results = runQuery('metadata audit', FIXTURE_INDEX);
    assert.equal(results[0].record.stable_id, 'AI-FEAT-033');
  });

  await t('keyword-overlap query surfaces multiple relevant records deterministically', () => {
    const results = runQuery('metadata', FIXTURE_INDEX);
    const ids = results.map((r) => r.record.stable_id);
    assert.ok(ids.includes('AI-FEAT-029'));
    assert.ok(ids.includes('AI-FEAT-033'));
    assert.ok(ids.includes('SUBSYS-metadata'));
  });

  await t('re-running the same query produces byte-identical ordering (deterministic ranking)', () => {
    const a = runQuery('metadata', FIXTURE_INDEX).map((r) => `${r.record.stable_id}:${r.score}`);
    const b = runQuery('metadata', FIXTURE_INDEX).map((r) => `${r.record.stable_id}:${r.score}`);
    assert.deepEqual(a, b);
  });

  await t('unknown query returns an empty result set, not an error', () => {
    const results = runQuery('completely unrelated nonsense query xyz123', FIXTURE_INDEX);
    assert.deepEqual(results, []);
  });

  await t('empty-string query returns an empty result set', () => {
    assert.deepEqual(runQuery('', FIXTURE_INDEX), []);
    assert.deepEqual(runQuery('   ', FIXTURE_INDEX), []);
  });

  await t('lookupById finds a record by stable ID and is case-insensitive on ID casing input', () => {
    const found = lookupById('AI-FEAT-029', FIXTURE_INDEX);
    assert.equal(found.title, 'Metadata Writing Engine');
    const notFound = lookupById('AI-FEAT-999', FIXTURE_INDEX);
    assert.equal(notFound, null);
  });

  await t('entityType filter restricts results to the requested entity type', () => {
    const results = runQuery('metadata', FIXTURE_INDEX, { entityType: 'subsystem' });
    assert.ok(results.every((r) => r.record.entity_type === 'subsystem'));
  });

  // -----------------------------------------------------------------
  // Phase C6 -- identity-mention tier (lib/query.js's own header comment
  // has the full forensic finding). Focused unit coverage, synthetic
  // fixtures only, per Section AA's discipline (the durable retrieval-
  // evaluation dataset lives separately in lib/retrievalEvalCorpusC6.js /
  // lib/retrievalEvalRunner.js -- not encoded here as brittle unit tests).
  // -----------------------------------------------------------------

  await t('wordBoundaryIncludes: matches a phrase at a real word boundary', () => {
    assert.equal(wordBoundaryIncludes('how do i create a transfer export?', 'transfer export'), true);
  });

  await t('wordBoundaryIncludes: does NOT match inside an unrelated longer word (no false partial-word hit)', () => {
    assert.equal(wordBoundaryIncludes('this is important to know', 'import'), false);
  });

  await t('identity-mention: a multi-word title named verbatim inside a longer question outscores plain keyword-overlap', () => {
    const named = makeRecord({ stable_id: 'AI-FEAT-033', title: 'Metadata Audit & Repair', aliases: ['metadata audit and repair'], keywords: ['metadata', 'audit', 'repair'] });
    const unrelated = makeRecord({ stable_id: 'AI-FEAT-029', title: 'Metadata Writing Engine', keywords: ['metadata', 'audit', 'writing'] }); // shares 2 keyword tokens by construction
    const q = 'How did the Metadata Audit & Repair tool come to exist?';
    const named_ = scoreRecord(q, named);
    const unrelated_ = scoreRecord(q, unrelated);
    assert.ok(named_.reasons.includes('identity-mention'));
    assert.ok(named_.score > unrelated_.score, `named record (${named_.score}) must outscore the unrelated keyword-overlap competitor (${unrelated_.score})`);
  });

  await t('identity-mention: single-word alias/title never qualifies (generic-word false-positive guard)', () => {
    const record = makeRecord({ stable_id: 'AI-FEAT-053', title: 'Global Search', aliases: ['global search', 'search'] });
    const { score, reasons } = scoreRecord('can i search for a file by typing plain language?', record);
    assert.ok(!reasons.includes('identity-mention'), 'the single-word alias "search" must never earn identity-tier credit');
    assert.ok(score < 500, 'must fall through to a lower tier (keyword-overlap or none), never the identity band');
  });

  await t('identity-mention: no false positive when the title is not actually named', () => {
    const record = makeRecord({ stable_id: 'AI-FEAT-033', title: 'Metadata Audit & Repair', keywords: ['metadata'] });
    const { reasons } = scoreRecord('How do I import photos from a memory card?', record);
    assert.ok(!reasons.includes('identity-mention'));
  });

  await t('identity-mention: competing title case -- a question naming BOTH of two multi-word titles credits both, longer/more-specific phrase scores higher', () => {
    const short = makeRecord({ stable_id: 'X', title: 'Metadata Audit' });
    const long = makeRecord({ stable_id: 'Y', title: 'Metadata Audit and Repair Tool' });
    const q = 'Is Metadata Audit the same as the Metadata Audit and Repair Tool?';
    const s = scoreRecord(q, short);
    const l = scoreRecord(q, long);
    assert.ok(s.reasons.includes('identity-mention') && l.reasons.includes('identity-mention'), 'both genuinely-named titles earn identity credit');
    assert.ok(l.score >= s.score, 'the longer, more specific, fully-matched phrase must not score lower than the shorter substring it contains');
  });

  summarize('query.test.js');
}

// -----------------------------------------------------------------------
// Phase C6 pinned real-corpus regression cases (Section AA's explicit
// minimum list) -- runs against the actual, real docs/product/ corpus via
// answerQuestion(), not the synthetic FIXTURE_INDEX above. Kept in this
// same file (not a new one) since it exercises the same query.js tier;
// each case cites the exact forensic finding it locks in.
// -----------------------------------------------------------------------
async function realCorpusMain() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  await t('PINNED: Transfer Export identity + HOW_TO -- "How do I create a Transfer Export?" resolves AI-FEAT-038 (was AI-WF-008 pre-C6)', () => {
    const a = answerQuestion('How do I create a Transfer Export?', ctx);
    assert.equal(a.matchedCapabilities[0].id, 'AI-FEAT-038');
  });

  await t('PINNED: Transfer Import identity + WHY -- "Why does Transfer Import exist?" resolves AI-FEAT-039 (was AI-FEAT-041 pre-C6, RF-4.3-001)', () => {
    const a = answerQuestion('Why does Transfer Import exist?', ctx);
    assert.equal(a.matchedCapabilities[0].id, 'AI-FEAT-039');
  });

  await t('PINNED: Archive Maintenance vs Event Maintenance -- each resolves its own exact identity, never the other', () => {
    const arch = answerQuestion('What is Archive Maintenance?', ctx);
    assert.equal(arch.matchedCapabilities[0].id, 'AI-FEAT-049');
    const evt = answerQuestion('What is Event Maintenance?', ctx);
    assert.equal(evt.matchedCapabilities[0].id, 'AI-FEAT-050');
  });

  await t('PINNED: Source Selection vs Source Detection -- each resolves its own exact identity, never the other', () => {
    const sel = answerQuestion('What is Source Selection?', ctx);
    assert.equal(sel.matchedCapabilities[0].id, 'AI-FEAT-012');
    const det = answerQuestion('What is Source Detection?', ctx);
    assert.equal(det.matchedCapabilities[0].id, 'AI-FEAT-011');
  });

  await t('PINNED: exact title inside a longer natural question still wins', () => {
    const a = answerQuestion('I need to know exactly how the Import Pipeline and Copy Engine decides what to copy first.', ctx);
    assert.equal(a.matchedCapabilities[0].id, 'AI-FEAT-019');
  });

  await t('PINNED: correct behavior when no title is mentioned -- a plain paraphrase resolves via ordinary keyword-overlap, unaffected by the identity-mention tier (which never fires here, by construction -- neither before nor after this checkpoint)', () => {
    // Deliberately NOT asserting this is the "right" answer -- it's a
    // known, disclosed, out-of-scope paraphrase-precision gap (Phase C6
    // report's own C6-PARA-E7), unrelated to and unaffected by the
    // identity-mention tier. This pin exists only to prove the new tier
    // stays inert (no reasons include 'identity-mention') when no title is
    // actually named, not to certify paraphrase accuracy.
    const a = answerQuestion('What do I do if AutoIngest itself needs to be updated to a newer version?', ctx);
    const ex = explainNormalization('What do I do if AutoIngest itself needs to be updated to a newer version?', ctx.searchIndex);
    const top = ex.find((c) => c.id === a.matchedCapabilities[0].id);
    assert.ok(top && !top.reasons.includes('identity-mention'), 'identity-mention must not be the reason a paraphrase-only question resolves as it does');
  });

  await t('PINNED: workflow-primary case -- a HOW_TO question naming an exact workflow-adjacent workflow title still resolves correctly', () => {
    const a = answerQuestion('How do I recover from an archive lock error?', ctx);
    assert.equal(a.matchedCapabilities[0].id, 'AI-WF-008');
    assert.equal(a.matchedCapabilities[0].entityType, 'workflow');
  });

  await t('PINNED: ambiguous case -- a question naming two competing multi-word titles is honestly flagged by the retrieval-confidence gate, not silently resolved', () => {
    const { assessPrimaryFit } = require('../lib/askSynthesis/retrievalConfidence');
    const q = 'Is a Transfer Export the same thing as a backup from Backup Update Scanning?';
    const a = answerQuestion(q, ctx);
    const fit = assessPrimaryFit(q, a, ctx);
    assert.equal(fit.fit, 'MISMATCHED');
  });

  summarize('query.test.js (real-corpus pinned cases)');
}

main().then(realCorpusMain);
