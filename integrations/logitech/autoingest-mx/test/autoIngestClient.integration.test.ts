/**
 * Integration tests for AutoIngestClient against the REAL, running
 * AutoIngest Phase 2 control transport (services/mxControlService.js) —
 * not a second mock protocol. Launches the real Electron app via
 * playwright-core's _electron, exactly like the AutoIngest repo's own
 * test/mxControlTransportLive.test.js, with an isolated fake "home"
 * directory so real discovery-by-convention (descriptor.ts) is exercised
 * end-to-end without ever touching real user settings.
 *
 * One deliberate, minimal exception: the protocol-mismatch reaction test
 * uses a tiny local `ws` server (not a second AutoIngest protocol — it
 * sends exactly the one real message shape {type:'ready',
 * protocolVersion:N} the transport already documents) because the REAL
 * server can never itself produce a mismatch against its own
 * PROTOCOL_VERSION. Real discovery (a real descriptor file) still points
 * the client at it.
 *
 * Run: npm run test:integration (compiles via real tsc first — see
 * tsconfig.test.json and "Known Node SDK / tooling limitations" in
 * docs/mxLogitechPlugin.md for why tsx/esbuild cannot run this file:
 * esbuild wraps evaluate() callbacks with a `__name` helper that doesn't
 * exist when Playwright serializes them into the browser context.)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { WebSocketServer } from 'ws';

import { AutoIngestClient, type LogLevel } from '../src/autoIngestClient.js';

// Resolved from process.cwd(), NOT import.meta.url/__dirname: this file's
// own directory depth differs between ts-node-style direct execution and
// tsc's compiled dist-test/test/ output, which is exactly the bug this
// once had (AUTOINGEST_ROOT one level short after adding tsc compilation —
// see git history). npm scripts always run with cwd = the package root
// (autoingest-mx/), so that is the one stable anchor.
const AUTOINGEST_ROOT = path.resolve(process.cwd(), '../../..'); // autoingest-mx -> logitech -> integrations -> worktree root

let passed = 0;
let failed = 0;
async function t(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL — ${name}`);
    console.error(err);
  }
}

function collectingLogger(sink: string[]): (level: LogLevel, message: string) => void {
  return (level, message) => sink.push(`[${level}] ${message}`);
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 10000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function mkFakeHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ai-mx-plugin-client-test-home-'));
}

const FAKE_MEDIA_BYTES = Buffer.alloc(60 * 1024, 0xab); // scanMediaRecursive drops files under 50KB as thumbnail/proxy stubs

/** A synthetic "memory card" with two fake media files — commands like
 *  navigation/selection genuinely need real files to act on, or every
 *  result is a trivially-true "nothing to do" outcome that proves nothing. */
async function mkSyntheticCard(): Promise<string> {
  const card = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-mx-plugin-client-test-card-'));
  const dcimDir = path.join(card, 'DCIM', '100CANON');
  await fs.mkdir(dcimDir, { recursive: true });
  await fs.writeFile(path.join(dcimDir, 'IMG_0001.JPG'), FAKE_MEDIA_BYTES);
  await fs.writeFile(path.join(dcimDir, 'IMG_0002.JPG'), FAKE_MEDIA_BYTES);
  return card;
}

async function launchAutoIngest(fakeHome: string, card: string): Promise<{ app: ElectronApplication }> {
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

console.log('AutoIngestClient integration tests (real Phase 2 transport)');

// ═══════════════════════════════════════════════════════════════════════
// 1-7: full lifecycle against a real running AutoIngest instance
// ═══════════════════════════════════════════════════════════════════════
{
  const fakeHome = await mkFakeHome();
  const card = await mkSyntheticCard();
  const logs: string[] = [];
  let app: ElectronApplication | null = null;
  let client: AutoIngestClient | null = null;

  try {
    ({ app } = await launchAutoIngest(fakeHome, card));

    client = new AutoIngestClient(collectingLogger(logs), fakeHome);

    await t('connect(): reaches "connected" against the real transport (real discovery, real handshake)', async () => {
      await client!.connect();
      await waitFor(() => client!.getConnectionState() === 'connected', 15000);
      assert.equal(client!.getConnectionState(), 'connected');
    });

    await t('initial state received: getLatestState() is real, non-null AutoIngest state', async () => {
      await waitFor(() => client!.getLatestState() !== null, 5000);
      const state = client!.getLatestState();
      assert.ok(state, 'state should be non-null');
      assert.equal(state!.context, 'browse');
      assert.ok(Array.isArray(state!.availableCommands));
    });

    await t('subscribe(): fires immediately with the current snapshot, then again on a real state push', async () => {
      const seen: unknown[] = [];
      const unsub = client!.subscribe((snap) => seen.push(snap));
      assert.equal(seen.length, 1, 'fires immediately on subscribe');
      const before = seen.length;
      const result = await client!.executeCommand('navigation.nextFile');
      assert.equal(result.ok, true);
      await waitFor(() => seen.length > before, 5000);
      unsub();
    });

    await t('command request/result correlation: a valid command resolves with a real, matching result', async () => {
      const result = await client!.executeCommand('selection.selectAll');
      assert.equal(result.ok, true);
      assert.equal(result.commandId, 'selection.selectAll');
    });

    await t('rejected command result: an unknown commandId resolves ok:false, reason:"unknown-command" — never hangs, never throws', async () => {
      const result = await client!.executeCommand('totally.bogus.command');
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'unknown-command');
    });

    await t('state push update: a real mutation is reflected in getLatestState() shortly after', async () => {
      await client!.executeCommand('selection.clear');
      const before = client!.getLatestState()?.selectedCount;
      await client!.executeCommand('selection.selectAll');
      await waitFor(() => client!.getLatestState()?.selectedCount !== before, 5000);
      assert.notEqual(client!.getLatestState()?.selectedCount, before);
    });

    await t('no token is ever logged, valid or invalid, across the whole session so far', async () => {
      // We never captured the raw descriptor token in this test (by design —
      // the client owns discovery internally), so assert against the one
      // thing we CAN assert: no log line is anywhere near token length/shape.
      const suspicious = logs.filter((l) => /[0-9a-f]{64}/i.test(l));
      assert.equal(suspicious.length, 0, `found a 64-hex-char (token-shaped) string in logs: ${JSON.stringify(suspicious)}`);
    });

    await t('disconnect(): connectionState becomes "disconnected", latestState clears, executeCommand fails fast without hanging', async () => {
      client!.disconnect();
      assert.equal(client!.getConnectionState(), 'disconnected');
      assert.equal(client!.getLatestState(), null);
      const result = await client!.executeCommand('navigation.nextFile');
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'not-connected');
    });
  } finally {
    client?.disconnect();
    await app?.close().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 8: reconnect after AutoIngest restart — new port/token, old credentials discarded
// ═══════════════════════════════════════════════════════════════════════
{
  const fakeHome = await mkFakeHome();
  const card = await mkSyntheticCard();
  let app1: ElectronApplication | null = null;
  let app2: ElectronApplication | null = null;
  let client: AutoIngestClient | null = null;

  try {
    ({ app: app1 } = await launchAutoIngest(fakeHome, card));
    const descriptorPath = path.join(fakeHome, 'Library', 'Application Support', 'auto-ingest', 'mx-control.json');
    const firstDescriptor = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));

    client = new AutoIngestClient(() => {}, fakeHome);
    await client.connect();
    await waitFor(() => client!.getConnectionState() === 'connected', 15000);

    await t('reconnect after restart: the first session\'s port/token are captured for comparison', () => {
      assert.ok(typeof firstDescriptor.port === 'number');
      assert.ok(typeof firstDescriptor.token === 'string');
    });

    // Simulate a full AutoIngest restart: close it (removes the descriptor —
    // see docs/mxControlTransport.md's before-quit guard), then relaunch,
    // which generates a genuinely NEW token/port.
    await app1.close();
    await waitFor(async () => !(await fs.access(descriptorPath).then(() => true).catch(() => false)), 5000);

    await t('client detects the disconnect and does not stay falsely "connected"', async () => {
      await waitFor(() => client!.getConnectionState() !== 'connected', 10000);
      assert.notEqual(client!.getConnectionState(), 'connected');
    });

    ({ app: app2 } = await launchAutoIngest(fakeHome, card));
    const secondDescriptor = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));

    await t('the new AutoIngest instance genuinely regenerated a different token/port', () => {
      assert.notEqual(secondDescriptor.token, firstDescriptor.token, 'token must be regenerated per run, never reused');
      // Port MAY coincide (ephemeral allocation) — token divergence is the real guarantee.
    });

    await t('reconnect after restart: client rediscovers the NEW descriptor and reconnects (never reuses stale credentials)', async () => {
      await waitFor(() => client!.getConnectionState() === 'connected', 20000);
      assert.equal(client!.getConnectionState(), 'connected');
      await waitFor(() => client!.getLatestState() !== null, 5000);
      assert.ok(client!.getLatestState());
    });
  } finally {
    client?.disconnect();
    await app1?.close().catch(() => {});
    await app2?.close().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 9: protocol-mismatch reaction — minimal fake server, real descriptor/discovery
// ═══════════════════════════════════════════════════════════════════════
{
  const fakeHome = await mkFakeHome();
  const fakeUserDataDir = path.join(fakeHome, 'Library', 'Application Support', 'auto-ingest');
  await fs.mkdir(fakeUserDataDir, { recursive: true });

  const httpPort = await new Promise<number>((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
      wss.on('connection', (ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString('utf8'));
          if (msg.type === 'hello') {
            // Real message shape, deliberately wrong protocolVersion — the
            // one case the real server can never itself produce.
            ws.send(JSON.stringify({ type: 'ready', protocolVersion: 999 }));
          }
        });
      });
      (globalThis as Record<string, unknown>).__mxTestWss = wss;
    });
  });

  await fs.writeFile(
    path.join(fakeUserDataDir, 'mx-control.json'),
    JSON.stringify({ port: httpPort, token: 'b'.repeat(64), pid: process.pid, protocolVersion: 1 }),
  );

  const logs: string[] = [];
  const client = new AutoIngestClient(collectingLogger(logs), fakeHome);

  await t('protocol mismatch: client logs a warning and does not report "connected" against a mismatched server', async () => {
    await client.connect();
    await new Promise((r) => setTimeout(r, 1500));
    assert.notEqual(client.getConnectionState(), 'connected');
    assert.ok(logs.some((l) => l.includes('protocol mismatch')), 'expected a protocol-mismatch log line');
  });

  client.disconnect();
  const wss = (globalThis as Record<string, unknown>).__mxTestWss as { close: () => void } | undefined;
  wss?.close();
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
