/**
 * eventPhotographerFolders.js — S1 foundation: which physical folder of an event belongs to which
 * permanent photographer identity, and the append-only history of those folders
 * (AI-FEAT-063, AI-RM-014 Q5e-2a). NOT connected to import, sync, sequencing, rename or any UI.
 *
 * Two OPTIONAL top-level event.json fields, each with its own schema number (event.json's own
 * `version` stays 1 — older builds reject any other version, so it must never change for this):
 *
 *   photographerFolders: { schema: 1, entries: [ {
 *       scope:          { componentId: string|null, componentFolder: string|null },
 *                       // null/null = the event root (an event with 0–1 components keeps photographer
 *                       // folders at its root); otherwise one component, by id AND folder name
 *       photographerId: UUID (permanent identity — never a name, alias or shortcut),
 *       folderName:     one folder name inside that scope ("PC03-Kay Current" or "Kay Current"),
 *       sequencePrefix: "PC03" | null (must agree with folderName),
 *       basis:          'operator-confirmed' | 'official-name-evidence',
 *       establishedAt:  ISO-8601 UTC,
 *       origin:         { computerId: string, operatorId: string|null },
 *       txId:           UUID — the history entry that established this mapping
 *   } ] }
 *
 *   photographerFolderHistory: { schema: 1, entries: [ {
 *       txId, scope, photographerId,
 *       choice:              'mapped' (first mapping) | 'renamed' | 'kept',
 *       fromFolderName, toFolderName,           // equal for 'mapped' and 'kept'
 *       fromRegisteredName, toRegisteredName,   // registry names at the time (archive-folder history
 *                                               // is kept apart from the profile's name history)
 *       at, origin: { computerId, operatorId }
 *   } ] }   — append-only: an update may only add entries after the existing ones.
 *
 * Compatibility rules:
 *  - Absent fields = the event behaves exactly as before (name-based folders). No bulk migration.
 *  - A field with an unknown/newer schema is preserved untouched and never written by this build.
 *  - Unknown keys inside entries are invalid (no free text can ride along); unknown TOP-LEVEL
 *    event.json fields are not this module's business and are always preserved.
 *  - Older AutoIngest builds keep the fields (their writers merge into the existing document) but
 *    IGNORE them: they still route, sequence and sync by folder name. A mapping is therefore a
 *    record, never an instruction, until S2–S8 and a minimum-version marker exist.
 *
 * Writing is gated OFF (writeGate) until the audited writers that could leave a mapping stale or
 * diverged are protected — see WRITE_PREREQUISITES. Tests inject the gate; production never does.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');
const P = require('./photographerIdentity');
const N = require('./photographerNameModel');
const { folderNameErrors } = require('./photographerProfileCommands');

const SCHEMA = 1;
const PC_RE = /^PC(\d{2,3})-(.+)$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const BASES = ['operator-confirmed', 'official-name-evidence'];
const CHOICES = ['mapped', 'renamed', 'kept'];
const MAX_ENTRIES = 2000;
const MAPPING_KEYS = ['scope', 'photographerId', 'folderName', 'sequencePrefix', 'basis', 'establishedAt', 'origin', 'txId'];
const HISTORY_KEYS = ['txId', 'scope', 'photographerId', 'choice', 'fromFolderName', 'toFolderName', 'fromRegisteredName', 'toRegisteredName', 'at', 'origin'];

/**
 * What must exist before mappings may be written to real events (audit, Q5e-2a):
 *   F11  photographerSequenceService.writeSequencesToEventJson writes outside the event.json
 *        write chain (a concurrent mapping update can be lost) and its PCxx renames do not update
 *        mappings (they would point at the pre-sequencing folder name).
 *   S3   archiveSyncService merges only imports/tagRefinements/metadataGroups into an existing NAS
 *        event.json, so mappings written on staging would never reach the NAS copy.
 *   META metadataSyncService rewrites event.json outside the write chain (lost-update window).
 */
const WRITE_PREREQUISITES = Object.freeze([
  { id: 'F11', title: 'Sequencing writer goes through updateEventJsonAtomic and remaps photographerFolders when it renames PCxx folders' },
  { id: 'S3', title: 'Archive sync merges photographerFolders/photographerFolderHistory between staging and NAS copies' },
  { id: 'META', title: 'metadataSyncService event.json writes go through updateEventJsonAtomic' },
]);
const IMPLEMENTED = Object.freeze([]);

/** @returns {{ enabled: boolean, unmet: string[] }} */
function writeGate(implemented = IMPLEMENTED) {
  const done = new Set(implemented);
  const unmet = WRITE_PREREQUISITES.map(p => p.id).filter(id => !done.has(id));
  return { enabled: unmet.length === 0, unmet };
}

const _fold = (s) => s.normalize('NFC').toLowerCase();
const _isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const _scopeKey = (s) => (s.componentId === null ? '__eventRoot__' : `c:${s.componentId}`);

/** Component scopes of an event, exactly as the folder layout uses them (see sequencer/planner). */
function eventScopes(doc) {
  const comps = (Array.isArray(doc && doc.components) ? doc.components : []).filter(c => _isObj(c) && typeof c.folderName === 'string' && c.folderName);
  if (comps.length <= 1) return { root: true, components: new Map() };
  return { root: false, components: new Map(comps.map(c => [String(c.id), c.folderName])) };
}

/** Errors for one folder name used INSIDE an event scope (a single path component). */
function folderEntryErrors(folderName, sequencePrefix) {
  if (typeof folderName !== 'string' || !folderName) return ['folder-name-missing'];
  if (folderName !== folderName.normalize('NFC')) return ['folder-name-not-nfc'];
  if (/[\\/]/.test(folderName) || folderName === '.' || folderName === '..' || path.isAbsolute(folderName)) return ['not-a-single-folder-name'];
  const pc = folderName.match(PC_RE);
  const base = pc ? pc[2] : folderName;
  // The PC prefix itself is legitimate here; everything else must be a safe folder name.
  const errors = folderNameErrors(base).filter(e => e !== 'looks-like-sequence-prefix');
  if (Buffer.byteLength(folderName, 'utf8') > 255) errors.push('too-long-for-folder');
  const expectedPrefix = pc ? `PC${pc[1]}` : null;
  if (sequencePrefix !== expectedPrefix) errors.push('sequence-prefix-mismatch');
  return [...new Set(errors)];
}

function _scopeErrors(scope, scopes) {
  if (!_isObj(scope) || Object.keys(scope).sort().join(',') !== 'componentFolder,componentId') return ['scope-invalid'];
  if (scope.componentId === null && scope.componentFolder === null) return scopes.root ? [] : ['event-root-scope-in-multi-component-event'];
  if (typeof scope.componentId !== 'string' || typeof scope.componentFolder !== 'string') return ['scope-invalid'];
  if (scopes.root) return ['component-scope-in-single-component-event'];
  if (!scopes.components.has(scope.componentId)) return ['component-not-in-event'];
  if (scopes.components.get(scope.componentId) !== scope.componentFolder) return ['component-folder-changed'];
  return [];
}

function _originErrors(o) {
  if (!_isObj(o) || Object.keys(o).sort().join(',') !== 'computerId,operatorId') return ['origin-invalid'];
  if (typeof o.computerId !== 'string' || !o.computerId) return ['origin-invalid'];
  if (o.operatorId !== null && (typeof o.operatorId !== 'string' || !o.operatorId)) return ['origin-invalid'];
  return [];
}

function _mappingErrors(m, scopes) {
  if (!_isObj(m)) return ['entry-invalid'];
  const extra = Object.keys(m).filter(k => !MAPPING_KEYS.includes(k));
  if (extra.length) return ['unexpected-field'];
  const errors = [..._scopeErrors(m.scope, scopes)];
  if (!P.isUuid(m.photographerId)) errors.push('photographer-id-invalid');
  errors.push(...folderEntryErrors(m.folderName, m.sequencePrefix));
  if (!BASES.includes(m.basis)) errors.push('basis-invalid');
  if (typeof m.establishedAt !== 'string' || !ISO_RE.test(m.establishedAt)) errors.push('time-invalid');
  errors.push(..._originErrors(m.origin));
  if (m.basis === 'operator-confirmed' && _isObj(m.origin) && !m.origin.operatorId) errors.push('operator-required');
  if (!P.isUuid(m.txId)) errors.push('tx-id-invalid');
  return errors;
}

function _historyErrors(h) {
  if (!_isObj(h)) return ['entry-invalid'];
  if (Object.keys(h).some(k => !HISTORY_KEYS.includes(k))) return ['unexpected-field'];
  const errors = [];
  if (!P.isUuid(h.txId)) errors.push('tx-id-invalid');
  // History outlives component edits: only the shape of the scope is checked, not its presence.
  if (!_isObj(h.scope) || Object.keys(h.scope).sort().join(',') !== 'componentFolder,componentId') errors.push('scope-invalid');
  if (!P.isUuid(h.photographerId)) errors.push('photographer-id-invalid');
  if (!CHOICES.includes(h.choice)) errors.push('choice-invalid');
  for (const k of ['fromFolderName', 'toFolderName']) if (typeof h[k] !== 'string' || !h[k] || /[\\/]/.test(h[k])) errors.push('folder-name-invalid');
  if ((h.choice === 'mapped' || h.choice === 'kept') && h.fromFolderName !== h.toFolderName) errors.push('kept-folder-changed');
  if (h.choice === 'renamed' && h.fromFolderName === h.toFolderName) errors.push('renamed-folder-unchanged');
  for (const k of ['fromRegisteredName', 'toRegisteredName']) if (typeof h[k] !== 'string' || !h[k].trim() || h[k].length > 200) errors.push('registered-name-invalid');
  if (typeof h.at !== 'string' || !ISO_RE.test(h.at)) errors.push('time-invalid');
  errors.push(..._originErrors(h.origin));
  return errors;
}

/**
 * Read and validate both fields of an event document. Pure.
 * @returns {{ state: 'absent'|'ok'|'invalid'|'unsupported-schema', mappings: object[], history: object[],
 *   errors: Array<{ where: string, index: number, errors: string[] }> }}
 *   state 'absent' — neither field present: legacy event, behave exactly as before.
 */
function readPhotographerFolders(doc) {
  const has = (k) => _isObj(doc) && Object.prototype.hasOwnProperty.call(doc, k);
  if (!has('photographerFolders') && !has('photographerFolderHistory')) return { state: 'absent', mappings: [], history: [], errors: [] };
  const pf = has('photographerFolders') ? doc.photographerFolders : { schema: SCHEMA, entries: [] };
  const ph = has('photographerFolderHistory') ? doc.photographerFolderHistory : { schema: SCHEMA, entries: [] };
  if (!_isObj(pf) || !_isObj(ph) || !Number.isInteger(pf.schema) || !Number.isInteger(ph.schema)) return { state: 'invalid', mappings: [], history: [], errors: [{ where: 'document', index: -1, errors: ['field-shape-invalid'] }] };
  if (pf.schema > SCHEMA || ph.schema > SCHEMA) return { state: 'unsupported-schema', mappings: [], history: [], errors: [] };
  const shapeOk = (x) => Object.keys(x).sort().join(',') === 'entries,schema' && x.schema === SCHEMA && Array.isArray(x.entries) && x.entries.length <= MAX_ENTRIES;
  if (!shapeOk(pf) || !shapeOk(ph)) return { state: 'invalid', mappings: [], history: [], errors: [{ where: 'document', index: -1, errors: ['field-shape-invalid'] }] };
  const scopes = eventScopes(doc);
  const errors = [];
  pf.entries.forEach((m, i) => { const e = _mappingErrors(m, scopes); if (e.length) errors.push({ where: 'mapping', index: i, errors: e }); });
  ph.entries.forEach((h, i) => { const e = _historyErrors(h); if (e.length) errors.push({ where: 'history', index: i, errors: e }); });
  // One identity has one folder per scope, and one folder belongs to one identity.
  const byPerson = new Map(), byFolder = new Map();
  pf.entries.forEach((m, i) => {
    if (!_isObj(m) || !_isObj(m.scope) || typeof m.folderName !== 'string') return;
    const sk = _scopeKey(m.scope);
    const pk = `${sk}|${m.photographerId}`, fk = `${sk}|${_fold(m.folderName)}`;
    if (byPerson.has(pk)) errors.push({ where: 'mapping', index: i, errors: ['duplicate-photographer-mapping'] });
    if (byFolder.has(fk) && byFolder.get(fk) !== m.photographerId) errors.push({ where: 'mapping', index: i, errors: ['folder-claimed-by-two-photographers'] });
    else if (byFolder.has(fk)) errors.push({ where: 'mapping', index: i, errors: ['duplicate-folder-mapping'] });
    byPerson.set(pk, i); byFolder.set(fk, m.photographerId);
  });
  const txIds = new Set(ph.entries.filter(_isObj).map(h => h.txId));
  pf.entries.forEach((m, i) => { if (_isObj(m) && P.isUuid(m.txId) && !txIds.has(m.txId)) errors.push({ where: 'mapping', index: i, errors: ['no-history-for-mapping'] }); });
  return { state: errors.length ? 'invalid' : 'ok', mappings: errors.length ? [] : pf.entries.map(e => JSON.parse(JSON.stringify(e))), history: errors.length ? [] : ph.entries.map(e => JSON.parse(JSON.stringify(e))), errors };
}

/** Revision of the two fields — an update built on an older read is refused. */
function foldersRevision(doc) {
  const pick = (k) => (_isObj(doc) && Object.prototype.hasOwnProperty.call(doc, k) ? doc[k] : null);
  return crypto.createHash('sha256').update(JSON.stringify([pick('photographerFolders'), pick('photographerFolderHistory')])).digest('hex').slice(0, 16);
}

/**
 * Evidence check for basis 'official-name-evidence': the folder's name (without PCxx) must be an
 * official name (current or former) of THIS identity and of no other identity. Similar spellings,
 * search aliases and learned shortcuts never qualify. Pure.
 */
function officialNameEvidence(folderName, photographerId, { state, shipped }) {
  const pc = typeof folderName === 'string' ? folderName.match(PC_RE) : null;
  const n = P.normalizeName(pc ? pc[2] : folderName || '');
  if (!n) return { ok: false, reason: 'no-name' };
  const hit = N.buildOfficialNameIndex(state, shipped).get(n);
  const ids = hit ? [...new Set([...hit.current, ...hit.former])] : [];
  const c = state.photographerCanonical(photographerId);
  if (!ids.includes(c)) return { ok: false, reason: 'not-an-official-name-of-this-photographer' };
  if (ids.length > 1) return { ok: false, reason: 'official-name-shared-by-several-photographers' };
  return { ok: true, via: hit.current.has(c) ? 'current-name' : 'former-name' };
}

/**
 * Prepare adding mappings (with their 'mapped' history entries). Pure; never overwrites: a scope
 * that already maps this photographer, or a folder already mapped, is refused — changing a mapping
 * belongs to the future S4 transaction (choice 'renamed'/'kept'), which is not implemented.
 * @param {object} doc  the freshest event.json document
 * @param {{ expectedRevision: string, additions: Array<{ scope, photographerId, folderName, basis }>,
 *   origin: { computerId, operatorId }, at: string, registry: { state, shipped }, newId?: () => string }} req
 *   registry — the derived identity registry: the photographer must exist there (canonical ID) and
 *   its registered name for the history entry is taken from it, never from the caller.
 * @returns {{ ok: true, changes: { photographerFolders, photographerFolderHistory } } | { ok: false, reason: string, details?: object[] }}
 */
function prepareMappingAdditions(doc, { expectedRevision, additions, origin, at, registry, newId = crypto.randomUUID } = {}) {
  if (expectedRevision !== foldersRevision(doc)) return { ok: false, reason: 'stale-revision' };
  const current = readPhotographerFolders(doc);
  if (current.state === 'unsupported-schema') return { ok: false, reason: 'unsupported-schema' };
  if (current.state === 'invalid') return { ok: false, reason: 'existing-mappings-invalid', details: current.errors };
  if (!Array.isArray(additions) || !additions.length) return { ok: false, reason: 'nothing-to-add' };
  if (!registry || !registry.state || !registry.shipped) return { ok: false, reason: 'registry-required' };
  const details = [];
  const mappings = [...current.mappings];
  const history = [...current.history];
  additions.forEach((a, i) => {
    const pc = typeof a.folderName === 'string' ? a.folderName.match(PC_RE) : null;
    const txId = newId();
    const m = {
      scope: a.scope, photographerId: a.photographerId, folderName: a.folderName, sequencePrefix: pc ? `PC${pc[1]}` : null,
      basis: a.basis, establishedAt: at, origin: { computerId: origin && origin.computerId, operatorId: origin ? origin.operatorId ?? null : null }, txId,
    };
    if (!P.isUuid(a.photographerId)) { details.push({ index: i, errors: ['photographer-id-invalid'] }); return; }
    const c = registry.state.photographerCanonical(a.photographerId);
    if (!registry.state.photographers.has(c) && !registry.shipped.byId.has(c)) { details.push({ index: i, errors: ['unknown-photographer'] }); return; }
    if (c !== a.photographerId) { details.push({ index: i, errors: ['not-canonical-photographer-id'] }); return; }
    if (a.basis === 'official-name-evidence') {
      const ev = officialNameEvidence(a.folderName, a.photographerId, registry);
      if (!ev.ok) { details.push({ index: i, errors: [ev.reason] }); return; }
    }
    mappings.push(m);
    const reg = N.officialNamesOf(registry.state, registry.shipped, c).current || '';
    history.push({ txId, scope: a.scope, photographerId: a.photographerId, choice: 'mapped', fromFolderName: a.folderName, toFolderName: a.folderName, fromRegisteredName: reg, toRegisteredName: reg, at, origin: m.origin });
  });
  if (details.length) return { ok: false, reason: 'mapping-rejected', details };
  const changes = { photographerFolders: { schema: SCHEMA, entries: mappings }, photographerFolderHistory: { schema: SCHEMA, entries: history } };
  const check = readPhotographerFolders({ ...doc, ...changes });
  if (check.state !== 'ok') return { ok: false, reason: 'mapping-rejected', details: check.errors };
  // Append-only: the existing history must be an exact prefix of the new one.
  if (JSON.stringify(history.slice(0, current.history.length)) !== JSON.stringify(current.history)) return { ok: false, reason: 'history-not-append-only' };
  return { ok: true, changes };
}

/**
 * READ-ONLY physical check of mappings against one event copy: the folder must exist with exactly
 * this name, be a real directory (not a symlink) and resolve inside the event folder.
 * @returns {Promise<Array<{ index: number, state: 'present'|'missing'|'name-differs-in-case'|'not-a-directory'|'symlink'|'escapes-event'|'unreadable' }>>}
 */
async function verifyMappingsOnDisk(eventRoot, mappings, { fs: fsx = require('fs').promises } = {}) {
  const out = [];
  let realRoot;
  try { realRoot = await fsx.realpath(eventRoot); } catch { return mappings.map((_, index) => ({ index, state: 'unreadable' })); }
  for (const [index, m] of mappings.entries()) {
    const scopeDir = m.scope.componentFolder ? path.join(eventRoot, m.scope.componentFolder) : eventRoot;
    try {
      const names = await fsx.readdir(scopeDir);
      if (!names.includes(m.folderName)) { out.push({ index, state: names.some(n => _fold(n) === _fold(m.folderName)) ? 'name-differs-in-case' : 'missing' }); continue; }
      const full = path.join(scopeDir, m.folderName);
      const st = await fsx.lstat(full);
      if (st.isSymbolicLink()) { out.push({ index, state: 'symlink' }); continue; }
      if (!st.isDirectory()) { out.push({ index, state: 'not-a-directory' }); continue; }
      const real = await fsx.realpath(full);
      out.push({ index, state: real.startsWith(realRoot + path.sep) ? 'present' : 'escapes-event' });
    } catch (err) {
      out.push({ index, state: err && err.code === 'ENOENT' ? 'missing' : 'unreadable' });
    }
  }
  return out;
}

/**
 * Add mappings to ONE event copy's event.json through the event.json write chain. Gated OFF in
 * production (writeGate). Inside the chain: re-read, revision check, re-validate, and verify every
 * new folder exists on disk as a real directory in that copy; otherwise nothing is written.
 * @param {string} eventFolderPath
 * @param {object} req  prepareMappingAdditions request
 * @param {{ updateEventJsonAtomic: Function, gate?: () => {enabled:boolean,unmet:string[]}, fs?: object }} deps
 */
async function addMappings(eventFolderPath, req, { updateEventJsonAtomic, gate = writeGate, fs: fsx = require('fs').promises } = {}) {
  const g = gate();
  if (!g.enabled) return { ok: false, reason: 'mapping-writes-disabled', unmet: g.unmet };
  // A refusal aborts the chained update by throwing, so event.json is not rewritten at all.
  const refuse = (outcome) => { const e = new Error('mapping refused'); e.code = 'EPF_REFUSED'; e.outcome = outcome; throw e; };
  let outcome = null;
  try {
    await updateEventJsonAtomic(path.join(eventFolderPath, 'event.json'), async (doc) => {
      const prep = prepareMappingAdditions(doc, req);
      if (!prep.ok) refuse(prep);
      const added = prep.changes.photographerFolders.entries.slice(readPhotographerFolders(doc).mappings.length);
      const disk = await verifyMappingsOnDisk(eventFolderPath, added, { fs: fsx });
      const bad = disk.filter(d => d.state !== 'present');
      if (bad.length) refuse({ ok: false, reason: 'folder-not-verified', details: bad });
      outcome = { ok: true, added: added.length };
      return prep.changes;
    });
  } catch (err) {
    if (err && err.code === 'EPF_REFUSED') return err.outcome;
    return { ok: false, reason: 'write-failed', code: err && err.code ? err.code : null };
  }
  return outcome || { ok: false, reason: 'write-failed' };
}

module.exports = {
  SCHEMA, WRITE_PREREQUISITES, IMPLEMENTED, writeGate, eventScopes, folderEntryErrors,
  readPhotographerFolders, foldersRevision, officialNameEvidence, prepareMappingAdditions, verifyMappingsOnDisk, addMappings,
};
