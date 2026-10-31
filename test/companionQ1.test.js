'use strict';

// AI-FEAT-061 Q1 — unit tests for the Electron-free parts of the menu-bar/tray
// companion foundation: the single shared drive poller (sourceMonitorService), the
// attachment tracker (sourceId per mount instance, label collisions), the path-free
// popup snapshot and popup positioning (companionModel).
//
// Run: node test/companionQ1.test.js

const assert = require('node:assert/strict');
const { createSourceMonitor, createAttachmentTracker } = require('../services/sourceMonitorService');
const {
  buildSnapshot, computePopupPosition, formatCapacity, resolveTrayAnchor, createAutoOpenTracker, POPUP_WIDTH, POPUP_HEIGHT,
} = require('../services/companionModel');

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const card = (mountpoint, label = 'EOS_DIGITAL', size = 64e9) => ({ mountpoint, label, size });

function fakeWindow(id) {
  const sent = [];
  return {
    id,
    sent,
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    webContents: { isDestroyed: () => false, send: (ch, payload) => sent.push([ch, payload]) },
  };
}

function monitorWith({ drives = { dcim: [], removable: [] }, windows = [], intervalMs = 25, delayMs = 0 } = {}) {
  const state = { drives, calls: 0 };
  const monitor = createSourceMonitor({
    listDrives: async () => { state.calls++; if (delayMs) await sleep(delayMs); return state.drives; },
    getTargets: () => windows,
    intervalMs,
  });
  return { monitor, state };
}

(async () => {
  // ── Attachment tracker ──────────────────────────────────────────────────────
  await t('a mount keeps the same sourceId across polls', () => {
    const tr = createAttachmentTracker();
    const a = tr.update([card('/Volumes/A')]);
    const b = tr.update([card('/Volumes/A')]);
    assert.equal(a[0].sourceId, b[0].sourceId);
  });

  await t('eject + reinsert is a NEW attachment (new sourceId)', () => {
    const tr = createAttachmentTracker();
    const first = tr.update([card('/Volumes/A')])[0].sourceId;
    tr.update([]);
    const again = tr.update([card('/Volumes/A')])[0].sourceId;
    assert.notEqual(first, again);
  });

  await t('two cards with the same label get distinct ids and labelCollision=true', () => {
    const tr = createAttachmentTracker();
    const out = tr.update([card('/Volumes/EOS_DIGITAL'), card('/Volumes/EOS_DIGITAL 1')]);
    assert.equal(out.length, 2);
    assert.notEqual(out[0].sourceId, out[1].sourceId);
    assert.ok(out.every(c => c.labelCollision === true));
  });

  await t('distinct labels are not collisions; one card leaving clears the collision', () => {
    const tr = createAttachmentTracker();
    tr.update([card('/Volumes/A', 'X'), card('/Volumes/B', 'X')]);
    const out = tr.update([card('/Volumes/A', 'X'), card('/Volumes/C', 'Y')]);
    assert.deepEqual(out.map(c => c.labelCollision), [false, false]);
  });

  await t('malformed entries and duplicate mounts are ignored', () => {
    const tr = createAttachmentTracker();
    const out = tr.update([null, {}, { mountpoint: '' }, card('/Volumes/A'), card('/Volumes/A')]);
    assert.equal(out.length, 1);
  });

  // ── Single shared poller ────────────────────────────────────────────────────
  await t('poller does not run until a consumer acquires it', async () => {
    const { monitor, state } = monitorWith();
    await sleep(80);
    assert.equal(state.calls, 0);
    assert.equal(monitor.getDiagnostics().running, false);
  });

  await t('two consumers share ONE interval (poll rate does not double)', async () => {
    const one = monitorWith({ intervalMs: 40 });
    await one.monitor.acquire('main-window');
    await sleep(230);
    const singleRate = one.state.calls;
    one.monitor.release('main-window');

    const two = monitorWith({ intervalMs: 40 });
    await two.monitor.acquire('main-window');
    await two.monitor.acquire('companion');
    await sleep(230);
    const sharedRate = two.state.calls;
    two.monitor.release('main-window');
    two.monitor.release('companion');
    // Second acquire adds exactly one immediate poll, never a second interval.
    assert.ok(sharedRate <= singleRate + 2, `single=${singleRate} shared=${sharedRate}`);
    assert.deepEqual(two.monitor.getDiagnostics().consumers, []);
  });

  await t('acquire is idempotent per consumer name', async () => {
    const { monitor } = monitorWith();
    await monitor.acquire('main-window');
    await monitor.acquire('main-window');
    assert.deepEqual(monitor.getDiagnostics().consumers, ['main-window']);
    monitor.release('main-window');
    assert.equal(monitor.getDiagnostics().running, false);
  });

  await t('poller keeps running while ANY consumer remains (main window closed, companion still open)', async () => {
    const { monitor, state } = monitorWith({ intervalMs: 20 });
    await monitor.acquire('main-window');
    await monitor.acquire('companion');
    monitor.release('main-window');
    const before = state.calls;
    await sleep(120);
    assert.ok(state.calls > before, 'still polling after main-window release');
    monitor.release('companion');
    const stopped = state.calls;
    await sleep(80);
    assert.equal(state.calls, stopped, 'stopped after last release');
  });

  await t('concurrent pollNow calls share one in-flight poll (no overlapping drivelist calls)', async () => {
    const { monitor, state } = monitorWith({ delayMs: 40, intervalMs: 10000 });
    await Promise.all([monitor.pollNow(), monitor.pollNow(), monitor.pollNow()]);
    assert.equal(state.calls, 1);
  });

  await t('broadcast contract unchanged: drives:updated then drives:allUpdated, same payloads, every target window', async () => {
    const dcim = [card('/Volumes/A')];
    const removable = [{ mountpoint: '/Volumes/A', label: 'EOS_DIGITAL' }, { mountpoint: '/Volumes/SSD', label: 'SSD' }];
    const w1 = fakeWindow(1);
    const w2 = fakeWindow(2);
    const { monitor } = monitorWith({ drives: { dcim, removable }, windows: [w1, w2], intervalMs: 10000 });
    await monitor.acquire('main-window');
    for (const w of [w1, w2]) {
      assert.deepEqual(w.sent.map(s => s[0]), ['drives:updated', 'drives:allUpdated']);
      assert.equal(w.sent[0][1], dcim, 'same dcim array object as the detector returned');
      assert.equal(w.sent[1][1], removable);
    }
    monitor.release('main-window');
  });

  await t('destroyed windows are skipped', async () => {
    const w1 = fakeWindow(1);
    w1.destroyed = true;
    const { monitor } = monitorWith({ windows: [w1], intervalMs: 10000 });
    await monitor.acquire('main-window');
    assert.equal(w1.sent.length, 0);
    monitor.release('main-window');
  });

  await t('subscribers get tracked cards; a throwing subscriber does not break others or the broadcast', async () => {
    const w = fakeWindow(1);
    const { monitor } = monitorWith({ drives: { dcim: [card('/Volumes/A')], removable: [] }, windows: [w], intervalMs: 10000 });
    const seen = [];
    monitor.subscribe(() => { throw new Error('boom'); });
    const unsub = monitor.subscribe((latest) => seen.push(latest));
    await monitor.acquire('companion');
    assert.equal(seen.length, 1);
    assert.match(seen[0].cards[0].sourceId, /^src-\d+$/);
    assert.equal(w.sent.length, 2);
    unsub();
    await monitor.pollNow();
    assert.equal(seen.length, 1, 'unsubscribed');
    monitor.release('companion');
  });

  await t('a failing drive listing is contained (no throw, no broadcast)', async () => {
    const w = fakeWindow(1);
    const monitor = createSourceMonitor({
      listDrives: async () => { throw new Error('drivelist exploded'); },
      getTargets: () => [w],
      intervalMs: 10000,
    });
    const origError = console.error;
    console.error = () => {};
    try { await monitor.acquire('main-window'); } finally { console.error = origError; }
    assert.equal(w.sent.length, 0);
    monitor.release('main-window');
  });

  await t('last release clears cached state (a stale card is never reported)', async () => {
    const { monitor } = monitorWith({ drives: { dcim: [card('/Volumes/A')], removable: [] }, intervalMs: 10000 });
    await monitor.acquire('companion');
    assert.equal(monitor.getLatest().cards.length, 1);
    monitor.release('companion');
    assert.equal(monitor.getLatest().cards.length, 0);
  });

  // ── Snapshot (the only data the popup receives) ─────────────────────────────
  await t('snapshot: no-card state', () => {
    const s = buildSnapshot({ cards: [], polledAt: null });
    assert.equal(s.schemaVersion, 2, 'v2 (Q2) is additive: sources[].assessment');
    assert.deepEqual(s.sources, []);
    assert.deepEqual(s.capabilities, { contentIdentity: false, verificationReceipts: false, sourceHistory: false });
    assert.equal(s.archive, null, 'archive status is Q3 — absent, not guessed');
  });

  await t('snapshot: never contains a filesystem path', () => {
    const tr = createAttachmentTracker();
    const s = buildSnapshot({ cards: tr.update([card('/Volumes/EOS_DIGITAL'), card('/Volumes/EOS_DIGITAL 1')]), polledAt: 'x' });
    const json = JSON.stringify(s);
    assert.ok(!json.includes('/Volumes'), json);
    assert.ok(!/mountpoint/i.test(json), json);
  });

  await t('snapshot: disambiguator only on label collision; status is "detected" only', () => {
    const tr = createAttachmentTracker();
    const both = buildSnapshot({ cards: tr.update([card('/Volumes/A', 'EOS', 64e9), card('/Volumes/B', 'EOS', 128e9)]) });
    assert.deepEqual(both.sources.map(s => s.disambiguator), ['64 GB', '128 GB']);
    const solo = buildSnapshot({ cards: createAttachmentTracker().update([card('/Volumes/A', 'EOS')]) });
    assert.equal(solo.sources[0].disambiguator, null);
    assert.deepEqual(Object.keys(solo.sources[0].evidence), ['detected']);
  });

  await t('snapshot: missing label falls back to a neutral name', () => {
    const s = buildSnapshot({ cards: [{ sourceId: 'src-1', label: '', labelCollision: false }] });
    assert.equal(s.sources[0].label, 'Unnamed card');
  });

  await t('formatCapacity', () => {
    assert.equal(formatCapacity(64e9), '64 GB');
    assert.equal(formatCapacity(2e12), '2.0 TB');
    assert.equal(formatCapacity(0), null);
    assert.equal(formatCapacity(undefined), null);
  });

  // ── Popup positioning ───────────────────────────────────────────────────────
  const screen = { x: 0, y: 0, width: 1440, height: 900 };
  await t('macOS: popup hangs below the menu-bar icon, centred', () => {
    const p = computePopupPosition({ trayBounds: { x: 1000, y: 0, width: 22, height: 24 }, workArea: { ...screen, y: 25, height: 875 }, platform: 'darwin' });
    assert.equal(p.x, Math.round(1011 - POPUP_WIDTH / 2));
    assert.equal(p.y, 30);
  });

  await t('Windows, bottom taskbar: popup sits above the tray icon', () => {
    const p = computePopupPosition({ trayBounds: { x: 1300, y: 860, width: 24, height: 40 }, workArea: { ...screen, height: 860 }, platform: 'win32' });
    assert.equal(p.y, 860 - POPUP_HEIGHT - 6);
    assert.ok(p.x + POPUP_WIDTH <= 1440);
  });

  await t('Windows, top taskbar: popup sits below the tray icon', () => {
    const p = computePopupPosition({ trayBounds: { x: 1300, y: 0, width: 24, height: 40 }, workArea: { ...screen, y: 40, height: 860 }, platform: 'win32' });
    assert.equal(p.y, 46);
  });

  await t('popup is clamped inside the work area at screen edges', () => {
    const p = computePopupPosition({ trayBounds: { x: 1430, y: 0, width: 22, height: 24 }, workArea: screen, platform: 'darwin' });
    assert.equal(p.x, 1440 - POPUP_WIDTH);
    const q = computePopupPosition({ trayBounds: { x: 0, y: 0, width: 22, height: 24 }, workArea: screen, platform: 'darwin' });
    assert.equal(q.x, 0);
  });

  // ── Request-window routing (windowRegistry.getRequestWindow) ────────────────
  // windowRegistry needs only BrowserWindow.getFocusedWindow/fromWebContents/getAllWindows;
  // a stand-in electron module is placed in the require cache for this block.
  const fakeBW = { focused: null, all: [], getFocusedWindow() { return this.focused; }, getAllWindows() { return this.all; }, fromWebContents(wc) { return this.all.find(w => w.webContents === wc) || null; } };
  require.cache[require.resolve('electron')] = { id: 'electron', filename: 'electron', loaded: true, exports: { BrowserWindow: fakeBW } };
  const reg = require('../services/windowRegistry');
  const win = (id) => ({ id, destroyed: false, isDestroyed() { return this.destroyed; }, once() {}, webContents: { id, isDestroyed: () => false } });
  const mainW = win(1), popupW = win(2), splashW = win(3);
  fakeBW.all = [mainW, popupW, splashW];
  reg.registerAuxiliary(popupW);
  const fromSender = (w) => ({ sender: w.webContents });

  await t('getRequestWindow: no auxiliary focused → exactly getFocusedWindow() (Stable behaviour)', () => {
    fakeBW.focused = mainW; assert.equal(reg.getRequestWindow(fromSender(mainW)), mainW);
    fakeBW.focused = splashW; assert.equal(reg.getRequestWindow(fromSender(mainW)), splashW);
    fakeBW.focused = null; assert.equal(reg.getRequestWindow(fromSender(mainW)), null);
  });

  await t('getRequestWindow: popup focused → the requesting app window, never the popup', () => {
    fakeBW.focused = popupW;
    assert.equal(reg.getRequestWindow(fromSender(mainW)), mainW);
    assert.equal(reg.getRequestWindow(fromSender(splashW)), splashW);
  });

  await t('getRequestWindow: popup focused and sender unusable → null (parentless dialog / no-op)', () => {
    fakeBW.focused = popupW;
    assert.equal(reg.getRequestWindow(fromSender(popupW)), null);
    assert.equal(reg.getRequestWindow(undefined), null);
    mainW.destroyed = true;
    assert.equal(reg.getRequestWindow(fromSender(mainW)), null);
    mainW.destroyed = false;
  });

  await t('getAppWindows excludes the popup (update/realtime broadcast recipients)', () => {
    assert.deepEqual(reg.getAppWindows(), [mainW, splashW]);
  });

  // ── Windows tray icon asset ─────────────────────────────────────────────────
  await t('assets/tray/tray.ico holds square PNG frames for 100–300 % scaling (16…48 px)', () => {
    const ico = require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'tray', 'tray.ico'));
    assert.equal(ico.readUInt16LE(2), 1, 'ICO type');
    const frames = [];
    for (let i = 0; i < ico.readUInt16LE(4); i++) {
      const o = 6 + 16 * i;
      const off = ico.readUInt32LE(o + 12);
      const png = ico.subarray(off, off + 24);
      assert.equal(png.subarray(1, 4).toString(), 'PNG', `frame ${i} is PNG`);
      const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
      assert.equal(w, h, `frame ${i} is square`);
      assert.equal(w, ico[o] || 256, `frame ${i} directory size matches image`);
      frames.push(w);
    }
    assert.deepEqual(frames, [16, 20, 24, 32, 40, 48]);
  });

  // ── Automatic card popup: connection identity / deduplication ───────────────
  const ids = (...list) => list.map(sourceId => ({ sourceId }));

  await t('auto-open: cards already connected at startup are a baseline, not connection events', () => {
    const tr = createAutoOpenTracker();
    assert.deepEqual(tr.observe(ids('src-1', 'src-2')), []);
    assert.deepEqual(tr.observe(ids('src-1', 'src-2')), []);
  });

  await t('auto-open: a newly inserted card is reported exactly once, never on later polls', () => {
    const tr = createAutoOpenTracker();
    tr.observe([]);
    assert.deepEqual(tr.observe(ids('src-1')), ['src-1']);
    for (let i = 0; i < 5; i++) assert.deepEqual(tr.observe(ids('src-1')), []);
  });

  await t('auto-open: removal + reinsertion (fresh attachment id) is a new connection', () => {
    const tr = createAutoOpenTracker();
    tr.observe([]);
    tr.observe(ids('src-1'));
    assert.deepEqual(tr.observe([]), []);
    assert.deepEqual(tr.observe(ids('src-2')), ['src-2']);
  });

  await t('auto-open: several cards — one event per new card, existing ones ignored', () => {
    const tr = createAutoOpenTracker();
    tr.observe(ids('src-1'));
    assert.deepEqual(tr.observe(ids('src-1', 'src-2', 'src-3')), ['src-2', 'src-3']);
    assert.deepEqual(tr.observe(ids('src-1', 'src-3')), []);
  });

  await t('auto-open: end to end with the real attachment tracker (same mount keeps its id)', () => {
    const at = createAttachmentTracker();
    const tr = createAutoOpenTracker();
    tr.observe(at.update([]));
    assert.equal(tr.observe(at.update([card('/Volumes/EOS_DIGITAL')])).length, 1);
    assert.equal(tr.observe(at.update([card('/Volumes/EOS_DIGITAL')])).length, 0, 'repeated poll');
    tr.observe(at.update([]));
    assert.equal(tr.observe(at.update([card('/Volumes/EOS_DIGITAL')])).length, 1, 'reinserted');
    assert.equal(tr.observe(at.update([card('/Volumes/EOS_DIGITAL'), card('/Volumes/EOS_DIGITAL 1')])).length, 1, 'second card, same label');
  });

  await t('auto-open: malformed input never throws and never reports an event', () => {
    const tr = createAutoOpenTracker();
    tr.observe(null);
    assert.deepEqual(tr.observe([null, {}, { sourceId: '' }]), []);
  });

  // ── Popup anchor when the tray icon is hidden ───────────────────────────────
  const displays = [
    { bounds: { x: 0, y: 0, width: 2560, height: 1080 }, workArea: { x: 0, y: 30, width: 2500, height: 1050 } },
    { bounds: { x: -1512, y: 0, width: 1512, height: 982 }, workArea: { x: -1512, y: 33, width: 1512, height: 949 } },
  ];
  await t('anchor: a visible tray icon is used as-is', () => {
    const tb = { x: 2000, y: 0, width: 34, height: 30 };
    assert.deepEqual(resolveTrayAnchor({ trayBounds: tb, displays, primary: displays[0], platform: 'darwin' }), tb);
  });

  await t('anchor: icon pushed off-screen by a menu-bar manager → right end of the primary menu bar (measured case x=-3394)', () => {
    const a = resolveTrayAnchor({ trayBounds: { x: -3394, y: 0, width: 34, height: 30 }, displays, primary: displays[0], platform: 'darwin' });
    assert.deepEqual(a, { x: 2538, y: 0, width: 22, height: 30 });
    const pos = computePopupPosition({ trayBounds: a, workArea: displays[0].workArea, platform: 'darwin' });
    assert.ok(pos.x + POPUP_WIDTH <= 2500 && pos.y >= 30, JSON.stringify(pos));
  });

  await t('anchor: zero-size bounds (no icon geometry) fall back too; Windows uses the taskbar corner', () => {
    const a = resolveTrayAnchor({ trayBounds: { x: 0, y: 0, width: 0, height: 0 }, displays, primary: displays[0], platform: 'win32' });
    assert.deepEqual(a, { x: 2478, y: 1080, width: 22, height: 22 });
  });

  // ── Operator activity (automatic-popup suppression) ─────────────────────────
  await t('operatorActivity: busy exactly while a wrapped handler runs; result and errors pass through', async () => {
    const activity = require('../services/operatorActivity');
    let release;
    const wrapped = activity.wrap('import', (a, b) => new Promise(r => { release = () => r(a + b); }));
    assert.equal(activity.isBusy(), false);
    const p = wrapped(2, 3);
    assert.equal(activity.isBusy(), true);
    assert.deepEqual(activity.activeKinds(), ['import']);
    release();
    assert.equal(await p, 5);
    assert.equal(activity.isBusy(), false);
    const failing = activity.wrap('dialog', async () => { throw new Error('boom'); });
    await assert.rejects(failing(), /boom/);
    assert.equal(activity.isBusy(), false, 'cleared after a rejection');
  });

  console.log(`${passed} passed`);
})();
