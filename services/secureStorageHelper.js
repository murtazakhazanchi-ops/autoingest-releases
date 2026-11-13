/**
 * secureStorageHelper.js — the main-process side of the secure-storage helper (CAM-001).
 *
 * An asynchronous secure-storage adapter for identityKeyStore.js whose Keychain work happens in a
 * child process (secureStorageHelperProcess.js), so the main process never waits on the Keychain:
 * a held access prompt or a stalled Keychain blocks only the helper. The protecting identity is
 * the main process's app name, passed to the child, which refuses to run under any other.
 *
 * Failures never carry key material or OS messages:
 *   error.code 'secure-storage-timeout'        no answer in time (prompt left open, stalled)
 *   error.code 'secure-storage-helper-failed'  could not start, exited, identity mismatch, bad reply
 *   error.code 'secure-storage-op-failed'      the helper answered, the operation failed
 * onWaiting(true) fires when a request has been outstanding for WAITING_AFTER_MS (typically an
 * access prompt on screen), onWaiting(false) when nothing is outstanding any more.
 */

'use strict';

const { LINE_PREFIX } = require('./secureStorageHelperProcess');

const START_TIMEOUT_MS = 30000;
const REQUEST_TIMEOUT_MS = 300000;    // long enough to answer a Keychain prompt
const WAITING_AFTER_MS = 2000;
const IDLE_CLOSE_MS = 3000;

const _err = (code) => Object.assign(new Error(code), { code });

/**
 * @param {{ identity: string, backend: string,
 *           spawnHelper: () => import('child_process').ChildProcess,   // stdio: ['pipe','pipe','ignore']
 *           onWaiting?: (waiting: boolean) => void,
 *           startTimeoutMs?: number, requestTimeoutMs?: number, waitingAfterMs?: number, idleCloseMs?: number }} opts
 */
function createHelperSecureStorage(opts) {
  const {
    identity, backend, spawnHelper, onWaiting = () => {},
    startTimeoutMs = START_TIMEOUT_MS, requestTimeoutMs = REQUEST_TIMEOUT_MS,
    waitingAfterMs = WAITING_AFTER_MS, idleCloseMs = IDLE_CLOSE_MS,
  } = opts;
  let child = null;          // { proc, ready: Promise<void> }
  let nextId = 1;
  const pending = new Map(); // id → { resolve, reject, timer, waitTimer }
  let waiting = false;
  let idleTimer = null;

  const setWaiting = (w) => { if (w !== waiting) { waiting = w; try { onWaiting(w); } catch { /* listener */ } } };
  const refreshWaiting = () => { if (!pending.size) setWaiting(false); };

  function _failAll(code) {
    for (const [id, p] of pending) { clearTimeout(p.timer); clearTimeout(p.waitTimer); pending.delete(id); p.reject(_err(code)); }
    refreshWaiting();
  }

  function _kill(c) {
    try { c.proc.stdin.end(); } catch { /* gone */ }
    try { c.proc.kill('SIGKILL'); } catch { /* gone */ }
  }

  function _start() {
    let proc;
    try { proc = spawnHelper(); } catch { return { proc: null, ready: Promise.reject(_err('secure-storage-helper-failed')) }; }
    const c = { proc, ready: null, exited: false };
    let markReady, markFailed;
    c.ready = new Promise((res, rej) => { markReady = res; markFailed = rej; });
    c.ready.catch(() => {});
    const startTimer = setTimeout(() => { markFailed(_err('secure-storage-timeout')); _kill(c); }, startTimeoutMs);
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.startsWith(LINE_PREFIX)) continue;        // anything else the runtime prints
        let msg = null;
        try { msg = JSON.parse(line.slice(LINE_PREFIX.length)); } catch { continue; }
        if (msg.type === 'ready') { clearTimeout(startTimer); markReady(); continue; }
        if (msg.type === 'fatal') { clearTimeout(startTimer); markFailed(_err('secure-storage-helper-failed')); continue; }
        const p = pending.get(msg.id);
        if (!p) continue;
        clearTimeout(p.timer); clearTimeout(p.waitTimer); pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.value); else p.reject(_err('secure-storage-op-failed'));
        refreshWaiting();
        _armIdle();
      }
    });
    const onGone = () => {
      if (c.exited) return;
      c.exited = true;
      clearTimeout(startTimer);
      markFailed(_err('secure-storage-helper-failed'));
      if (child === c) { child = null; _failAll('secure-storage-helper-failed'); }
    };
    proc.on('exit', onGone);
    proc.on('error', onGone);
    proc.stdin.on('error', () => {});
    return c;
  }

  function _armIdle() {
    clearTimeout(idleTimer);
    if (pending.size || !child) return;
    const c = child;
    idleTimer = setTimeout(() => { if (child === c && !pending.size) { child = null; try { c.proc.stdin.end(); } catch { /* gone */ } } }, idleCloseMs);
  }

  async function _call(op, data) {
    clearTimeout(idleTimer);
    if (!child || child.exited) child = _start();
    const c = child;
    const id = nextId++;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // An unanswered request means a blocked helper: end it (its prompt goes with it).
        pending.delete(id);
        if (child === c) child = null;
        if (c.proc) _kill(c);
        reject(_err('secure-storage-timeout'));
        refreshWaiting();
      }, requestTimeoutMs);
      const waitTimer = setTimeout(() => setWaiting(true), waitingAfterMs);
      pending.set(id, { resolve, reject, timer, waitTimer });
    });
    result.catch(() => {});   // observed below or by the caller; never an unhandled rejection
    try {
      await Promise.race([c.ready, result]);   // a request may time out before the helper is up
    } catch (err) {
      const p = pending.get(id);
      if (p) { clearTimeout(p.timer); clearTimeout(p.waitTimer); pending.delete(id); refreshWaiting(); }
      if (child === c) child = null;
      throw _err(err.code || 'secure-storage-helper-failed');
    }
    try { c.proc.stdin.write(`${JSON.stringify(data === undefined ? { id, op } : { id, op, data })}\n`); }
    catch { /* the exit handler fails the request */ }
    return result;
  }

  return {
    backend,
    identity,
    async: true,
    isAvailable: async () => (await _call('isAvailable')) === true,
    encrypt: async (buf) => {
      const plain = buf.toString('base64');
      return Buffer.from(String(await _call('encrypt', plain)), 'base64');
    },
    decrypt: async (cipher) => Buffer.from(String(await _call('decrypt', Buffer.from(cipher).toString('base64'))), 'base64'),
    isWaiting: () => waiting,
    /** will-quit: end the helper now. */
    close() { clearTimeout(idleTimer); const c = child; child = null; _failAll('secure-storage-helper-failed'); if (c && c.proc) _kill(c); },
  };
}

/**
 * The Electron wiring — a spawnHelper for createHelperSecureStorage: the app's own executable in
 * helper mode, under a throwaway user-data directory removed when it exits (the helper must not
 * touch the real profile; on macOS the Keychain item depends on the app name only). Main process only.
 */
function spawnElectronHelper({ electron = require('electron'), childProcess = require('child_process'), fs = require('fs'), os = require('os'), path = require('path') } = {}) {
  const { app } = electron;
  const { HELPER_FLAG, IDENTITY_ARG } = require('./secureStorageHelperProcess');
  return () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autoingest-keyhelper-'));
    const args = [HELPER_FLAG, `${IDENTITY_ARG}${app.getName()}`, `--user-data-dir=${tmp}`];
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    let proc;
    try {
      proc = childProcess.spawn(process.execPath, app.isPackaged ? args : [app.getAppPath(), ...args], { stdio: ['pipe', 'pipe', 'ignore'], env, windowsHide: true });
    } catch (err) {
      fs.rm(tmp, { recursive: true, force: true }, () => {});
      throw err;
    }
    proc.once('exit', () => fs.rm(tmp, { recursive: true, force: true }, () => {}));
    return proc;
  };
}

module.exports = { createHelperSecureStorage, spawnElectronHelper, START_TIMEOUT_MS, REQUEST_TIMEOUT_MS, WAITING_AFTER_MS };
