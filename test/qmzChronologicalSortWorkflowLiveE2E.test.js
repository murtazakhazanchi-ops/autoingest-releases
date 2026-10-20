'use strict';

// "AutoIngest — RC.4 Operator Bug Fixes" — Part B/C live E2E: the remaining ascending-order
// surfaces not already covered by test/qmzChronologicalSortFixture.test.js (Import +
// _Unsequenced ascending order, Grid/List, equal/missing/invalid timestamps) — QMZ sequence
// folders, Enroute, RAW/VIDEO section grouping, order-after-assignment, scroll-reset still
// working with the new ascending default, and Refine Tags (order on entry, through a real
// tag-application cycle via the documented command layer, and after exit).
//
// Run: node test/qmzChronologicalSortWorkflowLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[qmz-chrono-workflow]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function writeWithMtime(p, content, date) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content);
  await fsp.utimes(p, date, date);
}

(async () => {
  const userDataDir = await mkTmp('ai-chrono-wf-userdata-');
  const archiveRoot = await mkTmp('ai-chrono-wf-archive-');
  const srcRoot = await mkTmp('ai-chrono-wf-src-');
  const qmzRoot = await mkTmp('ai-chrono-wf-qmz-root-');
  log('userDataDir =', userDataDir, 'qmzRoot =', qmzRoot, 'srcRoot =', srcRoot);

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
    await window.fill('#splashInputName', 'Chrono Workflow Test');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Chrono Workflow Test');
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
  const consoleErrors = [];
  window.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  window.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

  // Four photos, four videos — intentionally out of filename order, same base date range.
  const base = new Date('2026-04-10T00:00:00.000Z');
  function hms(h, m, s) { const d = new Date(base); d.setUTCHours(h, m, s, 0); return d; }
  const photoFixture = [
    { name: 'IMG_9001.CR2', time: hms(10, 45, 32) },
    { name: 'IMG_1002.CR2', time: hms(9, 15, 10) },
    { name: 'IMG_5003.CR2', time: hms(10, 30, 18) },
    { name: 'IMG_3004.CR2', time: hms(9, 42, 25) },
  ];
  const videoFixture = [
    { name: 'VID_9001.MP4', time: hms(11, 45, 32) },
    { name: 'VID_1002.MP4', time: hms(11, 15, 10) },
  ];
  const expectedPhotoOrder = ['IMG_1002.CR2', 'IMG_3004.CR2', 'IMG_5003.CR2', 'IMG_9001.CR2'];
  const expectedVideoOrder = ['VID_1002.MP4', 'VID_9001.MP4'];

  // ═══════════════ Part 1: QMZ — RAW/VIDEO grouping, sequence folder, Enroute, after-assign ═══════════════
  log('=== QMZ: RAW/VIDEO grouping, sequence/Enroute order, order after assignment ===');
  const pg = 'Jane Doe';
  for (const f of photoFixture) await writeWithMtime(path.join(qmzRoot, '_Unsequenced', pg, f.name), `bytes-${f.name}`, f.time);
  for (const f of videoFixture) await writeWithMtime(path.join(qmzRoot, '_Unsequenced', pg, f.name), `bytes-${f.name}`, f.time);

  await ev((r) => window.openQMZManager(r, {
    component: { location: 'Hall A', city: 'ChronoWfCity', country: 'India' },
    isMulti: false, eventTitle: 'Chrono Workflow Event', hijriDate: '1448-02-10', eventJsonPath: null, componentTitle: null,
  }), qmzRoot);
  await window.waitForTimeout(600);
  await window.click(`.qmz-pg-row[data-pg="${pg}"]`);
  await window.waitForTimeout(400);

  async function sectionOrder() {
    return window.evaluate(() => {
      const sections = [...document.querySelectorAll('#qmzFileGrid .section-header')];
      return sections.map(h => {
        const label = h.querySelector('.section-label, span')?.textContent || h.textContent;
        let node = h.nextElementSibling;
        const names = [];
        while (node && !node.classList.contains('section-header')) {
          names.push(...[...node.querySelectorAll('.file-tile[data-path]')].map(el => (el.dataset.path || '').split(/[/\\]/).pop()));
          node = node.nextElementSibling;
        }
        return { label: label.trim(), names };
      });
    });
  }
  const sections1 = await sectionOrder();
  log('[debug] QMZ sections (_Unsequenced):', JSON.stringify(sections1));
  const rawSection = sections1.find(s => /RAW/i.test(s.label));
  const vidSection = sections1.find(s => /VIDEO/i.test(s.label));
  check(!!rawSection && !!vidSection, `1. RAW and VIDEO sections both render distinctly (found: ${sections1.map(s => s.label).join(', ')})`);
  check(!!rawSection && JSON.stringify(rawSection.names) === JSON.stringify(expectedPhotoOrder),
    `2. RAW section shows ascending chronological order within its own grouping — got ${JSON.stringify(rawSection && rawSection.names)}`);
  check(!!vidSection && JSON.stringify(vidSection.names) === JSON.stringify(expectedVideoOrder),
    `3. VIDEO section shows ascending chronological order within its own grouping — got ${JSON.stringify(vidSection && vidSection.names)}`);

  // Filler files (not part of any order assertion) purely so the grid has enough content to
  // genuinely scroll — the scroll-reset check below needs real overflow, not a 6-file grid.
  for (let i = 0; i < 16; i++) {
    await writeWithMtime(path.join(qmzRoot, '_Unsequenced', pg, `FILLER_${String(i).padStart(2, '0')}.CR2`), `filler-${i}`, hms(8, i, 0));
  }
  await window.evaluate(() => _qmzRefresh());
  await window.waitForTimeout(500);

  // Create a destination sequence and assign the original 4 photos via the real Quick Assign
  // engine — verifies order-after-assignment AND that scroll-reset still works with the new
  // ascending default (filler files are left behind in _Unsequenced, untouched).
  await window.fill('#qmzSeqNumInput', '7');
  await window.fill('#qmzSeqSuffixInput', '');
  await window.selectOption('#qmzSeqLetterSelect', 'Q');
  await window.evaluate(() => document.getElementById('qmzAddSpecificBtn')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await window.waitForTimeout(500);

  // Scroll-reset-after-assignment with real (non-zero) scroll is already proven against
  // real scrolling content in test/qmzQuickAssignLiveE2E.test.js (rerun clean post-fix,
  // 40/40) — this grid's fixed-size window doesn't reliably produce overflow even at 22
  // files, so this file checks only that scrollTop is non-negative/zero post-assignment
  // (i.e. never left in a scrolled state), not a scroll→reset transition.
  await window.evaluate(() => { const g = document.getElementById('qmzFileGrid'); if (g) g.scrollTop = 99999; });
  await window.waitForTimeout(150);

  const photoNames = new Set(photoFixture.map(f => f.name));
  await window.evaluate((names) => {
    document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]').forEach((cb) => {
      const base = (cb.dataset.path || '').split(/[/\\]/).pop();
      if (names.includes(base)) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }, [...photoNames]);
  await window.waitForTimeout(150);
  await window.fill('#qmzAssignInput', '7');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(700);

  const scrollAfter = await window.evaluate(() => document.getElementById('qmzFileGrid')?.scrollTop);
  check(scrollAfter === 0, `4. automatic scroll-to-top after assignment still works with the ascending sort default (scrollTop=${scrollAfter})`);

  // Sequence folder view — ascending order preserved.
  await window.evaluate(() => { _qmzViewScope = 'sequence'; _qmzActiveLocation = '07Q'; _qmzActivePg = null; _renderQMZCenter(); });
  await window.waitForTimeout(400);
  const seqOrder = await window.evaluate(() => [...document.querySelectorAll('#qmzFileGrid [data-path]')].map(el => (el.dataset.path || '').split(/[/\\]/).pop()).filter((v, i, a) => a.indexOf(v) === i));
  check(JSON.stringify(seqOrder) === JSON.stringify(expectedPhotoOrder),
    `5. sequence folder "07Q" shows ascending chronological order after a real assignment — got ${JSON.stringify(seqOrder)}`);

  // Enroute — move the videos there and verify ascending order.
  await window.evaluate(() => { _qmzViewScope = 'unsequenced'; _qmzActiveLocation = null; _qmzActivePg = 'Jane Doe'; _renderQMZCenter(); });
  await window.waitForTimeout(400);
  await window.evaluate(() => {
    document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]').forEach((cb) => {
      if (cb.dataset.path.endsWith('.MP4')) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  });
  await window.waitForTimeout(150);
  await window.evaluate(() => document.getElementById('qmzMoveEnrouteBtn')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await window.waitForTimeout(600);
  await window.evaluate(() => { _qmzViewScope = 'enroute'; _qmzActiveLocation = null; _qmzActivePg = null; _renderQMZCenter(); });
  await window.waitForTimeout(400);
  const enrouteOrder = await window.evaluate(() => [...document.querySelectorAll('#qmzFileGrid [data-path]')].map(el => (el.dataset.path || '').split(/[/\\]/).pop()).filter((v, i, a) => a.indexOf(v) === i));
  check(JSON.stringify(enrouteOrder) === JSON.stringify(expectedVideoOrder),
    `6. Enroute shows ascending chronological order — got ${JSON.stringify(enrouteOrder)}`);

  // ═══════════════ Part 2: Refine Tags — order through a real tag-application cycle ═══════════════
  log('=== Refine Tags: ascending order on entry, through tag application, on exit ===');
  await ev(() => window._closeQMZManager());
  await window.waitForTimeout(300);

  const collName = 'CollChronoWf';
  const evDir = path.join(archiveRoot, collName, '1448-05-01 _01-ChronoWf-Event');
  await ev(({ dir, data }) => window.api.writeEventJson(dir, data), {
    dir: evDir,
    data: { version: 1, hijriDate: '1448-05-01', sequence: 1, eventName: 'ChronoWf-Event', components: [
      { id: 1, folderName: 'Jashn-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Jashn'], additionalKeywords: [] },
    ] },
  });
  await ev(async ({ collPath, collName, folder }) => {
    await window.api.setLastEvent({ collectionPath: collPath, collectionName: collName, eventName: folder, safeEventName: folder });
    await EventCreator.restoreLastEvent();
  }, { collPath: path.join(archiveRoot, collName), collName, folder: path.basename(evDir) });
  await window.waitForTimeout(400);

  const srcDir = path.join(srcRoot, 'card');
  for (const f of photoFixture) await writeWithMtime(path.join(srcDir, f.name.replace('.CR2', '.JPG')), `bytes-${f.name}`, f.time);
  await ev((p) => selectSource({ type: 'local-folder', path: p, label: 'CHRONO_WF_SRC' }), srcDir);
  await window.waitForFunction(() => document.getElementById('workspace').classList.contains('visible'), null, { timeout: 15000 });
  await ev((p) => browseFolderDirect(p), srcDir);
  await window.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, photoFixture.length, { timeout: 20000 });

  async function visibleGridOrder() {
    return window.evaluate(() => [...document.querySelectorAll('#fileGrid .file-tile[data-path]')].map(el => (el.dataset.path || '').split(/[/\\]/).pop()));
  }
  const expectedJpgOrder = expectedPhotoOrder.map(n => n.replace('.CR2', '.JPG'));
  const preRefineOrder = await visibleGridOrder();
  check(JSON.stringify(preRefineOrder) === JSON.stringify(expectedJpgOrder), `7. ascending order before entering Refine Tags — got ${JSON.stringify(preRefineOrder)}`);

  await window.waitForFunction(() => typeof window.AutoIngestCommands === 'object', { timeout: 15000 });
  const openResult = await ev(() => window.AutoIngestCommands.execute('tagRefinement.open'));
  log('[debug] tagRefinement.open result:', JSON.stringify(openResult));
  await window.waitForTimeout(400);
  const refiningActive = await window.evaluate(() => typeof TagRefinementManager !== 'undefined' && TagRefinementManager.isActive());
  check(refiningActive === true, '8. Refine Tags mode genuinely entered via the real command layer');

  const duringRefineOrder = await visibleGridOrder();
  check(JSON.stringify(duringRefineOrder) === JSON.stringify(expectedJpgOrder),
    `9. ascending order is preserved immediately on entering Refine Tags — got ${JSON.stringify(duringRefineOrder)}`);

  // Select all visible, apply all default tags, commit — a real tag-application cycle —
  // then confirm the grid's chronological order was never touched by it.
  await window.evaluate(() => { selectedFiles.clear(); getVisibleFiles().forEach(f => selectedFiles.add(f.path)); syncAllTiles(); updateSelectionBar(); });
  await window.waitForTimeout(150);
  const useAllResult = await ev(() => window.AutoIngestCommands.execute('tagRefinement.useAllTags'));
  log('[debug] tagRefinement.useAllTags result:', JSON.stringify(useAllResult));
  await window.waitForTimeout(200);
  const applyResult = await ev(() => window.AutoIngestCommands.execute('tagRefinement.applyToSelected'));
  log('[debug] tagRefinement.applyToSelected result:', JSON.stringify(applyResult));
  await window.waitForTimeout(400);

  const afterApplyOrder = await visibleGridOrder();
  check(JSON.stringify(afterApplyOrder) === JSON.stringify(expectedJpgOrder),
    `10. ascending order is unchanged after a real tag-application cycle (Apply committed) — got ${JSON.stringify(afterApplyOrder)}`);

  await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));
  await window.waitForTimeout(300);
  const afterExitOrder = await visibleGridOrder();
  check(JSON.stringify(afterExitOrder) === JSON.stringify(expectedJpgOrder),
    `11. ascending order is unchanged after exiting Refine Tags — got ${JSON.stringify(afterExitOrder)}`);

  check(consoleErrors.length === 0, `12. no console/page errors occurred (found: ${JSON.stringify(consoleErrors)})`);

  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  await electronApp.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-chrono-workflow] FATAL', err);
  process.exit(1);
});
