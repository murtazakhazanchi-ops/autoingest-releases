#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/knowledgeMergeReadiness.test.js
// Pre-merge acceptance pass — locks in defects found while testing the
// portal "as a normal operator, not as the developer who knows how it
// works." The main finding: "Team Live" is the actual operator-facing UI
// toggle name for this feature (AI-WF-006: "Team Live must be enabled
// first"), not just internal documentation shorthand for "Online
// Registry"/"relay" — several Registry boundary questions phrased with
// "Team Live" instead of "registry"/"relay" fell through to a generic
// strong match instead of the correct boundary. Also covers two natural-
// phrasing gaps found the same way (conflict questions without the literal
// word "warning", presence questions using "actively working" instead of
// "editing").

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { QUERY_STATUS } = require('../lib/statusResolution');
const { answerQuestion, buildEngineContext } = require('../lib/knowledgeEngine');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  await t('"Team Live" phrasing is recognized as a synonym for the Online Registry media-storage boundary', () => {
    const answer = answerQuestion('Do my photos get sent through the Team Live server?', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
  });

  await t('"Team Live" phrasing is recognized as a synonym for the source-of-truth boundary', () => {
    const answer = answerQuestion('Is the Team Live registry basically my archive?', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
  });

  await t('a conflict question without the literal word "warning" still resolves to the conflict-detection boundary', () => {
    const answer = answerQuestion('Will I get warned if my colleague and I edit the same thing?', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
  });

  await t('"tell me about conflicts with other operators" resolves to the conflict-detection boundary', () => {
    const answer = answerQuestion('Does the app tell me about conflicts with other operators?', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
  });

  await t('"actively working on my files" (not just "editing my files") is recognized as the presence-not-activity boundary', () => {
    const answer = answerQuestion('If someone is online, are they actively working on my files?', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
  });

  await t('offline/degraded questions phrased with "Team Live" never falsely deny that import continues', () => {
    const answer = answerQuestion('Will my import stop working if Team Live disconnects?', ctx);
    assert.notEqual(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED, 'import continuing during relay disconnection must never be denied');
  });

  await t('every fabricated-ID and boundary-override regression check still holds after the Team Live trigger widening', () => {
    const { CORPUS } = require('../lib/knowledgeTestCorpus');
    const { CORPUS_V2 } = require('../lib/knowledgeTestCorpusV2');
    const boundaryQuestions = [...CORPUS, ...CORPUS_V2].filter((e) => e.expectedMatchQuality === 'boundary');
    for (const entry of boundaryQuestions) {
      const answer = answerQuestion(entry.question, ctx);
      assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED, `"${entry.question}" (expected boundary) resolved ${answer.capabilityStatus} after the Team Live trigger widening`);
    }
  });

  summarize('knowledgeMergeReadiness.test.js');
}

main();
