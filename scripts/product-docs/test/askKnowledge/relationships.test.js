#!/usr/bin/env node
'use strict';
// Run with: node scripts/product-docs/test/askKnowledge/relationships.test.js
// Ask AutoIngest — Stage 2, Section 23. Unit + integration tests for
// lib/askKnowledge/relationships.js (Sections 9-10: relational knowledge +
// relationship authority states SUPPORTED/CONTRADICTED/UNKNOWN/CONFLICT).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const {
  resolveRelationship, checkRelationship, describeEdge, classifyMatches,
  DIRECTIONAL_TYPES, SYMMETRIC_TYPES, PROCEDURAL_ORDERING_TYPES,
} = require('../../lib/askKnowledge/relationships');
const { HandleSession } = require('../../lib/askKnowledge/handles');

async function main() {
  const { t, summarize } = createRunner();

  await t('type classification: directional/symmetric/procedural-ordering sets are correctly partitioned', () => {
    assert.ok(DIRECTIONAL_TYPES.has('uses'));
    assert.ok(DIRECTIONAL_TYPES.has('writesTo'));
    assert.ok(DIRECTIONAL_TYPES.has('readsFrom'));
    assert.ok(DIRECTIONAL_TYPES.has('precedesInWorkflow'));
    assert.ok(SYMMETRIC_TYPES.has('distinctFrom'));
    assert.ok(PROCEDURAL_ORDERING_TYPES.has('precedesInWorkflow'));
    assert.ok(!PROCEDURAL_ORDERING_TYPES.has('uses'), 'uses must NOT be treated as having inherent temporal asymmetry');
    assert.ok(!DIRECTIONAL_TYPES.has('relatedTo'), 'relatedTo is the safe generic/non-directional default');
  });

  await t('describeEdge for a directional type states the correct subject-first ordering', () => {
    const meaning = describeEdge('precedesInWorkflow', 'subject->object', 'A', 'B');
    assert.match(meaning, /^A happens before B/);
  });

  await t('describeEdge for the reverse direction swaps first/second correctly', () => {
    const meaning = describeEdge('precedesInWorkflow', 'object->subject', 'A', 'B');
    assert.match(meaning, /^B happens before A/);
  });

  await t('describeEdge for a symmetric type never asserts an order', () => {
    const meaning = describeEdge('distinctFrom', 'subject->object', 'A', 'B');
    assert.match(meaning, /distinct\/separate/);
    assert.ok(!/before|after/.test(meaning));
  });

  await t('describeEdge for relatedTo (generic/unaudited) explicitly warns against assuming a direction', () => {
    const meaning = describeEdge('relatedTo', 'subject->object', 'A', 'B');
    assert.match(meaning, /do not assume/i);
  });

  await t('resolveRelationship: no edge in either direction returns UNKNOWN, never a negative assertion', () => {
    const result = resolveRelationship('AI-FEAT-999001', 'AI-FEAT-999002'); // ids with no KM coverage at all
    assert.equal(result.status, 'UNKNOWN');
    assert.deepEqual(result.edges, []);
    assert.match(result.note, /NOT ESTABLISHED/);
  });

  await t('integration: a real distinctFrom pair (Source Detection / Source Selection) returns CONTRADICTED, even though a precedesInWorkflow edge also exists for the same pair', () => {
    const result = resolveRelationship('AI-FEAT-011', 'AI-FEAT-012');
    assert.equal(result.status, 'CONTRADICTED');
    assert.ok(result.edges.length >= 2);
  });

  await t('integration: a real bidirectional "uses" pair (Import Pipeline / Duplicate Detection) is NOT flagged CONFLICT -- mutual usage is architecturally legitimate', () => {
    const result = resolveRelationship('AI-FEAT-019', 'AI-FEAT-020');
    assert.notEqual(result.status, 'CONFLICT');
  });

  await t('Stage 2.1 regression (DEC-024): Transfer Export/Import no longer produces a false CONFLICT now that the canonical data is corrected', () => {
    const result = resolveRelationship('AI-FEAT-038', 'AI-FEAT-039');
    assert.equal(result.status, 'SUPPORTED');
    assert.match(result.note, /directional/);
    // The corrected edge must still be discoverable both ways -- Export's
    // own precedesInWorkflow edge, plus Import's own relatedTo back-
    // reference to the same fact.
    assert.ok(result.edges.some((e) => e.type === 'precedesInWorkflow'));
    assert.ok(result.edges.some((e) => e.type === 'relatedTo'));
  });

  await t('Stage 2.1 regression (DEC-024): event.json contract\'s three previously-backwards edges no longer produce a false CONFLICT', () => {
    const pairs = [
      ['AI-FEAT-004', 'AI-FEAT-029'], // event.json <-> Metadata Writing Engine
      ['AI-FEAT-004', 'AI-FEAT-030'], // event.json <-> Metadata Durable Queue
      ['AI-FEAT-004', 'AI-FEAT-033'], // event.json <-> Metadata Audit & Repair
    ];
    for (const [a, b] of pairs) {
      const result = resolveRelationship(a, b);
      assert.notEqual(result.status, 'CONFLICT', `${a}<->${b} should not be CONFLICT`);
    }
  });

  await t('GENERAL regression (not corpus-specific): classifyMatches() detects a genuine same-type bidirectional precedesInWorkflow contradiction from synthetic fixture data', () => {
    // Proves the CONFLICT-detection MECHANISM itself, independent of
    // whatever the real corpus currently contains -- the real fixture that
    // originally proved this (Transfer Export/Import) was itself corrected
    // by DEC-024, so a test relying only on real data would silently stop
    // exercising this path the moment that data defect was fixed.
    const synthetic = classifyMatches([
      { direction: 'subject->object', type: 'precedesInWorkflow', note: 'A happens before B.', meaning: 'A happens before B.' },
      { direction: 'object->subject', type: 'precedesInWorkflow', note: 'B happens before A.', meaning: 'B happens before A.' },
    ]);
    assert.equal(synthetic.status, 'CONFLICT');
    assert.match(synthetic.note, /CONFLICTING/);
  });

  await t('GENERAL regression: classifyMatches() does NOT flag a same-type bidirectional "uses" pair as CONFLICT (mutual usage is legitimate)', () => {
    const synthetic = classifyMatches([
      { direction: 'subject->object', type: 'uses', note: 'A uses B.', meaning: 'A uses B.' },
      { direction: 'object->subject', type: 'uses', note: 'B uses A.', meaning: 'B uses A.' },
    ]);
    assert.notEqual(synthetic.status, 'CONFLICT');
  });

  await t('GENERAL regression: classifyMatches() does NOT flag distinctFrom co-occurring with a positive edge as CONFLICT (corpus convention, see DEC-023)', () => {
    const synthetic = classifyMatches([
      { direction: 'subject->object', type: 'precedesInWorkflow', note: 'A happens before B.', meaning: 'A happens before B.' },
      { direction: 'subject->object', type: 'distinctFrom', note: 'A and B are distinct mechanisms.', meaning: 'A and B are distinct/separate.' },
    ]);
    assert.equal(synthetic.status, 'CONTRADICTED');
  });

  await t('GENERAL regression: a single one-directional precedesInWorkflow edge (no reverse) is SUPPORTED, never falsely flagged CONFLICT', () => {
    const synthetic = classifyMatches([
      { direction: 'subject->object', type: 'precedesInWorkflow', note: 'A happens before B.', meaning: 'A happens before B.' },
    ]);
    assert.equal(synthetic.status, 'SUPPORTED');
  });

  await t('GENERAL regression: classifyMatches() on an empty matches array returns UNKNOWN, never invents a status', () => {
    assert.equal(classifyMatches([]).status, 'UNKNOWN');
  });

  await t('integration: a real directional pair (Import Pipeline precedesInWorkflow Audit Integrity Verification) returns SUPPORTED with a directional note', () => {
    const result = resolveRelationship('AI-FEAT-019', 'AI-FEAT-026');
    assert.equal(result.status, 'SUPPORTED');
    assert.match(result.note, /directional/);
  });

  await t('resolveRelationship is symmetric in its own call convention: swapping subject/object still finds the same edges', () => {
    const forward = resolveRelationship('AI-FEAT-038', 'AI-FEAT-039');
    const backward = resolveRelationship('AI-FEAT-039', 'AI-FEAT-038');
    assert.equal(forward.status, backward.status);
    assert.equal(forward.edges.length, backward.edges.length);
  });

  await t('checkRelationship: an invalid handle is a protocol error, never a relationship status', () => {
    const hs = new HandleSession();
    const h1 = hs.issue('AI-FEAT-011');
    const result = checkRelationship(h1, 'H999', hs);
    assert.equal(result.error, 'invalid_handle');
    assert.equal(result.status, undefined);
  });

  await t('checkRelationship: both handles resolving to the same subject returns SUPPORTED with no edges', () => {
    const hs = new HandleSession();
    const h1 = hs.issue('AI-FEAT-011');
    const h2 = hs.issue('AI-FEAT-011'); // same id -> same handle
    assert.equal(h1, h2);
    const result = checkRelationship(h1, h2, hs);
    assert.equal(result.status, 'SUPPORTED');
    assert.deepEqual(result.edges, []);
  });

  await t('checkRelationship: real handles resolve to the same result resolveRelationship itself returns', () => {
    const hs = new HandleSession();
    const h1 = hs.issue('AI-FEAT-011');
    const h2 = hs.issue('AI-FEAT-012');
    const viaHandles = checkRelationship(h1, h2, hs);
    const direct = resolveRelationship('AI-FEAT-011', 'AI-FEAT-012');
    assert.equal(viaHandles.status, direct.status);
  });

  await t('deterministic: repeated calls with identical input produce identical output', () => {
    const a = resolveRelationship('AI-FEAT-011', 'AI-FEAT-012');
    const b = resolveRelationship('AI-FEAT-011', 'AI-FEAT-012');
    assert.deepEqual(a, b);
  });

  summarize('askKnowledge/relationships.test.js');
}

main();
