/**
 * captureDateReader.js — reads the capture-date tags of one card file for the Q2
 * assessment (AI-FEAT-061). Read-only; returns a tag object for captureDateEvidence.
 *
 * Same reader split main/qmzService.js already established:
 *   - non-RAW photos (fileBrowser type 'photo': JPEG/PNG/TIFF): exifr, in-process, a
 *     tag-only parse with raw (un-revived) values, so the written text is preserved;
 *   - RAW and video: ExifTool through main/exifService.js's readFileTags() — the shared,
 *     already-running process pool (default `-fast` read, which still finds QuickTime
 *     dates written after the media data). exifr is never used for RAW: it can leak file
 *     descriptors on exotic RAW formats (services/thumbnailer.js).
 * When exifr finds no capture date (or fails, or times out) the file is read again with
 * ExifTool, so the fast path can only ever add speed, never lose evidence.
 *
 * Measured on 300 JPEGs (this machine): exifr ≈ 0.2 ms/file; ExifTool through the
 * shared pool ≈ 42 ms/file per process (per-task overhead, not parsing).
 */

'use strict';

const EXIFR_TIMEOUT_MS = 500;
const EXIFR_TAGS = ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal'];
const DATE_TAGS = ['DateTimeOriginal', 'CreateDate'];

let _exifr = null;
let _readFileTags = null;

function _deps() {
  // Lazy: the ExifTool pool is only touched when a RAW/video file needs it.
  if (!_exifr) _exifr = require('exifr');
  if (!_readFileTags) _readFileTags = require('../main/exifService').readFileTags;
}

async function _exifrTags(filePath) {
  let timer;
  try {
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), EXIFR_TIMEOUT_MS); });
    const tags = await Promise.race([_exifr.parse(filePath, { pick: EXIFR_TAGS, reviveValues: false }), timeout]);
    return tags && DATE_TAGS.some(k => tags[k]) ? tags : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} filePath
 * @param {'photo'|'raw'|'video'} type  fileBrowser media type (from config/app.config.js)
 * @returns {Promise<object>} tags; rejects only if the ExifTool read itself fails
 */
async function readCaptureTags(filePath, type) {
  _deps();
  if (type === 'photo') {
    const fast = await _exifrTags(filePath);
    if (fast) return fast;
  }
  return _readFileTags(filePath);
}

module.exports = { readCaptureTags, EXIFR_TIMEOUT_MS };
