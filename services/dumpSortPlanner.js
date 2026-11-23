/**
 * dumpSortPlanner.js — where Sort Dump moves each selected photo (AI-FEAT-064 EQI-3). Pure.
 *
 * Input is the operator's Import Workspace selection over <event>/Dump: each selected media file with
 * the component (sub-event) its group is mapped to. Output is a list of ASSETS — the unit that moves
 * together: every media file of one shot in one folder (RAW + JPEG, same stem) plus its .xmp sidecar.
 *
 * Destination = the normal import routing (renderer/importRouter.js):
 *   single-component event   <event>/<photographer folder>/[VIDEO/]<file>
 *   multi-component event    <event>/<component folder>/<photographer folder>/[VIDEO/]<file>
 * Nested Dump subfolders are flattened exactly as a card's DCIM folders are on import.
 *
 * Photographer = the Dump photographer folder the file sits in (Dump/<name>/…) — never the UI
 * photographer, the last import's operator or a camera suggestion. Dump itself is never sequenced.
 * The photographer's FINAL folder in a scope (component, or the event root) is chosen by the existing
 * conventions, in order:
 *   1. the folder recorded in event.json photographerSequences for that scope, when it exists on disk;
 *   2. the one existing folder in that scope whose name (PC prefix stripped) is the photographer's;
 *   3. a new folder — "PCnn-<name>" with the next free number when the scope is already sequenced
 *      (and not a QMZ component), otherwise the plain name, exactly as a normal import creates it
 *      (the operator sequences it later with Event Management's existing Sequence Folders action).
 * Two existing folders that both match → refused (never guess between them).
 */

'use strict';

const { canonicalName, isEventDumpName, isQmzContainerName, seqPrefix } = require('./photographerSequenceService');
const { mediaKind } = require('./dumpSortDiscovery');

const EVENT_ROOT_KEY = '__eventRoot__';
const PC_RE = /^PC(\d{2,3})[-_]/;
const NON_PHOTOGRAPHER_DIRS = new Set(['_selected', '__macosx', 'video', '.autoingest']);

const norm = (s) => String(s || '').normalize('NFC').toLowerCase().trim().replace(/[\s\-_]+/g, ' ');
const stemOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
const extOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i) : ''; };
const dirOf = (rel) => rel.slice(0, rel.lastIndexOf('/'));
const baseOf = (rel) => rel.slice(rel.lastIndexOf('/') + 1);

/** The Dump photographer a Dump-relative file belongs to, or null when it is not inside one. */
function dumpPhotographerOf(rel, dumpDir) {
  const parts = String(rel || '').split('/');
  if (parts.length < 3 || parts[0] !== dumpDir || !isEventDumpName(parts[0])) return null;
  if (parts.some(p => !p || p === '.' || p === '..')) return null;
  const name = parts[1];
  return canonicalName(name) === name && !name.startsWith('.') ? name : null;
}

/** "Folder is safe to create" — one plain path segment. */
function safeSegment(name) {
  return typeof name === 'string' && name.length > 0 && name.trim() === name && !/[\\/:\0]/.test(name) && name !== '.' && name !== '..' && !name.startsWith('.');
}

/**
 * @param {object} p
 * @param {string} p.dumpDir                        the Dump folder name on disk
 * @param {Array<{ folderName: string, types?: string[] }>} p.components   event.json components
 * @param {object} [p.photographerSequences]        event.json photographerSequences
 * @param {Record<string, string[]>} p.scopeDirs    existing directory names at each scope base
 *        (scope key = component folderName, or '__eventRoot__' for a single-component event)
 * @param {string[]} p.dumpRels                     every media + sidecar file in Dump (event-relative)
 * @param {Array<{ rel: string, subEventId: string|null }>} p.selection   selected media files
 * @returns {{ assets: object[], newFolders: object[], problems: Array<{ rel: string, reason: string }> }}
 */
function planSort({ dumpDir, components, photographerSequences, scopeDirs, dumpRels, selection }) {
  const problems = [];
  const comps = Array.isArray(components) ? components : [];
  const isMulti = comps.length > 1;
  const compByFolder = new Map(comps.map(c => [c.folderName, c]));

  const shots = groupShots(dumpRels);

  // Each selected file → its shot; every member of one shot must go to the same component.
  const chosen = new Map();   // shot key → { shot, subEventId, photographer }
  for (const s of selection || []) {
    const rel = s && s.rel;
    const photographer = dumpPhotographerOf(rel, dumpDir);
    if (!photographer) { problems.push({ rel: String(rel), reason: 'not inside a Dump photographer folder' }); continue; }
    const kind = mediaKind(baseOf(rel));
    if (!kind || kind === 'sidecar') { problems.push({ rel, reason: 'not a supported media file' }); continue; }
    const subEventId = isMulti ? (s.subEventId || null) : null;
    if (isMulti && (!subEventId || !compByFolder.has(subEventId))) { problems.push({ rel, reason: 'no component assigned' }); continue; }
    const key = `${dirOf(rel)}\0${stemOf(baseOf(rel)).toLowerCase()}`;
    const shot = shots.get(key);
    if (!shot || !shot.media.includes(rel)) { problems.push({ rel, reason: 'no longer in Dump' }); continue; }
    const prev = chosen.get(key);
    if (prev && prev.subEventId !== subEventId) { prev.split = true; continue; }
    if (!prev) chosen.set(key, { shot, subEventId, photographer, split: false });
  }

  const folderCache = new Map();   // scopeKey\0photographer → folder result
  const newFolders = [];
  const allocated = new Map();     // scopeKey → next sequence already handed out in this plan
  const assets = [];
  for (const [key, c] of chosen) {
    if (c.split) {
      for (const rel of c.shot.media) problems.push({ rel, reason: 'RAW/JPEG pair assigned to two different components' });
      continue;
    }
    const scopeKey = isMulti ? c.subEventId : EVENT_ROOT_KEY;
    const folder = _photographerFolder({ scopeKey, photographer: c.photographer, comp: compByFolder.get(c.subEventId), photographerSequences, scopeDirs, folderCache, newFolders, allocated });
    if (folder.problem) { for (const rel of c.shot.media) problems.push({ rel, reason: folder.problem }); continue; }
    const base = isMulti ? `${c.subEventId}/${folder.name}` : folder.name;
    const members = [];
    for (const rel of c.shot.media) {
      const name = baseOf(rel);
      members.push({ role: 'media', kind: mediaKind(name), src: rel, dest: mediaKind(name) === 'video' ? `${base}/VIDEO/${name}` : `${base}/${name}` });
    }
    for (const rel of c.shot.sidecars) members.push({ role: 'sidecar', kind: 'sidecar', src: rel, dest: `${base}/${baseOf(rel)}` });
    assets.push({ id: assets.length + 1, key: key.replace('\0', '/'), photographer: c.photographer, scopeKey, subEventId: c.subEventId, folder: folder.name, members });
  }
  return { assets, newFolders, problems };
}

/** Shots: media + sidecars sharing a stem in one folder (case-insensitive stem). Key = shotKey(rel). */
function groupShots(dumpRels) {
  const shots = new Map();   // dir\0stem → { dir, media: [], sidecars: [] }
  for (const rel of dumpRels || []) {
    const kind = mediaKind(baseOf(rel));
    if (!kind) continue;
    const key = shotKey(rel);
    if (!shots.has(key)) shots.set(key, { dir: dirOf(rel), media: [], sidecars: [] });
    (kind === 'sidecar' ? shots.get(key).sidecars : shots.get(key).media).push(rel);
  }
  return shots;
}
const shotKey = (rel) => `${dirOf(rel)}\0${stemOf(baseOf(rel)).toLowerCase()}`;

function _photographerFolder({ scopeKey, photographer, comp, photographerSequences, scopeDirs, folderCache, newFolders, allocated }) {
  const cacheKey = `${scopeKey}\0${photographer}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);
  const dirs = (scopeDirs && scopeDirs[scopeKey]) || [];
  const candidates = dirs.filter(d => !isEventDumpName(d) && !NON_PHOTOGRAPHER_DIRS.has(d.toLowerCase()) && !d.startsWith('.'));
  const record = photographerSequences && photographerSequences[scopeKey] && photographerSequences[scopeKey][photographer];
  let result;
  if (!safeSegment(photographer)) result = { problem: 'photographer folder name is not safe' };
  else if (record && typeof record.folderName === 'string' && candidates.includes(record.folderName)) result = { name: record.folderName, existing: true };
  else {
    const matches = candidates.filter(d => norm(canonicalName(d)) === norm(photographer));
    if (matches.length > 1) result = { problem: `two folders for this photographer already exist (${matches.join(', ')})` };
    else if (matches.length === 1) result = { name: matches[0], existing: true };
    else {
      const isQmz = !!(comp && Array.isArray(comp.types) && comp.types.includes('QMZ'));
      const seqs = candidates.filter(d => !isQmzContainerName(d)).map(d => PC_RE.exec(d)).filter(Boolean).map(m => Number(m[1]));
      const recorded = Object.values((photographerSequences && photographerSequences[scopeKey]) || {}).map(r => Number(r && r.sequence)).filter(Number.isFinite);
      const sequenced = !isQmz && (seqs.length > 0 || recorded.length > 0);
      if (sequenced) {
        const next = Math.max(allocated.get(scopeKey) || 0, ...seqs, ...recorded) + 1;
        allocated.set(scopeKey, next);
        const name = `${seqPrefix(next)}-${photographer}`;
        result = { name, existing: false, sequence: next };
      } else {
        result = { name: photographer, existing: false, sequence: null };
      }
      newFolders.push({ scopeKey, photographer, folderName: result.name, sequence: result.sequence });
    }
  }
  folderCache.set(cacheKey, result);
  return result;
}

module.exports = { planSort, groupShots, shotKey, dumpPhotographerOf, safeSegment, stemOf, extOf, norm, EVENT_ROOT_KEY };
