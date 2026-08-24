#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/knowledgeScoringCompetitionC63.test.js
// Phase C6.3 — candidate-scoring/retrieval-confidence regression suite.
// Locks in the one implemented change (NAVIGATION added to
// workflowPreferredType, see knowledgeEngine.js's own comment on that
// flag) plus every protected pre-existing result this checkpoint was
// required not to regress. Two architectural options (provenance-aware
// token-count tie-break; a Workflow-vs-Feature tier-mismatch override)
// were tested and explicitly REJECTED by full-corpus regression — see
// knowledgeEngine.js's own comments at both rejected call sites for the
// evidence — so this suite does not assert on either of those behaviors.

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { buildEngineContext, answerQuestion, classifyQuestion, QUESTION_TYPES } = require('../lib/knowledgeEngine');
const { runProductOwnerGate } = require('../lib/productOwnerGateRunner');
const { PRODUCT_OWNER_GATE_22 } = require('../lib/productOwnerAcceptanceGate');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  function primaryOf(question) {
    const a = answerQuestion(question, ctx);
    return a.matchedCapabilities && a.matchedCapabilities[0] ? a.matchedCapabilities[0].id : null;
  }

  // -----------------------------------------------------------------
  // N1 — the headline fix. NAVIGATION-classified, best real candidate is
  // a Workflow; must now resolve to it.
  // -----------------------------------------------------------------
  await t('N1: NAVIGATION question with a strong Workflow candidate resolves to that Workflow, not an unrelated Feature', () => {
    const q = 'Where do my photos actually end up after an import finishes?';
    assert.equal(classifyQuestion(q), QUESTION_TYPES.NAVIGATION);
    assert.equal(primaryOf(q), 'AI-WF-001');
  });

  // -----------------------------------------------------------------
  // Protected C6.1 fixes — must never regress.
  // -----------------------------------------------------------------
  await t('Q5 protected: "How do I create a Transfer Export?" still resolves to AI-FEAT-038', () => {
    assert.equal(primaryOf('How do I create a Transfer Export?'), 'AI-FEAT-038');
  });
  await t('Q13 protected: "Why does Transfer Import exist?" still resolves to AI-FEAT-039', () => {
    assert.equal(primaryOf('Why does Transfer Import exist?'), 'AI-FEAT-039');
  });
  await t('Archive Maintenance protected: "What is Archive Maintenance?" still resolves to AI-FEAT-049 (PLANNED)', () => {
    const a = answerQuestion('What is Archive Maintenance?', ctx);
    assert.equal(a.matchedCapabilities[0].id, 'AI-FEAT-049');
    assert.equal(a.capabilityStatus, 'PLANNED');
  });

  // -----------------------------------------------------------------
  // NAVIGATION behavior — Feature-appropriate NAVIGATION questions (the
  // majority, no competing companion workflow) must be unaffected by
  // including NAVIGATION in workflowPreferredType.
  // -----------------------------------------------------------------
  await t('NAVIGATION Feature-appropriate case unaffected: a File Browser question with no competing companion Workflow still resolves to AI-FEAT-013', () => {
    const q = 'Where do I go to look through everything already in a folder as a grid instead of a list?';
    assert.equal(classifyQuestion(q), QUESTION_TYPES.NAVIGATION);
    assert.equal(primaryOf(q), 'AI-FEAT-013');
  });

  // -----------------------------------------------------------------
  // Governance vs Feature — legitimate governance-primary TROUBLESHOOTING
  // question (pre-existing, unrelated to this checkpoint's own change,
  // re-verified here as a scoring-competition control). Note: a WHY-form
  // governance control naming "Transfer Export" by its exact title was
  // tried first and found to hit the SAME pre-existing (since-C6.1, not
  // C6.3-introduced) identity-mention-dominance defect already disclosed
  // for Q6 in the Product Owner gate (see productOwnerAcceptanceGate.js's
  // own Q6 rationale) — not asserted here since it is a known, disclosed,
  // out-of-scope-for-this-checkpoint defect, not a C6.3 regression.
  // -----------------------------------------------------------------
  await t('Governance-primary control: a same-machine stale-lock question legitimately resolves within {BUG-004, AI-WF-008}', () => {
    const a = answerQuestion('Every import on this one machine is blocked because of a lock left behind from before — what caused that?', ctx);
    assert.ok(['BUG-004', 'AI-WF-008'].includes(a.matchedCapabilities[0].id), `expected BUG-004 or AI-WF-008, got ${a.matchedCapabilities[0].id}`);
  });

  // -----------------------------------------------------------------
  // Exact-title / no-exact-title controls.
  // -----------------------------------------------------------------
  await t('Exact-title control: "What is Quick Import?" resolves to AI-FEAT-023', () => {
    assert.equal(primaryOf('What is Quick Import?'), 'AI-FEAT-023');
  });
  await t('No-exact-title paraphrase control: a QMZ-domain paraphrase still resolves within the QMZ concept neighborhood', () => {
    const id = primaryOf('What is the process for numbering Qadam Majlis Ziyafat images in order?');
    assert.ok(['AI-FEAT-047', 'AI-WF-007'].includes(id), `expected a QMZ-domain record, got ${id}`);
  });

  // -----------------------------------------------------------------
  // Product Owner 22-question retrieval gate — durable regression floor.
  // Baseline (pre-C6.3) was 15/22; C6.3's NAVIGATION fix brought it to
  // 16/22 (N1 fixed, nothing regressed). Floor set at 16, not exactly-16,
  // so a future genuine improvement doesn't require editing this test.
  // -----------------------------------------------------------------
  await t('Product Owner 22-question gate: pass rate at or above the C6.3 floor (16/22), and no C6.1-protected question newly fails', () => {
    const result = runProductOwnerGate(PRODUCT_OWNER_GATE_22, ctx);
    assert.ok(result.passing >= 16, `expected >= 16/22 passing, got ${result.passing}/22 (failing: ${result.failing.join(', ')})`);
    for (const mustPass of ['Q5', 'Q13', 'N1']) {
      assert.ok(!result.failing.includes(mustPass), `${mustPass} must not be in the failing set`);
    }
  });

  summarize('knowledgeScoringCompetitionC63.test.js');
}

main();
