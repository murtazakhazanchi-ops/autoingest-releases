#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/askSynthesis/synthesisEligibility.test.js
// Phase C5. Pure unit tests for the synthesis eligibility policy -- no
// model, no engine, no ctx: synthetic answer-shaped objects only, proving
// exactly the two refusal rules synthesisEligibility.js documents.

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { evaluateSynthesisEligibility } = require('../../lib/askSynthesis/synthesisEligibility');

async function main() {
  const { t, summarize } = createRunner();

  await t('null/undefined answer is ineligible', () => {
    assert.equal(evaluateSynthesisEligibility(null).eligible, false);
    assert.equal(evaluateSynthesisEligibility(undefined).eligible, false);
  });

  await t('deterministic UNKNOWN (no evidence at all) is ineligible', () => {
    const r = evaluateSynthesisEligibility({ capabilityStatus: 'UNKNOWN', matchQuality: 'none' });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'deterministic-unknown');
  });

  await t('authority-downgraded UNKNOWN (judge ran, could not confirm) is ineligible', () => {
    const r = evaluateSynthesisEligibility({
      capabilityStatus: 'UNKNOWN',
      matchQuality: 'strong',
      authority: { required: true, ran: true, finalCapabilityStatus: 'UNKNOWN' },
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'authority-downgraded-unknown');
  });

  await t('authority claim-unmatched (judge never invoked) is ineligible', () => {
    const r = evaluateSynthesisEligibility({
      capabilityStatus: 'UNKNOWN',
      matchQuality: 'strong',
      authority: { required: true, ran: false },
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'authority-claim-unmatched');
  });

  await t('weak matchQuality is ineligible even with an affirmative capabilityStatus', () => {
    const r = evaluateSynthesisEligibility({ capabilityStatus: 'AVAILABLE', matchQuality: 'weak' });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'weak-retrieval-weak');
  });

  await t('none matchQuality with a non-UNKNOWN status (defensive) is still ineligible', () => {
    const r = evaluateSynthesisEligibility({ capabilityStatus: 'NOT_SUPPORTED', matchQuality: 'none' });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'weak-retrieval-none');
  });

  await t('strong matchQuality with AVAILABLE is eligible', () => {
    const r = evaluateSynthesisEligibility({ capabilityStatus: 'AVAILABLE', matchQuality: 'strong' });
    assert.equal(r.eligible, true);
    assert.equal(r.reason, null);
  });

  await t('boundary matchQuality (curated NOT_SUPPORTED) is eligible -- may be explained naturally', () => {
    const r = evaluateSynthesisEligibility({ capabilityStatus: 'NOT_SUPPORTED', matchQuality: 'boundary' });
    assert.equal(r.eligible, true);
  });

  await t('roadmap matchQuality (deterministic dashboard data, not retrieval-ranked) is eligible', () => {
    const r = evaluateSynthesisEligibility({ capabilityStatus: 'PLANNED', matchQuality: 'roadmap' });
    assert.equal(r.eligible, true);
  });

  await t('PARTIALLY_AVAILABLE + strong is eligible', () => {
    const r = evaluateSynthesisEligibility({ capabilityStatus: 'PARTIALLY_AVAILABLE', matchQuality: 'strong' });
    assert.equal(r.eligible, true);
  });

  // Phase C5.1 -- retrieval-confidence primaryFit is a third, independent
  // refusal reason, folded in only when the caller supplies one (see
  // answerWithSynthesis.js's own comment: known-record navigation always
  // passes null here, per checkpoint Section L).
  await t('MISMATCHED primaryFit is ineligible even with strong matchQuality/AVAILABLE status', () => {
    const r = evaluateSynthesisEligibility(
      { capabilityStatus: 'AVAILABLE', matchQuality: 'strong' },
      { fit: 'MISMATCHED', reason: 'competing-title-named-in-query', competingId: 'AI-FEAT-038' },
    );
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'primary-mismatch-AI-FEAT-038');
  });

  await t('SAFE primaryFit does not affect an otherwise-eligible answer', () => {
    const r = evaluateSynthesisEligibility(
      { capabilityStatus: 'AVAILABLE', matchQuality: 'strong' },
      { fit: 'SAFE', reason: null },
    );
    assert.equal(r.eligible, true);
  });

  await t('null primaryFit (known-record path) never blocks an otherwise-eligible answer', () => {
    const r = evaluateSynthesisEligibility({ capabilityStatus: 'AVAILABLE', matchQuality: 'strong' }, null);
    assert.equal(r.eligible, true);
  });

  summarize('askSynthesis/synthesisEligibility.test.js');
}

main();
