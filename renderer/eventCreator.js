// renderer/eventCreator.js
// ── EventCreator — module singleton ────────────────────────────────────────
// Orchestrates the full multi-step event creation flow:
//   Step 1 (Commit C): Master Collection  → pick or create {HijriDate} _{Label}
//   Step 2 (Commit D): Event Details      → component builder + live name preview
//   Step 3 (Commit E): Preview & Confirm  → folder tree + final import
//
// Architecture:
//   • Pure renderer code — no Node access, all IPC via window.api
//   • sessionCollections persists across back/forward navigation this session
//   • selectedCollection is the single source of truth for the chosen master folder
//   • Each step renders into #ecBody; never touches anything outside ecBody / ecTitle

'use strict';

const EventCreator = (() => {

  // ── Session state ──────────────────────────────────────────────────────────
  // Persists for the full app session (not cleared on resetAppState)
  // so previously created collections stay available for the next event.
  const sessionCollections = [];   // { name, hijriDate, label, events[] }[]
  let   selectedCollection = null; // string (folder name) or null

  // ── Internal step tracker ──────────────────────────────────────────────────
  let currentStep = 1; // 1 = collection, 2 = event, 3 = preview

  // ── DOM shortcuts ──────────────────────────────────────────────────────────
  const $ecBody  = () => document.getElementById('ecBody');
  const $ecTitle = () => document.getElementById('ecTitle');

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

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 — Master Collection
  // ══════════════════════════════════════════════════════════════════════════

  function showMasterStep() {
    currentStep = 1;
    const title = $ecTitle();
    if (title) title.textContent = 'Create Collection';

    // Sync step rail highlight (step 1 active, others idle)
    syncRailHighlight(1);

    const body = $ecBody();
    if (!body) return;
    body.innerHTML = buildMasterHTML();
    attachMasterListeners();
  }

  // ── HTML builders ──────────────────────────────────────────────────────────

  function buildMasterHTML() {
    const hasExisting = sessionCollections.length > 0;
    const formOpen    = !hasExisting; // open by default when nothing exists

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

  <!-- Error banner ─────────────────────────────────────────────────────── -->
  <div id="ecMasterError" class="ec-master-error" role="alert" aria-live="polite"></div>

  <!-- Continue button ──────────────────────────────────────────────────── -->
  <button id="ecMasterContinue" class="ec-continue-btn" disabled>
    ${hasExisting ? 'Create & Continue →' : 'Create & Continue →'}
  </button>

</div>`;
  }

  function buildExistingCardsHTML() {
    return `
<p class="ec-section-title">Existing Collections</p>
<div class="ec-collection-cards" id="ecCollList" role="listbox" aria-label="Existing collections">
  ${sessionCollections.map(c => `
  <div
    class="ec-coll-card"
    data-name="${esc(c.name)}"
    tabindex="0"
    role="option"
    aria-selected="false"
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

    // Hijri date segments — numeric-only + auto-advance
    const yEl = document.getElementById('hijriYear');
    const mEl = document.getElementById('hijriMonth');
    const dEl = document.getElementById('hijriDay');

    if (yEl && mEl && dEl) {
      yEl.addEventListener('input', () => {
        numericOnly(yEl);
        if (yEl.value.length === 4) mEl.focus();
        onDateInput();
      });
      mEl.addEventListener('input', () => {
        numericOnly(mEl);
        if (mEl.value.length === 2) dEl.focus();
        onDateInput();
      });
      dEl.addEventListener('input', () => {
        numericOnly(dEl);
        onDateInput();
      });
      // Backspace back-navigation
      mEl.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && mEl.value === '') { e.preventDefault(); yEl.focus(); }
      });
      dEl.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && dEl.value === '') { e.preventDefault(); mEl.focus(); }
      });
      // Enter advances fields
      yEl.addEventListener('keydown', e => { if (e.key === 'Enter') mEl.focus(); });
      mEl.addEventListener('keydown', e => { if (e.key === 'Enter') dEl.focus(); });
      dEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('collLabel')?.focus();
      });
    }

    // Label field
    const lEl = document.getElementById('collLabel');
    if (lEl) {
      lEl.addEventListener('input', updatePreview);
      lEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') tryCreateCollection();
      });
    }

    // Continue button
    document.getElementById('ecMasterContinue')
      ?.addEventListener('click', tryCreateCollection);
  }

  // ── Input helpers ──────────────────────────────────────────────────────────

  function numericOnly(el) {
    el.value = el.value.replace(/\D/g, '');
  }

  function onDateInput() {
    // Clear date error while user is still typing
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

    const name     = buildCollectionName(y, m, d, l);
    const preview  = document.getElementById('ecPreviewName');
    const card     = document.getElementById('ecPreviewCard');

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
    document.querySelectorAll('.ec-coll-card').forEach(c => {
      const sel = c.dataset.name === name;
      c.classList.toggle('selected', sel);
      c.setAttribute('aria-selected', String(sel));
    });
    // Collapse the new form when picking existing
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
      // Existing collection picked
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

    btn.disabled  = !canContinue;
    btn.textContent = label;
  }

  // ── Validate + create ──────────────────────────────────────────────────────

  function tryCreateCollection() {
    const formOpen = document.getElementById('ecNewForm')?.classList.contains('open');

    // Using an existing collection
    if (!formOpen && selectedCollection) {
      proceedToEventStep();
      return;
    }

    // Validate new form
    const y = (document.getElementById('hijriYear')?.value  || '').trim();
    const m = (document.getElementById('hijriMonth')?.value || '').trim();
    const d = (document.getElementById('hijriDay')?.value   || '').trim();
    const l = (document.getElementById('collLabel')?.value  || '').trim();

    let hasError = false;

    // Date
    const dateErr  = validateHijriDate(y, m, d);
    const hijriErr = document.getElementById('hijriErr');
    if (hijriErr) {
      if (dateErr) {
        hijriErr.textContent = dateErr;
        hijriErr.classList.add('visible');
        hasError = true;
        // Focus the first bad segment
        if (!y || isNaN(parseInt(y, 10))) document.getElementById('hijriYear')?.focus();
        else if (!m || isNaN(parseInt(m, 10))) document.getElementById('hijriMonth')?.focus();
        else document.getElementById('hijriDay')?.focus();
      } else {
        hijriErr.classList.remove('visible');
      }
    }

    // Label
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

    const name = buildCollectionName(y, m, d, l);

    // Duplicate — auto-select and continue without erroring
    if (isDuplicate(name)) {
      selectedCollection = name;
      showBanner(`Collection already exists — resuming with "${name}".`, 'info');
      proceedToEventStep();
      return;
    }

    // Create new entry
    const collection = {
      name,
      hijriDate : `${y}-${pad2(m)}-${pad2(d)}`,
      label     : l,
      events    : []
    };
    sessionCollections.push(collection);
    selectedCollection = name;
    proceedToEventStep();
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
  // Uses the existing step elements: #step1, #step2, #step3
  // In event rail mode labels are: Create Collection / Create Event / Import

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
  // STEP 2 — Event Details (placeholder — Commit D will replace this)
  // ══════════════════════════════════════════════════════════════════════════

  function showEventStep() {
    currentStep = 2;
    const title = $ecTitle();
    if (title) title.textContent = 'Create Event';
    syncRailHighlight(2);

    const body = $ecBody();
    if (!body) return;

    body.innerHTML = `
<div class="ec-master-wrap">
  <div class="ec-breadcrumb-bar">
    <span class="ec-bc-label">Collection</span>
    <span class="ec-bc-value">${esc(selectedCollection || '')}</span>
    <button class="ec-bc-change" id="ecChangeCollection" aria-label="Change collection">Change</button>
  </div>

  <div class="ec-placeholder-block">
    <div class="ec-ph-icon">🗂️</div>
    <div class="ec-ph-title">Event Details</div>
    <div class="ec-ph-desc">
      The event component builder is coming in the next commit.<br>
      You'll select Event Type, Location, and City here.
    </div>
  </div>
</div>`;

    document.getElementById('ecChangeCollection')
      ?.addEventListener('click', showMasterStep);
  }

  // ── Step routing ───────────────────────────────────────────────────────────

  function proceedToEventStep() {
    // Animate out ecBody, swap, animate in
    const body = $ecBody();
    if (!body) { showEventStep(); return; }
    body.style.opacity    = '0';
    body.style.transform  = 'translateX(-12px)';
    body.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
    setTimeout(() => {
      showEventStep();
      body.style.opacity   = '';
      body.style.transform = '';
      body.style.transition = '';
      // Trigger reflow so transition runs in reverse
      void body.offsetHeight;
      body.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      body.style.opacity    = '1';
      body.style.transform  = 'translateX(0)';
      setTimeout(() => { body.style.transition = ''; }, 220);
    }, 180);
  }


  // ══════════════════════════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════════════════════════

  return {
    /** Call when entering the event creator panel. Always starts at step 1. */
    start() {
      selectedCollection = null;
      showMasterStep();
    },

    /** Call on resetAppState — clears selection but keeps session collections. */
    resetSelection() {
      selectedCollection = null;
    },

    /** Called by renderer's updateSteps() when railMode === 'event'. */
    syncRail() { syncRailHighlight(currentStep); },

    /** Expose for Commit D / E to read the chosen collection. */
    getSelectedCollection() { return selectedCollection; },
    getSessionCollections() { return sessionCollections; }
  };

})();
