// renderer/sourceCleanup.js — "Clean Up Imported Source Files" (AI-FEAT-064 EQI-4 Safe Source Cleanup).
//
// Source card / drive / folder → the operating system's recoverable Trash, only for files that main verified
// against their archive copy (services/sourceCleanupService.js). Every open is a fresh review of the source:
// nothing from an earlier import, review or cleanup is reused, so the second, third… cleanup of a session
// works exactly like the first. Nothing moves until the operator ticks the confirmation and presses the
// button; Cancel at any point before that changes nothing.
//
// Opened from the import summary ("Clean Up Imported Source Files") and from the source bar ("Clean Up
// Source…", shown for a card, external drive or folder source — never in Sort Dump). Uses renderer.js
// globals: activeSource, currentFiles, selectedFiles, tileMap, updateSelectionBar, showMessage, _scLastBatch.

'use strict';

const SourceCleanup = (() => {
  let _busy = false;
  let _state = null;   // { sourceRoot, sourceLabel, review }

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const plural = (n, w) => `${Number(n || 0).toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
  function bytes(n) {
    if (!n) return '0 MB';
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)} GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
    return `${Math.max(1, Math.round(n / 1e3))} KB`;
  }

  function overlay() {
    let o = document.getElementById('srcCleanOverlay');
    if (!o) {
      o = document.createElement('div');
      o.id = 'srcCleanOverlay';
      o.setAttribute('role', 'dialog');
      o.setAttribute('aria-modal', 'true');
      o.setAttribute('aria-labelledby', 'scxTitle');
      document.body.appendChild(o);
    }
    return o;
  }
  function close() {
    if (_busy) return;
    const o = document.getElementById('srcCleanOverlay');
    if (o) { o.classList.remove('visible'); o.innerHTML = ''; }
    document.removeEventListener('keydown', _onKey);
    _state = null;
  }
  function _onKey(e) { if (e.key === 'Escape' && !_busy) { e.preventDefault(); close(); } }
  function _show(html) {
    const o = overlay();
    o.innerHTML = `<div class="dupWarningModal scx-modal">${html}</div>`;
    o.classList.add('visible');
    document.removeEventListener('keydown', _onKey);
    document.addEventListener('keydown', _onKey);
    return o;
  }

  /** Opens a fresh review of `sourceRoot` (never a cached one). */
  async function open({ sourceRoot, sourceLabel } = {}) {
    if (_busy) { showMessage('A source cleanup is running. Wait for it to finish.', 6000); return; }
    if (window.DumpSortMode && DumpSortMode.isActive && DumpSortMode.isActive()) {
      showMessage('Source Cleanup is for cards and source folders — Sort Dump photos are already in the archive.', 7000);
      return;
    }
    if (!sourceRoot) { showMessage('Select the source to clean up first.', 5000); return; }
    _state = { sourceRoot, sourceLabel: sourceLabel || sourceRoot.split(/[\\/]/).filter(Boolean).pop() || sourceRoot, review: null };
    _show(`<h3 id="scxTitle">Clean Up Imported Source Files</h3>
      <p class="dup-subtitle">Checking every file on <strong>${esc(_state.sourceLabel)}</strong> against its archive copy…</p>
      <p class="scx-progress" id="scxProgress" role="status" aria-live="polite"></p>`);
    const off = window.api.onSourceCleanupProgress((p) => {
      const el = document.getElementById('scxProgress');
      if (el && p && p.phase === 'review') el.textContent = `${Number(p.done).toLocaleString()} of ${plural(p.total, 'file')} checked`;
    });
    let rv;
    try { rv = await window.api.sourceCleanupReview({ sourceRoot, sourceLabel: _state.sourceLabel }); }
    catch (err) { rv = { ok: false, blockers: [String(err && err.message || err)] }; }
    finally { if (typeof off === 'function') off(); }
    if (!_state) return;   // closed meanwhile
    _state.review = rv;
    _renderReview(rv);
  }

  function _reasonGroups(list) {
    const m = new Map();
    for (const e of list || []) m.set(e.reason, (m.get(e.reason) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  function _renderReview(rv) {
    if (!rv || !rv.ok) {
      _show(`<h3 id="scxTitle">Clean Up Imported Source Files</h3>
        <div class="dsr-block" role="alert">${((rv && rv.blockers) || ['The source could not be reviewed.']).map(b => `<p>${esc(b)}</p>`).join('')}</div>
        <p class="dup-subtitle">Nothing was changed.</p>
        <div class="dup-actions"><button type="button" class="dup-btn dup-btn-cancel" id="scxClose">Close</button></div>`).querySelector('#scxClose').addEventListener('click', close);
      document.getElementById('scxClose').focus();
      return;
    }
    const c = rv.counts;
    const cap = rv.capability || {};
    const can = rv.blockers.length === 0 && c.eligibleFiles > 0;
    const trashWhere = !cap.ok ? '—'
      : cap.platform === 'win32' ? `the Recycle Bin of ${esc(rv.source.volume || '')} (Windows behaviour not verified in this release)`
        : cap.boot ? 'your Trash — restore with Finder → Put Back' : `the Trash on this ${esc((rv.source.fsType || '').toUpperCase() || 'volume')} card — restore with Finder → Put Back while the card is inserted`;
    const groups = _reasonGroups(rv.excluded);
    const recovered = (rv.recovered || []).filter(r => r.state === 'reconciled');
    const verifiedLine = [c.verifiedBytes ? `${plural(c.verifiedBytes, 'file')} byte-identical` : '', c.verifiedImage ? `${plural(c.verifiedImage, 'file')} with identical image data (metadata added in the archive)` : ''].filter(Boolean).join(' · ');
    const o = _show(`<h3 id="scxTitle">Clean Up Imported Source Files</h3>
      <dl class="xem-facts scx-facts">
        <dt>Source</dt><dd><strong>${esc(rv.source.label)}</strong> <span class="scx-path">${esc(rv.source.root)}</span></dd>
        <dt>To the Trash</dt><dd><strong>${plural(c.eligibleFiles, 'file')}</strong> · ${bytes(c.eligibleBytes)}${c.eligibleAssets !== c.eligibleFiles ? ` <span class="xem-mix">(${c.eligibleAssets.toLocaleString() + ' photos and videos'} — a RAW with its JPEG or XMP counts as one)</span>` : ''}</dd>
        ${verifiedLine ? `<dt>Verified</dt><dd>${verifiedLine}</dd>` : ''}
        <dt>Excluded</dt><dd>${c.excluded ? `${plural(c.excluded, 'imported file')} — stay on the source` : 'None'}</dd>
        <dt>Not imported</dt><dd>${c.unimported ? `${plural(c.unimported, 'file')} — never touched` : 'None'}</dd>
        <dt>Recover from</dt><dd>${trashWhere}</dd>
      </dl>
      ${rv.blockers.length ? `<div class="dsr-block" role="alert">${rv.blockers.map(b => `<p>${esc(b)}</p>`).join('')}</div>` : ''}
      ${recovered.length ? `<p class="dsr-note">An earlier cleanup was interrupted and has been reconciled: ${recovered.map(r => `${r.summary.trashed} in the Trash, ${r.summary.notRemoved} left on the source${r.summary.attention ? `, ${r.summary.attention} need attention` : ''}`).join('; ')}. Nothing was repeated.</p>` : ''}
      ${groups.length ? `<details class="dsr-problems scx-excluded"${c.eligibleFiles ? '' : ' open'}><summary>Why ${plural(c.excluded, 'file')} ${c.excluded === 1 ? 'is' : 'are'} excluded</summary><ul>${groups.map(([r, n]) => `<li><strong>${n.toLocaleString()}</strong> — ${esc(r)}</li>`).join('')}</ul>
        <ul class="scx-list">${(rv.excluded || []).slice(0, 80).map(e => `<li>${esc(e.rel)} — ${esc(e.reason)}</li>`).join('')}${c.excluded > 80 ? `<li>…and ${(c.excluded - 80).toLocaleString()} more</li>` : ''}</ul></details>` : ''}
      <p class="xem-statement">Only files verified against their archive copy are moved to the Trash. Nothing is deleted permanently. Unimported, changed or unverified files stay on the source, and camera folders are never removed.</p>
      ${can ? `<label class="scx-confirm"><input type="checkbox" id="scxConfirm"> Move ${plural(c.eligibleFiles, 'verified file')} from ${esc(rv.source.label)} to the Trash</label>` : ''}
      <div class="dup-actions">
        ${can ? `<button type="button" class="dup-btn dup-btn-primary" id="scxGo" disabled>Move ${plural(c.eligibleFiles, 'File')} to Trash</button>` : ''}
        <button type="button" class="dup-btn dup-btn-cancel" id="scxCancel">${can ? 'Cancel' : 'Close'}</button>
      </div>`);
    o.querySelector('#scxCancel').addEventListener('click', close);
    const go = o.querySelector('#scxGo');
    const confirm = o.querySelector('#scxConfirm');
    if (go && confirm) {
      confirm.addEventListener('change', () => { go.disabled = !confirm.checked; });
      go.addEventListener('click', () => { if (confirm.checked) _run(rv); }, { once: true });
    }
    (confirm || o.querySelector('#scxCancel')).focus();
  }

  async function _run(rv) {
    _busy = true;
    const total = rv.counts.eligibleFiles;
    _show(`<h3 id="scxTitle">Moving to the Trash</h3>
      <p class="dsp-stage" id="scxStage">Re-checking each file before it is moved</p>
      <div class="dsp-track" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="0"><div class="dsp-fill" id="scxFill"></div></div>
      <p class="dup-subtitle" id="scxCount">0 of ${plural(total, 'file')}</p>
      <p class="dsr-note">Do not remove the card. If AutoIngest is interrupted, the next review reconciles what happened — nothing is repeated.</p>`);
    const off = window.api.onSourceCleanupProgress((p) => {
      if (!p || p.phase !== 'run') return;
      const fill = document.getElementById('scxFill');
      const cnt = document.getElementById('scxCount');
      const stage = document.getElementById('scxStage');
      if (fill) fill.style.width = `${Math.round((p.done / Math.max(1, p.total)) * 100)}%`;
      if (cnt) cnt.textContent = `${Number(p.done).toLocaleString()} of ${plural(p.total, 'file')} · ${Number(p.trashed).toLocaleString()} in the Trash`;
      if (stage && p.status === 'running') stage.textContent = 'Moving verified files to the Trash';
      const bar = document.querySelector('#srcCleanOverlay [role="progressbar"]');
      if (bar) bar.setAttribute('aria-valuenow', String(p.done));
    });
    let res;
    try { res = await window.api.sourceCleanupRun({ reviewId: rv.reviewId }); }
    catch (err) { res = { ok: false, blockers: [String(err && err.message || err)] }; }
    finally { if (typeof off === 'function') off(); _busy = false; }
    _renderResult(rv, res);
  }

  function _renderResult(rv, res) {
    if (!res || !res.ok) {
      _show(`<h3 id="scxTitle">Nothing was moved</h3>
        <div class="dsr-block" role="alert">${((res && res.blockers) || ['The cleanup could not start.']).map(b => `<p>${esc(b)}</p>`).join('')}</div>
        <div class="dup-actions"><button type="button" class="dup-btn dup-btn-cancel" id="scxClose">Close</button></div>`).querySelector('#scxClose').addEventListener('click', close);
      return;
    }
    const s = res.summary;
    const sep = rv.source.root.includes('\\') && !rv.source.root.includes('/') ? '\\' : '/';
    const trashed = res.files.filter(f => f.state === 'trashed');
    const kept = res.files.filter(f => f.state !== 'trashed');
    _dropFromWorkspace(trashed.map(f => `${rv.source.root}${sep}${f.rel}`));
    try {
      _scLastBatch = { deleted: s.trashed, failed: s.notRemoved + s.attention, timestamp: Date.now(),
        errors: kept.map(f => ({ file: f.rel.split(/[\\/]/).pop(), error: f.error || f.state })) };
    } catch { /* Activity Log panel not present */ }
    const tone = s.attention ? 'warn' : 'ok';
    const o = _show(`<h3 id="scxTitle">${s.attention ? 'Cleanup finished — some files need attention' : 'Cleanup finished'}</h3>
      <dl class="xem-facts scx-facts">
        <dt>In the Trash</dt><dd><strong>${plural(s.trashed, 'file')}</strong> · ${bytes(s.bytes)}</dd>
        <dt>Left on the source</dt><dd>${plural(s.notRemoved, 'file')}</dd>
        ${s.attention ? `<dt>Need attention</dt><dd class="scx-warn">${plural(s.attention, 'file')} — left the source but were not found in the Trash; check the Trash before reusing the card</dd>` : ''}
      </dl>
      ${kept.length ? `<details class="dsr-problems"${tone === 'warn' ? ' open' : ''}><summary>${plural(kept.length, 'file')} not moved</summary><ul>${kept.slice(0, 80).map(f => `<li>${esc(f.rel)} — ${esc(f.error || f.state)}</li>`).join('')}</ul></details>` : ''}
      <p class="dsr-note">Recover any of them from the Trash (Finder → Put Back). The archive, event Dumps and import history were not changed. You can keep importing from this source and clean up again.</p>
      <div class="dup-actions"><button type="button" class="dup-btn dup-btn-primary" id="scxDone">Done</button></div>`);
    o.querySelector('#scxDone').addEventListener('click', close);
    o.querySelector('#scxDone').focus();
    showMessage(`${plural(s.trashed, 'file')} moved to the Trash${s.notRemoved ? `, ${s.notRemoved} left on the source` : ''}.`, 8000);
  }

  /** Removes trashed files from the open source's grid and selection (nothing else changes). */
  function _dropFromWorkspace(paths) {
    if (!paths.length || typeof currentFiles === 'undefined') return;
    const norm = (p) => String(p || '').replace(/\\/g, '/');
    const gone = new Set(paths.map(norm));
    const before = currentFiles.length;
    currentFiles = currentFiles.filter(f => !gone.has(norm(f.path)));
    if (currentFiles.length === before) return;
    for (const p of [...selectedFiles]) if (gone.has(norm(p))) selectedFiles.delete(p);
    if (typeof currentFolderContext !== 'undefined' && currentFolderContext && Array.isArray(currentFolderContext.files)) {
      currentFolderContext.files = currentFolderContext.files.filter(f => !gone.has(norm(f.path)));
    }
    // The normal grid render: section counts and emptied sections follow the remaining files.
    renderFileArea(currentFiles);
    updateSelectionBar();
  }

  // ── Source-bar entry point ─────────────────────────────────────────────────
  const CLEANABLE = new Set(['memory-card', 'external-drive', 'local-folder']);
  function _syncButton() {
    const btn = document.getElementById('ctxCleanupBtn');
    if (!btn) return;
    const src = (typeof activeSource !== 'undefined') ? activeSource : null;
    const sortDump = window.DumpSortMode && DumpSortMode.isActive && DumpSortMode.isActive();
    btn.hidden = !(src && src.path && (!src.type || CLEANABLE.has(src.type)) && !sortDump);
  }
  function _wire() {
    const btn = document.getElementById('ctxCleanupBtn');
    if (btn) btn.addEventListener('click', () => {
      const src = (typeof activeSource !== 'undefined') ? activeSource : null;
      if (src && src.path) open({ sourceRoot: src.path, sourceLabel: src.label || src.name || null });
    });
    const val = document.getElementById('ctxSourceVal');
    if (val) new MutationObserver(_syncButton).observe(val, { childList: true, characterData: true, subtree: true });
    _syncButton();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire); else _wire();

  return { open, close, refreshButton: _syncButton, get busy() { return _busy; } };
})();

window.SourceCleanup = SourceCleanup;
