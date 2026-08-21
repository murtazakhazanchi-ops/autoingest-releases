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

  // Phase C6 (lib/query.js's identity-mention tier) fixed the underlying
  // retrieval defect these three cases exist to guard against -- all three
  // now resolve the correct primary directly, so retrievalConfidence's own
  // MISMATCHED path is no longer reached by them at all. Re-purposed as
  // SAFE-primary controls (proving the gate correctly stays out of the way
  // once retrieval is right, Section Q); MISMATCHED coverage itself is
  // preserved separately below and in answerWithSynthesis.test.js using a
  // genuinely still-remaining Phase C6 gap.
  await t('Q5, POST-C6: "How do I create a Transfer Export?" now resolves the correct primary directly (AI-FEAT-038) and is SAFE', () => {
    const { answer, fit } = fitFor('How do I create a Transfer Export?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-038');
    assert.equal(fit.fit, 'SAFE');
  });

  await t('Q13, POST-C6: "Why does Transfer Import exist?" now resolves the correct primary directly (AI-FEAT-039) and is SAFE', () => {
    const { answer, fit } = fitFor('Why does Transfer Import exist?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-039');
    assert.equal(fit.fit, 'SAFE');
  });

  await t('POST-C6: "What is archive maintenance?" now resolves the correct primary directly (AI-FEAT-049, not AI-FEAT-050) and is SAFE', () => {
    const { answer, fit } = fitFor('What is archive maintenance?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-049');
    assert.equal(fit.fit, 'SAFE');
  });

  await t('MISMATCHED coverage preserved: a two-competing-title question still catches the uncited loser', () => {
    // Phase C6's identity-mention tier can boost BOTH named titles here
    // ("Transfer Export" and "Backup Update Scanning") -- only one wins
    // primacy (AI-FEAT-040), and the other is not cited in sources, so
    // this gate still correctly flags it. Proves the gate remains
    // meaningful defense-in-depth after the fix, not merely redundant with
    // it (Section Q).
    const { answer, fit } = fitFor('Is a Transfer Export the same thing as a backup from Backup Update Scanning?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-040');
    assert.equal(fit.fit, 'MISMATCHED');
    assert.equal(fit.competingId, 'AI-FEAT-038');
  });

  await t('PHASE C6 DISCLOSED FINDING: primary for this exact question flipped from governance (DEC-021) to feature (AI-FEAT-038) -- stays SAFE either way (sources exemption / direct identity match)', () => {
    // Was governance-primary (DEC-021) pre-C6; the identity-mention tier
    // now makes AI-FEAT-038 itself the primary (raw 559 > DEC-021's raw
    // 400 -- see lib/query.js's own header and this checkpoint's report for
    // the full mechanism). Still SAFE, now via direct identity match rather
    // than the sources-exemption path -- see
    // knowledgeHistoricalContext.test.js's own updated case for the fuller
    // materiality-safety-mechanism discussion this flip surfaced.
    const { answer, fit } = fitFor('Why was Transfer Export locking kept process-local?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-038');
    assert.ok(answer.sources.some((s) => s.id === 'DEC-021'), 'DEC-021 remains present as a citation');
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
