/**
 * captureDateEvidence.js — what a file's own metadata says about WHEN it was captured
 * (AI-FEAT-061 Q2, smart date-based card assessment). Pure: no Electron, no filesystem.
 *
 * Input is the tag object main/exifService.js's readFileTags() already returns (the
 * shared ExifTool pool, default `-fast` read). Output is one evidence record per file.
 *
 * Rules (AI-FEAT-061 § Q2, DEC-029 decision 4):
 *   - Capture dates come from media metadata only. Filesystem timestamps are never
 *     capture evidence; a file without a readable capture date is "uncertain".
 *   - Times are compared as the camera's own wall clock, exactly as written. A naive
 *     time (no offset) is never converted; an offset, when written, is reported only.
 *   - Photos/RAW: SubSecDateTimeOriginal / DateTimeOriginal first, EXIF CreateDate next.
 *     Two tags that disagree on the calendar date → uncertain, never guessed.
 *   - Video: an offset-bearing CreationDate (QuickTime Keys) is the camera's local time.
 *     A naive DateTimeOriginal is taken as written. The QuickTime CreateDate family is
 *     UTC by specification but many cameras write local time into it, so it is read
 *     both ways: when both readings give the same calendar date the file is dated with
 *     LOW confidence; when they differ the date is uncertain.
 *   - Values like "0000:00:00 00:00:00" or out-of-range years are invalid, not dates.
 */

'use strict';

const MIN_VALID_YEAR = 1970;
const MAX_VALID_YEAR = 2100;

const PHOTO_PRIMARY_TAGS = ['SubSecDateTimeOriginal', 'DateTimeOriginal'];
const VIDEO_UTC_TAGS = ['CreateDate', 'MediaCreateDate', 'TrackCreateDate'];

const DATE_RE = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?\s*$/;

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Parses one ExifTool date value (exiftool-vendored ExifDateTime, or a plain string)
 * into its written wall-clock parts. Uses the original text (rawValue) so no library
 * timezone inference can shift it.
 * @param {unknown} value
 * @returns {{ date: string, time: string, offset: string|null } | { invalid: true } | null}
 *   null when absent; { invalid: true } when present but not a usable date
 */
function parseCaptureValue(value) {
  if (value === undefined || value === null || value === '') return null;
  let text = null;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'object' && typeof value.rawValue === 'string') text = value.rawValue;
  if (text === null) return { invalid: true };
  const m = DATE_RE.exec(text.trim());
  if (!m) return { invalid: true };
  const [, y, mo, d, h, mi, s = '00', zone] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(s);
  if (year < MIN_VALID_YEAR || year > MAX_VALID_YEAR) return { invalid: true };
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 60) return { invalid: true };
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1) return { invalid: true }; // e.g. 31 February
  let offset = null;
  if (zone) offset = zone === 'Z' ? '+00:00' : (zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`);
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}:${pad2(second)}`, offset };
}

/** Local calendar date/time of a UTC instant, in this computer's timezone. */
function localPartsOfUtc(utcMs) {
  const t = new Date(utcMs);
  return {
    date: `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`,
    time: `${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`,
  };
}

function _firstValid(tags, names) {
  let sawInvalid = false;
  for (const name of names) {
    const parsed = parseCaptureValue(tags[name]);
    if (parsed && !parsed.invalid) return { source: name, ...parsed };
    if (parsed && parsed.invalid) sawInvalid = true;
  }
  return sawInvalid ? { invalid: true } : null;
}

function _dated(found, confidence, extra = {}) {
  return {
    status: 'dated', date: found.date, time: found.time, offset: found.offset || null,
    source: found.source, confidence, reason: null, candidates: null, ...extra,
  };
}

function _uncertain(reason, candidates = null) {
  return { status: 'uncertain', date: null, time: null, offset: null, source: null, confidence: null, reason, candidates };
}

function _photoEvidence(tags) {
  const primary = _firstValid(tags, PHOTO_PRIMARY_TAGS);
  const secondary = _firstValid(tags, ['CreateDate']);
  const primaryOk = primary && !primary.invalid;
  const secondaryOk = secondary && !secondary.invalid;
  if (primaryOk) {
    // OffsetTimeOriginal accompanies DateTimeOriginal when SubSec… was not written.
    if (!primary.offset && typeof tags.OffsetTimeOriginal === 'string' && /^[+-]\d{2}:\d{2}$/.test(tags.OffsetTimeOriginal)) {
      primary.offset = tags.OffsetTimeOriginal;
    }
    if (secondaryOk && secondary.date !== primary.date) {
      return _uncertain('conflicting-tags', [
        { source: primary.source, date: primary.date },
        { source: 'CreateDate', date: secondary.date },
      ]);
    }
    return _dated(primary, 'high');
  }
  if (secondaryOk) return _dated(secondary, 'medium');
  return _uncertain(primary || secondary ? 'invalid-date' : 'no-capture-metadata');
}

function _videoEvidence(tags) {
  const creation = _firstValid(tags, ['CreationDate']);
  if (creation && !creation.invalid) return _dated(creation, creation.offset ? 'high' : 'medium');
  const original = _firstValid(tags, ['DateTimeOriginal']);
  if (original && !original.invalid) return _dated(original, 'medium');
  const utc = _firstValid(tags, VIDEO_UTC_TAGS);
  if (utc && !utc.invalid) {
    const asWritten = { date: utc.date, time: utc.time };
    const [y, mo, d] = utc.date.split('-').map(Number);
    const [h, mi, s] = utc.time.split(':').map(Number);
    const asUtc = localPartsOfUtc(Date.UTC(y, mo - 1, d, h, mi, s));
    if (asUtc.date === asWritten.date) {
      // Same calendar day whichever way the camera meant it; the time stays as written.
      return _dated({ ...utc, offset: null }, 'low', { note: 'video-timezone-unknown' });
    }
    return _uncertain('video-timezone-ambiguous', [
      { source: `${utc.source} (as written)`, date: asWritten.date },
      { source: `${utc.source} (as UTC)`, date: asUtc.date },
    ]);
  }
  return _uncertain(creation || original || utc ? 'invalid-date' : 'no-capture-metadata');
}

/**
 * @param {Record<string, unknown>|null} tags  readFileTags() result, or null when unreadable
 * @param {'photo'|'raw'|'video'} type  fileBrowser media type
 * @returns {{ status: 'dated'|'uncertain', date: string|null, time: string|null,
 *            offset: string|null, source: string|null,
 *            confidence: 'high'|'medium'|'low'|null, reason: string|null,
 *            candidates: Array<{source: string, date: string}>|null, note?: string }}
 */
function captureEvidence(tags, type) {
  if (!tags || typeof tags !== 'object') return _uncertain('read-error');
  return type === 'video' ? _videoEvidence(tags) : _photoEvidence(tags);
}

module.exports = { captureEvidence, parseCaptureValue, localPartsOfUtc, MIN_VALID_YEAR, MAX_VALID_YEAR };
