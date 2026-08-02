'use strict';
// TRUE crash/relaunch recovery — a real SIGKILL on the actual Electron OS process,
// not a hand-constructed manifest+journal (every prior crash-recovery test in this
// project used the latter, an explicitly plan-sanctioned fallback for when a real
// kill-and-relaunch isn't practical inside a test harness — this is that real test).
//
// Requires playwright-core (see test/metadataPipelineLive.test.js for install notes).
// Run: node test/metadataCrashRelaunch.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = '/Users/funun_pa/Projects/_Auto-Ingest-Software/electron-app-v24';

function log(...args) { console.log('[crash-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function rawFile(p) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.from('not-a-real-raw-file-just-bytes'));
}

async function launchApp(userDataDir) {
  const app = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  app.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  app.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));
  return app;
}

(async () => {
  const userDataDir = await mkTmp('ai-crash-userdata-');
  const archiveRoot = await mkTmp('ai-crash-archive-');
  const sourceDir = await mkTmp('ai-crash-source-');
  log('userDataDir =', userDataDir);
  log('archiveRoot =', archiveRoot);

  // ── Phase 1: launch, start a real metadata batch, kill mid-flight ────────────
  let electronApp = await launchApp(userDataDir);
  electronApp.on('close', () => log('phase 1 app CLOSED'));
  let window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');

  await window.waitForTimeout(1500);
  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  log('splash state:', JSON.stringify(splashState));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Crash Test Operator');
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
      await window.fill('#splashInputName', 'Crash Test Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }
  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  await window.evaluate(async (root) => window.api.setMainArchiveRoot(root), archiveRoot);
  await window.waitForTimeout(300);

  const evDir = path.join(archiveRoot, 'CollCrash', '1448-01-01 _01-Waaz-Hall A-Mumbai');
  const evJsonData = {
    version: 1, hijriDate: '1448-01-01', sequence: 1, eventName: 'Waaz',
    components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
  };
  await window.evaluate(async ({ dir, data }) => window.api.writeEventJson(dir, data), { dir: evDir, data: evJsonData });

  // 40 real files — enough that MAX_CONCURRENCY=2 write queue has a genuine
  // multi-second window where some files are done, some mid-write, some never started.
  const N = 40;
  const fileJobs = [];
  for (let i = 0; i < N; i++) {
    const src = path.join(sourceDir, `img_${i}.cr2`);
    await rawFile(src);
    fileJobs.push({ src, dest: path.join(evDir, 'Jane Doe', `img_${i}.cr2`) });
  }

  // Fire-and-forget from the driver's perspective: commitImportTransaction's own
  // metadata batch (applyBatch) runs asynchronously after the copy resolves, so we
  // don't await the metadata portion — we just need the copy+enqueue to happen,
  // then kill while ExifTool is actively working through the queue.
  const commitPromise = window.evaluate(async ({ jobs, eventJsonPath, ctx }) => {
    return window.api.commitImportTransaction(jobs, eventJsonPath, ctx);
  }, {
    jobs: fileJobs, eventJsonPath: evDir,
    ctx: { groups: [], photographer: 'Jane Doe', liveComps: null, subEventNames: null, collName: 'CollCrash', source: 'crash-e2e-test', importedBy: 'Crash Test Operator' },
  });

  // Give the copy time to finish and metadata writing to genuinely be in flight.
  await window.waitForTimeout(1200);

  const pid = electronApp.process().pid;
  log('killing real OS process, pid =', pid);
  process.kill(pid, 'SIGKILL');
  await commitPromise.catch(() => {}); // the IPC call itself will reject/hang — ignore.
  await new Promise((resolve) => {
    electronApp.process().once('exit', resolve);
    setTimeout(resolve, 5000); // safety timeout in case 'exit' doesn't fire cleanly
  });
  log('phase 1 process confirmed dead');

  // Snapshot: how many sidecars exist right after the kill (some subset — proves
  // the kill genuinely landed mid-batch, not before-any-write or after-all-writes).
  let sidecarsAfterKill = 0;
  for (let i = 0; i < N; i++) {
    const sidecar = path.join(evDir, 'Jane Doe', `img_${i}.xmp`);
    if (fs.existsSync(sidecar)) sidecarsAfterKill++;
  }
  log(`sidecars present immediately after kill: ${sidecarsAfterKill}/${N}`);
  check(sidecarsAfterKill > 0 && sidecarsAfterKill < N, `kill landed genuinely mid-batch (0 < ${sidecarsAfterKill} < ${N})`);

  // ── Phase 2: relaunch pointed at the SAME userData/archive, let recovery run ──
  const electronApp2 = await launchApp(userDataDir);
  let window2 = await electronApp2.firstWindow({ timeout: 60000 });
  await window2.waitForLoadState('domcontentloaded');
  log('phase 2 relaunched, window loaded');

  // resumeInterruptedBatches fires 3s after whenReady — wait generously past that,
  // plus real ExifTool time for the interrupted files to actually complete.
  await window2.waitForTimeout(15000);

  const finalEventJson = JSON.parse(await fsp.readFile(path.join(evDir, 'event.json'), 'utf8'));
  log('final event.json metadataState:', JSON.stringify(finalEventJson.metadataState));
  check(finalEventJson.metadataState?.state === 'metadata-complete', 'after real crash+relaunch, event.json metadataState reaches metadata-complete');
  check(finalEventJson.metadataState?.counts?.complete === N, `all ${N} files durably counted complete (got ${finalEventJson.metadataState?.counts?.complete})`);

  // Real ExifTool read-back on every file — no duplicate keywords, correct Creator.
  const { ExifTool } = require('exiftool-vendored');
  const et = new ExifTool();
  let allCorrect = true;
  let anyDuplicateKeywords = false;
  try {
    for (let i = 0; i < N; i++) {
      const sidecar = path.join(evDir, 'Jane Doe', `img_${i}.xmp`);
      const tags = await et.read(sidecar);
      const creator = tags.Creator?.[0] || tags.Creator;
      if (creator !== 'Jane Doe') { allCorrect = false; log(`img_${i}: wrong/missing Creator:`, creator); }
      const subject = Array.isArray(tags.Subject) ? tags.Subject : (tags.Subject ? [tags.Subject] : []);
      const seen = new Set();
      for (const s of subject) {
        const norm = String(s).trim().toLowerCase();
        if (seen.has(norm)) { anyDuplicateKeywords = true; log(`img_${i}: duplicate keyword "${s}"`); }
        seen.add(norm);
      }
    }
  } finally {
    await et.end().catch(() => {});
  }
  check(allCorrect, 'every file has the correct Creator after crash-recovery (no lost/wrong writes)');
  check(!anyDuplicateKeywords, 'no file has duplicate keywords after crash-recovery (idempotent resume)');

  // No active batch left uncompacted for this event — recovery's own invariant
  // (never compact before event.json durably reflects the outcome) should mean
  // by the time metadataState shows metadata-complete, the batch is gone from
  // the active queue dir. Locate userData's metadata-queue dir and check.
  const queueDir = path.join(userDataDir, 'metadata-queue');
  let activeManifests = [];
  try { activeManifests = (await fsp.readdir(queueDir)).filter(f => f.endsWith('.manifest.json')); } catch { /* dir may not exist if nothing was ever queued, not expected here */ }
  log('active manifests remaining after recovery:', activeManifests);
  check(activeManifests.length === 0, 'no active (uncompacted) batch manifest remains after successful recovery');

  log('=== SUMMARY:', failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`, '===');
  await electronApp2.close().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[crash-e2e] FATAL:', err);
  process.exit(1);
});
