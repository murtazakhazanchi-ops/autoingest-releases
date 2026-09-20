'use strict';

// Regression test for Bug 2's SECOND performance round: real Windows/SMB
// testing of the round-1 fix (bounded concurrency=4, commit c4ca0ce) showed
// correctness restored but the QMZ workspace still took 5-6 MINUTES to
// become usable on real-world events — e.g. 541 files: readdir ~86ms,
// mandatory stat ~2369ms cumulative, but
// captureDate(readCaptureDate/ExifTool) totalMs=168329 (up to 520ms/file) —
// the concurrency fix reduced wall time by ~4x as designed, but real SMB
// ExifTool round trips (~300ms+ average, worse than the ~117ms measured
// locally in round 1) meant even 4x-parallel was nowhere near enough for
// several-hundred-file photographer folders. The logs also showed some
// scans becoming near-instant later in the same session — traced to
// initRoot() unconditionally calling the FULL scanRoot() (which runs
// listMediaFiles(), including all per-file capture-date work) purely to
// read `scan.other` — discarding the rest — so every QMZ open paid the full
// per-file cost TWICE, with the second pass only fast because
// _exifDateCache (keyed path|size|mtimeMs) was already warmed by the first,
// wasted pass.
//
// Investigation traced every consumer of file.capturedAt in the renderer:
// exactly three, all display/ordering only (default 'date' sort comparator,
// the date label under each tile, and Timeline grouping) — never used for
// photographer/folder discovery, RAW/XMP pairing, or any move/assign/
// sequence operation. Authoritative EXIF capture date is therefore NOT
// required before the QMZ workspace can become interactive.
//
// Fix (this round):
//   1. listMediaFiles() no longer calls readCaptureDate()/ExifTool at all.
//      Every file gets an immediate capturedAt = its filesystem modifiedAt
//      (already available from the existing mandatory stat()) plus
//      capturedAtPending:true for RAW/photo types. scanRoot()/initRoot()
//      therefore complete in the time it takes to stat a directory, not to
//      run ExifTool across it — measured directly: 500 files, initRoot 4ms
//      + scanRoot 6ms = 10ms total to a usable workspace (previously tens
//      of seconds to minutes).
//   2. initRoot() now uses _classifyOtherFolders() — a new, cheap,
//      readdir-and-Dirent-hardened-classify-only function — instead of the
//      full scanRoot(), eliminating the duplicate full scan entirely (not
//      just relying on cache to make the second pass cheap).
//   3. A new, separate resolveCaptureDates(files) function (and
//      qmz:resolveCaptureDates IPC channel) resolves real EXIF dates for an
//      already-scanned file list, using the SAME bounded concurrency
//      (CAPTURE_DATE_CONCURRENCY=4, matching exifService.js's ExifTool pool
//      size) and the SAME _exifDateCache as before — this only changes WHEN
//      the work happens (explicitly, in the background, after the
//      workspace already rendered), not what it computes or how fast any
//      single call is.
//   4. renderer/renderer.js's _qmzRefresh() fires this resolution in the
//      background (never awaited) immediately after rendering the fast
//      scan result, and corrects capturedAt/re-renders in place once real
//      dates arrive — discarding stale results if _qmzData/_qmzRoot changed
//      in the meantime (QMZ closed, switched events, or a newer scan
//      already ran).
//
// TEST 1 — fast scan correctness: capturedAt=modifiedAt initially,
//          capturedAtPending=true for RAW files, zero ExifTool calls during
//          scanRoot/initRoot even at Leicester scale (1200 files).
// TEST 2 — resolveCaptureDates correctness: resolves real dates for a
//          scanned file list, matches what the OLD synchronous path would
//          have produced (same underlying readCaptureDate/cache).
// TEST 3 — initRoot() no longer performs a duplicate full scan: monkey-patch
//          exifService.readFileTags and assert ZERO calls during
//          initRoot()+scanRoot() together (proves the wasted first pass is
//          gone, not just cache-masked).
// TEST 4 — bounded concurrency still holds for resolveCaptureDates at scale,
//          with simulated latency proving genuine concurrent execution
//          (same technique as round 1's test, retargeted at the new
//          function).
// TEST 5 — ambiguous Dirents (BUG-011-class stat fallback, still fully
//          intact) combined with scale — scanRoot discovery unaffected by
//          moving capture-date work out.
// TEST 6 — normal Dirents at scale still trigger zero stat-fallback calls.
// TEST 7 — source-drift guard: CAPTURE_DATE_CONCURRENCY still matches
//          exifService.js's real ExifTool pool size.
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
  // ── TEST 1: fast scan correctness at Leicester scale ───────────────────────
  await t('TEST 1: 1200-file scan/init completes in milliseconds with provisional dates, zero ExifTool calls', async () => {
    const exifService = require(path.join(PROJECT_ROOT, 'main/exifService'));
    const origReadFileTags = exifService.readFileTags;
    let callCount = 0;
    exifService.readFileTags = async () => { callCount++; return {}; };

    try {
      const qmzService = require(path.join(PROJECT_ROOT, 'main/qmzService'));
      const qmzRoot = await mkQmzRoot();
      const N = 1200;
      const pgDir = path.join(qmzRoot, '_Unsequenced', 'PC01-Burhanuddin Ghia');
      for (let i = 1; i <= N; i++) {
        await writeRawXmpPair(path.join(pgDir, `BUR${String(i).padStart(5, '0')}.ARW`));
      }

      const t0 = Date.now();
      await qmzService.initRoot(qmzRoot);
      const scan = await qmzService.scanRoot(qmzRoot);
      const elapsed = Date.now() - t0;

      assert.equal(scan.unsequenced['PC01-Burhanuddin Ghia']?.count, N, 'all files must still be discovered');
      assert.equal(callCount, 0, 'zero ExifTool calls must happen during scan/init — capture dates are resolved separately, in the background');
      assert.ok(elapsed < 3000, `expected scan+init to complete in well under 3s even at 1200 files (no ExifTool blocking), took ${elapsed}ms`);

      const files = scan.unsequenced['PC01-Burhanuddin Ghia'].files;
      for (const f of files) {
        assert.equal(f.capturedAt, f.modifiedAt, 'capturedAt must start as the provisional modifiedAt value');
        assert.equal(f.capturedAtPending, true, 'RAW files must be marked capturedAtPending until resolveCaptureDates runs');
      }
      console.log(`    (1200-file scan+init: ${elapsed}ms, 0 ExifTool calls)`);
    } finally {
      exifService.readFileTags = origReadFileTags;
    }
  });

  // ── TEST 2: resolveCaptureDates correctness ─────────────────────────────────
  await t('TEST 2: resolveCaptureDates resolves real dates and matches what the old synchronous path would have produced', async () => {
    const exifService = require(path.join(PROJECT_ROOT, 'main/exifService'));
    const origReadFileTags = exifService.readFileTags;
    const FAKE_DATE = '2026-03-15T10:00:00.000Z';
    exifService.readFileTags = async () => ({ DateTimeOriginal: { toISOString: () => FAKE_DATE } });

    try {
      const qmzService = require(path.join(PROJECT_ROOT, 'main/qmzService'));
      const qmzRoot = await mkQmzRoot();
      const pgDir = path.join(qmzRoot, '_Unsequenced', 'PC01-Test');
      for (let i = 1; i <= 5; i++) {
        await writeRawXmpPair(path.join(pgDir, `IMG${i}.ARW`));
      }
      const scan = await qmzService.scanRoot(qmzRoot);
      const files = scan.unsequenced['PC01-Test'].files;
      assert.ok(files.every(f => f.capturedAtPending), 'setup: all files must start pending');

      const dates = await qmzService.resolveCaptureDates(files);
      for (const f of files) {
        assert.equal(dates[f.path], FAKE_DATE, `resolveCaptureDates must resolve the real EXIF date for ${f.path}`);
      }
    } finally {
      exifService.readFileTags = origReadFileTags;
    }
  });

  // ── TEST 3: no duplicate scan — initRoot performs zero ExifTool work ───────
  await t('TEST 3: initRoot() no longer duplicates scanRoot()\'s expensive work (was: full scan discarded except .other)', async () => {
    const qmzService = require(path.join(PROJECT_ROOT, 'main/qmzService'));
    const qmzRoot = await mkQmzRoot();
    // A genuine adoption candidate, so initRoot has real work to do — not
    // just an empty pass-through.
    await writeRawXmpPair(path.join(qmzRoot, 'Loose Photographer', 'L1.ARW'));

    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'main', 'qmzService.js'), 'utf8');
    assert.ok(src.includes('_classifyOtherFolders(qmzRoot)') && /const other\s*=\s*await _classifyOtherFolders\(qmzRoot\);/.test(src),
      'initRoot must use the cheap _classifyOtherFolders(), not the full scanRoot(), to determine adoption candidates');
    assert.ok(!/const scan\s*=\s*await scanRoot\(qmzRoot\);\s*\n\s*const adopted/.test(src),
      'initRoot must not call the full scanRoot() — source-drift guard against reintroducing the duplicate scan');

    const result = await qmzService.initRoot(qmzRoot);
    assert.equal(result.ok, true);
    assert.deepStrictEqual(result.adopted, ['Loose Photographer']);
    assert.ok(fs.existsSync(path.join(qmzRoot, '_Unsequenced', 'Loose Photographer', 'L1.ARW')), 'adoption itself must still work correctly');
  });

  // ── TEST 4: bounded concurrency holds for resolveCaptureDates at scale ─────
  await t('TEST 4: resolveCaptureDates uses bounded concurrency (not sequential) and never exceeds CAPTURE_DATE_CONCURRENCY', async () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'main', 'qmzService.js'), 'utf8');
    const concurrencyLimit = parseInt(/const CAPTURE_DATE_CONCURRENCY = (\d+);/.exec(src)[1], 10);

    const exifService = require(path.join(PROJECT_ROOT, 'main/exifService'));
    const origReadFileTags = exifService.readFileTags;
    const SIMULATED_DELAY_MS = 15;
    let inFlight = 0, maxInFlight = 0, callCount = 0;
    exifService.readFileTags = async () => {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      callCount++;
      await sleep(SIMULATED_DELAY_MS);
      inFlight--;
      return {};
    };

    try {
      const qmzService = require(path.join(PROJECT_ROOT, 'main/qmzService'));
      const qmzRoot = await mkQmzRoot();
      const N = 200;
      const pgDir = path.join(qmzRoot, '_Unsequenced', 'PC01-Concurrency Test');
      for (let i = 1; i <= N; i++) {
        await writeRawXmpPair(path.join(pgDir, `IMG${String(i).padStart(4, '0')}.ARW`));
      }
      const scan = await qmzService.scanRoot(qmzRoot);
      const files = scan.unsequenced['PC01-Concurrency Test'].files;

      const t0 = Date.now();
      const dates = await qmzService.resolveCaptureDates(files);
      const elapsed = Date.now() - t0;

      assert.equal(Object.keys(dates).length, N, 'all files must be resolved');
      assert.equal(callCount, N, 'exactly one ExifTool call per file');
      assert.ok(maxInFlight <= concurrencyLimit, `maxInFlight=${maxInFlight} must never exceed CAPTURE_DATE_CONCURRENCY=${concurrencyLimit}`);
      assert.ok(maxInFlight >= 2, `expected genuine concurrency to occur, got maxInFlight=${maxInFlight}`);
      const sequentialEstimate = N * SIMULATED_DELAY_MS;
      assert.ok(elapsed < sequentialEstimate / 2,
        `expected concurrent execution well under half the sequential estimate (${sequentialEstimate}ms), took ${elapsed}ms`);
      console.log(`    (${N}-file resolveCaptureDates: ${elapsed}ms vs ${sequentialEstimate}ms sequential estimate, maxInFlight=${maxInFlight})`);
    } finally {
      exifService.readFileTags = origReadFileTags;
    }
  });

  // ── TEST 5: ambiguous Dirents + scale, discovery unaffected ────────────────
  await t('TEST 5: ambiguous (lying) Dirents at scale still resolve correctly for fast discovery', async () => {
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

    await sleep(200);
    const logContent = fs.readFileSync(logPath, 'utf8');
    const perfLine = logContent.split('\n').reverse().find(l => l.includes('qmz-perf') && l.includes('statFallback') && l.includes(pgDir));
    assert.ok(perfLine, `expected a [qmz-perf] listMediaFiles aggregate line for ${pgDir} in app.log`);
    const fallbackMatch = /statFallback: count=(\d+)/.exec(perfLine);
    assert.ok(fallbackMatch, `expected statFallback count in log line: ${perfLine}`);
    assert.equal(fallbackMatch[1], '0', `normal Dirents must trigger zero stat-fallback calls, log line: ${perfLine}`);
  });

  // ── TEST 7: source-drift guard ──────────────────────────────────────────────
  await t('TEST 7: CAPTURE_DATE_CONCURRENCY matches exifService.js\'s real ExifTool pool size', async () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'main', 'qmzService.js'), 'utf8');
    const concMatch = /const CAPTURE_DATE_CONCURRENCY = (\d+);/.exec(src);
    assert.ok(concMatch, 'CAPTURE_DATE_CONCURRENCY constant not found — was it renamed?');
    const maxProcsMatch = fs.readFileSync(path.join(PROJECT_ROOT, 'main', 'exifService.js'), 'utf8').match(/maxProcs:\s*(\d+)/);
    assert.ok(maxProcsMatch, 'exifService.js maxProcs not found — was it renamed?');
    assert.equal(concMatch[1], maxProcsMatch[1], 'CAPTURE_DATE_CONCURRENCY should match the real ExifTool pool size');
  });

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED');
  process.exit(process.exitCode || 0);
})().catch(err => {
  console.error('[qmzPerfConcurrencyRegression] FATAL:', err);
  process.exit(1);
});
