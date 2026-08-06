#!/usr/bin/env node
'use strict';

// Tests the hook installer against a disposable plain git repo (no
// docs/product/ fixture needed — install-hooks.js only touches .git/hooks/
// and scripts/product-docs/hooks/*). Never touches the real repository's
// .git/hooks/ — see the module comment in install-hooks.js: installation is
// never invoked automatically by any other Part 5 command.
// Run with: node scripts/product-docs/test/automation/installHooks.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRunner } = require('../testHarness');

const REAL_HOOKS_DIR = path.join(__dirname, '..', '..', 'hooks');

function makeBareRepoWithHooksCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoingest-docs-hooks-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const targetHooksSrc = path.join(dir, 'scripts', 'product-docs', 'hooks');
  fs.mkdirSync(targetHooksSrc, { recursive: true });
  for (const name of ['pre-commit', 'post-commit', 'pre-push', 'install-hooks.js']) {
    fs.copyFileSync(path.join(REAL_HOOKS_DIR, name), path.join(targetHooksSrc, name));
    fs.chmodSync(path.join(targetHooksSrc, name), fs.statSync(path.join(REAL_HOOKS_DIR, name)).mode);
  }
  return dir;
}

function loadInstaller(dir) {
  const modPath = path.join(dir, 'scripts', 'product-docs', 'hooks', 'install-hooks.js');
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

async function main() {
  const { t, summarize } = createRunner();
  const cleanupDirs = [];

  await t('install writes a managed dispatcher into .git/hooks/ for all three hooks', () => {
    const dir = makeBareRepoWithHooksCopy();
    cleanupDirs.push(dir);
    const installer = loadInstaller(dir);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const results = installer.install();
      assert.equal(results.length, 3);
      for (const r of results) {
        const target = path.join(dir, '.git', 'hooks', r.name);
        assert.ok(fs.existsSync(target));
        const content = fs.readFileSync(target, 'utf8');
        assert.ok(content.includes(installer.MARKER_START));
        assert.ok(fs.statSync(target).mode & 0o111, 'installed hook must be executable');
      }
    } finally {
      process.chdir(cwd);
    }
  });

  await t('install preserves a pre-existing (non-ours) hook by chaining it, never discarding it', () => {
    const dir = makeBareRepoWithHooksCopy();
    cleanupDirs.push(dir);
    const preExisting = '#!/bin/sh\necho "pre-existing hook ran" > "$(dirname "$0")/../../preexisting-ran.txt"\nexit 0\n';
    fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'hooks', 'post-commit'), preExisting);
    fs.chmodSync(path.join(dir, '.git', 'hooks', 'post-commit'), 0o755);

    const installer = loadInstaller(dir);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const results = installer.install();
      const postCommitResult = results.find((r) => r.name === 'post-commit');
      assert.equal(postCommitResult.chained, true);
      const backupPath = path.join(dir, '.git', 'hooks', 'post-commit.autoingest-docs-chained');
      assert.ok(fs.existsSync(backupPath));
      assert.equal(fs.readFileSync(backupPath, 'utf8'), preExisting);
      const newContent = fs.readFileSync(path.join(dir, '.git', 'hooks', 'post-commit'), 'utf8');
      assert.ok(newContent.includes('post-commit.autoingest-docs-chained'), 'new dispatcher must call the preserved original');
    } finally {
      process.chdir(cwd);
    }
  });

  await t('install is idempotent — running it twice does not double-chain or corrupt the hook', () => {
    const dir = makeBareRepoWithHooksCopy();
    cleanupDirs.push(dir);
    const installer = loadInstaller(dir);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      installer.install();
      const firstContent = fs.readFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 'utf8');
      installer.install();
      const secondContent = fs.readFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 'utf8');
      assert.equal(firstContent, secondContent, 'a second install must produce byte-identical output');
    } finally {
      process.chdir(cwd);
    }
  });

  await t('verify-hooks reports installed:true and executable:true after install, false before', () => {
    const dir = makeBareRepoWithHooksCopy();
    cleanupDirs.push(dir);
    const installer = loadInstaller(dir);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      let statuses = installer.verify();
      assert.ok(statuses.every((s) => s.installed === false));
      installer.install();
      statuses = installer.verify();
      assert.ok(statuses.every((s) => s.installed === true && s.executable === true));
    } finally {
      process.chdir(cwd);
    }
  });

  await t('uninstall restores the original chained hook exactly and removes the backup', () => {
    const dir = makeBareRepoWithHooksCopy();
    cleanupDirs.push(dir);
    const preExisting = '#!/bin/sh\necho original\n';
    fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-push'), preExisting);
    fs.chmodSync(path.join(dir, '.git', 'hooks', 'pre-push'), 0o755);

    const installer = loadInstaller(dir);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      installer.install();
      const uninstallResults = installer.uninstall();
      const prePush = uninstallResults.find((r) => r.name === 'pre-push');
      assert.equal(prePush.removed, true);
      assert.equal(prePush.restoredOriginal, true);
      assert.equal(fs.readFileSync(path.join(dir, '.git', 'hooks', 'pre-push'), 'utf8'), preExisting);
      assert.ok(!fs.existsSync(path.join(dir, '.git', 'hooks', 'pre-push.autoingest-docs-chained')));
    } finally {
      process.chdir(cwd);
    }
  });

  await t('uninstall removes a hook it installed fresh (no prior original) entirely', () => {
    const dir = makeBareRepoWithHooksCopy();
    cleanupDirs.push(dir);
    const installer = loadInstaller(dir);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      installer.install();
      installer.uninstall();
      assert.ok(!fs.existsSync(path.join(dir, '.git', 'hooks', 'pre-commit')));
    } finally {
      process.chdir(cwd);
    }
  });

  await t('uninstall never touches a hook it did not install (not ours)', () => {
    const dir = makeBareRepoWithHooksCopy();
    cleanupDirs.push(dir);
    const foreignHook = '#!/bin/sh\necho "not ours"\n';
    fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), foreignHook);
    const installer = loadInstaller(dir);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const results = installer.uninstall();
      const preCommit = results.find((r) => r.name === 'pre-commit');
      assert.equal(preCommit.removed, false);
      assert.equal(fs.readFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 'utf8'), foreignHook);
    } finally {
      process.chdir(cwd);
    }
  });

  summarize('installHooks.test.js');
  for (const dir of cleanupDirs) fs.rmSync(dir, { recursive: true, force: true });
}

main();
