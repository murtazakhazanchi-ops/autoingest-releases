/**
 * photographerRegistryProfile.js — photographer profile management in the Photographer Registry
 * tab of Metadata Management (AI-FEAT-063, AI-RM-014 Q5e-1).
 *
 *   - search aliases: add, remove, and "Keep as search alias" for a learned typing shortcut;
 *   - retire / reactivate a profile (a registry status, never a deletion);
 *   - explicit first registry record for a list name that has none yet;
 *   - Rename Photographer: PREVIEW ONLY. The main process validates the name and plans the
 *     current event's folders read-only; there is no apply path anywhere.
 * Every change goes through the shared confirm-and-save panel (photographerRegistryActions.js);
 * only actions the main process lists for the profile are drawn. Records are addressed by opaque
 * handles; the current event is Metadata Management's own context, never guessed.
 * All text is set with textContent, never parsed as HTML.
 */

(function () {
  'use strict';

  const api = window.api || {};
  const A = () => window.PhotographerRegistryActions;

  const KIND_CHOICES = [
    { id: 'spelling', label: 'Other spelling' },
    { id: 'abbreviation', label: 'Abbreviation' },
    { id: 'other', label: 'Other' },
  ];
  const STATUS_TEXT = { active: 'Active', retired: 'Retired' };
  const MATCH_TEXT = {
    'current-name': 'Current name', 'former-name': 'Former name', ambiguous: 'Name shared with another photographer',
    'similar-spelling': 'Similar spelling only', 'search-alias-only': 'Search alias only',
  };
  const FOLDER_REASON = {
    'no-current-event': 'Folder detection needs a selected event. Select an event in AutoIngest, then reopen Metadata Management.',
    'outside-archive-roots': 'The selected event is not inside a configured staging, NAS or archive location.',
    'not-an-event': 'The selected event folder has no readable event.json.',
    'invalid-event': 'The selected event could not be identified.',
    'event-unreadable': 'The selected event could not be read.',
    'name-not-valid': 'Folders are previewed once the proposed name is valid.',
  };
  const COPY_REASON = {
    'collection-link-unreadable': 'its collection link cannot be read',
    'collection-not-matched-to-nas': 'the collection is not matched to the NAS yet',
    'collection-link-stale': 'the collection link points to another NAS',
    'collection-link-outside-nas': 'the collection link points outside the NAS',
    'nas-copy-unreachable': 'the NAS copy cannot be reached',
  };
  const COPY_STATE = {
    available: 'Available', unavailable: 'Not reachable', 'qmz-excluded': 'QMZ structure — excluded',
    'event-json-missing': 'No event.json', 'event-json-unreadable': 'event.json unreadable',
  };
  const PLAN_TEXT = {
    'event-copy-unavailable': 'Not every copy of the event can be reached.',
    'qmz-structure-excluded': 'QMZ structures are outside photographer renaming.',
    'multiple-candidate-folders': 'Several folders could belong to this photographer; none is chosen automatically.',
    'target-collision': 'A folder with the new name already exists.',
    'event-json-components-differ': 'The copies list different components.',
    'scope-unreadable': 'A folder could not be read.',
    'invalid-new-name': 'The proposed name is not valid.',
    'no-event-copies': 'No copy of the event was found.',
    'new-name-is-current-name': 'The proposed name is the current name.',
    'event-copies-differ': 'The copies do not contain the same folders.',
    'qmz-scope-excluded': 'A QMZ part of the event is excluded.',
    'no-folder-to-rename': 'No folder of this photographer was found in the selected event.',
    'local-copy-not-determined': 'The event was opened from the NAS or archive; its local staging copy is not looked up.',
    'no-nas-configured': 'No NAS location is configured, so only the local copy is shown.',
    'unexpected-event-depth': 'The event is not at the expected collection/event depth, so its NAS copy is not looked up.',
  };

  const el = (...a) => A().el(...a);
  const button = (...a) => A().button(...a);

  function section(title, hint) {
    const s = el('section', 'pr-section');
    s.appendChild(el('h4', 'pr-section-title', title));
    if (hint) s.appendChild(el('p', 'pr-section-hint', hint));
    return s;
  }
  function fmtDay(day) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'Date not recorded';
    const d = new Date(`${day}T00:00:00Z`);
    return isNaN(d) ? day : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  const who = (h) => `${h.operator === 'Not recorded' ? 'Operator not recorded' : h.operator === 'Unknown operator' ? 'Operator not on this computer' : h.operator} · ${h.computer === 'this' ? 'this computer' : 'another computer'}`;
  function historyRow(day, what, by) {
    const r = el('div', 'pr-history-row');
    r.appendChild(el('span', 'pr-history-day', fmtDay(day)));
    r.appendChild(el('span', 'pr-history-what', what));
    r.appendChild(el('span', 'pr-history-who', by));
    return r;
  }

  // ── Header actions: status, rename preview, first registration ───────────────
  function headerActions(container, p, ctx) {
    const acts = p.actions || [];
    if (!acts.length) return;
    const bar = el('div', 'pr-actions pr-actions--section');
    if (acts.includes('register')) {
      const b = button('Create registry record', 'pr-action pr-action--primary', () => A().openDecision(bar, b, 'Create registry record', { action: 'register', photographer: p.handle }, ctx));
      bar.appendChild(b);
    }
    if (acts.includes('retire')) {
      const b = button('Retire profile', 'pr-action', () => A().openDecision(bar, b, 'Retire profile', { action: 'status', photographer: p.handle, status: 'retired' }, ctx), `Retire the profile of ${p.name}`);
      bar.appendChild(b);
    }
    if (acts.includes('reactivate')) {
      const b = button('Reactivate profile', 'pr-action pr-action--primary', () => A().openDecision(bar, b, 'Reactivate profile', { action: 'status', photographer: p.handle, status: 'active' }, ctx), `Reactivate the profile of ${p.name}`);
      bar.appendChild(b);
    }
    if (acts.includes('rename-preview')) {
      const b = button('Rename Photographer', 'pr-action', () => renamePanel(bar, b, p), `Preview renaming ${p.name}`);
      bar.appendChild(b);
    }
    container.appendChild(bar);
  }

  function statusSection(p) {
    const s = section('Status', 'Retired is a registry status, not a deletion: the photographer stays in the photographer list and in every archive. Retired profiles are not suggested from camera evidence.');
    const now = p.statusDisputed ? 'Needs review — marked retired and active on different computers' : (STATUS_TEXT[p.status] || 'Active');
    const f = el('div', 'pr-field');
    f.appendChild(el('span', 'pr-field-label', 'Current status'));
    f.appendChild(el('span', 'pr-field-value', now));
    s.appendChild(f);
    for (const h of p.statusHistory || []) s.appendChild(historyRow(h.day, `${h.settles ? 'Review settled: ' : ''}${h.status === 'retired' ? 'Retired' : 'Reactivated'}`, who(h)));
    if (!(p.statusHistory || []).length) s.appendChild(el('p', 'pr-empty-line', 'Never retired.'));
    return s;
  }

  // ── Search aliases ──────────────────────────────────────────────────────────
  function aliasForm(anchor, opener, p, ctx, prefill) {
    const panel = A().formPanel(anchor, opener, 'Add search alias');
    panel.appendChild(el('p', 'pr-decision-title', prefill ? 'Keep this typing shortcut as a search alias' : 'Add a search alias'));
    panel.appendChild(el('p', 'pr-section-hint', 'Another spelling or abbreviation the registry search should find. It is never a name or a folder name, and import autocomplete does not use it yet.'));
    const label = el('label', 'pr-choice-legend', 'Search alias');
    const input = el('input', 'pr-search');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 80;
    input.id = `prAliasText-${Date.now()}`;
    label.htmlFor = input.id;
    input.value = prefill || '';
    const kindLabel = el('label', 'pr-choice-legend', 'Kind');
    const kind = el('select', 'ms-scope-select');
    kind.id = `prAliasKind-${Date.now()}`;
    kindLabel.htmlFor = kind.id;
    KIND_CHOICES.forEach(k => { const o = el('option', null, k.label); o.value = k.id; kind.appendChild(o); });
    kind.value = prefill ? 'abbreviation' : 'spelling';
    [label, input, kindLabel, kind].forEach(n => panel.appendChild(n));
    const update = A().stepButtons(panel, { canNext: () => !!input.value.trim(), onNext: () => A().showPreview(panel, { action: 'alias-add', photographer: p.handle, alias: input.value, kind: kind.value }, ctx) });
    input.addEventListener('input', update);
    input.focus();
  }

  function aliasSection(p, ctx) {
    const s = section('Search aliases', 'Other spellings the registry uses to find this photographer in searches. Not names, never folder names, and never used to choose a photographer.');
    if (!p.searchAliases.length) s.appendChild(el('p', 'pr-empty-line', 'No search aliases.'));
    for (const a of p.searchAliases) {
      const row = el('div', 'pr-alias-row');
      row.appendChild(el('span', 'pr-chip', a.text));
      const meta = [`added ${fmtDay(a.addedDay)}`, a.operator ? who(a) : null].filter(Boolean).join(' · ');
      row.appendChild(el('span', 'pr-camera-meta', meta));
      if (a.sharedWith.length) row.appendChild(el('span', 'pr-alias-shared', `Also an alias of ${a.sharedWith.map(x => x.name).join(', ')} — searching shows all of them`));
      if (a.removable) {
        const b = button('Remove', 'pr-action', () => A().openDecision(row, b, 'Remove search alias', { action: 'alias-remove', photographer: p.handle, alias: a.text }, ctx), `Remove search alias ${a.text}`);
        row.appendChild(b);
      }
      s.appendChild(row);
    }
    if ((p.actions || []).includes('alias-add')) {
      const bar = el('div', 'pr-actions');
      const b = button('Add search alias', 'pr-action', () => aliasForm(bar, b, p, ctx), `Add a search alias for ${p.name}`);
      bar.appendChild(b);
      s.appendChild(bar);
    }
    if ((p.aliasHistory || []).length) {
      s.appendChild(el('p', 'pr-section-hint pr-subhead', 'Alias history'));
      for (const h of p.aliasHistory) s.appendChild(historyRow(h.day, `${h.action === 'added' ? 'Added' : 'Removed'} “${h.text}”`, who(h)));
    }
    return s;
  }

  function shortcutSection(p, ctx) {
    const s = section('Learned typing shortcuts', 'What operators typed in autocomplete before choosing this photographer. Shortcuts are not aliases or names and are never changed here.');
    if (!p.learnedShortcuts.length) s.appendChild(el('p', 'pr-empty-line', 'No typing shortcuts learned.'));
    for (const sc of p.learnedShortcuts) {
      const row = el('div', 'pr-alias-row');
      row.appendChild(el('span', 'pr-chip pr-chip--shortcut', sc.text));
      if (sc.promotable) {
        const b = button('Keep as search alias', 'pr-action', () => aliasForm(row, b, p, ctx, sc.text), `Keep the shortcut ${sc.text} as a search alias`);
        row.appendChild(b);
      }
      s.appendChild(row);
    }
    return s;
  }

  // ── Rename Photographer — preview only ──────────────────────────────────────
  function currentEvent() {
    /* global _msCurrentEventPath, _msCurrentEventName */
    const p = typeof _msCurrentEventPath === 'string' && _msCurrentEventPath ? _msCurrentEventPath : null;
    const n = typeof _msCurrentEventName === 'string' && _msCurrentEventName ? _msCurrentEventName : null;
    return { path: p, name: n };
  }

  function renamePanel(anchor, opener, p) {
    const panel = A().formPanel(anchor, opener, 'Rename Photographer — preview only');
    panel.classList.add('pr-rename');
    panel.appendChild(el('p', 'pr-decision-title', 'Rename Photographer'));
    const notice = el('p', 'pr-preview-notice', 'Preview only — applying photographer name changes will be available after archive safety checks are completed.');
    panel.appendChild(notice);
    const label = el('label', 'pr-choice-legend', 'Proposed new name');
    const input = el('input', 'pr-search');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 120;
    input.id = `prRenameText-${Date.now()}`;
    label.htmlFor = input.id;
    input.value = p.name;
    panel.appendChild(label);
    panel.appendChild(input);
    const out = el('div', 'pr-rename-result');
    out.setAttribute('aria-live', 'polite');
    panel.appendChild(out);
    const row = el('div', 'pr-decision-buttons');
    const apply = el('button', 'emm-btn-primary', 'Apply rename — not available yet');
    apply.type = 'button';
    apply.disabled = true;
    apply.setAttribute('aria-disabled', 'true');
    row.appendChild(button('Close', 'emm-btn-secondary', () => A().closePanel()));
    row.appendChild(apply);
    panel.appendChild(row);
    let seq = 0, timer = null;
    const ev = currentEvent();
    async function run() {
      const my = ++seq;
      let res;
      try { res = await api.photographerRegistryRenamePreview({ photographer: p.handle, name: input.value, eventPath: ev.path }); } catch { res = null; }
      if (my !== seq || !document.contains(out)) return;
      renderPreview(out, res, ev);
    }
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
    input.focus();
    input.select();
    run();
  }

  function fact(label, value) {
    const r = el('div', 'pr-field');
    r.appendChild(el('span', 'pr-field-label', label));
    r.appendChild(el('span', 'pr-field-value', value));
    return r;
  }
  function list(items, cls) { const ul = el('ul', cls || 'pr-consequences'); items.forEach(t => ul.appendChild(el('li', null, t))); return ul; }

  function renderPreview(out, res, ev) {
    while (out.firstChild) out.removeChild(out.firstChild);
    if (!res || !res.ok) { out.appendChild(el('p', 'pr-decision-error', A().errorText(res && res.reason))); return; }
    out.appendChild(fact('Current registered name', res.currentName));
    out.appendChild(fact('Original name', res.originalName || res.currentName));
    out.appendChild(fact('Former names', res.formerNames.length ? res.formerNames.join(', ') : 'None'));
    out.appendChild(fact('Would be saved as', res.proposed.storedName || '—'));
    out.appendChild(fact('Photographer list spelling', res.proposed.listSpelling ? `${res.proposed.listSpelling}${res.proposed.recapitalised ? ' (the list capitalises each word)' : ''}` : '—'));
    const verdict = el('p', `pr-rename-verdict pr-rename-verdict--${res.valid ? 'ok' : 'blocked'}`, res.valid ? 'This name passes validation and collision checks.' : 'This name cannot be used:');
    out.appendChild(verdict);
    if (res.blocking.length) out.appendChild(list(res.blocking.map(b => (b.name ? `${b.text} (“${b.name}”)` : b.text))));
    if (res.warnings.length) { out.appendChild(el('p', 'pr-subhead pr-section-hint', 'Worth checking')); out.appendChild(list(res.warnings.map(w => w.text))); }
    if (res.ambiguousAliases.length) {
      out.appendChild(el('p', 'pr-subhead pr-section-hint', 'Search aliases shared with other photographers'));
      out.appendChild(list(res.ambiguousAliases.map(a => `“${a.text}” — also ${a.sharedWith.join(', ')}`)));
    }
    out.appendChild(folderSection(res.folders, ev));
    const pre = el('details', 'pr-prereq');
    pre.appendChild(el('summary', null, 'Why applying is not available yet'));
    pre.appendChild(list(res.unmet.map(u => `${u.id} — ${u.title}`)));
    out.appendChild(pre);
  }

  function folderSection(f, ev) {
    const s = el('div', 'pr-rename-folders');
    s.appendChild(el('p', 'pr-subhead pr-section-hint', ev.name ? `Folders in the current event: ${ev.name}` : 'Folders in the current event'));
    if (!f || !f.available) { s.appendChild(el('p', 'pr-empty-line', FOLDER_REASON[f && f.reason] || 'Folder detection is not available.')); return s; }
    const notes = [...f.notes, ...f.warnings].map(k => PLAN_TEXT[k]).filter(Boolean);
    for (const cp of f.copies) {
      const box = el('div', 'pr-copy');
      const why = cp.reason && COPY_REASON[cp.reason] ? ` — ${COPY_REASON[cp.reason]}` : '';
      box.appendChild(el('p', 'pr-copy-title', `${cp.label}: ${COPY_STATE[cp.state] || cp.state}${why}`));
      for (const sc of cp.scopes) {
        const scopeName = sc.scope ? `Component ${sc.scope}` : 'Event folder';
        if (sc.state === 'qmz-excluded') { box.appendChild(el('p', 'pr-empty-line', `${scopeName}: QMZ structure — excluded`)); continue; }
        if (sc.state !== 'ok') { box.appendChild(el('p', 'pr-empty-line', `${scopeName}: ${sc.state === 'missing' ? 'not present' : 'could not be read'}`)); continue; }
        if (!sc.candidates.length) { box.appendChild(el('p', 'pr-empty-line', `${scopeName}: no folder of this photographer`)); continue; }
        for (const c of sc.candidates) {
          const r = el('div', 'pr-folder-row');
          r.appendChild(el('span', 'pr-folder-scope', scopeName));
          r.appendChild(el('span', 'pr-folder-names', `${c.folderName} → ${c.proposedFolderName}`));
          const state = c.unchanged ? 'Already has this name'
            : c.blockers.length ? 'Blocked — a folder with the new name already exists'
              : c.proposed ? `Eligible for future rename, pending archive safety infrastructure${c.sequencePrefix ? ` (keeps ${c.sequencePrefix})` : ''}`
                : sc.multipleCandidates && (c.match === 'current-name' || c.match === 'former-name') ? 'Possible match — several candidates, none chosen'
                  : 'Not selected — never renamed automatically';
          r.appendChild(el('span', `pr-folder-state${c.proposed ? ' pr-folder-state--ok' : ''}`, `${MATCH_TEXT[c.match] || c.match} · ${state}`));
          box.appendChild(r);
        }
        for (const x of sc.excluded) box.appendChild(el('p', 'pr-empty-line', `${x.folderName}: QMZ structure — excluded`));
      }
      s.appendChild(box);
    }
    const blockers = f.blockers.map(k => PLAN_TEXT[k] || k);
    if (blockers.length) { s.appendChild(el('p', 'pr-subhead pr-section-hint', 'Would prevent renaming')); s.appendChild(list(blockers)); }
    if (notes.length) s.appendChild(list(notes, 'pr-consequences pr-muted-list'));
    return s;
  }

  window.PhotographerRegistryProfile = Object.freeze({ headerActions, statusSection, aliasSection, shortcutSection });
})();
