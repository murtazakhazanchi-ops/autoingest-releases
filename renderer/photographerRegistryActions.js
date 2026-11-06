/**
 * photographerRegistryActions.js — camera-association decisions in the Photographer Registry tab
 * of Metadata Management (AI-FEAT-063, AI-RM-014 Q5d).
 *
 * Draws only what the main process allows: each association and review item arrives with its
 * permitted actions, and nothing is offered otherwise. A decision is always two steps — the main
 * process writes the preview (what changes, what it means for future suggestions), the operator
 * confirms, then it is saved at once. Success is shown only after the main process reports the
 * registry durably written; on any refusal the current view stays and a plain explanation is shown.
 * Records are addressed by opaque handles only; operator, IDs and revisions never pass through here.
 * All text is set with textContent, never parsed as HTML.
 *
 * Used by photographerRegistryUI.js through window.PhotographerRegistryActions.
 */

(function () {
  'use strict';

  const api = window.api || {};

  const ACTION_LABEL = {
    confirm: 'Confirm',
    reject: 'Not this photographer',
    retire: 'No longer associated',
    correct: 'Correct association',
    resolve: 'Review conflict',
  };
  const ACTION_HINT = {
    confirm: 'Confirm that this photographer uses this camera',
    reject: 'Mark this camera as not this photographer\'s',
    retire: 'Mark this camera as no longer used by this photographer',
    correct: 'Move this camera to a different photographer',
    resolve: 'Settle the disagreeing decisions for this photographer',
  };
  const OUTCOME_CHOICES = [
    { id: 'confirm', label: 'Confirmed — this photographer uses this camera' },
    { id: 'reject', label: 'Not this photographer — they never used it' },
    { id: 'retire', label: 'No longer associated — they used it before, not any more' },
  ];
  const UNAVAILABLE_TEXT = {
    'no-operator': 'Select the active operator in AutoIngest to record camera decisions. Each decision is saved with the operator\'s name.',
    'no-registry': 'No camera history has been recorded yet, so there is nothing to decide here.',
    'registry-locked': 'Another AutoIngest process is updating the registry. Camera decisions are available again once it finishes.',
    'computer-not-ready': 'AutoIngest is still finishing its first start on this computer. Reopen this tab in a moment to record camera decisions.',
    'read-only': 'Camera decisions are not available.',
  };
  const ERROR_TEXT = {
    'no-operator': 'No active operator is selected. Select one in AutoIngest and try again. Nothing was changed.',
    'operator-changed': 'The active operator changed. Review the decision again before saving.',
    'no-registry': 'There is no registry to record this in. Nothing was changed.',
    'registry-locked': 'Another AutoIngest process is updating the registry. Try again in a moment. Nothing was changed.',
    'registry-read-only': 'The registry is read-only on this computer, so the decision could not be saved. Nothing was changed.',
    'registry-changed': 'The registry changed since this was shown. The current details are shown again — review them and decide again.',
    'stale-view': 'The view was refreshed since this was shown. Review the current details and decide again.',
    'expired-confirmation': 'This confirmation expired. Review the current details and decide again.',
    'not-available-for-state': 'This decision no longer fits the camera\'s current state. Review the current details.',
    'already-associated': 'That photographer is already associated with this camera.',
    'target-needs-review': 'That photographer\'s link to this camera needs review first.',
    'key-unavailable': 'Camera-body matching is unavailable on this computer, so camera records cannot be linked.',
    'write-failed': 'The decision could not be saved. Nothing was changed.',
    'computer-not-ready': 'AutoIngest is still finishing its first start on this computer. Try again in a moment. Nothing was changed.',
    'unsupported-action': 'This decision is not available here.',
  };
  const errorText = (reason) => ERROR_TEXT[reason]
    || (/^registry-/.test(reason || '') ? 'The registry cannot be changed safely right now. Nothing was changed.' : 'The decision could not be recorded. Nothing was changed.');

  let open = null; // { panel, token, busy } — one decision panel at a time

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function button(text, cls, onClick, label) {
    const b = el('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  /** Close the open decision panel; an unused confirmation is released in the main process. */
  function closePanel({ restoreFocus = true } = {}) {
    if (!open) return;
    const { panel, token, opener } = open;
    open = null;
    if (token) { try { api.photographerRegistryCancel(token); } catch { /* ignore */ } }
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    if (restoreFocus && opener && document.contains(opener)) opener.focus();
  }

  function panelKeys(panel) {
    panel.addEventListener('keydown', (e) => {
      // Keys inside the panel never reach main-window shortcuts or close the modal.
      e.stopPropagation();
      if (e.key === 'Escape' && open && !open.busy) { e.preventDefault(); closePanel(); }
    });
  }

  function newPanel(anchor, opener, title) {
    closePanel({ restoreFocus: false });
    // A new decision replaces the previous result line, so an old message is never read as this one's.
    const pane = anchor.closest('.pr-detail');
    if (pane) pane.querySelectorAll('.pr-result').forEach(n => n.remove());
    const panel = el('div', 'pr-decision');
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', title);
    panelKeys(panel);
    anchor.after(panel);
    open = { panel, token: null, opener, busy: false };
    return panel;
  }

  function clearPanel(panel) { while (panel.firstChild) panel.removeChild(panel.firstChild); }

  function showError(panel, reason) {
    let box = panel.querySelector('.pr-decision-error');
    if (!box) { box = el('p', 'pr-decision-error'); box.setAttribute('role', 'alert'); panel.appendChild(box); }
    box.textContent = errorText(reason);
  }

  // ── Step 1: choices that need the operator's input before a preview ──────────
  function radioGroup(name, legend, choices, onChange) {
    const fs = el('fieldset', 'pr-choice');
    fs.appendChild(el('legend', 'pr-choice-legend', legend));
    choices.forEach((c, i) => {
      const lab = el('label', 'pr-choice-option');
      const input = el('input');
      input.type = 'radio';
      input.name = name;
      input.value = c.id;
      input.addEventListener('change', () => onChange(c.id));
      lab.appendChild(input);
      lab.appendChild(el('span', null, c.label));
      fs.appendChild(lab);
      if (i === 0) input.dataset.first = '1';
    });
    return fs;
  }

  /** Photographer picker (search, then choose). Offers only photographers with a registry identity. */
  function picker(panel, { exclude, onPick }) {
    const wrap = el('div', 'pr-picker');
    const label = el('label', 'pr-choice-legend', 'Photographer');
    const input = el('input', 'pr-search');
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Search the photographer list';
    input.id = `prPick-${Math.random().toString(36).slice(2, 8)}`;
    label.htmlFor = input.id;
    const list = el('div', 'pr-picker-list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Matching photographers');
    const note = el('p', 'pr-picker-note');
    let seq = 0, timer = null, chosen = null;
    async function run() {
      const q = input.value.trim();
      const my = ++seq;
      while (list.firstChild) list.removeChild(list.firstChild);
      if (!q) { note.textContent = 'Type part of a name.'; return; }
      let res;
      try { res = await api.photographerRegistrySearch({ query: q, filter: 'all', sort: 'name' }); } catch { res = null; }
      if (my !== seq) return;
      const rows = res && res.ok ? res.results.filter(r => r.assignable && !exclude.includes(r.handle)).slice(0, 8) : [];
      const pending = res && res.ok ? res.results.filter(r => !r.assignable).length : 0;
      note.textContent = rows.length ? '' : pending ? 'Only photographers already used in an import can be chosen. A new name gets its record at its first import.' : 'No photographer matches.';
      rows.forEach((r) => {
        const opt = button(r.name, 'pr-picker-option', () => {
          chosen = r;
          list.querySelectorAll('.pr-picker-option').forEach(n => n.setAttribute('aria-selected', String(n === opt)));
          onPick(r);
        });
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-selected', String(!!chosen && chosen.handle === r.handle));
        list.appendChild(opt);
      });
    }
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 120); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { const f = list.querySelector('.pr-picker-option'); if (f) { e.preventDefault(); f.focus(); } }
    });
    list.addEventListener('keydown', (e) => {
      const opts = [...list.querySelectorAll('.pr-picker-option')];
      const i = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && i < opts.length - 1) { e.preventDefault(); opts[i + 1].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? opts[i - 1] : input).focus(); }
    });
    wrap.appendChild(label);
    wrap.appendChild(input);
    wrap.appendChild(list);
    wrap.appendChild(note);
    panel.appendChild(wrap);
    note.textContent = 'Type part of a name.';
    return input;
  }

  function stepButtons(panel, { nextLabel = 'Review', canNext, onNext }) {
    const row = el('div', 'pr-decision-buttons');
    const next = button(nextLabel, 'emm-btn-primary', onNext);
    next.disabled = !canNext();
    row.appendChild(button('Cancel', 'emm-btn-secondary', () => closePanel()));
    row.appendChild(next);
    panel.appendChild(row);
    return () => { next.disabled = !canNext(); };
  }

  // ── Step 2: the main process's preview, then Confirm and save ────────────────
  async function preview(panel, request, ctx) {
    clearPanel(panel);
    panel.setAttribute('aria-busy', 'true');
    panel.appendChild(el('p', 'pr-decision-wait', 'Preparing the decision…'));
    let prep;
    try { prep = await api.photographerRegistryPrepare(request); } catch { prep = null; }
    if (!open || open.panel !== panel) return;
    panel.removeAttribute('aria-busy');
    clearPanel(panel);
    if (!prep || !prep.ok) {
      showError(panel, prep && prep.reason);
      const row = el('div', 'pr-decision-buttons');
      row.appendChild(button('Close', 'emm-btn-secondary', () => closePanel()));
      panel.appendChild(row);
      row.firstChild.focus();
      return;
    }
    open.token = prep.token;
    const pv = prep.preview;
    panel.appendChild(el('p', 'pr-decision-title', pv.title));
    if (pv.camera) {
      const cam = `${pv.camera.make} ${pv.camera.model}${pv.camera.nickname ? ` (${pv.camera.nickname})` : ''}`;
      panel.appendChild(fact('Camera', cam));
    }
    const table = el('div', 'pr-change');
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', 'Proposed change');
    const head = el('div', 'pr-change-row pr-change-head');
    head.setAttribute('role', 'row');
    ['', 'Now', 'After saving'].forEach((h) => { const c = el('span', null, h); c.setAttribute('role', 'columnheader'); head.appendChild(c); });
    table.appendChild(head);
    for (const r of pv.rows) {
      const row = el('div', 'pr-change-row');
      row.setAttribute('role', 'row');
      [[r.label, 'pr-change-who'], [r.current, 'pr-change-now'], [r.proposed, 'pr-change-after']].forEach(([t, c]) => { const n = el('span', c, t); n.setAttribute('role', 'cell'); row.appendChild(n); });
      table.appendChild(row);
    }
    panel.appendChild(table);
    const ul = el('ul', 'pr-consequences');
    pv.consequences.forEach(c => ul.appendChild(el('li', null, c)));
    panel.appendChild(ul);
    if (pv.caveat) panel.appendChild(el('p', 'pr-decision-caveat', pv.caveat));
    panel.appendChild(el('p', 'pr-decision-operator', `Recorded as ${prep.operator}.`));
    const row = el('div', 'pr-decision-buttons');
    const save = button('Confirm and save', 'emm-btn-primary', () => commit(panel, save, ctx));
    row.appendChild(button('Cancel', 'emm-btn-secondary', () => closePanel()));
    row.appendChild(save);
    panel.appendChild(row);
    // Keep the question in view: show the panel from its top, then focus the save button.
    panel.scrollIntoView({ block: 'nearest' });
    save.focus({ preventScroll: true });
  }

  function fact(label, value) {
    const r = el('div', 'pr-field');
    r.appendChild(el('span', 'pr-field-label', label));
    r.appendChild(el('span', 'pr-field-value', value));
    return r;
  }

  async function commit(panel, save, ctx) {
    if (!open || open.busy || !open.token) return;
    open.busy = true;
    const token = open.token;
    panel.setAttribute('aria-busy', 'true');
    panel.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    save.textContent = 'Saving…';
    let res;
    try { res = await api.photographerRegistryCommit(token); } catch { res = null; }
    if (!open || open.panel !== panel) return;
    open.token = null; // used: never cancelled or re-sent
    open.busy = false;
    panel.removeAttribute('aria-busy');
    if (res && res.ok) {
      open = null;
      ctx.onResult(res, { ok: true, text: res.message });
      return;
    }
    const reason = res && res.reason;
    if (res && res.overview) {
      // The registry changed underneath: show the current state, explain, decide again.
      open = null;
      ctx.onResult(res, { ok: false, text: errorText(reason) });
      return;
    }
    panel.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    save.textContent = 'Confirm and save';
    save.disabled = true; // this confirmation is spent; Cancel and start again
    showError(panel, reason);
  }

  // ── Entry points used by photographerRegistryUI.js ──────────────────────────
  /** Note shown once in camera detail when decisions are unavailable. */
  function unavailableNote(management) {
    if (!management || management.available) return null;
    const text = UNAVAILABLE_TEXT[management.reason] || 'Camera decisions are not available while the registry cannot be changed safely.';
    return el('p', 'pr-manage-note', text);
  }

  /** Buttons for one association row of a camera. */
  function associationActions(rowNode, camera, assoc, ctx) {
    if (!assoc.actions || !assoc.actions.length || !assoc.photographer.handle) return;
    const bar = el('div', 'pr-actions');
    for (const a of assoc.actions) {
      const label = ACTION_LABEL[a];
      if (!label) continue;
      const b = button(label, `pr-action${a === 'confirm' || a === 'resolve' ? ' pr-action--primary' : ''}`, () => start(a), `${ACTION_HINT[a]}: ${assoc.photographer.name}`);
      bar.appendChild(b);
      function start(action) {
        const base = { camera: camera.handle, photographer: assoc.photographer.handle };
        const panel = newPanel(bar, b, label);
        if (action === 'confirm' || action === 'reject' || action === 'retire') { preview(panel, { ...base, action }, ctx); return; }
        if (action === 'resolve') {
          panel.appendChild(el('p', 'pr-decision-title', `Settle the decisions for ${assoc.photographer.name}`));
          panel.appendChild(el('p', 'pr-section-hint', 'Different decisions were recorded without seeing each other. Choose what is true now; every earlier decision stays in the history.'));
          let outcome = null;
          const refresh = () => update();
          panel.appendChild(radioGroup(`prOutcome-${Date.now()}`, 'This camera and photographer are:', OUTCOME_CHOICES, (v) => { outcome = v; refresh(); }));
          const update = stepButtons(panel, { canNext: () => !!outcome, onNext: () => preview(panel, { ...base, action, outcome }, ctx) });
          const first = panel.querySelector('input[data-first]');
          if (first) first.focus();
          return;
        }
        if (action === 'correct') {
          panel.appendChild(el('p', 'pr-decision-title', `Correct this camera's photographer`));
          panel.appendChild(el('p', 'pr-section-hint', 'Use this when the camera was recorded for the wrong photographer. If the camera is shared, use “Add another photographer” instead.'));
          let target = null, prior = null;
          const input = picker(panel, { exclude: [assoc.photographer.handle], onPick: (r) => { target = r; update(); } });
          panel.appendChild(radioGroup(`prPrior-${Date.now()}`, `What about ${assoc.photographer.name}?`, [
            { id: 'reject', label: `${assoc.photographer.name} never used this camera` },
            { id: 'retire', label: `${assoc.photographer.name} used it before, but not any more` },
          ], (v) => { prior = v; update(); }));
          const update = stepButtons(panel, { canNext: () => !!target && !!prior, onNext: () => preview(panel, { ...base, action, target: target.handle, priorOutcome: prior }, ctx) });
          input.focus();
        }
      }
    }
    rowNode.appendChild(bar);
  }

  /** "Add another photographer" for a camera (a shared camera keeps its existing photographers). */
  function cameraActions(sectionNode, camera, ctx) {
    if (!camera.actions || !camera.actions.includes('add-photographer')) return;
    const active = camera.associations.filter(a => ['confirmed', 'observed', 'disputed'].includes(a.state));
    const text = active.length ? 'Add another photographer' : 'Add photographer';
    const bar = el('div', 'pr-actions pr-actions--section');
    const b = button(text, 'pr-action', () => {
      const panel = newPanel(bar, b, text);
      panel.appendChild(el('p', 'pr-decision-title', text));
      panel.appendChild(el('p', 'pr-section-hint', active.length
        ? 'For a camera that several photographers use. The photographers already associated stay associated.'
        : 'Record which photographer uses this camera.'));
      let target = null;
      const input = picker(panel, { exclude: active.map(a => a.photographer.handle).filter(Boolean), onPick: (r) => { target = r; update(); } });
      const update = stepButtons(panel, { canNext: () => !!target, onNext: () => preview(panel, { action: 'add-photographer', camera: camera.handle, target: target.handle }, ctx) });
      input.focus();
    }, `${text} to ${camera.make} ${camera.model}`);
    bar.appendChild(b);
    sectionNode.appendChild(bar);
  }

  /** Resolution controls for a review item, or the reason it stays read-only. */
  function reviewActions(container, item, ctx) {
    const res = item.resolution || { supported: false, options: [] };
    const s = el('section', 'pr-section');
    s.appendChild(el('h4', 'pr-section-title', 'Resolve'));
    if (!res.supported) {
      s.appendChild(el('p', 'pr-section-hint', res.note || (ctx.management && !ctx.management.available
        ? (UNAVAILABLE_TEXT[ctx.management.reason] || 'Not available right now.')
        : 'This cannot be settled here. Nothing is merged, chosen or changed automatically.')));
      container.appendChild(s);
      return;
    }
    s.appendChild(el('p', 'pr-section-hint', 'Choose what is true. Your decision is recorded with your operator name; earlier records stay in the history.'));
    const bar = el('div', 'pr-actions');
    for (const o of res.options) {
      const b = button(o.label, 'pr-action', () => preview(newPanel(bar, b, o.label), { action: 'resolve-review', review: item.id, outcome: o.id }, ctx));
      bar.appendChild(b);
    }
    s.appendChild(bar);
    if (res.note) s.appendChild(el('p', 'pr-section-hint', res.note));
    container.appendChild(s);
  }

  /** Concise result line at the top of the detail pane. */
  function resultLine(result) {
    const p = el('p', `pr-result pr-result--${result.ok ? 'ok' : 'attention'}`, result.text);
    p.setAttribute('role', result.ok ? 'status' : 'alert');
    return p;
  }

  window.PhotographerRegistryActions = Object.freeze({ associationActions, cameraActions, reviewActions, unavailableNote, resultLine, closePanel });
})();
