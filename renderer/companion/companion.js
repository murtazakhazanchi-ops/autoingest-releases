/**
 * companion.js — renderer for the menu-bar/tray companion popup (AI-FEAT-061 Q1/Q2).
 * Renders the snapshot pushed by main; never computes status of its own: counts,
 * buckets, the selected date and every refusal message come from main. This file only
 * formats dates for display and sends the operator's choices back by opaque sourceId.
 * Text is set with textContent only.
 *
 * Rows are keyed by sourceId and updated in place, so a progress push or a poll never
 * closes a date menu the operator has open.
 */

'use strict';

(function () {
  const api = window.companion;
  const heading = document.getElementById('status-heading');
  const empty = document.getElementById('empty-state');
  const list = document.getElementById('card-list');
  const rowTemplate = document.getElementById('card-row');
  /** @type {Map<string, HTMLElement>} */
  const rows = new Map();
  /** sourceIds whose camera list the operator expanded (presentation only). */
  const expandedCameras = new Set();
  const CAMERAS_SHOWN = 3;
  /** EQI-1: companion-wide Event Dump view (destination event, photographer list) from main. */
  let dumpGlobal = null;

  const DUMP_REASONS = {
    'no-event': 'Choose an event first.',
    'no-photographer': 'Choose the photographer first.',
    'nothing-new': 'No new photos to import for this date.',
    'busy': 'AutoIngest is busy — try again when the current task finishes.',
    'source-detached': 'The card was removed.',
    'assessment-unavailable': 'The card changed — wait for the check to finish, then try again.',
    'event-changed': 'The event changed in AutoIngest — check the event and try again.',
    'no-event-in-app': 'No event is open in AutoIngest.',
    'event-unreadable': "This event's information could not be read. Open AutoIngest to check it.",
    'staging-not-configured': 'Local staging is not set up — open AutoIngest → Archive Locations.',
    'archive-offline': 'The archive is offline — use Local First for this event in AutoIngest.',
    'archive-busy': 'The archive folder is busy on another computer. Try again shortly.',
    'workspace-not-opened': "AutoIngest's window did not open.",
    'workspace-closed': "AutoIngest's window was closed during the import.",
    'no-response': 'AutoIngest stopped responding.',
    'unknown-photographer': 'That photographer is not in the photographer list.',
  };

  const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const UNCERTAIN_REASONS = {
    'no-capture-metadata': 'no capture date',
    'invalid-date': 'invalid date',
    'conflicting-tags': 'conflicting dates',
    'video-timezone-ambiguous': 'video time zone unknown',
    'pair-inconsistent': 'RAW/JPEG pair disagrees',
    'read-error': 'unreadable',
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

  function renderSummary(row, sourceId, s, handoffPending) {
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
  }

  function dumpCountsText(c, date) {
    const parts = [`${plural(c.selectedNew, 'new file')} ${date}`];
    if (c.selectedImported) parts.push(`${c.selectedImported.toLocaleString()} already imported (not selected)`);
    return parts.join(' · ');
  }

  function dumpResultText(op, photographer) {
    const r = op.result || {};
    if (op.state === 'refused' || op.state === 'cancelled' || op.state === 'failed') {
      return DUMP_REASONS[op.reason] || (r.detail ? `Import failed: ${r.detail}` : 'The import did not run.');
    }
    const where = photographer ? `Dump / ${photographer}` : 'the Dump';
    const head = `${plural(r.copied || 0, 'file')} copied and size-verified into ${where}`;
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

  /** EQI-1 Event Dump section for one card. */
  function renderDump(row, sourceId, d, s, handoffPending) {
    const box = row.querySelector('.dump');
    const mode = d ? d.mode : 'review';
    for (const b of row.querySelectorAll('.mode-btn')) {
      const on = b.dataset.mode === mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.onclick = () => { api.setDumpOptions(sourceId, { mode: b.dataset.mode }); };
    }
    row.querySelector('.card-actions').hidden = mode === 'dump';
    box.hidden = !d || mode !== 'dump';
    if (box.hidden) return;

    const g = dumpGlobal || { event: null, photographers: [], lastPhotographer: null };
    const ev = row.querySelector('.dump-event-name');
    ev.textContent = g.event ? g.event.eventName : 'No event selected';
    ev.title = g.event ? `${g.event.collectionName} / ${g.event.eventName}` : '';
    ev.dataset.empty = g.event ? '' : 'yes';
    const pending = !!(d.op && d.op.state === 'pending');
    const lock = handoffPending || pending;
    const choose = row.querySelector('.dump-choose-event');
    choose.textContent = g.event ? 'Change event' : 'Choose event';
    choose.disabled = lock;
    choose.onclick = () => { api.openEventPicker('choose'); };
    const create = row.querySelector('.dump-new-event');
    create.disabled = lock;
    create.onclick = () => { api.openEventPicker('new'); };

    const sel = row.querySelector('.dump-photographer');
    syncSelect(sel, [['', 'Choose photographer…'], ...g.photographers.map(n => [n, n])], d.photographer || '');
    sel.disabled = lock;
    sel.onchange = () => { api.setDumpOptions(sourceId, { photographer: sel.value || null }); };
    const sug = row.querySelector('.dump-suggest');
    sug.hidden = !g.lastPhotographer || d.photographer === g.lastPhotographer || !g.photographers.includes(g.lastPhotographer);
    if (!sug.hidden) {
      const use = row.querySelector('.dump-use-last');
      use.textContent = g.lastPhotographer;
      use.disabled = lock;
      use.onclick = () => { api.setDumpOptions(sourceId, { photographer: g.lastPhotographer }); };
    }

    const date = s.selection.date === s.today ? 'from today' : `from ${formatDate(s.selection.date)}`;
    row.querySelector('.dump-counts').textContent = dumpCountsText(d.counts, date);
    const earlierRow = row.querySelector('.dump-earlier-row');
    earlierRow.hidden = d.counts.earlierNew === 0;
    const earlier = row.querySelector('.dump-earlier');
    earlier.checked = !!d.includeEarlier;
    earlier.disabled = lock;
    earlier.onchange = () => { api.setDumpOptions(sourceId, { includeEarlier: earlier.checked }); };
    row.querySelector('.dump-earlier-text').textContent = `Also import ${plural(d.counts.earlierNew, 'new file')} from earlier dates`;

    const btn = row.querySelector('.dump-import');
    btn.disabled = lock || !g.event || !d.photographer || d.counts.toImport === 0 || !d.ready;
    btn.textContent = d.counts.toImport > 0 ? `Import ${plural(d.counts.toImport, 'file')} to Dump` : 'Import to Dump';
    btn.title = !g.event ? DUMP_REASONS['no-event'] : !d.photographer ? DUMP_REASONS['no-photographer'] : '';
    btn.onclick = () => { api.dumpImport(sourceId); };

    const prog = row.querySelector('.dump-progress');
    prog.hidden = !pending;
    if (pending) {
      const p = d.op.progress || { done: 0, total: 0 };
      row.querySelector('.dump-progress-text').textContent = `Importing… ${p.done.toLocaleString()} of ${p.total.toLocaleString()}`;
      row.querySelector('.dump-bar').style.width = `${p.total ? Math.round((p.done / p.total) * 100) : 0}%`;
    }
    const res = row.querySelector('.dump-result');
    res.hidden = !d.op || pending;
    res.textContent = d.op && !pending ? dumpResultText(d.op, d.photographer) : '';
    res.dataset.state = d.op ? d.op.state : '';
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
    const items = cams.cameras.map(c => ({
      name: c.bodyLabel ? `${c.display} · Body ${c.bodyLabel}` : c.display,
      count: c.files,
      badge: c.status === 'body-identified' ? 'Body identified' : 'Body not identified',
      status: c.status,
    }));
    if (cams.unknownFiles) items.push({ name: 'Unknown camera', count: cams.unknownFiles, badge: null, status: 'unknown' });
    if (cams.conflictFiles) items.push({ name: 'Conflicting camera information', count: cams.conflictFiles, badge: 'Not assigned', status: 'conflict' });
    const heading = row.querySelector('.cameras-heading');
    heading.textContent = cams.cameras.length === 1 ? 'Camera' : `Cameras (${cams.cameras.length})`;
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
    if (a && a.summary) renderSummary(row, src.sourceId, a.summary, !!a.handoffPending);
    if (a && a.summary) renderDump(row, src.sourceId, a.dump, a.summary, !!a.handoffPending);
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

  function render(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.sources)) return;
    dumpGlobal = snapshot.dump || null;
    const sources = snapshot.sources;
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

  document.getElementById('open-btn').addEventListener('click', () => api.openAutoIngest());
  document.getElementById('quit-btn').addEventListener('click', () => api.quit());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.hide(); });

  api.onSnapshot(render);
  api.getSnapshot().then(render);
  document.getElementById('open-btn').focus();
}());
