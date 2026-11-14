/**
 * eventDumpCompanion.js — the menu-bar companion's Event Dump Quick Import (AI-FEAT-064 EQI-1,
 * EQI-2.1). Main process only; wired by companionService. Pure logic over injected dependencies.
 *
 * Default behaviour: every NEW photo of the chosen shoot date (plus, when the operator ticks it, NEW
 * photos from earlier dates) → ONE event → Event/Dump/<photographer>/. Nothing is split between
 * events and no time entry is needed (EQI-2's division is a separate, optional view).
 *
 *   - "New" is file-level: the existing global import index (filename + size). Already-imported files
 *     are never re-selected; files with no reliable capture date stay on the card. RAW/JPEG pairs
 *     share a capture date, so they travel together.
 *   - The photographer is always the operator's explicit choice; the last photographer used this
 *     session is offered as a one-tap suggestion, never preselected.
 *   - EQI-2.1: the import runs in the MAIN PROCESS through companionImportService (the same router,
 *     runner and import transaction as every other event import) — the main application window is
 *     neither needed nor shown. The destination event is the companion's own: it follows the main
 *     window's active event when that changes, and the companion's Change Event / Create New Event
 *     (its own Event Creator window) never open or disturb the main window.
 *   - The popup only ever receives names, counts and sizes — never paths.
 */

'use strict';

const path = require('path');

const SOURCE_ID_RE = /^src-\d+$/;
const NOTICE_TTL_MS = 10 * 60 * 1000;
const MAX_PHOTOGRAPHER_LEN = 120;

/**
 * @param {object} deps
 * @param {(sourceId: string) => object|null} deps.getCard               attached card { mountpoint, label } or null
 * @param {(sourceId: string) => Promise<object|null>} deps.verifyJob    completed, still-valid assessment job
 * @param {(record: object, selection: object) => string} deps.classify  dateAssessmentModel.classify
 * @param {(sourceId: string) => object} deps.selectionFor               the card's normalized date selection
 * @param {(name: string, size: number) => boolean} deps.isImported      global import index lookup
 * @param {() => string[]} deps.listPhotographers                        the app's photographer list
 * @param {() => boolean} deps.isBusy                                    an import/sync/transfer/checksum is running
 * @param {(collectionPath: string) => Promise<object[]>} [deps.scanEvents]  the Event Creator's own event scan
 * @param {object} deps.importService                                    companionImportService
 * @param {(ref: object) => Promise<object|null>} deps.resolveEvent       { eventPath, eventName, collectionName, componentCount, pendingSync, types, places }
 * @param {(ev: object) => Promise<void>} [deps.persistLastEvent]        remember the event as AutoIngest's last event
 * @param {() => { opened: boolean, done: Promise<object> }} [deps.openEventCreator]  the companion's Event Creator window
 * @param {() => void} deps.pushSnapshot
 * @param {(opts?: object) => void} deps.showPopup
 * @param {() => void} deps.hidePopup
 * @param {(msg: string) => void} [deps.log]
 * @param {(event: object|null, pickerClosed: boolean) => void} [deps.onActiveEvent]
 *        EQI-2: the event changed, or the Event Creator closed (pickerClosed)
 */
function createEventDumpController(deps) {
  const log = deps.log || (() => {});
  /** sourceId → { mode, photographer, includeEarlier } */
  const _options = new Map();
  /** sourceId → a refusal that happened before the import service ran { state, reason, at } */
  const _refusals = new Map();
  /** The companion's destination event (path stays here). */
  let _event = null;
  let _lastPhotographer = null;
  let _creatorOpen = false;
  /** The card mode last chosen this session; new cards start in it ('review' = the Q2 actions). */
  let _lastMode = 'review';
  /** The last event listing sent to the popup: chooseEvent accepts only one of these folders. */
  let _listed = null;

  const _optionsFor = (sourceId) => _options.get(sourceId) || { mode: _lastMode, photographer: null, includeEarlier: false };

  function _photographers() {
    try {
      const list = deps.listPhotographers();
      return Array.isArray(list) ? [...new Set(list.filter(n => typeof n === 'string' && n.trim()).map(n => n.trim()))].sort((a, b) => a.localeCompare(b)) : [];
    } catch { return []; }
  }

  /** New/imported split for one card's records under its current selection (files with sizes). */
  function _plan(job, sourceId) {
    const sel = deps.selectionFor(sourceId);
    const opts = _optionsFor(sourceId);
    const out = { selectedNew: 0, selectedImported: 0, earlierNew: 0, earlierImported: 0, uncertain: 0, newByDate: {}, files: [], bytes: 0 };
    const take = (r) => { out.files.push({ path: r.path, size: Number(r.size) || 0 }); out.bytes += Number(r.size) || 0; };
    for (const r of (job && job.records) || []) {
      const imported = !!deps.isImported(r.name, r.size);
      const bucket = deps.classify(r.evidence, sel);
      if (r.evidence && r.evidence.status === 'dated' && !imported) out.newByDate[r.evidence.date] = (out.newByDate[r.evidence.date] || 0) + 1;
      if (bucket === 'selected') {
        if (imported) out.selectedImported++; else { out.selectedNew++; take(r); }
      } else if (bucket === 'earlier') {
        if (imported) out.earlierImported++;
        else { out.earlierNew++; if (opts.includeEarlier) take(r); }
      } else if (bucket === 'uncertain') out.uncertain++;
    }
    return out;
  }

  /** The card's latest single-event import (service) or a refusal — names, counts and bytes only. */
  function _opView(sourceId) {
    const svc = deps.importService.view(sourceId);
    const ref = _refusals.get(sourceId);
    if (ref && (!svc || ref.at >= svc.startedAt)) return Date.now() - ref.at < NOTICE_TTL_MS ? { kind: 'single', state: 'refused', reason: ref.reason, detail: ref.detail || null } : null;
    if (!svc || svc.kind !== 'single') return null;
    return svc.state === 'pending' || Date.now() - (svc.finishedAt || 0) < NOTICE_TTL_MS ? svc : null;
  }

  /** Path-free per-card view (null until the card's capture dates are known). */
  function cardView(sourceId, job) {
    if (!job || !job.datesReady) return null;
    const plan = _plan(job, sourceId);
    const opts = _optionsFor(sourceId);
    return {
      mode: opts.mode,
      photographer: opts.photographer,
      includeEarlier: opts.includeEarlier,
      counts: {
        selectedNew: plan.selectedNew, selectedImported: plan.selectedImported,
        earlierNew: plan.earlierNew, earlierImported: plan.earlierImported, uncertain: plan.uncertain,
        toImport: plan.files.length,
      },
      bytesToImport: plan.bytes,
      newByDate: plan.newByDate,
      op: _opView(sourceId),
      ready: job.state === 'complete',
    };
  }

  /** Path-free companion-wide view: the destination event and the photographer list. */
  function globalView() {
    return {
      event: _event ? {
        eventName: _event.eventName, collectionName: _event.collectionName,
        componentCount: _event.componentCount, pendingSync: _event.pendingSync,
        types: _event.types, places: _event.places,
      } : null,
      photographers: _photographers(),
      lastPhotographer: _lastPhotographer,
      busy: deps.importService.isRunning(),
      creatorOpen: _creatorOpen,
    };
  }

  /** EQI-1.2: display labels (event types, location/city) — bounded plain strings only. */
  const _labels = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).slice(0, 12).map(x => x.trim().slice(0, 80)) : []);

  function _setEvent(next, why) {
    const changed = JSON.stringify(next) !== JSON.stringify(_event);
    _event = next;
    if (changed) { log(`[event-dump] destination event set (${why})`); deps.pushSnapshot(); }
    return changed;
  }

  /**
   * The main window's active-event report (untrusted shape; only from the main window). When the
   * operator changes the event in AutoIngest, the companion follows; it never pushes back.
   */
  let _lastReport = null;
  function onWorkspaceEvent(info) {
    if (!info || typeof info !== 'object' || typeof info.eventPath !== 'string' || !info.eventPath) return;
    const next = {
      eventPath: info.eventPath,
      eventName: typeof info.eventName === 'string' ? info.eventName.slice(0, 200) : '',
      collectionName: typeof info.collectionName === 'string' ? info.collectionName.slice(0, 200) : '',
      componentCount: Number.isInteger(info.componentCount) ? info.componentCount : 0,
      pendingSync: info.pendingSync === true,
      localFirst: info.localFirst === true,
      types: _labels(info.types),
      places: _labels(info.places),
    };
    const json = JSON.stringify(next);
    if (json === _lastReport) return;   // only a CHANGE in the main window moves the companion
    _lastReport = json;
    if (_setEvent(next, 'main window') && deps.onActiveEvent) { try { deps.onActiveEvent(_event, false); } catch { /* division keeps its state */ } }
  }

  /** At launch with no main window: the last event AutoIngest remembers (resolved from disk). */
  async function seed(ref) {
    if (_event || !ref) return;
    try {
      const ev = await deps.resolveEvent(ref);
      if (ev && !_event) _setEvent(ev, 'last event');
    } catch { /* no event yet: the operator chooses one */ }
  }

  /** @param {unknown} payload  { sourceId, mode?, photographer?, includeEarlier? } from the popup */
  function setOptions(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (Object.keys(p).some(k => !['sourceId', 'mode', 'photographer', 'includeEarlier'].includes(k))) return { ok: false, reason: 'invalid' };
    if (typeof p.sourceId !== 'string' || !SOURCE_ID_RE.test(p.sourceId) || !deps.getCard(p.sourceId)) return { ok: false, reason: 'invalid' };
    const cur = { ..._optionsFor(p.sourceId) };
    if ('mode' in p) {
      if (p.mode !== 'review' && p.mode !== 'dump') return { ok: false, reason: 'invalid' };
      cur.mode = p.mode;
      _lastMode = p.mode;
    }
    if ('photographer' in p) {
      if (p.photographer === null || p.photographer === '') cur.photographer = null;
      else if (typeof p.photographer === 'string' && p.photographer.length <= MAX_PHOTOGRAPHER_LEN && _photographers().includes(p.photographer)) cur.photographer = p.photographer;
      else return { ok: false, reason: 'unknown-photographer' };
    }
    if ('includeEarlier' in p) {
      if (typeof p.includeEarlier !== 'boolean') return { ok: false, reason: 'invalid' };
      cur.includeEarlier = p.includeEarlier;
    }
    _options.set(p.sourceId, cur);
    deps.pushSnapshot();
    return { ok: true };
  }

  const _refuse = (sourceId, reason, detail = null) => {
    _refusals.set(sourceId, { state: 'refused', reason, detail, at: Date.now() });
    deps.pushSnapshot();
    return { state: 'refused', reason };
  };

  /**
   * Imports the card's selected new photos into the destination event's Dump — in the main
   * process, without the main window. Resolves when the import has FINISHED (copy, verification,
   * event.json and metadata), with its terminal state.
   * @param {unknown} payload  { sourceId } from the popup
   */
  async function startImport(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (Object.keys(p).some(k => k !== 'sourceId') || typeof p.sourceId !== 'string' || !SOURCE_ID_RE.test(p.sourceId)) {
      return { state: 'refused', reason: 'invalid' };
    }
    const { sourceId } = p;
    if (deps.importService.isRunning()) return { state: 'refused', reason: 'busy' };
    _refusals.delete(sourceId);
    const card = deps.getCard(sourceId);
    if (!card) return _refuse(sourceId, 'source-detached');
    if (deps.isBusy()) return _refuse(sourceId, 'busy');
    if (!_event) return _refuse(sourceId, 'no-event');
    const opts = _optionsFor(sourceId);
    if (!opts.photographer || !_photographers().includes(opts.photographer)) return _refuse(sourceId, 'no-photographer');
    const job = await deps.verifyJob(sourceId);          // complete and still the same card (dev/ino)
    if (!job || !deps.getCard(sourceId)) return _refuse(sourceId, 'assessment-unavailable');
    const plan = _plan(job, sourceId);
    if (plan.files.length === 0) return _refuse(sourceId, 'nothing-new');

    const ev = _event;
    const photographer = opts.photographer;
    log(`[event-dump] import started: ${plan.files.length} file(s) → event Dump (no main window)`);
    const final = await deps.importService.run({
      sourceId, kind: 'single', source: { label: card.label, path: card.mountpoint },
      localFirstEvent: !!(ev.pendingSync || ev.localFirst), collectionName: ev.collectionName,
      batches: [{ eventId: path.basename(ev.eventPath), eventPath: ev.eventPath, photographer, files: plan.files }],
    });
    if (final.state === 'completed' || final.state === 'completed-with-errors') _lastPhotographer = photographer;
    if (final.state === 'refused') return _refuse(sourceId, final.reason || 'refused');
    log(`[event-dump] import ${final.state}`);
    deps.showPopup({ inactive: true });
    return final;
  }

  /**
   * Create New Event: the companion's own Event Creator window (the existing Event Creator, never the
   * main application). On success the new event becomes the destination; on cancel nothing changes.
   */
  async function openEventCreator() {
    if (deps.importService.isRunning()) return { state: 'refused', reason: 'busy' };
    if (typeof deps.openEventCreator !== 'function') return { state: 'refused', reason: 'unavailable' };
    // The creator opens in the companion's collection: AutoIngest's last event is the companion's.
    if (_event && deps.persistLastEvent) { try { await deps.persistLastEvent(_event); } catch { /* opens at the last remembered event */ } }
    const before = _event;
    const started = deps.openEventCreator();
    if (!started.opened) return { state: 'refused', reason: 'already-open' };
    _creatorOpen = true;
    deps.pushSnapshot();
    const res = await started.done;
    _creatorOpen = false;
    let state = 'cancelled';
    if (res && res.ok && typeof res.eventPath === 'string') {
      const ev = await deps.resolveEvent({ eventPath: res.eventPath, pendingSync: res.pendingSync === true, localFirst: res.localFirst === true }).catch(() => null);
      if (ev) { _setEvent(ev, 'new event'); state = 'completed'; if (deps.persistLastEvent) deps.persistLastEvent(ev).catch(() => {}); }
    }
    log(`[event-dump] Event Creator closed: ${state}`);
    if (deps.onActiveEvent) { try { deps.onActiveEvent(state === 'completed' ? _event : before, true); } catch { /* division keeps its state */ } }
    deps.pushSnapshot();
    deps.showPopup();
    return { state, reason: state === 'completed' ? null : (res && res.reason) || 'cancelled' };
  }

  /** Kept for the popup's API: 'new' opens the companion's Event Creator window. */
  async function openPicker(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (Object.keys(p).some(k => k !== 'mode') || p.mode !== 'new') return { state: 'refused', reason: 'invalid' };
    return openEventCreator();
  }

  /** One-click Change Event: the events of the destination's collection (Event Creator's own scan). */
  async function listEvents() {
    if (!_event) return { ok: false, reason: 'no-event' };
    if (typeof deps.scanEvents !== 'function') return { ok: false, reason: 'unavailable' };
    const collectionPath = path.dirname(_event.eventPath);
    let scanned;
    try { scanned = await deps.scanEvents(collectionPath); } catch { return { ok: false, reason: 'scan-failed' }; }
    const events = (Array.isArray(scanned) ? scanned : [])
      .filter(e => e && e.isFromJson === true && e.isCorrupt !== true && typeof e.folderName === 'string' && e.folderName)
      .map(e => ({ folderName: e.folderName, hijriDate: typeof e.hijriDate === 'string' ? e.hijriDate : null }))
      .sort((a, b) => b.folderName.localeCompare(a.folderName));
    _listed = { collectionPath, collectionName: _event.collectionName, names: new Set(events.map(e => e.folderName)) };
    return { ok: true, collectionName: _event.collectionName, active: path.basename(_event.eventPath), events };
  }

  /**
   * Selects one of the listed events as the companion's destination. The main window is never
   * opened, focused or changed — an open Import workspace keeps all its assignments.
   * @param {unknown} payload  { folderName } from the popup
   */
  async function chooseEvent(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (Object.keys(p).some(k => k !== 'folderName') || typeof p.folderName !== 'string') return { state: 'refused', reason: 'invalid' };
    if (!_listed || !_listed.names.has(p.folderName)) return { state: 'refused', reason: 'not-listed' };
    if (deps.importService.isRunning()) return { state: 'refused', reason: 'busy' };
    const ev = await deps.resolveEvent({ collectionPath: _listed.collectionPath, collectionName: _listed.collectionName, folderName: p.folderName }).catch(() => null);
    if (!ev) return { state: 'refused', reason: 'event-unavailable' };
    _setEvent(ev, 'chosen in the companion');
    if (deps.persistLastEvent) deps.persistLastEvent(ev).catch(() => {});
    if (deps.onActiveEvent) { try { deps.onActiveEvent(_event, false); } catch { /* division keeps its state */ } }
    return { state: 'completed', reason: null };
  }

  function forget(sourceId) { _options.delete(sourceId); _refusals.delete(sourceId); deps.importService.forget(sourceId); }

  /** EQI-2: the destination event (main process only — it carries the path). */
  function activeEvent() { return _event ? { ..._event } : null; }
  /** EQI-2: the card's confirmed photographer (the operator's explicit Event Dump choice). */
  function photographerOf(sourceId) { return _optionsFor(sourceId).photographer || null; }

  return { cardView, globalView, onWorkspaceEvent, seed, setOptions, startImport, openPicker, openEventCreator, listEvents, chooseEvent, forget, activeEvent, photographerOf };
}

module.exports = { createEventDumpController };
