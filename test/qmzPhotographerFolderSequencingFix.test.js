'use strict';

// Regression tests for the "QMZ sequence folder treated as a photographer" bug class:
//   - photographerSequenceService.scanPhotographerFolders must never list a QMZ sequence
//     container ("01Q", "05aMZ", …), `_Unsequenced`, or `Enroute` as a photographer — the
//     real photographer, if any, is nested one level deeper and gets its own scope.
//   - applyRenames must never rename a QMZ container itself, even defensively.
//   - updateManifestAfterRename must remap manifest file paths at the correct nested depth.
//   - resolveScopeBaseDir (shared with main.js's event:applyPhotographerSequence IPC
//     handler) must accept the new multi-segment nested scope keys this produces while
//     still rejecting traversal/invalid input.
// Pure filesystem + pure logic — no Electron, no ExifTool.
// Run with: node test/qmzPhotographerFolderSequencingFix.test.js

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const fsp    = require('node:fs/promises');
const os     = require('node:os');
const path   = require('node:path');

const seq = require('../services/photographerSequenceService');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const mkdirs = async (root, rels) => {
  for (const r of rels) await fsp.mkdir(path.join(root, ...r.split('/')), { recursive: true });
};
const tmpEvent = () => fsp.mkdtemp(path.join(os.tmpdir(), 'ai-qmzseq-'));
const byScopeKey = scopes => new Map(scopes.map(s => [s.scopeKey, s]));

console.log('qmzPhotographerFolderSequencingFix');

(async () => {
  // ── Bug 2: scanPhotographerFolders must not list QMZ containers as photographers ──

  await t('single-component: a bare QMZ sequence folder under the event root is never a photographer; its real photographer gets its own nested scope', async () => {
    const ev = await tmpEvent();
    await mkdirs(ev, ['01Q/M Murtaza Khazanchi', '02M/Jane Doe']);
    const scopes = await seq.scanPhotographerFolders(ev, []);
    assert.equal(scopes.length, 3, 'root scope + one nested scope per sequence');
    const byKey = byScopeKey(scopes);
    assert.deepEqual(byKey.get(seq.EVENT_ROOT_KEY).photographers, [], 'root itself has no photographers — 01Q/02M are containers, not photographers');
    assert.deepEqual(byKey.get('01Q').photographers, [{ folderName: 'M Murtaza Khazanchi', canonical: 'M Murtaza Khazanchi' }]);
    assert.deepEqual(byKey.get('02M').photographers, [{ folderName: 'Jane Doe', canonical: 'Jane Doe' }]);
    for (const s of scopes) assert.ok(!s.photographers.some(p => p.canonical === '01Q' || p.canonical === '02M'), 'sequence code never appears as a photographer canonical name');
  });

  await t('same photographer in two different sequences gets two independent scopes, never merged', async () => {
    const ev = await tmpEvent();
    await mkdirs(ev, ['01Q/Jane Doe', '02M/Jane Doe']);
    const scopes = await seq.scanPhotographerFolders(ev, []);
    const byKey = byScopeKey(scopes);
    assert.deepEqual(byKey.get('01Q').photographers, [{ folderName: 'Jane Doe', canonical: 'Jane Doe' }]);
    assert.deepEqual(byKey.get('02M').photographers, [{ folderName: 'Jane Doe', canonical: 'Jane Doe' }]);
    assert.notEqual(byKey.get('01Q'), byKey.get('02M'));
  });

  await t('multi-component: a QMZ sequence nested inside a component gets scopeKey "Component/SeqCode"; ordinary photographers in the same component are unaffected', async () => {
    const ev = await tmpEvent();
    await mkdirs(ev, ['02-QMZ-BHUJ/01Q/M Murtaza Khazanchi', '02-QMZ-BHUJ/Ordinary Photographer', 'Other-Comp/Ann Poe']);
    const components = [{ folderName: '02-QMZ-BHUJ' }, { folderName: 'Other-Comp' }];
    const scopes = await seq.scanPhotographerFolders(ev, components);
    const byKey = byScopeKey(scopes);
    assert.deepEqual(byKey.get('02-QMZ-BHUJ').photographers, [{ folderName: 'Ordinary Photographer', canonical: 'Ordinary Photographer' }]);
    assert.deepEqual(byKey.get('02-QMZ-BHUJ/01Q').photographers, [{ folderName: 'M Murtaza Khazanchi', canonical: 'M Murtaza Khazanchi' }]);
    assert.deepEqual(byKey.get('Other-Comp').photographers, [{ folderName: 'Ann Poe', canonical: 'Ann Poe' }]);
  });

  await t('_Unsequenced holding folder is never a photographer; real photographer folders inside it are discovered as their own scope', async () => {
    const ev = await tmpEvent();
    await mkdirs(ev, ['_Unsequenced/Jane Doe', '01Q/Ann Poe']);
    const scopes = await seq.scanPhotographerFolders(ev, []);
    const byKey = byScopeKey(scopes);
    assert.deepEqual(byKey.get(seq.EVENT_ROOT_KEY).photographers, []);
    assert.deepEqual(byKey.get('_Unsequenced').photographers, [{ folderName: 'Jane Doe', canonical: 'Jane Doe' }]);
    assert.ok(!scopes.some(s => s.photographers.some(p => p.folderName === '_Unsequenced')));
  });

  await t('Enroute holding folder behaves the same way as _Unsequenced', async () => {
    const ev = await tmpEvent();
    await mkdirs(ev, ['Enroute/Jane Doe']);
    const scopes = await seq.scanPhotographerFolders(ev, []);
    const byKey = byScopeKey(scopes);
    assert.deepEqual(byKey.get('Enroute').photographers, [{ folderName: 'Jane Doe', canonical: 'Jane Doe' }]);
  });

  await t('an existing PC-prefixed photographer folder inside a QMZ sequence resolves to its bare canonical name', async () => {
    const ev = await tmpEvent();
    await mkdirs(ev, ['01Q/PC01-M Murtaza Khazanchi']);
    const scopes = await seq.scanPhotographerFolders(ev, []);
    const byKey = byScopeKey(scopes);
    assert.deepEqual(byKey.get('01Q').photographers, [{ folderName: 'PC01-M Murtaza Khazanchi', canonical: 'M Murtaza Khazanchi' }]);
  });

  await t('an ALREADY-DAMAGED container (previously mis-renamed with a PC prefix, e.g. "PC01-01Q") is still recognized as a container, not a photographer, going forward', async () => {
    const ev = await tmpEvent();
    await mkdirs(ev, ['PC01-01Q/Jane Doe']);
    const scopes = await seq.scanPhotographerFolders(ev, []);
    const byKey = byScopeKey(scopes);
    assert.deepEqual(byKey.get(seq.EVENT_ROOT_KEY).photographers, [], 'the damaged container itself is never listed as a photographer');
    assert.deepEqual(byKey.get('PC01-01Q').photographers, [{ folderName: 'Jane Doe', canonical: 'Jane Doe' }]);
  });

  await t('ordinary non-QMZ events (no sequence-code folders) are completely unaffected — single-component', async () => {
    const ev = await tmpEvent();
    await mkdirs(ev, ['Jane Doe', 'Ann Poe']);
    const scopes = await seq.scanPhotographerFolders(ev, []);
    assert.equal(scopes.length, 1);
    assert.deepEqual(scopes[0].photographers.sort((a, b) => a.folderName.localeCompare(b.folderName)), [
      { folderName: 'Ann Poe', canonical: 'Ann Poe' },
      { folderName: 'Jane Doe', canonical: 'Jane Doe' },
    ]);
  });

  await t('ordinary non-QMZ events are completely unaffected — multi-component', async () => {
    const ev = await tmpEvent();
    await mkdirs(ev, ['Ziyarat-Hall A/Jane Doe', 'Waaz-Majlis-Hall B/Ann Poe']);
    const components = [{ folderName: 'Ziyarat-Hall A' }, { folderName: 'Waaz-Majlis-Hall B' }];
    const scopes = await seq.scanPhotographerFolders(ev, components);
    assert.equal(scopes.length, 2);
    const byKey = byScopeKey(scopes);
    assert.deepEqual(byKey.get('Ziyarat-Hall A').photographers, [{ folderName: 'Jane Doe', canonical: 'Jane Doe' }]);
    assert.deepEqual(byKey.get('Waaz-Majlis-Hall B').photographers, [{ folderName: 'Ann Poe', canonical: 'Ann Poe' }]);
  });

  // ── applyRenames: must only ever touch the photographer, never the container ──

  await t('applying a sequence inside a single-component nested QMZ scope renames only the photographer folder; the sequence container keeps its own name', async () => {
    const ev = await tmpEvent();
    await mkdirs(ev, ['01Q/Jane Doe']);
    await fsp.writeFile(path.join(ev, '01Q', 'Jane Doe', 'photo.jpg'), 'x');
    const res = await seq.applyRenames(ev, [{ scopeKey: '01Q', ordered: [{ canonical: 'Jane Doe', sequence: 1, folderName: 'PC01-Jane Doe' }] }]);
    assert.ok(res.ok, res.error);
    assert.deepEqual(res.renames, [{ phase: undefined, from: 'Jane Doe', to: 'PC01-Jane Doe', scopeRel: '01Q' }].map(({ phase, ...r }) => r));
    assert.ok(fs.existsSync(path.join(ev, '01Q')), 'the sequence container itself is untouched');
    assert.ok(fs.existsSync(path.join(ev, '01Q', 'PC01-Jane Doe', 'photo.jpg')), 'the photo moved with its renamed photographer folder');
    assert.ok(!fs.existsSync(path.join(ev, '01Q', 'Jane Doe')));
  });

  await t('applying a sequence inside a multi-component nested QMZ scope ("Comp/01Q") renames only the photographer folder', async () => {
    const ev = await tmpEvent();
    await mkdirs(ev, ['02-QMZ-BHUJ/01Q/M Murtaza Khazanchi']);
    const res = await seq.applyRenames(ev, [{ scopeKey: '02-QMZ-BHUJ/01Q', ordered: [{ canonical: 'M Murtaza Khazanchi', sequence: 1, folderName: 'PC01-M Murtaza Khazanchi' }] }]);
    assert.ok(res.ok, res.error);
    assert.deepEqual(res.renames, [{ from: 'M Murtaza Khazanchi', to: 'PC01-M Murtaza Khazanchi', scopeRel: '02-QMZ-BHUJ/01Q' }]);
    assert.ok(fs.existsSync(path.join(ev, '02-QMZ-BHUJ', '01Q', 'PC01-M Murtaza Khazanchi')));
    assert.ok(fs.existsSync(path.join(ev, '02-QMZ-BHUJ', '01Q')), 'neither the component nor the sequence container were renamed');
    assert.ok(fs.existsSync(path.join(ev, '02-QMZ-BHUJ')));
  });

  await t('defensive backstop: a QMZ container name passed as a rename entry is silently skipped, never renamed, even directly at applyRenames', async () => {
    const ev = await tmpEvent();
    await mkdirs(ev, ['01Q/Jane Doe', '_Unsequenced/Ann Poe']);
    const res = await seq.applyRenames(ev, [{ scopeKey: seq.EVENT_ROOT_KEY, ordered: [
      { canonical: '01Q', sequence: 1, folderName: 'PC01-01Q' },
      { canonical: '_Unsequenced', sequence: 2, folderName: 'PC02-_Unsequenced' },
    ] }]);
    assert.ok(res.ok);
    assert.deepEqual(res.renames, [], 'nothing was renamed — both entries were QMZ containers');
    assert.ok(fs.existsSync(path.join(ev, '01Q')) && fs.existsSync(path.join(ev, '_Unsequenced')));
    assert.ok(!fs.existsSync(path.join(ev, 'PC01-01Q')) && !fs.existsSync(path.join(ev, 'PC02-_Unsequenced')));
  });

  // ── updateManifestAfterRename: nested-scope manifest path remapping ──

  await t('updateManifestAfterRename remaps a single-component nested QMZ-scope file path at the correct depth, leaving other scopes/paths untouched', async () => {
    const ev = await tmpEvent();
    const manifestDir = path.join(ev, '.autoingest');
    await fsp.mkdir(manifestDir, { recursive: true });
    const manifest = {
      jobs: [{
        photographer: 'unused-for-nested-scopes',
        files: ['01Q/Jane Doe/a.cr2', '02M/Jane Doe/b.cr2', 'Jane Doe/c.cr2'],
      }],
    };
    await fsp.writeFile(path.join(manifestDir, 'event.sync.json'), JSON.stringify(manifest));

    const scopedRenameMap = new Map([
      ['01Q', new Map([['Jane Doe', 'PC01-Jane Doe']])],
    ]);
    await seq.updateManifestAfterRename(ev, scopedRenameMap);

    const raw = JSON.parse(await fsp.readFile(path.join(manifestDir, 'event.sync.json'), 'utf8'));
    assert.deepEqual(raw.jobs[0].files, ['01Q/PC01-Jane Doe/a.cr2', '02M/Jane Doe/b.cr2', 'Jane Doe/c.cr2']);
  });

  await t('updateManifestAfterRename remaps a multi-component nested QMZ-scope file path ("Comp/01Q/Photographer/file")', async () => {
    const ev = await tmpEvent();
    const manifestDir = path.join(ev, '.autoingest');
    await fsp.mkdir(manifestDir, { recursive: true });
    const manifest = { jobs: [{ files: ['02-QMZ-BHUJ/01Q/M Murtaza Khazanchi/a.cr2', '02-QMZ-BHUJ/Ordinary Photographer/b.cr2'] }] };
    await fsp.writeFile(path.join(manifestDir, 'event.sync.json'), JSON.stringify(manifest));

    const scopedRenameMap = new Map([
      ['02-QMZ-BHUJ/01Q', new Map([['M Murtaza Khazanchi', 'PC01-M Murtaza Khazanchi']])],
    ]);
    await seq.updateManifestAfterRename(ev, scopedRenameMap);

    const raw = JSON.parse(await fsp.readFile(path.join(manifestDir, 'event.sync.json'), 'utf8'));
    assert.deepEqual(raw.jobs[0].files, ['02-QMZ-BHUJ/01Q/PC01-M Murtaza Khazanchi/a.cr2', '02-QMZ-BHUJ/Ordinary Photographer/b.cr2']);
  });

  await t('updateManifestAfterRename root-scope (non-QMZ) behavior is unchanged — regression guard', async () => {
    const ev = await tmpEvent();
    const manifestDir = path.join(ev, '.autoingest');
    await fsp.mkdir(manifestDir, { recursive: true });
    const manifest = { jobs: [{ photographer: 'Jane Doe', files: ['Jane Doe/a.cr2'] }] };
    await fsp.writeFile(path.join(manifestDir, 'event.sync.json'), JSON.stringify(manifest));

    const scopedRenameMap = new Map([[seq.EVENT_ROOT_KEY, new Map([['Jane Doe', 'PC01-Jane Doe']])]]);
    await seq.updateManifestAfterRename(ev, scopedRenameMap);

    const raw = JSON.parse(await fsp.readFile(path.join(manifestDir, 'event.sync.json'), 'utf8'));
    assert.equal(raw.jobs[0].photographer, 'PC01-Jane Doe');
    assert.deepEqual(raw.jobs[0].files, ['PC01-Jane Doe/a.cr2']);
  });

  // ── resolveScopeBaseDir: shared with main.js's IPC validation ──

  await t('resolveScopeBaseDir: EVENT_ROOT_KEY resolves directly to the event folder', async () => {
    const ev = await tmpEvent();
    const r = seq.resolveScopeBaseDir(ev, seq.EVENT_ROOT_KEY);
    assert.ok(r.ok); assert.equal(r.baseDir, ev);
  });

  await t('resolveScopeBaseDir: a single-segment scope key (component, or a bare QMZ container) resolves correctly', async () => {
    const ev = await tmpEvent();
    const r1 = seq.resolveScopeBaseDir(ev, 'CompFolder');
    assert.ok(r1.ok); assert.equal(r1.baseDir, path.join(ev, 'CompFolder'));
    const r2 = seq.resolveScopeBaseDir(ev, '01Q');
    assert.ok(r2.ok); assert.equal(r2.baseDir, path.join(ev, '01Q'));
  });

  await t('resolveScopeBaseDir: a nested two-segment scope key (component + QMZ container) resolves correctly', async () => {
    const ev = await tmpEvent();
    const r = seq.resolveScopeBaseDir(ev, '02-QMZ-BHUJ/01Q');
    assert.ok(r.ok); assert.equal(r.baseDir, path.join(ev, '02-QMZ-BHUJ', '01Q'));
  });

  await t('resolveScopeBaseDir: rejects a literal ".." segment, an empty segment, and a backslash segment', async () => {
    const ev = await tmpEvent();
    for (const bad of ['..', '../escape', 'Comp/..', 'Comp//Seq', 'Comp\\Seq', '']) {
      const r = seq.resolveScopeBaseDir(ev, bad);
      assert.equal(r.ok, false, `expected scope key ${JSON.stringify(bad)} to be rejected`);
    }
  });

  await t('resolveScopeBaseDir: rejects anything that would resolve outside the event directory', async () => {
    const ev = await tmpEvent();
    // Can't literally express ".." as a single clean segment (rejected above as a bad
    // segment), so this guards the containment check itself for any future scopeKey shape
    // that isn't individually segment-blocked — e.g. an absolute-looking segment.
    const r = seq.resolveScopeBaseDir(ev, path.resolve(os.tmpdir(), 'outside'));
    assert.equal(r.ok, false);
  });

  console.log(`${passed} passed`);
  if (process.exitCode) console.log('SOME TESTS FAILED');
})();
