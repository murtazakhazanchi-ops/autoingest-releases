// renderer/dumpSortMode.js — Sort Dump in the standard Import Workspace (AI-FEAT-064 EQI-3).
//
// Event Management's "Sort Dump" opens the NORMAL Import Workspace with the event's Dump folder as
// a folder source (left tree = the whole Dump hierarchy, every photographer and nested folder; grid,
// preview, selection, RAW/JPEG pairing, G1/G2/G3 groups, component mapping and Tag Refinement are the
// existing ones). Only the final action differs: "Move to Event Folders" asks main to MOVE the
// selected photos (services/dumpSortService.js) instead of importing them again.
//
// EQI-3.1 — the workspace stays a Sort Dump workspace for as long as the event's Dump is its source:
// its action is never turned into an ordinary import (no Confirm Event Import, no Local First / Direct
// Archive choice, no new import record). Changing the event, or the event changing underneath it (a
// rename), closes Sort Dump instead — explicitly, never mid-move. The move finishes at its durable
// boundary (files placed, event.json committed, Dump copies removed); metadata verification then runs in
// the background (services/dumpSortMetadata.js) and is shown by a compact title-bar chip, not a modal.
//
// Loaded after renderer.js (deferred, in order) and uses its globals: selectSource, selectedFiles,
// GroupManager, TagRefinementManager, EventCreator, isMetadataGroupingMode, showMissingSubEventModal,
// showUnassignedWarningModal, showMessage, showLanding, updateSelectionBar, ImportSession, _exitToHome,
// _ecPanelOpen, openActivityLogModal.

'use strict';

const DumpSortMode = (() => {
  let _ctx = null;   // { eventPath, dumpPath, eventName }
  let _running = false;
  let _opening = false;
  let _overlay = null;
  let _lastNote = '';   // outcome of the last move, kept in the banner until the next one
  let _hold = false;     // EQI-3.2: Create New Event for a transfer destination — the source event comes back
  const refused = new Map();   // absolute path → reason (shown on the tile until the next sort)

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
  function bytes(n) {
    if (!n) return '0 MB';
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)} GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
    return `${Math.max(1, Math.round(n / 1e3))} KB`;
  }

  function isActive() {
    return !!_ctx && typeof activeSource !== 'undefined' && activeSource && norm(activeSource.path) === norm(_ctx.dumpPath);
  }

  /** Called by selectSource for every source change: leaving the Dump source ends Sort Dump mode. */
  function onSourceChanged(path) {
    if (_ctx && norm(path) !== norm(_ctx.dumpPath)) _end();
  }

  function _end() {
    _ctx = null;
    refused.clear();
    document.body.classList.remove('dump-sort-mode');
    document.getElementById('dumpSortBanner')?.remove();
  }

  /**
   * Closes the Sort Dump workspace entirely (never leaves its Dump source behind as an ordinary import
   * source): its groups and refinements are discarded — nothing was moved — and AutoIngest returns home.
   */
  function _leave(message) {
    _end();
    try { GroupManager.reset(); TagRefinementManager.reset(); } catch { /* best effort */ }
    if (typeof _exitToHome === 'function') _exitToHome(); else showLanding();
    if (message) showMessage(message, 9000);
  }

  /** Event Management → Sort Dump: make the event current, then open its Dump in the workspace. */
  async function open(args) {
    if (_opening || _running) return;
    _opening = true;
    try { await _open(args); } finally { _opening = false; }
  }

  async function _open({ eventPath, folderName }) {
    _end();   // a previous Sort Dump workspace never survives into this one
    _lastNote = '';
    let st = await window.api.dumpSortStatus(eventPath);
    if (!st || !st.showSortDump) { showMessage(st && st.reason ? st.reason : 'This event has no unsorted Dump media.'); return; }
    if (st.pending) {
      // An interrupted sort is completed first (rolled forward from its journal), before anything else.
      let p = await window.api.dumpSortPlan(eventPath, []);
      // EQI-3.2: an interrupted cross-event transfer may hold locks in two events — offered until none is left.
      for (let i = 0; i < 3 && p && p.lock && p.lock.self && await offerSelfLockRelease(p.lock); i++) p = await window.api.dumpSortPlan(eventPath, []);
      let rec = (p && p.recovered) || [];
      if (rec.some(x => x.deferred)) {
        // Not completed yet (folder locked, or an import/sort is running) — said as it is, nothing opened.
        showMessage((p.blockers || []).find(b => /interrupted/i.test(b)) || 'An interrupted Sort Dump of this event is waiting to be completed.', 10000);
        return;
      }
      const moved = rec.reduce((n, x) => n + (x.movedFiles || 0), 0);
      const attention = rec.some(x => !x.ok);
      showMessage(attention ? 'An interrupted Sort Dump needs attention: some files were left in Dump because their destination differs.' : `An interrupted Sort Dump was completed (${moved} file${moved === 1 ? '' : 's'}).`, 7000);
      EventCreator.invalidateScannedEvents();
      st = await window.api.dumpSortStatus(eventPath);
      if (!st || !st.unsorted) { document.dispatchEvent(new CustomEvent('eventcreator:dumpSortChanged')); return; }
    }
    const adopted = await EventCreator.adoptEventByFolder(folderName);
    if (!adopted) { showMessage('The event could not be opened. Select it in Event Management and try again.'); return; }
    for (let i = 0; i < 60 && typeof EventMgmt !== 'undefined' && EventMgmt.isOpen(); i++) await new Promise(r => setTimeout(r, 50));
    const active = EventCreator.getActiveEventData();
    if (!active || norm(active.eventPath).split('/').pop() !== folderName) { showMessage('The event could not be opened for sorting.'); return; }
    const dumpPath = `${norm(active.eventPath)}/Dump`;
    _ctx = { eventPath: active.eventPath, dumpPath, eventName: folderName };
    refused.clear();
    document.body.classList.add('dump-sort-mode');
    await selectSource({ type: 'local-folder', path: dumpPath, label: 'Dump' });
    _ctx = { eventPath: active.eventPath, dumpPath, eventName: folderName };   // selectSource's own reset must not end it
    document.body.classList.add('dump-sort-mode');
    _banner(st);
    await _showAllDumpMedia(dumpPath);
    updateSelectionBar();
  }

  /** Media view over the WHOLE Dump (every photographer, nested folders) — where sorting starts. */
  async function _showAllDumpMedia(dumpPath) {
    // selectSource loads the folder tree and then the root's direct files without being awaited;
    // switching before that finishes would let its folder view overwrite the media grid.
    for (let i = 0; i < 200; i++) {
      if (currentFolderTree && currentFolderContext && norm(currentFolderContext.path) === norm(dumpPath)) break;
      await new Promise(r => setTimeout(r, 50));
    }
    currentFolderContext = { path: dumpPath, files: currentFolderContext ? currentFolderContext.files : [], isRoot: true, isLeaf: false };
    if (viewModeType === 'media') await _startMediaScan(dumpPath);
    else document.getElementById('viewMediaBtn')?.click();
  }

  function _banner(st) {
    document.getElementById('dumpSortBanner')?.remove();
    const host = document.getElementById('workspace');
    if (!host || !_ctx) return;
    const el = document.createElement('div');
    el.id = 'dumpSortBanner';
    el.className = 'dump-sort-banner';
    el.setAttribute('role', 'status');
    const n = st && typeof st.unsorted === 'number' ? st.unsorted : null;
    el.innerHTML = `<span class="dsb-title">Sort Dump</span><span class="dsb-event">${esc(_ctx.eventName)}</span>`
      + `<span class="dsb-count">${n === null ? '' : `${plural(n, 'unsorted photo')} · ${bytes(st.bytes)}`}</span>`
      + '<span class="dsb-dest" id="dsbDest"></span>'
      + '<button type="button" class="dsb-move-other" id="dsbMoveOther" title="Move the selected photos (or a group) to another event\'s Dump or folders — this workspace stays open">Move Selection to Another Event</button>'
      + `<span class="dsb-last" id="dsbLast" role="status">${esc(_lastNote)}</span>`
      + '<span class="dsb-hint">Sorting photos already imported into this event\'s Dump: group them (G1/G2/G3) to components, then Move to Event Folders. They are moved, not imported again. Photos that belong to another event: Move Selection to Another Event. Changing the event closes Sort Dump.</span>';
    host.prepend(el);
    el.querySelector('#dsbMoveOther').addEventListener('click', () => { if (window.CrossEventMove) CrossEventMove.open(); });
    _renderDestinations();
  }

  /** Banner: where each group goes in THIS event (the owning event is fixed while sorting). */
  function _renderDestinations() {
    const el = document.getElementById('dsbDest');
    if (!el || !_ctx) return;
    let groups = [];
    try { groups = GroupManager.getGroups(); } catch { /* not ready */ }
    const parts = groups.filter(g => g.files && g.files.size).map(g => `${esc(g.label || `G${g.id}`)} → ${esc(g.subEventId || (EventCreator.getEventComps().length > 1 ? 'no component yet' : 'event folder'))}`);
    el.innerHTML = parts.length ? `Moving to: ${parts.join(' · ')}` : '';
  }

  /** Workspace import button in Dump mode. */
  function decorateImportButton(btn) {
    if (!btn) return;
    btn.innerHTML = 'Move to Event Folders';
    btn.title = 'Move the selected Dump photos into the event\'s component and photographer folders';
    _renderDestinations();
  }

  /**
   * Change Event from the Sort Dump workspace. Never mid-move; otherwise the operator confirms that
   * Sort Dump closes (its group assignments belong to this event's Dump and are not carried over).
   * @returns {Promise<boolean>} true when the caller may continue to the event picker
   */
  async function requestEventChange() {
    if (!isActive()) return true;
    if (_running) { showMessage('A Sort Dump move is running. Wait for it to finish before changing the event.', 7000); return false; }
    const ok = await _confirmLeave();
    if (!ok) return false;
    _leave(null);
    return true;
  }

  function _confirmLeave() {
    return new Promise(resolve => {
      const o = _ensureOverlay();
      const name = _ctx ? _ctx.eventName : '';
      o.innerHTML = `<div class="dupWarningModal dump-sort-modal">
        <h3 id="dumpSortTitle">Close Sort Dump?</h3>
        <p class="dup-subtitle">Changing the event closes Sort Dump for <strong>${esc(name)}</strong>.</p>
        <p class="dsr-note">The group assignments made here belong to this event's Dump and are not carried to another event. Nothing has been moved; the photos stay in Dump until you sort them.</p>
        <div class="dup-actions">
          <button type="button" class="dup-btn dup-btn-primary" id="dsrStay">Stay in Sort Dump</button>
          <button type="button" class="dup-btn dup-btn-cancel" id="dsrLeave">Close Sort Dump</button>
        </div></div>`;
      o.classList.add('visible');
      const done = (v) => { document.removeEventListener('keydown', onKey); _close(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
      document.addEventListener('keydown', onKey);
      o.querySelector('#dsrStay').addEventListener('click', () => done(false), { once: true });
      o.querySelector('#dsrLeave').addEventListener('click', () => done(true), { once: true });
      o.querySelector('#dsrStay').focus();
    });
  }

  function onEventChanged() {
    if (!_ctx || _running || _opening || _hold) return;
    const ed = EventCreator.getActiveEventData();
    if (!ed || norm(ed.eventPath) !== norm(_ctx.eventPath)) _leave('The current event changed, so Sort Dump was closed. Nothing was moved.');
  }

  /**
   * A folder lock left by an interrupted run on THIS computer: the operator may release it explicitly
   * (the existing self-lock release, which refuses a lock that is still live). Another computer's lock
   * is never offered for release.
   * @returns {Promise<boolean>} true when released
   */
  function offerSelfLockRelease(lock) {
    if (!lock || !lock.self || !lock.lockPath) return Promise.resolve(false);
    return new Promise(resolve => {
      const o = _ensureOverlay();
      o.innerHTML = `<div class="dupWarningModal dump-sort-modal">
        <h3 id="dumpSortTitle">Previous Sort Dump lock found</h3>
        <p class="dup-subtitle">An archive folder of this event is still locked by this computer (${esc(lock.lockedBy || 'this Mac')}), but no Sort Dump is running here.</p>
        <p class="dsr-note">AutoIngest was probably closed or interrupted during a Sort Dump. Releasing the lock lets the interrupted Sort Dump finish safely from its journal. Locks held by other computers are never released here.</p>
        <p class="dsr-note" id="dsrLockErr" role="alert"></p>
        <div class="dup-actions">
          <button type="button" class="dup-btn dup-btn-primary" id="dsrRelease">Release Lock &amp; Continue</button>
          <button type="button" class="dup-btn dup-btn-cancel" id="dsrLockCancel">Cancel</button>
        </div></div>`;
      o.classList.add('visible');
      const done = (v) => { document.removeEventListener('keydown', onKey); _close(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
      document.addEventListener('keydown', onKey);
      o.querySelector('#dsrLockCancel').addEventListener('click', () => done(false), { once: true });
      o.querySelector('#dsrRelease').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        let r = { ok: true };
        for (const lp of (lock.lockPaths && lock.lockPaths.length ? lock.lockPaths : [lock.lockPath])) {
          r = await window.api.clearSelfStaleLock({ lockPath: lp, force: true }).catch(err => ({ ok: false, reason: err.message }));
          if (!r || !r.ok) break;
        }
        if (r && r.ok) { done(true); return; }
        const errEl = o.querySelector('#dsrLockErr');
        if (errEl) errEl.textContent = `The lock was not released: ${(r && r.reason) || 'unknown reason'}.`;
        e.currentTarget.disabled = false;
      });
      o.querySelector('#dsrRelease').focus();
    });
  }

  /** Event Management edit/rename guard: the event Sort Dump is working in keeps its name and folders. */
  function blocksEdit(eventPath, folderName) {
    if (!isActive()) return false;
    const mine = norm(_ctx.eventPath);
    return (eventPath && norm(eventPath) === mine) || (folderName && mine.split('/').pop() === folderName);
  }

  function tileNote(path) { return refused.get(norm(path)) || null; }

  /** The "Move to Event Folders" action. */
  async function run() {
    if (_running) return;
    if (!isActive()) return;
    if (TagRefinementManager.isEventScopeActive()) { showMessage('Finish refining tags first — click Done Refining, then move.'); return; }
    if (typeof ImportSession !== 'undefined' && !ImportSession.isLegacyEligible()) {
      showMessage('Sort Dump moves photos within this event only. Remove assignments to other events first.');
      return;
    }
    // The owning event must still be the current one AND still be where Sort Dump opened it. Either
    // changing (another event selected, the event renamed or moved) closes Sort Dump — it is never
    // turned into an ordinary import of the Dump's photos.
    const eventData = EventCreator.getActiveEventData();
    if (!eventData || norm(eventData.eventPath) !== norm(_ctx.eventPath)) {
      _leave('The current event changed, so Sort Dump was closed and nothing was moved. Open Sort Dump again from Event Management.');
      return;
    }
    const live = await window.api.dumpSortStatus(_ctx.eventPath).catch(() => null);
    if (!live || !live.ok) {
      _leave(`Sort Dump was closed and nothing was moved: ${(live && live.reason) || 'the event folder is not reachable'} If the event was renamed, open Sort Dump again from Event Management.`);
      return;
    }
    // The event's components come from its event.json — opening Event Management meanwhile resets
    // EventCreator's in-memory components to a blank form, which must never decide the move.
    if (!(await EventCreator.reloadForImport(_ctx.eventPath))) { showMessage('The event details could not be loaded. Open Sort Dump again from Event Management.'); return; }
    const comps = EventCreator.getEventComps();
    const isMulti = comps.length > 1;
    let groups;
    if (isMulti) {
      if (!GroupManager.hasGroups()) { showMessage('Assign the photos to groups (G1/G2/G3) and map each group to a component.'); return; }
      if (GroupManager.hasMissingSubEvents()) { await showMissingSubEventModal(); return; }
      groups = GroupManager.getGroups().map(g => ({ id: g.id, uid: g.uid, files: new Set(g.files), subEventId: g.subEventId, metadataTags: g.metadataTags ?? null }));
      const unassigned = GroupManager.getUnassignedFiles([...selectedFiles]);
      if (unassigned.length && !(await showUnassignedWarningModal(unassigned.length))) return;
    } else if (isMetadataGroupingMode() && GroupManager.hasGroups()) {
      groups = GroupManager.getGroups().map(g => ({ id: g.id, uid: g.uid, files: new Set(g.files), subEventId: null, metadataTags: g.metadataTags ?? null }));
      const unassigned = GroupManager.getUnassignedFiles([...selectedFiles]);
      if (unassigned.length) groups.push({ id: -1, files: new Set(unassigned), subEventId: null, metadataTags: [] });
    } else {
      if (!selectedFiles.size) { showMessage('Select the photos to move.'); return; }
      groups = [{ id: 0, files: new Set(selectedFiles), subEventId: null, metadataTags: null }];
    }
    const selection = groups.flatMap(g => [...g.files].map(p => ({ path: p, subEventId: g.subEventId || null })));
    const intent = groups.map(g => ({
      metadataTags: g.metadataTags ?? null,
      files: [...g.files],
      fileTagRefinements: isMulti && g.uid
        ? TagRefinementManager.serializeGroupForImport(g.uid)
        : TagRefinementManager.serializeGroupForImport(TagRefinementManager.EVENT_SCOPE, [...g.files]),
    }));

    _running = true;
    try {
      let planned = await window.api.dumpSortPlan(_ctx.eventPath, selection);
      if (planned && planned.lock && planned.lock.self && await offerSelfLockRelease(planned.lock)) planned = await window.api.dumpSortPlan(_ctx.eventPath, selection);
      const go = await _review(planned);
      if (!go) return;
      _showProgress();
      const off = window.api.onDumpSortProgress(_onProgress);
      let result;
      try { result = await window.api.dumpSortRun(_ctx.eventPath, selection, intent); }
      finally { if (typeof off === 'function') off(); }
      await _finish(result, planned);
    } catch (err) {
      const msg = String(err && err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      _showResult({ title: 'Sort Dump stopped', lines: [msg, 'Nothing was removed from Dump that is not safely at its destination. Open Sort Dump again to complete it.'], tone: 'error' });
    } finally {
      _running = false;
    }
  }

  // ── Overlay (review → progress → result → empty folders) ────────────────────────────────

  function _ensureOverlay() {
    if (_overlay && document.body.contains(_overlay)) return _overlay;
    _overlay = document.createElement('div');
    _overlay.id = 'dumpSortOverlay';
    _overlay.setAttribute('role', 'dialog');
    _overlay.setAttribute('aria-modal', 'true');
    _overlay.setAttribute('aria-labelledby', 'dumpSortTitle');
    document.body.appendChild(_overlay);
    return _overlay;
  }
  function _close() { if (_overlay) { _overlay.classList.remove('visible'); _overlay.innerHTML = ''; } }

  function _review(planned) {
    return new Promise(resolve => {
      const o = _ensureOverlay();
      const blockers = (planned && planned.blockers) || [];
      const problems = (planned && planned.problems) || [];
      const r = planned && planned.review;
      const rec = planned && planned.recovered;
      const canMove = planned && planned.ok && r && r.files > 0;
      const rows = r ? r.destinations.map(d => `<tr><td>${esc(d.component || 'Event folder')}</td><td class="dsr-folder">${esc(d.folder)}${d.isNew ? ` <span class="dsr-new">${d.sequence ? 'new · next sequence' : 'new folder'}</span>` : ''}</td><td>${esc(d.photographer)}</td><td class="num">${d.files.toLocaleString()}</td><td class="num">${bytes(d.bytes)}</td></tr>`).join('') : '';
      o.innerHTML = `<div class="dupWarningModal dump-sort-modal">
        <h3 id="dumpSortTitle">Move to Event Folders</h3>
        <p class="dup-subtitle">${r ? `${plural(r.files, 'file')} · ${bytes(r.bytes)}${r.sidecars ? ` · ${plural(r.sidecars, 'XMP sidecar')} moved with their photos` : ''}` : ''}</p>
        ${rec && rec.length ? `<p class="dsr-note">An interrupted Sort Dump was completed first (${plural(rec.reduce((n, x) => n + (x.movedFiles || 0), 0), 'file')}).</p>` : ''}
        ${blockers.length ? `<div class="dsr-block" role="alert">${blockers.map(b => `<p>${esc(b)}</p>`).join('')}</div>` : ''}
        ${rows ? `<table class="dsr-table"><thead><tr><th>Component</th><th>Folder</th><th>Photographer</th><th class="num">Files</th><th class="num">Size</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
        ${problems.length ? `<details class="dsr-problems"><summary>${plural(problems.length, 'file')} will stay in Dump</summary><ul>${problems.slice(0, 50).map(p => `<li>${esc(String(p.rel || p.src || '').split('/').pop())} — ${esc(p.reason)}</li>`).join('')}</ul></details>` : ''}
        ${r ? `<p class="dsr-note">Photos are moved, not copied: each leaves Dump only after it is safely in its final folder. ${plural(Math.max(0, r.remaining), 'photo')} will remain unsorted in Dump.</p>` : ''}
        <div class="dup-actions">
          ${canMove ? '<button type="button" class="dup-btn dup-btn-primary" id="dsrGo">Move to Event Folders</button>' : ''}
          <button type="button" class="dup-btn dup-btn-cancel" id="dsrCancel">${canMove ? 'Cancel' : 'Close'}</button>
        </div></div>`;
      o.classList.add('visible');
      const done = (v) => { document.removeEventListener('keydown', onKey); if (!v) _close(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
      document.addEventListener('keydown', onKey);
      o.querySelector('#dsrGo')?.addEventListener('click', () => done(true), { once: true });
      o.querySelector('#dsrCancel')?.addEventListener('click', () => done(false), { once: true });
      (o.querySelector('#dsrGo') || o.querySelector('#dsrCancel'))?.focus();
    });
  }

  const STAGES = { moving: 'Moving photos', records: 'Updating the event record', cleanup: 'Removing the Dump copies', metadata: 'Queuing metadata verification', done: 'Finished', 'needs-attention': 'Needs attention', cancelled: 'Nothing was moved' };
  function _showProgress() {
    const o = _ensureOverlay();
    o.innerHTML = `<div class="dupWarningModal dump-sort-modal" aria-busy="true">
      <h3 id="dumpSortTitle">Moving to Event Folders</h3>
      <p class="dsp-stage" id="dspStage">Preparing</p>
      <div class="dsp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="dsp-fill" id="dspFill"></div></div>
      <p class="dup-subtitle" id="dspCount"></p>
      <p class="dsr-note">Do not quit AutoIngest while photos are moving. If it is interrupted, the move is completed safely the next time Sort Dump opens. Metadata is verified in the background afterwards.</p>
    </div>`;
    o.classList.add('visible');
  }
  function _onProgress(p) {
    if (!p || !_overlay) return;
    const stage = document.getElementById('dspStage');
    const fill = document.getElementById('dspFill');
    const count = document.getElementById('dspCount');
    if (stage) stage.textContent = STAGES[p.stage] || 'Working';
    if (typeof p.done === 'number' && typeof p.total === 'number' && p.total > 0) {
      const pct = Math.round((p.done / p.total) * 100);
      if (fill) fill.style.transform = `scaleX(${pct / 100})`;
      fill?.parentElement?.setAttribute('aria-valuenow', String(pct));
      if (count) count.textContent = `${p.done.toLocaleString()} of ${plural(p.total, 'file')}`;
    }
  }

  function _showResult({ title, lines, tone = 'ok', details = '' }) {
    return new Promise(resolve => {
      const o = _ensureOverlay();
      o.innerHTML = `<div class="dupWarningModal dump-sort-modal dump-sort-${tone}">
        <h3 id="dumpSortTitle">${esc(title)}</h3>
        ${lines.map(l => `<p class="dup-subtitle">${esc(l)}</p>`).join('')}${details}
        <div class="dup-actions"><button type="button" class="dup-btn dup-btn-primary" id="dsrOk">Continue</button></div></div>`;
      o.classList.add('visible');
      const b = o.querySelector('#dsrOk');
      b.addEventListener('click', () => { _close(); resolve(); }, { once: true });
      b.focus();
    });
  }

  function _askEmptyFolder(name) {
    return new Promise(resolve => {
      const o = _ensureOverlay();
      o.innerHTML = `<div class="dupWarningModal dump-sort-modal">
        <h3 id="dumpSortTitle">Empty photographer folder</h3>
        <p class="dup-subtitle">This photographer folder is now empty. Would you like to delete it?</p>
        <p class="dsr-folder-name">Dump / ${esc(name)}</p>
        <div class="dup-actions">
          <button type="button" class="dup-btn dup-btn-primary" id="dsrKeep">Keep Folder</button>
          <button type="button" class="dup-btn dup-btn-cancel dsr-danger" id="dsrDelete">Delete Empty Folder</button>
        </div></div>`;
      o.classList.add('visible');
      o.querySelector('#dsrKeep').addEventListener('click', () => resolve('keep'), { once: true });
      o.querySelector('#dsrDelete').addEventListener('click', () => resolve('delete'), { once: true });
      o.querySelector('#dsrKeep').focus();
    });
  }

  async function _finish(result, planned) {
    refused.clear();
    for (const p of (result && result.problems) || []) {
      const rel = p.rel || p.src;
      if (rel) refused.set(norm(`${norm(_ctx.eventPath)}/${rel}`), p.reason);
    }
    if (!result || (result.ok === false && result.blockers)) {
      _close();
      if (result && result.lock && result.lock.self && await offerSelfLockRelease(result.lock)) {
        showMessage('The lock was released. Nothing was moved yet — click Move to Event Folders again.', 9000);
        return;
      }
      await _showResult({ title: 'Nothing was moved', lines: (result && result.blockers) || ['Sort Dump could not start.'], tone: 'error' });
      return;
    }
    // The move is durably complete here. Metadata verification was QUEUED (it runs in the background and
    // reports through the title-bar chip) — the operator is released now, never held by a metadata modal.
    _close();
    const st = await window.api.dumpSortStatus(_ctx.eventPath).catch(() => null);
    const meta = result.metadata || {};
    const metaLine = meta.state === 'queued' ? 'Metadata verification queued.'
      : meta.state === 'not-needed' ? 'No photo metadata to update (videos only).'
      : meta.state ? 'Metadata could not be queued — use Metadata Audit to verify these photos.' : '';
    const moved = `${plural(result.movedFiles || 0, 'file')} moved (${bytes(result.bytes)})${result.sidecars ? ` with ${plural(result.sidecars, 'XMP sidecar')}` : ''}.`;
    const left = st && typeof st.unsorted === 'number' ? (st.unsorted ? `${plural(st.unsorted, 'photo')} still unsorted in Dump.` : 'Dump has no unsorted photos left.') : '';
    const att = result.attention || [];
    const stay = (result.problems || []).length;
    if (att.length || stay || (meta.state && meta.state !== 'queued' && meta.state !== 'not-needed')) {
      // Something the operator must read — the only case that still asks for a click.
      const details = (att.length || stay)
        ? `<details class="dsr-problems" open><summary>${att.length ? `${plural(att.length, 'file')} need attention` : `${plural(stay, 'file')} stayed in Dump`}</summary><ul>${[...att, ...(result.problems || [])].slice(0, 50).map(p => `<li>${esc(String(p.src || p.rel || '').split('/').pop())} — ${esc(p.reason)}</li>`).join('')}</ul></details>`
        : '';
      await _showResult({ title: att.length ? 'Moved — some files need attention' : 'Moved to Event Folders', lines: [moved, metaLine, left].filter(Boolean), tone: att.length ? 'warn' : 'ok', details });
    }
    // Shown once the workspace is ready again (the Dump refresh below would clear an earlier message).
    const doneText = (att.length || stay) ? '' : `Files moved successfully. ${moved} ${metaLine} ${left}`.replace(/\s+/g, ' ').trim();
    _lastNote = doneText || `${moved} ${metaLine}`.trim();
    const noteEl = document.getElementById('dsbLast');
    if (noteEl) noteEl.textContent = _lastNote;

    // Empty photographer folders of THIS sort — the operator decides, one by one.
    const touched = new Set(((planned && planned.plan && planned.plan.assets) || []).map(a => a.photographer));
    const empty = await window.api.dumpSortEmptyFolders(_ctx.eventPath).catch(() => null);
    let dumpRemoved = false;
    for (const name of ((empty && empty.folders) || []).filter(n => touched.has(n))) {
      const choice = await _askEmptyFolder(name);
      if (choice === 'delete') {
        const r = await window.api.dumpSortDeleteEmptyFolder(_ctx.eventPath, name);
        if (!r || !r.ok) showMessage((r && r.reason) || 'The folder was kept.');
        else if (r.dumpRemoved) dumpRemoved = true;
      }
    }
    EventCreator.invalidateScannedEvents();
    if (dumpRemoved || (st && !st.unsorted)) {
      const eventName = _ctx.eventName;
      _close();
      _end();
      showLanding();
      showMessage(`${eventName}: Dump is fully sorted.${doneText ? ` ${doneText}` : ''}`, 8000);
      return;
    }
    // Refresh the Dump source: moved photos disappear; groups start empty for the next round. The
    // overlay stays up (refreshing) until the workspace is ready, so nothing done meanwhile is lost.
    const o = _ensureOverlay();
    o.innerHTML = '<div class="dupWarningModal dump-sort-modal" aria-busy="true"><h3 id="dumpSortTitle">Refreshing Dump</h3><p class="dup-subtitle">Showing the photos still to sort…</p></div>';
    o.classList.add('visible');
    const ctx = _ctx;
    GroupManager.reset(); TagRefinementManager.reset();
    await selectSource({ type: 'local-folder', path: ctx.dumpPath, label: 'Dump' });
    _ctx = ctx;
    document.body.classList.add('dump-sort-mode');
    _banner(st);
    await _showAllDumpMedia(ctx.dumpPath);
    if (typeof renderGroupPanel === 'function') renderGroupPanel();
    updateSelectionBar();
    _close();
  }

  // EQI-3.2 Move Selection to Another Event (renderer/crossEventMove.js) shares this workspace's overlay,
  // prompts and banner; while it runs, Sort Dump's own move and Change Event wait (`setBusy`).
  const ui = { ensureOverlay: _ensureOverlay, close: _close, showResult: _showResult, askEmptyFolder: _askEmptyFolder, onProgress: _onProgress };
  function setBusy(v) { _running = !!v; }
  function holdContext(v) { _hold = !!v; }
  function setLastNote(text) { _lastNote = text || ''; const el = document.getElementById('dsbLast'); if (el) el.textContent = _lastNote; }
  function refreshBanner(st) { if (isActive()) _banner(st); }
  function closeFullySorted(message) { _close(); _end(); showLanding(); if (message) showMessage(message, 8000); }

  return { isActive, onSourceChanged, open, run, decorateImportButton, tileNote, requestEventChange, blocksEdit, onEventChanged, offerSelfLockRelease, ui, setBusy, holdContext, setLastNote, refreshBanner, closeFullySorted, get context() { return isActive() ? _ctx : null; }, get busy() { return _running; } };
})();

window.DumpSortMode = DumpSortMode;

// ── Background Sort Dump metadata — compact title-bar chip (EQI-3.1) ─────────────────────────
// One line beside the Metadata indicator: verifying / writing counts while it runs, "completed" briefly,
// "requires attention" until clicked. Click → Metadata Management (Activity Log, Metadata tab). It never
// takes focus and never opens a modal by itself.
const DumpSortMetaChip = (() => {
  const runs = new Map();   // txId → state from main (dumpSort:metadata)
  let hideTimer = null;
  const n = (x) => Number(x || 0).toLocaleString();

  function _chip() {
    let el = document.getElementById('dsMetaChip');
    if (el) return el;
    const bar = document.getElementById('appTitleBar');
    if (!bar) return null;
    el = document.createElement('button');
    el.id = 'dsMetaChip';
    el.type = 'button';
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    el.addEventListener('click', async () => {
      const waiting = [...runs.values()].find(s => s.state === 'waiting' && s.lock && s.lock.self);
      if (waiting) {
        if (await DumpSortMode.offerSelfLockRelease(waiting.lock)) window.api.dumpSortResumeMetadata().catch(() => {});
        return;
      }
      for (const [id, st] of runs) if (!st.active && st.state !== 'waiting') runs.delete(id);
      render();
      if (typeof openActivityLogModal === 'function') openActivityLogModal({ tab: 'metadata' });
    });
    bar.appendChild(el);
    return el;
  }

  function _place(el) {
    const ind = document.getElementById('metaTitleIndicator');
    if (!ind || !ind.offsetWidth) return;
    const right = parseFloat(getComputedStyle(ind).right) || 0;
    el.style.right = `${right + ind.offsetWidth + 8}px`;
  }

  function render() {
    const el = _chip();
    if (!el) return;
    const list = [...runs.values()];
    const active = list.filter(s => s.active);
    const attention = list.filter(s => !s.active && (s.state === 'attention' || s.state === 'waiting'));
    const done = list.filter(s => !s.active && s.state === 'complete');
    clearTimeout(hideTimer);
    if (!active.length && !attention.length && !done.length) { el.hidden = true; return; }
    const sum = (arr, k) => arr.reduce((t, s) => t + (s[k] || 0), 0);
    let state, label;
    if (active.length) {
      const writing = active.filter(s => s.state === 'writing');
      state = 'running';
      label = writing.length
        ? `Sort Dump metadata: ${n(sum(writing, 'written'))} of ${n(sum(writing, 'queued'))} written`
        : `Sort Dump metadata: verifying ${n(sum(active, 'total'))} photo${sum(active, 'total') === 1 ? '' : 's'}`;
    } else if (attention.length) {
      state = 'attention';
      label = attention.some(s => s.state === 'attention') ? 'Metadata requires attention' : 'Sort Dump metadata: waiting for a folder lock';
    } else {
      state = 'complete';
      label = 'Metadata verification completed';
      hideTimer = setTimeout(() => { for (const s of done) runs.delete(s.txId); render(); }, 6000);
    }
    const all = list;
    el.dataset.state = state;
    el.textContent = label;
    el.title = `Sort Dump metadata — verified ${n(sum(all, 'verified'))} of ${n(sum(all, 'total'))}, pending ${n(sum(all.filter(s => s.active), 'pending'))}, `
      + `completed ${n(sum(all, 'complete') + sum(all, 'written'))}, failed ${n(sum(all, 'failed'))}`
      + `${attention.length && attention[0].message ? `. ${attention[0].message}` : ''}. Click for Metadata Management.`;
    el.hidden = false;
    _place(el);
  }

  function update(st) {
    if (!st || !st.txId) return;
    runs.set(st.txId, st);
    render();
  }

  if (window.api && window.api.onDumpSortMetadata) window.api.onDumpSortMetadata(update);
  if (window.api && window.api.dumpSortMetadataState) {
    window.api.dumpSortMetadataState().then(list => { for (const st of list || []) update(st); }).catch(() => {});
  }
  const ind = document.getElementById('metaTitleIndicator');
  if (ind && typeof ResizeObserver === 'function') new ResizeObserver(() => { const el = document.getElementById('dsMetaChip'); if (el && !el.hidden) _place(el); }).observe(ind);

  return { update, render, get states() { return [...runs.values()].map(s => ({ ...s })); } };
})();

window.DumpSortMetaChip = DumpSortMetaChip;
document.addEventListener('eventcreator:sortDump', (e) => { DumpSortMode.open(e.detail || {}).catch(err => showMessage(`Sort Dump could not open: ${err.message}`)); });
// Another event made current by any path (Event Management, MX console, restore): Sort Dump closes
// at once — its Dump source and assignments never wait, half-valid, behind the landing screen.
document.addEventListener('eventcreator:done', () => { DumpSortMode.onEventChanged(); });
