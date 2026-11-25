/**
 * captureTimeResolver.js — the original capture time the Import Workspace shows and sorts by
 * (Sort Dump included). Read-only: it reads media metadata, never writes it.
 *
 * Before this resolver the workspace showed and sorted by the file's filesystem modification
 * time (main/fileBrowser.js `modifiedAt`). A copied, moved or re-tagged photo then showed the
 * time it was copied — e.g. a CR3 captured 09:33 showed 22:31 in Sort Dump.
 *
 * Policy (AI-FEAT-064 EQI-3.2 hotfix; same wall-clock rules as services/captureDateEvidence.js):
 *   - Photos and RAW: EXIF SubSecDateTimeOriginal / DateTimeOriginal is authoritative (what Adobe
 *     Bridge shows as "Date Created" for camera files). Then EXIF CreateDate, then XMP
 *     photoshop:DateCreated / XMP exif:DateTimeOriginal, then IPTC DateCreated + TimeCreated.
 *     When a lower tag disagrees with the one used, the conflict is reported, never "fixed".
 *   - Video: captureDateEvidence's video rules (offset-bearing CreationDate first, the QuickTime
 *     CreateDate family read both as written and as UTC). A calendar date that depends on the
 *     QuickTime timezone guess is "uncertain", not dated.
 *   - Times are the camera's own wall clock as written. A naive value is never converted; an
 *     offset is kept beside it. Subseconds are kept for ordering.
 *   - Filesystem times (modify, create) are never capture evidence. No usable tag → unavailable.
 *
 * Result per file:
 *   { status: 'dated', local: 'YYYY-MM-DDTHH:MM:SS[.fff]', offset, source, confidence, conflict? }
 *   { status: 'uncertain', reason, candidates }   — tags exist but disagree on the date
 *   { status: 'unavailable', reason }             — no capture metadata (or unreadable)
 */

'use strict';

const { captureEvidence, parseCaptureValue } = require('./captureDateEvidence');

const EXIFR_TIMEOUT_MS = 500;
const CONCURRENCY = 4;                 // main/exifService.js pool size (maxProcs: 4)
const CACHE_MAX = 50000;

/** ExifTool tags read for one file (RAW/video, or a photo exifr could not date). */
const READ_TAGS = [
  'SubSecDateTimeOriginal', 'DateTimeOriginal', 'SubSecTimeOriginal', 'OffsetTimeOriginal', 'CreateDate',
  'CreationDate', 'MediaCreateDate', 'TrackCreateDate', 'DateCreated', 'TimeCreated',
];
/** Which group supplies a tag when several do — EXIF before maker notes before XMP. */
const GROUP_ORDER = ['Composite', 'ExifIFD', 'IFD0', 'Nikon', 'Canon', 'Sony', 'Keys', 'UserData', 'QuickTime', 'Track1', 'Track2', 'XMP-exif', 'XMP-photoshop', 'XMP-xmp', 'IPTC'];

const _cache = new Map();   // `${path}|${size}|${mtimeMs}` → result (a changed file is read again)

const SUBSEC_RE = /^\d{4}[:-]\d{2}[:-]\d{2}[ T]\d{2}:\d{2}:\d{2}\.(\d+)/;

function _text(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof v.rawValue === 'string') return v.rawValue;
  return null;
}

function _local(parsed, subsec) {
  const frac = subsec && /^\d+$/.test(subsec) ? `.${subsec.slice(0, 3).padEnd(3, '0')}` : '';
  return `${parsed.date}T${parsed.time}${frac}`;
}

/**
 * Pure: the capture time from a bare-name tag view.
 * @param {Record<string, unknown>|null} tags  bare tag name → value ({ group: value } lists are not accepted)
 * @param {'photo'|'raw'|'video'} type
 */
function resolveFromTags(tags, type) {
  if (!tags || typeof tags !== 'object') return { status: 'unavailable', reason: 'unreadable' };
  if (type === 'video') {
    const ev = captureEvidence(tags, 'video');
    if (ev.status === 'dated') {
      return { status: 'dated', local: `${ev.date}T${ev.time}`, offset: ev.offset, source: ev.source, confidence: ev.confidence, ...(ev.note ? { note: ev.note } : {}) };
    }
    return ev.reason === 'no-capture-metadata' || ev.reason === 'read-error'
      ? { status: 'unavailable', reason: ev.reason }
      : { status: 'uncertain', reason: ev.reason, candidates: ev.candidates };
  }

  const candidates = [];
  const add = (source, value, extraSubsec = null, offset = null) => {
    const p = parseCaptureValue(value);
    if (!p || p.invalid) return;
    const m = SUBSEC_RE.exec(String(_text(value) || '').trim());
    candidates.push({ source, parsed: { ...p, offset: p.offset || offset }, subsec: (m && m[1]) || extraSubsec });
  };
  const offsetOriginal = typeof tags.OffsetTimeOriginal === 'string' && /^[+-]\d{2}:\d{2}$/.test(tags.OffsetTimeOriginal) ? tags.OffsetTimeOriginal : null;
  const subsecOriginal = tags.SubSecTimeOriginal != null && /^\d+$/.test(String(tags.SubSecTimeOriginal).trim()) ? String(tags.SubSecTimeOriginal).trim() : null;
  add('SubSecDateTimeOriginal', tags.SubSecDateTimeOriginal, null, offsetOriginal);
  add('DateTimeOriginal', tags.DateTimeOriginal, subsecOriginal, offsetOriginal);
  add('CreateDate', tags.CreateDate);
  add('XMP-photoshop:DateCreated', tags['XMP-photoshop:DateCreated']);
  add('XMP-exif:DateTimeOriginal', tags['XMP-exif:DateTimeOriginal']);
  const iptcDate = _text(tags['IPTC:DateCreated']);
  if (iptcDate) {
    const time = _text(tags['IPTC:TimeCreated']);
    const m = /^(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:?\d{2})?/.exec(String(time || '').trim());
    add('IPTC:DateCreated', m ? `${iptcDate.trim()} ${m[1]}:${m[2]}:${m[3]}${m[4] || ''}` : `${iptcDate.trim()} 00:00:00`);
    if (!m && candidates.length && candidates[candidates.length - 1].source === 'IPTC:DateCreated') candidates[candidates.length - 1].dateOnly = true;
  }
  const usable = candidates.filter(c => !c.dateOnly);
  if (!usable.length) {
    const sawAny = ['SubSecDateTimeOriginal', 'DateTimeOriginal', 'CreateDate'].some(k => tags[k] != null && tags[k] !== '');
    return { status: 'unavailable', reason: sawAny ? 'invalid-date' : 'no-capture-metadata' };
  }
  const best = usable[0];
  const minute = (c) => `${c.parsed.date}T${c.parsed.time.slice(0, 5)}`;
  const conflict = candidates.filter(c => c !== best && (c.dateOnly ? c.parsed.date !== best.parsed.date : minute(c) !== minute(best)))
    .map(c => ({ source: c.source, value: c.dateOnly ? c.parsed.date : `${c.parsed.date}T${c.parsed.time}` }));
  const confidence = best.source.endsWith('DateTimeOriginal') && !best.source.startsWith('XMP') ? 'high' : 'medium';
  return {
    status: 'dated', local: _local(best.parsed, best.subsec), offset: best.parsed.offset || null, source: best.source, confidence,
    ...(conflict.length ? { conflict } : {}),
  };
}

/** A grouped ExifTool read (`Group:Tag` keys) → the bare-name view resolveFromTags reads. */
function viewFromGrouped(grouped) {
  const byTag = new Map();
  const view = {};
  for (const [key, value] of Object.entries(grouped || {})) {
    const i = key.indexOf(':');
    if (i < 0 || value === '' || value == null) continue;
    const group = key.slice(0, i), tag = key.slice(i + 1);
    if (tag === 'DateCreated' || tag === 'TimeCreated' || (tag === 'DateTimeOriginal' && group === 'XMP-exif')) {
      const k = group === 'IPTC' ? `IPTC:${tag}` : group.startsWith('XMP') ? `${group}:${tag}` : null;
      if (k && !(k in view)) view[k] = value;
      if (tag !== 'DateTimeOriginal') continue;
    }
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push({ group, value });
  }
  const rank = (g) => { const r = GROUP_ORDER.indexOf(g); return r < 0 ? GROUP_ORDER.length : r; };
  for (const [tag, list] of byTag) {
    const nonXmp = list.filter(x => !x.group.startsWith('XMP'));
    const pool = tag === 'DateTimeOriginal' && nonXmp.length ? nonXmp : list;
    view[tag] = [...pool].sort((a, b) => rank(a.group) - rank(b.group))[0].value;
  }
  return view;
}

let _exifr = null;
let _exifService = null;
function _deps() {
  if (!_exifr) _exifr = require('exifr');
  if (!_exifService) _exifService = require('../main/exifService');
}

async function _exifrView(filePath) {
  let timer;
  try {
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), EXIFR_TIMEOUT_MS); });
    const t = await Promise.race([_exifr.parse(filePath, { pick: ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'SubSecTimeOriginal'], reviveValues: false }), timeout]);
    return t && t.DateTimeOriginal ? t : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

/**
 * One file's capture time. Photos (JPEG/PNG/TIFF) try exifr in-process first; RAW, video and any
 * photo exifr cannot date are read once through the shared ExifTool pool. Never throws.
 */
async function readCaptureTime(file) {
  const type = file.type === 'raw' || file.type === 'video' ? file.type : 'photo';
  const mtimeMs = file.modifiedAt ? new Date(file.modifiedAt).getTime() : '';
  const key = `${file.path}|${file.size}|${mtimeMs}`;
  if (_cache.has(key)) return _cache.get(key);
  let result;
  try {
    _deps();
    let view = type === 'photo' ? await _exifrView(file.path) : null;
    if (!view) view = viewFromGrouped(await _exifService.readGroupedTags(file.path, READ_TAGS));
    result = resolveFromTags(view, type);
  } catch {
    result = { status: 'unavailable', reason: 'unreadable' };
  }
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(key, result);
  return result;
}

/**
 * @param {Array<{path:string, size:number, modifiedAt:string, type:string}>} files
 * @returns {Promise<Record<string, object>>} path → result
 */
async function readCaptureTimes(files) {
  const list = (Array.isArray(files) ? files : []).filter(f => f && typeof f.path === 'string');
  const out = {};
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const f = list[next++];
      out[f.path] = await readCaptureTime(f);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  return out;
}

module.exports = { resolveFromTags, viewFromGrouped, readCaptureTime, readCaptureTimes, READ_TAGS, _cache };
