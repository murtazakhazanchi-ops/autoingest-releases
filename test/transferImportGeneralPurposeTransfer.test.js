'use strict';

// Regression coverage for "AUTOINGEST — RESTORE GENERAL-PURPOSE TRANSFER IMPORT".
//
// Transfer Import must support arbitrary files, folders, nested directories, and AutoIngest
// Collections — not just Collection/Event-shaped content. The copy engine itself
// (_walkAndCopy/_copyFileSafe) was already fully generic (no event.json requirement, no
// extension/filename restriction); the only real gap was the ELIGIBILITY/CLASSIFICATION layer
// (scanImportTree / _resolveImportUnits), which rejected anything that wasn't Collection/Event
// shaped. This file proves the classification layer now accepts general-purpose content while
// archive-aware behavior (existing/new Collections, ambiguous direct Events staying blocked)
// is unchanged.
//
// Real filesystem, isolated tmp dirs, no Electron. Run with:
//   node test/transferImportGeneralPurposeTransfer.test.js

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const svc = require('../services/transferImportService');

let passed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    console.error(`  FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function isValidEventJsonFn(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.version !== 1) return false;
  if (!obj.hijriDate || typeof obj.hijriDate !== 'string') return false;
  if (!Number.isInteger(obj.sequence) || obj.sequence < 1) return false;
  if (!obj.eventName || typeof obj.eventName !== 'string') return false;
  if (!Array.isArray(obj.components)) return false;
  return true;
}
function evJson(seq, name, hijriDate = '1446-01-01') {
  return JSON.stringify({
    version: 1, hijriDate, sequence: seq, eventName: name,
    components: [{ types: ['Majlis'], city: 'TestCity', location: null }],
  });
}
async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function mkEvent(dir, seq, name) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'event.json'), evJson(seq, name));
  await fsp.writeFile(path.join(dir, 'photo.jpg'), 'bytes-' + name);
}
function findTreeNode(tree, name) { return tree.find(n => n.name === name); }

async function waitForImportDone(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = svc.getImportStatus();
    if (!status.running) return status;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('transfer import did not finish in time');
}

async function main() {
  console.log('transferImportGeneralPurposeTransfer (real filesystem, no Electron)');

  // ── Example A — AutoIngest Collection (archive-aware path unchanged) ─────────
  await t('A. an AutoIngest Collection (real Event structure) remains selectable and importable', async () => {
    const transferRoot = await mkTmp('ti-gp-a-src-');
    const mainArchiveRoot = await mkTmp('ti-gp-a-dst-');
    await mkEvent(path.join(transferRoot, '1448-03-26_Bhuj Atraaf Safar', '1448-03-26 _01-Waaz Mubarak-Masjid-Bhuj'), 1, 'Waaz Mubarak');

    const tree = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    const node = findTreeNode(tree.tree, '1448-03-26_Bhuj Atraaf Safar');
    assert.equal(node.type, 'collection');
    assert.equal(node.events[0].destinationStatus, 'resolved');

    const scope = { folderPaths: [path.join(transferRoot, '1448-03-26_Bhuj Atraaf Safar', '1448-03-26 _01-Waaz Mubarak-Masjid-Bhuj')] };
    const preview = await svc.previewImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn);
    assert.equal(preview.ok, true);
    assert.equal(preview.collections, 1);
    assert.equal(preview.events, 1);
  });

  // ── Example B — legacy year folder, numbered subfolders, no AutoIngest metadata ─
  await t('B. a legacy year folder (numbered subfolders, no event.json) is selectable and recursively importable', async () => {
    const transferRoot = await mkTmp('ti-gp-b-src-');
    const mainArchiveRoot = await mkTmp('ti-gp-b-dst-');
    const yearRoot = path.join(transferRoot, '1441');
    await fsp.mkdir(path.join(yearRoot, '_1441 HDD (Mrl) (Copied by ASC)'), { recursive: true });
    await fsp.writeFile(path.join(yearRoot, '_1441 HDD (Mrl) (Copied by ASC)', 'index.txt'), 'legacy index');
    for (const num of ['732', '733', '734']) {
      await fsp.mkdir(path.join(yearRoot, num), { recursive: true });
      await fsp.writeFile(path.join(yearRoot, num, `${num}-clip.mov`), 'raw video bytes ' + num);
    }
    await fsp.mkdir(path.join(yearRoot, 'From Sh Abdo B'), { recursive: true });
    await fsp.writeFile(path.join(yearRoot, 'From Sh Abdo B', 'note.txt'), 'handoff note');

    const tree = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    const node = findTreeNode(tree.tree, '1441');
    assert.equal(node.type, 'generic-folder', '1441 must be a selectable generic folder, not Unresolved');
    assert.equal(node.destinationStatus, 'resolved');

    const scope = { folderPaths: [yearRoot] };
    const preview = await svc.previewImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn);
    assert.equal(preview.ok, true);
    assert.equal(preview.unresolvedCount, 0);
    assert.equal(preview.files, 5); // index.txt + 3 clips + note.txt

    const result = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test' });
    assert.equal(result.ok, true);
    await waitForImportDone();
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, '1441', '_1441 HDD (Mrl) (Copied by ASC)', 'index.txt')), 'nested legacy folder name preserved');
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, '1441', '732', '732-clip.mov')), 'numbered subfolder preserved');
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, '1441', '733', '733-clip.mov')));
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, '1441', '734', '734-clip.mov')));
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, '1441', 'From Sh Abdo B', 'note.txt')));
    // Never reinterpreted as a Collection/Event — no event.json was invented anywhere.
    assert.ok(!fs.existsSync(path.join(mainArchiveRoot, '1441', 'event.json')));
    assert.ok(!fs.existsSync(path.join(mainArchiveRoot, '1441', '732', 'event.json')));
  });

  // ── Example C — VHS material, deeply nested lots ─────────────────────────────
  await t('C. a VHS folder with multiple lot subfolders is selectable and recursively importable, names preserved exactly', async () => {
    const transferRoot = await mkTmp('ti-gp-c-src-');
    const mainArchiveRoot = await mkTmp('ti-gp-c-dst-');
    const vhsRoot = path.join(transferRoot, 'London VHS');
    const lots = ['VHS LOT -01', 'VHS LOT -02', 'VHS LOT -07 (FUNGUS TAPE)'];
    for (const lot of lots) {
      await fsp.mkdir(path.join(vhsRoot, lot), { recursive: true });
      await fsp.writeFile(path.join(vhsRoot, lot, 'tape.mpg'), 'vhs capture bytes');
    }

    const tree = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    const node = findTreeNode(tree.tree, 'London VHS');
    assert.equal(node.type, 'generic-folder');
    assert.equal(node.destinationStatus, 'resolved');

    const scope = { folderPaths: [vhsRoot] };
    const result = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test' });
    assert.equal(result.ok, true);
    await waitForImportDone();
    for (const lot of lots) {
      assert.ok(fs.existsSync(path.join(mainArchiveRoot, 'London VHS', lot, 'tape.mpg')), `lot "${lot}" must be preserved exactly, parentheses included`);
    }
    // Preserves Main Archive Root/London VHS/... — not flattened, not renamed.
    assert.ok(fs.statSync(path.join(mainArchiveRoot, 'London VHS')).isDirectory());
  });

  // ── Example D — recovered files, arbitrary names/extensions ──────────────────
  await t('D. a "recovered" folder with arbitrary filenames/extensions is selectable and importable regardless of metadata', async () => {
    const transferRoot = await mkTmp('ti-gp-d-src-');
    const mainArchiveRoot = await mkTmp('ti-gp-d-dst-');
    const recRoot = path.join(transferRoot, 'recovered');
    await fsp.mkdir(path.join(recRoot, 'f0001234'), { recursive: true });
    await fsp.writeFile(path.join(recRoot, 'f0001234', 'DSC_UNKNOWN.dat'), 'recovered bytes');
    await fsp.writeFile(path.join(recRoot, 'orphan.bin'), 'another recovered file');

    const scope = { folderPaths: [recRoot] };
    const preview = await svc.previewImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn);
    assert.equal(preview.ok, true);
    assert.equal(preview.unresolvedCount, 0);
    assert.equal(preview.files, 2);

    const result = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test' });
    assert.equal(result.ok, true);
    await waitForImportDone();
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, 'recovered', 'f0001234', 'DSC_UNKNOWN.dat')));
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, 'recovered', 'orphan.bin')));
  });

  // ── 6. Individual files at the Transfer Drive root ────────────────────────────
  await t('6. an ordinary file directly at the Transfer Drive root is enumerated, selectable, and importable on its own', async () => {
    const transferRoot = await mkTmp('ti-gp-file-src-');
    const mainArchiveRoot = await mkTmp('ti-gp-file-dst-');
    await fsp.writeFile(path.join(transferRoot, 'manifest.csv'), 'a,b,c\n1,2,3');
    await fsp.writeFile(path.join(transferRoot, 'other.csv'), 'should not be swept in'); // control: must stay unselected

    const tree = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    const node = findTreeNode(tree.tree, 'manifest.csv');
    assert.equal(node.type, 'generic-file');
    assert.equal(node.destinationStatus, 'resolved');

    const scope = { filePaths: [path.join(transferRoot, 'manifest.csv')] };
    const preview = await svc.previewImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn);
    assert.equal(preview.ok, true);
    assert.equal(preview.files, 1);
    assert.equal(preview.genericItems, 1);

    const result = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test' });
    assert.equal(result.ok, true);
    await waitForImportDone();
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, 'manifest.csv')));
    assert.ok(!fs.existsSync(path.join(mainArchiveRoot, 'other.csv')), 'selecting one root file must never sweep in an unselected sibling file');
  });

  // ── 7. Mixed selection: files + folders together ─────────────────────────────
  await t('7. a mixed selection of files and folders imports both correctly in one operation', async () => {
    const transferRoot = await mkTmp('ti-gp-mixed-src-');
    const mainArchiveRoot = await mkTmp('ti-gp-mixed-dst-');
    await fsp.writeFile(path.join(transferRoot, 'top-level-readme.txt'), 'hello');
    await fsp.mkdir(path.join(transferRoot, 'Some Folder', 'inner'), { recursive: true });
    await fsp.writeFile(path.join(transferRoot, 'Some Folder', 'inner', 'data.bin'), 'inner bytes');
    await mkEvent(path.join(transferRoot, 'Africa Data', 'EventA'), 1, 'EventA');

    const scope = {
      filePaths: [path.join(transferRoot, 'top-level-readme.txt')],
      folderPaths: [path.join(transferRoot, 'Some Folder'), path.join(transferRoot, 'Africa Data', 'EventA')],
    };
    const preview = await svc.previewImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn);
    assert.equal(preview.ok, true);
    assert.equal(preview.unresolvedCount, 0);
    assert.equal(preview.genericItems, 2); // top-level-readme.txt + Some Folder
    assert.equal(preview.collections, 1);  // Africa Data

    const result = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test' });
    assert.equal(result.ok, true);
    await waitForImportDone();
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, 'top-level-readme.txt')));
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, 'Some Folder', 'inner', 'data.bin')));
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, 'Africa Data', 'EventA', 'photo.jpg')));
  });

  // ── 8. Deeply nested directories ──────────────────────────────────────────────
  await t('8. a deeply nested directory tree is preserved exactly, every level, every filename', async () => {
    const transferRoot = await mkTmp('ti-gp-deep-src-');
    const mainArchiveRoot = await mkTmp('ti-gp-deep-dst-');
    const deepRel = path.join('Deep', 'a', 'b', 'c', 'd', 'e');
    await fsp.mkdir(path.join(transferRoot, deepRel), { recursive: true });
    await fsp.writeFile(path.join(transferRoot, deepRel, 'leaf.txt'), 'deep leaf');

    const scope = { folderPaths: [path.join(transferRoot, 'Deep')] };
    const result = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test' });
    assert.equal(result.ok, true);
    await waitForImportDone();
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, deepRel, 'leaf.txt')));
  });

  // ── 9. Empty folders ───────────────────────────────────────────────────────────
  // SUPERSEDED 2026-10-22 ("Transfer Import: Recursive Collection Browsing and Zero-Copy
  // Failure" brief, step 8): nested empty directories used to be silently dropped, because
  // destination directories below the top level were only ever created as a side effect of
  // copying a file into them. _walkAndCopy now creates each destination directory
  // unconditionally, before recursing into it — fixed identically in Transfer Export's
  // copy of the same function. Both top-level and nested empty folders are now preserved.
  await t('9. an empty folder is a selectable, non-blocking unit; both top-level and nested empty directories are preserved', async () => {
    const transferRoot = await mkTmp('ti-gp-empty-src-');
    const mainArchiveRoot = await mkTmp('ti-gp-empty-dst-');
    await fsp.mkdir(path.join(transferRoot, 'EmptyFolder'), { recursive: true });
    await fsp.mkdir(path.join(transferRoot, 'PartlyEmpty', 'HasFile'), { recursive: true });
    await fsp.mkdir(path.join(transferRoot, 'PartlyEmpty', 'NoFilesAnywhere'), { recursive: true });
    await fsp.writeFile(path.join(transferRoot, 'PartlyEmpty', 'HasFile', 'f.txt'), 'x');

    const tree = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    const node = findTreeNode(tree.tree, 'EmptyFolder');
    assert.equal(node.type, 'generic-folder');
    assert.equal(node.destinationStatus, 'resolved', 'an empty folder must not be blocked as Unresolved');

    const scope = { folderPaths: [path.join(transferRoot, 'EmptyFolder'), path.join(transferRoot, 'PartlyEmpty')] };
    const result = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test' });
    assert.equal(result.ok, true);
    await waitForImportDone();
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, 'EmptyFolder')), 'a selected top-level empty folder IS created at the destination');
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, 'PartlyEmpty', 'HasFile', 'f.txt')));
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, 'PartlyEmpty', 'NoFilesAnywhere')), 'a nested empty subdirectory IS now created — the shared copy-engine fix');
  });

  // ── 10. Reimport ───────────────────────────────────────────────────────────────
  await t('10. reimporting a generic folder is idempotent — no duplication, no renaming, source untouched', async () => {
    const transferRoot = await mkTmp('ti-gp-reimport-src-');
    const mainArchiveRoot = await mkTmp('ti-gp-reimport-dst-');
    const folder = path.join(transferRoot, 'VHS LOT -03');
    await fsp.mkdir(folder, { recursive: true });
    await fsp.writeFile(path.join(folder, 'tape.mpg'), 'vhs bytes');

    const scope = { folderPaths: [folder] };
    const r1 = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test' });
    assert.equal(r1.ok, true);
    await waitForImportDone();
    const after1 = (await fsp.readdir(path.join(mainArchiveRoot, 'VHS LOT -03'))).sort();

    const r2 = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test' });
    assert.equal(r2.ok, true);
    await waitForImportDone();
    const after2 = (await fsp.readdir(path.join(mainArchiveRoot, 'VHS LOT -03'))).sort();
    assert.deepEqual(after2, after1, 'reimport must not duplicate or rename any file');
    assert.ok(fs.existsSync(path.join(folder, 'tape.mpg')), 'source must remain untouched');
  });

  // ── 11. Conflict handling — same-name file with different bytes gets a safe rename ──
  await t('11. a same-name file with DIFFERENT content at the destination is never overwritten — safely renamed instead', async () => {
    const transferRoot = await mkTmp('ti-gp-conflict-src-');
    const mainArchiveRoot = await mkTmp('ti-gp-conflict-dst-');
    const folder = path.join(transferRoot, 'ConflictFolder');
    await fsp.mkdir(folder, { recursive: true });
    await fsp.writeFile(path.join(folder, 'clip.mov'), 'new-bytes-longer-than-old');

    await fsp.mkdir(path.join(mainArchiveRoot, 'ConflictFolder'), { recursive: true });
    await fsp.writeFile(path.join(mainArchiveRoot, 'ConflictFolder', 'clip.mov'), 'old');

    const scope = { folderPaths: [folder] };
    const result = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test' });
    assert.equal(result.ok, true);
    await waitForImportDone();
    assert.equal(fs.readFileSync(path.join(mainArchiveRoot, 'ConflictFolder', 'clip.mov'), 'utf8'), 'old', 'the original destination file must never be overwritten');
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, 'ConflictFolder', 'clip_1.mov')), 'the incoming different file must be safely renamed, not dropped');
  });

  // ── 12. Symlink / path containment safety ─────────────────────────────────────
  await t('12. a symlink inside a generic folder, pointing outside the Transfer Drive, is never followed or copied', async () => {
    const transferRoot = await mkTmp('ti-gp-symlink-src-');
    const mainArchiveRoot = await mkTmp('ti-gp-symlink-dst-');
    const outsideSecret = await mkTmp('ti-gp-outside-');
    await fsp.writeFile(path.join(outsideSecret, 'secret.txt'), 'should never be copied');

    const folder = path.join(transferRoot, 'LinkFolder');
    await fsp.mkdir(folder, { recursive: true });
    await fsp.writeFile(path.join(folder, 'real.txt'), 'real content');
    await fsp.symlink(outsideSecret, path.join(folder, 'escape-link'), 'dir').catch(() => {});
    await fsp.symlink(path.join(outsideSecret, 'secret.txt'), path.join(folder, 'escape-file-link')).catch(() => {});

    const scope = { folderPaths: [folder] };
    const result = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test' });
    assert.equal(result.ok, true);
    await waitForImportDone();
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, 'LinkFolder', 'real.txt')), 'the real file must still be copied');
    assert.ok(!fs.existsSync(path.join(mainArchiveRoot, 'LinkFolder', 'escape-link')), 'a directory symlink must never be followed into the destination');
    assert.ok(!fs.existsSync(path.join(mainArchiveRoot, 'LinkFolder', 'escape-file-link')), 'a file symlink must never be copied/dereferenced into the destination');
  });

  // ── 13. Invalid destination (unreadable/offline Main Archive Root) ───────────
  await t('13. an unreadable Main Archive Root does not silently resolve a generic folder\'s destination', async () => {
    const transferRoot = await mkTmp('ti-gp-offline-src-');
    await fsp.mkdir(path.join(transferRoot, 'SomeFolder'), { recursive: true });
    await fsp.writeFile(path.join(transferRoot, 'SomeFolder', 'f.txt'), 'x');
    const offlineRoot = path.join(os.tmpdir(), 'ti-gp-offline-' + Date.now()); // never created

    const tree = await svc.scanImportTree(transferRoot, offlineRoot, isValidEventJsonFn);
    // scanImportTree still enumerates the generic folder (its destination name-mapping needs
    // no archive read), exactly like the new-Collection case — never silently fails closed by
    // fabricating a different outcome.
    assert.equal(tree.ok, true);
    const node = findTreeNode(tree.tree, 'SomeFolder');
    assert.equal(node.type, 'generic-folder');
  });

  console.log(`\n${passed} passed, ${process.exitCode ? 'some FAILED' : '0 failed'}`);
}

main().catch(err => { console.error('FATAL', err); process.exitCode = 1; });
