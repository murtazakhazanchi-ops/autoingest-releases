'use strict';

// AI-FEAT-063 / AI-RM-014 Q5e-2a — S1 foundation: photographerFolders / photographerFolderHistory
// in event.json. Schema validation, identity evidence, append-only history, the gated atomic
// writer, physical verification, and the preservation behaviour of every audited event.json
// writer. Synthetic temp event trees only; synthetic names and IDs.
//
// Run: node test/eventPhotographerFoldersQ5e2a.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createEvent } = require('../services/identityEvents');
const { deriveRegistryState } = require('../services/associationModel');
const P = require('../services/photographerIdentity');
const F = require('../services/eventPhotographerFolders');
const { updateEventJsonAtomic } = require('../main/eventJsonStore');

const ROOT = path.resolve(__dirname, '..');
const { execFileSync } = require('node:child_process');
// Q5's OWN changes since a base: its non-merge commits on the first-parent line, plus uncommitted
// and untracked work. Stable changes merged in (e.g. v0.9.17) arrive through merge commits and are
// therefore not counted as Q5 changes by these stage-boundary checks.
function q5OwnFiles(base) {
  const run = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n');
  return [...new Set([
    ...run(['log', '--first-parent', '--no-merges', '--format=', '--name-only', `${base}..HEAD`]),
    ...run(['diff', '--name-only', 'HEAD']),
    ...run(['ls-files', '--others', '--exclude-standard']),
  ].filter(Boolean))];
}
function q5OwnDiffLines(base, file) {
  // Cumulative diff since `base`, minus exactly the lines Stable itself removed in the releases
  // merged since (merge-base(base, Stable)..Stable) — those removals are Stable's, not Q5's.
  const run = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n');
  const pick = (lines) => lines.filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
  const own = pick(run(['diff', '-U0', base, '--', file]));
  let stableRemoved = [];
  try {
    const stable = run(['rev-parse', '--verify', 'origin/stable/0.9^{commit}'])[0];
    const from = run(['merge-base', base, stable])[0];
    if (from && from !== stable) stableRemoved = pick(run(['diff', '-U0', from, stable, '--', file])).filter(l => l.startsWith('-'));
  } catch { /* no Stable ref: count everything */ }
  const left = new Map();
  for (const l of stableRemoved) left.set(l, (left.get(l) || 0) + 1);
  return own.filter((l) => { if (!l.startsWith('-') || !left.get(l)) return true; left.set(l, left.get(l) - 1); return false; });
}

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
const tmp = (tag) => fsp.mkdtemp(path.join(os.tmpdir(), `ai-q5e2a-${tag}-`));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const SHIPPED = ['Test Shipped Alpha'];
const ID = {
  alpha: P.shippedPhotographerId('Test Shipped Alpha'),
  kay: '7a7a7a7a-1111-4222-8333-444444444442',
  sam1: '11111111-2222-4333-8444-555555555558',
  sam2: '66666666-7777-4888-9999-aaaaaaaaaaad',
};
const ORIGIN = { computerId: 'fake-computer-q5e2a', operatorId: 'user_q5e2aop_ab12' };
const AT = '2026-11-06T10:00:00.000Z';
const o = (at) => ({ origin: { computerId: 'fake-computer-q5e2a', operatorId: null, workflow: 'event-import' }, at });
const EVENTS = [
  createEvent('photographer-registered', { photographerId: ID.kay, name: 'Kay Old', idOrigin: 'random' }, o('2026-09-01T00:00:00Z')),
  createEvent('photographer-renamed', { photographerId: ID.kay, fromName: 'Kay Old', toName: 'Kay Current' }, { ...o('2026-09-10T00:00:00Z'), origin: { ...o().origin, workflow: 'registry' } }),
  createEvent('photographer-registered', { photographerId: ID.sam1, name: 'Sam Same', idOrigin: 'random' }, o('2026-09-02T00:00:00Z')),
  createEvent('photographer-registered', { photographerId: ID.sam2, name: 'Sam Same', idOrigin: 'random' }, o('2026-09-03T00:00:00Z')),
];
const shipped = P.bootstrapShippedIds(SHIPPED);
const REGISTRY = { state: deriveRegistryState(EVENTS, { shipped }), shipped };

const COMPONENTS = [{ id: 1, folderName: 'A-Day1', types: [], city: '' }, { id: 2, folderName: 'B-Day2', types: [], city: '' }];
const baseDoc = (extra = {}) => ({ version: 1, hijriDate: '1448-05-01', sequence: 3, eventName: 'Event Q5e2a', components: COMPONENTS, imports: [{ id: 'imp-1', photographer: 'Kay Current' }], photographerSequences: { 'A-Day1': { 'Kay Current': { sequence: 3, folderName: 'PC03-Kay Current' } } }, tagRefinements: { k: 1 }, metadataGroups: { g: 1 }, futureField: { keep: true }, ...extra });
const scopeA = { componentId: '1', componentFolder: 'A-Day1' };
const scopeB = { componentId: '2', componentFolder: 'B-Day2' };
const ROOT_SCOPE = { componentId: null, componentFolder: null };
const ON = () => ({ enabled: true, unmet: [] });

async function eventTree(doc = baseDoc()) {
  const root = await tmp('event');
  const ev = path.join(root, 'Coll', 'Event-Q5e2a');
  for (const c of ['A-Day1/PC03-Kay Current', 'B-Day2/PC05-Kay Old', 'B-Day2/Kay Curent', 'A-Day1/PC01-Test Shipped Alpha', 'A-Day1/Sam Same']) fs.mkdirSync(path.join(ev, c), { recursive: true });
  fs.writeFileSync(path.join(ev, 'A-Day1', 'PC03-Kay Current', 'IMG_0001.JPG'), 'fake');
  fs.writeFileSync(path.join(ev, 'event.json'), JSON.stringify(doc, null, 2));
  return { root, ev, json: path.join(ev, 'event.json') };
}
const add = (ev, additions, extra = {}) => {
  const doc = JSON.parse(fs.readFileSync(path.join(ev, 'event.json'), 'utf8'));
  return F.addMappings(ev, { expectedRevision: F.foldersRevision(doc), additions, origin: ORIGIN, at: AT, registry: REGISTRY, ...extra }, { updateEventJsonAtomic, gate: ON });
};

(async () => {
  console.log('Q5e-2a — schema and compatibility');

  await t('legacy event.json without the fields: "absent", nothing to do; validators of every build ignore the optional fields', async () => {
    const r = F.readPhotographerFolders(baseDoc());
    assert.deepEqual(r, { state: 'absent', mappings: [], history: [], errors: [] });
    const { validateEventJson } = require('../main/contracts/dataValidator');
    assert.doesNotThrow(() => validateEventJson(baseDoc({ photographerFolders: { schema: 1, entries: [] }, photographerFolderHistory: { schema: 1, entries: [] } })));
    // main.js isValidEventJson requires version === 1: the fields carry their own schema and never change it.
    const main = fs.readFileSync(path.join(ROOT, 'main', 'main.js'), 'utf8');
    assert.ok(/if \(obj\.version !== 1\) return false;/.test(main), 'older builds reject any other event.json version — so it is never bumped');
    assert.equal(F.SCHEMA, 1);
  });

  await t('newer schema is preserved untouched and never written; malformed fields are invalid, not guessed', async () => {
    assert.equal(F.readPhotographerFolders(baseDoc({ photographerFolders: { schema: 2, entries: [{ anything: true }] } })).state, 'unsupported-schema');
    assert.equal(F.readPhotographerFolders(baseDoc({ photographerFolders: [] })).state, 'invalid');
    assert.equal(F.readPhotographerFolders(baseDoc({ photographerFolders: { schema: 1, entries: [], extra: 1 } })).state, 'invalid');
    const { ev } = await eventTree(baseDoc({ photographerFolders: { schema: 2, entries: [] } }));
    const before = fs.readFileSync(path.join(ev, 'event.json'));
    const r = await add(ev, [{ scope: scopeA, photographerId: ID.kay, folderName: 'PC03-Kay Current', basis: 'official-name-evidence' }]);
    assert.equal(r.reason, 'unsupported-schema');
    assert.deepEqual(fs.readFileSync(path.join(ev, 'event.json')), before, 'not rewritten');
  });

  console.log('Q5e-2a — mappings and history');

  await t('multiple photographers and components; PCxx and unsequenced folders; former-name folder; history entry per mapping', async () => {
    const { ev, json } = await eventTree();
    const r = await add(ev, [
      { scope: scopeA, photographerId: ID.kay, folderName: 'PC03-Kay Current', basis: 'official-name-evidence' },
      { scope: scopeB, photographerId: ID.kay, folderName: 'PC05-Kay Old', basis: 'official-name-evidence' },
      { scope: scopeA, photographerId: ID.alpha, folderName: 'PC01-Test Shipped Alpha', basis: 'operator-confirmed' },
    ]);
    assert.deepEqual(r, { ok: true, added: 3 });
    const doc = JSON.parse(fs.readFileSync(json, 'utf8'));
    const read = F.readPhotographerFolders(doc);
    assert.equal(read.state, 'ok');
    assert.deepEqual(read.mappings.map(m => [m.scope.componentFolder, m.folderName, m.sequencePrefix, m.basis]), [
      ['A-Day1', 'PC03-Kay Current', 'PC03', 'official-name-evidence'], ['B-Day2', 'PC05-Kay Old', 'PC05', 'official-name-evidence'], ['A-Day1', 'PC01-Test Shipped Alpha', 'PC01', 'operator-confirmed']]);
    assert.deepEqual(read.history.map(h => [h.choice, h.fromFolderName, h.toFolderName, h.fromRegisteredName, h.toRegisteredName]), [
      ['mapped', 'PC03-Kay Current', 'PC03-Kay Current', 'Kay Current', 'Kay Current'],
      ['mapped', 'PC05-Kay Old', 'PC05-Kay Old', 'Kay Current', 'Kay Current'],
      ['mapped', 'PC01-Test Shipped Alpha', 'PC01-Test Shipped Alpha', 'Test Shipped Alpha', 'Test Shipped Alpha']]);
    assert.ok(read.mappings.every(m => read.history.some(h => h.txId === m.txId)), 'every mapping points at its history entry');
    assert.deepEqual(read.history[0].origin, ORIGIN);
    for (const k of ['imports', 'photographerSequences', 'components', 'tagRefinements', 'metadataGroups', 'futureField']) assert.deepEqual(doc[k], baseDoc()[k], `${k} preserved`);
    // History is append-only; a later addition keeps the earlier entries exactly.
    const r2 = await add(ev, [{ scope: scopeA, photographerId: ID.sam1, folderName: 'Sam Same', basis: 'operator-confirmed' }]);
    assert.equal(r2.ok, true);
    const h2 = F.readPhotographerFolders(JSON.parse(fs.readFileSync(json, 'utf8'))).history;
    assert.deepEqual(h2.slice(0, 3), read.history);
    assert.equal(h2.length, 4);
  });

  await t('single-component event uses the event-root scope; the same photographer in another event is independent', async () => {
    const one = baseDoc({ components: [{ id: 7, folderName: 'Only-Comp', types: [], city: '' }] });
    const root = await tmp('single');
    const ev1 = path.join(root, 'E1'), ev2 = path.join(root, 'E2');
    for (const ev of [ev1, ev2]) { fs.mkdirSync(path.join(ev, 'PC02-Kay Current'), { recursive: true }); fs.writeFileSync(path.join(ev, 'event.json'), JSON.stringify(one)); }
    assert.equal((await add(ev1, [{ scope: ROOT_SCOPE, photographerId: ID.kay, folderName: 'PC02-Kay Current', basis: 'official-name-evidence' }])).ok, true);
    assert.equal((await add(ev2, [{ scope: ROOT_SCOPE, photographerId: ID.kay, folderName: 'PC02-Kay Current', basis: 'official-name-evidence' }])).ok, true);
    const bad = await add(ev1, [{ scope: { componentId: '7', componentFolder: 'Only-Comp' }, photographerId: ID.alpha, folderName: 'PC02-Kay Current', basis: 'operator-confirmed' }]);
    assert.equal(bad.ok, false, 'a component scope is invalid in a single-component event');
  });

  await t('evidence: similar spelling, shared (ambiguous) name and unknown photographers are never mapped from names', async () => {
    const { ev, json } = await eventTree();
    const before = fs.readFileSync(json);
    const sim = await add(ev, [{ scope: scopeB, photographerId: ID.kay, folderName: 'Kay Curent', basis: 'official-name-evidence' }]);
    assert.deepEqual([sim.reason, sim.details[0].errors], ['mapping-rejected', ['not-an-official-name-of-this-photographer']]);
    const amb = await add(ev, [{ scope: scopeA, photographerId: ID.sam1, folderName: 'Sam Same', basis: 'official-name-evidence' }]);
    assert.deepEqual(amb.details[0].errors, ['official-name-shared-by-several-photographers'], 'two identities share the name');
    const unknown = await add(ev, [{ scope: scopeA, photographerId: crypto.randomUUID(), folderName: 'Sam Same', basis: 'operator-confirmed' }]);
    assert.deepEqual(unknown.details[0].errors, ['unknown-photographer']);
    const noOp = await add(ev, [{ scope: scopeA, photographerId: ID.sam1, folderName: 'Sam Same', basis: 'operator-confirmed' }], { origin: { computerId: 'c', operatorId: null } });
    assert.equal(noOp.ok, false, 'an operator confirmation needs an operator');
    assert.deepEqual(fs.readFileSync(json), before, 'refusals never rewrite event.json');
  });

  await t('duplicate and conflicting mappings; no silent overwrite; one folder never belongs to two photographers', async () => {
    const { ev, json } = await eventTree();
    assert.equal((await add(ev, [{ scope: scopeA, photographerId: ID.kay, folderName: 'PC03-Kay Current', basis: 'official-name-evidence' }])).ok, true);
    const again = await add(ev, [{ scope: scopeA, photographerId: ID.kay, folderName: 'Sam Same', basis: 'operator-confirmed' }]);
    assert.ok(again.details.some(d => d.errors.includes('duplicate-photographer-mapping')), 'a second folder for the same person in a scope is refused (no overwrite)');
    const claim = await add(ev, [{ scope: scopeA, photographerId: ID.alpha, folderName: 'pc03-kay current', basis: 'operator-confirmed' }]);
    assert.equal(claim.ok, false, 'case-insensitively the same folder → refused');
    const both = await add(ev, [
      { scope: scopeB, photographerId: ID.sam1, folderName: 'Kay Curent', basis: 'operator-confirmed' },
      { scope: scopeB, photographerId: ID.sam2, folderName: 'Kay Curent', basis: 'operator-confirmed' },
    ]);
    assert.ok(both.details.some(d => d.errors.includes('folder-claimed-by-two-photographers')));
    assert.equal(F.readPhotographerFolders(JSON.parse(fs.readFileSync(json, 'utf8'))).mappings.length, 1);
  });

  await t('invalid scopes, paths and names: traversal, absolute, separators, reserved Windows names, prefix mismatch, cross-component', async () => {
    const doc = baseDoc();
    const v = (m) => F.readPhotographerFolders({ ...doc, photographerFolders: { schema: 1, entries: [{ scope: scopeA, photographerId: ID.kay, sequencePrefix: null, basis: 'operator-confirmed', establishedAt: AT, origin: ORIGIN, txId: crypto.randomUUID(), folderName: 'x', ...m }] }, photographerFolderHistory: { schema: 1, entries: [] } }).errors.flatMap(e => e.errors);
    assert.ok(v({ folderName: '../Escape' }).includes('not-a-single-folder-name'));
    assert.ok(v({ folderName: '/Users/x' }).includes('not-a-single-folder-name'));
    assert.ok(v({ folderName: 'a\\b' }).includes('not-a-single-folder-name'));
    assert.ok(v({ folderName: '..' }).includes('not-a-single-folder-name'));
    assert.ok(v({ folderName: 'CON' }).includes('reserved-windows-name'));
    assert.ok(v({ folderName: 'Name.' }).includes('trailing-dot-or-space'));
    assert.ok(v({ folderName: 'Bad:Name' }).includes('invalid-folder-characters'));
    assert.ok(v({ folderName: '_Unsequenced' }).includes('structural-folder-name'), 'QMZ structures are never photographer folders');
    assert.ok(v({ folderName: 'PC03-Kay', sequencePrefix: null }).includes('sequence-prefix-mismatch'));
    assert.ok(v({ scope: { componentId: '9', componentFolder: 'Z' } }).includes('component-not-in-event'));
    assert.ok(v({ scope: { componentId: '1', componentFolder: 'B-Day2' } }).includes('component-folder-changed'), 'component id and folder must agree');
    assert.ok(v({ scope: ROOT_SCOPE }).includes('event-root-scope-in-multi-component-event'));
    assert.ok(v({ photographerId: 'Kay Current' }).includes('photographer-id-invalid'), 'never a name');
    assert.ok(v({ alias: 'KC' }).includes('unexpected-field'), 'no free text rides along');
    assert.ok(v({}).includes('no-history-for-mapping'));
  });

  await t('physical verification: missing folder, case-only difference, symlinked folder and symlink escaping the event', async () => {
    const { ev, root } = await eventTree();
    const outside = path.join(root, 'outside-folder');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(ev, 'A-Day1', 'Linked Folder'));
    const r = await add(ev, [{ scope: scopeA, photographerId: ID.alpha, folderName: 'Linked Folder', basis: 'operator-confirmed' }]);
    assert.deepEqual([r.reason, r.details[0].state], ['folder-not-verified', 'symlink']);
    const m = (folderName, scope = scopeA) => ({ scope, folderName });
    const states = await F.verifyMappingsOnDisk(ev, [m('PC03-Kay Current'), m('pc03-kay current'), m('Nope'), m('Linked Folder')]);
    assert.deepEqual(states.map(s => s.state), ['present', 'name-differs-in-case', 'missing', 'symlink']);
    const missing = await add(ev, [{ scope: scopeA, photographerId: ID.alpha, folderName: 'Not There', basis: 'operator-confirmed' }]);
    assert.equal(missing.reason, 'folder-not-verified');
  });

  await t('stale revision and the production write gate', async () => {
    const { ev, json } = await eventTree();
    const doc = JSON.parse(fs.readFileSync(json, 'utf8'));
    const rev = F.foldersRevision(doc);
    assert.equal((await add(ev, [{ scope: scopeA, photographerId: ID.kay, folderName: 'PC03-Kay Current', basis: 'official-name-evidence' }])).ok, true);
    const stale = await F.addMappings(ev, { expectedRevision: rev, additions: [{ scope: scopeA, photographerId: ID.alpha, folderName: 'PC01-Test Shipped Alpha', basis: 'operator-confirmed' }], origin: ORIGIN, at: AT, registry: REGISTRY }, { updateEventJsonAtomic, gate: ON });
    assert.equal(stale.reason, 'stale-revision');
    const before = fs.readFileSync(json);
    const off = await F.addMappings(ev, { expectedRevision: F.foldersRevision(JSON.parse(before)), additions: [{ scope: scopeA, photographerId: ID.alpha, folderName: 'PC01-Test Shipped Alpha', basis: 'operator-confirmed' }], origin: ORIGIN, at: AT, registry: REGISTRY }, { updateEventJsonAtomic });
    assert.deepEqual(off, { ok: false, reason: 'mapping-writes-disabled', unmet: ['S3', 'META', 'COMP'] }, 'production writes stay off until the audited writers are protected (F11 closed in Q5e-2b)');
    assert.deepEqual(fs.readFileSync(json), before);
  });

  await t('interrupted write: a failed atomic write leaves the previous event.json intact', async () => {
    const { ev, json } = await eventTree();
    const before = fs.readFileSync(json);
    fs.chmodSync(ev, 0o555); // the temp file cannot be created
    let r;
    try { r = await add(ev, [{ scope: scopeA, photographerId: ID.kay, folderName: 'PC03-Kay Current', basis: 'official-name-evidence' }]); }
    finally { fs.chmodSync(ev, 0o755); }
    assert.equal(r.reason, 'write-failed');
    assert.deepEqual(fs.readFileSync(json), before);
    assert.ok(!fs.existsSync(`${json}.tmp`));
    assert.equal(JSON.parse(fs.readFileSync(json, 'utf8')).photographerFolders, undefined);
  });

  console.log('Q5e-2a — existing writers (preservation audit)');

  const withFields = async () => {
    const t0 = await eventTree();
    assert.equal((await add(t0.ev, [{ scope: scopeA, photographerId: ID.kay, folderName: 'PC03-Kay Current', basis: 'official-name-evidence' }])).ok, true);
    const doc = JSON.parse(fs.readFileSync(t0.json, 'utf8'));
    return { ...t0, fields: JSON.stringify([doc.photographerFolders, doc.photographerFolderHistory]) };
  };
  const fieldsOf = (json) => { const d = JSON.parse(fs.readFileSync(json, 'utf8')); return JSON.stringify([d.photographerFolders, d.photographerFolderHistory]); };

  await t('updateEventJsonAtomic partial writers (imports, status, metadata state, intent remap) keep the fields', async () => {
    const { json, fields } = await withFields();
    await updateEventJsonAtomic(json, (d) => ({ imports: [...d.imports, { id: 'imp-2', photographer: 'Kay Current' }], status: 'complete' }));
    await updateEventJsonAtomic(json, () => ({ metadataState: { state: 'ok' }, lastMetadataRun: { at: 1 } }));
    assert.equal(fieldsOf(json), fields);
    assert.equal(JSON.parse(fs.readFileSync(json, 'utf8')).imports.length, 2);
  });

  await t('F11 sequencing writer: keeps the fields and (since Q5e-2b) writes through the event.json chain', async () => {
    const { ev, json, fields } = await withFields();
    const seq = require('../services/photographerSequenceService');
    const r = await seq.writeSequencesToEventJson(ev, { 'A-Day1': { 'Kay Current': { sequence: 4, folderName: 'PC04-Kay Current' } } });
    assert.equal(r.ok, true);
    assert.equal(fieldsOf(json), fields, 'fields survive the sequencing write');
    const doc = JSON.parse(fs.readFileSync(json, 'utf8'));
    assert.deepEqual(doc.futureField, { keep: true });
    const src = fs.readFileSync(path.join(ROOT, 'services', 'photographerSequenceService.js'), 'utf8');
    assert.ok(/updateEventJsonAtomic\(jsonPath/.test(src), 'Q5e-2b: the sequencing write is in the chain');
    assert.deepEqual(F.writeGate().unmet, ['S3', 'META', 'COMP']);
  });

  await t('archive sync: a new NAS copy receives the fields; an existing NAS copy keeps its own and does not receive them (S3)', async () => {
    const sync = require('../services/archiveSyncService');
    const local = await withFields();
    const nasA = path.join(await tmp('nasA'), 'Event-Q5e2a');
    fs.mkdirSync(nasA, { recursive: true });
    await sync._copyEventJsonIfNeeded(local.ev, nasA, []);
    assert.equal(fieldsOf(path.join(nasA, 'event.json')), local.fields, 'Case A: whole-file copy carries them');
    const nasB = path.join(await tmp('nasB'), 'Event-Q5e2a');
    fs.mkdirSync(nasB, { recursive: true });
    fs.writeFileSync(path.join(nasB, 'event.json'), JSON.stringify(baseDoc({ imports: [] })));
    await sync._copyEventJsonIfNeeded(local.ev, nasB, []);
    const nb = JSON.parse(fs.readFileSync(path.join(nasB, 'event.json'), 'utf8'));
    assert.equal(nb.imports.length, 1, 'imports merged as before');
    assert.equal(nb.photographerFolders, undefined, 'Case B: mappings are not propagated — S3 must add this before writes are enabled');
  });

  await t('no new direct event.json writer: every write site is the chain, a creation-only writer, or an audited one', async () => {
    const files = [...fs.readdirSync(path.join(ROOT, 'main')).map(f => `main/${f}`), ...fs.readdirSync(path.join(ROOT, 'services')).map(f => `services/${f}`)].filter(f => f.endsWith('.js'));
    const sites = [];
    for (const f of files) {
      const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
      lines.forEach((l) => { if (!/^\s*(\*|\/\/)/.test(l) && /fsp?\.rename\([^)]*,\s*(jsonPath|eventJsonPath)\)/.test(l)) sites.push(`${f}:${l.trim()}`); });
    }
    const known = [
      'main/eventJsonStore.js', // the chain itself
      'main/main.js', // event:write and event:prepareFromRegistry — creation only (absent-check first)
      'main/metadataSyncService.js', // META (x2): whole-document read-modify-write, outside the chain
      // services/photographerSequenceService.js — F11, moved into the chain in Q5e-2b
      'services/adoptionWriteService.js', // creation only (never overwrites)
    ];
    assert.deepEqual([...new Set(sites.map(s => s.split(':')[0]))].sort(), [...known].sort(), `event.json write sites: ${sites.join(' | ')}`);
    assert.equal(sites.filter(s => s.startsWith('main/main.js')).length, 2, 'main.js: only the two creation writers');
    assert.equal(sites.filter(s => s.startsWith('main/metadataSyncService.js')).length, 2);
  });

  await t('no import, routing, sync, sequencing, metadata, renderer or preload code changed by Q5e-2a', async () => {
    let base;
    try { base = execFileSync('git', ['rev-parse', '--verify', 'bab0902^{commit}'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return; }
    const changed = q5OwnFiles(base).filter(f => !f.startsWith('graphify-out/') && !f.startsWith('.claude/'));
    const allowed = new Set(['services/eventPhotographerFolders.js', 'services/photographerRenameContract.js', 'test/eventPhotographerFoldersQ5e2a.test.js', 'test/photographerRegistryQ5c.test.js', 'test/photographerRegistryQ5b.test.js',
      // Q5e-2b (authorized): sequencing in the event.json chain + identity guard, and their tests.
      'main/main.js', 'services/photographerSequenceService.js', 'services/photographerSequenceGuard.js', 'test/photographerSequencingQ5e2b.test.js',
      // Post-investigation stabilization (authorized, test-only): shared live-test isolation +
      // external-Quit guard and the live tests wired to it. No app code.
      'test/support/liveTestPreload.js', 'test/support/liveTestQuitGuard.js', 'test/support/liveTestHarness.js', 'test/liveTestQuitGuardLive.test.js',
      'test/metadataIntentDurabilityLive.test.js', 'test/multiEventImportLive.test.js', 'test/photographerRegistryQ5aLive.test.js',
      'test/photographerRegistryQ5cLive.test.js', 'test/photographerRegistryQ5dLive.test.js', 'test/photographerRegistryQ5e1Live.test.js',
      // EQI-1 (AI-FEAT-064 / AI-RM-016, owner-approved milestone, not Q5e-2a): Event Dump Quick Import.
      // Dump is never sequenced (photographerSequenceService), attributed by its own folder
      // (eventEvidenceReconstruction), and imported through the existing import transaction.
      'main/preload.js', 'main/companionPreload.js', 'renderer/index.html', 'renderer/renderer.js', 'renderer/eventDumpImport.js',
      'renderer/importRouter.js', 'renderer/importSessionUI.js', 'renderer/companion/companion.html', 'renderer/companion/companion.js',
      'renderer/companion/companion.css', 'services/eventDumpCompanion.js', 'services/eventDumpPaths.js', 'services/companionService.js', 'services/workspaceHandoff.js',
      'services/eventEvidenceReconstruction.js', 'test/companionQ1UiFreeze.test.js', 'test/photographerRegistryQ5c.test.js',
      'test/eventDumpQuickImportEQI1.test.js', 'test/eventDumpQuickImportLive.test.js', 'test/companionQ1Live.test.js', 'test/eventDumpRoundTripRecoveryLive.test.js', 'test/support/eventDumpLiveHelpers.js']);
    assert.deepEqual(changed.filter(f => !allowed.has(f)), []);
  });

  console.log(`${passed} passed`);
})();
