'use strict';

// ── EventMgmt — unified event management modal ─────────────────────────────
// Manages the #eventMgmtModal overlay: open/close, mode switching,
// collection bar sync, button visibility, dirty-state guard, and focus.

const EventMgmt = (() => {

  let _isOpen    = false;
  let _mode      = 'select'; // 'select' | 'create' | 'edit' | 'repair'
  let _triggerEl = null;     // element that had focus when the modal opened

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $overlay     = () => document.getElementById('eventMgmtModal');
  const $collName    = () => document.getElementById('emmCollName');
  const $closeBtn    = () => document.getElementById('emmCloseBtn');
  const $editBtn     = () => document.getElementById('emmEditBtn');
  const $continueBtn = () => document.getElementById('emmContinueBtn');
  const $createBtn   = () => document.getElementById('emmCreateBtn');
  const $saveBtn     = () => document.getElementById('emmSaveBtn');
  const $repairBtn   = () => document.getElementById('emmRepairBtn');

  // ── Footer sync ────────────────────────────────────────────────────────────

  function _syncFooterButtons() {
    [$editBtn(), $continueBtn(), $createBtn(), $saveBtn(), $repairBtn()].forEach(b => {
      if (b) b.style.display = 'none';
    });

    switch (_mode) {
      case 'master':
        // Footer shows only Back — inline Continue button lives inside the form.
        break;
      case 'select':
        if ($continueBtn()) { $continueBtn().style.display = ''; $continueBtn().disabled = true; }
        break;
      case 'create':
        if ($createBtn()) { $createBtn().style.display = ''; $createBtn().disabled = true; }
        break;
      case 'edit':
        if ($saveBtn()) $saveBtn().style.display = '';
        break;
      case 'repair':
        if ($repairBtn()) { $repairBtn().style.display = ''; $repairBtn().disabled = true; }
        break;
    }
  }

  // ── Collection bar sync — always reads live from EventCreator ──────────────

  function _syncCollBar() {
    const el = $collName();
    if (el) el.textContent = EventCreator.getSelectedCollection() || '—';
  }

  // ── Dirty-state guard ──────────────────────────────────────────────────────
  // Returns true if it is safe to close (user confirmed or form is clean).

  function _okToClose() {
    if (!EventCreator.isDirty()) return true;
    return window.confirm('You have unsaved changes. Discard them?');
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function open(opts) {
    const { mode = 'select' } = opts || {};
    console.log('[EventMgmt] open mode:', mode);
    _isOpen = true;
    _mode   = mode;

    // Capture the trigger element for focus restoration on close
    _triggerEl = (document.activeElement && document.activeElement !== document.body)
      ? document.activeElement
      : (document.getElementById('heroSecondaryBtn') || document.getElementById('heroPrimaryBtn'));

    _syncCollBar();
    _syncFooterButtons();
    $overlay()?.classList.add('open');
    document.body.style.overflow = 'hidden'; // body scroll lock

    // Move focus into the modal after the transition settles
    setTimeout(() => {
      const firstInput = document.getElementById('ecBody')?.querySelector('input, [tabindex="0"]');
      (firstInput || $closeBtn())?.focus();
    }, 200);
  }

  function close() {
    if (!_isOpen) return;
    _isOpen = false;
    $overlay()?.classList.remove('open');
    document.body.style.overflow = ''; // restore body scroll

    // Return focus to the element that triggered open.
    // Re-query by id if the stored reference was detached by a DOM re-render
    // (e.g. showLanding() rebuilds #heroCard via innerHTML, detaching old elements).
    const tgt = _triggerEl;
    _triggerEl = null;
    setTimeout(() => {
      const el = (tgt?.isConnected ? tgt : null)
        || (tgt?.id ? document.getElementById(tgt.id) : null)
        || document.getElementById('heroSecondaryBtn')
        || document.getElementById('heroPrimaryBtn');
      el?.focus();
    }, 50);
  }

  // requestClose — the single dirty-guarded exit point.
  // Called by close button, Esc key, backdrop click, and back button in SELECT mode.
  // Dispatches eventmgmt:requestClose so renderer.js can run its teardown.
  function requestClose() {
    if (!_okToClose()) return;
    document.dispatchEvent(new CustomEvent('eventmgmt:requestClose'));
  }

  // handleBack — smart back button behavior:
  //   SELECT views (masterStep / eventList)  → close modal
  //   CREATE / EDIT / PREVIEW                → dirty-check, then delegate to EventCreator's internal nav
  function handleBack() {
    const nav = EventCreator.getNavScreen();
    if (nav === 'masterStep' || nav === 'eventList') {
      requestClose();
      return;
    }
    // Dirty guard before any internal back navigation (covers eventForm in create/edit mode).
    if (EventCreator.isDirty() && !window.confirm('You have unsaved changes. Discard them?')) return;
    if (!EventCreator.navigateBack()) requestClose();
  }

  function setMode(mode) {
    _mode = mode;
    _syncFooterButtons();
    _syncCollBar();
  }

  function isOpen()    { return _isOpen; }
  function getMode()   { return _mode; }

  // ── Internal event wiring ──────────────────────────────────────────────────

  // Backdrop click — only fires when the user clicks the scrim, not inside .emm-box
  document.getElementById('eventMgmtModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('eventMgmtModal')) requestClose();
  });

  return { open, close, requestClose, handleBack, setMode, isOpen, getMode };

})();
