#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/knowledgeAdversarialPhase24.test.js
// Stage 2, Phase 24 — fresh adversarial review regression suite. Locks in
// the real defects found and fixed while testing 36 newly-invented
// questions (none reused from knowledgeTestCorpus.js or
// knowledgeTestCorpusV2.js — verified distinct at authoring time) against
// the real engine. See AI-FEAT-058's Phase 24 evolution entry for the full
// account of each defect's root cause.

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { QUERY_STATUS } = require('../lib/statusResolution');
const { answerQuestion, buildEngineContext } = require('../lib/knowledgeEngine');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  await t('a compound question naming an unrelated real feature does not override an explicit cloud-storage boundary phrase', () => {
    const answer = answerQuestion('Since AutoIngest has an Online Registry, does that mean it has cloud storage too?', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
  });

  await t('a compound question naming an unrelated real feature does not override an explicit multi-user-accounts boundary phrase', () => {
    const answer = answerQuestion('Because multiple operators can be present at once, does that mean AutoIngest supports multiple user accounts?', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
  });

  await t('all six original Stage 1 boundaries carry hardOverride (never suppressed by an unrelated strong raw match)', () => {
    const { KNOWN_BOUNDARIES } = require('../lib/statusResolution');
    const originalIds = ['face-recognition', 'ai-auto-tagging', 'photo-editing', 'cloud-storage', 'linux', 'multi-user-roles'];
    for (const id of originalIds) {
      const b = KNOWN_BOUNDARIES.find((x) => x.id === id);
      assert.ok(b, `boundary ${id} missing`);
      assert.equal(b.hardOverride, true, `boundary ${id} should carry hardOverride: true`);
    }
  });

  await t('a short generic trigger word does not false-positive inside an unrelated inflected word (GPS "coordinates" vs "coordinate with")', () => {
    const answer = answerQuestion('Can I tag photographs with GPS coordinates manually?', ctx);
    // Must not confidently claim availability via an accidental substring
    // match on the Online Registry (the original defect) — UNKNOWN (no
    // evidence either way) is the correct, honest outcome.
    assert.notEqual(answer.matchedCapabilities[0]?.id, 'AI-FEAT-048', 'GPS-coordinates question incorrectly matched the Online Registry via the "coordinate" substring bug');
  });

  await t('"replaces event.json" is recognized as the same registry-not-source-of-truth boundary as "replaces the archive"', () => {
    const answer = answerQuestion("It's my understanding that the Online Registry replaces event.json — is that correct?", ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
  });

  await t('sync-slot is findable via an EXPLANATION-classified question, correctly grounded in whichever real record documents it', () => {
    // Corrected 2026-08-17 during Part 4 closure / standalone-test
    // reconciliation: the original premise ("sync-slot exists only inside
    // AI-WF-006's own text") was proven false — AI-FEAT-048's canonical
    // file has documented "sync-slot negotiation"/"sync-slot coordination"
    // since the original feature-registry commit, predating both AI-WF-006
    // and this test. Both records are genuinely, evidentially relevant
    // (equal absolute evidence, 2 matched tokens each); this is the
    // already-disclosed near-identical-evidence residual class Approach D
    // (Phase 4.3) and the Phase 4.3 extension (Part 4 closure) both
    // deliberately leave to surface-normalized ordering, not primary-ID
    // brittleness. The real invariant: sync-slot must resolve to one of
    // the two records that actually document it, confidently (not a
    // decline), and AI-WF-006 must remain discoverable even when not
    // primary — an unrelated record must never win via keyword collision.
    const answer = answerQuestion('What is a sync-slot?', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.AVAILABLE);
    assert.ok(['AI-WF-006', 'AI-FEAT-048'].includes(answer.matchedCapabilities[0]?.id), `sync-slot primary should be AI-WF-006 or AI-FEAT-048 (the two records that actually document it), got ${answer.matchedCapabilities[0]?.id}`);
    assert.ok((answer.sources || []).some((s) => s.id === 'AI-WF-006'), 'AI-WF-006 must remain discoverable/cited even when AI-FEAT-048 is primary');
  });

  await t('"What does X mean" is classified the same as "What is X" (EXPLANATION)', () => {
    const { classifyQuestion, QUESTION_TYPES } = require('../lib/questionClassifier');
    assert.equal(classifyQuestion("What does 'Collection' mean in AutoIngest?"), QUESTION_TYPES.EXPLANATION);
  });

  await t('broadening workflow-preference to EXPLANATION did not introduce a false boundary override or a false AVAILABLE for any V1/V2 boundary-covered question', () => {
    const { CORPUS } = require('../lib/knowledgeTestCorpus');
    const { CORPUS_V2 } = require('../lib/knowledgeTestCorpusV2');
    const boundaryQuestions = [...CORPUS, ...CORPUS_V2].filter((e) => e.expectedMatchQuality === 'boundary');
    for (const entry of boundaryQuestions) {
      const answer = answerQuestion(entry.question, ctx);
      assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED, `"${entry.question}" (expected boundary) resolved ${answer.capabilityStatus} after the EXPLANATION broadening`);
    }
  });

  summarize('knowledgeAdversarialPhase24.test.js');
}

main();
