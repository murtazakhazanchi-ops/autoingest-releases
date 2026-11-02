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
