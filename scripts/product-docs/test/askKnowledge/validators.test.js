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
  findNullTargetEdges, findUnresolvedTargetEdges, findTemporalContradictions,
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

  // --- Stage 2.1 (DEC-024) corpus-defect validators, tested with BOTH
  // synthetic fixtures (general, not corpus-specific) and the real corpus
  // (must now be clean, post-correction) ------------------------------------

  await t('findNullTargetEdges: GENERAL synthetic fixture with a null targetId is detected', () => {
    const synthetic = [{ id: 'A', featureId: 'FA', relationships: [{ type: 'distinctFrom', targetId: null, note: 'incomplete' }] }];
    const found = findNullTargetEdges(synthetic);
    assert.equal(found.length, 1);
    assert.equal(found[0].fromId, 'A');
  });

  await t('findNullTargetEdges: a synthetic fixture with every targetId populated finds nothing', () => {
    const synthetic = [{ id: 'A', featureId: 'FA', relationships: [{ type: 'relatedTo', targetId: 'FB', note: 'fine' }] }];
    assert.deepEqual(findNullTargetEdges(synthetic), []);
  });

  await t('findNullTargetEdges: real corpus regression -- zero null targets after DEC-024\'s QMZ correction', () => {
    assert.deepEqual(findNullTargetEdges(), []);
  });

  await t('findUnresolvedTargetEdges: GENERAL synthetic fixture with a dangling targetId is detected', () => {
    const synthetic = [{ id: 'A', featureId: 'FA', relationships: [{ type: 'uses', targetId: 'NOT-A-REAL-ID', note: 'broken' }] }];
    const found = findUnresolvedTargetEdges(synthetic);
    assert.equal(found.length, 1);
  });

  await t('findUnresolvedTargetEdges: a targetId matching the recognized AI-FEAT/AI-WF shape is not flagged, even without a KM record for it', () => {
    const synthetic = [{ id: 'A', featureId: 'FA', relationships: [{ type: 'uses', targetId: 'AI-FEAT-999999', note: 'no KM record but real id shape' }] }];
    assert.deepEqual(findUnresolvedTargetEdges(synthetic), []);
  });

  await t('findUnresolvedTargetEdges: real corpus regression -- zero unresolved targets', () => {
    assert.deepEqual(findUnresolvedTargetEdges(), []);
  });

  await t('findTemporalContradictions: GENERAL synthetic fixture with same-type opposite-direction precedesInWorkflow is detected', () => {
    const synthetic = [
      { id: 'A', featureId: 'FA', relationships: [{ type: 'precedesInWorkflow', targetId: 'FB', note: 'A before B' }] },
      { id: 'B', featureId: 'FB', relationships: [{ type: 'precedesInWorkflow', targetId: 'FA', note: 'B before A' }] },
    ];
    const found = findTemporalContradictions(synthetic);
    assert.equal(found.length, 1);
  });

  await t('findTemporalContradictions: a single one-directional edge (no reverse) is never flagged', () => {
    const synthetic = [
      { id: 'A', featureId: 'FA', relationships: [{ type: 'precedesInWorkflow', targetId: 'FB', note: 'A before B' }] },
      { id: 'B', featureId: 'FB', relationships: [] },
    ];
    assert.deepEqual(findTemporalContradictions(synthetic), []);
  });

  await t('findTemporalContradictions: a same-type bidirectional "uses" pair is never flagged (only precedesInWorkflow is scoped in)', () => {
    const synthetic = [
      { id: 'A', featureId: 'FA', relationships: [{ type: 'uses', targetId: 'FB', note: 'A uses B' }] },
      { id: 'B', featureId: 'FB', relationships: [{ type: 'uses', targetId: 'FA', note: 'B uses A' }] },
    ];
    assert.deepEqual(findTemporalContradictions(synthetic), []);
  });

  await t('findTemporalContradictions: real corpus regression -- zero temporal contradictions after DEC-024\'s Transfer Export/Import correction', () => {
    assert.deepEqual(findTemporalContradictions(), []);
  });

  summarize('askKnowledge/validators.test.js');
}

main();
