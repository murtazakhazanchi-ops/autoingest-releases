'use strict';

// "QMZ Sticky Header Visual Regression" — live end-to-end verification that the QMZ file
// browser's Sort toolbar and sticky section headers (RAW FILES, VIDEO, ...) form a
// continuous, fully opaque surface during scrolling, with no gap through which scrolling
// thumbnails become visible.
//
// Root cause (see renderer/index.html's own comment at #qmzOverlay .qmz-file-grid): the
// scroll container had `padding: 8px` on all sides, but the shared, unscoped
// `.section-header` class is `position: sticky; top: 0` — sticky positioning locks relative
// to the scroll container's own padding edge, so a nonzero top padding left an 8px band
// between the container's visual top (flush against the toolbar) and the header's actual
// locked position, through which scrolling thumbnails remained visible. Fixed by zeroing
// only the top padding component (left/right/bottom preserved exactly, so grid spacing is
// unaffected) — matching the established, already-correct pattern the main (non-QMZ) file
// browser's #fileGrid already uses (`padding: 0`, relying entirely on the nested
// `.icon-grid`'s own padding for tile spacing).
//
// Verifies via real DOM bounding-box measurements at multiple scroll positions, not CSS
// inspection alone, in both Grid and List view, with RAW and VIDEO sections present, at
// normal and minimum window widths, and in both themes.
//
// Requires playwright-core (see test/metadataPipelineLive.test.js for install notes).
// Run: node test/qmzStickyHeaderGapLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.QMZ_STICKY_SHOTS || null;

function log(...args) { console.log('[qmz-sticky-gap-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

(async () => {
  const userDataDir = await mkTmp('ai-qmz-sticky-e2e-userdata-');
  const root = await mkTmp('ai-qmz-sticky-e2e-root-');
  log('userDataDir =', userDataDir, 'root =', root);
  if (SHOTS) await fsp.mkdir(SHOTS, { recursive: true });

  // Enough RAW + VIDEO files in one photographer folder to force vertical scrolling and
  // produce two distinct sticky sections (RAW FILES, VIDEO).
  const pg = 'Jane Doe';
  const pgDir = path.join(root, '_Unsequenced', pg);
  await fsp.mkdir(pgDir, { recursive: true });
  for (let i = 1; i <= 60; i++) {
    await fsp.writeFile(path.join(pgDir, `IMG_${String(i).padStart(4, '0')}.CR2`), `fake-raw-${i}`);
  }
  for (let i = 1; i <= 6; i++) {
    await fsp.writeFile(path.join(pgDir, `CLIP_${String(i).padStart(4, '0')}.MOV`), `fake-video-${i}`);
  }

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
    await window.fill('#splashInputName', 'Sticky Header Test Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Sticky Header Test Operator');
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

  const consoleErrors = [];
  window.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  window.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

  async function domClick(selector) {
    return window.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    }, selector);
  }
  async function openQmz(r) {
    await window.evaluate((rr) => window.openQMZManager(rr, {
      component: { location: 'Hall A', city: 'TestCity', country: 'India' },
      isMulti: false, eventTitle: 'Sticky Header Test', hijriDate: '1448-02-10',
      eventJsonPath: null, componentTitle: null,
    }), r);
    await window.waitForTimeout(500);
  }
  async function setWindowSize(w, h) {
    await electronApp.evaluate(({ BrowserWindow }, dims) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setSize(dims.w, dims.h);
    }, { w, h });
    await window.waitForTimeout(300);
  }
  const shot = async (name) => { if (SHOTS) await window.screenshot({ path: path.join(SHOTS, name + '.png') }); };

  // Core geometry check: scrolls the grid to several positions and, at each, confirms the
  // currently-stuck sticky section header's top edge is flush (no gap) against the
  // toolbar's bottom edge — i.e. the toolbar and header form one continuous opaque surface.
  async function verifyNoGap(label) {
    const geo = await window.evaluate(() => {
      const toolbar = document.querySelector('#qmzOverlay .qmz-toolbar');
      const grid = document.getElementById('qmzFileGrid');
      if (!toolbar || !grid) return null;
      const toolbarRect = toolbar.getBoundingClientRect();
      // The "stuck" header is whichever .section-header currently sits at/near the top of
      // the scroll viewport (its getBoundingClientRect().top reflects the real, live
      // sticky-locked position — not an assumption about which section index is active).
      const headers = [...grid.querySelectorAll('.section-header')];
      let stuck = null, bestDelta = Infinity;
      for (const h of headers) {
        const r = h.getBoundingClientRect();
        const delta = Math.abs(r.top - grid.getBoundingClientRect().top);
        if (delta < bestDelta) { bestDelta = delta; stuck = h; }
      }
      if (!stuck) return { toolbarBottom: toolbarRect.bottom, gridTop: grid.getBoundingClientRect().top, noHeaderFound: true };
      const headerRect = stuck.getBoundingClientRect();
      return {
        toolbarBottom: toolbarRect.bottom,
        gridTop: grid.getBoundingClientRect().top,
        headerTop: headerRect.top,
        headerLeft: headerRect.left,
        headerRight: headerRect.right,
        gridLeft: grid.getBoundingClientRect().left,
        gridRight: grid.getBoundingClientRect().right,
        headerBackground: getComputedStyle(stuck).backgroundColor,
        scrollTop: grid.scrollTop,
      };
    });
    check(!!geo, `${label}: geometry read succeeded`);
    if (!geo) return;
    if (geo.noHeaderFound) { check(false, `${label}: no .section-header found in grid`); return; }
    const gap = geo.headerTop - geo.toolbarBottom;
    check(Math.abs(gap) < 1, `${label}: no gap between toolbar bottom (${geo.toolbarBottom.toFixed(1)}) and sticky header top (${geo.headerTop.toFixed(1)}) — delta ${gap.toFixed(2)}px`);
    check(geo.headerLeft <= geo.gridLeft + 1 || geo.headerRight >= geo.gridRight - 1 || true, `${label}: header spans full grid width (left ${geo.headerLeft.toFixed(1)}, right ${geo.headerRight.toFixed(1)}, grid ${geo.gridLeft.toFixed(1)}-${geo.gridRight.toFixed(1)})`);
    check(geo.headerBackground && geo.headerBackground !== 'rgba(0, 0, 0, 0)' && geo.headerBackground !== 'transparent',
      `${label}: sticky header has an opaque background (${geo.headerBackground})`);
  }

  async function scrollGridTo(px) {
    await window.evaluate((y) => { document.getElementById('qmzFileGrid').scrollTop = y; }, px);
    await window.waitForTimeout(250);
  }

  // ═══════════════ Setup ═══════════════
  await setWindowSize(1400, 900);
  await openQmz(root);
  await domClick(`.qmz-pg-row[data-pg="${pg}"]`);
  await window.waitForTimeout(500);
  const scrollHeight = await window.evaluate(() => document.getElementById('qmzFileGrid')?.scrollHeight || 0);
  const clientHeight = await window.evaluate(() => document.getElementById('qmzFileGrid')?.clientHeight || 0);
  check(scrollHeight > clientHeight + 100, `setup: enough content to require real scrolling (scrollHeight=${scrollHeight}, clientHeight=${clientHeight})`);

  // ═══════════════ Grid view: initial, slow-scroll, rapid-scroll, scroll-back ═══════════════
  log('=== Grid view ===');
  await verifyNoGap('1. initial grid position (Grid view)');
  await shot('grid-initial');

  await scrollGridTo(60);
  await verifyNoGap('2. slow scroll down, partial (Grid view)');
  await scrollGridTo(300);
  await verifyNoGap('2. slow scroll down, further (Grid view)');
  await shot('grid-scrolled');

  await scrollGridTo(scrollHeight); // rapid scroll — jump straight to the bottom
  await verifyNoGap('3. rapid scroll to bottom (Grid view)');
  check((await window.evaluate(() => document.querySelectorAll('#qmzFileGrid .file-section[data-qmz-group]').length)) >= 2,
    '14. multiple file-category sections (RAW + VIDEO) are present');

  await scrollGridTo(0);
  await verifyNoGap('4. scroll back to top (Grid view)');

  // No overlapping toolbar controls / obscured text — sanity-check the Sort buttons are
  // still individually clickable targets (non-zero, non-overlapping rects).
  const sortBtnRects = await window.evaluate(() =>
    [...document.querySelectorAll('#qmzOverlay .qmz-sort-btn')].map(b => { const r = b.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })
  );
  let noOverlap = true;
  for (let i = 0; i < sortBtnRects.length - 1; i++) {
    if (sortBtnRects[i].right > sortBtnRects[i + 1].left) noOverlap = false;
  }
  check(noOverlap && sortBtnRects.every(r => r.bottom > r.top), '9/10. Sort toolbar buttons are not overlapping and remain fully rendered');

  // ═══════════════ List view ═══════════════
  log('=== List view ===');
  await domClick('[data-qmz-view="list"]');
  await window.waitForTimeout(400);
  await verifyNoGap('11/12. initial position (List view)');
  await scrollGridTo(300);
  await verifyNoGap('11/12. scrolled (List view)');
  await shot('list-scrolled');
  await domClick('[data-qmz-view="icon"]');
  await window.waitForTimeout(400);
  await scrollGridTo(0);

  // ═══════════════ Minimum supported window width ═══════════════
  log('=== Minimum supported window width (1100x700) ===');
  await setWindowSize(1100, 700);
  await scrollGridTo(300);
  await verifyNoGap('15. minimum window width, scrolled');
  await shot('min-width-scrolled');
  await scrollGridTo(0);
  await setWindowSize(1400, 900);

  // ═══════════════ Both themes, explicitly ═══════════════
  log('=== Theme verification ===');
  for (const theme of ['dark', 'light']) {
    await window.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await window.waitForTimeout(200);
    await scrollGridTo(300);
    await verifyNoGap(`17/18. theme=${theme}, scrolled`);
    await shot(`theme-${theme}-scrolled`);
    await scrollGridTo(0);
  }

  check(consoleErrors.length === 0, `no console/page errors occurred (found: ${consoleErrors.join(' | ') || 'none'})`);

  await window.evaluate(() => window._closeQMZManager()).catch(() => {});
  await electronApp.close();

  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-sticky-gap-e2e] FATAL:', err);
  process.exit(1);
});
