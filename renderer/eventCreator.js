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
      eventTypes:         (c.types || c.eventTypes || []).map(t => ({ id: t, label: t })),
      location:           c.location ? { id: c.location, label: c.location } : null,
      city:               c.city     ? { id: c.city,     label: c.city     } : null,
      country:            c.country  || '',
      additionalKeywords: Array.isArray(c.additionalKeywords)
        ? c.additionalKeywords.map(kw =>
            typeof kw === 'string'
              ? { label: kw, keywordId: null, useInFolderName: false }
              : { label: kw.label || '', keywordId: kw.keywordId || null, useInFolderName: !!kw.useInFolderName, folderPlacement: kw.folderPlacement || null }
          )
        : [],
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
  // City included only when allSameCity is false. Index must not change after first write.
  // Folder-name keywords are interleaved within the event-tag section per folderPlacement.
  function buildFolderName(comp, idx, allSameCity) {
    const indexPart  = String(idx + 1).padStart(2, '0');
    const eventTypes = comp.eventTypes || [];
    const locationPart = comp.location?.label ? '-' + sanitizeForFolder(comp.location.label) : '';
    const cityPart     = (!allSameCity && comp.city?.label) ? '-' + sanitizeForFolder(comp.city.label) : '';

    const kwToFolder = (comp.additionalKeywords || []).filter(k => k && k.useInFolderName);

    if (kwToFolder.length === 0) {
      return `${indexPart}-${sanitizeForFolder(eventTypes.map(t => t.label).join('-'))}${locationPart}${cityPart}`;
    }

    const byMode = (k, mode, ai) => {
      const fp = k.folderPlacement;
      if (!fp) return mode === 'end-of-event-tags';
      return fp.mode === mode && (ai === undefined || fp.anchorIndex === ai);
    };
    const byOrder = (a, b) => (a.folderPlacement?.order || 0) - (b.folderPlacement?.order || 0);

    const tokens = [];
    const placed = new Set();
    for (let i = 0; i < eventTypes.length; i++) {
      kwToFolder.filter(k => byMode(k, 'before-event-tag', i)).sort(byOrder).forEach(k => { placed.add(k); tokens.push(k.label); });
      tokens.push(eventTypes[i].label);
      kwToFolder.filter(k => byMode(k, 'after-event-tag', i)).sort(byOrder).forEach(k => { placed.add(k); tokens.push(k.label); });
    }
    kwToFolder.filter(k => byMode(k, 'end-of-event-tags') || !placed.has(k)).sort(byOrder).forEach(k => tokens.push(k.label));

    return `${indexPart}-${sanitizeForFolder(tokens.join('-'))}${locationPart}${cityPart}`;
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
        country:    c.country || '',
        folderName: c.folderName ?? null,
        additionalKeywords: Array.isArray(c.additionalKeywords)
          ? c.additionalKeywords.map(kw =>
              typeof kw === 'string'
                ? { label: kw, keywordId: null, useInFolderName: false }
                : { label: kw.label || '', keywordId: kw.keywordId || null, useInFolderName: !!kw.useInFolderName, folderPlacement: kw.folderPlacement || null }
            )
          : [],
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
      country: c.country || '',
      // Preserve folderName threaded in by loadEventFromDisk.
      // Once set, folderName is never recomputed — it is the stable folder identity.
      folderName: c.folderName ?? null,
      additionalKeywords: Array.isArray(c.additionalKeywords) ? c.additionalKeywords : [],
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
  let   selectedCollection  = null; // string (folder name) or null
  let _offlineStagingMode   = false; // true when archive is offline and staging collections are shown
  let _effectiveStagingRoot = null;  // staging root to use for collection create/check when offline

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
  let _collectionCode  = '';    // optional Collection Code, persisted to event.json as collectionCode
  let _structureWarningPending = false; // prevents double-modal if save is triggered concurrently
  let _legacyModalOpen         = false; // prevents double-modal on fast double-click of Continue
  let _navScreen           = 'masterStep'; // 'masterStep' | 'eventList' | 'eventForm' | 'previewStep'
  let _selectedListFolder  = null;         // Phase 2: folder name highlighted in SELECT mode
  let _listenersAttached   = false;        // Guard: delegated panel listeners registered only once
  let _saveInProgress          = false;        // Guard: prevent concurrent save executions
  let _lastSaveWasMetaOutdated = false;        // Consumed once by renderer via consumeMetaOutdated()
  let _kwRegistry              = null;         // Cached keyword registry for Additional Keywords search
  let _kwRegistryPromise       = null;         // In-flight promise so we load at most once

  // ── Online Registry state (advisory — separate from filesystem truth) ───────
  let _activeTab       = 'current-device'; // 'current-device' | 'online-registry'
  let _registryEntries = [];               // advisory registry entries from realtime service
  let _registryLoading = false;

  function _makeComp() {
    return { id: ++_compSeq, eventTypes: [], location: null, city: _globalCityVal ? { ..._globalCityVal } : null, country: '', additionalKeywords: [] };
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

  function showStructureChangeWarningModal(diskInfo = null, opts = {}) {
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

    const bodyContent = opts.bodyHtml != null ? opts.bodyHtml
      : `<p>This event was originally a <strong>single-component event</strong>. Existing photos are stored directly in the event folder and will not be automatically reorganized into sub-events.</p>
    ${diskSummaryHtml}
    <p>New imports will follow the multi-component structure.</p>
    <p>You can reorganize existing photos manually if needed.</p>`;

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
    ${bodyContent}
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

    // Async: detect offline + scan staging root; re-renders when results arrive.
    _loadStagingCollectionsIfOffline().catch(err => {
      console.warn('[EventCreator] staging collection scan failed:', err);
    });
  }

  // Re-renders Step 1 in place — used after async staging scan completes.
  function _refreshMasterStep() {
    if (_navScreen !== 'masterStep') return;
    const body = $ecBody();
    if (!body) return;
    body.innerHTML = buildMasterHTML();
    attachMasterListeners();
  }

  // Checks archive status; if offline + staging available, scans staging root for
  // master collections and merges them into sessionCollections, then re-renders Step 1.
  async function _loadStagingCollectionsIfOffline() {
    let opsStatus;
    try { opsStatus = await window.api.getArchiveOperationsStatus(); } catch { return; }

    const isOffline   = opsStatus?.status === 'nas-disconnected' || opsStatus?.status === 'invalid-nas';
    const stagingRoot = opsStatus?.localStagingRoot;

    if (!isOffline || !stagingRoot) {
      if (_offlineStagingMode) {
        _offlineStagingMode   = false;
        _effectiveStagingRoot = null;
        _refreshMasterStep();
      }
      return;
    }

    const wasAlreadyOffline = _offlineStagingMode;
    _offlineStagingMode   = true;
    _effectiveStagingRoot = stagingRoot;

    let result;
    try { result = await window.api.scanStagingCollections(stagingRoot); } catch {
      if (!wasAlreadyOffline) _refreshMasterStep();
      return;
    }

    if (result?.ok && Array.isArray(result.collections)) {
      for (const sc of result.collections) {
        const existing = sessionCollections.find(c => c.name === sc.name);
        if (existing) {
          existing._linkStatus = sc.linkStatus || null;
          existing._linkData   = sc.linkData   || null;
        } else {
          sessionCollections.push({
            name: sc.name, hijriDate: '', label: '', events: sc.events || [],
            _masterPath: sc.path, _linkStatus: sc.linkStatus || null, _linkData: sc.linkData || null,
          });
        }
      }
    }

    _refreshMasterStep();
  }

  // Returns the effective on-disk path for the current collection.
  // While archive is offline, returns staging path (coll._masterPath).
  // activeMaster.path always holds the intended NAS archive path for setLastEvent/reconnect.
  function _effectiveCollPath() {
    if (_offlineStagingMode && selectedCollection) {
      const coll = sessionCollections.find(c => c.name === selectedCollection);
      if (coll?._masterPath) return coll._masterPath;
    }
    return activeMaster?.path || null;
  }

  // ── HTML builders ──────────────────────────────────────────────────────────

  function buildTabBarHTML() {
    const cdActive  = _activeTab === 'current-device';
    const orActive  = _activeTab === 'online-registry';
    return `
<div class="ec-tab-bar" role="tablist" aria-label="Event source">
  <button class="ec-tab${cdActive ? ' ec-tab--active' : ''}" data-tab="current-device" role="tab" aria-selected="${cdActive}" tabindex="${cdActive ? '0' : '-1'}">Current Device</button>
  <button class="ec-tab${orActive ? ' ec-tab--active' : ''}" data-tab="online-registry" role="tab" aria-selected="${orActive}" tabindex="${orActive ? '0' : '-1'}">Online Registry</button>
</div>`;
  }

  function buildMasterHTML() {
    const hasExisting = sessionCollections.length > 0;
    const formOpen    = !hasExisting;

    const offlineLabel = _offlineStagingMode ? 'Create New (Local Staging)' : (hasExisting ? 'Create New Collection' : 'New Collection');

    const currentDevicePanel = `
  ${_offlineStagingMode && !hasExisting ? `<p class="ec-subtext" style="margin-bottom:12px">Archive offline — no Local Staging collections found.</p>` : ''}
  ${hasExisting ? buildExistingCardsHTML() : ''}

  <!-- New collection expander ──────────────────────────────────────────── -->
  <button
    id="ecNewToggle"
    class="ec-new-toggle${formOpen ? ' open' : ''}"
    aria-expanded="${formOpen}"
    aria-controls="ecNewForm"
  >
    <span class="ec-new-plus" aria-hidden="true">＋</span>
    <span>${offlineLabel}</span>
    <span class="ec-new-arrow" aria-hidden="true"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
  </button>

  <!-- New collection form ─────────────────────────────────────────────── -->
  <div id="ecNewForm" class="ec-new-form${formOpen ? ' open' : ''}" role="region" aria-label="New collection form">
    ${buildNewFormHTML()}
  </div>

  <!-- Archive Root row (always shown) ────────────────────────────────── -->
  ${buildArchiveRootRowHTML()}

  <!-- Error banner ─────────────────────────────────────────────────────── -->
  <div id="ecMasterError" class="ec-master-error" role="alert" aria-live="polite"></div>

  <!-- Continue button ──────────────────────────────────────────────────── -->
  <button id="ecMasterContinue" class="ec-continue-btn" disabled>
    ${hasExisting ? 'Create & Continue →' : 'Create & Continue →'}
  </button>`;

    return `
<div class="ec-master-wrap">
${currentDevicePanel}
</div>`;
  }

  function buildArchiveRootRowHTML() {
    if (!sessionArchiveRoot) {
      return `
<div class="ec-location-display ec-location-no-root" id="ecLocationDisplay">
  <span class="ec-location-label">Archive Root</span>
  <span class="ec-location-path ec-location-unset">Not set — create a collection requires an Active Archive Root</span>
  <button class="ec-location-change-link" id="ecChangeLocation">Open Archive Locations</button>
</div>`;
    }
    const displayPath = sessionArchiveRoot.length > 55
      ? '…' + sessionArchiveRoot.slice(-52)
      : sessionArchiveRoot;
    const rootLabel = _offlineStagingMode ? 'Archive Root (offline)' : 'Archive Root';
    return `
<div class="ec-location-display" id="ecLocationDisplay">
  <span class="ec-location-label">${rootLabel}</span>
  <span class="ec-location-path" title="${esc(sessionArchiveRoot)}">${esc(displayPath)}</span>
  <button class="ec-location-change-link" id="ecChangeLocation">Change Archive Location</button>
</div>`;
  }

  // ── Online Registry HTML builders ──────────────────────────────────────────

  function buildOnlineRegistryHTML() {
    if (_registryLoading) {
      return `<div class="ec-reg-empty"><p class="ec-reg-empty-sub">Loading registry…</p></div>`;
    }

    const collEntries = _registryEntries.filter(e => e.entryType === 'collection');
    const evEntries   = _registryEntries.filter(e => e.entryType === 'event');

    if (collEntries.length === 0 && evEntries.length === 0) {
      return `
<div class="ec-reg-empty">
  <p class="ec-reg-empty-title">No registry entries</p>
  <p class="ec-reg-empty-sub">Collections and events published by other connected devices will appear here.</p>
</div>`;
    }

    const parts = [];
    if (collEntries.length > 0) {
      parts.push(`<p class="ec-section-title">Collections</p>`);
      parts.push(`<div class="ec-collection-cards">${collEntries.map(buildRegistryCardHTML).join('')}</div>`);
    }
    if (evEntries.length > 0) {
      parts.push(`<p class="ec-section-title"${collEntries.length > 0 ? ' style="margin-top:20px"' : ''}>Events</p>`);
      parts.push(`<div class="ec-collection-cards">${evEntries.map(buildRegistryCardHTML).join('')}</div>`);
    }
    return parts.join('\n');
  }

  function buildEventListRegistryHTML() {
    if (_registryLoading) {
      return `<div class="ec-reg-empty"><p class="ec-reg-empty-sub">Loading registry…</p></div>`;
    }

    const evEntries = _registryEntries.filter(e => e.entryType === 'event');

    if (evEntries.length === 0) {
      return `
<div class="ec-reg-empty">
  <p class="ec-reg-empty-title">No events in registry</p>
  <p class="ec-reg-empty-sub">Events created by other connected devices will appear here.</p>
</div>`;
    }

    const matching = selectedCollection
      ? evEntries.filter(e => e.collectionName === selectedCollection)
      : evEntries;
    const others   = selectedCollection
      ? evEntries.filter(e => e.collectionName !== selectedCollection)
      : [];

    const parts = [];
    if (matching.length > 0) {
      if (selectedCollection && others.length > 0) {
        parts.push(`<p class="ec-section-title">This collection</p>`);
      }
      parts.push(`<div class="ec-collection-cards">${matching.map(buildRegistryCardHTML).join('')}</div>`);
    }
    if (others.length > 0) {
      parts.push(`<p class="ec-section-title"${matching.length > 0 ? ' style="margin-top:20px"' : ''}>Other collections</p>`);
      parts.push(`<div class="ec-collection-cards">${others.map(buildRegistryCardHTML).join('')}</div>`);
    }
    return parts.join('\n');
  }

  function _getRegistryLocalStatus(entry) {
    if (entry.entryType === 'collection') {
      if (sessionCollections.some(c => c.name === entry.collectionName)) return 'ready';
    } else {
      const coll = sessionCollections.find(c => c.name === entry.collectionName);
      if (coll?.events?.some(ev => ev.name === entry.eventFolderName)) return 'ready';
    }
    return entry.nasCollectionPath ? 'available' : 'needs-setup';
  }

  function _getRegistryStatusPillHTML(status) {
    const map = {
      'available':   ['ec-reg-pill--available',   'Available'],
      'ready':       ['ec-reg-pill--ready',        'Ready'],
      'needs-setup': ['ec-reg-pill--needs-setup',  'Needs setup'],
      'issue':       ['ec-reg-pill--issue',        'Issue'],
    };
    const [cls, label] = map[status] || map['available'];
    return `<span class="ec-reg-pill ${cls}">${esc(label)}</span>`;
  }

  function _getRegistryOriginText(entry) {
    if (entry.origin === 'archive-available') return 'From archive';
    const name = entry.createdByDeviceName || entry.createdByDeviceId;
    return name ? `From ${esc(name)}` : 'From another device';
  }

  function buildRegistryCardHTML(entry) {
    const status    = _getRegistryLocalStatus(entry);
    const isEvent   = entry.entryType === 'event';
    const icon      = isEvent
      ? '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'
      : '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>';
    const nameText  = isEvent ? esc(entry.eventFolderName || '') : esc(entry.collectionName || '');
    const subText   = isEvent && entry.collectionName ? `<div class="ec-coll-subname">in ${esc(entry.collectionName)}</div>` : '';
    const typeLabel = isEvent ? 'Event' : 'Collection';
    const metaText  = `${typeLabel} · ${_getRegistryOriginText(entry)}`;
    const regId     = esc(entry.registryId);

    let actionHTML = '';
    if (status !== 'ready') {
      const act   = isEvent ? 'prepare-event' : 'prepare-collection';
      actionHTML  = `<div class="ec-coll-actions"><button class="ec-coll-action-btn ec-coll-action-btn--primary" data-reg-action="${act}" data-registry-id="${regId}">Prepare Locally</button></div>`;
    }

    return `
<div class="ec-reg-card" data-registry-id="${regId}" tabindex="0">
  <span class="ec-coll-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span>
  <div class="ec-coll-info">
    <div class="ec-coll-name">${nameText}</div>
    ${subText}
    <div class="ec-coll-card-footer">
      <span class="ec-coll-meta">${esc(metaText)}</span>
      ${_getRegistryStatusPillHTML(status)}
      ${actionHTML}
    </div>
  </div>
</div>`;
  }

  // ── Registry data loading + preparation ────────────────────────────────────

  function _refreshEventListRegistryPanel() {
    if (_navScreen !== 'eventList') return;
    const panel = document.querySelector('[data-panel="online-registry"]');
    if (!panel) return;
    panel.innerHTML = buildEventListRegistryHTML();
    _attachRegistryListeners();
  }

  async function _loadRegistryEntries() {
    if (!window.api.registryGetAll) return;
    _registryLoading = true;
    _refreshEventListRegistryPanel();
    try {
      const result = await window.api.registryGetAll();
      if (result?.ok && Array.isArray(result.entries)) {
        _registryEntries = result.entries;
      }
    } catch (err) {
      console.warn('[EventCreator] registry load failed:', err);
    } finally {
      _registryLoading = false;
    }
    _refreshEventListRegistryPanel();
  }

  function _attachRegistryListeners() {
    document.querySelectorAll('.ec-coll-action-btn[data-reg-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const regId  = btn.dataset.registryId;
        const action = btn.dataset.regAction;
        const entry  = _registryEntries.find(r => r.registryId === regId);
        if (!entry) return;
        if (action === 'prepare-collection') {
          _doPrepareCollFromRegistry(entry).catch(err => showBanner(err.message || 'Preparation failed.', 'error'));
        } else if (action === 'prepare-event') {
          _doPrepareEventFromRegistry(entry).catch(err => showBanner(err.message || 'Preparation failed.', 'error'));
        }
      });
    });
  }

  async function _doPrepareCollFromRegistry(entry) {
    if (!window.api.prepareCollectionFromRegistry) {
      showBanner('Collection preparation not available.', 'error');
      return;
    }
    const result = await window.api.prepareCollectionFromRegistry({ entry });
    if (!result?.ok) {
      showBanner(`Could not prepare collection: ${result?.reason || 'unknown error'}`, 'error');
      return;
    }
    if (!sessionCollections.find(c => c.name === entry.collectionName)) {
      sessionCollections.push({
        name: entry.collectionName, hijriDate: '', label: '', events: [],
        _masterPath: result.localCollectionPath,
        _linkStatus: entry.nasCollectionPath ? 'linked' : 'provisional',
        _linkData: null,
      });
    }
    _activeTab = 'current-device';
    _renderEventList();
    showBanner(`"${entry.collectionName}" is now available on this device.`, 'success');
  }

  async function _doPrepareEventFromRegistry(entry) {
    if (!window.api.prepareEventFromRegistry) {
      showBanner('Event preparation not available.', 'error');
      return;
    }
    const result = await window.api.prepareEventFromRegistry({ entry });
    if (!result?.ok) {
      const msg = result?.message || result?.reason || 'unknown error';
      showBanner(`Could not prepare event: ${msg}`, 'error');
      return;
    }
    let coll = sessionCollections.find(c => c.name === entry.collectionName);
    if (!coll) {
      coll = {
        name: entry.collectionName, hijriDate: '', label: '', events: [],
        _masterPath: result.localCollectionPath,
        _linkStatus: entry.nasCollectionPath ? 'linked' : 'provisional',
        _linkData: null,
      };
      sessionCollections.push(coll);
    }
    if (entry.eventFolderName && !coll.events.find(ev => ev.name === entry.eventFolderName)) {
      coll.events.push({ name: entry.eventFolderName });
    }
    _activeTab = 'current-device';
    _scannedEvents = null;
    showBanner(`Event is now available on this device.`, 'success');
    _scanAndRenderEventList().catch(err => {
      console.error('[EventCreator] rescan after prepare failed:', err);
      _scannedEvents = [];
      _renderEventList();
    });
  }

  function _getLinkBadgeHTML(linkStatus) {
    const map = {
      'linked':          ['ec-link-badge--linked',         'Linked'],
      'offline-ready':   ['ec-link-badge--offline-ready',  'Offline-ready'],
      'provisional':     ['ec-link-badge--provisional',    'Provisional · Needs archive match'],
      'stale-link':      ['ec-link-badge--stale-link',     'Stale link · Needs re-match'],
      'unlinked-legacy': ['ec-link-badge--unlinked-legacy','Unlinked · Verify link recommended'],
    };
    if (!linkStatus || !map[linkStatus]) return '';
    const [cls, label] = map[linkStatus];
    return `<span class="ec-link-badge ${cls}">${esc(label)}</span>`;
  }

  function _getCardActionHTML(c) {
    const status = c._linkStatus;
    if (!_offlineStagingMode && !status) return '';
    const actions = [];

    if (_offlineStagingMode) {
      if (status === 'provisional' || status === 'stale-link') {
        actions.push(`<button class="ec-coll-action-btn ec-coll-action-btn--primary" data-action="match-nas" data-name="${esc(c.name)}">Match to NAS</button>`);
      }
    } else {
      if (!status || status === 'unlinked-legacy') {
        actions.push(`<button class="ec-coll-action-btn ec-coll-action-btn--primary" data-action="prepare-offline" data-name="${esc(c.name)}">Prepare Offline</button>`);
      } else if (status === 'stale-link') {
        actions.push(`<button class="ec-coll-action-btn ec-coll-action-btn--primary" data-action="prepare-offline" data-name="${esc(c.name)}">Re-link</button>`);
      }
    }

    return actions.length ? `<div class="ec-coll-actions">${actions.join('')}</div>` : '';
  }

  function buildExistingCardsHTML() {
    const sectionTitle = _offlineStagingMode ? 'Local Staging Collections' : 'Existing Collections';
    return `
<p class="ec-section-title">${sectionTitle}</p>
${_offlineStagingMode ? '<p class="ec-subtext">Archive offline — showing collections from Local Staging</p>' : ''}
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
      <div class="ec-coll-card-footer">
        <span class="ec-coll-meta">${esc(c.events.length)} event${c.events.length === 1 ? '' : 's'}</span>
        ${_getLinkBadgeHTML(c._linkStatus)}
        ${_getCardActionHTML(c)}
      </div>
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

    // Collection action buttons (Prepare Offline / Match to NAS / Re-link)
    document.querySelectorAll('.ec-coll-action-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation(); // do not select the card
        const name   = btn.dataset.name;
        const action = btn.dataset.action;
        if (action === 'prepare-offline') {
          _doPrepareOffline(name).catch(err => showBanner(err.message || 'Prepare Offline failed.', 'error'));
        } else if (action === 'match-nas') {
          _doMatchToNas(name).catch(err => showBanner(err.message || 'Match to NAS failed.', 'error'));
        }
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

    document.getElementById('ecChangeLocation')
      ?.addEventListener('click', () => changeArchiveLocationInternal());
  }

  function _fireTryCreate() {
    tryCreateCollection().catch(err => showBanner(err.message, 'error'));
  }

  async function _doPrepareOffline(collectionName) {
    const coll = sessionCollections.find(c => c.name === collectionName);
    if (!coll) return;
    const nasCollectionPath = coll._masterPath;
    if (!nasCollectionPath) {
      showBanner('Cannot prepare offline — no NAS path found for this collection.', 'error');
      return;
    }
    const result = await window.api.prepareOffline({ nasCollectionPath, collectionName });
    if (!result?.ok) {
      showBanner(`Prepare Offline failed: ${result?.reason || 'unknown error'}`, 'error');
      return;
    }
    coll._linkStatus = 'linked';
    _refreshMasterStep();
    showBanner(`"${collectionName}" is now prepared for offline use.`, 'success');
  }

  async function _doMatchToNas(collectionName) {
    const coll = sessionCollections.find(c => c.name === collectionName);
    if (!coll) return;

    // Let the user pick the NAS collection folder via system dialog
    const picked = await window.api.chooseExistingMaster(sessionArchiveRoot || undefined);
    if (!picked?.path) return; // user cancelled

    const localCollectionPath = coll._masterPath;
    if (!localCollectionPath) {
      showBanner('Cannot match — no local staging path found for this collection.', 'error');
      return;
    }

    const result = await window.api.matchCollectionToNas({
      localCollectionPath,
      nasCollectionPath: picked.path,
    });
    if (!result?.ok) {
      showBanner(`Match to NAS failed: ${result?.reason || 'unknown error'}`, 'error');
      return;
    }
    coll._linkStatus = 'linked';
    _refreshMasterStep();
    showBanner(`"${collectionName}" is now linked to the selected NAS collection.`, 'success');
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
      // activeMaster.path always holds the intended archive path for setLastEvent/reconnect.
      // Effective disk I/O uses _effectiveCollPath() which returns coll._masterPath when offline.
      const archivePath = (_offlineStagingMode && sessionArchiveRoot)
        ? sessionArchiveRoot + '/' + name
        : coll._masterPath;
      activeMaster = { name, path: archivePath };
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

    // When offline, create under Local Staging Root; otherwise require Active Archive Root.
    const effectiveRoot = (_offlineStagingMode && _effectiveStagingRoot) ? _effectiveStagingRoot : sessionArchiveRoot;
    if (!effectiveRoot) {
      showBanner('Set an Active Archive Root in Archive Locations before creating a collection.', 'error');
      document.dispatchEvent(new CustomEvent('eventcreator:openArchiveLocations'));
      return;
    }

    // Disk is the source of truth — always check existence regardless of
    // whether the name appears in sessionCollections. This makes in-session
    // duplicates, prior-session duplicates, and externally-created folders
    // all trigger the same modal flow.
    const { exists, fullPath } = await window.api.checkMasterExists(effectiveRoot, name);
    let masterPath;

    if (exists) {
      const useIt = await showMasterExistsModal(name);
      if (!useIt) return; // user chose No → stay on Step 1
      masterPath = fullPath;
    } else {
      // Advisory: check remote-visible collection names before creating locally.
      // Non-blocking — failure to check never prevents creation.
      if (window.api.getRealtimeKnownNames && typeof checkRealtimeNameConflict === 'function') {
        try {
          await window.api.getRealtimeKnownNames().then(rtNames => {
            if (rtNames?.collections?.includes(name)) {
              window._rtConflictHint = `"${name}" is already visible from another device. Continue creating it locally?`;
            } else {
              window._rtConflictHint = null;
            }
          });
        } catch { window._rtConflictHint = null; }
        if (window._rtConflictHint) {
          const proceed = window.confirm(`Advisory: ${window._rtConflictHint}\n\nThis does not block creation — it is only a visibility notice.`);
          window._rtConflictHint = null;
          if (!proceed) return;
        }
      }
      const created = await window.api.createMaster(effectiveRoot, name);
      masterPath = created.path;

      // When creating offline (in staging root), write a provisional link so
      // the sync layer knows this collection has no NAS link yet.
      if (_offlineStagingMode && window.api.writeProvisionalLink) {
        window.api.writeProvisionalLink({ localCollectionPath: masterPath, collectionName: name })
          .catch(err => console.warn('[EventCreator] provisional link write failed:', err));
      }
    }

    // Register in session state — update existing entry if present, else push
    let collection = sessionCollections.find(c => c.name === name);
    if (collection) {
      collection._masterPath  = masterPath;
      if (_offlineStagingMode) collection._linkStatus = 'provisional';
    } else {
      collection = {
        name, hijriDate, label: l, events: [], _masterPath: masterPath,
        _linkStatus: _offlineStagingMode ? 'provisional' : null, _linkData: null,
      };
      sessionCollections.push(collection);
    }
    selectedCollection = name;
    // When offline, activeMaster.path stays the NAS path so _tryCreateEvent triggers the
    // NAS-fail → staging-fallback path, and setLastEvent stores the archive path for reconnect.
    activeMaster = {
      name,
      path: (_offlineStagingMode && sessionArchiveRoot) ? (sessionArchiveRoot + '/' + name) : masterPath,
    };

    proceedToEventStep();
  }

  // ── Change archive location ────────────────────────────────────────────────

  function changeArchiveLocationInternal() {
    document.dispatchEvent(new CustomEvent('eventcreator:openArchiveLocations'));
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
    const _scanPath = _effectiveCollPath() || activeMaster?.path;
    _scannedEvents = await window.api.scanMasterEvents(_scanPath);
    if (!_scannedEvents) _scannedEvents = [];

    // When archive is online, augment the list with Local Staging events that are
    // pending sync. These events were created while offline and exist only in Local
    // Staging — the archive scan above will not find them.
    if (!_offlineStagingMode && selectedCollection) {
      try {
        const queueData = await window.api.getSyncQueue();
        const pending = (queueData?.jobs || []).filter(
          j => j.collection === selectedCollection && j.status !== 'synced' && j.localEventPath
        );
        if (pending.length > 0) {
          const archiveNames = new Set(_scannedEvents.map(e => e.folderName));
          for (const job of pending) {
            if (archiveNames.has(job.event)) continue; // already in archive (shouldn't happen for non-synced, but guard anyway)
            const m = job.event.match(/^(\d{4}-\d{2}-\d{2}) _(\d{2})-/);
            _scannedEvents.push({
              folderName:      job.event,
              hijriDate:       m ? m[1] : '',
              sequence:        m ? m[2] : '00',
              components:      [],
              isFromJson:      false,
              isParseable:     true,
              isUnresolved:    false,
              isLegacy:        false,
              isCorrupt:       false,
              isPendingSync:   true,
              _localEventPath: job.localEventPath,
              _eventJson:      null,
            });
          }
          // Re-sort parseable entries newest-first; unparseable stay at the end.
          const parseable   = _scannedEvents.filter(e => e.isParseable);
          const unparseable = _scannedEvents.filter(e => !e.isParseable);
          parseable.sort((a, b) => {
            if (a.hijriDate !== b.hijriDate) return b.hijriDate.localeCompare(a.hijriDate);
            return b.sequence.localeCompare(a.sequence);
          });
          _scannedEvents = [...parseable, ...unparseable];
        }
      } catch (err) {
        console.warn('[_scanAndRenderEventList] pending-sync augment failed:', err);
      }
    }

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
      const isLegacy = ev.isLegacy === true;
      const warnBadge = ev.isUnresolved
        ? `<span class="ec-evl-warn" title="Some tokens in this event don't match the controlled lists yet. You can still view or edit."><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>`
        : '';
      const legacyBadge = isLegacy
        ? `<span class="ec-evl-badge--legacy">LEGACY</span>`
        : '';
      const pendingBadge = ev.isPendingSync
        ? `<span class="ec-evl-badge--pending" title="Created while archive was offline — waiting to sync to archive">Pending sync</span>`
        : '';
      const displayName = ev._eventJson?.eventName || ev.folderName;
      return `
<div class="ec-evl-item" data-folder="${esc(ev.folderName)}" tabindex="0" role="option" aria-selected="false">
  <div class="ec-evl-meta">
    <div class="ec-evl-name" title="${esc(displayName)}">${esc(displayName)}</div>
    <div class="ec-evl-date">${esc(ev.hijriDate)}</div>
  </div>
  ${legacyBadge}${warnBadge}${pendingBadge}
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

  ${buildTabBarHTML()}

  <div class="ec-tab-panel" data-panel="current-device"${_activeTab !== 'current-device' ? ' hidden' : ''}>
    <p class="ec-section-title">Existing Events <span class="ec-hint" style="font-weight:normal">(${resolved.length})</span></p>
    ${resolved.length > 0 ? '<input type="search" id="ecEvlSearch" class="ec-evl-search" placeholder="Search events…" autocomplete="off">' : ''}
    <div class="ec-evl-list" id="ecEvlList" role="listbox" aria-label="Events">
      ${resolvedHTML || '<p class="ec-hint">No resolvable events yet.</p>'}
    </div>
    ${unparseableHTML}
  </div>

  <div class="ec-tab-panel" data-panel="online-registry"${_activeTab !== 'online-registry' ? ' hidden' : ''}>
    ${buildEventListRegistryHTML()}
  </div>

</div>`;

    // Scroll reset so the list always starts at the top.
    body.scrollTop = 0;

    // Tab switching for event-list screen.
    document.querySelectorAll('.ec-tab[data-tab]').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        const tab = tabBtn.dataset.tab;
        if (_activeTab === tab) return;
        _activeTab = tab;
        document.querySelectorAll('.ec-tab[data-tab]').forEach(t => {
          const active = t.dataset.tab === tab;
          t.classList.toggle('ec-tab--active', active);
          t.setAttribute('aria-selected', String(active));
          t.setAttribute('tabindex', active ? '0' : '-1');
        });
        document.querySelectorAll('[data-panel]').forEach(p => {
          p.hidden = (p.dataset.panel !== tab);
        });
        if (tab === 'online-registry') {
          _registryLoading = true;
          _refreshEventListRegistryPanel();
          _loadRegistryEntries().catch(() => {});
        }
      });
    });

    // Registry action buttons (Prepare Locally) in Online Registry panel.
    _attachRegistryListeners();

    // Collection bar: Change → go back to master step.
    document.getElementById('ecChangeCollection')?.addEventListener('click', () => {
      _scannedEvents = null;
      _viewingExisting = null;
      _selectedListFolder = null;
      _activeTab = 'current-device';
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

    if (!activeMaster?.path && !_effectiveCollPath()) {
      console.error('[_openExistingEvent] No activeMaster path');
      return;
    }

    const eventPath = (_effectiveCollPath() || activeMaster.path) + '/' + entry.folderName;

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
      folderName:         entry.folderName,
      displayName:        entry._eventJson?.eventName || entry.folderName,
      hijriDate:          entry.hijriDate    || entry._eventJson?.hijriDate    || null,
      sequence:           entry.sequence     ?? entry._eventJson?.sequence     ?? null,
      isUnresolved:       !!entry.isUnresolved,
      isOfflineLocalCopy: _offlineStagingMode,
    };

    _renderEventForm();
  }

  async function openEventForEdit(entry, { skipAutoRepair = false } = {}) {
    const eventPath = (_effectiveCollPath() || activeMaster?.path) + '/' + entry.folderName;

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
      country:    c.country || '',
      additionalKeywords: Array.isArray(c.additionalKeywords) ? c.additionalKeywords : [],
    }));

    setEventState(editable);

    _compSeq = editable.length;

    _viewingExisting = {
      folderName:   entry.folderName,
      displayName:  entry._eventJson?.eventName || entry.folderName,
      hijriDate:    entry.hijriDate    || entry._eventJson?.hijriDate    || null,
      sequence:     entry.sequence     ?? entry._eventJson?.sequence     ?? null,
      isUnresolved: !!entry.isUnresolved,
      components:   editable.map(c => ({ ...c, eventTypes: [...c.eventTypes] })),
      adoption:     entry._eventJson?.adoption ?? null,
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
    // Transition EventMgmt out of SELECT mode so _renderEventForm's SELECT guard
    // does not block navigation. Same pattern as the legacy skipAutoRepair path above.
    if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen()) EventMgmt.setMode('edit');

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
    // Default to today's Hijri date on first render; preserve user-entered value on return.
    if (!_viewingExisting) {
      if (!_newEventDate) {
        window.api.getTodayDate().then(today => {
          if (_newEventDate) return; // Already set by another render or user input — don't clobber.
          const { year, month, day } = today.hijri;
          _newEventDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const yEl = document.getElementById('evHijriYear');
          const mEl = document.getElementById('evHijriMonth');
          const dEl = document.getElementById('evHijriDay');
          if (yEl && !yEl.value) yEl.value = String(year);
          if (mEl && !mEl.value) mEl.value = String(month).padStart(2, '0');
          if (dEl && !dEl.value) dEl.value = String(day).padStart(2, '0');
          _updateEventPreview();
        }).catch(() => {});
      } else {
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
      row.country?.setDisabled(locked);
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

  // Returns true if any metadata-written fields (eventTypes, location, city) differ between snapshots.
  function _metaFieldsChanged(oldComps, newComps) {
    if (!Array.isArray(oldComps) || oldComps.length !== newComps.length) return true;
    for (let i = 0; i < oldComps.length; i++) {
      const o = oldComps[i];
      const n = newComps[i];
      const oTypes = (o.eventTypes || []).map(t => t.label).sort().join('|');
      const nTypes = (n.eventTypes || []).map(t => t.label).sort().join('|');
      if (oTypes !== nTypes) return true;
      if ((o.location?.label ?? null) !== (n.location?.label ?? null)) return true;
      if ((o.city?.label ?? null) !== (n.city?.label ?? null)) return true;
    }
    return false;
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
        const _effPath = _effectiveCollPath() || activeMaster?.path;
        if (_effPath && oldName) {
          _diskChecked = true;
          const _eventDiskPath = _effPath + '/' + oldName;
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
      // Adopted pre-completion: event.json had adoption block and originally had 0 components.
      // Going 0→multi always warrants a warning — no existing-data check needed.
      const _wasAdoptedPreCompletion = !!_viewingExisting?.adoption &&
        (_viewingExisting?.components || []).length === 0;
      if (_wasAdoptedPreCompletion && _isNowMulti && !_structureWarningPending) {
        _structureWarningPending = true;
        try {
          const proceed = await showStructureChangeWarningModal(null, {
            bodyHtml: `<p>This is an <strong>adopted event</strong> with no previously defined components.</p>
    <p>Saving with ${_eventComps.length} components will define it as a <strong>multi-component event</strong>.</p>
    <p>Existing folders in this event will not be reorganized automatically. Review routing before importing.</p>`,
          });
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
        id:                 c.id,
        types:              c.eventTypes.map(et => et.label),
        location:           c.location?.label || null,
        city:               c.city?.label     || '',
        country:            c.country         || null,
        additionalKeywords: Array.isArray(c.additionalKeywords) && c.additionalKeywords.length ? c.additionalKeywords : undefined,
        isUnresolved:       false,
        folderName:         c.folderName ?? buildFolderName(c, idx, _noRenameAllSameCity),
      }));
      const _noRenameEffPath = _effectiveCollPath() || activeMaster?.path;
      if (_noRenameEffPath) {
        const noRenamePath = _noRenameEffPath + '/' + oldName;
        const noRenamePayload = {
          eventName:     newName,
          safeEventName: safeNewName,
          hijriDate:     _viewingExisting.hijriDate,
          sequence:      _viewingExisting.sequence,
          components:    noRenameCompsForDisk,
          status:        'created',
          ...(_viewingExisting.adoption != null ? { adoption: _viewingExisting.adoption } : {}),
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
        // Flag outdated if metadata-relevant fields changed and the event has import history.
        const _noRenameImports = (_cachedEntry?._eventJson?.imports || []).length > 0;
        if (_noRenameImports && _metaFieldsChanged(_viewingExisting?.components, _eventComps)) {
          _lastSaveWasMetaOutdated = true;
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
    const _renameEffPath = _effectiveCollPath() || activeMaster?.path;
    const result = await window.api.renameEvent(_renameEffPath, oldName, safeNewName);
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
      id:                 c.id,
      types:              c.eventTypes.map(et => et.label),
      location:           c.location?.label || null,
      city:               c.city?.label     || '',
      country:            c.country         || null,
      additionalKeywords: Array.isArray(c.additionalKeywords) && c.additionalKeywords.length ? c.additionalKeywords : undefined,
      isUnresolved:       false,
      // Preserve existing folderName (set once at creation — never recompute).
      folderName:         c.folderName ?? buildFolderName(c, idx, _renameAllSameCity),
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
    const _newEvEffPath = _effectiveCollPath() || activeMaster?.path;
    if (_newEvEffPath) {
      const newEventPath = _newEvEffPath + '/' + safeNewName;
      const renamePayload = {
        eventName:     newName,
        safeEventName: safeNewName,
        hijriDate:     _viewingExisting.hijriDate,
        sequence:      _viewingExisting.sequence,
        components:    compsForDisk,
        status:        'created',
        ...(_viewingExisting.adoption != null ? { adoption: _viewingExisting.adoption } : {}),
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

    // Flag outdated if metadata-relevant fields changed and the event has import history.
    {
      const _renameImports = (entry?._eventJson?.imports || []).length > 0;
      if (_renameImports && _metaFieldsChanged(_viewingExisting?.components, _eventComps)) {
        _lastSaveWasMetaOutdated = true;
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

  <!-- Optional Collection Code -->
  <div class="ec-field" style="margin-top:16px">
    <p class="ec-section-title">Collection Code <span style="font-size:0.75rem;font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-muted)">— optional</span></p>
    <input id="evCollectionCode" type="text"
           value="${esc(_viewingExisting?.collectionCode || _viewingExisting?.eventId || _collectionCode || '')}"
           ${_viewingExisting && !_editMode ? 'disabled style="opacity:0.6"' : ''}
           placeholder="Optional archive collection reference"
           aria-label="Collection Code"
           autocomplete="off" maxlength="128">
    <span class="ec-hint">Optional archive collection reference. Leave blank if not yet assigned.</span>
  </div>

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
    const canRemove  = _eventComps.length > 1;
    const chipsHTML  = comp.eventTypes.map((et, idx) => `
      <span class="ec-chip">
        ${esc(et.label)}<button class="ec-chip-x" data-comp="${comp.id}" data-idx="${idx}" aria-label="Remove ${esc(et.label)}">×</button>
      </span>`).join('');

    return `
<div class="ec-comp-row" data-comp-id="${comp.id}">
  <div class="ec-comp-header">
    <span class="ec-drag-handle" title="Drag to reorder" aria-hidden="true">⠿</span>
    <span class="ec-comp-label">Component ${index + 1}</span>
    ${canRemove
      ? `<button type="button" class="ec-comp-remove" data-comp-id="${comp.id}" aria-label="Remove component ${index + 1}">✕ Remove</button>`
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
      <label class="ec-comp-field-label">Additional Keywords <span class="ec-opt">(metadata only)</span></label>
      <div class="ec-kw-wrap">
        <div class="ec-kw-chips" id="ecKwChips-${comp.id}">${(comp.additionalKeywords || []).map((kw, ki) => {
          const label = kw.label || '';
          const ro = _viewingExisting && !_editMode;
          return `<span class="ec-chip ec-kw-chip">` +
            `<span class="ec-chip-label">${esc(label)}</span>` +
            `<button type="button" class="ec-kw-chip-x" data-comp="${comp.id}" data-idx="${ki}" aria-label="Remove ${esc(label)}"${ro ? ' disabled' : ''}>×</button>` +
            `</span>`;
        }).join('')}</div>
        ${!(_viewingExisting && !_editMode) ? `<div class="ec-kw-add-row"><div class="ec-kw-search-wrap" data-comp-id="${comp.id}"><input type="text" id="ecKwInput-${comp.id}" class="ec-kw-input" placeholder="Search keyword registry…" autocomplete="off" maxlength="80" aria-label="Search keyword registry" aria-autocomplete="list" aria-controls="ecKwDD-${comp.id}" aria-expanded="false"><div class="ec-kw-dropdown" id="ecKwDD-${comp.id}" hidden role="listbox"></div></div></div>` : ''}
        <div class="ec-kw-free-error" id="ecKwFreeErr-${comp.id}" hidden aria-live="polite">Select a keyword from the registry. To add a new keyword, update the Keyword Registry first.</div>
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
    <div class="ec-comp-field">
      <label class="ec-comp-field-label">Country <span class="ec-opt">(metadata only)</span></label>
      <div id="ecCountry-${comp.id}"></div>
    </div>
  </div>
  <div class="ec-kw-adv" id="ecKwAdv-${comp.id}">
    <button type="button" class="ec-kw-adv-toggle" data-comp-id="${comp.id}" aria-expanded="false" aria-controls="ecKwAdvBody-${comp.id}">Folder name options</button>
    <div class="ec-kw-adv-body" id="ecKwAdvBody-${comp.id}" hidden>
      <div class="ec-kw-adv-preview" id="ecKwAdvPreview-${comp.id}"></div>
      <p class="ec-kw-adv-warn" id="ecKwAdvWarn-${comp.id}" hidden>Folder name is getting long. Consider keeping some keywords as metadata only.</p>
      <div class="ec-kw-adv-rows" id="ecKwAdvRows-${comp.id}"></div>
    </div>
  </div>
</div>`;
  }

  // ── Keyword Registry helpers ───────────────────────────────────────────────

  async function _getRegistry() {
    if (_kwRegistry) return _kwRegistry;
    if (!_kwRegistryPromise) {
      _kwRegistryPromise = window.api.keywordsLoadRegistry()
        .then(reg => { _kwRegistry = reg; return reg; })
        .catch(() => null);
    }
    return _kwRegistryPromise;
  }

  function _kwRegistryItems(reg) {
    if (!reg) return [];
    const seen = new Set();
    const result = [];
    for (const kw of [...(reg.base?.keywords || []), ...(reg.overrides || [])]) {
      if (!kw.label) continue;
      const lo = kw.label.toLowerCase();
      if (seen.has(lo)) continue;
      seen.add(lo);
      result.push({ id: kw.id || null, label: kw.label });
    }
    return result;
  }

  function _countryRegistryItems(reg) {
    if (!reg) return [];
    const countryGroups = new Set(
      (reg.base?.groups || []).filter(g => g.category === 'country').map(g => g.id)
    );
    const seen = new Set();
    const result = [];
    for (const kw of [...(reg.base?.keywords || []), ...(reg.overrides || [])]) {
      if (!kw.label) continue;
      const lo = kw.label.toLowerCase();
      if (seen.has(lo)) continue;
      if (kw.category !== 'country' && !countryGroups.has(kw.groupId)) continue;
      seen.add(lo);
      result.push({ label: kw.label });
    }
    return result;
  }

  function _lookupCityCountry(reg, cityLabel) {
    if (!reg || !cityLabel) return null;
    const lo = cityLabel.toLowerCase();
    for (const kw of [...(reg.base?.keywords || []), ...(reg.overrides || [])]) {
      if (kw.category === 'city' && typeof kw.label === 'string' &&
          kw.label.toLowerCase() === lo && kw.country) {
        return kw.country;
      }
    }
    return null;
  }

  async function _showKwDropdown(inputEl, comp, query) {
    const ddEl = document.getElementById(`ecKwDD-${comp.id}`);
    if (!ddEl) return;
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      ddEl.hidden = true;
      inputEl.setAttribute('aria-expanded', 'false');
      return;
    }
    const reg = await _getRegistry();
    const items = _kwRegistryItems(reg);
    const existingLabels = new Set((comp.additionalKeywords || []).map(k => (k.label || '').toLowerCase()));
    const matches = items
      .filter(kw => kw.label.toLowerCase().includes(q) && !existingLabels.has(kw.label.toLowerCase()))
      .slice(0, 8);
    if (matches.length === 0) {
      ddEl.innerHTML = `<div class="ec-kw-dd-empty">No matches in registry</div>`;
      ddEl.hidden = false;
      inputEl.setAttribute('aria-expanded', 'true');
      return;
    }
    ddEl.innerHTML = matches.map(kw =>
      `<div class="ec-kw-dd-item" data-label="${esc(kw.label)}" data-kid="${esc(kw.id || '')}" role="option" tabindex="-1">${esc(kw.label)}</div>`
    ).join('');
    ddEl.hidden = false;
    inputEl.setAttribute('aria-expanded', 'true');
  }

  function _addKwToComp(comp, label, keywordId) {
    if (!label) return false;
    if (!Array.isArray(comp.additionalKeywords)) comp.additionalKeywords = [];
    if (comp.additionalKeywords.some(k => (k.label || '').toLowerCase() === label.toLowerCase())) return false;
    comp.additionalKeywords.push({ label, keywordId: keywordId || null, useInFolderName: false });
    return true;
  }

  // ── Advanced folder-name panel ─────────────────────────────────────────────

  function _buildPlacementSelect(comp, kw, ki) {
    const types   = comp.eventTypes || [];
    const fp      = kw.folderPlacement;
    const cur     = fp ? (fp.mode === 'end-of-event-tags' ? 'end'
                         : (fp.mode === 'before-event-tag' ? `before:${fp.anchorIndex}` : `after:${fp.anchorIndex}`))
                       : 'end';
    const ro      = _viewingExisting && !_editMode;
    const opts    = [];
    if (types.length > 0) {
      opts.push(`<option value="before:0"${cur === 'before:0' ? ' selected' : ''}>Before ${esc(types[0].label)}</option>`);
      for (let i = 0; i < types.length; i++) {
        const v = `after:${i}`;
        opts.push(`<option value="${v}"${cur === v ? ' selected' : ''}>After ${esc(types[i].label)}</option>`);
      }
    }
    opts.push(`<option value="end"${cur === 'end' ? ' selected' : ''}>End of Event Tags</option>`);
    return `<select class="ec-kw-adv-placement" data-comp="${comp.id}" data-idx="${ki}"${ro ? ' disabled' : ''}>${opts.join('')}</select>`;
  }

  function _refreshKwAdvanced(comp) {
    const bodyEl = document.getElementById(`ecKwAdvBody-${comp.id}`);
    if (!bodyEl || bodyEl.hidden) return;
    const rowsEl = document.getElementById(`ecKwAdvRows-${comp.id}`);
    const prevEl = document.getElementById(`ecKwAdvPreview-${comp.id}`);
    const warnEl = document.getElementById(`ecKwAdvWarn-${comp.id}`);
    if (!rowsEl) return;

    const allSameCity = _eventComps.length <= 1 ||
      _eventComps.every(c => c.city?.label === _eventComps[0].city?.label);
    const compIdx  = _eventComps.findIndex(c => c.id === comp.id);
    const folderName = buildFolderName(comp, compIdx >= 0 ? compIdx : 0, allSameCity);
    if (prevEl) prevEl.innerHTML = `<span class="ec-kw-adv-prev-label">Preview</span><code class="ec-kw-adv-prev-code">${esc(folderName)}</code>`;
    const kwInFolder = (comp.additionalKeywords || []).some(k => k.useInFolderName);
    if (warnEl) warnEl.hidden = !(kwInFolder && folderName.length > 160);

    const kws = comp.additionalKeywords || [];
    const isReadonly = _viewingExisting && !_editMode;
    if (kws.length === 0) {
      rowsEl.innerHTML = '<p class="ec-kw-adv-empty">Add an additional keyword above to enable folder name options.</p>';
      return;
    }
    rowsEl.innerHTML = kws.map((kw, ki) => {
      const inFolder = !!kw.useInFolderName;
      return `<div class="ec-kw-adv-row">` +
        `<span class="ec-kw-adv-kw-name">${esc(kw.label || '')}</span>` +
        `<label class="ec-kw-adv-include-label">` +
          `<input type="checkbox" class="ec-kw-adv-check" data-comp="${comp.id}" data-idx="${ki}"${inFolder ? ' checked' : ''}${isReadonly ? ' disabled' : ''}>` +
          `<span>Include in folder name</span>` +
        `</label>` +
        (inFolder ? `<div class="ec-kw-adv-placement-row"><span class="ec-kw-adv-placement-label">Placement:</span>${_buildPlacementSelect(comp, kw, ki)}</div>` : '') +
        `</div>`;
    }).join('');
  }

  function _refreshKwChips(comp) {
    const el = document.getElementById(`ecKwChips-${comp.id}`);
    if (!el) return;
    const isReadonly = _viewingExisting && !_editMode;
    el.innerHTML = (comp.additionalKeywords || []).map((kw, ki) => {
      const label = kw.label || '';
      return `<span class="ec-chip ec-kw-chip">` +
        `<span class="ec-chip-label">${esc(label)}</span>` +
        `<button type="button" class="ec-kw-chip-x" data-comp="${comp.id}" data-idx="${ki}" ` +
          `aria-label="Remove ${esc(label)}"${isReadonly ? ' disabled' : ''}>×</button>` +
        `</span>`;
    }).join('');
  }

  // ── Dropdown mounting ──────────────────────────────────────────────────────

  function _mountEventDropdowns() {
    const gcEl = document.getElementById('ecGlobalCityDD');
    if (gcEl) {
      _globalCityDD = new TreeAutocomplete({
        container: gcEl,
        type: 'cities',
        placeholder: 'Search city…',
        onSelect: async ({ id, label }) => {
          _globalCityVal = { id, label };
          // Lookup country for this global city
          const reg = await _getRegistry();
          const country = _lookupCityCountry(reg, label);
          _eventComps.forEach(c => {
            if (!c.city) {
              c.city = { id, label };
              _compDDs[c.id]?.city?.setValue(id, label);
            }
            // Auto-fill country on components that don't have a manually-set country
            if (country) {
              const compDD = _compDDs[c.id];
              if (compDD?.country && !compDD.country.isManuallySet()) {
                compDD.country.setValueAuto(country);
              }
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
            _refreshKwAdvanced(comp);
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
        onSelect: ({ id, label }) => { comp.location = { id, label }; _refreshKwAdvanced(comp); _updateEventPreview(); }
      });
      if (comp.location) row.loc.setValue(comp.location.id, comp.location.label);
    }

    const cityEl = document.getElementById(`ecCity-${comp.id}`);
    if (cityEl) {
      row.city = new TreeAutocomplete({
        container: cityEl, type: 'cities', placeholder: 'City…',
        onSelect: async ({ id, label }) => {
          comp.city = { id, label };
          _refreshKwAdvanced(comp);
          _updateEventPreview();
          // Auto-fill country from city-country association if not manually overridden
          const compDD = _compDDs[comp.id];
          if (compDD?.country && !compDD.country.isManuallySet()) {
            const reg = await _getRegistry();
            const country = _lookupCityCountry(reg, label);
            if (country) compDD.country.setValueAuto(country);
          }
        }
      });
      if (comp.city) row.city.setValue(comp.city.id, comp.city.label);
    }

    row.country = _mountCountryDD(comp);
    if (comp.country) row.country?.setValue(comp.country);

    // Auto-fill country for components that already have a city but no country set
    if (comp.city?.label && !comp.country) {
      _getRegistry().then(reg => {
        const country = _lookupCityCountry(reg, comp.city.label);
        if (country && row.country && !row.country.isManuallySet()) {
          row.country.setValueAuto(country);
        }
      }).catch(() => {});
    }

    _compDDs[comp.id] = row;
  }

  // ── Country control (TreeAutocomplete-compatible, sourced from keyword registry) ──

  function _mountCountryDD(comp) {
    const container = document.getElementById(`ecCountry-${comp.id}`);
    if (!container) return null;

    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'tac';

    const rowEl = document.createElement('div');
    rowEl.className = 'tac-row';

    const inp = document.createElement('input');
    inp.type         = 'text';
    inp.className    = 'tac-inp';
    inp.placeholder  = 'Country';
    inp.autocomplete = 'off';
    inp.spellcheck   = false;
    inp.setAttribute('role', 'combobox');
    inp.setAttribute('aria-autocomplete', 'list');
    inp.setAttribute('aria-expanded', 'false');

    const clearBtn = document.createElement('button');
    clearBtn.type      = 'button';
    clearBtn.className = 'tac-clear-btn';
    clearBtn.textContent = '×';
    clearBtn.hidden    = true;
    clearBtn.setAttribute('tabindex', '-1');
    clearBtn.setAttribute('aria-label', 'Clear country');

    const chev = document.createElement('span');
    chev.className = 'tac-chev';
    chev.setAttribute('aria-hidden', 'true');

    rowEl.append(inp, clearBtn, chev);

    const dd = document.createElement('div');
    dd.className = 'tac-dd';
    dd.hidden    = true;
    dd.setAttribute('role', 'listbox');

    wrap.append(rowEl, dd);
    container.append(wrap);

    let _isOpen      = false;
    let _selected    = null;
    let _items       = null;
    let _activeIdx   = -1;
    let _manuallySet = false;

    async function _ensureItems() {
      if (_items) return _items;
      const reg = await _getRegistry();
      _items = _countryRegistryItems(reg);
      return _items;
    }

    function _syncActive() {
      const nav = [...dd.querySelectorAll('.tac-item')];
      nav.forEach((el, i) => el.classList.toggle('tac-active', i === _activeIdx));
      nav[_activeIdx]?.scrollIntoView({ block: 'nearest' });
    }

    function _render(query) {
      dd.innerHTML = '';
      const q       = (query || '').trim().toLowerCase();
      const src     = _items || [];
      const matches = q ? src.filter(c => c.label.toLowerCase().includes(q)) : src;

      if (matches.length === 0) {
        const empty = document.createElement('div');
        empty.className   = 'tac-empty';
        empty.textContent = src.length === 0
          ? 'No countries found in keyword registry. Import your Bridge keyword list first.'
          : 'No matches';
        dd.append(empty);
      } else {
        matches.slice(0, 20).forEach((c, i) => {
          const el = document.createElement('div');
          el.className = 'tac-item' + (i === _activeIdx ? ' tac-active' : '');
          el.setAttribute('role', 'option');
          el.textContent = c.label;
          el.addEventListener('mousedown', e => { e.preventDefault(); _select(c.label); });
          dd.append(el);
        });
      }
    }

    async function _open() {
      if (_isOpen) return;
      _isOpen = true;
      dd.hidden = false;
      wrap.dataset.open = '';
      inp.setAttribute('aria-expanded', 'true');
      await _ensureItems();
      _render(inp.value);
    }

    function _close() {
      if (!_isOpen) return;
      _isOpen = false;
      _activeIdx = -1;
      dd.hidden = true;
      delete wrap.dataset.open;
      inp.setAttribute('aria-expanded', 'false');
      inp.value      = _selected || '';
      clearBtn.hidden = !_selected;
    }

    function _select(label) {
      _manuallySet = true;
      _selected    = label;
      comp.country = label;
      inp.value    = label;
      clearBtn.hidden = false;
      _close();
      // Learn city-country association if a city is set on this component
      if (comp.city?.label) {
        window.api.keywordsSaveCityCountry(comp.city.label, label)
          .then(() => { _kwRegistry = null; _kwRegistryPromise = null; })
          .catch(err => console.warn('[country] saveCityCountry failed:', err));
      }
    }

    function _clearVal() {
      _manuallySet = false;
      _selected    = null;
      comp.country = '';
      inp.value    = '';
      clearBtn.hidden = true;
      if (_isOpen) { _activeIdx = -1; _render(''); }
    }

    inp.addEventListener('focus', () => _open());
    inp.addEventListener('input', async () => {
      clearBtn.hidden = !inp.value;
      _activeIdx = -1;
      if (!_isOpen) {
        _isOpen = true;
        dd.hidden = false;
        wrap.dataset.open = '';
        inp.setAttribute('aria-expanded', 'true');
      }
      await _ensureItems();
      _render(inp.value);
    });

    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!_isOpen) { _open(); return; }
        const nav = [...dd.querySelectorAll('.tac-item')];
        if (nav.length === 0) return;
        _activeIdx = e.key === 'ArrowDown'
          ? Math.min(_activeIdx + 1, nav.length - 1)
          : Math.max(_activeIdx - 1, 0);
        _syncActive();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!_isOpen) { _open(); return; }
        const nav = [...dd.querySelectorAll('.tac-item')];
        if (_activeIdx >= 0 && nav[_activeIdx]) {
          nav[_activeIdx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        _close();
      }
    });

    clearBtn.addEventListener('mousedown', e => { e.preventDefault(); _clearVal(); });

    const _globalDown = e => { if (!wrap.contains(e.target)) _close(); };
    document.addEventListener('mousedown', _globalDown, true);

    return {
      setValue(label) {
        if (!label) return;
        _manuallySet    = true;
        _selected       = label;
        inp.value       = label;
        clearBtn.hidden = false;
      },
      setValueAuto(label) {
        if (!label) return;
        _selected       = label;
        comp.country    = label;
        inp.value       = label;
        clearBtn.hidden = false;
      },
      isManuallySet() { return _manuallySet; },
      clear()        { _clearVal(); },
      setDisabled(v) {
        inp.disabled = v;
        wrap.classList.toggle('tac-disabled', v);
      },
      destroy() {
        document.removeEventListener('mousedown', _globalDown, true);
        wrap.remove();
      }
    };
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
        _newEventDate    = null;
        _collectionCode  = '';
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
        _newEventDate    = null;
        _collectionCode  = '';
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
        row?.et?.destroy(); row?.loc?.destroy(); row?.city?.destroy(); row?.country?.destroy();
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
          _refreshKwAdvanced(comp);
          _updateEventPreview();
        }
        return;
      }

      // .ec-kw-chip-x — remove an additional keyword chip
      const kwChipX = e.target.closest('.ec-kw-chip-x');
      if (kwChipX) {
        const compId = Number(kwChipX.dataset.comp);
        const idx    = Number(kwChipX.dataset.idx);
        const comp   = _eventComps.find(c => c.id === compId);
        if (comp) {
          comp.additionalKeywords.splice(idx, 1);
          _refreshKwChips(comp);
          _updateEventPreview();
        }
        return;
      }

      // .ec-kw-toggle-folder — toggle useInFolderName on a keyword chip
      const kwToggle = e.target.closest('.ec-kw-toggle-folder');
      if (kwToggle) {
        const compId = Number(kwToggle.dataset.comp);
        const idx    = Number(kwToggle.dataset.idx);
        const comp   = _eventComps.find(c => c.id === compId);
        if (comp && comp.additionalKeywords[idx]) {
          const newInFolder = !comp.additionalKeywords[idx].useInFolderName;
          const types2 = comp.eventTypes || [];
          const lastIdx2 = types2.length > 0 ? types2.length - 1 : -1;
          const defFp = lastIdx2 >= 0
            ? { mode: 'after-event-tag', anchorLabel: types2[lastIdx2].label, anchorIndex: lastIdx2, order: 0 }
            : { mode: 'end-of-event-tags', anchorLabel: null, anchorIndex: -1, order: 0 };
          comp.additionalKeywords[idx] = {
            ...comp.additionalKeywords[idx],
            useInFolderName: newInFolder,
            folderPlacement: newInFolder && !comp.additionalKeywords[idx].folderPlacement
              ? defFp
              : comp.additionalKeywords[idx].folderPlacement
          };
          _refreshKwChips(comp);
          _refreshKwAdvanced(comp);
          _updateEventPreview();
        }
        return;
      }

      // .ec-kw-adv-toggle — open/close the advanced folder-name panel
      const advToggle = e.target.closest('.ec-kw-adv-toggle');
      if (advToggle) {
        const compId = Number(advToggle.dataset.compId);
        const comp   = _eventComps.find(c => c.id === compId);
        const bodyEl = document.getElementById(`ecKwAdvBody-${compId}`);
        if (!bodyEl) return;
        const isOpen = !bodyEl.hidden;
        bodyEl.hidden = isOpen;
        advToggle.setAttribute('aria-expanded', String(!isOpen));
        advToggle.classList.toggle('open', !isOpen);
        if (!isOpen && comp) _refreshKwAdvanced(comp);
        return;
      }

      // .ec-kw-dd-item — select a keyword from the search dropdown
      const ddItem = e.target.closest('.ec-kw-dd-item');
      if (ddItem) {
        const wrap = ddItem.closest('.ec-kw-search-wrap');
        if (!wrap) return;
        const compId = Number(wrap.dataset.compId);
        const comp   = _eventComps.find(c => c.id === compId);
        if (!comp) return;
        const label     = ddItem.dataset.label;
        if (!label) return; // "No matches" placeholder — no data-label
        const keywordId = ddItem.dataset.kid || null;
        if (_addKwToComp(comp, label, keywordId)) {
          _refreshKwChips(comp);
          _updateEventPreview();
        }
        const inputEl = document.getElementById(`ecKwInput-${comp.id}`);
        const ddEl    = document.getElementById(`ecKwDD-${comp.id}`);
        if (inputEl) { inputEl.value = ''; inputEl.setAttribute('aria-expanded', 'false'); }
        if (ddEl)    ddEl.hidden = true;
        return;
      }
    });

    // ── Input delegation (hijri date fields + country) ──────────────────────
    body.addEventListener('input', e => {
      const id = e.target.id;
      if (id === 'evHijriYear' || id === 'evHijriMonth' || id === 'evHijriDay') {
        numericOnly(e.target);
        if (id === 'evHijriYear'  && e.target.value.length === 4) document.getElementById('evHijriMonth')?.focus();
        if (id === 'evHijriMonth' && e.target.value.length === 2) document.getElementById('evHijriDay')?.focus();
        _onEvDateInput();
      }
      if (id === 'evCollectionCode') {
        _collectionCode = e.target.value.trim();
      }
      if (e.target.classList.contains('ec-kw-input')) {
        const compId = Number(e.target.id.replace('ecKwInput-', ''));
        const comp   = _eventComps.find(c => c.id === compId);
        if (comp) _showKwDropdown(e.target, comp, e.target.value);
      }
    });

    // ── Keydown delegation (hijri date navigation + keyword enter) ───────────
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
      if (e.target.classList.contains('ec-kw-input')) {
        if (e.key === 'Enter') {
          e.preventDefault();
          const compId = Number(id.replace('ecKwInput-', ''));
          const kw     = value.trim();
          if (!kw) return;
          // Free text is not accepted — only registry items via dropdown click
          const errEl = document.getElementById(`ecKwFreeErr-${compId}`);
          if (errEl) {
            errEl.hidden = false;
            setTimeout(() => { if (errEl) errEl.hidden = true; }, 4000);
          }
          const ddEl = document.getElementById(`ecKwDD-${compId}`);
          if (ddEl) { ddEl.hidden = true; e.target.setAttribute('aria-expanded', 'false'); }
        } else if (e.key === 'Escape') {
          const compId = Number(id.replace('ecKwInput-', ''));
          const ddEl   = document.getElementById(`ecKwDD-${compId}`);
          if (ddEl) { ddEl.hidden = true; e.target.setAttribute('aria-expanded', 'false'); }
        }
      }
    });

    // ── Change delegation — advanced folder-name panel (checkbox + placement) ──
    body.addEventListener('change', e => {
      const advCheck = e.target.closest('.ec-kw-adv-check');
      if (advCheck) {
        const compId = Number(advCheck.dataset.comp);
        const idx    = Number(advCheck.dataset.idx);
        const comp   = _eventComps.find(c => c.id === compId);
        if (!comp || !comp.additionalKeywords[idx]) return;
        const newInFolder = advCheck.checked;
        const types = comp.eventTypes || [];
        const lastTypeIdx = types.length > 0 ? types.length - 1 : -1;
        const defaultPlacement = lastTypeIdx >= 0
          ? { mode: 'after-event-tag', anchorLabel: types[lastTypeIdx].label, anchorIndex: lastTypeIdx, order: 0 }
          : { mode: 'end-of-event-tags', anchorLabel: null, anchorIndex: -1, order: 0 };
        comp.additionalKeywords[idx] = {
          ...comp.additionalKeywords[idx],
          useInFolderName: newInFolder,
          folderPlacement: newInFolder && !comp.additionalKeywords[idx].folderPlacement
            ? defaultPlacement
            : comp.additionalKeywords[idx].folderPlacement
        };
        _refreshKwChips(comp);
        _refreshKwAdvanced(comp);
        _updateEventPreview();
        return;
      }
      const advPlace = e.target.closest('.ec-kw-adv-placement');
      if (advPlace) {
        const compId = Number(advPlace.dataset.comp);
        const idx    = Number(advPlace.dataset.idx);
        const comp   = _eventComps.find(c => c.id === compId);
        if (!comp || !comp.additionalKeywords[idx]) return;
        const val    = advPlace.value;
        let fp;
        if (val === 'end') {
          fp = { mode: 'end-of-event-tags', anchorLabel: null, anchorIndex: -1, order: 0 };
        } else if (val.startsWith('before:')) {
          const ai   = Number(val.replace('before:', ''));
          fp = { mode: 'before-event-tag', anchorLabel: comp.eventTypes?.[ai]?.label || null, anchorIndex: ai, order: 0 };
        } else if (val.startsWith('after:')) {
          const ai   = Number(val.replace('after:', ''));
          fp = { mode: 'after-event-tag', anchorLabel: comp.eventTypes?.[ai]?.label || null, anchorIndex: ai, order: 0 };
        } else {
          fp = { mode: 'end-of-event-tags', anchorLabel: null, anchorIndex: -1, order: 0 };
        }
        comp.additionalKeywords[idx] = { ...comp.additionalKeywords[idx], folderPlacement: fp };
        _refreshKwAdvanced(comp);
        _updateEventPreview();
        return;
      }
    });

    // ── Focusout delegation — close keyword/country dropdowns when focus leaves ─
    body.addEventListener('focusout', e => {
      if (e.target.classList.contains('ec-kw-input')) {
        // Delay so a click on a dd-item fires first
        setTimeout(() => {
          const compId = Number(e.target.id.replace('ecKwInput-', ''));
          const ddEl   = document.getElementById(`ecKwDD-${compId}`);
          if (ddEl && !ddEl.hidden) {
            ddEl.hidden = true;
            e.target.setAttribute('aria-expanded', 'false');
          }
        }, 150);
      }
    });
  }

  function _refreshCompList() {
    const listEl = document.getElementById('ecCompList');
    if (!listEl) return;

    Object.keys(_compDDs).forEach(id => {
      const row = _compDDs[Number(id)];
      row?.et?.destroy(); row?.loc?.destroy(); row?.city?.destroy(); row?.country?.destroy();
    });
    _compDDs = {};

    if (_eventComps.length === 0) {
      listEl.innerHTML = '<p class="ec-hint" style="padding:12px 0;margin:0">No components added yet.</p>';
      return;
    }

    listEl.innerHTML = _eventComps.map((c, i) => _buildCompRow(c, i)).join('');
    _eventComps.forEach(comp => _mountCompDDs(comp));
    // Remove-button clicks handled by delegated listener on #ecBody — no per-button wiring needed.

    // Wire drag-to-reorder on the drag handles.
    let _dragSrcId = null;
    listEl.querySelectorAll('.ec-comp-row[data-comp-id]').forEach(row => {
      const handle = row.querySelector('.ec-drag-handle');
      if (!handle) return;
      handle.setAttribute('draggable', 'true');
      handle.addEventListener('dragstart', e => {
        _dragSrcId = Number(row.dataset.compId);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('ec-dragging');
      });
      handle.addEventListener('dragend', () => {
        row.classList.remove('ec-dragging');
        listEl.querySelectorAll('.ec-comp-row').forEach(r => r.classList.remove('ec-drag-over'));
      });
      row.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        listEl.querySelectorAll('.ec-comp-row').forEach(r => r.classList.remove('ec-drag-over'));
        row.classList.add('ec-drag-over');
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        const targetId = Number(row.dataset.compId);
        if (_dragSrcId === null || _dragSrcId === targetId) return;
        const fromIdx = _eventComps.findIndex(c => c.id === _dragSrcId);
        const toIdx   = _eventComps.findIndex(c => c.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;
        const [moved] = _eventComps.splice(fromIdx, 1);
        _eventComps.splice(toIdx, 0, moved);
        _dragSrcId = null;
        _refreshCompList();
        _updateEventPreview();
      });
    });
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

    const firstCity   = comps[0]?.city?.label || '';
    const allSameCity = comps.every(c => (c.city?.label || '') === firstCity);

    const byMode = (k, mode, ai) => {
      const fp = k.folderPlacement;
      if (!fp) return mode === 'end-of-event-tags';
      return fp.mode === mode && (ai === undefined || fp.anchorIndex === ai);
    };
    const byOrder = (a, b) => (a.folderPlacement?.order || 0) - (b.folderPlacement?.order || 0);

    const parts = [];
    comps.forEach(comp => {
      const kwToFolder = (comp.additionalKeywords || []).filter(k => k && k.useInFolderName);
      const eventTypes = comp.eventTypes || [];

      if (kwToFolder.length === 0) {
        eventTypes.forEach(et => { if (et.label) parts.push(et.label); });
      } else {
        const placed = new Set();
        for (let i = 0; i < eventTypes.length; i++) {
          kwToFolder.filter(k => byMode(k, 'before-event-tag', i)).sort(byOrder).forEach(k => { placed.add(k); parts.push(k.label); });
          if (eventTypes[i].label) parts.push(eventTypes[i].label);
          kwToFolder.filter(k => byMode(k, 'after-event-tag', i)).sort(byOrder).forEach(k => { placed.add(k); parts.push(k.label); });
        }
        kwToFolder.filter(k => byMode(k, 'end-of-event-tags') || !placed.has(k)).sort(byOrder).forEach(k => parts.push(k.label));
      }

      if (comp.location?.label) parts.push(comp.location.label);
      if (!allSameCity && comp.city?.label) parts.push(comp.city.label);
    });
    if (allSameCity && firstCity) parts.push(firstCity);

    return sanitizeEventName(parts.join('-'));
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

    const eventPath = (_effectiveCollPath() || activeMaster?.path) + '/' + entry.folderName;

    const components = await loadEventFromDisk(eventPath);
    if (!components) {
      console.error('[_selectExistingForImport] Failed to load components from', eventPath);
      return false;
    }

    setEventState(components);
    _compSeq = _eventComps.length;

    _viewingExisting = {
      folderName:         entry.folderName,
      displayName:        entry.displayName || entry._eventJson?.eventName || entry.folderName,
      hijriDate:          entry.hijriDate    || entry._eventJson?.hijriDate    || null,
      sequence:           entry.sequence     ?? entry._eventJson?.sequence     ?? null,
      isUnresolved:       !!entry.isUnresolved,
      components:         _eventComps.map(c => ({ ...c, eventTypes: [...c.eventTypes] })),
      isOfflineLocalCopy: _offlineStagingMode,
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
        types:              c.eventTypes.map(et => et.label),
        location:           c.location?.label || null,
        city:               c.city?.label     || '',
        country:            c.country         || null,
        additionalKeywords: Array.isArray(c.additionalKeywords) && c.additionalKeywords.length ? c.additionalKeywords : undefined,
        isUnresolved:       false,
        folderName:         buildFolderName(c, idx, allSameCity),
      }));

      const collectionCode = document.getElementById('evCollectionCode')?.value?.trim() || _collectionCode || null;
      const eventJsonPayload = {
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
      };
      if (collectionCode) {
        eventJsonPayload.collectionCode     = collectionCode;
        eventJsonPayload.collectionCodeLink = {
          system:   'archive-entry-form',
          code:     collectionCode,
          linkedAt: new Date().toISOString(),
        };
      }
      // Advisory: check remote-visible event names before writing locally.
      // Non-blocking — failure to check never prevents creation.
      if (window.api.getRealtimeKnownNames) {
        try {
          const rtNames = await window.api.getRealtimeKnownNames();
          const remoteMatch = rtNames?.events?.find(e => e.eventFolderName === safe);
          if (remoteMatch) {
            const proceed = window.confirm(
              `Advisory: "${safe}" is already visible from another device.\n\nThis does not block creation — it is only a visibility notice. Continue?`
            );
            if (!proceed) return;
          }
        } catch { /* advisory only — never block on failure */ }
      }

      // Await write so a NAS failure can be detected and routed to local staging.
      const _writeResult = await window.api.writeEventJson(eventFolderPath, eventJsonPayload);
      if (_writeResult?.ok) {
        if (_writeResult.alreadyExisted) {
          console.log('[EventCreator] event.json already existed; kept existing record:', name);
        }
        // When archive is offline and activeMaster.path was already the staging path
        // (e.g. user selected an existing staging collection), the write succeeds directly.
        // Mark the event as a local staging copy so the hero shows the offline badge.
        if (_offlineStagingMode) {
          _viewingExisting = {
            folderName:         safe,
            displayName:        name,
            hijriDate:          _newEventDate,
            sequence:           parseInt(seq, 10),
            isUnresolved:       false,
            isOfflineLocalCopy: true,
          };
        }
      } else {
        // Archive write failed — check if offline; if so, fall back to local staging.
        let _stagingOk = false;
        try {
          const _opsStatus   = await window.api.getArchiveOperationsStatus();
          const _isOffline   = _opsStatus?.status === 'nas-disconnected' || _opsStatus?.status === 'invalid-nas';
          const _stagingRoot = _opsStatus?.localStagingRoot;
          if (_isOffline && _stagingRoot) {
            const _collName        = activeMaster.path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || selectedCollection;
            const _stagingCollPath = _stagingRoot.replace(/\\/g, '/').replace(/\/$/, '') + '/' + _collName;
            const _stagingEvPath   = _stagingCollPath + '/' + safe;
            const _stagingWrite    = await window.api.writeEventJson(_stagingEvPath, eventJsonPayload);
            if (_stagingWrite?.ok) {
              coll._masterPath = _stagingCollPath;
              // Mark new offline event so hero shows the local-staging badge.
              _viewingExisting = {
                folderName:         safe,
                displayName:        name,
                hijriDate:          _newEventDate,
                sequence:           parseInt(seq, 10),
                isUnresolved:       false,
                isOfflineLocalCopy: true,
              };
              console.log('[EventCreator] archive offline — event.json written to local staging:', _stagingEvPath);
              _stagingOk = true;
            }
          }
        } catch (_fallbackErr) {
          console.error('[EventCreator] staging fallback failed:', _fallbackErr);
        }
        if (!_stagingOk) {
          _showEventBanner('Failed to create event — archive is offline and local staging is unavailable.', 'error');
          coll.events.pop();
          _activeEventIdx = Math.max(0, _activeEventIdx - 1);
          return;
        }
      }

      // Create one subfolder per component — only for multi-component events.
      // Single-component events route files directly into the event folder.
      if (compsForDisk.length > 1) {
        try {
          // Use effective working collection path — staging when offline, archive when online.
          const basePath = (coll._masterPath || activeMaster.path) + '/' + safe;

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

    const bannerEl = document.getElementById('ecEventError');
    if (bannerEl) { clearTimeout(bannerEl._hideTimer); bannerEl.classList.remove('visible'); }
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

  // ── Photographer Folder Sequencing Modal ──────────────────────────────────

  // Must stay in sync with photographerSequenceService.EVENT_ROOT_KEY
  const _SEQ_EVENT_ROOT_KEY = '__eventRoot__';

  function _seqPrefix(n) {
    return n < 10 ? `PC0${n}` : `PC${n}`;
  }

  async function _openSeqModal() {
    // Works from SELECT mode (_selectedListFolder set) and from event-form view mode
    // (_viewingExisting set). Requires at least one of the two to be available.
    const targetFolderName = _viewingExisting?.folderName || _selectedListFolder;
    if (!targetFolderName) return;

    // Derive local staging event path for IPC
    const entry = (_scannedEvents || []).find(e => e.folderName === targetFolderName);
    let localEventPath = entry?._localEventPath || null;
    if (!localEventPath && _offlineStagingMode) {
      const collPath = _effectiveCollPath();
      if (collPath) localEventPath = collPath.replace(/\\/g, '/').replace(/\/$/, '') + '/' + targetFolderName;
    }
    if (!localEventPath && _viewingExisting?._stagingCollPath) {
      localEventPath = _viewingExisting._stagingCollPath.replace(/\\/g, '/').replace(/\/$/, '') + '/' + targetFolderName;
    }

    if (!localEventPath) {
      await showErrorModal('Cannot sequence folders: local staging path not available for this event.');
      return;
    }

    // Fetch component-scoped photographer folders from main process
    const fetchResult = await window.api.getPhotographerFolders({ localEventPath });
    if (!fetchResult.ok) {
      await showErrorModal(`Cannot load photographer folders: ${fetchResult.reason}`);
      return;
    }

    const { scopes } = fetchResult;
    const allHavePhotographers = scopes && scopes.some(s => s.photographers.length > 0);
    if (!scopes || !allHavePhotographers) {
      await showErrorModal('No photographer folders found in this event.');
      return;
    }

    // Existing component-scoped sequences from event.json
    // Shape: { scopeKey: { canonical: { sequence, folderName } } }
    const existingSeqs = entry?._eventJson?.photographerSequences || {};

    // Build per-scope ordered working lists.
    // Each scope: { scopeKey, scopeLabel, items: [{ canonical }] }
    const scopeStates = scopes.map(scope => {
      const scopeExisting = existingSeqs[scope.scopeKey] || {};
      const sequenced   = [];
      const unsequenced = [];
      for (const ph of scope.photographers) {
        const seqData = scopeExisting[ph.canonical];
        if (seqData?.sequence) {
          sequenced.push({ canonical: ph.canonical, sequence: seqData.sequence });
        } else {
          unsequenced.push({ canonical: ph.canonical });
        }
      }
      sequenced.sort((a, b) => a.sequence - b.sequence);
      return {
        scopeKey:   scope.scopeKey,
        scopeLabel: scope.scopeLabel,
        items:      [...sequenced, ...unsequenced].map(x => ({ canonical: x.canonical })),
      };
    });

    const isMultiScope = scopeStates.length > 1;

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'ec-modal-overlay';
      document.body.appendChild(overlay);

      const errEl = () => overlay.querySelector('#ecSeqError');

      function buildRowHTML(item, idx, scopeIdx) {
        const prefix = _seqPrefix(idx + 1);
        const dest   = `${prefix}-${esc(item.canonical)}`;
        return `
<li class="ec-seq-row" draggable="true" data-idx="${idx}" data-scope="${scopeIdx}">
  <span class="ec-drag-handle" title="Drag to reorder" aria-hidden="true">⠿</span>
  <span class="ec-seq-num">${esc(prefix)}</span>
  <span class="ec-seq-name">${esc(item.canonical)}</span>
  <span class="ec-seq-arrow">→</span>
  <span class="ec-seq-dest">${dest}</span>
</li>`;
      }

      function buildScopeHTML(scope, scopeIdx) {
        const rowsHTML = scope.items.map((item, idx) => buildRowHTML(item, idx, scopeIdx)).join('');
        const headerHTML = isMultiScope
          ? `<li class="ec-seq-group-header" aria-hidden="true">${esc(scope.scopeLabel || scope.scopeKey)}</li>`
          : '';
        return headerHTML + rowsHTML;
      }

      function renderList() {
        const list = overlay.querySelector('#ecSeqList');
        if (!list) return;
        list.innerHTML = scopeStates.map((scope, si) => buildScopeHTML(scope, si)).join('');
        wireRowDrag();
      }

      function renderModal() {
        const subtitleText = isMultiScope
          ? 'Drag to reorder within each sub-event. Folders will be renamed with PC prefix on apply.'
          : 'Drag to reorder. Folders will be renamed with PC prefix on apply.';

        overlay.innerHTML = `
<div class="ec-seq-modal-box">
  <p class="ec-modal-title">Photographer Folder Sequence</p>
  <p class="ec-seq-subtitle">${esc(subtitleText)}</p>
  <ul class="ec-seq-list" id="ecSeqList" role="list">
    ${scopeStates.map((scope, si) => buildScopeHTML(scope, si)).join('')}
  </ul>
  <div class="ec-seq-error" id="ecSeqError" role="alert" aria-live="polite"></div>
  <div class="ec-modal-actions">
    <button class="ec-outline-btn" id="ecSeqCancel">Cancel</button>
    <button class="ec-continue-btn" id="ecSeqApply">Apply Sequence</button>
  </div>
</div>`;

        overlay.querySelector('#ecSeqCancel').addEventListener('click', () => cleanup(false));
        overlay.querySelector('#ecSeqApply').addEventListener('click', () => applySequence());
        wireRowDrag();
        requestAnimationFrame(() => overlay.querySelector('#ecSeqApply')?.focus());
      }

      // _dragState: tracks drag source by scope index + item index
      let _dragState = null;

      function wireRowDrag() {
        const list = overlay.querySelector('#ecSeqList');
        if (!list) return;
        list.querySelectorAll('.ec-seq-row').forEach(row => {
          row.addEventListener('dragstart', e => {
            _dragState = { scopeIdx: Number(row.dataset.scope), idx: Number(row.dataset.idx) };
            e.dataTransfer.effectAllowed = 'move';
            row.classList.add('ec-seq-dragging');
          });
          row.addEventListener('dragend', () => {
            _dragState = null;
            row.classList.remove('ec-seq-dragging');
            list.querySelectorAll('.ec-seq-row').forEach(r => r.classList.remove('ec-seq-over'));
          });
          row.addEventListener('dragover', e => {
            // Only allow reorder within the same scope
            if (!_dragState || Number(row.dataset.scope) !== _dragState.scopeIdx) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            list.querySelectorAll('.ec-seq-row').forEach(r => r.classList.remove('ec-seq-over'));
            row.classList.add('ec-seq-over');
          });
          row.addEventListener('drop', e => {
            e.preventDefault();
            if (!_dragState) return;
            const toScopeIdx = Number(row.dataset.scope);
            const toIdx      = Number(row.dataset.idx);
            if (toScopeIdx !== _dragState.scopeIdx || toIdx === _dragState.idx) return;
            const scope = scopeStates[toScopeIdx];
            const [moved] = scope.items.splice(_dragState.idx, 1);
            scope.items.splice(toIdx, 0, moved);
            _dragState = null;
            renderList();
          });
        });
      }

      async function applySequence() {
        const applyBtn = overlay.querySelector('#ecSeqApply');
        if (applyBtn) applyBtn.disabled = true;

        // Build component-scoped ordered array for IPC
        const scopedOrdered = scopeStates.map(scope => ({
          scopeKey: scope.scopeKey,
          ordered:  scope.items.map((item, idx) => ({
            canonical: item.canonical,
            sequence:  idx + 1,
          })),
        }));

        const result = await window.api.applyPhotographerSequence({ localEventPath, scopedOrdered });

        if (!result.ok) {
          const err = errEl();
          if (err) err.textContent = `Failed: ${result.reason}`;
          if (applyBtn) applyBtn.disabled = false;
          return;
        }

        cleanup(true);
      }

      function cleanup(applied) {
        document.removeEventListener('keydown', keyHandler);
        overlay.remove();
        resolve(applied);
      }

      function keyHandler(e) {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
      }
      document.addEventListener('keydown', keyHandler);

      renderModal();
    });
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

    // Advisory: report viewing activity to Team Live (non-blocking, fire-and-forget).
    if (window.api?.reportTeamActivity) {
      window.api.reportTeamActivity({
        mode:            'viewing',
        collectionName:  coll.name || null,
        eventFolderName: lastEvent.name || null,
        status:          'viewing',
      }).catch(() => {});
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

    /**
     * Called by renderer after Archive Locations Save (and at startup during
     * nasRoot migration) to synchronise sessionArchiveRoot with the authoritative
     * nasRoot setting.  Clears any activeMaster/selectedCollection/sessionCollections
     * that no longer belong to the new root so stale paths are never used.
     * @param {string|null} path
     */
    setSessionArchiveRoot(path) {
      const root = (typeof path === 'string' && path.length > 0) ? path : null;
      sessionArchiveRoot = root;
      // Clear activeMaster if it no longer lives under the new root
      if (activeMaster && (!root || !activeMaster.path.startsWith(root + '/'))) {
        activeMaster        = null;
        selectedCollection  = null;
        _scannedEvents      = null;
        _viewingExisting    = null;
        _editMode           = false;
        _selectedListFolder = null;
      }
      // Clear cached session collections from a different root — step 1 re-scans on next open
      if (sessionCollections.length > 0) {
        const allFromNewRoot = root && sessionCollections.every(c => c._masterPath?.startsWith(root + '/'));
        if (!allFromNewRoot) sessionCollections.length = 0;
      }
    },

    /** Opens Archive Locations modal to change the Active Archive Root. */
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
        let last = await window.api.getLastEvent();

        // lastEvent may have been cleared by a previous offline restart.
        // If archive is now offline, try to reconstruct from the sync queue's
        // most-recently-seen job — it carries collection name, event folder name,
        // and the archive nasRoot path we need to persist for reconnect.
        if (!last) {
          try {
            const opsStatus = await window.api.getArchiveOperationsStatus();
            const isOffline = opsStatus?.status === 'nas-disconnected' || opsStatus?.status === 'invalid-nas';
            if (isOffline && opsStatus?.nasRoot) {
              const queueData = await window.api.getSyncQueue();
              const candidate = (queueData?.jobs || [])
                .filter(j => j.localEventPath && j.collection && j.event)
                .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))[0];
              if (candidate) {
                last = {
                  collectionPath: opsStatus.nasRoot + '/' + candidate.collection,
                  collectionName: candidate.collection,
                  eventName:      candidate.event,
                };
                console.log('[restoreLastEvent] queue rescue — reconstructed lastEvent from sync queue:', candidate.localEventPath);
              }
            }
          } catch (qErr) {
            console.warn('[restoreLastEvent] queue rescue failed:', qErr);
          }
        }

        if (!last || !last.collectionPath || !last.collectionName) {
          console.log('[restoreLastEvent] No previous event');
          return;
        }

        const safeName  = last.safeEventName || sanitizeForPath(last.eventName || '');
        const eventPath = safeName ? (last.collectionPath + '/' + safeName) : null;

        let resolvedCollPath      = last.collectionPath;
        let resolvedEventPath     = eventPath;
        let isOfflineLocalCopy    = false;
        let _resolvedStagingRoot  = null;

        const valid = await window.api.verifyLastEvent(last.collectionPath, eventPath);
        if (!valid) {
          // Before clearing, attempt fallback to local staging copy (archive may be offline).
          let stagingResolved = false;
          let archiveOffline  = false;
          try {
            const opsStatus   = await window.api.getArchiveOperationsStatus();
            archiveOffline    = opsStatus?.status === 'nas-disconnected' || opsStatus?.status === 'invalid-nas';
            const stagingRoot = opsStatus?.localStagingRoot;
            if (stagingRoot && last.collectionName) {
              const sCollPath  = stagingRoot + '/' + last.collectionName;
              const sEventPath = safeName ? (sCollPath + '/' + safeName) : null;
              console.log('[restoreLastEvent] staging fallback — checking:', { sCollPath, sEventPath, safeName });
              const stagingValid = sEventPath ? await window.api.verifyLastEvent(sCollPath, sEventPath) : false;
              if (stagingValid) {
                resolvedCollPath      = sCollPath;
                resolvedEventPath     = sEventPath;
                isOfflineLocalCopy    = true;
                stagingResolved       = true;
                _resolvedStagingRoot  = stagingRoot;
                console.log('[restoreLastEvent] archive offline — restoring from local staging (exact):', sEventPath);
              } else {
                // Exact path check failed — scan the staging collection for a matching event folder.
                try {
                  const scanResult = await window.api.scanStagingCollections(stagingRoot);
                  const matchColl  = scanResult?.collections?.find(c => c.name === last.collectionName);
                  console.log('[restoreLastEvent] staging scan — collection:',
                    matchColl ? matchColl.name : 'NOT FOUND',
                    '| available:', scanResult?.collections?.map(c => c.name) ?? []);
                  if (matchColl && matchColl.events.length > 0) {
                    const targetName = safeName || sanitizeForPath(last.eventName || '');
                    const matchEvent = matchColl.events.find(e => e.name === targetName)
                      || matchColl.events.find(e => e.name === sanitizeForPath(last.eventName || ''));
                    console.log('[restoreLastEvent] staging scan — looking for:', targetName,
                      '| found:', matchEvent ? matchEvent.name : 'NOT FOUND',
                      '| events:', matchColl.events.map(e => e.name));
                    if (matchEvent) {
                      const scannedEventPath = matchColl.path + '/' + matchEvent.name;
                      const scannedValid = await window.api.verifyLastEvent(matchColl.path, scannedEventPath);
                      if (scannedValid) {
                        resolvedCollPath      = matchColl.path;
                        resolvedEventPath     = scannedEventPath;
                        isOfflineLocalCopy    = true;
                        stagingResolved       = true;
                        _resolvedStagingRoot  = stagingRoot;
                        console.log('[restoreLastEvent] archive offline — restoring from local staging (scan):', scannedEventPath);
                      } else {
                        console.warn('[restoreLastEvent] staging scan: event folder found but verifyLastEvent failed:', scannedEventPath);
                      }
                    }
                  } else if (!matchColl) {
                    console.warn('[restoreLastEvent] staging scan: collection not found in staging root:', last.collectionName,
                      '| staging root:', stagingRoot);
                  } else {
                    console.warn('[restoreLastEvent] staging scan: collection found but no events with event.json:', matchColl.name);
                  }
                } catch (scanErr) {
                  console.warn('[restoreLastEvent] staging scan failed:', scanErr);
                }
              }
            }
          } catch (err) {
            console.warn('[restoreLastEvent] staging fallback check failed:', err);
          }

          if (!stagingResolved) {
            if (archiveOffline) {
              // Archive is offline and no staging copy found — preserve lastEvent so it
              // can be used on the next restart when the archive reconnects.
              console.warn('[restoreLastEvent] archive offline, no staging copy found — preserving lastEvent');
              return;
            }
            // Archive is online but path no longer exists — truly stale, clear it.
            console.warn('[restoreLastEvent] stale path detected, clearing:', eventPath || last.collectionPath);
            window.api.setLastEvent(null).catch(() => {});
            selectedCollection  = null;
            activeMaster        = null;
            _viewingExisting    = null;
            _scannedEvents      = null;
            setEventState([]);
            return;
          }
        }

        console.log('[restoreLastEvent] path:', resolvedEventPath);

        let components = await loadEventFromDisk(resolvedEventPath);

        // Archive event folder exists (verifyLastEvent passed) but event.json is missing —
        // typical of a partial sync that copied media but didn't write event.json.
        // Try local staging copy and mark as pending sync (not offline — archive IS online).
        let _pendingSync        = false;
        let _pendingStagingColl = null;
        if (!components && !isOfflineLocalCopy) {
          try {
            const opsStatus   = await window.api.getArchiveOperationsStatus();
            const stagingRoot = opsStatus?.localStagingRoot;
            if (stagingRoot && last.collectionName && safeName) {
              const sCollPath  = stagingRoot + '/' + last.collectionName;
              const sEventPath = sCollPath + '/' + safeName;
              const stgComps   = await loadEventFromDisk(sEventPath);
              if (stgComps) {
                components          = stgComps;
                resolvedCollPath    = sCollPath;
                resolvedEventPath   = sEventPath;
                _pendingSync        = true;
                _pendingStagingColl = sCollPath;
                console.log('[restoreLastEvent] archive event.json missing — staging fallback (pending sync):', sEventPath);
              } else {
                // Exact staging path failed — scan the staging collection for a match.
                try {
                  const scanResult = await window.api.scanStagingCollections(stagingRoot);
                  const matchColl  = scanResult?.collections?.find(c => c.name === last.collectionName);
                  if (matchColl) {
                    const targetName = safeName || sanitizeForPath(last.eventName || '');
                    const matchEvent = matchColl.events.find(e => e.name === targetName)
                      || matchColl.events.find(e => e.name === sanitizeForPath(last.eventName || ''));
                    if (matchEvent) {
                      const scannedEventPath = matchColl.path + '/' + matchEvent.name;
                      const scannedComps     = await loadEventFromDisk(scannedEventPath);
                      if (scannedComps) {
                        components          = scannedComps;
                        resolvedCollPath    = matchColl.path;
                        resolvedEventPath   = scannedEventPath;
                        _pendingSync        = true;
                        _pendingStagingColl = matchColl.path;
                        console.log('[restoreLastEvent] archive event.json missing — staging scan fallback (pending sync):', scannedEventPath);
                      }
                    }
                  }
                } catch (scanErr) {
                  console.warn('[restoreLastEvent] staging scan after load-fail:', scanErr);
                }
              }
            }
          } catch (err) {
            console.warn('[restoreLastEvent] staging fallback after load-fail:', err);
          }
        }

        if (!components) {
          console.error('[restoreLastEvent] Failed to load event — archive event.json missing, no staging copy found');
          return;
        }

        // Read identity from disk — getLastEvent() doesn't persist hijriDate/sequence.
        let _restoredHijriDate = null, _restoredSequence = null;
        try {
          const ejson = await window.api.readEventJson(resolvedEventPath);
          if (ejson && ejson.hijriDate) {
            _restoredHijriDate = ejson.hijriDate;
            _restoredSequence  = ejson.sequence ?? null;
          }
        } catch {}

        // Restore session state so landing card and resetToList() work correctly.
        // coll._masterPath uses resolvedCollPath so getActiveEventData().eventPath points
        // to the staging copy while offline (archive path is preserved in activeMaster).
        let coll = sessionCollections.find(c => c.name === last.collectionName);
        if (!coll) {
          coll = { name: last.collectionName, hijriDate: '', events: [], _masterPath: resolvedCollPath };
          sessionCollections.push(coll);
        } else {
          coll._masterPath = resolvedCollPath;
        }

        // Always persist archive path in activeMaster so settings reconnect correctly on next launch.
        activeMaster = { name: last.collectionName, path: last.collectionPath };

        // When restored from local staging, activate offline staging mode so that
        // _effectiveCollPath() returns the staging collection path (not the offline NAS path).
        // This makes _scanAndRenderEventList() scan the correct local path when the user
        // opens Event Management while the archive is disconnected.
        if (isOfflineLocalCopy && _resolvedStagingRoot) {
          _offlineStagingMode   = true;
          _effectiveStagingRoot = _resolvedStagingRoot;
        }

        // If last event was reconstructed from the sync queue (not from settings), write it
        // back so the next restart can use the normal path without needing a queue scan.
        if (isOfflineLocalCopy && safeName) {
          window.api.getLastEvent().then(existing => {
            if (!existing) {
              window.api.setLastEvent({
                collectionPath: last.collectionPath,
                collectionName: last.collectionName,
                eventName:      last.eventName || safeName,
              }).catch(() => {});
            }
          }).catch(() => {});
        }

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
          folderName:        safeName,
          displayName:       last.eventName || safeName,
          hijriDate:         _restoredHijriDate,
          sequence:          _restoredSequence,
          isUnresolved:      false,
          isOfflineLocalCopy,
          isPendingSync:        _pendingSync,
          _stagingCollPath:     _pendingSync ? _pendingStagingColl : undefined,
          wasLocalStagingEvent: _pendingSync,
        };

        if (!Array.isArray(_eventComps) || _eventComps.length === 0) {
          console.warn('[restoreLastEvent] Empty components after restore');
        }

        console.log('[restoreLastEvent] Restored', components.length, 'components', {
          folderName:        safeName,
          hijriDate:         _restoredHijriDate,
          sequence:          _restoredSequence,
          isOfflineLocalCopy,
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
      // For pending-local events, route imports to Local Staging (not archive) so
      // files land in the correct staging folder that will be synced later.
      const collPath = (_viewingExisting?.isPendingSync && _viewingExisting?._stagingCollPath)
        ? _viewingExisting._stagingCollPath
        : (coll._masterPath || null);
      return {
        coll,
        event,
        idx,
        collectionPath: collPath,
        eventPath: collPath ? (collPath + '/' + event.name) : null,
      };
    },

    /** Returns true when the current event was restored from local staging due to offline archive. */
    isOfflineLocalCopy() {
      return _viewingExisting?.isOfflineLocalCopy === true;
    },

    /** Returns true when the current event exists only in Local Staging and is pending sync to archive. */
    isPendingSync() {
      return _viewingExisting?.isPendingSync === true;
    },

    /** Returns true when this session started (or adopted) a Local First staging event — persists after resolve. */
    wasLocalStagingEvent() {
      return _viewingExisting?.wasLocalStagingEvent === true;
    },

    /**
     * Called when the archive comes back online in the same session.
     * Re-checks whether the archive event path is now accessible.
     * If so: updates coll._masterPath to the archive path and clears isOfflineLocalCopy.
     * If not: leaves staging copy in place — no state cleared.
     * Returns true if the resolve succeeded (caller should refresh hero display).
     */
    async resolveOfflineLocalCopyToArchive() {
      if (!_viewingExisting?.isOfflineLocalCopy) return false;
      if (!activeMaster?.path || !_viewingExisting.folderName) return false;

      const archiveCollPath  = activeMaster.path;
      const archiveEventPath = archiveCollPath + '/' + _viewingExisting.folderName;

      try {
        const valid = await window.api.verifyLastEvent(archiveCollPath, archiveEventPath);
        if (!valid) return false;

        const coll = sessionCollections.find(c => c.name === selectedCollection);
        if (coll) coll._masterPath = archiveCollPath;

        _viewingExisting.isOfflineLocalCopy = false;

        // Archive is confirmed online — exit staging mode and invalidate the cached event
        // list so the next Event Management open rescans from the archive path, not the
        // stale Local Staging scan.
        _offlineStagingMode   = false;
        _effectiveStagingRoot = null;
        _scannedEvents        = null;

        // If Event Management is already open in the list view, rescan immediately so
        // the displayed event count reflects the archive, not Local Staging.
        if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen() && EventMgmt.getMode() === 'select') {
          _scanAndRenderEventList().catch(err => {
            console.error('[resolveOfflineLocalCopyToArchive] rescan failed:', err);
          });
        }

        console.log('[resolveOfflineLocalCopyToArchive] resolved to archive:', archiveEventPath);
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Called after a successful Sync Now / Sync All Ready in the same session.
     * If the current event was a pending local staging copy (isPendingSync), checks
     * whether the archive event.json has now been written by the sync. If so, switches
     * the active path to the archive copy and clears the pending badge.
     * Returns true if the resolve succeeded (caller should refresh hero display).
     * Does NOT clear the badge if archive event.json is still missing — sync may have failed.
     */
    async resolvePendingLocalCopyToArchive() {
      if (!_viewingExisting?.isPendingSync) return false;
      if (!activeMaster?.path || !_viewingExisting.folderName) return false;

      const archiveCollPath  = activeMaster.path;
      const archiveEventPath = archiveCollPath + '/' + _viewingExisting.folderName;

      try {
        // Must verify event.json is present — verifyLastEvent only stats the directory.
        const archiveComponents = await loadEventFromDisk(archiveEventPath);
        if (!archiveComponents) return false;

        const coll = sessionCollections.find(c => c.name === selectedCollection);
        if (coll) coll._masterPath = archiveCollPath;

        _viewingExisting.isPendingSync    = false;
        _viewingExisting._stagingCollPath = undefined;
        // wasLocalStagingEvent intentionally preserved: import mode defaults to local-first
        // for the rest of this session so subsequent imports don't silently go to archive.

        // Invalidate event list cache so Event Management rescans from archive.
        _scannedEvents = null;

        if (typeof EventMgmt !== 'undefined' && EventMgmt.isOpen() && EventMgmt.getMode() === 'select') {
          _scanAndRenderEventList().catch(err => {
            console.error('[resolvePendingLocalCopyToArchive] rescan failed:', err);
          });
        }

        console.log('[resolvePendingLocalCopyToArchive] resolved to archive:', archiveEventPath);
        return true;
      } catch {
        return false;
      }
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

    /**
     * Re-reads the event at eventPath from disk and locks _eventComps.
     * Used by the import handler when _eventComps was cleared (e.g. after resetToList)
     * but the event context is still active. Always reads fresh from disk — no session cache.
     * Returns true on success, false if the event could not be read or is empty.
     */
    async reloadForImport(eventPath) {
      const components = await loadEventFromDisk(eventPath);
      if (!components || components.length === 0) return false;
      setEventState(components);
      return _eventComps.length > 0;
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
          // activeMaster.path must always be the NAS archive path for setLastEvent/reconnect.
          const archivePath = (_offlineStagingMode && sessionArchiveRoot)
            ? sessionArchiveRoot + '/' + selectedCollection
            : coll._masterPath;
          activeMaster = { name: selectedCollection, path: archivePath };
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
    tryCreateEvent() { return _tryCreateEvent(); },

    /** Phase 4 — Save Changes footer button: validates, renames folder, then closes the modal. Returns Promise. */
    saveEditedEvent() { return _handleSaveEditedEvent(); },

    /** Consume and reset the one-shot outdated flag set during saveEditedEvent(). */
    consumeMetaOutdated() { const v = _lastSaveWasMetaOutdated; _lastSaveWasMetaOutdated = false; return v; },

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
      // Pending-local events live in Local Staging, not on the archive yet — use their
      // stored local path directly instead of constructing from _effectiveCollPath().
      let eventPath;
      if (entry.isPendingSync && entry._localEventPath) {
        eventPath = entry._localEventPath;
      } else {
        const _adoptEffPath = _effectiveCollPath() || activeMaster?.path;
        if (!_adoptEffPath) {
          console.error('[adoptSelectedEvent] No activeMaster path — cannot read event.json');
          return false;
        }
        eventPath = _adoptEffPath + '/' + entry.folderName;
      }

      // ── Legacy check — must come before the corrupt/reload guard ────────────
      // A legacy event has no event.json on disk (_eventJson is null) or has a
      // JSON file that is missing the components array. This is a recoverable
      // state: the user should open Edit to configure it. Do NOT treat it as
      // corruption — the reload below would also return null and silently exit.
      const _isLegacyEntry = entry.isLegacy === true;
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
      // Adopted event: components:[] is intentional — redirect to edit so the operator
      // can define components before importing. Not a corruption case.
      if (json && !json._corrupt && Array.isArray(json.components) && json.components.length === 0 && json.adoption) {
        await openEventForEdit(entry, { skipAutoRepair: true });
        return false;
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
      // For pending-local events: mark as local copy so the hero badge shows correctly
      // and getActiveEventData() routes imports to Local Staging. The staging collection
      // path is the parent of _localEventPath (strip trailing /folderName).
      const _isPendingLocal = !!entry.isPendingSync && !!entry._localEventPath;
      _viewingExisting = {
        folderName:      entry.folderName,
        displayName:     json.eventName || entry.folderName,
        hijriDate:       entry.hijriDate,
        sequence:        entry.sequence,
        isUnresolved:    entry.isUnresolved,
        isOfflineLocalCopy: _isPendingLocal,
        isPendingSync:   _isPendingLocal,
        _stagingCollPath: _isPendingLocal
          ? entry._localEventPath.slice(0, -(entry.folderName.length + 1))
          : null,
        wasLocalStagingEvent: _isPendingLocal,
        components:      _eventComps.map(c => ({ ...c, eventTypes: [...c.eventTypes] })),
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

    /** Force the next event list / Activity Log open to re-scan from disk. */
    invalidateScannedEvents() { _scannedEvents = null; },

    isDirty() {
      return _navScreen === 'eventForm' && (_editMode || _repairMode || !_viewingExisting);
    },

    getNavScreen() { return _navScreen; },

    /**
     * Called by renderer when a realtime:registry:entry push arrives.
     * Updates the advisory registry cache and refreshes the Online Registry
     * tab if it is currently active.
     */
    onRegistryEntry(entry) {
      if (!entry || typeof entry !== 'object' || !entry.registryId) return;
      const idx = _registryEntries.findIndex(r => r.registryId === entry.registryId);
      if (idx >= 0) {
        _registryEntries[idx] = entry;
      } else {
        _registryEntries.push(entry);
      }
      if (_activeTab === 'online-registry' && _navScreen === 'eventList') {
        _refreshEventListRegistryPanel();
      }
    },

    /** Open the Photographer Folder Sequence modal for the currently selected or viewed event. */
    async openSeqModal() { return _openSeqModal(); },
  };

})();
