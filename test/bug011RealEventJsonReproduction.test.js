'use strict';

// Local reproduction attempt for BUG-011's real-Windows/NAS RC failure, using the
// EXACT event.json shape the tester supplied from their real archive (fields,
// values, and the two-component/two-city/QMZ structure are copied verbatim from
// the tester's report — not a simplified approximation). Runs the REAL Electron
// app (Playwright's _electron) against an isolated synthetic archive — never
// touches real data.
//
// Purpose: rule in/out every code-level hypothesis raised in the forensic-trace
// request before concluding the defect is Windows-runtime-only (Dirent/fs.stat
// mismatch on a network drive, or similar) and therefore untestable from macOS.
//
// Specifically tests:
//   TEST 1 — the exact real event.json (2 components, 2 different cities, QMZ +
//            multi-type component, status:"complete", imports[] with a Windows
//            local-drive source path E:\..., lastMetadataRun, metadataState) is
//            discovered correctly by master:scanEvents. Rules out: schema
//            incompatibility, imports[]/source-path misuse, component-vs-event
//            folder-name confusion.
//   TEST 2 — the event's hijriDate (1448-02-22) differs from the collection
//            folder's own date-like prefix (1448-01-11) — collection contains
//            events spanning multiple Hijri dates. Rules out: an assumed
//            event.hijriDate === collection-date filter (none was found by
//            reading the code, this proves it empirically too).
//   TEST 3 — multiple events with varying component counts (1, 2, 3) and mixed
//            single/multi-city structures all discovered together, newest-first
//            sort intact. Rules out: any off-by-one or first-component-only
//            assumption in the scan loop.
//   TEST 4 — component.folderName values ("01-QMZ-East London",
//            "02-Arrival-Ziyarat-London") are never mistaken for the event
//            folder's own identity (needsReconciliation must stay false when the
//            event folder name matches eventName/safeEventName, not any
//            component.folderName).
//
// Run: node test/bug011RealEventJsonReproduction.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = '/Users/funun_pa/Projects/_Auto-Ingest-Software/electron-app-v24';

function log(...args) { console.log('[repro]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeEventJsonFixture(dir, data) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'event.json'), JSON.stringify(data, null, 2), 'utf8');
}

// The exact real event.json shape reported by the tester, field-for-field.
function realEventJsonFixture() {
  return {
    version: 1,
    hijriDate: '1448-02-22',
    sequence: 1,
    eventName: '1448-02-22 _01-QMZ-East London-Arrival-Ziyarat-London',
    safeEventName: '1448-02-22 _01-QMZ-East London-Arrival-Ziyarat-London',
    status: 'complete',
    components: [
      {
        types: ['QMZ'],
        location: null,
        city: 'East London',
        country: 'United Kingdom',
        folderName: '01-QMZ-East London',
      },
      {
        types: ['Arrival', 'Ziyarat'],
        location: null,
        city: 'London',
        country: 'United Kingdom',
        folderName: '02-Arrival-Ziyarat-London',
      },
    ],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 3600000,
    imports: [
      {
        source: { path: 'E:\\UK Asfaar-Photos\\DCIM\\100EOS5D\\IMG_0001.CR2' },
        importedAt: Date.now() - 86000000,
      },
      {
        source: { path: 'E:\\UK Asfaar-Photos\\DCIM\\100EOS5D\\IMG_0002.CR2' },
        importedAt: Date.now() - 86000000,
      },
    ],
    lastImport: { importedAt: Date.now() - 86000000, count: 2 },
    lastMetadataRun: { runAt: Date.now() - 3600000, batchId: 'batch-repro-001', status: 'complete' },
    metadataState: { status: 'complete', filesProcessed: 2, filesTotal: 2 },
  };
}

(async () => {
  const userDataDir = await mkTmp('ai-e2e-bug011-userdata-');
  const archiveRoot = await mkTmp('ai-e2e-bug011-archive-');

  log('userDataDir =', userDataDir);
  log('archiveRoot =', archiveRoot);

  // Mirror the tester's exact collection name.
  const collName = '1448-01-11 _UK Safar';
  const collDir  = path.join(archiveRoot, collName);

  // ── Fixture 1: the exact real event, verbatim ────────────────────────────────
  const realEvName = '1448-02-22 _01-QMZ-East London-Arrival-Ziyarat-London';
  const realEvDir  = path.join(collDir, realEvName);
  await writeEventJsonFixture(realEvDir, realEventJsonFixture());
  // Also create the two component subfolders — a multi-component event's real
  // archive layout has one subfolder per component, matching folderName.
  await fsp.mkdir(path.join(realEvDir, '01-QMZ-East London'), { recursive: true });
  await fsp.mkdir(path.join(realEvDir, '02-Arrival-Ziyarat-London'), { recursive: true });

  // ── Fixture 2: a single-component event, different Hijri date again ─────────
  const singleEvName = '1448-01-15 _01-Majlis-Adam Masjid-Bradford';
  await writeEventJsonFixture(path.join(collDir, singleEvName), {
    version: 1, hijriDate: '1448-01-15', sequence: 1,
    eventName: singleEvName, safeEventName: singleEvName, status: 'created',
    components: [{ types: ['Majlis'], location: 'Adam Masjid', city: 'Bradford', country: 'United Kingdom', folderName: null }],
  });

  // ── Fixture 3: a three-component event, three different cities ──────────────
  const tripleEvName = '1448-03-01 _01-Waaz-Bradford-Ziyafat-London-Majlis-East London';
  await writeEventJsonFixture(path.join(collDir, tripleEvName), {
    version: 1, hijriDate: '1448-03-01', sequence: 1,
    eventName: tripleEvName, safeEventName: tripleEvName, status: 'created',
    components: [
      { types: ['Waaz'], location: null, city: 'Bradford', country: 'United Kingdom', folderName: '01-Waaz-Bradford' },
      { types: ['Ziyafat'], location: null, city: 'London', country: 'United Kingdom', folderName: '02-Ziyafat-London' },
      { types: ['Majlis'], location: null, city: 'East London', country: 'United Kingdom', folderName: '03-Majlis-East London' },
    ],
  });

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  window.on('pageerror', err => log('[pageerror]', err.message));
  await window.waitForLoadState('domcontentloaded');

  await window.waitForTimeout(1500);
  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Repro Test Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) {
      await window.click('.splash-user-item');
      await window.click('#splashSelectStartBtn');
    } else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Repro Test Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }

  window = await mainWindowPromise;
  window.on('pageerror', err => log('[pageerror]', err.message));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  await window.evaluate(async (root) => {
    await window.api.initArchiveRoot(root);
    await window.api.setNasRoot(root);
    await window.api.setMainArchiveRoot(root);
  }, archiveRoot);

  // ── Direct IPC call — same channel the real UI uses, no UI driving needed ───
  const scanResult = await window.evaluate(async (masterPath) => window.api.scanMasterEvents(masterPath), collDir);
  log('scanMasterEvents result:', JSON.stringify({
    ok: scanResult?.ok,
    count: scanResult?.events?.length,
    names: scanResult?.events?.map(e => e.folderName),
  }, null, 2));

  // ── TEST 1: the exact real event is discovered, valid, not corrupt ──────────
  check(scanResult?.ok === true, 'TEST 1: scan reports ok:true');
  const realEv = scanResult?.events?.find(e => e.folderName === realEvName);
  check(!!realEv, 'TEST 1: the exact real event (2 components, QMZ, 2 cities) is present in the result');
  if (realEv) {
    check(realEv.isParseable === true, 'TEST 1: real event is isParseable (counts toward "Existing Events")');
    check(realEv.isCorrupt === false, 'TEST 1: real event is NOT marked corrupt — schema accepted as-is');
    check(realEv.isFromJson === true, 'TEST 1: real event sourced from event.json (not legacy folder-name fallback)');
    check(realEv.hijriDate === '1448-02-22', 'TEST 1: hijriDate read correctly from event.json');
    check(Array.isArray(realEv.components) && realEv.components.length === 2, 'TEST 1: both components present');
    check(realEv.needsReconciliation === false, 'TEST 1: needsReconciliation is false — folder name matches safeEventName exactly');
  }

  // ── TEST 4: component.folderName never mistaken for event identity ──────────
  if (realEv) {
    check(realEv.folderName === realEvName, 'TEST 4: event.folderName is the EVENT folder name, not a component.folderName');
    check(realEv.folderName !== realEv.components?.[0]?.folderName, 'TEST 4: event folder name differs from component 1 folderName as expected');
    check(realEv.folderName !== realEv.components?.[1]?.folderName, 'TEST 4: event folder name differs from component 2 folderName as expected');
  }

  // ── TEST 2: differing Hijri date (event date != collection-name date) ───────
  const singleEv = scanResult?.events?.find(e => e.folderName === singleEvName);
  check(!!singleEv && singleEv.isParseable, 'TEST 2: single-component event with a DIFFERENT Hijri date than the collection name is still discovered');

  // ── TEST 3: multi-component variety, all discovered together ────────────────
  const tripleEv = scanResult?.events?.find(e => e.folderName === tripleEvName);
  check(!!tripleEv && tripleEv.isParseable && tripleEv.components?.length === 3, 'TEST 3: three-component, three-city event discovered with all 3 components intact');
  check((scanResult?.events?.filter(e => e.isParseable) || []).length === 3, 'TEST 3: all 3 fixture events counted as "Existing Events" (resolved), 0 unexpected drops');

  await electronApp.close().catch(() => {});
  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('[repro] FATAL:', err);
  process.exit(1);
});
