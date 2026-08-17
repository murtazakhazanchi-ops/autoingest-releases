#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/knowledgeNeighborhoodAdmission.test.js
// Part 5 Phase 5.2 (Decision 3 of 8) — Minimum-Sufficient Multi-Record
// Neighborhoods. Locks in the required acceptance families: single-record
// stays default; a secondary is admitted only when it contributes a
// material, distinct-authority-role aspect the primary cannot itself
// supply; sources[] visibility (Phase 5.1) is never treated as admission.

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { answerQuestion, explainNeighborhood, buildEngineContext } = require('../lib/knowledgeEngine');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  // -----------------------------------------------------------------
  // Feature + Workflow
  // -----------------------------------------------------------------
  await t('Feature + Workflow: the Transfer Import flagship admits ONLY AI-FEAT-039 (purpose/current/limitation) + AI-WF-009 (procedure) -- DEC-012 stays visible-not-admitted (tangential/reverse-lookup, no distinct requested aspect)', () => {
    const q = 'Why does Transfer Import exist, what limitation does Collection-nested import have, and what should I do operationally?';
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-039');
    assert.ok(answer.sources.some((s) => s.id === 'AI-WF-009'));
    assert.ok(/direct-Event/i.test(answer.directAnswer) && /Collection-nested/i.test(answer.directAnswer), 'the limitation aspect must already be explicit in AI-FEAT-039\'s own text, not a fabricated third record');
    const diag = explainNeighborhood(q, ctx);
    const wf = diag.admitted.find((m) => m.id === 'AI-WF-009');
    assert.ok(wf, 'AI-WF-009 must be reported as admitted');
    assert.equal(wf.role, 'Workflow');
    assert.equal(wf.source, 'independent-retrieval');
    assert.deepEqual(diag.admitted.map((m) => m.id).sort(), ['AI-WF-009'], 'the minimum-sufficient neighborhood must be EXACTLY {AI-FEAT-039 primary, AI-WF-009}, nothing else admitted');
    const dec = diag.notAdmitted.find((m) => m.id === 'DEC-012');
    assert.ok(dec, 'DEC-012 must be explicitly reported as visible-not-admitted, not silently dropped');
    assert.ok(/reverse lookup/i.test(dec.reason), 'the rejection reason must cite the tangential/reverse-lookup relationship type, not merely "wrong classification"');
  });

  // -----------------------------------------------------------------
  // Direct-but-nonmaterial Governance adversarial control (Final Closure
  // Check, item C): DEC-001 is a DIRECT citation on AI-FEAT-010's own
  // "Related decisions" field, and an EXPLANATION question about
  // AI-FEAT-010 is classification-eligible -- yet DEC-001's own canonical
  // "Related feature(s)" header names ONLY AI-FEAT-004, never AI-FEAT-010.
  // Proves direct citation + eligible classification is STILL not
  // sufficient; reciprocal citation (the record's own related_ids,
  // pre-existing field) is the third discriminator required.
  // -----------------------------------------------------------------
  await t('adversarial control: a DIRECT, classification-eligible Decision (DEC-001) is still rejected when it does not reciprocally cite the primary Feature back', () => {
    const q = 'What is Event Management and Editing?';
    const diag = explainNeighborhood(q, ctx);
    assert.equal(diag.primary.id, 'AI-FEAT-010');
    assert.equal(diag.classification, 'EXPLANATION');
    assert.ok(!diag.admitted.some((m) => m.id === 'DEC-001'), 'DEC-001 must NOT be admitted -- it is one-directional (AI-FEAT-010 cites it, it does not cite AI-FEAT-010 back)');
    const dec = diag.notAdmitted.find((m) => m.id === 'DEC-001');
    assert.ok(dec, 'DEC-001 must be explicitly reported as visible-not-admitted');
    assert.ok(/does not name/i.test(dec.reason), 'the rejection reason must cite the reciprocity failure specifically');
  });

  // -----------------------------------------------------------------
  // Feature + Decision (R21 / DEC-011)
  // -----------------------------------------------------------------
  await t('Feature + Decision (R21): DEC-011 admitted because the question is EXPLANATION-classified (rationale genuinely requested)', () => {
    const q = 'What is the current status of the QMZ dedicated domain workflow decision?';
    const diag = explainNeighborhood(q, ctx);
    assert.equal(diag.primary.id, 'AI-FEAT-047');
    assert.equal(diag.classification, 'EXPLANATION');
    const dec = diag.admitted.find((m) => m.id === 'DEC-011');
    assert.ok(dec, 'DEC-011 must be admitted');
    assert.equal(dec.role, 'Decision');
    assert.equal(dec.source, 'phase5.1-relationship-visibility');
  });

  await t('Feature + Decision negative control: DEC-009 stays visible-not-admitted for a plain current-state question about the same feature', () => {
    const q = 'Does AutoIngest verify metadata after same-size-skip imports?';
    const diag = explainNeighborhood(q, ctx);
    assert.equal(diag.primary.id, 'AI-FEAT-032');
    assert.equal(diag.classification, 'STATUS');
    assert.equal(diag.governanceEligible, false);
    const dec = diag.notAdmitted.find((m) => m.id === 'DEC-009');
    assert.ok(dec, 'DEC-009 must be reported as visible-not-admitted, not silently dropped from the report');
    const answer = answerQuestion(q, ctx);
    assert.ok(answer.sources.some((s) => s.id === 'DEC-009'), 'DEC-009 remains VISIBLE in sources[] (Phase 5.1, unchanged) even though not admitted to the neighborhood -- visibility is not admission');
  });

  // -----------------------------------------------------------------
  // Feature + Bug (R14 admits BUG-009; the same feature's STATUS-classified twin does not)
  // -----------------------------------------------------------------
  await t('Feature + Bug (R14): BUG-009 admitted because the question is TROUBLESHOOTING-classified (defect/incident genuinely requested)', () => {
    const q = 'What went wrong with the same-size skip and metadata verification?';
    const diag = explainNeighborhood(q, ctx);
    assert.equal(diag.primary.id, 'AI-FEAT-032');
    assert.equal(diag.classification, 'TROUBLESHOOTING');
    const bug = diag.admitted.find((m) => m.id === 'BUG-009');
    assert.ok(bug, 'BUG-009 must be admitted');
    assert.equal(bug.role, 'Bug');
  });

  await t('Feature + Bug negative control: a related Bug does not automatically appear as an admitted authority for a plain capability question', () => {
    const diag = explainNeighborhood('Does AutoIngest verify metadata after same-size-skip imports?', ctx);
    assert.ok(!diag.admitted.some((m) => m.role === 'Bug'), 'no Bug should be admitted for a non-troubleshooting, non-explanation question');
  });

  // -----------------------------------------------------------------
  // Feature + Postmortem (R14 also admits PM-001)
  // -----------------------------------------------------------------
  await t('Feature + Postmortem (R14): PM-001 admitted alongside DEC-009/BUG-009 under the same TROUBLESHOOTING materiality gate', () => {
    const diag = explainNeighborhood('What went wrong with the same-size skip and metadata verification?', ctx);
    const pm = diag.admitted.find((m) => m.id === 'PM-001');
    assert.ok(pm, 'PM-001 must be admitted');
    assert.equal(pm.role, 'Postmortem');
  });

  // -----------------------------------------------------------------
  // Workflow + limitation/status
  // -----------------------------------------------------------------
  await t('Workflow + limitation/status: procedure (AI-WF-009) reachable together with the current documented limitation (AI-FEAT-039)', () => {
    const q = 'How do I import from a transfer drive, and what is the current constraint with Collection-nested transfers?';
    const answer = answerQuestion(q, ctx);
    assert.ok(answer.matchedCapabilities.some((m) => m.id === 'AI-FEAT-039'), 'AI-FEAT-039 (the limitation content) must be independently reachable');
    assert.ok(answer.sources.some((s) => s.id === 'AI-WF-009'), 'AI-WF-009 (procedure) must be present');
  });

  // -----------------------------------------------------------------
  // Simple controls — single-aspect questions must remain single-record.
  // Strengthened per Materiality Correction: uses AI-FEAT-032, a Feature
  // with a real related Decision (DEC-009), Bug (BUG-009), Postmortem
  // (PM-001), AND a companion Workflow (AI-WF-009) that independently
  // scores above CONFIDENCE_FLOOR -- all four eligible, none material.
  // -----------------------------------------------------------------
  await t('MANDATORY negative controls (all four roles, one well-evidenced case): a plain STATUS question about a Feature with a real Decision + Bug + Postmortem + independently-strong Workflow admits NONE of them', () => {
    const q = 'Does AutoIngest verify metadata after same-size-skip imports?';
    const diag = explainNeighborhood(q, ctx);
    assert.equal(diag.primary.id, 'AI-FEAT-032');
    assert.equal(diag.classification, 'STATUS');
    assert.equal(diag.admitted.length, 0, 'zero admissions -- eligibility (score, visibility, classification-adjacent) is never by itself materiality');
    const byRole = Object.fromEntries(diag.notAdmitted.map((m) => [m.role, m]));
    assert.ok(byRole['Decision'], 'DEC-009 must be reported visible-not-admitted');
    assert.ok(byRole['Bug'], 'BUG-009 must be reported visible-not-admitted');
    assert.ok(byRole['Postmortem'], 'PM-001 must be reported visible-not-admitted');
    assert.ok(byRole['Workflow'], 'AI-WF-009 (independently above CONFIDENCE_FLOOR) must be reported visible-not-admitted, not treated as material merely because it scored well');
    const answer = answerQuestion(q, ctx);
    assert.ok(['DEC-009', 'BUG-009', 'PM-001', 'AI-WF-009'].every((id) => answer.sources.some((s) => s.id === id)), 'all four remain VISIBLE in sources[] (Phase 5.1 / pre-existing companion-Workflow citation, unchanged) even though none are admitted');
  });

  await t('Workflow negative control (isolated): the same companion Workflow (AI-WF-007) admitted for R21 (EXPLANATION) is visible-not-admitted for a STATUS question about the identical Feature', () => {
    const diag = explainNeighborhood('Does AutoIngest support QMZ sequencing?', ctx);
    assert.equal(diag.primary.id, 'AI-FEAT-047');
    assert.equal(diag.classification, 'STATUS');
    assert.ok(!diag.admitted.some((m) => m.role === 'Workflow'), 'no Workflow should be admitted for a non-procedural question');
    assert.ok(diag.notAdmitted.some((m) => m.id === 'AI-WF-007'), 'AI-WF-007 must be reported visible-not-admitted, not silently dropped');
  });

  await t('simple control: a plain single-aspect capability question does not gain a fabricated secondary authority', () => {
    const diag = explainNeighborhood('What is Global Search?', ctx);
    assert.equal(diag.admitted.length, 0, 'a simple question must not gain a synthesized secondary member merely because governance-eligible classification applies');
  });

  await t('simple control (RF-5.2-001/RF-5.4-008): archive-lock-error question keeps its exact pre-existing 4-source baseline, no fifth member added', () => {
    const answer = answerQuestion('How do I recover from an archive lock error?', ctx);
    assert.equal(answer.sources.length, 4);
  });

  // -----------------------------------------------------------------
  // Unsupported-aspect control
  // -----------------------------------------------------------------
  await t('unsupported-aspect control: a boundary-declined aspect is never fabricated; the supported record remains structurally present, not silently dropped', () => {
    const answer = answerQuestion('Why does Transfer Import exist, and what AI-based auto-tagging does it apply to imported photos?', ctx);
    assert.equal(answer.capabilityStatus, 'NOT_SUPPORTED');
    assert.ok(!/tagging/i.test(answer.directAnswer) || /no AI-based/i.test(answer.directAnswer), 'must never manufacture a tagging capability');
    assert.ok(answer.matchedCapabilities.some((m) => m.id === 'AI-FEAT-039'), 'the genuinely supported aspect (AI-FEAT-039) must remain structurally present in the answer, not erased by the boundary decline');
  });

  // -----------------------------------------------------------------
  // Scope-conflict controls
  // -----------------------------------------------------------------
  await t('scope-conflict control: current (direct-Event) vs Planned-adjacent (Collection-nested) distinction stays explicit, never silently merged', () => {
    const answer = answerQuestion('Why does Transfer Import exist, what limitation does Collection-nested import have, and what should I do operationally?', ctx);
    assert.ok(/direct-Event transfers/i.test(answer.directAnswer) && /Collection-nested transfers/i.test(answer.directAnswer), 'both transfer shapes must be named explicitly, not merged into one undifferentiated claim');
  });

  await t('scope-conflict control: a Planned record never gets silently reported as AVAILABLE inside a compound question that also names an Available record', () => {
    const answer = answerQuestion('What is Global Search and how does it relate to the Knowledge Engine?', ctx);
    assert.equal(answer.capabilityStatus, 'PLANNED', 'Global Search itself is Planned -- must not be reported as if it were already Available merely because the question also references an Available record');
  });

  // -----------------------------------------------------------------
  // No ranking influence / no recursive expansion (regression guards, reusing Phase 5.1's own proofs)
  // -----------------------------------------------------------------
  await t('neighborhood admission never influences ranking: R14\'s primary score/quality/confidence are unchanged by admission reasoning', () => {
    const answer = answerQuestion('What went wrong with the same-size skip and metadata verification?', ctx);
    assert.equal(answer.matchedCapabilities[0].score, 400);
    assert.equal(answer.matchQuality, 'strong');
    assert.equal(answer.confidence, 0.4);
    const diag = explainNeighborhood('What went wrong with the same-size skip and metadata verification?', ctx);
    assert.equal(diag.influencedRanking, false);
  });

  await t('no recursive expansion: DEC-009 also cites AI-FEAT-019 in its own header, but AI-FEAT-019 is never admitted or visible for AI-FEAT-032\'s answer', () => {
    const diag = explainNeighborhood('What went wrong with the same-size skip and metadata verification?', ctx);
    assert.ok(!diag.admitted.some((m) => m.id === 'AI-FEAT-019'));
    assert.ok(!diag.notAdmitted.some((m) => m.id === 'AI-FEAT-019'));
  });

  summarize('knowledgeNeighborhoodAdmission.test.js');
}

main();
