#!/usr/bin/env node
'use strict';
// Run with: node scripts/product-docs/test/askKnowledge/validators.test.js
// Ask AutoIngest — Stage 2, Section 21/23. Unit tests for
// lib/askKnowledge/validators.js's deterministic Knowledge Base/tool-layer
// validators (not the full conversational answer validator).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const {
  isWellFormedHandleShape, handleCollidesWithInternalIdShape,
  isValidRelationType, classifyRelationType, isRecognizedRecordIdShape,
  scanForLeaks, validateKnowledgeRecord, validateFullCorpus, checkImpossibleStates,
} = require('../../lib/askKnowledge/validators');
const { STATUS, EXTRACTION_TIERS } = require('../../lib/knowledgeModel/schema');

async function main() {
  const { t, summarize } = createRunner();

  await t('isWellFormedHandleShape accepts H<n>, rejects everything else', () => {
    assert.equal(isWellFormedHandleShape('H1'), true);
    assert.equal(isWellFormedHandleShape('H42'), true);
    assert.equal(isWellFormedHandleShape('AI-FEAT-001'), false);
    assert.equal(isWellFormedHandleShape('h1'), false); // case-sensitive
    assert.equal(isWellFormedHandleShape(''), false);
    assert.equal(isWellFormedHandleShape(undefined), false);
  });

  await t('handleCollidesWithInternalIdShape detects every real internal id prefix', () => {
    for (const id of ['AI-FEAT-001', 'AI-WF-001', 'KM-x', 'DEC-013', 'BUG-004', 'PM-001', 'AI-MEM-0001', 'AI-RM-002']) {
      assert.equal(handleCollidesWithInternalIdShape(id), true, `${id} should collide`);
    }
    assert.equal(handleCollidesWithInternalIdShape('H1'), false);
  });

  await t('isValidRelationType accepts only schema.js\'s own RELATIONSHIP_TYPES', () => {
    assert.equal(isValidRelationType('uses'), true);
    assert.equal(isValidRelationType('distinctFrom'), true);
    assert.equal(isValidRelationType('madeUpType'), false);
  });

  await t('classifyRelationType partitions every real relationship type unambiguously', () => {
    assert.equal(classifyRelationType('uses'), 'DIRECTIONAL');
    assert.equal(classifyRelationType('writesTo'), 'DIRECTIONAL');
    assert.equal(classifyRelationType('readsFrom'), 'DIRECTIONAL');
    assert.equal(classifyRelationType('precedesInWorkflow'), 'DIRECTIONAL');
    assert.equal(classifyRelationType('distinctFrom'), 'SYMMETRIC');
    assert.equal(classifyRelationType('relatedTo'), 'GENERIC_UNKNOWN');
    assert.equal(classifyRelationType('somethingNew'), 'GENERIC_UNKNOWN');
  });

  await t('isRecognizedRecordIdShape accepts AI-FEAT-###/AI-WF-###, rejects everything else', () => {
    assert.equal(isRecognizedRecordIdShape('AI-FEAT-001'), true);
    assert.equal(isRecognizedRecordIdShape('AI-WF-009'), true);
    assert.equal(isRecognizedRecordIdShape('KM-x'), false);
    assert.equal(isRecognizedRecordIdShape('H1'), false);
  });

  await t('scanForLeaks finds a leak nested at any depth (object, array, deeply nested)', () => {
    const dirty = { a: { b: [{ c: 'see DEC-013 for detail' }] } };
    const leaks = scanForLeaks(dirty);
    assert.equal(leaks.length, 1);
    assert.equal(leaks[0].path, '$.a.b[0].c');
  });

  await t('scanForLeaks finds every leak, not just the first', () => {
    const dirty = { a: 'DEC-001', b: 'DEC-002' };
    assert.equal(scanForLeaks(dirty).length, 2);
  });

  await t('scanForLeaks on a fully clean object returns empty', () => {
    assert.deepEqual(scanForLeaks({ title: 'Fine', results: [{ handle: 'H1', kind: 'feature' }] }), []);
  });

  await t('validateKnowledgeRecord flags a record with no provenance', () => {
    const bad = { id: 'KM-test', title: 'Test', status: STATUS.IMPLEMENTED, provenance: [], extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED };
    const errors = validateKnowledgeRecord(bad);
    assert.ok(errors.some((e) => /no provenance/.test(e)));
  });

  await t('validateKnowledgeRecord accepts a genuinely well-formed record', () => {
    const good = {
      id: 'KM-test', title: 'Test', status: STATUS.IMPLEMENTED,
      provenance: [{ claim: 'x', source: 'y', type: 'code', confidence: 'high' }],
      extractionTier: EXTRACTION_TIERS.FORENSIC_VERIFIED,
    };
    assert.deepEqual(validateKnowledgeRecord(good), []);
  });

  await t('integration: the real, promoted Knowledge Model corpus has zero schema validation errors', () => {
    assert.deepEqual(validateFullCorpus(), []);
  });

  await t('checkImpossibleStates flags EMPTY knowledgeState with non-empty dimensions', () => {
    const violations = checkImpossibleStates({ knowledgeState: 'EMPTY', dimensions: { purpose: 'x' } });
    assert.ok(violations.length > 0);
  });

  await t('checkImpossibleStates flags an error field coexisting with a real result payload', () => {
    const violations = checkImpossibleStates({ error: 'invalid_handle', status: 'AVAILABLE' });
    assert.ok(violations.length > 0);
  });

  await t('checkImpossibleStates accepts a genuinely well-formed result with no violations', () => {
    assert.deepEqual(checkImpossibleStates({ knowledgeState: 'DOCUMENTED', dimensions: { purpose: 'x' } }), []);
    assert.deepEqual(checkImpossibleStates({ error: 'invalid_handle', note: 'x' }), []);
    assert.deepEqual(checkImpossibleStates({ status: 'UNKNOWN', edges: [] }), []);
  });

  summarize('askKnowledge/validators.test.js');
}

main();
