'use strict';

// AI-FEAT-061 Q1 — unit tests for the Electron-free parts of the menu-bar/tray
// companion foundation: the single shared drive poller (sourceMonitorService), the
// attachment tracker (sourceId per mount instance, label collisions), the path-free
// popup snapshot and popup positioning (companionModel).
//
// Run: node test/companionQ1.test.js

const assert = require('node:assert/strict');
const { createSourceMonitor, createAttachmentTracker } = require('../services/sourceMonitorService');
const { buildSnapshot, computePopupPosition, formatCapacity, POPUP_WIDTH, POPUP_HEIGHT } = require('../services/companionModel');

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
    assert.equal(s.schemaVersion, 1);
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

  console.log(`${passed} passed`);
})();
