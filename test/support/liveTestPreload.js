'use strict';
// Live-test isolation preload for the Electron MAIN process — loaded only by live tests, as
// `electron -r test/support/liveTestPreload.js <wrapper-app>`. test/ is outside package.json
// build.files, so this file never ships in a packaged build, and it refuses to run inside one.
//
// It establishes, or fails closed (exit 97/98):
//   1. drivelist stubbed from $AI_TEST_DRIVES_FILE — no real card or drive is ever listed;
//   2. a test-only app identity (name must match /^autoingest-[a-z0-9-]+-livetest$/), checked at
//      will-finish-launching, i.e. before 'ready' and therefore before any Keychain access;
//   3. the userData path the harness created ($AI_TEST_USERDATA, if set) — verified, not set: the
//      harness fixes it with --user-data-dir (or the wrapper's setPath) before main.js loads;
//   4. the external-Quit guard (liveTestQuitGuard.js) — unless AI_TEST_QUIT_GUARD=off.


const fs = require('fs');
const { app } = require('electron');
const { installQuitGuard } = require('./liveTestQuitGuard');

const env = process.env;
const NAME_RE = /^autoingest-[a-z0-9-]+-livetest$/;

function record(entry) {
  try { fs.appendFileSync(env.AI_TEST_ISO_LOG, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry }) + '\n'); } catch { /* the harness treats a missing log as not isolated */ }
}
function fail(code, reason) {
  record({ type: 'isolation-failed', reason });
  console.error('[live-iso] ISOLATION FAILED:', reason);
  // Electron's process.exit() only schedules the exit and returns, letting the caller (and
  // main.js) keep running; reallyExit ends the process here, and the throw covers its absence.
  if (typeof process.reallyExit === 'function') process.reallyExit(code);
  process.exit(code);
  throw new Error('[live-iso] isolation failed: ' + reason);
}

if (!env.AI_TEST_ISO_LOG || !env.AI_TEST_PROJECT_ROOT || !env.AI_TEST_DRIVES_FILE) fail(97, 'missing AI_TEST_ISO_LOG / AI_TEST_PROJECT_ROOT / AI_TEST_DRIVES_FILE');
if (app.isPackaged) fail(97, 'refusing to load into a packaged app');

// ── 1. drivelist stub ──────────────────────────────────────────────────────────────────────────
const dlPath = require.resolve('drivelist', { paths: [env.AI_TEST_PROJECT_ROOT] });
const dl = require(dlPath);
const stubList = async () => { try { return JSON.parse(fs.readFileSync(env.AI_TEST_DRIVES_FILE, 'utf8')); } catch { return []; } };
dl.list = stubList;
if (require(dlPath).list !== stubList) fail(97, 'drivelist stub not active');

// ── 4. external-Quit guard ─────────────────────────────────────────────────────────────────────
// AI_TEST_QUIT_GUARD=off exists only for the guard's own control case (proving an unguarded app
// really quits); the harness rejects a guard-less launch unless the caller opts out explicitly.
let guard = null;
if (env.AI_TEST_QUIT_GUARD !== 'off') {
  try { guard = installQuitGuard(app, record); } catch { fail(97, 'quit guard could not be installed'); }
  if (!guard.isActive()) fail(97, 'quit guard could not be installed');
}

// ── 2./3. identity and userData, before 'ready' (and so before any Keychain access) ────────────
app.once('will-finish-launching', () => {
  const name = app.getName();
  if (!NAME_RE.test(name)) fail(98, 'app name is not a test-only identity');
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const userData = real(app.getPath('userData'));
  if (env.AI_TEST_USERDATA && userData !== real(env.AI_TEST_USERDATA)) fail(98, 'userData is not the temp profile the harness created');
  global.__aiLiveIso = { name, userData, stubbed: require(dlPath).list === stubList, guard: !!guard && guard.isActive() };
  record({ type: 'isolated', name, stubbed: global.__aiLiveIso.stubbed, guard: global.__aiLiveIso.guard });
});

process.on('exit', (code) => { const st = guard ? guard.state : null; record({ type: 'exit', code, deliberate: st && st.deliberate ? st.deliberate.via : null, blocked: st ? st.blocked : 0 }); });
