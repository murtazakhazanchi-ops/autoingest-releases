// renderer/dumpSortMode.js — Sort Dump in the standard Import Workspace (AI-FEAT-064 EQI-3).
//
// Event Management's "Sort Dump" opens the NORMAL Import Workspace with the event's Dump folder as
// a folder source (left tree = the whole Dump hierarchy, every photographer and nested folder; grid,
// preview, selection, RAW/JPEG pairing, G1/G2/G3 groups, component mapping and Tag Refinement are the
// existing ones). Only the final action differs: "Move to Event Folders" asks main to MOVE the
// selected photos (services/dumpSortService.js) instead of importing them again.
//
// Loaded after renderer.js (deferred, in order) and uses its globals: selectSource, selectedFiles,
// GroupManager, TagRefinementManager, EventCreator, isMetadataGroupingMode, showMissingSubEventModal,
// showUnassignedWarningModal, showMessage, showLanding, updateSelectionBar, ImportSession.

'use strict';

const DumpSortMode = (() => {
  let _ctx = null;   // { eventPath, dumpPath, eventName }
  let _running = false;
  let _overlay = null;
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

  /** Event Management → Sort Dump: make the event current, then open its Dump in the workspace. */
  async function open({ eventPath, folderName }) {
    let st = await window.api.dumpSortStatus(eventPath);
    if (!st || !st.showSortDump) { showMessage(st && st.reason ? st.reason : 'This event has no unsorted Dump media.'); return; }
    if (st.pending) {
      // An interrupted sort is completed first (rolled forward from its journal), before anything else.
      const p = await window.api.dumpSortPlan(eventPath, []);
      const rec = (p && p.recovered) || [];
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
    el.innerHTML = `<span class="dsb-title">Sorting Dump</span><span class="dsb-event">${esc(_ctx.eventName)}</span>`
      + `<span class="dsb-count">${n === null ? '' : `${plural(n, 'unsorted photo')} · ${bytes(st.bytes)}`}</span>`
      + '<span class="dsb-hint">Select photos, group them (G1/G2/G3) to components, then Move to Event Folders. Photos already in Dump are not imported again.</span>';
    host.prepend(el);
  }

  /** Workspace import button in Dump mode. */
  function decorateImportButton(btn) {
    if (!btn) return;
    btn.innerHTML = 'Move to Event Folders';
    btn.title = 'Move the selected Dump photos into the event\'s component and photographer folders';
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
    const eventData = EventCreator.getActiveEventData();
    if (!eventData || norm(eventData.eventPath) !== norm(_ctx.eventPath)) {
      showMessage('The current event changed. Open Sort Dump again from Event Management.');
      _end();
      return;
    }
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
      const planned = await window.api.dumpSortPlan(_ctx.eventPath, selection);
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

  const STAGES = { moving: 'Moving photos', records: 'Updating the event record', cleanup: 'Removing the Dump copies', metadata: 'Verifying metadata', done: 'Finished', 'needs-attention': 'Needs attention' };
  function _showProgress() {
    const o = _ensureOverlay();
    o.innerHTML = `<div class="dupWarningModal dump-sort-modal" aria-busy="true">
      <h3 id="dumpSortTitle">Moving to Event Folders</h3>
      <p class="dsp-stage" id="dspStage">Preparing</p>
      <div class="dsp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="dsp-fill" id="dspFill"></div></div>
      <p class="dup-subtitle" id="dspCount"></p>
      <p class="dsr-note">Do not quit AutoIngest. If it is interrupted, the move is completed safely the next time Sort Dump opens.</p>
    </div>`;
    o.classList.add('visible');
  }
  function _onProgress(p) {
    if (!p || !_overlay) return;
    const stage = document.getElementById('dspStage');
    const fill = document.getElementById('dspFill');
    const count = document.getElementById('dspCount');
    if (stage) stage.textContent = STAGES[p.stage] || 'Working';
    if (p.stage === 'metadata' && p.event === 'file_done' && count) count.textContent = 'Writing component tags…';
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
          <button type="button" class="dup-btn dup-btn-cancel" id="dsrKeep">Keep Folder</button>
          <button type="button" class="dup-btn dup-btn-primary" id="dsrDelete">Delete Empty Folder</button>
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
      await _showResult({ title: 'Nothing was moved', lines: (result && result.blockers) || ['Sort Dump could not start.'], tone: 'error' });
      return;
    }
    const st = await window.api.dumpSortStatus(_ctx.eventPath).catch(() => null);
    const meta = result.metadata || {};
    const metaLine = meta.state === 'complete' ? 'Metadata verified for the new folders.'
      : meta.state === 'not-needed' ? 'No photo metadata to update (videos only).'
      : meta.state === 'unconfirmed' ? 'Metadata is still being written — check Metadata Audit later.'
      : meta.state ? `Metadata: ${meta.state}${meta.failed ? ` (${meta.failed} failed — use Metadata Audit to repair)` : ''}.` : '';
    const lines = [
      `${plural(result.movedFiles || 0, 'file')} moved (${bytes(result.bytes)})${result.sidecars ? ` with ${plural(result.sidecars, 'XMP sidecar')}` : ''}.`,
      metaLine,
      st && typeof st.unsorted === 'number' ? (st.unsorted ? `${plural(st.unsorted, 'photo')} still unsorted in Dump.` : 'Dump has no unsorted photos left.') : '',
    ].filter(Boolean);
    const att = result.attention || [];
    const stay = (result.problems || []).length;
    const details = (att.length || stay)
      ? `<details class="dsr-problems" open><summary>${att.length ? `${plural(att.length, 'file')} need attention` : `${plural(stay, 'file')} stayed in Dump`}</summary><ul>${[...att, ...(result.problems || [])].slice(0, 50).map(p => `<li>${esc(String(p.src || p.rel || '').split('/').pop())} — ${esc(p.reason)}</li>`).join('')}</ul></details>`
      : '';
    await _showResult({ title: att.length ? 'Moved — some files need attention' : 'Moved to Event Folders', lines, tone: att.length ? 'warn' : 'ok', details });

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
      showMessage(`${eventName}: Dump is fully sorted.`, 6000);
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

  return { isActive, onSourceChanged, open, run, decorateImportButton, tileNote, get context() { return _ctx; }, get busy() { return _running; } };
})();

window.DumpSortMode = DumpSortMode;
document.addEventListener('eventcreator:sortDump', (e) => { DumpSortMode.open(e.detail || {}).catch(err => showMessage(`Sort Dump could not open: ${err.message}`)); });
