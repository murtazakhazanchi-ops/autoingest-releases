// renderer/importSessionUI.js
// ── Multi-event import — renderer UI glue ────────────────────────────────────
//
// Wires the pure model (importSession.js) and runner (importSessionRunner.js) into the
// existing Import workspace. Everything here is presentation + orchestration; routing,
// metadata context, copy safety and event transactions are all still the existing code.
//
// Loaded BEFORE renderer.js. Top-level code only declares functions/state and registers DOM
// listeners; every reference to a renderer.js global (selectedFiles, tileMap, EventMgmt,
// showProgress, …) is resolved lazily at call time, after renderer.js has loaded.
//
// Concepts (see importSession.js): UI selection ≠ persistent file→event assignment;
// Current Event ≠ a file's assigned event; per-event working state lives in isolated
// GroupManager instance.
'use strict';

// ── State ────────────────────────────────────────────────────────────────────

let _ecReturnTarget   = null;   // 'workspace' while the event picker was opened from the Import workspace
let _ecReturnSnapshot = null;   // EventCreator.captureActiveSelection() taken when it opened
let _ecSwitchReq      = 0;      // stale-guard for the async return-from-picker path
let _importWasSession = false;  // true when the last import ran through the session path
let _multiImportAbort = false;  // set on source disconnect / abort; owned by the runner, never reset by a copy
let _sessionRunBusy   = false;  // blocks re-entry while review modals / a run are in flight
let _sessMetaPollTimers = [];   // per-event metadata status pollers in the run summary

// ── Small DOM helpers (no innerHTML for event names → no injection) ──────────

function _sessEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

/** Event data for the Current Event, plus the archive flags Local First rules depend on. */
function _captureEventData() {
  const ed = EventCreator.getActiveEventData();
  if (!ed || !ed.eventPath) return null;
  return { ...ed, isPendingSync: EventCreator.isPendingSync(), wasLocalStagingEvent: EventCreator.wasLocalStagingEvent() };
}

function _sessShortName(name, max = 24) {
  const n = String(name || '');
  return n.length > max ? n.slice(0, max - 1) + '…' : n;
}

// ── Event ownership badges (E1/E2…) ──────────────────────────────────────────
// Ownership is derived from the per-event stores; the badge is a pure projection of it.
// Shown when it adds information: ≥2 events participate, the owner is NOT the Current
// Event, or the file was assigned directly (no group badge to acknowledge it). Nothing
// extra appears in the ordinary one-event workflow.

function _eventBadgeCtx() {
  return { participating: ImportSession.participatingCount(), currentKey: ImportSession.getCurrentKey() };
}

function _eventBadgeInfo(path, ctx) {
  const o = ImportSession.ownerOf(path);
  if (!o) return null;
  const isCurrent = o.key === ctx.currentKey;
  const isDirect = o.ws.directFiles.has(path);
  if (!(ctx.participating >= 2 || !isCurrent || isDirect)) return null;
  const ev = o.ws.eventData && o.ws.eventData.event;
  return { text: `E${o.ordinal}`, isCurrent, title: `Assigned to E${o.ordinal} — ${(ev && (ev.displayName || ev.name)) || ''}` };
}

function _eventBadgeHtmlIcon(path, ctx) {
  const i = _eventBadgeInfo(path, ctx);
  return i ? `<div class="file-event-badge${i.isCurrent ? ' is-current' : ''}" title="${_esc(i.title)}">${i.text}</div>` : '';
}

function _eventBadgeHtmlList(path, ctx) {
  const i = _eventBadgeInfo(path, ctx);
  return i ? `<span class="evb-list${i.isCurrent ? ' is-current' : ''}" title="${_esc(i.title)}">${i.text}</span>` : '';
}

/** O(1) per tile via tileMap — same targeted-sync pattern as syncGroupBadge. */
function syncEventBadge(path, ctx) {
  const tile = tileMap.get(path);
  if (!tile) return;
  const info = _eventBadgeInfo(path, ctx || _eventBadgeCtx());

  if (viewMode === 'icon') {
    let badge = tile.querySelector('.file-event-badge');
    if (info) {
      if (!badge) {
        badge = document.createElement('div');
        const metaRight = tile.querySelector('.file-meta-right');
        if (metaRight) metaRight.insertBefore(badge, metaRight.firstChild); else tile.appendChild(badge);
      }
      badge.className = 'file-event-badge' + (info.isCurrent ? ' is-current' : '');
      badge.textContent = info.text;
      badge.title = info.title;
    } else if (badge) {
      badge.remove();
    }
  } else {
    const nameCell = tile.querySelector('.lt-name');
    if (!nameCell) return;
    let badge = nameCell.querySelector('.evb-list');
    if (info) {
      if (!badge) {
        badge = document.createElement('span');
        const grp = nameCell.querySelector('.grp-badge-list');
        nameCell.insertBefore(badge, grp || null);
      }
      badge.className = 'evb-list' + (info.isCurrent ? ' is-current' : '');
      badge.textContent = info.text;
      badge.title = info.title;
    } else if (badge) {
      badge.remove();
    }
  }
}

function syncAllEventBadges() {
  const ctx = _eventBadgeCtx();
  for (const [path] of tileMap) syncEventBadge(path, ctx);
}

/** Targeted variant for a known set of changed paths. */
function syncEventBadgesFor(paths) {
  const ctx = _eventBadgeCtx();
  for (const p of paths) syncEventBadge(p, ctx);
}

// ── Import Session strip (context bar, line 3) ───────────────────────────────

let _sessStripSig = '';

function _renderSessionStrip() {
  const row = document.getElementById('ctxLine3Session');
  if (!row) return;
  // Ordinary one-event workflow (no session assignments): nothing to show and no O(files) work.
  if (importMode !== 'event' || !ImportSession.hasAssignments()) {
    if (_sessStripSig !== '') { _sessStripSig = ''; row.style.display = 'none'; }
    return;
  }
  const viewPaths = Array.isArray(currentFiles) ? currentFiles.map(f => f.path) : null;
  const sum = ImportSession.getSummary(viewPaths);
  const show = importMode === 'event' && sum.events.length > 0 &&
    (sum.events.length >= 2 || !ImportSession.isLegacyEligible());

  const sig = show ? JSON.stringify([sum.events.map(e => [e.ordinal, e.name, e.fileCount, e.isCurrent]), sum.assignedTotal, sum.unassignedInView]) : '';
  if (sig === _sessStripSig) return;
  _sessStripSig = sig;

  if (!show) { row.style.display = 'none'; return; }
  row.style.display = '';

  const chips = document.getElementById('ctxSessionChips');
  chips.textContent = '';
  for (const e of sum.events) {
    const chip = _sessEl('span', 'ctx-session-chip' + (e.isCurrent ? ' is-current' : ''));
    chip.appendChild(_sessEl('span', 'evb-list' + (e.isCurrent ? ' is-current' : ''), `E${e.ordinal}`));
    const nm = _sessEl('span', 'ctx-session-chip-name', e.name);
    nm.title = e.name;
    chip.appendChild(nm);
    chip.appendChild(_sessEl('span', 'ctx-session-chip-count', `${e.fileCount}`));
    chips.appendChild(chip);
  }
  const un = document.getElementById('ctxSessionUnassigned');
  un.textContent = `${sum.assignedTotal} assigned` + (sum.unassignedInView != null ? ` · ${sum.unassignedInView} unassigned in this view` : '');
  // The count only covers files LOADED in the current view (tree-mode sources are not scanned up front) —
  // say so, and state the invariant that protects everything else.
  un.title = 'Counts only the files loaded in the current view. Only assigned files are ever imported; ' +
             'every other file on the source (in view or not) is left untouched.';
}

// ── Assign to Current Event (single-component events) ────────────────────────
// Multi-component events establish ownership through their groups, so no extra step exists
// for them. For events without groups, an explicit action makes the assignment — it is never
// implied by changing event or by pressing Import.

function _currentEventIsGroupless() {
  if (importMode !== 'event') return false;
  const ed = EventCreator.getActiveEventData();
  return !!ed && (ed.event?.components?.length ?? 0) === 1;
}

function _syncAssignButtons() {
  const assignBtn = document.getElementById('assignEventBtn');
  const unBtn = document.getElementById('unassignEventBtn');
  if (!assignBtn || !unBtn) return;

  const eligible = _currentEventIsGroupless() && !importRunning && selectedFiles.size > 0;
  if (!eligible) { assignBtn.style.display = 'none'; unBtn.style.display = 'none'; return; }

  const ws = ImportSession.getCurrent();
  const owned = (p) => !!ws && (ws.directFiles.has(p) || ws.groups.getFileGroupMap().has(p));
  let canAssign = false, canUnassign = false;
  for (const p of selectedFiles) {
    if (ws && ws.directFiles.has(p)) canUnassign = true;
    if (!owned(p)) canAssign = true;
    if (canAssign && canUnassign) break;
  }

  const name = EventCreator.getActiveEventData()?.event?.displayName || EventCreator.getActiveEventData()?.event?.name || 'Event';
  assignBtn.textContent = `Assign to ${_sessShortName(name)}`;
  assignBtn.title = `Assign the selected files to “${name}”. Assigned files import into this event even after you change event.`;
  assignBtn.style.display = canAssign ? '' : 'none';
  unBtn.style.display = canUnassign ? '' : 'none';
}

function assignSelectionToCurrentEvent() {
  const ed = _captureEventData();
  if (!ed || !_currentEventIsGroupless() || selectedFiles.size === 0) return;
  ImportSession.switchTo(ed);
  const paths = [...selectedFiles];
  const r = ImportSession.assignDirect(paths);
  const claim = ImportSession.takeLastClaim();
  if (r.assigned === 0) return;

  // Same post-assign treatment as ⌘G: the selection is consumed, ownership persists.
  selectedFiles.clear();
  syncAllTiles();
  syncAllGroupBadges();
  updateSelectionBar();

  const cw = ImportSession.getCurrent();
  let msg = `Assigned ${r.assigned} file${r.assigned === 1 ? '' : 's'} to E${cw ? cw.ordinal : ''}`;
  if (claim && claim.reassigned > 0) msg += ` (${claim.reassigned} moved from ${claim.fromOrdinals.map(o => 'E' + o).join(', ')})`;
  showMessage(msg, 5000);
}

function unassignSelectionFromCurrentEvent() {
  const ws = ImportSession.getCurrent();
  if (!ws) return;
  const direct = [...selectedFiles].filter(p => ws.directFiles.has(p));
  if (direct.length === 0) return;
  ImportSession.release(direct);
  syncAllGroupBadges();
  updateSelectionBar();
  showMessage(`Removed ${direct.length} file${direct.length === 1 ? '' : 's'} from the event`, 4000);
}

document.getElementById('assignEventBtn')?.addEventListener('click', assignSelectionToCurrentEvent);
document.getElementById('unassignEventBtn')?.addEventListener('click', unassignSelectionFromCurrentEvent);

/** Called at the end of updateSelectionBar(): keeps the session UI in step with selection/ownership. */
function _syncSessionSelectionUI() {
  _syncAssignButtons();
  _renderSessionStrip();
  if (importMode !== 'event') return;
  const importBtn = document.getElementById('importBtn');
  if (!importBtn || ImportSession.isLegacyEligible()) return;   // legacy label/visibility already set
  const total = ImportSession.getSummary().assignedTotal;
  importBtn.classList.toggle('visible', total > 0);
  importBtn.disabled = total === 0 || importRunning;
  importBtn.innerHTML = `${SVG.download} Import ${total} Assigned File${total === 1 ? '' : 's'}`;
}

// ── Change Event from inside the Import workspace ────────────────────────────
// Reuses the existing event picker/creator (EventMgmt + EventCreator) unchanged; only the
// exit differs: instead of landing on the home screen it returns to THIS workspace, with the
// source, folder navigation, thumbnails and every event's assignments intact.

function _refreshEventWorkspaceUI() {
  _updateContextBar();
  renderGroupPanel();            // also refreshes the session strip
  syncAllGroupBadges();          // group badges (current event) + event badges
  updateSelectionBar();
  updateSteps();
  _renderMetaTitleIndicator();
}

function openEventPickerFromWorkspace(opts = {}) {
  if (importRunning || _sessionRunBusy) return;
  const cur = _captureEventData();
  if (!cur) { showMessage('No active event to change.'); return; }
  ImportSession.switchTo(cur);   // make sure the current event's workspace exists and is bound
  _ecReturnTarget = 'workspace';
  _ecReturnSnapshot = EventCreator.captureActiveSelection();
  if (opts.preselect) EventCreator.preselectEvent(opts.preselect.collectionName, opts.preselect.eventFolderName);
  _ecPanelOpen();                // rail → event mode, open EventMgmt, hide context bar
  EventCreator.resetToList();
}

/**
 * True only while the picker was opened from a LIVE Import workspace. The target is also cleared here
 * when it has gone stale: the picker can be closed by paths that never fire a handled exit (e.g.
 * resetAppState() → EventMgmt.close() on card removal), and a stale target would later hijack an
 * unrelated landing-screen event change into a phantom workspace return.
 */
function _ecReturnsToWorkspace() {
  if (_ecReturnTarget !== 'workspace') return false;
  const alive = !!activeSource && ImportSession.getCurrentKey() !== null &&
    document.getElementById('workspace').classList.contains('visible');
  if (!alive) { _ecReturnTarget = null; _ecReturnSnapshot = null; return false; }
  return true;
}

/**
 * The picker finished (event adopted/created) or was dismissed. Hydrate FIRST (async), then
 * swap workspaces SYNCHRONOUSLY so the state is never half-switched across an await.
 */
async function _returnToWorkspaceFromPicker(cancelled) {
  const snap = _ecReturnSnapshot;
  const req = ++_ecSwitchReq;
  _ecReturnTarget = null;
  _ecReturnSnapshot = null;

  try {
    let ed = cancelled ? null : _captureEventData();
    if (cancelled || !ed) {
      EventCreator.restoreActiveSelection(snap);
      ed = _captureEventData();
    }
    if (ed) {
      // resetToList() cleared EventCreator's locked components, and a freshly created event
      // leaves a blank placeholder — re-read from disk so the workspace has real components.
      let loaded = await EventCreator.reloadForImport(ed.eventPath);
      if (req !== _ecSwitchReq) return;   // a newer return superseded this one
      if (!loaded && !cancelled) {
        showMessage('Event details could not be loaded — staying on the previous event.', 6000);
        EventCreator.restoreActiveSelection(snap);
        ed = _captureEventData();
        loaded = ed ? await EventCreator.reloadForImport(ed.eventPath) : false;
        if (req !== _ecSwitchReq) return;
      }
      const finalEd = _captureEventData();
      if (finalEd) ImportSession.switchTo(finalEd);
    }
  } catch (err) {
    console.error('[ImportSession] return from event picker failed:', err);
    // Never leave EventCreator on one event and the session/facade bound to another: fall back to
    // the event the operator was working on, and rebind the session to it.
    try {
      EventCreator.restoreActiveSelection(snap);
      const back = _captureEventData();
      if (back) {
        try { await EventCreator.reloadForImport(back.eventPath); } catch { /* best effort */ }
        ImportSession.switchTo(back);
      }
    } catch (restoreErr) {
      console.error('[ImportSession] restoring the previous event failed:', restoreErr);
    }
    showMessage('Could not switch events — staying on the previous event.', 6000);
  } finally {
    if (req === _ecSwitchReq) {
      EventMgmt.close();
      setRailMode('card');
      _refreshEventWorkspaceUI();
    }
  }
}

document.getElementById('ctxChangeEventBtn')?.addEventListener('click', () => openEventPickerFromWorkspace());

// ── Editing a participating event is blocked (v1) ────────────────────────────
// Editing/renaming would change the event key, component ids and sub-event ids that
// assignments and group mappings are bound to. Events with NO assignments in
// the current session stay editable exactly as before.

EventCreator.setEditGuard((eventPath, folderName) => {
  const blocked = ImportSession.isParticipating(eventPath) ||
    ImportSession.isParticipatingByName(EventCreator.getSelectedCollection(), folderName);
  if (!blocked) return true;
  showMessage(
    'Files in this import session are assigned to this event, so it can’t be edited or renamed right now. ' +
    'Remove its file assignments first (unassign the files or remove their groups), or import them — then edit the event.',
    12000
  );
  return false;
});

// ── Session dialogs (built with the app's existing modal classes) ────────────

/** @returns {Promise<any>} value of the clicked action (Esc / backdrop → the action flagged `cancel`) */
function _sessDialog({ title, body, actions, maxWidth = 520 }) {
  return new Promise(resolve => {
    const overlay = _sessEl('div', 'ec-modal-overlay');
    const box = _sessEl('div', 'ec-modal-box');
    box.style.maxWidth = `${maxWidth}px`;
    box.appendChild(_sessEl('div', 'ec-modal-title', title));
    const bodyEl = _sessEl('div', 'ec-modal-body');
    bodyEl.appendChild(body);
    box.appendChild(bodyEl);
    const bar = _sessEl('div', 'ec-modal-actions');
    const cancelValue = (actions.find(a => a.cancel) || {}).value;

    const done = (value) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(cancelValue); } };
    for (const a of actions) {
      const b = _sessEl('button', a.primary ? 'ec-continue-btn' : 'ec-outline-btn', a.label);
      b.type = 'button';
      b.addEventListener('click', () => done(a.value));
      bar.appendChild(b);
    }
    box.appendChild(bar);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey, true);
    bar.querySelector('button:last-child')?.focus();
  });
}

function _sessGroupByEvent(items) {
  const byEvent = new Map();
  for (const it of items) {
    if (!byEvent.has(it.eventKey)) byEvent.set(it.eventKey, { ordinal: it.ordinal, name: it.eventName, key: it.eventKey, messages: [] });
    byEvent.get(it.eventKey).messages.push(it.message);
  }
  return [...byEvent.values()].sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * Validation findings, grouped by the event they belong to.
 * blocking → resolves { goto: eventKey } | null;  non-blocking → resolves true (continue) | false.
 */
async function showSessionIssuesModal(items, { blocking }) {
  const body = _sessEl('div');
  body.appendChild(_sessEl('p', null, blocking
    ? 'These problems must be fixed before importing. Nothing has been copied.'
    : 'These are not blocking, but please review them before importing.'));
  const gotoButtons = [];
  for (const ev of _sessGroupByEvent(items)) {
    const wrap = _sessEl('div', 'ei-sess-event');
    const head = _sessEl('div', 'ei-sess-event-head');
    head.appendChild(_sessEl('span', 'evb-list', `E${ev.ordinal}`));
    head.appendChild(_sessEl('span', null, ev.name));
    wrap.appendChild(head);
    const ul = _sessEl('ul');
    ul.style.margin = '2px 0 4px 18px';
    for (const m of ev.messages) ul.appendChild(_sessEl('li', null, m));
    wrap.appendChild(ul);
    body.appendChild(wrap);
    if (blocking) gotoButtons.push(ev);
  }

  if (!blocking) {
    return _sessDialog({
      title: 'Review before importing', body,
      actions: [{ label: 'Cancel', value: false, cancel: true }, { label: 'Continue anyway', value: true, primary: true }],
    });
  }

  // One "Go to Ex" button per blocking event: reopens the event picker with that event highlighted.
  const actions = gotoButtons.slice(0, 3).map(ev => ({ label: `Go to E${ev.ordinal}`, value: { goto: ev.key } }));
  actions.push({ label: 'Close', value: null, cancel: true, primary: true });
  const result = await _sessDialog({ title: 'Cannot import yet', body, actions });
  if (result && result.goto) {
    const ws = ImportSession.getWorkspace(result.goto);
    const coll = ws?.eventData?.coll?.name, ev = ws?.eventData?.event?.name;
    if (coll && ev) {
      _sessionRunBusy = false;   // the import attempt is over; the picker refuses to open while it is busy
      openEventPickerFromWorkspace({ preselect: { collectionName: coll, eventFolderName: ev } });
    }
  }
  return result;
}

function showSessionConfirm({ title, message, confirmLabel, cancelLabel = 'Cancel' }) {
  return _sessDialog({
    title, body: _sessEl('p', null, message),
    actions: [{ label: cancelLabel, value: false, cancel: true }, { label: confirmLabel, value: true, primary: true }],
  });
}

// ── Combined review (one photographer, one import method, every event) ───────
// Reuses the existing Confirm Event Import overlay and _renderDestinationTree; the
// per-event sections are just that renderer called once per event.

function _sessGroupsForTree(item) {
  return item.groups.map(g => ({ ...g, files: new Set(g.files) }));
}

/** @returns {Promise<{photographer:string, importMode:string}|null>} */
async function showSessionReviewModal(plan) {
  let archiveStatus = {};
  try { archiveStatus = await window.api.getArchiveOperationsStatus(); } catch { /* non-critical */ }

  return new Promise(resolve => {
    const overlay = document.getElementById('eventImportOverlay');
    const importBtn = document.getElementById('eiImportBtn');
    const titleEl = document.querySelector('#eventImportModal h3');
    const prevTitle = titleEl ? titleEl.textContent : '';
    if (titleEl) titleEl.textContent = 'Confirm Multi-Event Import';
    document.getElementById('eiEventName').textContent =
      `${plan.events.length} event${plan.events.length === 1 ? '' : 's'} · ${plan.totals.assigned} file${plan.totals.assigned === 1 ? '' : 's'}`;

    // Per-event destination structure (existing renderer, once per event)
    const treeEl = document.getElementById('cmDestinationTree');
    const renderTrees = (photographerName) => {
      treeEl.textContent = '';
      for (const item of plan.events) {
        const head = _sessEl('div', 'ei-sess-event-head');
        head.appendChild(_sessEl('span', 'evb-list', `E${item.ordinal}`));
        head.appendChild(_sessEl('span', null, item.name));
        head.appendChild(_sessEl('span', 'ei-sess-count', `${item.fileCount} file${item.fileCount === 1 ? '' : 's'}`));
        treeEl.appendChild(head);
        const wrap = _sessEl('div', 'ei-sess-tree');
        wrap.innerHTML = _renderDestinationTree(_sessGroupsForTree(item), item.routingEventData, photographerName);
        treeEl.appendChild(wrap);
      }
    };

    // Photographer — ONE for the whole import session (applied to every event's own routing)
    const container = document.getElementById('eiPhotographerContainer');
    container.innerHTML = '';
    if (_eiPhotographerDD) { _eiPhotographerDD.destroy(); _eiPhotographerDD = null; }
    importBtn.disabled = true;

    // Group → component mapping, per event
    const mappingSection = document.getElementById('eiMappingSection');
    const mappingTable = document.getElementById('eiMappingTable');
    mappingSection.style.display = '';
    mappingTable.textContent = '';
    for (const item of plan.events) {
      const head = _sessEl('div', 'ei-sess-event-head');
      head.appendChild(_sessEl('span', 'evb-list', `E${item.ordinal}`));
      head.appendChild(_sessEl('span', null, item.name));
      head.appendChild(_sessEl('span', 'ei-sess-count', `${item.fileCount} file${item.fileCount === 1 ? '' : 's'}`));
      mappingTable.appendChild(head);
      if (!item.isMulti) continue;
      item.groups.forEach((g, idx) => {
        const row = _sessEl('div', 'ei-map-row');
        const lab = _sessEl('span', 'ei-map-group', g.label);
        lab.style.setProperty('--group-color', GroupManager.getGroupColor(idx));
        row.appendChild(lab);
        row.appendChild(_sessEl('span', 'ei-map-arrow', '→'));
        row.appendChild(_sessEl('span', 'ei-map-sub', g.subEventId || '—'));
        row.appendChild(_sessEl('span', 'ei-map-count', `${g.files.length} file${g.files.length === 1 ? '' : 's'}`));
        mappingTable.appendChild(row);
      });
    }

    // Import method — session-wide. Mirrors showEventImportConfirmModal's method block
    // (kept separate so the proven single-event modal is untouched).
    const nasStatus = archiveStatus.status || '';
    const nasRoot = archiveStatus.effectiveNasRoot || archiveStatus.nasRoot || null;
    const stagingRoot = archiveStatus.localStagingRoot || null;
    const nasUsable = !!nasRoot && ['ready', 'local-staging-missing'].includes(nasStatus);
    const lastSeg = p => (p || '').replace(/\\/g, '/').replace(/\/$/, '').split('/').filter(Boolean).pop() || '';
    const localFirstRadio = document.getElementById('eiModeLocalFirst');
    const directNasRadio = document.getElementById('eiModeDirectNas');
    const modeStatusEl = document.getElementById('eiModeStatus');
    const modeDestEl = document.getElementById('eiModeDestPreview');
    const optLocalFirst = document.getElementById('eiOptLocalFirst');
    const optDirectNas = document.getElementById('eiOptDirectNas');
    const anyPendingLocal = plan.events.some(e => e.isPendingSync);
    const anyLocalStaging = plan.events.some(e => e.wasLocalStagingEvent);
    let mode = archiveStatus.defaultImportMode || 'direct-nas';

    const modeStatus = (m) => {
      if (m === 'direct-nas') {
        if (!nasRoot || nasStatus === 'nas-not-set') return { text: 'Archive not configured', cls: 'warn' };
        if (nasStatus === 'nas-disconnected') return { text: 'Archive not connected', cls: 'err' };
        if (nasStatus === 'invalid-nas') return { text: 'Invalid archive root', cls: 'err' };
      } else if (m === 'local-first' && !stagingRoot) return { text: 'Set local staging first', cls: 'warn' };
      return { text: '', cls: '' };
    };
    const destPreview = (m, phName) => {
      const ph = phName || '(photographer)';
      const rows = [];
      for (const item of plan.events) {
        const base = (root) => [lastSeg(root), lastSeg(item.collectionPath), lastSeg(item.eventPath), ph].filter(Boolean).join('/') + '/';
        if (m === 'direct-nas' && nasUsable) rows.push([`E${item.ordinal} Archive`, base(nasRoot)]);
        if (m === 'local-first') {
          if (stagingRoot) rows.push([`E${item.ordinal} Local`, base(stagingRoot)]);
          if (nasUsable) rows.push([`E${item.ordinal} Archive`, base(nasRoot)]);
        }
      }
      modeDestEl.textContent = '';
      for (const [lbl, path] of rows) {
        const r = _sessEl('div', 'im-dest-row');
        r.appendChild(_sessEl('span', 'im-dest-lbl', lbl));
        const p = _sessEl('span', 'im-dest-path' + (phName ? '' : ' placeholder'), path);
        p.title = path;
        r.appendChild(p);
        modeDestEl.appendChild(r);
      }
      modeDestEl.style.display = rows.length ? '' : 'none';
    };
    const applyMode = (m, phName) => {
      mode = m;
      if (localFirstRadio) localFirstRadio.checked = (m === 'local-first');
      if (directNasRadio) directNasRadio.checked = (m === 'direct-nas');
      optLocalFirst?.classList.toggle('im-selected', m === 'local-first');
      optDirectNas?.classList.toggle('im-selected', m === 'direct-nas');
      const { text, cls } = modeStatus(m);
      if (modeStatusEl) { modeStatusEl.textContent = text; modeStatusEl.className = `im-status-row ${cls}`.trim(); }
      destPreview(m, phName);
      _eiSelectedImportMode = m;
    };

    if (anyPendingLocal) {
      // A participating event exists only in Local Staging: the whole session must go Local First.
      applyMode('local-first', null);
      if (directNasRadio) directNasRadio.disabled = true;
      if (optDirectNas) { optDirectNas.title = 'Direct archive import is blocked until every event is synced'; optDirectNas.style.opacity = '0.45'; }
    } else if (anyLocalStaging) {
      applyMode('local-first', null);
    } else {
      applyMode(mode, null);
    }

    const phName = () => _eiPhotographerDD?.getValue()?.label?.trim() || null;
    _eiPhotographerDD = new TreeAutocomplete({
      container, type: 'photographers', placeholder: 'Search photographer…',
      onSelect: (v) => {
        const label = v?.label?.trim() || null;
        importBtn.disabled = !label;
        renderTrees(label);
        applyMode(mode, label);
      },
    });
    renderTrees(null);

    const abort = new AbortController();
    localFirstRadio?.addEventListener('change', () => { if (localFirstRadio.checked) applyMode('local-first', phName()); }, { signal: abort.signal });
    directNasRadio?.addEventListener('change', () => { if (directNasRadio.checked) applyMode('direct-nas', phName()); }, { signal: abort.signal });

    const t = plan.totals;
    document.getElementById('eiFileSummary').textContent =
      `${t.assigned} file${t.assigned === 1 ? '' : 's'} across ${t.events} event${t.events === 1 ? '' : 's'} will be imported` +
      (t.unassignedInView != null ? ` · ${t.unassignedInView} unassigned file${t.unassignedInView === 1 ? '' : 's'} in the current view (and any not loaded) will stay untouched on the source` : '');

    overlay.classList.add('visible');

    const close = (result) => {
      overlay.classList.remove('visible');
      abort.abort();
      if (titleEl) titleEl.textContent = prevTitle;
      if (directNasRadio) directNasRadio.disabled = false;
      if (optDirectNas) { optDirectNas.title = ''; optDirectNas.style.opacity = ''; }
      mappingTable.textContent = '';
      document.getElementById('eiCancelBtn').removeEventListener('click', onCancel);
      importBtn.removeEventListener('click', onImport);
      if (_eiPhotographerDD) { _eiPhotographerDD.destroy(); _eiPhotographerDD = null; }
      resolve(result);
    };
    const onCancel = () => close(null);
    const onImport = () => {
      const name = phName();
      if (!name) return;
      close({ photographer: name, importMode: mode });
    };
    document.getElementById('eiCancelBtn').addEventListener('click', onCancel, { once: true });
    importBtn.addEventListener('click', onImport, { once: true });
  });
}

// ── The session import ───────────────────────────────────────────────────────

async function runSessionImport() {
  if (importRunning || _sessionRunBusy) return;
  _sessionRunBusy = true;
  try { await _runSessionImportInner(); }
  finally { _sessionRunBusy = false; }
}

async function _runSessionImportInner() {
  _importWasSession = true;
  _multiImportAbort = false;
  // Cleanup-root contract: capture the source root synchronously, before the first await. The audit
  // identity (source, operator) is captured at the same moment: the drive poll may null activeSource
  // mid-run, and every event of the run must record the same source.
  const importCleanupRoot = activeSource?.path || null;
  const sourceMeta = _buildImportSourceMeta();
  const importedBy = _activeUser ? { id: _activeUser.id, name: _activeUser.name } : null;

  const cur = _captureEventData();
  if (cur) ImportSession.switchTo(cur);   // refreshes the current event's data

  const assigned = ImportSession.getSummary();
  if (assigned.events.length === 0) { showMessage('No files are assigned to an event yet. Assign files first.'); return; }

  // Re-read every participating event from disk (event.json is the source of truth) — a
  // problem in Event B must surface even while Event A is the visible one.
  const fresh = new Map();
  await Promise.all(assigned.events.map(async (e) => {
    let snap = null;
    try { snap = await EventCreator.loadEventSnapshot(ImportSession.getWorkspace(e.key).eventData.eventPath); } catch { snap = null; }
    fresh.set(e.key, snap);
  }));

  const viewPaths = (currentFiles || []).map(f => f.path);
  let plan = ImportSession.buildPlan({ photographer: null, fresh, viewPaths });
  if (plan.hasBlocking) { await showSessionIssuesModal(plan.errors, { blocking: true }); return; }

  if (plan.totals.unassignedInView > 0) {
    const n = plan.totals.unassignedInView;
    const proceed = await showSessionConfirm({
      title: 'Unassigned files',
      message: `${n} file${n === 1 ? '' : 's'} in the current view ${n === 1 ? 'is' : 'are'} not assigned to any event. ` +
               `${n === 1 ? 'It' : 'They'} will not be imported and will remain on the source. ` +
               'Files outside this view are not counted here; only assigned files are ever imported.',
      confirmLabel: 'Continue anyway',
    });
    if (!proceed) return;
  }
  if (plan.warnings.length > 0) {
    const proceed = await showSessionIssuesModal(plan.warnings, { blocking: false });
    if (!proceed) return;
  }

  const choice = await showSessionReviewModal(plan);
  if (!choice) return;

  plan = ImportSession.buildPlan({ photographer: choice.photographer, importMode: choice.importMode, fresh, viewPaths });
  if (plan.hasBlocking) { await showSessionIssuesModal(plan.errors, { blocking: true }); return; }
  const allJobs = plan.events.flatMap(e => e.fileJobs);
  if (allJobs.length === 0) { showMessage('No files to import.'); return; }

  // ── Pre-flight, once for the whole session (mirrors the single-event checks) ──
  let archSt = {};
  try { archSt = await window.api.getArchiveOperationsStatus(); } catch { /* non-critical */ }
  if (choice.importMode === 'local-first') {
    if (!archSt.localStagingRoot) { showMessage('Local staging root is not configured. Cannot use Local First mode.'); return; }
  } else {
    if (archSt.status === 'nas-disconnected' || archSt.status === 'invalid-nas') {
      showMessage('Archive offline — switch to Local First mode to import while disconnected.', 6000);
      return;
    }
    if (archSt.nasRoot) {
      for (;;) {
        const lockCheck = await window.api.checkDirectArchiveLocks({ fileJobs: allJobs });
        if (!lockCheck.blocked?.length) break;
        const pick = await _showDirectArchiveBusyDialog(lockCheck.blocked, lockCheck.currentDeviceName ?? null);
        if (pick === 'cancel') return;
        if (pick === 'switch') { showMessage('Switch to Local First in the review and try again.'); return; }
        // 'refresh' / 'clear' → re-check
      }
    }
  }

  importRunning = true;
  updateSelectionBar();
  _csqEligibleFiles = null;
  _csqSourceRoot = null;
  document.getElementById('scqOpenBtn')?.remove();
  _sessMetaPollTimers.forEach(clearTimeout);
  _sessMetaPollTimers = [];
  showProgress();

  const txPathByKey = new Map();   // eventKey → path event.json lives at (staging path in Local First)
  const subEventNamesFor = (item) => (fresh.get(item.eventKey)?.subEventIds || []).map(id => ({ id, name: id }));
  const normSlash = (p) => (p || '').replace(/\\/g, '/').replace(/\/$/, '');
  let result;

  try {
    result = await ImportSessionRunner.run(plan, {
      shouldStop: async () => {
        if (_multiImportAbort || !importRunning) return 'aborted';
        if (importCleanupRoot) {
          let alive = true;
          try { alive = await window.api.dirExists(importCleanupRoot); } catch { alive = false; }
          if (!alive) return 'source-disconnected';
        }
        return null;
      },
      isSourceAlive: async () => (importCleanupRoot ? !!(await window.api.dirExists(importCleanupRoot)) : true),

      prepareEvent: async (item) => {
        if (choice.importMode !== 'local-first') {
          return { ok: true, prepared: { txEventPath: item.eventPath, txFileJobs: item.fileJobs } };
        }
        const normColl = normSlash(item.collectionPath);
        const normStaging = normSlash(archSt.localStagingRoot);
        const collectionName = normColl.split('/').filter(Boolean).pop() || '';
        const mirror = await window.api.ensureLocalMirror({
          collectionName,
          eventName: item.routingEventData.event?.name || '',
          eventPath: item.eventPath,
          eventJsonPath: normSlash(item.eventPath) + '/event.json',
        });
        if (!mirror?.ok) return { ok: false, error: `Local staging setup failed: ${mirror?.reason || 'unknown error'}` };
        const txFileJobs = item.fileJobs.map(job => {
          const nd = job.dest.replace(/\\/g, '/');
          return nd.startsWith(normColl + '/') ? { ...job, dest: normStaging + '/' + collectionName + nd.slice(normColl.length) } : job;
        });
        return { ok: true, prepared: { txEventPath: mirror.localEventPath, txFileJobs } };
      },

      markInProgress: async (item, prepared) => {
        txPathByKey.set(item.eventKey, prepared.txEventPath);
        await window.api.updateEventJson(prepared.txEventPath, { status: 'in-progress' });
      },

      onEventFailed: async (item, prepared) => {
        // Reset to 'created' so the event is not stuck in-progress after a failure — but only if this run
        // actually marked it in-progress; a failure before that point must not downgrade a healthy event.
        if (!prepared) return;
        await window.api.updateEventJson(prepared.txEventPath, { status: 'created' });
      },

      onEventStart: (item, index, total) => {
        const lbl = document.getElementById('progressEventLabel');
        if (lbl) { lbl.style.display = ''; lbl.textContent = `Event ${index + 1} of ${total} — E${item.ordinal} · ${item.name}`; }
        // The copy engine resets pause/abort per event — mirror that in the controls.
        document.getElementById('progressFill').style.width = '0%';
        document.getElementById('progressCount').textContent = '0 / 0';
        document.getElementById('progressFilename').textContent = 'Preparing…';
        document.getElementById('progressEta').textContent = '';
      },

      commit: async (item, prepared, ctx) => {
        // copyFileJobs starts with isPaused=false — put the controls in that state right before it does, so a
        // Pause clicked during the (non-copy) prepare window can't show "Paused" while the engine runs.
        document.getElementById('progressPauseBtn').style.display = '';
        document.getElementById('progressResumeBtn').style.display = 'none';
        const auditContext = {
          collName: item.routingEventData.coll?.name,
          photographer: choice.photographer,
          subEventNames: subEventNamesFor(item),
          liveComps: item.routingEventData.event.components,
          groups: item.groups.map(g => ({
            id: g.id, subEventId: g.subEventId, metadataTags: g.metadataTags ?? null,
            files: [...g.files],
          })),
          source: sourceMeta,
          importedBy,
          importMode: choice.importMode,
          // Multi-event: attribute this transaction's metadata progress to THIS event, and let
          // Deep Verify cover every event of the session.
          progressEventPath: item.eventPath,
          importSessionId: ctx.importSessionId,
        };
        const summary = await window.api.commitImportTransaction(prepared.txFileJobs, prepared.txEventPath, auditContext);
        if (choice.importMode === 'local-first') {
          try { _sessRegisterLocalFirst(item, prepared, summary, choice.photographer); }
          catch (err) { console.error('[LF] sync manifest registration failed (event already committed):', err); }
        }
        return summary;
      },
    });
  } catch (err) {
    console.error('[IMPORT] Multi-event run failed:', err);
    document.getElementById('progressFilename').textContent = `Import failed: ${ImportSessionRunner.cleanMessage(err)}`;
    document.getElementById('progressDoneBtn').classList.add('visible');
    importRunning = false;
    return;
  }

  // Successful events leave the session (so they can never import twice); failed and
  // not-started ones stay assigned for retry. Source and Current Event remain usable.
  ImportSession.completeEvents(result.completedKeys);
  // An event that committed with per-file errors stays assigned for retry, but ONLY its failed files: files it
  // already copied (or same-size-skipped) are released. Their destinations are rewritten in place by metadata
  // tagging (JPEG/PNG/TIFF), so a same-size check would no longer recognise them and a retry would create
  // `_1` duplicates. Nothing here touches the source or the archive — it only stops re-assigning done files.
  for (const e of result.events) {
    if (e.status !== 'completed-with-errors' || !e.summary) continue;
    const done = [...(e.summary.copiedFiles || []), ...(e.summary.skippedFiles || [])].map(f => f.src).filter(Boolean);
    ImportSession.release(done);
  }
  try {
    EventCreator.invalidateScannedEvents();
    await refreshDestCache();
    try { globalImportIndex = await window.api.getImportIndex() || {}; } catch { /* non-critical */ }
    _renderHeroLastImportArea();
  } catch { /* non-critical */ }

  _sessShowRunSummary(result, plan, importCleanupRoot, txPathByKey);
  importRunning = false;
  _refreshEventWorkspaceUI();
}

/** Local First: one pending sync manifest per event, keyed by its own metadata batch. */
function _sessRegisterLocalFirst(item, prepared, summary, photographer) {
  const collName = normalizeSlashPath(item.collectionPath).split('/').filter(Boolean).pop() || '';
  const importedAt = Date.now();
  const importId = summary.metadataBatchId || importedAt.toString(36);
  const prefix = normalizeSlashPath(prepared.txEventPath) + '/';
  const relFiles = (summary.copiedFiles || []).map(cf => {
    const norm = (cf.dest || '').replace(/\\/g, '/');
    return norm.startsWith(prefix) ? norm.slice(prefix.length) : null;
  }).filter(Boolean);
  const eventName = item.routingEventData.event?.name || '';

  if (summary.metadataBatchId) {
    _lfRegisterManifest({
      batchId: summary.metadataBatchId, importId, photographer: photographer || '',
      fileCount: summary.copied || 0, files: relFiles.length > 0 ? relFiles : null,
      localEventPath: prepared.txEventPath, eventName, collectionName: collName, importedAt,
    });
  } else {
    window.api.appendSyncJob(prepared.txEventPath, {
      importId, batchId: null, eventName, collectionName: collName, photographer: photographer || '',
      fileCount: summary.copied || 0, files: relFiles.length > 0 ? relFiles : null, importedAt,
      metadataStatus: 'skipped-disabled', readyForSync: false, needsAttention: true, reason: 'auto-metadata-disabled',
    }).then(() => _archiveNotice('Local import complete.', () => _sqOpen(), 7000))
      .catch(e => console.error('[LF] Failed to append sync job (no-meta):', e));
  }
}

function normalizeSlashPath(p) { return (p || '').replace(/\\/g, '/').replace(/\/$/, ''); }

// ── Run summary ──────────────────────────────────────────────────────────────

function _sessShowRunSummary(result, plan, importCleanupRoot, txPathByKey) {
  const failedFiles = [];
  const skippedReasons = [];
  for (const e of result.events) {
    if (!e.summary) continue;
    for (const f of (e.summary.failedFiles || [])) failedFiles.push({ ...f, filename: `E${e.ordinal} · ${f.filename}` });
    for (const r of (e.summary.skippedReasons || [])) skippedReasons.push(`E${e.ordinal} · ${r}`);
  }

  // Files cleanup may offer = ONLY what transactions reported as copied (see runner contract);
  // showProgressSummary captures the source root passed in, exactly as the single-event path.
  showProgressSummary({
    copied: result.totals.copied, skipped: result.totals.skipped, errors: result.totals.errors,
    skippedReasons, failedFiles, duration: result.totals.duration,
    integrity: result.copiedFiles.length > 0 ? 'verified' : null,
    copiedFiles: result.copiedFiles,
  }, importCleanupRoot, null, { skipQmz: true });

  const clean = result.status === 'completed';
  _postImportSucceeded = clean;
  document.getElementById('progressFilename').textContent =
    clean ? 'Import complete.'
    : result.status === 'aborted' ? 'Import stopped — some events were not imported.'
    : 'Import finished with issues.';
  const lbl = document.getElementById('progressEventLabel');
  if (lbl) lbl.style.display = 'none';

  const summaryEl = document.getElementById('progressSummary');
  summaryEl.querySelector('.sess-run-list')?.remove();
  summaryEl.querySelector('.sess-run-note')?.remove();
  const list = _sessEl('div', 'sess-run-list');
  const polls = [];
  for (const e of result.events) {
    const cls = e.status === 'completed' ? 'sr-completed' : e.status === 'completed-with-errors' ? 'sr-warn' : 'sr-failed';
    const row = _sessEl('div', `sess-run-row ${cls}`);
    row.appendChild(_sessEl('span', 'evb-list', `E${e.ordinal}`));
    row.appendChild(_sessEl('span', 'sr-name', e.name));
    let stat;
    if (e.summary) stat = `${e.summary.copied} copied · ${e.summary.skipped} skipped · ${e.summary.errors} failed`;
    else if (e.status === 'not-started') stat = 'not started';
    else stat = 'failed';
    row.appendChild(_sessEl('span', 'sr-stat', stat));
    let detail = '';
    if (e.status === 'failed') detail = e.error || '';
    else if (e.status === 'not-started') detail = e.reason === 'source-disconnected' ? 'The source was disconnected.' : 'The import was stopped before this event started.';
    else if (e.status === 'completed-with-errors') detail = 'Some files failed — only the failed files stay assigned so you can retry them.';
    if (detail) row.appendChild(_sessEl('span', 'sr-detail', detail));
    if (e.summary && txPathByKey.get(e.eventKey)) {
      const meta = _sessEl('span', 'sr-detail sr-meta', '');
      row.appendChild(meta);
      polls.push({ path: txPathByKey.get(e.eventKey), el: meta });
    }
    list.appendChild(row);
  }
  summaryEl.appendChild(list);

  if (result.retainedKeys.length > 0) {
    summaryEl.appendChild(_sessEl('div', 'sess-run-note',
      `${result.retainedKeys.length} event${result.retainedKeys.length === 1 ? ' is' : 's are'} still assigned. ` +
      'Press Import again to retry: an event that had per-file errors keeps only its failed files, and nothing already copied is re-imported or overwritten.'));
  }

  for (const p of polls) _sessPollRowMetadata(p.path, p.el, 10);

  // "Sort QMZ Photos" is event-specific — offer it per event that actually copied files.
  const actLeft = document.getElementById('progressModal')?.querySelector('.im-actions-left');
  for (const e of result.events) {
    if (!e.summary || !(e.summary.copiedFiles || []).length) continue;
    const item = plan.events.find(p => p.eventKey === e.eventKey);
    if (item) _appendQmzSortButton(actLeft, document.getElementById('progressModal'), item.routingEventData, e.summary.copiedFiles, `qmzSortBtn-${e.ordinal}`, `Sort QMZ Photos — E${e.ordinal}`);
  }
}

function _sessPollRowMetadata(eventPath, el, attemptsLeft) {
  if (!window.api?.getMetadataEventState) return;
  window.api.getMetadataEventState(eventPath).then(state => {
    if (!el.isConnected) return;
    const s = state && state.state;
    if (!s) {
      if (attemptsLeft > 0) _sessMetaPollTimers.push(setTimeout(() => _sessPollRowMetadata(eventPath, el, attemptsLeft - 1), 2000));
      return;
    }
    el.textContent = `Metadata: ${(METADATA_STATE_LABELS[s] || { label: s }).label}`;
    const settling = ['metadata-in-progress', 'metadata-queued', 'metadata-interrupted', 'metadata-verification-required'].includes(s);
    if (settling && attemptsLeft > 0) _sessMetaPollTimers.push(setTimeout(() => _sessPollRowMetadata(eventPath, el, attemptsLeft - 1), 2000));
  }).catch(() => {});
}
