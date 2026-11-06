/**
 * photographerProfileCommands.js — backend command logic for photographer profiles
 * (AI-FEAT-063, AI-RM-014 Q5b). NOT wired to IPC, preload, the renderer or startup.
 *
 * Builders are pure: given the registry events they validate a proposed name or alias, check
 * collisions, preview the exact stored spelling, verify the caller's profile revision and build
 * the append-only event with operator provenance. The service runs a builder INSIDE the
 * registry write queue (store.appendEventsChecked), so the revision check and the append are one
 * atomic step.
 *
 * Profile renaming stays OFF: the service refuses unless photographerRenameContract.renameGate()
 * reports every S1–S8 prerequisite implemented. Search-alias commands are also off until the
 * registry UI stage exposes them. Tests inject gates; production code never does.
 *
 * Names become folder names (PCxx-<name>) on macOS, Windows and SMB shares, so a proposed name
 * must be a valid folder name everywhere, and must not look like a structural folder.
 */

'use strict';

const { createEvent } = require('./identityEvents');
const { deriveRegistryState } = require('./associationModel');
const P = require('./photographerIdentity');
const N = require('./photographerNameModel');
const { renameGate } = require('./photographerRenameContract');
const { SEQ_RE } = require('../renderer/qmzSequenceFormat');

const NAME_MIN = 2;
const NAME_MAX = 80;
const ALIAS_MAX = 80;
const ALIAS_KINDS = ['spelling', 'abbreviation', 'other'];
const INVALID_FOLDER_CHARS = /[<>:"/\\|?*]/g;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁤﻿]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const PC_PREFIX = /^pc\d{2,3}-/i;
// Mirrors photographerSequenceService SKIP_DIRS and the QMZ reserved folders.
const STRUCTURAL = new Set(['_selected', '__macosx', 'video', '.autoingest', '.ds_store', 'thumbs.db', '_unsequenced', 'enroute']);

/** listManager.addToList stores list entries proper-cased; mirrored here for the preview only. */
const _listSpelling = (s) => s.replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());

/** Exact spelling that would be stored: NFC, trimmed, inner whitespace collapsed. Never re-cased. */
function previewStoredName(raw) {
  if (typeof raw !== 'string') return null;
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/**
 * A name that is safe as a folder name component on macOS, Windows and SMB.
 * @returns {string[]} error kinds (empty = valid)
 */
function folderNameErrors(name) {
  const errors = [];
  if (CONTROL_CHARS.test(name)) errors.push('control-characters');
  if (INVISIBLE_CHARS.test(name)) errors.push('invisible-characters');
  if (name.match(INVALID_FOLDER_CHARS)) errors.push('invalid-folder-characters');
  if (/[. ]$/.test(name)) errors.push('trailing-dot-or-space');
  if (WINDOWS_RESERVED.test(name)) errors.push('reserved-windows-name');
  if (/^[.#]/.test(name)) errors.push('hidden-or-ignored-folder-prefix');
  if (PC_PREFIX.test(name)) errors.push('looks-like-sequence-prefix');
  if (STRUCTURAL.has(name.toLowerCase())) errors.push('structural-folder-name');
  if (SEQ_RE.test(name)) errors.push('qmz-sequence-code');
  if (Buffer.byteLength(name, 'utf8') > 200) errors.push('too-long-for-folder');
  return errors;
}

/**
 * @returns {{ ok: boolean, storedName: string|null, normalized: string, errors: string[], notes: string[],
 *   invalidCharacters: string[] }}
 */
function validateProposedName(raw) {
  const storedName = previewStoredName(raw);
  if (storedName === null) return { ok: false, storedName: null, normalized: '', errors: ['not-text'], notes: [], invalidCharacters: [] };
  const errors = [];
  if (!storedName) errors.push('empty-name');
  else if ([...storedName].length < NAME_MIN) errors.push('too-short');
  if ([...storedName].length > NAME_MAX) errors.push('too-long');
  if (storedName) errors.push(...folderNameErrors(storedName));
  const normalized = P.normalizeName(storedName);
  if (storedName && !normalized) errors.push('no-letters-or-digits');
  const notes = [];
  if (storedName && _listSpelling(storedName) !== storedName) notes.push('photographer-list-would-recapitalise');
  return { ok: errors.length === 0, storedName, normalized, errors, notes, invalidCharacters: [...new Set(storedName.match(INVALID_FOLDER_CHARS) || [])] };
}

function _context(events, { shippedNames = [] } = {}) {
  const shipped = P.bootstrapShippedIds(shippedNames);
  const state = deriveRegistryState(events, { shipped });
  return { shipped, state };
}

function _knownIdentity(ctx, photographerId) {
  if (!P.isUuid(photographerId)) return null;
  const c = ctx.state.photographerCanonical(photographerId);
  return ctx.state.photographers.has(c) || ctx.shipped.byId.has(c) ? c : null;
}

function _allIdentities(ctx) {
  const ids = new Set(ctx.state.photographers.keys());
  for (const id of ctx.shipped.byId.keys()) ids.add(ctx.state.photographerCanonical(id));
  return [...ids].sort().map(id => {
    const n = N.officialNamesOf(ctx.state, ctx.shipped, id);
    return { photographerId: id, name: n.current, formerNames: n.former };
  });
}

function _checkOrigin(origin) {
  if (!origin || origin.workflow !== 'registry') return 'registry-workflow-required';
  if (typeof origin.operatorId !== 'string' || !origin.operatorId.trim()) return 'operator-required';
  if (typeof origin.computerId !== 'string' || !origin.computerId.trim()) return 'computer-required';
  return null;
}

/**
 * Validation + collision check of a proposed official name (new name or rename).
 * @param {string} raw
 * @param {{ events: object[], shippedNames?: string[], listNames?: string[], learnedShortcuts?: Record<string,string[]>,
 *           selfPhotographerId?: string|null }} opts
 */
function checkProposedName(raw, { events = [], shippedNames = [], listNames = [], learnedShortcuts = {}, selfPhotographerId = null } = {}) {
  const v = validateProposedName(raw);
  const preview = { storedName: v.storedName, listSpelling: v.storedName ? _listSpelling(v.storedName) : null, notes: v.notes };
  if (!v.ok) return { ok: false, preview, blocking: v.errors.map(kind => ({ kind })), warnings: [] };
  const ctx = _context(events, { shippedNames });
  const self = selfPhotographerId ? _knownIdentity(ctx, selfPhotographerId) : null;
  const res = P.checkNameCollision(v.storedName, { listNames, aliases: learnedShortcuts, photographers: _allIdentities(ctx), selfPhotographerId: self });
  const warnings = [...res.warnings];
  const owners = N.searchAliasOwners(N.deriveSearchAliases(events, { state: ctx.state })).get(v.normalized);
  const others = owners ? [...owners].filter(id => id !== self) : [];
  if (others.length) warnings.push({ kind: 'matches-registry-search-alias', photographerIds: others.sort() });
  return { ok: res.ok, preview, blocking: res.blocking, warnings };
}

/** Revision the caller must echo back with a command. */
function getProfileRevision(events, { shippedNames = [], photographerId }) {
  const ctx = _context(events, { shippedNames });
  const c = _knownIdentity(ctx, photographerId);
  return c ? N.profileRevision(events, { state: ctx.state, photographerId: c }) : null;
}

function _prelude(events, { shippedNames, photographerId, expectedRevision, origin }) {
  const originError = _checkOrigin(origin);
  if (originError) return { refusal: { ok: false, reason: originError } };
  const ctx = _context(events, { shippedNames });
  const c = _knownIdentity(ctx, photographerId);
  if (!c) return { refusal: { ok: false, reason: 'unknown-photographer' } };
  const revision = N.profileRevision(events, { state: ctx.state, photographerId: c });
  if (expectedRevision !== revision) return { refusal: { ok: false, reason: 'stale-revision', currentRevision: revision } };
  return { ctx, c, revision };
}

/**
 * Official rename of an identity. The ID never changes; the current name becomes a former name.
 * @returns {{ ok: true, events: object[], result: object } | { ok: false, reason: string, ... }}
 */
function buildRenameEvent(events, { shippedNames = [], listNames = [], learnedShortcuts = {}, photographerId, proposedName, expectedRevision, origin, at, newId } = {}) {
  const pre = _prelude(events, { shippedNames, photographerId, expectedRevision, origin });
  if (pre.refusal) return pre.refusal;
  const { ctx, c, revision } = pre;
  const current = N.officialNamesOf(ctx.state, ctx.shipped, c).current;
  const check = checkProposedName(proposedName, { events, shippedNames, listNames, learnedShortcuts, selfPhotographerId: c });
  if (!check.ok) return { ok: false, reason: 'name-rejected', blocking: check.blocking, warnings: check.warnings, preview: check.preview };
  const toName = check.preview.storedName;
  if (toName === current) return { ok: false, reason: 'unchanged' };
  const warnings = [...check.warnings];
  if (ctx.state.conflicts.some(x => x.kind === 'conflicting-renames' && ctx.state.photographerCanonical(x.photographerId) === c)) warnings.push({ kind: 'unresolved-rename-conflict' });
  const ev = createEvent('photographer-renamed', { photographerId: c, fromName: current, toName }, { origin, at, newId });
  return {
    ok: true, events: [ev],
    result: { photographerId: c, fromName: current, toName, caseOnly: P.normalizeName(current) === P.normalizeName(toName), previousRevision: revision, preview: check.preview, warnings },
  };
}

function _aliasText(raw) {
  const s = previewStoredName(raw);
  if (s === null) return { error: 'not-text' };
  if (!s || !P.normalizeName(s)) return { error: 'empty-alias' };
  if ([...s].length < NAME_MIN) return { error: 'too-short' };
  if ([...s].length > ALIAS_MAX) return { error: 'too-long' };
  if (CONTROL_CHARS.test(s) || INVISIBLE_CHARS.test(s)) return { error: 'invisible-or-control-characters' };
  return { alias: s, normalized: P.normalizeName(s) };
}

/** Add a registry search alias. Never identity: an alias equal to an official name is refused. */
function buildAliasAddEvent(events, { shippedNames = [], photographerId, alias, kind = 'other', expectedRevision, origin, at, newId } = {}) {
  const pre = _prelude(events, { shippedNames, photographerId, expectedRevision, origin });
  if (pre.refusal) return pre.refusal;
  const { ctx, c, revision } = pre;
  if (!ALIAS_KINDS.includes(kind)) return { ok: false, reason: 'invalid-alias-kind' };
  const t = _aliasText(alias);
  if (t.error) return { ok: false, reason: 'alias-rejected', blocking: [{ kind: t.error }] };
  const index = N.buildOfficialNameIndex(ctx.state, ctx.shipped);
  const hit = index.get(t.normalized);
  if (hit && (hit.current.has(c) || hit.former.has(c))) return { ok: false, reason: 'alias-rejected', blocking: [{ kind: 'alias-is-official-name' }] };
  if (hit) return { ok: false, reason: 'alias-rejected', blocking: [{ kind: 'alias-is-official-name-of-another', photographerIds: [...new Set([...hit.current, ...hit.former])].sort() }] };
  const aliases = N.deriveSearchAliases(events, { state: ctx.state });
  if ((aliases.get(c) || []).some(a => P.normalizeName(a.alias) === t.normalized)) return { ok: false, reason: 'alias-exists' };
  const owners = N.searchAliasOwners(aliases).get(t.normalized);
  const warnings = owners && owners.size ? [{ kind: 'shared-search-alias', photographerIds: [...owners].sort() }] : [];
  const ev = createEvent('photographer-alias-added', { photographerId: c, alias: t.alias, kind }, { origin, at, newId });
  return { ok: true, events: [ev], result: { photographerId: c, alias: t.alias, kind, previousRevision: revision, warnings } };
}

/** Remove a live registry search alias (removes every addition of it this registry has seen). */
function buildAliasRemoveEvent(events, { shippedNames = [], photographerId, alias, expectedRevision, origin, at, newId } = {}) {
  const pre = _prelude(events, { shippedNames, photographerId, expectedRevision, origin });
  if (pre.refusal) return pre.refusal;
  const { ctx, c, revision } = pre;
  const t = _aliasText(alias);
  if (t.error) return { ok: false, reason: 'alias-rejected', blocking: [{ kind: t.error }] };
  const live = (N.deriveSearchAliases(events, { state: ctx.state }).get(c) || []).find(a => P.normalizeName(a.alias) === t.normalized);
  if (!live) return { ok: false, reason: 'alias-not-found' };
  const ev = createEvent('photographer-alias-removed', { photographerId: c, alias: live.alias, resolves: live.addEventIds }, { origin, at, newId });
  return { ok: true, events: [ev], result: { photographerId: c, alias: live.alias, previousRevision: revision } };
}

/**
 * Retire or reactivate a profile (Q5e-1). A registry status only: names, aliases, cameras, history
 * and the photographer list are untouched. `resolves` = every earlier status event of the identity
 * (the ones the operator saw), so a disputed status is settled by this decision.
 */
function buildStatusEvent(events, { shippedNames = [], photographerId, status, expectedRevision, origin, at, newId } = {}) {
  if (!['active', 'retired'].includes(status)) return { ok: false, reason: 'invalid-status' };
  const pre = _prelude(events, { shippedNames, photographerId, expectedRevision, origin });
  if (pre.refusal) return pre.refusal;
  const { ctx, c, revision } = pre;
  const current = N.deriveProfileStatus(events, { state: ctx.state }).get(c);
  const now = current ? current.status : 'active';
  if (now === status) return { ok: false, reason: 'status-unchanged' };
  const ev = createEvent('photographer-status-set', { photographerId: c, status, resolves: current ? [...current.statusEventIds] : [] }, { origin, at, newId });
  return { ok: true, events: [ev], result: { photographerId: c, from: now, status, previousRevision: revision } };
}

const _aliasesOff = () => ({ enabled: false, unmet: ['registry-ui-stage'] });

/**
 * @param {{ store: { appendEventsChecked: Function }, getNames: () => { shippedNames: string[], listNames: string[], learnedShortcuts?: object },
 *           now?: () => Date, gates?: { rename?: () => {enabled:boolean,unmet:string[]}, aliases?: () => {enabled:boolean,unmet:string[]} } }} deps
 */
function createProfileCommandService({ store, getNames, now = () => new Date(), gates = {} } = {}) {
  const renameAllowed = gates.rename || (() => renameGate());
  const aliasesAllowed = gates.aliases || _aliasesOff;
  const run = (gate, refusal, builder, args) => {
    const g = gate();
    if (!g.enabled) return Promise.resolve({ ok: false, reason: refusal, unmet: g.unmet });
    const at = now().toISOString();
    return store.appendEventsChecked(events => builder(events, { ...getNames(), ...args, at }));
  };
  return {
    renamePhotographer: (args) => run(renameAllowed, 'rename-disabled', buildRenameEvent, args),
    addSearchAlias: (args) => run(aliasesAllowed, 'aliases-disabled', buildAliasAddEvent, args),
    removeSearchAlias: (args) => run(aliasesAllowed, 'aliases-disabled', buildAliasRemoveEvent, args),
  };
}

module.exports = {
  NAME_MIN, NAME_MAX, ALIAS_KINDS,
  previewStoredName, folderNameErrors, validateProposedName, checkProposedName, getProfileRevision,
  buildRenameEvent, buildAliasAddEvent, buildAliasRemoveEvent, buildStatusEvent, createProfileCommandService,
};
