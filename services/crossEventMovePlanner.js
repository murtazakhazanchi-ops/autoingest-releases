/**
 * crossEventMovePlanner.js — where "Move Selection to Another Event" sends each selected Dump photo
 * (AI-FEAT-064 EQI-3.2). Pure.
 *
 * The unit that moves is the same ASSET as Sort Dump's (dumpSortPlanner): every media file of one shot
 * in one folder (RAW + JPEG, same stem) plus its .xmp sidecar — a pair is never split between events.
 * Photographer = the SOURCE Dump photographer folder the file sits in (Dump/<name>/…), never the UI
 * photographer, the operator or a camera suggestion. A selection holding several photographers yields
 * one destination scope per photographer — two photographers are never merged into one folder.
 *
 *   kind 'dump'        <B>/Dump/<photographer>/<path below the photographer folder>
 *                      unsequenced (no PC number); the photographer's existing Dump folder in B is reused
 *                      when its name matches (PC prefix / case / separators ignored), two matches → refused
 *   kind 'component'   <B>/[<component>/]<photographer folder>/[VIDEO/]<file> — exactly Sort Dump's routing
 *                      (dumpSortPlanner.planSort with B's components, sequences and folders): an existing
 *                      sequence is reused, a new PC number only where B's scope is already sequenced (never
 *                      in a QMZ component), the plain name otherwise
 */

'use strict';

const { planSort, groupShots, shotKey, dumpPhotographerOf, safeSegment, norm, EVENT_ROOT_KEY } = require('./dumpSortPlanner');
const { mediaKind } = require('./dumpSortDiscovery');
const { canonicalName } = require('./photographerSequenceService');

const baseOf = (rel) => rel.slice(rel.lastIndexOf('/') + 1);

/**
 * @param {object} p
 * @param {'dump'|'component'} p.kind
 * @param {string} p.sourceDumpDir                     the source event's Dump folder name on disk
 * @param {string[]} p.sourceDumpRels                  every media + sidecar file in the source Dump (source-relative)
 * @param {string[]} p.selection                       selected media files (source-relative)
 * @param {object} p.destination
 * @param {string|null} [p.destination.dumpDir]        the destination's Dump folder name (null → "Dump" is created)
 * @param {string[]} [p.destination.dumpFolders]       existing photographer folders in the destination Dump
 * @param {Array<{ folderName: string, types?: string[] }>} [p.destination.components]
 * @param {object} [p.destination.photographerSequences]
 * @param {Record<string, string[]>} [p.destination.scopeDirs]
 * @param {string|null} [p.component]                  kind 'component': the destination component folderName
 * @returns {{ assets: object[], newFolders: object[], problems: Array<{ rel: string, reason: string }> }}
 */
function planTransfer({ kind, sourceDumpDir, sourceDumpRels, selection, destination = {}, component = null }) {
  if (kind === 'component') return _planComponent({ sourceDumpDir, sourceDumpRels, selection, destination, component });
  if (kind === 'dump') return _planDump({ sourceDumpDir, sourceDumpRels, selection, destination });
  return { assets: [], newFolders: [], problems: [{ rel: '', reason: 'unknown destination type' }] };
}

function _planComponent({ sourceDumpDir, sourceDumpRels, selection, destination, component }) {
  const comps = Array.isArray(destination.components) ? destination.components : [];
  if (!comps.length) return { assets: [], newFolders: [], problems: (selection || []).map(rel => ({ rel, reason: 'the destination event has no components' })) };
  const multi = comps.length > 1;
  if (multi && !comps.some(c => c.folderName === component)) {
    return { assets: [], newFolders: [], problems: (selection || []).map(rel => ({ rel, reason: 'choose one of the destination event\'s components' })) };
  }
  return planSort({
    dumpDir: sourceDumpDir, components: comps, photographerSequences: destination.photographerSequences,
    scopeDirs: destination.scopeDirs || {}, dumpRels: sourceDumpRels,
    selection: (selection || []).map(rel => ({ rel, subEventId: multi ? component : null })),
  });
}

function _planDump({ sourceDumpDir, sourceDumpRels, selection, destination }) {
  const problems = [];
  const destDump = destination.dumpDir || 'Dump';
  const existing = (destination.dumpFolders || []).filter(n => !n.startsWith('.'));
  const shots = groupShots(sourceDumpRels);
  const chosen = new Map();   // shot key → { shot, photographer }
  for (const rel of selection || []) {
    const photographer = dumpPhotographerOf(rel, sourceDumpDir);
    if (!photographer) { problems.push({ rel: String(rel), reason: 'not inside a Dump photographer folder' }); continue; }
    const kind = mediaKind(baseOf(rel));
    if (!kind || kind === 'sidecar') { problems.push({ rel, reason: 'not a supported media file' }); continue; }
    const key = shotKey(rel);
    const shot = shots.get(key);
    if (!shot || !shot.media.includes(rel)) { problems.push({ rel, reason: 'no longer in Dump' }); continue; }
    if (!chosen.has(key)) chosen.set(key, { shot, photographer });
  }
  const folderOf = new Map();   // photographer → { name } | { problem }
  const assets = [];
  for (const [key, c] of chosen) {
    if (!folderOf.has(c.photographer)) folderOf.set(c.photographer, _dumpFolder(c.photographer, existing));
    const folder = folderOf.get(c.photographer);
    if (folder.problem) { for (const rel of c.shot.media) problems.push({ rel, reason: folder.problem }); continue; }
    const srcBase = `${sourceDumpDir}/${c.photographer}/`;
    const destOf = (rel) => `${destDump}/${folder.name}/${rel.slice(srcBase.length)}`;
    const members = [
      ...c.shot.media.map(rel => ({ role: 'media', kind: mediaKind(baseOf(rel)), src: rel, dest: destOf(rel) })),
      ...c.shot.sidecars.map(rel => ({ role: 'sidecar', kind: 'sidecar', src: rel, dest: destOf(rel) })),
    ];
    assets.push({ id: assets.length + 1, key: key.replace('\0', '/'), photographer: c.photographer, scopeKey: 'Dump', subEventId: null, folder: folder.name, members });
  }
  return { assets, newFolders: [], problems };
}

/** The photographer's folder in the destination Dump: an existing matching one, or the source name. */
function _dumpFolder(photographer, existing) {
  if (!safeSegment(photographer)) return { problem: 'photographer folder name is not safe' };
  if (existing.includes(photographer)) return { name: photographer };
  const matches = existing.filter(d => norm(canonicalName(d)) === norm(photographer));
  if (matches.length > 1) return { problem: `two Dump folders for this photographer already exist in the destination (${matches.join(', ')})` };
  return { name: matches.length ? matches[0] : photographer };
}

module.exports = { planTransfer, EVENT_ROOT_KEY };
