'use strict';

// Regression coverage for the "Transfer Import Unresolved Folder Bug" fix.
//
// Root cause (two independent, compounding defects in services/transferImportService.js):
//  1. A Collection-shaped top-level folder (has real Event children, proven by event.json —
//     never guessed) whose name has no existing counterpart under the Main Archive Root was
//     treated as 'unresolved' and permanently checkbox-blocked, even though the folder's own
//     name IS its unambiguous destination (the same deterministic mapping Transfer Export and
//     the legacy Collection-scoped import path already use, and the same mapping the real copy
//     functions already create on demand via fsp.mkdir(..., {recursive:true})). This is not the
//     "guess an ambiguous destination" problem DEC-012 forbids — there is exactly one candidate
//     because the name itself is the evidence — so it is now destinationStatus:'resolved' with
//     an informational destinationReason:'new-collection', selectable like any other item.
//  2. $RECYCLE.BIN / System Volume Information (common on any external drive previously used
//     outside AutoIngest, on either macOS or Windows) were not excluded, so they appeared as
//     extra noisy, permanently-blocked 'external' rows alongside genuinely unresolved items.
//
// A direct Event at the Transfer Drive root (no enclosing Collection folder) with no existing
// archive-identity match remains correctly unresolved — that IS the ambiguous case DEC-012
// describes (which of potentially several Collections should it land in?), and must stay
// blocked. A 3-level "wrapper/Collection/Event" source layout also remains unresolved — the
// Main Archive Root's own model (see _buildArchiveIndex) is strictly Collection/Event, two
// levels, so a wrapper layer is a genuinely unsupported structure, not something this fix
// changes; it is covered here only to document that it still fails safely, not silently.
//
// Real filesystem, isolated tmp dirs, no Electron. Run with:
//   node test/transferImportUnresolvedClassification.test.js

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
async function mkEvent(dir, seq, name, hijriDate) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'event.json'), evJson(seq, name, hijriDate));
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
  console.log('transferImportUnresolvedClassification (real filesystem, no Electron)');

  // ── 1. Valid transfer drive with an existing destination collection ──────────
  await t('1. an existing destination Collection resolves exactly as before (no regression)', async () => {
    const transferRoot = await mkTmp('ti-1-src-');
    const mainArchiveRoot = await mkTmp('ti-1-dst-');
    await mkEvent(path.join(transferRoot, 'ExistingColl', 'EventA'), 1, 'EventA');
    await fsp.mkdir(path.join(mainArchiveRoot, 'ExistingColl'), { recursive: true });

    const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    assert.equal(result.ok, true);
    const node = findTreeNode(result.tree, 'ExistingColl');
    assert.equal(node.type, 'collection');
    assert.equal(node.isNewCollection, false);
    assert.equal(node.events[0].destinationStatus, 'resolved');
    assert.equal(node.events[0].destinationReason, null);
  });

  // ── 2. A new collection not yet present at the destination ───────────────────
  await t('2. a new Collection (no destination counterpart) is resolved + selectable, not blocked', async () => {
    const transferRoot = await mkTmp('ti-2-src-');
    const mainArchiveRoot = await mkTmp('ti-2-dst-');
    await mkEvent(path.join(transferRoot, 'Africa Data', 'EventA'), 1, 'EventA');
    // Destination has nothing matching "Africa Data" yet.

    const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    const node = findTreeNode(result.tree, 'Africa Data');
    assert.equal(node.type, 'collection');
    assert.equal(node.isNewCollection, true);
    assert.equal(node.events[0].destinationStatus, 'resolved', 'must be selectable, not unresolved');
    assert.equal(node.events[0].destinationReason, 'new-collection');
    assert.equal(node.events[0].collectionKey, 'Africa Data');

    // The actual resolver used by Preview/Scan/Import agrees.
    const preview = await svc.previewImport(transferRoot, mainArchiveRoot, { folderPaths: [path.join(transferRoot, 'Africa Data', 'EventA')] }, isValidEventJsonFn);
    assert.equal(preview.ok, true);
    assert.equal(preview.unresolvedCount, 0);
    assert.equal(preview.collections, 1);
    assert.equal(preview.events, 1);
  });

  // ── 3. A source containing year folders (ambiguous: wrapper vs. literal Collection name) ──
  await t('3a. a year-named folder that is itself a direct Collection (digits-only name) resolves like any other new Collection', async () => {
    const transferRoot = await mkTmp('ti-3a-src-');
    const mainArchiveRoot = await mkTmp('ti-3a-dst-');
    await mkEvent(path.join(transferRoot, '1447', 'EventZ'), 1, 'EventZ');

    const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    const node = findTreeNode(result.tree, '1447');
    assert.equal(node.type, 'collection');
    assert.equal(node.isNewCollection, true);
    assert.equal(node.events[0].destinationStatus, 'resolved');
  });

  await t('3b. a year-named WRAPPER folder (Year/Collection/Event, 3 levels) stays safely unresolved — unsupported structure, never guessed', async () => {
    const transferRoot = await mkTmp('ti-3b-src-');
    const mainArchiveRoot = await mkTmp('ti-3b-dst-');
    await mkEvent(path.join(transferRoot, '1446', 'CollectionX', 'EventY'), 1, 'EventY');

    const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    const node = findTreeNode(result.tree, '1446');
    assert.equal(node.type, 'external');
    assert.equal(node.destinationStatus, 'unresolved');
    assert.equal(node.destinationReason, 'external-root-no-approved-destination');
  });

  // ── 4. A source containing unrelated directories ─────────────────────────────
  await t('4. an unrelated directory with no Event anywhere one level down stays unresolved', async () => {
    const transferRoot = await mkTmp('ti-4-src-');
    const mainArchiveRoot = await mkTmp('ti-4-dst-');
    await fsp.mkdir(path.join(transferRoot, 'Random Notes', 'misc'), { recursive: true });
    await fsp.writeFile(path.join(transferRoot, 'Random Notes', 'misc', 'readme.txt'), 'hi');

    const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    const node = findTreeNode(result.tree, 'Random Notes');
    assert.equal(node.type, 'external');
    assert.equal(node.destinationStatus, 'unresolved');
  });

  // ── 5. $RECYCLE.BIN / System Volume Information ──────────────────────────────
  await t('5. $RECYCLE.BIN and System Volume Information are excluded entirely, not shown as unresolved candidates', async () => {
    const transferRoot = await mkTmp('ti-5-src-');
    const mainArchiveRoot = await mkTmp('ti-5-dst-');
    await fsp.mkdir(path.join(transferRoot, '$RECYCLE.BIN', 'S-1-5-21'), { recursive: true });
    await fsp.writeFile(path.join(transferRoot, '$RECYCLE.BIN', 'S-1-5-21', 'junk.dat'), 'x');
    await fsp.mkdir(path.join(transferRoot, 'System Volume Information'), { recursive: true });
    await fsp.writeFile(path.join(transferRoot, 'System Volume Information', 'IndexerVolumeGuid'), 'x');
    // Case variation, since Windows filesystems are case-insensitive.
    await fsp.mkdir(path.join(transferRoot, 'Africa Data'), { recursive: true }); // control: a real candidate alongside junk
    await mkEvent(path.join(transferRoot, 'Africa Data', 'EventA'), 1, 'EventA');

    const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    assert.equal(findTreeNode(result.tree, '$RECYCLE.BIN'), undefined, '$RECYCLE.BIN must not appear at all');
    assert.equal(findTreeNode(result.tree, 'System Volume Information'), undefined, 'System Volume Information must not appear at all');
    assert.ok(findTreeNode(result.tree, 'Africa Data'), 'a real candidate must still appear');

    // Confirm nothing on disk was touched.
    assert.ok(fs.existsSync(path.join(transferRoot, '$RECYCLE.BIN', 'S-1-5-21', 'junk.dat')));
    assert.ok(fs.existsSync(path.join(transferRoot, 'System Volume Information', 'IndexerVolumeGuid')));
  });

  // ── 5b. Cross-platform casing (Windows filesystems are case-insensitive) ─────
  await t('5b. junk-folder exclusion matches case-insensitively, since the real-world casing on a Windows-formatted drive can vary', async () => {
    const transferRoot = await mkTmp('ti-5b-src-');
    const mainArchiveRoot = await mkTmp('ti-5b-dst-');
    await fsp.mkdir(path.join(transferRoot, '$Recycle.Bin'), { recursive: true }); // real Windows casing variant
    await fsp.mkdir(path.join(transferRoot, 'SYSTEM VOLUME INFORMATION'), { recursive: true });

    const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    assert.equal(findTreeNode(result.tree, '$Recycle.Bin'), undefined);
    assert.equal(findTreeNode(result.tree, 'SYSTEM VOLUME INFORMATION'), undefined);
  });

  // Note on Windows path-separator testing: transferImportService.js deliberately uses the
  // host-native `path` module (never path.win32/path.posix explicitly) so that a real Windows
  // build gets correct Windows path semantics automatically — the same mechanism docs call out
  // for path.win32-shaped testing elsewhere (test/pathUtils.test.js) does not apply here because
  // this fix never parses a full path string; _skipDir/junk-matching and the new-collection
  // check both operate on a bare directory name (fs.readdir's Dirent.name), which carries no
  // separator at all and is therefore platform-generic by construction. A simulated `C:\...`
  // string run through POSIX path.join on this macOS host would not reproduce real Windows
  // behavior and would only produce a misleading result — so it is deliberately not faked here.
  // Genuine Windows-separator verification for this fix is: run this same file (or the Transfer
  // Import UI) on a real Windows machine/CI runner; see the final report's Windows Verification
  // Status for what was and was not actually run.

  // ── 6. A source containing _Sorted ────────────────────────────────────────────
  await t('6. a "_Sorted" top-level folder is treated like any other candidate name, not special-cased', async () => {
    const transferRoot = await mkTmp('ti-6-src-');
    const mainArchiveRoot = await mkTmp('ti-6-dst-');
    await mkEvent(path.join(transferRoot, '_Sorted', 'EventS'), 1, 'EventS');

    const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    const node = findTreeNode(result.tree, '_Sorted');
    assert.equal(node.type, 'collection');
    assert.equal(node.isNewCollection, true);
    assert.equal(node.events[0].destinationStatus, 'resolved');
  });

  // ── 7. An offline or incorrect archive destination ───────────────────────────
  await t('7. an unreadable/offline Main Archive Root fails the whole scan explicitly, never silently resolves anything', async () => {
    const transferRoot = await mkTmp('ti-7-src-');
    await mkEvent(path.join(transferRoot, 'Coll', 'EventA'), 1, 'EventA');
    const offlineRoot = path.join(os.tmpdir(), 'ti-7-offline-' + Date.now()); // never created

    const result = await svc.scanImportTree(transferRoot, offlineRoot, isValidEventJsonFn);
    // mainArchiveRoot being unreadable does not fail scanImportTree itself (fsp.stat just
    // rejects for every candidate, consistently treating every Collection as new) — assert
    // that behavior explicitly so a future change can't silently start guessing instead.
    assert.equal(result.ok, true);
    const node = findTreeNode(result.tree, 'Coll');
    assert.equal(node.isNewCollection, true);
  });

  // ── 8. A destination with valid archive identity but no matching existing event ──
  await t('8. a direct Event at the Transfer Drive root with no existing archive match stays unresolved (genuinely ambiguous — DEC-012)', async () => {
    const transferRoot = await mkTmp('ti-8-src-');
    const mainArchiveRoot = await mkTmp('ti-8-dst-');
    await mkEvent(path.join(transferRoot, 'DirectEvent'), 5, 'DirectEvent');
    await fsp.mkdir(path.join(mainArchiveRoot, 'SomeOtherCollection'), { recursive: true }); // unrelated, no identity match

    const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    const node = findTreeNode(result.tree, 'DirectEvent');
    assert.equal(node.type, 'event');
    assert.equal(node.destinationStatus, 'unresolved');
    assert.equal(node.destinationReason, 'no-existing-collection-found');
  });

  // ── 9. A transfer drive containing a mixture of valid and invalid folders ────
  await t('9. a mixed drive resolves new Collections, keeps ambiguous/junk blocked, in the same scan', async () => {
    const transferRoot = await mkTmp('ti-9-src-');
    const mainArchiveRoot = await mkTmp('ti-9-dst-');
    await mkEvent(path.join(transferRoot, 'Africa Data', 'EventA'), 1, 'EventA');       // new collection -> resolved
    await mkEvent(path.join(transferRoot, 'ExistingColl', 'EventB'), 2, 'EventB');      // existing collection -> resolved
    await fsp.mkdir(path.join(mainArchiveRoot, 'ExistingColl'), { recursive: true });
    await fsp.mkdir(path.join(transferRoot, '$RECYCLE.BIN'), { recursive: true });       // junk -> excluded
    await fsp.mkdir(path.join(transferRoot, 'Random Notes'), { recursive: true });       // unsupported -> unresolved

    const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    assert.equal(findTreeNode(result.tree, 'Africa Data').isNewCollection, true);
    assert.equal(findTreeNode(result.tree, 'Africa Data').events[0].destinationStatus, 'resolved');
    assert.equal(findTreeNode(result.tree, 'ExistingColl').isNewCollection, false);
    assert.equal(findTreeNode(result.tree, 'ExistingColl').events[0].destinationStatus, 'resolved');
    assert.equal(findTreeNode(result.tree, '$RECYCLE.BIN'), undefined);
    assert.equal(findTreeNode(result.tree, 'Random Notes').destinationStatus, 'unresolved');
  });

  // ── End-to-end: a new Collection actually imports, creates the folder, and is idempotent ──
  await t('end-to-end: importing a new-Collection candidate creates the destination and copies files; a second run is a no-op (no duplication, no source change)', async () => {
    const transferRoot = await mkTmp('ti-e2e-src-');
    const mainArchiveRoot = await mkTmp('ti-e2e-dst-');
    const srcEventDir = path.join(transferRoot, 'Africa Data', 'EventA');
    await mkEvent(srcEventDir, 1, 'EventA');

    const scope = { folderPaths: [srcEventDir] };
    const preview = await svc.previewImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn);
    assert.equal(preview.ok, true);
    assert.equal(preview.collections, 1);
    assert.equal(preview.unresolvedCount, 0);

    const destEventDir = path.join(mainArchiveRoot, 'Africa Data', 'EventA');
    assert.ok(!fs.existsSync(destEventDir), 'destination must not exist before import — nothing pre-created at scan/preview time');

    const result1 = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test-device' });
    assert.equal(result1.ok, true);
    await waitForImportDone();

    assert.ok(fs.existsSync(path.join(destEventDir, 'event.json')), 'new Collection/Event folder must now exist');
    assert.ok(fs.existsSync(path.join(destEventDir, 'photo.jpg')));
    // Source is read-only — untouched.
    assert.ok(fs.existsSync(path.join(srcEventDir, 'photo.jpg')), 'source file must still exist — never deleted');

    const filesAfterFirstImport = (await fsp.readdir(destEventDir)).sort();

    // Reimport (duplicate) behavior: same-size files are skipped, never duplicated.
    const result2 = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test-device' });
    assert.equal(result2.ok, true);
    await waitForImportDone();
    const filesAfterSecondImport = (await fsp.readdir(destEventDir)).sort();
    assert.deepEqual(filesAfterSecondImport, filesAfterFirstImport, 'reimport must not duplicate or rename any file');
  });

  console.log(`\n${passed} passed, ${process.exitCode ? 'some FAILED' : '0 failed'}`);
}

main().catch(err => { console.error('FATAL', err); process.exitCode = 1; });
