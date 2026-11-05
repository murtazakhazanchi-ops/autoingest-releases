/**
 * photographerFolderRenamePlanner.js — READ-ONLY preview of which photographer folders in ONE
 * event would follow a photographer's official rename (AI-FEAT-063, AI-RM-014 Q5b).
 *
 * Filesystem access is limited to readdir / readFile / stat (fs injected). It never writes
 * event.json, never renames, never creates a lock, journal or marker, and never touches QMZ
 * structures. Applying a plan is S4 (photographerRenameContract) and is not implemented:
 * every plan says applied:false and canApply:false.
 *
 * Folder layout mirrors photographerSequenceService.scanPhotographerFolders: a single-component
 * event keeps photographer folders under the event root, a multi-component event under each
 * component folder. A photographer folder is "PCxx-<name>" or, before sequencing, "<name>".
 *
 * Matching is conservative and identity-based:
 *   current-name / former-name  exact official name of THIS identity (normalized) → proposed,
 *                               unless the scope has several candidates (then none is proposed)
 *   ambiguous                   official name of this AND another identity → never proposed
 *   similar-spelling            near-miss of an official name → listed, never proposed
 *   search-alias-only           registry search alias only → listed, never folder identity
 * The plan output carries event-relative folder names only — no absolute paths.
 */

'use strict';

const path = require('path');
const { deriveRegistryState } = require('./associationModel');
const P = require('./photographerIdentity');
const N = require('./photographerNameModel');
const { validateProposedName } = require('./photographerProfileCommands');
const { renameGate } = require('./photographerRenameContract');
const { SEQ_RE } = require('../renderer/qmzSequenceFormat');

const PC_RE = /^PC(\d{2,3})-(.+)$/;
const SKIP = new Set(['_Selected', '__MACOSX', 'VIDEO', '.autoingest', '.DS_Store', 'Thumbs.db']);
const QMZ_DIRS = new Set(['_Unsequenced', 'Enroute']);
const QMZ_STATE_FILE = 'qmz-sequences.json';
const EVENT_ROOT = '__eventRoot__';

const _fold = (s) => s.normalize('NFC').toLowerCase(); // APFS/NTFS/SMB compare names case-insensitively

async function _isDir(fsx, dir, entry) {
  if (entry.isDirectory()) return true;
  // Dirent can misreport on network shares; trust stat() (same hardening as the sequencer).
  try { return (await fsx.stat(path.join(dir, entry.name))).isDirectory(); } catch { return false; }
}

async function _readEventJson(fsx, root) {
  try { return { ok: true, doc: JSON.parse((await fsx.readFile(path.join(root, 'event.json'))).toString('utf8')) }; }
  catch (err) { return { ok: false, reason: err && err.code === 'ENOENT' ? 'event-json-missing' : 'event-json-unreadable' }; }
}

function _classify(nn, m) {
  if (nn === m.current) return 'current-name';
  if (m.former.has(nn)) return m.sharedOfficial.has(nn) ? 'ambiguous' : 'former-name';
  if (nn === m.target) return 'new-name';
  if ([m.current, ...m.former].some(o => P.similarName(nn, o))) return 'similar-spelling';
  if (m.aliases.has(nn)) return 'search-alias-only';
  return null;
}

async function _scanScope(fsx, dir, scopeKey, m, excludeNames) {
  let entries;
  try { entries = await fsx.readdir(dir, { withFileTypes: true }); }
  catch (err) { return { scopeKey, state: err && err.code === 'ENOENT' ? 'missing' : 'unreadable', candidates: [], excluded: [] }; }
  if (entries.some(e => e.name === QMZ_STATE_FILE)) return { scopeKey, state: 'qmz-excluded', candidates: [], excluded: [] };
  const folders = [];
  const excluded = [];
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith('.') || e.name.startsWith('#') || excludeNames.has(e.name)) continue;
    if (!(await _isDir(fsx, dir, e))) continue;
    if (QMZ_DIRS.has(e.name) || SEQ_RE.test(e.name)) { excluded.push({ folderName: e.name, reason: 'qmz-structure' }); continue; }
    folders.push(e.name);
  }
  const candidates = [];
  for (const folderName of folders) {
    const pc = folderName.match(PC_RE);
    const canonical = pc ? pc[2] : folderName;
    const match = _classify(P.normalizeName(canonical), m);
    if (!match || match === 'new-name') continue;
    const proposedFolderName = pc ? `PC${pc[1]}-${m.targetName}` : m.targetName;
    const blockers = [];
    const others = folders.filter(f => f !== folderName);
    if (others.some(f => _fold(f) === _fold(proposedFolderName))) blockers.push('target-folder-exists');
    else if (others.some(f => P.normalizeName((f.match(PC_RE) || [])[2] || f) === m.target)) blockers.push('new-name-folder-exists');
    candidates.push({
      folderName, sequencePrefix: pc ? `PC${pc[1]}` : null, match, proposedFolderName,
      caseOnly: folderName !== proposedFolderName && _fold(folderName) === _fold(proposedFolderName),
      unchanged: folderName === proposedFolderName, proposed: false, blockers,
    });
  }
  const strong = candidates.filter(c => (c.match === 'current-name' || c.match === 'former-name') && !c.unchanged);
  if (strong.length === 1 && !strong[0].blockers.length) strong[0].proposed = true;
  const multiple = strong.length > 1;
  return { scopeKey, state: 'ok', candidates, excluded, multipleCandidates: multiple };
}

/**
 * @param {{ events: object[], shippedNames?: string[], photographerId: string, newName: string,
 *           copies: Array<{ copyId: string, kind: 'local-staging'|'nas', root: string|null }>,
 *           fs?: typeof import('fs').promises }} input
 */
async function planCurrentEventFolderRename({ events = [], shippedNames = [], photographerId, newName, copies = [], fs: fsx = require('fs').promises } = {}) {
  const blockers = [];
  const warnings = [];
  const gate = renameGate();
  const base = { previewOnly: true, applied: false, canApply: false, applyBlockedBy: gate.unmet };
  const shipped = P.bootstrapShippedIds(shippedNames);
  const state = deriveRegistryState(events, { shipped });
  const c = P.isUuid(photographerId) ? state.photographerCanonical(photographerId) : null;
  if (!c || (!state.photographers.has(c) && !shipped.byId.has(c))) return { ...base, blockers: ['unknown-photographer'], warnings, copies: [] };

  const v = validateProposedName(newName);
  if (!v.ok) blockers.push('invalid-new-name');
  const names = N.officialNamesOf(state, shipped, c);
  const index = N.buildOfficialNameIndex(state, shipped);
  const former = new Set(names.former.map(P.normalizeName));
  const sharedOfficial = new Set([...index].filter(([, h]) => new Set([...h.current, ...h.former]).size > 1).map(([n]) => n));
  const aliases = new Set((N.deriveSearchAliases(events, { state }).get(c) || []).map(a => P.normalizeName(a.alias)));
  const m = { current: P.normalizeName(names.current || ''), former, sharedOfficial, aliases, target: v.normalized, targetName: v.storedName || '' };
  if (v.ok && v.normalized === m.current && v.storedName === names.current) blockers.push('new-name-is-current-name');

  if (!copies.length) blockers.push('no-event-copies');
  const outCopies = [];
  for (const copy of copies) {
    const out = { copyId: String(copy.copyId || ''), kind: copy.kind === 'nas' ? 'nas' : 'local-staging', state: 'available', scopes: [] };
    outCopies.push(out);
    if (!copy.root) { out.state = 'unavailable'; continue; }
    let rootEntries;
    try { rootEntries = await fsx.readdir(copy.root); }
    catch { out.state = 'unavailable'; continue; }
    if (rootEntries.includes(QMZ_STATE_FILE)) { out.state = 'qmz-excluded'; continue; }
    const ej = await _readEventJson(fsx, copy.root);
    if (!ej.ok) { out.state = ej.reason; continue; }
    const comps = (Array.isArray(ej.doc.components) ? ej.doc.components : []).map(x => x && x.folderName).filter(f => typeof f === 'string' && f);
    out.components = comps;
    if (comps.length > 1) {
      for (const comp of comps) out.scopes.push(await _scanScope(fsx, path.join(copy.root, comp), comp, m, new Set()));
    } else {
      out.scopes.push(await _scanScope(fsx, copy.root, EVENT_ROOT, m, new Set(comps)));
    }
  }

  for (const cp of outCopies) {
    if (cp.state === 'unavailable') blockers.push('event-copy-unavailable');
    else if (cp.state === 'qmz-excluded') blockers.push('qmz-structure-excluded');
    else if (cp.state !== 'available') blockers.push(cp.state);
    for (const s of cp.scopes) {
      if (s.state === 'unreadable') blockers.push('scope-unreadable');
      if (s.state === 'qmz-excluded') warnings.push('qmz-scope-excluded');
      if (s.multipleCandidates) blockers.push('multiple-candidate-folders');
      if (s.candidates.some(x => x.blockers.length)) blockers.push('target-collision');
    }
  }
  const available = outCopies.filter(cp => cp.state === 'available');
  const signature = (cp) => JSON.stringify(cp.scopes.map(s => [s.scopeKey, s.candidates.filter(x => x.proposed).map(x => x.folderName).sort()]).sort());
  if (available.length > 1 && new Set(available.map(signature)).size > 1) warnings.push('event-copies-differ');
  if (available.length > 1 && new Set(available.map(cp => JSON.stringify(cp.components))).size > 1) blockers.push('event-json-components-differ');
  const proposedCount = available.reduce((n, cp) => n + cp.scopes.reduce((k, s) => k + s.candidates.filter(x => x.proposed).length, 0), 0);
  if (!proposedCount && !blockers.length) warnings.push('no-folder-to-rename');

  return {
    ...base,
    photographer: { photographerId: c, currentName: names.current, formerNames: names.former, newName: v.storedName, newNameErrors: v.errors },
    blockers: [...new Set(blockers)], warnings: [...new Set(warnings)],
    copies: outCopies.map(({ components, ...rest }) => rest),
    proposedCount,
  };
}

module.exports = { planCurrentEventFolderRename };
