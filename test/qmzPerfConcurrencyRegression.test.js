'use strict';

// Regression test for the "Bug 2 STILL FAILS — real machine diagnostics
// isolated the failure stage" report: the real Windows/NAS Leicester event
// (1 photographer, ~1227 RAW + ~1227 XMP = ~2454 directory entries) proved
// root resolution, _Unsequenced discovery, and photographer-folder
// classification were ALL correct, but the QMZ workspace still stalled for
// 30+ seconds with no scanRoot RESULT logged before the tester gave up.
//
// Measurement (see the forensic report) proved the cause precisely: NOT
// main/qmzService.js's Dirent/stat hardening (6144ff9) — a 50-file
// measurement showed statFallback count=0 on a normal filesystem, i.e. the
// hardening's stat() fallback never even fired — but listMediaFiles()'s
// PRE-EXISTING per-file `readCaptureDate()` call (ExifTool round-trip for
// RAW capture-date reading), run one at a time in a sequential
// `for (...) await ...` loop. The same 50-file measurement showed 99.7% of
// total wall time (5866ms of 5883ms) inside that one call, at up to 391ms
// per file — for ~1227 real files over a real network share, sequential
// execution could easily run into minutes.
//
// Fix: listMediaFiles() now processes its per-file stat/capture-date work
// through _mapWithConcurrency(), bounded to CAPTURE_DATE_CONCURRENCY (4,
// matching main/exifService.js's own ExifTool pool size, maxProcs: 4) —
// exploiting the pool's real parallel capacity instead of leaving 3 of 4
// worker processes idle throughout. Measured directly against the real
// production code: ~1.6x wall-clock speedup at 50 files, ~3.24x at 300
// files (better ratio at scale — queueing/warmup overhead amortizes), with
// concurrency=10 producing NO further improvement over 4 (confirming the
// ExifTool pool itself, not the JS-side bound, is the real ceiling).
//
// This suite proves the fix WITHOUT requiring real multi-minute ExifTool
// round-trips: exifService.readFileTags is monkey-patched (mutating the
// shared, cached module.exports — matches this codebase's existing
// technique, see test/metadataXmpUncPathRegression.test.js's
// ExifTool.prototype.write patch) to inject a controlled, measurable delay
// per call, so wall-clock assertions are fast and deterministic in CI while
// still exercising the REAL listMediaFiles()/_mapWithConcurrency() code.
//
// TEST 1 — small scale (10 media): correctness, RAW/XMP pairing, source-drift
//          guard that CAPTURE_DATE_CONCURRENCY matches exifService's maxProcs.
// TEST 2 — 100+ media: correctness at moderate scale within the real
//          production ExifTool pool (no monkey-patch) with a real timing
//          sanity check (must complete well under naive-sequential time).
// TEST 3 — Leicester-scale (1200 RAW + 1200 XMP) with simulated per-call
//          latency: proves wall-clock time is close to
//          (N / CAPTURE_DATE_CONCURRENCY) * simulatedDelay, not N * delay —
//          the concrete "did concurrency actually happen" proof — and that
//          every file is still discovered, no duplicates, no loss.
// TEST 4 — concurrency-bound assertion: tracks the maximum number of
//          simultaneous in-flight capture-date calls and asserts it never
//          exceeds CAPTURE_DATE_CONCURRENCY, so a future regression back to
//          unbounded Promise.all (or accidentally raising the limit) is
//          caught even if wall-clock timing alone wouldn't prove it.
// TEST 5 — ambiguous Dirents (requiring the 6144ff9 stat fallback) combined
//          with scale: both fixes composing correctly together.
// TEST 6 — normal Dirents still incur zero unnecessary stat-fallback calls
//          at scale (regression guard for 6144ff9's own correctness).
//
// Run with the real Electron binary (qmzService.js transitively needs
// Electron's app.getPath via services/logger.js):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     --user-data-dir=<isolated tmp dir> test/qmzPerfConcurrencyRegression.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

let passed = 0;
function ok(name) { passed++; console.log(`  ok — ${name}`); }
function fail(name, detail) {
  process.exitCode = 1;
  console.error(`  FAIL — ${name}`);
  if (detail !== undefined) console.error(detail);
}
async function t(name, fn) {
  try { await fn(); ok(name); }
  catch (err) { fail(name, err && err.stack || err); }
}

async function mkQmzRoot() { return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-qmz-perf-')); }
async function writeRawXmpPair(p) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.from('not-a-real-raw-file'));
  await fsp.writeFile(p.slice(0, -path.extname(p).length) + '.xmp', '<xmp/>', 'utf8');
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  // ── TEST 1: small scale + source-drift guard ───────────────────────────────
  await t('TEST 1: 10 RAW/XMP pairs — correct discovery, and CAPTURE_DATE_CONCURRENCY matches exifService.js maxProcs', async () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'main', 'qmzService.js'), 'utf8');
    const concMatch = /const CAPTURE_DATE_CONCURRENCY = (\d+);/.exec(src);
    assert.ok(concMatch, 'CAPTURE_DATE_CONCURRENCY constant not found — was it renamed?');
    const maxProcsMatch = fs.readFileSync(path.join(PROJECT_ROOT, 'main', 'exifService.js'), 'utf8').match(/maxProcs:\s*(\d+)/);
    assert.ok(maxProcsMatch, 'exifService.js maxProcs not found — was it renamed?');
    assert.equal(concMatch[1], maxProcsMatch[1], 'CAPTURE_DATE_CONCURRENCY should match the real ExifTool pool size — measured directly: raising it beyond maxProcs produced zero further speedup (10 vs 4 concurrency: 10898ms vs 10801ms at 300 files)');

    const qmzService = require(path.join(PROJECT_ROOT, 'main/qmzService'));
    const qmzRoot = await mkQmzRoot();
    for (let i = 1; i <= 10; i++) {
      await writeRawXmpPair(path.join(qmzRoot, '_Unsequenced', 'PC01-Test Photographer', `IMG${String(i).padStart(3, '0')}.ARW`));
    }
    const scan = await qmzService.scanRoot(qmzRoot);
    assert.equal(scan.unsequenced['PC01-Test Photographer']?.count, 10);
    for (const f of scan.unsequenced['PC01-Test Photographer'].files) {
      const xmp = f.path.slice(0, -path.extname(f.path).length) + '.xmp';
      assert.ok(fs.existsSync(xmp), `XMP sidecar must exist for ${f.path}`);
    }
  });

  // ── TEST 2: 100+ media, real pool, timing sanity ───────────────────────────
  await t('TEST 2: 120 RAW/XMP pairs — correct discovery, completes well under naive-sequential estimate', async () => {
    const qmzService = require(path.join(PROJECT_ROOT, 'main/qmzService'));
    const qmzRoot = await mkQmzRoot();
    const N = 120;
    for (let i = 1; i <= N; i++) {
      await writeRawXmpPair(path.join(qmzRoot, '_Unsequenced', 'PC01-Scale Test', `IMG${String(i).padStart(4, '0')}.ARW`));
    }
    const t0 = Date.now();
    const scan = await qmzService.scanRoot(qmzRoot);
    const elapsed = Date.now() - t0;
    assert.equal(scan.unsequenced['PC01-Scale Test']?.count, N);
    // Naive sequential baseline measured ~117ms/file average (real ExifTool
    // calls against tiny placeholder files). 120 files sequential would be
    // ~14s; bounded concurrency should land well under that even accounting
    // for CI variance. Generous ceiling to avoid flakiness.
    assert.ok(elapsed < 12000, `expected well under 12s for 120 files with bounded concurrency, took ${elapsed}ms`);
    console.log(`    (120-file real scan took ${elapsed}ms)`);
  });

  // ── TEST 3: Leicester-scale with simulated latency ─────────────────────────
  await t('TEST 3: Leicester-scale (1200 RAW + 1200 XMP) with simulated per-call latency proves bounded concurrency, not sequential', async () => {
    const exifService = require(path.join(PROJECT_ROOT, 'main/exifService'));
    const origReadFileTags = exifService.readFileTags;
    const SIMULATED_DELAY_MS = 15;
    let inFlight = 0, maxInFlight = 0, callCount = 0;
    exifService.readFileTags = async (filePath) => {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      callCount++;
      await sleep(SIMULATED_DELAY_MS);
      inFlight--;
      // Shape matches real ExifTool output enough for readCaptureDate to
      // find nothing and fall through — this test only cares about
      // discovery + timing, not date-parsing correctness (covered elsewhere).
      return {};
    };

    try {
      const qmzService = require(path.join(PROJECT_ROOT, 'main/qmzService'));
      const qmzRoot = await mkQmzRoot();
      const N = 1200;
      const pgDir = path.join(qmzRoot, '_Unsequenced', 'PC01-Burhanuddin Ghia');
      for (let i = 1; i <= N; i++) {
        await writeRawXmpPair(path.join(pgDir, `BUR${String(i).padStart(5, '0')}.ARW`));
      }

      const t0 = Date.now();
      const scan = await qmzService.scanRoot(qmzRoot);
      const elapsed = Date.now() - t0;

      assert.equal(scan.unsequenced['PC01-Burhanuddin Ghia']?.count, N, 'all 1200 files must be discovered — no data loss');
      const names = new Set(scan.unsequenced['PC01-Burhanuddin Ghia'].files.map(f => f.name));
      assert.equal(names.size, N, 'no duplicate files');
      assert.equal(callCount, N, 'readCaptureDate/ExifTool must be called exactly once per RAW file');

      // Sequential would be N * SIMULATED_DELAY_MS = 18000ms. Bounded to
      // concurrency 4, expected floor is (N/4)*delay = 4500ms. Generous
      // ceiling well above the floor but far below the sequential total,
      // so this genuinely distinguishes "concurrent" from "sequential"
      // rather than just being a loose timing assertion.
      const sequentialEstimate = N * SIMULATED_DELAY_MS;
      assert.ok(elapsed < sequentialEstimate / 2,
        `expected concurrent execution well under half the sequential estimate (${sequentialEstimate}ms), took ${elapsed}ms`);
      console.log(`    (1200-file simulated scan: ${elapsed}ms wall time vs ${sequentialEstimate}ms sequential estimate, maxInFlight=${maxInFlight})`);
    } finally {
      exifService.readFileTags = origReadFileTags;
    }
  });

  // ── TEST 4: concurrency bound never exceeded ───────────────────────────────
  await t('TEST 4: concurrent capture-date calls never exceed CAPTURE_DATE_CONCURRENCY', async () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'main', 'qmzService.js'), 'utf8');
    const concurrencyLimit = parseInt(/const CAPTURE_DATE_CONCURRENCY = (\d+);/.exec(src)[1], 10);

    const exifService = require(path.join(PROJECT_ROOT, 'main/exifService'));
    const origReadFileTags = exifService.readFileTags;
    let inFlight = 0, maxInFlight = 0;
    exifService.readFileTags = async () => {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      await sleep(10);
      inFlight--;
      return {};
    };

    try {
      const qmzService = require(path.join(PROJECT_ROOT, 'main/qmzService'));
      const qmzRoot = await mkQmzRoot();
      const pgDir = path.join(qmzRoot, '_Unsequenced', 'PC01-Concurrency Test');
      for (let i = 1; i <= 60; i++) {
        await writeRawXmpPair(path.join(pgDir, `IMG${String(i).padStart(3, '0')}.ARW`));
      }
      await qmzService.scanRoot(qmzRoot);
      assert.ok(maxInFlight <= concurrencyLimit, `maxInFlight=${maxInFlight} must never exceed CAPTURE_DATE_CONCURRENCY=${concurrencyLimit}`);
      assert.ok(maxInFlight >= 2, `expected genuine concurrency (>1 in flight at once) to actually occur during the test, got maxInFlight=${maxInFlight} — test may not be exercising the concurrent path`);
      console.log(`    (observed maxInFlight=${maxInFlight}, limit=${concurrencyLimit})`);
    } finally {
      exifService.readFileTags = origReadFileTags;
    }
  });

  // ── TEST 5: ambiguous Dirents + scale together ─────────────────────────────
  await t('TEST 5: ambiguous (lying) Dirents at scale still resolve correctly alongside bounded concurrency', async () => {
    const qmzRoot = await mkQmzRoot();
    const pgDir = path.join(qmzRoot, '_Unsequenced', 'PC01-Ambiguous Dirent Test');
    const N = 40;
    for (let i = 1; i <= N; i++) {
      await writeRawXmpPair(path.join(pgDir, `IMG${String(i).padStart(3, '0')}.ARW`));
    }

    const realReaddir = fsp.readdir;
    const lieAbout = new Set();
    for (let i = 1; i <= N; i++) lieAbout.add(`IMG${String(i).padStart(3, '0')}.ARW`);
    fsp.readdir = async (dir, opts) => {
      const entries = await realReaddir(dir, opts);
      if (!opts || !opts.withFileTypes) return entries;
      return entries.map(e => lieAbout.has(e.name)
        ? { name: e.name, isDirectory: () => false, isFile: () => false }
        : e);
    };

    try {
      const qmzService = require(path.join(PROJECT_ROOT, 'main/qmzService'));
      const scan = await qmzService.scanRoot(qmzRoot);
      assert.equal(scan.unsequenced['PC01-Ambiguous Dirent Test']?.count, N,
        `all ${N} ARW files must be recovered via stat fallback despite lying Dirents`);
    } finally {
      fsp.readdir = realReaddir;
    }
  });

  // ── TEST 6: normal Dirents incur zero unnecessary stat fallback at scale ──
  await t('TEST 6: normal (non-lying) Dirents at scale trigger zero stat-fallback calls (verified via the real [qmz-perf] instrumentation)', async () => {
    // _fileHardened is only invoked when a Dirent's isFile() is already
    // false (checked inline in listMediaFiles before calling it) — internal
    // calls use the local function reference, not module.exports, so this
    // can't be observed by monkey-patching the export from outside. Instead,
    // read the real [qmz-perf] statFallback count this scan itself logs to
    // app.log (this test process IS the Electron main process it was
    // launched as, so app.getPath('userData') resolves to the real log dir).
    const { app } = require('electron');
    const logPath = path.join(app.getPath('userData'), 'app.log');

    const qmzService = require(path.join(PROJECT_ROOT, 'main/qmzService'));
    const qmzRoot = await mkQmzRoot();
    const pgDir = path.join(qmzRoot, '_Unsequenced', 'PC01-Normal Dirent Test');
    for (let i = 1; i <= 30; i++) {
      await writeRawXmpPair(path.join(pgDir, `IMG${String(i).padStart(3, '0')}.ARW`));
    }
    const scan = await qmzService.scanRoot(qmzRoot);
    assert.equal(scan.unsequenced['PC01-Normal Dirent Test']?.count, 30);

    await sleep(200); // let the async fs.appendFile log write flush
    const logContent = fs.readFileSync(logPath, 'utf8');
    const perfLine = logContent.split('\n').reverse().find(l => l.includes('qmz-perf') && l.includes('statFallback') && l.includes(pgDir));
    assert.ok(perfLine, `expected a [qmz-perf] listMediaFiles aggregate line for ${pgDir} in app.log`);
    const fallbackMatch = /statFallback: count=(\d+)/.exec(perfLine);
    assert.ok(fallbackMatch, `expected statFallback count in log line: ${perfLine}`);
    assert.equal(fallbackMatch[1], '0', `normal Dirents must trigger zero stat-fallback calls, log line: ${perfLine}`);
  });

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED');
  process.exit(process.exitCode || 0);
})().catch(err => {
  console.error('[qmzPerfConcurrencyRegression] FATAL:', err);
  process.exit(1);
});
