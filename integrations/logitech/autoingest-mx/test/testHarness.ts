/**
 * testHarness.ts — shared real-AutoIngest launch helpers for this plugin's
 * integration tests (autoIngestClient.integration.test.ts and
 * browsePageActions.integration.test.ts). Extracted so both files drive the
 * exact same real launch/splash/fixture sequence rather than maintaining
 * two copies that could silently drift apart.
 *
 * Launches the REAL AutoIngest app via playwright-core's _electron —
 * exactly like the AutoIngest repo's own test/mxControlTransportLive.test.js
 * — against an isolated fake "home" directory, so real discovery-by-
 * convention (descriptor.ts) is exercised end-to-end without ever touching
 * real user settings. Synthetic fixtures only.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { _electron as electron, type ElectronApplication } from 'playwright-core';

// Resolved from process.cwd(), NOT import.meta.url/__dirname: this file's
// own directory depth differs between direct execution and tsc's compiled
// dist-test/test/ output (see docs/mxLogitechPlugin.md's tooling-limitation
// note). npm scripts always run with cwd = the package root (autoingest-mx/).
export const AUTOINGEST_ROOT = path.resolve(process.cwd(), '../../..'); // autoingest-mx -> logitech -> integrations -> worktree root

export async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 10000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function mkFakeHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ai-mx-plugin-test-home-'));
}

const FAKE_MEDIA_BYTES = Buffer.alloc(60 * 1024, 0xab); // scanMediaRecursive drops files under 50KB as thumbnail/proxy stubs

/** A synthetic "memory card" with two fake media files — commands like
 *  navigation/selection genuinely need real files to act on, or every
 *  result is a trivially-true "nothing to do" outcome that proves nothing. */
export async function mkSyntheticCard(): Promise<string> {
  const card = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-mx-plugin-test-card-'));
  const dcimDir = path.join(card, 'DCIM', '100CANON');
  await fs.mkdir(dcimDir, { recursive: true });
  await fs.writeFile(path.join(dcimDir, 'IMG_0001.JPG'), FAKE_MEDIA_BYTES);
  await fs.writeFile(path.join(dcimDir, 'IMG_0002.JPG'), FAKE_MEDIA_BYTES);
  return card;
}

export async function launchAutoIngest(fakeHome: string, card: string): Promise<{ app: ElectronApplication }> {
  const userDataDir = path.join(fakeHome, 'Library', 'Application Support', 'auto-ingest');
  const app = await electron.launch({
    args: [AUTOINGEST_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: AUTOINGEST_ROOT,
    timeout: 60000,
  });

  let window = await app.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1200);

  const splashState = await window
    .evaluate(() => {
      const vis = (id: string) => {
        const el = document.getElementById(id);
        return !!el && el.style.display !== 'none';
      };
      return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
    })
    .catch(() => ({ welcome: false, select: false, create: false }));

  const mainWindowPromise = app.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'MX Plugin Test');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) {
      await window.click('.splash-user-item');
      await window.click('#splashSelectStartBtn');
    } else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'MX Plugin Test');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }

  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(800);
  await window.waitForFunction(() => typeof (window as unknown as { AutoIngestCommands?: unknown }).AutoIngestCommands === 'object', { timeout: 15000 });

  const onboardingVisible = await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.contains('visible'));
  if (onboardingVisible) {
    await window.click('#onboardingSkip');
    await window.waitForTimeout(200);
  }

  // Real files to act on — otherwise navigation/selection commands all
  // trivially resolve executed:false ("nothing to do") and prove nothing.
  await window.evaluate(
    (p) => (window as unknown as { selectSource: (s: unknown) => void }).selectSource({ type: 'memory-card', path: p, label: 'MX_PLUGIN_TEST_CARD' }),
    card,
  );
  await window.waitForFunction(() => document.querySelectorAll('#fileGrid .file-tile').length >= 2, { timeout: 15000 });

  return { app };
}
