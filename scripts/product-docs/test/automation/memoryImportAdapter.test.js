#!/usr/bin/env node
'use strict';

// Tests automation/memory/importAdapter.js's tool-neutral import path:
// format rejection (Scenario F in the Part 6 brief), path traversal
// rejection, oversized-file rejection, and malformed-JSON rejection. Writes
// only under .autoingest-docs/ (gitignored scratch) and a temp source file
// outside the tracked tree.
// Run with: node scripts/product-docs/test/automation/memoryImportAdapter.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRunner } = require('../testHarness');
const importAdapter = require('../../automation/memory/importAdapter');
const { IMPORTS_DIR } = require('../../automation/memory/paths');
const { REPO_ROOT } = require('../../automation/paths');

const SCRATCH_SOURCE_DIR = path.join(REPO_ROOT, '.autoingest-docs', 'test-scratch', 'memory-import-sources');

function writeSource(name, content) {
  fs.mkdirSync(SCRATCH_SOURCE_DIR, { recursive: true });
  const p = path.join(SCRATCH_SOURCE_DIR, name);
  fs.writeFileSync(p, content);
  return p;
}

function cleanup() {
  fs.rmSync(SCRATCH_SOURCE_DIR, { recursive: true, force: true });
  fs.rmSync(IMPORTS_DIR, { recursive: true, force: true });
}

async function main() {
  const { t, summarize } = createRunner();
  cleanup();

  await t('an unsupported format is rejected outright, never guess-parsed', () => {
    const p = writeSource('a.txt', 'some content');
    assert.throws(() => importAdapter.importFile('yaml', p), /Unsupported import format/);
  });

  await t('a valid Markdown import is accepted and written to the gitignored imports tier', () => {
    const p = writeSource('session.md', '# Session summary\n\nWe decided X because Y.');
    const result = importAdapter.importFile('markdown', p);
    assert.ok(fs.existsSync(result.destPath));
    const stored = JSON.parse(fs.readFileSync(result.destPath, 'utf8'));
    assert.equal(stored.format, 'markdown');
    assert.match(stored.content.summary, /Session summary/);
  });

  await t('a valid JSON import matching the minimal schema is accepted', () => {
    const p = writeSource('session.json', JSON.stringify({ summary: 'a structured summary', events: [] }));
    const result = importAdapter.importFile('json', p);
    assert.ok(fs.existsSync(result.destPath));
  });

  await t('a JSON import with neither "summary" nor "events" fails schema validation', () => {
    const p = writeSource('bad.json', JSON.stringify({ unrelated_field: true }));
    assert.throws(() => importAdapter.importFile('json', p), /schema validation/);
  });

  await t('malformed JSON is rejected with a clear parse error, not a crash', () => {
    const p = writeSource('malformed.json', '{ this is not json');
    assert.throws(() => importAdapter.importFile('json', p), /not valid JSON/);
  });

  await t('an empty Markdown file is rejected', () => {
    const p = writeSource('empty.md', '   \n  ');
    assert.throws(() => importAdapter.importFile('markdown', p), /empty/);
  });

  await t('a nonexistent file is rejected with a clear "not found" error', () => {
    assert.throws(() => importAdapter.importFile('markdown', path.join(SCRATCH_SOURCE_DIR, 'does-not-exist.md')), /not found/);
  });

  await t('a path outside the repository root is refused (no directory-traversal import)', () => {
    const outside = path.join(os.tmpdir(), `memory-import-outside-${Date.now()}.md`);
    fs.writeFileSync(outside, '# outside the repo');
    try {
      assert.throws(() => importAdapter.importFile('markdown', outside), /outside the repository/);
    } finally {
      fs.unlinkSync(outside);
    }
  });

  await t('a symlink physically inside the repo pointing OUTSIDE it is refused (regression: lexical path check alone is insufficient)', () => {
    const outsideTarget = path.join(os.tmpdir(), `memory-import-symlink-target-${Date.now()}.md`);
    fs.writeFileSync(outsideTarget, '# secret content outside the repo');
    const symlinkPath = path.join(SCRATCH_SOURCE_DIR, 'escape-link.md');
    fs.symlinkSync(outsideTarget, symlinkPath);
    try {
      assert.throws(() => importAdapter.importFile('markdown', symlinkPath), /outside the repository/);
    } finally {
      fs.unlinkSync(symlinkPath);
      fs.unlinkSync(outsideTarget);
    }
  });

  await t('an oversized file is rejected before being read into memory in full', () => {
    const big = 'x'.repeat(importAdapter.MAX_IMPORT_BYTES + 1024);
    const p = writeSource('big.md', big);
    assert.throws(() => importAdapter.importFile('markdown', p), /exceeds the .*-byte cap/);
  });

  cleanup();
  summarize('memoryImportAdapter.test.js');
}

main();
