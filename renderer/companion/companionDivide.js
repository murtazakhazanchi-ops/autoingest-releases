/**
 * companionDivide.js — the companion's optional "Divide Photos Between Events" view
 * (AI-FEAT-064 EQI-2). Loaded before companion.js, which calls CompanionDivide.render() while the
 * popup is in its 'divide' presentation.
 *
 * Main owns every rule and count (services/eventDumpDivide.js): this file shows the operator's time
 * ranges, the card's photos in capture order and the import review, and sends choices back by
 * opaque ids and event folder names. Text is set with textContent only; no path ever arrives here.
 *
 * The photo strip is virtualized (only visible rows exist) and thumbnails are requested for the
 * visible photos only, a few at a time, so a large card stays responsive.
 */

'use strict';

window.CompanionDivide = (function () {
  const api = window.companion;
  const $ = (id) => document.getElementById(id);
  const ROW_H = 58;
  const OVERSCAN = 6;
  const THUMB_BATCH = 12;
  const PALETTE = 6;

  const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const formatDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return dateFormat.format(new Date(Date.UTC(y, m - 1, d))); };
  const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const REASONS = {
    'no-event': 'Choose an event in Event Dump first — it sets the collection the events come from.',
    'busy': 'AutoIngest is busy — try again when the current task finishes.',
    'conflicts': 'Some photos are in two ranges with different events. Adjust the overlapping ranges first.',
    'no-photographer': 'Choose and confirm the photographer first.',
    'camera-photographer': 'Choose the photographer for each camera first.',
    'nothing-assigned': 'Assign at least one time range to an event.',
    'event-unavailable': 'An assigned event is no longer available. Choose it again.',
    'scan-failed': 'The events could not be listed. Open AutoIngest to check the archive.',
    'staging-not-configured': 'Local staging is not set up — open AutoIngest → Archive Locations.',
    'archive-offline': 'The archive is offline — nothing was imported.',
    'archive-busy': 'An archive folder is busy on another computer. Try again shortly.',
    'source-changed': 'Files on the card changed since it was checked. Wait for the check to finish and review again.',
    'source-detached': 'The card was removed.',
    'assessment-unavailable': 'The card changed — wait for the check to finish, then try again.',
    'collection-changed': 'The active event in AutoIngest is now in another collection. Choose an event of this collection, then try again.',
    'event-unreadable': "An event's information could not be read. Open AutoIngest to check it.",
    'workspace-not-opened': "AutoIngest's window did not open.",
    'workspace-closed': "AutoIngest's window was closed during the import.",
    'no-response': 'AutoIngest stopped responding.',
    'too-many-ranges': 'That is the most time ranges one card can have.',
    'no-photos': 'No new photos with a reliable time on this date.',
    'already-boundary': 'A range already starts at that photo.',
    'already-in-range': 'That photo is already in a range.',
    'no-photo': 'No photo to move the boundary to.',
    'empty-range': 'That would leave the range empty.',
    'gap-outside-range': 'Add a time range around this pause first; the suggestion only splits a range.',
    'not-listed': 'That event is no longer in the list — search again.',
    'invalid-time': 'Enter a valid time.',
    'unknown-photographer': 'That photographer is not in the photographer list.',
  };
  const NOTICES = {
    'new-event-selected': 'The new event is selected for its range. Nothing was imported.',
    'new-event-cancelled': 'No new event was created — your ranges are unchanged.',
    'new-event-other-collection': 'The new event is in another collection, so it was not used. Ranges are unchanged.',
  };

  let src = null, dv = null, g = null;        // current card, its division view, companion-wide view
  let assets = [], assetsKey = '', loading = false;
  const thumbs = new Map();
  let thumbQueue = new Set(), thumbBusy = false;
  let selected = new Set(), anchor = null, focusIdx = 0;
  let chooser = null;                          // { mode: 'range'|'assets', rangeId?, ids?, events, choice }
  let message = null;

  /** Short, readable event label: "1448-05-01 _01 · Waaz-Hall-Surat". */
  function eventLabel(folder) {
    const m = /^(\d{4}-\d{2}-\d{2} _\d+)-(.*)$/.exec(folder || '');
    return m ? `${m[1]} · ${m[2]}` : (folder || '');
  }
  function colorOf(eventId) {
    const known = (dv && dv.known) || [];
    const order = ((dv && dv.ranges) || []).map(r => r.eventId).filter(Boolean);
    const ids = [...new Set([...order, ...known])];
    const i = ids.indexOf(eventId);
    return i < 0 ? 0 : (i % PALETTE) + 1;
  }
  const say = (text) => { message = text || null; renderNotice(); };
  const reasonText = (r) => REASONS[r] || 'That did not work — try again.';
  async function cmd(name, args) {
    const res = await api.divide(src.sourceId, name, args || {});
    if (res && res.ok === false) say(reasonText(res.reason)); else say(null);
    return res;
  }

  // ── header ──────────────────────────────────────────────────────────────

  function renderHead() {
    $('brand-sub').textContent = 'Divide Between Events';
    $('dv-sub').textContent = `${src.label} · Collection ${dv.collectionName || ''}`;
    const stats = $('dv-stats');
    if (!dv.ready) { stats.replaceChildren(); return; }
    const assigned = dv.events.reduce((n, e) => n + e.assets, 0);
    const items = [
      ['Assigned', assigned, 'ok'],
      ['Unassigned', dv.unassigned.assets, dv.unassigned.assets ? 'muted' : 'ok'],
      ['In two ranges', dv.conflicts.assets, dv.conflicts.assets ? 'bad' : 'hide'],
      ['Already imported', dv.imported.assets, dv.imported.assets ? 'muted' : 'hide'],
      ['No reliable date', dv.undated.assets, dv.undated.assets ? 'muted' : 'hide'],
    ].filter(x => x[2] !== 'hide');
    stats.replaceChildren(...items.map(([label, n, kind]) => {
      const d = el('div', 'dv-stat'); d.dataset.kind = kind;
      d.append(el('dt', null, label), el('dd', null, n.toLocaleString()));
      return d;
    }));
  }

  function renderNotice() {
    const n = $('dv-notice');
    const text = message || (dv && dv.notice && NOTICES[dv.notice]) || '';
    n.textContent = text;
    n.hidden = !text;
    n.dataset.kind = message ? 'warn' : 'info';
  }

  // ── time ranges ─────────────────────────────────────────────────────────

  function timeInput(value, label, onCommit) {
    const i = el('input', 'dv-time');
    i.type = 'time'; i.step = 1; i.value = value.length === 5 ? `${value}:00` : value;
    i.setAttribute('aria-label', label);
    i.addEventListener('change', () => { if (i.value) onCommit(i.value); });
    return i;
  }

  const shortDateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const shortDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return shortDateFormat.format(new Date(Date.UTC(y, m - 1, d))); };

  function rangeItem(r, dates) {
    const li = el('li', 'dv-range');
    li.dataset.id = r.id;
    li.dataset.color = r.eventId ? String(colorOf(r.eventId)) : '0';
    const nudge = (edge, dir, text, label) => {
      const b = el('button', 'btn btn-quiet btn-tiny dv-nudge', text);
      b.type = 'button'; b.title = label; b.setAttribute('aria-label', `Range ${r.n}: ${label}`);
      b.addEventListener('click', () => cmd('nudge', { rangeId: r.id, edge, dir }));
      return b;
    };

    // Row 1: number · date · (next day) · remove
    const top = el('div', 'dv-range-top');
    top.append(el('span', 'dv-range-n', String(r.n)));
    const date = el('select', 'dv-range-date');
    date.setAttribute('aria-label', `Range ${r.n} date`);
    const opts = [...new Set([r.date, ...dates.map(d => d.date)])].sort().reverse();
    date.replaceChildren(...opts.map(d => { const o = el('option', null, shortDate(d)); o.value = d; return o; }));
    date.value = r.date;
    date.addEventListener('change', () => cmd('updateRange', { rangeId: r.id, date: date.value }));
    top.append(date);
    if (r.nextDay) top.append(el('span', 'dv-nextday', 'ends next day'));
    const rm = el('button', 'icon-btn dv-remove', '×');
    rm.type = 'button'; rm.title = 'Remove this range'; rm.setAttribute('aria-label', `Remove range ${r.n}`);
    rm.addEventListener('click', () => cmd('removeRange', { rangeId: r.id }));
    top.append(rm);

    // Row 2: start time ◀ ▶  →  end time ◀ ▶ (each boundary moves to the neighbouring photo)
    const times = el('div', 'dv-range-times');
    const startBox = el('span', 'dv-edge');
    startBox.append(timeInput(r.start, `Range ${r.n} start time`, (v) => cmd('updateRange', { rangeId: r.id, start: v })),
      nudge('start', -1, '◀', 'start one photo earlier'), nudge('start', 1, '▶', 'start one photo later'));
    const endBox = el('span', 'dv-edge');
    endBox.append(timeInput(r.end, `Range ${r.n} end time`, (v) => cmd('updateRange', { rangeId: r.id, end: v })),
      nudge('end', -1, '◀', 'end one photo earlier'), nudge('end', 1, '▶', 'end one photo later'));
    times.append(startBox, el('span', 'dv-dash', 'to'), endBox);

    // Row 3: event · photo count
    const evRow = el('div', 'dv-range-event');
    const evBtn = el('button', `dv-event-btn${r.eventId ? '' : ' is-empty'}`, r.eventId ? eventLabel(r.eventId) : 'Choose event…');
    evBtn.type = 'button'; evBtn.title = r.eventId || 'Choose the event for this range';
    evBtn.setAttribute('aria-label', `Range ${r.n} event: ${r.eventId || 'not chosen'}`);
    evBtn.addEventListener('click', () => openChooser({ mode: 'range', rangeId: r.id }));
    evRow.append(evBtn, el('span', 'dv-range-count', plural(r.assets, 'photo')));

    li.append(top, times, evRow);
    const warns = [];
    if (r.problem) warns.push('This range has an invalid date or time.');
    for (const o of r.overlaps) {
      const other = dv.ranges.find(x => x.id === o.with);
      if (!other) continue;
      warns.push(o.sameEvent ? `Overlaps range ${other.n} (same event — fine).` : `Overlaps range ${other.n}: ${plural(r.conflicts, 'photo is', 'photos are')} in both. Adjust the times.`);
    }
    if (!r.problem && r.assets === 0 && !r.conflicts) warns.push('No new photos in this range.');
    if (dv.pendingNewFor && dv.pendingNewFor.rangeId === r.id) warns.push('Creating a new event in AutoIngest…');
    for (const w of warns) { const p = el('p', 'dv-range-warn', w); p.dataset.kind = /Overlaps range \d+:/.test(w) ? 'bad' : 'muted'; li.append(p); }
    return li;
  }

  function renderRanges() {
    const list = $('dv-range-list');
    const focused = document.activeElement && list.contains(document.activeElement);
    const sig = JSON.stringify([dv.ranges, dv.dates.map(d => d.date), dv.pendingNewFor, dv.known.length]);
    // Never rebuild under the operator's cursor (a time being typed); counts update on the next push.
    if (list.dataset.sig !== sig && !focused) {
      list.replaceChildren(...dv.ranges.map(r => rangeItem(r, dv.dates)));
      list.dataset.sig = sig;
    }
    $('dv-hint').hidden = dv.ranges.length > 0;
  }

  function renderGaps() {
    const sel = $('dv-gap-min');
    if (document.activeElement !== sel) sel.value = dv.gapMinutes ? String(dv.gapMinutes) : '';
    const list = $('dv-gap-list');
    list.replaceChildren(...dv.gaps.map(gp => {
      const li = el('li', 'dv-gap');
      li.append(el('span', 'dv-gap-text', `Pause of ${gp.gapMinutes >= 60 ? `${Math.floor(gp.gapMinutes / 60)} h ${gp.gapMinutes % 60} min` : `${gp.gapMinutes} min`} before ${gp.time}`));
      const show = el('button', 'link-btn', 'Show');
      show.type = 'button';
      show.addEventListener('click', () => scrollToAsset(gp.atId, true));
      const acc = el('button', 'btn btn-secondary btn-tiny', 'Split Here');
      acc.type = 'button'; acc.disabled = !gp.inRange;
      acc.title = gp.inRange ? 'Put a range boundary at this photo (no event is assigned)' : 'Add a time range around this pause first';
      acc.addEventListener('click', () => cmd('acceptGap', { key: gp.key }));
      const no = el('button', 'btn btn-quiet btn-tiny', 'Dismiss');
      no.type = 'button';
      no.addEventListener('click', () => cmd('dismissGap', { key: gp.key }));
      li.append(show, acc, no);
      return li;
    }));
    list.hidden = !dv.gaps.length;
  }

  function photographerSelect(value, label, onPick) {
    const s = el('select', 'dv-ph-select');
    s.setAttribute('aria-label', label);
    const names = (g && g.photographers) || [];
    const opt = (v, t) => { const o = el('option', null, t); o.value = v; return o; };
    s.replaceChildren(opt('', 'Choose photographer…'), ...names.map(n => opt(n, n)));
    s.value = value && names.includes(value) ? value : '';
    s.addEventListener('change', () => onPick(s.value || null));
    return s;
  }

  function renderPhotographer() {
    const body = $('dv-ph-body');
    if (body.contains(document.activeElement)) return;
    if (dv.cameraMode === 'per-camera') {
      const rows = dv.cameras.map(c => {
        const row = el('div', 'dv-cam');
        row.append(el('span', 'dv-cam-name', `${c.label} · ${plural(c.assets, 'photo')}`),
          photographerSelect(c.photographer, `Photographer for ${c.label}`, (name) => cmd('setCameraPhotographer', { camera: c.key, photographer: name })));
        return row;
      });
      body.replaceChildren(el('p', 'dv-ph-note', 'Photos from more than one camera: choose the photographer for each camera.'), ...rows);
      return;
    }
    const sug = src.assessment && src.assessment.dump && src.assessment.dump.suggestion;
    const row = el('div', 'dv-cam');
    row.append(photographerSelect(dv.photographer, 'Photographer', (name) => api.setDumpOptions(src.sourceId, { photographer: name })));
    const parts = [row];
    if (!dv.photographer && sug && sug.candidates && sug.candidates.length) {
      const choices = el('div', 'dv-ph-choices');
      choices.append(el('span', 'dv-ph-note', sug.status === 'confirmed' ? 'Camera confirmed for:' : 'Seen with this camera:'));
      for (const c of sug.candidates) {
        const b = el('button', `btn ${sug.status === 'confirmed' ? 'btn-primary' : 'btn-secondary'} btn-tiny`, `Use ${c.name}`);
        b.type = 'button';
        b.addEventListener('click', () => api.setDumpOptions(src.sourceId, { photographer: c.name }));
        choices.append(b);
      }
      parts.push(choices);
    }
    parts.push(el('p', 'dv-ph-note', dv.photographer ? `Every assigned photo is imported as ${dv.photographer}.` : 'The photographer is never chosen for you — confirm it here.'));
    body.replaceChildren(...parts);
  }

  // ── photo strip (virtualized) ─────────────────────────────────────────────

  async function loadAssets() {
    if (!dv || !dv.ready || !dv.viewDate) { assets = []; drawStrip(); return; }
    const key = `${src.sourceId}|${dv.viewDate}|${JSON.stringify(dv.ranges)}|${dv.events.map(e => `${e.eventId}:${e.assets}`).join(',')}|${dv.unassigned.assets}|${dv.conflicts.assets}|${dv.imported.assets}|${dv.rev || 0}`;
    if (key === assetsKey || loading) return;
    loading = true;
    try {
      const res = await api.divideAssets(src.sourceId, dv.viewDate);
      if (res && res.ok) {
        const sameDate = assets.length && assets[0].date === res.date;
        assets = res.assets;
        assetsKey = key;
        if (!sameDate) { selected = new Set(); anchor = null; focusIdx = 0; $('dv-strip').scrollTop = 0; }
        else selected = new Set([...selected].filter(id => assets.some(a => a.id === id)));
      }
    } finally { loading = false; }
    drawStrip();
    // A push that arrived during the load may have changed the key again.
    if (dv && key !== assetsKeyFor()) loadAssets();
  }
  const assetsKeyFor = () => (dv ? `${src.sourceId}|${dv.viewDate}|${JSON.stringify(dv.ranges)}|${dv.events.map(e => `${e.eventId}:${e.assets}`).join(',')}|${dv.unassigned.assets}|${dv.conflicts.assets}|${dv.imported.assets}|${dv.rev || 0}` : '');

  function chipFor(a) {
    if (a.imported) return ['Already imported', 'muted'];
    if (a.conflict) return ['In two ranges', 'bad'];
    if (a.eventId) return [eventLabel(a.eventId), String(colorOf(a.eventId))];
    if (a.needsChoice) return ['Time uncertain — assign by hand', 'warn'];
    return ['Unassigned', 'muted'];
  }

  function rowFor(a, i) {
    const row = el('div', 'dv-row');
    row.style.transform = `translateY(${i * ROW_H}px)`;
    row.setAttribute('role', 'option');
    row.id = `dv-opt-${a.id}`;
    row.dataset.id = a.id;
    row.setAttribute('aria-selected', selected.has(a.id) ? 'true' : 'false');
    const prev = assets[i - 1];
    if (prev && (prev.eventId !== a.eventId || prev.conflict !== a.conflict)) row.classList.add('is-boundary');
    if (a.imported) row.classList.add('is-imported');
    const thumb = el('div', 'dv-thumb');
    const url = thumbs.get(a.id);
    if (url) { const img = el('img'); img.src = url; img.alt = ''; thumb.append(img); }
    else { thumb.dataset.type = a.type; if (!thumbs.has(a.id)) thumbQueue.add(a.id); }
    const text = el('div', 'dv-row-text');
    const line1 = el('div', 'dv-row-line');
    line1.append(el('span', 'dv-row-time', a.time), el('span', 'dv-row-name', a.label));
    const badges = el('div', 'dv-row-line dv-row-sub');
    const kind = a.type === 'pair' ? 'RAW + JPEG' : a.type === 'raw' ? 'RAW' : a.type === 'video' ? 'Video' : 'Photo';
    badges.append(el('span', 'dv-badge', kind));
    if (a.camera && dv.cameraMode === 'per-camera') badges.append(el('span', 'dv-badge', a.camera));
    if (a.via === 'manual') badges.append(el('span', 'dv-badge dv-badge-manual', 'Chosen by hand'));
    text.append(line1, badges);
    const [chipText, chipKind] = chipFor(a);
    const chip = el('span', 'dv-chip', chipText);
    chip.dataset.color = chipKind;
    chip.title = a.eventId || chipText;
    row.append(thumb, text, chip);
    row.addEventListener('click', (e) => select(i, e.shiftKey, e.metaKey || e.ctrlKey));
    return row;
  }

  function drawStrip() {
    const strip = $('dv-strip');
    const inner = $('dv-strip-inner');
    inner.style.height = `${assets.length * ROW_H}px`;
    if (!assets.length) {
      inner.replaceChildren(el('p', 'dv-empty', dv && dv.ready ? 'No photos with a reliable date on this day.' : 'Checking the card…'));
      renderSelection();
      return;
    }
    const first = Math.max(0, Math.floor(strip.scrollTop / ROW_H) - OVERSCAN);
    const last = Math.min(assets.length, Math.ceil((strip.scrollTop + strip.clientHeight) / ROW_H) + OVERSCAN);
    const rows = [];
    for (let i = first; i < last; i++) rows.push(rowFor(assets[i], i));
    inner.replaceChildren(...rows);
    strip.setAttribute('aria-activedescendant', assets[focusIdx] ? `dv-opt-${assets[focusIdx].id}` : '');
    renderSelection();
    pumpThumbs();
  }

  async function pumpThumbs() {
    if (thumbBusy || !thumbQueue.size || !src) return;
    thumbBusy = true;
    try {
      while (thumbQueue.size && src) {
        const ids = [...thumbQueue].slice(0, THUMB_BATCH);
        ids.forEach(id => thumbQueue.delete(id));
        const res = await api.divideThumbs(src.sourceId, ids);
        if (!res || !res.ok) break;
        for (const id of ids) thumbs.set(id, res.thumbs[id] || null);
        while (thumbs.size > 600) thumbs.delete(thumbs.keys().next().value);
        // Paint the new thumbnails into rows that are still on screen.
        for (const id of ids) {
          const url = thumbs.get(id);
          const t = document.querySelector(`#dv-opt-${id} .dv-thumb`);
          if (url && t && !t.querySelector('img')) { const img = el('img'); img.src = url; img.alt = ''; t.replaceChildren(img); }
        }
      }
    } finally { thumbBusy = false; }
  }

  function select(i, extend, toggle) {
    const a = assets[i];
    if (!a) return;
    focusIdx = i;
    if (extend && anchor != null) {
      const [lo, hi] = [Math.min(anchor, i), Math.max(anchor, i)];
      selected = new Set(assets.slice(lo, hi + 1).map(x => x.id));
    } else if (toggle) {
      if (selected.has(a.id)) selected.delete(a.id); else selected.add(a.id);
      anchor = i;
    } else {
      selected = new Set([a.id]);
      anchor = i;
    }
    drawStrip();
  }

  function scrollToAsset(id, choose) {
    const i = assets.findIndex(a => a.id === id);
    if (i < 0) return;
    const strip = $('dv-strip');
    strip.scrollTop = Math.max(0, i * ROW_H - strip.clientHeight / 2 + ROW_H / 2);
    if (choose) select(i, false, false); else drawStrip();
  }

  function renderSelection() {
    const ids = [...selected];
    const one = ids.length === 1 ? assets.find(a => a.id === ids[0]) : null;
    $('dv-sel').title = 'Click a photo; Shift-click selects a run; ↑ ↓ move.';
    $('dv-sel').textContent = !ids.length ? 'Select a photo to split or assign it.'
      : one ? `${one.time} · ${one.label}` : `${plural(ids.length, 'photo')} selected`;
    $('dv-split').disabled = !one || !one.reliable || one.imported;
    $('dv-assign').disabled = !ids.length || ids.every(id => (assets.find(a => a.id === id) || {}).imported);
    $('dv-clear').disabled = !ids.some(id => (assets.find(a => a.id === id) || {}).via === 'manual');
  }

  $('dv-strip').addEventListener('scroll', () => drawStrip(), { passive: true });
  $('dv-strip').addEventListener('keydown', (e) => {
    if (!assets.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = Math.max(0, Math.min(assets.length - 1, focusIdx + (e.key === 'ArrowDown' ? 1 : -1)));
      select(i, e.shiftKey, false);
      const strip = $('dv-strip');
      if (i * ROW_H < strip.scrollTop) strip.scrollTop = i * ROW_H;
      else if ((i + 1) * ROW_H > strip.scrollTop + strip.clientHeight) strip.scrollTop = (i + 1) * ROW_H - strip.clientHeight;
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      scrollToAsset(assets[e.key === 'Home' ? 0 : assets.length - 1].id, true);
    }
  });
  $('dv-split').addEventListener('click', async () => {
    const id = [...selected][0];
    if (id) await cmd('splitAt', { assetId: id });
  });
  $('dv-assign').addEventListener('click', () => openChooser({ mode: 'assets', ids: [...selected] }));
  $('dv-clear').addEventListener('click', () => cmd('setAssets', { assetIds: [...selected], target: null }));
  $('dv-add-range').addEventListener('click', () => cmd('addRange'));
  $('dv-gap-min').addEventListener('change', () => cmd('setGapMinutes', { minutes: $('dv-gap-min').value ? Number($('dv-gap-min').value) : null }));
  $('dv-date').addEventListener('change', () => cmd('setViewDate', { date: $('dv-date').value }));

  // ── event chooser ─────────────────────────────────────────────────────────

  async function openChooser(opts) {
    chooser = { ...opts, events: null, choice: null };
    $('dv-chooser').hidden = false;
    $('dv-chooser-title').textContent = opts.mode === 'range'
      ? `Event for range ${(dv.ranges.find(r => r.id === opts.rangeId) || {}).n || ''}`
      : `Assign ${plural(opts.ids.length, 'photo')} by hand`;
    $('dv-chooser-new').hidden = opts.mode !== 'range';
    $('dv-chooser-use').disabled = true;
    $('dv-chooser-search').value = '';
    chooserNote('Loading events…');
    $('dv-chooser-list').replaceChildren();
    const res = await api.divideEvents(src.sourceId);
    if (!chooser) return;
    if (!res || !res.ok) { chooserNote(reasonText(res && res.reason)); return; }
    chooser.events = res;
    chooserNote(res.events.length ? '' : 'No events in this collection yet — use Create New Event.');
    renderChooser();
    $('dv-chooser-search').focus();
  }
  function chooserNote(t) { const n = $('dv-chooser-note'); n.textContent = t; n.hidden = !t; }
  function closeChooser() { chooser = null; $('dv-chooser').hidden = true; }

  function renderChooser() {
    if (!chooser || !chooser.events) return;
    const q = $('dv-chooser-search').value.trim().toLowerCase();
    const extra = chooser.mode === 'assets' ? [{ value: '__unassigned__', label: 'Keep out of every event (unassigned)' }] : [{ value: '', label: 'No event (leave this range unassigned)' }];
    const items = [...extra, ...chooser.events.events.map(f => ({ value: f, label: f }))]
      .filter(x => !q || x.label.toLowerCase().includes(q))
      .map(x => {
        const li = el('li', 'picker-item');
        li.setAttribute('role', 'option');
        li.tabIndex = 0;
        li.append(el('span', 'picker-name', x.label));
        if (x.value && x.value === chooser.events.active) li.append(el('span', 'picker-tag', 'Current'));
        li.setAttribute('aria-selected', chooser.choice === x.value ? 'true' : 'false');
        const pick = () => { chooser.choice = x.value; $('dv-chooser-use').disabled = false; renderChooser(); };
        li.addEventListener('click', pick);
        li.addEventListener('keydown', (k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); pick(); } });
        li.addEventListener('dblclick', () => { pick(); useChoice(); });
        return li;
      });
    $('dv-chooser-list').replaceChildren(...items);
  }

  async function useChoice() {
    if (!chooser || chooser.choice == null) return;
    const c = chooser;
    closeChooser();
    if (c.mode === 'range') await cmd('setRangeEvent', { rangeId: c.rangeId, folderName: c.choice || null });
    else await cmd('setAssets', { assetIds: c.ids, target: c.choice });
  }

  $('dv-chooser-search').addEventListener('input', renderChooser);
  $('dv-chooser-cancel').addEventListener('click', closeChooser);
  $('dv-chooser-use').addEventListener('click', useChoice);
  $('dv-chooser-new').addEventListener('click', async () => {
    const c = chooser;
    closeChooser();
    if (c && c.mode === 'range') await cmd('newEvent', { rangeId: c.rangeId });
  });

  // ── review and import ─────────────────────────────────────────────────────

  const MODE_TEXT = { 'local-first': 'Local First — copied to Local Staging, then synced to the archive', 'direct-nas': 'Direct Archive' };

  async function openReview() {
    const res = await api.divideReview(src.sourceId);
    if (!res || !res.ok) { say(reasonText(res && res.reason)); return; }
    const meta = $('dv-review-meta');
    const pairs = [
      ['Card', res.card || src.label],
      ['Capture dates', res.dates.map(formatDate).join(', ') || '—'],
      ['Photographer', [...new Set(res.batches.map(b => b.photographer))].join(', ') || 'Not chosen'],
      ['Archive', `${MODE_TEXT[res.archive.mode] || res.archive.mode}${res.archive.problem ? ` — ${reasonText(res.archive.problem)}` : ''}`],
      ['Files to copy', res.totalFiles.toLocaleString()],
    ];
    meta.replaceChildren(...pairs.map(([k, v]) => { const d = el('div', 'dv-meta'); d.append(el('dt', null, k), el('dd', null, v)); return d; }));
    $('dv-review-events').replaceChildren(...res.events.map(e => {
      const li = el('li', 'dv-review-event');
      li.dataset.color = String(colorOf(e.eventId));
      li.append(el('span', 'dv-review-name', e.eventId),
        el('span', 'dv-review-count', `${plural(e.assets, 'photo')} · ${plural(e.files, 'file')}`),
        el('span', 'dv-review-dest', `Dump / ${e.photographers.map(p => p.name).join(', ')}`));
      return li;
    }));
    const notes = [];
    if (res.unassigned.assets) notes.push(`${plural(res.unassigned.assets, 'photo')} not assigned — ${res.unassigned.assets === 1 ? 'it stays' : 'they stay'} on the card and ${res.unassigned.assets === 1 ? 'is' : 'are'} not imported.`);
    if (res.imported.files) notes.push(`${plural(res.imported.files, 'file')} already imported — left out.`);
    if (res.undated.files) notes.push(`${plural(res.undated.files, 'file')} without a reliable capture date stay on the card.`);
    notes.push('Nothing is deleted from the card. Dump folders are never sequenced.');
    $('dv-review-note').textContent = notes.join(' ');
    const blockers = [...res.blockers, ...(res.archive.problem ? [res.archive.problem] : [])];
    const block = $('dv-review-block');
    block.hidden = !blockers.length;
    block.textContent = blockers.map(reasonText).join(' ');
    const btn = $('dv-review-import');
    btn.disabled = blockers.length > 0 || res.totalFiles === 0;
    btn.textContent = res.totalFiles ? `Import to Selected Events (${plural(res.totalFiles, 'file')})` : 'Import to Selected Events';
    $('dv-review-panel').hidden = false;
    (btn.disabled ? $('dv-review-cancel') : btn).focus();
  }
  function closeReview() { $('dv-review-panel').hidden = true; }

  $('dv-review').addEventListener('click', openReview);
  $('dv-review-cancel').addEventListener('click', closeReview);
  $('dv-review-import').addEventListener('click', async () => {
    $('dv-review-import').disabled = true;
    closeReview();
    const res = await api.divideImport(src.sourceId);
    if (res && res.state === 'refused') say(reasonText(res.reason));
  });
  $('dv-back').addEventListener('click', () => { closeChooser(); closeReview(); api.setView('expanded', src.sourceId); });

  for (const id of ['dv-chooser', 'dv-review-panel']) {
    $(id).addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      if (id === 'dv-chooser') closeChooser(); else closeReview();
    });
  }

  const STATUS_TEXT = { waiting: 'Waiting', running: 'Importing…', completed: 'Done', 'completed-with-errors': 'Done with errors', failed: 'Failed', 'not-started': 'Not started' };
  const META_TEXT = { writing: 'writing metadata…', complete: 'metadata written', 'needs-review': 'metadata needs review', 'some-failed': 'metadata failed for some files', 'not-run': 'metadata not written (automatic metadata is off)' };

  function renderAction() {
    const op = dv.op;
    const pending = !!(op && op.state === 'pending');
    const blockers = dv.ready ? dv.review.blockers : ['assessment-unavailable'];
    const ready = $('dv-ready');
    ready.hidden = pending;
    ready.dataset.ready = !blockers.length ? 'yes' : '';
    ready.textContent = !dv.ready ? 'Waiting for the card check to finish…'
      : blockers.length ? reasonText(blockers[0])
      : `Ready: ${plural(dv.review.totalFiles, 'file')} → ${plural(dv.events.length, 'event')}${dv.unassigned.assets ? ` · ${plural(dv.unassigned.assets, 'photo')} unassigned (left on the card)` : ''}`;
    const prog = $('dv-progress');
    prog.hidden = !pending;
    if (pending) {
      const p = op.progress || { index: 0, total: 0, done: 0, files: 0, totalFiles: 0 };
      const cur = op.events[p.index] || {};
      const doneFiles = Math.min(p.totalFiles, p.files + (cur.status === 'running' ? p.done : 0));
      $('dv-progress-text').textContent = `Event ${Math.min(p.index + 1, p.total)} of ${p.total} — ${eventLabel(cur.eventId)} · ${doneFiles.toLocaleString()} of ${p.totalFiles.toLocaleString()} files`;
      $('dv-bar').style.width = `${p.totalFiles ? Math.round((doneFiles / p.totalFiles) * 100) : 0}%`;
    }
    const results = $('dv-results');
    const showResults = !!(op && op.events && op.events.length);
    results.hidden = !showResults;
    if (showResults) {
      results.replaceChildren(...op.events.map(e => {
        const li = el('li', 'dv-result');
        li.dataset.status = e.status;
        li.dataset.color = String(colorOf(e.eventId));
        li.append(el('span', 'dv-result-name', `${eventLabel(e.eventId)} · ${e.photographer}`));
        const counts = e.status === 'waiting' || e.status === 'running' ? `${plural(e.files, 'file')}`
          : `${e.copied.toLocaleString()} copied${e.skipped ? ` · ${e.skipped.toLocaleString()} skipped` : ''}${e.errors ? ` · ${e.errors.toLocaleString()} failed` : ''}`;
        li.append(el('span', 'dv-result-status', `${STATUS_TEXT[e.status] || e.status} · ${counts}${e.metadata && META_TEXT[e.metadata.state] ? ` · ${META_TEXT[e.metadata.state]}` : ''}`));
        if (e.error && (e.status === 'failed' || e.status === 'not-started')) li.append(el('span', 'dv-result-error', e.error === 'source-disconnected' ? 'The card was removed — nothing more was copied.' : e.error));
        return li;
      }));
    }
    if (op && op.state === 'refused' && op.reason) { ready.hidden = false; ready.textContent = reasonText(op.reason); ready.dataset.ready = ''; }
    if (op && !pending && op.state !== 'refused') {
      const head = op.state === 'completed' ? 'All events imported.' : op.state === 'completed-with-errors' ? 'Imported — some files failed and are still on the card. Review Import again to retry them.'
        : op.state === 'partial' ? 'Some events were not imported. Review Import again to retry them — nothing already copied is copied twice.'
        : 'The import did not complete. Nothing already copied is copied twice when you retry.';
      if (blockers.includes('nothing-assigned') && op.state === 'completed') { ready.textContent = head; ready.dataset.ready = 'yes'; } else ready.textContent = `${head} ${ready.textContent}`;
    }
    const lock = pending || !!(src.assessment && src.assessment.handoffPending);
    $('dv-review').disabled = lock || !dv.ready;
    $('dv-add-range').disabled = lock || !dv.ready;
    $('dv-back').disabled = pending;
    for (const b of document.querySelectorAll('#dv .dv-ranges button, #dv .dv-ranges select, #dv .dv-ranges input, #dv .dv-photo-actions button')) {
      if (lock) { b.dataset.lockDisabled = b.disabled ? '' : 'yes'; b.disabled = true; }
      else if (b.dataset.lockDisabled === 'yes') { b.disabled = false; b.dataset.lockDisabled = ''; }
    }
  }

  function renderDates() {
    const sel = $('dv-date');
    const items = dv.dates.map(d => [d.date, `${formatDate(d.date)} — ${d.assets.toLocaleString()} new${d.assigned ? ` · ${d.assigned.toLocaleString()} assigned` : ''}`]);
    const sig = JSON.stringify(items);
    if (sel.dataset.sig !== sig && document.activeElement !== sel) {
      sel.replaceChildren(...items.map(([v, t]) => { const o = el('option', null, t); o.value = v; return o; }));
      sel.dataset.sig = sig;
    }
    if (document.activeElement !== sel && dv.viewDate) sel.value = dv.viewDate;
    sel.disabled = !items.length;
  }

  /** @param {object} source  snapshot source (its assessment carries .divide) @param {object} snapshot */
  function render(source, snapshot) {
    if (!src || src.sourceId !== source.sourceId) { thumbs.clear(); thumbQueue = new Set(); assets = []; assetsKey = ''; selected = new Set(); message = null; }
    src = source;
    g = snapshot.dump || null;
    dv = source.assessment && source.assessment.divide;
    if (!dv) { $('dv-sub').textContent = 'Preparing…'; return; }
    renderHead();
    renderNotice();
    if (!dv.ready) { $('dv-range-list').replaceChildren(); drawStrip(); renderAction(); return; }
    renderDates();
    renderRanges();
    renderGaps();
    renderPhotographer();
    renderAction();
    loadAssets();
  }

  function hide() {
    closeChooser();
    closeReview();
    src = null; dv = null; assets = []; assetsKey = ''; thumbs.clear(); thumbQueue = new Set(); selected = new Set(); message = null;
  }

  return { render, hide };
}());
