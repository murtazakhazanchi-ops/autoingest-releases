#!/usr/bin/env node
'use strict';
// Run with: node scripts/product-docs/test/askKnowledge/leakBoundary.test.js
// Ask AutoIngest — Stage 2, Section 23. Unit tests for
// lib/askKnowledge/leakBoundary.js (Sections 8 + 20: internal-reference
// resolution and the presentation-safe leak boundary).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const {
  sanitizeTechnicalDetail, resolveThenSanitize, titleForFeatureId,
  containsUnresolvedInternalReference,
} = require('../../lib/askKnowledge/leakBoundary');

async function main() {
  const { t, summarize } = createRunner();

  await t('sanitizeTechnicalDetail redacts a source file path with line range', () => {
    const out = sanitizeTechnicalDetail('See services/transferExportService.js:31-34 for detail.');
    assert.ok(!out.includes('services/transferExportService.js'));
  });

  await t('sanitizeTechnicalDetail redacts a bare function call', () => {
    const out = sanitizeTechnicalDetail('Calls resumeExportFromCheckpoint() internally.');
    assert.ok(!out.includes('resumeExportFromCheckpoint()'));
  });

  await t('sanitizeTechnicalDetail redacts a governance id (DEC/BUG/PM/KM/AI-FEAT/AI-WF) anywhere in prose', () => {
    const out = sanitizeTechnicalDetail('Per DEC-013 and BUG-004, see AI-FEAT-045 and KM-archive-lock-handling.');
    assert.ok(!/\b(?:DEC|BUG|PM|KM|AI-FEAT|AI-WF)-[A-Za-z0-9-]+\b/.test(out));
  });

  await t('sanitizeTechnicalDetail passes through ordinary prose unchanged in substance', () => {
    const out = sanitizeTechnicalDetail('This feature helps operators organize their imports.');
    assert.equal(out, 'This feature helps operators organize their imports.');
  });

  await t('sanitizeTechnicalDetail is a safe no-op on empty/falsy input', () => {
    assert.equal(sanitizeTechnicalDetail(''), '');
    assert.equal(sanitizeTechnicalDetail(null), null);
    assert.equal(sanitizeTechnicalDetail(undefined), undefined);
  });

  await t('resolveThenSanitize resolves a real AI-FEAT-### reference to its title, not a raw id', () => {
    const out = resolveThenSanitize('See AI-FEAT-011 for detail.');
    assert.ok(!out.includes('AI-FEAT-011'));
    assert.match(out, /Source Detection/);
  });

  await t('resolveThenSanitize resolves a backtick-quoted AI-FEAT-### reference too', () => {
    const out = resolveThenSanitize('See `AI-FEAT-011` for detail.');
    assert.ok(!out.includes('AI-FEAT-011'));
    assert.match(out, /Source Detection/);
  });

  await t('resolveThenSanitize strips a fenced code block wholesale', () => {
    const out = resolveThenSanitize('Run this:\n```\ngit diff --stat\n```\nthen check.');
    assert.ok(!out.includes('git diff'));
    assert.ok(!out.includes('```'));
  });

  await t('resolveThenSanitize strips a dangling/unterminated fence marker', () => {
    const out = resolveThenSanitize('Some text ``` with no close.');
    assert.ok(!out.includes('```'));
  });

  await t('resolveThenSanitize strips any remaining backtick span after resolution (multi-token expressions, leading-digit tokens)', () => {
    const out = resolveThenSanitize('Guarded by `_syncingJobIds.size === 0` and commit `659788b`.');
    assert.ok(!out.includes('`'));
    assert.ok(!out.includes('_syncingJobIds'));
    assert.ok(!out.includes('659788b'));
  });

  await t('resolveThenSanitize never throws on malformed/garbled source text', () => {
    assert.doesNotThrow(() => resolveThenSanitize('`unpaired backtick with no close'));
    assert.doesNotThrow(() => resolveThenSanitize('`a`b`c`d`e`'));
  });

  await t('resolveThenSanitize is a safe no-op on empty/non-string input', () => {
    assert.equal(resolveThenSanitize(''), '');
    assert.equal(resolveThenSanitize(null), null);
    assert.equal(resolveThenSanitize(undefined), undefined);
    assert.equal(resolveThenSanitize(42), 42);
  });

  await t('resolveThenSanitize collapses whitespace/orphaned punctuation left behind by redaction', () => {
    const out = resolveThenSanitize('A value (`x`) between two spans.');
    assert.ok(!/\(\s*\)/.test(out));
  });

  await t('titleForFeatureId resolves a real feature id to its title, and returns null for an unknown id', () => {
    assert.equal(titleForFeatureId('AI-FEAT-011'), 'Source Detection (Drives, DCIM, Sony PRIVATE)');
    assert.equal(titleForFeatureId('AI-FEAT-999999'), null);
  });

  await t('containsUnresolvedInternalReference detects a raw governance id or leftover backtick', () => {
    assert.equal(containsUnresolvedInternalReference('See DEC-013 for detail.'), true);
    assert.equal(containsUnresolvedInternalReference('See `code` here.'), true);
    assert.equal(containsUnresolvedInternalReference('Ordinary clean prose.'), false);
  });

  await t('containsUnresolvedInternalReference is false for clean, already-sanitized text', () => {
    const clean = resolveThenSanitize('See AI-FEAT-011 and DEC-013 for detail.');
    assert.equal(containsUnresolvedInternalReference(clean), false);
  });

  await t('deterministic: repeated calls on the same input produce identical output', () => {
    const input = 'See AI-FEAT-011 and `some_function()` per DEC-013.';
    assert.equal(resolveThenSanitize(input), resolveThenSanitize(input));
  });

  summarize('askKnowledge/leakBoundary.test.js');
}

main();
