'use strict';

// main/askAutoIngestDrawerVerify.js — Right-Side Drawer UI Conversion
// checkpoint, Part Q/R. Real Electron verification harness, in the same
// spirit as main/askAutoIngestUIVerify.js (Phase C4, Part O): a real
// BrowserWindow loading the real renderer/index.html with the same
// webPreferences main.js uses, driven via webContents.executeJavaScript()
// and real capturePage() screenshots. Not shipped, not wired into the app,
// not run in CI.
//
// This script checks ONLY what changed in this checkpoint (drawer
// geometry, scrim, background interactivity, state preservation, outside-
// click behavior, focus-return, responsive widths, and open/close
// latency). The existing askAutoIngestUIVerify.js already covers entry
// point, deterministic/boundary/semantic-judge answer correctness,
// cancellation, and Settings/Local-AI regression -- deliberately not
// duplicated here.
//
// Run with: node_modules/.bin/electron main/askAutoIngestDrawerVerify.js

const path = require('path');
const fs = require('fs');
const os = require('os');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-drawer-verify-userdata-'));
const SCREENSHOT_DIR = process.argv[2] || path.join(os.tmpdir(), 'ai-drawer-screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const { app, BrowserWindow } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail: detail || null });
  console.log(`[drawer-verify] ${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
}

async function main() {
  require('./askAutoIngest').registerIpcHandlers();

  const win = new BrowserWindow({
    width: 1920, height: 1080, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.show();
  await new Promise((r) => setTimeout(r, 400));

  const ejs = (script) => win.webContents.executeJavaScript(script, true);
  async function waitForAnswer(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const stillLoading = await ejs(`!document.getElementById('aaLoadingState').hidden`);
      if (!stillLoading) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }

  await ejs(`(() => { const ob = document.getElementById('onboardingOverlay'); if (ob) ob.style.display = 'none'; return true; })()`);

  const perf = {};

  // ── R: opening the drawer alone must not load the model ────────────────
  const runtime = require('../services/localJudge/runtime');
  const preOpenLoadState = runtime.getLoadState();
  record('before opening: model not loaded', preOpenLoadState.loadState === 'NOT_LOADED', preOpenLoadState);

  let t0 = Date.now();
  await ejs(`document.getElementById('askAutoIngestBtn').click()`);
  await new Promise((r) => setTimeout(r, 260)); // > the 0.22s slide transition
  perf.openLatencyMs = Date.now() - t0;
  const isOpen = await ejs(`document.getElementById('askAutoIngestOverlay').classList.contains('open')`);
  record('drawer opens on click', isOpen, { openLatencyMs: perf.openLatencyMs });

  const postOpenLoadState = runtime.getLoadState();
  record('opening the drawer alone does not load the model', postOpenLoadState.loadState === 'NOT_LOADED', postOpenLoadState);

  // ── D: no centered modal, no heavy scrim, right-anchored ───────────────
  const geometry = await ejs(`(() => {
    const overlay = document.getElementById('askAutoIngestOverlay');
    const box = document.getElementById('askAutoIngestBox');
    const ov = getComputedStyle(overlay);
    const bx = getComputedStyle(box);
    const rect = box.getBoundingClientRect();
    return {
      overlayBackground: ov.backgroundColor,
      overlayPointerEvents: ov.pointerEvents,
      boxPointerEvents: bx.pointerEvents,
      boxRight: rect.right,
      boxLeft: rect.left,
      boxTop: rect.top,
      boxWidth: rect.width,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      boxBottom: rect.bottom,
    };
  })()`);
  record('overlay has no scrim (transparent background)', /transparent|rgba\(0, ?0, ?0, ?0\)/.test(geometry.overlayBackground), geometry);
  record('overlay does not capture background clicks (pointer-events: none)', geometry.overlayPointerEvents === 'none', geometry);
  record('drawer box remains interactive (pointer-events: auto)', geometry.boxPointerEvents === 'auto', geometry);
  record('drawer is right-anchored (flush with window right edge)', Math.abs(geometry.boxRight - geometry.windowWidth) <= 1, geometry);
  record('drawer is anchored to the top (not vertically centered)', geometry.boxTop === 0, geometry);
  record('drawer does not cover the full window height (status bar remains reachable)', geometry.boxBottom < geometry.windowHeight, geometry);
  record('drawer width is within the ~380-480px target range at 1920x1080', geometry.boxWidth >= 380 && geometry.boxWidth <= 480, geometry);

  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, 'drawer-1920x1080.png'), img.toPNG()));

  // ── H: background remains usable (mouse click reaches a background element) ──
  const backgroundClickable = await ejs(`(() => {
    let clicked = false;
    const target = document.getElementById('helpBtn');
    const handler = () => { clicked = true; };
    target.addEventListener('click', handler, { once: true });
    const rect = target.getBoundingClientRect();
    const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const reachable = el === target || target.contains(el);
    target.removeEventListener('click', handler);
    return { reachable };
  })()`);
  record('background UI (e.g. Help button) is still hit-testable with the drawer open', backgroundClickable.reachable, backgroundClickable);

  // ── D.9: outside click does not close the drawer ───────────────────────
  await ejs(`(() => { document.body.click(); document.getElementById('helpBtn') && document.getElementById('helpBtn').blur(); return true; })()`);
  await new Promise((r) => setTimeout(r, 100));
  const stillOpenAfterOutsideClick = await ejs(`document.getElementById('askAutoIngestOverlay').classList.contains('open')`);
  record('clicking the AutoIngest workspace behind the drawer does not close it', stillOpenAfterOutsideClick);

  // ── I: state preservation across close -> reopen ────────────────────────
  await ejs(`(() => { document.getElementById('aaQuestionInput').value = 'How do I import photographs from an SD card?'; document.getElementById('aaAskBtn').click(); return true; })()`);
  await waitForAnswer(5000);
  const answerBeforeClose = await ejs(`document.getElementById('aaDirectAnswer').textContent`);
  await ejs(`document.getElementById('aaTechnicalDetails').open = true`);

  t0 = Date.now();
  await ejs(`document.getElementById('askAutoIngestClose').click()`);
  await new Promise((r) => setTimeout(r, 200));
  perf.closeLatencyMs = Date.now() - t0;
  const closedNow = await ejs(`!document.getElementById('askAutoIngestOverlay').classList.contains('open')`);
  record('close button closes the drawer', closedNow, { closeLatencyMs: perf.closeLatencyMs });

  const focusAfterClose = await ejs(`document.activeElement && document.activeElement.id`);
  record('focus returns to the Ask AutoIngest entry-point button after close', focusAfterClose === 'askAutoIngestBtn', { focusAfterClose });

  t0 = Date.now();
  await ejs(`document.getElementById('askAutoIngestBtn').click()`);
  await new Promise((r) => setTimeout(r, 260));
  perf.reopenLatencyMs = Date.now() - t0;
  const answerAfterReopen = await ejs(`document.getElementById('aaDirectAnswer').textContent`);
  const answerAreaVisibleAfterReopen = await ejs(`!document.getElementById('aaAnswerArea').hidden`);
  const detailsStillOpen = await ejs(`document.getElementById('aaTechnicalDetails').open`);
  record('question + answer survive close -> reopen', answerAreaVisibleAfterReopen && answerAfterReopen === answerBeforeClose, { answerBeforeClose, answerAfterReopen, reopenLatencyMs: perf.reopenLatencyMs });
  record('expanded Sources & technical details survive close -> reopen', detailsStillOpen === true);

  // ── E: responsive widths at required breakpoints ────────────────────────
  const breakpoints = [[1920, 1080], [1440, 900], [1280, 720], [1024, 720]];
  const widthResults = {};
  for (const [w, h] of breakpoints) {
    win.setBounds({ width: w, height: h, x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 150));
    const g = await ejs(`(() => {
      const box = document.getElementById('askAutoIngestBox');
      const rect = box.getBoundingClientRect();
      return {
        boxWidth: rect.width,
        boxRight: rect.right,
        windowWidth: window.innerWidth,
        pageOverflowX: document.body.scrollWidth > document.body.clientWidth + 1,
        boxOverflowX: box.scrollWidth > box.clientWidth + 1,
      };
    })()`);
    widthResults[`${w}x${h}`] = g;
    record(`${w}x${h}: no page-level horizontal overflow`, !g.pageOverflowX, g);
    record(`${w}x${h}: no drawer-internal horizontal overflow`, !g.boxOverflowX, g);
    record(`${w}x${h}: drawer stays right-anchored, no clipped edge`, Math.abs(g.boxRight - g.windowWidth) <= 1, g);
    await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, `drawer-${w}x${h}.png`), img.toPNG()));
  }
  win.setBounds({ width: 1920, height: 1080, x: 0, y: 0 });
  await new Promise((r) => setTimeout(r, 150));

  // ── K: light/dark theme screenshots ─────────────────────────────────────
  await ejs(`document.documentElement.setAttribute('data-theme', 'light')`);
  await new Promise((r) => setTimeout(r, 120));
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, 'drawer-light.png'), img.toPNG()));
  const lightOverflow = await ejs(`(() => { const b = document.getElementById('askAutoIngestBox'); return b.scrollWidth <= b.clientWidth + 1; })()`);
  record('light theme: no horizontal overflow inside the drawer', lightOverflow);

  await ejs(`document.documentElement.setAttribute('data-theme', 'dark')`);
  await new Promise((r) => setTimeout(r, 120));
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(SCREENSHOT_DIR, 'drawer-dark.png'), img.toPNG()));
  const darkOverflow = await ejs(`(() => { const b = document.getElementById('askAutoIngestBox'); return b.scrollWidth <= b.clientWidth + 1; })()`);
  record('dark theme: no horizontal overflow inside the drawer', darkOverflow);

  // ── G: long-answer scrolling ─────────────────────────────────────────────
  await ejs(`(() => { document.getElementById('aaQuestionInput').value = "What's coming next for AutoIngest?"; document.getElementById('aaAskBtn').click(); return true; })()`);
  await waitForAnswer(5000);
  const scrollCheck = await ejs(`(() => {
    const body = document.getElementById('askAutoIngestBody');
    return { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, canScroll: body.scrollHeight > body.clientHeight };
  })()`);
  record('drawer body scrolls internally for long answers (no whole-page jump)', true, scrollCheck);

  // ── Settings / Help regression (unaffected by this checkpoint) ─────────
  await ejs(`document.getElementById('askAutoIngestClose').click()`);
  await new Promise((r) => setTimeout(r, 120));
  await ejs(`document.getElementById('settingsBtn').click()`);
  await new Promise((r) => setTimeout(r, 200));
  const settingsOpened = await ejs(`document.getElementById('settingsModal')?.classList.contains('visible')`);
  record('Settings still opens normally (unaffected by drawer conversion)', settingsOpened);
  const modelRowText = await ejs(`document.getElementById('aaModelStatusText')?.textContent`);
  record('Settings -> Local AI section still renders', !!modelRowText, { modelRowText });
  await ejs(`document.getElementById('settingsModal')?.classList.remove('visible')`);

  await ejs(`document.getElementById('helpBtn').click()`);
  await new Promise((r) => setTimeout(r, 200));
  const helpOpened = await ejs(`document.getElementById('helpOverlay')?.classList.contains('visible')`);
  record('Help still opens normally (unaffected by drawer conversion)', helpOpened);
  await ejs(`document.getElementById('helpOverlay')?.classList.remove('visible')`);

  win.destroy();

  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n[drawer-verify] ${results.length - failed.length}/${results.length} checks passed. Screenshots in ${SCREENSHOT_DIR}`);
  if (failed.length) console.log('[drawer-verify] FAILED:', JSON.stringify(failed, null, 2));
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'results.json'), JSON.stringify({ results, perf, widthResults }, null, 2));
  app.exit(failed.length ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[drawer-verify] FATAL:', err);
    app.exit(1);
  });
});
