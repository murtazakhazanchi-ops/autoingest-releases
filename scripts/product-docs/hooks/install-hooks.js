#!/usr/bin/env node
'use strict';

// Installs Part 5's version-controlled hooks into .git/hooks/ by writing a
// small dispatcher (not a copy — edits to scripts/product-docs/hooks/*
// take effect immediately without reinstalling). Idempotent: running
// install twice produces the same result. Chains any pre-existing hook —
// never silently discards it (this repository's post-commit/post-checkout
// hooks were installed by `graphify hook install`; those must keep
// running). No network access. Never installed automatically by any
// other Part 5 command — this is the one explicit, human-approved step.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MARKER_START = '# autoingest-docs-hook-start';
const MARKER_END = '# autoingest-docs-hook-end';
const HOOK_NAMES = ['pre-commit', 'post-commit', 'pre-push'];

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function gitHooksDir() {
  return execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { encoding: 'utf8' }).trim();
}

function managedBlock(root, name) {
  const scriptPath = path.join(root, 'scripts', 'product-docs', 'hooks', name);
  return [
    MARKER_START,
    '# Do not edit this block by hand — regenerate with',
    '# `node scripts/product-docs/cli.js automation install-hooks`.',
    `"${scriptPath}" "$@" || exit $?`,
    MARKER_END,
  ].join('\n');
}

function chainedBackupPath(hooksDir, name) {
  return path.join(hooksDir, `${name}.autoingest-docs-chained`);
}

function isOurs(content) {
  return content.includes(MARKER_START);
}

function installOne(root, hooksDir, name) {
  const target = path.join(hooksDir, name);
  const backup = chainedBackupPath(hooksDir, name);
  const block = managedBlock(root, name);

  let existing = null;
  if (fs.existsSync(target)) existing = fs.readFileSync(target, 'utf8');

  if (existing && !isOurs(existing)) {
    // A hook we didn't install is present (e.g. graphify's post-commit).
    // Preserve it verbatim as a chained backup, unless we already did.
    if (!fs.existsSync(backup)) {
      fs.writeFileSync(backup, existing);
      fs.chmodSync(backup, 0o755);
    }
  }

  const chainCall = fs.existsSync(backup)
    ? `if [ -x "${backup}" ]; then "${backup}" "$@" || exit $?; fi\n`
    : '';

  const newContent = `#!/bin/sh\n${chainCall}${block}\n`;
  fs.writeFileSync(target, newContent);
  fs.chmodSync(target, 0o755);
  return { name, chained: fs.existsSync(backup), wasOurs: !!existing && isOurs(existing) };
}

function install() {
  const root = repoRoot();
  const hooksDir = gitHooksDir();
  fs.mkdirSync(hooksDir, { recursive: true });
  return HOOK_NAMES.map((name) => installOne(root, hooksDir, name));
}

function uninstallOne(hooksDir, name) {
  const target = path.join(hooksDir, name);
  const backup = chainedBackupPath(hooksDir, name);
  if (!fs.existsSync(target)) return { name, removed: false };
  const content = fs.readFileSync(target, 'utf8');
  if (!isOurs(content)) return { name, removed: false, note: 'not ours — left untouched' };
  if (fs.existsSync(backup)) {
    fs.copyFileSync(backup, target);
    fs.chmodSync(target, 0o755);
    fs.unlinkSync(backup);
    return { name, removed: true, restoredOriginal: true };
  }
  fs.unlinkSync(target);
  return { name, removed: true, restoredOriginal: false };
}

function uninstall() {
  const hooksDir = gitHooksDir();
  return HOOK_NAMES.map((name) => uninstallOne(hooksDir, name));
}

function verify() {
  const hooksDir = gitHooksDir();
  return HOOK_NAMES.map((name) => {
    const target = path.join(hooksDir, name);
    if (!fs.existsSync(target)) return { name, installed: false };
    const content = fs.readFileSync(target, 'utf8');
    const stat = fs.statSync(target);
    const executable = !!(stat.mode & 0o111);
    return { name, installed: isOurs(content), executable, chained: fs.existsSync(chainedBackupPath(hooksDir, name)) };
  });
}

// Non-mutating preview of what `install()` would do — no file is written or
// chmod'd. Part 7A's "hook-installation readiness report and dry-run"
// requirement: an operator (or the harness that would otherwise install
// automatically) can inspect exactly what would change before approving it.
function readiness() {
  const root = repoRoot();
  const hooksDir = gitHooksDir();
  let hooksDirWritable = true;
  try {
    fs.accessSync(hooksDir, fs.constants.W_OK);
  } catch {
    hooksDirWritable = false;
  }
  const perHook = HOOK_NAMES.map((name) => {
    const target = path.join(hooksDir, name);
    const backup = chainedBackupPath(hooksDir, name);
    const exists = fs.existsSync(target);
    const existingContent = exists ? fs.readFileSync(target, 'utf8') : null;
    const alreadyOurs = exists && isOurs(existingContent);
    const foreignHookPresent = exists && !alreadyOurs;
    return {
      name,
      target,
      currently_installed_by_us: alreadyOurs,
      foreign_hook_present: foreignHookPresent,
      would_chain_existing_hook: foreignHookPresent && !fs.existsSync(backup),
      already_chained: fs.existsSync(backup),
      preview: managedBlock(root, name),
    };
  });
  return {
    repo_root: root,
    hooks_dir: hooksDir,
    hooks_dir_writable: hooksDirWritable,
    node_executable: process.execPath,
    hooks: perHook,
    would_mutate: perHook.filter((h) => !h.currently_installed_by_us || h.would_chain_existing_hook).map((h) => h.name),
    note: 'Dry-run only — no files were written. Run "automation install-hooks" (without --dry-run) to apply.',
  };
}

module.exports = { install, uninstall, verify, readiness, HOOK_NAMES, MARKER_START, MARKER_END };

if (require.main === module) {
  const cmd = process.argv[2] || 'install';
  const fn = { install, uninstall, verify, readiness }[cmd];
  if (!fn) {
    console.error(`Usage: install-hooks.js <install|uninstall|verify|readiness>`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(fn(), null, 2));
  }
}
