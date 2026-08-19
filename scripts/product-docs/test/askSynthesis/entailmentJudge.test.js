#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/askSynthesis/entailmentJudge.test.js
// Capability Entailment Judge Prototype (checkpoint authorized 2026-08-18) --
// locks in the deterministic pieces: claim normalization, bounded evidence
// package construction, and the authority/safety-fallback contract. Does
// NOT test real model inference (that's the bench/ benchmark, run manually
// against real local models -- not part of the automated suite).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const build = require('../../lib/build');
const { buildEngineContext, answerQuestion } = require('../../lib/knowledgeEngine');
const { normalizeClaim } = require('../../lib/askSynthesis/claimNormalization');
const { buildEntailmentEvidencePackage } = require('../../lib/askSynthesis/entailmentEvidencePackage');
const { resolveEntailmentAuthority } = require('../../lib/askSynthesis/entailmentAuthority');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  await t('claim normalization: "Does AutoIngest support X" preserves X verbatim, never paraphrases', () => {
    const r = normalizeClaim('Does AutoIngest support blockchain-verified chain-of-custody signing for archived photos?');
    assert.equal(r.method, 'deterministic');
    assert.equal(r.claim, 'AutoIngest supports blockchain-verified chain-of-custody signing for archived photos');
  });

  await t('claim normalization: unmatched templates are disclosed as "unmatched", never silently guessed', () => {
    const r = normalizeClaim('Will there be a conflict warning if two people import at once?');
    assert.equal(r.method, 'unmatched');
    assert.equal(r.claim, null);
  });

  await t('bounded evidence package never includes unrelated retrieved records at "summary" level', () => {
    const q = 'Does AutoIngest offer cloud backup?';
    const { claim } = normalizeClaim(q);
    const answer = answerQuestion(q, ctx);
    const { pkg } = buildEntailmentEvidencePackage(q, claim, answer, ctx, { level: 'summary' });
    const ids = new Set(pkg.evidence.map((e) => e.id));
    assert.ok(ids.size <= 1, 'summary-level package must be scoped to the primary record only');
  });

  await t('curated boundary is surfaced in the package and always wins the authority contract, unconditionally', () => {
    const q = 'Can AutoIngest recognize faces?';
    const { claim } = normalizeClaim(q);
    const answer = answerQuestion(q, ctx);
    const { pkg } = buildEntailmentEvidencePackage(q, claim, answer, ctx, { level: 'summary+body' });
    assert.ok(pkg.curatedBoundary, 'face-recognition boundary must be surfaced');
    const authority = resolveEntailmentAuthority({ curatedBoundary: pkg.curatedBoundary, judgeResult: { judgment: 'SUPPORTS', evidenceHandles: ['S1'], confidence: 'HIGH' }, judgeError: null, handleMap: { idByHandle: new Map() } });
    assert.equal(authority.finalStatus, 'NOT_SUPPORTED', 'curated boundary must override even a confident SUPPORTS judgment');
    assert.equal(authority.authoritySource, 'curated-boundary');
  });

  await t('safety contract: model failure/timeout falls back to UNKNOWN, never AVAILABLE', () => {
    const authority = resolveEntailmentAuthority({ curatedBoundary: null, judgeResult: null, judgeError: 'timeout', handleMap: { idByHandle: new Map() } });
    assert.equal(authority.finalStatus, 'UNKNOWN');
  });

  await t('safety contract: SUPPORTS with an invalid/fabricated handle falls back to UNKNOWN', () => {
    const handleMap = { idByHandle: new Map([['S1', 'AI-FEAT-001']]) };
    const authority = resolveEntailmentAuthority({ curatedBoundary: null, judgeResult: { judgment: 'SUPPORTS', evidenceHandles: ['S99'], confidence: 'HIGH' }, judgeError: null, handleMap });
    assert.equal(authority.finalStatus, 'UNKNOWN');
    assert.equal(authority.authoritySource, 'invalid-handle-fallback');
  });

  await t('safety contract: SUPPORTS with zero cited evidence handles falls back to UNKNOWN, never a bare affirmation', () => {
    const handleMap = { idByHandle: new Map([['S1', 'AI-FEAT-001']]) };
    const authority = resolveEntailmentAuthority({ curatedBoundary: null, judgeResult: { judgment: 'SUPPORTS', evidenceHandles: [], confidence: 'HIGH' }, judgeError: null, handleMap });
    assert.equal(authority.finalStatus, 'UNKNOWN');
  });

  await t('safety contract: LOW-confidence SUPPORTS is treated as insufficient, never AVAILABLE', () => {
    const handleMap = { idByHandle: new Map([['S1', 'AI-FEAT-001']]) };
    const authority = resolveEntailmentAuthority({ curatedBoundary: null, judgeResult: { judgment: 'SUPPORTS', evidenceHandles: ['S1'], confidence: 'LOW' }, judgeError: null, handleMap });
    assert.equal(authority.finalStatus, 'UNKNOWN');
  });

  await t('safety contract: CONTRADICTS without a curated boundary is NOT auto-converted to NOT_SUPPORTED -- treated as insufficient, per explicit instruction', () => {
    const handleMap = { idByHandle: new Map([['S1', 'AI-FEAT-001']]) };
    const authority = resolveEntailmentAuthority({ curatedBoundary: null, judgeResult: { judgment: 'CONTRADICTS', evidenceHandles: ['S1'], confidence: 'HIGH' }, judgeError: null, handleMap });
    assert.equal(authority.finalStatus, 'UNKNOWN', 'an unconfirmed model-asserted negative must not become an authoritative NOT_SUPPORTED');
  });

  await t('safety contract: a genuine HIGH-confidence, properly-cited SUPPORTS is the only path to AVAILABLE', () => {
    const handleMap = { idByHandle: new Map([['S1', 'AI-FEAT-001']]) };
    const authority = resolveEntailmentAuthority({ curatedBoundary: null, judgeResult: { judgment: 'SUPPORTS', evidenceHandles: ['S1'], confidence: 'HIGH' }, judgeError: null, handleMap });
    assert.equal(authority.finalStatus, 'AVAILABLE');
    assert.equal(authority.authoritySource, 'judge-supports');
  });

  summarize('askSynthesis/entailmentJudge.test.js');
}

main();
