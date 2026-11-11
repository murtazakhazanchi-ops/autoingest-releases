'use strict';
// Test-process side of live-test isolation (see liveTestPreload.js for the Electron side).
//
//   const iso = prepareIsolatedApp({ tag: 'durability', work, projectRoot });
//   const app = await electron.launch({ args: [...iso.args, '--user-data-dir=' + ud, '--no-sandbox'], env: iso.env(ud), cwd: projectRoot });
//   await verifyIsolation(app, iso, ud);          // throws unless stub + guard + test identity + temp userData
//   ... test ...
//   const q = quitGuardSummary(iso);              // { blocked, unguarded, deliberate, exits, isolated, failed }
//
// A run is never silently "rescued": blocked external quits are counted and printed, an
// external quit the guard could not cancel is reported as unguarded, and a launch whose isolation
// cannot be proven throws before the test touches anything.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PRELOAD = path.join(__dirname, 'liveTestPreload.js');
const NAME_RE = /^autoingest-[a-z0-9-]+-livetest$/;
const PROD_KEYCHAIN_ITEMS = ['auto-ingest Safe Storage', 'AutoIngest Safe Storage'];

/**
 * Writes a wrapper app named autoingest-<tag>-livetest that loads the real main.js.
 * @param {{ tag: string, work: string, projectRoot: string, drives?: object[] }} opts
 */
function prepareIsolatedApp({ tag, work, projectRoot, drives = [] }) {
  const name = `autoingest-${tag}-livetest`;
  if (!NAME_RE.test(name)) throw new Error(`invalid live-test tag: ${tag}`);
  const wrapperDir = path.join(work, 'wrapper-app');
  fs.mkdirSync(wrapperDir, { recursive: true });
  fs.writeFileSync(path.join(wrapperDir, 'package.json'), JSON.stringify({ name, version: '0.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(wrapperDir, 'index.js'), "'use strict';\nrequire(process.env.AI_TEST_PROJECT_ROOT + '/main/main.js');\n");
  const drivesFile = path.join(work, 'drives.json');
  fs.writeFileSync(drivesFile, JSON.stringify(drives));
  const isoLog = path.join(work, 'live-iso.jsonl');
  fs.writeFileSync(isoLog, '');
  return {
    name, wrapperDir, drivesFile, isoLog, keychainItem: `${name} Safe Storage`,
    args: ['-r', PRELOAD, wrapperDir],
    env: (userData) => ({ ...process.env, AI_TEST_PROJECT_ROOT: projectRoot, AI_TEST_DRIVES_FILE: drivesFile, AI_TEST_ISO_LOG: isoLog, AI_TEST_USERDATA: userData }),
  };
}

/** Throws unless the launched app proves stub, guard, test identity and the expected userData. */
async function verifyIsolation(app, iso, userData, { requireGuard = true } = {}) {
  const got = await app.evaluate(() => global.__aiLiveIso || null);
  const want = fs.realpathSync(userData);
  const problems = [];
  if (!got) problems.push('preload did not run');
  else {
    if (!got.stubbed) problems.push('drivelist stub inactive');
    if (requireGuard && !got.guard) problems.push('quit guard inactive');
    if (got.name !== iso.name || !NAME_RE.test(got.name)) problems.push('app identity is not the test identity');
    if (got.userData !== want) problems.push('userData is not the temp profile');
  }
  if (problems.length) {
    await app.evaluate(({ app: a }) => a.exit(99)).catch(() => {});
    throw new Error('ISOLATION NOT ESTABLISHED: ' + problems.join('; '));
  }
  return got;
}

function readIsoLog(iso) {
  try { return fs.readFileSync(iso.isoLog, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
}

/** Counts from the guard log across every launch of this run (restarts included). */
function quitGuardSummary(iso) {
  const ev = readIsoLog(iso);
  const n = (t) => ev.filter(e => e.type === t).length;
  const exited = new Set(ev.filter(e => e.type === 'exit').map(e => e.pid));
  return {
    isolated: n('isolated'), failed: n('isolation-failed'),
    // Launches whose process ended without its exit handler running: an intentional SIGKILL
    // crash, or something the test did not ask for (OS termination, sleep, a real crash).
    // Tests assert this equals the number of crashes they inflicted.
    endedWithoutExit: ev.filter(e => e.type === 'isolated' && !exited.has(e.pid)).length,
    blocked: n('external-quit-blocked'), unguarded: n('external-quit-unguarded'),
    deliberate: n('deliberate-quit') + n('deliberate-exit'),
    exits: ev.filter(e => e.type === 'exit').map(e => ({ code: e.code, deliberate: e.deliberate, blocked: e.blocked })),
    blockedAt: ev.filter(e => e.type === 'external-quit-blocked').map(e => e.at),
  };
}

/** One-line report for a test's summary; never prints paths, names or identifiers. */
function formatQuitGuardSummary(q) {
  return `quit-guard: launches=${q.isolated} externalQuitsBlocked=${q.blocked}${q.blocked ? ' (' + q.blockedAt.join(', ') + ')' : ''} unguarded=${q.unguarded} deliberateQuits=${q.deliberate} endedWithoutExit=${q.endedWithoutExit} isolationFailures=${q.failed}`;
}

const keychainHas = (service) => { try { execFileSync('security', ['find-generic-password', '-s', service], { stdio: 'ignore' }); return true; } catch { return false; } };

/** Production Keychain presence snapshot (existence only — never read or modified). */
const prodKeychainSnapshot = () => PROD_KEYCHAIN_ITEMS.map(keychainHas);

/** Deletes this run's test-identity Keychain item, and only if it did not exist before the run. */
function removeTestKeychainItem(iso, existedBefore) {
  if (!NAME_RE.test(iso.name) || existedBefore) return false;
  if (!keychainHas(iso.keychainItem)) return true;
  try { execFileSync('security', ['delete-generic-password', '-s', iso.keychainItem], { stdio: 'ignore' }); } catch { /* reported by the caller's check */ }
  return !keychainHas(iso.keychainItem);
}

module.exports = {
  PRELOAD, NAME_RE, prepareIsolatedApp, verifyIsolation, readIsoLog, quitGuardSummary,
  formatQuitGuardSummary, keychainHas, prodKeychainSnapshot, removeTestKeychainItem,
};
