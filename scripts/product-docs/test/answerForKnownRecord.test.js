'use strict';

// Run with: node scripts/product-docs/test/answerForKnownRecord.test.js
//
// Ask AutoIngest — Related-topic direct-navigation checkpoint, updated by
// the Related-Record Content Correction checkpoint. Proves the additive
// lookup path (knowledgeEngine.js's answerForKnownRecord() and
// answerWithAuthority.js's answerKnownRecordWithAuthority()) that lets the
// renderer navigate a Related capsule straight to its known canonical
// record id, without ever routing the capsule's visible title back through
// fuzzy retrieval (runQuery()/searchCandidates()), and -- per the
// correction -- WITHOUT ever routing it through capability-claim
// verification either: known-record browsing shows the record's own real
// canonical content unconditionally, never a generic authority hedge.
// answerQuestion()'s own retrieval/ranking/synthesis is unaffected by any
// of this, which the sibling test files (knowledge.test.js,
// capabilityAuthority.test.js, answerWithAuthority.test.js, etc.) already
// prove (rerun alongside this file, all still green).

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { buildEngineContext, answerQuestion, answerForKnownRecord, QUESTION_TYPES } = require('../lib/knowledgeEngine');
const { RECORD_STATUS } = require('../lib/statusResolution');
const { primaryAuthorityKind } = require('../lib/capabilityAuthority');
const { answerKnownRecordWithAuthority } = require('../lib/answerWithAuthority');

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
  // Authority wiring — CORRECTED (Related-Record Content Correction
  // checkpoint, Product Owner acceptance-failure report). Related-topic
  // browsing is known-record display, not a capability-existence claim:
  // it must NEVER enter applyCapabilityAuthority()'s scope, for EITHER a
  // Feature-primary or Workflow-primary record, and must NEVER touch the
  // judge/model, so the record's own real canonical content (directAnswer/
  // guidance/steps) is always shown -- never replaced by the generic
  // "verification unavailable" hedge, regardless of whether a local model
  // is installed, ready, or would even reject the claim if asked.
  // answerKnownRecordWithAuthority() no longer accepts a judge/
  // getModelAvailability options object at all (there is nothing left for
  // it to inject into) -- calls below intentionally use the 2-arg form.
  // ---------------------------------------------------------------------
  await t('answerKnownRecordWithAuthority: a Feature-primary AVAILABLE record NEVER enters authority scope — no judge, no model-availability check, real content preserved', async () => {
    const deterministic = answerForKnownRecord(relatedFeatureId, ctx);
    assert.equal(primaryAuthorityKind(deterministic), 'feature', 'sanity: this fixture record is exactly the kind of record the OLD behavior used to route through authority');
    const result = await answerKnownRecordWithAuthority(relatedFeatureId, ctx);
    assert.equal(result.authority.required, false, 'Related browsing must never be authority-required');
    assert.equal(result.authority.ran, false, 'the judge must never run for Related browsing');
    assert.equal(result.capabilityStatus, deterministic.capabilityStatus, 'record status is read straight from the record, never touched by authority');
    assert.equal(result.directAnswer, deterministic.directAnswer, 'the record\'s own real canonical description must survive verbatim, never replaced by a hedge');
    assert.deepEqual(result.steps, deterministic.steps);
    assert.deepEqual(result.limitations, deterministic.limitations);
  });

  await t('answerKnownRecordWithAuthority: real content is preserved even when the local judge would reject or the model is unavailable (the exact Product Owner-reported failure)', async () => {
    // These fakes prove the point structurally: if answerKnownRecordWithAuthority()
    // ever again routed through applyCapabilityAuthority(), invoking either
    // of these would flip capabilityStatus to UNKNOWN and replace
    // directAnswer with the generic hedge -- exactly the regression this
    // checkpoint fixes. They are never actually called.
    const judgeThatWouldFail = async () => { throw Object.assign(new Error('unavailable'), { modelState: 'NOT_DOWNLOADED', modelUnavailable: true }); };
    const deterministic = answerForKnownRecord(relatedFeatureId, ctx);
    const result = await answerKnownRecordWithAuthority(relatedFeatureId, ctx);
    assert.notEqual(result.directAnswer, 'Capability verification is currently unavailable. You can still view the related documentation below.');
    assert.notEqual(result.capabilityStatus, 'UNKNOWN');
    assert.equal(result.directAnswer, deterministic.directAnswer);
    void judgeThatWouldFail; // documents the counterfactual; never invoked
  });

  await t('answerKnownRecordWithAuthority: a Workflow-primary direct navigation never loads the model (out of authority scope by entity type alone)', async () => {
    const workflowId = det.matchedCapabilities[0].id;
    const result = await answerKnownRecordWithAuthority(workflowId, ctx);
    assert.equal(result.authority.required, false);
    assert.equal(result.authority.ran, false);
  });

  await t('answerKnownRecordWithAuthority: an unresolvable id returns null, never invoking the judge or throwing', async () => {
    const result = await answerKnownRecordWithAuthority('AI-FEAT-999999', ctx);
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
