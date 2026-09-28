'use strict';

// Live end-to-end verification of Per-Photo Tag Refinement — driving the REAL
// Electron app's real IPC handler (import:commitTransaction), real exifService,
// and real ExifTool, for a genuine multi-component event with a per-file
// refinement override. Mirrors the direct-IPC-drive pattern already established
// in test/metadataPipelineLive.test.js (bypasses the Event Creator wizard UI,
// which is orthogonal to this feature, but exercises every line this feature
// actually touches: main.js's tagRefinementsForDisk persistence block and
// metadataExpectationService's tier-0 fileTagRefinements override).
//
// Requires playwright-core. Run with the real Electron binary:
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox test/tagRefinementLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

function log(...args) { console.log('[tag-refine-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function rawFile(p) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.from('not-a-real-raw-file-just-bytes'));
}

(async () => {
  const userDataDir = await mkTmp('ai-tagrefine-e2e-userdata-');
  const archiveRoot = await mkTmp('ai-tagrefine-e2e-root-');
  const sourceDir   = await mkTmp('ai-tagrefine-e2e-src-');
  log('userDataDir =', userDataDir);
  log('archiveRoot =', archiveRoot);

  const app = await electron.launch({
    args: [process.cwd(), '--user-data-dir=' + userDataDir, '--no-sandbox'],
    timeout: 60000,
  });

  let window = await app.firstWindow({ timeout: 60000 });
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  });
  log('splash state:', JSON.stringify(splashState));

  const mainWindowPromise = app.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Tag Refine E2E Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) {
      await window.click('.splash-user-item');
      await window.click('#splashSelectStartBtn');
    } else {
      await window.click('#splashNewProfileBtn');
      await window.fill('#splashInputName', 'Tag Refine E2E Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }

  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);

  const errors = [];
  window.on('pageerror', err => errors.push('pageerror: ' + err.message));

  // ── Sanity: the new module actually loaded in the real renderer context ──
  const trmCheck = await window.evaluate(() => ({
    exists: typeof TagRefinementManager !== 'undefined',
    hasIsEligible: typeof TagRefinementManager?.isEligible === 'function',
    isActiveInitially: TagRefinementManager?.isActive?.(),
    eligibleTrue: TagRefinementManager?.isEligible?.({ eventTypes: [{ label: 'Waaz' }], additionalKeywords: [{ label: 'Children' }] }),
    // Eligibility rule CHANGED from ">1 total refinable tag" to ">= 1": a lone Event Type is
    // now eligible (the operator can drop it from individual photos); only a component with
    // nothing to refine is not.
    eligibleSingleType: TagRefinementManager?.isEligible?.({ eventTypes: [{ label: 'Waaz' }], additionalKeywords: [] }),
    eligibleFalse: TagRefinementManager?.isEligible?.({ eventTypes: [], additionalKeywords: [] }),
    sharedModelLoaded: typeof RefinableTags?.effectiveDefaults === 'function',
  }));
  log('TagRefinementManager renderer check:', JSON.stringify(trmCheck));
  check(trmCheck.exists && trmCheck.hasIsEligible, 'TagRefinementManager loaded in the real renderer (script tag wired correctly)');
  check(trmCheck.sharedModelLoaded, 'shared RefinableTags model loaded in the real renderer (script order correct)');
  check(trmCheck.isActiveInitially === false, 'refinement mode inactive by default');
  check(trmCheck.eligibleTrue === true && trmCheck.eligibleSingleType === true && trmCheck.eligibleFalse === false,
    'isEligible reflects the real >=1-refinable-tag rule live in the app (lone Event Type eligible; zero tags not)');

  // ── Configure Main Archive Root via the real IPC (bypasses folder-picker dialog) ──
  await window.evaluate(async (root) => window.api.setMainArchiveRoot(root), archiveRoot);
  await window.waitForTimeout(300);

  // =============================================================================
  // Multi-component event: Component 1 (Waaz+Majlis+Ziyafat, 2 Additional Keywords)
  // and Component 2 (Ziyarat only — now eligible too under the >=1 rule, but left
  // unrefined here to prove an untouched eligible component imports exactly as before).
  // One file in Component 1's group carries an explicit per-file refinement override.
  // =============================================================================
  const evDir = path.join(archiveRoot, 'CollTagRefineE2E', '1448-01-01 _01-Waaz-Ziyarat');
  const comp1Folder = 'Waaz-Hall A';
  const comp2Folder = 'Ziyarat-Hall B';
  const eventJsonData = {
    version: 1, hijriDate: '1448-01-01', sequence: 1, eventName: 'Waaz-Ziyarat',
    components: [
      {
        folderName: comp1Folder, location: 'Hall A', city: 'Mumbai', country: 'India',
        types: ['Waaz', 'Majlis', 'Ziyafat'],
        additionalKeywords: [{ label: 'Children', keywordId: 'k1' }, { label: 'Outdoor', keywordId: 'k2' }],
      },
      { folderName: comp2Folder, location: 'Hall B', city: 'Mumbai', country: 'India', types: ['Ziyarat'], additionalKeywords: [] },
    ],
  };
  await window.evaluate(async ({ dir, data }) => window.api.writeEventJson(dir, data), { dir: evDir, data: eventJsonData });

  const srcR1 = path.join(sourceDir, 'r1.cr2'); // Component 1, default (inherit)
  const srcR2 = path.join(sourceDir, 'r2.cr2'); // Component 1, explicit refinement
  const srcZ1 = path.join(sourceDir, 'z1.cr2'); // Component 2, default (not eligible, untouched by feature)
  await rawFile(srcR1); await rawFile(srcR2); await rawFile(srcZ1);

  const destR1 = path.join(evDir, comp1Folder, 'Jane Doe', 'r1.cr2');
  const destR2 = path.join(evDir, comp1Folder, 'Jane Doe', 'r2.cr2');
  const destZ1 = path.join(evDir, comp2Folder, 'Jane Doe', 'z1.cr2');

  // Shape mirrors exactly what renderer.js's auditContext.groups now serializes
  // (id, subEventId, metadataTags, files, fileTagRefinements) — the real IPC contract.
  const groups = [
    {
      id: 1, subEventId: comp1Folder, metadataTags: null,
      files: [srcR1, srcR2],
      fileTagRefinements: { [srcR2]: { eventTypes: ['Waaz'], additionalKeywords: ['Children'] } },
    },
    { id: 2, subEventId: comp2Folder, metadataTags: null, files: [srcZ1], fileTagRefinements: null },
  ];

  const commit = await window.evaluate(async ({ fileJobs, eventJsonPath, ctx }) => {
    return window.api.commitImportTransaction(fileJobs, eventJsonPath, ctx);
  }, {
    fileJobs: [{ src: srcR1, dest: destR1 }, { src: srcR2, dest: destR2 }, { src: srcZ1, dest: destZ1 }],
    eventJsonPath: evDir,
    ctx: { groups, photographer: 'Jane Doe', liveComps: null, subEventNames: null, collName: 'CollTagRefineE2E', source: 'e2e-test', importedBy: 'Tag Refine E2E Operator' },
  });
  log('commitImportTransaction result:', JSON.stringify({ copied: commit.copied, errors: commit.errors, metadataBatchId: commit.metadataBatchId }));
  check(commit.copied === 3 && commit.errors === 0, 'all 3 files copied with zero errors');

  // Poll for metadata completion (event-driven backend, not instant).
  let evJsonOnDisk = null;
  for (let i = 0; i < 30; i++) {
    await window.waitForTimeout(1000);
    try { evJsonOnDisk = JSON.parse(await fsp.readFile(path.join(evDir, 'event.json'), 'utf8')); } catch { /* not written yet */ }
    if (evJsonOnDisk?.metadataState?.state === 'metadata-complete') break;
  }
  log('final event.json metadataState:', JSON.stringify(evJsonOnDisk?.metadataState));
  check(evJsonOnDisk?.metadataState?.state === 'metadata-complete', 'metadata batch reached metadata-complete');

  // ── Persistence: tagRefinements written to event.json, relPath-keyed ──
  log('event.json tagRefinements:', JSON.stringify(evJsonOnDisk?.tagRefinements));
  const persistedRefinement = Array.isArray(evJsonOnDisk?.tagRefinements) ? evJsonOnDisk.tagRefinements[0] : null;
  check(
    !!persistedRefinement
      && JSON.stringify(persistedRefinement.eventTypes) === JSON.stringify(['Waaz'])
      && JSON.stringify(persistedRefinement.additionalKeywords) === JSON.stringify(['Children'])
      && persistedRefinement.relPaths.some(p => p.replace(/\\/g, '/').endsWith('r2.cr2')),
    'tagRefinements persisted to event.json, relPath-keyed to r2.cr2, mirroring the metadataGroups convention'
  );

  // ── Real ExifTool read-back proves the actual written keywords ──
  const { ExifTool } = require('exiftool-vendored');
  const et = new ExifTool();
  try {
    const sidecar = p => p.slice(0, -path.extname(p).length) + '.xmp';
    const asArr = v => (v === undefined || v === null) ? [] : (Array.isArray(v) ? v : [v]);

    const tagsR1 = await et.read(sidecar(destR1)); // default — inherits ALL component tags
    const kwR1 = asArr(tagsR1.Subject).sort();
    log('r1 (default) Subject:', JSON.stringify(kwR1));
    check(
      ['Waaz', 'Majlis', 'Ziyafat', 'Children', 'Outdoor', 'Hall A', 'Mumbai', 'India'].every(k => kwR1.includes(k)),
      'unrefined file inherits ALL component Event Types + Additional Keywords (closes the pre-existing gap, live)'
    );

    const tagsR2 = await et.read(sidecar(destR2)); // explicit refinement — only Waaz + Children
    const kwR2 = asArr(tagsR2.Subject).sort();
    log('r2 (refined) Subject:', JSON.stringify(kwR2));
    check(
      kwR2.includes('Waaz') && kwR2.includes('Children') && kwR2.includes('Hall A') && kwR2.includes('Mumbai') && kwR2.includes('India'),
      'refined file receives its explicit Event Type + Additional Keyword selection'
    );
    check(
      !kwR2.includes('Majlis') && !kwR2.includes('Ziyafat') && !kwR2.includes('Outdoor'),
      'refined file does NOT receive component tags outside its explicit selection'
    );

    const tagsZ1 = await et.read(sidecar(destZ1)); // Component 2 — eligible but left unrefined
    const kwZ1 = asArr(tagsZ1.Subject).sort();
    log('z1 (Component 2, unrefined) Subject:', JSON.stringify(kwZ1));
    check(
      kwZ1.includes('Ziyarat') && kwZ1.includes('Hall B') && kwZ1.includes('Mumbai') && kwZ1.includes('India'),
      'Component 2 (single Event Type, no Additional Keywords), left unrefined, imports normally with its inherited Event Type'
    );
  } finally {
    await et.end().catch(() => {});
  }

  // ── Additional Keywords never alter folder/sub-event naming or routing ──
  check(fs.existsSync(destR1) && fs.existsSync(destR2) && fs.existsSync(destZ1), 'all files land at their exact expected archive paths — refinement never altered routing');
  check(!fs.existsSync(path.join(evDir, 'Children')) && !fs.existsSync(path.join(evDir, 'Outdoor')),
    'Additional Keywords never became folder names anywhere in the archive');

  check(errors.length === 0, `no renderer page errors (${JSON.stringify(errors)})`);

  await app.close();
  log(`=== SUMMARY: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(e => { console.error('[tag-refine-e2e] FATAL', e.stack || e.message); process.exit(1); });
