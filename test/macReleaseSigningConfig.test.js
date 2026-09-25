'use strict';

// D3 — macOS release-signing foundation. Deterministic, credential-free checks that the
// repository-side configuration actually enforces "never silently ship an unsigned macOS
// release," without requiring real Apple credentials to run. Real signed/notarized-artifact
// verification only happens once credentials are provisioned and a real CI build runs
// scripts/verify-mac-signing.sh against real output (see the D3 implementation report).
//
// Run: node test/macReleaseSigningConfig.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');

console.log('macReleaseSigningConfig (D3 — repository-side foundation, no credentials required)');

(async () => {
  // ── package.json: no explicit unsigned prohibition ──
  t('build.mac.identity is not explicitly null (removed, not merely falsy)', () => {
    assert.equal('identity' in pkg.build.mac, false, 'identity key must be absent so electron-builder auto-discovers via CSC_LINK/keychain');
  });

  t('build.mac.hardenedRuntime is explicitly true', () => {
    assert.equal(pkg.build.mac.hardenedRuntime, true);
  });

  t('build.mac.gatekeeperAssess is removed (confirmed unused/vestigial in the installed app-builder-lib@26.8.1)', () => {
    assert.equal('gatekeeperAssess' in pkg.build.mac, false);
  });

  t('build.dmg.sign is explicitly true (the DMG container itself must be signed, not just the inner .app)', () => {
    assert.equal(pkg.build.dmg.sign, true);
  });

  t('forceCodeSigning is NOT in the static package.json config (kept CI-only via a CLI override, so local `npm run dist:mac`/`build:mac` still packages without credentials)', () => {
    assert.equal('forceCodeSigning' in pkg.build.mac, false);
  });

  t('local packaging scripts (dist:mac / build:mac) do not themselves force signing', () => {
    for (const key of ['dist:mac', 'build:mac', 'dist', 'build']) {
      const script = pkg.scripts[key] || '';
      assert.doesNotMatch(script, /forceCodeSigning/, `${key} must remain usable by a developer with no Apple credentials`);
    }
  });

  // ── release.yml: both mac release jobs carry identical signing enforcement ──
  const jobBlocks = {
    'build-mac': workflow.slice(workflow.indexOf('\n  build-mac:'), workflow.indexOf('\n  build-windows:')),
    'rc-build-mac': workflow.slice(workflow.indexOf('\n  rc-build-mac:')),
  };
  assert.ok(jobBlocks['build-mac'].length > 200, 'build-mac job block located');
  assert.ok(jobBlocks['rc-build-mac'].length > 200, 'rc-build-mac job block located');

  for (const [jobName, block] of Object.entries(jobBlocks)) {
    t(`${jobName}: contains a presence-only credential preflight step`, () => {
      assert.match(block, /Verify macOS signing\/notarization credentials are configured/);
      assert.match(block, /macOS release signing credentials are not configured/);
    });

    t(`${jobName}: preflight checks every required secret name (CSC_LINK/CSC_KEY_PASSWORD plus at least one notarization credential set)`, () => {
      for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
        assert.ok(block.includes(name), `expected secret name "${name}" to be referenced`);
      }
    });

    t(`${jobName}: the build step passes -c.mac.forceCodeSigning=true`, () => {
      assert.match(block, /-c\.mac\.forceCodeSigning=true/);
    });

    t(`${jobName}: the build step's env exposes the signing/notarization secrets to electron-builder`, () => {
      const buildStepStart = block.search(/- name: Build and publish Mac/);
      assert.ok(buildStepStart >= 0, 'found the "Build and publish Mac[...]" step');
      const buildStep = block.slice(buildStepStart, buildStepStart + 1200);
      for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) {
        assert.ok(buildStep.includes(name), `build step env must include ${name}`);
      }
    });

    t(`${jobName}: a post-build verification gate runs scripts/verify-mac-signing.sh against BOTH architectures and fails the job on any failure`, () => {
      assert.match(block, /Verify macOS release signing & notarization/);
      assert.match(block, /verify-mac-signing\.sh.*dist\/mac\/AutoIngest\.app/);
      assert.match(block, /verify-mac-signing\.sh.*dist\/mac-arm64\/AutoIngest\.app/);
      assert.match(block, /set -e/, 'the gate step must not swallow a failing verification');
    });

    t(`${jobName}: the DMG itself is independently checked for an ad-hoc signature`, () => {
      assert.match(block, /spctl --assess --type open/);
      assert.match(block, /Signature=adhoc/);
    });
  }

  t('the two mac release jobs use the identical credential/preflight/gate mechanism (Preview/Stable parity — no "RC unsigned, Stable signed" split)', () => {
    const extractStepNames = (block) => [...block.matchAll(/- name: ([^\n]+)/g)].map(m => m[1].trim())
      .filter(n => /Apple|signing|notarization|macOS release/.test(n));
    const buildMacSteps = extractStepNames(jobBlocks['build-mac']);
    const rcBuildMacSteps = extractStepNames(jobBlocks['rc-build-mac']);
    assert.deepEqual(buildMacSteps, rcBuildMacSteps);
    assert.ok(buildMacSteps.length >= 3, 'expected at least the credential-prep, preflight, and verification-gate steps');
  });

  t('Windows signing is untouched by this change (out of scope for D3)', () => {
    // Bounded strictly to the build-windows job's own steps (ending at its one build step),
    // not by job-key text alone — a pre-existing, unrelated comment on development-build
    // (textually between build-windows and development-build's job key) already mentions
    // "forceCodeSigning" while explaining Windows has none; slicing on job keys alone would
    // wrongly sweep that unrelated prose in.
    const start = workflow.indexOf('\n  build-windows:');
    const end = workflow.indexOf('Build and publish Windows', start) + 'Build and publish Windows'.length + 60;
    const winBlock = workflow.slice(start, end);
    assert.doesNotMatch(winBlock, /CSC_LINK|APPLE_|forceCodeSigning/);
  });

  t('the new D3 step names appear exactly twice each (once per mac release job — build-mac and rc-build-mac — never in the Windows jobs)', () => {
    for (const stepName of ['Prepare Apple API key file', 'Verify macOS signing/notarization credentials are configured', 'Verify macOS release signing & notarization']) {
      const count = workflow.split(stepName).length - 1;
      assert.equal(count, 2, `expected "${stepName}" to appear exactly twice, found ${count}`);
    }
  });

  // ── verification script itself ──
  t('scripts/verify-mac-signing.sh exists and is executable', () => {
    const p = path.join(ROOT, 'scripts/verify-mac-signing.sh');
    assert.ok(fs.existsSync(p));
    const mode = fs.statSync(p).mode;
    assert.ok(mode & 0o111, 'script must be executable');
  });

  t('scripts/verify-mac-signing.sh checks every required signal, not just exit codes', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/verify-mac-signing.sh'), 'utf8');
    for (const needle of [
      'codesign --verify --deep --strict',
      'spctl --assess --type execute',
      'stapler validate',
      'Signature=adhoc',
      'TeamIdentifier=not set',
      'Developer ID Application',
      'flags=.*runtime',
      '_CodeSignature/CodeResources',
      'set -o pipefail',
    ]) {
      assert.ok(src.includes(needle), `expected script to check for "${needle}"`);
    }
  });

  console.log(`${passed} passed`);
  process.exit(process.exitCode || 0);
})();
