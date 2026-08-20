#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/askSynthesis/retrievalConfidence.test.js
// Phase C5.1. Proves assessPrimaryFit() against the REAL corpus (not
// synthetic fixtures) -- the whole point of this module is a forensic
// finding about the real production data (see its own header comment), so
// a fake searchIndex would prove nothing about whether the fix actually
// works. Covers: the two originally-reported defects (Q5/Q13), a defect
// found during this checkpoint's own evaluation-set validation ("archive
// maintenance"), the sources-exemption that resolves the one apparent false
// positive, and representative correctly-resolved questions (including the
// exact case that broke the PRIOR, reverted C5 candidate rule) that must
// remain SAFE.

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const build = require('../../lib/build');
const { buildEngineContext, answerQuestion } = require('../../lib/knowledgeEngine');
const { assessPrimaryFit } = require('../../lib/askSynthesis/retrievalConfidence');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  function fitFor(question) {
    const answer = answerQuestion(question, ctx);
    return { answer, fit: assessPrimaryFit(question, answer, ctx) };
  }

  await t('Q5 "How do I create a Transfer Export?": wrong primary (AI-WF-008) is MISMATCHED against AI-FEAT-038', () => {
    const { answer, fit } = fitFor('How do I create a Transfer Export?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-WF-008');
    assert.equal(fit.fit, 'MISMATCHED');
    assert.equal(fit.competingId, 'AI-FEAT-038');
  });

  await t('Q13 "Why does Transfer Import exist?": wrong primary (AI-FEAT-041) is MISMATCHED against AI-FEAT-039', () => {
    const { answer, fit } = fitFor('Why does Transfer Import exist?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-041');
    assert.equal(fit.fit, 'MISMATCHED');
    assert.equal(fit.competingId, 'AI-FEAT-039');
  });

  await t('"What is archive maintenance?": wrong primary (AI-FEAT-050) is MISMATCHED against AI-FEAT-049 (found during this checkpoint\'s own eval-set validation, not previously reported)', () => {
    const { answer, fit } = fitFor('What is archive maintenance?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-050');
    assert.equal(fit.fit, 'MISMATCHED');
    assert.equal(fit.competingId, 'AI-FEAT-049');
  });

  await t('governance-primary answer whose own cited feature is named in the query stays SAFE (sources exemption)', () => {
    const { answer, fit } = fitFor('Why was Transfer Export locking kept process-local?');
    assert.equal(answer.matchedCapabilities[0].id, 'DEC-021');
    assert.ok(answer.sources.some((s) => s.id === 'AI-FEAT-038'), 'AI-FEAT-038 must be cited in sources for the exemption to apply');
    assert.equal(fit.fit, 'SAFE');
  });

  await t('"How do I create a new event?" (the exact case that produced a false positive under the PRIOR, reverted C5 rule) stays SAFE', () => {
    const { answer, fit } = fitFor('How do I create a new event?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-WF-002');
    assert.equal(fit.fit, 'SAFE');
  });

  await t('"How does the Online Registry work?" (correct primary, narrow same-type score margin -- the case that sank the rejected margin-based alternative) stays SAFE', () => {
    const { answer, fit } = fitFor('How does the Online Registry work?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-WF-006');
    assert.equal(fit.fit, 'SAFE');
  });

  await t('"How do I import photographs from an SD card?" (unambiguous, correct primary) stays SAFE', () => {
    const { answer, fit } = fitFor('How do I import photographs from an SD card?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-WF-001');
    assert.equal(fit.fit, 'SAFE');
  });

  await t('"What is Source Detection?" stays SAFE despite "Source Selection" being a real, closely-related, confusable title', () => {
    const { answer, fit } = fitFor('What is Source Detection?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-011');
    assert.equal(fit.fit, 'SAFE');
  });

  await t('no primary (roadmap answer) is always SAFE -- nothing retrieval-ranked to distrust', () => {
    const answer = answerQuestion("What's coming next?", ctx);
    const fit = assessPrimaryFit("What's coming next?", answer, ctx);
    assert.equal(fit.fit, 'SAFE');
  });

  await t('assessPrimaryFit is defensive against a missing/malformed ctx (never throws)', () => {
    assert.equal(assessPrimaryFit('anything', { matchedCapabilities: [{ id: 'X' }] }, null).fit, 'SAFE');
    assert.equal(assessPrimaryFit('anything', { matchedCapabilities: [{ id: 'X' }] }, {}).fit, 'SAFE');
    assert.equal(assessPrimaryFit('anything', null, ctx).fit, 'SAFE');
  });

  summarize('askSynthesis/retrievalConfidence.test.js');
}

main();
