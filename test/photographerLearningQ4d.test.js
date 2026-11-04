'use strict';

// AI-FEAT-063 / AI-RM-014 Q4d — interrupted-learning recovery, evidence integrity and the
// cross-process learning state. The real learning service, the real Q4b registry store, the
// real recovery-evidence rules and the real state store run against throw-away temp folders:
// a fake card, a fake archive event folder with event.json, and a FAKE secure storage.
// Camera tags are injected per file path (an ExifTool read is covered by the live test);
// the image-data hash is computed over a fake "pixel" section of each file so that a metadata
// rewrite keeps it while a different image does not. Every serial and photographer is FAKE.
//
// Run: node test/photographerLearningQ4d.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fileIdentity } = require('../services/cameraIdentityEvidence');
const { createIdentityRegistryStore } = require('../services/identityRegistryStore');
const { createPhotographerLearningService, learningKey } = require('../services/photographerLearningService');
const { createLearningStateStore } = require('../services/learningStateStore');
const RE = require('../services/learningRecoveryEvidence');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-q4d-learning-'));
let n = 0;
const SHIPPED = ['Shipped Q4d Person'];
const LIST = [...SHIPPED, 'Local Q4d Alpha', 'Local Q4d Beta'];
const COMPUTER = 'comp-q4d-A';
const T = {
  canonA: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS R5', 'ExifIFD:SerialNumber': 'FAKEQ4DR5A01' },
  canonB: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS R5', 'ExifIFD:SerialNumber': 'FAKEQ4DR5B02' },
  sony: { 'IFD0:Make': 'SONY', 'IFD0:Model': 'ILCE-7M3', 'Sony:InternalSerialNumber': 'FAKEQ4DSONY1' },
  modelOnly: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS R5' },
  unknown: {},
};
const FAKE_SERIALS = ['FAKEQ4DR5A01', 'FAKEQ4DR5B02', 'FAKEQ4DSONY1'];

function fakeSecureStorage(over = {}) {
  return { backend: 'fake-test', identity: 'q4d-test-app', isAvailable: () => true,
    encrypt: (b) => Buffer.concat([Buffer.from('S:'), b]), decrypt: (c) => { if (!c.subarray(0, 2).equals(Buffer.from('S:'))) throw new Error('x'); return Buffer.from(c.subarray(2)); }, ...over };
}

// ── Media fixtures: "PIX:<pixels>|META:<metadata>" ───────────────────────────────
const TAGS = new Map(); // absolute path → camera tags a read of that file would return
const media = (pixels, meta = 'camera-original') => `PIX:${pixels}|META:${meta}`;
async function fakeHash(p) { const s = await fsp.readFile(p, 'utf8'); const m = /^PIX:(.*)\|META:/s.exec(s); return m ? crypto.createHash('md5').update(m[1]).digest('hex') : null; }
const pairKey = (dest) => RE.captureKey(dest);
const ext = (f) => path.extname(f).toLowerCase();

/** Recovery resolver equivalent to the runtime's, with injected tag reads (by evidence path). */
function testRecoveryResolver(io = {}) {
  return async (files) => {
    const cio = { stat: io.stat || (p => fsp.stat(p)), imageDataHash: io.imageDataHash || fakeHash };
    const classified = [];
    for (const f of files) classified.push({ file: f, c: await RE.classifyCommittedFile(f, cio) });
    const sum = RE.summarize(classified);
    if (sum.transient) return { records: [], unread: files.length, source: 'unavailable', transient: sum.transient, counts: sum.counts };
    if (!sum.usable.length) return { records: [], unread: sum.unread, source: 'unavailable', reason: 'no-trustworthy-evidence', waitingForSource: sum.waitingForSource, counts: sum.counts };
    const keys = sum.usable.map(u => pairKey(u.file.dest));
    const records = sum.usable.map((u, i) => ({
      path: u.file.dest, name: path.basename(u.file.dest), type: ['.cr3', '.arw'].includes(ext(u.file.dest)) ? 'raw' : 'photo', size: u.file.size,
      pairKey: keys.filter(k => k === keys[i]).length > 1 ? keys[i] : null, evidence: null, identity: fileIdentity(TAGS.get(u.path) || {}),
    }));
    return { records, unread: sum.unread, waitingForSource: sum.waitingForSource, source: sum.counts.source ? 'archive+source' : 'archive', counts: sum.counts };
  };
}

/**
 * One committed import on disk: card files, archive copies under Event/<photographer>/ and an
 * event.json entry — exactly what a successful import:commitTransaction leaves behind.
 * @param {Array<{name: string, tags: object, pixels?: string}>} spec
 */
async function committedImport(photographer, spec, { eventDir, entryIds = [`entry-q4d-${++n}`], operatorId = 'op-q4d-1' } = {}) {
  const base = path.join(ROOT, `import-${++n}`);
  const card = path.join(base, 'card', 'DCIM', '100CANON');
  eventDir = eventDir || path.join(base, 'archive', `Event ${n}`);
  const destDir = path.join(eventDir, photographer);
  await fsp.mkdir(card, { recursive: true }); await fsp.mkdir(destDir, { recursive: true });
  const files = [];
  for (const f of spec) {
    const src = path.join(card, f.name), dest = path.join(destDir, f.name);
    const body = media(f.pixels || `${f.name}-${n}`);
    await fsp.writeFile(src, body); await fsp.copyFile(src, dest);
    TAGS.set(src, f.tags); TAGS.set(dest, f.tags);
    files.push({ src, dest, size: Buffer.byteLength(body) });
  }
  const ej = path.join(eventDir, 'event.json');
  const doc = fs.existsSync(ej) ? JSON.parse(fs.readFileSync(ej, 'utf8')) : { status: 'complete', imports: [] };
  for (const id of entryIds) doc.imports.push({ id, timestamp: new Date().toISOString(), componentIndex: 0, counts: { photos: spec.length, videos: 0 }, photographer, importedBy: { id: operatorId } });
  await fsp.writeFile(ej, JSON.stringify(doc));
  return { eventDir, entryIds, files, card, operatorId, ctx: { entryIds, photographer, files, copied: files.length, workflow: 'event-import', operatorId, eventDir } };
}

/** AutoIngest's in-place metadata write: same pixels, more metadata → different size. */
async function rewriteMetadata(p) { const s = await fsp.readFile(p, 'utf8'); await fsp.writeFile(p, s.replace('|META:camera-original', '|META:camera-original+XMP-dc:Creator=AutoIngest+IPTC:Keywords')); }

/** A computer: its userData identity-registry dir and a learning service over a real store. */
function computer({ dir = path.join(ROOT, `ud-${++n}`, 'identity-registry'), computerId = COMPUTER, enabled = true, secureStorage = fakeSecureStorage(),
  liveEvidence = null, evidenceDelayMs = 0, recoveryIo = {}, busy = () => false, clock, limits, maxQueue, recoveryDelayMs = 0 } = {}) {
  let store = null;
  const c = {
    dir, computerId, store: () => store,
    svc: createPhotographerLearningService({
      isEnabled: () => enabled,
      journalDir: () => dir,
      getComputerId: () => computerId,
      getNames: () => ({ listNames: LIST, shippedNames: SHIPPED }),
      openStore: async () => { store = createIdentityRegistryStore({ dir, secureStorage, computerId }); await store.open(); return store; },
      resolveEvidence: async (files, { signal }) => {
        if (evidenceDelayMs) await new Promise((res) => { const tm = setTimeout(res, evidenceDelayMs); signal.addEventListener('abort', () => { clearTimeout(tm); res(); }); });
        if (liveEvidence) return liveEvidence(files);
        return { records: files.map(f => ({ path: f.src, name: path.basename(f.src), type: 'photo', size: f.size, pairKey: null, evidence: null, identity: fileIdentity(TAGS.get(f.src) || {}) })), unread: 0, source: 'read' };
      },
      resolveRecoveryEvidence: async (files, opts) => { if (recoveryDelayMs) await new Promise((res) => { const tm = setTimeout(res, recoveryDelayMs); opts.signal.addEventListener('abort', () => { clearTimeout(tm); res(); }); }); return testRecoveryResolver(recoveryIo)(files, opts); },
      isBusy: busy,
      now: clock || (() => new Date()),
      limits,
      ...(maxQueue ? { maxQueue } : {}),
    }),
  };
  return c;
}
const restart = (c, over = {}) => computer({ dir: c.dir, computerId: c.computerId, ...over });
const stateOf = (c) => ({
  journal: (() => { try { return JSON.parse(fs.readFileSync(path.join(c.dir, 'learning', 'learning-journal.json'), 'utf8')).entries; } catch { return []; } })(),
  pending: (() => { try { return JSON.parse(fs.readFileSync(path.join(c.dir, 'learning', 'learning-pending.json'), 'utf8')).items; } catch { return []; } })(),
});
const keyOf = (imp) => learningKey(COMPUTER, imp.entryIds);
const entryFor = (c, imp) => stateOf(c).journal.find(e => e.key === keyOf(imp));
const eventsFor = (c, imp) => c.store().getEvents().filter(e => e.importId === keyOf(imp));
async function quit(c) { c.svc.shutdown(); await c.svc.whenIdle(); const s = c.store(); if (s) s.releaseLockSync(); }
async function closeStore(c) { const s = c.store(); if (s) await s.close(); }
const io = { computerId: COMPUTER, learningKey, stat: p => fsp.stat(p), readFile: p => fsp.readFile(p) };

(async () => {
  // ═══ Evidence rules (pure, real files) ═════════════════════════════════════════
  console.log('Q4d — commit verification');
  await t('a committed import verifies; every tampered or rolled-back variant is refused, offline is transient', async () => {
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0001.CR3', tags: T.canonA }]);
    const item = { importId: keyOf(imp), computerId: COMPUTER, entryIds: imp.entryIds, eventDir: imp.eventDir, photographer: 'Local Q4d Alpha', operatorId: imp.operatorId, files: imp.files };
    assert.deepEqual(await RE.verifyCommittedImport(item, io), { ok: true });
    const r = async (over, ioOver = {}) => RE.verifyCommittedImport({ ...item, ...over }, { ...io, ...ioOver });
    assert.equal((await r({ computerId: 'comp-other' })).reason, 'different-computer');
    assert.equal((await r({}, { computerId: 'comp-other' })).reason, 'different-computer', 'another computer never recovers this one\'s pending import');
    assert.equal((await r({ entryIds: ['entry-forged'] })).reason, 'import-key-mismatch');
    assert.equal((await r({ files: [{ dest: '/elsewhere/IMG.CR3' }] })).reason, 'file-outside-event');
    assert.equal((await r({ photographer: 'Local Q4d Beta' })).reason, 'photographer-mismatch');
    assert.equal((await r({ operatorId: 'op-someone-else' })).reason, 'operator-mismatch');
    const off = await r({ eventDir: path.join(ROOT, 'nas-offline', 'Event'), files: [{ dest: path.join(ROOT, 'nas-offline', 'Event', 'A', 'x.CR3') }] });
    assert.deepEqual([off.ok, off.transient], [false, true], 'unreachable archive is transient');
    const ej = path.join(imp.eventDir, 'event.json');
    const good = fs.readFileSync(ej, 'utf8');
    fs.writeFileSync(ej, JSON.stringify({ status: 'created', imports: [] })); // rolled back
    assert.deepEqual([(await r({})).reason, (await r({})).transient], ['import-entry-missing', false]);
    fs.writeFileSync(ej, '{"imports": [ trunc');
    assert.equal((await r({})).reason, 'event-json-corrupt');
    fs.unlinkSync(ej);
    assert.equal((await r({})).reason, 'event-json-missing');
    fs.writeFileSync(ej, good);
  });

  console.log('Q4d — archive evidence classification');
  await t('unmodified archive copy → archive; rewritten copy → source only with an equal image-data hash; otherwise uncertain', async () => {
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0001.CR3', tags: T.canonA }, { name: 'IMG_0002.JPG', tags: T.canonA }]);
    const [raw, jpg] = imp.files;
    const cio = { stat: p => fsp.stat(p), imageDataHash: fakeHash };
    assert.deepEqual(await RE.classifyCommittedFile(raw, cio), { status: 'archive', path: raw.dest });
    assert.deepEqual(await RE.classifyCommittedFile(jpg, cio), { status: 'archive', path: jpg.dest }, 'not yet rewritten');
    await rewriteMetadata(jpg.dest);
    assert.notEqual(fs.statSync(jpg.dest).size, jpg.size);
    assert.deepEqual(await RE.classifyCommittedFile(jpg, cio), { status: 'source', path: jpg.src }, 'metadata rewritten, same image → the card original is read');
    assert.equal((await RE.classifyCommittedFile(jpg, { ...cio, imageDataHash: async () => null })).reason, 'image-data-hash-unavailable');
    await fsp.writeFile(jpg.src, media('a-different-picture'));
    assert.equal((await RE.classifyCommittedFile(jpg, cio)).reason, 'source-changed', 'card reused: different file at the same path');
    await fsp.writeFile(jpg.src, media('X'.repeat(jpg.size - 20)).slice(0, jpg.size));
    assert.equal(fs.statSync(jpg.src).size, jpg.size);
    assert.equal((await RE.classifyCommittedFile(jpg, cio)).reason, 'image-data-mismatch', 'same size, different picture: never trusted');
    await fsp.rm(jpg.src);
    assert.equal((await RE.classifyCommittedFile(jpg, cio)).reason, 'archive-modified-source-unavailable');
    await fsp.rm(raw.dest);
    assert.deepEqual(await RE.classifyCommittedFile(raw, cio), { status: 'missing', reason: 'archive-copy-missing' });
    await fsp.rm(imp.eventDir, { recursive: true });
    assert.equal((await RE.classifyCommittedFile(raw, cio)).status, 'unreachable');
  });
  await t('a RAW/JPEG pair is one capture: a verified RAW covers its uncertain JPEG; anything else uncertain stays unread', async () => {
    const d = '/x/Event/Alpha';
    const c = (name, status, reason) => ({ file: { dest: `${d}/${name}` }, c: { status, reason, path: `${d}/${name}` } });
    const s = RE.summarize([c('A.CR3', 'archive'), c('A.JPG', 'uncertain', 'archive-modified-source-unavailable'), c('B.JPG', 'uncertain', 'archive-modified-source-unavailable'), c('C.JPG', 'missing', 'archive-copy-missing')]);
    assert.deepEqual([s.usable.length, s.unread, s.waitingForSource, s.counts.pairCovered], [1, 2, 1, 1]);
    assert.ok(RE.summarize([c('A.CR3', 'archive'), c('Z.JPG', 'unreachable', 'EIO')]).transient, 'an unreachable copy makes the whole attempt transient');
  });

  await t('a renamed copy (NAME_1) that repeats an already-archived picture is not new evidence; a different picture is', async () => {
    const d = path.join(ROOT, `dups-${++n}`, 'Event', 'Alpha');
    await fsp.mkdir(d, { recursive: true });
    const w = async (name, body) => { const p = path.join(d, name); await fsp.writeFile(p, body); return { dest: p }; };
    await w('IMG_0001.JPG', media('pic-1', 'camera-original+XMP-dc:Creator=AutoIngest')); // archived earlier, metadata rewritten
    const again = await w('IMG_0001_1.JPG', media('pic-1'));                                 // same picture copied again
    await w('IMG_0002.JPG', media('pic-2'));
    const other = await w('IMG_0002_1.JPG', media('another-camera-same-name'));               // genuine name clash
    const nikon = await w('DSC_0042.JPG', media('pic-3'));                                     // ordinary name with "_N"
    let hashes = 0;
    const cio = { stat: p => fsp.stat(p), imageDataHash: async (p) => { hashes++; return fakeHash(p); } };
    const dups = await RE.findDuplicateCaptures([again, other, nikon], cio);
    assert.deepEqual([...dups], [again.dest]);
    assert.equal(hashes, 4, 'hashes only where the un-suffixed original exists (never for DSC_0042)');
  });

  // ═══ Interrupted learning → recovery ═══════════════════════════════════════════
  console.log('Q4d — interrupted learning is recovered exactly once');
  await t('quit before a queued job starts: pending is durable, the next run recovers it once', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    const imp1 = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0001.CR3', tags: T.canonA }]);
    const imp2 = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0002.CR3', tags: T.canonA }, { name: 'IMG_0003.CR3', tags: T.canonA }]);
    assert.equal(c.svc.onImportCommitted(imp1.ctx), 'queued');
    assert.equal(c.svc.onImportCommitted(imp2.ctx), 'queued');
    await new Promise(r => setTimeout(r, 150));
    await quit(c);
    const p = stateOf(c).pending;
    assert.deepEqual(p.map(i => i.importId).sort(), [keyOf(imp1), keyOf(imp2)].sort(), 'both committed imports are pending');
    assert.equal(fs.statSync(path.join(c.dir, 'learning', 'learning-pending.json')).mode & 0o777, 0o600);
    const next = restart(c);
    const r = await next.svc.recoverPending();
    await next.svc.whenIdle();
    assert.equal(r.started, 2);
    assert.deepEqual([entryFor(next, imp1).status, entryFor(next, imp1).recovered, entryFor(next, imp1).evidence], ['recorded', true, 'archive']);
    assert.equal(eventsFor(next, imp2).find(e => e.type === 'import-observed').fileCount, 2);
    assert.equal(stateOf(next).pending.length, 0, 'pending cleared after a final outcome');
    const count = next.store().getEvents().length;
    await next.svc.recoverPending({ force: true }); await next.svc.whenIdle();
    assert.equal(next.store().getEvents().length, count, 'a second pass adds nothing');
    await closeStore(next);
  });
  await t('quit during evidence extraction: interrupted, then recovered from verified archive copies with the card ejected', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0001.CR3', tags: T.sony }, { name: 'IMG_0001.JPG', tags: T.sony }]);
    c.svc.onImportCommitted(imp.ctx);
    await new Promise(r => setTimeout(r, 200));
    await quit(c);
    assert.deepEqual([entryFor(c, imp).status, entryFor(c, imp).reason], ['interrupted', 'shutdown']);
    await rewriteMetadata(imp.files[1].dest);          // AutoIngest's metadata write finished later
    await fsp.rm(path.dirname(imp.card), { recursive: true }); // card ejected
    const next = restart(c);
    await next.svc.recoverPending(); await next.svc.whenIdle();
    const e = entryFor(next, imp);
    assert.deepEqual([e.status, e.observation, e.evidenceCounts.archive, e.evidenceCounts.pairCovered], ['recorded', 'single-body', 1, 1], 'RAW verified, its rewritten JPEG covered by the pair');
    assert.equal(eventsFor(next, imp).find(x => x.type === 'import-observed').fileCount, 1, 'the pair is one capture');
    await closeStore(next);
  });
  await t('rewritten JPEG with its card still present → the card original is read (hash-verified)', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0101.JPG', tags: T.canonB }]);
    c.svc.onImportCommitted(imp.ctx);
    await new Promise(r => setTimeout(r, 100));
    await quit(c);
    await rewriteMetadata(imp.files[0].dest);
    TAGS.set(imp.files[0].dest, T.modelOnly); // pretend the rewrite lost the maker-note serial
    const next = restart(c);
    await next.svc.recoverPending(); await next.svc.whenIdle();
    const e = entryFor(next, imp);
    assert.deepEqual([e.status, e.observation, e.evidence, e.evidenceCounts.source], ['recorded', 'single-body', 'archive+source', 1]);
    await closeStore(next);
  });
  await t('rewritten JPEG, card gone: waits (bounded) for the card, then records evidence-unavailable — never a guess', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0201.JPG', tags: T.canonA }, { name: 'IMG_0202.JPG', tags: T.canonA }]);
    c.svc.onImportCommitted(imp.ctx);
    await new Promise(r => setTimeout(r, 100));
    await quit(c);
    for (const f of imp.files) await rewriteMetadata(f.dest);
    await fsp.rm(path.dirname(imp.card), { recursive: true });
    let next = restart(c);
    for (let attempt = 1; attempt <= 2; attempt++) {
      await next.svc.recoverPending({ force: true }); await next.svc.whenIdle();
      assert.deepEqual([entryFor(next, imp).status, entryFor(next, imp).reason, stateOf(next).pending[0].attempts], ['deferred', 'source-card-not-available', attempt]);
    }
    await next.svc.recoverPending({ force: true }); await next.svc.whenIdle();
    assert.deepEqual([entryFor(next, imp).status, stateOf(next).pending.length], ['evidence-unavailable', 0], 'third attempt is final');
    assert.equal(eventsFor(next, imp).length, 0, 'no association, no device from unverifiable files');
    await closeStore(next);
  });
  await t('missing or changed archive files leave attribution incomplete — no association from the rest', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    const imp = await committedImport('Local Q4d Beta', [{ name: 'A.CR3', tags: T.canonA }, { name: 'B.CR3', tags: T.canonA }, { name: 'C.CR3', tags: T.canonA }]);
    c.svc.onImportCommitted(imp.ctx);
    await new Promise(r => setTimeout(r, 100));
    await quit(c);
    await fsp.rm(imp.files[1].dest);                                       // deleted from the archive
    await fsp.writeFile(imp.files[2].dest, media('replaced-with-another-picture-entirely')); // replaced
    await fsp.rm(path.dirname(imp.card), { recursive: true });
    const next = restart(c);
    await next.svc.recoverPending({ force: true }); await next.svc.whenIdle();
    await next.svc.recoverPending({ force: true }); await next.svc.whenIdle();
    await next.svc.recoverPending({ force: true }); await next.svc.whenIdle();
    const e = entryFor(next, imp);
    assert.deepEqual([e.status, e.observation, e.unreadFiles], ['recorded', 'incomplete-attribution', 2]);
    assert.deepEqual(eventsFor(next, imp), [], 'no observation of any kind for this import');
    assert.deepEqual(next.store().getEvents().map(x => x.type).sort(), ['device-registered', 'photographer-registered'], 'the verified body is registered as equipment only — no photographer association');
    await closeStore(next);
  });
  await t('archive offline is transient: attempts count, then abandoned after 3 — nothing recorded', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0301.CR3', tags: T.canonA }]);
    c.svc.onImportCommitted(imp.ctx);
    await new Promise(r => setTimeout(r, 100));
    await quit(c);
    const hidden = `${imp.eventDir}.offline`;
    await fsp.rename(imp.eventDir, hidden); // NAS unmounted
    const next = restart(c);
    for (let a = 1; a <= 3; a++) {
      await next.svc.recoverPending({ force: true }); await next.svc.whenIdle();
      assert.equal(entryFor(next, imp).status, 'deferred');
      assert.match(entryFor(next, imp).reason, /^archive-unreachable/);
    }
    const r = await next.svc.recoverPending({ force: true }); await next.svc.whenIdle();
    assert.deepEqual([r.finalized, entryFor(next, imp).status, stateOf(next).pending.length], [1, 'abandoned', 0]);
    assert.match(entryFor(next, imp).reason, /^attempts-exhausted:archive-unreachable/);
    await fsp.rename(hidden, imp.eventDir);
    assert.equal(eventsFor(next, imp).length, 0);
    await closeStore(next);
  });
  await t('rolled-back / corrupt / missing event.json entry: recovery is abandoned, nothing recorded', async () => {
    for (const damage of ['rolled-back', 'corrupt', 'missing']) {
      const c = computer({ evidenceDelayMs: 5000 });
      const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0401.CR3', tags: T.canonA }]);
      c.svc.onImportCommitted(imp.ctx);
      await new Promise(r => setTimeout(r, 100));
      await quit(c);
      const ej = path.join(imp.eventDir, 'event.json');
      if (damage === 'rolled-back') fs.writeFileSync(ej, JSON.stringify({ status: 'created', imports: [] }));
      if (damage === 'corrupt') fs.writeFileSync(ej, '{ "imports": [');
      if (damage === 'missing') fs.unlinkSync(ej);
      const next = restart(c);
      await next.svc.recoverPending(); await next.svc.whenIdle();
      const e = entryFor(next, imp);
      assert.equal(e.status, 'abandoned', damage);
      assert.match(e.reason, /^commit-not-verified:/);
      assert.equal(eventsFor(next, imp).length, 0, damage);
      assert.equal(stateOf(next).pending.length, 0);
      await closeStore(next);
    }
  });
  await t('quit after the append but before the pending record was cleared → recovery says duplicate, adds nothing', async () => {
    const c = computer();
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0501.CR3', tags: T.canonA }]);
    c.svc.onImportCommitted(imp.ctx); await c.svc.whenIdle();
    const before = c.store().getEvents().length;
    const item = { importId: keyOf(imp), computerId: COMPUTER, entryIds: imp.entryIds, eventDir: imp.eventDir, photographer: 'Local Q4d Alpha', workflow: 'event-import', operatorId: imp.operatorId, day: '2026-11-04', acceptedAt: new Date().toISOString(), attempts: 0, notBefore: null, lastReason: null, owner: { pid: 999999, runId: 'crashed' }, files: imp.files };
    await createLearningStateStore({ dir: c.dir }).update(({ pending }) => ({ pending: [...pending, item] }));
    await quit(c);
    const next = restart(c);
    await next.svc.recoverPending(); await next.svc.whenIdle();
    assert.equal(entryFor(next, imp).status, 'recorded', 'the journal keeps the real outcome (duplicate does not overwrite it)');
    assert.equal(entryFor(next, imp).seenAgain, 1);
    assert.equal(next.store().getEvents().length, before);
    assert.equal(stateOf(next).pending.length, 0);
    await closeStore(next);
  });
  await t('recovered events are identical to the ones a live run writes (deterministic IDs) — retries cannot duplicate', async () => {
    const live = computer();
    const rec = computer({ evidenceDelayMs: 5000 });
    const ids = [`entry-q4d-det-${++n}`];
    const a = await committedImport('Shipped Q4d Person', [{ name: 'D.CR3', tags: T.sony }], { entryIds: ids });
    const b = await committedImport('Shipped Q4d Person', [{ name: 'D.CR3', tags: T.sony }], { entryIds: ids });
    live.svc.onImportCommitted(a.ctx); await live.svc.whenIdle();
    rec.svc.onImportCommitted(b.ctx); await new Promise(r => setTimeout(r, 100)); await quit(rec);
    const next = restart(rec);
    await next.svc.recoverPending(); await next.svc.whenIdle();
    const idsOf = (c) => c.store().getEvents().filter(e => e.importId === learningKey(COMPUTER, ids)).map(e => e.eventId).sort();
    assert.deepEqual(idsOf(next), idsOf(live));
    await Promise.all([next.svc.recoverPending({ force: true }), next.svc.recoverPending({ force: true })]); await next.svc.whenIdle();
    assert.equal(next.store().getEvents().filter(e => e.type === 'import-observed').length, 1);
    await closeStore(live); await closeStore(next);
  });
  await t('duplicate callbacks across a restart while pending: one pending record, one observation', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0601.CR3', tags: T.canonB }]);
    assert.equal(c.svc.onImportCommitted(imp.ctx), 'queued');
    assert.equal(c.svc.onImportCommitted({ ...imp.ctx, entryIds: [...imp.entryIds].reverse() }), 'duplicate');
    await new Promise(r => setTimeout(r, 100)); await quit(c);
    const next = restart(c, { evidenceDelayMs: 0 });
    assert.equal(next.svc.onImportCommitted(imp.ctx), 'queued', 'the same commit reported again after restart');
    await next.svc.whenIdle();
    await next.svc.recoverPending({ force: true }); await next.svc.whenIdle();
    assert.equal(stateOf(next).pending.length, 0);
    assert.equal(eventsFor(next, imp).filter(e => e.type === 'import-observed').length, 1);
    await closeStore(next);
  });

  console.log('Q4d — limits, scheduling and unavailable dependencies');
  await t('recovery window: older than 7 days → expired; pending list capped (queue overflow kept, then dropped)', async () => {
    let now = Date.parse('2026-11-04T10:00:00Z');
    const clock = () => new Date(now);
    const c = computer({ evidenceDelayMs: 5000, clock });
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0701.CR3', tags: T.canonA }]);
    c.svc.onImportCommitted(imp.ctx); await new Promise(r => setTimeout(r, 100)); await quit(c);
    now += 8 * 86400000;
    const next = restart(c, { clock });
    const r = await next.svc.recoverPending();
    assert.deepEqual([r.finalized, entryFor(next, imp).status, stateOf(next).pending.length], [1, 'expired', 0]);
    await closeStore(next);
    const capped = computer({ evidenceDelayMs: 2000, maxQueue: 1, limits: { maxPending: 2 } });
    const imps = [];
    for (let i = 0; i < 4; i++) imps.push(await committedImport('Local Q4d Alpha', [{ name: `CAP_${i}.CR3`, tags: T.canonA }]));
    assert.deepEqual(imps.map(x => capped.svc.onImportCommitted(x.ctx)), ['queued', 'queue-full', 'queue-full', 'queue-full']);
    await new Promise(r => setTimeout(r, 200));
    await quit(capped);
    const st = stateOf(capped);
    assert.equal(st.pending.length, 2, 'never more than the limit');
    assert.deepEqual(imps.slice(1).map(x => st.journal.find(e => e.key === keyOf(x)).status), ['deferred', 'dropped', 'dropped']);
  });
  await t('registry locked or corrupt: pending kept, attempts not consumed; key unavailable → model-level only', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0801.CR3', tags: T.canonA }]);
    c.svc.onImportCommitted(imp.ctx); await new Promise(r => setTimeout(r, 100)); await quit(c);
    const holder = createIdentityRegistryStore({ dir: c.dir, secureStorage: fakeSecureStorage(), computerId: COMPUTER });
    await holder.open(); // another AutoIngest holds the registry
    const blocked = restart(c);
    const r = await blocked.svc.recoverPending({ force: true });
    assert.deepEqual([r.started, r.registry, stateOf(c).pending[0].attempts], [0, 'locked-by-another-process', 0]);
    await holder.close();
    const noKey = restart(c, { secureStorage: fakeSecureStorage({ decrypt: () => { throw new Error('keychain denied'); } }) });
    await noKey.svc.recoverPending(); await noKey.svc.whenIdle();
    const e = entryFor(noKey, imp);
    assert.deepEqual([e.status, e.bodyMatching, e.observation], ['recorded', false, 'single-model']);
    await closeStore(noKey);
    const c2 = computer({ evidenceDelayMs: 5000 });
    const imp2 = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0802.CR3', tags: T.canonA }]);
    c2.svc.onImportCommitted(imp2.ctx); await new Promise(r2 => setTimeout(r2, 100)); await quit(c2);
    fs.writeFileSync(path.join(c2.dir, 'registry.json'), '{"broken": ');
    const corrupt = restart(c2);
    const r2 = await corrupt.svc.recoverPending({ force: true });
    assert.deepEqual([r2.started, r2.registry, stateOf(c2).pending.length, stateOf(c2).pending[0].attempts], [0, 'registry-corrupt', 1, 0]);
    await closeStore(corrupt);
  });
  await t('mixed cameras or an unknown camera at recovery → co-occurrence / no association', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    const mixed = await committedImport('Local Q4d Alpha', [{ name: 'M1.CR3', tags: T.canonA }, { name: 'M2.CR3', tags: T.canonB }]);
    const unk = await committedImport('Local Q4d Beta', [{ name: 'U1.CR3', tags: T.sony }, { name: 'U2.CR3', tags: T.unknown }]);
    c.svc.onImportCommitted(mixed.ctx); c.svc.onImportCommitted(unk.ctx);
    await new Promise(r => setTimeout(r, 100)); await quit(c);
    const next = restart(c);
    await next.svc.recoverPending(); await next.svc.whenIdle();
    assert.equal(entryFor(next, mixed).observation, 'multiple-cameras');
    assert.ok(!eventsFor(next, mixed).some(e => e.type === 'import-observed'));
    assert.equal(entryFor(next, unk).observation, 'incomplete-attribution');
    assert.ok(!eventsFor(next, unk).some(e => ['import-observed', 'model-observed'].includes(e.type)));
    assert.ok(!next.store().getEvents().some(e => e.type.startsWith('association-')), 'recovery never confirms');
    await closeStore(next);
  });
  await t('never while the operator is busy; never before its delay; a live source failure becomes pending', async () => {
    let busy = true;
    const timers = [];
    const c = computer({ busy: () => busy });
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0901.CR3', tags: T.canonA }]);
    const svcLive = computer({ dir: c.dir, liveEvidence: (files) => ({ records: [], unread: files.length, source: 'unavailable' }) });
    svcLive.svc.onImportCommitted(imp.ctx); await svcLive.svc.whenIdle();
    assert.deepEqual([entryFor(c, imp).status, entryFor(c, imp).reason, entryFor(c, imp).pending], ['deferred', 'source-unavailable', true]);
    assert.ok(Date.parse(stateOf(c).pending[0].notBefore) > Date.now() + 60000, 'not retried before the archive copies have settled');
    await quit(svcLive);
    assert.deepEqual(await c.svc.recoverPending({ force: true }), { started: 0, finalized: 0, busy: true });
    // Scheduling uses injected timers: nothing fires on its own.
    const s = createPhotographerLearningService({
      isEnabled: () => true, journalDir: () => c.dir, getComputerId: () => COMPUTER, getNames: () => ({ listNames: LIST, shippedNames: SHIPPED }),
      openStore: async () => { const st = createIdentityRegistryStore({ dir: c.dir, secureStorage: fakeSecureStorage(), computerId: COMPUTER }); await st.open(); return st; },
      resolveEvidence: async () => ({ records: [], unread: 0, source: 'read' }), resolveRecoveryEvidence: testRecoveryResolver(),
      isBusy: () => busy, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    });
    s.scheduleRecovery(90000);
    assert.deepEqual(timers.map(x => x.ms), [90000]);
    s.scheduleRecovery(300000);
    assert.equal(timers.length, 1, 'a later request never postpones an earlier pass');
    await timers[0].fn();
    assert.equal(timers[1].ms, 60000, 'busy → checks again in a minute, starts nothing');
    s.shutdown();
    busy = false;
    const off = computer({ enabled: false, dir: path.join(ROOT, `ud-off-${++n}`, 'identity-registry') });
    assert.deepEqual(await off.svc.recoverPending(), { started: 0, finalized: 0 });
    assert.ok(!fs.existsSync(off.dir), 'learning off: recovery creates nothing');
  });
  await t('scheduler: registry unavailable → no retry loop; a not-yet-due item → one timer at its due time', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_0950.CR3', tags: T.canonA }]);
    c.svc.onImportCommitted(imp.ctx); await new Promise(r => setTimeout(r, 100)); await quit(c);
    const timers = [];
    const mk = () => createPhotographerLearningService({
      isEnabled: () => true, journalDir: () => c.dir, getComputerId: () => COMPUTER, getNames: () => ({ listNames: LIST, shippedNames: SHIPPED }),
      openStore: async () => { const st = createIdentityRegistryStore({ dir: c.dir, secureStorage: fakeSecureStorage(), computerId: COMPUTER }); await st.open(); return st; },
      resolveEvidence: async () => ({ records: [], unread: 0, source: 'read' }), resolveRecoveryEvidence: testRecoveryResolver(),
      setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    });
    const holder = createIdentityRegistryStore({ dir: c.dir, secureStorage: fakeSecureStorage(), computerId: COMPUTER });
    await holder.open();
    const s1 = mk();
    s1.scheduleRecovery(1000);
    await timers[0].fn();
    assert.equal(timers.length, 1, 'registry locked: no further timer this run');
    s1.shutdown(); await holder.close();
    await createLearningStateStore({ dir: c.dir }).update(({ pending }) => ({ pending: pending.map(i => ({ ...i, notBefore: new Date(Date.now() + 120000).toISOString() })) }));
    const s2 = mk();
    s2.scheduleRecovery(1000);
    await timers[1].fn();
    assert.ok(timers.length === 3 && timers[2].ms > 100000 && timers[2].ms <= 120000, `one timer at the due time (${timers[2] && timers[2].ms} ms)`);
    s2.shutdown();
    const st = (await s2.storeIfOpen()); if (st) await st.close();
  });
  await t('graceful shutdown during a recovery attempt: attempt counted, resumed by the next run', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_1001.CR3', tags: T.canonA }]);
    c.svc.onImportCommitted(imp.ctx); await new Promise(r => setTimeout(r, 100)); await quit(c);
    const r1 = restart(c, { recoveryDelayMs: 5000 });
    await r1.svc.recoverPending();
    await new Promise(r => setTimeout(r, 200));
    await quit(r1);
    assert.deepEqual([entryFor(r1, imp).status, stateOf(r1).pending[0].attempts], ['interrupted', 1]);
    const r2 = restart(c);
    await r2.svc.recoverPending(); await r2.svc.whenIdle();
    assert.deepEqual([entryFor(r2, imp).status, entryFor(r2, imp).attempt], ['recorded', 2]);
    await closeStore(r2);
  });

  // ═══ Journal / pending across processes ══════════════════════════════════════
  console.log('Q4d — learning state across processes');
  const childCode = (dir, tag, count, extra = '') => `
    const { createLearningStateStore } = require(${JSON.stringify(path.join(__dirname, '..', 'services', 'learningStateStore.js'))});
    ${extra}
    const s = createLearningStateStore({ dir: ${JSON.stringify(dir)}, ...(typeof OPTS !== 'undefined' ? OPTS : {}) });
    (async () => {
      for (let i = 0; i < ${count}; i++) {
        await s.update(({ journal, pending }) => ({
          journal: [...journal, { key: '${tag}-' + i, status: 'recorded' }],
          pending: i % 2 ? pending.filter(p => p.importId !== '${tag}-' + (i - 1)) : [...pending, { importId: '${tag}-' + i }],
        }));
      }
    })().catch(e => { console.error(e); process.exit(3); });`;
  const run = (code) => new Promise((res) => { const p = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'inherit'] }); p.on('exit', (c) => res(c)); });
  await t('two processes updating the same journal and pending list concurrently lose nothing', async () => {
    const dir = path.join(ROOT, `xproc-${++n}`, 'identity-registry');
    // A registry lock held by one of them must not block the learning state (no deadlock).
    const holder = createIdentityRegistryStore({ dir, secureStorage: fakeSecureStorage(), computerId: COMPUTER });
    await holder.open();
    const codes = await Promise.all([run(childCode(dir, 'A', 60)), run(childCode(dir, 'B', 60)), (async () => {
      const s = createLearningStateStore({ dir });
      for (let i = 0; i < 60; i++) await s.update(({ journal }) => ({ journal: [...journal, { key: `P-${i}`, status: 'recorded' }] }));
      return 0;
    })()]);
    await holder.close();
    assert.deepEqual(codes, [0, 0, 0]);
    const st = await createLearningStateStore({ dir }).read();
    assert.equal(new Set(st.journal.map(e => e.key)).size, 180, 'every entry from all three writers is present');
    assert.equal(st.pending.length, 0, 'every add/remove pair applied in order');
    assert.ok(!fs.existsSync(path.join(dir, 'learning', 'state.lock')), 'lock released');
    assert.ok(!fs.readdirSync(path.join(dir, 'learning')).some(f => f.includes('.tmp-')), 'no temp files left');
  });
  await t('a writer killed mid-write: previous journal intact, stale lock taken over, temp removed', async () => {
    const dir = path.join(ROOT, `crash-${++n}`, 'identity-registry');
    const s = createLearningStateStore({ dir });
    await s.update(() => ({ journal: [{ key: 'before-crash', status: 'recorded' }] }));
    // The child takes the lock, writes its temp file and then hangs in rename until killed.
    const hang = `const real = require('fs').promises; const OPTS = { fs: new Proxy(real, { get: (t, k) => k === 'rename' ? (async (a, b) => { if (String(a).includes('.tmp-')) { console.error('IN-RENAME'); await new Promise(() => {}); } return real.rename(a, b); }) : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]) }) };`;
    const child = spawn(process.execPath, ['-e', childCode(dir, 'K', 1, hang)], { stdio: ['ignore', 'ignore', 'pipe'] });
    await new Promise((res) => child.stderr.on('data', (d) => { if (String(d).includes('IN-RENAME')) res(); }));
    assert.ok(fs.existsSync(path.join(dir, 'learning', 'state.lock')));
    assert.ok(fs.readdirSync(path.join(dir, 'learning')).some(f => f.includes('.tmp-')), 'temp file written');
    child.kill('SIGKILL');
    await new Promise(r => child.on('exit', r));
    const after = createLearningStateStore({ dir });
    await after.update(({ journal }) => ({ journal: [...journal, { key: 'after-crash', status: 'recorded' }] }));
    const st = await after.read();
    assert.deepEqual(st.journal.map(e => e.key), ['before-crash', 'after-crash'], 'crashed write never landed; nothing lost');
    assert.ok(!fs.readdirSync(path.join(dir, 'learning')).some(f => f.includes('.tmp-') || f === 'state.lock'));
  });
  await t('a live holder is waited for; an old lock of a live process is taken over; a damaged journal is quarantined', async () => {
    const dir = path.join(ROOT, `lock-${++n}`, 'identity-registry');
    const sd = path.join(dir, 'learning');
    await fsp.mkdir(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'state.lock'), JSON.stringify({ pid: process.pid, token: 'other', at: new Date().toISOString() }));
    const s = createLearningStateStore({ dir, lockTimeoutMs: 300 });
    await assert.rejects(s.update(() => ({})), { code: 'ELOCKED' }, 'a fresh lock of a live process is respected');
    fs.writeFileSync(path.join(sd, 'state.lock'), JSON.stringify({ pid: process.pid, token: 'other', at: new Date(Date.now() - 60000).toISOString() }));
    await s.update(() => ({ journal: [{ key: 'x', status: 'recorded' }] }));
    fs.writeFileSync(path.join(sd, 'learning-journal.json'), '{"format":"autoingest-learning-journal","entries":[ trunc');
    await s.update(({ journal }) => ({ journal: [...journal, { key: 'y', status: 'recorded' }] }));
    assert.deepEqual((await s.read()).journal.map(e => e.key), ['y']);
    assert.ok(fs.readdirSync(path.join(dir, 'quarantine')).some(f => f.startsWith('learning-journal-damaged-')), 'damaged copy kept for investigation');
  });
  await t('a lock that only looks alive (dead owner, pid reused) delays a write but never loses it; quit releases our lock', async () => {
    const dir = path.join(ROOT, `pidreuse-${++n}`, 'identity-registry');
    const sd = path.join(dir, 'learning');
    await fsp.mkdir(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'state.lock'), JSON.stringify({ pid: process.pid, token: 'dead-run', at: new Date().toISOString() }));
    const s = createLearningStateStore({ dir, staleMs: 600 }); // default timeout is staleMs + 5 s
    const t0 = Date.now();
    await s.update(() => ({ journal: [{ key: 'kept', status: 'queued' }] }));
    assert.ok(Date.now() - t0 >= 500, 'waited for the lock to age out');
    assert.deepEqual((await s.read()).journal.map(e => e.key), ['kept']);
    // Quit in the middle of an update: the next process must not find our lock.
    const slow = createLearningStateStore({ dir, fs: new Proxy(fsp, { get: (tg, k) => (k === 'rename' ? async (a, b) => { await new Promise(r => setTimeout(r, 300)); return fsp.rename(a, b); } : (typeof tg[k] === 'function' ? tg[k].bind(tg) : tg[k])) }) });
    const pending = slow.update(() => ({ journal: [{ key: 'late', status: 'queued' }] }));
    await new Promise(r => setTimeout(r, 100));
    assert.ok(fs.existsSync(path.join(sd, 'state.lock')));
    slow.releaseSync();
    assert.ok(!fs.existsSync(path.join(sd, 'state.lock')), 'released synchronously');
    await pending;
  });
  await t('journal and pending never carry serials, digests or key material; the journal carries no names or paths', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    const imp = await committedImport('Local Q4d Alpha', [{ name: 'IMG_1101.CR3', tags: T.canonA }]);
    c.svc.onImportCommitted(imp.ctx); await new Promise(r => setTimeout(r, 100)); await quit(c);
    const pendingText = fs.readFileSync(path.join(c.dir, 'learning', 'learning-pending.json'), 'utf8');
    const next = restart(c);
    await next.svc.recoverPending(); await next.svc.whenIdle();
    const journalText = fs.readFileSync(path.join(c.dir, 'learning', 'learning-journal.json'), 'utf8');
    for (const s of FAKE_SERIALS) assert.ok(!pendingText.includes(s) && !journalText.includes(s), 'no raw serial');
    assert.ok(!/[0-9a-f]{64}/.test(pendingText) && !/[0-9a-f]{64}/.test(journalText), 'no digests or keys');
    for (const s of ['Local Q4d', ROOT, 'IMG_1101', 'DCIM']) assert.ok(!journalText.includes(s), 'journal: no names or paths');
    await closeStore(next);
  });

  await fsp.rm(ROOT, { recursive: true, force: true });
  console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
})();
