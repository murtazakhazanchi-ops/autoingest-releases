// renderer/captureTime.js — original capture time in the Import Workspace (Sort Dump included).
//
// The grid, list, timeline, date sort and group panel used to read file.modifiedAt — the filesystem
// modification time — and labelled it as the photo's date. A photo copied or re-tagged later showed
// that later time. This module attaches each file's original capture time (read in main by
// services/captureTimeResolver.js: EXIF DateTimeOriginal first, never a filesystem time) as
// file.capture, reading in the background so a large Dump or card is usable at once.
//
// file.capture: undefined (not read yet) | { status: 'dated', local, offset, source, confidence, conflict? }
//               | { status: 'uncertain', reason, candidates } | { status: 'unavailable', reason }
// `local` is the camera's wall clock as written ("2026-11-16T09:33:11.420"), never shifted by a timezone.
// file.modifiedAt stays the filesystem time (thumbnail cache identity) and is never shown as capture time.

'use strict';

const CaptureTime = (() => {
  const BATCH = 150;
  const RESORT_DELAY_MS = 250;
  const pending = new Set();     // file objects queued or being read
  let queue = [];
  let running = false;
  let generation = 0;            // bumped per ensure(); a stale view is never re-rendered
  let resortTimer = null;
  let onDone = null;

  const pad2 = (n) => String(n).padStart(2, '0');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function _parts(local) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(local || '');
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6], ms: m[7] ? +m[7].slice(0, 3).padEnd(3, '0') : 0 };
  }

  /** Wall-clock ms for ordering (the written time read as if UTC — no local-zone shift). null if not dated. */
  function sortMs(file) {
    const c = file && file.capture;
    if (!c || c.status !== 'dated') return null;
    const p = _parts(c.local);
    return p ? Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s, p.ms) : null;
  }

  /** "16 Nov 2026, 09:33" in the camera's wall clock (12/24 h follows the system locale). */
  function _format(p) {
    const t = new Date(2000, 0, 1, p.h, p.mi).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${pad2(p.d)} ${MONTHS[p.mo - 1]} ${p.y}, ${t}`;
  }

  function label(file) {
    const c = file && file.capture;
    if (!c) return 'Reading capture date…';
    if (c.status === 'dated') { const p = _parts(c.local); return p ? _format(p) : 'Capture date unavailable'; }
    return c.status === 'uncertain' ? 'Capture date uncertain' : 'Capture date unavailable';
  }

  /** Tooltip: the tag the time came from, its offset, and any disagreeing tag. */
  function title(file) {
    const c = file && file.capture;
    if (!c) return 'The original capture time is being read from the file’s metadata.';
    if (c.status === 'dated') {
      const p = _parts(c.local);
      const lines = [`Captured ${p ? `${p.y}-${pad2(p.mo)}-${pad2(p.d)} ${pad2(p.h)}:${pad2(p.mi)}:${pad2(p.s)}` : c.local}${c.offset ? ` (UTC${c.offset})` : ''} — from ${c.source}`];
      if (c.note === 'video-timezone-unknown' || c.confidence === 'low') lines.push('The camera did not record its time zone; shown as written.');
      for (const x of c.conflict || []) lines.push(`${x.source} says ${x.value.replace('T', ' ')}`);
      return lines.join('\n');
    }
    if (c.status === 'uncertain') return `The capture-date tags disagree${(c.candidates || []).length ? `: ${(c.candidates).map(x => `${x.source} ${x.date}`).join(', ')}` : ''}.`;
    return 'This file has no capture date in its metadata. Its filesystem dates are not capture dates.';
  }

  /** Plain-text label + HTML-safe tooltip for templates (escape is the caller's escapeHtml). */
  function cellHtml(file, escape) {
    const cls = !file.capture ? ' capture-pending' : file.capture.status !== 'dated' ? ' capture-missing' : '';
    return { cls, text: escape(label(file)), title: escape(title(file)) };
  }

  /** Timeline group key: "<toDateString>-<hour>" in the camera's wall clock, or a status key. */
  function groupKey(file) {
    const c = file && file.capture;
    if (!c) return 'capture:pending';
    const p = c.status === 'dated' ? _parts(c.local) : null;
    if (!p) return 'capture:none';
    return `${new Date(p.y, p.mo - 1, p.d).toDateString()}-${p.h}`;
  }

  function groupLabel(key) {
    if (key === 'capture:pending') return 'Reading capture dates…';
    if (key === 'capture:none') return 'Capture date unavailable';
    return null;
  }

  /**
   * Date comparator: dated files by capture time; files without one after them (pending ones by their
   * provisional filesystem time, which is never displayed), then by name. `dir` is 'asc' | 'desc'.
   */
  function compare(a, b, dir) {
    const ta = sortMs(a), tb = sortMs(b);
    if (ta != null && tb != null && ta !== tb) return dir === 'asc' ? ta - tb : tb - ta;
    if ((ta == null) !== (tb == null)) return ta == null ? 1 : -1;
    if (ta == null && !a.capture && !b.capture) {
      const ma = Date.parse(a.modifiedAt) || 0, mb = Date.parse(b.modifiedAt) || 0;
      if (ma !== mb) return dir === 'asc' ? ma - mb : mb - ma;
    }
    const n = String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    return dir === 'asc' ? n : -n;
  }

  /** Updates the visible date labels of files just read, without re-rendering the grid. */
  function _patch(files) {
    const area = document.getElementById('fileGrid');
    if (!area) return;
    const byPath = new Map(files.map(f => [f.path, f]));
    for (const el of area.querySelectorAll('[data-capture-for]')) {
      const f = byPath.get(el.getAttribute('data-capture-for'));
      if (!f) continue;
      el.textContent = label(f);
      el.title = title(f);
      el.classList.toggle('capture-pending', !f.capture);
      el.classList.toggle('capture-missing', !!f.capture && f.capture.status !== 'dated');
    }
  }

  async function _drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const batch = queue.splice(0, BATCH);
        let res = {};
        try { res = (await window.api.readCaptureTimes(batch.map(f => ({ path: f.path, type: f.type, size: f.size, modifiedAt: f.modifiedAt })))) || {}; }
        catch { res = {}; }
        for (const f of batch) {
          pending.delete(f);
          f.capture = res[f.path] || { status: 'unavailable', reason: 'unreadable' };
        }
        _patch(batch);
      }
    } finally {
      running = false;
    }
    // The latest ensure()'s callback, once nothing is left to read (a newer ensure() may have added
    // files to this same drain). It runs only if no further ensure() came in meanwhile.
    const g = generation;
    clearTimeout(resortTimer);
    resortTimer = setTimeout(() => { if (g === generation && !queue.length && !running && typeof onDone === 'function') onDone(); }, RESORT_DELAY_MS);
  }

  /**
   * Reads the capture time of every file in `files` not read yet. `done` runs once when they are all
   * read and this is still the latest request — the caller re-sorts / re-groups then.
   * @returns {boolean} true when something is being read
   */
  function ensure(files, done) {
    ++generation;
    onDone = done || null;
    const media = (files || []).filter(f => f && !f.capture && !pending.has(f) && (f.type === 'photo' || f.type === 'raw' || f.type === 'video'));
    for (const f of (files || [])) if (f && !f.capture && f.type !== 'photo' && f.type !== 'raw' && f.type !== 'video') f.capture = { status: 'unavailable', reason: 'not-media' };
    for (const f of media) pending.add(f);
    queue = queue.concat(media);
    if (!media.length && !running && !queue.length) return false;
    _drain();
    return true;
  }

  return { ensure, label, title, cellHtml, sortMs, compare, groupKey, groupLabel, get busy() { return running || queue.length > 0; } };
})();

window.CaptureTime = CaptureTime;
