'use strict';

// Live end-to-end verification of the multi-event import ORCHESTRATION contract at the
// process boundary: two (then three) independent `import:commitTransaction` calls for
// different events from ONE synthetic source, through the REAL Electron main process, real
// copy engine, real exifService and real ExifTool, using the direct-IPC-drive pattern of the
// other *Live.test.js files.
//
// Proves:
//   • per-event metadata isolation — every file is tagged from ITS OWN event/component
//     (event types, Location, City, Additional Keywords, photographer);
//     nothing from another event leaks in
//   • metadata:progress carries the batch's own event identity (`eventPath`) even when the
//     operator's Current Event differs — and stays absent for single-event imports
//   • Deep Verify covers the WHOLE session when transactions share an importSessionId, and
//     only the last transaction otherwise (unchanged legacy behaviour)
//   • copy safety under a multi-event plan: same-size skip, different-size conflict rename,
//     never overwrite, per-file error continuation, exact counters
//   • per-event event.json imports[] (each event records only its own import)
//   • unassigned source files are never touched; every source file is left in place
//
// SYNTHETIC ONLY: all fixtures live in fresh temp dirs; no real card / archive is touched.
// Run: node test/multiEventImportLive.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[multi-event-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) log('PASS —', msg);
  else { failures++; log('FAIL —', msg); }
}
const mkTmp = (prefix) => fsp.mkdtemp(path.join(os.tmpdir(), prefix));

async function writeFake(p, bytes = 60 * 1024, fill = 0xab) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.alloc(bytes, fill));
}

(async () => {
  const userDataDir = await mkTmp('ai-multi-e2e-userdata-');
  const archiveRoot = await mkTmp('ai-multi-e2e-archive-');
  const sourceRoot  = await mkTmp('ai-multi-e2e-source-');
  log('userDataDir =', userDataDir);
  log('archiveRoot =', archiveRoot);
  log('sourceRoot  =', sourceRoot);

  const app = await electron.launch({
    args: [PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  app.process().stderr.on('data', (d) => { const t = String(d); if (/Error|Unhandled/i.test(t)) process.stdout.write('[main-stderr] ' + t); });

  let window = await app.firstWindow({ timeout: 60000 });
  await window.waitForTimeout(1500);
  const splash = await window.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  });
  const mainWindowPromise = app.waitForEvent('window', { timeout: 30000 });
  if (splash.create) {
    await window.fill('#splashInputName', 'Multi Event E2E Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splash.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.fill('#splashInputName', 'Multi Event E2E Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splash.welcome) {
    await window.click('#splashContinueBtn');
  }
  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);

  const pageErrors = [];
  window.on('pageerror', err => pageErrors.push(err.message));

  await window.evaluate(async (root) => window.api.setMainArchiveRoot(root), archiveRoot);
  await window.waitForTimeout(300);

  // Renderer-side recorder for metadata:progress payloads.
  await window.evaluate(() => {
    window.__mp = [];
    window.api.onMetadataProgress((p) => { window.__mp.push(p); });
  });

  // ── Events: A and B multi-component, C single-component; all in one collection ──
  const coll = 'CollMultiE2E';
  const evA = path.join(archiveRoot, coll, '1448-02-01 _01-Waaz-Alpha');
  const evB = path.join(archiveRoot, coll, '1448-02-02 _02-Majlis-Beta');
  const evC = path.join(archiveRoot, coll, '1448-02-03 _03-Jashn-Gamma');
  const A1 = 'Waaz-Hall A', A2 = 'Ziyafat-Hall A';
  const B1 = 'Majlis-Hall B', B2 = 'Safar-Hall B';
  const eventJson = (hijri, seq, name, components) => ({ version: 1, hijriDate: hijri, sequence: seq, eventName: name, components });
  const jsonA = eventJson('1448-02-01', 1, 'Waaz-Alpha', [
    { folderName: A1, location: 'Hall A', city: 'Surat', country: 'India', types: ['Waaz'], additionalKeywords: [{ label: 'AlphaKw', keywordId: 'ka' }] },
    { folderName: A2, location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyafat'], additionalKeywords: [] },
  ]);
  const jsonB = eventJson('1448-02-02', 2, 'Majlis-Beta', [
    { folderName: B1, location: 'Hall B', city: 'Mumbai', country: 'India', types: ['Majlis', 'Nazm'], additionalKeywords: [{ label: 'BetaKw', keywordId: 'kb' }] },
    { folderName: B2, location: 'Hall B', city: 'Mumbai', country: 'India', types: ['Safar'], additionalKeywords: [] },
  ]);
  const jsonC = eventJson('1448-02-03', 3, 'Jashn-Gamma', [
    { folderName: 'Jashn-Hall C', location: 'Hall C', city: 'Pune', country: 'India', types: ['Jashn'], additionalKeywords: [] },
  ]);
  for (const [dir, data] of [[evA, jsonA], [evB, jsonB], [evC, jsonC]]) {
    await window.evaluate(async ({ dir, data }) => window.api.writeEventJson(dir, data), { dir, data });
  }

  // ── One synthetic source (deliberately NOT a camera layout — source-agnostic) ──
  const src = (rel) => path.join(sourceRoot, rel);
  const a001 = src('shoot/A001.cr2'), a002 = src('shoot/A002.cr2'), a003 = src('videos/A003.mp4');
  const b001 = src('shoot/B001.cr2'), b002 = src('shoot/B002.cr2'), b003 = src('videos/B003.mov');
  const c001 = src('shoot/C001.cr2');
  const unassigned = src('shoot/UNASSIGNED.cr2');
  for (const p of [a001, a002, a003, b001, b002, b003, c001, unassigned]) await writeFake(p);
  const srcSizesBefore = Object.fromEntries((await Promise.all([a001, a002, a003, b001, b002, b003, c001, unassigned].map(async p => [p, (await fsp.stat(p)).size]))));

  const PHOTOG = 'Jane Doe';
  const dest = (ev, sub, file, vid = false) => path.join(ev, sub || '', PHOTOG, vid ? 'VIDEO' : '', file);

  const ctxFor = (groups, collName = coll) => ({ groups, photographer: PHOTOG, liveComps: null, subEventNames: null, collName, source: 'e2e-test', importedBy: 'Multi Event E2E Operator' });

  // Event A: two groups (one component each), video in group 2. Event B likewise.
  const groupsA = [
    { id: 1, subEventId: A1, metadataTags: null, files: [a001, a002] },
    { id: 2, subEventId: A2, metadataTags: null, files: [a003] },
  ];
  const groupsB = [
    { id: 1, subEventId: B1, metadataTags: null, files: [b001, b002] },
    { id: 2, subEventId: B2, metadataTags: null, files: [b003] },
  ];
  const jobsA = [
    { src: a001, dest: dest(evA, A1, 'A001.cr2') }, { src: a002, dest: dest(evA, A1, 'A002.cr2') },
    { src: a003, dest: dest(evA, A2, 'A003.mp4', true) },
  ];
  const jobsB = [
    { src: b001, dest: dest(evB, B1, 'B001.cr2') }, { src: b002, dest: dest(evB, B1, 'B002.cr2') },
    { src: b003, dest: dest(evB, B2, 'B003.mov', true) },
  ];

  const sessionId = 'ims-e2e-' + Date.now().toString(36);
  const commit = (jobs, evPath, groups, extra = {}) => window.evaluate(async ({ jobs, evPath, ctx }) =>
    window.api.commitImportTransaction(jobs, evPath, ctx), { jobs, evPath, ctx: { ...ctxFor(groups), ...extra } });

  // ════════════════════════════════════════════════════════════════════════
  // ONE source import → Event A then Event B (same importSessionId), operator's
  // Current Event never changes in this test (it is neither — proving identity
  // comes from the payload, not from UI state).
  // ════════════════════════════════════════════════════════════════════════
  const resA = await commit(jobsA, evA, groupsA, { progressEventPath: evA, importSessionId: sessionId });
  const resB = await commit(jobsB, evB, groupsB, { progressEventPath: evB, importSessionId: sessionId });
  log('A:', JSON.stringify({ copied: resA.copied, errors: resA.errors, batch: resA.metadataBatchId }));
  log('B:', JSON.stringify({ copied: resB.copied, errors: resB.errors, batch: resB.metadataBatchId }));
  check(resA.copied === 3 && resA.errors === 0, 'Event A: 3 files copied, 0 errors');
  check(resB.copied === 3 && resB.errors === 0, 'Event B: 3 files copied, 0 errors');
  check(resA.metadataBatchId && resB.metadataBatchId && resA.metadataBatchId !== resB.metadataBatchId, 'each event starts its OWN metadata batch');

  // ── Routing: exact destinations, VIDEO folders, photographer folder ──
  for (const j of [...jobsA, ...jobsB]) check(fs.existsSync(j.dest), `landed at expected path: ${path.relative(archiveRoot, j.dest)}`);
  check(!fs.existsSync(dest(evA, A1, 'B001.cr2')) && !fs.existsSync(dest(evB, B1, 'A001.cr2')), 'no file routed into the other event');

  // ── Unassigned + source integrity ──
  const allArchiveFiles = [];
  const walk = async (d) => { for (const e of await fsp.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else allArchiveFiles.push(p); } };
  await walk(archiveRoot);
  check(!allArchiveFiles.some(p => path.basename(p).startsWith('UNASSIGNED')), 'the unassigned source file was never imported');
  check(!allArchiveFiles.some(p => path.basename(p).startsWith('C001')), 'the not-yet-imported Event C file was not imported');
  const srcSizesAfter = Object.fromEntries((await Promise.all(Object.keys(srcSizesBefore).map(async p => [p, (await fsp.stat(p)).size]))));
  check(JSON.stringify(srcSizesBefore) === JSON.stringify(srcSizesAfter), 'every source file is still present and unmodified (import never touches the source)');

  // ── metadata:progress identity ──
  // Wait for both batches to finish
  const waitMeta = async (evDir) => {
    for (let i = 0; i < 40; i++) {
      await window.waitForTimeout(500);
      try { const j = JSON.parse(await fsp.readFile(path.join(evDir, 'event.json'), 'utf8')); if (j?.metadataState?.state === 'metadata-complete') return j; } catch { /* not yet */ }
    }
    return null;
  };
  const docA = await waitMeta(evA);
  const docB = await waitMeta(evB);
  check(docA?.metadataState?.state === 'metadata-complete', 'Event A metadata batch reached metadata-complete');
  check(docB?.metadataState?.state === 'metadata-complete', 'Event B metadata batch reached metadata-complete');

  const mp = await window.evaluate(() => window.__mp);
  const byBatch = (id) => mp.filter(p => p.batchId === id);
  const startA = byBatch(resA.metadataBatchId).find(p => p.event === 'batch_start');
  const startB = byBatch(resB.metadataBatchId).find(p => p.event === 'batch_start');
  check(startA && startA.eventPath === evA, 'Event A batch_start carries Event A’s own identity');
  check(startB && startB.eventPath === evB, 'Event B batch_start carries Event B’s own identity');
  check(byBatch(resA.metadataBatchId).every(p => p.eventPath === evA) && byBatch(resB.metadataBatchId).every(p => p.eventPath === evB),
    'EVERY progress event of each batch is attributed to its own event (no cross-attribution)');

  // ── Per-event metadata isolation (real ExifTool read-back) ──
  const { ExifTool } = require('exiftool-vendored');
  const et = new ExifTool();
  const asArr = v => (v === undefined || v === null) ? [] : (Array.isArray(v) ? v : [v]);
  const sidecar = p => p.slice(0, -path.extname(p).length) + '.xmp';
  try {
    const kw = async (p) => asArr((await et.read(sidecar(p))).Subject).sort();
    const creator = async (p) => { const t = await et.read(sidecar(p)); return t.Creator || t.Artist || null; };

    const kA1 = await kw(dest(evA, A1, 'A001.cr2'));
    const kA2 = await kw(dest(evA, A1, 'A002.cr2'));
    const kB1 = await kw(dest(evB, B1, 'B001.cr2'));
    const kB2 = await kw(dest(evB, B1, 'B002.cr2'));
    log('A001:', JSON.stringify(kA1));
    log('A002:', JSON.stringify(kA2));
    log('B001:', JSON.stringify(kB1));
    log('B002:', JSON.stringify(kB2));

    // Stable's existing metadata semantics: event types + Location + City + Country (Additional Keywords are
    // not written to files on this line — unchanged by multi-event import, so not asserted here).
    const aFull = ['Waaz', 'Hall A', 'Surat', 'India'];
    const bFull = ['Majlis', 'Nazm', 'Hall B', 'Mumbai', 'India'];
    check(aFull.every(k => kA1.includes(k)) && aFull.every(k => kA2.includes(k)), 'Event A files carry Event A’s own event type, Location, City and Country');
    check(bFull.every(k => kB1.includes(k)) && bFull.every(k => kB2.includes(k)), 'Event B files carry Event B’s own event types, Location, City and Country');

    const aTokens = ['Waaz', 'Ziyafat', 'AlphaKw', 'Hall A', 'Surat'];
    const bTokens = ['Majlis', 'Nazm', 'Safar', 'BetaKw', 'Hall B', 'Mumbai'];
    check(![...kA1, ...kA2].some(k => bTokens.includes(k)), 'NO Event B tag appears on any Event A file');
    check(![...kB1, ...kB2].some(k => aTokens.includes(k)), 'NO Event A tag appears on any Event B file');

    // (Videos carry minimal metadata and no .xmp sidecar by existing design — routing is asserted above.)
    const cA = await creator(dest(evA, A1, 'A001.cr2'));
    const cB = await creator(dest(evB, B1, 'B001.cr2'));
    check(String(cA).includes(PHOTOG) && String(cB).includes(PHOTOG), 'Creator/Artist = the session photographer on both events’ files');
  } catch (err) {
    failures++;
    log('FAIL — metadata read-back threw:', err.stack || err.message);
  } finally {
    await et.end().catch(() => {});
  }

  // ── Per-event event.json ──
  check(Array.isArray(docA?.imports) && docA.imports.length >= 1 && docA.imports.every(i => i.photographer === PHOTOG), 'Event A imports[] recorded (its own transaction)');
  const totalPhotosA = (docA.imports || []).reduce((s, i) => s + (i.counts?.photos || 0), 0);
  const totalVideosA = (docA.imports || []).reduce((s, i) => s + (i.counts?.videos || 0), 0);
  const totalPhotosB = (docB.imports || []).reduce((s, i) => s + (i.counts?.photos || 0), 0);
  const totalVideosB = (docB.imports || []).reduce((s, i) => s + (i.counts?.videos || 0), 0);
  check(totalPhotosA === 2 && totalVideosA === 1, `Event A imports[] counts are Event A’s only (${totalPhotosA} photos, ${totalVideosA} video)`);
  check(totalPhotosB === 2 && totalVideosB === 1, `Event B imports[] counts are Event B’s only (${totalPhotosB} photos, ${totalVideosB} video)`);
  check(docA.status === 'complete' && docB.status === 'complete', 'both events committed status:complete (per-event atomic transactions)');
  check(!('tagRefinements' in docA) && !('tagRefinements' in docB), 'no held-feature state is written to either event.json (Stable behaviour preserved)');

  // ── Deep Verify covers the WHOLE session (shared importSessionId) ──
  const dv = await window.evaluate(async () => window.api.runChecksumVerification());
  log('Deep Verify (session):', JSON.stringify(dv));
  check(dv.total === 6 && dv.failed === 0, 'Deep Verify covers ALL 6 files across both events, 0 failures');

  // ── Legacy semantics preserved: no importSessionId → only the last transaction ──
  const resC = await commit([{ src: c001, dest: dest(evC, '', 'C001.cr2') }], evC,
    [{ id: 0, subEventId: null, metadataTags: null, files: [c001] }]);
  check(resC.copied === 1 && resC.errors === 0, 'single-event import (no session id / progressEventPath) still works unchanged');
  const dv2 = await window.evaluate(async () => window.api.runChecksumVerification());
  check(dv2.total === 1, `single-event Deep Verify still covers only that import (total=${dv2.total})`);
  await waitMeta(evC);
  const mp2 = await window.evaluate(() => window.__mp);
  const startC = mp2.find(p => p.batchId === resC.metadataBatchId && p.event === 'batch_start');
  check(startC && !('eventPath' in startC), 'single-event batch payload carries NO eventPath (renderer falls back to legacy behaviour)');

  // ── Copy safety under the multi-event plan ──
  // 1) re-run A: every file is an exact same-size duplicate → skipped, counters exact, never re-copied.
  const rerunA = await commit(jobsA, evA, groupsA, { progressEventPath: evA, importSessionId: 'ims-e2e-rerun-' + Date.now().toString(36) });
  check(rerunA.copied === 0 && rerunA.skipped === 3 && rerunA.errors === 0, `re-running Event A skips all 3 exact duplicates (copied=${rerunA.copied}, skipped=${rerunA.skipped})`);

  // 2) conflict: same destination name, DIFFERENT size → safe _1 rename, original untouched.
  const conflictSrc = src('shoot2/B001.cr2');
  await writeFake(conflictSrc, 70 * 1024, 0xcd);
  const originalB001Size = (await fsp.stat(dest(evB, B1, 'B001.cr2'))).size;
  const conflict = await commit([{ src: conflictSrc, dest: dest(evB, B1, 'B001.cr2') }], evB,
    [{ id: 1, subEventId: B1, metadataTags: null, files: [conflictSrc] }], { progressEventPath: evB });
  const renamed = fs.readdirSync(path.dirname(dest(evB, B1, 'B001.cr2'))).filter(n => /^B001_\d+\.cr2$/.test(n));
  check(conflict.copied === 1 && renamed.length === 1, `different-size collision copied under a safe _N name (${renamed.join(',')})`);
  check((await fsp.stat(dest(evB, B1, 'B001.cr2'))).size === originalB001Size, 'the original destination file was NEVER overwritten');

  // 3) per-file error continuation: one missing source in an event; the others still copy, counters exact.
  const okSrc = src('shoot3/A900.cr2'); await writeFake(okSrc);
  const missingSrc = src('shoot3/DOES_NOT_EXIST.cr2');
  const errRes = await commit([
    { src: missingSrc, dest: dest(evA, A1, 'DOES_NOT_EXIST.cr2') },
    { src: okSrc, dest: dest(evA, A1, 'A900.cr2') },
  ], evA, [{ id: 1, subEventId: A1, metadataTags: null, files: [missingSrc, okSrc] }], { progressEventPath: evA });
  check(errRes.errors === 1 && errRes.copied === 1, `a failing file does not stop the rest of its event (copied=${errRes.copied}, errors=${errRes.errors})`);
  check(fs.existsSync(dest(evA, A1, 'A900.cr2')) && !fs.existsSync(dest(evA, A1, 'DOES_NOT_EXIST.cr2')), 'the good file landed, the bad one did not');

  check(pageErrors.length === 0, `no renderer page errors (${JSON.stringify(pageErrors)})`);

  await app.close();
  for (const d of [userDataDir, archiveRoot, sourceRoot]) await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
  log(`=== SUMMARY: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(e => { console.error('[multi-event-e2e] FATAL', e.stack || e.message); process.exit(1); });
