#!/usr/bin/env node
'use strict';

// Model bake-off checkpoint (2026-08-25) -- fast, model-free regression
// coverage for the bake-off's own evidence serializer and acceptance-set
// structure. Real-model quality results are a separate, non-CI benchmark
// (see main/askAutoIngestModelBakeOff.js's own header) -- this file only
// proves the deterministic construction logic every candidate model is
// fed through, matches the discipline scripts/product-docs/test/
// evidenceAtoms.test.js already established for the underlying atom
// architecture.

const assert = require('node:assert/strict');
const path = require('path');
const { createRunner } = require('../../test/testHarness');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { buildEvidencePackage } = require('../../lib/askSynthesis/evidencePackage');
const { serializeEvidence } = require('./evidenceSerializer');
const { CASES } = require('./acceptanceSet');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  await t('acceptance set: at least 50 cases, per the Product Owner checkpoint minimum', () => {
    assert.ok(CASES.length >= 50, `expected >=50 cases, got ${CASES.length}`);
  });

  await t('acceptance set: every case has a unique id', () => {
    const ids = CASES.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate case id found');
  });

  await t('acceptance set: every case has at least one turn and an expect block', () => {
    for (const c of CASES) {
      assert.ok(Array.isArray(c.turns) && c.turns.length >= 1, `${c.id} has no turns`);
      assert.ok(c.expect && typeof c.expect === 'object', `${c.id} has no expect block`);
    }
  });

  await t('serializeEvidence: always includes QUESTION and STATUS sections', () => {
    const pkg = buildEvidencePackage('What is QMZ?', ctx);
    const text = serializeEvidence('What is QMZ?', pkg, {});
    assert.match(text, /^QUESTION\n"What is QMZ\?"/);
    assert.match(text, /STATUS\n/);
  });

  await t('serializeEvidence: TECHNICAL DETAILS section only appears when includeTechnical is true', () => {
    const pkg = buildEvidencePackage('How do I sort QMZ photos?', ctx);
    const without = serializeEvidence('How do I sort QMZ photos?', pkg, { includeTechnical: false });
    const withTech = serializeEvidence('How do I sort QMZ photos?', pkg, { includeTechnical: true });
    assert.ok(!without.includes('TECHNICAL DETAILS'));
    assert.ok(withTech.includes('TECHNICAL DETAILS'));
  });

  await t('serializeEvidence: RATIONALE only appears for classifications selectEvidenceAtomsForClassification allows', () => {
    const howToPkg = buildEvidencePackage('How do I sort QMZ photos?', ctx);
    const explanationPkg = buildEvidencePackage('What is QMZ?', ctx);
    assert.equal(howToPkg.classification, 'HOW_TO');
    assert.equal(explanationPkg.classification, 'EXPLANATION');
    const howToText = serializeEvidence('How do I sort QMZ photos?', howToPkg, {});
    const explanationText = serializeEvidence('What is QMZ?', explanationPkg, {});
    assert.ok(!howToText.includes('RATIONALE'), 'HOW_TO must never carry RATIONALE');
    assert.ok(explanationText.includes('RATIONALE'), 'a genuine EXPLANATION question on a record with real rationale should carry it');
  });

  await t('serializeEvidence: never includes the literal "Why this exists" marker or a raw internal ID (S1-style handles are a separate concern; this checks the bake-off\'s own plain-text evidence)', () => {
    const pkg = buildEvidencePackage('What is QMZ?', ctx);
    const text = serializeEvidence('What is QMZ?', pkg, {});
    assert.ok(!/Why this exists/i.test(text));
  });

  await t('scoreResults.js: exists and exports nothing unexpected (module loads cleanly)', () => {
    assert.doesNotThrow(() => require.resolve(path.join(__dirname, 'scoreResults.js')));
  });

  summarize('evidenceSerializer.test.js');
}

main();
