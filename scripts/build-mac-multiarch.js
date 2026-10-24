#!/usr/bin/env node
'use strict';

// macOS Intel (x64) and Apple Silicon (arm64) builds both need the CORRECT per-architecture
// native binary for `sharp` and `@napi-rs/canvas` — but unlike `drivelist` (a node-gyp module
// electron-builder's own automatic per-target @electron/rebuild step already recompiles
// correctly for whichever single architecture it is packaging at that moment), sharp and
// @napi-rs/canvas ship as PREBUILT, platform-specific npm optionalDependencies, never
// recompiled by that rebuild step at all. A plain `npm install` on one host can only ever
// resolve ONE architecture's optional variant into node_modules — npm actively prunes the
// other on every install — so whichever variant the last plain `npm install` happened to
// resolve (the host's own architecture) is the ONLY one ever on disk to bundle.
//
// A naive "build arm64, reinstall, build x64" loop using `electron-builder --mac --arm64`
// then `--mac --x64` does NOT fix this: those CLI arch flags do not override package.json's
// own `build.mac.target[].arch` array (which still lists BOTH `x64` and `arm64`) — verified
// live, electron-builder still packages BOTH architectures on every single invocation
// regardless of the flag, so whichever reinstall happened most recently wins for BOTH output
// directories. The only reliable fix (confirmed the same way) is to make EACH pass's own
// on-disk config unambiguous: temporarily narrow `build.mac.target[].arch` to exactly one
// architecture in package.json itself before invoking electron-builder, restoring the
// original file afterward (including on failure) so the committed package.json is never
// left mutated.
//
// Any extra CLI arguments this script receives (e.g. `-p always
// -c.mac.forceCodeSigning=true`, as the release workflow passes) are forwarded identically
// to both electron-builder invocations — this file is a drop-in replacement for a plain
// `electron-builder --mac` call, not a new CLI surface.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');
const extraArgs = process.argv.slice(2);
const MAC_ARCHES = ['arm64', 'x64'];

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(' ')}\n`);
  execFileSync(cmd, args, { stdio: 'inherit' });
}

const originalPackageJsonText = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');

function writePackageJsonForArch(arch) {
  const pkg = JSON.parse(originalPackageJsonText);
  for (const target of pkg.build.mac.target) {
    target.arch = [arch];
  }
  fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + '\n');
}

function restorePackageJson() {
  fs.writeFileSync(PACKAGE_JSON_PATH, originalPackageJsonText);
}

try {
  for (const arch of MAC_ARCHES) {
    run('npm', ['install', '--no-save', `--cpu=${arch}`, '--os=darwin']);
    writePackageJsonForArch(arch);
    try {
      run('npx', ['electron-builder', '--mac', `--${arch}`, ...extraArgs]);
    } finally {
      restorePackageJson();
    }
  }
} finally {
  // Leave node_modules matching the real host architecture, not whichever arch built last —
  // both for the optional sharp/canvas packages (npm's own os/cpu resolution) AND for
  // node-gyp-style native modules like `drivelist`, which electron-builder's own internal
  // @electron/rebuild step (run automatically inside each `electron-builder --mac --<arch>`
  // pass above) leaves compiled for whichever architecture built LAST — x64, since it runs
  // second — breaking plain `npm start`/dev-mode Electron launches on an arm64 host until
  // explicitly rebuilt back. Caught live: every dev-mode Playwright test timed out waiting
  // for the app window after a `build:mac` run, traced to drivelist.node being x86_64 on
  // this arm64 machine.
  const hostArch = os.arch();
  run('npm', ['install', '--no-save', `--cpu=${hostArch}`, '--os=darwin']);
  run('npx', ['electron-rebuild']);
}
