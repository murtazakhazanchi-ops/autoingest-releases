'use strict';

// "AutoIngest — RC.4 Operator Bug Fixes" — Part B/C regression coverage: ascending
// chronological (oldest-first) display order for Import and QMZ, using a deterministic
// synthetic fixture whose capture timestamps are intentionally out of filename order
// (exactly the brief's own example table), plus direct comparator-level edge-case
// coverage (equal timestamps, missing timestamps, invalid timestamps) against the REAL
// production `sortGroup`/`_qmzSortGroup`/`_validTimeOrEpoch` functions — never a mocked
// pre-sorted array.
//
// Visible order is read from the DOM (file-tile order), not from internal arrays.
//
// Run: node test/qmzChronologicalSortFixture.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[qmz-chrono-sort]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

// Writes a file then stamps BOTH atime/mtime to an explicit Date — this is the file's real,
// readable filesystem timestamp (what `main/fileBrowser.js`/`main/qmzService.js` actually
// stat() and report as modifiedAt/capturedAt), not a mocked value injected into the app.
async function writeWithMtime(p, content, date) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content);
  await fsp.utimes(p, date, date);
}

(async () => {
  const userDataDir = await mkTmp('ai-chrono-userdata-');
  const archiveRoot = await mkTmp('ai-chrono-archive-');
  const srcRoot = await mkTmp('ai-chrono-src-');
  const qmzRoot = await mkTmp('ai-chrono-qmz-root-');
  log('userDataDir =', userDataDir, 'archiveRoot =', archiveRoot, 'srcRoot =', srcRoot, 'qmzRoot =', qmzRoot);

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Chrono Sort Test');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Chrono Sort Test');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }
  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });

  const ev = (fn, arg) => window.evaluate(fn, arg);

  // ═══════════════ Part 1: direct comparator edge-case coverage ═══════════════
  // Calls the REAL production sortGroup/_qmzSortGroup/_validTimeOrEpoch with synthetic
  // objects, never a pre-sorted array — exercising the actual comparator's edge-case
  // handling in isolation from file-system/EXIF timing variance.
  log('=== Comparator edge cases (real sortGroup/_qmzSortGroup functions) ===');

  const epochCases = await ev(() => ({
    valid:   _validTimeOrEpoch('2026-01-02T03:04:05.000Z'),
    missing: _validTimeOrEpoch(null),
    empty:   _validTimeOrEpoch(''),
    invalid: _validTimeOrEpoch('not-a-real-date'),
  }));
  check(epochCases.valid === new Date('2026-01-02T03:04:05.000Z').getTime(), `1. _validTimeOrEpoch resolves a real ISO date correctly (got ${epochCases.valid})`);
  check(epochCases.missing === 0, `2. _validTimeOrEpoch falls back to epoch (0) for a missing date (got ${epochCases.missing})`);
  check(epochCases.empty === 0, `3. _validTimeOrEpoch falls back to epoch (0) for an empty string (got ${epochCases.empty})`);
  check(epochCases.invalid === 0, `4. _validTimeOrEpoch falls back to epoch (0) for a malformed date string — never NaN (got ${epochCases.invalid})`);

  const importSortResult = await ev(() => {
    const prevKey = sortKey, prevDir = sortDir;
    sortKey = 'date'; sortDir = 'asc';
    const files = [
      { name: 'EqualB.jpg', modifiedAt: '2026-01-01T10:00:00.000Z' },
      { name: 'EqualA.jpg', modifiedAt: '2026-01-01T10:00:00.000Z' }, // exact tie with EqualB — name must break it
      { name: 'Missing.jpg', modifiedAt: null },                      // no timestamp at all
      { name: 'Invalid.jpg', modifiedAt: 'garbage-not-a-date' },      // malformed timestamp
      { name: 'Newest.jpg', modifiedAt: '2026-02-01T00:00:00.000Z' },
      { name: 'Oldest.jpg', modifiedAt: '2025-12-01T00:00:00.000Z' },
    ];
    const order = sortGroup(files).map(f => f.name);
    sortKey = prevKey; sortDir = prevDir; // restore app state exactly as found
    return order;
  });
  log('[debug] import sortGroup edge-case order:', JSON.stringify(importSortResult));
  // Oldest.jpg (2025-12) sorts first; Missing.jpg/Invalid.jpg both fall back to epoch 0,
  // so they sort before everything with a real date, ordered between themselves by name
  // (Invalid < Missing alphabetically); EqualA/EqualB tie at the same real timestamp, so
  // name breaks the tie (EqualA < EqualB); Newest.jpg (2026-02) sorts last.
  const expectedImportOrder = ['Invalid.jpg', 'Missing.jpg', 'Oldest.jpg', 'EqualA.jpg', 'EqualB.jpg', 'Newest.jpg'];
  check(JSON.stringify(importSortResult) === JSON.stringify(expectedImportOrder),
    `5. sortGroup (Import) handles missing/invalid/tied timestamps deterministically — got ${JSON.stringify(importSortResult)}, expected ${JSON.stringify(expectedImportOrder)}`);

  const qmzSortResult = await ev(() => {
    const prevKey = _qmzSortKey, prevDir = _qmzSortDir;
    _qmzSortKey = 'date'; _qmzSortDir = 'asc';
    const files = [
      { name: 'EqualB.cr2', capturedAt: '2026-01-01T10:00:00.000Z' },
      { name: 'EqualA.cr2', capturedAt: '2026-01-01T10:00:00.000Z' },
      { name: 'Missing.cr2', capturedAt: null },
      { name: 'Invalid.cr2', capturedAt: 'garbage-not-a-date' },
      { name: 'Newest.cr2', capturedAt: '2026-02-01T00:00:00.000Z' },
      { name: 'Oldest.cr2', capturedAt: '2025-12-01T00:00:00.000Z' },
    ];
    const order = _qmzSortGroup(files).map(f => f.name);
    _qmzSortKey = prevKey; _qmzSortDir = prevDir;
    return order;
  });
  const expectedQmzOrder = ['Invalid.cr2', 'Missing.cr2', 'Oldest.cr2', 'EqualA.cr2', 'EqualB.cr2', 'Newest.cr2'];
  check(JSON.stringify(qmzSortResult) === JSON.stringify(expectedQmzOrder),
    `6. _qmzSortGroup (QMZ) handles missing/invalid/tied timestamps identically — got ${JSON.stringify(qmzSortResult)}, expected ${JSON.stringify(expectedQmzOrder)}`);

  // ═══════════════ Part 2: Import workspace — real files, real mtimes ═══════════════
  log('=== Import workspace: real files, out-of-filename-order mtimes ===');

  const collName = 'CollChrono';
  const evDir = path.join(archiveRoot, collName, '1448-05-01 _01-Chrono-Event');
  await ev(({ dir, data }) => window.api.writeEventJson(dir, data), {
    dir: evDir,
    data: { version: 1, hijriDate: '1448-05-01', sequence: 1, eventName: 'Chrono-Event', components: [
      { id: 1, folderName: 'Jashn-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Jashn'], additionalKeywords: [] },
    ] },
  });
  await ev(async ({ collPath, collName, folder }) => {
    await window.api.setLastEvent({ collectionPath: collPath, collectionName: collName, eventName: folder, safeEventName: folder });
    await EventCreator.restoreLastEvent();
  }, { collPath: path.join(archiveRoot, collName), collName, folder: path.basename(evDir) });
  await window.waitForTimeout(400);

  // Exactly the brief's own example table — intentionally out of filename order.
  const base = new Date('2026-03-15T00:00:00.000Z');
  const fixture = [
    { name: 'IMG_9001.JPG', hhmmss: [10, 45, 32] },
    { name: 'IMG_1002.JPG', hhmmss: [9, 15, 10] },
    { name: 'IMG_5003.JPG', hhmmss: [10, 30, 18] },
    { name: 'IMG_3004.JPG', hhmmss: [9, 42, 25] },
  ];
  const expectedChronoOrder = ['IMG_1002.JPG', 'IMG_3004.JPG', 'IMG_5003.JPG', 'IMG_9001.JPG'];

  const srcDir = path.join(srcRoot, 'card');
  for (const f of fixture) {
    const [h, m, s] = f.hhmmss;
    const d = new Date(base);
    d.setUTCHours(h, m, s, 0);
    await writeWithMtime(path.join(srcDir, f.name), `fake-bytes-${f.name}`, d);
  }

  await ev((p) => selectSource({ type: 'local-folder', path: p, label: 'CHRONO_SRC' }), srcDir);
  await window.waitForFunction(() => document.getElementById('workspace').classList.contains('visible'), null, { timeout: 15000 });
  await ev((p) => browseFolderDirect(p), srcDir);
  await window.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, fixture.length, { timeout: 20000 });

  async function visibleOrder(selector) {
    return window.evaluate((sel) => [...document.querySelectorAll(sel)].map(el => (el.dataset.path || '').split(/[/\\]/).pop()), selector);
  }
  const importOrder1 = await visibleOrder('#fileGrid .file-tile[data-path]');
  check(JSON.stringify(importOrder1) === JSON.stringify(expectedChronoOrder),
    `7. Import workspace displays real out-of-filename-order files in ascending chronological order — got ${JSON.stringify(importOrder1)}`);

  // Refresh preserves order (re-browse the same folder).
  await ev((p) => browseFolderDirect(p), srcDir);
  await window.waitForTimeout(500);
  const importOrder2 = await visibleOrder('#fileGrid .file-tile[data-path]');
  check(JSON.stringify(importOrder2) === JSON.stringify(expectedChronoOrder),
    `8. order is preserved after a refresh (re-browse) — got ${JSON.stringify(importOrder2)}`);

  // List view preserves the same chronological order. #gridListSwitch is a visually-hidden
  // styled-toggle checkbox (Playwright's actionability check won't click it) — toggle it
  // the same way its own real browser 'change' handler expects.
  await window.evaluate(() => {
    const el = document.getElementById('gridListSwitch');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await window.waitForTimeout(300);
  const listRows = await window.evaluate(() => [...document.querySelectorAll('#fileGrid .list-table tbody tr[data-path]')].map(el => (el.dataset.path || '').split(/[/\\]/).pop()));
  check(JSON.stringify(listRows) === JSON.stringify(expectedChronoOrder), `9. List view shows the same ascending chronological order — got ${JSON.stringify(listRows)}`);
  await window.evaluate(() => {
    const el = document.getElementById('gridListSwitch');
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await window.waitForTimeout(200);

  // ═══════════════ Part 3: equal timestamps — real files, same real mtime ═══════════════
  log('=== Equal real timestamps: deterministic tie-break ===');
  const tieDir = path.join(srcRoot, 'tiecard');
  const tieTime = new Date('2026-03-16T12:00:00.000Z');
  await writeWithMtime(path.join(tieDir, 'Zeta.jpg'), 'z', tieTime);
  await writeWithMtime(path.join(tieDir, 'Alpha.jpg'), 'a', tieTime);
  await ev((p) => selectSource({ type: 'local-folder', path: p, label: 'TIE_SRC' }), tieDir);
  await window.waitForTimeout(300);
  await ev((p) => browseFolderDirect(p), tieDir);
  await window.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, 2, { timeout: 20000 });
  const tieOrder = await visibleOrder('#fileGrid .file-tile[data-path]');
  check(JSON.stringify(tieOrder) === JSON.stringify(['Alpha.jpg', 'Zeta.jpg']),
    `10. two files with an identical real mtime break the tie deterministically by name — got ${JSON.stringify(tieOrder)}`);

  // ═══════════════ Part 4: QMZ workspace — real files in _Unsequenced ═══════════════
  log('=== QMZ workspace: real files, out-of-filename-order mtimes ===');
  const pg = 'Jane Doe';
  for (const f of fixture) {
    const [h, m, s] = f.hhmmss;
    const d = new Date(base);
    d.setUTCHours(h, m, s, 0);
    await writeWithMtime(path.join(qmzRoot, '_Unsequenced', pg, f.name.replace('.JPG', '.CR2')), `fake-bytes-${f.name}`, d);
  }
  await ev((r) => window.openQMZManager(r, {
    component: { location: 'Hall A', city: 'ChronoCity', country: 'India' },
    isMulti: false, eventTitle: 'Chrono QMZ Event', hijriDate: '1448-02-10', eventJsonPath: null, componentTitle: null,
  }), qmzRoot);
  await window.waitForTimeout(600);
  await window.click(`.qmz-pg-row[data-pg="${pg}"]`);
  await window.waitForTimeout(400);
  const qmzOrder = await visibleOrder('#qmzFileGrid .file-tile[data-path]');
  const expectedQmzChronoOrder = expectedChronoOrder.map(n => n.replace('.JPG', '.CR2'));
  check(JSON.stringify(qmzOrder) === JSON.stringify(expectedQmzChronoOrder),
    `11. QMZ _Unsequenced displays real out-of-filename-order files in ascending chronological order — got ${JSON.stringify(qmzOrder)}`);

  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  await electronApp.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-chrono-sort] FATAL', err);
  process.exit(1);
});
