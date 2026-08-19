#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/askSynthesis/safetyValidation.test.js
// Ask AutoIngest Phase A.2 -- locks in every deterministic post-hoc safety
// check, now operating on the opaque-handle model (Track 2.A): the model
// never sees a raw ID, only handles ("S1".."SN"); validateSynthesis()
// resolves handles back to real IDs via the same handleMap sourceHandles.js
// builds for the real prompt, then re-runs the identical content checks
// Phase A already had, plus the new historicalNote schema-omission check and
// the separately-tracked handle-leak-in-prose check (Track 2.B).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { validateSynthesis, checkSourceIdsExist } = require('../../lib/askSynthesis/safetyValidation');

function sampleHandleMap() {
  return {
    idByHandle: new Map([['S1', 'AI-WF-001'], ['S2', 'AI-FEAT-011'], ['S3', 'AI-FEAT-012']]),
    handleById: new Map([['AI-WF-001', 'S1'], ['AI-FEAT-011', 'S2'], ['AI-FEAT-012', 'S3']]),
    displayNameByHandle: new Map([['S1', 'Import Photographs'], ['S2', 'Source Detection'], ['S3', 'Source Selection']]),
    validHandles: ['S1', 'S2', 'S3'],
  };
}

function samplePackage(overrides) {
  return {
    capabilityStatus: 'AVAILABLE',
    legitimateSourceIds: ['AI-WF-001', 'AI-FEAT-011', 'AI-FEAT-012'],
    historical: { admitted: [] },
    ...overrides,
  };
}

async function main() {
  const { t, summarize } = createRunner();

  await t('a fully valid handle-based candidate passes every check', () => {
    const pkg = samplePackage({});
    const hm = sampleHandleMap();
    const candidate = {
      answer: 'Yes, this is supported.',
      capabilityStatus: 'AVAILABLE',
      steps: [{ text: 'Connect your source.', sourceIds: ['S1'] }],
      warnings: [{ text: 'Duplicate files are skipped.', sourceIds: ['S2'] }],
      sourceIds: ['S1', 'S2'],
    };
    const result = validateSynthesis(candidate, pkg, hm);
    assert.equal(result.ok, true, JSON.stringify(result.details));
  });

  await t('rejects a handle not present in the valid handle set (would-be fabrication)', () => {
    const pkg = samplePackage({});
    const hm = sampleHandleMap();
    const candidate = { answer: 'Yes.', capabilityStatus: 'AVAILABLE', sourceIds: ['S99'] };
    const result = validateSynthesis(candidate, pkg, hm);
    assert.equal(result.ok, false);
    assert.ok(result.failedChecks.includes('handlesExist'));
    assert.equal(result.details.handlesExist.invalidReferences[0].handle, 'S99');
  });

  await t('checkSourceIdsExist operates directly on the handleMap (Phase A.2 signature)', () => {
    const hm = sampleHandleMap();
    const good = checkSourceIdsExist({ sourceIds: ['S1'] }, hm);
    assert.equal(good.ok, true);
    const bad = checkSourceIdsExist({ sourceIds: ['S1', 'S404'] }, hm);
    assert.equal(bad.ok, false);
    assert.equal(bad.invalidReferences[0].handle, 'S404');
  });

  await t('rejects an uncited procedural step (resolved via the real handle map)', () => {
    const pkg = samplePackage({});
    const hm = sampleHandleMap();
    const candidate = {
      answer: 'Yes.',
      capabilityStatus: 'AVAILABLE',
      steps: [{ text: 'Click the secret admin button.', sourceIds: [] }],
    };
    const result = validateSynthesis(candidate, pkg, hm);
    assert.equal(result.ok, false);
    assert.ok(result.failedChecks.includes('everyClaimCited'));
  });

  await t('rejects a capabilityStatus that does not match the deterministic engine exactly', () => {
    const pkg = samplePackage({ capabilityStatus: 'NOT_SUPPORTED' });
    const hm = sampleHandleMap();
    const candidate = { answer: 'Yes actually it is supported.', capabilityStatus: 'AVAILABLE', sourceIds: [] };
    const result = validateSynthesis(candidate, pkg, hm);
    assert.equal(result.ok, false);
    assert.ok(result.failedChecks.includes('capabilityStatusMatches'));
  });

  await t('rejects a raw internal ID leaking into prose -- now a stronger signal since the model never sees one', () => {
    const pkg = samplePackage({});
    const hm = sampleHandleMap();
    const candidate = { answer: 'See AI-WF-001 for details.', capabilityStatus: 'AVAILABLE', sourceIds: ['S1'] };
    const result = validateSynthesis(candidate, pkg, hm);
    assert.equal(result.ok, false);
    assert.ok(result.failedChecks.includes('noIdLeakInProse'));
  });

  await t('rejects a handle leaking into prose, tracked SEPARATELY from ID leakage', () => {
    const pkg = samplePackage({});
    const hm = sampleHandleMap();
    const candidate = { answer: 'See S1 for details.', capabilityStatus: 'AVAILABLE', sourceIds: ['S1'] };
    const result = validateSynthesis(candidate, pkg, hm);
    assert.equal(result.ok, false);
    assert.ok(result.failedChecks.includes('noHandleLeakInProse'));
    assert.ok(!result.failedChecks.includes('noIdLeakInProse'), 'a handle leak must never be double-counted as an ID leak');
  });

  await t('rejects a historicalNote when the evidence package admitted zero historical context', () => {
    const pkg = samplePackage({ historical: { admitted: [] } });
    const hm = sampleHandleMap();
    const candidate = { answer: 'Yes.', capabilityStatus: 'AVAILABLE', sourceIds: [], historicalNote: 'This changed over time because...' };
    const result = validateSynthesis(candidate, pkg, hm);
    assert.equal(result.ok, false);
    assert.ok(result.failedChecks.includes('historicalGrounded'));
  });

  await t('accepts a historicalNote when the evidence package genuinely admitted historical context', () => {
    const pkg = samplePackage({ historical: { admitted: [{ id: 'AI-MEM-0004' }] } });
    const hm = sampleHandleMap();
    const candidate = { answer: 'Yes.', capabilityStatus: 'AVAILABLE', sourceIds: [], historicalNote: 'This changed over time because...' };
    const result = validateSynthesis(candidate, pkg, hm);
    assert.equal(result.ok, true, JSON.stringify(result.details));
  });

  await t('malformed shape (missing answer) is rejected before any other check runs', () => {
    const pkg = samplePackage({});
    const hm = sampleHandleMap();
    const candidate = { capabilityStatus: 'AVAILABLE' };
    const result = validateSynthesis(candidate, pkg, hm);
    assert.equal(result.ok, false);
    assert.deepEqual(result.failedChecks, ['schemaShape']);
  });

  await t('a leak check does not false-positive on an ordinary word that merely contains digits (regression guard for the ID-shape regex)', () => {
    const pkg = samplePackage({});
    const hm = sampleHandleMap();
    const candidate = { answer: 'This works in AutoIngest version 24 without issue.', capabilityStatus: 'AVAILABLE', sourceIds: [] };
    const result = validateSynthesis(candidate, pkg, hm);
    assert.equal(result.ok, true, JSON.stringify(result.details));
  });

  summarize('askSynthesis/safetyValidation.test.js');
}

main();
