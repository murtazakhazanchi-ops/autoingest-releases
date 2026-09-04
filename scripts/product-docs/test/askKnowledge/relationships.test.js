#!/usr/bin/env node
'use strict';
// Run with: node scripts/product-docs/test/askKnowledge/relationships.test.js
// Ask AutoIngest — Stage 2, Section 23. Unit + integration tests for
// lib/askKnowledge/relationships.js (Sections 9-10: relational knowledge +
// relationship authority states SUPPORTED/CONTRADICTED/UNKNOWN/CONFLICT).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const {
  resolveRelationship, checkRelationship, describeEdge,
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

  await t('integration: a real same-type bidirectional precedesInWorkflow pair (Transfer Export / Transfer Import) returns CONFLICT -- genuine temporal-asymmetry contradiction', () => {
    const result = resolveRelationship('AI-FEAT-038', 'AI-FEAT-039');
    assert.equal(result.status, 'CONFLICT');
    assert.match(result.note, /CONFLICTING/);
    assert.ok(result.edges.length >= 2);
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
