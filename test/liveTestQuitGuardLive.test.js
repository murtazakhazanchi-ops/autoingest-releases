'use strict';
// LIVE: the test-only external-Quit guard (test/support/liveTestPreload.js) on the real main.js.
//
//   A  a real macOS Quit AppleEvent sent to THIS test app's pid is blocked and logged; the app
//      keeps working afterwards
//   B  a deliberate, test-controlled close (Playwright app.close() → app.quit()) still quits,
//      exit code 0, recorded as deliberate
//   C  a real crash (SIGKILL) is still a crash — the guard neither hides it nor fakes an exit —
//      and a relaunch on the same profile recovers normally
//   D  control: the same AppleEvent with the guard off really does quit the app, so A's survival
//      is the guard's doing, and production (which never loads the preload) quits as before
//   E  fail-closed: a wrapper without a test-only identity exits 98 before 'ready'; missing test
//      env exits 97 — neither creates a Keychain item
//
// The Quit is targeted by pid (NSRunningApplication.terminate via JXA): no other app, Electron
// instance or test session receives it. Isolation: temp profile, drivelist stub, test identity.
// Run: node test/liveTestQuitGuardLive.test.js     (macOS only)

const { _electron: electron } = require('playwright-core');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const H = require('./support/liveTestHarness');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));

let failures = 0;
const log = (...a) => console.log('[quit-guard-live]', ...a);
const check = (c, m) => { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function sendQuitAppleEvent(pid) {
  const js = `ObjC.import('AppKit'); var a = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${Number(pid)}); a.isNil() ? 'nil' : (a.terminate ? 'sent' : 'refused')`;
  return execFileSync('osascript', ['-l', 'JavaScript', '-e', js], { encoding: 'utf8' }).trim();
}

async function passSplash(app) {
  const w = await app.firstWindow({ timeout: 60000 });
  await w.waitForTimeout(1500);
  const mainP = app.waitForEvent('window', { predicate: p => p.url().endsWith('index.html'), timeout: 30000 });
  await w.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    if (vis('splashSelect')) { const u = document.querySelector('.splash-user-item'); if (u) { u.click(); document.getElementById('splashSelectStartBtn').click(); } else document.getElementById('splashNewProfileBtn').click(); }
    if (vis('splashWelcome')) document.getElementById('splashContinueBtn').click();
  });
  await sleep(300);
  try { await w.fill('#splashInputName', 'Guard Operator', { timeout: 2000 }); await w.fill('#splashInputRole', 'QA'); await w.click('#splashCreateStartBtn'); } catch { /* existing profile */ }
  const main = await mainP;
  await main.waitForLoadState('domcontentloaded');
  return main;
}

async function launch(iso, ud, { guard = true } = {}) {
  const env = iso.env(ud);
  if (!guard) env.AI_TEST_QUIT_GUARD = 'off';
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [...iso.args, '--user-data-dir=' + ud, '--no-sandbox'], cwd: PROJECT_ROOT, env, timeout: 60000 });
  await H.verifyIsolation(app, iso, ud, { requireGuard: guard });
  const main = await passSplash(app);
  const proc = app.process();
  const exited = new Promise(r => proc.once('exit', (code, signal) => r({ code, signal })));
  return { app, main, pid: proc.pid, exited };
}

const within = (p, ms) => Promise.race([p, sleep(ms).then(() => null)]);

function spawnRaw(args, env) {
  return new Promise((resolve) => {
    const p = spawn(ELECTRON_BIN, args, { env, stdio: 'ignore' });
    const t = setTimeout(() => { p.kill('SIGKILL'); resolve({ code: null, timedOut: true }); }, 30000);
    p.once('exit', (code) => { clearTimeout(t); resolve({ code, timedOut: false }); });
  });
}

(async () => {
  if (process.platform !== 'darwin') { log('SKIP — macOS only'); return; }
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-quitguard-live-'));
  const ud = path.join(work, 'userData'); await fsp.mkdir(ud);
  const iso = H.prepareIsolatedApp({ tag: 'quitguard', work, projectRoot: PROJECT_ROOT });
  const prodBefore = H.prodKeychainSnapshot();
  const testItemBefore = H.keychainHas(iso.keychainItem);
  let cur = null;
  try {
    // ── A: external Quit blocked ────────────────────────────────────────────────────────────────
    cur = await launch(iso, ud);
    check(true, 'isolation proven (test identity, temp userData, drivelist stub, guard active)');
    check(sendQuitAppleEvent(cur.pid) === 'sent', 'A: Quit AppleEvent delivered to the test app pid only');
    const earlyExit = await within(cur.exited, 4000);
    check(earlyExit === null && alive(cur.pid), 'A: external Quit did NOT shut the app down');
    const stillWorks = await cur.main.evaluate(() => typeof window.api === 'object' && document.readyState === 'complete').catch(() => false);
    check(stillWorks, 'A: renderer and preload API still respond after the blocked Quit');
    let q = H.quitGuardSummary(iso);
    check(q.blocked === 1 && q.deliberate === 0, `A: exactly one external quit recorded as blocked, none as deliberate (${H.formatQuitGuardSummary(q)})`);
    const blockedEntry = H.readIsoLog(iso).find(e => e.type === 'external-quit-blocked');
    check(!!blockedEntry && blockedEntry.windows >= 1 && typeof blockedEntry.uptimeSec === 'number' && /AppleEvent/.test(blockedEntry.likelySource), 'A: blocked entry carries diagnostic context (time, uptime, windows, focus, likely source)');
    check(!JSON.stringify(blockedEntry).includes(work) && !JSON.stringify(blockedEntry).includes(os.homedir()), 'A: diagnostic entry contains no file paths');

    // ── B: deliberate close still quits ─────────────────────────────────────────────────────────
    await cur.app.close();
    const bExit = await within(cur.exited, 20000);
    check(!!bExit && bExit.code === 0 && bExit.signal === null, `B: deliberate app.close() quits normally with exit code 0 (${JSON.stringify(bExit)})`);
    q = H.quitGuardSummary(iso);
    check(q.deliberate >= 1 && q.exits.length === 1 && q.exits[0].deliberate === 'app.quit' && q.exits[0].code === 0, `B: exit recorded as deliberate app.quit (${JSON.stringify(q.exits)})`);
    check(q.blocked === 1, 'B: the deliberate quit was not counted as external');
    cur = null;

    // ── C: real crash is still a crash; relaunch recovers ───────────────────────────────────────
    cur = await launch(iso, ud);
    process.kill(cur.pid, 'SIGKILL');
    const cExit = await within(cur.exited, 10000);
    check(!!cExit && cExit.signal === 'SIGKILL' && cExit.code === null, `C: SIGKILL is reported as a crash (signal SIGKILL, no exit code) — not masked (${JSON.stringify(cExit)})`);
    q = H.quitGuardSummary(iso);
    check(q.exits.length === 1 && q.blocked === 1, 'C: the guard recorded no exit and no blocked quit for the crashed instance');
    check(q.endedWithoutExit === 1, `C: the harness counts the crashed launch as ended without an exit record (${q.endedWithoutExit}), so an unintended termination cannot pass unnoticed`);
    cur = await launch(iso, ud);
    const recovered = await cur.main.evaluate(() => typeof window.api === 'object').catch(() => false);
    check(recovered, 'C: relaunch on the same profile after the crash starts normally');
    await cur.app.close();
    const c2 = await within(cur.exited, 20000);
    check(!!c2 && c2.code === 0, 'C: recovered instance closes deliberately with exit code 0');
    cur = null;

    // ── D: control — guard off, the same Quit really quits ──────────────────────────────────────
    cur = await launch(iso, ud, { guard: false });
    check(sendQuitAppleEvent(cur.pid) === 'sent', 'D: Quit AppleEvent delivered (guard off)');
    const dExit = await within(cur.exited, 20000);
    check(!!dExit && dExit.code === 0 && !alive(cur.pid), `D: without the guard the external Quit shuts the app down cleanly (${JSON.stringify(dExit)}) — unchanged production shutdown path`);
    cur = null;

    // ── E: fail-closed isolation ────────────────────────────────────────────────────────────────
    const bad = path.join(work, 'bad-wrapper'); await fsp.mkdir(bad);
    await fsp.writeFile(path.join(bad, 'package.json'), JSON.stringify({ name: 'autoingest-not-a-test-identity', version: '0.0.0', main: 'index.js' }));
    await fsp.writeFile(path.join(bad, 'index.js'), "require(process.env.AI_TEST_PROJECT_ROOT + '/main/main.js');\n");
    const badUd = path.join(work, 'bad-userData'); await fsp.mkdir(badUd);
    const e1 = await spawnRaw([...iso.args.slice(0, 2), bad, '--user-data-dir=' + badUd, '--no-sandbox'], iso.env(badUd));
    check(e1.code === 98, `E: non-test identity exits 98 before 'ready' (${JSON.stringify(e1)})`);
    const envNoLog = { ...iso.env(badUd) }; delete envNoLog.AI_TEST_ISO_LOG;
    const e2 = await spawnRaw([...iso.args, '--user-data-dir=' + badUd, '--no-sandbox'], envNoLog);
    check(e2.code === 97, `E: missing test environment exits 97 (${JSON.stringify(e2)})`);
    check(!H.keychainHas('autoingest-not-a-test-identity Safe Storage'), 'E: refused launch created no Keychain item');
    const isoEv = H.readIsoLog(iso);
    check(isoEv.some(e => e.type === 'isolation-failed'), 'E: refusal recorded in the isolation log');
    check(!isoEv.some(e => e.type === 'isolated' && e.name !== iso.name), 'E: execution stopped at the refusal (no "isolated" record for the refused identity)');
  } catch (err) {
    failures++; log('FAIL — unexpected error:', err && err.message);
  } finally {
    if (cur) { try { process.kill(cur.pid, 'SIGKILL'); } catch { /* already gone */ } }
    check(H.removeTestKeychainItem(iso, testItemBefore), 'test Keychain item absent after the run');
    check(JSON.stringify(H.prodKeychainSnapshot()) === JSON.stringify(prodBefore), 'production Keychain items unchanged (presence only, never read)');
    log(H.formatQuitGuardSummary(H.quitGuardSummary(iso)));
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURE(S)`);
    process.exitCode = failures === 0 ? 0 : 1;
  }
})();
