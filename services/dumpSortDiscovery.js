/**
 * dumpSortDiscovery.js — what is in an event's Dump folder (AI-FEAT-064 EQI-3 Sort Dump). Read only.
 *
 *   <event>/Dump/<photographer>/…   media imported by Event Dump Quick Import, never sequenced
 *
 * Walks the whole Dump tree (nested subfolders included) without following symbolic links and
 * classifies every entry, so Sort Dump is offered only while unsorted media really exists — and a
 * Dump holding anything unexpected is reported instead of being treated as empty:
 *   media        supported photo / RAW / video files inside a photographer folder
 *   sidecars     .xmp sidecars (moved together with their photo, never on their own)
 *   partials     unfinished copies (<name>.aiimport-partial) left by an interrupted import
 *   hidden       dot-files (Finder/OS state); never media, never counted as unsorted
 *   unsupported  any other file, a file directly in Dump, a symbolic link, a PC-sequenced folder
 */

'use strict';

const path = require('path');
const fsp = require('fs').promises;
const config = require('../config/app.config');
const { canonicalName, isEventDumpName } = require('./photographerSequenceService');

const PHOTO_EXT = new Set(config.PHOTO_EXTENSIONS.map(e => e.toLowerCase()));
const RAW_EXT = new Set(config.RAW_EXTENSIONS.map(e => e.toLowerCase()));
const VIDEO_EXT = new Set(config.VIDEO_EXTENSIONS.map(e => e.toLowerCase()));
const SIDECAR_EXT = new Set(['.xmp']);
const PARTIAL_SUFFIX = '.aiimport-partial';
const MAX_DEPTH = 8;

/** 'raw' | 'photo' | 'video' | 'sidecar' | null for a file name. */
function mediaKind(name) {
  const ext = path.extname(name).toLowerCase();
  if (RAW_EXT.has(ext)) return 'raw';
  if (PHOTO_EXT.has(ext)) return 'photo';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (SIDECAR_EXT.has(ext)) return 'sidecar';
  return null;
}

/** The event's Dump folder name as it exists on disk ("Dump", any case), or null. */
async function findDumpDir(eventPath, io = fsp) {
  let entries;
  try { entries = await io.readdir(eventPath, { withFileTypes: true }); } catch { return null; }
  const hit = entries.find(e => e.isDirectory() && !e.isSymbolicLink() && isEventDumpName(e.name) && canonicalName(e.name) === e.name);
  return hit ? hit.name : null;
}

/**
 * @param {string} eventPath  absolute event folder
 * @param {{ io?: object }} [opts]  io: fs.promises-compatible (tests)
 * @returns {Promise<{ exists: boolean, dumpDir: string|null, photographers: Array<{ name: string, files: Array<{ rel: string, size: number, kind: string }>, bytes: number }>,
 *   media: number, bytes: number, sidecars: string[], partials: string[], hidden: string[], unsupported: Array<{ rel: string, reason: string }> }>}
 *   every `rel` is event-relative with '/' separators
 */
async function discoverDump(eventPath, { io = fsp } = {}) {
  const out = { exists: false, dumpDir: null, photographers: [], media: 0, bytes: 0, sidecars: [], partials: [], hidden: [], unsupported: [] };
  const dumpDir = await findDumpDir(eventPath, io);
  if (!dumpDir) return out;
  out.exists = true;
  out.dumpDir = dumpDir;
  const dumpAbs = path.join(eventPath, dumpDir);
  let top;
  try { top = await io.readdir(dumpAbs, { withFileTypes: true }); } catch (err) {
    out.unsupported.push({ rel: dumpDir, reason: `unreadable (${err.code || 'error'})` });
    return out;
  }
  for (const e of top.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${dumpDir}/${e.name}`;
    if (e.name.startsWith('.')) { out.hidden.push(rel); continue; }
    if (e.isSymbolicLink()) { out.unsupported.push({ rel, reason: 'symbolic link' }); continue; }
    if (!e.isDirectory()) { out.unsupported.push({ rel, reason: 'file directly in Dump (no photographer folder)' }); continue; }
    if (canonicalName(e.name) !== e.name) { out.unsupported.push({ rel, reason: 'PC-sequenced folder inside Dump' }); continue; }
    const ph = { name: e.name, files: [], bytes: 0 };
    await _walk(io, path.join(dumpAbs, e.name), rel, 1, ph, out);
    if (ph.files.length) {
      out.photographers.push(ph);
      out.media += ph.files.length;
      out.bytes += ph.bytes;
    }
  }
  return out;
}

async function _walk(io, abs, rel, depth, ph, out) {
  if (depth > MAX_DEPTH) { out.unsupported.push({ rel, reason: 'folder nesting too deep' }); return; }
  let entries;
  try { entries = await io.readdir(abs, { withFileTypes: true }); } catch (err) {
    out.unsupported.push({ rel, reason: `unreadable (${err.code || 'error'})` });
    return;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRel = `${rel}/${e.name}`;
    const childAbs = path.join(abs, e.name);
    if (e.name.startsWith('.')) { out.hidden.push(childRel); continue; }
    if (e.isSymbolicLink()) { out.unsupported.push({ rel: childRel, reason: 'symbolic link' }); continue; }
    if (e.isDirectory()) { await _walk(io, childAbs, childRel, depth + 1, ph, out); continue; }
    if (!e.isFile()) { out.unsupported.push({ rel: childRel, reason: 'not a regular file' }); continue; }
    if (e.name.endsWith(PARTIAL_SUFFIX)) { out.partials.push(childRel); continue; }
    const kind = mediaKind(e.name);
    if (kind === 'sidecar') { out.sidecars.push(childRel); continue; }
    if (!kind) { out.unsupported.push({ rel: childRel, reason: 'unsupported file type' }); continue; }
    let size = 0;
    try { size = (await io.stat(childAbs)).size; } catch { out.unsupported.push({ rel: childRel, reason: 'unreadable' }); continue; }
    ph.files.push({ rel: childRel, size, kind });
    ph.bytes += size;
  }
}

/**
 * The Event Management summary: whether Sort Dump is offered and what to tell the operator.
 * `pending` = a Sort Dump transaction that has not finished (crash or failure) for this event.
 */
function summarize(found, { pending = 0 } = {}) {
  const attention = found.unsupported.length + found.partials.length;
  return {
    unsorted: found.media,
    bytes: found.bytes,
    photographers: found.photographers.map(p => ({ name: p.name, count: p.files.length, bytes: p.bytes })),
    attention,
    pending,
    showSortDump: found.media > 0 || pending > 0,
  };
}

module.exports = { discoverDump, findDumpDir, summarize, mediaKind, PARTIAL_SUFFIX };
