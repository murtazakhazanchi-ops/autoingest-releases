'use strict';

// Regression for the shared _walkAndCopy empty-directory fix, on the Transfer EXPORT side
// ("Transfer Import: Recursive Collection Browsing and Zero-Copy Failure" brief, step 8 —
// "include the fix with dedicated Import and Export regressions"). Export's own copy of
// _walkAndCopy had the identical limitation and received the identical fix: a destination
// directory is now created unconditionally, before recursing into it, not only as a side
// effect of copying a file into it.
//
// Real filesystem, isolated tmp dirs, no Electron. Run with:
//   node test/transferExportEmptyDirectoryRegression.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const svc = require('../services/transferExportService');

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

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

async function waitForExportDone(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = svc.getExportStatus();
    if (!status.running) return status;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('transfer export did not finish in time');
}

async function main() {
  console.log('transferExportEmptyDirectoryRegression (real filesystem, no Electron)');

  await t('a nested empty subdirectory inside an exported Event folder is preserved at the destination', async () => {
    const nasRoot      = await mkTmp('ai-txexp-empty-nas-');
    const transferRoot = await mkTmp('ai-txexp-empty-tx-');

    const eventDir = path.join(nasRoot, 'CollectionA', 'EventA');
    await fsp.mkdir(path.join(eventDir, 'HasFile'), { recursive: true });
    await fsp.mkdir(path.join(eventDir, 'NoFilesAnywhere', 'DeeperEmpty'), { recursive: true });
    await fsp.writeFile(path.join(eventDir, 'HasFile', 'photo.jpg'), 'bytes');
    await fsp.writeFile(path.join(eventDir, 'event.json'), JSON.stringify({
      version: 1, hijriDate: '1446-01-01', sequence: 1, eventName: 'EventA',
      components: [{ types: ['Majlis'], city: 'TestCity', location: null }],
    }));

    const scope = { folderPaths: [eventDir] };
    const result = await svc.runExport(nasRoot, transferRoot, scope, { deviceName: 'test' });
    assert.equal(result.ok, true, JSON.stringify(result));
    await waitForExportDone();

    const destEventDir = path.join(transferRoot, 'CollectionA', 'EventA');
    assert.ok(fs.existsSync(path.join(destEventDir, 'HasFile', 'photo.jpg')), 'the real file must still be exported');
    assert.ok(fs.existsSync(path.join(destEventDir, 'NoFilesAnywhere')), 'a nested empty subdirectory must now be preserved');
    assert.ok(fs.existsSync(path.join(destEventDir, 'NoFilesAnywhere', 'DeeperEmpty')), 'an empty subdirectory nested two levels deep (no files anywhere below it) must also be preserved');
  });

  console.log(`\n${passed} passed, ${process.exitCode ? 'some FAILED' : '0 failed'}`);
}

main().catch(err => { console.error('FATAL', err); process.exitCode = 1; });
