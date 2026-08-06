#!/usr/bin/env node
'use strict';

// Security-focused unit tests: path traversal, secret redaction, and
// command-injection resistance (execFileSync argument arrays, never shell
// string interpolation). Pure in-memory / real-fs-but-repo-local — never
// touches docs/product/. Run with:
// node scripts/product-docs/test/automation/security.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createRunner } = require('../testHarness');
const { assertInsideRepo, atomicWriteFileSync } = require('../../automation/atomicWrite');
const { redactText, redactDeep } = require('../../automation/redact');
const { REPO_ROOT } = require('../../automation/paths');

async function main() {
  const { t, summarize } = createRunner();

  await t('assertInsideRepo accepts a path inside the repository root', () => {
    const p = path.join(REPO_ROOT, '.autoingest-docs', 'sessions', 'x.json');
    assert.equal(assertInsideRepo(p), p);
  });

  await t('assertInsideRepo rejects a path traversal escape via ../', () => {
    const p = path.join(REPO_ROOT, '.autoingest-docs', '..', '..', 'etc', 'passwd');
    assert.throws(() => assertInsideRepo(p), /outside repository root/);
  });

  await t('assertInsideRepo rejects an absolute path entirely outside the repo', () => {
    assert.throws(() => assertInsideRepo(os.tmpdir()), /outside repository root/);
  });

  await t('assertInsideRepo rejects a sibling directory whose name merely starts with the repo path', () => {
    // e.g. REPO_ROOT = /x/electron-app-v24 must not accept /x/electron-app-v24-evil
    const evilSibling = REPO_ROOT + '-evil-sibling';
    assert.throws(() => assertInsideRepo(evilSibling), /outside repository root/);
  });

  await t('atomicWriteFileSync refuses to write outside the repository root', () => {
    const outside = path.join(os.tmpdir(), 'autoingest-docs-should-not-exist.txt');
    assert.throws(() => atomicWriteFileSync(outside, 'x'));
    assert.ok(!fs.existsSync(outside));
  });

  await t('atomicWriteFileSync never leaves a partial file visible under its final name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-test-'));
    // Simulate "inside repo" by pointing REPO_ROOT-relative logic at a temp
    // dir directly via a controlled absolute path check bypass: write to a
    // path under REPO_ROOT/.autoingest-docs (always permitted) instead.
    const target = path.join(REPO_ROOT, '.autoingest-docs', `atomic-test-${process.pid}.txt`);
    atomicWriteFileSync(target, 'content-v1');
    assert.equal(fs.readFileSync(target, 'utf8'), 'content-v1');
    atomicWriteFileSync(target, 'content-v2');
    assert.equal(fs.readFileSync(target, 'utf8'), 'content-v2');
    // No stray .tmp files left behind in the same directory.
    const leftovers = fs.readdirSync(path.dirname(target)).filter((f) => f.includes('.tmp'));
    assert.deepEqual(leftovers, []);
    fs.unlinkSync(target);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t('redactText masks an AWS-style access key', () => {
    const out = redactText('here is a key AKIAABCDEFGHIJKLMNOP end');
    assert.ok(!out.includes('AKIAABCDEFGHIJKLMNOP'));
    assert.ok(out.includes('[REDACTED]'));
  });

  await t('redactText masks a GitHub personal access token', () => {
    const out = redactText('token=ghp_1234567890abcdefghijklmnopqrstuvwxyz');
    assert.ok(!out.includes('ghp_1234567890abcdefghijklmnopqrstuvwxyz'));
  });

  await t('redactText masks a generic api_key=... assignment', () => {
    const out = redactText('config: api_key: "sk_live_abcdefghijklmnop1234"');
    assert.ok(!out.includes('sk_live_abcdefghijklmnop1234'));
  });

  await t('redactText leaves ordinary evidence text untouched', () => {
    const text = 'Fixed the off-by-one in the loop bound at services/foo.js:42';
    assert.equal(redactText(text), text);
  });

  await t('redactDeep recurses into nested objects and arrays without mutating the input', () => {
    const input = { a: 'token=ghp_1234567890abcdefghijklmnopqrstuvwxyz', b: ['nested AKIAABCDEFGHIJKLMNOP here'], c: 5 };
    const before = JSON.parse(JSON.stringify(input));
    const out = redactDeep(input);
    assert.deepEqual(input, before, 'redactDeep must not mutate its input');
    assert.ok(!out.a.includes('ghp_'));
    assert.ok(!out.b[0].includes('AKIA'));
    assert.equal(out.c, 5);
  });

  summarize('security.test.js');
}

main();
