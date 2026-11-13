'use strict';

// AI-FEAT-064 EQI-1.1 — adaptive menu-bar companion: popup sizing per presentation, the
// photographer search ranking, the companion-owned event picker (listEvents / chooseEvent) and
// the handoff's foreground option (Import to Dump must not bring the main window forward).
// Pure Node; no Electron, no card, no archive.
// Run: node test/eqiCompanionAdaptiveEQI11.test.js

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { POPUP_SIZES, computePopupSize, computePopupPosition } = require('../services/companionModel');
const { matchPhotographers } = require('../renderer/companion/photographerMatch');
const { createEventDumpController } = require('../services/eventDumpCompanion');
const { createWorkspaceHandoff } = require('../services/workspaceHandoff');
const { classify, normalizeSelection } = require('../services/dateAssessmentModel');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  console.log('eqiCompanionAdaptiveEQI11');

  // ── Popup sizing ──────────────────────────────────────────────────────────
  await t('computePopupSize: compact ~360 px and expanded ~620 px on an ordinary display', () => {
    const wa = { x: 0, y: 25, width: 1512, height: 944 };
    assert.deepEqual(computePopupSize('compact', wa), { width: 360, height: 600 });
    assert.deepEqual(computePopupSize('expanded', wa), { width: 620, height: 720 });
    assert.ok(POPUP_SIZES.compact.width >= 340 && POPUP_SIZES.compact.width <= 380);
    assert.ok(POPUP_SIZES.expanded.width >= 580 && POPUP_SIZES.expanded.width <= 650);
    assert.deepEqual(computePopupSize('nonsense', wa), computePopupSize('compact', wa), 'unknown view → compact');
  });

  await t('computePopupSize: fits short and narrow work areas (never larger than the display)', () => {
    const short = computePopupSize('expanded', { x: 0, y: 25, width: 1280, height: 690 });
    assert.equal(short.width, 620);
    assert.ok(short.height <= 690 - 24 - 6, `height ${short.height}`);
    const tiny = computePopupSize('expanded', { x: 0, y: 0, width: 560, height: 400 });
    assert.ok(tiny.width <= 560 - 24);
    assert.equal(tiny.height, POPUP_SIZES.expanded.minHeight, 'keeps a usable minimum height');
  });

  await t('expanded popup stays anchored under the tray icon and inside the work area (both displays)', () => {
    const displays = [
      { workArea: { x: 0, y: 25, width: 1512, height: 944 }, tray: { x: 1300, y: 0, width: 24, height: 24 } },
      { workArea: { x: -1920, y: 25, width: 1920, height: 1055 }, tray: { x: -40, y: 0, width: 24, height: 24 } },
    ];
    for (const d of displays) {
      for (const view of ['compact', 'expanded']) {
        const size = computePopupSize(view, d.workArea);
        const pos = computePopupPosition({ trayBounds: d.tray, workArea: d.workArea, platform: 'darwin', ...size });
        assert.equal(pos.y, d.tray.y + d.tray.height + 6, 'hangs below the menu bar icon');
        assert.ok(pos.x >= d.workArea.x && pos.x + size.width <= d.workArea.x + d.workArea.width, `${view} inside ${JSON.stringify(d.workArea)}`);
      }
    }
  });

  // ── Photographer search ───────────────────────────────────────────────────
  const names = ['Ali Bhai', 'Husain Bhai Rampurawala', 'M Murtaza Khazanchi', 'Murtaza Lokhandwala', 'Zahra Ben', 'Ãmmar Shakir'];

  await t('matchPhotographers: case-insensitive, partial and word-based; a stored prefix can be left out', () => {
    assert.deepEqual(matchPhotographers(names, 'murtaza kha'), ['M Murtaza Khazanchi', 'Murtaza Lokhandwala'], 'word-prefix match ranks above a mid-word one');
    assert.deepEqual(matchPhotographers(names, 'KHAZ'), ['M Murtaza Khazanchi']);
    assert.deepEqual(matchPhotographers(names, 'murtaza'), ['Murtaza Lokhandwala', 'M Murtaza Khazanchi'], 'starts-with ranks above a later word');
    assert.deepEqual(matchPhotographers(names, 'bhai'), ['Ali Bhai', 'Husain Bhai Rampurawala']);
    assert.deepEqual(matchPhotographers(names, 'ammar'), ['Ãmmar Shakir'], 'accents fold');
    assert.deepEqual(matchPhotographers(names, 'rampur husain'), ['Husain Bhai Rampurawala'], 'word order does not matter');
  });

  await t('matchPhotographers: exact first; empty query and no match give nothing; never invents a name', () => {
    assert.deepEqual(matchPhotographers(['Ali Bhai Senior', 'Ali Bhai'], 'ali bhai'), ['Ali Bhai', 'Ali Bhai Senior']);
    assert.deepEqual(matchPhotographers(names, ''), []);
    assert.deepEqual(matchPhotographers(names, '   '), []);
    assert.deepEqual(matchPhotographers(names, 'nobody here'), []);
    assert.deepEqual(matchPhotographers(null, 'ali'), []);
    for (const r of matchPhotographers(names, 'a')) assert.ok(names.includes(r));
  });

  await t('matchPhotographers: large lists stay fast and are capped', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `Photographer ${String(i).padStart(4, '0')} Bhai`);
    const t0 = process.hrtime.bigint();
    const r = matchPhotographers(big, 'bhai');
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(r.length, 50);
    assert.equal(matchPhotographers(big, 'photographer 0042').length, 1);
    assert.ok(ms < 200, `${ms.toFixed(1)} ms`);
  });

  // ── Companion-owned event picker ──────────────────────────────────────────
  function harness({ scanned, scanThrows = false, noScan = false } = {}) {
    const sent = [];
    let finish = null;
    const handoff = {
      active: null,
      getActive() { return this.active; },
      request(kind, opts) {
        sent.push({ kind, opts, msg: opts.payload(9) });
        this.active = { kind };
        const done = new Promise(r => { finish = (res) => { handoff.active = null; r(res); }; });
        return { started: true, operation: {}, done };
      },
    };
    const c = createEventDumpController({
      handoff,
      getCard: () => null,
      verifyJob: async () => null,
      classify,
      selectionFor: () => normalizeSelection(null, '2026-11-13'),
      isImported: () => false,
      listPhotographers: () => [],
      isBusy: () => false,
      pushSnapshot: () => {},
      showPopup: () => {},
      hidePopup: () => {},
      ...(noScan ? {} : { scanEvents: async (p) => { if (scanThrows) throw new Error('x'); return scanned(p); } }),
    });
    return { c, sent, finish: (r) => finish(r) };
  }
  const LONG = '1448-05-21 _01-Urs Mubarak-Syedna Taher Saifuddin RA-Raudat Tahera-Mumbai-Majlis-Waaz';
  const scanned = () => [
    { folderName: '1448-05-20 _01-Waaz-Surat', hijriDate: '1448-05-20', isFromJson: true },
    { folderName: LONG, hijriDate: '1448-05-21', isFromJson: true },
    { folderName: 'random folder', isFromJson: false },
    { folderName: '1448-05-19 _01-Broken', isFromJson: true, isCorrupt: true },
  ];

  await t('listEvents: only valid events of the active collection, newest first; no event → refused', async () => {
    const h = harness({ scanned });
    assert.equal((await h.c.listEvents()).reason, 'no-event');
    h.c.onWorkspaceEvent({ eventPath: '/Arc/1448 Coll/1448-05-20 _01-Waaz-Surat', eventName: '1448-05-20 _01-Waaz-Surat', collectionName: '1448 Coll' });
    const r = await h.c.listEvents();
    assert.equal(r.ok, true);
    assert.equal(r.collectionName, '1448 Coll');
    assert.equal(r.active, '1448-05-20 _01-Waaz-Surat');
    assert.deepEqual(r.events.map(e => e.folderName), [LONG, '1448-05-20 _01-Waaz-Surat']);
    assert.ok(!JSON.stringify(r).includes('/Arc'), 'no filesystem path reaches the popup');
    assert.equal((await harness({ noScan: true }).c.listEvents()).reason, 'no-event');
    const hf = harness({ scanned, scanThrows: true });
    hf.c.onWorkspaceEvent({ eventPath: '/Arc/C/E', eventName: 'E' });
    assert.equal((await hf.c.listEvents()).reason, 'scan-failed');
  });

  await t('chooseEvent: validates input, only listed events, and selects WITHOUT foregrounding the main window', async () => {
    const h = harness({ scanned });
    h.c.onWorkspaceEvent({ eventPath: '/Arc/1448 Coll/1448-05-20 _01-Waaz-Surat', eventName: '1448-05-20 _01-Waaz-Surat', collectionName: '1448 Coll' });
    assert.equal((await h.c.chooseEvent({ folderName: LONG })).reason, 'not-listed', 'nothing listed yet');
    await h.c.listEvents();
    assert.equal((await h.c.chooseEvent({ folderName: LONG, eventPath: '/etc' })).reason, 'invalid');
    assert.equal((await h.c.chooseEvent(null)).reason, 'invalid');
    assert.equal((await h.c.chooseEvent({ folderName: 'random folder' })).reason, 'not-listed');
    assert.equal((await h.c.chooseEvent({ folderName: '../x' })).reason, 'not-listed');
    assert.equal((await h.c.chooseEvent({ folderName: '1448-05-20 _01-Waaz-Surat' })).state, 'completed', 'the current event: nothing to do');
    assert.equal(h.sent.length, 0);

    const p = h.c.chooseEvent({ folderName: LONG });
    await tick();
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].kind, 'event-select');
    assert.equal(h.sent[0].opts.foreground, false);
    assert.equal(h.sent[0].opts.channel, 'companion:selectEvent');
    assert.deepEqual(h.sent[0].msg, { requestId: 9, collectionPath: '/Arc/1448 Coll', collectionName: '1448 Coll', folderName: LONG });
    assert.equal((await h.c.chooseEvent({ folderName: '1448-05-20 _01-Waaz-Surat' })).reason, 'busy', 'one request at a time');
    h.finish({ state: 'completed' });
    assert.deepEqual(await p, { state: 'completed', reason: null });
  });

  await t('chooseEvent: an open Import workspace falls back to the main window\'s existing event picker', async () => {
    const h = harness({ scanned });
    h.c.onWorkspaceEvent({ eventPath: '/Arc/1448 Coll/1448-05-20 _01-Waaz-Surat', eventName: 'x', collectionName: '1448 Coll' });
    await h.c.listEvents();
    const p = h.c.chooseEvent({ folderName: LONG });
    await tick();
    h.finish({ state: 'refused', reason: 'workspace-open' });
    await tick(); await tick();
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent[1].kind, 'event-picker');
    assert.notEqual(h.sent[1].opts.foreground, false, 'the fallback opens the main window');
    h.finish({ state: 'completed' });
    await p;
  });

  // ── Handoff foreground option ─────────────────────────────────────────────
  function handoffRig() {
    const ipc = new EventEmitter();
    const wc = new EventEmitter();
    Object.assign(wc, { id: 5, isDestroyed: () => false, isLoading: () => false, sent: [], send(ch, msg) { this.sent.push({ ch, msg }); } });
    const win = { isDestroyed: () => false, webContents: wc };
    let opened = 0;
    const h = createWorkspaceHandoff({ ipcMain: ipc, getMainWindow: () => win, openApp: () => { opened++; }, isBusy: () => false, readyTimeoutMs: 2000 });
    h.register();
    ipc.emit('companion:workspaceReady', { sender: wc });
    return { ipc, wc, h, opened: () => opened };
  }

  await t('workspaceHandoff: foreground:false reaches a ready main window without opening/focusing it', async () => {
    const r = handoffRig();
    const s = r.h.request('dump-import', { sourceId: 's', channel: 'companion:dumpImport', foreground: false, payload: (id) => ({ requestId: id }) });
    for (let i = 0; i < 50 && !r.wc.sent.length; i++) await new Promise(res => setTimeout(res, 20));
    assert.equal(r.wc.sent[0].ch, 'companion:dumpImport');
    assert.equal(r.opened(), 0, 'main window not brought forward');
    r.ipc.emit('companion:openSourceResult', { sender: r.wc }, { requestId: r.wc.sent[0].msg.requestId, result: { ok: true } });
    assert.equal((await s.done).state, 'completed');
  });

  await t('workspaceHandoff: the default still opens AutoIngest (Review handoff and pickers unchanged)', async () => {
    const r = handoffRig();
    const s = r.h.request('event-picker', { channel: 'companion:openEventPicker', payload: (id) => ({ requestId: id }) });
    for (let i = 0; i < 50 && !r.wc.sent.length; i++) await new Promise(res => setTimeout(res, 20));
    assert.equal(r.opened(), 1);
    r.ipc.emit('companion:openSourceResult', { sender: r.wc }, { requestId: r.wc.sent[0].msg.requestId, result: {} });
    await s.done;
  });

  console.log(`\n${passed} passed`);
})();
