#!/usr/bin/env node
'use strict';

// Tests automation/memory/redactor.js's read-only secret scan (no filesystem
// I/O, no cleanup needed).
// Run with: node scripts/product-docs/test/automation/memoryRedactor.test.js
const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { scanForSecrets, redactCapsuleText } = require('../../automation/memory/redactor');

async function main() {
  const { t, summarize } = createRunner();

  await t('scanForSecrets flags an AWS-style access key', () => {
    assert.equal(scanForSecrets('the key is AKIAABCDEFGHIJKLMNOP embedded here').length, 1);
  });

  await t('scanForSecrets flags a GitHub personal access token', () => {
    assert.equal(scanForSecrets('token: ghp_1234567890abcdef1234567890abcdef1234').length, 1);
  });

  await t('scanForSecrets does not flag ordinary evidence prose', () => {
    assert.equal(scanForSecrets('commit `2c2090a` rebalanced the Audit & Repair tab into a flex layout').length, 0);
  });

  await t('scanForSecrets on empty/non-string input returns no findings', () => {
    assert.equal(scanForSecrets('').length, 0);
    assert.equal(scanForSecrets(undefined).length, 0);
  });

  await t('redactCapsuleText actually masks the matched span', () => {
    const out = redactCapsuleText('password="Sup3rSecretValue123"');
    assert.match(out, /\[REDACTED\]/);
    assert.doesNotMatch(out, /Sup3rSecretValue123/);
  });

  summarize('memoryRedactor.test.js');
}

main();
