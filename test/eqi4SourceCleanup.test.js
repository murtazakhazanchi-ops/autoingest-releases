// test/eqi4SourceCleanup.test.js — EQI-4 Safe Source Cleanup: evidence, eligibility, run, journal, recovery.
// Real files and real SHA-256 in temp folders. The Trash step here is a SIMULATION (a fake trash folder,
// files moved by rename) so every failure path can be forced; the real macOS Trash is exercised on disk-image
// volumes by test/eqi4TrashVolumes.test.js and in the live test.
// Run: node test/eqi4SourceCleanup.test.js

'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const evidence = require('../services/sourceCleanupEvidence');
const eligibility = require('../services/sourceCleanupEligibility');
const { createSourceCleanupService } = require('../services/sourceCleanupService');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const sha = (p) => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(p).on('data', c => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const bytes = (seed, n = 4096) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) % 251; return b; };

/** Simulated Trash (rename into <root>/.sim-trash). Failure injection by file name. */
function simTrash(state) {
  const trashDir = (root) => path.join(root, '.sim-trash');
  return {
    async capability(root) {
      if (state.unsupported) return { ok: false, platform: 'sim', verified: false, reason: 'Recoverable Trash is not available on this volume' };
      await fsp.mkdir(trashDir(root), { recursive: true });
      return { ok: true, platform: 'sim', verified: false, trashDir: trashDir(root), volume: root, fsType: 'sim' };
    },
    async trashFile(file, cap, _deps, hooks) {
      const name = path.basename(file);
      const before = (await fsp.readdir(cap.trashDir)).filter(n => n.startsWith(name));
      if (hooks && hooks.beforeTrash) await hooks.beforeTrash(before.map(n => path.join(cap.trashDir, n)));
      if (state.failOn && state.failOn.test(name)) return { outcome: 'not-removed', error: 'The Trash refused it: simulated' };
      let dest = path.join(cap.trashDir, name);
      if (fs.existsSync(dest)) dest = `${dest} ${Date.now()}${path.extname(name)}`;
      await fsp.rename(file, dest);
      state.trashed = (state.trashed || 0) + 1;
      return { outcome: 'trashed', trashPath: dest };
    },
    async locate(file, size, before, cap) {
      if (fs.existsSync(file)) return { where: 'source' };
      if (!cap) return { where: 'unknown' };
      const had = new Set(before || []);
      for (const n of await fsp.readdir(cap.trashDir).catch(() => [])) {
        const p = path.join(cap.trashDir, n);
        if (n.startsWith(path.basename(file)) && !had.has(p) && fs.statSync(p).size === size) return { where: 'trash', trashPath: p };
      }
      return { where: 'unknown' };
    },
  };
}

async function setup() {
  const root = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi4-unit-')));
  const userData = path.join(root, 'userData');
  const card = path.join(root, 'CARD_A');
  const archive = path.join(root, 'archive');
  const staging = path.join(root, 'staging');
  for (const d of [userData, card, archive, staging]) await fsp.mkdir(d, { recursive: true });
  return { root, userData, card, archive, staging };
}

/** Writes `n` source files and (optionally) imports them: copies to the archive and records evidence. */
async function put(card, rel, data) { const p = path.join(card, rel); await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, data); return p; }
async function importFiles(env, srcs, { mode = 'direct', destOf } = {}) {
  const files = [];
  for (const src of srcs) {
    const dest = destOf ? destOf(src) : path.join(env.archive, 'Coll', 'Event', 'Dump', 'Ph', path.relative(env.card, src));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
    files.push({ src, dest, size: fs.statSync(src).size });
  }
  return evidence.recordBatch(env.userData, { batchId: `imp-${Math.random().toString(36).slice(2)}`, importMode: mode, eventPath: path.join(env.archive, 'Coll', 'Event'), destination: 'dump', sourceRoot: env.card, files });
}

function service(env, state = {}, extra = {}) {
  return createSourceCleanupService({
    userData: env.userData, evidence, eligibility, trash: simTrash(state),
    io: { realpath: (p) => fsp.realpath(p), stat: (p) => fsp.stat(p), sha256: sha, fingerprint: evidence.fingerprint, imageHash: async (p) => (state.imageHash ? state.imageHash(p) : null) },
    roots: () => ({ nasRoot: extra.nasRoot === undefined ? env.archive : extra.nasRoot, mainArchiveRoot: env.archive, stagingRoot: env.staging }),
    resolveArchiveEvent: async (localEventPath, nasRoot) => ({ ok: true, archiveEventPath: path.join(nasRoot, path.basename(path.dirname(localEventPath)), path.basename(localEventPath)) }),
    readManifest: async (lep) => (extra.manifest ? extra.manifest(lep) : null),
    relKey: (ev, f) => path.relative(ev, f).split(path.sep).join('/'),
    busyReason: () => state.busy || null,
    listSource: async (r) => {
      const out = [];
      const walk = async (d) => { for (const e of await fsp.readdir(d, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else out.push({ path: p, size: fs.statSync(p).size }); } };
      await walk(r); return out;
    },
    testHooks: extra.testHooks || null,
  });
}

(async () => {
  console.log('=== evidence ===');
  await t('evidence is per file, newest wins, scoped to the source root; a file changed during the import is not recorded', async () => {
    const env = await setup();
    const a = await put(env.card, 'DCIM/100/IMG_0001.JPG', bytes(1));
    const r1 = await importFiles(env, [a]);
    assert.equal(r1.recorded, 1);
    const r2 = await evidence.recordBatch(env.userData, { batchId: 'x', files: [{ src: a, dest: '/nope', size: 1 }] });
    assert.equal(r2.ok, false, 'size differs from the source now → nothing recorded');
    const other = path.join(env.root, 'CARD_B'); await fsp.mkdir(other);
    assert.equal((await evidence.forSource(env.userData, other)).size, 0, 'card B sees none of card A');
    assert.equal((await evidence.forSource(env.userData, env.card)).size, 1);
  });

  console.log('=== review / run ===');
  await t('100 imported + 20 unimported: exactly the 100 verified files go to the Trash, the 20 stay', async () => {
    const env = await setup();
    const imported = [];
    for (let i = 1; i <= 100; i++) imported.push(await put(env.card, `DCIM/100CANON/IMG_${String(i).padStart(4, '0')}.CR3`, bytes(i)));
    const left = [];
    for (let i = 101; i <= 120; i++) left.push(await put(env.card, `DCIM/100CANON/IMG_${String(i).padStart(4, '0')}.CR3`, bytes(i)));
    await importFiles(env, imported);
    const svc = service(env);
    const rv = await svc.review(env.card);
    assert.equal(rv.ok, true); assert.deepEqual(rv.blockers, []);
    assert.equal(rv.counts.eligibleFiles, 100); assert.equal(rv.counts.unimported, 20); assert.equal(rv.counts.excluded, 0);
    const res = await svc.run(rv.reviewId);
    assert.equal(res.summary.trashed, 100);
    for (const p of imported) assert.equal(fs.existsSync(p), false);
    for (const p of left) assert.equal(fs.existsSync(p), true, 'unimported file untouched');
    assert.equal(fs.readdirSync(path.join(env.archive, 'Coll', 'Event', 'Dump', 'Ph', 'DCIM', '100CANON')).length, 100, 'archive untouched');
    assert.equal(fs.existsSync(path.join(env.card, 'DCIM', '100CANON')), true, 'camera folders kept');
  });

  await t('changed, replaced-with-same-size, archive-missing, archive-damaged and same-physical-file sources are excluded with reasons', async () => {
    const env = await setup();
    const changed = await put(env.card, 'DCIM/A.JPG', bytes(1));
    const replaced = await put(env.card, 'DCIM/B.JPG', bytes(2));
    const missing = await put(env.card, 'DCIM/C.JPG', bytes(3));
    const same = await put(env.card, 'DCIM/D.JPG', bytes(4));
    const archDiff = await put(env.card, 'DCIM/E.JPG', bytes(5));
    await importFiles(env, [changed, replaced, missing, archDiff]);
    await fsp.writeFile(path.join(env.archive, 'Coll', 'Event', 'Dump', 'Ph', 'DCIM', 'E.JPG'), bytes(55));   // archive copy damaged, same size
    await evidence.recordBatch(env.userData, { batchId: 'same', importMode: 'direct', sourceRoot: env.card, files: [{ src: same, dest: same, size: fs.statSync(same).size }] });
    await fsp.appendFile(changed, 'x');
    const st = fs.statSync(replaced); await fsp.writeFile(replaced, bytes(99)); await fsp.utimes(replaced, st.atime, st.mtime);
    await fsp.unlink(path.join(env.archive, 'Coll', 'Event', 'Dump', 'Ph', 'DCIM', 'C.JPG'));
    const rv = await service(env).review(env.card);
    const why = Object.fromEntries(rv.excluded.map(e => [path.basename(e.rel), e.reason]));
    assert.match(why['A.JPG'], /Changed on the source/);
    assert.match(why['B.JPG'], /Changed on the source/, 'replaced with same name, size and time: the fingerprint differs');
    assert.match(why['E.JPG'], /differs/);
    assert.match(why['C.JPG'], /not found/);
    assert.match(why['D.JPG'], /same file/);
    assert.equal(rv.counts.eligibleFiles, 0);
  });

  await t('a JPEG whose archive copy got metadata is verified by image data; different image data is excluded', async () => {
    const env = await setup();
    const a = await put(env.card, 'DCIM/A.JPG', bytes(1));
    const b = await put(env.card, 'DCIM/B.JPG', bytes(2));
    await importFiles(env, [a, b]);
    for (const n of ['A.JPG', 'B.JPG']) await fsp.appendFile(path.join(env.archive, 'Coll', 'Event', 'Dump', 'Ph', 'DCIM', n), 'XMPMETA');
    const state = { imageHash: (p) => (path.basename(p) === 'B.JPG' && p.includes('archive') ? 'other' : `img-${path.basename(p)}`) };
    const rv = await service(env, state).review(env.card);
    assert.deepEqual(rv.eligible.map(e => [path.basename(e.rel), e.verified]), [['A.JPG', 'image-data']]);
    assert.match(rv.excluded[0].reason, /differs/);
  });

  await t('RAW + JPEG + XMP are one asset: an unimported JPEG or sidecar keeps the RAW on the card; duplicate names in other folders are separate', async () => {
    const env = await setup();
    const raw = await put(env.card, 'DCIM/100/IMG_0001.CR3', bytes(1));
    await put(env.card, 'DCIM/100/IMG_0001.JPG', bytes(2));        // not imported
    const raw2 = await put(env.card, 'DCIM/100/IMG_0002.CR3', bytes(3));
    await put(env.card, 'DCIM/100/IMG_0002.xmp', bytes(4, 300));   // sidecar not imported
    const dup1 = await put(env.card, 'DCIM/101/IMG_0001.CR3', bytes(5));
    const dupJ = await put(env.card, 'DCIM/101/IMG_0001.JPG', bytes(6));
    const vid = await put(env.card, 'PRIVATE/M4ROOT/CLIP/C0001.MP4', bytes(7));
    await importFiles(env, [raw, raw2, dup1, dupJ, vid]);
    const rv = await service(env).review(env.card);
    const elig = rv.eligible.map(e => e.rel).sort();
    assert.deepEqual(elig, ['DCIM/101/IMG_0001.CR3', 'DCIM/101/IMG_0001.JPG', 'PRIVATE/M4ROOT/CLIP/C0001.MP4'].map(p => p.split('/').join(path.sep)).sort());
    const why = Object.fromEntries(rv.excluded.map(e => [e.rel, e.reason]));
    assert.match(why[path.join('DCIM', '100', 'IMG_0001.CR3')], /Kept with IMG_0001\.JPG/);
    assert.match(why[path.join('DCIM', '100', 'IMG_0002.CR3')], /Kept with IMG_0002\.xmp/);
    const svc = service(env); const rv2 = await svc.review(env.card); const r2 = await svc.run(rv2.reviewId);
    assert.equal(r2.summary.trashed, 3);
    assert.equal(fs.existsSync(raw) && fs.existsSync(raw2), true, 'RAWs whose pair is unverified stay');
    assert.equal(fs.existsSync(path.join(env.card, 'PRIVATE', 'M4ROOT', 'CLIP')), true, 'video folder structure kept');
  });

  await t('Local First: only a synced, verified ARCHIVE copy counts; staging-only or NAS unavailable is excluded; reservations are followed', async () => {
    const env = await setup();
    const a = await put(env.card, 'DCIM/A.JPG', bytes(1));
    const b = await put(env.card, 'DCIM/B.JPG', bytes(2));
    const c = await put(env.card, 'DCIM/C.JPG', bytes(3));
    const stEvent = path.join(env.staging, 'Coll', 'Ev');
    await importFiles(env, [a, b, c], { mode: 'local-first', destOf: (s) => path.join(stEvent, 'Dump', 'Ph', path.basename(s)) });
    const arch = path.join(env.archive, 'Coll', 'Ev', 'Dump', 'Ph');
    await fsp.mkdir(arch, { recursive: true });
    await fsp.copyFile(a, path.join(arch, 'A.JPG'));             // synced as-is
    await fsp.copyFile(c, path.join(arch, 'C_1.JPG'));           // synced under a reserved conflict name
    const manifest = () => ({ jobs: [{ importId: 'x', resolvedFiles: [{ relPath: 'Dump/Ph/C.JPG', finalRelPath: 'Dump/Ph/C_1.JPG' }] }] });
    const rv = await service(env, {}, { manifest }).review(env.card);
    assert.deepEqual(rv.eligible.map(e => path.basename(e.rel)).sort(), ['A.JPG', 'C.JPG']);
    assert.match(rv.excluded.find(e => e.rel.endsWith('B.JPG')).reason, /Not synced to the archive yet/);
    const off = await service(env, {}, { nasRoot: path.join(env.root, 'nas-offline'), manifest }).review(env.card);
    assert.equal(off.counts.eligibleFiles, 0);
    assert.match(off.excluded[0].reason, /not available/);
  });

  await t('scope: a source inside / containing the archive or staging, or an event Dump, is refused', async () => {
    const env = await setup();
    const svc = service(env);
    assert.match(svc.scopeRefusal(path.join(env.archive, 'Coll')), /inside the archive/);
    assert.match(svc.scopeRefusal(env.root), /contains/);
    assert.match(svc.scopeRefusal(path.join(env.root, 'elsewhere', 'Ev', 'Dump')), /Dump/);
    assert.match(svc.scopeRefusal('/'), /whole disk/);
    assert.equal(svc.scopeRefusal(env.card), null);
  });

  await t('busy (import / metadata) or unsupported Trash: review shows the blocker and run refuses — nothing moves', async () => {
    const env = await setup();
    const a = await put(env.card, 'DCIM/A.JPG', bytes(1));
    await importFiles(env, [a]);
    const state = { busy: 'An import is running — clean up when it has finished.' };
    const svc = service(env, state);
    const rv = await svc.review(env.card);
    assert.deepEqual(rv.blockers, [state.busy]);
    assert.equal((await svc.run(rv.reviewId)).ok, false);
    const st2 = { unsupported: true }; const svc2 = service(env, st2);
    const rv2 = await svc2.review(env.card);
    assert.match(rv2.blockers[0], /not available/);
    assert.equal((await svc2.run(rv2.reviewId)).ok, false);
    assert.equal(fs.existsSync(a), true);
  });

  console.log('=== repeated cycles, re-verification, failures ===');
  await t('repeat in one session: import → clean → import more → clean → reinsert → card B; a review id works once', async () => {
    const env = await setup();
    const svc = service(env);
    const batch = async (card, from, n) => { const ps = []; for (let i = from; i < from + n; i++) ps.push(await put(card, `DCIM/100/IMG_${String(i).padStart(4, '0')}.JPG`, bytes(i))); return ps; };
    const b1 = await batch(env.card, 1, 10); const keep = await batch(env.card, 11, 3);
    await importFiles(env, b1);
    let rv = await svc.review(env.card);
    assert.equal((await svc.run(rv.reviewId)).summary.trashed, 10);
    assert.equal((await svc.run(rv.reviewId)).ok, false, 'the same review cannot run twice');
    const b2 = await batch(env.card, 20, 5);
    await importFiles(env, b2);
    rv = await svc.review(env.card);
    assert.equal(rv.counts.eligibleFiles, 5, 'second cycle sees only the new batch');
    assert.equal(rv.counts.unimported, 3);
    assert.equal((await svc.run(rv.reviewId)).summary.trashed, 5);
    // "reinsert": the card folder is unmounted and mounted again (renamed away and back)
    await fsp.rename(env.card, `${env.card}-ejected`); await fsp.rename(`${env.card}-ejected`, env.card);
    rv = await svc.review(env.card);
    assert.equal(rv.counts.eligibleFiles, 0); assert.equal(rv.counts.unimported, 3);
    const cardB = path.join(env.root, 'CARD_B'); await fsp.mkdir(cardB);
    const bB = await batch(cardB, 1, 4);    // same names as card A's first batch
    const envB = { ...env, card: cardB };
    await importFiles(envB, bB, { destOf: (s) => path.join(env.archive, 'Coll', 'Event2', path.basename(s)) });
    rv = await svc.review(cardB);
    assert.equal(rv.counts.eligibleFiles, 4);
    assert.equal((await svc.run(rv.reviewId)).summary.trashed, 4);
    for (const p of keep) assert.equal(fs.existsSync(p), true);
  });

  await t('re-verified at run time: a file changed after the review stays; the card removed mid-run stops the rest', async () => {
    const env = await setup();
    const ps = []; for (let i = 1; i <= 4; i++) ps.push(await put(env.card, `DCIM/IMG_${i}.JPG`, bytes(i)));
    await importFiles(env, ps);
    const svc = service(env);
    const rv = await svc.review(env.card);
    await fsp.appendFile(ps[0], 'changed');
    const res = await svc.run(rv.reviewId);
    const by = Object.fromEntries(res.files.map(f => [path.basename(f.rel), f]));
    assert.equal(by['IMG_1.JPG'].state, 'not-removed'); assert.match(by['IMG_1.JPG'].error, /Changed/);
    assert.equal(res.summary.trashed, 3);
    // card removed during a run
    const env2 = await setup();
    const qs = []; for (let i = 1; i <= 5; i++) qs.push(await put(env2.card, `DCIM/IMG_${i}.JPG`, bytes(i)));
    await importFiles(env2, qs);
    let n = 0;
    const st = {};
    const svc2 = service(env2, st, { testHooks: { crashAfterTrash: () => { if (++n === 2) fs.renameSync(env2.card, `${env2.card}-gone`); } } });
    const res2 = await svc2.run((await svc2.review(env2.card)).reviewId);
    assert.equal(res2.summary.trashed, 2);
    assert.equal(res2.files.filter(f => f.state === 'not-removed' && /disconnected|Not verified|no longer/.test(f.error || '')).length, 3);
  });

  await t('a refused file inside an asset: the rest of that asset stays, the split is reported; other assets continue', async () => {
    const env = await setup();
    const raw = await put(env.card, 'DCIM/IMG_1.CR3', bytes(1));
    const jpg = await put(env.card, 'DCIM/IMG_1.JPG', bytes(2));
    const other = await put(env.card, 'DCIM/IMG_2.JPG', bytes(3));
    await importFiles(env, [raw, jpg, other]);
    const svc = service(env, { failOn: /IMG_1\.JPG/ });
    const res = await svc.run((await svc.review(env.card)).reviewId);
    const by = Object.fromEntries(res.files.map(f => [path.basename(f.rel), f]));
    assert.equal(by['IMG_1.CR3'].state, 'trashed'); assert.equal(by['IMG_1.CR3'].partialAsset, true);
    assert.equal(by['IMG_1.JPG'].state, 'not-removed');
    assert.equal(by['IMG_2.JPG'].state, 'trashed');
    assert.equal(fs.existsSync(jpg), true);
  });

  console.log('=== journal, crash recovery, lock ===');
  await t('crash recovery reconciles from real state and never trashes again', async () => {
    const env = await setup();
    const ps = []; for (let i = 1; i <= 4; i++) ps.push(await put(env.card, `DCIM/IMG_${i}.JPG`, bytes(i)));
    await importFiles(env, ps);
    const trashDir = path.join(env.card, '.sim-trash'); await fsp.mkdir(trashDir, { recursive: true });
    // An interrupted journal: 1 trashed-before-crash (in Trash, journal still 'trashing'), 1 'trashing' but still on
    // the source, 1 'trashing' and gone from both, 1 'planned'.
    await fsp.rename(ps[0], path.join(trashDir, 'IMG_1.JPG'));
    await fsp.unlink(ps[2]);
    const size = fs.statSync(ps[1]).size;
    const doc = { schema: 'autoingest.sourceCleanup', version: 1, id: 'sc-crash', state: 'running', startedAt: new Date().toISOString(), source: { root: env.card },
      capability: { platform: 'sim', trashDir }, files: [
        { path: ps[0], size, state: 'trashing', trashBefore: [] }, { path: ps[1], size, state: 'trashing', trashBefore: [] },
        { path: ps[2], size, state: 'trashing', trashBefore: [] }, { path: ps[3], size, state: 'planned' }] };
    await fsp.mkdir(path.join(env.userData, 'source-cleanup', 'journal'), { recursive: true });
    await fsp.writeFile(path.join(env.userData, 'source-cleanup', 'journal', 'sc-crash.json'), JSON.stringify(doc));
    const state = {};
    const svc = service(env, state);
    const rep = await svc.recover();
    assert.deepEqual(rep[0].summary, { trashed: 1, notRemoved: 2, attention: 1, bytes: size });
    assert.equal(state.trashed || 0, 0, 'recovery never moved anything');
    assert.equal(fs.existsSync(ps[1]) && fs.existsSync(ps[3]), true);
    assert.equal(fs.readdirSync(path.join(env.userData, 'source-cleanup', 'journal')).filter(n => n.endsWith('.json')).length, 0, 'journal finished');
    const hist = await svc.history();
    assert.equal(hist[0].state, 'reconciled');
  });

  await t('one cleanup per computer: a live lock of another process refuses; a stale lock is taken over', async () => {
    const env = await setup();
    const a = await put(env.card, 'DCIM/A.JPG', bytes(1));
    await importFiles(env, [a]);
    const lock = path.join(env.userData, 'source-cleanup', 'run.lock');
    await fsp.mkdir(path.dirname(lock), { recursive: true });
    await fsp.writeFile(lock, JSON.stringify({ pid: process.ppid, at: Date.now() }));   // the parent shell: alive
    const svc = service(env);
    const r1 = await svc.run((await svc.review(env.card)).reviewId);
    assert.equal(r1.ok, false); assert.match(r1.blockers[0], /Another AutoIngest/);
    await fsp.writeFile(lock, JSON.stringify({ pid: 999999, at: Date.now() }));        // gone
    const r2 = await svc.run((await svc.review(env.card)).reviewId);
    assert.equal(r2.summary.trashed, 1);
    assert.equal(fs.existsSync(lock), false, 'lock released');
  });

  console.log(`eqi4SourceCleanup: ${passed} passed`);
})();
