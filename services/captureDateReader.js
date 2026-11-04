/**
 * captureDateReader.js — reads one card file's capture-date tags (AI-FEAT-061 Q2) and,
 * in the same read, its camera-identity tags (Q3). Read-only.
 *
 * Same reader split main/qmzService.js established:
 *   - non-RAW photos (fileBrowser type 'photo': JPEG/PNG/TIFF): exifr, in-process, a
 *     tag-only parse with raw (un-revived) values, so the written text is preserved.
 *     exifr also returns Make, Model and the EXIF body serial; it cannot read maker
 *     notes, so the card assessment may follow up with readIdentityTags() (Q3).
 *   - RAW and video: ONE ExifTool read through main/exifService.js's shared pool
 *     (readGroupedTags: `-fast -G1 -a`, only the date + identity tags), so every value
 *     keeps the metadata group that supplied it. exifr is never used for RAW: it can
 *     leak file descriptors on exotic RAW formats (services/thumbnailer.js).
 * When exifr finds no capture date (or fails, or times out) the file is read again with
 * ExifTool, so the fast path can only ever add speed, never lose evidence.
 *
 * Q2 compatibility: captureDateEvidence reads bare tag names (the view ExifTool gives
 * without groups). dateViewFromGrouped() rebuilds exactly that view from the grouped
 * read, choosing between duplicate tags in the order ExifTool itself does — measured on
 * 3,459 real camera files (Canon, Sony, Nikon, DJI, Panasonic; photo, RAW and video).
 *
 * Measured on 300 JPEGs (this machine): exifr ≈ 0.2 ms/file; ExifTool through the
 * shared pool ≈ 42 ms/file per process (per-task overhead, not parsing).
 */

'use strict';

const EXIFR_TIMEOUT_MS = 500;
const EXIFR_TAGS = ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'Make', 'Model', 'SerialNumber'];
const DATE_TAGS_PRESENT = ['DateTimeOriginal', 'CreateDate'];

/** Capture-date tags captureDateEvidence uses. */
const DATE_TAGS = ['SubSecDateTimeOriginal', 'DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'CreationDate', 'MediaCreateDate', 'TrackCreateDate'];
/** Camera-identity tags (Q3). Lens serials, Artist, Owner and Copyright are deliberately not read. */
const IDENTITY_TAGS = ['Make', 'Model', 'SerialNumber', 'CameraSerialNumber', 'InternalSerialNumber', 'InternalSerialNumber2', 'CanonModelID', 'SonyModelID', 'Encoder', 'Software'];

/**
 * Which group's value ExifTool reports for a bare tag name when several groups carry it
 * (measured; groups not listed fall back to the order ExifTool printed them in).
 */
const DATE_PRIORITY = {
  DateTimeOriginal: ['ExifIFD', 'Nikon', 'IFD0', 'XMP-exif'],
  CreateDate: ['Nikon', 'QuickTime', 'ExifIFD', 'XMP-xmp'],
  SubSecDateTimeOriginal: ['Composite'],
  OffsetTimeOriginal: ['ExifIFD'],
  MediaCreateDate: ['Track1', 'Track2', 'Track3'],
  TrackCreateDate: ['Track1', 'Track2', 'Track3'],
};

let _exifr = null;
let _exifService = null;

function _deps() {
  // Lazy: the ExifTool pool is only touched when a file needs it.
  if (!_exifr) _exifr = require('exifr');
  if (!_exifService) _exifService = require('../main/exifService');
}

/** Bare tag name → [{ group, value }] in the order ExifTool printed them. */
function _byTag(grouped) {
  const out = new Map();
  for (const [key, value] of Object.entries(grouped || {})) {
    const i = key.indexOf(':');
    if (i < 0) continue;
    const tag = key.slice(i + 1);
    if (!out.has(tag)) out.set(tag, []);
    out.get(tag).push({ group: key.slice(0, i), value });
  }
  return out;
}

/**
 * The bare-name date view captureDateEvidence expects, from a grouped read.
 * @param {Record<string, unknown>} grouped
 * @returns {Record<string, unknown>}
 */
function dateViewFromGrouped(grouped) {
  const byTag = _byTag(grouped);
  const view = {};
  for (const tag of DATE_TAGS) {
    const cands = byTag.get(tag);
    if (!cands || !cands.length) continue;
    const order = DATE_PRIORITY[tag] || [];
    const ranked = [...cands].sort((a, b) => {
      const ra = order.indexOf(a.group), rb = order.indexOf(b.group);
      return (ra < 0 ? order.length : ra) - (rb < 0 ? order.length : rb);
    });
    view[tag] = ranked[0].value;
  }
  return view;
}

/** Only the identity tags of a grouped read, keys kept as "Group:Tag". */
function identityFromGrouped(grouped) {
  const out = {};
  for (const [key, value] of Object.entries(grouped || {})) {
    const tag = key.slice(key.indexOf(':') + 1);
    if (key.includes(':') && IDENTITY_TAGS.includes(tag) && value !== '' && value != null) out[key] = value;
  }
  return out;
}

async function _exifrTags(filePath) {
  let timer;
  try {
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), EXIFR_TIMEOUT_MS); });
    const tags = await Promise.race([_exifr.parse(filePath, { pick: EXIFR_TAGS, reviveValues: false }), timeout]);
    return tags && DATE_TAGS_PRESENT.some(k => tags[k]) ? tags : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** exifr's standard tags under the ExifTool group names they correspond to. */
function _identityFromExifr(t) {
  const id = {};
  if (t.Make) id['IFD0:Make'] = t.Make;
  if (t.Model) id['IFD0:Model'] = t.Model;
  if (t.SerialNumber != null && t.SerialNumber !== '') id['ExifIFD:SerialNumber'] = t.SerialNumber;
  return id;
}

/**
 * One read for both capture date (Q2) and camera identity (Q3).
 * @param {string} filePath
 * @param {'photo'|'raw'|'video'} type  fileBrowser media type (from config/app.config.js)
 * @returns {Promise<{ tags: object, id: Record<string, unknown>, makerNotesRead: boolean }>}
 *   tags: bare-name date tags for captureDateEvidence; id: grouped identity tags;
 *   makerNotesRead: false when only exifr's standard tags were available.
 *   Rejects only if the ExifTool read itself fails.
 */
async function readCaptureMetadata(filePath, type) {
  _deps();
  if (type === 'photo') {
    const fast = await _exifrTags(filePath);
    if (fast) {
      const tags = {};
      for (const k of ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal']) if (fast[k] !== undefined) tags[k] = fast[k];
      return { tags, id: _identityFromExifr(fast), makerNotesRead: false };
    }
  }
  const grouped = await _exifService.readGroupedTags(filePath, [...DATE_TAGS, ...IDENTITY_TAGS]);
  return { tags: dateViewFromGrouped(grouped), id: identityFromGrouped(grouped), makerNotesRead: true };
}

/** Q3 follow-up for a photo read by exifr: its maker-note identity tags, via ExifTool. */
async function readIdentityTags(filePath) {
  _deps();
  return identityFromGrouped(await _exifService.readGroupedTags(filePath, IDENTITY_TAGS));
}

/**
 * Q4d: ExifTool's hash of the image/media data only (metadata excluded), so a file whose
 * metadata AutoIngest rewrote still matches its camera original. null when unsupported.
 */
async function readImageDataHash(filePath) {
  _deps();
  const grouped = await _exifService.readGroupedTags(filePath, ['ImageDataHash']);
  const key = Object.keys(grouped || {}).find(k => k.endsWith(':ImageDataHash'));
  const v = key ? grouped[key] : null;
  return typeof v === 'string' && /^[0-9a-f]{32,128}$/i.test(v) ? v.toLowerCase() : null;
}

/** Q2 entry point (date tags only), kept for existing callers. */
async function readCaptureTags(filePath, type) {
  return (await readCaptureMetadata(filePath, type)).tags;
}

module.exports = {
  readCaptureMetadata, readIdentityTags, readImageDataHash, readCaptureTags, dateViewFromGrouped, identityFromGrouped,
  DATE_TAGS, IDENTITY_TAGS, EXIFR_TIMEOUT_MS,
};
