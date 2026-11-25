'use strict';

// AI-FEAT-061 Q1/Q2 — static guard for the main-window UI freeze (DEC-027).
// Compares this branch against the Stable baseline and fails if any file that
// renders or wires the existing main window / splash changed, apart from the one
// approved non-visual handoff listener (Q2). The companion's own UI must live only
// under renderer/companion/.
//
// Q5c exception (AI-FEAT-063 / AI-RM-014): the read-only Photographer Registry tab inside
// Metadata Management, and nothing else — a fourth tab button, its panel, styles scoped to
// that panel (plus the tab-row responsiveness rule), the dedicated photographerRegistryUI.js
// module, the one-line tab registration + lazy-load hook in renderer.js, and four read-only
// preload channels. Each is checked line by line below; everything else stays frozen.
// Q5d extends it for camera-association decisions INSIDE that panel only: one more dedicated
// module (photographerRegistryActions.js, which draws its controls in the panel's detail pane),
// its script tag and scoped .pr-* styles, and three decision channels (prepare/commit/cancel).
// Q5e-1 adds, still inside that panel only, the profile module (photographerRegistryProfile.js:
// aliases, retire/reactivate, first registration, PREVIEW-ONLY rename), its script tag and scoped
// styles, and one read-only channel (renamePreview). No rename can be applied from the UI.
// EQI-1 exception (AI-FEAT-064 / AI-RM-016, owner-approved): Event Dump Quick Import from the
// companion, run by the main window's EXISTING import machinery and drawing NOTHING in the main
// window — a new non-visual module (eventDumpImport.js) and its script tag, additive
// ImportRouter.buildDumpFileJobs, a behaviour-preserving extraction of the multi-event import's
// per-event prepare step (importSessionUI.js _sessPrepareEvent, so both imports route alike), the
// module's init in the companion block of renderer.js, and three companion channels. The picker /
// Event Creator it opens is the existing UI, unchanged.
//
// Run: node test/companionQ1UiFreeze.test.js [baseRef]   (default origin/stable/0.9)

const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.argv[2] || 'origin/stable/0.9';
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err.message); process.exitCode = 1; }
}

// Committed + staged + unstaged + untracked changes relative to BASE.
const mergeBase = git('merge-base', BASE, 'HEAD').trim();
const changed = new Set([
  ...git('diff', '--name-only', mergeBase).split('\n'),
  ...git('ls-files', '--others', '--exclude-standard').split('\n'),
].filter(Boolean));

// Q2 (AI-FEAT-061): the ONE approved main-window touch is the non-visual companion
// handoff listener — additions only, in renderer/renderer.js and main/preload.js, with
// no DOM, markup or style of its own.
const APPROVED_RENDERER_TOUCH = 'renderer/renderer.js';
const Q5C_INDEX = 'renderer/index.html';
const Q5C_MODULE = 'renderer/photographerRegistryUI.js';
const Q5D_MODULE = 'renderer/photographerRegistryActions.js';
const Q5E_MODULE = 'renderer/photographerRegistryProfile.js';
const Q5C_TAB_LINE_OLD = "  ['msTabMetadata', 'msTabAudit', 'msTabRegistry'].forEach(id => {";
const Q5C_TAB_LINE_NEW = "  ['msTabMetadata', 'msTabAudit', 'msTabRegistry', 'msTabPhotographers'].forEach(id => {";
const Q5C_PRELOAD_CHANNELS = ['photographerRegistry:load', 'photographerRegistry:search', 'photographerRegistry:photographer', 'photographerRegistry:camera'];
const Q5D_PRELOAD_CHANNELS = ['photographerRegistry:prepare', 'photographerRegistry:commit', 'photographerRegistry:cancel', 'photographerRegistry:renamePreview'];
const EQI1_MODULE = 'renderer/eventDumpImport.js';
const EQI1_ROUTER = 'renderer/importRouter.js';
const EQI1_SESSION_UI = 'renderer/importSessionUI.js';
const EQI1_SCRIPT = '<script src="eventDumpImport.js"></script>';
const EQI1_PRELOAD_CHANNELS = ['companion:dumpImport', 'companion:openEventPicker', 'companion:workspaceEvent',
  // EQI-1.1: one-click event selection without foregrounding, and the attention request for safety dialogs.
  'companion:selectEvent', 'companion:attention',
  // EQI-2: the multi-event Dump plan handoff and its per-event progress (no main-window UI).
  'companion:dumpPlanImport', 'companion:dumpPlanEvent',
  // EQI-2.1: the companion's Event Creator window reports its outcome (sender-checked in main).
  'eventCreatorWindow:result'];
const EQI1_RENDERER_LINES = [
  '+  // AI-FEAT-064 EQI-1: Event Dump imports / event picker requests from the companion, and the',
  '+  // active-event report it shows.',
  "+  if (typeof EventDumpImport !== 'undefined') EventDumpImport.init();",
];
// EQI-3 Sort Dump (AI-FEAT-064, owner-approved: it lives in the main window by design — Event Management
// button + the standard Import Workspace in Dump mode). These are the ONLY renderer.js changes: the
// four hooks into renderer/dumpSortMode.js and the tile line pair gaining the "Stayed in Dump" mark.
const EQI3_RENDERER_REMOVED = [
  "-    const tileCls      = 'file-tile' + (checked ? ' selected' : '') + (imported ? ' already-imported' : '') + pairCls;",
  "-    const importedLabel = imported ? `<div class=\"file-imported-label\">${_SVG_CHECK_XS}Imported</div>` : '';",
];
const EQI3_RENDERER_ADDED = [
  '+  // EQI-3 Sort Dump: every Dump photo was imported once already — in that workspace the question',
  '+  // is "sorted yet?", answered by the photo still being in Dump, not by the import history.',
  '+  if (window.DumpSortMode && DumpSortMode.isActive()) return false;',
  '+  if (window.DumpSortMode) DumpSortMode.onSourceChanged(path);   // EQI-3: leaving the Dump source ends Sort Dump',
  '+    const dumpNote     = window.DumpSortMode ? DumpSortMode.tileNote(file.path) : null;   // EQI-3: stayed in Dump',
  "+    const tileCls      = 'file-tile' + (checked ? ' selected' : '') + (imported ? ' already-imported' : '') + (dumpNote ? ' dump-refused' : '') + pairCls;",
  '+    const importedLabel = imported ? `<div class="file-imported-label">${_SVG_CHECK_XS}Imported</div>`',
  "+      : dumpNote ? `<div class=\"file-imported-label dump-refused-label\" title=\"${escapeHtml(dumpNote)}\">Stayed in Dump</div>` : '';",
  '+  if (window.DumpSortMode && DumpSortMode.isActive()) DumpSortMode.decorateImportButton(importBtn);   // EQI-3',
  "+  // EQI-3 Sort Dump: in the event's own Dump the action MOVES the selection into the event's final",
  '+  // folders (renderer/dumpSortMode.js) — never a second import of photos that are already archived.',
  '+  if (window.DumpSortMode && DumpSortMode.isActive()) { await DumpSortMode.run(); return; }',
  '+',
];
const EQI3_SCRIPT = '<script src="dumpSortMode.js" defer></script>';
// EQI-3.1 Sort Dump context safety (AI-FEAT-064): the card-disconnect stop gains its reason, Change Source
// is held while a move runs, and photos in a managed event's Dump are never offered an ordinary import.
const EQI31_RENDERER_REMOVED = [
  '-      window.api.abortCopy();',
  "-      showMessage('Card disconnected. Import cancelled.');",
];
const EQI31_RENDERER_ADDED = [
  "+      window.api.abortCopy('source-disconnected');",
  "+      showMessage('Card disconnected. Import stopped.');",
  "+  if (window.DumpSortMode && DumpSortMode.busy) { showMessage('A Sort Dump move is running. Wait for it to finish.', 6000); return; }",
  "+  // EQI-3.1: photos inside a managed event's Dump were imported once already. Outside an open Sort Dump",
  "+  // (e.g. the folder chosen by hand as a Local Folder source) they are never offered an ordinary import.",
  "+  if (activeSource && activeSource.type === 'local-folder' && window.api.dumpSortSourceOwner) {",
  "+    const dumpOwner = await window.api.dumpSortSourceOwner(activeSource.path).catch(() => null);",
  "+    if (dumpOwner) {",
  "+      showMessage(`These photos are in the Dump of ${dumpOwner.eventName}, so they were imported already. Open Event Management → Sort Dump for that event to move them into its folders.`, 10000);",
  "+      return;",
  "+    }",
  "+  }",
  "+",
];
// EQI-3.2 Move Selection to Another Event: Create New Event for a transfer destination returns to the same
// Sort Dump (renderer/crossEventMove.js) — three guarded early returns in the existing picker handlers.
const EQI32_RENDERER_ADDED = [
  '+    if (window.CrossEventMove && CrossEventMove.cancelCreator()) return;   // EQI-3.2: back to the same Sort Dump',
  '+  if (window.CrossEventMove && CrossEventMove.cancelCreator()) return;   // EQI-3.2: back to the same Sort Dump',
  "+  // EQI-3.2: Create New Event for a Sort Dump transfer destination — the new event becomes the transfer's",
  '+  // destination and the Sort Dump workspace returns on its own (source) event; nothing else changes.',
  '+  if (window.CrossEventMove && CrossEventMove.takeCreatorResult()) return;',
];
// EQI-3.2 hotfix: the workspace shows and sorts by the ORIGINAL CAPTURE time (renderer/captureTime.js)
// instead of the filesystem modification time — the date cell, date sort, timeline key/label, group panel.
const EQI32H_RENDERER = [
  "+// EQI-3.2 hotfix: grouped by the ORIGINAL CAPTURE time (renderer/captureTime.js), never the",
  "+// filesystem modification time; files without one get their own \"Capture date unavailable\" group.",
  "-    const date = file.modifiedAt ? new Date(file.modifiedAt) : new Date(0);",
  "-    const key = date.toDateString() + '-' + date.getHours();",
  "+    const key = CaptureTime.groupKey(file);",
  "+    _lastSortSig   = _captureSortSig(sorted);",
  "-      cmp = _validTimeOrEpoch(a.modifiedAt) - _validTimeOrEpoch(b.modifiedAt);",
  "-      // Deterministic tie-break on equal/missing timestamps — otherwise relies solely on",
  "-      // Array.sort's stability (guaranteed by spec, but an explicit tie-break keeps the",
  "-      // order deterministic from the comparator itself, not an implementation detail).",
  "-      if (cmp === 0) cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });",
  "+      // EQI-3.2 hotfix: capture chronology (EXIF DateTimeOriginal …), never the filesystem",
  "+      // modification time. Files without a capture date sort after the dated ones in either",
  "+      // direction; ties break on the name. The comparator applies the direction itself.",
  "+      return CaptureTime.compare(a, b, sortDir);",
  "+// EQI-3.2 hotfix: once the capture times of the shown files are read, a date sort / timeline is rebuilt",
  "+// once — only while that same file list is still on screen, and never clearing a status-bar message",
  "+// (the re-render refreshes the selection count, which would otherwise blank e.g. \"Sort Dump was closed\").",
  "+let _lastSortSig = null;",
  "+function _captureSortSig(sorted) {",
  "+  return sorted.map(f => timelineMode ? `${f.path}|${CaptureTime.groupKey(f)}` : f.path).join('\\n');",
  "+}",
  "+function _resortAfterCaptureTimes(files) {",
  "+  if (files !== currentFiles || (sortKey !== 'date' && !timelineMode)) return;",
  "+  const ws = document.getElementById('workspace');",
  "+  if (!ws || !ws.classList.contains('visible')) return;",
  "+  // Labels are already updated in place; rebuild only when the order or timeline grouping changed.",
  "+  if (_lastSortSig !== null && _captureSortSig(sortGroup(files)) === _lastSortSig) return;",
  "+  const area = document.getElementById('fileGrid');",
  "+  const status = document.getElementById('statusMessage');",
  "+  const msg = status ? status.textContent : '';",
  "+  const top = area ? area.scrollTop : 0;",
  "+  resetViewCache();",
  "+  renderCurrentView();",
  "+  if (area) area.scrollTop = top;",
  "+  if (status && msg && !status.textContent) status.textContent = msg;",
  "+}",
  "+  // EQI-3.2 hotfix: read the original capture times in the background (labels update in place);",
  "+  // once all are read, a date sort or timeline is rebuilt once, keeping the scroll position.",
  "+  CaptureTime.ensure(currentFiles, _resortAfterCaptureTimes);",
  "-            <div class=\"file-date\">${formatDate(file.modifiedAt)}</div>",
  "+            ${_captureDateHtml(file, 'div', 'file-date')}",
  "-      <td class=\"lt-date\">${formatDate(file.modifiedAt)}</td>",
  "+      ${_captureDateHtml(file, 'td', 'lt-date')}",
  "+/** EQI-3.2 hotfix: the tile/list date cell — the original capture time, patched in place once read. */",
  "+function _captureDateHtml(file, tag, cls) {",
  "+  const c = CaptureTime.cellHtml(file, escapeHtml);",
  "+  return `<${tag} class=\"${cls}${c.cls}\" data-capture-for=\"${escapeHtml(file.path)}\" title=\"${c.title}\">${c.text}</${tag}>`;",
  "+}",
  "-    const label    = `${datePart}  ·  ${String(hour).padStart(2, '0')}:00`;",
  "+    const label    = CaptureTime.groupLabel(key) || `${datePart}  ·  ${String(hour).padStart(2, '0')}:00`;",
  "-          const time   = meta?.modifiedAt",
  "-            ? new Date(meta.modifiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })",
  "+          // EQI-3.2 hotfix: the capture time (never the filesystem time); blank until read.",
  "+          const time   = meta && meta.capture && meta.capture.status === 'dated'",
  "+            ? CaptureTime.label(meta).split(', ').pop()",
  "",
];
// EQI-4 Safe Source Cleanup: the old dialog's permanent-delete handlers are replaced by one call into
// renderer/sourceCleanup.js; the import summary button is renamed.
const EQI4_RENDERER = [
  "-    cleanBtn.textContent = 'Review Cleanup';",
  "-    cleanBtn.title       = 'Review Source Cleanup';",
  "+    cleanBtn.textContent = 'Clean Up Imported Source Files';",
  "+    cleanBtn.title       = 'Review which imported files are verified in the archive and can be moved to the Trash';",
  "-function _formatBytes(bytes) {",
  "-  if (!bytes || bytes < 1024) return `${bytes || 0} B`;",
  "-  if (bytes < 1024 * 1024)    return `${(bytes / 1024).toFixed(1)} KB`;",
  "-  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;",
  "-}",
  "-",
  "-function _updateScqDeleteBtn() {",
  "-  const list    = document.getElementById('scFileList');",
  "-  const input   = document.getElementById('scConfirmInput');",
  "-  const btn     = document.getElementById('scDeleteBtn');",
  "-  const countEl = document.getElementById('scSelCount');",
  "-  if (!list || !input || !btn) return;",
  "-  const checked = list.querySelectorAll('input[type=\"checkbox\"]:checked');",
  "-  const n = checked.length;",
  "-  if (countEl) countEl.textContent = n > 0 ? `${n} file${n > 1 ? 's' : ''} selected` : '';",
  "-  btn.disabled = !(n > 0 && input.value === 'DELETE FROM SOURCE');",
  "-}",
  "-",
  "+// EQI-4 Safe Source Cleanup (renderer/sourceCleanup.js). The pre-EQI-4 dialog deleted files permanently",
  "+// from the last import's in-memory list, and after one cleanup it removed its own Delete/Cancel buttons and",
  "+// hid its file list, so a second import's cleanup opened with nothing to act on (the second-run failure).",
  "+// Every open now re-reviews the source from durable evidence and moves verified files to the Trash.",
  "-  const overlay      = document.getElementById('sourceCleanupOverlay');",
  "-  const fileList     = document.getElementById('scFileList');",
  "-  const confirmInput = document.getElementById('scConfirmInput');",
  "-  const resultArea   = document.getElementById('scResultArea');",
  "-  const selectAll    = document.getElementById('scSelectAll');",
  "-  const deleteBtn    = document.getElementById('scDeleteBtn');",
  "-  const cancelBtn    = document.getElementById('scCancelBtn');",
  "-  const confirmGate  = document.getElementById('sourceCleanupOverlay')?.querySelector('.sc-confirm-gate');",
  "-  const scActions    = document.getElementById('sourceCleanupOverlay')?.querySelector('.sc-actions');",
  "-  const selectAllRow = document.getElementById('sourceCleanupOverlay')?.querySelector('.sc-select-all-row');",
  "-  if (!overlay || !fileList || !_csqEligibleFiles) return;",
  "-",
  "-  // Reset modal to file-list state",
  "-  fileList.innerHTML = '';",
  "-  if (confirmInput) confirmInput.value = '';",
  "-  if (resultArea)   { resultArea.style.display = 'none'; resultArea.innerHTML = ''; }",
  "-  if (selectAll)    { selectAll.checked = false; selectAll.indeterminate = false; }",
  "-  if (deleteBtn)    { deleteBtn.disabled = true; deleteBtn.textContent = 'Delete Selected'; }",
  "-  if (cancelBtn)    { cancelBtn.disabled = false; cancelBtn.textContent = 'Cancel'; cancelBtn.onclick = _closeSourceCleanup; }",
  "-  if (confirmGate)  confirmGate.style.display = '';",
  "-  if (scActions)    scActions.style.display = '';",
  "-  if (selectAllRow) selectAllRow.style.display = '';",
  "-",
  "-  // Safety net: empty state when all files were deleted but state was not nulled",
  "-  if (_csqEligibleFiles.length === 0) {",
  "-    fileList.innerHTML = '<div class=\"sc-empty-state\">No source files are eligible for cleanup.<br>Only files confirmed imported successfully can be deleted.</div>';",
  "-    if (selectAllRow) selectAllRow.style.display = 'none';",
  "-    if (confirmGate)  confirmGate.style.display  = 'none';",
  "-    if (scActions) {",
  "-      scActions.innerHTML = '';",
  "-      const doneBtn = document.createElement('button');",
  "-      doneBtn.className   = 'sc-btn-done';",
  "-      doneBtn.textContent = 'Done';",
  "-      doneBtn.onclick     = _closeSourceCleanup;",
  "-      scActions.appendChild(doneBtn);",
  "-    }",
  "-    overlay.classList.remove('hidden');",
  "-    return;",
  "-  }",
  "-",
  "-  // Populate file rows using current _csqEligibleFiles (already filtered of past deletions)",
  "-  _csqEligibleFiles.forEach((f, idx) => {",
  "-    const filename = f.src.split(/[\\\\/]/).pop();",
  "-    const row = document.createElement('label');",
  "-    row.className = 'sc-file-row';",
  "-    row.dataset.src = f.src;",
  "-    row.innerHTML = `",
  "-      <input type=\"checkbox\" data-idx=\"${idx}\" />",
  "-      <span class=\"sc-file-name\" title=\"${escapeHtml(f.src)}\">${escapeHtml(filename)}</span>",
  "-      <span class=\"sc-file-size\">${_formatBytes(f.size)}</span>`;",
  "-    row.querySelector('input').addEventListener('change', () => {",
  "-      _syncSelectAll();",
  "-      _updateScqDeleteBtn();",
  "-    });",
  "-    fileList.appendChild(row);",
  "-  });",
  "-",
  "-  if (selectAll) {",
  "-    selectAll.onchange = () => {",
  "-      fileList.querySelectorAll('input[type=\"checkbox\"]').forEach(cb => cb.checked = selectAll.checked);",
  "-      _updateScqDeleteBtn();",
  "-    };",
  "-  }",
  "-  if (confirmInput) confirmInput.oninput = _updateScqDeleteBtn;",
  "-  if (deleteBtn)    deleteBtn.onclick = _handleSourceDelete;",
  "-",
  "-  overlay.classList.remove('hidden');",
  "-}",
  "-",
  "-function _syncSelectAll() {",
  "-  const list      = document.getElementById('scFileList');",
  "-  const selectAll = document.getElementById('scSelectAll');",
  "-  if (!list || !selectAll) return;",
  "-  const all     = list.querySelectorAll('input[type=\"checkbox\"]');",
  "-  const checked = list.querySelectorAll('input[type=\"checkbox\"]:checked');",
  "-  selectAll.indeterminate = checked.length > 0 && checked.length < all.length;",
  "-  selectAll.checked       = all.length > 0 && checked.length === all.length;",
  "-}",
  "-",
  "-async function _handleSourceDelete() {",
  "-  if (!_csqEligibleFiles || !_csqSourceRoot) return;",
  "-  const list       = document.getElementById('scFileList');",
  "-  const deleteBtn  = document.getElementById('scDeleteBtn');",
  "-  const cancelBtn  = document.getElementById('scCancelBtn');",
  "-  const resultArea = document.getElementById('scResultArea');",
  "-  if (!list || !deleteBtn) return;",
  "-",
  "-  const checkedBoxes = list.querySelectorAll('input[type=\"checkbox\"]:checked');",
  "-  const toDelete = Array.from(checkedBoxes).map(cb => {",
  "-    const idx = parseInt(cb.getAttribute('data-idx'), 10);",
  "-    return _csqEligibleFiles[idx];",
  "-  }).filter(Boolean);",
  "-  if (!toDelete.length) return;",
  "-",
  "-  deleteBtn.disabled = true;",
  "-  deleteBtn.textContent = 'Deleting…';",
  "-  if (cancelBtn) cancelBtn.disabled = true;",
  "-",
  "-  try {",
  "-    const { ok, results, error } = await window.api.deleteFromSource(toDelete, _csqSourceRoot);",
  "-",
  "-    if (!ok) {",
  "-      if (resultArea) {",
  "-        resultArea.style.display = '';",
  "-        resultArea.innerHTML = `<div class=\"sc-result-err\">Error: ${escapeHtml(error || 'Unknown error')}</div>`;",
  "-      }",
  "-      deleteBtn.textContent = 'Delete Selected';",
  "-      deleteBtn.disabled = false;",
  "-      if (cancelBtn) cancelBtn.disabled = false;",
  "-      return;",
  "-    }",
  "-",
  "-    let successCount = 0;",
  "-    let failCount    = 0;",
  "-    const lines = results.map(r => {",
  "-      const name = (r.src || '').split(/[\\\\/]/).pop();",
  "-      if (r.deleted) {",
  "-        successCount++;",
  "-        return `<div class=\"cleanup-file-row\"><span class=\"cleanup-icon\">${SVG.check}</span><span>${escapeHtml(name)}</span></div>`;",
  "-      }",
  "-      failCount++;",
  "-      return `<div class=\"cleanup-file-row cleanup-file-row--err\"><span class=\"cleanup-icon cleanup-icon--err\">${SVG.warn}</span><span>${escapeHtml(name)} — ${escapeHtml(r.error || 'Unknown')}</span></div>`;",
  "-    });",
  "-",
  "-    // Record result for Activity Log Source Cleanup panel (session-ephemeral)",
  "-    _scLastBatch = {",
  "-      deleted:   successCount,",
  "-      failed:    failCount,",
  "-      timestamp: Date.now(),",
  "-      errors:    results.filter(r => !r.deleted).map(r => ({",
  "-        file:  (r.src || '').split(/[\\\\/]/).pop(),",
  "-        error: r.error || 'Unknown',",
  "-      })),",
  "-    };",
  "-",
  "-    // Remove deleted rows from DOM and update eligible set",
  "-    const deletedSrcs = new Set(results.filter(r => r.deleted).map(r => r.src));",
  "-    Array.from(checkedBoxes).forEach(cb => {",
  "-      const idx = parseInt(cb.getAttribute('data-idx'), 10);",
  "-      const f   = _csqEligibleFiles[idx];",
  "-      if (f && deletedSrcs.has(f.src)) cb.closest('.sc-file-row').remove();",
  "-    });",
  "-    _csqEligibleFiles = _csqEligibleFiles.filter(f => !deletedSrcs.has(f.src));",
  "-    // When all eligible files are gone, retire the button so the modal can't reopen blank.",
  "-    if (_csqEligibleFiles.length === 0) {",
  "-      document.getElementById('scqOpenBtn')?.remove();",
  "-      _csqEligibleFiles = null;",
  "-      _csqSourceRoot    = null;",
  "-    }",
  "-",
  "-    // Surgically remove deleted files from the visible file grid",
  "-    if (deletedSrcs.size > 0) {",
  "-      currentFiles = currentFiles.filter(f => !deletedSrcs.has(f.path));",
  "-      for (const srcPath of deletedSrcs) {",
  "-        selectedFiles.delete(srcPath);",
  "-        const tile = tileMap.get(srcPath);",
  "-        if (tile) { tile.remove(); tileMap.delete(srcPath); }",
  "-      }",
  "-      updateSelectionBar();",
  "-    }",
  "-",
  "-    // Show structured result — summary + bounded file list",
  "-    if (resultArea) {",
  "-      const summaryText = successCount > 0",
  "-        ? `${successCount} file${successCount > 1 ? 's' : ''} removed from source${failCount > 0 ? `, ${failCount} failed` : ''}.`",
  "-        : failCount > 0 ? `${failCount} file${failCount > 1 ? 's' : ''} failed to remove.` : '';",
  "-      const fileRows = lines.join('');",
  "-      resultArea.style.display   = '';",
  "-      resultArea.style.maxHeight = 'none';",
  "-      resultArea.innerHTML =",
  "-        `<div class=\"cleanup-result success\"><span class=\"cleanup-icon\">${SVG.check}</span><span>${escapeHtml(summaryText)}</span></div>` +",
  "-        (fileRows ? `<div class=\"cleanup-file-list\">${fileRows}</div>` : '');",
  "-    }",
  "-    // Hide the pre-deletion file-selector list — it is empty or partially cleared",
  "-    list.style.display = 'none';",
  "-",
  "-    // Replace action row with a primary Done button — no auto-close",
  "-    const scActions = document.getElementById('sourceCleanupOverlay')?.querySelector('.sc-actions');",
  "-    const confirmGate = document.getElementById('sourceCleanupOverlay')?.querySelector('.sc-confirm-gate');",
  "-    const selectAllRow = document.getElementById('sourceCleanupOverlay')?.querySelector('.sc-select-all-row');",
  "-    if (confirmGate)  confirmGate.style.display  = 'none';",
  "-    if (selectAllRow) selectAllRow.style.display = 'none';",
  "-    if (scActions) {",
  "-      scActions.innerHTML = '';",
  "-      const doneBtn = document.createElement('button');",
  "-      doneBtn.className   = 'sc-btn-done';",
  "-      doneBtn.textContent = 'Done';",
  "-      doneBtn.onclick     = _closeSourceCleanup;",
  "-      scActions.appendChild(doneBtn);",
  "-    }",
  "-",
  "-    // If failures remain, re-enable for retry",
  "-    if (failCount > 0) {",
  "-      _syncSelectAll();",
  "-      _updateScqDeleteBtn();",
  "-    }",
  "-  } catch (err) {",
  "-    if (resultArea) {",
  "-      resultArea.style.display = '';",
  "-      resultArea.innerHTML = `<div class=\"sc-result-err\">Error: ${escapeHtml(err.message)}</div>`;",
  "-    }",
  "-    deleteBtn.textContent = 'Delete Selected';",
  "-    deleteBtn.disabled = false;",
  "-    if (cancelBtn) cancelBtn.disabled = false;",
  "-  }",
  "-}",
  "-",
  "-function _closeSourceCleanup() {",
  "-  const overlay = document.getElementById('sourceCleanupOverlay');",
  "-  if (overlay) overlay.classList.add('hidden');",
  "-  // State (_csqEligibleFiles, _csqSourceRoot) intentionally kept — cleared only at",
  "-  // import start or by resetAppState (disconnect/eject), not here, so partial",
  "-  // results survive Cancel and the list remains intact until the next import.",
  "+  if (!window.SourceCleanup) return;",
  "+  const root = _csqSourceRoot || activeSource?.path || null;",
  "+  if (!root) { showMessage('Select the source to clean up first.', 5000); return; }",
  "+  const label = (activeSource && activeSource.path === root && (activeSource.label || activeSource.name)) || null;",
  "+  SourceCleanup.open({ sourceRoot: root, sourceLabel: label });",
  "",
];
const EQI31_RENDERER = new Set([...EQI31_RENDERER_REMOVED, ...EQI31_RENDERER_ADDED, ...EQI32_RENDERER_ADDED, ...EQI32H_RENDERER, ...EQI4_RENDERER]);
const EQI32_SCRIPT = '<script src="crossEventMove.js" defer></script>';
const EQI32H_SCRIPT = '<script src="captureTime.js" defer></script>';
const EQI4_SCRIPT = '<script src="sourceCleanup.js" defer></script>';
const EQI32_PRELOAD_CHANNELS = ['crossEvent:destinations', 'crossEvent:plan', 'crossEvent:run', 'crossEvent:progress', 'media:captureTimes',
  'sourceCleanup:review', 'sourceCleanup:run', 'sourceCleanup:history', 'sourceCleanup:progress'];
// EQI-3.1: copy:abort carries why the copy stopped (user, source disconnected) — same channel, one argument.
const EQI31_PRELOAD_REMOVED = ["-  abortCopy:  () => ipcRenderer.send('copy:abort'),"];
const EQI31_PRELOAD_CHANNELS = ['copy:abort'];
const diffLines = (file) => git('diff', '-U0', mergeBase, '--', file).split('\n')
  .filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));

t('no existing renderer file changed except the approved handoff listener (main window, splash, shared modules)', () => {
  // EQI-2.1: the companion's own Event Creator window — a separate page (the main window's
  // index.html is untouched; its styles are injected at runtime, not copied).
  const EQI21_WINDOW = ['renderer/eventCreatorWindow.html', 'renderer/eventCreatorWindow.js'];
  // EQI-3: the Sort Dump workspace module and the Event Management "Sort Dump" button.
  const EQI3_MAIN_WINDOW = ['renderer/dumpSortMode.js', 'renderer/eventCreator.js'];
  // EQI-3.1: the runner treats "Import stopped/refused" like a cancel and exports that check.
  const EQI31_MAIN_WINDOW = ['renderer/importSessionRunner.js'];
  // EQI-3.2: the Move Selection to Another Event module of the Sort Dump workspace.
  const EQI32_MAIN_WINDOW = ['renderer/crossEventMove.js', 'renderer/captureTime.js', 'renderer/sourceCleanup.js'];
  const offending = [...changed].filter(f => f.startsWith('renderer/') && !f.startsWith('renderer/companion/') && ![APPROVED_RENDERER_TOUCH, Q5C_INDEX, Q5C_MODULE, Q5D_MODULE, Q5E_MODULE, EQI1_MODULE, EQI1_ROUTER, EQI1_SESSION_UI, ...EQI21_WINDOW, ...EQI3_MAIN_WINDOW, ...EQI31_MAIN_WINDOW, ...EQI32_MAIN_WINDOW].includes(f));
  assert.deepEqual(offending, []);
});

t('renderer.js: handoff listener is additions only and draws nothing', () => {
  const all = diffLines(APPROVED_RENDERER_TOUCH).filter(l => !EQI3_RENDERER_REMOVED.includes(l) && !EQI3_RENDERER_ADDED.includes(l) && !EQI31_RENDERER.has(l));
  // Q5c: the only changed existing line is the Metadata Management tab list gaining its fourth id.
  assert.deepEqual(all.filter(l => l.startsWith('-')), all.some(l => l === `+${Q5C_TAB_LINE_NEW}`) ? [`-${Q5C_TAB_LINE_OLD}`] : [], 'no existing line removed or changed');
  const lines = all.filter(l => l !== `+${Q5C_TAB_LINE_NEW}` && l !== `-${Q5C_TAB_LINE_OLD}` && !EQI1_RENDERER_LINES.includes(l));
  const drawing = lines.filter(l => /innerHTML|outerHTML|createElement|insertAdjacent|appendChild|replaceChildren|\.style\.|classList\.(add|remove|toggle)|<[a-z]+[ >]/i.test(l));
  assert.deepEqual(drawing, [], 'no DOM, markup or style created');
  if (lines.length) assert.ok(lines.some(l => l.includes('COMPANION HANDOFF')), 'confined to the documented handoff block');
});

t('renderer.js (EQI-3): exactly the documented Sort Dump hooks', () => {
  const all = diffLines(APPROVED_RENDERER_TOUCH).filter(l => !EQI31_RENDERER.has(l));
  const stray = all.filter(l => /DumpSortMode|dumpNote|dump-refused/.test(l) && !EQI3_RENDERER_ADDED.includes(l) && !EQI3_RENDERER_REMOVED.includes(l));
  assert.deepEqual(stray, [], 'no Sort Dump line outside the documented hooks');
  if (all.some(l => /DumpSortMode/.test(l))) assert.deepEqual(all.filter(l => EQI3_RENDERER_REMOVED.includes(l)), EQI3_RENDERER_REMOVED, 'only the tile line pair changed');
});

t('main-window preload: only the companion handoff channels were added', () => {
  const lines = diffLines('main/preload.js').filter(l => !EQI31_PRELOAD_REMOVED.includes(l));
  assert.deepEqual(lines.filter(l => l.startsWith('-')), [], 'no existing API removed or changed');
  const allowed = new Set(['companion:openSource', 'companion:openSourceProgress', 'companion:openSourceResult', 'companion:workspaceReady', ...Q5C_PRELOAD_CHANNELS, ...Q5D_PRELOAD_CHANNELS, ...EQI1_PRELOAD_CHANNELS, ...EQI31_PRELOAD_CHANNELS, ...EQI32_PRELOAD_CHANNELS]);
  const channels = [...lines.join('\n').matchAll(/'([a-z-]+:[A-Za-z]+)'/g)].map(m => m[1]);
  assert.deepEqual(channels.filter(c => !allowed.has(c)), [], 'no other channel exposed to the main window');
});

t('renderer.js (Q5c): only the tab registration and the lazy-load hook, nothing else', () => {
  const q5c = diffLines(APPROVED_RENDERER_TOUCH).filter(l => l === `-${Q5C_TAB_LINE_OLD}` || /msTabPhotographers|PhotographerRegistry|Photographer Registry/.test(l));
  if (!q5c.length) return;
  assert.deepEqual(q5c, [
    `-${Q5C_TAB_LINE_OLD}`,
    `+${Q5C_TAB_LINE_NEW}`,
    '+  // Photographer Registry (Q5c): read-only, loads lazily each time the tab is shown.',
    "+  if (tabId === 'msTabPhotographers') window.PhotographerRegistryUI?.onShow();",
  ]);
});

t('index.html (Q5c): additions only, confined to the Photographer Registry tab, panel, scoped styles and module', () => {
  const lines = diffLines(Q5C_INDEX);
  assert.deepEqual(lines.filter(l => l.startsWith('-')), [], 'no existing markup or style removed or changed');
  const added = lines.map(l => l.slice(1));
  const ids = added.flatMap(l => [...l.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  assert.deepEqual(ids.filter(id => !/^(pr[A-Z]|msTabPhotographers$|msTab-photographers$|ctxCleanupBtn$)/.test(id)), [], 'only Q5c-owned ids (+ EQI-4 source-bar button)');
  const classes = added.flatMap(l => [...l.matchAll(/\bclass="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
  assert.deepEqual(classes.filter(c => !c.startsWith('pr-') && !['ms-tab', 'ms-tab-helper', 'ms-scope-select', 'ctx-action-btn'].includes(c)), [], 'only pr-* classes plus reused tab/helper/select styles (+ EQI-4 source-bar button)');
  const selectors = added.filter(l => /^\s*[.#@][^{]*\{/.test(l)).map(l => l.trim());
  // EQI-3 Sort Dump: namespaced styles (.ec-evl-dump-*, .dump-sort-*, .dsb-/.dsr-/.dsp-*, #dumpSortOverlay, the tile mark);
  // EQI-3.1: the title-bar background-metadata chip (#dsMetaChip); EQI-3.2: the transfer dialog (.xem-*).
  const eqi3 = (part) => /^\s*(\.ec-evl-dump-|\.dump-sort-|\.dsr-|\.dsp-|#dumpSortOverlay\b|\.file-tile\.dump-refused\b|\.dump-refused-label\b|#dsMetaChip\b|\.xem-|\.(file|lt)-date\.capture-|#srcCleanOverlay\b|\.scx-|#ctxCleanupBtn\b)/.test(part);
  const scoped = (sel) => /^@media \(max-width: 860px\)/.test(sel) || /^@media \(prefers-reduced-motion: reduce\) \{ \.dsp-fill/.test(sel) || sel.split('{')[0].split(',').every(part => eqi3(part) || /^\s*(\.pr-|#msTabPhotographers\b|#metadataSyncModal \.ms-tabs?\b)/.test(part));
  assert.deepEqual(selectors.filter(sel => !scoped(sel)), [], 'every new rule is scoped to the Q5c panel or the modal tab row');
  const scripts = added.filter(l => /<script\b/.test(l));
  assert.deepEqual(scripts.map(l => l.trim()).sort(), ['<script src="photographerRegistryUI.js" defer></script>', '<script src="photographerRegistryActions.js" defer></script>', '<script src="photographerRegistryProfile.js" defer></script>', EQI1_SCRIPT, EQI3_SCRIPT, EQI32_SCRIPT, EQI32H_SCRIPT, EQI4_SCRIPT].sort(), 'only the dedicated modules are loaded');
  const tabButtons = added.filter(l => /class="ms-tab"/.test(l));
  assert.equal(tabButtons.length, 1, 'exactly one new Metadata Management tab button');
  assert.ok(/data-ms-tab="msTabPhotographers">Photographer Registry<\/button>/.test(tabButtons[0]));
  const actions = added.filter(l => /<button\b/.test(l) && !/class="ms-tab"|data-pr-view=|id="ctxCleanupBtn"/.test(l));
  assert.deepEqual(actions, [], 'no action button (rename, alias, confirm, retire, resolve) in the markup');
});

t('renderer.js (EQI-1): only the Event Dump module init in the companion block', () => {
  const eqi = diffLines(APPROVED_RENDERER_TOUCH).filter(l => /EventDumpImport|EQI-1|active-event report/.test(l));
  if (!eqi.length) return;
  assert.deepEqual(eqi, EQI1_RENDERER_LINES);
});

t('eventDumpImport.js (EQI-1): non-visual — draws nothing, only clicks the existing "+ Create New Event" button', () => {
  const src = require('fs').readFileSync(path.join(ROOT, EQI1_MODULE), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/innerHTML|outerHTML|insertAdjacent|createElement|appendChild|replaceChildren|\.style\.|classList\.(add|remove|toggle)|document\.write/.test(code), 'no DOM, markup or style created');
  assert.ok(!/ipcRenderer|require\(/.test(code), 'no direct IPC or module access');
  const ids = [...code.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
  // EQI-2.1: imports and event creation moved out of the main window (companionImportService /
  // the companion's Event Creator window); what remains only reports the active event.
  assert.deepEqual([...new Set(ids)].sort(), [], 'reads no element and clicks nothing');
  assert.ok(!/commitImportTransaction|ImportSessionRunner|ecNewEventFromList/.test(code), 'runs no import and opens no picker');
  assert.ok(/companionWorkspaceEvent/.test(code), 'reports the active event to the companion');
});

t('importRouter.js (EQI-1): additions only — buildDumpFileJobs, never consults photographerSequences', () => {
  const lines = diffLines(EQI1_ROUTER);
  const removed = lines.filter(l => l.startsWith('-'));
  assert.deepEqual(removed, ['-  return { buildFileJobs, simulateImport, validateGroups };'], 'only the export line changed');
  const added = lines.filter(l => l.startsWith('+')).join('\n');
  assert.ok(/function buildDumpFileJobs/.test(added) && !/photographerSequences\[|\.photographerSequences/.test(added.replace(/\/\/.*$/gm, '')), 'Dump routing never reads PC sequences');
});

t('importSessionUI.js (EQI-1): only the per-event prepare step moved into _sessPrepareEvent, unchanged', () => {
  const lines = diffLines(EQI1_SESSION_UI);
  const norm = (l) => l.slice(1).trim();
  const added = new Set(lines.filter(l => l.startsWith('+')).map(norm));
  const removed = lines.filter(l => l.startsWith('-')).map(norm).filter(Boolean);
  // The helper takes the import mode as a parameter instead of reading the session's `choice`.
  const notMoved = removed.filter(l => !added.has(l) && !['prepareEvent: async (item) => {', '},', "if (choice.importMode !== 'local-first') {", "const normSlash = (p) => (p || '').replace(/\\\\/g, '/').replace(/\\/$/, '');"].includes(l));
  assert.deepEqual(notMoved, [], 'every removed line reappears in the extracted helper');
  assert.ok(added.has('prepareEvent: (item) => _sessPrepareEvent(item, choice.importMode, archSt),'), 'the multi-event import calls the shared helper');
  const drawing = lines.filter(l => l.startsWith('+') && /innerHTML|createElement|\.style\.|classList\.(add|remove|toggle)/.test(l));
  assert.deepEqual(drawing, [], 'no DOM, markup or style created');
});

t('photographerRegistryActions.js (Q5d): decisions only through prepare/commit/cancel (+ search for the picker), no HTML injection', () => {
  const src = require('fs').readFileSync(path.join(ROOT, Q5D_MODULE), 'utf8');
  const calls = [...src.matchAll(/api\.(\w+)\(/g)].map(m => m[1]);
  assert.deepEqual([...new Set(calls)].sort(), ['photographerRegistryCancel', 'photographerRegistryCommit', 'photographerRegistryPrepare', 'photographerRegistrySearch']);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), 'text is set with textContent only');
  assert.ok(!/ipcRenderer|require\(/.test(src), 'no direct IPC or module access');
  assert.ok(!/rename|folder/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'no naming or folder control');
  assert.ok(!/getElementById\('(?!pr)|querySelector\('(?!\.pr-|input\[data-first\]|button)/.test(src), 'touches only its own panel elements');
});

t('photographerRegistryProfile.js (Q5e-1): profile actions through the shared panel; rename is preview-only', () => {
  const src = require('fs').readFileSync(path.join(ROOT, Q5E_MODULE), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const calls = [...code.matchAll(/api\.(\w+)\(/g)].map(m => m[1]);
  assert.deepEqual([...new Set(calls)].sort(), ['photographerRegistryRenamePreview'], 'its only direct call is the read-only rename preview');
  const actions = [...code.matchAll(/action: '([a-z-]+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(actions)].sort(), ['alias-add', 'alias-remove', 'register', 'status'], 'no rename, merge or folder action is ever requested');
  assert.ok(/apply\.disabled = true/.test(code) && !/apply\.disabled = false|apply\.addEventListener/.test(code), 'the apply button exists only disabled, with no handler');
  assert.ok(!/Rename Folder/i.test(code), 'no "Rename Folder Too" control');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|ipcRenderer|require\(/.test(code), 'textContent only, no direct IPC');
});

t('photographerRegistryUI.js (Q5c): browsing reads only the four read channels, no HTML injection', () => {
  const src = require('fs').readFileSync(path.join(ROOT, Q5C_MODULE), 'utf8');
  const calls = [...src.matchAll(/api\.(\w+)\(/g)].map(m => m[1]);
  assert.deepEqual([...new Set(calls)].sort(), ['photographerRegistryCamera', 'photographerRegistryLoad', 'photographerRegistryPhotographer', 'photographerRegistrySearch']);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), 'text is set with textContent only');
  assert.ok(!/ipcRenderer|require\(/.test(src), 'no direct IPC or module access');
});

t('no main-window asset or style changed (only new tray assets added)', () => {
  const offending = [...changed].filter(f => f.startsWith('assets/') && !f.startsWith('assets/tray/'));
  assert.deepEqual(offending, []);
});

t('companion UI is confined to renderer/companion/ and its own preload', () => {
  const companionFiles = [...changed].filter(f => /companion/i.test(f));
  assert.ok(companionFiles.includes('main/companionPreload.js'), 'dedicated preload present');
  assert.ok(companionFiles.some(f => f.startsWith('renderer/companion/')), 'companion renderer present');
});

t('main.js contains no remaining first-window progress routing (R1)', () => {
  const src = require('fs').readFileSync(path.join(ROOT, 'main', 'main.js'), 'utf8');
  assert.equal((src.match(/BrowserWindow\.getAllWindows\(\)\.find\(/g) || []).length, 0);
});

console.log(`${passed} passed (base ${BASE} @ ${mergeBase.slice(0, 7)})`);
