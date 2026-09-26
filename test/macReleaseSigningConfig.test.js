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

  t('build-mac (Stable) carries exactly the original signing mechanism, with no unsigned-exception mechanism at all', () => {
    const extractStepNames = (block) => [...block.matchAll(/- name: ([^\n]+)/g)].map(m => m[1].trim())
      .filter(n => /Apple|signing|notarization|macOS release/.test(n));
    const buildMacSteps = extractStepNames(jobBlocks['build-mac']);
    assert.deepEqual(buildMacSteps, [
      'Prepare Apple API key file (if configured)',
      'Verify macOS signing/notarization credentials are configured',
      'Verify macOS release signing & notarization',
    ]);
    assert.doesNotMatch(jobBlocks['build-mac'], /allow_unsigned_mac|mac_signing_mode|UNSIGNED \/ NOT NOTARIZED/,
      'Stable must have no unsigned-exception mechanism — signing stays unconditionally required there');
  });

  t('rc-build-mac carries the same base mechanism PLUS the explicit, opt-in unsigned exception (D3 deferred)', () => {
    const extractStepNames = (block) => [...block.matchAll(/- name: ([^\n]+)/g)].map(m => m[1].trim())
      .filter(n => /Apple|signing|notarization|macOS release/.test(n));
    const rcBuildMacSteps = extractStepNames(jobBlocks['rc-build-mac']);
    assert.deepEqual(rcBuildMacSteps, [
      'Determine macOS signing mode',
      'Prepare Apple API key file (if configured)',
      'Verify macOS signing/notarization credentials are configured',
      'Verify macOS release signing & notarization',
      'Confirm unsigned macOS artifacts (D3 deferred — no strict signing gate run)',
    ]);
  });

  t('allow_unsigned_mac workflow_dispatch input exists, defaults false, and is boolean-typed', () => {
    assert.match(workflow, /allow_unsigned_mac:/);
    const inputBlock = workflow.slice(workflow.indexOf('allow_unsigned_mac:'), workflow.indexOf('allow_unsigned_mac:') + 700);
    assert.match(inputBlock, /default:\s*false/);
    assert.match(inputBlock, /type:\s*boolean/);
  });

  t('the unsigned build path truly unsets (not just leaves empty) every CSC/Apple env var before invoking electron-builder — a real CI failure showed electron-builder treats an empty CSC_LINK as a present (if malformed) cert path, not as absent', () => {
    const block = jobBlocks['rc-build-mac'];
    const buildStepIdx = block.indexOf('- name: Build and publish Mac RC');
    const nextStepStart = block.indexOf('\n      - name:', buildStepIdx + 1);
    const buildStep = block.slice(buildStepIdx, nextStepStart);
    assert.match(buildStep, /unset CSC_LINK CSC_KEY_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID/);
  });

  t('the credential preflight and strict verification gate are both skipped in unsigned mode — never run-then-ignored', () => {
    const block = jobBlocks['rc-build-mac'];
    const preflightStepStart = block.indexOf('- name: Verify macOS signing/notarization credentials are configured');
    assert.match(block.slice(preflightStepStart, preflightStepStart + 150), /if: steps\.mac_signing_mode\.outputs\.mode == 'signed'/);

    const gateStepStart = block.indexOf('- name: Verify macOS release signing & notarization');
    assert.match(block.slice(gateStepStart, gateStepStart + 150), /if: steps\.mac_signing_mode\.outputs\.mode == 'signed'/);
  });

  t('the unsigned path never invokes scripts/verify-mac-signing.sh (which is designed to correctly fail an unsigned build)', () => {
    const block = jobBlocks['rc-build-mac'];
    const unsignedStepIdx = block.indexOf('Confirm unsigned macOS artifacts');
    const unsignedStepStart = block.lastIndexOf('- name:', unsignedStepIdx);
    const nextStepStart = block.indexOf('\n      - name:', unsignedStepStart + 1);
    const unsignedStep = block.slice(unsignedStepStart, nextStepStart === -1 ? undefined : nextStepStart);
    assert.doesNotMatch(unsignedStep, /verify-mac-signing\.sh/);
    assert.match(unsignedStep, /UNSIGNED \/ NOT NOTARIZED — D3 DEFERRED/, 'the exact required declaration string must appear in CI logs');
    assert.match(unsignedStep, /if: steps\.mac_signing_mode\.outputs\.mode == 'unsigned'/);
  });

  t('the build step passes forceCodeSigning=false (explicit) in unsigned mode and =true (default) in signed mode — never omitted', () => {
    const block = jobBlocks['rc-build-mac'];
    const buildStepIdx = block.indexOf('- name: Build and publish Mac RC');
    const nextStepStart = block.indexOf('\n      - name:', buildStepIdx + 1);
    const buildStep = block.slice(buildStepIdx, nextStepStart);
    assert.match(buildStep, /-c\.mac\.forceCodeSigning=false/);
    assert.match(buildStep, /-c\.mac\.forceCodeSigning=true/);
    assert.match(buildStep, /MAC_SIGNING_MODE/);
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

  t('no literal empty ${{ }} expression exists anywhere, including inside comments — GitHub templates run: blocks BEFORE bash ever sees them, so even a comment\'s illustrative "${{ }}" is parsed as a real (invalid) expression and rejects the whole workflow at dispatch time (caught live: "An expression was expected")', () => {
    assert.doesNotMatch(workflow, /\$\{\{\s*\}\}/);
    const opens = (workflow.match(/\$\{\{/g) || []).length;
    const closes = (workflow.match(/\}\}/g) || []).length;
    assert.equal(opens, closes, `unbalanced \${{ / }} — ${opens} opens vs ${closes} closes`);
  });

  t('no step-level `if:` condition references the `secrets` context (GitHub Actions rejects the ENTIRE workflow file at dispatch time if any does — caught live: a prior draft of this exact workflow failed `gh workflow run` with "Unrecognized named-value: \'secrets\'" on two such lines)', () => {
    const ifLines = workflow.split('\n').filter(l => /^\s*if:/.test(l));
    for (const line of ifLines) {
      assert.doesNotMatch(line, /secrets\./, `step-level if: must never reference secrets — found: ${line.trim()}`);
    }
  });

  console.log(`${passed} passed`);
  process.exit(process.exitCode || 0);
})();
