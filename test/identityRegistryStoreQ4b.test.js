'use strict';

// AI-FEAT-063 / AI-RM-014 Q4b — persistent identity registry and encrypted key storage.
// Pure Node: the OS secure storage is a FAKE adapter (Electron safeStorage is exercised by
// identityRegistrySafeStorageQ4b.electron.js) and the filesystem is the real one inside
// throw-away temp directories, wrapped for fault injection (ENOSPC, EACCES, interrupted
// writes). Never touches the operator's userData. Every serial and photographer is FAKE.
//
// Run: node test/identityRegistryStoreQ4b.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createIdentityRegistryStore, validateRegistryDocument } = require('../services/identityRegistryStore');
const { createEvent } = require('../services/identityEvents');
const { normalizeEventSet, deriveRegistryState } = require('../services/associationModel');
const { planMerge } = require('../services/identityMergePlan');
const P = require('../services/photographerIdentity');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-q4b-registry-'));
let dirN = 0;
const freshDir = () => path.join(ROOT, `ud-${++dirN}`, 'identity-registry');

// Fake OS secure storage: reversible sealing with a marker; toggles for failure scenarios.
function fakeSecureStorage({ available = true, failDecrypt = false } = {}) {
  const s = {
    backend: 'fake-test', identity: 'q4b-test-app', available, failDecrypt,
    isAvailable: () => s.available,
    encrypt: (buf) => Buffer.concat([Buffer.from('SEALED:'), Buffer.from(buf.map(b => b ^ 0x5a))]),
    decrypt: (c) => {
      if (s.failDecrypt || !c.subarray(0, 7).equals(Buffer.from('SEALED:'))) throw new Error('cannot decrypt');
      return Buffer.from(c.subarray(7).map(b => b ^ 0x5a));
    },
  };
  return s;
}

// Fault-injecting fs.promises: faults = [{ op, path: RegExp, code, times }]
function faultyFs(faults = []) {
  const hit = (op, p) => {
    const f = faults.find(x => x.op === op && x.path.test(String(p)) && (x.times === undefined || x.times > 0));
    if (!f) return;
    if (f.times !== undefined) f.times--;
    const e = new Error(`${f.code} (injected)`); e.code = f.code; throw e;
  };
  const wrap = (op) => async (...a) => { hit(op, a[0]); return fsp[op](...a); };
  return {
    faults,
    readFile: wrap('readFile'), rename: async (a, b) => { hit('rename', b); return fsp.rename(a, b); },
    unlink: wrap('unlink'), stat: wrap('stat'), readdir: wrap('readdir'), mkdir: wrap('mkdir'), copyFile: async (a, b) => { hit('copyFile', b); return fsp.copyFile(a, b); },
    open: async (p, ...rest) => {
      hit('open', p);
      const fh = await fsp.open(p, ...rest);
      return { writeFile: async (d) => { hit('write', p); return fh.writeFile(d); }, sync: () => fh.sync(), close: () => fh.close() };
    },
  };
}

let idN = 0;
const seqId = () => `00000000-0000-4000-8000-${(++idN).toString(16).padStart(12, '0')}`;
let clock = Date.parse('2026-11-03T08:00:00Z');
const now = () => new Date(clock += 1000);
const ORIGIN = { computerId: 'comp-test-A', operatorId: null, workflow: 'registry' };
const mkStore = (dir, extra = {}) => createIdentityRegistryStore({ dir, secureStorage: extra.secureStorage || fakeSecureStorage(), computerId: 'comp-test-A', now, ...extra });
const photographerEvent = (name, id = seqId()) => createEvent('photographer-registered', { photographerId: id, name, idOrigin: 'random' }, { origin: ORIGIN, at: now().toISOString(), newId: seqId });
const deviceEvent = (keyring, serial) => {
  const keyId = keyring.keyIds[0];
  return createEvent('device-registered', {
    deviceId: seqId(), make: 'Canon', modelKey: 'EOS70D', modelDisplay: 'Canon EOS 70D',
    identifiers: [{ ns: 'exif.bodySerial', keyId, digest: keyring.digest(keyId, 'exif.bodySerial', 'Canon', serial), trusted: true }],
  }, { origin: ORIGIN, at: now().toISOString(), newId: seqId });
};
const read = (f) => fs.readFileSync(f, 'utf8');
const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : []);

(async () => {
  console.log('Q4b — initialisation, keys and restart');
  await t('a new registry generates one encrypted key; no plaintext key is stored anywhere', async () => {
    const dir = freshDir();
    const keyBytes = [];
    const randomBytes = (n) => { const b = crypto.randomBytes(n); if (n === 32) keyBytes.push(Buffer.from(b)); return b; };
    const s = mkStore(dir, { randomBytes });
    const st = await s.open();
    assert.equal(st.state, 'ready');
    assert.equal(st.reason, 'initialized');
    assert.equal(st.bodyMatching, true);
    assert.equal(st.keyCount, 1);
    const keysDoc = JSON.parse(read(s.paths.keyFile));
    assert.equal(keysDoc.keys.length, 1);
    assert.match(keysDoc.keys[0].keyId, /^local-[0-9a-f]{12}$/);
    assert.equal(keysDoc.keys[0].protection, 'os-secure-storage');
    const all = ls(dir).map(f => (fs.statSync(path.join(dir, f)).isFile() ? read(path.join(dir, f)) : '')).join('\n');
    for (const k of keyBytes) for (const enc of ['hex', 'base64']) assert.ok(!all.includes(k.toString(enc)), `plaintext key (${enc}) must not be on disk`);
    assert.ok(!read(s.paths.registryFile).includes(keysDoc.keys[0].material), 'key material is not in the registry file');
    await s.close();
  });
  await t('restart keeps the same registry, keys and digests', async () => {
    const dir = freshDir();
    const a = mkStore(dir); await a.open();
    const d1 = a.getKeyring().digest(a.getKeyring().keyIds[0], 'exif.bodySerial', 'Canon', 'FAKEQ4B0001');
    const regId = JSON.parse(read(a.paths.registryFile)).registryId;
    await a.close();
    const b = mkStore(dir); const st = await b.open();
    assert.equal(st.state, 'ready'); assert.equal(st.reason, null); assert.equal(st.bodyMatching, true);
    assert.equal(JSON.parse(read(b.paths.registryFile)).registryId, regId);
    assert.equal(b.getKeyring().digest(b.getKeyring().keyIds[0], 'exif.bodySerial', 'Canon', 'FAKEQ4B0001'), d1);
    await b.close();
  });
  await t('missing key file: body matching off, learning on, key never regenerated', async () => {
    const dir = freshDir();
    const a = mkStore(dir); await a.open(); await a.close();
    fs.renameSync(path.join(dir, 'keys.json'), path.join(dir, '..', 'keys.moved'));
    const before = read(path.join(dir, 'registry.json'));
    const b = mkStore(dir); const st = await b.open();
    assert.deepEqual([st.state, st.learning, st.bodyMatching, st.keyStatus], ['ready', true, false, 'key-file-missing']);
    assert.equal(b.getKeyring(), null);
    assert.ok(!fs.existsSync(path.join(dir, 'keys.json')), 'no replacement key generated');
    assert.equal(read(path.join(dir, 'registry.json')), before);
    await b.close();
    // Reinstall / restore: putting the key file back restores matching.
    fs.renameSync(path.join(dir, '..', 'keys.moved'), path.join(dir, 'keys.json'));
    const c = mkStore(dir); assert.equal((await c.open()).bodyMatching, true); await c.close();
  });
  await t('decryption failure, damaged key file, wrong registry and unavailable storage all disable matching only', async () => {
    const dir = freshDir();
    const a = mkStore(dir); await a.open(); await a.close();
    const keyFile = path.join(dir, 'keys.json');
    const original = read(keyFile);
    let s = mkStore(dir, { secureStorage: fakeSecureStorage({ failDecrypt: true }) });
    assert.equal((await s.open()).keyStatus, 'key-undecryptable'); await s.close();
    s = mkStore(dir, { secureStorage: fakeSecureStorage({ available: false }) });
    assert.equal((await s.open()).keyStatus, 'secure-storage-unavailable'); await s.close();
    const doc = JSON.parse(original);
    fs.writeFileSync(keyFile, JSON.stringify({ ...doc, keys: [{ ...doc.keys[0], material: Buffer.from('tampered').toString('base64') }] }));
    s = mkStore(dir); assert.equal((await s.open()).keyStatus, 'key-file-corrupt'); await s.close();
    fs.writeFileSync(keyFile, '{"format":"autoingest-identity-keys",'); // partial JSON
    s = mkStore(dir); assert.equal((await s.open()).keyStatus, 'key-file-corrupt'); await s.close();
    assert.equal(read(keyFile), '{"format":"autoingest-identity-keys",', 'damaged key file left for investigation');
    fs.writeFileSync(keyFile, JSON.stringify({ ...doc, registryId: P.newPhotographerId() }));
    s = mkStore(dir); assert.equal((await s.open()).keyStatus, 'key-registry-mismatch'); await s.close();
    fs.writeFileSync(keyFile, original);
    s = mkStore(dir); const st = await s.open(); assert.equal(st.bodyMatching, true); await s.close();
  });
  await t('secure storage unavailable at creation: keyless registry; keys are not generated later', async () => {
    const dir = freshDir();
    const a = mkStore(dir, { secureStorage: fakeSecureStorage({ available: false }) });
    const st = await a.open();
    assert.deepEqual([st.state, st.bodyMatching, st.keyStatus, st.keyCount], ['ready', false, 'no-keys', 0]);
    assert.ok(!fs.existsSync(path.join(dir, 'keys.json')));
    await a.close();
    const b = mkStore(dir); const st2 = await b.open();
    assert.equal(st2.keyStatus, 'no-keys', 'generation only happens when initialising a new registry');
    assert.ok(!fs.existsSync(path.join(dir, 'keys.json')));
    await b.close();
  });
  await t('registry deleted but key file kept (crash during init, manual cleanup): existing keys are adopted, not replaced', async () => {
    const dir = freshDir();
    const a = mkStore(dir); await a.open(); await a.close();
    const keysBefore = read(path.join(dir, 'keys.json'));
    fs.unlinkSync(path.join(dir, 'registry.json'));
    const b = mkStore(dir); const st = await b.open();
    assert.deepEqual([st.reason, st.bodyMatching], ['initialized-with-existing-keys', true]);
    assert.equal(read(path.join(dir, 'keys.json')), keysBefore);
    await b.close();
  });

  console.log('Q4b — corruption, schema and recovery');
  await t('partial JSON registry: quarantined copy, original untouched, learning disabled, open never throws', async () => {
    const dir = freshDir();
    const a = mkStore(dir); await a.open(); await a.appendEvents([photographerEvent('Test Q4b Alpha')]); await a.close();
    const reg = path.join(dir, 'registry.json');
    const partial = read(reg).slice(0, 120);
    fs.writeFileSync(reg, partial);
    const b = mkStore(dir); const st = await b.open();
    assert.deepEqual([st.state, st.reason, st.learning, st.bodyMatching], ['disabled', 'registry-corrupt', false, false]);
    assert.equal(read(reg), partial, 'evidence left in place');
    assert.ok(ls(path.join(dir, 'quarantine')).some(f => f.startsWith('registry-corrupt-')));
    const res = await b.appendEvents([photographerEvent('Test Q4b Beta')]);
    assert.equal(res.ok, false);
    assert.equal(read(reg), partial, 'disabled registry is never written');
    await b.close();
  });
  await t('invalid schema (unknown field, bad event, unknown keyId) → corrupt; newer schema version → untouched', async () => {
    const dir = freshDir();
    const a = mkStore(dir); await a.open(); await a.close();
    const reg = path.join(dir, 'registry.json');
    const good = JSON.parse(read(reg));
    for (const bad of [
      { ...good, surprise: true },
      { ...good, events: [{ schema: 1, eventId: 'nope' }] },
      { ...good, keyIds: [] , events: [deviceEvent(require('../services/identityKeyring').createKeyring([{ keyId: 'local-zzzz', key: Buffer.alloc(32, 7) }]), 'FAKEQ4B0009')] },
    ]) {
      fs.writeFileSync(reg, JSON.stringify(bad));
      const s = mkStore(dir); assert.equal((await s.open()).reason, 'registry-corrupt'); await s.close();
    }
    const newer = JSON.stringify({ ...good, schemaVersion: 2, futureField: 1 });
    fs.writeFileSync(reg, newer);
    const s = mkStore(dir); const st = await s.open();
    assert.deepEqual([st.state, st.reason], ['disabled', 'unsupported-schema-version']);
    assert.equal(read(reg), newer, 'never rewritten');
    await s.close();
    assert.equal(validateRegistryDocument({ ...good, schemaVersion: 0 }).ok, false);
  });
  await t('recovery from backup is explicit, validated and preserves the damaged file', async () => {
    const dir = freshDir();
    const a = mkStore(dir); await a.open();
    await a.appendEvents([photographerEvent('Test Q4b Gamma')]);
    await a.appendEvents([photographerEvent('Test Q4b Delta')]);
    await a.close();
    const reg = path.join(dir, 'registry.json');
    fs.writeFileSync(reg, 'garbage');
    const b = mkStore(dir); await b.open();
    const cands = await b.listRecoveryCandidates();
    assert.ok(cands.length >= 2 && cands.every(c => c.valid));
    assert.ok(!JSON.stringify(cands).match(/[0-9a-f]{64}/), 'candidates carry no digests');
    assert.equal((await b.recoverFromBackup(cands[0].name)).reason, 'confirmation-required');
    assert.equal(read(reg), 'garbage', 'nothing happens without confirmation');
    assert.equal((await b.recoverFromBackup('../registry.json', { confirm: true })).reason, 'unknown-backup');
    const res = await b.recoverFromBackup(cands[0].name, { confirm: true });
    assert.equal(res.ok, true);
    assert.ok(read(path.join(dir, 'quarantine', res.preserved)) === 'garbage', 'damaged file preserved before restore');
    const st = b.getStatus();
    assert.deepEqual([st.state, st.reason, st.events], ['ready', 'recovered-from-backup', 1]);
    await b.close();
  });
  await t('registry missing while backups exist: disabled, nothing auto-created; explicit recovery works', async () => {
    const dir = freshDir();
    const a = mkStore(dir); await a.open(); await a.appendEvents([photographerEvent('Test Q4b Eps')]); await a.close();
    fs.unlinkSync(path.join(dir, 'registry.json'));
    const b = mkStore(dir); const st = await b.open();
    assert.deepEqual([st.state, st.reason], ['disabled', 'registry-missing-backups-present']);
    assert.ok(!fs.existsSync(path.join(dir, 'registry.json')));
    const [c] = await b.listRecoveryCandidates();
    assert.equal((await b.recoverFromBackup(c.name, { confirm: true })).ok, true);
    assert.equal(b.getStatus().state, 'ready');
    await b.close();
  });
  await t('interrupted write: leftover temp file is quarantined; registry unaffected', async () => {
    const dir = freshDir();
    const a = mkStore(dir); await a.open(); await a.close();
    const before = read(path.join(dir, 'registry.json'));
    fs.writeFileSync(path.join(dir, 'registry.json.tmp-999-deadbeef'), '{"format":"autoingest-identity-reg');
    const b = mkStore(dir); const st = await b.open();
    assert.equal(st.state, 'ready');
    assert.equal(read(path.join(dir, 'registry.json')), before);
    assert.ok(!ls(dir).some(f => f.includes('.tmp-')));
    assert.ok(ls(path.join(dir, 'quarantine')).some(f => f.startsWith('interrupted-')));
    await b.close();
  });

  console.log('Q4b — write failures and concurrency');
  await t('disk full / permission errors: write fails cleanly, file and memory unchanged, later writes succeed', async () => {
    const dir = freshDir();
    const fx = faultyFs();
    const s = mkStore(dir, { fs: fx }); await s.open();
    await s.appendEvents([photographerEvent('Test Q4b One')]);
    const reg = path.join(dir, 'registry.json');
    const before = read(reg);
    fx.faults.push({ op: 'write', path: /registry\.json\.tmp-/, code: 'ENOSPC', times: 1 });
    let res = await s.appendEvents([photographerEvent('Test Q4b Two')]);
    assert.deepEqual([res.ok, res.reason], [false, 'write-failed:ENOSPC']);
    assert.equal(read(reg), before);
    assert.equal(s.getStatus().events, 1, 'memory unchanged');
    assert.ok(!ls(dir).some(f => f.includes('.tmp-')), 'temp file cleaned up');
    fx.faults.push({ op: 'open', path: /backups/, code: 'EACCES', times: 1 });
    res = await s.appendEvents([photographerEvent('Test Q4b Three')]);
    assert.deepEqual([res.ok, res.reason], [false, 'write-failed:EACCES']);
    assert.equal(read(reg), before, 'no registry write without a backup');
    fx.faults.push({ op: 'rename', path: /registry\.json$/, code: 'EPERM', times: 1 });
    res = await s.appendEvents([photographerEvent('Test Q4b Four')]);
    assert.equal(res.ok, false);
    assert.equal(read(reg), before);
    res = await s.appendEvents([photographerEvent('Test Q4b Five')]);
    assert.equal(res.ok, true);
    assert.equal(s.getStatus().events, 2);
    await s.close();
    const denied = mkStore(freshDir(), { fs: faultyFs([{ op: 'mkdir', path: /./, code: 'EACCES' }]) });
    const st = await denied.open();
    assert.deepEqual([st.state, st.reason, st.learning], ['disabled', 'io-error:EACCES', false]);
  });
  await t('concurrent appends are serialized; a second writer is locked out; a stale lock is taken over', async () => {
    const dir = freshDir();
    const s = mkStore(dir); await s.open();
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => s.appendEvents([photographerEvent(`Test Q4b Parallel ${i}`)])));
    assert.ok(results.every(r => r.ok && r.added.length === 1));
    assert.equal(JSON.parse(read(path.join(dir, 'registry.json'))).events.length, 40);
    const other = mkStore(dir); const st = await other.open();
    assert.deepEqual([st.state, st.reason], ['disabled', 'locked-by-another-process']);
    await s.close();
    fs.writeFileSync(path.join(dir, 'registry.lock'), JSON.stringify({ pid: 999999, token: 'dead', at: 'x' }));
    const third = mkStore(dir, { isPidAlive: () => false }); assert.equal((await third.open()).state, 'ready');
    assert.ok(ls(path.join(dir, 'quarantine')).some(f => f.startsWith('stale-lock-')));
    await third.close();
    assert.ok(!fs.existsSync(path.join(dir, 'registry.lock')), 'lock released on close');
  });
  await t('a registry changed on disk by someone else is not overwritten', async () => {
    const dir = freshDir();
    const s = mkStore(dir); await s.open();
    const reg = path.join(dir, 'registry.json');
    const outside = read(reg).replace('"events": []', '"events": [] ');
    fs.writeFileSync(reg, outside);
    const res = await s.appendEvents([photographerEvent('Test Q4b Outside')]);
    assert.equal(res.ok, false);
    assert.equal(read(reg), outside);
    assert.deepEqual([s.getStatus().state, s.getStatus().reason], ['disabled', 'registry-changed-externally']);
    await s.close();
  });
  await t('backups are kept before every write and pruned to the retention limit', async () => {
    const dir = freshDir();
    const s = mkStore(dir, { backupRetention: 5 }); await s.open();
    for (let i = 0; i < 9; i++) await s.appendEvents([photographerEvent(`Test Q4b Backup ${i}`)]);
    const backups = ls(path.join(dir, 'backups'));
    assert.equal(backups.length, 5);
    const newest = JSON.parse(read(path.join(dir, 'backups', backups[4])));
    assert.equal(newest.events.length, 8, 'newest backup is the state before the last write');
    await s.close();
  });

  console.log('Q4b — event integrity');
  await t('duplicate events are idempotent and cause no write', async () => {
    const dir = freshDir();
    const s = mkStore(dir); await s.open();
    const e = photographerEvent('Test Q4b Dup');
    await s.appendEvents([e]);
    const backupsBefore = ls(path.join(dir, 'backups')).length;
    const res = await s.appendEvents([e, e]);
    assert.deepEqual([res.ok, res.added.length, res.duplicates.length], [true, 0, 2]);
    assert.equal(ls(path.join(dir, 'backups')).length, backupsBefore, 'no write for duplicates');
    await s.close();
  });
  await t('same eventId with different content: local kept, other copy held, survives restart, never derived', async () => {
    const dir = freshDir();
    const s = mkStore(dir); await s.open();
    const e = photographerEvent('Test Q4b Original');
    await s.appendEvents([e]);
    const forged = { ...e, name: 'Test Q4b Forged' };
    const res = await s.appendEvents([forged]);
    assert.deepEqual([res.ok, res.held], [true, [e.eventId]]);
    await s.appendEvents([forged]); // held only once
    await s.close();
    const r = mkStore(dir); await r.open();
    assert.equal(r.getStatus().integrityConflicts, 1);
    assert.deepEqual(r.getIntegrityConflicts().map(c => c.eventId), [e.eventId]);
    assert.equal(r.getEvents().find(x => x.eventId === e.eventId).name, 'Test Q4b Original');
    assert.equal(r.deriveState().photographers.get(e.photographerId).name, 'Test Q4b Original');
    await r.close();
    // Pure layer: a set holding both versions trusts neither; a merge keeps local and holds incoming.
    const n = normalizeEventSet([e, forged]);
    assert.ok(!n.events.some(x => x.eventId === e.eventId));
    assert.equal(n.ignored.find(x => x.eventId === e.eventId).reason, 'event-id-collision');
    const plan = planMerge([e], [forged]);
    assert.deepEqual([plan.idCollisions, plan.held.length, plan.merged[0].name], [[e.eventId], 1, 'Test Q4b Original']);
    const twins = planMerge([], [e, forged]);
    assert.deepEqual([twins.added.length, twins.held.length], [0, 2], 'conflicting twins inside one incoming set are both held');
  });
  await t('unknown future event types in the file are preserved verbatim; local appends of unknown types are refused', async () => {
    const dir = freshDir();
    const s = mkStore(dir); await s.open(); await s.close();
    const reg = path.join(dir, 'registry.json');
    const doc = JSON.parse(read(reg));
    const future = { schema: 1, eventId: seqId(), type: 'future-camera-note', at: '2026-11-03T09:00:00.000Z', origin: ORIGIN, note: 'from a newer version' };
    fs.writeFileSync(reg, `${JSON.stringify({ ...doc, events: [future] }, null, 2)}\n`);
    const r = mkStore(dir); const st = await r.open();
    assert.deepEqual([st.state, st.unknownTypeEvents], ['ready', 1]);
    await r.appendEvents([photographerEvent('Test Q4b After Future')]);
    assert.deepEqual(JSON.parse(read(reg)).events[0], future, 'preserved verbatim through a rewrite');
    const refused = await r.appendEvents([{ ...future, eventId: seqId() }]);
    assert.equal(refused.rejected[0].errors[0], 'unknown event type');
    await r.close();
  });

  console.log('Q4b — photographer IDs');
  await t('shipped names: deterministic, no write; local additions: random ID persisted once and reused after restart', async () => {
    const dir = freshDir();
    const shippedNames = ['Shipped Q4b Person'];
    const listNames = [...shippedNames, 'Local Q4b Person'];
    const s = mkStore(dir); await s.open();
    const sh = await s.ensurePhotographerId('shipped q4b person', { listNames, shippedNames, origin: ORIGIN });
    assert.deepEqual([sh.ok, sh.via, sh.photographerId], [true, 'shipped', P.shippedPhotographerId('Shipped Q4b Person')]);
    assert.equal(s.getStatus().events, 0);
    const loc = await s.ensurePhotographerId('Local Q4b Person', { listNames, shippedNames, origin: ORIGIN });
    assert.deepEqual([loc.ok, loc.via], [true, 'new']);
    assert.match(loc.photographerId, /^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    const again = await Promise.all([1, 2, 3].map(() => s.ensurePhotographerId('LOCAL q4b person', { listNames, shippedNames, origin: ORIGIN })));
    assert.ok(again.every(x => x.photographerId === loc.photographerId && x.via === 'registered'), 'no duplicate IDs under concurrency');
    assert.equal((await s.ensurePhotographerId('Not In List', { listNames, shippedNames, origin: ORIGIN })).reason, 'not-in-photographer-list');
    await s.close();
    const r = mkStore(dir); await r.open();
    assert.equal((await r.ensurePhotographerId('Local Q4b Person', { listNames, shippedNames, origin: ORIGIN })).photographerId, loc.photographerId);
    await r.close();
  });
  await t('the same name on two computers is two photographers; a merged registry reports it as ambiguous', async () => {
    const listNames = ['Shared Q4b Name'];
    const a = mkStore(freshDir()); await a.open();
    const b = mkStore(freshDir()); await b.open();
    const ida = (await a.ensurePhotographerId('Shared Q4b Name', { listNames, origin: ORIGIN })).photographerId;
    const idb = (await b.ensurePhotographerId('Shared Q4b Name', { listNames, origin: { ...ORIGIN, computerId: 'comp-test-B' } })).photographerId;
    assert.notEqual(ida, idb);
    const plan = planMerge(a.getEvents(), b.getEvents());
    assert.ok(plan.newConflicts.some(c => c.kind === 'same-name-different-ids'));
    assert.equal((await a.appendEvents(plan.added)).ok, true);
    const amb = await a.ensurePhotographerId('Shared Q4b Name', { listNames, origin: ORIGIN });
    assert.deepEqual([amb.ok, amb.reason, amb.photographerIds.sort()], [false, 'ambiguous', [ida, idb].sort()]);
    await a.close(); await b.close();
  });

  console.log('Q4b — privacy');
  await t('status, diagnostics and files carry no raw serials, keys or digests outside the registry events', async () => {
    const dir = freshDir();
    const s = mkStore(dir); await s.open();
    const ring = s.getKeyring();
    const ev = deviceEvent(ring, 'FAKEQ4BSERIAL77');
    await s.appendEvents([ev]);
    const digest = ev.identifiers[0].digest;
    const diag = JSON.stringify([s.getStatus(), await s.listRecoveryCandidates(), s.getIntegrityConflicts(), ring]);
    assert.ok(!diag.includes(digest) && !/[0-9a-f]{64}/.test(diag), 'no digests in diagnostics');
    for (const f of ['registry.json', 'keys.json']) assert.ok(!read(path.join(dir, f)).includes('FAKEQ4BSERIAL77'), `no raw serial in ${f}`);
    assert.ok(!read(path.join(dir, 'keys.json')).includes(digest));
    assert.equal(deriveRegistryState(s.getEvents()).devices.size, 1);
    const mode = fs.statSync(path.join(dir, 'keys.json')).mode & 0o777;
    assert.equal(mode, 0o600, 'key file readable by the owner only');
    await s.close();
  });

  await fsp.rm(ROOT, { recursive: true, force: true });
  console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
})();
