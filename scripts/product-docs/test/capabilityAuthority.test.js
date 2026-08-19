#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/capabilityAuthority.test.js
// Phase C1: Semantic Authority Core Integration (Product Owner-authorized
// checkpoint, 2026-08-19). Proves the full production pipeline --
// retrieval -> deterministic answerQuestion() -> authority-scope decision
// -> injected semantic judgment -> deterministic post-validation -> final
// capabilityStatus -- WITHOUT loading any local model. Every judge here is
// an injected fake/stub; this file measures integration correctness, never
// model quality (that remains bench/'s manual, model-required benchmark).

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { buildEngineContext, answerQuestion } = require('../lib/knowledgeEngine');
const { QUERY_STATUS, RECORD_STATUS } = require('../lib/statusResolution');
const { QUESTION_TYPES } = require('../lib/questionClassifier');
const { shouldApplyCapabilityAuthority, applyCapabilityAuthority, primaryAuthorityKind } = require('../lib/capabilityAuthority');
const { normalizeClaim } = require('../lib/askSynthesis/claimNormalization');
const { buildEntailmentEvidencePackage } = require('../lib/askSynthesis/entailmentEvidencePackage');
const { ADVERSARIAL_QUESTIONS } = require('./fixtures/capabilityAuthorityAdversarialQuestions');

const NEVER_CALL_JUDGE = async () => { throw new Error('judge must not be called here'); };

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  // ---------------------------------------------------------------------
  // Part E: authority-scope predicate -- positive cases (real questions)
  // ---------------------------------------------------------------------

  await t('scope: CAPABILITY + Feature-primary + AVAILABLE -> authority required', () => {
    const answer = answerQuestion('Can I see dashboard metadata health?', ctx);
    assert.equal(answer.classification, QUESTION_TYPES.CAPABILITY);
    assert.equal(primaryAuthorityKind(answer), 'feature');
    assert.equal(shouldApplyCapabilityAuthority(answer), true);
  });

  await t('scope: STATUS + Feature-primary + PARTIALLY_AVAILABLE -> authority required', () => {
    const answer = answerQuestion('Does AutoIngest support system status monitoring?', ctx);
    assert.equal(answer.classification, QUESTION_TYPES.STATUS);
    assert.equal(answer.capabilityStatus, RECORD_STATUS.PARTIALLY_AVAILABLE);
    assert.equal(primaryAuthorityKind(answer), 'feature');
    assert.equal(shouldApplyCapabilityAuthority(answer), true);
  });

  await t('scope: STATUS + Governance-primary (borrowed AVAILABLE) -> authority required', () => {
    const answer = answerQuestion('Does AutoIngest support telemetry?', ctx);
    assert.equal(answer.classification, QUESTION_TYPES.STATUS);
    assert.equal(answer.capabilityStatus, RECORD_STATUS.AVAILABLE);
    assert.equal(primaryAuthorityKind(answer), 'governance');
    assert.equal(shouldApplyCapabilityAuthority(answer), true);
  });

  // ---------------------------------------------------------------------
  // Part E: authority-scope predicate -- negative cases (real questions
  // where a real, current corpus example exists)
  // ---------------------------------------------------------------------

  const negativeRealCases = [
    { label: 'curated boundary', question: 'Can AutoIngest recognize faces?' },
    { label: 'Workflow-primary', question: 'How do I create a new event?' },
    { label: 'UNKNOWN / no evidence', question: 'xyzzy plugh unrelated made up capability qqqqq' },
    { label: 'NOT_SUPPORTED via Planned-adjacent status resolution never affirmative here', question: 'What routine maintenance does AutoIngest do on my archive?' }, // PLANNED, not NOT_SUPPORTED -- also a negative case
    { label: 'ROADMAP', question: 'What is coming next on the roadmap?' },
    { label: 'HOW_TO (classification excluded even though status is affirmative)', question: 'How do I create a new event?' },
    { label: 'TROUBLESHOOTING (classification excluded even though status is affirmative)', question: 'My transfer stopped halfway - what happens now?' },
    { label: 'EXPLANATION (classification excluded even though status is affirmative)', question: 'What is a sync-slot?' },
    { label: 'TEAM_ACTIVITY (classification excluded even though status is affirmative)', question: 'Who else is online right now?' },
    { label: 'NAVIGATION', question: 'Where do I find the settings menu?' },
    { label: 'COMPARISON (classification excluded even though status is affirmative)', question: 'What is the difference between Quick Import and Transfer Import?' },
    { label: 'CONNECTIVITY (classification excluded even though status is affirmative)', question: 'What happens if I go offline during import?' },
  ];
  for (const { label, question } of negativeRealCases) {
    await t(`scope: ${label} -> authority NOT required ("${question}")`, () => {
      const answer = answerQuestion(question, ctx);
      assert.equal(shouldApplyCapabilityAuthority(answer), false, `expected authority not required, got classification=${answer.classification} status=${answer.capabilityStatus} matchQuality=${answer.matchQuality}`);
    });
  }

  // ---------------------------------------------------------------------
  // Part E: negative cases with no natural current corpus example --
  // exercised directly against the predicate with synthetic answer shapes
  // (same shape answerQuestion() actually returns, per knowledgeEngine.js).
  // ---------------------------------------------------------------------

  await t('scope: PLANNED status -> authority not required (synthetic)', () => {
    const answer = { classification: QUESTION_TYPES.STATUS, capabilityStatus: RECORD_STATUS.PLANNED, matchQuality: 'strong', matchedCapabilities: [{ id: 'AI-FEAT-999', entityType: 'feature' }] };
    assert.equal(shouldApplyCapabilityAuthority(answer), false);
  });

  await t('scope: NOT_SUPPORTED status without a curated-boundary matchQuality marker -> authority not required (synthetic, defense-in-depth)', () => {
    const answer = { classification: QUESTION_TYPES.STATUS, capabilityStatus: QUERY_STATUS.NOT_SUPPORTED, matchQuality: 'strong', matchedCapabilities: [{ id: 'AI-FEAT-999', entityType: 'feature' }] };
    assert.equal(shouldApplyCapabilityAuthority(answer), false);
  });

  await t('scope: no primary / no matchedCapabilities -> authority not required (synthetic)', () => {
    const answer = { classification: QUESTION_TYPES.CAPABILITY, capabilityStatus: RECORD_STATUS.AVAILABLE, matchQuality: 'none', matchedCapabilities: [] };
    assert.equal(shouldApplyCapabilityAuthority(answer), false);
  });

  await t('scope: null/undefined answer -> authority not required, never throws', () => {
    assert.equal(shouldApplyCapabilityAuthority(null), false);
    assert.equal(shouldApplyCapabilityAuthority(undefined), false);
  });

  // ---------------------------------------------------------------------
  // Part F: claim-normalization failure on an authority-sensitive question
  // ---------------------------------------------------------------------

  await t('claim-unmatched: authority-sensitive question with an unmatched claim template downgrades to UNKNOWN without ever calling the judge', async () => {
    // "Will there be a conflict warning..." is STATUS-classified (matches
    // "will autoingest"? no -- verify independently) and is the exact
    // unmatched example already locked in by entailmentJudge.test.js.
    const question = 'Will there be a conflict warning if two people import at once?';
    const answer = answerQuestion(question, ctx);
    // This question resolves to the registry-conflict-detection curated
    // boundary in the real engine, which would already exclude it via
    // condition 4 -- construct a synthetic in-scope answer instead so this
    // test exercises claim-unmatched specifically, not boundary exclusion.
    const inScopeAnswer = { ...answer, classification: QUESTION_TYPES.STATUS, capabilityStatus: RECORD_STATUS.AVAILABLE, matchQuality: 'strong' };
    assert.equal(shouldApplyCapabilityAuthority(inScopeAnswer), true, 'precondition: synthetic answer must be in-scope for this test to be meaningful');
    const result = await applyCapabilityAuthority(question, inScopeAnswer, ctx, NEVER_CALL_JUDGE);
    assert.equal(result.capabilityStatus, QUERY_STATUS.UNKNOWN);
    assert.equal(result.authority.fallbackReason, 'claim-unmatched');
    assert.equal(result.authority.ran, false);
  });

  // ---------------------------------------------------------------------
  // Part K: curated boundary supremacy -- judge stub THROWS if invoked
  // ---------------------------------------------------------------------

  await t('curated boundary: judge is never invoked for a hard-override boundary question, and the result is unchanged NOT_SUPPORTED', async () => {
    const question = 'Can AutoIngest recognize faces?';
    const answer = answerQuestion(question, ctx);
    assert.equal(answer.matchQuality, 'boundary', 'precondition: this must be a real boundary-resolved answer');
    const result = await applyCapabilityAuthority(question, answer, ctx, NEVER_CALL_JUDGE);
    assert.equal(result.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
    assert.equal(result.authority.required, false);
    assert.equal(result.authority.ran, false);
    assert.equal(result.directAnswer, answer.directAnswer, 'boundary directAnswer must be byte-identical, untouched by the decorator');
  });

  // ---------------------------------------------------------------------
  // Part I: deterministic post-validation, exercised through the full
  // decorator with injected judges (not just resolveEntailmentAuthority()
  // directly -- entailmentJudge.test.js already covers that layer; this
  // proves the DECORATOR wires it correctly end to end).
  // ---------------------------------------------------------------------

  const CAP_MONITORING_Q = 'Does AutoIngest support system status monitoring?'; // real STATUS/Feature-primary/PARTIALLY_AVAILABLE case

  await t('post-validation: valid HIGH-confidence SUPPORTS confirms the claim', async () => {
    const answer = answerQuestion(CAP_MONITORING_Q, ctx);
    const judge = async (pkg, handleMap) => ({ judgment: 'SUPPORTS', evidenceHandles: [handleMap.validHandles[0]], confidence: 'HIGH' });
    const result = await applyCapabilityAuthority(CAP_MONITORING_Q, answer, ctx, judge);
    assert.equal(result.authority.authoritySource, 'judge-supports');
    assert.notEqual(result.capabilityStatus, QUERY_STATUS.UNKNOWN);
  });

  await t('post-validation: LOW-confidence SUPPORTS downgrades to UNKNOWN', async () => {
    const answer = answerQuestion(CAP_MONITORING_Q, ctx);
    const judge = async (pkg, handleMap) => ({ judgment: 'SUPPORTS', evidenceHandles: [handleMap.validHandles[0]], confidence: 'LOW' });
    const result = await applyCapabilityAuthority(CAP_MONITORING_Q, answer, ctx, judge);
    assert.equal(result.capabilityStatus, QUERY_STATUS.UNKNOWN);
    assert.equal(result.authority.authoritySource, 'judge-supports-low-confidence');
  });

  await t('post-validation: SUPPORTS with zero cited handles downgrades to UNKNOWN', async () => {
    const answer = answerQuestion(CAP_MONITORING_Q, ctx);
    const judge = async () => ({ judgment: 'SUPPORTS', evidenceHandles: [], confidence: 'HIGH' });
    const result = await applyCapabilityAuthority(CAP_MONITORING_Q, answer, ctx, judge);
    assert.equal(result.capabilityStatus, QUERY_STATUS.UNKNOWN);
    assert.equal(result.authority.authoritySource, 'judge-supports-no-citation-fallback');
  });

  await t('post-validation: SUPPORTS citing an invalid/fabricated handle downgrades to UNKNOWN, never AVAILABLE', async () => {
    const answer = answerQuestion(CAP_MONITORING_Q, ctx);
    const judge = async () => ({ judgment: 'SUPPORTS', evidenceHandles: ['S999-fabricated'], confidence: 'HIGH' });
    const result = await applyCapabilityAuthority(CAP_MONITORING_Q, answer, ctx, judge);
    assert.equal(result.capabilityStatus, QUERY_STATUS.UNKNOWN);
    assert.equal(result.authority.authoritySource, 'invalid-handle-fallback');
  });

  await t('post-validation: CONTRADICTS without a curated boundary downgrades to UNKNOWN, never NOT_SUPPORTED', async () => {
    const answer = answerQuestion(CAP_MONITORING_Q, ctx);
    const judge = async (pkg, handleMap) => ({ judgment: 'CONTRADICTS', evidenceHandles: [handleMap.validHandles[0]], confidence: 'HIGH' });
    const result = await applyCapabilityAuthority(CAP_MONITORING_Q, answer, ctx, judge);
    assert.equal(result.capabilityStatus, QUERY_STATUS.UNKNOWN);
    assert.equal(result.authority.authoritySource, 'judge-contradicts-unconfirmed');
  });

  await t('post-validation: INSUFFICIENT_EVIDENCE downgrades to UNKNOWN', async () => {
    const answer = answerQuestion(CAP_MONITORING_Q, ctx);
    const judge = async () => ({ judgment: 'INSUFFICIENT_EVIDENCE', evidenceHandles: [], confidence: 'HIGH' });
    const result = await applyCapabilityAuthority(CAP_MONITORING_Q, answer, ctx, judge);
    assert.equal(result.capabilityStatus, QUERY_STATUS.UNKNOWN);
    assert.equal(result.authority.authoritySource, 'judge-insufficient');
  });

  await t('post-validation: judge exception downgrades to UNKNOWN', async () => {
    const answer = answerQuestion(CAP_MONITORING_Q, ctx);
    const judge = async () => { throw new Error('simulated model crash'); };
    const result = await applyCapabilityAuthority(CAP_MONITORING_Q, answer, ctx, judge);
    assert.equal(result.capabilityStatus, QUERY_STATUS.UNKNOWN);
    assert.equal(result.authority.authoritySource, 'model-failure-fallback');
  });

  await t('post-validation: judge returning null (unavailable) downgrades to UNKNOWN', async () => {
    const answer = answerQuestion(CAP_MONITORING_Q, ctx);
    const judge = async () => null;
    const result = await applyCapabilityAuthority(CAP_MONITORING_Q, answer, ctx, judge);
    assert.equal(result.capabilityStatus, QUERY_STATUS.UNKNOWN);
    assert.equal(result.authority.authoritySource, 'model-failure-fallback');
  });

  await t('post-validation: malformed judgment value downgrades to UNKNOWN', async () => {
    const answer = answerQuestion(CAP_MONITORING_Q, ctx);
    const judge = async () => ({ judgment: 'MAYBE_I_GUESS', evidenceHandles: [], confidence: 'HIGH' });
    const result = await applyCapabilityAuthority(CAP_MONITORING_Q, answer, ctx, judge);
    assert.equal(result.capabilityStatus, QUERY_STATUS.UNKNOWN);
    assert.equal(result.authority.authoritySource, 'unrecognized-judgment-fallback');
  });

  await t('post-validation: duplicate evidence handles are deterministically deduplicated and a valid SUPPORTS still confirms', async () => {
    const answer = answerQuestion(CAP_MONITORING_Q, ctx);
    const judge = async (pkg, handleMap) => ({ judgment: 'SUPPORTS', evidenceHandles: [handleMap.validHandles[0], handleMap.validHandles[0], handleMap.validHandles[0]], confidence: 'HIGH' });
    const result = await applyCapabilityAuthority(CAP_MONITORING_Q, answer, ctx, judge);
    assert.equal(result.authority.authoritySource, 'judge-supports');
    assert.equal(result.authority.evidenceHandles.length, 1, 'repeated identical handles must collapse to exactly one validated handle');
  });

  await t('post-validation: no path returns AVAILABLE/PARTIALLY_AVAILABLE when the pre-authority status was already affirmative but the judge fails or declines', async () => {
    const answer = answerQuestion(CAP_MONITORING_Q, ctx);
    const failureModes = [
      async () => { throw new Error('boom'); },
      async () => null,
      async () => ({ judgment: 'INSUFFICIENT_EVIDENCE', evidenceHandles: [], confidence: 'HIGH' }),
      async (pkg, handleMap) => ({ judgment: 'CONTRADICTS', evidenceHandles: [handleMap.validHandles[0]], confidence: 'HIGH' }),
      async () => ({ judgment: 'SUPPORTS', evidenceHandles: [], confidence: 'HIGH' }),
      async () => ({ judgment: 'SUPPORTS', evidenceHandles: ['bogus'], confidence: 'HIGH' }),
    ];
    for (const judge of failureModes) {
      const result = await applyCapabilityAuthority(CAP_MONITORING_Q, answer, ctx, judge);
      assert.notEqual(result.capabilityStatus, RECORD_STATUS.AVAILABLE);
      assert.notEqual(result.capabilityStatus, RECORD_STATUS.PARTIALLY_AVAILABLE);
    }
  });

  // ---------------------------------------------------------------------
  // Part J: PARTIALLY_AVAILABLE preservation on valid SUPPORTS
  // ---------------------------------------------------------------------

  await t('PARTIALLY_AVAILABLE preservation: a valid SUPPORTS on a pre-authority PARTIALLY_AVAILABLE record stays PARTIALLY_AVAILABLE, never upgrades to AVAILABLE', async () => {
    const answer = answerQuestion(CAP_MONITORING_Q, ctx);
    assert.equal(answer.capabilityStatus, RECORD_STATUS.PARTIALLY_AVAILABLE, 'precondition: this must be a real PARTIALLY_AVAILABLE case');
    const judge = async (pkg, handleMap) => ({ judgment: 'SUPPORTS', evidenceHandles: [handleMap.validHandles[0]], confidence: 'HIGH' });
    const result = await applyCapabilityAuthority(CAP_MONITORING_Q, answer, ctx, judge);
    assert.equal(result.capabilityStatus, RECORD_STATUS.PARTIALLY_AVAILABLE);
    assert.equal(result.authority.finalCapabilityStatus, RECORD_STATUS.PARTIALLY_AVAILABLE);
  });

  await t('PARTIALLY_AVAILABLE preservation: a pre-authority AVAILABLE record still resolves AVAILABLE on valid SUPPORTS (not incorrectly downgraded to PARTIALLY_AVAILABLE)', async () => {
    const q = 'Does AutoIngest support telemetry?'; // real AVAILABLE/Governance-primary case
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.capabilityStatus, RECORD_STATUS.AVAILABLE);
    const judge = async (pkg, handleMap) => ({ judgment: 'SUPPORTS', evidenceHandles: [handleMap.validHandles[0]], confidence: 'HIGH' });
    const result = await applyCapabilityAuthority(q, answer, ctx, judge);
    assert.equal(result.capabilityStatus, RECORD_STATUS.AVAILABLE);
  });

  // ---------------------------------------------------------------------
  // Part L: RF-4.3-EXT-001 closure at the FINAL authority-qualified layer,
  // while the deterministic inner result remains inspectable and untouched.
  // ---------------------------------------------------------------------

  await t('RF-4.3-EXT-001: deterministic inner engine still confidently (falsely) affirms this -- diagnostic visibility preserved, not silently fixed', () => {
    const q = 'Does AutoIngest support drone footage import with GPS flight paths?';
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.capabilityStatus, RECORD_STATUS.AVAILABLE, 'the known deterministic defect must remain observable, not quietly patched here');
    assert.equal(answer.matchQuality, 'strong');
  });

  await t('RF-4.3-EXT-001: FINAL authority-qualified answer is UNKNOWN, never AVAILABLE, using the judgment the real Phi-4-mini model has stably produced for this exact case across every benchmark in this investigation', async () => {
    const q = 'Does AutoIngest support drone footage import with GPS flight paths?';
    const answer = answerQuestion(q, ctx);
    const realisticJudge = async () => ({ judgment: 'INSUFFICIENT_EVIDENCE', evidenceHandles: [], confidence: 'HIGH' });
    const result = await applyCapabilityAuthority(q, answer, ctx, realisticJudge);
    assert.equal(result.capabilityStatus, QUERY_STATUS.UNKNOWN);
    assert.notEqual(result.capabilityStatus, RECORD_STATUS.AVAILABLE);
    // The inner deterministic result remains inspectable on the authority
    // diagnostic, not erased.
    assert.equal(result.authority.deterministicCapabilityStatus, RECORD_STATUS.AVAILABLE);
  });

  // ---------------------------------------------------------------------
  // Part M: 51-case adversarial corpus, promoted to permanent, model-free
  // INTEGRATION regression coverage.
  //
  // IMPORTANT SCOPE CORRECTION (Product Owner review, post-C1-report): this
  // sweep proves SAFE INTEGRATION BEHAVIOR ONLY -- that the decorator
  // correctly downgrades to UNKNOWN under every NON-AFFIRMING or FAILING
  // judge outcome (A-E below), for a population of 51 real questions whose
  // gold label is known NOT to be SUPPORTS. It does NOT, and must NOT be
  // read to, prove that these 51 questions are semantically unsupported --
  // that is established separately by the real-model adversarial benchmark
  // (0/51 false SUPPORTS across two real local models, Phi-4-mini and
  // Qwen2.5-7B, proven across the "Final Recall-Closure & Model-Capacity"
  // and "Current Behavior Evidence Promotion" checkpoints). A genuinely
  // valid SUPPORTS+HIGH+real-handle judge is deliberately NEVER swept
  // across this fixture: 32/51 of these questions actually enter authority
  // scope under the real deterministic engine today (verified directly --
  // the false-affirmation population is materially larger than the single
  // RF-4.3-EXT-001 flagship case alone), and for those, a valid SUPPORTS
  // judgment is SUPPOSED to produce AVAILABLE/PARTIALLY_AVAILABLE per
  // Product Owner decision #4 -- that is CORRECT decorator behavior (the
  // decorator trusts its injected judge; deciding whether a claim is truly
  // supported is the judge's job, never this layer's). Asserting "never
  // AVAILABLE" under a valid-SUPPORTS mock would therefore be testing (and
  // failing against) the wrong thing entirely. Requirement F -- that a
  // valid SUPPORTS+HIGH+real-handle judgment correctly PRESERVES
  // AVAILABLE/PARTIALLY_AVAILABLE -- is proven separately below using KNOWN
  // LEGITIMATE POSITIVES (real corpus cases the deterministic engine
  // correctly and truthfully resolves affirmative), never this adversarial
  // fixture, which by construction contains no legitimate positives.
  //
  // A/B/C/D/E below map directly to the Product Owner's own lettered list.
  // ---------------------------------------------------------------------

  const failingOrNonAffirmingJudges = {
    'A. always INSUFFICIENT_EVIDENCE': async () => ({ judgment: 'INSUFFICIENT_EVIDENCE', evidenceHandles: [], confidence: 'HIGH' }),
    'B. always CONTRADICTS, uncurated': async (pkg, handleMap) => ({ judgment: 'CONTRADICTS', evidenceHandles: handleMap.validHandles.slice(0, 1), confidence: 'HIGH' }),
    'C. always throws (judge exception)': async () => { throw new Error('simulated failure'); },
    'D. always malformed (unrecognized judgment value)': async () => ({ judgment: 'PERHAPS', evidenceHandles: [], confidence: 'HIGH' }),
    'E. SUPPORTS with a fabricated/invalid handle': async () => ({ judgment: 'SUPPORTS', evidenceHandles: ['S-does-not-exist'], confidence: 'HIGH' }),
    'E. SUPPORTS with zero cited handles': async () => ({ judgment: 'SUPPORTS', evidenceHandles: [], confidence: 'HIGH' }),
  };

  for (const [label, judge] of Object.entries(failingOrNonAffirmingJudges)) {
    await t(`51-case adversarial sweep (${label}): safe integration behavior -- never resolves AVAILABLE or PARTIALLY_AVAILABLE`, async () => {
      for (const { id, question } of ADVERSARIAL_QUESTIONS) {
        const answer = answerQuestion(question, ctx);
        const result = await applyCapabilityAuthority(question, answer, ctx, judge);
        assert.notEqual(result.capabilityStatus, RECORD_STATUS.AVAILABLE, `${id} "${question}" resolved AVAILABLE under judge behavior "${label}"`);
        assert.notEqual(result.capabilityStatus, RECORD_STATUS.PARTIALLY_AVAILABLE, `${id} "${question}" resolved PARTIALLY_AVAILABLE under judge behavior "${label}"`);
      }
    });
  }

  await t('51-case fixture: at least one real question actually enters authority scope today (the sweep above is not vacuously passing on an empty population)', () => {
    let inScope = 0;
    for (const { question } of ADVERSARIAL_QUESTIONS) {
      const answer = answerQuestion(question, ctx);
      if (shouldApplyCapabilityAuthority(answer)) inScope++;
    }
    assert.ok(inScope > 0, 'expected at least one adversarial question to genuinely exercise the authority-required path');
  });

  await t('51-case fixture integrity: exactly 51 cases, matching the frozen gold set adversarial population', () => {
    assert.equal(ADVERSARIAL_QUESTIONS.length, 51);
  });

  // ---------------------------------------------------------------------
  // Requirement F (Product Owner review): SUPPORTS + HIGH + a valid real
  // evidence handle, on a KNOWN LEGITIMATE POSITIVE (never the adversarial
  // fixture above), correctly PRESERVES AVAILABLE or PARTIALLY_AVAILABLE.
  // Both cases already exist above (Part J) under their own descriptive
  // names -- referenced here for a single, explicit F-labeled check tying
  // scope + evidence + confirm together end to end.
  // ---------------------------------------------------------------------

  await t('F. valid SUPPORTS on a known legitimate positive (Feature-primary) preserves the correct affirmative status end to end', async () => {
    const answer = answerQuestion(CAP_MONITORING_Q, ctx);
    assert.equal(shouldApplyCapabilityAuthority(answer), true);
    const judge = async (pkg, handleMap) => ({ judgment: 'SUPPORTS', evidenceHandles: [handleMap.validHandles[0]], confidence: 'HIGH' });
    const result = await applyCapabilityAuthority(CAP_MONITORING_Q, answer, ctx, judge);
    assert.equal(result.capabilityStatus, RECORD_STATUS.PARTIALLY_AVAILABLE);
  });

  // ---------------------------------------------------------------------
  // Governance evidence provenance (Product Owner review): the fix to
  // buildEntailmentEvidencePackage() must resolve evidence from the CITED
  // FEATURE only -- the governance record itself (its own summary/detail
  // narrative) must never become capability evidence. The governance
  // citation is context/provenance, never independent capability authority.
  // ---------------------------------------------------------------------

  await t('Governance evidence provenance: every evidence item for a Governance-primary answer is keyed to the cited Feature, never to the governance record itself', () => {
    const q = 'Does AutoIngest support telemetry?'; // DEC-017 primary, cites AI-FEAT-057
    const { claim } = normalizeClaim(q);
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.matchedCapabilities[0].entityType, 'decision', 'precondition: this must be a real Governance-primary case');
    const citedFeatureId = answer.sources[1].id;
    assert.match(citedFeatureId, /^AI-FEAT-/, 'precondition: sources[1] must be the cited Feature');
    const { pkg } = buildEntailmentEvidencePackage(q, claim, answer, ctx, { level: 'summary+body' });
    assert.ok(pkg.evidence.length > 0, 'precondition: the fix must actually produce evidence for this case');
    for (const item of pkg.evidence) {
      assert.equal(item.id, citedFeatureId, `evidence item (kind=${item.kind}) must be keyed to the cited Feature ${citedFeatureId}, not the governance record ${answer.matchedCapabilities[0].id}`);
    }
  });

  await t('Governance evidence provenance: evidence text is the cited Feature\'s own canonical text, never the governance record\'s own narrative', () => {
    const q = 'Does AutoIngest support telemetry?';
    const { claim } = normalizeClaim(q);
    const answer = answerQuestion(q, ctx);
    const { pkg } = buildEntailmentEvidencePackage(q, claim, answer, ctx, { level: 'summary+body' });
    const decisionRec = ctx.searchIndexById.get('DEC-017');
    const featureRec = ctx.knowledgeIndexById.get('AI-FEAT-057');
    const summaryItem = pkg.evidence.find((e) => e.kind === 'summary');
    assert.ok(summaryItem, 'precondition: a summary evidence item must exist');
    assert.equal(summaryItem.text, featureRec.summary, 'evidence summary text must be the cited Feature\'s own summary');
    assert.notEqual(summaryItem.text, decisionRec.summary, 'evidence must never be the governance record\'s own summary text');
  });

  summarize('capabilityAuthority.test.js');
}

main();
