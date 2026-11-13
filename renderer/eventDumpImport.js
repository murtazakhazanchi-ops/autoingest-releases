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

    const isMulti = Array.isArray(ed.event.components) && ed.event.components.length > 1;
    // Dump media belongs to no component yet: single-component events keep the event's own
    // component keywords (group 0, as a normal import); multi-component events get an explicit
    // "no component keyword" ([]) until Sort Dump assigns the component.
    const group = { id: isMulti ? -1 : 0, subEventId: null, metadataTags: isMulti ? [] : null, files: [...req.files], fileTagRefinements: null };
    const item = {
      eventKey: ed.eventPath, ordinal: 1, name: ed.event.name,
      eventPath: ed.eventPath, collectionPath: ed.collectionPath, routingEventData: ed, fileJobs,
    };
    const sourceMeta = { type: 'memory-card', label: (req.source && req.source.label) || 'Memory card', path: (req.source && req.source.path) || '' };
    const importedBy = _activeUser ? { id: _activeUser.id, name: _activeUser.name } : null;

    _running = true;
    importRunning = true;
    let result;
    try {
      result = await ImportSessionRunner.run({ events: [item], hasBlocking: false }, {
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
        commit: async (it, prepared) => {
          const summary = await window.api.commitImportTransaction(prepared.txFileJobs, prepared.txEventPath, {
            collName: ed.coll && ed.coll.name,
            photographer,
            subEventNames: [],
            liveComps: ed.event.components,
            groups: [group],
            source: sourceMeta,
            importedBy,
            importMode,
            destination: 'dump',
          });
          if (importMode === 'local-first') {
            try { _sessRegisterLocalFirst(it, prepared, summary, photographer); }
            catch (err) { console.error('[EventDump] sync manifest registration failed (event already committed):', err); }
          }
          return summary;
        },
      });
    } catch (err) {
      return _refuse('error', ImportSessionRunner.cleanMessage(err));
    } finally {
      importRunning = false;
      _running = false;
    }

    try {
      EventCreator.invalidateScannedEvents();
      globalImportIndex = await window.api.getImportIndex() || {};
    } catch { /* non-critical */ }

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
    window.api.onCompanionOpenEventPicker((req) => {
      const res = openPicker(req && req.mode === 'new' ? 'new' : 'choose');
      window.api.companionOpenSourceResult(req && req.requestId, res);
    });
    setInterval(_report, REPORT_MS);
    _report();
  }

  return { init, run, openPicker, selectEvent, _activeEventInfo };
})();

if (typeof module !== 'undefined') module.exports = EventDumpImport;
