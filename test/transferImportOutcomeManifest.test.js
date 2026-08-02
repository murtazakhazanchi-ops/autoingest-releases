'use strict';

// Proves the additive per-file outcome manifest (plan §7): every attempted file
// during a real Transfer Import run gets exactly one outcome record, with the
// correct outcome for copied / same-size-skipped files, and that no copy/skip/
// rename decision changed. Real filesystem, isolated tmp dirs, no Electron.
// Run with: node test/transferImportOutcomeManifest.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  console.log('transferImportOutcomeManifest (real filesystem, no Electron)');

  await t('a plain import records copied + same-size-skipped outcomes with correct eventPath scoping', async () => {
    const transferRoot    = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-ti-src-'));
    const mainArchiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-ti-dst-'));

    const eventJson = {
      version: 1, hijriDate: '1448-01-01', sequence: 1, eventName: 'Test Event',
      components: [{ id: 'c1', types: [], city: 'Mumbai', location: null }],
    };
    const srcEventDir = path.join(transferRoot, 'CollectionA', 'EventA');
    await fsp.mkdir(srcEventDir, { recursive: true });
    await fsp.writeFile(path.join(srcEventDir, 'event.json'), JSON.stringify(eventJson), 'utf8');
    await fsp.writeFile(path.join(srcEventDir, 'new-photo.jpg'), 'new-file-bytes');

    // Pre-existing same-size destination file — must be recorded as same-size-skipped.
    const destEventDir = path.join(mainArchiveRoot, 'CollectionA', 'EventA');
    await fsp.mkdir(destEventDir, { recursive: true });
    await fsp.writeFile(path.join(destEventDir, 'already-there.jpg'), 'existing-bytes'); // same length as source below
    await fsp.writeFile(path.join(srcEventDir, 'already-there.jpg'), 'existing-bytes');

    const scope = { folderPaths: [srcEventDir] };
    const result = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test-device' });
    assert.equal(result.ok, true);
    const batchId = result.batchId;

    const status = await waitForImportDone();
    assert.equal(status.copied, 2); // new-photo.jpg + event.json (always included)
    assert.equal(status.skipped, 1);

    const outcomes = await svc.readTransferOutcomes(mainArchiveRoot, batchId);
    assert.equal(outcomes.length, 3);

    const copiedEntry = outcomes.find(o => o.destPath === path.join(destEventDir, 'new-photo.jpg'));
    const skippedEntry = outcomes.find(o => o.destPath === path.join(destEventDir, 'already-there.jpg'));
    assert.ok(copiedEntry, 'copied file must have an outcome entry');
    assert.ok(skippedEntry, 'same-size-skipped file must have an outcome entry');
    assert.equal(copiedEntry.outcome, 'copied');
    assert.equal(skippedEntry.outcome, 'same-size-skipped');
    assert.equal(copiedEntry.eventPath, destEventDir);
    assert.equal(skippedEntry.eventPath, destEventDir);
    assert.equal(copiedEntry.batchId, batchId);

    // No copy/skip decision changed by adding recording.
    assert.ok(fs.existsSync(path.join(destEventDir, 'new-photo.jpg')));
    assert.equal(fs.readFileSync(path.join(destEventDir, 'already-there.jpg'), 'utf8'), 'existing-bytes');
  });

  await t('a checkpoint write failure does not corrupt/cancel already-completed copies, is surfaced via getImportStatus, and is recorded exactly once in the audit trail', async () => {
    const transferRoot    = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-ti-ckpt-src-'));
    const mainArchiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-ti-ckpt-dst-'));

    const eventJson = {
      version: 1, hijriDate: '1448-01-01', sequence: 1, eventName: 'Checkpoint Test',
      components: [{ id: 'c1', types: [], city: 'Mumbai', location: null }],
    };
    const srcEventDir = path.join(transferRoot, 'CollectionB', 'EventB');
    await fsp.mkdir(srcEventDir, { recursive: true });
    await fsp.writeFile(path.join(srcEventDir, 'event.json'), JSON.stringify(eventJson), 'utf8');
    await fsp.writeFile(path.join(srcEventDir, 'photo.jpg'), 'real-file-bytes');

    // Transfer Import requires the destination event folder to already exist
    // (pre-existing app precondition, matching the first test above).
    await fsp.mkdir(path.join(mainArchiveRoot, 'CollectionB', 'EventB'), { recursive: true });

    // Simulate a real filesystem failure for the checkpoint write (not a mock): the
    // checkpoint path is mainArchiveRoot/.autoingest/transfer-imports/import-checkpoint.json,
    // written via a temp-file-then-rename. Pre-create a DIRECTORY exactly where the
    // temp file needs to land, so fsp.writeFile(tmp, ...) genuinely fails (EISDIR) —
    // the same class of error a real disk/permissions problem would produce. The
    // transfer-imports directory itself is real, so unrelated resolution logic
    // (which touches other paths under mainArchiveRoot) is unaffected.
    const _ckptAuditDir = path.join(mainArchiveRoot, '.autoingest', 'transfer-imports');
    await fsp.mkdir(_ckptAuditDir, { recursive: true });
    await fsp.mkdir(path.join(_ckptAuditDir, 'import-checkpoint.json.tmp'), { recursive: true });

    const scope = { folderPaths: [srcEventDir] };
    const result = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test-device' });
    assert.equal(result.ok, true, 'a checkpoint write failure must not prevent the import from running at all');

    const status = await waitForImportDone();

    // The import itself must complete normally — a checkpoint failure must never
    // corrupt or cancel already-in-flight/completed copies.
    assert.equal(status.copied, 2); // photo.jpg + event.json
    assert.ok(fs.existsSync(path.join(mainArchiveRoot, 'CollectionB', 'EventB', 'photo.jpg')));
    assert.equal(
      fs.readFileSync(path.join(mainArchiveRoot, 'CollectionB', 'EventB', 'photo.jpg'), 'utf8'),
      'real-file-bytes',
      'the copied file must be intact, not truncated/corrupted by the unrelated checkpoint failure'
    );

    // Operator-visible: getImportStatus must not falsely claim resumability.
    assert.equal(status.checkpointHealthy, false, 'checkpointHealthy must reflect the real write failure');
    assert.ok(status.checkpointError, 'the underlying filesystem error message must be present, not swallowed');
  });

  await t('a checkpoint write failure is recorded exactly once in imports.audit.jsonl (not once per attempt)', async () => {
    const transferRoot    = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-ti-ckpt2-src-'));
    const mainArchiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-ti-ckpt2-dst-'));

    const eventJson = {
      version: 1, hijriDate: '1448-01-01', sequence: 1, eventName: 'Checkpoint Test 2',
      components: [{ id: 'c1', types: [], city: 'Mumbai', location: null }],
    };
    const srcEventDir = path.join(transferRoot, 'CollectionC', 'EventC');
    await fsp.mkdir(srcEventDir, { recursive: true });
    await fsp.writeFile(path.join(srcEventDir, 'event.json'), JSON.stringify(eventJson), 'utf8');
    await fsp.writeFile(path.join(srcEventDir, 'photo.jpg'), 'real-file-bytes');
    await fsp.mkdir(path.join(mainArchiveRoot, 'CollectionC', 'EventC'), { recursive: true });

    // Block only the checkpoint's own file path specifically (transfer-imports/
    // exists as a real directory so the audit log — a sibling file in that same
    // directory — can still be written), by pre-creating the transfer-imports dir
    // and putting a directory (not a file) exactly where the checkpoint JSON must
    // land, so fsp.writeFile(tmp, ...) for the checkpoint's own .tmp file fails.
    const auditDir = path.join(mainArchiveRoot, '.autoingest', 'transfer-imports');
    await fsp.mkdir(auditDir, { recursive: true });
    await fsp.mkdir(path.join(auditDir, 'import-checkpoint.json.tmp'), { recursive: true });

    const scope = { folderPaths: [srcEventDir] };
    const result = await svc.runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, { deviceName: 'test-device' });
    assert.equal(result.ok, true);
    const status = await waitForImportDone();
    assert.equal(status.checkpointHealthy, false);

    const auditPath = path.join(auditDir, 'imports.audit.jsonl');
    const auditLines = (await fsp.readFile(auditPath, 'utf8')).trim().split('\n').filter(Boolean);
    const checkpointFailureEntries = auditLines.map(l => JSON.parse(l)).filter(e => e.type === 'checkpoint-failure');
    assert.equal(checkpointFailureEntries.length, 1, 'exactly one checkpoint-failure entry must be recorded per run, not once per attempt (no audit-log spam)');
    assert.ok(checkpointFailureEntries[0].error, 'the underlying filesystem error must be captured in the audit entry');
  });

  console.log(`${passed} passed`);
  if (process.exitCode) console.log('SOME TESTS FAILED');
}

main();
