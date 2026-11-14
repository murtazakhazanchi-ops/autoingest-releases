// renderer/eventDumpImport.js — AI-FEAT-064: the main window's link to the menu-bar companion.
//
// Since EQI-2.1 the companion runs Event Dump imports in the main process
// (services/companionImportService.js) and creates events in its own Event Creator window, so this
// window is neither needed nor shown for them. What remains here is non-visual: the main window's
// active event is reported to the companion (names and the event path — the path stays in main),
// so that when the operator changes the event in AutoIngest the companion follows.
'use strict';

const EventDumpImport = (() => {
  const REPORT_MS = 1000;
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
      // The Local First rule of the import-mode choice (started in / adopted from Local Staging).
      localFirst: EventCreator.wasLocalStagingEvent(),
      // EQI-1.2: labels only, so the companion can set the event's types and place apart from its name.
      ..._eventLabels(ed.event.components),
    };
  }

  /** Push the active event to main whenever it changes. */
  function _report() {
    const ev = _activeEventInfo();
    const pickerOpen = typeof EventMgmt !== 'undefined' && typeof EventMgmt.isOpen === 'function' ? EventMgmt.isOpen() : false;
    const info = ev ? { ...ev, pickerOpen } : (pickerOpen ? { pickerOpen } : null);
    const json = JSON.stringify(info);
    if (json === _lastReport) return;
    _lastReport = json;
    try { window.api.companionWorkspaceEvent(info); } catch { /* companion disabled */ }
  }

  function init() {
    if (!window.api || typeof window.api.companionWorkspaceEvent !== 'function') return;
    setInterval(_report, REPORT_MS);
    _report();
  }

  return { init, _activeEventInfo };
})();

if (typeof module !== 'undefined') module.exports = EventDumpImport;
