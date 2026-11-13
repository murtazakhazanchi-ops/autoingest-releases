/**
 * secureStorageHelperProcess.js — the child side of the secure-storage helper (CAM-001).
 *
 * macOS: Electron safeStorage reads the "<app name> Safe Storage" Keychain item synchronously on
 * the calling thread, and the Keychain may hold that call behind an access prompt (a new
 * ad-hoc-signed build, a locked keychain). In the main process that froze AutoIngest. The main
 * process therefore never calls safeStorage on macOS; it launches the app's OWN executable with
 * HELPER_FLAG, and that short-lived, windowless process makes the safeStorage calls instead. It is
 * the same signed binary under the same app name, so it uses the same Keychain item with the same
 * access rules — no key migration, no other Keychain item, no bypassed prompt.
 *
 * Protocol (stdin/stdout, one JSON object per line, lines prefixed with LINE_PREFIX):
 *   child → parent  { type: 'ready' } | { type: 'fatal', reason }
 *   parent → child  { id, op: 'isAvailable' | 'encrypt' | 'decrypt', data?: base64 }
 *   child → parent  { id, ok: true, value } | { id, ok: false, error: 'failed' }
 * Key material crosses only this private pipe — never a log, a file or a renderer. The child exits
 * when its stdin closes (the parent finished or died) or after IDLE_EXIT_MS without a request.
 *
 * Test seam: AUTOINGEST_KEY_HELPER_TEST (JSON { stallMs, result: 'deny'|'crash' }) simulates a
 * Keychain call that blocks this process, a refusal, or a crash. It is ignored under the
 * production identities.
 */

'use strict';

const HELPER_FLAG = '--autoingest-key-helper';
const IDENTITY_ARG = '--autoingest-key-helper-identity=';
const LINE_PREFIX = '@@aikh ';
const IDLE_EXIT_MS = 60000;
const PRODUCTION_IDENTITIES = new Set(['auto-ingest', 'AutoIngest']);

function _testSeam(name, env) {
  if (PRODUCTION_IDENTITIES.has(name) || !env.AUTOINGEST_KEY_HELPER_TEST) return null;
  try { return JSON.parse(env.AUTOINGEST_KEY_HELPER_TEST); } catch { return null; }
}

/** Blocks this process's main thread, as a held Keychain call would. */
function _stall(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(ms, 600000));
}

function runKeyHelper({ electron = require('electron'), argv = process.argv, env = process.env, stdin = process.stdin, stdout = process.stdout } = {}) {
  const { app, safeStorage } = electron;
  const send = (msg) => { try { stdout.write(`${LINE_PREFIX}${JSON.stringify(msg)}\n`); } catch { /* parent gone */ } };
  const expected = (argv.find(a => a.startsWith(IDENTITY_ARG)) || '').slice(IDENTITY_ARG.length);
  try { if (app.setActivationPolicy) app.setActivationPolicy('accessory'); } catch { /* no Dock icon is cosmetic */ }
  try { app.disableHardwareAcceleration(); } catch { /* no windows anyway */ }
  app.on('window-all-closed', () => {});

  app.whenReady().then(() => {
    const name = app.getName();
    // Fail closed: under any other identity safeStorage would use (or create) another Keychain item.
    if (!expected || name !== expected) { send({ type: 'fatal', reason: 'identity-mismatch' }); app.exit(3); return; }
    const seam = _testSeam(name, env);
    let idle = null;
    const armIdle = () => { clearTimeout(idle); idle = setTimeout(() => app.exit(0), IDLE_EXIT_MS); };
    const handle = (req) => {
      if (seam && seam.stallMs) { _stall(Number(seam.stallMs)); seam.stallMs = 0; }
      if (seam && seam.result === 'crash') { app.exit(70); return; }
      try {
        if (req.op === 'isAvailable') {
          send({ id: req.id, ok: true, value: seam && seam.result === 'deny' ? false : safeStorage.isEncryptionAvailable() });
        } else if (req.op === 'encrypt' || req.op === 'decrypt') {
          if (seam && seam.result === 'deny') throw new Error('denied');
          const input = Buffer.from(String(req.data || ''), 'base64');
          const out = req.op === 'encrypt' ? safeStorage.encryptString(input.toString('base64')) : Buffer.from(safeStorage.decryptString(input), 'base64');
          send({ id: req.id, ok: true, value: out.toString('base64') });
          out.fill(0); input.fill(0);
        } else {
          send({ id: req.id, ok: false, error: 'failed' });
        }
      } catch {
        send({ id: req.id, ok: false, error: 'failed' });   // never the message: it could echo input
      }
    };
    let buf = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => {
      armIdle();
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let req = null;
        try { req = JSON.parse(line); } catch { /* ignore */ }
        if (req && Number.isInteger(req.id)) handle(req);
      }
    });
    stdin.on('end', () => app.exit(0));
    stdin.on('error', () => app.exit(0));
    armIdle();
    send({ type: 'ready' });
  });
}

module.exports = { runKeyHelper, HELPER_FLAG, IDENTITY_ARG, LINE_PREFIX, PRODUCTION_IDENTITIES };
