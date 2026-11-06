/**
 * photographerRegistryUI.js — Photographer Registry tab of Metadata Management
 * (AI-FEAT-063, AI-RM-014 Q5c browsing; Q5d camera decisions).
 *
 * Shows photographers, cameras and review items from the main process's privacy-safe view
 * (photographerRegistryBrowser). Records are addressed only by opaque handles. Camera-association
 * decisions and supported conflict resolutions are drawn by photographerRegistryActions.js, only
 * where the main process allows them; nothing here renames, edits aliases, retires profiles or
 * creates records. All text is set with textContent, never parsed as HTML.
 *
 * Entry point: window.PhotographerRegistryUI.onShow(), called by _msSetTab when the tab is
 * selected. Data loads lazily on each show; every request is guarded by a request id so a
 * slow response never overwrites a newer one.
 */

(function () {
  'use strict';

  const api = window.api || {};
  const $ = (id) => document.getElementById(id);

  const IDENTITY_TEXT = {
    shipped: 'From the shipped photographer list',
    registered: 'Added to the photographer list',
    'pending-first-use': 'Not used in an import yet',
    ambiguous: 'Name matches several photographer records',
    referenced: 'Known from registry history only',
  };
  const MATCHED_ON_TEXT = {
    'former-name': 'Former name',
    'search-alias': 'Search alias',
    'learned-shortcut': 'Typing shortcut',
    camera: 'Camera',
  };
  const STATE_ORDER = ['confirmed', 'observed', 'disputed', 'rejected', 'retired'];
  const HISTORY_KIND_TEXT = {
    observation: 'Import', confirmation: 'Confirmed', rejection: 'Not this photographer', retirement: 'No longer used',
    correction: 'Correction', resolution: 'Review settled', link: 'Camera link',
  };
  const actions = () => window.PhotographerRegistryActions || null;

  let view = 'photographers';            // photographers | cameras | review
  let overview = null;
  let rows = [];                         // current list rows for the active view
  let activeIndex = -1;
  let selected = { photographers: null, cameras: null, review: null };
  let loadSeq = 0, searchSeq = 0, detailSeq = 0;
  let searchTimer = null;
  let wired = false;
  let pendingResult = null;              // Q5d: result line to show above the next detail render

  // ── DOM helpers ───────────────────────────────────────────────────────────────
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function fmtDay(day) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const d = new Date(`${day}T00:00:00Z`);
    return isNaN(d) ? day : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  const operatorText = (name) => (name === 'Not recorded' ? 'Operator not recorded' : name === 'Unknown operator' ? 'Operator not on this computer' : name);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

  function section(title, hint) {
    const s = el('section', 'pr-section');
    const h = el('h4', 'pr-section-title', title);
    s.appendChild(h);
    if (hint) s.appendChild(el('p', 'pr-section-hint', hint));
    return s;
  }
  function emptyLine(text) { return el('p', 'pr-empty-line', text); }
  function field(label, value) {
    const r = el('div', 'pr-field');
    r.appendChild(el('span', 'pr-field-label', label));
    r.appendChild(el('span', 'pr-field-value', value));
    return r;
  }
  function chip(text, cls) { return el('span', `pr-chip${cls ? ` ${cls}` : ''}`, text); }
  function linkButton(text, onClick, label) {
    const b = el('button', 'pr-link', text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  // ── Status notices ───────────────────────────────────────────────────────────
  function statusNotices(ov) {
    const out = [];
    const st = (ov && ov.status) || { state: 'unreadable' };
    const add = (tone, text) => out.push({ tone, text });
    switch (st.state) {
      case 'missing':
        add('info', 'No camera or name history has been recorded yet. Photographers from the photographer list are shown; camera history appears here after imports.');
        break;
      case 'missing-backups-present':
        add('attention', 'The registry file is missing, but backups exist. Nothing has been reset or replaced. Camera and name history are not shown until this is looked at.');
        break;
      case 'locked':
        add('info', 'Another AutoIngest process is updating the registry. Showing the last saved state.');
        break;
      case 'corrupt':
        add('attention', 'The registry file could not be read as a valid registry. It has not been changed or reset. Photographers are shown without camera or name history.');
        break;
      case 'incompatible':
        add('attention', st.reason === 'newer-schema-version'
          ? 'The registry was saved by a newer version of AutoIngest. It is not changed here. Photographers are shown without camera or name history.'
          : 'The registry uses an older format this version cannot read. It is not changed here. Photographers are shown without camera or name history.');
        break;
      case 'unreadable':
        add('attention', 'The registry could not be read right now (for example, a permissions or disk problem). Nothing was changed. Imports are not affected.');
        break;
      default: break;
    }
    if (st.learningEnabled === false) add('info', 'Photographer learning is turned off. Existing history is shown; new imports are not added.');
    if (Number.isInteger(st.pendingLearning) && st.pendingLearning > 0) add('info', `${plural(st.pendingLearning, 'import')} waiting to be learned. ${st.pendingLearning === 1 ? 'It appears' : 'They appear'} here once learning finishes.`);
    if (st.bodyMatching === 'unavailable') add('attention', 'Camera-body matching is unavailable on this computer because its secure key is missing or cannot be used. Camera history can still be browsed.');
    if (st.integrityConflicts > 0) add('attention', `${plural(st.integrityConflicts, 'registry record')} ${st.integrityConflicts === 1 ? 'is' : 'are'} held aside for review and not used.`);
    if (st.unknownEventTypes > 0) add('info', 'Some registry records come from a newer version of AutoIngest and are kept but not shown.');
    return out;
  }

  function renderStatus() {
    const box = $('prStatus');
    if (!box) return;
    clear(box);
    for (const n of statusNotices(overview)) box.appendChild(el('p', `pr-notice pr-notice--${n.tone}`, n.text));
    box.hidden = !box.firstChild;
  }

  function renderViewTabs() {
    const reviewCount = overview && Array.isArray(overview.reviewItems) ? overview.reviewItems.length : 0;
    const counts = {
      photographers: overview && overview.counts ? overview.counts.photographers : null,
      cameras: overview && overview.counts ? overview.counts.cameras : null,
      review: reviewCount,
    };
    document.querySelectorAll('#msTabPhotographers [data-pr-view]').forEach((b) => {
      const v = b.dataset.prView;
      const on = v === view;
      b.classList.toggle('pr-view-active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      const c = b.querySelector('.pr-view-count');
      if (c) c.textContent = counts[v] === null || counts[v] === undefined ? '' : String(counts[v]);
      if (v === 'review') b.classList.toggle('pr-view-attention', reviewCount > 0);
    });
    const controls = $('prPhotographerControls');
    if (controls) controls.hidden = view !== 'photographers';
    const search = $('prSearch');
    if (search) {
      search.placeholder = view === 'cameras' ? 'Search make, model or nickname' : view === 'review' ? 'Search review items' : 'Search names, former names, aliases or cameras';
      search.setAttribute('aria-label', search.placeholder);
    }
    const list = $('prList');
    if (list) list.setAttribute('aria-label', view === 'cameras' ? 'Cameras' : view === 'review' ? 'Review items' : 'Photographers');
  }

  // ── List ─────────────────────────────────────────────────────────────────────
  function rowId(i) { return `prRow-${i}`; }

  function renderList(emptyText) {
    const list = $('prList');
    if (!list) return;
    clear(list);
    list.removeAttribute('aria-activedescendant');
    if (!rows.length) {
      list.appendChild(el('p', 'pr-list-empty', emptyText));
      activeIndex = -1;
      return;
    }
    rows.forEach((r, i) => {
      const item = el('div', 'pr-row');
      item.id = rowId(i);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(r.id === selected[view]));
      if (r.id === selected[view]) item.classList.add('pr-row-selected');
      const top = el('div', 'pr-row-top');
      top.appendChild(el('span', 'pr-row-title', r.title));
      if (r.flag) top.appendChild(el('span', 'pr-flag', r.flag));
      item.appendChild(top);
      if (r.sub) item.appendChild(el('div', 'pr-row-sub', r.sub));
      item.addEventListener('mousedown', (e) => e.preventDefault());
      item.addEventListener('click', () => { setActive(i); list.focus(); select(r.id); });
      list.appendChild(item);
    });
    const sel = rows.findIndex(r => r.id === selected[view]);
    setActive(sel >= 0 ? sel : -1, true);
  }

  function setActive(i, quiet) {
    const list = $('prList');
    if (!list) return;
    const prev = list.querySelector('.pr-row-active');
    if (prev) prev.classList.remove('pr-row-active');
    activeIndex = i;
    if (i < 0 || !rows[i]) { list.removeAttribute('aria-activedescendant'); return; }
    const node = $(rowId(i));
    if (node) {
      node.classList.add('pr-row-active');
      list.setAttribute('aria-activedescendant', node.id);
      if (!quiet || node.offsetTop < list.scrollTop || node.offsetTop > list.scrollTop + list.clientHeight) node.scrollIntoView({ block: 'nearest' });
    }
  }

  function photographerRows(results) {
    return results.map((p) => {
      const bits = [p.status === 'retired' ? 'Retired' : 'Active'];
      bits.push(plural(p.cameraCount, 'camera'));
      const last = fmtDay(p.lastObservedDay);
      if (last) bits.push(`last seen ${last}`);
      if (p.matchedOn && MATCHED_ON_TEXT[p.matchedOn] && p.matchedText) bits.push(`${MATCHED_ON_TEXT[p.matchedOn]}: ${p.matchedText}`);
      return { id: p.handle, title: p.name, sub: bits.join(' · '), flag: p.needsReview ? 'Needs review' : null };
    });
  }

  function cameraRows(query) {
    const q = (query || '').trim().toLowerCase();
    return (overview && overview.cameras ? overview.cameras : [])
      .filter(c => !q || [c.make, c.model, `${c.make} ${c.model}`, c.nickname].filter(Boolean).some(t => t.toLowerCase().includes(q)))
      .map((c) => {
        const bits = [plural(c.photographerCount, 'photographer')];
        if (c.shared) bits.push('shared');
        const last = fmtDay(c.lastObservedDay);
        if (last) bits.push(`last seen ${last}`);
        return { id: c.handle, title: c.nickname ? `${c.nickname} — ${c.make} ${c.model}` : `${c.make} ${c.model}`, sub: bits.join(' · '), flag: c.needsReview ? 'Needs review' : null };
      });
  }

  function reviewRows(query) {
    const q = (query || '').trim().toLowerCase();
    return (overview && overview.reviewItems ? overview.reviewItems : [])
      .filter(r => !q || [r.title, ...r.photographers.map(p => p.name), ...r.cameras.map(c => `${c.make} ${c.model}`)].some(t => t.toLowerCase().includes(q)))
      .map(r => ({
        id: r.id, title: r.title,
        sub: [...r.photographers.map(p => p.name), ...r.cameras.map(c => `${c.make} ${c.model}`)].join(', ') || 'Registry records',
      }));
  }

  async function refreshList() {
    const query = ($('prSearch') || {}).value || '';
    if (view === 'photographers') {
      const seq = ++searchSeq;
      const filter = ($('prFilter') || {}).value || 'all';
      const sort = ($('prSort') || {}).value || 'name';
      let res;
      try { res = await api.photographerRegistrySearch({ query, filter, sort }); } catch { res = null; }
      if (seq !== searchSeq || view !== 'photographers') return;
      rows = res && res.ok ? photographerRows(res.results) : [];
      const note = $('prListNote');
      if (note) {
        note.textContent = res && res.ambiguous ? 'Several photographers share this alias or shortcut. None is selected for you.' : '';
        note.hidden = !(res && res.ambiguous);
      }
      renderList(!res || !res.ok ? 'The photographer list could not be loaded.'
        : query.trim() ? 'No photographer matches this search.'
        : filter !== 'all' ? 'No photographer matches this filter.' : 'No photographers yet.');
      return;
    }
    const note = $('prListNote');
    if (note) note.hidden = true;
    if (view === 'cameras') {
      rows = cameraRows(query);
      renderList(query.trim() ? 'No camera matches this search.' : 'No cameras recorded yet. Cameras appear after imports with photographer learning on.');
    } else {
      rows = reviewRows(query);
      renderList(query.trim() ? 'No review item matches this search.' : 'Nothing needs review.');
    }
  }

  // ── Detail ───────────────────────────────────────────────────────────────────
  function detailPlaceholder(text) {
    const d = $('prDetail');
    if (!d) return;
    clear(d);
    showPendingResult(d);
    d.appendChild(el('p', 'pr-detail-empty', text));
  }

  // ── Q5d: decision results ───────────────────────────────────────────────────
  function showPendingResult(d) {
    const A = actions();
    if (!pendingResult || !A) return;
    const line = A.resultLine(pendingResult);
    pendingResult = null;
    line.tabIndex = -1;
    d.insertBefore(line, d.firstChild);
    line.focus();
  }

  function decisionContext() {
    const from = view;
    return {
      management: overview && overview.management,
      // A saved (or refused) decision returns a fresh snapshot: show it, keep the operator's place.
      onResult: (res, result) => {
        overview = normalizedOverview(res.overview);
        selected = { photographers: null, cameras: null, review: null };
        pendingResult = result;
        renderStatus();
        const focus = res.focus && res.focus.camera;
        switchView(from === 'review' || !focus ? from : 'cameras', from === 'review' ? null : focus);
      },
    };
  }

  function placeholderFor(v) {
    return v === 'cameras' ? 'Select a camera to see its details.'
      : v === 'review' ? 'Select a review item to see what it means.'
      : 'Select a photographer to see their profile.';
  }

  async function select(id) {
    selected[view] = id;
    const list = $('prList');
    if (list) list.querySelectorAll('.pr-row').forEach((n, i) => {
      const on = rows[i] && rows[i].id === id;
      n.classList.toggle('pr-row-selected', on);
      n.setAttribute('aria-selected', String(on));
    });
    if (!id) { detailPlaceholder(placeholderFor(view)); return; }
    const seq = ++detailSeq;
    const forView = view;
    if (forView === 'review') { renderReviewDetail(id); return; }
    let res;
    try {
      res = forView === 'cameras' ? await api.photographerRegistryCamera(id) : await api.photographerRegistryPhotographer(id);
    } catch { res = null; }
    if (seq !== detailSeq || forView !== view) return;
    const A = actions();
    if (A) A.closePanel({ restoreFocus: false });
    if (!res || !res.ok) { detailPlaceholder('This record is no longer available. The registry may have changed — reopen the tab to refresh.'); return; }
    if (forView === 'cameras') renderCameraDetail(res); else renderPhotographerDetail(res);
  }

  function openRecord(kind, handle) {
    if (!handle) return;
    switchView(kind === 'camera' ? 'cameras' : 'photographers', handle);
  }

  function reviewSection(items, title) {
    const s = section(title || 'Needs review');
    if (!items.length) { s.appendChild(emptyLine('Nothing needs review.')); return s; }
    for (const r of items) {
      const box = el('div', 'pr-review-item');
      box.appendChild(el('p', 'pr-review-title', r.title));
      box.appendChild(el('p', 'pr-review-text', r.explanation));
      s.appendChild(box);
    }
    return s;
  }

  function renderPhotographerDetail({ profile: p, reviewItems }) {
    const d = $('prDetail');
    if (!d) return;
    clear(d);
    const head = el('header', 'pr-detail-head');
    head.appendChild(el('h3', 'pr-detail-title', p.name));
    const badges = el('div', 'pr-badges');
    badges.appendChild(chip(p.status === 'retired' ? 'Retired' : 'Active', p.status === 'retired' ? 'pr-chip--muted' : 'pr-chip--ok'));
    if (IDENTITY_TEXT[p.identity]) badges.appendChild(chip(IDENTITY_TEXT[p.identity], 'pr-chip--muted'));
    if (p.needsReview) badges.appendChild(chip('Needs review', 'pr-chip--attention'));
    head.appendChild(badges);
    d.appendChild(head);

    const names = section('Names');
    names.appendChild(field('Current name', p.name));
    names.appendChild(field('Original registered name', p.originalName || p.name));
    names.appendChild(field('Former official names', p.formerNames.length ? p.formerNames.join(', ') : 'None'));
    d.appendChild(names);

    const hist = section('Name changes');
    if (!p.nameHistory.length) hist.appendChild(emptyLine('No name changes recorded.'));
    for (const h of p.nameHistory) {
      const r = el('div', 'pr-history-row');
      r.appendChild(el('span', 'pr-history-day', fmtDay(h.day) || 'Date not recorded'));
      const what = el('span', 'pr-history-what', `${h.fromName} → ${h.toName}`);
      r.appendChild(what);
      r.appendChild(el('span', 'pr-history-who', `${operatorText(h.operator)} · ${h.computer === 'this' ? 'this computer' : 'another computer'}${h.stale ? ' · made from an older name' : ''}`));
      hist.appendChild(r);
    }
    d.appendChild(hist);

    const aliases = section('Search aliases', 'Other spellings the registry uses to find this photographer in searches. Not names, and never used to choose a photographer.');
    if (!p.searchAliases.length) aliases.appendChild(emptyLine('No search aliases.'));
    else { const w = el('div', 'pr-chips'); p.searchAliases.forEach(a => w.appendChild(chip(a.text))); aliases.appendChild(w); }
    d.appendChild(aliases);

    const sc = section('Learned typing shortcuts', 'What operators typed in autocomplete before choosing this photographer. Shortcuts are not aliases or names.');
    if (!p.learnedShortcuts.length) sc.appendChild(emptyLine('No typing shortcuts learned.'));
    else { const w = el('div', 'pr-chips'); p.learnedShortcuts.forEach(s => w.appendChild(chip(s.text, 'pr-chip--shortcut'))); sc.appendChild(w); }
    d.appendChild(sc);

    const cams = section('Cameras', 'A camera match suggests who usually uses a camera. It does not prove who took a particular photo.');
    if (!p.cameras.length) cams.appendChild(emptyLine('No camera history recorded.'));
    const sorted = [...p.cameras].sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
    for (const c of sorted) {
      const r = el('div', 'pr-camera-row');
      const nm = c.nickname ? `${c.nickname} — ${c.make} ${c.model}` : `${c.make} ${c.model}`;
      r.appendChild(linkButton(nm, () => openRecord('camera', c.handle), `Open camera ${nm}`));
      const meta = [c.label];
      if (c.shared) meta.push('shared');
      if (c.confirmations) meta.push(`confirmed ${plural(c.confirmations, 'time')}`);
      if (c.observedImports) meta.push(`seen in ${plural(c.observedImports, 'import')}`);
      const last = fmtDay(c.lastObservedDay);
      if (last) meta.push(`last seen ${last}`);
      r.appendChild(el('span', `pr-camera-meta pr-state--${c.state}`, meta.join(' · ')));
      cams.appendChild(r);
    }
    d.appendChild(cams);

    const models = section('Camera models without a body identifier', 'Imports where only the camera model was known, so the individual camera could not be identified.');
    if (!p.modelsUsed.length) models.appendChild(emptyLine('None recorded.'));
    for (const m of p.modelsUsed) {
      const last = fmtDay(m.lastObservedDay);
      models.appendChild(field(`${m.make} ${m.model}`, `${plural(m.imports, 'import')} on ${plural(m.days, 'day')}${last ? ` · last seen ${last}` : ''}`));
    }
    d.appendChild(models);

    d.appendChild(reviewSection(reviewItems));
    d.scrollTop = 0;
  }

  function renderCameraDetail({ camera: c, reviewItems }) {
    const d = $('prDetail');
    if (!d) return;
    clear(d);
    const head = el('header', 'pr-detail-head');
    head.appendChild(el('h3', 'pr-detail-title', `${c.make} ${c.model}`));
    const badges = el('div', 'pr-badges');
    badges.appendChild(chip(c.identified ? 'Identified camera body' : 'Model only', 'pr-chip--muted'));
    if (c.shared) badges.appendChild(chip('Shared camera', 'pr-chip--muted'));
    if (c.needsReview) badges.appendChild(chip('Needs review', 'pr-chip--attention'));
    head.appendChild(badges);
    d.appendChild(head);

    const info = section('Camera');
    info.appendChild(field('Manufacturer', c.make));
    info.appendChild(field('Model', c.model));
    info.appendChild(field('Nickname', c.nickname || 'None'));
    info.appendChild(field('Identified by', c.identifierTypes.length ? c.identifierTypes.join(', ') : 'Not identified'));
    info.appendChild(field('First seen', fmtDay(c.firstObservedDay) || fmtDay(c.registeredDay) || 'Not recorded'));
    info.appendChild(field('Last seen', fmtDay(c.lastObservedDay) || 'Not recorded'));
    d.appendChild(info);

    const people = section('Photographers', 'A camera match suggests who usually uses this camera. It does not prove who took a particular photo.');
    const A = actions();
    const ctx = decisionContext();
    const note = A && A.unavailableNote(overview && overview.management);
    if (note) people.appendChild(note);
    if (!c.associations.length) people.appendChild(emptyLine('No photographer history for this camera.'));
    for (const a of c.associations) {
      const r = el('div', 'pr-assoc-row');
      const top = el('div', 'pr-assoc-top');
      if (a.photographer.handle) top.appendChild(linkButton(a.photographer.name, () => openRecord('photographer', a.photographer.handle), `Open photographer ${a.photographer.name}`));
      else top.appendChild(el('span', 'pr-assoc-name', a.photographer.name));
      top.appendChild(chip(a.label, `pr-state--${a.state}`));
      if (a.unsettled) top.appendChild(chip('Decisions disagree', 'pr-chip--attention'));
      r.appendChild(top);
      r.appendChild(el('p', 'pr-assoc-text', a.explanation));
      const facts = [];
      if (a.confirmations) facts.push(`confirmed ${plural(a.confirmations, 'time')}${fmtDay(a.lastConfirmedDay) ? `, last ${fmtDay(a.lastConfirmedDay)}` : ''}`);
      if (a.observedImports) facts.push(`seen in ${plural(a.observedImports, 'import')} on ${plural(a.observedDays, 'day')}`);
      if (facts.length) r.appendChild(el('p', 'pr-assoc-facts', facts.join(' · ')));
      if (A) A.associationActions(r, c, a, ctx);
      people.appendChild(r);
    }
    if (A) A.cameraActions(people, c, ctx);
    d.appendChild(people);

    const sug = section('Suggestion at import');
    sug.appendChild(field('Level', c.suggestion.label));
    if (c.suggestion.reasons.length) { const ul = el('ul', 'pr-reasons'); c.suggestion.reasons.forEach(t => ul.appendChild(el('li', null, t))); sug.appendChild(ul); }
    for (const cand of c.suggestion.candidates) {
      if (!cand.reasons.length) continue;
      sug.appendChild(el('p', 'pr-reason-head', cand.photographer.name));
      const ul = el('ul', 'pr-reasons'); cand.reasons.forEach(t => ul.appendChild(el('li', null, t))); sug.appendChild(ul);
    }
    d.appendChild(sug);

    const hist = section('History');
    if (!c.history.length) hist.appendChild(emptyLine('No history recorded.'));
    for (const h of c.history) {
      const r = el('div', 'pr-history-row');
      r.appendChild(el('span', 'pr-history-day', fmtDay(h.day) || 'Date not recorded'));
      const what = el('span', 'pr-history-what');
      if (HISTORY_KIND_TEXT[h.kind]) what.appendChild(chip(HISTORY_KIND_TEXT[h.kind], `pr-chip--kind pr-kind--${h.kind}`));
      what.appendChild(document.createTextNode(h.what));
      r.appendChild(what);
      r.appendChild(el('span', 'pr-history-who', `${h.workflow} · ${operatorText(h.operator)} · ${h.computer === 'this' ? 'this computer' : 'another computer'}`));
      hist.appendChild(r);
    }
    d.appendChild(hist);

    d.appendChild(reviewSection(reviewItems));
    d.scrollTop = 0;
    showPendingResult(d);
  }

  function renderReviewDetail(id) {
    const r = (overview && overview.reviewItems || []).find(x => x.id === id);
    if (!r) { detailPlaceholder('This review item is no longer listed.'); return; }
    const d = $('prDetail');
    clear(d);
    const head = el('header', 'pr-detail-head');
    head.appendChild(el('h3', 'pr-detail-title', r.title));
    d.appendChild(head);
    const what = section('What this means');
    what.appendChild(el('p', 'pr-review-text', r.explanation));
    d.appendChild(what);
    if (r.photographers.length) {
      const s = section('Photographers involved');
      // Several entries can share one name (that is often the conflict): label them apart.
      const sameName = (n) => r.photographers.filter(x => x.name === n).length > 1;
      let recordNo = 0;
      for (const p of r.photographers) {
        const row = el('div', 'pr-camera-row');
        const label = !sameName(p.name) ? p.name
          : p.identity === 'ambiguous' ? `${p.name} (list name)` : `${p.name} (record ${++recordNo})`;
        row.appendChild(p.handle ? linkButton(label, () => openRecord('photographer', p.handle), `Open photographer ${label}`) : el('span', 'pr-assoc-name', label));
        s.appendChild(row);
      }
      d.appendChild(s);
    }
    if (r.cameras.length) {
      const s = section('Cameras involved');
      for (const c of r.cameras) {
        const row = el('div', 'pr-camera-row');
        const nm = `${c.make} ${c.model}`;
        row.appendChild(c.handle ? linkButton(nm, () => openRecord('camera', c.handle), `Open camera ${nm}`) : el('span', 'pr-assoc-name', nm));
        s.appendChild(row);
      }
      d.appendChild(s);
    }
    const A = actions();
    if (A) { A.closePanel({ restoreFocus: false }); A.reviewActions(d, r, decisionContext()); }
    else d.appendChild(el('p', 'pr-section-hint', 'Shown for information. Nothing is merged, chosen or changed automatically.'));
    d.scrollTop = 0;
    showPendingResult(d);
  }

  // ── View switching and loading ───────────────────────────────────────────────
  async function switchView(v, selectId) {
    const search = $('prSearch');
    // Each section searches different things, so a query never carries over between them.
    if (search && (selectId || v !== view)) search.value = '';
    view = v;
    if (selectId) selected[v] = selectId;
    renderViewTabs();
    await refreshList();
    if (view !== v) return;
    if (selected[v] && rows.some(r => r.id === selected[v])) select(selected[v]);
    else { selected[v] = null; detailPlaceholder(placeholderFor(v)); }
  }

  function normalizedOverview(res) {
    const ov = res && res.status ? res : { ok: false, status: { state: 'unreadable' }, counts: {}, cameras: [], reviewItems: [] };
    return { ...ov, cameras: ov.cameras || [], reviewItems: ov.reviewItems || [] };
  }

  async function onShow() {
    wire();
    const seq = ++loadSeq;
    const panel = $('msTabPhotographers');
    if (panel) panel.setAttribute('aria-busy', 'true');
    const list = $('prList');
    if (list && !overview) { clear(list); list.appendChild(el('p', 'pr-list-empty', 'Loading the registry…')); }
    let res;
    try { res = await api.photographerRegistryLoad(); } catch { res = null; }
    if (seq !== loadSeq) return;
    if (panel) panel.removeAttribute('aria-busy');
    const A = actions();
    if (A) A.closePanel({ restoreFocus: false });
    overview = normalizedOverview(res);
    // Handles belong to one snapshot; a reload invalidates every selection.
    selected = { photographers: null, cameras: null, review: null };
    renderStatus();
    await switchView(view);
  }

  function onListKey(e) {
    if (!rows.length) return;
    let i = activeIndex;
    if (e.key === 'ArrowDown') i = Math.min(rows.length - 1, i + 1);
    else if (e.key === 'ArrowUp') i = Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = rows.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') { if (i >= 0) { e.preventDefault(); e.stopPropagation(); select(rows[i].id); } return; }
    else return;
    // Handled here: keep main-window shortcuts (file grid navigation etc.) from also acting.
    e.preventDefault();
    e.stopPropagation();
    setActive(i);
    select(rows[i].id);
  }

  function onViewTabKey(e) {
    const tabs = [...document.querySelectorAll('#msTabPhotographers [data-pr-view]')];
    const i = tabs.indexOf(e.currentTarget);
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    if (j < 0) return;
    e.preventDefault();
    e.stopPropagation();
    tabs[j].focus();
    switchView(tabs[j].dataset.prView);
  }

  function wire() {
    if (wired) return;
    wired = true;
    document.querySelectorAll('#msTabPhotographers [data-pr-view]').forEach((b) => {
      b.addEventListener('click', () => switchView(b.dataset.prView));
      b.addEventListener('keydown', onViewTabKey);
    });
    const search = $('prSearch');
    if (search) {
      search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(refreshList, 120); });
      search.addEventListener('keydown', (e) => {
        e.stopPropagation(); // typing here must never trigger main-window shortcuts
        if (e.key === 'Escape') { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return; }
        if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); $('prList').focus(); setActive(0); select(rows[0].id); }
      });
    }
    ['prFilter', 'prSort'].forEach((id) => { const n = $(id); if (n) n.addEventListener('change', refreshList); });
    const list = $('prList');
    if (list) list.addEventListener('keydown', onListKey);
  }

  window.PhotographerRegistryUI = Object.freeze({ onShow });
})();
