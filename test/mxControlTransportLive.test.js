'use strict';

// Live end-to-end verification of the MX Console local control transport
// (AI-FEAT MX Console Phase 2 — services/mxControlService.js,
// renderer/mxControlAdapter.js, and the mx-control:* preload channels).
//
// Drives the REAL Electron app (real main process, real renderer, real
// AutoIngestCommands) and a REAL raw WebSocket client (the `ws` package,
// the same client-library role a future Logitech plugin would play) talking
// to the real loopback server over the real discovery descriptor file — no
// mocked transport, no stubbed IPC. Synthetic fixtures only; never touches a
// real archive, card, NAS, or user settings.
//
// Run: node test/mxControlTransportLive.test.js

const { _electron: electron } = require('playwright-core');
const WebSocket = require('ws');
const fs   = require('fs');
const fsp  = require('fs/promises');
const net  = require('net');
const os   = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[mx-transport]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

const FAKE_MEDIA_BYTES = Buffer.alloc(60 * 1024, 0xab);
async function writeMedia(root, relFile) {
  const full = path.join(root, relFile);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, FAKE_MEDIA_BYTES);
}
async function writeRaw(p) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.from('not-a-real-raw-file-just-bytes'));
}

/** Small helper: one-shot request/response over an already-open ws, matched
 * by message type (and requestId when given), with a timeout so a hung
 * expectation fails the test instead of hanging the whole run. */
function waitForMessage(ws, predicate, timeoutMs = 5000, label = 'message') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMsg);
      reject(new Error(`timed out waiting for ${label}`));
    }, timeoutMs);
    function onMsg(raw) {
      let msg;
      try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.removeListener('message', onMsg);
        resolve(msg);
      }
    }
    ws.on('message', onMsg);
  });
}

function connectRaw(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  // The rapid-dial-command test legitimately keeps several concurrent
  // waitForMessage() listeners in flight at once — raise the cap so Node's
  // generic leak-detection heuristic doesn't warn on expected concurrency.
  ws.setMaxListeners(50);
  return ws;
}

async function readDescriptor(userDataDir) {
  const p = path.join(userDataDir, 'mx-control.json');
  const raw = await fsp.readFile(p, 'utf8');
  return { descriptorPath: p, descriptor: JSON.parse(raw) };
}

(async () => {
  const userDataDir = await mkTmp('ai-e2e-mx-transport-userdata-');
  const card = await mkTmp('ai-e2e-mx-transport-card-');
  await writeMedia(card, 'DCIM/100CANON/IMG_0001.JPG');
  await writeMedia(card, 'DCIM/100CANON/IMG_0002.JPG');
  const qmzRoot = await mkTmp('ai-e2e-mx-transport-qmz-');
  await writeRaw(path.join(qmzRoot, '_Unsequenced', 'Jane Doe', 'q1.cr2'));

  log('userDataDir =', userDataDir);
  log('card        =', card);

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  window.on('pageerror', (err) => log('[pageerror]', err.message));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'MX Transport Test');
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
      await window.fill('#splashInputName', 'MX Transport Test');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }

  window = await mainWindowPromise;
  let pageErrorCount = 0;
  window.on('pageerror', (err) => { pageErrorCount++; log('[pageerror]', err.message); });
  window.on('console', (msg) => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000);
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });
  await window.waitForFunction(() => typeof window.AutoIngestCommands === 'object', { timeout: 15000 });

  const onboardingVisible = await window.evaluate(() =>
    document.getElementById('onboardingOverlay')?.classList.contains('visible'));
  if (onboardingVisible) { await window.click('#onboardingSkip'); await window.waitForTimeout(200); }

  await window.evaluate((p) => window.selectSource({ type: 'memory-card', path: p, label: 'MX_XPORT_CARD' }), card);
  await window.waitForTimeout(800);
  await window.waitForFunction(() => document.querySelectorAll('#fileGrid .file-tile').length >= 2, { timeout: 15000 });

  // Give mxControlAdapter.js's bootstrap push time to reach the main process
  // before we read the descriptor / connect.
  await window.waitForTimeout(300);

  let ws1 = null;
  let ws2 = null;
  let port = null;

  try {
    // ═══════════════════════════════════════════════════════════════════
    // 1. Discovery descriptor
    // ═══════════════════════════════════════════════════════════════════
    const { descriptorPath, descriptor } = await readDescriptor(userDataDir);
    check(typeof descriptor.port === 'number' && descriptor.port > 0, 'descriptor has a real numeric port');
    check(typeof descriptor.token === 'string' && /^[0-9a-f]{64}$/.test(descriptor.token), 'descriptor token is 64 hex chars (256-bit entropy)');
    check(descriptor.protocolVersion === 1, 'descriptor protocolVersion is 1');
    const mainPid = await electronApp.evaluate(() => process.pid);
    check(descriptor.pid === mainPid, 'descriptor pid matches the real main process pid');

    const stat = await fsp.stat(descriptorPath);
    // POSIX-only check (chmod is best-effort on other platforms per the service's own comment).
    if (process.platform !== 'win32') {
      check((stat.mode & 0o777) === 0o600, `descriptor file has restrictive 0600 permissions (got ${(stat.mode & 0o777).toString(8)})`);
    }

    port = descriptor.port;
    const { token } = descriptor;

    // ═══════════════════════════════════════════════════════════════════
    // 2. Auth handshake
    // ═══════════════════════════════════════════════════════════════════
    ws1 = connectRaw(port);
    await new Promise((resolve, reject) => { ws1.once('open', resolve); ws1.once('error', reject); });

    // Both listeners MUST be attached before sending hello: the server sends
    // ready and the initial state back-to-back synchronously, and 'message'
    // is a live event, not a buffered stream — awaiting one wait, then
    // creating the next, risks the second frame arriving (and being
    // silently dropped with no listener attached) in the gap between them.
    const readyMsgPromise    = waitForMessage(ws1, (m) => m.type === 'ready', 5000, 'ready');
    const initialStatePromise = waitForMessage(ws1, (m) => m.type === 'state' && !m.requestId, 5000, 'initial state push');
    ws1.send(JSON.stringify({ type: 'hello', token, protocolVersion: 1 }));
    const readyMsg = await readyMsgPromise;
    check(readyMsg.protocolVersion === 1, 'valid token + matching protocolVersion → ready with protocolVersion echoed');

    // "On initial authenticated connection: send the current complete state
    // once." — should already have arrived (queued right after ready).
    const initialState = await initialStatePromise;
    check(initialState.state !== null, 'authenticated client receives REAL (non-null) initial state — the renderer bootstrap push already landed');
    check(initialState.state.context === 'browse', 'initial state reflects the real renderer context');

    // ═══════════════════════════════════════════════════════════════════
    // 3. State push — one message per real mutation, nothing extra
    // ═══════════════════════════════════════════════════════════════════
    let pushCount = 0;
    ws1.on('message', (raw) => {
      try { const m = JSON.parse(raw.toString('utf8')); if (m.type === 'state' && !m.requestId) pushCount++; }
      catch { /* ignore */ }
    });

    const nextPush = () => waitForMessage(ws1, (m) => m.type === 'state' && !m.requestId, 4000, 'state push');

    let p = nextPush();
    await window.evaluate(() => window.AutoIngestCommands.execute('navigation.nextFile'));
    let pushed = await p;
    check(pushed.state.activeFile !== null, 'navigation pushes an updated state (activeFile set)');

    p = nextPush();
    await window.evaluate(() => window.AutoIngestCommands.execute('selection.selectAll'));
    pushed = await p;
    check(pushed.state.selectedCount === 2, 'selection change pushes updated state (selectedCount reflects real selection)');

    p = nextPush();
    await window.evaluate(() => window.AutoIngestCommands.execute('preview.toggle'));
    pushed = await p;
    check(pushed.state.previewOpen === true, 'preview open pushes updated state');
    p = nextPush();
    await window.evaluate(() => window.AutoIngestCommands.execute('preview.toggle'));
    pushed = await p;
    check(pushed.state.previewOpen === false, 'preview close pushes updated state');

    p = nextPush();
    const assignResult = await window.evaluate(() => window.AutoIngestCommands.execute('group.assign', { groupId: null }));
    pushed = await p;
    check(assignResult.executed === true && pushed.state.groups.length === 1, 'group mutation pushes updated state (real new group)');

    await window.waitForTimeout(300); // let any stray extra pushes (there shouldn't be any) arrive before counting
    check(pushCount === 5, `exactly one push per real mutation, no polling/duplicate spam (got ${pushCount} pushes for 5 mutations)`);

    // ═══════════════════════════════════════════════════════════════════
    // 4. Commands via WS — valid navigation/selection/group
    // ═══════════════════════════════════════════════════════════════════
    function execViaWs(ws, commandId, payload) {
      const requestId = `r-${commandId}-${Math.random().toString(36).slice(2)}`;
      const resultPromise = waitForMessage(ws, (m) => m.type === 'commandResult' && m.requestId === requestId, 5000, `commandResult(${commandId})`);
      ws.send(JSON.stringify({ type: 'executeCommand', requestId, commandId, payload }));
      return resultPromise;
    }

    await window.evaluate(() => window.AutoIngestCommands.execute('selection.clear'));
    await window.evaluate(() => { for (const g of [...GroupManager.getGroups()]) GroupManager.removeGroup(g.id); });

    let r = await execViaWs(ws1, 'navigation.nextFile');
    check(r.result.ok === true, 'valid navigation command executes via WS');

    r = await execViaWs(ws1, 'selection.toggleCurrent');
    check(r.result.ok === true && r.result.executed === true, 'valid selection command executes via WS');

    r = await execViaWs(ws1, 'selection.selectAll');
    check(r.result.ok === true, 'setup: select all via WS for the group command below');

    r = await execViaWs(ws1, 'group.assign', { groupId: null });
    check(r.result.ok === true && r.result.executed === true && r.result.detail && r.result.detail.groupId != null,
      'valid group command executes via WS, real detail returned');

    // ═══════════════════════════════════════════════════════════════════
    // 5. Commands via WS — QMZ
    // ═══════════════════════════════════════════════════════════════════
    const eventContext = { component: { location: 'Hall A', city: 'Mumbai', country: 'India' }, isMulti: false, eventTitle: 'Waaz Mubarak', hijriDate: '1448-02-10', eventJsonPath: null, componentTitle: null };
    await window.evaluate(({ root, ctx }) => window.openQMZManager(root, ctx), { root: qmzRoot, ctx: eventContext });
    await window.waitForTimeout(1000);

    async function domClick(selector) {
      return window.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return false; el.click(); return true; }, selector);
    }
    await domClick('.qmz-pg-row[data-pg="Jane Doe"]');
    await window.waitForTimeout(300);

    const createResult = await window.evaluate((root) => window.api.qmzCreateSequence({ qmzRoot: root, number: 3, letter: 'Q' }), qmzRoot);
    check(createResult.ok === true, 'setup: real sequence 03Q created for the WS QMZ command test');
    await window.evaluate(() => _qmzRefresh());
    await window.waitForTimeout(300);

    const qmzPaths = await window.evaluate(() => _qmzGetActiveFiles().map((f) => f.path));
    await window.evaluate((paths) => { paths.forEach((p2) => _qmzSelectedFiles.add(p2)); _qmzSyncAllTiles(); }, qmzPaths);
    await window.waitForTimeout(200);

    r = await execViaWs(ws1, 'qmz.assignToSequence', { sequenceCode: '03Q' });
    check(r.result.ok === true && r.result.executed === true, 'valid qmz.assignToSequence executes via WS in QMZ context');
    await window.waitForTimeout(400);
    const movedFiles = await fsp.readdir(path.join(qmzRoot, '03Q', 'Jane Doe')).catch(() => []);
    check(movedFiles.includes('q1.cr2'), 'the WS-driven QMZ assignment genuinely moved the file on disk');

    // ═══════════════════════════════════════════════════════════════════
    // 6. Command result semantics — unavailable / malformed / unknown
    // ═══════════════════════════════════════════════════════════════════
    r = await execViaWs(ws1, 'group.assign', { groupId: null }); // still in QMZ context — group.assign requires !isQmzOpen()
    check(r.result.ok === false && r.result.reason === 'not-applicable', 'an unavailable command (group.assign while in QMZ) returns not-applicable, not executed');

    // '05X' — not '05aQ'. '05aQ' (number 05 + suffix 'a' + type 'Q') is a WELL-FORMED code
    // under the current SEQ_RE (renderer/qmzSequenceFormat.js) — it just doesn't exist in
    // this fixture's QMZ workspace (only 03Q was created above). A well-formed-but-nonexistent
    // code is, by commandManager.js's own documented contract (see its 'qmz.assignToSequence'
    // comment: "Never creates the sequence and never guesses a type... a nonexistent code is a
    // normal 'ran, nothing to do' outcome"), ok:true/executed:false — NOT invalid-payload. This
    // test predated the fix that taught isValid() to accept suffixed/combined-type codes (see
    // that same file's "Stage 5 fix" comment) and was never updated afterward, so it asserted a
    // rejection reason that the (correct, intentional) validator no longer produces for that
    // input. '05X' has an unrecognized type letter ('X' is not MZ/AQ/Q/M/Z/O) and is genuinely
    // malformed under every version of the validator, so it exercises the real invalid-payload
    // path without loosening or re-tightening any production validation.
    r = await execViaWs(ws1, 'qmz.assignToSequence', { sequenceCode: '05X' });
    check(r.result.ok === false && r.result.reason === 'invalid-payload', 'a malformed payload is rejected — the transport never invents/loosens validation');

    r = await execViaWs(ws1, 'totally.unknown.command', {});
    check(r.result.ok === false && r.result.reason === 'unknown-command', 'an unknown commandId is rejected — no arbitrary function/command name can execute');

    r = await execViaWs(ws1, '__proto__', {});
    check(r.result.ok === false && r.result.reason === 'unknown-command', 'a prototype-pollution-shaped commandId is treated as just another unknown command — no special handling, no eval');

    await window.evaluate(() => _closeQMZManager());
    await window.waitForTimeout(200);

    // ═══════════════════════════════════════════════════════════════════
    // 7. Security — auth required before ANY application data
    // ═══════════════════════════════════════════════════════════════════
    ws2 = connectRaw(port);
    await new Promise((resolve, reject) => { ws2.once('open', resolve); ws2.once('error', reject); });
    const unauthErrPromise = waitForMessage(ws2, (m) => m.type === 'error', 3000, 'unauthenticated error');
    ws2.send(JSON.stringify({ type: 'getState', requestId: 'x1' }));
    const unauthErr = await unauthErrPromise;
    check(unauthErr.code === 'unauthenticated', 'a getState sent before hello is rejected — no application state leaks pre-auth');
    await new Promise((resolve) => { if (ws2.readyState === WebSocket.CLOSED) resolve(); else ws2.once('close', resolve); });

    // Invalid token.
    const ws3 = connectRaw(port);
    await new Promise((resolve, reject) => { ws3.once('open', resolve); ws3.once('error', reject); });
    const badTokenErrPromise = waitForMessage(ws3, (m) => m.type === 'error', 3000, 'invalid-token error');
    ws3.send(JSON.stringify({ type: 'hello', token: 'not-the-real-token', protocolVersion: 1 }));
    const badTokenErr = await badTokenErrPromise;
    check(badTokenErr.code === 'invalid-token', 'an invalid token is rejected');
    await new Promise((resolve) => { if (ws3.readyState === WebSocket.CLOSED) resolve(); else ws3.once('close', resolve); });

    // Protocol mismatch.
    const ws4 = connectRaw(port);
    await new Promise((resolve, reject) => { ws4.once('open', resolve); ws4.once('error', reject); });
    const protoErrPromise = waitForMessage(ws4, (m) => m.type === 'error', 3000, 'protocol-mismatch error');
    ws4.send(JSON.stringify({ type: 'hello', token, protocolVersion: 999 }));
    const protoErr = await protoErrPromise;
    check(protoErr.code === 'protocol-mismatch', 'a mismatched protocolVersion is rejected');
    await new Promise((resolve) => { if (ws4.readyState === WebSocket.CLOSED) resolve(); else ws4.once('close', resolve); });

    // Second concurrent authenticated client — explicit single-client policy.
    const ws5 = connectRaw(port);
    await new Promise((resolve, reject) => { ws5.once('open', resolve); ws5.once('error', reject); });
    const secondClientErrPromise = waitForMessage(ws5, (m) => m.type === 'error', 3000, 'already-connected error');
    ws5.send(JSON.stringify({ type: 'hello', token, protocolVersion: 1 }));
    const secondClientErr = await secondClientErrPromise;
    check(secondClientErr.code === 'already-connected', 'a second client is explicitly rejected while one is already authenticated (single active client policy)');
    check(ws1.readyState === WebSocket.OPEN, 'the FIRST client stays connected and unaffected by the rejected second one');

    // Malformed JSON — must not crash the app, and must not affect ws1.
    const ws6 = connectRaw(port);
    await new Promise((resolve, reject) => { ws6.once('open', resolve); ws6.once('error', reject); });
    const invalidJsonErrPromise = waitForMessage(ws6, (m) => m.type === 'error', 3000, 'invalid-json error');
    ws6.send('{ this is not json');
    const invalidJsonErr = await invalidJsonErrPromise;
    check(invalidJsonErr.code === 'invalid-json', 'malformed JSON is rejected safely, not left to crash the process');
    await new Promise((resolve) => { if (ws6.readyState === WebSocket.CLOSED) resolve(); else ws6.once('close', resolve); });

    // Oversized message — ws's maxPayload should terminate the connection,
    // and the SERVER (and ws1) must survive it untouched.
    const ws7 = connectRaw(port);
    await new Promise((resolve, reject) => { ws7.once('open', resolve); ws7.once('error', reject); });
    const oversizedClosePromise = new Promise((resolve) => ws7.once('close', (code) => resolve(code)));
    const hugePayload = 'x'.repeat(200 * 1024); // well past the 64KB cap
    ws7.send(JSON.stringify({ type: 'hello', token, protocolVersion: 1, junk: hugePayload }));
    const oversizedCloseCode = await Promise.race([oversizedClosePromise, new Promise((r) => setTimeout(() => r('timeout'), 4000))]);
    check(oversizedCloseCode !== 'timeout', 'an oversized message causes the connection to close (server enforces maxPayload) rather than hang');
    check(ws1.readyState === WebSocket.OPEN, 'the oversized-message attempt on a DIFFERENT socket never affects the real authenticated client');

    // Loopback-only reachability — best effort; skipped (not failed) if this
    // sandbox genuinely has no usable non-loopback interface to try.
    const lanIp = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    if (lanIp) {
      const reachable = await new Promise((resolve) => {
        const sock = net.createConnection({ host: lanIp, port, timeout: 1500 });
        sock.once('connect', () => { sock.destroy(); resolve(true); });
        sock.once('timeout', () => { sock.destroy(); resolve(false); });
        sock.once('error', () => resolve(false));
      });
      check(reachable === false, `the control port is NOT reachable via the LAN interface (${lanIp}) — loopback-only binding confirmed`);
    } else {
      log('SKIP — no non-loopback IPv4 interface available in this environment; loopback-only binding was verified by code (127.0.0.1 literal) instead');
    }

    // ═══════════════════════════════════════════════════════════════════
    // 8. Resilience — disconnect/reconnect, renderer reload, rapid commands
    // ═══════════════════════════════════════════════════════════════════
    ws1.removeAllListeners('message');
    const ws1ClosePromise = new Promise((resolve) => ws1.once('close', resolve));
    ws1.close(1000, 'test reconnect');
    await ws1ClosePromise;

    const ws1b = connectRaw(port);
    await new Promise((resolve, reject) => { ws1b.once('open', resolve); ws1b.once('error', reject); });
    // Same both-listeners-before-send fix as the first handshake above.
    const reconnectReadyPromise = waitForMessage(ws1b, (m) => m.type === 'ready', 5000, 'ready after reconnect');
    const reconnectStatePromise = waitForMessage(ws1b, (m) => m.type === 'state' && !m.requestId, 5000, 'state after reconnect');
    ws1b.send(JSON.stringify({ type: 'hello', token, protocolVersion: 1 }));
    const reconnectReady = await reconnectReadyPromise;
    check(reconnectReady.protocolVersion === 1, 'reconnecting with the same token after a disconnect succeeds (server released the single-client slot)');
    const reconnectState = await reconnectStatePromise;
    check(reconnectState.state !== null, 'the reconnected client gets a fresh initial state, not stale-suppressed by the previous session\'s dedup marker');

    // Renderer reload/reconnect: the adapter re-wires on reload and pushes a
    // fresh bootstrap state; the transport must tolerate this without dying.
    //
    // The reconnect's own initial state above already happens to be the
    // renderer's "nothing selected/focused yet" state — the SAME shape a
    // freshly-reloaded renderer's bootstrap push will have (by this point in
    // the run the file grid itself is no longer guaranteed populated either
    // — the QMZ detour and various rejected-command probes earlier don't
    // reliably leave it in a known state). Deterministically re-select the
    // card and select a file so there is a guaranteed real, non-null
    // activeFile — otherwise the dedup check in _broadcastStateIfChanged()
    // could legitimately (and correctly) suppress the post-reload push as a
    // false "no real change", which would prove nothing about reload
    // tolerance either way.
    await window.evaluate((p) => window.selectSource({ type: 'memory-card', path: p, label: 'MX_XPORT_CARD' }), card);
    await window.waitForFunction(() => document.querySelectorAll('#fileGrid .file-tile').length >= 2, { timeout: 15000 });

    // The commandResult reply and the state-changed push it triggers are two
    // INDEPENDENT IPC sends with no ordering guarantee between them — must
    // explicitly wait for the push itself (not just the command's own reply)
    // before reloading, or the reload can wipe the renderer before that
    // separate ipcRenderer.send ever fires, leaving _lastBroadcastStateJson
    // stale and this whole setup pointless.
    const preReloadStatePushPromise = waitForMessage(ws1b, (m) => m.type === 'state' && !m.requestId && m.state && m.state.activeFile !== null, 8000, 'pre-reload activeFile push');
    await execViaWs(ws1b, 'navigation.nextFile');
    await preReloadStatePushPromise;

    // The listener MUST be attached before triggering the reload — 'message'
    // is a live event, not a buffered stream, so a push that arrives before
    // waitForMessage() is called would otherwise be silently lost forever.
    const postReloadStatePromise = waitForMessage(ws1b, (m) => m.type === 'state' && !m.requestId, 15000, 'state after renderer reload');
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => typeof window.AutoIngestCommands === 'object', { timeout: 20000 });
    const postReloadState = await postReloadStatePromise;
    check(postReloadState.state !== null && postReloadState.state.activeFile === null,
      'a renderer reload is tolerated — the adapter re-wires and pushes a genuinely fresh reset state (no stale activeFile carried over)');

    // Rapid dial-like navigation commands — must all resolve individually,
    // well under the generous rate-sanity ceiling, without crashing anything.
    // The reload above reset the renderer's in-memory state entirely (no
    // source selected), so the card must be reselected before there is
    // anything to navigate across.
    await window.evaluate((p) => window.selectSource({ type: 'memory-card', path: p, label: 'MX_XPORT_CARD' }), card);
    await window.waitForFunction(() => document.querySelectorAll('#fileGrid .file-tile').length >= 2, { timeout: 15000 });
    const rapidResults = await Promise.all(
      Array.from({ length: 20 }, (_, i) => execViaWs(ws1b, i % 2 === 0 ? 'navigation.nextFile' : 'navigation.previousFile'))
    );
    check(rapidResults.every((res) => res.result && res.result.ok === true), '20 rapid dial-like navigation commands all resolve individually with ok:true');

    // Malformed client (ws6/ws7 above) must not have affected the app itself.
    check(pageErrorCount === 0, `no renderer page errors were raised by any malformed/oversized/rejected client attempt (count=${pageErrorCount})`);
    r = await execViaWs(ws1b, 'navigation.nextFile');
    check(r.result.ok === true, 'the app remains fully functional after malformed/oversized client attempts — a real command still executes correctly');

    ws1b.close();

    if (failures === 0) {
      log('ALL CHECKS PASSED');
    } else {
      log(`${failures} CHECK(S) FAILED`);
      process.exitCode = 1;
    }
  } finally {
    try { ws1 && ws1.close(); } catch { /* ignore */ }
    try { ws2 && ws2.close(); } catch { /* ignore */ }
    await electronApp.close().catch(() => {});

    // ── Post-shutdown: server/descriptor cleanup ──────────────────────────
    const descriptorPath = path.join(userDataDir, 'mx-control.json');
    await new Promise((r) => setTimeout(r, 600)); // before-quit's async shutdown needs a moment
    const descriptorGoneAfterShutdown = !fs.existsSync(descriptorPath);
    check(descriptorGoneAfterShutdown, 'clean shutdown removes the discovery descriptor');

    let serverClosedAfterShutdown = true;
    if (port) {
      serverClosedAfterShutdown = await new Promise((resolve) => {
        const sock = net.createConnection({ host: '127.0.0.1', port, timeout: 2000 });
        sock.once('connect', () => { sock.destroy(); resolve(false); }); // still accepting — NOT closed
        sock.once('timeout', () => { sock.destroy(); resolve(true); });
        sock.once('error', () => resolve(true)); // ECONNREFUSED — genuinely closed
      });
    }
    check(serverClosedAfterShutdown, 'a new connection attempt after shutdown is refused — the server genuinely stopped listening');

    const overallOk = failures === 0 && descriptorGoneAfterShutdown && serverClosedAfterShutdown;
    console.log(overallOk ? '[mx-transport] ALL CHECKS PASSED (final)' : `[mx-transport] ${failures} CHECK(S) FAILED (final)`);
    if (!overallOk) process.exitCode = 1;
  }
})().catch((err) => {
  console.error('[mx-transport] FATAL', err);
  process.exitCode = 1;
});
