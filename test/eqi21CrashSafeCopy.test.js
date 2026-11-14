'use strict';

// AI-FEAT-064 EQI-2.1 — crash-safe destination writes in the shared copy engine (main/fileManager.js).
// A copy is written to "<name>.aiimport-partial" and renamed only after verification, so a crash
// mid-copy never leaves a truncated file under the photo's real name (which a later import would
// see as a name conflict and import again as "_1"). Temp folders only.
// Run: node test/eqi21CrashSafeCopy.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { copyFileJobs, resolveDestPath, PARTIAL_SUFFIX } = require('../main/fileManager');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
const ls = async (d) => (await fsp.readdir(d).catch(() => [])).sort();

(async () => {
  console.log('eqi21CrashSafeCopy');
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi21-copy-'));
  const src = path.join(tmp, 'card'); await fsp.mkdir(src);
  const files = {};
  for (const n of ['A.CR3', 'B.CR3', 'C.JPG']) { files[n] = crypto.randomBytes(300 * 1024); await fsp.writeFile(path.join(src, n), files[n]); }
  const jobs = (dest) => Object.keys(files).map(n => ({ src: path.join(src, n), dest: path.join(dest, n) }));

  await t('a normal copy leaves only verified files under their real names — no partial files', async () => {
    const dest = path.join(tmp, 'd1');
    const seen = [];
    const r = await copyFileJobs(jobs(dest), () => {}, { onCopyStart: (a) => seen.push(a.dest), onCopyEnd: () => {} });
    assert.equal(r.copied, 3);
    assert.deepEqual(await ls(dest), ['A.CR3', 'B.CR3', 'C.JPG']);
    assert.ok(seen.every(p => p.endsWith(PARTIAL_SUFFIX)), 'bytes are written to the partial while copying (byte instrumentation follows it)');
    for (const n of Object.keys(files)) assert.ok((await fsp.readFile(path.join(dest, n))).equals(files[n]));
  });

  await t('after a crash mid-copy (a truncated partial left behind) the re-import copies the photo once — no "_1", no truncated file', async () => {
    const dest = path.join(tmp, 'd2'); await fsp.mkdir(dest);
    // what a crash leaves: A fully copied; B half-written as a partial; C not started
    await fsp.writeFile(path.join(dest, 'A.CR3'), files['A.CR3']);
    await fsp.writeFile(path.join(dest, 'B.CR3' + PARTIAL_SUFFIX), files['B.CR3'].subarray(0, 100 * 1024));
    const r = await copyFileJobs(jobs(dest), () => {});
    assert.deepEqual([r.copied, r.skipped, r.errors], [2, 1, 0], 'A skipped (same size), B and C copied');
    assert.deepEqual(await ls(dest), ['A.CR3', 'B.CR3', 'C.JPG'], 'no "_1" copy and no partial left');
    assert.ok((await fsp.readFile(path.join(dest, 'B.CR3'))).equals(files['B.CR3']), 'B is complete');
  });

  await t('the OLD failure mode, for contrast: a truncated file under the real name is never overwritten — it becomes a name conflict', async () => {
    const dest = path.join(tmp, 'd3'); await fsp.mkdir(dest);
    await fsp.writeFile(path.join(dest, 'B.CR3'), files['B.CR3'].subarray(0, 100 * 1024));
    await copyFileJobs([{ src: path.join(src, 'B.CR3'), dest: path.join(dest, 'B.CR3') }], () => {});
    assert.deepEqual(await ls(dest), ['B.CR3', 'B_1.CR3'], 'existing files are never overwritten (unchanged rule) — which is why the partial-file write matters');
  });

  await t('a destination that appears during the copy is never overwritten', async () => {
    const dest = path.join(tmp, 'd4'); await fsp.mkdir(dest);
    let planted = false;
    const r = await copyFileJobs([{ src: path.join(src, 'C.JPG'), dest: path.join(dest, 'C.JPG') }], () => {}, {
      onCopyStart: () => {}, onCopyEnd: () => { if (!planted) { planted = true; require('node:fs').writeFileSync(path.join(dest, 'C.JPG'), 'someone else'); } },
    });
    assert.equal(await fsp.readFile(path.join(dest, 'C.JPG'), 'utf8'), 'someone else', 'the other file is intact');
    assert.deepEqual([r.copied, r.errors], [0, 1], 'reported as a failed file — never a silent overwrite');
    assert.ok(!(await ls(dest)).some(n => n.endsWith(PARTIAL_SUFFIX)), 'no partial left behind');
  });

  await t('a name claimed by an in-flight copy is taken even though only its partial is on disk', async () => {
    const dest = path.join(tmp, 'd5'); await fsp.mkdir(dest);
    const claimed = new Set([path.join(dest, 'IMG_0001.JPG')]);
    const r = await resolveDestPath(dest, 'IMG_0001.JPG', 123, claimed);
    assert.deepEqual([r.action, path.basename(r.destPath)], ['rename', 'IMG_0001_1.JPG']);
    assert.equal((await resolveDestPath(dest, 'IMG_0001.JPG', 123)).action, 'copy', 'without a claim the name is free (unchanged behaviour)');
  });

  await t('two different photos of the same name in ONE import, copied concurrently: "<name>" and "<name>_1", both intact', async () => {
    const dest = path.join(tmp, 'd6');
    const sources = [];
    for (const folder of ['100CANON', '101CANON', '102CANON']) {
      const d = path.join(src, folder); await fsp.mkdir(d, { recursive: true });
      const bytes = crypto.randomBytes(6 * 1024 * 1024 + sources.length);   // different contents and sizes
      await fsp.writeFile(path.join(d, 'IMG_0001.JPG'), bytes); sources.push(bytes);
    }
    const r = await copyFileJobs(['100CANON', '101CANON', '102CANON'].map(f => ({ src: path.join(src, f, 'IMG_0001.JPG'), dest: path.join(dest, 'IMG_0001.JPG') })), () => {});
    assert.deepEqual([r.copied, r.errors], [3, 0], 'no file lost to a commit conflict');
    assert.deepEqual(await ls(dest), ['IMG_0001.JPG', 'IMG_0001_1.JPG', 'IMG_0001_2.JPG']);
    const got = await Promise.all((await ls(dest)).map(n => fsp.readFile(path.join(dest, n))));
    assert.ok(sources.every(b => got.some(g => g.equals(b))), 'every photo present exactly as on the card — none overwritten');
  });

  await fsp.rm(tmp, { recursive: true, force: true });
  console.log(`eqi21CrashSafeCopy: ${passed} passed${process.exitCode ? ', FAILURES above' : ''}`);
})();
