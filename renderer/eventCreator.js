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
  let _viewingExisting = null; // { folderName, hijriDate, sequence, isUnresolved } | null
  let _editMode        = false; // M6: when true in view-existing mode, form is editable

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
    _eventComps    = [];
    _globalCityVal = null;
    _compSeq       = 0;
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

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 — Master Collection
  // ══════════════════════════════════════════════════════════════════════════

  function showMasterStep() {
    currentStep = 1;
    const title = $ecTitle();
    if (title) title.textContent = 'Create Collection';
    syncRailHighlight(1);

    const body = $ecBody();
    if (!body) return;
    body.innerHTML = buildMasterHTML();
    attachMasterListeners();
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
    <span class="ec-new-arrow" aria-hidden="true">▶</span>
  </button>

  <!-- New collection form ─────────────────────────────────────────────── -->
  <div id="ecNewForm" class="ec-new-form${formOpen ? ' open' : ''}" role="region" aria-label="New collection form">
    ${buildNewFormHTML()}
  </div>

  <!-- Select Existing Master CTA ──────────────────────────────────────── -->
  <button id="ecSelectExistingBtn" class="ec-select-existing-btn">
    📂  Select Existing Master…
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
    <span class="ec-coll-icon" aria-hidden="true">📁</span>
    <div class="ec-coll-info">
      <div class="ec-coll-name">${esc(c.name)}</div>
      <div class="ec-coll-meta">${esc(c.events.length)} event${c.events.length === 1 ? '' : 's'}</div>
    </div>
    <span class="ec-coll-check" aria-hidden="true">✓</span>
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
  <span class="ec-preview-label">📁  Folder Name Preview</span>
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
  <div class="ec-breadcrumb-bar">
    <div class="ec-bc-row">
      <span class="ec-bc-label">Collection</span>
      <span class="ec-bc-value" title="${esc(selectedCollection || '')}">${esc(selectedCollection || '')}</span>
      <button class="ec-bc-change" id="ecChangeCollection">Change</button>
    </div>
  </div>
  <p class="ec-hint" style="margin:24px 0;text-align:center">Scanning master for existing events…</p>
</div>`;
    document.getElementById('ecChangeCollection')?.addEventListener('click', () => {
      _scannedEvents = null; _viewingExisting = null;
      showMasterStep();
    });
  }

  async function _scanAndRenderEventList() {
    _scannedEvents = await window.api.scanMasterEvents(activeMaster.path);
    if (!_scannedEvents || _scannedEvents.length === 0) {
      // No existing events — skip the list and go straight to the empty form.
      _renderEventForm();
      return;
    }
    _renderEventList();
  }

  function _renderEventList() {
    const body = $ecBody();
    if (!body) return;

    // M6: reset title when returning to the list from view/edit mode.
    const title = $ecTitle();
    if (title) title.textContent = 'Existing Events';

    const resolved   = _scannedEvents.filter(e => e.isParseable);
    const unparseable = _scannedEvents.filter(e => !e.isParseable);

    const resolvedHTML = resolved.map(ev => {
      const badge = ev.isUnresolved
        ? `<span class="ec-evl-warn" title="Some tokens in this event don't match the controlled lists yet. You can still view or edit.">⚠</span>`
        : '';
      return `
<div class="ec-evl-item" data-folder="${esc(ev.folderName)}" tabindex="0" role="button">
  <span class="ec-evl-seq">${esc(ev.sequence)}</span>
  <div class="ec-evl-meta">
    <div class="ec-evl-name" title="${esc(ev.folderName)}">${esc(ev.folderName)}</div>
    <div class="ec-evl-date">${esc(ev.hijriDate)}</div>
  </div>
  ${badge}
</div>`;
    }).join('');

    const unparseableHTML = unparseable.length === 0 ? '' : `
<p class="ec-section-title" style="margin-top:20px;opacity:0.6">Unrecognised Folders</p>
${unparseable.map(ev => `
<div class="ec-evl-item ec-evl-disabled" title="${esc(ev.reason || 'Cannot parse')}">
  <span class="ec-evl-seq">?</span>
  <div class="ec-evl-meta">
    <div class="ec-evl-name">${esc(ev.folderName)}</div>
    <div class="ec-evl-date ec-evl-warn-text">${esc(ev.reason || 'Cannot parse')}</div>
  </div>
  <span class="ec-evl-warn">⚠</span>
</div>`).join('')}`;

    body.innerHTML = `
<div class="ec-master-wrap">

  <div class="ec-breadcrumb-bar">
    <div class="ec-bc-row">
      <span class="ec-bc-label">Collection</span>
      <span class="ec-bc-value" title="${esc(selectedCollection || '')}">${esc(selectedCollection || '')}</span>
      <button class="ec-bc-change" id="ecChangeCollection">Change</button>
    </div>
  </div>

  <p class="ec-section-title">Existing Events <span class="ec-hint" style="font-weight:normal">(${resolved.length} found)</span></p>
  <div class="ec-evl-list">
    ${resolvedHTML || '<p class="ec-hint">No resolvable events yet.</p>'}
  </div>
  ${unparseableHTML}

  <button id="ecNewEventFromList" class="ec-continue-btn" style="margin-top:20px">+ Create New Event</button>

</div>`;

    document.getElementById('ecChangeCollection')?.addEventListener('click', () => {
      _scannedEvents = null; _viewingExisting = null;
      showMasterStep();
    });

    body.querySelectorAll('.ec-evl-item[data-folder]').forEach(el => {
      const open = () => _openExistingEvent(el.dataset.folder);
      el.addEventListener('click', open);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });

    document.getElementById('ecNewEventFromList')?.addEventListener('click', () => {
      _viewingExisting = null;
      _eventComps = [];
      _renderEventForm();
    });
  }

  // M5/M6: open an existing event — starts in view-only; "Edit Event" unlocks.
  function _openExistingEvent(folderName) {
    const entry = (_scannedEvents || []).find(e => e.folderName === folderName && e.isParseable);
    if (!entry) return;

    // Rehydrate components from parsed data into the EventCreator's internal shape.
    _editMode = false;
    _compSeq = 0;
    _eventComps = entry.components.map(c => ({
      id:         ++_compSeq,
      // Event types get id===label since we don't round-trip list-IDs through parsed strings.
      // TreeAutocomplete accepts that shape for display; the alias engine handles search later.
      eventTypes: c.eventTypes.map(label => ({ id: label, label })),
      location:   c.location ? { id: c.location, label: c.location } : null,
      city:       { id: c.city, label: c.city },
      isUnresolved: !!c.isUnresolved,
    }));

    _viewingExisting = {
      folderName: entry.folderName,
      hijriDate:  entry.hijriDate,
      sequence:   entry.sequence,
      isUnresolved: entry.isUnresolved,
    };

    _renderEventForm();
  }

  // Pure render of the Step-2 form. Split out of showEventStep so both the
  // scan path (after choosing "Create New Event") and the view-existing path
  // reach the same builder.
  function _renderEventForm() {
    if (_eventComps.length === 0) _eventComps = [_makeComp()];

    const body = $ecBody();
    if (!body) return;

    _destroyEventDDs();
    body.innerHTML = _buildEventHTML();
    _mountEventDropdowns();
    _attachEventListeners();
    _updateEventPreview();

    // M5: in view-only mode, lock all inputs AFTER dropdowns have mounted with values.
    if (_viewingExisting) {
      _applyEditLockState();
    }
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

    // Update the Continue button to reflect view / edit mode.
    const cont = document.getElementById('ecEventContinue');
    if (cont) {
      if (_editMode) {
        cont.textContent = 'Save Changes →';
        cont.className   = 'ec-continue-btn';
        cont.disabled    = false;
      } else {
        cont.textContent = 'Edit Event';
        cont.className   = 'ec-outline-btn';
        cont.disabled    = false;
      }
    }

    // Update title bar to match.
    const title = $ecTitle();
    if (title) title.textContent = _editMode ? 'Edit Event' : 'View Event';

    // Update mode badge.
    const badges = body.querySelectorAll('.ec-mode-badge');
    badges.forEach(b => b.textContent = _editMode ? 'Editing Event' : 'Viewing Existing Event');
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
    const parts   = _buildCompString(_eventComps);
    const newName = `${_viewingExisting.hijriDate} _${_viewingExisting.sequence}-${parts}`;
    const oldName = _viewingExisting.folderName;

    // If the name hasn't changed, no-op -> back to list.
    if (newName === oldName) {
      _editMode = false;
      _viewingExisting = null;
      _eventComps = [];
      _destroyEventDDs();
      _renderEventList();
      return;
    }

    // M6: warn if another event already has the same content parts (different sequence).
    const dupMatch = (_scannedEvents || []).find(e => {
      if (e.folderName === oldName || !e.isParseable) return false;
      const m = e.folderName.match(/^\d{4}-\d{2}-\d{2} _\d{2}-(.+)$/);
      return m && m[1] === parts;
    });
    if (dupMatch) {
      const proceed = await _showModal({
        title:    'Similar Event Exists',
        bodyHTML: `Another event already has the same components:<br><strong>${esc(dupMatch.folderName)}</strong><br><br>Save anyway?`,
        buttons:  [
          { label: 'Cancel',       primary: false, value: 'no'  },
          { label: 'Save Anyway',  primary: true,  value: 'yes' }
        ]
      });
      if (proceed !== 'yes') return;
    }

    // Call IPC to rename on disk.
    const result = await window.api.renameEvent(activeMaster.path, oldName, newName);
    if (!result.ok) {
      if (result.reason === 'collision') {
        _showEventBanner(`A folder named "${newName}" already exists.`, 'error');
      } else {
        _showEventBanner(result.reason || 'Rename failed.', 'error');
      }
      return;
    }

    // Update the scanned events cache so the list reflects the change.
    const entry = (_scannedEvents || []).find(e => e.folderName === oldName);
    if (entry) {
      entry.folderName = newName;
      entry.components = _eventComps.map(c => ({
        eventTypes: c.eventTypes.map(et => et.label),
        location: c.location?.label || null,
        city: c.city?.label || '',
        isUnresolved: false, // User edited through UI = all selections are from controlled lists
      }));
      entry.isUnresolved = false;
    }

    _editMode = false;
    _viewingExisting = null;
    _eventComps = [];
    _destroyEventDDs();
    _renderEventList();
  }

  // ── HTML builder ─────────────────────────────────────────────────────────────────────

  function _buildEventHTML() {
    // M5: mode badge + breadcrumb differ depending on whether we're creating new
    // or viewing an existing event from disk.
    const modeBadge = _viewingExisting
      ? `<span class="ec-mode-badge ec-mode-multi" style="margin-left:8px">Viewing Existing Event</span>`
      : '';
    const warnBadge = _viewingExisting && _viewingExisting.isUnresolved
      ? `<span class="ec-evl-warn" style="margin-left:6px" title="Some tokens don't match the controlled lists. You can still view and edit.">⚠ Unresolved tokens</span>`
      : '';
    const eventRow = _viewingExisting ? `
    <div class="ec-bc-row">
      <span class="ec-bc-label">Event</span>
      <span class="ec-bc-value" title="${esc(_viewingExisting.folderName)}">${esc(_viewingExisting.folderName)}</span>
      <button class="ec-bc-change" id="ecBackToList">← Back to list</button>
    </div>` : '';

    return `
<div class="ec-master-wrap">

  <div class="ec-breadcrumb-bar">
    <div class="ec-bc-row">
      <span class="ec-bc-label">Collection</span>
      <span class="ec-bc-value" title="${esc(selectedCollection || '')}">${esc(selectedCollection || '')}</span>
      ${modeBadge}
      ${warnBadge}
      <button class="ec-bc-change" id="ecChangeCollection">Change</button>
    </div>
    ${eventRow}
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
    <span class="ec-preview-label">📁  Event Folder Preview</span>
    <span id="ecEventPreviewName" class="ec-preview-name empty">—</span>
  </div>

  <div id="ecEventError" class="ec-master-error" role="alert" aria-live="polite"></div>

  <button id="ecEventContinue" class="ec-continue-btn" disabled>Create Event →</button>

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
      _wireETChips(comp);
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
    _wireETChips(comp);
  }

  function _wireETChips(comp) {
    const el = document.getElementById(`ecETChips-${comp.id}`);
    if (!el) return;
    el.querySelectorAll('.ec-chip-x').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        comp.eventTypes.splice(idx, 1);
        _refreshETChips(comp);
        _updateEventPreview();
      });
    });
  }

  // ── Listeners ──────────────────────────────────────────────────────────────

  function _attachEventListeners() {
    document.getElementById('ecChangeCollection')
      ?.addEventListener('click', () => {
        // M3: going back to Step 1 clears the scan cache so we rescan on re-entry.
        _scannedEvents = null;
        _viewingExisting = null;
        showMasterStep();
      });

    // M5/M6: "Back to list" returns to event-list. Silent discard if editing.
    document.getElementById('ecBackToList')
      ?.addEventListener('click', () => {
        _viewingExisting = null;
        _editMode = false;
        _eventComps = [];
        _destroyEventDDs();
        _renderEventList();
      });

    document.getElementById('ecAddComp')
      ?.addEventListener('click', () => {
        _eventComps.push(_makeComp());
        _refreshCompList();
        _updateEventPreview();
        const last = _eventComps[_eventComps.length - 1];
        document.getElementById(`ecET-${last.id}`)?.querySelector('input')?.focus();
      });

    _wireRemoveButtons();

    document.getElementById('ecEventContinue')
      ?.addEventListener('click', () => {
        if (_viewingExisting && !_editMode) {
          // M6: enter edit mode.
          _editMode = true;
          _applyEditLockState();
          _updateEventPreview();
        } else if (_viewingExisting && _editMode) {
          // M6: save edits.
          _handleSaveEditedEvent();
        } else {
          _tryCreateEvent();
        }
      });
  }

  function _wireRemoveButtons() {
    document.querySelectorAll('.ec-comp-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const id  = Number(btn.dataset.compId);
        const row = _compDDs[id];
        row?.et?.destroy(); row?.loc?.destroy(); row?.city?.destroy();
        delete _compDDs[id];
        _eventComps = _eventComps.filter(c => c.id !== id);
        _refreshCompList();
        _updateEventPreview();
      });
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

    listEl.innerHTML = _eventComps.map((c, i) => _buildCompRow(c, i)).join('');
    _eventComps.forEach(comp => _mountCompDDs(comp));
    _wireRemoveButtons();
  }

  // ── Event name builder ─────────────────────────────────────────────────────

  function _buildCompString(comps) {
    const result = [];
    let i = 0;
    while (i < comps.length) {
      const cityLabel = comps[i].city?.label || '';
      let j = i;
      while (j < comps.length && (comps[j].city?.label || '') === cityLabel) {
        const c = comps[j];
        c.eventTypes.forEach(et => { if (et?.label) result.push(et.label); });
        if (c.location?.label) result.push(c.location.label);
        j++;
      }
      if (cityLabel) result.push(cityLabel);
      i = j;
    }
    return result.join('-');
  }

  // ── Live preview + continue-button gate ────────────────────────────────────

  function _updateEventPreview() {
    const preview = document.getElementById('ecEventPreviewName');
    const card    = document.getElementById('ecEventPreviewCard');
    const btn     = document.getElementById('ecEventContinue');

    const coll  = sessionCollections.find(c => c.name === selectedCollection);
    // M6: use the locked sequence from _viewingExisting when editing, else next seq.
    const seq   = _viewingExisting
      ? _viewingExisting.sequence
      : String((coll?.events.length ?? 0) + 1).padStart(2, '0');
    const parts = _buildCompString(_eventComps);
    const valid = _eventComps.length > 0 && _eventComps.every(c => c.eventTypes.length > 0 && c.city);
    const name  = parts ? `${_viewingExisting ? _viewingExisting.hijriDate : (coll?.hijriDate || '?')} _${seq}-${parts}` : '';

    if (preview) {
      preview.textContent = name || '—';
      preview.classList.toggle('empty', !name);
      card?.classList.toggle('has-value', !!name);
    }
    if (btn) btn.disabled = !valid;
  }

  // ── Validate + create ──────────────────────────────────────────────────────

  function _tryCreateEvent() {
    if (_eventComps.length === 0) {
      _showEventBanner('Add at least one component.', 'error'); return;
    }
    const missing = _eventComps.find(c => c.eventTypes.length === 0 || !c.city);
    if (missing) {
      _showEventBanner('Every component needs at least one Event Type and a City.', 'error'); return;
    }

    const coll = sessionCollections.find(c => c.name === selectedCollection);
    if (!coll) { _showEventBanner('No collection selected — go back to Step 1.', 'error'); return; }

    const seq   = String(coll.events.length + 1).padStart(2, '0');
    const parts = _buildCompString(_eventComps);
    const name  = `${coll.hijriDate} _${seq}-${parts}`;

    coll.events.push({ name, components: _eventComps.map(c => ({ ...c, eventTypes: [...c.eventTypes] })) });
    _activeEventIdx = coll.events.length - 1;

    _eventComps = [_makeComp()];

    _proceedToPreviewStep();
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
  function _proceedToPreviewStep() { _slideToStep(showPreviewStep); }


  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — Event Created (Commit E)
  // ══════════════════════════════════════════════════════════════════════════

  function _buildSubEventFolderNames(components) {
    const cities   = components.map(c => c.city?.label || '');
    const sameCity = new Set(cities).size === 1;
    return components.map((comp, idx) => {
      const parts = [
        ...comp.eventTypes.map(e => e.label),
        comp.location?.label,
        sameCity ? null : comp.city?.label
      ].filter(Boolean);
      return `${pad2(idx + 1)}-${parts.join('-')}`;
    });
  }

  function _buildFolderTreeHTML(coll, event) {
    const isMulti = event.components.length > 1;
    const rows    = [];
    const r = (level, name, cls) =>
      `<div class="ft-row ft-l${level}">` +
      `<span class="ft-icon" aria-hidden="true">📁</span>` +
      `<span class="ft-name${cls ? ' ' + cls : ''}">${esc(name)}</span></div>`;

    rows.push(r(0, coll.name + '/'));
    rows.push(r(1, event.name + '/'));

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
    <button id="ecDoneBtn" class="ec-continue-btn">Done ✓</button>
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
        _eventComps     = removed.components.map(comp => ({ ...comp, eventTypes: [...comp.eventTypes] }));
        _activeEventIdx = Math.max(0, c.events.length - 1);
      }
      _slideToStep(showEventStep);
    });

    document.getElementById('ecAddAnotherBtn')?.addEventListener('click', () => {
      _eventComps = [_makeComp()];
      _slideToStep(showEventStep);
    });

    document.getElementById('ecDoneBtn')?.addEventListener('click', () => {
      document.getElementById('ecBackBtn')?.click();
    });
  }


  // ══════════════════════════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════════════════════════

  return {
    /** Enter the event creator panel. Always starts at step 1. Does NOT clear sessionArchiveRoot. */
    start() {
      selectedCollection = null;
      activeMaster       = null;
      _scannedEvents     = null;
      _viewingExisting   = null;
      _editMode          = false;
      _resetEventForm();
      showMasterStep();
    },

    /** Called on resetAppState — clears selection but keeps session collections and archive root. */
    resetSelection() {
      selectedCollection = null;
      activeMaster       = null;
      _scannedEvents     = null;
      _viewingExisting   = null;
      _editMode          = false;
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
     * Returns { coll, event, idx } for the most recently completed event,
     * or null if no event has been confirmed yet this session.
     */
    getActiveEventData() {
      if (!selectedCollection) return null;
      const coll = sessionCollections.find(c => c.name === selectedCollection);
      if (!coll || coll.events.length === 0) return null;
      const idx   = Math.min(_activeEventIdx, coll.events.length - 1);
      const event = coll.events[idx];
      return event ? { coll, event, idx } : null;
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
    resume() { showPreviewStep(); }
  };

})();
