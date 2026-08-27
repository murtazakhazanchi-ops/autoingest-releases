#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/evidenceAtoms.test.js
// C8 corrective checkpoint (2026-08-24), Defect 2 — "atomic evidence
// synthesis". Fast, model-free regression coverage for
// lib/askSynthesis/evidencePackage.js's new atomic, role-typed evidence
// construction (FACT/ACTION/LIMITATION/TECHNICAL/RATIONALE/PROVENANCE),
// question-relevant selection, promptTemplates.js's payload gating, and
// safetyValidation.js's two new evidence-package-derived leak checks. Real-
// Phi acceptance (whether these atoms actually fix documentation-dump
// answers) is a separate, non-CI benchmark -- this file only proves the
// deterministic construction/selection/detection logic itself, the same
// division of labor answerWithSynthesis.test.js's own header comment
// documents for the synthesis pipeline as a whole.

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { buildEngineContext } = require('../lib/knowledgeEngine');
const {
  buildEvidencePackage,
  buildEvidenceAtoms,
  selectEvidenceAtomsForClassification,
  splitRationaleFromProvenanceQualifier,
  extractTechnicalAtoms,
} = require('../lib/askSynthesis/evidencePackage');
const { buildSynthesisPrompt } = require('../lib/askSynthesis/promptTemplates');
const { checkNoTechnicalIdentifierLeak, checkNoProvenanceAtomLeak } = require('../lib/askSynthesis/safetyValidation');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  // ---------------------------------------------------------------------
  // splitRationaleFromProvenanceQualifier -- the structural marker(parenthetical)
  // pattern this checkpoint discovered (23/25 corpus records with "Why
  // this exists" carry an immediate provenance-qualifying parenthetical;
  // 2/25 do not).
  // ---------------------------------------------------------------------
  await t('splitRationaleFromProvenanceQualifier: marker + parenthetical + colon splits into rationale and provenanceQualifier', () => {
    const blob = '**Why this exists** (captured 2026-08-14 — *Known from project history; repository evidence pending*): the real reasoning goes here.';
    const { rationale, provenanceQualifier } = splitRationaleFromProvenanceQualifier(blob);
    assert.equal(rationale, 'the real reasoning goes here.');
    assert.ok(/repository evidence pending/.test(provenanceQualifier));
  });

  await t('splitRationaleFromProvenanceQualifier: marker with NO parenthetical (real corpus case, e.g. AI-FEAT-026) yields rationale-only, provenanceQualifier null', () => {
    const blob = '**Why this exists**: a fast, lightweight, operator-triggered completeness check.';
    const { rationale, provenanceQualifier } = splitRationaleFromProvenanceQualifier(blob);
    assert.equal(rationale, 'a fast, lightweight, operator-triggered completeness check.');
    assert.equal(provenanceQualifier, null);
  });

  await t('splitRationaleFromProvenanceQualifier: no marker at all -> null/null, input untouched semantically', () => {
    const result = splitRationaleFromProvenanceQualifier(null);
    assert.equal(result.rationale, null);
    assert.equal(result.provenanceQualifier, null);
  });

  // ---------------------------------------------------------------------
  // extractTechnicalAtoms -- the backtick-code-span structural convention
  // (verified this checkpoint: 38/58 Feature records' own Summary section
  // use it, not a QMZ special case).
  // ---------------------------------------------------------------------
  await t('extractTechnicalAtoms: extracts each unique backtick-wrapped identifier as its own TECHNICAL atom', () => {
    const text = 'has its own root (`qmzRoot`), state file (`qmz-sequences.json`), and never touches `sortKey`/`viewMode`.';
    const atoms = extractTechnicalAtoms(text, 'AI-FEAT-047', 'directAnswer');
    const texts = atoms.map((a) => a.text);
    assert.deepEqual(texts, ['qmzRoot', 'qmz-sequences.json', 'sortKey', 'viewMode']);
    assert.ok(atoms.every((a) => a.role === 'TECHNICAL' && a.sourceId === 'AI-FEAT-047'));
  });

  await t('extractTechnicalAtoms: no backticks -> zero atoms', () => {
    assert.deepEqual(extractTechnicalAtoms('plain operator-facing prose with no code spans.', 'X', 'directAnswer'), []);
  });

  // ---------------------------------------------------------------------
  // buildEvidenceAtoms / buildEvidencePackage -- real corpus record (QMZ,
  // the exact record the original Answer-Quality Hold complaint cited).
  // ---------------------------------------------------------------------
  await t('buildEvidencePackage("How do I sort QMZ photos?"): evidenceAtoms carries all six roles, each traceable to its source field', () => {
    const pkg = buildEvidencePackage('How do I sort QMZ photos?', ctx);
    const roles = new Set(pkg.evidenceAtoms.map((a) => a.role));
    assert.ok(roles.has('FACT'));
    assert.ok(roles.has('ACTION'), 'QMZ has real Workflow steps -- must produce ACTION atoms');
    assert.ok(roles.has('LIMITATION'));
    assert.ok(roles.has('TECHNICAL'), 'QMZ\'s own directAnswer has backtick-wrapped identifiers (qmzRoot, qmz-sequences.json, etc.)');
    assert.ok(roles.has('RATIONALE'), 'QMZ has a real "Why this exists" narrative');
    assert.ok(roles.has('PROVENANCE'), 'QMZ\'s "Why this exists" has a provenance-qualifying parenthetical');
    const technicalTexts = pkg.evidenceAtoms.filter((a) => a.role === 'TECHNICAL').map((a) => a.text);
    assert.ok(technicalTexts.includes('qmzRoot'));
    assert.ok(technicalTexts.includes('qmz-sequences.json'));
  });

  await t('selectEvidenceAtomsForClassification: HOW_TO never includes RATIONALE, TECHNICAL, or PROVENANCE', () => {
    const pkg = buildEvidencePackage('How do I sort QMZ photos?', ctx);
    assert.equal(pkg.classification, 'HOW_TO');
    const roles = new Set(pkg.selectedEvidenceAtoms.map((a) => a.role));
    assert.ok(!roles.has('RATIONALE'));
    assert.ok(!roles.has('TECHNICAL'));
    assert.ok(!roles.has('PROVENANCE'));
    assert.ok(roles.has('FACT'));
    assert.ok(roles.has('ACTION'));
  });

  await t('selectEvidenceAtomsForClassification: EXPLANATION includes RATIONALE when present, but still never TECHNICAL or PROVENANCE', () => {
    const pkg = buildEvidencePackage('What is QMZ?', ctx);
    assert.equal(pkg.classification, 'EXPLANATION');
    const roles = new Set(pkg.selectedEvidenceAtoms.map((a) => a.role));
    assert.ok(roles.has('RATIONALE'), 'a genuine "what is X" question on a record with real rationale should offer it (matches TYPE_GUIDANCE.EXPLANATION\'s own instruction)');
    assert.ok(!roles.has('TECHNICAL'));
    assert.ok(!roles.has('PROVENANCE'));
  });

  await t('selectEvidenceAtomsForClassification: never selects TECHNICAL/PROVENANCE regardless of classification, even when explicitly asked to', () => {
    const atoms = [
      { role: 'FACT', text: 'f' }, { role: 'ACTION', text: 'a' }, { role: 'LIMITATION', text: 'l' },
      { role: 'TECHNICAL', text: 't' }, { role: 'RATIONALE', text: 'r' }, { role: 'PROVENANCE', text: 'p' },
    ];
    for (const classification of ['HOW_TO', 'EXPLANATION', 'UNKNOWN', 'KNOWN_RECORD_BROWSE', 'CAPABILITY', 'TROUBLESHOOTING']) {
      const selected = selectEvidenceAtomsForClassification(atoms, classification);
      assert.ok(!selected.some((a) => a.role === 'TECHNICAL'), `TECHNICAL leaked through for classification ${classification}`);
      assert.ok(!selected.some((a) => a.role === 'PROVENANCE'), `PROVENANCE leaked through for classification ${classification}`);
    }
  });

  // ---------------------------------------------------------------------
  // deterministicFallback -- operator-safe by default (Section H).
  // ---------------------------------------------------------------------
  await t('buildEvidencePackage: deterministicFallback.directAnswer excludes the "Why this exists" provenance/rationale narrative', () => {
    const pkg = buildEvidencePackage('What is QMZ?', ctx);
    assert.ok(!/Why this exists/i.test(pkg.deterministicFallback.directAnswer), `deterministicFallback.directAnswer still carries the provenance narrative: ${pkg.deterministicFallback.directAnswer}`);
    assert.ok(pkg.deterministicFallback.directAnswer.length > 0, 'the capability description itself must still be present');
  });

  // ---------------------------------------------------------------------
  // promptTemplates.js -- whyThisExists payload gating.
  // ---------------------------------------------------------------------
  await t('buildSynthesisPrompt: whyThisExists is present (rationale only, never the provenance qualifier) for an EXPLANATION question on a record with real rationale', () => {
    const pkg = buildEvidencePackage('What is QMZ?', ctx);
    const { user } = buildSynthesisPrompt(pkg);
    const payload = JSON.parse(user);
    assert.ok(payload.whyThisExists, 'expected whyThisExists to be present for EXPLANATION');
    assert.ok(!/repository evidence pending|Purpose Capture interview|captured \d{4}-\d{2}-\d{2}/i.test(payload.whyThisExists), 'whyThisExists must never carry the provenance qualifier text');
  });

  await t('buildSynthesisPrompt: whyThisExists is structurally ABSENT for a HOW_TO question, even on a record with real rationale', () => {
    const pkg = buildEvidencePackage('How do I sort QMZ photos?', ctx);
    const { user } = buildSynthesisPrompt(pkg);
    const payload = JSON.parse(user);
    assert.ok(!('whyThisExists' in payload), 'whyThisExists must be structurally absent (not merely empty) for HOW_TO');
  });

  await t('buildSynthesisPrompt: no TECHNICAL identifier (e.g. "qmzRoot", "qmz-sequences.json") is ever offered as a standalone evidence field', () => {
    const pkg = buildEvidencePackage('How do I sort QMZ photos?', ctx);
    const { user } = buildSynthesisPrompt(pkg);
    const payload = JSON.parse(user);
    assert.ok(!('evidenceAtoms' in payload) && !('selectedEvidenceAtoms' in payload) && !('technical' in payload), 'the raw atom list itself must never be handed to the model as a field named after its internal role');
  });

  // ---------------------------------------------------------------------
  // safetyValidation.js -- the two new evidence-package-derived leak
  // checks. Evidence-package-derived, not a hardcoded blacklist -- same
  // pattern as checkNoIdLeakInProse/checkNoHandleLeakInProse.
  // ---------------------------------------------------------------------
  await t('checkNoTechnicalIdentifierLeak: fails when the candidate echoes a real TECHNICAL atom from this evidence package', () => {
    const pkg = buildEvidencePackage('How do I sort QMZ photos?', ctx);
    const result = checkNoTechnicalIdentifierLeak({ answer: 'It uses qmzRoot internally to track state.' }, pkg);
    assert.equal(result.ok, false);
    assert.ok(result.leaks.some((l) => l.identifier === 'qmzRoot'));
  });

  await t('checkNoTechnicalIdentifierLeak: passes for an answer that never mentions any real TECHNICAL atom text', () => {
    const pkg = buildEvidencePackage('How do I sort QMZ photos?', ctx);
    const result = checkNoTechnicalIdentifierLeak({ answer: 'QMZ helps you sort photos into sequences.', steps: [{ text: 'Assign photos to a sequence.' }] }, pkg);
    assert.equal(result.ok, true);
  });

  await t('checkNoTechnicalIdentifierLeak: an unrelated technical WORD the operator\'s own evidence never used (e.g. "JSON") is never flagged -- this is evidence-derived, not a vocabulary blacklist', () => {
    const pkg = buildEvidencePackage('How do I import photographs from an SD card?', ctx);
    const result = checkNoTechnicalIdentifierLeak({ answer: 'AutoIngest reads the files and writes them into your archive using its own JSON-based tracking.' }, pkg);
    assert.equal(result.ok, true, 'a generic technical word not among this record\'s own extracted TECHNICAL atoms must never fail the check');
  });

  await t('checkNoProvenanceAtomLeak: fails when the candidate echoes this record\'s real provenance-qualifier text verbatim', () => {
    const pkg = buildEvidencePackage('What is QMZ?', ctx);
    const provenanceAtom = pkg.evidenceAtoms.find((a) => a.role === 'PROVENANCE');
    assert.ok(provenanceAtom, 'sanity: QMZ must have a PROVENANCE atom for this test to mean anything');
    const result = checkNoProvenanceAtomLeak({ answer: `Background: ${provenanceAtom.text}. That is why it exists.` }, pkg);
    assert.equal(result.ok, false);
  });

  await t('checkNoProvenanceAtomLeak: passes for a genuine, natural "why" explanation that never quotes the citation text', () => {
    const pkg = buildEvidencePackage('What is QMZ?', ctx);
    const result = checkNoProvenanceAtomLeak({ answer: 'It exists because manually sorting large events was tedious and error-prone, so this workspace was built to make that process faster and more reliable.' }, pkg);
    assert.equal(result.ok, true);
  });

  summarize('evidenceAtoms.test.js');
}

main();
