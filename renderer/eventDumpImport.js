// renderer/eventDumpImport.js — AI-FEAT-064 EQI-1: Event Dump import for the menu-bar companion.
//
// The companion (main process) chooses the card files, the photographer and the destination
// event; THIS workspace runs the import with its own, existing machinery, so a Dump import is
// routed, locked, committed, metadata-tagged and (Local First) sync-registered exactly like any
// other event import:
//   ImportRouter.buildDumpFileJobs → ImportSessionRunner (one-event plan) → _sessPrepareEvent
//   (Local First mirror + remap) → commitImportTransaction(destination: 'dump') →
//   _sessRegisterLocalFirst.
// Destination: <event>/Dump/<photographer>/[VIDEO/]<file> — never PC-sequenced, never a component.
// The event must be this workspace's active event (revalidated from disk); nothing here guesses
// an archive location, changes the active event, or touches the open Import workspace.
//
// It also keeps the companion informed of the active event (names only — the path stays in main)
// and opens the existing event picker / Event Creator when the companion asks.
'use strict';

const EventDumpImport = (() => {
  const HEARTBEAT_MS = 2000;
  const REPORT_MS = 1000;
  let _running = false;
  let _lastReport = '';

  function _eventLabels(components) {
    const types = [], places = [];
    const add = (arr, v) => { if (typeof v === 'string' && v.trim() && !arr.includes(v.trim())) arr.push(v.trim()); };
    for (const c of Array.isArray(components) ? components : []) {
      for (const t of (c && c.eventTypes) || []) add(types, t && t.label);
      add(places, [c && c.location && c.location.label, c && c.city && c.city.label].filter(Boolean).join(', '));
    }
    return { types, places };
  }

  function _activeEventInfo() {
    const ed = (typeof EventCreator !== 'undefined') ? EventCreator.getActiveEventData() : null;
    if (!ed || !ed.eventPath || !ed.event) return null;
    return {
      eventPath: ed.eventPath,
      eventName: ed.event.name || '',
      collectionName: (ed.coll && ed.coll.name) || '',
      componentCount: Array.isArray(ed.event.components) ? ed.event.components.length : 0,
      pendingSync: EventCreator.isPendingSync(),
      // EQI-2: the Local First rule of _importModeFor, so the companion's review can state the mode.
      localFirst: EventCreator.wasLocalStagingEvent(),
      // EQI-1.2: labels only, so the companion can set the event's types and place apart from
      // its name (the canonical name itself is shown unchanged).
      ..._eventLabels(ed.event.components),
    };
  }

  /** Push the active event (and whether the event picker is open) to main whenever it changes. */
  function _report() {
    const ev = _activeEventInfo();
    const pickerOpen = typeof EventMgmt !== 'undefined' && typeof EventMgmt.isOpen === 'function' ? EventMgmt.isOpen() : false;
    const info = ev ? { ...ev, pickerOpen } : (pickerOpen ? { pickerOpen } : null);
    const json = JSON.stringify(info);
    if (json === _lastReport) return;
    _lastReport = json;
    try { window.api.companionWorkspaceEvent(info); } catch { /* companion disabled */ }
  }

  function _refuse(reason, detail) { return { ok: false, reason, detail: detail || null }; }

  /**
   * The import method, by the Confirm Event Import modal's own rule (renderer.js, "Import Method
   * UI" — kept unchanged under the main-window freeze): a pending-local event must use Local First;
   * an event started in Local Staging defaults to Local First; otherwise the archive's default.
   */
  function _importModeFor(archSt) {
    if (EventCreator.isPendingSync() || EventCreator.wasLocalStagingEvent()) return 'local-first';
    return (archSt && archSt.defaultImportMode) || 'direct-nas';
  }

  /**
   * @param {{ eventPath: string, photographer: string, files: string[], source: { label: string, path: string } }} req
   * @returns {Promise<object>} { ok, reason?, copied, skipped, errors, metadataBatchId, importMode, … }
   */
  async function run(req) {
    if (_running || importRunning || _sessionRunBusy) return _refuse('busy');
    const ed = EventCreator.getActiveEventData();
    if (!ed || !ed.eventPath) return _refuse('no-event');
    if (ed.eventPath !== req.eventPath) return _refuse('event-changed');
    if (!Array.isArray(req.files) || req.files.length === 0) return _refuse('nothing-selected');
    const photographer = typeof req.photographer === 'string' ? req.photographer.trim() : '';
    if (!photographer) return _refuse('no-photographer');

    // event.json is the source of truth: the event must still exist and be readable right now.
    let snap = null;
    try { snap = await EventCreator.loadEventSnapshot(ed.eventPath); } catch { snap = null; }
    if (!snap) return _refuse('event-unreadable');

    let archSt = {};
    try { archSt = await window.api.getArchiveOperationsStatus(); } catch { /* non-critical */ }
    const importMode = _importModeFor(archSt);
    if (importMode === 'local-first' && !archSt.localStagingRoot) return _refuse('staging-not-configured');
    if (importMode === 'direct-nas' && (archSt.status === 'nas-disconnected' || archSt.status === 'invalid-nas')) {
      return _refuse('archive-offline');
    }

    const { fileJobs } = ImportRouter.buildDumpFileJobs({ eventData: ed, photographer, files: req.files });
    if (fileJobs.length !== req.files.length) return _refuse('routing-failed');
    // A busy photographer folder (e.g. this computer's own lock left by a crash): the EXISTING
    // busy-archive dialog, exactly as the multi-event import uses it — Clear & Continue only on
    // the operator's explicit choice; cancel/switch leave the decision to AutoIngest.
    if (importMode === 'direct-nas' && archSt.nasRoot) {
      for (;;) {
        const lockCheck = await window.api.checkDirectArchiveLocks({ fileJobs });
        if (!lockCheck || !lockCheck.blocked || !lockCheck.blocked.length) break;
        // The import runs with the main window in the background: bring it forward for this
        // decision, so the dialog is never hidden behind other apps (EQI-1.1).
        try { window.api.companionRequestAttention(); } catch { /* companion disabled */ }
        const pick = await _showDirectArchiveBusyDialog(lockCheck.blocked, lockCheck.currentDeviceName ?? null);
        if (pick === 'refresh' || pick === 'clear') continue;
        return _refuse('archive-busy');
      }
    }

    const sourceMeta = { type: 'memory-card', label: (req.source && req.source.label) || 'Memory card', path: (req.source && req.source.path) || '' };
    const item = _dumpItem(ed, ed.event.components, photographer, fileJobs, req.files);
    const result = await _runItems([item], { importMode, archSt, sourceMeta });
    if (result.error) return _refuse('error', result.error);

    const entry = result.events[0] || {};
    const s = entry.summary || {};
    return {
      ok: entry.status === 'completed' || entry.status === 'completed-with-errors',
      reason: entry.status === 'failed' ? 'import-failed' : null,
      status: entry.status || result.status,
      detail: entry.error || null,
      importMode,
      requested: req.files.length,
      copied: Number(s.copied) || 0,
      skipped: Number(s.skipped) || 0,
      errors: Number(s.errors) || 0,
      metadataBatchId: s.metadataBatchId || null,
    };
  }

  /**
   * One Dump transaction of a plan: an event's routing data, its file jobs and its group. Dump
   * media belongs to no component yet: single-component events keep the event's own component
   * keywords (group 0, as a normal import); multi-component events get an explicit "no component
   * keyword" ([]) until Sort Dump assigns the component.
   */
  function _dumpItem(routingEventData, components, photographer, fileJobs, files) {
    const isMulti = Array.isArray(components) && components.length > 1;
    return {
      eventKey: routingEventData.eventPath, ordinal: 1, name: routingEventData.event.name,
      eventPath: routingEventData.eventPath, collectionPath: routingEventData.collectionPath, routingEventData, fileJobs,
      photographer,
      group: { id: isMulti ? -1 : 0, subEventId: null, metadataTags: isMulti ? [] : null, files: [...files], fileTagRefinements: null },
    };
  }

  /**
   * Runs Dump items with the existing multi-event runner (failure isolation per event, source-wide
   * stop) and the existing transaction. Shared by the single-event Event Dump (EQI-1) and the
   * multi-event plan (EQI-2), so both route, lock, commit and sync-register the same way.
   * @returns {Promise<object>} ImportSessionRunner result, or { error } when the runner itself threw
   */
  async function _runItems(items, { importMode, archSt, sourceMeta, onEventStart, onEventEnd }) {
    const importedBy = _activeUser ? { id: _activeUser.id, name: _activeUser.name } : null;
    const stagingNorm = (archSt.localStagingRoot || '').replace(/\\/g, '/').replace(/\/$/, '');
    _running = true;
    importRunning = true;
    try {
      return await ImportSessionRunner.run({ events: items, hasBlocking: false }, {
        shouldStop: async () => {
          if (!sourceMeta.path) return null;
          let alive = true;
          try { alive = await window.api.dirExists(sourceMeta.path); } catch { alive = false; }
          return alive ? null : 'source-disconnected';
        },
        isSourceAlive: async () => (sourceMeta.path ? !!(await window.api.dirExists(sourceMeta.path)) : true),
        prepareEvent: (it) => _sessPrepareEvent(it, importMode, archSt),
        markInProgress: async (it, prepared) => { await window.api.updateEventJson(prepared.txEventPath, { status: 'in-progress' }); },
        onEventFailed: async (it, prepared) => { if (prepared) await window.api.updateEventJson(prepared.txEventPath, { status: 'created' }); },
        onEventStart,
        onEventEnd,
        commit: async (it, prepared, ctx) => {
          const ed = it.routingEventData;
          // Local First: the staging copy may have been cleared after an earlier sync; the archive's
          // own Dump folder is then checked too, so an identical photo is never synced twice.
          const archiveEventPath = importMode === 'local-first' && stagingNorm
            && !it.eventPath.replace(/\\/g, '/').startsWith(stagingNorm + '/') ? it.eventPath : null;
          const summary = await window.api.commitImportTransaction(prepared.txFileJobs, prepared.txEventPath, {
            collName: ed.coll && ed.coll.name,
            photographer: it.photographer,
            subEventNames: [],
            liveComps: ed.event.components,
            groups: [it.group],
            source: sourceMeta,
            importedBy,
            importMode,
            destination: 'dump',
            ...(items.length > 1 ? { progressEventPath: it.eventPath, importSessionId: ctx.importSessionId } : {}),
            ...(archiveEventPath ? { archiveEventPath } : {}),
          });
          if (importMode === 'local-first') {
            try { _sessRegisterLocalFirst(it, prepared, summary, it.photographer); }
            catch (err) { console.error('[EventDump] sync manifest registration failed (event already committed):', err); }
          }
          return summary;
        },
      });
    } catch (err) {
      return { error: ImportSessionRunner.cleanMessage(err) };
    } finally {
      importRunning = false;
      _running = false;
      try {
        EventCreator.invalidateScannedEvents();
        globalImportIndex = await window.api.getImportIndex() || {};
      } catch { /* non-critical */ }
    }
  }

  /**
   * AI-FEAT-064 EQI-2: ONE plan with several event destinations (the companion's Divide Photos
   * Between Events). Every batch is (event, photographer, files) in the ACTIVE event's collection;
   * each event is read from its own event.json (never the active event's data), routed to
   * <event>/Dump/<photographer>/ and committed as its own transaction. A failed event never undoes
   * a committed one; nothing is retried automatically.
   * @param {{ collectionPath: string, batches: Array<{ folderName: string, eventPath: string, photographer: string, files: string[] }>, source: object }} req
   * @param {(info: object) => void} [report]  per-event start/end counts for the companion
   */
  async function runPlan(req, report = () => {}) {
    if (_running || importRunning || _sessionRunBusy) return _refuse('busy');
    const ed = EventCreator.getActiveEventData();
    if (!ed || !ed.eventPath || !ed.collectionPath) return _refuse('no-event');
    const norm = (p) => (typeof p === 'string' ? p.replace(/\\/g, '/').replace(/\/+$/, '') : '');
    const coll = norm(ed.collectionPath);
    if (!req || norm(req.collectionPath) !== coll) return _refuse('collection-changed');
    const batches = Array.isArray(req.batches) ? req.batches : [];
    if (!batches.length) return _refuse('nothing-selected');
    const seen = new Set();
    for (const b of batches) {
      const okName = b && typeof b.folderName === 'string' && b.folderName && !/[\\/]/.test(b.folderName) && b.folderName !== '.' && b.folderName !== '..';
      if (!okName || norm(b.eventPath) !== `${coll}/${b.folderName}`) return _refuse('invalid');
      if (typeof b.photographer !== 'string' || !b.photographer.trim() || b.photographer !== b.photographer.trim()) return _refuse('no-photographer');
      if (!Array.isArray(b.files) || !b.files.length) return _refuse('nothing-selected');
      for (const f of b.files) { if (typeof f !== 'string' || seen.has(f)) return _refuse('invalid'); seen.add(f); }
    }

    let archSt = {};
    try { archSt = await window.api.getArchiveOperationsStatus(); } catch { /* non-critical */ }
    const importMode = _importModeFor(archSt);
    if (importMode === 'local-first' && !archSt.localStagingRoot) return _refuse('staging-not-configured');
    if (importMode === 'direct-nas' && (archSt.status === 'nas-disconnected' || archSt.status === 'invalid-nas')) return _refuse('archive-offline');

    // event.json is the source of truth: every destination must exist and be readable right now.
    const items = [];
    for (const b of batches) {
      const eventPath = `${coll}/${b.folderName}`;
      let snap = null;
      try { snap = await EventCreator.loadEventSnapshot(eventPath); } catch { snap = null; }
      if (!snap) return _refuse('event-unreadable', b.folderName);
      const routing = { coll: ed.coll, event: { name: b.folderName, components: snap.components }, idx: null, collectionPath: ed.collectionPath, eventPath };
      const { fileJobs } = ImportRouter.buildDumpFileJobs({ eventData: routing, photographer: b.photographer, files: b.files });
      if (fileJobs.length !== b.files.length) return _refuse('routing-failed');
      items.push({ ..._dumpItem(routing, snap.components, b.photographer, fileJobs, b.files), eventKey: `${eventPath}\u0000${b.photographer}`, ordinal: items.length + 1 });
    }
    if (importMode === 'direct-nas' && archSt.nasRoot) {
      for (;;) {
        const lockCheck = await window.api.checkDirectArchiveLocks({ fileJobs: items.flatMap(i => i.fileJobs) });
        if (!lockCheck || !lockCheck.blocked || !lockCheck.blocked.length) break;
        try { window.api.companionRequestAttention(); } catch { /* companion disabled */ }
        const pick = await _showDirectArchiveBusyDialog(lockCheck.blocked, lockCheck.currentDeviceName ?? null);
        if (pick === 'refresh' || pick === 'clear') continue;
        return _refuse('archive-busy');
      }
    }

    const sourceMeta = { type: 'memory-card', label: (req.source && req.source.label) || 'Memory card', path: (req.source && req.source.path) || '' };
    const indexOf = (it) => items.indexOf(it);
    const result = await _runItems(items, {
      importMode, archSt, sourceMeta,
      onEventStart: (it) => report({ phase: 'start', index: indexOf(it) }),
      onEventEnd: (e) => {
        const i = items.findIndex(it => it.eventKey === e.eventKey);
        const s = e.summary || {};
        report({ phase: 'end', index: i, status: e.status, copied: Number(s.copied) || 0, skipped: Number(s.skipped) || 0, errors: Number(s.errors) || 0, error: e.error || (e.status === 'not-started' ? e.reason : null) || null });
      },
    });
    if (result.error) return _refuse('error', result.error);

    // The handoff carries flat scalar fields only: one e<i>_* group per batch, in plan order.
    const out = { ok: result.events.some(e => e.status === 'completed' || e.status === 'completed-with-errors'), status: result.status, importMode, events: items.length };
    if (!out.ok) out.reason = 'import-failed';
    items.forEach((it, i) => {
      const e = result.events.find(x => x.eventKey === it.eventKey) || { status: 'not-started' };
      const s = e.summary || {};
      Object.assign(out, {
        [`e${i}_status`]: e.status, [`e${i}_copied`]: Number(s.copied) || 0, [`e${i}_skipped`]: Number(s.skipped) || 0,
        [`e${i}_errors`]: Number(s.errors) || 0, [`e${i}_batch`]: s.metadataBatchId || null,
        [`e${i}_error`]: e.error ? String(e.error).slice(0, 200) : (e.status === 'not-started' ? (e.reason || 'not-started') : null),
      });
    });
    return out;
  }

  /**
   * EQI-1.1 one-click Change Event from the companion, WITHOUT bringing this window forward: the
   * event is adopted through the same path AutoIngest uses at startup (setLastEvent →
   * EventCreator.restoreLastEvent), as a landing-screen event change (session boundary, exactly as
   * showEventCreatorResume does). With an Import workspace open, its assignments must not be
   * disturbed — refused, and the companion opens the existing picker instead.
   * @param {{ collectionPath: string, collectionName: string, folderName: string }} req
   */
  async function selectEvent(req) {
    if (_running || importRunning || _sessionRunBusy) return _refuse('busy');
    if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen()) return _refuse('workspace-open');
    const workspaceLive = !!activeSource && document.getElementById('workspace').classList.contains('visible');
    if (workspaceLive) return _refuse('workspace-open');
    const { collectionPath, collectionName, folderName } = req || {};
    if (!collectionPath || !collectionName || !folderName) return _refuse('invalid');
    ImportSession.reset();
    renderGroupPanel();
    await window.api.setLastEvent({ collectionPath, collectionName, eventName: folderName, safeEventName: folderName });
    await EventCreator.restoreLastEvent();
    const ed = EventCreator.getActiveEventData();
    if (!ed || !ed.event || ed.event.name !== folderName) return _refuse('event-unavailable');
    if (typeof renderHome === 'function' && !document.getElementById('workspace').classList.contains('visible')) {
      try { renderHome(); } catch { /* cosmetic only */ }
    }
    return { ok: true };
  }

  /** Opens the existing event picker (and, for 'new', the existing Event Creator form). */
  function openPicker(mode) {
    if (importRunning || _sessionRunBusy) return _refuse('busy');
    const workspaceLive = !!activeSource && document.getElementById('workspace').classList.contains('visible');
    // The picker re-renders its list after a slide transition (and after a scan, when needed); a
    // button already in the DOM belongs to the previous render and must not be clicked.
    const staleNewBtn = document.getElementById('ecNewEventFromList');
    // A live Import workspace keeps every event's assignments; the landing-screen picker is a
    // session boundary — exactly as the workspace's own "Change event" and the hero's buttons do.
    const opened = workspaceLive ? openEventPickerFromWorkspace() : (showEventCreatorResume(), true);
    if (!opened) return _refuse('picker-unavailable');
    if (mode === 'new') {
      // The operator's own "+ Create New Event" — the same modal, validation and sequencing. The
      // event list renders asynchronously, so wait (bounded) for its freshly rendered button.
      const deadline = Date.now() + 15000;
      const tryClick = () => {
        const btn = document.getElementById('ecNewEventFromList');
        if (btn && btn !== staleNewBtn && btn.offsetParent !== null) { btn.click(); return; }
        if (Date.now() < deadline) setTimeout(tryClick, 100);
      };
      setTimeout(tryClick, 0);
    }
    return { ok: true };
  }

  function init() {
    if (!window.api || typeof window.api.onCompanionDumpImport !== 'function') return;
    window.api.onCompanionDumpImport(async (req) => {
      const requestId = req && req.requestId;
      window.api.companionOpenSourceProgress(requestId);            // acknowledge at once
      const beat = setInterval(() => window.api.companionOpenSourceProgress(requestId), HEARTBEAT_MS);
      let res;
      try { res = await run(req || {}); }
      catch (err) { res = _refuse('error', (err && err.message) || String(err)); }
      finally { clearInterval(beat); }
      window.api.companionOpenSourceResult(requestId, res);
      _report();
    });
    window.api.onCompanionSelectEvent(async (req) => {
      const requestId = req && req.requestId;
      window.api.companionOpenSourceProgress(requestId);
      let res;
      try { res = await selectEvent(req || {}); }
      catch (err) { res = _refuse('error', (err && err.message) || String(err)); }
      window.api.companionOpenSourceResult(requestId, res);
      _report();
    });
    if (typeof window.api.onCompanionDumpPlanImport === 'function') {
      window.api.onCompanionDumpPlanImport(async (req) => {
        const requestId = req && req.requestId;
        window.api.companionOpenSourceProgress(requestId);            // acknowledge at once
        const beat = setInterval(() => window.api.companionOpenSourceProgress(requestId), HEARTBEAT_MS);
        let res;
        try { res = await runPlan(req || {}, (info) => { try { window.api.companionDumpPlanEvent({ ...info, requestId }); } catch { /* companion disabled */ } }); }
        catch (err) { res = _refuse('error', (err && err.message) || String(err)); }
        finally { clearInterval(beat); }
        window.api.companionOpenSourceResult(requestId, res);
        _report();
      });
    }
    window.api.onCompanionOpenEventPicker((req) => {
      const res = openPicker(req && req.mode === 'new' ? 'new' : 'choose');
      window.api.companionOpenSourceResult(req && req.requestId, res);
    });
    setInterval(_report, REPORT_MS);
    _report();
  }

  return { init, run, runPlan, openPicker, selectEvent, _activeEventInfo };
})();

if (typeof module !== 'undefined') module.exports = EventDumpImport;
