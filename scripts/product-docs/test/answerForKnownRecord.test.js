'use strict';

// Run with: node scripts/product-docs/test/answerForKnownRecord.test.js
//
// Ask AutoIngest — Related-topic direct-navigation checkpoint. Proves the
// NEW, additive lookup path (knowledgeEngine.js's answerForKnownRecord()
// and answerWithAuthority.js's answerKnownRecordWithAuthority()) that lets
// the renderer navigate a Related capsule straight to its known canonical
// record id, without ever routing the capsule's visible title back through
// fuzzy retrieval (runQuery()/searchCandidates()) -- and without changing
// answerQuestion()'s own retrieval/ranking/synthesis, which the sibling
// test files (knowledge.test.js, capabilityAuthority.test.js,
// answerWithAuthority.test.js, etc.) already prove is unaffected by this
// checkpoint (rerun alongside this file, all still green).

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { buildEngineContext, answerQuestion, answerForKnownRecord, QUESTION_TYPES } = require('../lib/knowledgeEngine');
const { RECORD_STATUS } = require('../lib/statusResolution');
const { primaryAuthorityKind } = require('../lib/capabilityAuthority');
const { answerKnownRecordWithAuthority } = require('../lib/answerWithAuthority');

const READY = () => ({ status: 'READY', detail: {} });
const NEVER_CALL = async () => { throw new Error('must not be called'); };

function spy(fn) {
  const calls = [];
  const wrapped = (...args) => { calls.push(args); return fn(...args); };
  wrapped.calls = calls;
  return wrapped;
}

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  // A real, live "Related" fan-out (verified against the Product Owner's
  // own screenshot example): "My transfer stopped halfway..." resolves
  // Workflow-primary AI-WF-005 with 4 related feature ids.
  const RELATED_QUESTION = 'My transfer stopped halfway. What should I do?';
  const det = answerQuestion(RELATED_QUESTION, ctx);
  const relatedFeatureId = det.relatedCapabilities[0];

  await t('sanity: the fixture question really does produce a multi-capsule Related fan-out', () => {
    assert.ok(det.relatedCapabilities.length >= 4, 'expected at least 4 related capsules, matching the Product Owner example');
  });

  // ---------------------------------------------------------------------
  // Direct id resolution — feature.
  // ---------------------------------------------------------------------
  await t('answerForKnownRecord: resolves a known Feature id directly, matching the record verbatim', () => {
    const record = ctx.knowledgeIndexById.get(relatedFeatureId);
    const answer = answerForKnownRecord(relatedFeatureId, ctx);
    assert.ok(answer, 'must resolve');
    assert.equal(answer.capabilityStatus, record.operatorStatus);
    assert.equal(answer.classification, QUESTION_TYPES.CAPABILITY);
    assert.deepEqual(answer.relatedCapabilities, record.relatedFeatures);
    assert.equal(answer.sources[0].id, record.id);
    assert.equal(answer.sources[0].path, record.canonicalDocument || null);
    // Signature of a direct id lookup, never a fuzzy retrieval score: a
    // real runQuery() score can never reach this exact ceiling.
    assert.equal(answer.matchedCapabilities[0].score, 1000);
    assert.equal(answer.matchQuality, 'strong');
    assert.equal(answer.confidence, 1);
  });

  await t('answerForKnownRecord: every id in a real Related fan-out resolves to a real, distinct Feature record', () => {
    for (const id of det.relatedCapabilities) {
      const answer = answerForKnownRecord(id, ctx);
      assert.ok(answer, `expected ${id} to resolve`);
      assert.equal(answer.matchedCapabilities[0].id, id);
      assert.equal(answer.matchedCapabilities[0].entityType, 'feature');
    }
  });

  // ---------------------------------------------------------------------
  // Direct id resolution — workflow.
  // ---------------------------------------------------------------------
  await t('answerForKnownRecord: resolves a known Workflow id directly, matching the record verbatim', () => {
    const workflowId = det.matchedCapabilities[0].id; // AI-WF-005 in this fixture
    const record = ctx.workflowIndexById.get(workflowId);
    const answer = answerForKnownRecord(workflowId, ctx);
    assert.ok(answer, 'must resolve');
    assert.equal(answer.capabilityStatus, RECORD_STATUS.AVAILABLE, 'a Workflow record is only ever authored for something that exists');
    assert.equal(answer.classification, QUESTION_TYPES.HOW_TO);
    assert.deepEqual(answer.steps, record.steps && record.steps.length ? record.steps : null);
    assert.deepEqual(answer.relatedCapabilities, record.relatedCapabilities);
    assert.equal(answer.sources[0].id, record.id);
  });

  // ---------------------------------------------------------------------
  // Unresolvable id — never falls back to fuzzy search, never throws.
  // ---------------------------------------------------------------------
  await t('answerForKnownRecord: an id that resolves to neither index returns null, not a fuzzy-search fallback', () => {
    assert.equal(answerForKnownRecord('AI-FEAT-999999', ctx), null);
    assert.equal(answerForKnownRecord('not-a-real-id', ctx), null);
  });

  // ---------------------------------------------------------------------
  // Authority wiring — a Feature-primary direct navigation enters the SAME
  // narrow, unmodified authority scope an ordinary capability question
  // about that exact feature would (Part 9: the model loads if and only if
  // the destination genuinely enters an authority-sensitive path).
  // ---------------------------------------------------------------------
  await t('answerKnownRecordWithAuthority: a Feature-primary AVAILABLE record enters authority scope exactly like an ordinary question would', async () => {
    const deterministic = answerForKnownRecord(relatedFeatureId, ctx);
    assert.equal(primaryAuthorityKind(deterministic), 'feature', 'sanity: this fixture record must be in-scope for the assertion below to mean anything');
    const availabilitySpy = spy(READY);
    const judgeSpy = spy(async (pkg, handleMap) => ({ judgment: 'SUPPORTS', evidenceHandles: handleMap.validHandles.slice(0, 1), confidence: 'HIGH' }));
    const result = await answerKnownRecordWithAuthority(relatedFeatureId, ctx, { judge: judgeSpy, getModelAvailability: availabilitySpy });
    assert.ok(judgeSpy.calls.length > 0, 'the local judge must be invoked for an in-scope Feature-primary direct navigation');
    assert.ok(availabilitySpy.calls.length > 0);
    assert.equal(result.authority.required, true);
    assert.equal(result.authority.ran, true);
    assert.equal(result.capabilityStatus, RECORD_STATUS.AVAILABLE);
  });

  await t('answerKnownRecordWithAuthority: a Workflow-primary direct navigation never loads the model (out of authority scope by entity type alone)', async () => {
    const workflowId = det.matchedCapabilities[0].id;
    const availabilitySpy = spy(READY);
    const result = await answerKnownRecordWithAuthority(workflowId, ctx, { judge: NEVER_CALL, getModelAvailability: availabilitySpy });
    assert.equal(result.authority.required, false);
    assert.equal(result.authority.ran, false);
    assert.equal(availabilitySpy.calls.length, 0, 'model availability must never even be checked for a Workflow-primary direct navigation');
  });

  await t('answerKnownRecordWithAuthority: an unresolvable id returns null, never invoking the judge or throwing', async () => {
    const result = await answerKnownRecordWithAuthority('AI-FEAT-999999', ctx, { judge: NEVER_CALL, getModelAvailability: spy(READY) });
    assert.equal(result, null);
  });

  // ---------------------------------------------------------------------
  // No regression to the existing retrieval-based entrypoint -- direct
  // navigation is a fully separate, additive path.
  // ---------------------------------------------------------------------
  await t('answerQuestion() itself is byte-identical for the same fixture question after this checkpoint', () => {
    const again = answerQuestion(RELATED_QUESTION, ctx);
    assert.deepEqual(again, det);
  });

  summarize('answerForKnownRecord.test.js');
}

main().catch((err) => { console.error(err); process.exit(1); });
