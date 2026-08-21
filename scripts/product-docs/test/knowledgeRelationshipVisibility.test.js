#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/knowledgeRelationshipVisibility.test.js
// Part 5 Phase 5.1 (Decision 4 of 8) — Relationship Visibility Plumbing.
// Locks in that existing canonical Feature <-> Governance relationships
// (already extracted by lib/authorityTopics.js's buildAuthorityIndex(),
// reused here — never reparsed) are visible as supporting context on a
// Feature-primary answer, WITHOUT changing which record is primary or how
// confidently. This is a label/visibility suite: it never asserts on
// primary-record identity being caused by a relationship, only that the
// relationship appears in `sources` and that ranking is provably untouched.

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { answerQuestion, explainRelationships, buildEngineContext } = require('../lib/knowledgeEngine');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  const R14_QUESTION = 'What went wrong with the same-size skip and metadata verification?';
  const R21_QUESTION = 'What is the current status of the QMZ dedicated domain workflow decision?';

  await t('Feature -> Decision visibility: DEC-009 appears in AI-FEAT-032\'s sources (R14)', () => {
    const answer = answerQuestion(R14_QUESTION, ctx);
    assert.equal(answer.matchedCapabilities[0]?.id, 'AI-FEAT-032');
    assert.ok(answer.sources.some((s) => s.id === 'DEC-009'), 'DEC-009 should be a visible source');
  });

  await t('Feature -> Postmortem visibility: PM-001 appears in AI-FEAT-032\'s sources', () => {
    const answer = answerQuestion(R14_QUESTION, ctx);
    assert.ok(answer.sources.some((s) => s.id === 'PM-001'), 'PM-001 should be a visible source');
  });

  await t('existing Feature -> Bug behavior preserved: BUG-009 still cited, unchanged by Decision 4', () => {
    const answer = answerQuestion(R14_QUESTION, ctx);
    assert.ok(answer.sources.some((s) => s.id === 'BUG-009'), 'BUG-009 (pre-Phase-5.1 path) must remain cited');
  });

  await t('R21 / DEC-011 case: DEC-011 appears in AI-FEAT-047\'s sources', () => {
    const answer = answerQuestion(R21_QUESTION, ctx);
    assert.equal(answer.matchedCapabilities[0]?.id, 'AI-FEAT-047');
    assert.ok(answer.sources.some((s) => s.id === 'DEC-011'), 'DEC-011 should be a visible source');
    assert.ok(answer.sources.some((s) => s.id === 'BUG-007'), 'BUG-007 (pre-Phase-5.1 path) must remain cited');
  });

  await t('a visible related Governance record is never admitted into matchedCapabilities merely because the edge exists', () => {
    const answer = answerQuestion(R14_QUESTION, ctx);
    assert.ok(!answer.matchedCapabilities.some((m) => m.id === 'DEC-009' || m.id === 'PM-001'), 'DEC-009/PM-001 must appear only in sources, never as a scored/ranked candidate');
  });

  await t('no relationship lookup changes primary ranking: AI-FEAT-032\'s score/quality/confidence are the pure query.js/Phase-4.3 values, unaffected by DEC-009/PM-001 visibility', () => {
    // Score/confidence CHANGED at Phase C6 (lib/query.js's identity-mention
    // tier): "metadata verification" is AI-FEAT-032's own exact title,
    // verbatim in R14_QUESTION, so it now wins via genuine identity
    // evidence (564) instead of the old keyword-overlap-only score (400) --
    // same underlying fact as knowledgeNeighborhoodAdmission.test.js's own
    // updated case. This test's actual purpose (relationship-lookup
    // reasoning contributes zero ranking influence) is unaffected.
    const answer = answerQuestion(R14_QUESTION, ctx);
    assert.equal(answer.matchedCapabilities[0].score, 564);
    assert.equal(answer.matchQuality, 'strong');
    assert.equal(answer.confidence, 0.564);
  });

  await t('no recursive graph expansion: DEC-009 also cites AI-FEAT-019 in its own header, but AI-FEAT-019 never leaks into AI-FEAT-032\'s answer', () => {
    const answer = answerQuestion(R14_QUESTION, ctx);
    assert.ok(!answer.sources.some((s) => s.id === 'AI-FEAT-019'), 'AI-FEAT-019 must not appear -- governanceRelationshipsForFeature() reads only the PRIMARY record\'s own relationships, never a cited decision\'s OTHER related features');
    assert.equal(answer.sources.length, 6, 'exactly 6 legitimate sources: AI-FEAT-032, AI-RM-001, BUG-009, DEC-009, PM-001, AI-WF-009');
  });

  await t('canonical source traceability: every surfaced relationship carries a real, non-null canonical path', () => {
    const answer = answerQuestion(R14_QUESTION, ctx);
    const dec = answer.sources.find((s) => s.id === 'DEC-009');
    const pm = answer.sources.find((s) => s.id === 'PM-001');
    assert.ok(dec.path && dec.path.startsWith('decisions/'), `DEC-009 path should be traceable, got ${dec.path}`);
    assert.ok(pm.path && pm.path.startsWith('postmortems/'), `PM-001 path should be traceable, got ${pm.path}`);
  });

  await t('PHASE C6 DISCLOSED FINDING: this exact question now resolves Feature-primary (AI-FEAT-038), not Governance-primary (DEC-021) -- see the checkpoint report and knowledgeHistoricalContext.test.js\'s own updated case for the full mechanism', () => {
    // Was governance-primary pre-C6 (lib/query.js's identity-mention tier
    // now gives AI-FEAT-038 a raw score of 559, higher than DEC-021's raw
    // 400, so answerFromGovernanceRecord's own untouched "governance wins
    // only when it beats every other type outright" rule no longer routes
    // through it for THIS question -- the mechanism itself is unchanged;
    // this specific question no longer reaches it). DEC-021 remains cited.
    const answer = answerQuestion('What does Transfer Export do and why was its locking kept process-local?', ctx);
    assert.equal(answer.matchedCapabilities[0]?.id, 'AI-FEAT-038');
    assert.ok(answer.sources.some((s) => s.id === 'DEC-021'), 'the decision remains cited, just no longer primary');
  });

  await t('Workflow-primary case: no Governance relationship is fabricated for a Workflow, since the canonical Workflow schema has no relatedDecisions/relatedPostmortems field', () => {
    const answer = answerQuestion('How do I import photos from a memory card?', ctx);
    assert.equal(answer.matchedCapabilities[0]?.entityType, 'workflow');
    const diag = explainRelationships('How do I import photos from a memory card?', ctx);
    assert.equal(diag.relationships.length, 0, 'a Workflow-primary answer must report zero relationships -- there is no canonical basis to invent one');
    assert.ok(diag.note, 'the diagnostic must explain WHY (schema has no field), not silently return empty');
  });

  await t('explainRelationships diagnostic never influences ranking (self-proving: reads the already-finalized answer)', () => {
    const diag = explainRelationships(R14_QUESTION, ctx);
    assert.equal(diag.influencedRanking, false);
    assert.ok(diag.relationships.every((r) => r.visibility === 'visible-not-admitted'));
    assert.ok(diag.relationships.every((r) => r.projectionSource === 'authorityTopics.js buildAuthorityIndex()'));
  });

  await t('a feature with zero related decisions/postmortems shows zero fabricated relationships (no phantom edges)', () => {
    // Phase C6 UPDATE: "Why does Transfer Import exist?" now correctly
    // primaries AI-FEAT-039 (which DOES have a real related decision,
    // DEC-012 -- itself proof the fix works, see the checkpoint report),
    // so it no longer demonstrates the zero-relationships case this test
    // exists to guard. Replaced with a different, still-real
    // zero-relationships feature (AI-FEAT-041, the exact record this test
    // used to reach only via the pre-fix defect) via a question that
    // legitimately, correctly primaries it on its own merits.
    const diag = explainRelationships('What is Transfer Background/Minimize Operation?', ctx);
    assert.equal(diag.primaryId, 'AI-FEAT-041');
    assert.deepEqual(diag.relationships, []);
  });

  summarize('knowledgeRelationshipVisibility.test.js');
}

main();
