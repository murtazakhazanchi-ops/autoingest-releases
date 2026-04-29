// renderer/eventCreator.js
// ── EventCreator — module singleton ────────────────────────────────────────
// Orchestrates the full multi-step event creation flow:
//   Step 1 (M1): Master Collection  → disk-backed create or select existing
//   Step 2 (Commit D): Event Details → component builder + live name preview
//   Step 3 (Commit E): Preview & Confirm → folder tree + final import
//
// Architecture:
//   • Pure renderer code — no Node access, all IPC via window.api
//   • sessionArchiveRoot persists across resets within a session (never cleared by resetSelection or start)
//   • sessionCollections persists across back/forward navigation this session
//   • activeMaster = { name, path } | null — cleared on resetSelection/start
//   • selectedCollection is the single source of truth for the chosen master name (= activeMaster.name)

'use strict';

const EventCreator = (() => {

  // Produces a filesystem-safe name: replaces path separators with '-' and
  // strips characters illegal on Windows. Used for folder paths only — display
  // always uses the original name.
  function sanitizeForPath(name) {
    if (typeof name !== 'string') return '';
    return name
      .replace(/[/\\]/g, '-')
      .replace(/[:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Normalize disk-format components ({ types, city, location } as strings) to
  // session format ({ eventTypes: [{id,label}], city: {id,label}, location }).
  // Safe to call on components already in session format — handles both via fallbacks.
  // Used by restoreLastEvent so coll.events always carries consistent format.
  function _normComps(components) {
    if (!Array.isArray(components)) return [];
    return components.map(c => ({
      eventTypes: (c.types || c.eventTypes || []).map(t => ({ id: t, label: t })),
      location:   c.location ? { id: c.location, label: c.location } : null,
      city:       c.city    ? { id: c.city,     label: c.city     } : null,
    }));
  }

  function assertValidComponents(comps, label) {
    if (!Array.isArray(comps)) {
      console.error(`[assertValidComponents] ${label || '?'}: not an array —`, comps);
      return;
    }
    for (const c of comps) {
      if (!Array.isArray(c.eventTypes)) {
        console.error(`[assertValidComponents] ${label || '?'}: eventTypes corrupted in component —`, c);
      }
    }
    console.log(`[assertValidComponents] ${label || '?'}: OK — ${comps.length} component(s). Structure:`,
      JSON.stringify(comps.map(c => ({ eventTypes: c.eventTypes, city: c.city, location: c.location })), null, 2));
  }

  function assertStrictComponents(comps) {
    if (!Array.isArray(comps) || comps.length === 0) {
      throw new Error('Invalid components: empty or not array');
    }
    for (const c of comps) {
      if (!Array.isArray(c.eventTypes) || c.eventTypes.length === 0) {
        throw new Error('Invalid component: missing eventTypes');
      }
      if (c.eventTypes.some(t => typeof t === 'string')) {
        throw new Error('CORRUPTION: eventTypes must be objects, not strings');
      }
      if (!c.city || !c.city.label) {
        throw new Error('Invalid component: missing city');
      }
    }
  }

  function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    Object.freeze(obj);
    Object.getOwnPropertyNames(obj).forEach(name => {
      const val = obj[name];
      if (val && typeof val === 'object' && !Object.isFrozen(val)) deepFreeze(val);
    });
    return obj;
  }

  function sanitizeForFolder(name) {
    if (!name) return '';
    return name
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/\s*-\s*/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  // Sourced from renderer/folderNameHelper.js — tested independently there.
  // City is included only when allSameCity is false (mixed cities across components).
  // The index encodes the sorted-by-id position and must not change after first write.
  function buildFolderName(comp, idx, allSameCity) {
    const indexPart    = String(idx + 1).padStart(2, '0');
    const typePart     = sanitizeForFolder(
      (comp.eventTypes || []).map(t => t.label).join('-')
    );
    const locationPart = comp.location?.label
      ? '-' + sanitizeForFolder(comp.location.label)
      : '';
    const cityPart     = (!allSameCity && comp.city?.label)
      ? '-' + sanitizeForFolder(comp.city.label)
      : '';
    return `${indexPart}-${typePart}${locationPart}${cityPart}`;
  }

  function sanitizeEventName(name) {
    if (!name) return '';
    return name
      .replace(/[+_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/\s*-\s*/g, '-')
      .trim();
  }

  async function loadEventFromDisk(eventPath) {
    try {
      let json = await window.api.readEventJson(eventPath);

      // Normalize IPC return shape — may arrive as a JSON string or wrapped object.
      if (typeof json === 'string') {
        try {
          json = JSON.parse(json);
        } catch (e) {
          console.error('[loadEventFromDisk] JSON parse failed:', e);
          return null;
        }
      }
      if (json && typeof json === 'object' && 'data' in json) {
        json = json.data;
      }

      if (!json || !Array.isArray(json.components)) {
        const exists = await window.api.dirExists(eventPath);
        if (!exists) {
          console.error('[loadEventFromDisk] PATH NOT FOUND:', eventPath);
        } else {
          console.error('[loadEventFromDisk] event.json missing or invalid at:', eventPath, '— raw response:', json);
        }
        return null;
      }

      const normalized = json.components.map((c, i) => ({
        id:         typeof c.id === 'number' ? c.id : (i + 1),
        eventTypes: Array.isArray(c.types) ? c.types.map(t => ({ label: t })) : [],
        location:   c.location ? { label: c.location } : null,
        city:       c.city    ? { label: c.city }    : null,
        folderName: c.folderName ?? null,
      }));

      console.log('[loadEventFromDisk] Loaded', normalized.length, 'components from', eventPath);

      return normalized;
    } catch (err) {
      console.error('[loadEventFromDisk] Failed to read event.json:', err);
      return null;
    }
  }

  // Creates a minimal event.json for legacy event folders that predate the schema.
  // Receives the full entry object so it can use pre-parsed identity (hijriDate, sequence)
  // instead of re-parsing the folder name — consistent with the "no fallback parsing" rule.
  async function _repairLegacyEvent(eventPath, entry) {
    const folderName = eventPath.split('/').pop();

    // Prefer identity already parsed by the scanner.
    let hijriDate = entry?.hijriDate ?? null;
    const rawSeq  = entry?.sequence  ?? null;

    // Normalize sequence to number — scanner may return a string (e.g. "02").
    let sequence = typeof rawSeq === 'number' ? rawSeq : parseInt(rawSeq, 10);
    console.log('[REPAIR NORMALIZED]', { rawSequence: rawSeq, parsedSequence: sequence });

    // If the scanner couldn't parse identity (truly unresolved), try parsing folder name.
    if (!hijriDate || Number.isNaN(sequence)) {
      // Correct format: "YYYY-MM-DD _NN-..." (space before underscore)
      const match = folderName.match(/^(\d{4}-\d{2}-\d{2}) _(\d+)-(.+)$/);
      if (!match) {
        console.error('[REPAIR] Cannot resolve identity for legacy folder:', folderName);
        return null;
      }
      hijriDate = match[1];
      sequence  = parseInt(match[2], 10);
    }

    if (!hijriDate || Number.isNaN(sequence)) {
      console.error('[REPAIR] Invalid identity:', { folderName, hijriDate, sequence });
      return null;
    }

    // Write a minimal event.json using disk component format (types[], not eventTypes[]).
    try {
      await window.api.updateEventJson(eventPath, {
        version:       1,
        hijriDate,
        sequence:      Number(sequence),
        eventName:     entry.folderName,
        safeEventName: entry.folderName,
        status:        'created',
        components:    [{ id: 1, types: [], location: null, city: '', isUnresolved: true }],
        updatedAt:     Date.now(),
      });
      console.log('[REPAIR] event.json created:', { path: eventPath, hijriDate, sequence: Number(sequence) });
    } catch (err) {
      console.error('[REPAIR FAILED] Could not write event.json:', err);
      return null;
    }

    // Reload from disk with retries — the IPC write may not be immediately visible.
    let repaired = null;
    for (let i = 0; i < 3; i++) {
      repaired = await loadEventFromDisk(eventPath);
      console.log('[REPAIR RETRY]', { attempt: i + 1, result: repaired ? repaired.length : null });
      if (repaired && repaired.length > 0) break;
      await new Promise(r => setTimeout(r, 50));
    }

    if (!repaired) {
      console.error('[CRITICAL] Repair failed: loadEventFromDisk returned null after retries:', eventPath);
      return null;
    }
    if (repaired.length === 0) {
      console.error('[CRITICAL] Repair failed: components empty after reload (possible format mismatch: types not array):', eventPath);
      return null;
    }

    // Patch the scanned entry so the list view reflects the repaired state immediately.
    const idx = _scannedEvents.findIndex(e => e.folderName === entry.folderName);
    if (idx !== -1) {
      _scannedEvents[idx] = {
        ..._scannedEvents[idx],
        _eventJson: {
          hijriDate,
          sequence: Number(sequence),
          components: repaired,
        },
        _corrupt: false,
      };
      console.log('[REPAIR] Updated scannedEvents cache for:', entry.folderName);
    }

    return repaired;
  }

  function setEventState(components) {
    if (!Array.isArray(components)) {
      console.error('[setEventState] Invalid components input');
      _eventComps = [];
      return;
    }

    if (components.length === 0) {
      _eventComps = [];
      console.log('[setEventState] Cleared state');
      return;
    }

    // Guard against disk-format components being passed in.
    // Disk format uses { types, city, location } (strings); UI format uses { eventTypes, city, location } (objects).
    // Any caller that passes disk-format will silently zero-out eventTypes — catch it here instead.
    if (!components[0]?.eventTypes) {
      console.error('[setEventState] Non-normalized components — disk format passed directly. Use loadEventFromDisk first.', components);
      return;
    }

    const normalized = components.map((c, i) => ({
      id: i + 1,
      eventTypes: Array.isArray(c.eventTypes)
        ? c.eventTypes.map(t => ({ label: t.label }))
        : [],
      location: c.location ? { label: c.location.label } : null,
      city: c.city ? { label: c.city.label } : null,
      // Preserve folderName threaded in by loadEventFromDisk.
      // Once set, folderName is never recomputed — it is the stable folder identity.
      folderName: c.folderName ?? null,
    }));

    if (normalized.some(c => !Array.isArray(c.eventTypes))) {
      console.error('[setEventState] Corrupted eventTypes detected');
      return;
    }

    _eventComps = normalized;

    console.log('[setEventState] Locked state with', _eventComps.length, 'components');
  }

  // ── Session state ──────────────────────────────────────────────────────────
  let sessionArchiveRoot = null;  // string | null — cache of persisted settings.archiveRoot; primed by primeFromSettings(), auto-migrates on create/change
  let activeMaster       = null;  // { name, path } | null — the on-disk master folder in use
  const sessionCollections = [];  // { name, hijriDate, label, events[], _masterPath }[]
  let   selectedCollection = null; // string (folder name) or null

  // ── Internal step tracker ──────────────────────────────────────────────────
  let currentStep = 1;

  // ── Event step state (Commit D) ────────────────────────────────────────────
  let _globalCityVal  = null;
  let _globalCityDD   = null;
  let _eventComps     = [];
  let _compDDs        = {};
  let _compSeq        = 0;
  let _activeEventIdx = 0;

  // M3/M5: existing-event list + view state.
  //   _scannedEvents:  result of master:scanEvents for the current activeMaster,
  //                    null until a scan has run this Step-2 entry.
  //   _viewingExisting: when set, the form starts read-only; M6 edit mode
  //                    can unlock it via _editMode flag.
  let _scannedEvents   = null;
  let _viewingExisting = null; // { folderName, hijriDate, sequence, isUnresolved, components } | null
  let _editMode        = false; // M6: when true in view-existing mode, form is editable
  let _repairMode      = false; // Phase 5: when true, form is repairing an unparseable folder
  let _repairFolderName = null; // Phase 5: original (bad) folder name being repaired
  let _newEventDate    = null;  // M7: hijri date string for new events ("YYYY-MM-DD"), null when viewing/editing
  let _structureWarningPending = false; // prevents double-modal if save is triggered concurrently
  let _legacyModalOpen         = false; // prevents double-modal on fast double-click of Continue
  let _navScreen           = 'masterStep'; // 'masterStep' | 'eventList' | 'eventForm' | 'previewStep'
  let _selectedListFolder  = null;         // Phase 2: folder name highlighted in SELECT mode
  let _listenersAttached   = false;        // Guard: delegated panel listeners registered only once
  let _saveInProgress      = false;        // Guard: prevent concurrent save executions

  function _makeComp() {
    return { id: ++_compSeq, eventTypes: [], location: null, city: _globalCityVal ? { ..._globalCityVal } : null };
  }

  function _destroyEventDDs() {
    if (_globalCityDD) { _globalCityDD.destroy(); _globalCityDD = null; }
    Object.values(_compDDs).forEach(row => {
      row.et?.destroy();
      row.loc?.destroy();
      row.city?.destroy();
    });
    _compDDs = {};
  }

  function _resetEventForm() {
    _destroyEventDDs();
    setEventState([]);
    _globalCityVal  = null;
    _compSeq        = 0;
    _saveInProgress = false;
  }

  // ── DOM shortcuts ──────────────────────────────────────────────────────────
  const $ecBody  = () => document.getElementById('ecBody');
  const $ecTitle = () => document.getElementById('ecTitle');

  // ── Path helpers ───────────────────────────────────────────────────────────

  function pathBasename(p) {
    return (p || '').replace(/[/\\]+$/, '').split(/[/\\]/).pop() || p;
  }

  // ── Hijri date helpers ─────────────────────────────────────────────────────

  function validateHijriDate(y, m, d) {
    const year  = parseInt(y,  10);
    const month = parseInt(m,  10);
    const day   = parseInt(d,  10);
    if (!y  || isNaN(year)  || year  < 1400 || year  > 1500) return 'Year must be between 1400 and 1500';
    if (!m  || isNaN(month) || month < 1    || month > 12  ) return 'Month must be 01–12';
    if (!d  || isNaN(day)   || day   < 1    || day   > 30  ) return 'Day must be 01–30';
    return null;
  }

  function pad2(v) { return String(v).padStart(2, '0'); }

  function buildCollectionName(y, m, d, label) {
    const l = (label || '').trim();
    if (!y || !m || !d || !l) return '';
    if (validateHijriDate(y, m, d)) return '';
    return `${y}-${pad2(m)}-${pad2(d)} _${l}`;
  }

  function isDuplicate(name) {
    return sessionCollections.some(c => c.name === name);
  }

  // ── HTML escape utility ────────────────────────────────────────────────────
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Modal helpers ──────────────────────────────────────────────────────────
  // Shared promise-based overlay modal.
  // buttons: [{ label, primary, value }] — primary=true uses .ec-continue-btn

  function _showModal({ title, bodyHTML, buttons }) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'ec-modal-overlay';

      const buttonsHTML = buttons.map(b =>
        `<button class="${b.primary ? 'ec-continue-btn' : 'ec-outline-btn'}"
                 data-val="${esc(String(b.value))}">${esc(b.label)}</button>`
      ).join('');

      overlay.innerHTML = `
<div class="ec-modal-box">
  <p class="ec-modal-title">${esc(title)}</p>
  <p class="ec-modal-body"></p>
  <div class="ec-modal-actions">${buttonsHTML}</div>
</div>`;

      // bodyHTML is trusted internal HTML (caller is responsible for escaping user data)
      overlay.querySelector('.ec-modal-body').innerHTML = bodyHTML;
      document.body.appendChild(overlay);

      const primaryVal = String(buttons.find(b => b.primary)?.value ?? '');
      const cancelVal  = String(buttons.find(b => !b.primary)?.value ?? primaryVal);

      function cleanup(val) {
        document.removeEventListener('keydown', keyHandler);
        overlay.remove();
        resolve(val);
      }

      overlay.querySelectorAll('button[data-val]').forEach(btn => {
        btn.addEventListener('click', () => cleanup(btn.dataset.val));
      });

      function keyHandler(e) {
        if (e.key === 'Enter')  { e.preventDefault(); cleanup(primaryVal); }
        if (e.key === 'Escape') { e.preventDefault(); cleanup(cancelVal);  }
      }
      document.addEventListener('keydown', keyHandler);

      // Focus primary button
      requestAnimationFrame(() =>
        overlay.querySelector('.ec-continue-btn')?.focus()
      );
    });
  }

  function showMasterExistsModal(folderName) {
    return _showModal({
      title:    'Master Folder Already Exists',
      bodyHTML: `A folder named <strong>${esc(folderName)}</strong> already exists at this location. Use the existing folder?`,
      buttons:  [
        { label: 'No, cancel',  primary: false, value: 'no'  },
        { label: 'Yes, use it', primary: true,  value: 'yes' }
      ]
    }).then(v => v === 'yes');
  }

  function showErrorModal(message) {
    return _showModal({
      title:    'Error',
      bodyHTML: esc(message),
      buttons:  [{ label: 'OK', primary: true, value: 'ok' }]
    });
  }

  function showStructureChangeWarningModal(diskInfo = null) {
    // Build the disk summary block when we have real data from disk.
    let diskSummaryHtml = '';
    if (diskInfo && diskInfo.hasContent) {
      const { folders, files, folderCount, fileCount } = diskInfo;
      const fLabel    = folderCount === 1 ? 'folder'  : 'folders';
      const fileLabel = fileCount   === 1 ? 'file'    : 'files';
      const countParts = [];
      if (folderCount > 0) countParts.push(`${folderCount} ${fLabel}`);
      if (fileCount   > 0) countParts.push(`${fileCount} ${fileLabel}`);

      const preview     = folders.slice(0, 3).map(f => `<span class="ec-struct-disk-item">• ${esc(f)}</span>`).join('');
      const overflow    = folders.length > 3 ? `<span class="ec-struct-disk-more">+${folders.length - 3} more</span>` : '';
      const folderBlock = folders.length > 0
        ? `<div class="ec-struct-disk-folders">${preview}${overflow}</div>`
        : '';

      diskSummaryHtml = `
<div class="ec-struct-disk-info">
  <div class="ec-struct-disk-counts">${countParts.map(p => `<span>● ${esc(p)}</span>`).join('')}</div>
  ${folderBlock}
</div>`;
    }

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'ec-modal-overlay';

      overlay.innerHTML = `
<div class="ec-struct-modal-box">
  <div class="ec-struct-modal-header">
    <div class="ec-struct-modal-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    </div>
    <p class="ec-struct-modal-title">Event Structure Change Detected</p>
  </div>
  <div class="ec-struct-modal-body">
    <p>This event was originally a <strong>single-component event</strong>. Existing photos are stored directly in the event folder and will not be automatically reorganized into sub-events.</p>
    ${diskSummaryHtml}
    <p>New imports will follow the multi-component structure.</p>
    <p>You can reorganize existing photos manually if needed.</p>
  </div>
  <div class="ec-struct-modal-actions">
    <button class="ec-outline-btn" data-val="cancel">Cancel</button>
    <button class="ec-continue-btn" data-val="proceed">Proceed</button>
  </div>
</div>`;

      document.body.appendChild(overlay);

      function cleanup(val) {
        document.removeEventListener('keydown', keyHandler);
        overlay.remove();
        resolve(val === 'proceed');
      }

      overlay.querySelectorAll('button[data-val]').forEach(btn => {
        btn.addEventListener('click', () => cleanup(btn.dataset.val));
      });

      function keyHandler(e) {
        if (e.key === 'Enter')  { e.preventDefault(); cleanup('proceed'); }
        if (e.key === 'Escape') { e.preventDefault(); cleanup('cancel');  }
      }
      document.addEventListener('keydown', keyHandler);

      requestAnimationFrame(() => overlay.querySelector('.ec-continue-btn')?.focus());
    });
  }

  function showLegacyEventWarningModal() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'ec-modal-overlay';

      overlay.innerHTML = `
<div class="ec-struct-modal-box">
  <div class="ec-struct-modal-header">
    <div class="ec-struct-modal-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    </div>
    <p class="ec-struct-modal-title">Legacy Event Detected</p>
  </div>
  <div class="ec-struct-modal-body">
    <p>This event folder does not have a valid <strong>event.json</strong> file. It was likely created outside the app or predates the current format.</p>
    <p>You cannot import into this event until it has been set up. Open it in the editor to configure its details and create the required metadata.</p>
  </div>
  <div class="ec-struct-modal-actions">
    <button class="ec-outline-btn" data-val="cancel">Cancel</button>
    <button class="ec-continue-btn" data-val="edit">Edit Event</button>
  </div>
</div>`;

      document.body.appendChild(overlay);

      function cleanup(val) {
        document.removeEventListener('keydown', keyHandler);
        overlay.remove();
        resolve(val);
      }

      overlay.querySelectorAll('button[data-val]').forEach(btn => {
        btn.addEventListener('click', () => cleanup(btn.dataset.val));
      });

      function keyHandler(e) {
        if (e.key === 'Enter')  { e.preventDefault(); cleanup('edit');   }
        if (e.key === 'Escape') { e.preventDefault(); cleanup('cancel'); }
      }
      document.addEventListener('keydown', keyHandler);

      requestAnimationFrame(() => overlay.querySelector('.ec-continue-btn')?.focus());
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 — Master Collection
  // ══════════════════════════════════════════════════════════════════════════

  function showMasterStep() {
    currentStep = 1;
    _navScreen  = 'masterStep';
    const title = $ecTitle();
    if (title) title.textContent = 'Create Collection';
    syncRailHighlight(1);
    if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen()) EventMgmt.setMode('master');

    const body = $ecBody();
    if (!body) return;
    body.innerHTML = buildMasterHTML();
    attachMasterListeners();

    // Pre-fill Hijri date only when ALL three fields are empty (avoids clobbering partial edits)
    window.api.getTodayDate().then(today => {
      const yEl = document.getElementById('hijriYear');
      const mEl = document.getElementById('hijriMonth');
      const dEl = document.getElementById('hijriDay');
      if (!yEl?.value && !mEl?.value && !dEl?.value) {
        if (yEl) yEl.value = String(today.hijri.year);
        if (mEl) mEl.value = String(today.hijri.month).padStart(2, '0');
        if (dEl) dEl.value = String(today.hijri.day).padStart(2, '0');
      }
    }).catch(() => {});
  }

  // ── HTML builders ──────────────────────────────────────────────────────────

  function buildMasterHTML() {
    const hasExisting = sessionCollections.length > 0;
    const formOpen    = !hasExisting;

    return `
<div class="ec-master-wrap">

  ${hasExisting ? buildExistingCardsHTML() : ''}

  <!-- New collection expander ──────────────────────────────────────────── -->
  <button
    id="ecNewToggle"
    class="ec-new-toggle${formOpen ? ' open' : ''}"
    aria-expanded="${formOpen}"
    aria-controls="ecNewForm"
  >
    <span class="ec-new-plus" aria-hidden="true">＋</span>
    <span>${hasExisting ? 'Create New Collection' : 'New Collection'}</span>
    <span class="ec-new-arrow" aria-hidden="true"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
  </button>

  <!-- New collection form ─────────────────────────────────────────────── -->
  <div id="ecNewForm" class="ec-new-form${formOpen ? ' open' : ''}" role="region" aria-label="New collection form">
    ${buildNewFormHTML()}
  </div>

  <!-- Select Existing Master CTA ──────────────────────────────────────── -->
  <button id="ecSelectExistingBtn" class="ec-select-existing-btn">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
    Select Existing Master…
  </button>

  <!-- Location row (only shown once archive root is set) ───────────────── -->
  ${sessionArchiveRoot ? buildLocationRowHTML() : ''}

  <!-- Error banner ─────────────────────────────────────────────────────── -->
  <div id="ecMasterError" class="ec-master-error" role="alert" aria-live="polite"></div>

  <!-- Continue button ──────────────────────────────────────────────────── -->
  <button id="ecMasterContinue" class="ec-continue-btn" disabled>
    ${hasExisting ? 'Create & Continue →' : 'Create & Continue →'}
  </button>

</div>`;
  }

  function buildLocationRowHTML() {
    const displayPath = sessionArchiveRoot.length > 55
      ? '…' + sessionArchiveRoot.slice(-52)
      : sessionArchiveRoot;
    return `
<div class="ec-location-display" id="ecLocationDisplay">
  <span class="ec-location-label">Location</span>
  <span class="ec-location-path" title="${esc(sessionArchiveRoot)}">${esc(displayPath)}</span>
  <button class="ec-location-change-link" id="ecChangeLocation">Change Location</button>
</div>`;
  }

  function buildExistingCardsHTML() {
    return `
<p class="ec-section-title">Existing Collections</p>
<div class="ec-collection-cards" id="ecCollList" role="listbox" aria-label="Existing collections">
  ${sessionCollections.map(c => `
  <div
    class="ec-coll-card${selectedCollection === c.name ? ' selected' : ''}"
    data-name="${esc(c.name)}"
    tabindex="0"
    role="option"
    aria-selected="${selectedCollection === c.name}"
    aria-label="${esc(c.name)}"
  >
    <span class="ec-coll-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></span>
    <div class="ec-coll-info">
      <div class="ec-coll-name">${esc(c.name)}</div>
      <div class="ec-coll-meta">${esc(c.events.length)} event${c.events.length === 1 ? '' : 's'}</div>
    </div>
    <span class="ec-coll-check" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
  </div>`).join('')}
</div>
<p class="ec-section-title" style="margin-top:28px">Or Create New</p>`;
  }

  function buildNewFormHTML() {
    return `
<div class="ec-field">
  <label>Hijri Date</label>
  <div class="ec-hijri-row">
    <input
      id="hijriYear" class="ec-hijri-seg" type="text" inputmode="numeric"
      maxlength="4" placeholder="1447" aria-label="Hijri year (4 digits)"
      autocomplete="off"
    >
    <span class="ec-sep" aria-hidden="true">–</span>
    <input
      id="hijriMonth" class="ec-hijri-seg" type="text" inputmode="numeric"
      maxlength="2" placeholder="10" aria-label="Hijri month (01–12)"
      autocomplete="off"
    >
    <span class="ec-sep" aria-hidden="true">–</span>
    <input
      id="hijriDay" class="ec-hijri-seg" type="text" inputmode="numeric"
      maxlength="2" placeholder="03" aria-label="Hijri day (01–30)"
      autocomplete="off"
    >
  </div>
  <span class="ec-hint">Example: 1447 – 10 – 03</span>
  <span id="hijriErr" class="ec-error" role="alert" aria-live="polite"></span>
</div>

<div class="ec-field">
  <label for="collLabel">Collection Label</label>
  <input
    id="collLabel" type="text"
    placeholder="e.g. Surat Safar"
    maxlength="80" autocomplete="off" spellcheck="true"
  >
  <span class="ec-hint">Free text — city + trip descriptor. Exact capitalisation is preserved.</span>
  <span id="labelErr" class="ec-error" role="alert" aria-live="polite"></span>
</div>

<div class="ec-preview-card" id="ecPreviewCard" aria-live="polite">
  <span class="ec-preview-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>  Folder Name Preview</span>
  <span id="ecPreviewName" class="ec-preview-name empty">—</span>
</div>`;
  }

  // ── Listeners ──────────────────────────────────────────────────────────────

  function attachMasterListeners() {
    // Existing collection cards
    document.querySelectorAll('.ec-coll-card').forEach(card => {
      const select = () => selectExisting(card.dataset.name);
      card.addEventListener('click',   select);
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
      });
    });

    // Toggle new form
    const toggle = document.getElementById('ecNewToggle');
    const form   = document.getElementById('ecNewForm');
    if (toggle && form) {
      toggle.addEventListener('click', () => {
        const opening = !form.classList.contains('open');
        form.classList.toggle('open', opening);
        toggle.classList.toggle('open', opening);
        toggle.setAttribute('aria-expanded', String(opening));
        if (opening) {
          deselectExisting();
          requestAnimationFrame(() => document.getElementById('hijriYear')?.focus());
        }
        recheckContinue();
      });
    }

    // Hijri date segments
    const yEl = document.getElementById('hijriYear');
    const mEl = document.getElementById('hijriMonth');
    const dEl = document.getElementById('hijriDay');

    if (yEl && mEl && dEl) {
      yEl.addEventListener('input', () => { numericOnly(yEl); if (yEl.value.length === 4) mEl.focus(); onDateInput(); });
      mEl.addEventListener('input', () => { numericOnly(mEl); if (mEl.value.length === 2) dEl.focus(); onDateInput(); });
      dEl.addEventListener('input', () => { numericOnly(dEl); onDateInput(); });
      mEl.addEventListener('keydown', e => { if (e.key === 'Backspace' && mEl.value === '') { e.preventDefault(); yEl.focus(); } });
      dEl.addEventListener('keydown', e => { if (e.key === 'Backspace' && dEl.value === '') { e.preventDefault(); mEl.focus(); } });
      yEl.addEventListener('keydown', e => { if (e.key === 'Enter') mEl.focus(); });
      mEl.addEventListener('keydown', e => { if (e.key === 'Enter') dEl.focus(); });
      dEl.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('collLabel')?.focus(); });
    }

    const lEl = document.getElementById('collLabel');
    if (lEl) {
      lEl.addEventListener('input', updatePreview);
      lEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') _fireTryCreate();
      });
    }

    document.getElementById('ecMasterContinue')
      ?.addEventListener('click', _fireTryCreate);

    document.getElementById('ecSelectExistingBtn')
      ?.addEventListener('click', () => handleSelectExistingMaster().catch(err => showBanner(err.message, 'error')));

    document.getElementById('ecChangeLocation')
      ?.addEventListener('click', () => changeArchiveLocationInternal().catch(err => showBanner(err.message, 'error')));
  }

  function _fireTryCreate() {
    tryCreateCollection().catch(err => showBanner(err.message, 'error'));
  }

  // ── Input helpers ──────────────────────────────────────────────────────────

  function numericOnly(el) {
    el.value = el.value.replace(/\D/g, '');
  }

  function onDateInput() {
    const errEl = document.getElementById('hijriErr');
    if (errEl) errEl.classList.remove('visible');
    updatePreview();
  }

  // ── Live preview ───────────────────────────────────────────────────────────

  function updatePreview() {
    const y = (document.getElementById('hijriYear')?.value  || '').trim();
    const m = (document.getElementById('hijriMonth')?.value || '').trim();
    const d = (document.getElementById('hijriDay')?.value   || '').trim();
    const l = (document.getElementById('collLabel')?.value  || '').trim();

    const name    = buildCollectionName(y, m, d, l);
    const preview = document.getElementById('ecPreviewName');
    const card    = document.getElementById('ecPreviewCard');

    if (preview) {
      if (name) {
        preview.textContent = name;
        preview.classList.remove('empty');
        card?.classList.add('has-value');
      } else {
        preview.textContent = '—';
        preview.classList.add('empty');
        card?.classList.remove('has-value');
      }
    }
    recheckContinue();
  }

  // ── Selection state ────────────────────────────────────────────────────────

  function selectExisting(name) {
    selectedCollection = name;
    const coll = sessionCollections.find(c => c.name === name);
    if (coll?._masterPath) {
      activeMaster = { name, path: coll._masterPath };
    }
    document.querySelectorAll('.ec-coll-card').forEach(c => {
      const sel = c.dataset.name === name;
      c.classList.toggle('selected', sel);
      c.setAttribute('aria-selected', String(sel));
    });
    const form   = document.getElementById('ecNewForm');
    const toggle = document.getElementById('ecNewToggle');
    if (form && toggle) {
      form.classList.remove('open');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
    recheckContinue();
  }

  function deselectExisting() {
    selectedCollection = null;
    activeMaster = null;
    document.querySelectorAll('.ec-coll-card').forEach(c => {
      c.classList.remove('selected');
      c.setAttribute('aria-selected', 'false');
    });
    recheckContinue();
  }

  // ── Continue button state ──────────────────────────────────────────────────

  function recheckContinue() {
    const btn      = document.getElementById('ecMasterContinue');
    const formOpen = document.getElementById('ecNewForm')?.classList.contains('open');
    if (!btn) return;

    let canContinue = false;
    let label       = 'Continue →';

    if (!formOpen && selectedCollection) {
      canContinue = true;
      label       = 'Continue →';
    } else if (formOpen) {
      const y = (document.getElementById('hijriYear')?.value  || '').trim();
      const m = (document.getElementById('hijriMonth')?.value || '').trim();
      const d = (document.getElementById('hijriDay')?.value   || '').trim();
      const l = (document.getElementById('collLabel')?.value  || '').trim();
      canContinue = buildCollectionName(y, m, d, l) !== '';
      label       = 'Create & Continue →';
    }

    btn.disabled    = !canContinue;
    btn.textContent = label;
  }

  // ── Validate + create (now disk-backed) ────────────────────────────────────

  async function tryCreateCollection() {
    const formOpen = document.getElementById('ecNewForm')?.classList.contains('open');

    // Existing in-session card selected → just proceed
    if (!formOpen && selectedCollection) {
      proceedToEventStep();
      return;
    }

    // Validate new form fields
    const y = (document.getElementById('hijriYear')?.value  || '').trim();
    const m = (document.getElementById('hijriMonth')?.value || '').trim();
    const d = (document.getElementById('hijriDay')?.value   || '').trim();
    const l = (document.getElementById('collLabel')?.value  || '').trim();

    let hasError = false;

    const dateErr  = validateHijriDate(y, m, d);
    const hijriErr = document.getElementById('hijriErr');
    if (hijriErr) {
      if (dateErr) {
        hijriErr.textContent = dateErr;
        hijriErr.classList.add('visible');
        hasError = true;
        if (!y || isNaN(parseInt(y, 10)))      document.getElementById('hijriYear')?.focus();
        else if (!m || isNaN(parseInt(m, 10))) document.getElementById('hijriMonth')?.focus();
        else                                    document.getElementById('hijriDay')?.focus();
      } else {
        hijriErr.classList.remove('visible');
      }
    }

    const labelErr = document.getElementById('labelErr');
    if (labelErr) {
      if (!l) {
        labelErr.textContent = 'Collection label is required.';
        labelErr.classList.add('visible');
        document.getElementById('collLabel')?.focus();
        hasError = true;
      } else {
        labelErr.classList.remove('visible');
      }
    }

    if (hasError) return;

    const name      = buildCollectionName(y, m, d, l);
    const hijriDate = `${y}-${pad2(m)}-${pad2(d)}`;

    // Ensure we have an archive root (prompts once, then persists forever)
    if (!sessionArchiveRoot) {
      const pick = await window.api.chooseArchiveRoot();
      if (!pick) return; // user canceled → stay on Step 1
      sessionArchiveRoot = pick.path;
      // Auto-migrate: persist on first selection so we never re-prompt.
      // Non-blocking; failure is logged but doesn't abort the flow.
      window.api.setArchiveRootSetting(pick.path)
        .catch(err => console.error('[settings] persist archiveRoot failed:', err));
    }

    // Disk is the source of truth — always check existence regardless of
    // whether the name appears in sessionCollections. This makes in-session
    // duplicates, prior-session duplicates, and externally-created folders
    // all trigger the same modal flow.
    const { exists, fullPath } = await window.api.checkMasterExists(sessionArchiveRoot, name);
    let masterPath;

    if (exists) {
      const useIt = await showMasterExistsModal(name);
      if (!useIt) return; // user chose No → stay on Step 1
      masterPath = fullPath;
    } else {
      const created = await window.api.createMaster(sessionArchiveRoot, name);
      masterPath = created.path;
    }

    // Register in session state — update existing entry if present, else push
    let collection = sessionCollections.find(c => c.name === name);
    if (collection) {
      collection._masterPath = masterPath;
    } else {
      collection = { name, hijriDate, label: l, events: [], _masterPath: masterPath };
      sessionCollections.push(collection);
    }
    selectedCollection = name;
    activeMaster = { name, path: masterPath };

    proceedToEventStep();
  }

  // ── Select Existing Master ─────────────────────────────────────────────────

  async function handleSelectExistingMaster() {
    // M2: pass sessionArchiveRoot so the picker defaults to inside the archive.
    // User can still navigate elsewhere — this is a soft nudge, not a restriction.
    const pick = await window.api.chooseExistingMaster(sessionArchiveRoot);
    if (!pick) return; // canceled

    const folderPath = pick.path;
    const { valid, reason } = await window.api.validateMasterAccessible(folderPath);
    if (!valid) {
      await showErrorModal(`Cannot use this folder: ${reason}`);
      return;
    }

    const name = pathBasename(folderPath);
    activeMaster = { name, path: folderPath };
    selectedCollection = name;

    // Add stub to sessionCollections if not present
    if (!sessionCollections.some(c => c.name === name)) {
      sessionCollections.push({ name, hijriDate: '', label: name, events: [], _masterPath: folderPath });
    }

    proceedToEventStep();
  }

  // ── Change archive location ────────────────────────────────────────────────

  async function changeArchiveLocationInternal() {
    const pick = await window.api.chooseArchiveRoot();
    if (!pick) return; // canceled → keep current root
    sessionArchiveRoot = pick.path;
    // Persist the new choice. Non-blocking; failure is logged.
    window.api.setArchiveRootSetting(pick.path)
      .catch(err => console.error('[settings] persist archiveRoot failed:', err));
    showMasterStep(); // re-render to update location row
  }

  // ── Error / info banner ────────────────────────────────────────────────────

  function showBanner(msg, type = 'error') {
    const el = document.getElementById('ecMasterError');
    if (!el) return;
    el.textContent = msg;
    el.dataset.type = type;
    el.classList.add('visible');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('visible'), 4500);
  }

  // ── Step rail sync ─────────────────────────────────────────────────────────

  function syncRailHighlight(activeStep) {
    for (let i = 1; i <= 3; i++) {
      const el = document.getElementById(`step${i}Indicator`);
      if (!el) continue;
      el.classList.remove('active', 'done');
      if (i === activeStep) el.classList.add('active');
      else if (i < activeStep) el.classList.add('done');
    }
  }


  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 — Event Details (Commit D)
  // ══════════════════════════════════════════════════════════════════════════

  function showEventStep() {
    currentStep = 2;
    const title = $ecTitle();
    if (title) title.textContent = _viewingExisting ? (_editMode ? 'Edit Event' : 'View Event') : 'Create Event';
    syncRailHighlight(2);

    // M3: when entering fresh (not in view/edit mode, no in-progress components),
    // scan the active master for existing events. If any are found, show the
    // list-first view with a "Create New Event" button. Otherwise fall through
    // to the existing empty-form behavior for brand-new masters.
    if (!_viewingExisting && _eventComps.length === 0 && activeMaster && _scannedEvents === null) {
      _renderEventListSpinner();
      _scanAndRenderEventList().catch(err => {
        console.error('[EventCreator] scanMasterEvents failed:', err);
        // Fallback: render the empty form as if nothing existed.
        _scannedEvents = [];
        _renderEventForm();
      });
      return;
    }

    _renderEventForm();
  }

  // ── M3: event-list UI (shown when activeMaster has event subfolders) ──────

  function _renderEventListSpinner() {
    const body = $ecBody();
    if (!body) return;
    body.innerHTML = `
<div class="ec-master-wrap">
  <p class="ec-hint" style="margin:24px 0;text-align:center">Scanning master for existing events…</p>
</div>`;
  }

  async function _scanAndRenderEventList() {
    _scannedEvents = await window.api.scanMasterEvents(activeMaster.path);
    if (!_scannedEvents) _scannedEvents = [];
    // Always render the list — empty state shows "No resolvable events yet" + "+ Create New Event".
    // Never auto-open the create form; the user must click the button explicitly.
    _renderEventList();
  }

  function _renderEventList() {
    _navScreen = 'eventList';
    const body = $ecBody();
    if (!body) return;

    // Entering SELECT mode — reset footer whenever the list is shown (covers navigateBack too).
    if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen()) EventMgmt.setMode('select');

    const title = $ecTitle();
    if (title) title.textContent = 'Create or Select Event';

    const resolved    = _scannedEvents.filter(e => e.isParseable);
    const unparseable = _scannedEvents.filter(e => !e.isParseable);

    const resolvedHTML = resolved.map(ev => {
      const isLegacy = !ev._eventJson || !Array.isArray(ev._eventJson.components) || ev._eventJson.components.length === 0;
      const warnBadge = ev.isUnresolved
        ? `<span class="ec-evl-warn" title="Some tokens in this event don't match the controlled lists yet. You can still view or edit."><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>`
        : '';
      const legacyBadge = isLegacy
        ? `<span class="ec-evl-badge--legacy">LEGACY</span>`
        : '';
      const displayName = ev._eventJson?.eventName || ev.folderName;
      return `
<div class="ec-evl-item" data-folder="${esc(ev.folderName)}" tabindex="0" role="option" aria-selected="false">
  <div class="ec-evl-meta">
    <div class="ec-evl-name" title="${esc(displayName)}">${esc(displayName)}</div>
    <div class="ec-evl-date">${esc(ev.hijriDate)}</div>
  </div>
  ${legacyBadge}${warnBadge}
</div>`;
    }).join('');

    const unparseableHTML = unparseable.length === 0 ? '' : `
<p class="ec-section-title" style="margin-top:20px;opacity:0.6">Unrecognised Folders</p>
${unparseable.map(ev => `
<div class="ec-evl-item ec-evl-disabled ec-unrec-item" title="${esc(ev.reason || 'Cannot parse')}">
  <div class="ec-evl-meta">
    <div class="ec-evl-name">${esc(ev.folderName)}</div>
    <div class="ec-evl-date ec-evl-warn-text">${esc(ev.reason || 'Cannot parse')}</div>
  </div>
  <span class="ec-evl-warn"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
  <button class="ec-evl-repair-btn" data-folder="${esc(ev.folderName)}" title="Fix this folder by filling in the missing event details">Fix &amp; Convert →</button>
</div>`).join('')}`;

    body.innerHTML = `
<div class="ec-master-wrap">

  <div class="ec-collection-bar">
    <span class="ec-label">Collection</span>
    <span class="ec-name" title="${esc(selectedCollection || '')}">${esc(selectedCollection || '—')}</span>
    <button class="ec-change-btn" id="ecChangeCollection">Change</button>
  </div>

  <button id="ecNewEventFromList" class="ec-new-event-btn">+ Create New Event</button>

  <p class="ec-section-title">Existing Events <span class="ec-hint" style="font-weight:normal">(${resolved.length})</span></p>
  ${resolved.length > 0 ? '<input type="search" id="ecEvlSearch" class="ec-evl-search" placeholder="Search events…" autocomplete="off">' : ''}
  <div class="ec-evl-list" id="ecEvlList" role="listbox" aria-label="Events">
    ${resolvedHTML || '<p class="ec-hint">No resolvable events yet.</p>'}
  </div>
  ${unparseableHTML}

</div>`;

    // Scroll reset so the list always starts at the top.
    body.scrollTop = 0;

    // Collection bar: Change → go back to master step.
    document.getElementById('ecChangeCollection')?.addEventListener('click', () => {
      _scannedEvents = null;
      _viewingExisting = null;
      _selectedListFolder = null;
      showMasterStep();
    });

    // Phase 5: wire "Fix & Convert →" buttons on unparseable items.
    body.querySelectorAll('.ec-evl-repair-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation(); // prevent bubble to disabled parent
        _openRepairEvent(btn.dataset.folder);
      });
    });

    // Local reference to the currently highlighted element — avoids querySelectorAll
    // on every click (point 11: only touch prev + new element).
    let _localSelectedEl = null;

    // Central select helper — applies highlight and fires events (points 2, 8, 11).
    const _applySelect = (el) => {
      if (_localSelectedEl === el) return; // same element ref: true no-op
      if (_localSelectedEl && _selectedListFolder === el.dataset.folder) return; // already visually selected by folder
      if (_localSelectedEl) {
        _localSelectedEl.classList.remove('ec-evl-selected');
        _localSelectedEl.setAttribute('aria-selected', 'false');
      }
      el.classList.add('ec-evl-selected');
      el.setAttribute('aria-selected', 'true');
      _localSelectedEl = el;
      _selectedListFolder = el.dataset.folder;
      document.dispatchEvent(new CustomEvent('eventcreator:listSelect'));
    };

    // Wire click + keyboard on each selectable item.
    body.querySelectorAll('.ec-evl-item[data-folder]').forEach(el => {
      el.addEventListener('click', () => _applySelect(el));
      el.addEventListener('keydown', e => {
        if (e.key === ' ') { e.preventDefault(); _applySelect(el); return; }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); _applySelect(el); if (!_selectedListFolder) return; document.getElementById('emmContinueBtn')?.click(); return; }
        // Point 7: ↑/↓ arrow navigation within the visible item set.
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const items = [...body.querySelectorAll('.ec-evl-item[data-folder]')]
            .filter(i => i.style.display !== 'none');
          const curIdx = items.indexOf(el);
          const nextIdx = e.key === 'ArrowDown'
            ? Math.min(curIdx + 1, items.length - 1)
            : Math.max(curIdx - 1, 0);
          if (nextIdx !== curIdx) {
            _applySelect(items[nextIdx]);
            items[nextIdx].focus();
            items[nextIdx].scrollIntoView({ block: 'nearest' });
          }
        }
      });
    });

    // Point 1: preselect the active event (or the folder from the last selection).
    const preselectFolder = _selectedListFolder ||
      sessionCollections.find(c => c.name === selectedCollection)?.events[_activeEventIdx]?.name ||
      null;
    if (preselectFolder) {
      const target = [...body.querySelectorAll('.ec-evl-item[data-folder]')]
        .find(el => el.dataset.folder === preselectFolder);
      if (target) {
        _applySelect(target);
        target.scrollIntoView({ block: 'nearest' }); // point 1: ensure preselected item is visible
      }
    }

    // Point 2: focus selected item (or first selectable) for keyboard navigation.
    requestAnimationFrame(() => {
      const focusTarget = body.querySelector('.ec-evl-item.ec-evl-selected')
        || body.querySelector('.ec-evl-item[tabindex="0"]:not(.ec-evl-disabled)');
      focusTarget?.focus();
    });

    // Point 5: search filter — hides non-matching items, shows empty state, deselects if filtered out.
    document.getElementById('ecEvlSearch')?.addEventListener('input', function () {
      const q = this.value.trim().toLowerCase();
      const visibleFolders = [];
      body.querySelectorAll('.ec-evl-item[data-folder]').forEach(item => {
        const matches = !q || item.dataset.folder.toLowerCase().includes(q);
        item.style.display = matches ? '' : 'none';
        if (matches) visibleFolders.push(item.dataset.folder);
      });
      // Empty search state message (point 5)
      let emptyMsg = document.getElementById('ecEvlEmptySearch');
      if (q && visibleFolders.length === 0) {
        if (!emptyMsg) {
          emptyMsg = document.createElement('p');
          emptyMsg.id            = 'ecEvlEmptySearch';
          emptyMsg.className     = 'ec-hint';
          emptyMsg.style.cssText = 'text-align:center;padding:16px 0;margin:0;';
          emptyMsg.textContent   = 'No events match your search.';
          document.getElementById('ecEvlList')?.after(emptyMsg);
        }
        emptyMsg.style.display = '';
      } else if (emptyMsg) {
        emptyMsg.style.display = 'none';
      }
      if (_selectedListFolder && !visibleFolders.includes(_selectedListFolder)) {
        if (_localSelectedEl) {
          _localSelectedEl.classList.remove('ec-evl-selected');
          _localSelectedEl.setAttribute('aria-selected', 'false');
        }
        _localSelectedEl      = null;
        _selectedListFolder   = null;
        document.dispatchEvent(new CustomEvent('eventcreator:listDeselect'));
        // Move focus to first visible item so keyboard nav is still possible
        const firstVisible = [...body.querySelectorAll('.ec-evl-item[data-folder]')]
          .find(i => i.style.display !== 'none');
        firstVisible?.focus();
      }
    });

    document.getElementById('ecNewEventFromList')?.addEventListener('click', () => {
      _viewingExisting = null;
      _newEventDate    = null;
      setEventState([]);
      if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen()) EventMgmt.setMode('create');
      _renderEventForm();
    });
  }

  // Phase 5: open an unparseable folder in repair mode — user fills in all fields
  // and saves to rename the folder to a valid event name.
  function _openRepairEvent(folderName) {
    const entry = (_scannedEvents || []).find(e => e.folderName === folderName && !e.isParseable);
    if (!entry) return;
    _repairMode       = true;
    _repairFolderName = folderName;
    _viewingExisting  = null;
    _editMode         = false;
    _newEventDate     = null;
    setEventState([_makeComp()]);
    if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen()) EventMgmt.setMode('repair');
    _renderEventForm();
  }

  // M5/M6: open an existing event — starts in view-only; "Edit Event" unlocks.
  // opts.edit = true skips the view-lock and opens directly in edit mode (Phase 2).
  // event.json is the ONLY source of components — no entry.components fallback.
  async function _openExistingEvent(folderName, opts) {
    const entry = (_scannedEvents || []).find(e => e.folderName === folderName && e.isParseable);
    if (!entry) return;

    if (!activeMaster?.path) {
      console.error('[_openExistingEvent] No activeMaster path');
      return;
    }

    const eventPath = activeMaster.path + '/' + entry.folderName;

    let components = await loadEventFromDisk(eventPath);

    if (!components) {
      console.warn('[_openExistingEvent] Missing event.json, attempting legacy repair:', eventPath);
      components = await _repairLegacyEvent(eventPath, entry);
      if (!components) {
        console.error('[_openExistingEvent] Legacy repair failed — cannot open event');
        return;
      }
    }

    setEventState(components);

    _compSeq = components.length;

    _viewingExisting = {
      folderName:   entry.folderName,
      displayName:  entry._eventJson?.eventName || entry.folderName,
      hijriDate:    entry.hijriDate    || entry._eventJson?.hijriDate    || null,
      sequence:     entry.sequence     ?? entry._eventJson?.sequence     ?? null,
      isUnresolved: !!entry.isUnresolved,
    };

    _renderEventForm();
  }

  async function openEventForEdit(entry, { skipAutoRepair = false } = {}) {
    const eventPath = activeMaster.path + '/' + entry.folderName;

    if (!eventPath) {
      console.error('[openEventForEdit] Missing event path');
      return;
    }

    let components = await loadEventFromDisk(eventPath);

    if (!components) {
      if (skipAutoRepair) {
        // Legacy path: no event.json exists and we must NOT write one yet.
        // Open the editor with one blank component so the user configures it
        // from scratch. event.json is only written when they click Save.
        console.log('[openEventForEdit] Legacy open (no auto-repair) for:', entry.folderName);

        _viewingExisting = {
          folderName:   entry.folderName,
          displayName:  entry.folderName,
          hijriDate:    entry.hijriDate ?? null,
          sequence:     entry.sequence  ?? null,
          isUnresolved: true,
          isLegacy:     true,
        };

        // Identity guard — hijriDate + sequence are needed to build the save path.
        if (!_viewingExisting.hijriDate || _viewingExisting.sequence == null) {
          console.error('[openEventForEdit] Legacy entry has incomplete identity — cannot edit', {
            folderName: entry.folderName,
            hijriDate:  _viewingExisting.hijriDate,
            sequence:   _viewingExisting.sequence,
          });
          return;
        }

        setEventState([_makeComp()]);
        _compSeq = 1;
        _editMode = true;
        // Transition EventMgmt out of SELECT mode so _renderEventForm's SELECT guard
        // does not block navigation. Mirrors what emmEditBtn handler does in renderer.js.
        if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen()) EventMgmt.setMode('edit');
        console.log('[openEventForEdit] Legacy editor open — awaiting user configuration');
        _renderEventForm();
        return;
      }

      console.warn('[openEventForEdit] Missing event.json, attempting legacy repair:', eventPath);
      components = await _repairLegacyEvent(eventPath, entry);
      if (!components) {
        console.error('[openEventForEdit] Legacy repair failed — cannot enter edit mode');
        return;
      }
    }

    const editable = components.map(c => ({
      id:         c.id,
      eventTypes: c.eventTypes.map(t => ({ label: t.label })),
      location:   c.location,
      city:       c.city,
    }));

    setEventState(editable);

    _compSeq = editable.length;

    _viewingExisting = {
      folderName:   entry.folderName,
      displayName:  entry._eventJson?.eventName || entry.folderName,
      hijriDate:    entry.hijriDate    || entry._eventJson?.hijriDate    || null,
      sequence:     entry.sequence     ?? entry._eventJson?.sequence     ?? null,
      isUnresolved: !!entry.isUnresolved,
    };

    // Guard: event identity must be complete before entering edit mode.
    if (!_viewingExisting.hijriDate || _viewingExisting.sequence == null) {
      console.error('[openEventForEdit] CRITICAL: event identity incomplete — cannot edit', {
        folderName: entry.folderName,
        hijriDate:  _viewingExisting.hijriDate,
        sequence:   _viewingExisting.sequence,
        entry,
      });
      return;
    }

    _editMode = true;

    console.log('[openEventForEdit] Ready for editing:', editable.length, 'components');

    _renderEventForm();
  }

  // Pure render of the Step-2 form. Split out of showEventStep so both the
  // scan path (after choosing "Create New Event") and the view-existing path
  // reach the same builder.
  function _renderEventForm() {
    // Hard guard: never render the form while the modal is in SELECT mode.
    if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen() && EventMgmt.getMode() === 'select') {
      console.warn('[EventCreator] _renderEventForm blocked — EventMgmt mode is select, expected edit/create/repair');
      return;
    }

    _navScreen = 'eventForm';
    if (_eventComps.length === 0) setEventState([_makeComp()]);

    const body = $ecBody();
    if (!body) return;

    // Point 10: set modal title for create / repair / view (edit set by _applyEditLockState).
    const title = $ecTitle();
    if (title) {
      if (_repairMode)         title.textContent = 'Repair Event';
      else if (!_viewingExisting) title.textContent = 'Create New Event';
      // view/edit: _applyEditLockState() will set 'View Event' / 'Edit Event'
    }

    _destroyEventDDs();
    body.innerHTML = _buildEventHTML();
    body.scrollTop = 0; // Point 2: always start at top of the form.

    // M7: pre-fill hijri date fields for new events.
    if (!_viewingExisting) {
      if (!_newEventDate) {
        const coll = sessionCollections.find(c => c.name === selectedCollection);
        _newEventDate = coll?.hijriDate || null;
      }
      if (_newEventDate) {
        const [y, m, d] = _newEventDate.split('-');
        const yEl = document.getElementById('evHijriYear');
        const mEl = document.getElementById('evHijriMonth');
        const dEl = document.getElementById('evHijriDay');
        if (yEl) yEl.value = y || '';
        if (mEl) mEl.value = m || '';
        if (dEl) dEl.value = d || '';
      }
    }

    _mountEventDropdowns();
    _attachPanelDelegatedListeners();
    _updateEventPreview();

    // M5: in view-only mode, lock all inputs AFTER dropdowns have mounted with values.
    if (_viewingExisting) {
      _applyEditLockState();
    }

    // Point 3: focus first visible input so keyboard users can start typing immediately.
    requestAnimationFrame(() => {
      const first = body.querySelector('input:not([type="hidden"]):not(:disabled)');
      first?.focus();
    });
  }

  // M6: applies the correct lock/unlock state based on _editMode.
  // Called after dropdowns are mounted and values populated.
  function _applyEditLockState() {
    const body = $ecBody();
    if (!body) return;
    const locked = !_editMode; // locked when NOT in edit mode

    // Enable/disable every dropdown.
    if (_globalCityDD) _globalCityDD.setDisabled(locked);
    Object.values(_compDDs).forEach(row => {
      row.et?.setDisabled(locked);
      row.loc?.setDisabled(locked);
      row.city?.setDisabled(locked);
    });
    // Show/hide chip-remove buttons.
    body.querySelectorAll('.ec-chip-x').forEach(btn => btn.style.display = locked ? 'none' : '');
    // Show/hide Add Component and per-component Remove buttons.
    const addBtn = document.getElementById('ecAddComp');
    if (addBtn) addBtn.style.display = locked ? 'none' : '';
    body.querySelectorAll('.ec-comp-remove').forEach(btn => btn.style.display = locked ? 'none' : '');

    // Update the action button(s) to reflect view / edit mode.
    const cont    = document.getElementById('ecEventContinue');
    const editBtn = document.getElementById('ecEventEdit');
    if (cont) {
      if (_editMode) {
        cont.textContent = 'Save and Select Event →';
        cont.className   = 'ec-continue-btn';
        cont.disabled    = false;
        if (editBtn) editBtn.style.display = 'none';
      } else {
        // View mode: primary = "Select for Import →", secondary = "Edit Event"
        cont.textContent = 'Select for Import →';
        cont.className   = 'ec-continue-btn';
        cont.disabled    = false;
        if (editBtn) editBtn.style.display = '';
      }
    }

    // Update title bar to match.
    const title = $ecTitle();
    if (title) title.textContent = _editMode ? 'Edit Event' : 'View Event';
  }

  // M6: save edits to an existing event by renaming the folder on disk.
  async function _handleSaveEditedEvent() {
    // Validate all components have required fields.
    if (_eventComps.length === 0) {
      _showEventBanner('Add at least one component.', 'error'); return;
    }
    const missing = _eventComps.find(c => c.eventTypes.length === 0 || !c.city);
    if (missing) {
      _showEventBanner('Every component needs at least one Event Type and a City.', 'error'); return;
    }

    // Build the new event name using locked hijriDate + sequence from _viewingExisting.
    const parts       = _buildCompString(_eventComps);
    const newName     = `${_viewingExisting.hijriDate} _${_viewingExisting.sequence}-${parts}`;
    const safeNewName = sanitizeForPath(newName);
    const oldName     = _viewingExisting.folderName;

    // Warn before saving if a previously single-component event is now multi-component
    // and has existing imported data. Files stored in the old flat structure will not
    // be automatically reorganized — the user must be aware before proceeding.
    // _structureWarningPending prevents a second modal if save is triggered concurrently.
    {
      const _origEntry  = (_scannedEvents || []).find(e => e.folderName === _viewingExisting?.folderName);
      const _wasSingle  = (_origEntry?._eventJson?.components || []).length === 1;
      const _isNowMulti = _eventComps.length > 1;
      let _diskChecked     = false;
      let _diskInfo        = null;
      let _hasExistingData = false;
      if (_wasSingle && _isNowMulti) {
        if (activeMaster?.path && oldName) {
          _diskChecked = true;
          const _eventDiskPath = activeMaster.path + '/' + oldName;
          const _pathExists    = await window.api.dirExists(_eventDiskPath);
          if (_pathExists) {
            _diskInfo        = await window.api.dirInspectContent(_eventDiskPath);
            _hasExistingData = _diskInfo.hasContent;
          }
        }
        if (!_diskChecked) {
          _hasExistingData = (_origEntry?._eventJson?.imports || []).length > 0;
        }
      }
      if (_wasSingle && _isNowMulti && _hasExistingData && !_structureWarningPending) {
        _structureWarningPending = true;
        try {
          const proceed = await showStructureChangeWarningModal(_diskInfo);
          if (!proceed) return;
        } finally {
          _structureWarningPending = false;
        }
      }
    }

    // If the safe folder name hasn't changed, skip rename but still select and proceed.
    if (safeNewName === oldName) {
      try { assertStrictComponents(_eventComps); }
      catch (err) {
        console.error('BLOCKED CORRUPTED SAVE (no-rename):', err);
        _showEventBanner('Internal error: component structure is invalid. Cannot save.', 'error');
        return;
      }
      const _noRenameAllSameCity = _eventComps.length <= 1 ||
        _eventComps.every(c => c.city?.label === _eventComps[0].city?.label);
      const noRenameCompsForDisk = JSON.parse(JSON.stringify(_eventComps)).map((c, idx) => ({
        id:           c.id,
        types:        c.eventTypes.map(et => et.label),
        location:     c.location?.label || null,
        city:         c.city?.label     || '',
        isUnresolved: false,
        folderName:   c.folderName ?? buildFolderName(c, idx, _noRenameAllSameCity),
      }));
      if (activeMaster?.path) {
        const noRenamePath = activeMaster.path + '/' + oldName;
        const noRenamePayload = {
          eventName:     newName,
          safeEventName: safeNewName,
          hijriDate:     _viewingExisting.hijriDate,
          sequence:      _viewingExisting.sequence,
          components:    noRenameCompsForDisk,
          status:        'created',
        };
        try {
          await window.api.updateEventJson(noRenamePath, noRenamePayload);
          console.log('[POST-SAVE]', { path: noRenamePath, components: noRenamePayload.components.length, sequence: noRenamePayload.sequence });
        } catch (err) {
          console.error('[EventCreator] updateEventJson (no-rename) failed:', err);
          return;
        }
        // Patch in-memory scan cache so list view reflects saved state immediately.
        const _cachedEntry = (_scannedEvents || []).find(e => e.folderName === oldName);
        if (_cachedEntry) {
          _cachedEntry.components   = noRenameCompsForDisk;
          _cachedEntry.isUnresolved = false;
          _cachedEntry.isLegacy     = false;
          _cachedEntry.isCorrupt    = false;
          if (_cachedEntry._eventJson) {
            _cachedEntry._eventJson.components    = noRenameCompsForDisk;
            _cachedEntry._eventJson.eventName     = newName;
            _cachedEntry._eventJson.safeEventName = safeNewName;
          } else {
            _cachedEntry._eventJson = {
              hijriDate:     _viewingExisting.hijriDate,
              sequence:      _viewingExisting.sequence,
              eventName:     newName,
              safeEventName: safeNewName,
              components:    noRenameCompsForDisk,
            };
          }
        }
      }
      _editMode = false;
      _viewingExisting = { ..._viewingExisting, isUnresolved: false };
      _destroyEventDDs();
      await _selectExistingForImport(_viewingExisting);
      return;
    }

    // M6: warn if another event already has the same content parts (different sequence).
    const dupMatch = (_scannedEvents || []).find(e => {
      if (e.folderName === oldName || !e.isParseable) return false;
      const m = e.folderName.match(/^\d{4}-\d{2}-\d{2} _\d{2}-(.+)$/);
      return m && m[1] === sanitizeForPath(parts);
    });
    if (dupMatch) {
      const proceed = await _showModal({
        title:    'Similar Event Exists',
        bodyHTML: `Another event already has the same components:<br><strong>${esc(dupMatch._eventJson?.eventName || dupMatch.folderName)}</strong><br><br>Save anyway?`,
        buttons:  [
          { label: 'Cancel',       primary: false, value: 'no'  },
          { label: 'Save Anyway',  primary: true,  value: 'yes' }
        ]
      });
      if (proceed !== 'yes') return;
    }

    // Call IPC to rename on disk using the filesystem-safe name.
    const result = await window.api.renameEvent(activeMaster.path, oldName, safeNewName);
    if (!result.ok) {
      if (result.reason === 'collision') {
        _showEventBanner(`A folder named "${safeNewName}" already exists.`, 'error');
      } else {
        _showEventBanner(result.reason || 'Rename failed.', 'error');
      }
      return;
    }

    // Persist the new folder name immediately — the disk rename just succeeded so
    // safeNewName is the ground truth. Any subsequent failure (event.json write, etc.)
    // won't affect the folder itself; the persisted pointer must reflect reality now.
    window.api.setLastEvent({
      collectionPath: activeMaster.path,
      collectionName: selectedCollection,
      eventName:      newName,
      safeEventName:  safeNewName,
    }).catch(err => console.error('[setLastEvent after rename] failed:', err));

    // Validate and snapshot _eventComps before write — blocks corrupted saves.
    console.log('WRITING EVENT JSON (_handleSaveEditedEvent):', JSON.stringify(_eventComps, null, 2));
    try {
      assertStrictComponents(_eventComps);
    } catch (err) {
      console.error('BLOCKED CORRUPTED SAVE (_handleSaveEditedEvent):', err);
      _showEventBanner('Internal error: component structure is invalid. Cannot save.', 'error');
      return;
    }
    const cleanComps = JSON.parse(JSON.stringify(_eventComps));
    try {
      cleanComps.forEach((c, i) => {
        if (c.city && typeof c.city !== 'object')         throw new Error(`CORRUPTION: city must be object at component ${i}`);
        if (c.location && typeof c.location !== 'object') throw new Error(`CORRUPTION: location must be object at component ${i}`);
      });
    } catch (err) {
      console.error('BLOCKED CORRUPTED SAVE (validation):', err);
      _showEventBanner('Internal error: component data is corrupted. Cannot save.', 'error');
      return;
    }

    // Assign stable unique ids: keep existing numeric ids, seed new ones above
    // the current max so insertions and deletions never produce collisions.
    const _usedIds = new Set(cleanComps.filter(c => typeof c.id === 'number').map(c => c.id));
    let _nextId = (_usedIds.size ? Math.max(..._usedIds) : 0) + 1;
    const compsWithIds = cleanComps.map(c =>
      typeof c.id === 'number' ? c : { ...c, id: _nextId++ }
    );

    // Update the scanned events cache so the list reflects the change.
    const _renameAllSameCity = compsWithIds.length <= 1 ||
      compsWithIds.every(c => c.city?.label === compsWithIds[0].city?.label);
    const compsForDisk = compsWithIds.map((c, idx) => ({
      id:           c.id,
      types:        c.eventTypes.map(et => et.label),
      location:     c.location?.label || null,
      city:         c.city?.label     || '',
      isUnresolved: false,
      // Preserve existing folderName (set once at creation — never recompute).
      folderName:   c.folderName ?? buildFolderName(c, idx, _renameAllSameCity),
    }));
    if (!compsForDisk.every(c => typeof c.id === 'number')) {
      throw new Error('Invalid component structure: missing id');
    }
    const entry = (_scannedEvents || []).find(e => e.folderName === oldName);
    if (entry) {
      entry.folderName   = safeNewName;
      entry.components   = compsForDisk;
      entry.isUnresolved = false;
      entry.isLegacy     = false;
      entry.isCorrupt    = false;
      if (entry._eventJson) {
        entry._eventJson.components    = compsForDisk;
        entry._eventJson.eventName     = newName;
        entry._eventJson.safeEventName = safeNewName;
      } else {
        entry._eventJson = {
          hijriDate:     _viewingExisting.hijriDate,
          sequence:      _viewingExisting.sequence,
          eventName:     newName,
          safeEventName: safeNewName,
          components:    compsForDisk,
        };
      }
    }

    // Update (or create for legacy events) event.json at the new safe path.
    if (activeMaster?.path) {
      const newEventPath = activeMaster.path + '/' + safeNewName;
      const renamePayload = {
        eventName:     newName,
        safeEventName: safeNewName,
        hijriDate:     _viewingExisting.hijriDate,
        sequence:      _viewingExisting.sequence,
        components:    compsForDisk,
        status:        'created',
      };
      try {
        await window.api.updateEventJson(newEventPath, renamePayload);
        console.log('[POST-SAVE]', { path: newEventPath, components: renamePayload.components.length, sequence: renamePayload.sequence });
      } catch (err) {
        console.error('[EventCreator] updateEventJson (save edit) failed:', err);
        return;
      }

      // Sync component subfolders — only for multi-component events.
      // Single-component events have no subfolders to sync.
      if (compsForDisk.length > 1) try {
        const basePath = newEventPath;
        const tasks = [];
        for (let idx = 0; idx < compsForDisk.length; idx++) {
          // Use the persisted folderName — not a recomputed name — as the target.
          const newFolderName  = compsForDisk[idx].folderName;
          const newPath        = basePath + '/' + newFolderName;
          const existingPrefix = String(idx + 1).padStart(2, '0') + '-';
          const existing = await window.api.findDirByPrefix(basePath, existingPrefix);
          if (existing) {
            if (existing.name !== newFolderName) {
              tasks.push(
                window.api.renameDir(basePath + '/' + existing.name, newPath)
                  .catch(err => console.error('[Subfolder Rename] Failed:', existing.name, err))
              );
            }
          } else {
            tasks.push(
              window.api.ensureDir(newPath)
                .catch(err => console.error('[Subfolder Create] Failed:', newPath, err))
            );
          }
        }
        await Promise.all(tasks);
        console.log('[Subfolder Sync] Completed', compsForDisk.length, 'components');
      } catch (err) {
        console.error('[Subfolder Sync] Error:', err);
      }
    }

    _editMode = false;
    _viewingExisting = {
      ..._viewingExisting,
      folderName:   safeNewName,
      displayName:  newName,
      isUnresolved: false,
    };
    _destroyEventDDs();
    await _selectExistingForImport(_viewingExisting);
  }

  // ── HTML builder ─────────────────────────────────────────────────────────────────────

  function _buildEventHTML() {
    if (!Array.isArray(_eventComps)) {
      console.error('Invalid components structure', _eventComps);
    }
    // M5 / Phase 5: breadcrumb differs by create / view / edit / repair.
    const warnText = _viewingExisting && _viewingExisting.isUnresolved
      ? `<span style="margin-left:8px;font-size:11px;color:var(--text-muted)">unresolved tokens</span>`
      : '';
    const eventRow = _repairMode ? `
    <div class="ec-bc-row">
      <span class="ec-bc-label">Original</span>
      <span class="ec-bc-value" title="${esc(_repairFolderName)}">${esc(_repairFolderName)}</span>
      <button class="ec-bc-change" id="ecBackToList">← Back to list</button>
    </div>` : _viewingExisting ? `
    <div class="ec-bc-row">
      <span class="ec-bc-label">Event</span>
      <span class="ec-bc-value" title="${esc(_viewingExisting.displayName || _viewingExisting.folderName)}">${esc(_viewingExisting.displayName || _viewingExisting.folderName)}</span>
      ${warnText}
      <button class="ec-bc-change" id="ecBackToList">← Back to list</button>
    </div>` : '';

    return `
<div class="ec-master-wrap">

  <div class="ec-breadcrumb-bar">
    <div class="ec-bc-row">
      <span class="ec-bc-label">Collection</span>
      <span class="ec-bc-value" title="${esc(selectedCollection || '')}">${esc(selectedCollection || '')}</span>
      <button class="ec-bc-change" id="ecChangeCollection">Change</button>
    </div>
    ${eventRow}
  </div>

  ${!_viewingExisting ? `
  <!-- M7: Hijri date for new events (auto-sequences based on this date) -->
  <div class="ec-field" style="margin-top:16px">
    <p class="ec-section-title">Event Date</p>
    <div class="ec-hijri-row">
      <input id="evHijriYear" class="ec-hijri-seg" type="text" inputmode="numeric"
             maxlength="4" placeholder="1447" aria-label="Hijri year" autocomplete="off">
      <span class="ec-sep" aria-hidden="true">–</span>
      <input id="evHijriMonth" class="ec-hijri-seg" type="text" inputmode="numeric"
             maxlength="2" placeholder="10" aria-label="Hijri month" autocomplete="off">
      <span class="ec-sep" aria-hidden="true">–</span>
      <input id="evHijriDay" class="ec-hijri-seg" type="text" inputmode="numeric"
             maxlength="2" placeholder="03" aria-label="Hijri day" autocomplete="off">
    </div>
    <span class="ec-hint">Date for this event. Sequence auto-assigns based on existing events for this date.</span>
    <span id="evHijriErr" class="ec-error" role="alert" aria-live="polite"></span>
  </div>
  ` : _viewingExisting ? `
  <!-- M6: Locked date + sequence display for view/edit mode — identity from event.json, never recomputed -->
  <div class="ec-field" style="margin-top:16px">
    <p class="ec-section-title">Event Date <span class="ec-req" style="font-size:0.7rem;opacity:0.6">(locked)</span></p>
    <div class="ec-hijri-row">
      ${(() => {
        const [y='', m='', d=''] = (_viewingExisting.hijriDate || '').split('-');
        return `
      <input class="ec-hijri-seg" type="text" value="${esc(y)}" disabled aria-label="Hijri year" style="opacity:0.6">
      <span class="ec-sep" aria-hidden="true">–</span>
      <input class="ec-hijri-seg" type="text" value="${esc(m)}" disabled aria-label="Hijri month" style="opacity:0.6">
      <span class="ec-sep" aria-hidden="true">–</span>
      <input class="ec-hijri-seg" type="text" value="${esc(d)}" disabled aria-label="Hijri day" style="opacity:0.6">
      <span style="margin-left:10px;font-size:0.75rem;color:var(--text-secondary)">seq&nbsp;${esc(String(_viewingExisting.sequence ?? '—'))}</span>`;
      })()}
    </div>
    <span class="ec-hint">Date and sequence are locked. Only components can be changed.</span>
  </div>
  ` : ''}

  <div class="ec-global-city">
    <p class="ec-section-title">Global City</p>
    <div id="ecGlobalCityDD"></div>
    <span class="ec-hint">Default city for each new component. Override per-component if needed.</span>
  </div>

  <div class="ec-comp-section">
    <p class="ec-section-title" style="margin-top:24px">Components <span class="ec-req">*</span></p>
    <div class="ec-comp-list" id="ecCompList">
      ${_eventComps.map((c, i) => _buildCompRow(c, i)).join('')}
    </div>
    <button id="ecAddComp" class="ec-add-comp">＋  Add Component</button>
  </div>

  <div class="ec-preview-card" id="ecEventPreviewCard" aria-live="polite" style="margin-top:24px">
    <span class="ec-preview-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>  Event Folder Preview</span>
    <span id="ecEventPreviewName" class="ec-preview-name empty">—</span>
  </div>

  <div id="ecEventError" class="ec-master-error" role="alert" aria-live="polite"></div>

  ${_viewingExisting
    ? `<div class="ec-view-actions" style="display:none" aria-hidden="true">
         <button id="ecEventEdit" class="ec-outline-btn">Edit Event</button>
         <button id="ecEventContinue" class="ec-continue-btn">Select for Import →</button>
       </div>`
    : `<button id="ecEventContinue" class="ec-continue-btn" disabled style="display:none" aria-hidden="true">Create Event →</button>`}

</div>`;
  }

  function _buildCompRow(comp, index) {
    console.log('UI EVENT TYPES:', comp.eventTypes);
    const canRemove  = _eventComps.length > 1;
    const chipsHTML  = comp.eventTypes.map((et, idx) => `
      <span class="ec-chip">
        ${esc(et.label)}<button class="ec-chip-x" data-comp="${comp.id}" data-idx="${idx}" aria-label="Remove ${esc(et.label)}">×</button>
      </span>`).join('');

    return `
<div class="ec-comp-row" data-comp-id="${comp.id}">
  <div class="ec-comp-header">
    <span class="ec-comp-label">Component ${index + 1}</span>
    ${canRemove
      ? `<button class="ec-comp-remove" data-comp-id="${comp.id}" aria-label="Remove component ${index + 1}">✕ Remove</button>`
      : ''}
  </div>
  <div class="ec-comp-fields">
    <div class="ec-comp-field">
      <label class="ec-comp-field-label">Event Type(s) <span class="ec-req">*</span></label>
      <div class="ec-et-wrap">
        <div class="ec-et-chips" id="ecETChips-${comp.id}">${chipsHTML}</div>
        <div id="ecET-${comp.id}"></div>
      </div>
    </div>
    <div class="ec-comp-field">
      <label class="ec-comp-field-label">Location <span class="ec-opt">(optional)</span></label>
      <div id="ecLoc-${comp.id}"></div>
    </div>
    <div class="ec-comp-field">
      <label class="ec-comp-field-label">City <span class="ec-req">*</span></label>
      <div id="ecCity-${comp.id}"></div>
    </div>
  </div>
</div>`;
  }

  // ── Dropdown mounting ──────────────────────────────────────────────────────

  function _mountEventDropdowns() {
    const gcEl = document.getElementById('ecGlobalCityDD');
    if (gcEl) {
      _globalCityDD = new TreeAutocomplete({
        container: gcEl,
        type: 'cities',
        placeholder: 'Search city…',
        onSelect: ({ id, label }) => {
          _globalCityVal = { id, label };
          _eventComps.forEach(c => {
            if (!c.city) {
              c.city = { id, label };
              _compDDs[c.id]?.city?.setValue(id, label);
            }
          });
          _updateEventPreview();
        }
      });
      if (_globalCityVal) _globalCityDD.setValue(_globalCityVal.id, _globalCityVal.label);
    }

    _eventComps.forEach(comp => _mountCompDDs(comp));
  }

  function _mountCompDDs(comp) {
    const row = {};

    const etEl = document.getElementById(`ecET-${comp.id}`);
    if (etEl) {
      const etDD = new TreeAutocomplete({
        container: etEl, type: 'event-types',
        placeholder: 'Search event type…',
        onSelect: (item) => {
          if (!item) return;
          const { id, label } = item;
          if (!comp.eventTypes.some(e => e.label === label)) {
            comp.eventTypes.push({ id, label });
            _refreshETChips(comp);
            _updateEventPreview();
          }
          etDD.clear();
        }
      });
      row.et = etDD;
      // Chip-x clicks handled by delegated listener on #ecBody — no per-chip wiring needed.
    }

    const locEl = document.getElementById(`ecLoc-${comp.id}`);
    if (locEl) {
      row.loc = new TreeAutocomplete({
        container: locEl, type: 'locations', placeholder: 'Location… (optional)',
        onSelect: ({ id, label }) => { comp.location = { id, label }; _updateEventPreview(); }
      });
      if (comp.location) row.loc.setValue(comp.location.id, comp.location.label);
    }

    const cityEl = document.getElementById(`ecCity-${comp.id}`);
    if (cityEl) {
      row.city = new TreeAutocomplete({
        container: cityEl, type: 'cities', placeholder: 'City…',
        onSelect: ({ id, label }) => { comp.city = { id, label }; _updateEventPreview(); }
      });
      if (comp.city) row.city.setValue(comp.city.id, comp.city.label);
    }

    _compDDs[comp.id] = row;
  }

  // ── Chip helpers ───────────────────────────────────────────────────────────

  function _refreshETChips(comp) {
    const el = document.getElementById(`ecETChips-${comp.id}`);
    if (!el) return;
    el.innerHTML = comp.eventTypes.map((et, idx) => `
      <span class="ec-chip">
        ${esc(et.label)}<button class="ec-chip-x" data-comp="${comp.id}" data-idx="${idx}" aria-label="Remove ${esc(et.label)}">×</button>
      </span>`).join('');
    // Chip-x clicks handled by delegated listener on #ecBody — no per-chip wiring needed.
  }

  // ── Listeners ──────────────────────────────────────────────────────────────
  // All form-area interactions are handled by THREE delegated listeners on
  // #ecBody (stable element, never replaced). _attachPanelDelegatedListeners()
  // is called from _renderEventForm() but is guarded by _listenersAttached so
  // the actual addEventListener calls run exactly once per session.

  function _onEvDateInput() {
    const errEl = document.getElementById('evHijriErr');
    if (errEl) errEl.classList.remove('visible');
    const y = document.getElementById('evHijriYear')?.value.trim()  || '';
    const m = document.getElementById('evHijriMonth')?.value.trim() || '';
    const d = document.getElementById('evHijriDay')?.value.trim()   || '';
    if (y && m && d && !validateHijriDate(y, m, d)) {
      _newEventDate = `${y}-${pad2(m)}-${pad2(d)}`;
    } else {
      _newEventDate = null;
    }
    _updateEventPreview();
  }

  function _attachPanelDelegatedListeners() {
    if (_listenersAttached) return;
    const body = $ecBody();
    if (!body) return;
    _listenersAttached = true;

    // ── Click delegation ────────────────────────────────────────────────────
    body.addEventListener('click', async e => {

      // #ecChangeCollection — go back to master step (dirty check for unsaved state)
      if (e.target.closest('#ecChangeCollection')) {
        if (_editMode || _repairMode || !_viewingExisting) {
          if (!window.confirm('You have unsaved changes. Discard them?')) return;
        }
        _scannedEvents    = null;
        _viewingExisting  = null;
        _editMode         = false;
        _repairMode       = false;
        _repairFolderName = null;
        setEventState([]);
        _newEventDate     = null;
        _destroyEventDDs();
        showMasterStep();
        return;
      }

      // #ecBackToList — return to event list, silent discard
      if (e.target.closest('#ecBackToList')) {
        _viewingExisting  = null;
        _editMode         = false;
        _repairMode       = false;
        _repairFolderName = null;
        _newEventDate     = null;
        setEventState([]);
        _destroyEventDDs();
        _renderEventList();
        return;
      }

      // #ecAddComp — add a new component row
      if (e.target.closest('#ecAddComp')) {
        _eventComps.push(_makeComp());
        _refreshCompList();
        _updateEventPreview();
        const last = _eventComps[_eventComps.length - 1];
        document.getElementById(`ecET-${last.id}`)?.querySelector('input')?.focus();
        return;
      }

      // #ecEventEdit — reload from disk into editable copy, then unlock
      if (e.target.closest('#ecEventEdit')) {
        const entry = (_scannedEvents || []).find(e => e.folderName === _viewingExisting?.folderName) || _viewingExisting;
        await openEventForEdit(entry);
        return;
      }

      // #ecEventContinue — Save / Select / Create (guarded against concurrent calls)
      if (e.target.closest('#ecEventContinue')) {
        if (_saveInProgress) return;
        const btn = document.getElementById('ecEventContinue');
        if (btn?.disabled) return;
        if (_viewingExisting && !_editMode) {
          const entry = (_scannedEvents || []).find(e => e.folderName === _viewingExisting.folderName) || _viewingExisting;
          const success = await _selectExistingForImport(entry);
          if (!success) {
            console.error('[Continue] Failed to select event');
            return;
          }
        } else if (_viewingExisting && _editMode) {
          _saveInProgress = true;
          if (btn) btn.disabled = true;
          try {
            await _handleSaveEditedEvent();
          } finally {
            _saveInProgress = false;
            // Re-enable only if save failed and we are still in edit mode.
            if (_editMode) { if (btn) btn.disabled = false; }
          }
        } else {
          _tryCreateEvent();
        }
        return;
      }

      // .ec-comp-remove — remove a component row
      const removeBtn = e.target.closest('.ec-comp-remove');
      if (removeBtn) {
        const id  = Number(removeBtn.dataset.compId);
        const row = _compDDs[id];
        row?.et?.destroy(); row?.loc?.destroy(); row?.city?.destroy();
        delete _compDDs[id];
        setEventState(_eventComps.filter(c => c.id !== id));
        _refreshCompList();
        _updateEventPreview();
        return;
      }

      // .ec-chip-x — remove an event-type chip
      const chipX = e.target.closest('.ec-chip-x');
      if (chipX) {
        const compId = Number(chipX.dataset.comp);
        const idx    = Number(chipX.dataset.idx);
        const comp   = _eventComps.find(c => c.id === compId);
        if (comp) {
          comp.eventTypes.splice(idx, 1);
          _refreshETChips(comp);
          _updateEventPreview();
        }
        return;
      }
    });

    // ── Input delegation (hijri date fields) ────────────────────────────────
    body.addEventListener('input', e => {
      const id = e.target.id;
      if (id === 'evHijriYear' || id === 'evHijriMonth' || id === 'evHijriDay') {
        numericOnly(e.target);
        if (id === 'evHijriYear'  && e.target.value.length === 4) document.getElementById('evHijriMonth')?.focus();
        if (id === 'evHijriMonth' && e.target.value.length === 2) document.getElementById('evHijriDay')?.focus();
        _onEvDateInput();
      }
    });

    // ── Keydown delegation (hijri date navigation) ───────────────────────────
    body.addEventListener('keydown', e => {
      const { id, value } = e.target;
      if (id === 'evHijriMonth' && e.key === 'Backspace' && value === '') {
        e.preventDefault(); document.getElementById('evHijriYear')?.focus();
      } else if (id === 'evHijriDay' && e.key === 'Backspace' && value === '') {
        e.preventDefault(); document.getElementById('evHijriMonth')?.focus();
      } else if (id === 'evHijriYear'  && e.key === 'Enter') {
        document.getElementById('evHijriMonth')?.focus();
      } else if (id === 'evHijriMonth' && e.key === 'Enter') {
        document.getElementById('evHijriDay')?.focus();
      } else if (id === 'evHijriDay'   && e.key === 'Enter') {
        document.getElementById('collLabel')?.focus();
      }
    });
  }

  function _refreshCompList() {
    const listEl = document.getElementById('ecCompList');
    if (!listEl) return;

    Object.keys(_compDDs).forEach(id => {
      const row = _compDDs[Number(id)];
      row?.et?.destroy(); row?.loc?.destroy(); row?.city?.destroy();
    });
    _compDDs = {};

    if (_eventComps.length === 0) {
      listEl.innerHTML = '<p class="ec-hint" style="padding:12px 0;margin:0">No components added yet.</p>';
      return;
    }

    listEl.innerHTML = _eventComps.map((c, i) => _buildCompRow(c, i)).join('');
    _eventComps.forEach(comp => _mountCompDDs(comp));
    // Remove-button clicks handled by delegated listener on #ecBody — no per-button wiring needed.
  }

  // ── Event name builder ─────────────────────────────────────────────────────

  // M7: compute the next sequence number for a given hijri date by scanning
  // both disk events (_scannedEvents) and in-session events (coll.events).
  function _computeNextSequence(hijriDate) {
    let maxSeq = 0;
    // Disk events (parsed by scanner).
    if (_scannedEvents) {
      for (const ev of _scannedEvents) {
        if (ev.isParseable && ev.hijriDate === hijriDate) {
          const n = parseInt(ev.sequence, 10);
          if (n > maxSeq) maxSeq = n;
        }
      }
    }
    // In-session events (not yet on disk, stored in coll.events[].name).
    const coll = sessionCollections.find(c => c.name === selectedCollection);
    if (coll) {
      for (const ev of coll.events) {
        const m = ev.name.match(/^(\d{4}-\d{2}-\d{2}) _(\d{2})-/);
        if (m && m[1] === hijriDate) {
          const n = parseInt(m[2], 10);
          if (n > maxSeq) maxSeq = n;
        }
      }
    }
    return String(maxSeq + 1).padStart(2, '0');
  }

  function _buildCompString(comps) {
    if (!Array.isArray(comps) || comps.length === 0) return '';

    const normalized = comps;
    if (!normalized.length) return '';

    const firstCity  = normalized[0]?.city?.label || '';
    const allSameCity = normalized.every(c => (c.city?.label || '') === firstCity);

    const parts = [];
    normalized.forEach(comp => {
      comp.eventTypes.forEach(et => { if (et.label) parts.push(et.label); });
      if (comp.location?.label) parts.push(comp.location.label);
      if (!allSameCity && comp.city?.label) parts.push(comp.city.label);
    });
    if (allSameCity && firstCity) parts.push(firstCity);

    const finalName = sanitizeEventName(parts.join('-'));
    console.log('FINAL EVENT NAME:', finalName);
    return finalName;
  }

  // ── Live preview + continue-button gate ────────────────────────────────────

  function _updateEventPreview() {
    const preview = document.getElementById('ecEventPreviewName');
    const card    = document.getElementById('ecEventPreviewCard');
    const btn     = document.getElementById('ecEventContinue');

    const coll  = sessionCollections.find(c => c.name === selectedCollection);
    // M7: for new events, use _newEventDate + auto-sequence from disk+session scan.
    // M6: for editing existing, use locked date+sequence from _viewingExisting.
    let eventDate, seq;
    if (_viewingExisting) {
      eventDate = _viewingExisting.hijriDate;
      seq       = _viewingExisting.sequence;
    } else if (_newEventDate) {
      eventDate = _newEventDate;
      seq       = _computeNextSequence(_newEventDate);
    } else {
      eventDate = coll?.hijriDate || '?';
      seq       = '??';
    }
    const parts = _buildCompString(_eventComps);
    const valid = _eventComps.length > 0 && _eventComps.every(c => c.eventTypes.length > 0 && c.city);
    const dateValid = _viewingExisting || !!_newEventDate;
    const name  = (parts && dateValid) ? `${eventDate} _${seq}-${parts}` : '';

    if (preview) {
      const displayName = name || '—';
      if (preview.textContent !== displayName) {
        preview.textContent = displayName;
        preview.classList.toggle('empty', !name);
        card?.classList.toggle('has-value', !!name);
      }
    }
    if (btn) btn.disabled = !(valid && dateValid);

    // Mirror to modal footer — Create / Save / Repair all share the same validity gate.
    const isValid  = valid && dateValid;
    const emmCreate = document.getElementById('emmCreateBtn');
    const emmSave   = document.getElementById('emmSaveBtn');
    const emmRepair = document.getElementById('emmRepairBtn');
    if (emmCreate) emmCreate.disabled = !isValid;
    if (emmSave)   emmSave.disabled   = !isValid;
    if (emmRepair) emmRepair.disabled = !isValid;
  }

  // ── Validate + create ──────────────────────────────────────────────────────

  async function _selectExistingForImport(entry) {
    if (!entry || !entry.folderName) {
      console.error('[_selectExistingForImport] CRITICAL: invalid entry', entry);
      return false;
    }

    const eventPath = activeMaster.path + '/' + entry.folderName;

    const components = await loadEventFromDisk(eventPath);
    if (!components) {
      console.error('[_selectExistingForImport] Failed to load components from', eventPath);
      return false;
    }

    setEventState(components);
    _compSeq = _eventComps.length;

    _viewingExisting = {
      folderName:   entry.folderName,
      displayName:  entry.displayName || entry._eventJson?.eventName || entry.folderName,
      hijriDate:    entry.hijriDate    || entry._eventJson?.hijriDate    || null,
      sequence:     entry.sequence     ?? entry._eventJson?.sequence     ?? null,
      isUnresolved: !!entry.isUnresolved,
      components:   _eventComps.map(c => ({ ...c, eventTypes: [...c.eventTypes] })),
    };

    if (!_viewingExisting.hijriDate || _viewingExisting.sequence == null) {
      console.error('[_selectExistingForImport] CRITICAL: identity incomplete after hydration', _viewingExisting);
      return false;
    }

    const coll = selectedCollection
      ? sessionCollections.find(c => c.name === selectedCollection)
      : null;
    if (coll) {
      const existingIdx = coll.events.findIndex(e => e.name === entry.folderName);
      if (existingIdx >= 0) {
        _activeEventIdx = existingIdx;
        coll.events[existingIdx].components = JSON.parse(JSON.stringify(_eventComps));
        if (!coll.events[existingIdx].displayName) {
          coll.events[existingIdx].displayName = _viewingExisting.displayName;
        }
      } else {
        coll.events.push({
          name:        entry.folderName,
          displayName: _viewingExisting.displayName,
          components:  JSON.parse(JSON.stringify(_eventComps)),
        });
        _activeEventIdx = coll.events.length - 1;
      }
    }

    console.log('[_selectExistingForImport] Loaded', _eventComps.length, 'components, dispatching done');
    console.log('[EVENT READY]', { date: _viewingExisting.hijriDate, sequence: _viewingExisting.sequence, components: _eventComps.length });
    document.dispatchEvent(new CustomEvent('eventcreator:done'));
    return true;
  }

  async function _tryCreateEvent() {
    if (_eventComps.length === 0) {
      _showEventBanner('Add at least one component.', 'error'); return;
    }
    const missing = _eventComps.find(c => c.eventTypes.length === 0 || !c.city);
    if (missing) {
      _showEventBanner('Every component needs at least one Event Type and a City.', 'error'); return;
    }

    const coll = sessionCollections.find(c => c.name === selectedCollection);
    if (!coll) { _showEventBanner('No collection selected — go back to Step 1.', 'error'); return; }

    // M7: validate event date.
    if (!_newEventDate) {
      _showEventBanner('Enter a valid Hijri date for this event.', 'error');
      document.getElementById('evHijriYear')?.focus();
      return;
    }

    // Validate and snapshot before write — blocks corrupted saves.
    console.log('WRITING EVENT JSON (_tryCreateEvent):', JSON.stringify(_eventComps, null, 2));
    try {
      assertStrictComponents(_eventComps);
    } catch (err) {
      console.error('BLOCKED CORRUPTED SAVE (_tryCreateEvent):', err);
      _showEventBanner('Internal error: component structure is invalid. Cannot create.', 'error');
      return;
    }
    const cleanComps = JSON.parse(JSON.stringify(_eventComps));

    const seq  = _computeNextSequence(_newEventDate);
    const parts = _buildCompString(cleanComps);
    const name  = `${_newEventDate} _${seq}-${parts}`;
    const safe  = sanitizeForPath(name);

    coll.events.push({ name: safe, displayName: name, components: JSON.parse(JSON.stringify(cleanComps)) });
    _activeEventIdx = coll.events.length - 1;

    // Persist event.json immediately (Patch 4: handles folder-exists-no-JSON case too).
    // writeEventJson: creates folder if absent, writes JSON if absent, returns existing
    // JSON unmodified if already present — so a duplicate create is always a safe no-op.
    if (activeMaster?.path) {
      const eventFolderPath = activeMaster.path + '/' + safe;

      // Component order here is the same order they appear in _eventComps (setEventState
      // always assigns ids 1…n in array order, so cleanComps is already position-ordered).
      // folderName is computed once at creation from this order and never recomputed.
      const allSameCity = cleanComps.length <= 1 ||
        cleanComps.every(c => c.city?.label === cleanComps[0].city?.label);
      const compsForDisk = cleanComps.map((c, idx) => ({
        types:        c.eventTypes.map(et => et.label),
        location:     c.location?.label || null,
        city:         c.city?.label     || '',
        isUnresolved: false,
        folderName:   buildFolderName(c, idx, allSameCity),
      }));

      window.api.writeEventJson(eventFolderPath, {
        version:       1,
        hijriDate:     _newEventDate,
        sequence:      parseInt(seq, 10),
        eventName:     name,
        safeEventName: safe,
        components:    compsForDisk,
        globalCity:    compsForDisk[0]?.city || '',
        status:        'created',
        createdAt:     Date.now(),
        updatedAt:     Date.now(),
      }).then(result => {
        if (result?.alreadyExisted) {
          console.log('[EventCreator] event.json already existed; kept existing record:', name);
        }
      }).catch(err => console.error('[EventCreator] writeEventJson failed:', err));

      // Create one subfolder per component — only for multi-component events.
      // Single-component events route files directly into the event folder.
      if (compsForDisk.length > 1) {
        try {
          const basePath = activeMaster.path + '/' + safe;

          // folderName was already computed and persisted into compsForDisk above.
          // Use those names directly so disk folders match event.json exactly.
          const tasks = compsForDisk.map(diskComp => {
            const fullPath = basePath + '/' + diskComp.folderName;
            return window.api.ensureDir(fullPath)
              .then(() => ({ ok: true, path: fullPath }))
              .catch(err => {
                console.error('[Subfolders] Failed for:', fullPath, err);
                return { ok: false, path: fullPath, error: err };
              });
          });
          const results = await Promise.all(tasks);

          const failed = results.filter(r => !r.ok);
          if (failed.length > 0) {
            console.warn('[Subfolders] Failed folders:', failed.map(f => f.path));
          } else {
            console.log('[Subfolders] All folders created successfully');
          }
          console.log('[Subfolders] Created', compsForDisk.length, 'component folders');
        } catch (err) {
          console.error('[Subfolders] Failed:', err);
        }
      }
    }

    setEventState([_makeComp()]);

    _proceedToPreviewStep();
  }

  // Phase 5: validate form, build a valid event name, rename the bad folder on disk,
  // update the cache, and return to the event list with the repaired entry pre-selected.
  async function _tryRepairEvent() {
    if (!_repairMode || !_repairFolderName) return;

    if (_eventComps.length === 0) {
      _showEventBanner('Add at least one component.', 'error'); return;
    }
    const missing = _eventComps.find(c => c.eventTypes.length === 0 || !c.city);
    if (missing) {
      _showEventBanner('Every component needs at least one Event Type and a City.', 'error'); return;
    }
    if (!_newEventDate) {
      _showEventBanner('Enter a valid Hijri date for this event.', 'error');
      document.getElementById('evHijriYear')?.focus();
      return;
    }

    // Validate and snapshot before write — blocks corrupted saves.
    console.log('WRITING EVENT JSON (_tryRepairEvent):', JSON.stringify(_eventComps, null, 2));
    try {
      assertStrictComponents(_eventComps);
    } catch (err) {
      console.error('BLOCKED CORRUPTED SAVE (_tryRepairEvent):', err);
      _showEventBanner('Internal error: component structure is invalid. Cannot repair.', 'error');
      return;
    }
    const cleanComps = JSON.parse(JSON.stringify(_eventComps));

    const seq         = _computeNextSequence(_newEventDate);
    const parts       = _buildCompString(cleanComps);
    const newName     = `${_newEventDate} _${seq}-${parts}`;
    const safeNewName = sanitizeForPath(newName);
    const oldName     = _repairFolderName;

    const result = await window.api.renameEvent(activeMaster.path, oldName, safeNewName);
    if (!result.ok) {
      _showEventBanner(result.reason || 'Rename failed.', 'error');
      return;
    }

    // Replace unparseable entry with a fully resolved one in the scan cache.
    const repairCompsForDisk = cleanComps.map(c => ({
      types:        c.eventTypes.map(et => et.label),
      location:     c.location?.label || null,
      city:         c.city?.label     || '',
      isUnresolved: false,
    }));
    if (_scannedEvents) {
      const idx = _scannedEvents.findIndex(e => e.folderName === oldName && !e.isParseable);
      if (idx >= 0) {
        _scannedEvents.splice(idx, 1, {
          folderName:   safeNewName,
          hijriDate:    _newEventDate,
          sequence:     seq,
          components:   repairCompsForDisk,
          isParseable:  true,
          isUnresolved: false,
          _eventJson:   { eventName: newName, safeEventName: safeNewName },
        });
      }
    }

    // Write event.json for the newly repaired event folder.
    if (activeMaster?.path) {
      const newEventPath = activeMaster.path + '/' + safeNewName;
      window.api.writeEventJson(newEventPath, {
        version:       1,
        hijriDate:     _newEventDate,
        sequence:      parseInt(seq, 10),
        eventName:     newName,
        safeEventName: safeNewName,
        components:    repairCompsForDisk,
        globalCity:    repairCompsForDisk[0]?.city || '',
        status:        'created',
        createdAt:     Date.now(),
        updatedAt:     Date.now(),
      }).catch(err => console.error('[EventCreator] writeEventJson (repair) failed:', err));
    }

    // Preselect the repaired event on return to list (use safe name for list lookup).
    _selectedListFolder = safeNewName;
    _repairMode         = false;
    _repairFolderName   = null;
    setEventState([]);
    _newEventDate       = null;
    _editMode           = false;
    _destroyEventDDs();

    if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen()) {
      EventMgmt.setMode('select');
      _renderEventList();
      document.dispatchEvent(new CustomEvent('eventcreator:listSelect'));
    } else {
      _renderEventList();
    }
  }

  function _showEventBanner(msg, type = 'error') {
    const el = document.getElementById('ecEventError');
    if (!el) return;
    el.textContent  = msg;
    el.dataset.type = type;
    el.classList.add('visible');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('visible'), 4500);
  }

  // ── Slide-transition helper ────────────────────────────────────────────────

  function _slideToStep(renderFn) {
    console.log('[EventCreator] STEP →', renderFn.name || '(anonymous)');
    const body = $ecBody();
    if (!body) { renderFn(); return; }
    body.style.cssText += ';opacity:0;transform:translateX(-14px);transition:opacity 0.18s ease,transform 0.18s ease';
    setTimeout(() => {
      try { renderFn(); } catch (e) { console.error('[EventCreator] step render error:', e); }
      body.style.cssText += ';opacity:0;transform:translateX(14px);transition:none';
      void body.offsetHeight;
      body.style.cssText += ';opacity:1;transform:translateX(0);transition:opacity 0.2s ease,transform 0.2s ease';
      setTimeout(() => { body.style.opacity = ''; body.style.transform = ''; body.style.transition = ''; }, 220);
    }, 185);
  }

  function proceedToEventStep()    { _slideToStep(showEventStep);   }

  function _proceedToPreviewStep() {
    // Persist active selection so startup can restore it next session.
    // Use activeMaster.path (full disk path) so verification doesn't depend on
    // the stored archiveRoot, which may differ from the actual parent folder.
    if (activeMaster && selectedCollection) {
      const coll = sessionCollections.find(c => c.name === selectedCollection);
      const evt  = coll?.events[_activeEventIdx] ?? coll?.events.at(-1);
      if (evt) {
        window.api.setLastEvent({
          collectionPath: activeMaster.path,
          collectionName: selectedCollection,
          eventName:      evt.displayName || evt.name,
          safeEventName:  evt.name,
        }).catch(() => {});
      }
    }
    // In modal mode: dispatch done and close instead of sliding to the preview step.
    if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen()) {
      document.dispatchEvent(new CustomEvent('eventcreator:done'));
      return;
    }
    _slideToStep(showPreviewStep);
  }


  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — Event Created (Commit E)
  // ══════════════════════════════════════════════════════════════════════════

  function _buildSubEventFolderNames(components) {
    // Prefer the persisted folderName (written at event creation, stable thereafter).
    // Fallback: compute from current metadata for legacy events that predate this field.
    // Note: the fallback always includes city, which may differ from the naming logic used
    // at creation (which conditionally omits city when all components share one). This is
    // acceptable for legacy events — no folder scanning or matching is attempted.
    const allSameCity = components.length <= 1 ||
      components.every(c => c.city?.label === components[0].city?.label);
    return components.map((comp, idx) => {
      if (comp.folderName != null) return comp.folderName;
      return buildFolderName(comp, idx, allSameCity);
    });
  }

  function _buildFolderTreeHTML(coll, event) {
    const isMulti = event.components.length > 1;
    const rows    = [];
    const r = (level, name, cls) =>
      `<div class="ft-row ft-l${level}">` +
      `<span class="ft-icon" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></span>` +
      `<span class="ft-name${cls ? ' ' + cls : ''}">${esc(name)}</span></div>`;

    rows.push(r(0, coll.name + '/'));
    rows.push(r(1, (event.displayName || event.name) + '/'));

    if (isMulti) {
      const subNames = _buildSubEventFolderNames(event.components);
      event.components.forEach((_, idx) => {
        rows.push(r(2, subNames[idx] + '/'));
        rows.push(r(3, '(photographer)/', 'ft-pending'));
        rows.push(r(4, 'VIDEO/'));
      });
    } else {
      rows.push(r(2, '(photographer)/', 'ft-pending'));
      rows.push(r(3, 'VIDEO/'));
    }
    return rows.join('');
  }

  function showPreviewStep() {
    currentStep = 3;
    _navScreen  = 'previewStep';
    const title = $ecTitle();
    if (title) title.textContent = 'Event Created';
    syncRailHighlight(3);

    const coll      = sessionCollections.find(c => c.name === selectedCollection);
    const lastEvent = coll?.events[_activeEventIdx] ?? coll?.events.at(-1);

    const body = $ecBody();
    if (!body) return;

    if (!coll || !lastEvent) {
      console.error('[EventCreator] showPreviewStep: missing coll or lastEvent',
        { selectedCollection, collFound: !!coll });
      showEventStep();
      return;
    }

    const isMulti   = lastEvent.components.length > 1;
    const modeLabel = isMulti ? 'Multi-component' : 'Single component';

    const eventRowInner = coll.events.length > 1
      ? `<select class="ec-bc-select" id="ecEventSelect">${
          coll.events.map((ev, i) =>
            `<option value="${i}"${i === _activeEventIdx ? ' selected' : ''}>${String(i + 1).padStart(2, '0')} — ${esc(ev.name)}</option>`
          ).join('')
        }</select>`
      : `<span class="ec-bc-value" title="${esc(lastEvent.name)}">${esc(lastEvent.name)}</span>`;

    body.innerHTML = `
<div class="ec-master-wrap">

  <div class="ec-breadcrumb-bar">
    <div class="ec-bc-row">
      <span class="ec-bc-label">Collection</span>
      <span class="ec-bc-value" title="${esc(coll.name)}">${esc(coll.name)}</span>
    </div>
    <div class="ec-bc-row">
      <span class="ec-bc-label">Event</span>
      ${eventRowInner}
      <button class="ec-bc-change" id="ecChangeEvent">Change</button>
    </div>
  </div>

  <div class="ec-preview-header">
    <span class="ec-mode-badge ${isMulti ? 'ec-mode-multi' : 'ec-mode-single'}">${esc(modeLabel)}</span>
    <span class="ec-preview-label">Folder structure</span>
  </div>

  <div class="ec-folder-tree">${_buildFolderTreeHTML(coll, lastEvent)}</div>

  <div class="ec-success-actions">
    <button id="ecAddAnotherBtn" class="ec-outline-btn">＋ Add Another Event</button>
    <button id="ecDoneBtn" class="ec-continue-btn">Done <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></button>
  </div>

</div>`;

    _destroyEventDDs();

    document.getElementById('ecEventSelect')?.addEventListener('change', e => {
      _activeEventIdx = parseInt(e.target.value, 10);
      showPreviewStep();
    });

    document.getElementById('ecChangeEvent')?.addEventListener('click', () => {
      const c = sessionCollections.find(x => x.name === selectedCollection);
      if (c && c.events.length > 0) {
        const idx     = Math.min(_activeEventIdx, c.events.length - 1);
        const [removed] = c.events.splice(idx, 1);
        setEventState(removed.components);
        _compSeq = _eventComps.length;
        assertValidComponents(_eventComps, 'ecChangeEvent');
        _activeEventIdx = Math.max(0, c.events.length - 1);
      }
      _slideToStep(showEventStep);
    });

    document.getElementById('ecAddAnotherBtn')?.addEventListener('click', () => {
      setEventState([_makeComp()]);
      _slideToStep(showEventStep);
    });

    document.getElementById('ecDoneBtn')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('eventcreator:done'));
    });
  }


  // ══════════════════════════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════════════════════════

  return {
    /** Enter the event creator panel. Always starts at step 1. Does NOT clear sessionArchiveRoot. */
    start() {
      selectedCollection  = null;
      activeMaster        = null;
      _scannedEvents      = null;
      _viewingExisting    = null;
      _editMode           = false;
      _newEventDate       = null;
      _selectedListFolder = null;
      _resetEventForm();
      showMasterStep();
    },

    /** Called on resetAppState — clears selection but keeps session collections and archive root. */
    resetSelection() {
      selectedCollection  = null;
      activeMaster        = null;
      _scannedEvents      = null;
      _viewingExisting    = null;
      _editMode           = false;
      _newEventDate       = null;
      _navScreen          = 'masterStep';
      _selectedListFolder = null;
    },

    /** Called by renderer's updateSteps() when railMode === 'event'. */
    syncRail() { syncRailHighlight(currentStep); },

    getSelectedCollection() { return selectedCollection; },
    getSessionCollections() { return sessionCollections; },

    /** Returns { name, path } for the active on-disk master folder, or null. */
    getActiveMaster()       { return activeMaster; },

    /** Returns the session-scoped archive root path, or null if not yet chosen. */
    getSessionArchiveRoot() { return sessionArchiveRoot; },

    /** Opens picker to change archive location; re-renders Step 1 if open. */
    changeArchiveLocation:  changeArchiveLocationInternal,

    /**
     * Called once by renderer.initApp() to prime sessionArchiveRoot from
     * persisted settings. Safe to call before any Step 1 render.
     * Silently ignored if settings.archiveRoot is null/unavailable.
     */
    async primeFromSettings() {
      try {
        const stored = await window.api.getArchiveRootSetting();
        if (stored && !sessionArchiveRoot) sessionArchiveRoot = stored;
      } catch (err) {
        console.error('[EventCreator] primeFromSettings failed:', err);
      }
    },

    /**
     * Restores the previously active event at startup. Reads all state from
     * disk — never reuses cached components or parser output.
     */
    async restoreLastEvent() {
      try {
        const last = await window.api.getLastEvent();

        if (!last || !last.collectionPath || !last.collectionName) {
          console.log('[restoreLastEvent] No previous event');
          return;
        }

        const valid = await window.api.verifyLastEvent(last.collectionPath);
        if (!valid) {
          window.api.setLastEvent(null).catch(() => {});
          return;
        }

        const safeName  = last.safeEventName || sanitizeForPath(last.eventName || '');
        const eventPath = last.collectionPath + '/' + safeName;

        console.log('[restoreLastEvent] path:', eventPath);
        if (!(await window.api.dirExists(eventPath))) {
          console.warn('[restoreLastEvent] stale path detected, clearing:', eventPath);
          window.api.setLastEvent(null).catch(() => {});
          return;
        }

        const components = await loadEventFromDisk(eventPath);

        if (!components) {
          console.error('[restoreLastEvent] Failed to load event');
          return;
        }

        // Read identity from disk — getLastEvent() doesn't persist hijriDate/sequence.
        let _restoredHijriDate = null, _restoredSequence = null;
        try {
          const ejson = await window.api.readEventJson(eventPath);
          if (ejson && ejson.hijriDate) {
            _restoredHijriDate = ejson.hijriDate;
            _restoredSequence  = ejson.sequence ?? null;
          }
        } catch {}

        // Restore session state so landing card and resetToList() work correctly.
        let coll = sessionCollections.find(c => c.name === last.collectionName);
        if (!coll) {
          coll = { name: last.collectionName, hijriDate: '', events: [], _masterPath: last.collectionPath };
          sessionCollections.push(coll);
        } else if (!coll._masterPath) {
          coll._masterPath = last.collectionPath;
        }

        activeMaster = { name: last.collectionName, path: last.collectionPath };

        const displayName = last.eventName || safeName;
        let eventIdx = coll.events.findIndex(e => e.name === safeName);
        if (eventIdx < 0) {
          coll.events.push({ name: safeName, displayName, components });
          eventIdx = coll.events.length - 1;
        } else {
          coll.events[eventIdx].components = components;
        }

        selectedCollection  = last.collectionName;
        _activeEventIdx     = eventIdx;
        _selectedListFolder = safeName;

        setEventState(components);
        _compSeq = components.length;

        _viewingExisting = {
          folderName:   safeName,
          displayName:  last.eventName || safeName,
          hijriDate:    _restoredHijriDate,
          sequence:     _restoredSequence,
          isUnresolved: false,
        };

        if (!Array.isArray(_eventComps) || _eventComps.length === 0) {
          console.warn('[restoreLastEvent] Empty components after restore');
        }

        console.log('[restoreLastEvent] Restored', components.length, 'components', {
          folderName: safeName,
          hijriDate:  _restoredHijriDate,
          sequence:   _restoredSequence,
          comps: components.map(c => ({ id: c.id, eventTypes: c.eventTypes.map(t => t.label), city: c.city?.label })),
        });
      } catch (err) {
        console.error('[restoreLastEvent] Error restoring event:', err);
      }
    },

    /**
     * Returns { coll, event, idx } for the most recently completed event,
     * or null if no event has been confirmed yet this session.
     */
    getActiveEventData() {
      if (!selectedCollection) return null;
      const coll = sessionCollections.find(c => c.name === selectedCollection);
      if (!coll || coll.events.length === 0) return null;
      const idx   = Math.min(_activeEventIdx, coll.events.length - 1);
      const event = coll.events[idx];
      if (!event) return null;
      return {
        coll,
        event,
        idx,
        collectionPath: coll._masterPath || null,
        eventPath: coll._masterPath ? (coll._masterPath + '/' + event.name) : null,
      };
    },

    /** Returns a snapshot of the current live components (_eventComps). */
    getEventComps() {
      return JSON.parse(JSON.stringify(_eventComps));
    },

    /** Repopulates _eventComps from an external snapshot (e.g. session store fallback). */
    setEventComps(comps) {
      if (Array.isArray(comps) && comps.length > 0) {
        setEventState(JSON.parse(JSON.stringify(comps)));
      }
    },

    setActiveEventIndex(idx) {
      _activeEventIdx = idx;
    },

    buildFolderPreviewHTML(coll, event) {
      return _buildFolderTreeHTML(coll, event);
    },

    /**
     * Returns sub-event descriptors for the active event's components.
     * Each entry: { id: string, name: string } where id === name (folder name).
     * Returns [] for single-component events or when no event is active.
     */
    getSubEventNames() {
      const data = this.getActiveEventData();
      if (!data || data.event.components.length <= 1) return [];
      return _buildSubEventFolderNames(data.event.components).map(name => ({ id: name, name }));
    },

    /** Resume at step 3 (for "Change" from landing page). */
    resume() { showPreviewStep(); },

    /**
     * Navigate to the event list in SELECT mode, preselecting the currently
     * active event. Used by "Change Event" so the user lands on the list
     * with their event highlighted — not on the form or preview.
     */
    resetToList() {
      // Resolve the active event folder name for preselection (fallback if not already set by restoreLastEvent).
      if (!_selectedListFolder) {
        const coll = selectedCollection
          ? sessionCollections.find(c => c.name === selectedCollection)
          : null;
        if (coll && coll.events.length > 0) {
          const idx = Math.min(_activeEventIdx, coll.events.length - 1);
          _selectedListFolder = coll.events[idx]?.name || null;
        }
      }

      // Clear any form / edit / repair state — returning to the list.
      _viewingExisting  = null;
      _editMode         = false;
      _repairMode       = false;
      _repairFolderName = null;
      setEventState([]);
      _newEventDate     = null;
      _destroyEventDDs();

      if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen()) EventMgmt.setMode('select');

      // No collection established — must go to master step to pick one.
      if (!selectedCollection) {
        console.log('[EventCreator] resetToList → no collection, going to master step');
        _slideToStep(showMasterStep);
        return;
      }

      // Reconstruct activeMaster from the collection's persisted path if it was lost
      // (e.g. app restart restores selectedCollection but not activeMaster).
      if (!activeMaster) {
        const coll = sessionCollections.find(c => c.name === selectedCollection);
        if (coll?._masterPath) {
          activeMaster = { name: selectedCollection, path: coll._masterPath };
          console.log('[EventCreator] resetToList → reconstructed activeMaster from _masterPath');
        }
      }

      console.log('[EventCreator] resetToList: collection=%s scannedEvents=%s activeMaster=%s selectedFolder=%s',
        selectedCollection,
        _scannedEvents ? `${_scannedEvents.length} events` : 'null',
        activeMaster ? activeMaster.path : 'null',
        _selectedListFolder);

      if (_scannedEvents !== null) {
        // Events already cached — go straight to the list.
        _slideToStep(_renderEventList);
      } else if (activeMaster) {
        // Need to scan — always render list afterward, never the create form.
        _slideToStep(() => {
          _renderEventListSpinner();
          _scanAndRenderEventList().catch(err => {
            console.error('[EventCreator] resetToList scan failed:', err);
            _scannedEvents = [];
            _renderEventList();
          });
        });
      } else {
        // Collection known but master path unavailable — must re-establish via Step 1.
        console.log('[EventCreator] resetToList → no activeMaster, going to master step');
        _slideToStep(showMasterStep);
      }
    },

    /**
     * Steps back one level within the event creator.
     * Returns true if navigation was handled internally; false if the caller
     * (renderer.js) should navigate away (e.g. showLanding()).
     */
    navigateBack() {
      switch (_navScreen) {
        case 'masterStep':
          return false;
        case 'eventList':
          _slideToStep(showMasterStep);
          return true;
        case 'eventForm':
          _viewingExisting  = null;
          _editMode         = false;
          _repairMode       = false;
          _repairFolderName = null;
          setEventState([]);
          _newEventDate     = null;
          _destroyEventDDs();
          _slideToStep(_renderEventList);
          return true;
        case 'previewStep':
          if (_viewingExisting) _slideToStep(_renderEventForm);
          else                  _slideToStep(_renderEventList);
          return true;
        default:
          return false;
      }
    },

    /** Phase 3 — Create Event footer button: validates and creates the event, then closes the modal. */
    tryCreateEvent() { _tryCreateEvent(); },

    /** Phase 4 — Save Changes footer button: validates, renames folder, then closes the modal. Returns Promise. */
    saveEditedEvent() { return _handleSaveEditedEvent(); },

    /** Phase 5 — Save & Repair footer button: validates, renames bad folder to valid name. Returns Promise. */
    tryRepairEvent() { return _tryRepairEvent(); },

    /**
     * Phase 2 — Continue from SELECT mode: adopt the highlighted event into the
     * session without going through preview, then dispatch eventcreator:done.
     */
    async adoptSelectedEvent() {
      if (!_selectedListFolder || !selectedCollection) return false;
      const entry = (_scannedEvents || []).find(e => e.folderName === _selectedListFolder);
      if (!entry) return false;

      // event.json is the ONLY source — no entry.components fallback.
      if (!activeMaster?.path) {
        console.error('[adoptSelectedEvent] No activeMaster path — cannot read event.json');
        return false;
      }
      const eventPath = activeMaster.path + '/' + entry.folderName;

      // ── Legacy check — must come before the corrupt/reload guard ────────────
      // A legacy event has no event.json on disk (_eventJson is null) or has a
      // JSON file that is missing the components array. This is a recoverable
      // state: the user should open Edit to configure it. Do NOT treat it as
      // corruption — the reload below would also return null and silently exit.
      const _isLegacyEntry = !entry._eventJson || !Array.isArray(entry._eventJson?.components) || entry._eventJson.components.length === 0;
      if (_isLegacyEntry) {
        console.warn('[LEGACY] Event has no valid event.json, redirecting to edit:', entry.folderName);
        if (_legacyModalOpen) return false;
        _legacyModalOpen = true;
        try {
          const action = await showLegacyEventWarningModal();
          if (action === 'edit') { await openEventForEdit(entry, { skipAutoRepair: true }); }
        } finally {
          _legacyModalOpen = false;
        }
        return false;
      }

      // ── Corrupt guard — stale/corrupt entries that have a valid _eventJson ─
      // Only reached when _eventJson exists and has a components array.
      // Attempts a fresh reload for entries repaired after the initial scan.
      if (entry._corrupt) {
        console.warn('[adoptSelectedEvent] corrupt entry, forcing reload:', entry.folderName);
        const comps = await loadEventFromDisk(eventPath);
        if (!comps) {
          console.error('[adoptSelectedEvent] Reload failed — cannot adopt:', entry.folderName);
          return false;
        }
        entry._eventJson = {
          hijriDate:  entry.hijriDate,
          sequence:   entry.sequence,
          components: comps,
        };
        entry._corrupt = false;
      }

      let json = null;
      try {
        json = await window.api.readEventJson(eventPath);
      } catch (err) {
        console.error('[adoptSelectedEvent] Failed to read event.json:', err);
      }
      if (!json || json._corrupt || !Array.isArray(json.components) || json.components.length === 0) {
        // Unexpected: the entry passed the legacy check (had valid _eventJson) but the
        // fresh disk read failed. Not a legacy event — treat as non-recoverable corruption.
        console.error('[adoptSelectedEvent] Fresh read invalid after legacy check passed:', eventPath);
        return false;
      }

      // json.components is DISK format ({ types, city, location } as strings).
      // setEventState expects UI format ({ eventTypes:[{label}], city:{label}, location:{label} }).
      // loadEventFromDisk performs the normalization — never pass json.components directly.
      const freshComponents = await loadEventFromDisk(eventPath);
      if (!freshComponents || freshComponents.length === 0) {
        console.error('[adoptSelectedEvent] loadEventFromDisk returned empty for', eventPath);
        return false;
      }

      _editMode = false;
      _newEventDate = null;
      setEventState(freshComponents);
      _compSeq = _eventComps.length;
      console.log('REHYDRATED COMPONENTS:', _eventComps.length);
      if (!Array.isArray(_eventComps) || _eventComps.length === 0) {
        console.error('INVALID STATE: components lost after rehydration');
      }
      assertValidComponents(_eventComps, 'adoptSelectedEvent');
      deepFreeze(_eventComps);
      _viewingExisting = {
        folderName:   entry.folderName,
        displayName:  json.eventName || entry.folderName,
        hijriDate:    entry.hijriDate,
        sequence:     entry.sequence,
        isUnresolved: entry.isUnresolved,
        components:   _eventComps.map(c => ({ ...c, eventTypes: [...c.eventTypes] })),
      };

      const coll = sessionCollections.find(c => c.name === selectedCollection);
      if (!coll) return false;
      const existingIdx = coll.events.findIndex(e => e.name === entry.folderName);
      if (existingIdx >= 0) {
        _activeEventIdx = existingIdx;
        // Always refresh components — the restored entry may carry disk-format components
        // from restoreLastEvent; _viewingExisting.components is always session format.
        coll.events[existingIdx].components = JSON.parse(JSON.stringify(_eventComps));
        if (!coll.events[existingIdx].displayName) {
          coll.events[existingIdx].displayName = _viewingExisting.displayName;
        }
      } else {
        coll.events.push({
          name:        entry.folderName,
          displayName: _viewingExisting.displayName,
          components:  JSON.parse(JSON.stringify(_eventComps)),
        });
        _activeEventIdx = coll.events.length - 1;
      }

      if (activeMaster) {
        const evt = coll.events[_activeEventIdx];
        if (evt) window.api.setLastEvent({
          collectionPath: activeMaster.path,
          collectionName: selectedCollection,
          eventName:      evt.displayName || evt.name,
          safeEventName:  evt.name,
        }).catch(() => {});
      }

      document.dispatchEvent(new CustomEvent('eventcreator:done'));
      return true;
    },

    /** Phase 2 — Edit from SELECT mode: open highlighted event directly in edit mode. */
    async editSelectedEvent() {
      if (!_selectedListFolder) return false;
      const entry = (_scannedEvents || []).find(e => e.folderName === _selectedListFolder) || { folderName: _selectedListFolder };
      await openEventForEdit(entry);
      return true;
    },

    /**
     * Navigate to the master-step (collection picker) from any screen.
     * Caller is responsible for the dirty-state confirm before calling this.
     */
    goToMasterStep() {
      _viewingExisting  = null;
      _editMode         = false;
      _repairMode       = false;
      _repairFolderName = null;
      _selectedListFolder = null;
      _scannedEvents    = null;
      setEventState([]);
      _newEventDate     = null;
      _destroyEventDDs();
      if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen()) EventMgmt.setMode('select');
      document.dispatchEvent(new CustomEvent('eventcreator:listDeselect'));
      _slideToStep(showMasterStep);
    },

    isDirty() {
      return _navScreen === 'eventForm' && (_editMode || _repairMode || !_viewingExisting);
    },

    getNavScreen() { return _navScreen; },
  };

})();
