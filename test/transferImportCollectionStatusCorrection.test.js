'use strict';

// Regression coverage for "AutoIngest — Transfer Import Collection Status Correction".
//
// Two real defects, both in services/transferImportService.js:
//
//  1. A destination-existence lookup that threw for ANY reason (ENOENT genuinely missing,
//     but also EACCES/EPERM/other I/O faults on a reachable destination) was collapsed by a
//     bare `try { ... } catch {}` into "doesn't exist" — i.e. "New Collection". A failed
//     lookup is not evidence of absence (a permission-restricted destination subfolder could
//     easily exist and be misreported as brand new). Fixed by distinguishing a clean
//     ENOENT/ENOTDIR ("absent" -> new) from any other stat failure ("unknown" -> unresolved,
//     never silently "new").
//
//  2. After a successful/partial/failed Transfer Import completed, the renderer's scope tree
//     — including each Collection's "New Collection" status — was never re-evaluated against
//     the destination filesystem. A Collection that was new before the run (and is now on
//     disk) kept showing "New Collection" until the modal was closed and reopened. Fixed by
//     reloading the destination-aware tree once the status poll observes the run has
//     finished (renderer/renderer.js's _tiStartPoll). Covered by a live Electron test
//     (test/transferImportCollectionStatusLiveE2E.test.js) — this file covers only the
//     service-layer classification logic, no Electron required.
//
// Real filesystem, isolated tmp dirs, no Electron. Run with:
//   node test/transferImportCollectionStatusCorrection.test.js

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
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

async function main() {
  console.log('transferImportCollectionStatusCorrection (real filesystem, no Electron)');

  // ── 1. Primary workflow (brief §7): A,B exist at destination, C does not ───────
  await t('1. destination comparison matches exactly the operator-specified A/B/C matrix', async () => {
    const transferRoot = await mkTmp('tics-1-src-');
    const mainArchiveRoot = await mkTmp('tics-1-dst-');
    await mkEvent(path.join(transferRoot, 'A', 'Ev1'), 1, 'Ev1');
    await mkEvent(path.join(transferRoot, 'B', 'Ev1'), 1, 'Ev1');
    await mkEvent(path.join(transferRoot, 'C', 'Ev1'), 1, 'Ev1');
    await fsp.mkdir(path.join(mainArchiveRoot, 'A'), { recursive: true });
    await fsp.mkdir(path.join(mainArchiveRoot, 'B'), { recursive: true });

    const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    assert.equal(findTreeNode(result.tree, 'A').isNewCollection, false, 'A must not be New Collection');
    assert.equal(findTreeNode(result.tree, 'B').isNewCollection, false, 'B must not be New Collection');
    assert.equal(findTreeNode(result.tree, 'C').isNewCollection, true,  'C must be New Collection');
  });

  // ── 2. Existing Collection with additional Events must stay "not new" ──────────
  await t('2. an existing Collection with NEW Events inside is still not New Collection, and those Events are selectable', async () => {
    const transferRoot = await mkTmp('tics-2-src-');
    const mainArchiveRoot = await mkTmp('tics-2-dst-');
    await mkEvent(path.join(transferRoot, 'A', 'Ev1'), 1, 'Ev1');
    await mkEvent(path.join(transferRoot, 'A', 'Ev2-new'), 2, 'Ev2-new'); // not yet at destination
    await mkEvent(path.join(mainArchiveRoot, 'A', 'Ev1'), 1, 'Ev1'); // destination already has Ev1

    const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    const node = findTreeNode(result.tree, 'A');
    assert.equal(node.isNewCollection, false, 'existing Collection with new Events must not read as New Collection');
    assert.equal(node.events.length, 2);
    for (const ev of node.events) {
      assert.equal(ev.destinationStatus, 'resolved', `${ev.name} must remain selectable`);
      assert.equal(ev.destinationReason, null, `${ev.name} must not be flagged new-collection — the Collection itself already exists`);
    }

    // Scan for New Data must still detect the one genuinely new Event's files.
    const scan = await svc.scanImportSync(transferRoot, mainArchiveRoot, { folderPaths: [path.join(transferRoot, 'A')] }, isValidEventJsonFn);
    assert.equal(scan.ok, true);
    assert.ok(scan.totals.newFiles >= 2, 'the new Event\'s files (event.json + photo.jpg) must be detected as new');
  });

  // ── 3. The actual resolver used by Preview/Scan/Import agrees with the tree ────
  await t('3. _resolveImportUnits (Preview/Scan/Import path) classifies new vs. existing the same way as the tree', async () => {
    const transferRoot = await mkTmp('tics-3-src-');
    const mainArchiveRoot = await mkTmp('tics-3-dst-');
    await mkEvent(path.join(transferRoot, 'A', 'Ev1'), 1, 'Ev1');
    await mkEvent(path.join(transferRoot, 'C', 'Ev1'), 1, 'Ev1');
    await fsp.mkdir(path.join(mainArchiveRoot, 'A'), { recursive: true });

    const preview = await svc.previewImport(transferRoot, mainArchiveRoot, {
      folderPaths: [path.join(transferRoot, 'A'), path.join(transferRoot, 'C')],
    }, isValidEventJsonFn);
    assert.equal(preview.ok, true);
    assert.equal(preview.unresolvedCount, 0, 'both A and C must be resolved, not blocked');
  });

  // ── 4. A failed destination lookup must never be reported as "New Collection" ──
  // (A permission-restricted destination subfolder, not a genuinely missing one — the real
  // defect this task fixes. chmod is applied AFTER mkdir, never via mkdir({mode}), since a
  // recursive mkdir with `mode` would also restrict its own not-yet-created ancestors.)
  await t('4. a destination lookup that fails for a reason OTHER than "not found" is unresolved, never falsely "new" or "existing"', async () => {
    const transferRoot = await mkTmp('tics-4-src-');
    const mainArchiveRoot = await mkTmp('tics-4-dst-');
    await mkEvent(path.join(transferRoot, 'Blocked', 'Ev1'), 1, 'Ev1');

    // "Blocked" genuinely exists at the destination, but its PARENT is unreadable (0o000),
    // so stat() on mainArchiveRoot/Blocked fails with EACCES, not ENOENT.
    await fsp.mkdir(path.join(mainArchiveRoot, 'Blocked'), { recursive: true });
    await fsp.chmod(mainArchiveRoot, 0o000);

    try {
      const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
      const node = findTreeNode(result.tree, 'Blocked');
      assert.equal(node.isNewCollection, false, 'an uncertain lookup must never be reported as New Collection');
      assert.equal(node.events[0].destinationStatus, 'unresolved', 'an uncertain lookup must be unresolved, not silently resolved either way');
      assert.equal(node.events[0].destinationReason, 'destination-lookup-failed');

      // The real resolver used by Preview/Scan/Import must agree — never silently importing
      // into (or past) a destination it could not actually verify.
      const preview = await svc.previewImport(transferRoot, mainArchiveRoot, {
        folderPaths: [path.join(transferRoot, 'Blocked')],
      }, isValidEventJsonFn);
      assert.equal(preview.ok, true);
      assert.equal(preview.unresolvedCount, 1, 'must be blocked from import, not guessed');
    } finally {
      await fsp.chmod(mainArchiveRoot, 0o755); // restore so the OS can clean up the tmp dir
    }
  });

  // ── 5. Generic (non-Collection) folders never receive any Collection label ──────
  await t('5. a generic folder with no Event anywhere inside gets no Collection status at all', async () => {
    const transferRoot = await mkTmp('tics-5-src-');
    const mainArchiveRoot = await mkTmp('tics-5-dst-');
    await fsp.mkdir(path.join(transferRoot, 'Legacy VHS'), { recursive: true });
    await fsp.writeFile(path.join(transferRoot, 'Legacy VHS', 'tape1.mov'), 'x');

    const result = await svc.scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn);
    const node = findTreeNode(result.tree, 'Legacy VHS');
    assert.equal(node.type, 'generic-folder');
    assert.equal(node.isNewCollection, undefined, 'generic folders must never carry an isNewCollection flag');
  });

  console.log(`\n${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}`);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
