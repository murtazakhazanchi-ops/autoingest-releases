'use strict';

// AI-FEAT-063 / AI-RM-014 Q4c — learning from committed imports (service level). The real
// learning service and the real Q4b registry store run in throw-away temp dirs with a FAKE
// secure storage; camera evidence is injected as Q2/Q3-shaped records built with the real
// fileIdentity(). The Electron runtime (cache lookup, re-read, main.js hook) is covered by
// photographerLearningQ4cLive.test.js. Every serial and photographer is FAKE.
//
// Run: node test/photographerLearningQ4c.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fileIdentity } = require('../services/cameraIdentityEvidence');
const { createIdentityRegistryStore } = require('../services/identityRegistryStore');
const { createPhotographerLearningService, learningKey } = require('../services/photographerLearningService');
const { suggestForCamera } = require('../services/photographerSuggestion');
const P = require('../services/photographerIdentity');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-q4c-learning-'));
let dirN = 0;
const SHIPPED = ['Shipped Q4c Person'];
const LIST = [...SHIPPED, 'Local Q4c Alpha', 'Local Q4c Beta'];

const T = {
  canonA: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS R5', 'ExifIFD:SerialNumber': 'FAKEQ4CR5A01', 'Canon:InternalSerialNumber': 'FKQ4CR5AI1' },
  canonAExifOnly: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS R5', 'ExifIFD:SerialNumber': 'FAKEQ4CR5A01' },
  canonAIntOnly: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS R5', 'Canon:InternalSerialNumber': 'FKQ4CR5AI1' },
  canonB: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS R5', 'ExifIFD:SerialNumber': 'FAKEQ4CR5B02' },
  canonNoSerial: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS R5' },
  sony: { 'IFD0:Make': 'SONY', 'IFD0:Model': 'ILCE-7M3', 'Sony:InternalSerialNumber': 'FAKEQ4CSONY1' },
  nikon: { 'IFD0:Make': 'NIKON CORPORATION', 'IFD0:Model': 'NIKON D750', 'Nikon:SerialNumber': '7400001' },
  phone: { 'IFD0:Make': 'Apple', 'IFD0:Model': 'iPhone 6' },
  unknown: {},
};
const FAKE = Object.values(T).flatMap(o => Object.entries(o).filter(([k]) => /Serial/.test(k)).map(([, v]) => v));

function fakeSecureStorage(over = {}) {
  return { backend: 'fake-test', identity: 'q4c-test-app', isAvailable: () => true,
    encrypt: (b) => Buffer.concat([Buffer.from('S:'), b]), decrypt: (c) => { if (!c.subarray(0, 2).equals(Buffer.from('S:'))) throw new Error('x'); return Buffer.from(c.subarray(2)); }, ...over };
}

/** A computer: its own userData dir, a fake keychain and a learning service over a real store. */
function computer({ computerId = 'comp-q4c-A', dir = path.join(ROOT, `ud-${++dirN}`, 'identity-registry'), enabled = true, secureStorage = fakeSecureStorage(), evidenceDelayMs = 0, clock, maxQueue } = {}) {
  let evidence = null; // set per import
  let store = null;
  const c = {
    dir, computerId,
    setEvidence(e) { evidence = e; },
    store: () => store,
    svc: createPhotographerLearningService({
      isEnabled: () => enabled,
      journalDir: () => dir,
      getComputerId: () => computerId,
      getNames: () => ({ listNames: LIST, shippedNames: SHIPPED }),
      openStore: async () => { store = createIdentityRegistryStore({ dir, secureStorage, computerId }); await store.open(); return store; },
      resolveEvidence: async (_files, { signal }) => {
        if (evidenceDelayMs) await new Promise((res) => { const tm = setTimeout(res, evidenceDelayMs); signal.addEventListener('abort', () => { clearTimeout(tm); res(); }); });
        return typeof evidence === 'function' ? evidence() : evidence;
      },
      now: clock || (() => new Date()),
      ...(maxQueue ? { maxQueue } : {}),
    }),
  };
  return c;
}

/** Q2/Q3-shaped records for the committed files: tags + optional RAW/JPEG pair key. */
function records(spec) {
  return spec.map(([tags, pairKey = null], i) => ({ path: `/fake/card/DCIM/F${i}.JPG`, name: `F${i}.JPG`, type: 'photo', size: 1000 + i, pairKey, evidence: null, identity: fileIdentity(tags) }));
}
const ev = (spec, extra = {}) => ({ records: records(spec), unread: 0, source: 'cache', ...extra });
let entryN = 0;
const commit = (c, photographer, n, over = {}) => c.svc.onImportCommitted({
  entryIds: over.entryIds || [`entry-${++entryN}`], photographer,
  files: Array.from({ length: n }, (_, i) => ({ src: `/fake/card/DCIM/F${i}.JPG`, size: 1000 + i })),
  copied: over.copied ?? n, workflow: over.workflow || 'event-import', operatorId: null,
});
const events = (c) => c.store().getEvents();
const types = (c) => events(c).map(e => e.type);
const lastOutcome = (c) => c.svc.outcomes().slice(-1)[0];
const pid = (name) => (SHIPPED.includes(name) ? P.shippedPhotographerId(name) : null);

(async () => {
  console.log('Q4c — eligibility, laziness, opt-out');
  await t('nothing is created on disk before the first eligible committed import, or while learning is off', async () => {
    const off = computer({ enabled: false });
    off.setEvidence(ev([[T.canonA]]));
    assert.equal(commit(off, 'Local Q4c Alpha', 1), 'disabled');
    await off.svc.whenIdle();
    assert.ok(!fs.existsSync(off.dir), 'learning off: no registry, key or journal');
    const c = computer();
    c.setEvidence(ev([[T.canonA]]));
    assert.equal(c.svc.onImportCommitted({ entryIds: [], photographer: 'Local Q4c Alpha', files: [{ src: '/x' }], copied: 1, workflow: 'event-import' }), 'ineligible');
    assert.equal(commit(c, 'Local Q4c Alpha', 1, { copied: 0 }), 'ineligible', 'all files already in the archive: nothing newly ingested');
    for (const workflow of ['staging-import', 'transfer-import', 'qmz-move', 'metadata-repair']) assert.equal(commit(c, 'Local Q4c Alpha', 1, { workflow }), 'ineligible', `${workflow} is not eligible`);
    assert.equal(c.svc.onImportCommitted({ entryIds: ['e'], photographer: '  ', files: [{ src: '/x' }], copied: 1, workflow: 'event-import' }), 'ineligible');
    await c.svc.whenIdle();
    assert.ok(!fs.existsSync(c.dir), 'ineligible imports create nothing');
    assert.equal(commit(c, 'Local Q4c Alpha', 1), 'queued');
    await c.svc.whenIdle();
    assert.ok(fs.existsSync(path.join(c.dir, 'registry.json')) && fs.existsSync(path.join(c.dir, 'keys.json')));
  });
  await t('onImportCommitted returns immediately even when evidence is slow, and never throws', async () => {
    const c = computer({ evidenceDelayMs: 400 });
    c.setEvidence(ev([[T.canonA]]));
    const t0 = process.hrtime.bigint();
    const r = commit(c, 'Local Q4c Alpha', 1);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(r, 'queued');
    assert.ok(ms < 20, `returned in ${ms.toFixed(2)} ms`);
    assert.doesNotThrow(() => c.svc.onImportCommitted(null));
    assert.doesNotThrow(() => c.svc.onImportCommitted({ entryIds: 5, files: 'x' }));
    await c.svc.whenIdle();
    assert.equal(lastOutcome(c).status, 'recorded');
  });

  console.log('Q4c — per-import learning rules');
  await t('one identified body → device registered + import-observed; never a confirmation', async () => {
    const c = computer();
    c.setEvidence(ev([[T.canonA], [T.canonA], [T.canonAExifOnly]]));
    commit(c, 'Local Q4c Alpha', 3);
    await c.svc.whenIdle();
    assert.deepEqual(types(c).sort(), ['device-registered', 'import-observed', 'photographer-registered']);
    assert.ok(!types(c).some(x => x.startsWith('association-')), 'no confirmed/rejected/retired from an import');
    const o = events(c).find(e => e.type === 'import-observed');
    assert.equal(o.fileCount, 3);
    assert.equal(o.origin.workflow, 'event-import');
    assert.equal(o.origin.computerId, 'comp-q4c-A');
    const s = c.store().deriveState({ shippedNames: SHIPPED });
    const [dev] = s.devices.keys();
    assert.equal(suggestForCamera(s, { kind: 'body', deviceId: dev }).level, 'possible');
  });
  await t('Canon dual identifiers, Sony and Nikon maker-note identities: one device each, matched on later imports', async () => {
    const c = computer();
    for (const [tags, again] of [[T.canonA, T.canonAIntOnly], [T.sony, T.sony], [T.nikon, T.nikon]]) {
      c.setEvidence(ev([[tags]])); commit(c, 'Local Q4c Alpha', 1); await c.svc.whenIdle();
      c.setEvidence(ev([[again]])); commit(c, 'Local Q4c Alpha', 1); await c.svc.whenIdle();
    }
    const s = c.store().deriveState();
    assert.equal(s.devices.size, 3, 'Canon internal-only file matched the body its original registered');
    for (const d of s.devices.values()) assert.equal(s.associationsForDevice(d.deviceId)[0].observedImports, 2);
  });
  await t('mixed-camera import → co-occurrence only; same-model bodies stay separate', async () => {
    const c = computer();
    c.setEvidence(ev([[T.canonA], [T.canonB], [T.canonB]]));
    commit(c, 'Local Q4c Alpha', 3);
    await c.svc.whenIdle();
    assert.equal(lastOutcome(c).observation, 'multiple-cameras');
    const s = c.store().deriveState();
    assert.equal(s.devices.size, 2, 'two R5 bodies registered independently');
    for (const d of s.devices.keys()) assert.equal(suggestForCamera(s, { kind: 'body', deviceId: d }).level, 'none');
    assert.ok(types(c).includes('import-cooccurred') && !types(c).includes('import-observed'));
  });
  await t('model-only → weak model observation; unknown camera or unread files → no association', async () => {
    const c = computer();
    c.setEvidence(ev([[T.phone], [T.phone]])); commit(c, 'Local Q4c Alpha', 2); await c.svc.whenIdle();
    assert.equal(lastOutcome(c).observation, 'single-model');
    assert.ok(types(c).includes('model-observed'));
    assert.equal(c.store().deriveState().devices.size, 0);
    const before = events(c).length;
    c.setEvidence(ev([[T.unknown]])); commit(c, 'Local Q4c Alpha', 1); await c.svc.whenIdle();
    assert.equal(lastOutcome(c).status, 'nothing-to-record');
    c.setEvidence(ev([[T.sony], [T.sony], [T.unknown]])); commit(c, 'Local Q4c Alpha', 3); await c.svc.whenIdle();
    assert.equal(lastOutcome(c).observation, 'incomplete-attribution', 'an unidentified minority blocks the observation');
    assert.deepEqual(types(c).slice(before), ['device-registered'], 'the body is still registered as a camera, with no association');
    c.setEvidence({ records: [], unread: 2, source: 'unavailable' }); commit(c, 'Local Q4c Alpha', 2); await c.svc.whenIdle();
    assert.equal(lastOutcome(c).status, 'nothing-to-record', 'source removed before reading: nothing guessed');
    c.setEvidence(ev([[T.nikon]], { unread: 1 })); commit(c, 'Local Q4c Alpha', 2); await c.svc.whenIdle();
    assert.equal(lastOutcome(c).observation, 'incomplete-attribution', 'partial read: no association');
  });
  await t('RAW/JPEG pairs count once', async () => {
    const c = computer();
    c.setEvidence(ev([[T.sony, 'pair-1'], [T.sony, 'pair-1'], [T.sony, 'pair-2'], [T.sony, 'pair-2'], [T.sony]]));
    commit(c, 'Local Q4c Alpha', 5); await c.svc.whenIdle();
    assert.equal(events(c).find(e => e.type === 'import-observed').fileCount, 3);
  });
  await t('multi-event session: each committed event is learned with its own files and photographer', async () => {
    const c = computer();
    c.setEvidence(ev([[T.canonA], [T.canonA]]));
    commit(c, 'Local Q4c Alpha', 2, { workflow: 'multi-event-import' });
    await c.svc.whenIdle();
    c.setEvidence(ev([[T.nikon]]));
    commit(c, 'Shipped Q4c Person', 1, { workflow: 'multi-event-import' });
    await c.svc.whenIdle();
    const s = c.store().deriveState({ shippedNames: SHIPPED });
    const assoc = [...s.associations.values()].filter(a => a.state);
    assert.equal(assoc.length, 2, 'two associations, not every camera × every photographer');
    const byPh = Object.fromEntries(assoc.map(a => [s.photographers.get(a.photographerId)?.name, s.devices.get(a.deviceId).modelKey]));
    assert.deepEqual(byPh, { 'Local Q4c Alpha': fileIdentity(T.canonA).model.key, 'Shipped Q4c Person': fileIdentity(T.nikon).model.key });
    assert.ok(events(c).filter(e => e.type === 'import-observed').every(e => e.origin.workflow === 'multi-event-import'));
    assert.equal(assoc.find(a => a.photographerId === pid('Shipped Q4c Person')).photographerId, P.shippedPhotographerId('Shipped Q4c Person'), 'shipped names keep their deterministic ID');
  });
  await t('three observed imports on different days → likely, still observed (never confirmed)', async () => {
    let day = Date.parse('2026-11-01T10:00:00');
    const c = computer({ clock: () => new Date(day) });
    for (let i = 0; i < 3; i++) { c.setEvidence(ev([[T.sony]])); commit(c, 'Local Q4c Beta', 1); await c.svc.whenIdle(); day += 86400000; }
    const s = c.store().deriveState();
    const [dev] = s.devices.keys();
    const sug = suggestForCamera(s, { kind: 'body', deviceId: dev });
    assert.deepEqual([sug.level, sug.preselectable, sug.candidates[0].basis, sug.candidates[0].confirmations], ['likely', false, 'observed', 0]);
  });
  await t('shared camera: two photographers on one body stay alternatives', async () => {
    const c = computer();
    c.setEvidence(ev([[T.nikon]])); commit(c, 'Local Q4c Alpha', 1); await c.svc.whenIdle();
    c.setEvidence(ev([[T.nikon]])); commit(c, 'Local Q4c Beta', 1); await c.svc.whenIdle();
    const s = c.store().deriveState();
    assert.equal(suggestForCamera(s, { kind: 'body', deviceId: [...s.devices.keys()][0] }).level, 'alternatives');
  });

  console.log('Q4c — exactly-once, restarts, failures');
  await t('duplicate callbacks and restarts never duplicate an observation', async () => {
    const c = computer();
    c.setEvidence(ev([[T.canonA]]));
    const ids = ['entry-dup-1', 'entry-dup-2'];
    assert.equal(commit(c, 'Local Q4c Alpha', 1, { entryIds: ids }), 'queued');
    assert.equal(commit(c, 'Local Q4c Alpha', 1, { entryIds: [...ids].reverse() }), 'duplicate', 'same committed entries in any order');
    await c.svc.whenIdle();
    const n = events(c).length;
    await c.store().close();
    const again = computer({ dir: c.dir, computerId: c.computerId }); // restart: new service, same userData
    again.setEvidence(ev([[T.canonA]]));
    assert.equal(commit(again, 'Local Q4c Alpha', 1, { entryIds: ids }), 'queued');
    await again.svc.whenIdle();
    assert.equal(lastOutcome(again).status, 'duplicate');
    assert.equal(events(again).length, n);
    assert.equal(learningKey('comp-q4c-A', ids), learningKey('comp-q4c-A', [...ids].reverse()));
    assert.notEqual(learningKey('comp-q4c-A', ids), learningKey('comp-q4c-B', ids), 'scoped to the originating computer');
    await again.store().close();
  });
  await t('registry locked by another process, corrupt registry: learning skipped, nothing overwritten', async () => {
    const c = computer();
    c.setEvidence(ev([[T.canonA]])); commit(c, 'Local Q4c Alpha', 1); await c.svc.whenIdle();
    const holder = c.store(); // still open = lock held
    const other = computer({ dir: c.dir });
    other.setEvidence(ev([[T.canonA]])); commit(other, 'Local Q4c Alpha', 1); await other.svc.whenIdle();
    assert.deepEqual([lastOutcome(other).status, lastOutcome(other).reason], ['registry-unavailable', 'locked-by-another-process']);
    await holder.close();
    fs.writeFileSync(path.join(c.dir, 'registry.json'), '{"broken": ');
    const third = computer({ dir: c.dir });
    third.setEvidence(ev([[T.canonA]])); commit(third, 'Local Q4c Alpha', 1); await third.svc.whenIdle();
    assert.deepEqual([lastOutcome(third).status, lastOutcome(third).reason], ['registry-unavailable', 'registry-corrupt']);
    assert.equal(fs.readFileSync(path.join(c.dir, 'registry.json'), 'utf8'), '{"broken": ');
  });
  await t('missing / undecryptable key: body learning disabled (model-only), key never replaced', async () => {
    const c = computer();
    c.setEvidence(ev([[T.canonA]])); commit(c, 'Local Q4c Alpha', 1); await c.svc.whenIdle();
    await c.store().close();
    const keyFile = path.join(c.dir, 'keys.json');
    const keys = fs.readFileSync(keyFile, 'utf8');
    const devicesBefore = 1; // the Canon body registered above
    const locked = computer({ dir: c.dir, secureStorage: fakeSecureStorage({ decrypt: () => { throw new Error('keychain denied'); } }) });
    locked.setEvidence(ev([[T.canonB]])); commit(locked, 'Local Q4c Alpha', 1); await locked.svc.whenIdle();
    const o = lastOutcome(locked);
    assert.deepEqual([o.status, o.bodyMatching, o.observation], ['recorded', false, 'single-model']);
    assert.equal(locked.store().deriveState().devices.size, devicesBefore, 'no new device without a key');
    assert.equal(fs.readFileSync(keyFile, 'utf8'), keys, 'key file untouched');
    await locked.store().close();
    const renamed = computer({ dir: c.dir, secureStorage: fakeSecureStorage({ identity: 'renamed-app', decrypt: () => { throw new Error('must not be called'); } }) });
    renamed.setEvidence(ev([[T.canonB]])); commit(renamed, 'Local Q4c Alpha', 1); await renamed.svc.whenIdle();
    assert.equal(renamed.store().getStatus().keyStatus, 'key-protection-identity-mismatch', 'a renamed app never decrypts under another identity');
    await renamed.store().close();
  });
  await t('graceful shutdown cancels slow work; the next run reports it as interrupted', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    c.setEvidence(ev([[T.canonA]]));
    commit(c, 'Local Q4c Alpha', 1);
    await new Promise(r => setTimeout(r, 150));
    c.svc.shutdown();
    await c.svc.whenIdle();
    assert.equal(lastOutcome(c).status, 'interrupted');
    assert.ok(!types(c).includes('import-observed'), 'nothing half-recorded');
    assert.equal(commit(c, 'Local Q4c Alpha', 1), 'stopped');
    c.store().releaseLockSync();
    assert.ok(!fs.existsSync(path.join(c.dir, 'registry.lock')), 'lock released synchronously at quit');
    // A process killed mid-learning leaves "started"; the next run's first journal write reports it.
    const jf = path.join(c.dir, 'learning-journal.json');
    const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
    j.entries.push({ key: 'imp-' + 'a'.repeat(32), runId: 'crashed-run', at: new Date().toISOString(), workflow: 'event-import', status: 'started', reason: null, files: 1 });
    fs.writeFileSync(jf, JSON.stringify(j));
    const next = computer({ dir: c.dir });
    next.setEvidence(ev([[T.sony]])); commit(next, 'Local Q4c Alpha', 1); await next.svc.whenIdle();
    const swept = JSON.parse(fs.readFileSync(jf, 'utf8')).entries.find(e => e.runId === 'crashed-run');
    assert.deepEqual([swept.status, swept.reason], ['interrupted', 'app-closed-before-learning-finished']);
    await next.store().close();
  });
  await t('jobs still waiting at quit are journaled when accepted and reported as interrupted next run', async () => {
    const c = computer({ evidenceDelayMs: 5000 });
    c.setEvidence(ev([[T.canonA]]));
    const keys = [1, 2, 3].map(() => { const id = `entry-${++entryN}`; assert.equal(commit(c, 'Local Q4c Alpha', 1, { entryIds: [id] }), 'queued'); return learningKey('comp-q4c-A', [id]); });
    await new Promise(r => setTimeout(r, 150));
    c.svc.shutdown();
    await c.svc.whenIdle();
    c.store().releaseLockSync();
    const jf = path.join(c.dir, 'learning-journal.json');
    const statusOf = () => { const e = JSON.parse(fs.readFileSync(jf, 'utf8')).entries; return keys.map(k => e.filter(x => x.key === k).map(x => `${x.status}:${x.reason}`)); };
    assert.deepEqual(statusOf(), [['interrupted:shutdown'], ['queued:null'], ['queued:null']], 'running job interrupted; waiting jobs durably recorded as queued');
    const next = computer({ dir: c.dir });
    next.setEvidence(ev([[T.sony]])); commit(next, 'Local Q4c Alpha', 1); await next.svc.whenIdle();
    assert.deepEqual(statusOf(), [['interrupted:shutdown'], ['interrupted:app-closed-before-learning-started'], ['interrupted:app-closed-before-learning-started']]);
    assert.ok(!next.store().getEvents().some(e => keys.includes(e.importId)), 'nothing recorded for the dropped jobs (no retry, no guess)');
    await next.store().close();
  });
  await t('a full learning queue is journaled as dropped, never silently lost', async () => {
    const c = computer({ evidenceDelayMs: 300, maxQueue: 2 });
    c.setEvidence(ev([[T.canonA]]));
    const res = [1, 2, 3, 4].map(() => commit(c, 'Local Q4c Alpha', 1));
    assert.deepEqual(res, ['queued', 'queued', 'queue-full', 'queue-full']);
    await c.svc.whenIdle();
    const e = JSON.parse(fs.readFileSync(path.join(c.dir, 'learning-journal.json'), 'utf8')).entries;
    assert.equal(e.filter(x => x.status === 'dropped' && x.reason === 'queue-full').length, 2);
    assert.equal(e.filter(x => x.status === 'recorded').length, 2, 'both accepted jobs still processed');
    await c.store().close();
  });
  await t('journal reports outcomes without identifiers, names, paths or digests', async () => {
    const c = computer();
    c.setEvidence(ev([[T.canonA], [T.sony]])); commit(c, 'Local Q4c Alpha', 2); await c.svc.whenIdle();
    c.setEvidence(ev([[T.nikon]])); commit(c, 'Local Q4c Beta', 1); await c.svc.whenIdle();
    const text = fs.readFileSync(path.join(c.dir, 'learning-journal.json'), 'utf8');
    const j = JSON.parse(text);
    assert.ok(j.entries.length >= 2 && j.entries.every(e => /^imp-[0-9a-f]{32}$/.test(e.key)));
    for (const s of [...FAKE, 'Local Q4c', '/fake/', 'F0.JPG']) assert.ok(!text.includes(s), `journal leaks ${s.length} chars`);
    assert.ok(!/[0-9a-f]{64}/.test(text), 'no digests');
    const reg = fs.readFileSync(path.join(c.dir, 'registry.json'), 'utf8');
    for (const s of FAKE) assert.ok(!reg.includes(s), 'no raw serial in the registry');
  });

  await c_cleanup();
  console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
})();

async function c_cleanup() { await fsp.rm(ROOT, { recursive: true, force: true }); }
