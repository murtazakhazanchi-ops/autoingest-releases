#!/usr/bin/env node
'use strict';
// Run with: node scripts/product-docs/test/askKnowledge/sourcePrecedence.test.js
// Ask AutoIngest — Stage 2, Section 23. Unit tests for
// lib/askKnowledge/sourcePrecedence.js (Section 7: source precedence and
// conflict detection between the live status resolver and the Knowledge
// Model's own static status field).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { LIVE_TO_KM_STATUS, checkStatusConsistency } = require('../../lib/askKnowledge/sourcePrecedence');
const { STATUS } = require('../../lib/knowledgeModel/schema');
const { QUERY_STATUS } = require('../../lib/statusResolution');

async function main() {
  const { t, summarize } = createRunner();

  await t('crosswalk maps every live QUERY_STATUS value onto a KM STATUS value', () => {
    assert.equal(LIVE_TO_KM_STATUS[QUERY_STATUS.AVAILABLE], STATUS.IMPLEMENTED);
    assert.equal(LIVE_TO_KM_STATUS[QUERY_STATUS.PARTIALLY_AVAILABLE], STATUS.IMPLEMENTED);
    assert.equal(LIVE_TO_KM_STATUS[QUERY_STATUS.PLANNED], STATUS.PLANNED);
    assert.equal(LIVE_TO_KM_STATUS[QUERY_STATUS.NOT_SUPPORTED], STATUS.NOT_SUPPORTED);
    assert.equal(LIVE_TO_KM_STATUS[QUERY_STATUS.UNKNOWN], STATUS.UNKNOWN);
  });

  await t('checkStatusConsistency: no KM records at all agrees trivially (nothing to disagree with)', () => {
    const result = checkStatusConsistency('AI-FEAT-999', QUERY_STATUS.AVAILABLE, []);
    assert.equal(result.agree, true);
    assert.deepEqual(result.conflicts, []);
  });

  await t('checkStatusConsistency: a KM record whose status matches the crosswalked live status agrees', () => {
    const kmRecords = [{ id: 'KM-x', status: STATUS.IMPLEMENTED }];
    const result = checkStatusConsistency('AI-FEAT-999', QUERY_STATUS.AVAILABLE, kmRecords);
    assert.equal(result.agree, true);
  });

  await t('checkStatusConsistency: PARTIALLY_AVAILABLE also crosswalks to IMPLEMENTED and agrees', () => {
    const kmRecords = [{ id: 'KM-x', status: STATUS.IMPLEMENTED }];
    const result = checkStatusConsistency('AI-FEAT-999', QUERY_STATUS.PARTIALLY_AVAILABLE, kmRecords);
    assert.equal(result.agree, true);
  });

  await t('checkStatusConsistency: a genuine mismatch (live PLANNED vs KM NOT_SUPPORTED) is surfaced, not silently resolved', () => {
    const kmRecords = [{ id: 'KM-x', status: STATUS.NOT_SUPPORTED }];
    const result = checkStatusConsistency('AI-FEAT-999', QUERY_STATUS.PLANNED, kmRecords);
    assert.equal(result.agree, false);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].kmRecordId, 'KM-x');
    assert.equal(result.conflicts[0].liveStatus, QUERY_STATUS.PLANNED);
    assert.equal(result.conflicts[0].kmStatus, STATUS.NOT_SUPPORTED);
  });

  await t('checkStatusConsistency: multiple KM records for one featureId are each checked independently', () => {
    const kmRecords = [
      { id: 'KM-a', status: STATUS.IMPLEMENTED },
      { id: 'KM-b', status: STATUS.NOT_SUPPORTED },
    ];
    const result = checkStatusConsistency('AI-FEAT-999', QUERY_STATUS.AVAILABLE, kmRecords);
    assert.equal(result.agree, false);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].kmRecordId, 'KM-b');
  });

  await t('checkStatusConsistency: a KM record with no status field is skipped, never a false conflict', () => {
    const kmRecords = [{ id: 'KM-x', status: null }];
    const result = checkStatusConsistency('AI-FEAT-999', QUERY_STATUS.AVAILABLE, kmRecords);
    assert.equal(result.agree, true);
  });

  await t('integration: the real Knowledge Model has zero live/KM status disagreements for a well-known record (Source Detection)', () => {
    const build = require('../../lib/build');
    const { buildEngineContext } = require('../../lib/knowledgeEngine');
    const { answerForKnownRecord } = require('../../lib/knowledgeEngine');
    const { findAllByFeatureId } = require('../../lib/knowledgeModel/index');
    const { built } = build.assemble();
    const ctx = buildEngineContext(built);
    const answer = answerForKnownRecord('AI-FEAT-011', ctx);
    const kmRecords = findAllByFeatureId('AI-FEAT-011');
    const result = checkStatusConsistency('AI-FEAT-011', answer.capabilityStatus, kmRecords);
    assert.equal(result.agree, true);
  });

  summarize('askKnowledge/sourcePrecedence.test.js');
}

main();
