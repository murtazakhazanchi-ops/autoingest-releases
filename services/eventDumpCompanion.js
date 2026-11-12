/**
 * eventDumpCompanion.js — the menu-bar companion's Event Dump Quick Import (AI-FEAT-064 EQI-1).
 * Main process only; wired by companionService. Pure logic over injected dependencies.
 *
 * Default and only EQI-1 behaviour: every NEW photo of the chosen shoot date (plus, when the
 * operator ticks it, NEW photos from earlier dates) → ONE event — the workspace's active event —
 * into Event/Dump/<photographer>/. Nothing is split between events and no time entry is needed.
 *
 *   - "New" is file-level: the existing global import index (filename + size) — never the time of
 *     the last import, so older unimported photos stay eligible after a newer batch was imported.
 *     Already-imported files are never re-selected; files with no reliable capture date stay on
 *     the card. RAW/JPEG pairs share a capture date, so they travel together.
 *   - The photographer is always the operator's explicit choice from the photographer list; the
 *     last photographer used this session is offered as a one-tap suggestion, never preselected.
 *   - The import itself runs in the main window's existing import machinery (eventDumpImport.js
 *     via workspaceHandoff.request), so routing, Local First / Direct Archive, locks, event.json,
 *     metadata and sync are the same validated paths as every other event import.
 *   - The popup only ever receives names and counts — never paths.
 */

'use strict';

const SOURCE_ID_RE = /^src-\d+$/;
const NOTICE_TTL_MS = 10 * 60 * 1000;
const MAX_PHOTOGRAPHER_LEN = 120;

/**
 * @param {object} deps
 * @param {{ request: Function, getActive: Function }} deps.handoff        workspaceHandoff instance
 * @param {(sourceId: string) => object|null} deps.getCard               attached card { mountpoint, label } or null
 * @param {(sourceId: string) => Promise<object|null>} deps.verifyJob    completed, still-valid assessment job
 * @param {(sourceId: string) => object|null} deps.peekJob               current assessment job (no verification)
 * @param {(record: object, selection: object) => string} deps.classify  dateAssessmentModel.classify
 * @param {(sourceId: string) => object} deps.selectionFor               the card's normalized date selection
 * @param {(name: string, size: number) => boolean} deps.isImported      global import index lookup
 * @param {() => string[]} deps.listPhotographers                        the app's photographer list
 * @param {() => boolean} deps.isBusy                                    an import/sync/transfer/checksum is running
 * @param {() => void} deps.pushSnapshot
 * @param {(opts?: object) => void} deps.showPopup
 * @param {() => void} deps.hidePopup
 * @param {(msg: string) => void} [deps.log]
 */
function createEventDumpController(deps) {
  const log = deps.log || (() => {});
  /** sourceId → { photographer: string|null, includeEarlier: boolean } */
  const _options = new Map();
  /** sourceId → latest Dump operation view { state, reason, result, progress, metadata, at } */
  const _ops = new Map();
  /** The workspace's active event as last reported by the main window (path stays here). */
  let _event = null;
  let _lastPhotographer = null;
  let _activeSourceId = null;      // card whose Dump import is running
  /** batchId → metadata outcome; a batch can finish before the import's result reaches main. */
  const _batches = new Map();
  let _pickerPending = false;      // the operator was sent to the event picker / Event Creator
  let _pickerSeenOpen = false;     // …and the main window has reported it open since
  let _lastPickerOpen = false;     // the main window's latest report: is Event Management open?
  /** The card mode last chosen this session; new cards start in it ('review' = the Q2 actions). */
  let _lastMode = 'review';

  const _optionsFor = (sourceId) => _options.get(sourceId) || { mode: _lastMode, photographer: null, includeEarlier: false };

  function _photographers() {
    try {
      const list = deps.listPhotographers();
      return Array.isArray(list) ? [...new Set(list.filter(n => typeof n === 'string' && n.trim()).map(n => n.trim()))].sort((a, b) => a.localeCompare(b)) : [];
    } catch { return []; }
  }

  /** New/imported split for one card's records under its current selection. */
  function _plan(job, sourceId) {
    const sel = deps.selectionFor(sourceId);
    const opts = _optionsFor(sourceId);
    const out = { selectedNew: 0, selectedImported: 0, earlierNew: 0, earlierImported: 0, uncertain: 0, newByDate: {}, files: [] };
    for (const r of (job && job.records) || []) {
      const imported = !!deps.isImported(r.name, r.size);
      const bucket = deps.classify(r.evidence, sel);
      if (r.evidence && r.evidence.status === 'dated' && !imported) out.newByDate[r.evidence.date] = (out.newByDate[r.evidence.date] || 0) + 1;
      if (bucket === 'selected') {
        if (imported) out.selectedImported++; else { out.selectedNew++; out.files.push(r.path); }
      } else if (bucket === 'earlier') {
        if (imported) out.earlierImported++;
        else { out.earlierNew++; if (opts.includeEarlier) out.files.push(r.path); }
      } else if (bucket === 'uncertain') out.uncertain++;
    }
    return out;
  }

  /** Path-free per-card view (null until the card's capture dates are known). */
  function cardView(sourceId, job) {
    if (!job || !job.datesReady) return null;
    const plan = _plan(job, sourceId);
    const opts = _optionsFor(sourceId);
    const op = _ops.get(sourceId);
    const showOp = op && (op.state === 'pending' || Date.now() - op.at < NOTICE_TTL_MS);
    return {
      mode: opts.mode,
      photographer: opts.photographer,
      includeEarlier: opts.includeEarlier,
      counts: {
        selectedNew: plan.selectedNew, selectedImported: plan.selectedImported,
        earlierNew: plan.earlierNew, earlierImported: plan.earlierImported, uncertain: plan.uncertain,
        toImport: plan.files.length,
      },
      newByDate: plan.newByDate,
      op: showOp ? { state: op.state, reason: op.reason, result: op.result, progress: op.progress, metadata: op.metadata, at: op.at } : null,
      ready: job.state === 'complete',
    };
  }

  /** Path-free companion-wide view: the destination event and the photographer list. */
  function globalView() {
    return {
      event: _event ? {
        eventName: _event.eventName, collectionName: _event.collectionName,
        componentCount: _event.componentCount, pendingSync: _event.pendingSync,
      } : null,
      photographers: _photographers(),
      lastPhotographer: _lastPhotographer,
      busy: !!(deps.handoff && deps.handoff.getActive()),
    };
  }

  /** The main window's active-event report (untrusted shape; only from the main window). */
  function onWorkspaceEvent(info) {
    let next = null;
    if (info && typeof info === 'object' && typeof info.eventPath === 'string' && info.eventPath) {
      next = {
        eventPath: info.eventPath,
        eventName: typeof info.eventName === 'string' ? info.eventName.slice(0, 200) : '',
        collectionName: typeof info.collectionName === 'string' ? info.collectionName.slice(0, 200) : '',
        componentCount: Number.isInteger(info.componentCount) ? info.componentCount : 0,
        pendingSync: info.pendingSync === true,
      };
    }
    const pickerOpen = !!(info && typeof info === 'object' && info.pickerOpen === true);
    _lastPickerOpen = pickerOpen;
    const changed = JSON.stringify(next) !== JSON.stringify(_event);
    _event = next;
    if (changed) deps.pushSnapshot();
    // Back to the menu bar once the operator has left the event picker / Event Creator in the
    // main window — after creating or choosing an event (the companion now shows it) or after
    // cancelling (the previous event and every card choice are unchanged).
    if (_pickerPending && _pickerSeenOpen && !pickerOpen) {
      _pickerPending = false; _pickerSeenOpen = false;
      log(`[event-dump] event picker closed (event ${changed ? 'changed' : 'unchanged'}) — back to the menu bar`);
      deps.showPopup({ inactive: true });
    } else if (_pickerPending && pickerOpen && !_pickerSeenOpen) {
      _pickerSeenOpen = true;
      log('[event-dump] event picker open in the main window');
    }
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

  function _record(sourceId, patch) {
    _ops.set(sourceId, { ...(_ops.get(sourceId) || {}), ...patch, at: Date.now() });
    deps.pushSnapshot();
  }

  /**
   * Starts the Dump import of one card. Resolves with the operation's terminal state.
   * @param {unknown} payload  { sourceId } from the popup
   */
  async function startImport(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (Object.keys(p).some(k => k !== 'sourceId') || typeof p.sourceId !== 'string' || !SOURCE_ID_RE.test(p.sourceId)) {
      return { state: 'refused', reason: 'invalid' };
    }
    const { sourceId } = p;
    if (deps.handoff.getActive() || _activeSourceId) return { state: 'refused', reason: 'busy' };
    const refuse = (reason) => { _record(sourceId, { state: 'refused', reason, result: null, progress: null, metadata: null }); return { state: 'refused', reason }; };
    const card = deps.getCard(sourceId);
    if (!card) return refuse('source-detached');
    if (deps.isBusy()) return refuse('busy');
    if (!_event) return refuse('no-event');
    const opts = _optionsFor(sourceId);
    if (!opts.photographer || !_photographers().includes(opts.photographer)) return refuse('no-photographer');
    const job = await deps.verifyJob(sourceId);          // complete and still the same card (dev/ino)
    if (!job || !deps.getCard(sourceId)) return refuse('assessment-unavailable');
    const plan = _plan(job, sourceId);
    if (plan.files.length === 0) return refuse('nothing-new');

    const eventPath = _event.eventPath;
    const photographer = opts.photographer;
    _activeSourceId = sourceId;
    _record(sourceId, { state: 'pending', reason: null, result: null, progress: { done: 0, total: plan.files.length }, metadata: null });
    log(`[event-dump] import started: ${plan.files.length} file(s) → event Dump`);
    const started = deps.handoff.request('dump-import', {
      sourceId,
      channel: 'companion:dumpImport',
      payload: (requestId) => ({ requestId, eventPath, photographer, files: plan.files, source: { label: card.label, path: card.mountpoint } }),
    });
    if (!started.started) { _activeSourceId = null; return refuse('busy'); }
    const final = await started.done;
    _activeSourceId = null;
    const r = final.result || {};
    const state = final.state === 'completed' ? (r.errors > 0 ? 'completed-with-errors' : 'completed') : final.state;
    if (final.state === 'completed') _lastPhotographer = photographer;
    const prev = _ops.get(sourceId) || {};
    const batchId = r.metadataBatchId || null;
    _record(sourceId, {
      state, reason: final.reason || r.reason || null, batchId,
      result: { requested: r.requested || plan.files.length, copied: r.copied || 0, skipped: r.skipped || 0, errors: r.errors || 0, importMode: r.importMode || null, detail: r.detail || null },
      progress: prev.progress || null,
      metadata: batchId ? (_batches.get(batchId) || { state: 'writing' }) : { state: 'not-run' },
    });
    log(`[event-dump] import ${state}: copied=${r.copied || 0} skipped=${r.skipped || 0} errors=${r.errors || 0}`);
    deps.showPopup({ inactive: true });
    return { state, reason: final.reason || null };
  }

  /** Opens the main window's existing event picker ('choose') or Event Creator ('new'). */
  async function openPicker(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (Object.keys(p).some(k => k !== 'mode') || !['choose', 'new'].includes(p.mode)) return { state: 'refused', reason: 'invalid' };
    if (deps.handoff.getActive() || _activeSourceId) return { state: 'refused', reason: 'busy' };
    deps.hidePopup();
    _pickerPending = true;
    // Reports are sent on change only: if Event Management is already open, no "opened" report follows.
    _pickerSeenOpen = _lastPickerOpen;
    log(`[event-dump] event picker requested (${p.mode}; already open: ${_lastPickerOpen})`);
    const started = deps.handoff.request('event-picker', {
      channel: 'companion:openEventPicker',
      payload: (requestId) => ({ requestId, mode: p.mode }),
    });
    const final = await started.done;
    if (final.state !== 'completed') { _pickerPending = false; _pickerSeenOpen = false; deps.showPopup({ inactive: true }); }
    // The workspace answers only after Event Management has opened (and its messages arrive in
    // order), so a completed request IS the "opened" signal — the open/close may both fall
    // between two periodic reports when the operator is quick.
    else if (_pickerPending) _pickerSeenOpen = true;
    return { state: final.state, reason: final.reason || null };
  }

  /** copyFileJobs progress for the running Dump import (counts only). */
  function onImportProgress(progress) {
    if (!_activeSourceId || !progress) return;
    const op = _ops.get(_activeSourceId);
    if (!op || op.state !== 'pending') return;
    const done = Number.isFinite(progress.completedCount) ? progress.completedCount : progress.index;
    _record(_activeSourceId, { progress: { done: Number(done) || 0, total: Number(progress.total) || (op.progress && op.progress.total) || 0 } });
  }

  /** Metadata batch outcome for the last Dump import (batch_complete payload). */
  function onMetadataBatch(p) {
    if (!p || p.event !== 'batch_complete' || !p.batchId) return;
    const failed = Number(p.failed) || 0;
    const partial = (Number(p.partial) || 0) + (Number(p.ambiguous) || 0);
    const outcome = { state: failed > 0 ? 'some-failed' : partial > 0 ? 'needs-review' : 'complete', done: Number(p.done) || 0, failed, skipped: Number(p.skipped) || 0 };
    _batches.set(p.batchId, outcome);
    while (_batches.size > 20) _batches.delete(_batches.keys().next().value);
    for (const [sourceId, op] of _ops) {
      if (op && op.batchId === p.batchId) { _record(sourceId, { metadata: outcome }); break; }
    }
  }

  function forget(sourceId) { _options.delete(sourceId); _ops.delete(sourceId); }

  return { cardView, globalView, onWorkspaceEvent, setOptions, startImport, openPicker, onImportProgress, onMetadataBatch, forget };
}

module.exports = { createEventDumpController };
