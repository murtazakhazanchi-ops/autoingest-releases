// renderer/crossEventMove.js — "Move Selection to Another Event" in the Sort Dump workspace (AI-FEAT-064 EQI-3.2).
//
// Photos that were imported into the wrong event's Dump are moved to another event from Sort Dump itself:
// the operator picks the photos (the selection, or one G1/G2/G3 group), a destination event of the same
// collection (searchable, or created with the existing Event Creator) and where they go there — the
// event's Dump (sorted later with its own Sort Dump) or one of its components — reviews, and confirms.
// main moves them through a two-event journal (services/crossEventMoveService.js): never a new import,
// never an overwrite, both event records reconciled, metadata verified in the background.
//
// NAVIGATE ≠ REASSIGN: choosing a destination here never changes the current event. The Sort Dump
// workspace stays open on its source event; only the moved photos leave its grid — every other selection
// and group assignment stays as it was. Change Event keeps its EQI-3.1 behaviour (asks to close Sort Dump).
//
// Loaded after dumpSortMode.js and uses renderer.js / importSessionUI.js globals: selectedFiles, renderFileArea,
// currentFiles, currentFolderContext, currentFolderTree, renderFolders, GroupManager, renderGroupPanel,
// updateSelectionBar, showMessage, EventCreator, EventMgmt, setRailMode, _ecPanelOpen, _refreshEventWorkspaceUI.

'use strict';

const CrossEventMove = (() => {
  let _state = null;      // the dialog's choices, kept across Back / Create New Event
  let _events = null;     // destinations() result for the open dialog
  let _creating = null;   // { snap, ctx, state } while the Event Creator is open for a new destination

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const plural = (n, w) => `${Number(n || 0).toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
  function bytes(n) {
    if (!n) return '0 MB';
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)} GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
    return `${Math.max(1, Math.round(n / 1e3))} KB`;
  }
  const ui = () => DumpSortMode.ui;

  /** The photo sets the operator can move: the current selection, and each non-empty group. */
  function _photoSets() {
    const sets = [];
    if (selectedFiles.size) sets.push({ id: 'selected', label: `Selected photos (${selectedFiles.size.toLocaleString()})`, files: [...selectedFiles] });
    let groups = [];
    try { groups = GroupManager.getGroups(); } catch { /* none */ }
    for (const g of groups) {
      if (!g.files || !g.files.size) continue;
      const name = g.label || `G${g.id}`;
      sets.push({ id: `g:${g.uid || g.id}`, label: `${name}${g.subEventId ? ` · ${g.subEventId}` : ''} (${g.files.size.toLocaleString()})`, files: [...g.files] });
    }
    return sets;
  }

  /** Opens the dialog (from the Sort Dump banner). `state` restores choices (Back, Create New Event). */
  async function open(state = null, note = null) {
    const ctx = DumpSortMode.context;
    if (!ctx) return;
    if (DumpSortMode.busy) { showMessage('A move is running. Wait for it to finish.', 6000); return; }
    const sets = _photoSets();
    if (!sets.length) { showMessage('Select the photos that belong to another event (or put them in a group) first.', 7000); return; }
    _state = { photos: sets[0].id, dest: null, kind: 'dump', component: null, query: '', ...(state || {}) };
    if (!sets.some(s => s.id === _state.photos)) _state.photos = sets[0].id;
    const o = ui().ensureOverlay();
    o.innerHTML = '<div class="dupWarningModal dump-sort-modal xem-modal" aria-busy="true"><h3 id="dumpSortTitle">Move Photos to Another Event</h3><p class="dup-subtitle">Loading the events of this collection…</p></div>';
    o.classList.add('visible');
    _events = await window.api.crossEventDestinations(ctx.eventPath).catch(err => ({ ok: false, reason: err.message, events: [] }));
    if (!DumpSortMode.context) { ui().close(); return; }
    _renderChoose(sets, note);
  }

  function _renderChoose(sets, note) {
    const ctx = DumpSortMode.context;
    const o = ui().ensureOverlay();
    const ev = (_events && _events.events) || [];
    const dest = ev.find(e => norm(e.eventPath) === norm(_state.dest)) || null;
    const comps = dest ? dest.components : [];
    if (_state.kind === 'component' && dest && comps.length === 1) _state.component = comps[0].folderName;
    if (_state.component && !comps.some(c => c.folderName === _state.component)) _state.component = null;
    const sourceName = (_events && _events.source && _events.source.folderName) || ctx.eventName;
    o.innerHTML = `<div class="dupWarningModal dump-sort-modal xem-modal">
      <h3 id="dumpSortTitle">Move Photos to Another Event</h3>
      <p class="dup-subtitle">From <strong>${esc(sourceName)}</strong>${_events && _events.collection ? ` · ${esc(_events.collection)}` : ''}. This Sort Dump stays open; the current event does not change.</p>
      ${note ? `<p class="xem-note-ok" role="status">${esc(note)}</p>` : ''}
      ${_events && !_events.ok ? `<div class="dsr-block" role="alert"><p>${esc(_events.reason || 'The events of this collection could not be read.')}</p></div>` : ''}
      <fieldset class="xem-field"><legend>Photos</legend>
        ${sets.map(s => `<label class="xem-radio"><input type="radio" name="xemPhotos" value="${esc(s.id)}" ${s.id === _state.photos ? 'checked' : ''}> ${esc(s.label)}</label>`).join('')}
      </fieldset>
      <div class="xem-field">
        <label class="xem-legend" for="xemSearch">Destination event</label>
        <div class="xem-search-row">
          <input type="search" id="xemSearch" class="xem-search" placeholder="Search events in this collection" value="${esc(_state.query)}" autocomplete="off" aria-controls="xemList">
          <button type="button" class="dup-btn dup-btn-cancel xem-create" id="xemCreate">Create New Event…</button>
        </div>
        <div class="xem-list" id="xemList" role="listbox" aria-label="Destination events"></div>
      </div>
      <fieldset class="xem-field" ${dest ? '' : 'disabled'}><legend>Put them in</legend>
        <label class="xem-radio"><input type="radio" name="xemKind" value="dump" ${_state.kind === 'dump' ? 'checked' : ''}> ${dest ? esc(dest.folderName) : 'The destination event'}'s <strong>Dump</strong> — sort them there later with Sort Dump</label>
        <label class="xem-radio"><input type="radio" name="xemKind" value="component" ${_state.kind === 'component' ? 'checked' : ''}> A final component folder of that event</label>
        <select id="xemComponent" class="xem-select" aria-label="Destination component" ${_state.kind === 'component' && dest ? '' : 'disabled'}>
          <option value="">Choose a component…</option>
          ${comps.map(c => `<option value="${esc(c.folderName)}" ${c.folderName === _state.component ? 'selected' : ''}>${esc(c.label)}${c.qmz ? ' (QMZ — no PC numbers)' : ''}</option>`).join('')}
        </select>
      </fieldset>
      <div class="dup-actions">
        <button type="button" class="dup-btn dup-btn-primary" id="xemReview" ${_canReview(dest) ? '' : 'disabled'}>Review Move</button>
        <button type="button" class="dup-btn dup-btn-cancel" id="xemCancel">Cancel</button>
      </div></div>`;
    o.classList.add('visible');
    _renderList();
    const search = o.querySelector('#xemSearch');
    search.addEventListener('input', () => { _state.query = search.value; _renderList(); });
    o.querySelectorAll('input[name="xemPhotos"]').forEach(r => r.addEventListener('change', () => { _state.photos = r.value; }));
    o.querySelectorAll('input[name="xemKind"]').forEach(r => r.addEventListener('change', () => { _state.kind = r.value; _renderChoose(sets); }));
    o.querySelector('#xemComponent')?.addEventListener('change', (e) => { _state.component = e.target.value || null; o.querySelector('#xemReview').disabled = !_canReview(dest); });
    o.querySelector('#xemCreate').addEventListener('click', () => _createEvent());
    o.querySelector('#xemCancel').addEventListener('click', () => _dismiss());
    o.querySelector('#xemReview').addEventListener('click', () => _review(sets));
    _trapEscape();
    search.focus();
  }

  function _canReview(dest) {
    if (!dest || dest.unavailable) return false;
    return _state.kind === 'dump' || (_state.kind === 'component' && !!_state.component);
  }

  function _renderList() {
    const list = document.getElementById('xemList');
    if (!list) return;
    const q = (_state.query || '').trim().toLowerCase();
    const ev = ((_events && _events.events) || []).filter(e => !q || `${e.folderName} ${e.eventName} ${e.hijriDate}`.toLowerCase().includes(q));
    if (!ev.length) { list.innerHTML = `<p class="xem-empty">${q ? 'No event matches.' : 'This collection has no other event yet. Create one with Create New Event.'}</p>`; return; }
    list.innerHTML = ev.map(e => `<button type="button" role="option" class="xem-event${norm(e.eventPath) === norm(_state.dest) ? ' selected' : ''}" aria-selected="${norm(e.eventPath) === norm(_state.dest)}" data-path="${esc(e.eventPath)}" ${e.unavailable ? 'aria-disabled="true"' : ''}>
        <span class="xem-event-name">${esc(e.folderName)}</span>
        <span class="xem-event-meta">${e.unavailable ? `Unavailable — ${esc(e.unavailable)}` : `${plural(e.components.length, 'component')}${e.components.length ? `: ${esc(e.components.map(c => c.folderName).join(', '))}` : ''}`}</span>
      </button>`).join('');
    list.querySelectorAll('.xem-event').forEach(b => b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      _state.dest = b.dataset.path;
      _renderChoose(_photoSets());
      document.querySelector(`.xem-event[data-path="${CSS.escape(_state.dest)}"]`)?.focus();
    }));
  }

  let _escHandler = null;
  function _trapEscape(fn = _dismiss) {
    if (_escHandler) document.removeEventListener('keydown', _escHandler);
    _escHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); fn(); } };
    document.addEventListener('keydown', _escHandler);
  }
  function _dismiss() {
    if (_escHandler) { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
    ui().close();
  }

  // ── Create New Event (the existing Event Creator) ─────────────────────────────────────────
  // The creator makes the new event current when it finishes; Sort Dump holds its context meanwhile and
  // the SOURCE event is restored at once, so the workspace, its selection and its groups are untouched.

  function _createEvent() {
    const ctx = DumpSortMode.context;
    if (!ctx) return;
    _creating = { snap: EventCreator.captureActiveSelection(), ctx: { ...ctx }, state: { ..._state } };
    DumpSortMode.holdContext(true);
    _dismiss();
    _ecPanelOpen();
    EventCreator.resetToList();
    showMessage('Create the destination event (or choose an existing one). You return to Sort Dump afterwards — nothing moves until you confirm.', 9000);
  }

  /** renderer.js eventcreator:done — true when the creator was opened from here (handled here). */
  function takeCreatorResult() {
    if (!_creating) return false;
    const c = _creating;
    _creating = null;
    const ed = EventCreator.getActiveEventData();
    const made = ed && ed.eventPath && norm(ed.eventPath) !== norm(c.ctx.eventPath) ? ed.eventPath : null;
    _returnFromCreator(c, made).catch(err => showMessage(`Could not return to Sort Dump: ${err.message}`, 8000));
    return true;
  }

  /** renderer.js picker dismissed (Back / close) — true when handled here. */
  function cancelCreator() {
    if (!_creating) return false;
    const c = _creating;
    _creating = null;
    _returnFromCreator(c, null).catch(err => showMessage(`Could not return to Sort Dump: ${err.message}`, 8000));
    return true;
  }

  async function _returnFromCreator(c, made) {
    try {
      EventCreator.restoreActiveSelection(c.snap);
      await EventCreator.reloadForImport(c.ctx.eventPath);
    } finally {
      if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen()) EventMgmt.close();
      setRailMode('card');
      if (typeof _refreshEventWorkspaceUI === 'function') _refreshEventWorkspaceUI();
      DumpSortMode.holdContext(false);
    }
    const ed = EventCreator.getActiveEventData();
    if (!ed || norm(ed.eventPath) !== norm(c.ctx.eventPath)) { DumpSortMode.onEventChanged(); return; }   // never sort against another event
    const state = { ...c.state, ...(made ? { dest: made, query: '' } : {}) };
    await open(state, made ? `"${norm(made).split('/').pop()}" is selected as the destination. Nothing has been moved.` : null);
  }

  // ── Review → move ─────────────────────────────────────────────────────────────────────────

  function _args(sets) {
    const ctx = DumpSortMode.context;
    const set = sets.find(s => s.id === _state.photos) || sets[0];
    return { eventPath: ctx.eventPath, destPath: _state.dest, kind: _state.kind, component: _state.kind === 'component' ? _state.component : null, selection: set ? set.files : [] };
  }

  async function _review(sets, retried = 0) {
    const args = _args(sets);
    const o = ui().ensureOverlay();
    o.innerHTML = '<div class="dupWarningModal dump-sort-modal xem-modal" aria-busy="true"><h3 id="dumpSortTitle">Move Photos to Another Event</h3><p class="dup-subtitle">Checking both events…</p></div>';
    const planned = await window.api.crossEventPlan(args).catch(err => ({ ok: false, blockers: [err.message] }));
    if (retried < 3 && planned && planned.lock && planned.lock.self && await DumpSortMode.offerSelfLockRelease(planned.lock)) return _review(sets, retried + 1);
    const r = planned && planned.review;
    const blockers = (planned && planned.blockers) || [];
    const problems = (planned && planned.problems) || [];
    const canMove = !!(planned && planned.ok && r && r.files > 0);
    const src = planned && planned.source;
    const dst = planned && planned.destination;
    const typeLabel = _state.kind === 'dump' ? 'Dump (sorted later with Sort Dump)' : `Final component — ${_state.component || ''}`;
    const rows = r ? r.destinations.map(d => `<tr><td>${esc(d.photographer)}</td><td class="dsr-folder">${esc(d.path)}${d.isNew ? ` <span class="dsr-new">${d.sequence ? `new · PC${String(d.sequence).padStart(2, '0')}` : 'new folder'}</span>` : ''}</td><td class="num">${d.files.toLocaleString()}</td><td class="num">${bytes(d.bytes)}</td></tr>`).join('') : '';
    const blocking = r ? r.collisions.filter(c => c.blocking) : [];
    const reused = r ? r.collisions.filter(c => c.kind === 'identical') : [];
    const nameOnly = r ? r.collisions.filter(c => c.kind === 'same-name-other-photographer') : [];
    const mix = r ? [r.raw ? plural(r.raw, 'RAW') : '', r.jpeg ? `${r.jpeg.toLocaleString()} JPEG/photo` : '', r.videos ? plural(r.videos, 'video') : '', r.sidecars ? plural(r.sidecars, 'XMP sidecar') : ''].filter(Boolean).join(' · ') : '';
    o.innerHTML = `<div class="dupWarningModal dump-sort-modal xem-modal">
      <h3 id="dumpSortTitle">Move Photos to Another Event</h3>
      <dl class="xem-facts">
        <dt>From</dt><dd>${esc(src ? src.folderName : DumpSortMode.context.eventName)}</dd>
        <dt>To</dt><dd><strong>${esc(dst ? dst.folderName : '')}</strong></dd>
        <dt>Destination</dt><dd>${esc(typeLabel)}</dd>
        ${r ? `<dt>Photographers</dt><dd>${esc(r.photographers.join(', ') || '—')}</dd>
        <dt>Files</dt><dd>${plural(r.files, 'file')} · ${bytes(r.bytes)}${mix ? ` <span class="xem-mix">(${esc(mix)})</span>` : ''}</dd>
        <dt>Left in this Dump</dt><dd>${plural(r.remaining, 'photo')}</dd>
        <dt>Archive</dt><dd>Same collection (${esc(r.archive.collection)})${r.archive.location === 'nas' ? ' on the NAS — both events are locked while moving' : ''}${r.archive.localFirstCopies ? '; any synced Local First copy is moved too' : ''}</dd>` : ''}
      </dl>
      ${blockers.length ? `<div class="dsr-block" role="alert">${blockers.map(b => `<p>${esc(b)}</p>`).join('')}</div>` : ''}
      ${rows ? `<table class="dsr-table"><thead><tr><th>Photographer</th><th>Destination folder</th><th class="num">Files</th><th class="num">Size</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
      ${r && r.newSequences.length ? `<p class="dsr-note">New photographer sequence: ${esc(r.newSequences.map(s => `${s.folder}${s.component ? ` in ${s.component}` : ''}`).join(', '))}.</p>` : ''}
      ${reused.length ? `<p class="dsr-note">${plural(reused.length, 'file')} already at the destination with identical content — reused, not copied again.</p>` : ''}
      ${nameOnly.length ? `<p class="dsr-note">${plural(nameOnly.length, 'file name')} also used by another photographer in the destination Dump (different photos, separate folders).</p>` : ''}
      ${blocking.length || problems.length ? `<details class="dsr-problems"${blocking.length ? ' open' : ''}><summary>${plural(problems.length, 'file')} will stay in this Dump</summary><ul>${problems.slice(0, 50).map(p => `<li>${esc(String(p.rel || p.src || '').split('/').pop())} — ${esc(p.reason)}</li>`).join('')}</ul></details>` : ''}
      <p class="xem-statement">These photographs will be moved, not imported again. They will leave the source event only after the destination is verified.</p>
      <div class="dup-actions">
        ${canMove ? '<button type="button" class="dup-btn dup-btn-primary" id="xemGo">Move Photos</button>' : ''}
        <button type="button" class="dup-btn dup-btn-cancel" id="xemBack">Back</button>
        <button type="button" class="dup-btn dup-btn-cancel" id="xemCancel2">Cancel</button>
      </div></div>`;
    o.classList.add('visible');
    o.querySelector('#xemBack').addEventListener('click', () => _renderChoose(_photoSets()));
    o.querySelector('#xemCancel2').addEventListener('click', () => _dismiss());
    o.querySelector('#xemGo')?.addEventListener('click', () => _run(args, planned), { once: true });
    _trapEscape(() => _renderChoose(_photoSets()));
    (o.querySelector('#xemGo') || o.querySelector('#xemBack')).focus();
  }

  async function _run(args, planned) {
    if (_escHandler) { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
    const ctx = DumpSortMode.context;
    if (!ctx || norm(ctx.eventPath) !== norm(args.eventPath)) { ui().close(); return; }
    const destName = planned.destination.folderName;
    DumpSortMode.setBusy(true);
    let result;
    try {
      const o = ui().ensureOverlay();
      o.innerHTML = `<div class="dupWarningModal dump-sort-modal" aria-busy="true">
        <h3 id="dumpSortTitle">Moving to ${esc(destName)}</h3>
        <p class="dsp-stage" id="dspStage">Preparing</p>
        <div class="dsp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="dsp-fill" id="dspFill"></div></div>
        <p class="dup-subtitle" id="dspCount"></p>
        <p class="dsr-note">Do not quit AutoIngest while photos are moving. If it is interrupted, the move is completed safely the next time Sort Dump opens either event. Metadata is verified in the background afterwards.</p>
      </div>`;
      o.classList.add('visible');
      const off = window.api.onCrossEventProgress(ui().onProgress);
      try { result = await window.api.crossEventRun(args); }
      finally { if (typeof off === 'function') off(); }
    } catch (err) {
      const msg = String(err && err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      DumpSortMode.setBusy(false);
      await ui().showResult({ title: 'Move stopped', lines: [msg, 'Every photo is either still in this Dump or safely at the destination. Open Sort Dump for this event again to complete the move.'], tone: 'error' });
      return;
    }
    DumpSortMode.setBusy(false);
    await _finish(result, planned, ctx);
  }

  async function _finish(result, planned, ctx) {
    if (!result || (result.ok === false && result.blockers)) {
      ui().close();
      if (result && result.lock && result.lock.self && await DumpSortMode.offerSelfLockRelease(result.lock)) {
        showMessage('The lock was released. Nothing was moved yet — open Move Selection to Another Event again.', 9000);
        return;
      }
      await ui().showResult({ title: 'Nothing was moved', lines: (result && result.blockers) || ['The move could not start.'], tone: 'error' });
      return;
    }
    const destName = planned.destination.folderName;
    const where = planned.destination.kind === 'dump' ? `${destName}'s Dump` : `${destName} / ${planned.destination.component}`;
    _dropFromWorkspace(ctx, (result.moved || []).map(m => m.src));
    const meta = result.metadata || {};
    const metaLine = meta.state === 'queued' ? 'Metadata verification queued.' : meta.state === 'not-needed' ? '' : meta.state ? 'Metadata could not be queued — use Metadata Audit on the destination event.' : '';
    const moved = `${plural(result.movedFiles || 0, 'photo')} moved to ${where} (${bytes(result.bytes)})${result.sidecars ? ` with ${plural(result.sidecars, 'XMP sidecar')}` : ''}.`;
    const att = result.attention || [];
    const stay = (result.problems || []).length;
    if (att.length || stay || result.phase === 'cancelled') {
      const details = `<details class="dsr-problems" open><summary>${att.length ? `${plural(att.length, 'file')} need attention` : `${plural(stay, 'file')} stayed in this Dump`}</summary><ul>${[...att, ...(result.problems || [])].slice(0, 50).map(p => `<li>${esc(String(p.src || p.rel || '').split('/').pop())} — ${esc(p.reason)}</li>`).join('')}</ul></details>`;
      await ui().showResult({ title: att.length ? 'Moved — some files need attention' : (result.movedFiles ? 'Moved to another event' : 'Nothing was moved'), lines: [moved, metaLine, att.length ? 'Files that need attention are still in this Dump or at the destination — none were deleted.' : ''].filter(Boolean), tone: att.length ? 'warn' : 'ok', details });
    } else ui().close();
    DumpSortMode.setLastNote(`${moved} ${metaLine}`.trim());

    // Photographer folders this move emptied — the operator decides, one by one (Keep is the default).
    const touched = new Set((result.photographers || []));
    const empty = await window.api.dumpSortEmptyFolders(ctx.eventPath).catch(() => null);
    let dumpRemoved = false;
    for (const name of ((empty && empty.folders) || []).filter(n => touched.has(n))) {
      const choice = await ui().askEmptyFolder(name);
      if (choice === 'delete') {
        const r = await window.api.dumpSortDeleteEmptyFolder(ctx.eventPath, name);
        if (!r || !r.ok) showMessage((r && r.reason) || 'The folder was kept.');
        else if (r.dumpRemoved) dumpRemoved = true;
      }
    }
    ui().close();
    EventCreator.invalidateScannedEvents();   // Event Management: B's Sort Dump button, A's count
    const st = await window.api.dumpSortStatus(ctx.eventPath).catch(() => null);
    if (dumpRemoved || (st && st.ok && !st.unsorted)) {
      DumpSortMode.closeFullySorted(`${ctx.eventName}: Dump is fully sorted. ${moved} ${metaLine}`.trim());
      return;
    }
    DumpSortMode.refreshBanner(st);
    await _refreshTree(ctx);
    showMessage(`${moved} ${metaLine}`.trim(), 8000);
  }

  /** Removes the moved photos from the grid, selection and groups — nothing else changes. */
  function _dropFromWorkspace(ctx, rels) {
    const gone = new Set(rels.map(r => norm(`${norm(ctx.eventPath)}/${r}`)));
    const isGone = (p) => gone.has(norm(p));
    for (const p of [...selectedFiles]) if (isGone(p)) selectedFiles.delete(p);
    currentFiles = currentFiles.filter(f => !isGone(f.path));
    if (currentFolderContext && Array.isArray(currentFolderContext.files)) currentFolderContext.files = currentFolderContext.files.filter(f => !isGone(f.path));
    const grouped = [];
    try { for (const g of GroupManager.getGroups()) for (const p of g.files) if (isGone(p)) grouped.push(p); } catch { /* none */ }
    if (grouped.length) GroupManager.unassignFiles(grouped);
    // The existing grid render (selection and group marks are read from their stores, not reset): section
    // counts and empty sections follow the remaining photos.
    renderFileArea(currentFiles);
    if (typeof renderGroupPanel === 'function') renderGroupPanel();
    updateSelectionBar();
  }

  /** The left folder tree of the Dump source (photographer folders emptied or removed by the move). */
  async function _refreshTree(ctx) {
    try {
      const tree = await window.api.getFolders(ctx.dumpPath);
      if (!DumpSortMode.context || !tree || typeof tree !== 'object' || Array.isArray(tree)) return;
      currentFolderTree = tree;
      renderFolders(tree, currentFolderContext ? currentFolderContext.path : tree.path);
    } catch { /* the grid is already correct; the tree refreshes on the next open */ }
  }

  return { open, takeCreatorResult, cancelCreator, get creating() { return !!_creating; } };
})();

window.CrossEventMove = CrossEventMove;
