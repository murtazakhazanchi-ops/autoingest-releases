#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/questionClassifier.test.js
// Part 3 Phase 4.4 (Decision 6 of 8, hygiene half) — focused regression
// suite for the "why does X" purpose-vs-troubleshooting classification
// defect. This is a LABEL-correctness suite only: it asserts on
// classifyQuestion()'s own output, never on retrieval/answerQuestion()
// results. Retrieval invariance for the same questions is checked
// separately in knowledgeRegressionCorpusV3.js (RF-4.3-001/RF-4.4-001) and
// in the Phase 4.4 Pre-Commit Report's explicit before/after comparison —
// this phase is classifier-hygiene only, not a Gap C retrieval fix.

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const { classifyQuestion, QUESTION_TYPES } = require('../lib/questionClassifier');

async function main() {
  const { t, summarize } = createRunner();

  // -----------------------------------------------------------------
  // Purpose / explanation controls — must NOT classify TROUBLESHOOTING
  // -----------------------------------------------------------------
  const purposeQuestions = [
    'Why does Transfer Import exist?',
    'Why was Transfer Export designed this way?',
    'Why is event.json the authoritative record?',
    'Why was this feature created?',
    'Why is this designed this way?',
    'Why was the Metadata Audit tool built?',
    'Why is the Grouping System structured this way?',
    'What is the reason for this behavior?',
  ];
  for (const q of purposeQuestions) {
    await t(`purpose/rationale form classifies EXPLANATION, not TROUBLESHOOTING: ${JSON.stringify(q)}`, () => {
      const actual = classifyQuestion(q);
      assert.equal(actual, QUESTION_TYPES.EXPLANATION, `expected EXPLANATION, got ${actual}`);
    });
  }

  // -----------------------------------------------------------------
  // Troubleshooting controls — genuine failure forms must remain
  // TROUBLESHOOTING after the narrowing (proves the fix narrows the
  // pattern, it does not disable it)
  // -----------------------------------------------------------------
  const troubleshootingQuestions = [
    "Why can't I import this transfer drive?",
    "Why won't Transfer Import resume?",
    "Why doesn't metadata repair start?",
    'Why did this import fail?',
    'Why is the archive sync not working?',
    "Why can't I import photos from this drive?",
    "Why won't the metadata audit complete?",
    'Why am I getting this error when importing?',
  ];
  for (const q of troubleshootingQuestions) {
    await t(`genuine failure form still classifies TROUBLESHOOTING: ${JSON.stringify(q)}`, () => {
      const actual = classifyQuestion(q);
      assert.equal(actual, QUESTION_TYPES.TROUBLESHOOTING, `expected TROUBLESHOOTING, got ${actual}`);
    });
  }

  // -----------------------------------------------------------------
  // Ambiguous controls — the word "why" alone must never force
  // TROUBLESHOOTING; these carry no recognized failure vocabulary and
  // must not classify TROUBLESHOOTING even though none of them are
  // clean purpose/rationale forms either (real ambiguity, asserted as
  // "not troubleshooting", not forced into a specific bucket).
  // -----------------------------------------------------------------
  const ambiguousQuestions = [
    'Why is metadata sometimes incomplete after import?',
    'Why does the archive sync take so long?',
    'Why is Transfer Import slower than Quick Import?',
    'Why did the operator choose Quick Import over Transfer Import?',
  ];
  for (const q of ambiguousQuestions) {
    await t(`ambiguous "why" form (no failure vocabulary) does not classify TROUBLESHOOTING: ${JSON.stringify(q)}`, () => {
      const actual = classifyQuestion(q);
      assert.notEqual(actual, QUESTION_TYPES.TROUBLESHOOTING, `"why" alone forced TROUBLESHOOTING for a non-failure question (got ${actual})`);
    });
  }

  await t('every real "why is/was/does" question across V1+V2+V3 classifies exactly as expected — locks in the narrowing corpus-wide, not just for the hand-picked cases above', () => {
    const { CORPUS } = require('../lib/knowledgeTestCorpus');
    const { CORPUS_V2 } = require('../lib/knowledgeTestCorpusV2');
    const v3mod = require('../lib/knowledgeRegressionCorpusV3');
    const v3 = Array.isArray(v3mod) ? v3mod : (v3mod.REGRESSION_CORPUS_V3 || Object.values(v3mod).find(Array.isArray));
    const all = [...CORPUS, ...CORPUS_V2, ...v3].filter((e) => typeof e.question === 'string');
    const whyIsWasDoes = all.filter((e) => /\bwhy (is|was|does)\b/i.test(e.question));
    assert.ok(whyIsWasDoes.length >= 8, `expected at least 8 real "why is/was/does" corpus questions to check against, found ${whyIsWasDoes.length} — corpus may have shrunk`);
    for (const entry of whyIsWasDoes) {
      const actual = classifyQuestion(entry.question);
      const isExistFamily = /\bwhy does transfer import exist\b/i.test(entry.question);
      if (isExistFamily) {
        assert.equal(actual, QUESTION_TYPES.EXPLANATION, `"${entry.question}" (the corrected family) should classify EXPLANATION, got ${actual}`);
      } else {
        assert.notEqual(actual, QUESTION_TYPES.TROUBLESHOOTING, `"${entry.question}" unexpectedly classifies TROUBLESHOOTING after the narrowing`);
      }
    }
  });

  summarize('questionClassifier.test.js');
}

main();
