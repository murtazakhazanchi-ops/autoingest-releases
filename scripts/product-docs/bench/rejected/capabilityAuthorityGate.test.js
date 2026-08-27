#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/capabilityAuthorityGate.test.js
// Retrieval Safety Checkpoint (Product Owner-authorized 2026-08-18) —
// "Unsupported-Capability Authority & False-Affirmation Closure". Locks in
// BOTH the genuine strengths and the DISQUALIFYING weakness of the
// title-token-overlap authority gate found during this investigation. This
// file exists to make the checkpoint's own negative conclusion (NOT safe to
// ship as designed) reproducible, not to certify the gate as production-
// ready — see the checkpoint's own pre-commit report for the full account.

const assert = require('node:assert/strict');
const { createRunner } = require('../../test/testHarness');
const build = require('../../lib/build');
const { buildEngineContext, answerQuestion, explainNormalization } = require('../../lib/knowledgeEngine');
const { applyCapabilityAuthorityGate } = require('./capabilityAuthorityGate');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  function gate(q) {
    const answer = answerQuestion(q, ctx);
    const diag = explainNormalization(q, ctx.searchIndex);
    return { answer, result: applyCapabilityAuthorityGate(q, answer, diag, ctx) };
  }

  // -----------------------------------------------------------------
  // Genuine strengths (why this rule was worth investigating at all)
  // -----------------------------------------------------------------
  await t('closes the governance-primary false positive this checkpoint was opened to investigate (blockchain/DEC-017)', () => {
    const { answer, result } = gate('Does AutoIngest support blockchain-verified chain-of-custody signing for archived photos?');
    assert.equal(answer.capabilityStatus, 'AVAILABLE', 'precondition: the real engine still confidently affirms this today');
    assert.equal(result.gated, true);
    assert.equal(result.answer.capabilityStatus, 'UNKNOWN');
  });

  await t('closes all three governance-primary false positives found in Phase A.2 (blockchain/DEC-017, voice-command/DEC-004, color-grading/DEC-002)', () => {
    for (const q of [
      'Does AutoIngest support blockchain-verified chain-of-custody signing for archived photos?',
      'Does AutoIngest support voice-command narration during import?',
      'Does AutoIngest provide a built-in color grading tool for RAW files?',
    ]) {
      const { result } = gate(q);
      assert.equal(result.gated, true, `expected ${q} to be gated`);
    }
  });

  await t('never gates a NOT_SUPPORTED boundary answer (cloud backup, face recognition, conflict warning) -- out of scope by design', () => {
    for (const q of [
      'Does AutoIngest offer cloud backup?',
      'Can AutoIngest recognize faces?',
      'If two people import at the same time, will there be a conflict warning?',
    ]) {
      const { answer, result } = gate(q);
      assert.equal(answer.capabilityStatus, 'NOT_SUPPORTED');
      assert.equal(result.gated, false);
    }
  });

  await t('never touches the historically-critical "How do I create a new event?" regression control (DEC-020)', () => {
    const { answer, result } = gate('How do I create a new event?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-WF-002');
    assert.equal(result.gated, false);
    assert.equal(result.answer.capabilityStatus, 'AVAILABLE');
  });

  await t('exact-id/exact-alias/title-substring matches are never gated, regardless of how narrow the record is', () => {
    const { answer, result } = gate('What is QMZ?');
    assert.equal(answer.capabilityStatus, 'AVAILABLE');
    assert.equal(result.gated, false, 'a direct/title-tier match must never be second-guessed by this gate');
  });

  // -----------------------------------------------------------------
  // The disqualifying weakness (why this checkpoint's recommendation is
  // "architectural decision still required", not "safe to commit")
  // -----------------------------------------------------------------
  await t('DISQUALIFYING FINDING: gates a real, correct, historically-improved answer whose match comes from body/Summary text using different words than the record\'s own title -- "Can I tell if a teammate is online right now?" (AI-FEAT-027, documented in knowledgeTestCorpusV2 as a genuine improvement, not a coincidence)', () => {
    const { answer, result } = gate('Can I tell if a teammate is online right now?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-027', 'precondition: this is the real, already-verified-correct primary');
    assert.equal(result.gated, true, 'the title-overlap rule incorrectly downgrades this correct answer -- "teammate"/"online"/"right"/"now" share zero tokens with the title "Activity Log", even though the record\'s own Summary genuinely documents live presence');
  });

  await t('DISQUALIFYING FINDING: gates a second real, correct, historically-improved answer for the same reason ("How do I get preview builds?" -> AI-FEAT-057)', () => {
    const { answer, result } = gate('How do I get preview builds?');
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-057');
    assert.equal(result.gated, true, 'title tokens "multi-channel"/"release"/"update"/"system" share nothing with "preview"/"builds", even though this is documented as the genuinely correct answer');
  });

  await t('measured regression rate against the real V1+V2+V3 regression corpus is material (not a hypothetical concern): at least 20 of ~165 corpus questions are gated, several of them documented `control`/improvement entries, not merely known-imperfect ones', () => {
    const v1 = require('../../lib/knowledgeTestCorpus');
    const v2 = require('../../lib/knowledgeTestCorpusV2');
    const v3 = require('../../lib/knowledgeRegressionCorpusV3');
    const extract = (mod) => {
      const arr = Array.isArray(mod) ? mod : (mod.corpus || mod.default || Object.values(mod).find(Array.isArray));
      return (arr || []).map((e) => e.question || e.q).filter(Boolean);
    };
    const allQs = [...extract(v1), ...extract(v2), ...extract(v3)];
    let gatedCount = 0;
    for (const q of allQs) {
      try {
        const { result } = gate(q);
        if (result.gated) gatedCount++;
      } catch { /* a handful of corpus entries are not plain question strings -- skip, not this test's concern */ }
    }
    assert.ok(gatedCount >= 20, `expected at least 20 corpus regressions to reproduce the checkpoint's own finding, got ${gatedCount} -- if this number has dropped, the underlying engine/corpus may have changed and the checkpoint's conclusion should be re-verified, not silently trusted as still true`);
  });

  summarize('capabilityAuthorityGate.test.js');
}

main();
