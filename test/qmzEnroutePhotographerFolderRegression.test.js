'use strict';

// Follow-up verification for Stage 4 of "PDF-Assisted QMZ Workspace Folder Generation":
// confirms that photographs moved into Enroute always retain their photographer-wise folder
// organization (Enroute/<Photographer>/<Photograph>, never Enroute/<Photograph> directly),
// and that reverse/cross-destination movement preserves the same identity.
//
// Inspection (see the accompanying report) found main/qmzService.js's moveFilesToEnroute()
// already uses `path.join(qmzRoot, ENROUTE_DIR, photographerName)` — structurally identical
// to moveFilesToSequence()'s `path.join(qmzRoot, sequenceCode, photographerName)` and
// moveFilesToUnsequenced()'s `path.join(qmzRoot, UNSEQUENCED, photographerName)` — so this
// suite is deliberately VERIFICATION ONLY, per this task's own rule: "if it already works, do
// not unnecessarily change production code." No production file is modified by this commit.
//
// Requires the real Electron binary (qmzService.js transitively needs Electron's app.getPath
// via services/logger.js — plain `node` fails):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
//     --no-sandbox --user-data-dir=<isolated tmp dir> \
//     test/qmzEnroutePhotographerFolderRegression.test.js

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

async function mkQmzRoot() { return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-qmz-enroute-pg-')); }
async function writeFile(p, content = 'synthetic') {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content);
}
async function listDirNames(dir) {
  try { return (await fsp.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name); }
  catch { return []; }
}
async function listFileNames(dir) {
  try { return (await fsp.readdir(dir, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name); }
  catch { return []; }
}

(async () => {
  const qmz = require(path.join(PROJECT_ROOT, 'main/qmzService'));
  const { moveFilesToEnroute, moveFilesToUnsequenced, moveFilesToSequence, ensureEnroute,
    createSequence, scanRoot, initRoot } = qmz;

  // ═══════════════ A/B/C — forward movement into Enroute preserves photographer folders ═══
  console.log('=== A/B/C: forward movement into Enroute ===');

  await t('A: one JPEG moved from _Unsequenced/Photographer lands at Enroute/Photographer/<file>, never Enroute/<file>', async () => {
    const root = await mkQmzRoot();
    const src  = path.join(root, '_Unsequenced', 'Abbas Bhai', 'DSC001.jpg');
    await writeFile(src, 'jpeg-bytes');
    const r = await moveFilesToEnroute(root, [src], 'Abbas Bhai');
    assert.equal(r.ok, true);
    assert.equal(r.moved[0].dest, path.join(root, 'Enroute', 'Abbas Bhai', 'DSC001.jpg'));
    assert.ok(fs.existsSync(path.join(root, 'Enroute', 'Abbas Bhai', 'DSC001.jpg')));
    assert.deepStrictEqual(await listFileNames(path.join(root, 'Enroute')), [], 'no file may sit directly inside Enroute/ itself');
  });

  await t('B: multiple photographs from the SAME photographer all land under one Enroute/Photographer folder', async () => {
    const root = await mkQmzRoot();
    const srcDir = path.join(root, '_Unsequenced', 'Abbas Bhai');
    await writeFile(path.join(srcDir, 'DSC001.jpg'));
    await writeFile(path.join(srcDir, 'DSC002.jpg'));
    await writeFile(path.join(srcDir, 'DSC003.jpg'));
    const r = await moveFilesToEnroute(root, [
      path.join(srcDir, 'DSC001.jpg'),
      path.join(srcDir, 'DSC002.jpg'),
    ], 'Abbas Bhai');
    assert.equal(r.ok, true);
    assert.deepStrictEqual(await listFileNames(path.join(root, 'Enroute', 'Abbas Bhai')).then(l => l.sort()), ['DSC001.jpg', 'DSC002.jpg']);
    // The remaining, un-selected photograph stays exactly where it was.
    assert.ok(fs.existsSync(path.join(srcDir, 'DSC003.jpg')), 'the photograph never selected for the move must remain in _Unsequenced');
    assert.ok(!fs.existsSync(path.join(srcDir, 'DSC001.jpg')) && !fs.existsSync(path.join(srcDir, 'DSC002.jpg')));
  });

  await t('C: photographs from TWO different photographers are kept in separate Enroute subfolders, never mixed', async () => {
    const root = await mkQmzRoot();
    const srcA = path.join(root, '_Unsequenced', 'Abbas Bhai');
    const srcH = path.join(root, '_Unsequenced', 'Husain Bhai');
    await writeFile(path.join(srcA, 'DSC001.jpg'));
    await writeFile(path.join(srcA, 'DSC002.jpg'));
    await writeFile(path.join(srcH, 'DSC004.jpg'));
    await writeFile(path.join(srcH, 'DSC005.jpg'));
    const rA = await moveFilesToEnroute(root, [path.join(srcA, 'DSC001.jpg'), path.join(srcA, 'DSC002.jpg')], 'Abbas Bhai');
    const rH = await moveFilesToEnroute(root, [path.join(srcH, 'DSC004.jpg'), path.join(srcH, 'DSC005.jpg')], 'Husain Bhai');
    assert.equal(rA.ok, true); assert.equal(rH.ok, true);
    assert.deepStrictEqual((await listDirNames(path.join(root, 'Enroute'))).sort(), ['Abbas Bhai', 'Husain Bhai']);
    assert.deepStrictEqual((await listFileNames(path.join(root, 'Enroute', 'Abbas Bhai'))).sort(), ['DSC001.jpg', 'DSC002.jpg']);
    assert.deepStrictEqual((await listFileNames(path.join(root, 'Enroute', 'Husain Bhai'))).sort(), ['DSC004.jpg', 'DSC005.jpg']);
    assert.deepStrictEqual(await listFileNames(path.join(root, 'Enroute')), [], 'still no loose file directly in Enroute/');
  });

  // ═══════════════ D — existing Enroute photographer folder is reused, never duplicated ═══
  console.log('=== D: existing photographer folder is reused ===');

  await t('D: moving into an ALREADY-EXISTING Enroute/Photographer folder reuses it — no "Abbas Bhai_1" / "Abbas Bhai (1)"', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'Enroute', 'Abbas Bhai', 'existing.jpg'), 'already-here');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'new.jpg');
    await writeFile(src, 'new-bytes');
    const r = await moveFilesToEnroute(root, [src], 'Abbas Bhai');
    assert.equal(r.ok, true);
    const dirs = await listDirNames(path.join(root, 'Enroute'));
    assert.deepStrictEqual(dirs, ['Abbas Bhai'], 'exactly one photographer folder must exist — no numbered/suffixed duplicate');
    const files = (await listFileNames(path.join(root, 'Enroute', 'Abbas Bhai'))).sort();
    assert.deepStrictEqual(files, ['existing.jpg', 'new.jpg']);
    const preserved = await fsp.readFile(path.join(root, 'Enroute', 'Abbas Bhai', 'existing.jpg'), 'utf8');
    assert.equal(preserved, 'already-here', 'the pre-existing photograph must not be overwritten');
  });

  // ═══════════════ E — no loose files directly in Enroute/ ═══════════════
  console.log('=== E: no photograph is ever written directly inside Enroute/ ===');

  await t('E: after several moves across different photographers, Enroute/ itself contains ONLY directories', async () => {
    const root = await mkQmzRoot();
    for (const pg of ['Abbas Bhai', 'Husain Bhai', 'Yusuf Bhai']) {
      const src = path.join(root, '_Unsequenced', pg, 'photo.jpg');
      await writeFile(src);
      await moveFilesToEnroute(root, [src], pg);
    }
    const entries = await fsp.readdir(path.join(root, 'Enroute'), { withFileTypes: true });
    assert.ok(entries.every(e => e.isDirectory()), 'every entry directly inside Enroute/ must be a photographer directory, never a file');
  });

  // ═══════════════ F/G — reverse movement (Enroute → _Unsequenced) ═══════════════
  console.log('=== F/G: reverse movement preserves photographer identity ===');

  await t('F/G: moving from Enroute/Photographer back to _Unsequenced lands at _Unsequenced/Photographer, not _Unsequenced/<file>', async () => {
    const root = await mkQmzRoot();
    const enrouteSrc = path.join(root, 'Enroute', 'Abbas Bhai', 'DSC001.jpg');
    await writeFile(enrouteSrc, 'bytes');
    const r = await moveFilesToUnsequenced(root, [enrouteSrc], 'Abbas Bhai');
    assert.equal(r.ok, true);
    assert.equal(r.moved[0].dest, path.join(root, '_Unsequenced', 'Abbas Bhai', 'DSC001.jpg'));
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'Abbas Bhai', 'DSC001.jpg')));
    assert.ok(!fs.existsSync(enrouteSrc), 'source must be gone from Enroute after the reverse move');
  });

  await t('F/G: the now-empty Enroute/Photographer leaf folder is cleaned up, matching existing move-to-Unsequenced behavior', async () => {
    const root = await mkQmzRoot();
    const enrouteSrc = path.join(root, 'Enroute', 'Abbas Bhai', 'only.jpg');
    await writeFile(enrouteSrc);
    await moveFilesToUnsequenced(root, [enrouteSrc], 'Abbas Bhai');
    assert.ok(!fs.existsSync(path.join(root, 'Enroute', 'Abbas Bhai')), 'an emptied leaf photographer folder is removed, exactly like every other source of this move');
    assert.ok(fs.existsSync(path.join(root, 'Enroute')), 'the Enroute folder itself must never be removed by this cleanup — only its empty leaf');
  });

  // ═══════════════ (Scenario E of the brief) — cross-destination: Enroute → numbered sequence ═══
  console.log('=== Cross-destination: Enroute -> numbered sequence preserves photographer identity ===');

  await t('Enroute/Photographer -> 01Q/Photographer preserves the photographer subfolder (existing supported operation, no new code)', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const enrouteSrc = path.join(root, 'Enroute', 'Abbas Bhai', 'DSC001.jpg');
    await writeFile(enrouteSrc, 'bytes');
    const r = await moveFilesToSequence(root, [enrouteSrc], '01Q', 'Abbas Bhai');
    assert.equal(r.ok, true);
    assert.equal(r.moved[0].dest, path.join(root, '01Q', 'Abbas Bhai', 'DSC001.jpg'));
    assert.ok(fs.existsSync(path.join(root, '01Q', 'Abbas Bhai', 'DSC001.jpg')));
  });

  // ═══════════════ H — existing filename collision handling applies to Enroute too ═══════
  console.log('=== H: existing collision handling (safeMoveFile\'s _1/_2 rename) applies unchanged ===');

  await t('H: a colliding filename (different size) is renamed with _1, never overwritten — same as every other destination', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'Enroute', 'Abbas Bhai', 'dup.jpg'), 'first-version');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'dup.jpg');
    await writeFile(src, 'second-version-different-size!!');
    const r = await moveFilesToEnroute(root, [src], 'Abbas Bhai');
    assert.equal(r.ok, true);
    assert.equal(r.moved[0].action, 'moved-renamed');
    assert.ok(fs.existsSync(path.join(root, 'Enroute', 'Abbas Bhai', 'dup_1.jpg')));
    const original = await fsp.readFile(path.join(root, 'Enroute', 'Abbas Bhai', 'dup.jpg'), 'utf8');
    assert.equal(original, 'first-version');
  });

  await t('H: an identical-size file at the destination is treated as already-moved (skipped), matching existing semantics', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'Enroute', 'Abbas Bhai', 'same.jpg'), 'xx');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'same.jpg');
    await writeFile(src, 'xx'); // same size (2 bytes)
    const r = await moveFilesToEnroute(root, [src], 'Abbas Bhai');
    assert.equal(r.ok, true);
    assert.equal(r.moved[0].action, 'skipped');
  });

  await t('H: a RAW file\'s .xmp sidecar travels with it into Enroute (sidecar co-move unchanged)', async () => {
    const root = await mkQmzRoot();
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'raw1.cr2');
    await writeFile(src, 'raw-bytes');
    await writeFile(path.join(root, '_Unsequenced', 'Abbas Bhai', 'raw1.xmp'), 'xmp-bytes');
    const r = await moveFilesToEnroute(root, [src], 'Abbas Bhai');
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(root, 'Enroute', 'Abbas Bhai', 'raw1.cr2')));
    assert.ok(fs.existsSync(path.join(root, 'Enroute', 'Abbas Bhai', 'raw1.xmp')), 'the sidecar must follow its RAW file, same as every other destination');
  });

  // ═══════════════ I/J — Enroute recognition survives refresh/reopen ═══════════════
  console.log('=== I/J: Enroute remains recognized and intact across scans/reopens ===');

  await t('I: Enroute remains correctly recognized (not "other") immediately after a move populates it', async () => {
    const root = await mkQmzRoot();
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await moveFilesToEnroute(root, [src], 'Abbas Bhai');
    const scan = await scanRoot(root);
    assert.equal(scan.enroute.exists, true);
    assert.deepStrictEqual(scan.other, []);
    assert.equal(scan.enroute.photographers['Abbas Bhai'].count, 1);
  });

  await t('J: Enroute contents remain intact across repeated scans and initRoot() calls (simulating reopening the workspace)', async () => {
    const root = await mkQmzRoot();
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src, 'persisted-bytes');
    await moveFilesToEnroute(root, [src], 'Abbas Bhai');
    await initRoot(root);
    const scan1 = await scanRoot(root);
    await initRoot(root);
    const scan2 = await scanRoot(root);
    assert.deepStrictEqual(scan1.enroute.photographers['Abbas Bhai'].count, scan2.enroute.photographers['Abbas Bhai'].count);
    const bytes = await fsp.readFile(path.join(root, 'Enroute', 'Abbas Bhai', 'a.jpg'), 'utf8');
    assert.equal(bytes, 'persisted-bytes', 'reopening/rescanning the workspace must never alter Enroute\'s real content');
  });

  // ═══════════════ K — numbered QMZ sequence assignment is unaffected ═══════════════
  console.log('=== K: numbered sequence assignment continues working unaffected ===');

  await t('K: moveFilesToSequence still correctly builds <code>/<photographer>/<file> after Enroute exists and has content', async () => {
    const root = await mkQmzRoot();
    await moveFilesToEnroute(root, [await (async () => { const p = path.join(root, '_Unsequenced', 'Abbas Bhai', 'x.jpg'); await writeFile(p); return p; })()], 'Abbas Bhai');
    await createSequence(root, 2, 'M');
    const src = path.join(root, '_Unsequenced', 'Husain Bhai', 'y.jpg');
    await writeFile(src);
    const r = await moveFilesToSequence(root, [src], '02M', 'Husain Bhai');
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(root, '02M', 'Husain Bhai', 'y.jpg')));
  });

  // ═══════════════ L — no automatic movement occurs merely because Enroute was created ═══
  console.log('=== L: creating Enroute never auto-moves anything ===');

  await t('L: ensureEnroute() never moves any existing photograph anywhere', async () => {
    const root = await mkQmzRoot();
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'untouched.jpg');
    await writeFile(src, 'should-not-move');
    await ensureEnroute(root);
    assert.ok(fs.existsSync(src), 'the file must still be exactly where it was — Enroute\'s mere existence must never trigger a move');
    assert.deepStrictEqual(await listDirNames(path.join(root, 'Enroute')), [], 'a freshly created Enroute must start completely empty');
  });

  // ═══════════════ M — no unexpected metadata writes ═══════════════
  console.log('=== M: no metadata-write side effects from an Enroute move ===');

  await t('M: moveFilesToEnroute never touches qmz-sequences.json state (Enroute is not a sequence, nothing to record)', async () => {
    const root = await mkQmzRoot();
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    const stateBefore = await qmz.readState(root);
    await moveFilesToEnroute(root, [src], 'Abbas Bhai');
    const stateAfter = await qmz.readState(root);
    assert.deepStrictEqual(stateBefore, stateAfter, 'moving a file into Enroute must not write any sequence state at all');
  });

  // ═══════════════ N — path-traversal / unsafe photographer-name characterization ═══════
  console.log('=== N: path-traversal characterization (parity check against the existing shared engine) ===');

  await t('N: a traversal-shaped photographer name behaves IDENTICALLY for Enroute and for the existing numbered-sequence path (pre-existing shared trust boundary, not introduced by or specific to Enroute)', async () => {
    // NOTE: this does not assert traversal is blocked — it asserts PARITY. Neither
    // moveFilesToEnroute nor the pre-existing moveFilesToSequence/moveFilesToUnsequenced
    // validates `photographerName` against path-traversal sequences; all three trust it
    // exactly the same amount, because in every real UI path this value is always sourced
    // from an already-scanned, real on-disk folder name or an already-selected real file's
    // own path — never free-typed by an operator. See the accompanying report for the full
    // characterization and why this is correctly out of scope for this narrowly-targeted
    // Enroute-folder-preservation task to "fix" on its own.
    const rootEnroute = await mkQmzRoot();
    const rootSeq      = await mkQmzRoot();
    await createSequence(rootSeq, 1, 'Q');
    const traversalName = '..' + path.sep + '..' + path.sep + 'escaped-enroute';
    const traversalName2 = '..' + path.sep + '..' + path.sep + 'escaped-seq';

    const srcE = path.join(rootEnroute, '_Unsequenced', 'real-pg', 'a.jpg');
    await writeFile(srcE);
    const rE = await moveFilesToEnroute(rootEnroute, [srcE], traversalName);

    const srcS = path.join(rootSeq, '_Unsequenced', 'real-pg', 'a.jpg');
    await writeFile(srcS);
    const rS = await moveFilesToSequence(rootSeq, [srcS], '01Q', traversalName2);

    // Parity: both either succeed or fail the same way — Enroute introduces no NEW gap and no
    // NEW protection relative to the already-shipped numbered-sequence move path.
    assert.equal(rE.ok, rS.ok, 'Enroute and the existing numbered-sequence path must behave identically for the same unsafe input');
  });

  // ═══════════════ O — a movement failure must not cause unrelated data loss ═══════════
  console.log('=== O: a per-file movement failure never touches unrelated files ===');

  await t('O: one unreadable/missing source file in a batch fails independently — every OTHER file still moves, nothing unrelated is lost', async () => {
    const root = await mkQmzRoot();
    const srcDir = path.join(root, '_Unsequenced', 'Abbas Bhai');
    const good1 = path.join(srcDir, 'good1.jpg');
    const good2 = path.join(srcDir, 'good2.jpg');
    const missing = path.join(srcDir, 'does-not-exist.jpg'); // never written — simulates a vanished/already-moved source
    await writeFile(good1, 'bytes-1');
    await writeFile(good2, 'bytes-2');
    const untouchedSibling = path.join(root, '_Unsequenced', 'Husain Bhai', 'leave-me-alone.jpg');
    await writeFile(untouchedSibling, 'do-not-touch');

    const r = await moveFilesToEnroute(root, [good1, missing, good2], 'Abbas Bhai');
    assert.equal(r.ok, false, 'a batch containing one missing source is reported as not fully ok');
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].error, 'source-missing');
    assert.equal(r.moved.length, 2, 'the two genuinely movable files are still moved despite the one failure');
    assert.ok(fs.existsSync(path.join(root, 'Enroute', 'Abbas Bhai', 'good1.jpg')));
    assert.ok(fs.existsSync(path.join(root, 'Enroute', 'Abbas Bhai', 'good2.jpg')));
    const untouchedBytes = await fsp.readFile(untouchedSibling, 'utf8');
    assert.equal(untouchedBytes, 'do-not-touch', 'a completely unrelated photographer\'s file must be untouched by another photographer\'s failed-batch move');
  });

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED');
  process.exit(process.exitCode || 0);
})().catch(err => {
  console.error('[qmzEnroutePhotographerFolderRegression] FATAL:', err);
  process.exit(1);
});
