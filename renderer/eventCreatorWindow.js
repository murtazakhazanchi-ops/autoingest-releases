// renderer/eventCreatorWindow.js — host for the companion's Event Creator window (AI-FEAT-064 EQI-2.1).
//
// The window runs the SAME EventCreator and EventMgmt modules as the main window and starts them the
// same way the main window does at launch (primeFromSettings → effective archive root →
// restoreLastEvent), so the collection, date, type, location/city rules, event naming, sequence
// allocation, event.json creation, archive routing, validation and error handling are the existing
// ones. Only the main window's navigation is absent: instead of returning to its landing screen,
// this window reports the outcome to the companion and is closed by main.
//
//   create  → "+ Create New Event" form opens at once; Continue creates the event.
//   cancel  → Back / Esc / closing the window: nothing is created.
//   choose  → picking an existing event in the list and pressing Continue also returns it.
'use strict';

(function () {
  let reported = false;
  const report = (result) => {
    if (reported) return;
    reported = true;
    try { window.api.eventCreatorWindowResult(result); } catch { /* window is closing */ }
  };

  // The main window's navigation helpers that EventCreator may call; here there is nothing to show.
  window.showLanding = () => {};
  window.updateSteps = () => {};

  const $ = (id) => document.getElementById(id);
  const busyGuard = (id, fn) => async () => {
    const btn = $(id);
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    try { await fn(); } finally { if (EventMgmt.isOpen() && !reported) btn.disabled = false; }
  };

  // Footer actions — the same calls the main window's renderer makes (renderer.js, Event Management).
  $('emmBackBtn').addEventListener('click', () => EventMgmt.handleBack());
  $('emmCreateBtn').addEventListener('click', busyGuard('emmCreateBtn', () => EventCreator.tryCreateEvent()));
  $('emmContinueBtn').addEventListener('click', busyGuard('emmContinueBtn', () => EventCreator.adoptSelectedEvent()));
  // Editing, sequencing and repair stay in the main application.
  for (const id of ['emmEditBtn', 'emmSeqFoldersBtn', 'emmSaveBtn', 'emmRepairBtn']) {
    const b = $(id); if (b) b.remove();
  }
  document.addEventListener('eventcreator:listSelect', () => { const c = $('emmContinueBtn'); if (c) c.disabled = false; });
  document.addEventListener('eventcreator:listDeselect', () => { const c = $('emmContinueBtn'); if (c) c.disabled = true; });
  document.addEventListener('eventcreator:openArchiveLocations', () => {
    window.alert('Archive Locations are set in AutoIngest. Open AutoIngest from the menu bar to change them.');
  });

  document.addEventListener('eventcreator:done', () => {
    const ed = EventCreator.getActiveEventData();
    if (!ed || !ed.eventPath) { report({ ok: false, reason: 'no-event' }); return; }
    report({ ok: true, eventPath: ed.eventPath, pendingSync: EventCreator.isPendingSync(), localFirst: EventCreator.wasLocalStagingEvent() });
  });
  document.addEventListener('eventmgmt:requestClose', () => report({ ok: false, reason: 'cancelled' }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.tac-dropdown.open, .ec-modal-overlay')) EventMgmt.requestClose();
  });

  async function start() {
    try { await EventCreator.primeFromSettings(); } catch { /* as the main window */ }
    try {
      const st = await window.api.getArchiveOperationsStatus();
      const root = (st && (st.effectiveNasRoot || st.nasRoot)) || null;
      if (root && root !== EventCreator.getSessionArchiveRoot()) EventCreator.setSessionArchiveRoot(root);
    } catch { /* EventCreator explains a missing archive itself */ }
    await EventCreator.restoreLastEvent();
    EventMgmt.open({ mode: 'select' });
    const stale = $('ecNewEventFromList');
    EventCreator.resetToList();
    // Straight into the existing "+ Create New Event" form (the list renders asynchronously).
    const deadline = Date.now() + 15000;
    const tryClick = () => {
      const btn = $('ecNewEventFromList');
      if (btn && btn !== stale && btn.offsetParent !== null) { btn.click(); document.body.dataset.ready = 'create'; return; }
      if (Date.now() < deadline) setTimeout(tryClick, 100);
      else document.body.dataset.ready = 'list';
    };
    setTimeout(tryClick, 0);
  }

  start().catch((err) => { console.error('[EventCreatorWindow] start failed:', (err && (err.code || err.name)) || 'error'); report({ ok: false, reason: 'start-failed' }); });
}());
