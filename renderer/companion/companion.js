/**
 * companion.js — renderer for the menu-bar/tray companion popup (AI-FEAT-061 Q1/Q2/Q3,
 * AI-FEAT-064 EQI-1/EQI-1.1).
 * Renders the snapshot pushed by main; never computes status of its own: counts, buckets, the
 * selected date, the destination event, the photographer list and every refusal message come
 * from main. This file only formats them and sends the operator's choices back by opaque
 * sourceId / name. Text is set with textContent only.
 *
 * EQI-1.1: one popup, two presentations (main sizes the window and keeps the state):
 *   compact  — card overview: what is on each card and what to do with it
 *   expanded — Event Dump for one card: event, photographer, destination, import, progress
 *
 * Rows are keyed by sourceId and updated in place, so a progress push or a poll never closes a
 * date menu, the photographer search or the event picker the operator has open.
 */

'use strict';

(function () {
  const api = window.companion;
  const match = window.PhotographerMatch.matchPhotographers;
  const $ = (id) => document.getElementById(id);
  const popup = document.querySelector('.popup');
  const heading = $('status-heading');
  const empty = $('empty-state');
  const list = $('card-list');
  const rowTemplate = $('card-row');
  /** @type {Map<string, HTMLElement>} */
  const rows = new Map();
  /** sourceIds whose camera list the operator expanded (presentation only). */
  const expandedCameras = new Set();
  const CAMERAS_SHOWN = 3;
  let snap = null;

  const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const UNCERTAIN_REASONS = {
    'no-capture-metadata': 'no capture date',
    'invalid-date': 'invalid date',
    'conflicting-tags': 'conflicting dates',
    'video-timezone-ambiguous': 'video time zone unknown',
    'pair-inconsistent': 'RAW/JPEG pair disagrees',
    'read-error': 'unreadable',
  };
  const DUMP_REASONS = {
    'no-event': 'Choose an event first.',
    'no-photographer': 'Choose the photographer first.',
    'nothing-new': 'No new photos to import for this date.',
    'busy': 'AutoIngest is busy — try again when the current task finishes.',
    'source-detached': 'The card was removed.',
    'assessment-unavailable': 'The card changed — wait for the check to finish, then try again.',
    'event-changed': 'The event changed in AutoIngest — check the event and try again.',
    'event-unreadable': "This event's information could not be read. Open AutoIngest to check it.",
    'event-unavailable': 'That event could not be opened. Open AutoIngest to check it.',
    'staging-not-configured': 'Local staging is not set up — open AutoIngest → Archive Locations.',
    'archive-offline': 'The archive is offline — use Local First for this event in AutoIngest.',
    'archive-busy': 'The archive folder is busy on another computer. Try again shortly.',
    'workspace-not-opened': "AutoIngest's window did not open.",
    'workspace-closed': "AutoIngest's window was closed during the import.",
    'no-response': 'AutoIngest stopped responding.',
    'unknown-photographer': 'That photographer is not in the photographer list.',
    'not-listed': 'That event is no longer in the list — search again.',
    'scan-failed': 'The events could not be listed. Open AutoIngest to check the archive.',
  };

  function formatDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return dateFormat.format(new Date(Date.UTC(y, m - 1, d)));
  }

  const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

  function headingText(count) {
    if (count === 0) return 'No card connected';
    return count === 1 ? '1 card connected' : `${count} cards connected`;
  }

  function progressText(a) {
    switch (a.state) {
      case 'pending': return 'Waiting to check capture dates…';
      case 'scanning': return 'Finding photos and videos…';
      case 'reading': return `Reading capture dates… ${a.progress.done.toLocaleString()} of ${a.progress.total.toLocaleString()}`;
      case 'identifying': return `Identifying cameras… ${a.identifyProgress.done.toLocaleString()} of ${a.identifyProgress.total.toLocaleString()}`;
      case 'paused': return `Paused while AutoIngest is importing… ${a.progress.done.toLocaleString()} of ${a.progress.total.toLocaleString()}`;
      default: return '';
    }
  }

  function optionLabel(o) {
    const when = o.relation === 'today' ? `Today · ${formatDate(o.date)}` : formatDate(o.date);
    const suffix = o.relation === 'later' ? ' (after today)' : '';
    return `${when}${suffix} — ${o.count.toLocaleString()}`;
  }

  /** Replaces a select's options only when they changed and the operator is not in it. */
  function syncSelect(select, items, value) {
    const signature = JSON.stringify(items);
    if (select.dataset.signature !== signature && document.activeElement !== select) {
      select.replaceChildren(...items.map(([v, label]) => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = label;
        return opt;
      }));
      select.dataset.signature = signature;
    }
    if (document.activeElement !== select) select.value = value;
  }

  function breakdownText(b) {
    const parts = [];
    if (b.photo) parts.push(plural(b.photo, 'photo'));
    if (b.raw) parts.push(`${b.raw.toLocaleString()} RAW`);
    if (b.video) parts.push(plural(b.video, 'video'));
    if (b.pairs) parts.push(plural(b.pairs, 'RAW+JPEG pair'));
    return parts.join(' · ');
  }

  function notesText(s) {
    const notes = [];
    if (s.counts.uncertain) {
      const reasons = Object.entries(s.uncertainReasons).map(([r, n]) => `${UNCERTAIN_REASONS[r] || r} ${n.toLocaleString()}`);
      notes.push(`Date uncertain: ${reasons.join(', ')}. These are never counted under a date.`);
    }
    if (s.afterTodayCount) notes.push(`${plural(s.afterTodayCount, 'file is', 'files are')} dated after today — the camera clock may be ahead.`);
    if (s.selectedBreakdown.lowConfidence) {
      notes.push(`${plural(s.selectedBreakdown.lowConfidence, 'video has', 'videos have')} no time zone; the date is likely but not certain.`);
    }
    return notes.join(' ');
  }

  /** "3 new · 89 already imported" for the chosen date (file-level history from main). */
  function importStatusText(d) {
    if (!d) return '';
    const c = d.counts;
    const parts = [`${plural(c.selectedNew, 'new file')}`];
    if (c.selectedImported) parts.push(`${c.selectedImported.toLocaleString()} already imported`);
    if (c.earlierNew) parts.push(`${c.earlierNew.toLocaleString()} new from earlier dates`);
    return parts.join(' · ');
  }

  function dumpResultText(op) {
    const r = op.result || {};
    if (op.state === 'refused' || op.state === 'cancelled' || op.state === 'failed') {
      return DUMP_REASONS[op.reason] || (r.detail ? `Import failed: ${r.detail}` : 'The import did not run.');
    }
    const head = `${plural(r.copied || 0, 'file')} copied and size-verified`;
    const rest = [];
    if (r.skipped) rest.push(`${r.skipped.toLocaleString()} already there (skipped)`);
    if (r.errors) rest.push(`${r.errors.toLocaleString()} failed — still on the card`);
    const m = op.metadata || {};
    const meta = m.state === 'writing' ? 'Writing metadata…'
      : m.state === 'complete' ? 'Metadata written.'
      : m.state === 'needs-review' ? 'Metadata written; some files need review in Metadata Audit.'
      : m.state === 'some-failed' ? `Metadata failed for ${plural(m.failed || 0, 'file')} — see Metadata Audit.`
      : m.state === 'not-run' ? 'Metadata not written (automatic metadata is off).' : '';
    return [head + (rest.length ? ` · ${rest.join(' · ')}` : '') + '.', meta].filter(Boolean).join(' ');
  }

  // ── Compact: card rows ────────────────────────────────────────────────────

  function renderSummary(row, sourceId, s, handoffPending, d) {
    const dateSelect = row.querySelector('.date-select');
    syncSelect(dateSelect, s.options.map(o => [o.date, optionLabel(o)]), s.selection.date);
    dateSelect.onchange = () => { api.selectDate(sourceId, dateSelect.value, s.selection.untilTime); };

    const midnight = row.querySelector('.midnight-select');
    syncSelect(midnight, [['', 'No'], ...s.afterMidnightOptions.map(t => [t, `Until ${t}`])], s.selection.untilTime || '');
    midnight.onchange = () => { api.selectDate(sourceId, s.selection.date, midnight.value || null); };

    const isToday = s.selection.date === s.today;
    const day = isToday ? 'today' : `on ${formatDate(s.selection.date)}`;
    const extra = s.selection.untilTime ? ` and after midnight until ${s.selection.untilTime}` : '';
    row.querySelector('.selected-num').textContent = s.counts.selected.toLocaleString();
    row.querySelector('.selected-caption').textContent = `${s.counts.selected === 1 ? 'file' : 'files'} captured ${day}${extra}`;
    row.querySelector('.selected-breakdown').textContent = breakdownText(s.selectedBreakdown);
    row.querySelector('.import-status').textContent = importStatusText(d);

    row.querySelector('.earlier-count').textContent = s.counts.earlier.toLocaleString();
    row.querySelector('.later-count').textContent = s.counts.later.toLocaleString();
    row.querySelector('.later-bucket').hidden = s.counts.later === 0;
    row.querySelector('.uncertain-count').textContent = s.counts.uncertain.toLocaleString();

    const note = row.querySelector('.assess-note');
    note.textContent = notesText(s);
    note.hidden = !note.textContent;

    const suggestion = row.querySelector('.suggestion');
    suggestion.hidden = !s.suggestion;
    if (s.suggestion) {
      row.querySelector('.suggestion-text').textContent =
        `No files from today. Most files are from ${formatDate(s.suggestion.date)} (${s.suggestion.count.toLocaleString()}).`;
      const use = row.querySelector('.use-suggestion');
      use.textContent = `Show ${formatDate(s.suggestion.date)}`;
      use.onclick = () => { api.selectDate(sourceId, s.suggestion.date, null); };
    }

    const reviewSelected = row.querySelector('.review-selected');
    reviewSelected.disabled = handoffPending || s.counts.selected === 0;
    reviewSelected.onclick = () => { api.reviewSelected(sourceId); };
    const reviewEarlier = row.querySelector('.review-earlier');
    reviewEarlier.disabled = handoffPending || s.counts.earlier + s.counts.later + s.counts.uncertain === 0;
    reviewEarlier.onclick = () => { api.reviewEarlier(sourceId); };

    const dumpBtn = row.querySelector('.event-dump-btn');
    dumpBtn.disabled = !d;
    dumpBtn.onclick = () => { api.setView('expanded', sourceId); };
    // An Event Dump result stays visible in the overview after going back to it.
    const last = row.querySelector('.dump-last');
    const op = d && d.op;
    last.hidden = !op;
    last.textContent = op ? (op.state === 'pending' ? 'Event Dump import in progress…' : `Last Event Dump: ${dumpResultText(op)}`) : '';
    last.dataset.state = op ? op.state : '';
  }

  function cameraRow({ name, count, badge, status }) {
    const li = document.createElement('li');
    li.className = 'camera-row';
    li.dataset.status = status;
    const n = document.createElement('span');
    n.className = 'camera-name';
    n.textContent = name;
    n.title = name;
    const c = document.createElement('span');
    c.className = 'camera-count';
    c.textContent = status === 'pending' ? '' : plural(count, 'file');
    li.append(n, c);
    if (badge) {
      const b = document.createElement('span');
      b.className = 'camera-badge';
      b.textContent = badge;
      li.append(b);
    }
    return li;
  }

  function cameraItems(cams) {
    const items = cams.cameras.map(c => ({
      name: c.bodyLabel ? `${c.display} · Body ${c.bodyLabel}` : c.display,
      count: c.files,
      badge: c.status === 'body-identified' ? 'Body identified' : 'Body not identified',
      status: c.status,
    }));
    if (cams.unknownFiles) items.push({ name: 'Unknown camera', count: cams.unknownFiles, badge: null, status: 'unknown' });
    if (cams.conflictFiles) items.push({ name: 'Conflicting camera information', count: cams.conflictFiles, badge: 'Not assigned', status: 'conflict' });
    return items;
  }

  /** Q3: cameras on the card — names, counts and body status from main; never serials. */
  function renderCameras(row, sourceId, cams, identifying) {
    const box = row.querySelector('.cameras');
    box.hidden = !cams && !identifying;
    if (!cams) {
      if (identifying) {
        row.querySelector('.cameras-heading').textContent = 'Cameras';
        row.querySelector('.camera-list').replaceChildren(cameraRow({ name: 'Identifying cameras…', count: 0, badge: null, status: 'pending' }));
        row.querySelector('.cameras-more').hidden = true;
      }
      return;
    }
    const items = cameraItems(cams);
    const head = row.querySelector('.cameras-heading');
    head.textContent = cams.cameras.length === 1 ? 'Camera' : `Cameras (${cams.cameras.length})`;
    const expanded = expandedCameras.has(sourceId);
    const visible = expanded ? items : items.slice(0, CAMERAS_SHOWN);
    row.querySelector('.camera-list').replaceChildren(...visible.map(cameraRow));
    const more = row.querySelector('.cameras-more');
    more.hidden = items.length <= CAMERAS_SHOWN;
    more.textContent = expanded ? 'Show fewer' : `+${items.length - CAMERAS_SHOWN} more`;
    more.onclick = () => {
      if (expandedCameras.has(sourceId)) expandedCameras.delete(sourceId); else expandedCameras.add(sourceId);
      renderCameras(row, sourceId, cams);
    };
  }

  function renderAssessment(row, src) {
    const a = src.assessment;
    const progress = row.querySelector('.assess-progress');
    const result = row.querySelector('.assess-result');
    const error = row.querySelector('.assess-error');
    const notice = row.querySelector('.assess-notice');

    const working = !a || ['pending', 'scanning', 'reading', 'identifying', 'paused'].includes(a.state);
    progress.hidden = !working;
    if (working) {
      row.querySelector('.progress-text').textContent = a ? progressText(a) : 'Waiting to check capture dates…';
      const p = a && a.state === 'identifying' ? a.identifyProgress : a && a.progress;
      const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
      row.querySelector('.progress-bar').style.width = `${pct}%`;
    }
    error.hidden = !(a && a.state === 'error');
    error.textContent = a && a.state === 'error' ? (a.error || 'The card could not be read.') : '';
    result.hidden = !(a && a.summary);
    renderCameras(row, src.sourceId, a && a.cameras, !!(a && a.summary && a.state === 'identifying'));
    if (a && a.summary) renderSummary(row, src.sourceId, a.summary, !!a.handoffPending, a.dump);
    // Review handoff: pending / completed / refused / cancelled / failed, from main.
    notice.hidden = !(a && a.handoff);
    notice.textContent = a && a.handoff ? a.handoff.message : '';
    notice.dataset.state = a && a.handoff ? a.handoff.state : '';
  }

  function rowFor(src) {
    let row = rows.get(src.sourceId);
    if (!row) {
      row = rowTemplate.content.firstElementChild.cloneNode(true);
      row.dataset.sourceId = src.sourceId;
      rows.set(src.sourceId, row);
    }
    row.querySelector('.card-label').textContent = src.label;
    row.querySelector('.card-disambiguator').textContent = src.labelCollision && src.disambiguator ? src.disambiguator : '';
    renderAssessment(row, src);
    return row;
  }

  function renderCompact(sources) {
    heading.textContent = headingText(sources.length);
    empty.hidden = sources.length !== 0;
    list.hidden = sources.length === 0;
    const live = new Set(sources.map(s => s.sourceId));
    for (const [id, row] of rows) {
      if (!live.has(id)) { row.remove(); rows.delete(id); expandedCameras.delete(id); }
    }
    const ordered = sources.map(rowFor);
    // Re-append only when the order actually changed, keeping focus inside a row.
    if (ordered.some((row, i) => list.children[i] !== row) || list.children.length !== ordered.length) {
      list.replaceChildren(...ordered);
    }
  }

  // ── Expanded: Event Dump for one card ─────────────────────────────────────

  const xp = {
    phInput: $('xp-ph-input'), phList: $('xp-ph-list'), phActive: -1, phMatches: [],
    picker: $('xp-picker'), pickerSearch: $('xp-picker-search'), pickerList: $('xp-picker-list'),
    pickerEvents: null, pickerChoice: null,
  };

  function currentSource() {
    const v = snap && snap.view;
    if (!v || v.mode !== 'expanded') return null;
    return (snap.sources || []).find(s => s.sourceId === v.sourceId) || null;
  }

  function closePhotographerList() {
    xp.phList.hidden = true;
    xp.phInput.setAttribute('aria-expanded', 'false');
    xp.phInput.removeAttribute('aria-activedescendant');
    xp.phActive = -1;
  }

  function renderPhotographerList() {
    const g = (snap && snap.dump) || { photographers: [] };
    xp.phMatches = match(g.photographers, xp.phInput.value, 50);
    if (xp.phActive >= xp.phMatches.length) xp.phActive = xp.phMatches.length ? 0 : -1;
    const items = xp.phMatches.map((name, i) => {
      const li = document.createElement('li');
      li.id = `ph-opt-${i}`;
      li.className = 'combo-item';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === xp.phActive ? 'true' : 'false');
      li.textContent = name;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choosePhotographer(name); });
      return li;
    });
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'combo-empty';
      li.textContent = xp.phInput.value.trim() ? 'No photographer matches — check the spelling.' : 'Type part of a name.';
      items.push(li);
    }
    xp.phList.replaceChildren(...items);
    xp.phList.hidden = false;
    xp.phInput.setAttribute('aria-expanded', 'true');
    if (xp.phActive >= 0) {
      xp.phInput.setAttribute('aria-activedescendant', `ph-opt-${xp.phActive}`);
      xp.phList.querySelector(`#ph-opt-${xp.phActive}`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  function choosePhotographer(name) {
    const src = currentSource();
    if (!src) return;
    closePhotographerList();
    xp.phInput.value = name;
    api.setDumpOptions(src.sourceId, { photographer: name });
  }

  xp.phInput.addEventListener('input', () => { xp.phActive = 0; renderPhotographerList(); });
  xp.phInput.addEventListener('focus', () => { if (xp.phInput.value.trim()) renderPhotographerList(); });
  xp.phInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (xp.phList.hidden) renderPhotographerList();
      const n = xp.phMatches.length;
      if (!n) return;
      xp.phActive = e.key === 'ArrowDown' ? (xp.phActive + 1) % n : (xp.phActive - 1 + n) % n;
      renderPhotographerList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Only a highlighted EXISTING name is ever selected — typed text alone is not a photographer.
      if (!xp.phList.hidden && xp.phActive >= 0 && xp.phMatches[xp.phActive]) choosePhotographer(xp.phMatches[xp.phActive]);
    } else if (e.key === 'Escape') {
      if (!xp.phList.hidden) { e.preventDefault(); e.stopPropagation(); closePhotographerList(); }
    }
  });
  xp.phInput.addEventListener('blur', () => { setTimeout(closePhotographerList, 120); });

  // One-click event picker (companion-owned).
  async function openEventPicker() {
    xp.picker.hidden = false;
    xp.pickerChoice = null;
    $('xp-picker-use').disabled = true;
    xp.pickerSearch.value = '';
    setPickerNote('Loading events…');
    xp.pickerList.replaceChildren();
    const res = await api.listEvents();
    if (!res || !res.ok) {
      setPickerNote(DUMP_REASONS[res && res.reason] || 'The events could not be listed.');
      return;
    }
    xp.pickerEvents = res;
    setPickerNote(res.events.length ? '' : 'No events in this collection yet — use Create New Event.');
    renderPickerList();
    xp.pickerSearch.focus();
  }

  function setPickerNote(text) {
    const n = $('xp-picker-note');
    n.textContent = text;
    n.hidden = !text;
  }

  function renderPickerList() {
    const res = xp.pickerEvents;
    if (!res) return;
    const q = xp.pickerSearch.value.trim().toLowerCase();
    const items = res.events.filter(e => !q || e.folderName.toLowerCase().includes(q)).map(e => {
      const li = document.createElement('li');
      li.className = 'picker-item';
      li.dataset.folder = e.folderName;
      li.setAttribute('role', 'option');
      li.tabIndex = 0;
      const name = document.createElement('span');
      name.className = 'picker-name';
      name.textContent = e.folderName;
      li.append(name);
      if (e.folderName === res.active) {
        const tag = document.createElement('span');
        tag.className = 'picker-tag';
        tag.textContent = 'Current';
        li.append(tag);
      }
      const selected = xp.pickerChoice === e.folderName;
      li.setAttribute('aria-selected', selected ? 'true' : 'false');
      const pick = () => { xp.pickerChoice = e.folderName; $('xp-picker-use').disabled = false; renderPickerList(); };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); pick(); } });
      li.addEventListener('dblclick', () => { pick(); useChosenEvent(); });
      return li;
    });
    xp.pickerList.replaceChildren(...items);
  }

  function closeEventPicker() {
    xp.picker.hidden = true;
    xp.pickerEvents = null;
    xp.pickerChoice = null;
  }

  async function useChosenEvent() {
    if (!xp.pickerChoice) return;
    $('xp-picker-use').disabled = true;
    setPickerNote('Selecting…');
    const res = await api.chooseEvent(xp.pickerChoice);
    if (res && res.state === 'completed') { closeEventPicker(); return; }
    setPickerNote(DUMP_REASONS[res && res.reason] || 'That event could not be selected.');
    $('xp-picker-use').disabled = false;
  }

  xp.pickerSearch.addEventListener('input', renderPickerList);
  xp.pickerSearch.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEventPicker(); } });
  $('xp-picker-cancel').addEventListener('click', closeEventPicker);
  $('xp-picker-use').addEventListener('click', useChosenEvent);
  $('xp-change-event').addEventListener('click', openEventPicker);
  $('xp-new-event').addEventListener('click', () => { api.openEventPicker('new'); });

  function renderExpanded(src) {
    const a = src.assessment || {};
    const s = a.summary;
    const d = a.dump;
    const g = (snap && snap.dump) || { event: null, photographers: [], lastPhotographer: null };
    $('brand-sub').textContent = 'Event Dump';
    $('xp-card-label').textContent = src.label;
    const cams = a.cameras ? cameraItems(a.cameras).map(c => c.name) : [];
    $('xp-card-meta').textContent = cams.length ? cams.join(' · ') : 'Memory card';

    if (s) {
      const dateSel = $('xp-date');
      syncSelect(dateSel, s.options.map(o => [o.date, optionLabel(o)]), s.selection.date);
      dateSel.onchange = () => { api.selectDate(src.sourceId, dateSel.value, s.selection.untilTime); };
      const day = s.selection.date === s.today ? 'today' : `on ${formatDate(s.selection.date)}`;
      $('xp-counts').textContent = d ? `${plural(d.counts.selectedNew, 'new file')} captured ${day}` : '';
      const sub = [];
      if (d && d.counts.selectedImported) sub.push(`${d.counts.selectedImported.toLocaleString()} already imported`);
      if (s.counts.uncertain) sub.push(`${s.counts.uncertain.toLocaleString()} without a reliable date stay on the card`);
      $('xp-counts-sub').textContent = sub.join(' · ');
    }
    const lock = !!(a.handoffPending || (d && d.op && d.op.state === 'pending'));
    $('xp-earlier-row').hidden = !d || d.counts.earlierNew === 0;
    if (d) {
      const earlier = $('xp-earlier');
      earlier.checked = !!d.includeEarlier;
      earlier.disabled = lock;
      earlier.onchange = () => { api.setDumpOptions(src.sourceId, { includeEarlier: earlier.checked }); };
      $('xp-earlier-text').textContent = `Also import ${plural(d.counts.earlierNew, 'new file')} from earlier dates`;
    }

    // Selected event — the complete canonical name, wrapping; never truncated.
    const evName = $('xp-event-name');
    evName.textContent = g.event ? g.event.eventName : 'No event selected';
    evName.dataset.empty = g.event ? '' : 'yes';
    $('xp-event-coll').textContent = g.event ? `Collection ${g.event.collectionName}` : '';
    $('xp-change-event').textContent = g.event ? 'Change Event' : 'Choose Event';
    $('xp-change-event').disabled = lock;
    $('xp-new-event').disabled = lock;

    // Photographer — the confirmed choice lives in main; typing never replaces it.
    if (document.activeElement !== xp.phInput && xp.phList.hidden) xp.phInput.value = (d && d.photographer) || '';
    xp.phInput.disabled = lock;
    const phState = $('xp-ph-state');
    phState.textContent = d && d.photographer ? `Selected: ${d.photographer}` : 'No photographer selected — choose one from the list.';
    phState.dataset.empty = d && d.photographer ? '' : 'yes';
    const sug = $('xp-ph-suggest');
    sug.hidden = !g.lastPhotographer || (d && d.photographer === g.lastPhotographer) || !g.photographers.includes(g.lastPhotographer);
    if (!sug.hidden) {
      const use = $('xp-ph-use-last');
      use.textContent = g.lastPhotographer;
      use.disabled = lock;
      use.onclick = () => choosePhotographer(g.lastPhotographer);
    }

    $('xp-dest').textContent = g.event
      ? `${g.event.collectionName} / ${g.event.eventName} / Dump / ${(d && d.photographer) || '<photographer>'}`
      : 'Choose an event to see where the files will go.';

    // Pinned action.
    const btn = $('xp-import');
    const ready = !!(d && d.ready && g.event && d.photographer && d.counts.toImport > 0);
    btn.disabled = lock || !ready;
    btn.textContent = d && d.counts.toImport > 0 ? `Import ${plural(d.counts.toImport, 'file')} to Dump` : 'Import to Dump';
    btn.title = !g.event ? DUMP_REASONS['no-event'] : !(d && d.photographer) ? DUMP_REASONS['no-photographer'] : '';
    btn.onclick = () => { api.dumpImport(src.sourceId); };
    const op = d && d.op;
    const pending = !!(op && op.state === 'pending');
    $('xp-progress').hidden = !pending;
    if (pending) {
      const p = op.progress || { done: 0, total: 0 };
      $('xp-progress-text').textContent = `Importing to ${g.event ? g.event.eventName : 'the event'} as ${d.photographer}… ${p.done.toLocaleString()} of ${p.total.toLocaleString()}`;
      $('xp-bar').style.width = `${p.total ? Math.round((p.done / p.total) * 100) : 0}%`;
    }
    const res = $('xp-result');
    res.hidden = !op || pending;
    res.textContent = op && !pending ? dumpResultText(op) : '';
    res.dataset.state = op ? op.state : '';
  }

  function render(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.sources)) return;
    snap = snapshot;
    const src = currentSource();
    const view = src ? 'expanded' : 'compact';
    popup.dataset.view = view;
    for (const el of document.querySelectorAll('.view-compact')) el.hidden = view !== 'compact';
    for (const el of document.querySelectorAll('.view-expanded')) el.hidden = view !== 'expanded';
    renderCompact(snapshot.sources);
    if (src) renderExpanded(src);
    else { $('brand-sub').textContent = 'Card companion'; closeEventPicker(); closePhotographerList(); }
  }

  $('back-btn').addEventListener('click', () => { closeEventPicker(); closePhotographerList(); api.setView('compact'); });
  $('open-btn').addEventListener('click', () => api.openAutoIngest());
  $('quit-btn').addEventListener('click', () => api.quit());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) api.hide(); });

  api.onSnapshot(render);
  api.getSnapshot().then(render);
  $('open-btn').focus();
}());
