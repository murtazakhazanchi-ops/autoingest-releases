/**
 * eventDumpDivide.js — "Divide Photos Between Events" for the menu-bar companion
 * (AI-FEAT-064 EQI-2, Multi-Event Quick Assignment). Main process only; wired by companionService.
 *
 * OPTIONAL: the default Event Dump import (eventDumpCompanion.js) is unchanged — this only runs when
 * the operator chooses Divide Photos Between Events in the expanded Event Dump view.
 *
 *   - The operator's time ranges, per-range events, per-photo corrections and per-camera
 *     photographers live here, per card, until the card is removed (a new card never inherits them).
 *   - Assignment rules are eventDumpAssignmentModel.js (pure): half-open ranges, conflicts block the
 *     import, unreliable times are never range-assigned, RAW/JPEG pairs travel together.
 *   - Destinations are events of ONE collection (the active event's), chosen from the Event
 *     Creator's own scan; a new event is made with the existing Event Creator in the main window.
 *   - The import is ONE plan — a batch per (event, photographer) — executed by the main window's
 *     existing ImportSessionRunner and commitImportTransaction (destination 'dump'), so locks,
 *     Local First / Direct Archive, event.json, metadata, the import index and sync registration
 *     are the validated EQI-1 paths. Never PC-sequenced, never a component, never a source delete.
 *   - The popup only receives names, times and counts — never a path.
 */

'use strict';

const path = require('path');
const M = require('./eventDumpAssignmentModel');

const SOURCE_ID_RE = /^src-\d+$/;
const ID_RE = /^[a-z][0-9]{1,6}$/;
const MAX_RANGES = 24;
const MAX_ASSETS_PER_CALL = 2000;
const MAX_THUMBS_PER_CALL = 24;
const THUMB_CACHE = 400;
const NOTICE_TTL_MS = 30 * 60 * 1000;
const MAX_NAME_LEN = 200;

/**
 * @param {object} deps
 * @param {{ request: Function, getActive: Function }} deps.handoff
 * @param {(sourceId: string) => object|null} deps.getCard
 * @param {(sourceId: string) => object|null} deps.peekJob                current assessment job
 * @param {(sourceId: string) => Promise<object|null>} deps.verifyJob      complete, still-valid job
 * @param {(name: string, size: number) => boolean} deps.isImported
 * @param {() => string[]} deps.listPhotographers
 * @param {(collectionPath: string) => Promise<object[]>} deps.scanEvents  master:scanEvents core
 * @param {(job: object) => { cameraOf: (index: number) => string|null, labels: Map<string, string> }} deps.cameras
 * @param {(sourceId: string) => string|null} [deps.selectedDate]          the card's chosen shoot date (Q2)
 * @param {() => object|null} deps.getActiveEvent                          { eventPath, collectionName, pendingSync, localFirst }
 * @param {(sourceId: string) => string|null} deps.cardPhotographer        the card's confirmed photographer (Event Dump)
 * @param {(mode: 'new'|'choose') => Promise<object>} deps.openPicker      the existing event picker / Event Creator
 * @param {() => Promise<object>} [deps.archiveStatus]                     archive:getOperationsStatus
 * @param {(p: string) => Promise<number|null>} [deps.statSize]            current size of a source file
 * @param {(p: string) => Promise<string|null>} [deps.makeThumb]           small data-URL thumbnail
 * @param {(record: object) => void} [deps.journal]                        durable plan record (userData)
 * @param {() => boolean} deps.isBusy
 * @param {() => void} deps.pushSnapshot
 * @param {(opts?: object) => void} deps.showPopup
 * @param {(msg: string) => void} [deps.log]
 */
function createDivideController(deps) {
  const log = deps.log || (() => {});
  const statSize = deps.statSize || (async () => null);
  /** sourceId → session */
  const _sessions = new Map();
  /** sourceId → latest plan operation */
  const _ops = new Map();
  let _active = null;            // { sourceId, requestId, batches } while a plan import runs
  const _batchMeta = new Map();  // metadataBatchId → outcome (batch can finish before the result)

  const _photographers = () => {
    try { const l = deps.listPhotographers(); return Array.isArray(l) ? [...new Set(l.filter(n => typeof n === 'string' && n.trim()).map(n => n.trim()))] : []; }
    catch { return []; }
  };

  function _newSession(sourceId, ev) {
    return {
      sourceId,
      collectionPath: path.dirname(ev.eventPath),
      collectionName: ev.collectionName || path.basename(path.dirname(ev.eventPath)),
      viewDate: null,
      ranges: [],
      nextId: 1,
      overrides: new Map(),
      cameraPhotographers: new Map(),
      gapMinutes: null,
      dismissedGaps: new Set(),
      known: new Set([path.basename(ev.eventPath)]),   // destination folders the operator may pick
      pendingNewFor: null,
      notice: null,
      rev: 0,                                          // bumps on every change the popup must refetch for
      job: null, assets: null, undated: null, cameraLabels: new Map(),
      thumbs: new Map(),
    };
  }

  /** Assets for the session's card under the current import history (paths stay here). */
  function _assetsFor(s, job) {
    if (!job || job.state !== 'complete' || !Array.isArray(job.records)) return null;
    if (s.job !== job) {
      // A new assessment of the card: per-photo choices and thumbnails referred to the old asset
      // ids and are dropped; ranges are times and stay.
      if (s.job) { s.overrides.clear(); s.thumbs.clear(); }
      s.job = job;
      let cams = { cameraOf: () => null, labels: new Map() };
      try { cams = deps.cameras(job) || cams; } catch { /* no camera grouping */ }
      s.cameraLabels = cams.labels || new Map();
      const built = M.buildAssets(job.records, { isImported: () => false, cameraOf: cams.cameraOf });
      s.assets = built.assets; s.undated = built.undated;
    }
    // Import history changes as imports commit: refresh the per-file "already imported" flags.
    for (const a of s.assets) {
      for (const f of a.files) f.imported = !!deps.isImported(f.name, f.size);
      a.imported = a.files.every(f => f.imported);
      a.newFiles = a.files.filter(f => !f.imported).length;
    }
    return s.assets;
  }

  /**
   * The date shown: the operator's choice while it still has new photos; else the card's chosen shoot
   * date (Q2 selection, today by default); else the date with the most new photos.
   */
  function _ensureViewDate(s, assets) {
    const counts = new Map();
    for (const a of assets) if (!a.imported) counts.set(a.date, (counts.get(a.date) || 0) + 1);
    if (s.viewDate && counts.has(s.viewDate)) return;
    let chosen = null;
    try { chosen = deps.selectedDate ? deps.selectedDate(s.sourceId) : null; } catch { chosen = null; }
    s.viewDate = chosen && counts.has(chosen) ? chosen
      : counts.size ? [...counts].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? 1 : -1))[0][0] : null;
  }

  /** Distinct identified cameras among the new photos: 2+ → each camera's photographer is chosen. */
  function _cameraMode(s, assets) {
    const keys = new Map();
    let unidentified = 0;
    for (const a of assets) {
      if (a.imported) continue;
      if (a.camera) keys.set(a.camera, (keys.get(a.camera) || 0) + 1); else unidentified++;
    }
    if (keys.size < 2) return { mode: 'single', cameras: [] };
    const cams = [...keys].map(([key, count]) => ({ key, label: s.cameraLabels.get(key) || 'Camera', assets: count, photographer: s.cameraPhotographers.get(key) || null }));
    if (unidentified) cams.push({ key: 'unidentified', label: 'Camera not identified', assets: unidentified, photographer: s.cameraPhotographers.get('unidentified') || null });
    return { mode: 'per-camera', cameras: cams };
  }

  function _photographerFor(s, mode, sourceId) {
    const card = deps.cardPhotographer(sourceId);
    const names = new Set(_photographers());
    return (a) => {
      const name = mode === 'per-camera' ? s.cameraPhotographers.get(a.camera || 'unidentified') : card;
      return name && names.has(name) ? name : null;
    };
  }

  /** Everything the popup shows for one card's division — names, times and counts only. */
  function view(sourceId) {
    const s = _sessions.get(sourceId);
    if (!s) return null;
    const assets = _assetsFor(s, deps.peekJob(sourceId));
    const op = _ops.get(sourceId);
    const showOp = op && (op.state === 'pending' || Date.now() - op.at < NOTICE_TTL_MS);
    const base = {
      collectionName: s.collectionName, notice: s.notice, pendingNewFor: s.pendingNewFor, rev: s.rev,
      op: showOp ? { ...op, events: op.events.map(e => ({ ...e })) } : null,
    };
    if (!assets) return { ...base, ready: false };
    const res = M.assign(assets, s.ranges, s.overrides);
    const sum = M.summarize(assets, res, s.ranges);
    const cam = _cameraMode(s, assets);
    const { batches, missingPhotographer } = M.buildBatches(assets, res, _photographerFor(s, cam.mode, sourceId));
    const dates = new Map();
    for (const a of assets) {
      if (a.imported) continue;
      const d = dates.get(a.date) || { date: a.date, assets: 0, assigned: 0 };
      d.assets++;
      if (res.byAsset.get(a.id).eventId) d.assigned++;
      dates.set(a.date, d);
    }
    const dateList = [...dates.values()].sort((x, y) => (x.date < y.date ? 1 : -1));
    _ensureViewDate(s, assets);
    const overlapOf = (id) => res.overlaps.filter(o => o.a === id || o.b === id).map(o => ({ with: o.a === id ? o.b : o.a, sameEvent: o.sameEvent }));
    const ranges = s.ranges.map((r, i) => {
      const iv = M.rangeProblem(r) ? null : M.rangeInterval(r);
      const c = sum.ranges.get(r.id) || { assets: 0, files: 0, conflicts: 0 };
      return { id: r.id, n: i + 1, date: r.date, start: M.shortTime(r.start), end: M.shortTime(r.end), nextDay: !!(iv && iv.nextDay),
        eventId: r.eventId, problem: M.rangeProblem(r), assets: c.assets, files: c.files, conflicts: c.conflicts, overlaps: overlapOf(r.id) };
    });
    const events = [...sum.events].map(([eventId, c]) => ({
      eventId, assets: c.assets, files: c.files,
      photographers: batches.filter(b => b.eventId === eventId).map(b => ({ name: b.photographer, files: b.files.length })),
    }));
    const blockers = [];
    if (sum.conflicts.assets) blockers.push('conflicts');
    if (missingPhotographer) blockers.push(cam.mode === 'per-camera' ? 'camera-photographer' : 'no-photographer');
    if (!batches.length) blockers.push('nothing-assigned');
    if (s.ranges.some(r => r.eventId && !s.known.has(r.eventId))) blockers.push('event-unavailable');
    return {
      ...base,
      ready: true,
      viewDate: s.viewDate,
      dates: dateList,
      ranges,
      events,
      known: [...s.known].sort((x, y) => y.localeCompare(x)),
      unassigned: sum.unassigned,
      conflicts: sum.conflicts,
      imported: sum.imported,
      undated: s.undated,
      cameraMode: cam.mode,
      cameras: cam.cameras,
      photographer: deps.cardPhotographer(sourceId),
      gapMinutes: s.gapMinutes,
      gaps: s.gapMinutes && s.viewDate ? M.gapSuggestions(assets, { date: s.viewDate, minutes: s.gapMinutes, ranges: s.ranges, dismissed: s.dismissedGaps })
        .map(g => ({ key: g.key, atId: g.atId, time: M.shortTime(g.time), gapMinutes: g.gapMinutes, inRange: s.ranges.some(r => !M.rangeProblem(r) && (() => { const iv = M.rangeInterval(r); return iv.start < g.sec && g.sec < iv.end; })()) })) : [],
      review: {
        blockers,
        batches: batches.map(b => ({ eventId: b.eventId, photographer: b.photographer, files: b.files.length, assets: b.assetIds.length })),
        totalFiles: batches.reduce((n, b) => n + b.files.length, 0),
      },
    };
  }

  // ── commands from the popup (untrusted payloads) ─────────────────────────

  const _strict = (p, keys) => p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).every(k => keys.includes(k));
  const _session = (p) => (p && typeof p.sourceId === 'string' && SOURCE_ID_RE.test(p.sourceId) && deps.getCard(p.sourceId) ? _sessions.get(p.sourceId) || null : null);
  const _range = (s, id) => (typeof id === 'string' && ID_RE.test(id) ? s.ranges.find(r => r.id === id) || null : null);
  const _ok = (s) => { s.notice = null; s.rev++; deps.pushSnapshot(); return { ok: true }; };
  const _busy = (sourceId) => !!(_active && _active.sourceId === sourceId);

  /** Opens (or resumes) the division for a card. Needs the active event: it names the collection. */
  function open(sourceId) {
    if (typeof sourceId !== 'string' || !SOURCE_ID_RE.test(sourceId) || !deps.getCard(sourceId)) return { ok: false, reason: 'invalid' };
    if (_sessions.has(sourceId)) return { ok: true };
    const ev = deps.getActiveEvent();
    if (!ev || typeof ev.eventPath !== 'string' || !ev.eventPath) return { ok: false, reason: 'no-event' };
    _sessions.set(sourceId, _newSession(sourceId, ev));
    log('[event-divide] division opened for a card');
    return { ok: true };
  }

  function _defaultRange(s) {
    const assets = s.assets || [];
    const date = s.viewDate;
    const res = M.assign(assets, s.ranges, s.overrides);
    const free = assets.filter(a => !a.imported && a.reliable && a.date === date && !res.byAsset.get(a.id).eventId && !res.byAsset.get(a.id).conflict);
    if (!free.length) return { date: date || null, start: '09:00:00', end: '10:00:00' };
    const floorMin = (t) => `${t.slice(0, 5)}:00`;
    const last = free[free.length - 1];
    const endSec = Math.min(M.wallSeconds(last.date, `${last.time.slice(0, 5)}:00`) + 60, free[0].sec + M.DAY_S - 60);
    return { date: free[0].date, start: floorMin(free[0].time), end: M.wallParts(endSec).time };
  }

  /** @param {unknown} p  { sourceId, cmd, ... } */
  async function command(p) {
    const s = _session(p);
    if (!s || typeof p.cmd !== 'string') return { ok: false, reason: 'invalid' };
    if (_busy(p.sourceId)) return { ok: false, reason: 'busy' };
    const assets = _assetsFor(s, deps.peekJob(p.sourceId)) || [];
    if (p.cmd !== 'setViewDate') _ensureViewDate(s, assets);
    const byId = (id) => (typeof id === 'string' && ID_RE.test(id) ? assets.find(a => a.id === id) || null : null);
    switch (p.cmd) {
      case 'setViewDate': {
        if (!_strict(p, ['sourceId', 'cmd', 'date']) || !M.isDate(p.date)) return { ok: false, reason: 'invalid' };
        s.viewDate = p.date;
        return _ok(s);
      }
      case 'addRange': {
        if (!_strict(p, ['sourceId', 'cmd'])) return { ok: false, reason: 'invalid' };
        if (s.ranges.length >= MAX_RANGES) return { ok: false, reason: 'too-many-ranges' };
        const d = _defaultRange(s);
        if (!d.date) return { ok: false, reason: 'no-photos' };
        s.ranges = [...s.ranges, { id: `r${s.nextId++}`, ...d, eventId: null }];
        return _ok(s);
      }
      case 'updateRange': {
        if (!_strict(p, ['sourceId', 'cmd', 'rangeId', 'date', 'start', 'end'])) return { ok: false, reason: 'invalid' };
        const r = _range(s, p.rangeId);
        if (!r) return { ok: false, reason: 'invalid' };
        const next = { ...r };
        if ('date' in p) { if (!M.isDate(p.date)) return { ok: false, reason: 'invalid-date' }; next.date = p.date; }
        for (const k of ['start', 'end']) if (k in p) { if (!M.isTime(p[k])) return { ok: false, reason: 'invalid-time' }; next[k] = p[k].length === 5 ? `${p[k]}:00` : p[k]; }
        s.ranges = s.ranges.map(x => (x.id === r.id ? next : x));
        return _ok(s);
      }
      case 'removeRange': {
        if (!_strict(p, ['sourceId', 'cmd', 'rangeId']) || !_range(s, p.rangeId)) return { ok: false, reason: 'invalid' };
        s.ranges = s.ranges.filter(x => x.id !== p.rangeId);
        if (s.pendingNewFor === p.rangeId) s.pendingNewFor = null;
        return _ok(s);
      }
      case 'setRangeEvent': {
        if (!_strict(p, ['sourceId', 'cmd', 'rangeId', 'folderName'])) return { ok: false, reason: 'invalid' };
        const r = _range(s, p.rangeId);
        if (!r) return { ok: false, reason: 'invalid' };
        if (p.folderName !== null && (typeof p.folderName !== 'string' || !s.known.has(p.folderName))) return { ok: false, reason: 'not-listed' };
        s.ranges = s.ranges.map(x => (x.id === r.id ? { ...x, eventId: p.folderName } : x));
        return _ok(s);
      }
      case 'splitAt': {
        if (!_strict(p, ['sourceId', 'cmd', 'assetId'])) return { ok: false, reason: 'invalid' };
        const a = byId(p.assetId);
        if (!a || !a.reliable) return { ok: false, reason: 'invalid' };
        if (s.ranges.length >= MAX_RANGES) return { ok: false, reason: 'too-many-ranges' };
        const holder = s.ranges.find(r => !M.rangeProblem(r) && (() => { const iv = M.rangeInterval(r); return iv.start <= a.sec && a.sec < iv.end; })());
        const newId = `r${s.nextId}`;
        let out;
        if (holder) {
          out = M.splitAt(s.ranges, holder.id, a.sec, newId);
          if (!out.ok) return { ok: false, reason: out.reason === 'not-inside-range' ? 'already-boundary' : out.reason };
          s.ranges = out.ranges;
        } else {
          out = M.rangeFrom(assets, s.ranges, a.sec, newId);
          if (!out.ok) return { ok: false, reason: out.reason };
          s.ranges = [...s.ranges, out.range];
        }
        s.nextId++;
        return _ok(s);
      }
      case 'nudge': {
        if (!_strict(p, ['sourceId', 'cmd', 'rangeId', 'edge', 'dir'])) return { ok: false, reason: 'invalid' };
        const secs = [...new Set(assets.filter(a => a.reliable).map(a => a.sec))].sort((x, y) => x - y);
        const out = M.nudge(s.ranges, p.rangeId, p.edge, p.dir, secs);
        if (!out.ok) return { ok: false, reason: out.reason };
        s.ranges = out.ranges;
        return _ok(s);
      }
      case 'setAssets': {
        if (!_strict(p, ['sourceId', 'cmd', 'assetIds', 'target'])) return { ok: false, reason: 'invalid' };
        if (!Array.isArray(p.assetIds) || !p.assetIds.length || p.assetIds.length > MAX_ASSETS_PER_CALL) return { ok: false, reason: 'invalid' };
        const list = p.assetIds.map(byId);
        if (list.some(a => !a)) return { ok: false, reason: 'invalid' };
        const t = p.target;
        if (!(t === null || t === M.UNASSIGNED || (typeof t === 'string' && s.known.has(t)))) return { ok: false, reason: 'not-listed' };
        for (const a of list) { if (t === null) s.overrides.delete(a.id); else s.overrides.set(a.id, t); }
        return _ok(s);
      }
      case 'setGapMinutes': {
        if (!_strict(p, ['sourceId', 'cmd', 'minutes']) || !(p.minutes === null || M.GAP_OPTIONS_MIN.includes(p.minutes))) return { ok: false, reason: 'invalid' };
        s.gapMinutes = p.minutes;
        return _ok(s);
      }
      case 'acceptGap':
      case 'dismissGap': {
        if (!_strict(p, ['sourceId', 'cmd', 'key']) || typeof p.key !== 'string') return { ok: false, reason: 'invalid' };
        const g = s.viewDate && s.gapMinutes ? M.gapSuggestions(assets, { date: s.viewDate, minutes: s.gapMinutes, ranges: s.ranges, dismissed: s.dismissedGaps }).find(x => x.key === p.key) : null;
        if (!g) return { ok: false, reason: 'invalid' };
        if (p.cmd === 'dismissGap') { s.dismissedGaps.add(g.key); return _ok(s); }
        // Accepting a suggestion only puts a boundary inside an existing range (Split Here at that
        // photo); it never creates an event assignment.
        const holder = s.ranges.find(r => !M.rangeProblem(r) && (() => { const iv = M.rangeInterval(r); return iv.start < g.sec && g.sec < iv.end; })());
        if (!holder) return { ok: false, reason: 'gap-outside-range' };
        const out = M.splitAt(s.ranges, holder.id, g.sec, `r${s.nextId}`);
        if (!out.ok) return { ok: false, reason: out.reason };
        s.nextId++;
        s.ranges = out.ranges;
        return _ok(s);
      }
      case 'setCameraPhotographer': {
        if (!_strict(p, ['sourceId', 'cmd', 'camera', 'photographer']) || typeof p.camera !== 'string' || p.camera.length > 64) return { ok: false, reason: 'invalid' };
        const cam = _cameraMode(s, assets);
        if (!cam.cameras.some(c => c.key === p.camera)) return { ok: false, reason: 'invalid' };
        if (p.photographer === null) s.cameraPhotographers.delete(p.camera);
        else if (typeof p.photographer === 'string' && _photographers().includes(p.photographer)) s.cameraPhotographers.set(p.camera, p.photographer);
        else return { ok: false, reason: 'unknown-photographer' };
        return _ok(s);
      }
      case 'newEvent': {
        // The existing Event Creator in the main window; on return the new event is selected for
        // this range (never imported automatically). Cancelling leaves everything unchanged.
        if (!_strict(p, ['sourceId', 'cmd', 'rangeId']) || !_range(s, p.rangeId)) return { ok: false, reason: 'invalid' };
        const ev = deps.getActiveEvent();
        s.pendingNewFor = { rangeId: p.rangeId, before: ev ? ev.eventPath : null };
        deps.pushSnapshot();
        const r = await deps.openPicker('new');
        if (!r || r.state !== 'completed') { s.pendingNewFor = null; deps.pushSnapshot(); return { ok: false, reason: (r && r.reason) || 'picker-unavailable' }; }
        return { ok: true };
      }
      default:
        return { ok: false, reason: 'invalid' };
    }
  }

  /**
   * The main window's active event changed (or the Event Creator closed). A division waiting for a
   * new event takes it for the intended range — only from the session's own collection.
   * @param {{ eventPath: string }|null} ev  @param {boolean} pickerClosed
   */
  function onActiveEvent(ev, pickerClosed) {
    for (const s of _sessions.values()) {
      if (!s.pendingNewFor || !pickerClosed) continue;
      const pending = s.pendingNewFor;
      s.pendingNewFor = null;
      if (!ev || !ev.eventPath || ev.eventPath === pending.before) { s.notice = 'new-event-cancelled'; continue; }
      if (path.dirname(ev.eventPath) !== s.collectionPath) { s.notice = 'new-event-other-collection'; continue; }
      const folder = path.basename(ev.eventPath);
      s.known.add(folder);
      if (s.ranges.some(r => r.id === pending.rangeId)) s.ranges = s.ranges.map(r => (r.id === pending.rangeId ? { ...r, eventId: folder } : r));
      s.notice = 'new-event-selected';
      s.rev++;
      log('[event-divide] new event selected for a range');
    }
    deps.pushSnapshot();
  }

  /** The collection's events (Event Creator scan): the destinations a range may use. Names only. */
  async function events(p) {
    const s = _session(p);
    if (!s || !_strict(p, ['sourceId'])) return { ok: false, reason: 'invalid' };
    let scanned;
    try { scanned = await deps.scanEvents(s.collectionPath); } catch { return { ok: false, reason: 'scan-failed' }; }
    const list = (Array.isArray(scanned) ? scanned : [])
      .filter(e => e && e.isFromJson === true && e.isCorrupt !== true && typeof e.folderName === 'string' && e.folderName && e.folderName.length <= MAX_NAME_LEN)
      .map(e => e.folderName)
      .sort((a, b) => b.localeCompare(a));
    for (const f of list) s.known.add(f);
    const ev = deps.getActiveEvent();
    return { ok: true, collectionName: s.collectionName, active: ev && path.dirname(ev.eventPath) === s.collectionPath ? path.basename(ev.eventPath) : null, events: list };
  }

  /** The photos of one date, chronologically, for the boundary view (names and times only). */
  function assetsOf(p) {
    const s = _session(p);
    if (!s || !_strict(p, ['sourceId', 'date']) || !M.isDate(p.date)) return { ok: false, reason: 'invalid' };
    const assets = _assetsFor(s, deps.peekJob(p.sourceId));
    if (!assets) return { ok: false, reason: 'assessment-unavailable' };
    const res = M.assign(assets, s.ranges, s.overrides);
    const list = assets.filter(a => a.date === p.date).slice(0, 20000).map(a => M.publicAsset(a, res.byAsset.get(a.id)));
    // Each asset's camera key is opaque (session HMAC); the label is the camera's display name.
    return { ok: true, date: p.date, assets: list.map(a => ({ ...a, camera: a.camera ? (s.cameraLabels.get(a.camera) || 'Camera') : null })) };
  }

  /** Small thumbnails for the visible photos only (bounded per call, cached per card). */
  async function thumbs(p) {
    const s = _session(p);
    if (!s || !_strict(p, ['sourceId', 'ids']) || !Array.isArray(p.ids) || p.ids.length > MAX_THUMBS_PER_CALL) return { ok: false, reason: 'invalid' };
    const assets = _assetsFor(s, deps.peekJob(p.sourceId)) || [];
    const out = {};
    for (const id of p.ids) {
      const a = typeof id === 'string' && ID_RE.test(id) ? assets.find(x => x.id === id) : null;
      if (!a) continue;
      if (!s.thumbs.has(id)) {
        let url = null;
        try { url = deps.makeThumb ? await deps.makeThumb(a.thumbPath) : null; } catch { url = null; }
        s.thumbs.set(id, url);
        while (s.thumbs.size > THUMB_CACHE) s.thumbs.delete(s.thumbs.keys().next().value);
      }
      out[id] = s.thumbs.get(id);
    }
    return { ok: true, thumbs: out };
  }

  // ── the import ───────────────────────────────────────────────────────────

  function _record(sourceId, patch) {
    _ops.set(sourceId, { ...(_ops.get(sourceId) || { events: [] }), ...patch, at: Date.now() });
    const s = _sessions.get(sourceId);
    if (s && patch.state) s.rev++;
    deps.pushSnapshot();
  }

  /** Destination archive mode and whether it can be used now (the workspace re-checks at run time). */
  async function _archiveCheck() {
    const ev = deps.getActiveEvent();
    let st = {};
    try { st = deps.archiveStatus ? (await deps.archiveStatus()) || {} : {}; } catch { st = {}; }
    const mode = ev && (ev.pendingSync || ev.localFirst) ? 'local-first' : (st.defaultImportMode || 'direct-nas');
    if (mode === 'local-first' && !st.localStagingRoot) return { mode, problem: 'staging-not-configured' };
    if (mode === 'direct-nas' && (st.status === 'nas-disconnected' || st.status === 'invalid-nas')) return { mode, problem: 'archive-offline' };
    return { mode, problem: null };
  }

  /** The import review: what would be imported where, and anything that blocks it. Names only. */
  async function review(p) {
    const s = _session(p);
    if (!s || !_strict(p, ['sourceId'])) return { ok: false, reason: 'invalid' };
    const v = view(p.sourceId);
    if (!v || !v.ready) return { ok: false, reason: 'assessment-unavailable' };
    const arch = await _archiveCheck();
    const card = deps.getCard(p.sourceId);
    const res = M.assign(s.assets || [], s.ranges, s.overrides);
    const dates = [...new Set((s.assets || []).filter(a => !a.imported && res.byAsset.get(a.id).eventId).map(a => a.date))].sort();
    return { ok: true, card: card ? card.label : null, collectionName: s.collectionName, dates, archive: arch, ...v.review, events: v.events,
      unassigned: v.unassigned, imported: v.imported, conflicts: v.conflicts, undated: v.undated, cameraMode: v.cameraMode };
  }

  /**
   * Imports every assigned photo in ONE plan. Revalidates the card, the source files, the events
   * and the archive first; resolves with the operation's terminal state.
   * @param {unknown} p  { sourceId }
   */
  async function startImport(p) {
    if (!_strict(p, ['sourceId']) || typeof p.sourceId !== 'string' || !SOURCE_ID_RE.test(p.sourceId)) return { state: 'refused', reason: 'invalid' };
    const { sourceId } = p;
    const s = _sessions.get(sourceId);
    if (!s) return { state: 'refused', reason: 'invalid' };
    if (deps.handoff.getActive() || _active) return { state: 'refused', reason: 'busy' };
    const refuse = (reason, detail = null) => { _record(sourceId, { state: 'refused', reason, detail, events: [], progress: null }); return { state: 'refused', reason }; };
    const card = deps.getCard(sourceId);
    if (!card) return refuse('source-detached');
    if (deps.isBusy()) return refuse('busy');
    const job = await deps.verifyJob(sourceId);
    if (!job || !deps.getCard(sourceId)) return refuse('assessment-unavailable');
    const assets = _assetsFor(s, job);
    const res = M.assign(assets, s.ranges, s.overrides);
    const sum = M.summarize(assets, res, s.ranges);
    if (sum.conflicts.assets) return refuse('conflicts');
    const cam = _cameraMode(s, assets);
    const { batches, missingPhotographer } = M.buildBatches(assets, res, _photographerFor(s, cam.mode, sourceId));
    if (missingPhotographer) return refuse(cam.mode === 'per-camera' ? 'camera-photographer' : 'no-photographer');
    if (!batches.length) return refuse('nothing-assigned');

    // Every destination must still be a valid event of the collection (Event Creator scan).
    let scanned = [];
    try { scanned = await deps.scanEvents(s.collectionPath); } catch { return refuse('scan-failed'); }
    const valid = new Set((scanned || []).filter(e => e && e.isFromJson === true && e.isCorrupt !== true).map(e => e.folderName));
    const missing = [...new Set(batches.map(b => b.eventId))].filter(f => !valid.has(f));
    if (missing.length) return refuse('event-unavailable', missing.join(', '));
    const arch = await _archiveCheck();
    if (arch.problem) return refuse(arch.problem);
    // Source files must still be the files that were assessed (same size, still there).
    const byPath = new Map(assets.flatMap(a => a.files.map(f => [f.path, f])));
    for (const b of batches) {
      for (const f of b.files) {
        const size = await statSize(f);
        if (size === null || size !== byPath.get(f).size) return refuse('source-changed');
      }
    }
    if (!deps.getCard(sourceId)) return refuse('source-detached');

    const plan = batches.map((b) => ({ folderName: b.eventId, eventPath: path.join(s.collectionPath, b.eventId), photographer: b.photographer, files: [...b.files] }));
    const opEvents = plan.map(b => ({ eventId: b.folderName, photographer: b.photographer, files: b.files.length, status: 'waiting', copied: 0, skipped: 0, errors: 0, error: null, metadata: null }));
    const total = plan.reduce((n, b) => n + b.files.length, 0);
    _active = { sourceId, batchIds: new Map() };
    _record(sourceId, { state: 'pending', reason: null, detail: null, events: opEvents, progress: { index: 0, total: plan.length, done: 0, files: 0, totalFiles: total }, mode: arch.mode });
    const journalId = `plan-${Date.now().toString(36)}`;
    _journal({ id: journalId, at: new Date().toISOString(), state: 'started', card: card.label, collectionName: s.collectionName, mode: arch.mode,
      batches: plan.map(b => ({ event: b.folderName, photographer: b.photographer, files: b.files.map(f => ({ name: path.basename(f), size: byPath.get(f).size })) })) });
    log(`[event-divide] plan import started: ${plan.length} event batch(es), ${total} file(s)`);

    const started = deps.handoff.request('dump-plan', {
      sourceId,
      foreground: false,
      channel: 'companion:dumpPlanImport',
      payload: (requestId) => {
        _active.requestId = requestId;
        return { requestId, collectionPath: s.collectionPath, batches: plan, source: { label: card.label, path: card.mountpoint } };
      },
    });
    if (!started.started) { _active = null; return refuse('busy'); }
    const final = await started.done;
    const r = final.result || {};
    const cur = _ops.get(sourceId) || { events: opEvents };
    const events = cur.events.map((e, i) => {
      // The handoff keeps only flat scalar result fields: one e<i>_* group per batch.
      const x = typeof r[`e${i}_status`] === 'string' ? { status: r[`e${i}_status`], copied: r[`e${i}_copied`], skipped: r[`e${i}_skipped`], errors: r[`e${i}_errors`],
        error: r[`e${i}_error`], metadataBatchId: r[`e${i}_batch`] } : null;
      if (!x) return e.status === 'waiting' || e.status === 'running' ? { ...e, status: 'not-started' } : e;
      const batchId = typeof x.metadataBatchId === 'string' ? x.metadataBatchId : null;
      if (batchId) _active.batchIds.set(batchId, i);
      return { ...e, status: _status(x.status), copied: _n(x.copied), skipped: _n(x.skipped), errors: _n(x.errors), error: typeof x.error === 'string' ? x.error.slice(0, 300) : null,
        // No batch: nothing to tag when nothing was copied; otherwise automatic metadata is off.
        metadata: batchId ? (_batchMeta.get(batchId) || { state: 'writing' }) : (_n(x.copied) > 0 ? { state: 'not-run' } : null), batchId };
    });
    const state = final.state !== 'completed' ? final.state
      : events.every(e => e.status === 'completed') ? 'completed'
      : events.every(e => e.status === 'completed' || e.status === 'completed-with-errors') ? 'completed-with-errors'
      : events.some(e => e.status === 'completed' || e.status === 'completed-with-errors') ? 'partial' : 'failed';
    const batchIds = _active.batchIds;
    _active = null;
    _record(sourceId, { state, reason: final.reason || r.reason || null, detail: r.detail || null, events, batchIds: [...batchIds] });
    _journal({ id: journalId, at: new Date().toISOString(), state, events: events.map(e => ({ event: e.eventId, photographer: e.photographer, status: e.status, copied: e.copied, skipped: e.skipped, errors: e.errors })) });
    log(`[event-divide] plan import ${state}: ${events.map(e => e.status).join(',')}`);
    deps.showPopup({ inactive: true });
    return { state, reason: final.reason || null };
  }

  const _n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
  const _status = (st) => (['completed', 'completed-with-errors', 'failed', 'not-started'].includes(st) ? st : 'failed');
  const _journal = (rec) => { try { if (deps.journal) deps.journal(rec); } catch { /* best effort */ } };

  /** Per-event start/end from the main window while the plan runs (counts only). */
  function onPlanEvent(info) {
    if (!_active || !info || typeof info !== 'object' || info.requestId !== _active.requestId) return;
    const op = _ops.get(_active.sourceId);
    if (!op || op.state !== 'pending') return;
    const i = Number.isInteger(info.index) ? info.index : -1;
    if (i < 0 || i >= op.events.length) return;
    const events = op.events.map((e, j) => {
      if (j !== i) return e;
      if (info.phase === 'start') return { ...e, status: 'running' };
      return { ...e, status: _status(info.status), copied: _n(info.copied), skipped: _n(info.skipped), errors: _n(info.errors), error: typeof info.error === 'string' ? info.error.slice(0, 300) : null };
    });
    const doneFiles = events.reduce((n, e) => n + (e.status === 'running' || e.status === 'waiting' ? 0 : e.files), 0);
    _record(_active.sourceId, { events, progress: { ...op.progress, index: i, done: 0, files: doneFiles } });
  }

  /** copyFileJobs progress of the running batch (counts only). */
  function onImportProgress(progress) {
    if (!_active || !progress) return;
    const op = _ops.get(_active.sourceId);
    if (!op || op.state !== 'pending') return;
    const done = Number.isFinite(progress.completedCount) ? progress.completedCount : progress.index;
    _record(_active.sourceId, { progress: { ...op.progress, done: _n(done) } });
  }

  /** Metadata batch outcome (batch_complete) for an event of the last plan. */
  function onMetadataBatch(pl) {
    if (!pl || pl.event !== 'batch_complete' || !pl.batchId) return;
    const failed = _n(pl.failed);
    const partial = _n(pl.partial) + _n(pl.ambiguous);
    const outcome = { state: failed > 0 ? 'some-failed' : partial > 0 ? 'needs-review' : 'complete', failed };
    _batchMeta.set(pl.batchId, outcome);
    while (_batchMeta.size > 50) _batchMeta.delete(_batchMeta.keys().next().value);
    for (const [sourceId, op] of _ops) {
      const idx = (op.events || []).findIndex(e => e.batchId === pl.batchId);
      if (idx >= 0) { _record(sourceId, { events: op.events.map((e, j) => (j === idx ? { ...e, metadata: outcome } : e)) }); break; }
    }
  }

  function isRunning(sourceId) { return _busy(sourceId); }
  function forget(sourceId) { _sessions.delete(sourceId); _ops.delete(sourceId); }
  function has(sourceId) { return _sessions.has(sourceId); }

  return { open, has, view, command, events, assetsOf, thumbs, review, startImport, onActiveEvent, onPlanEvent, onImportProgress, onMetadataBatch, isRunning, forget };
}

module.exports = { createDivideController };
