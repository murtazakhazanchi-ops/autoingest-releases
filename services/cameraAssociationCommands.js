/**
 * cameraAssociationCommands.js — operator decisions on photographer↔camera associations and the
 * conflicts Q4 can settle safely (AI-FEAT-063, AI-RM-014 Q5d). Pure: no Electron, no filesystem,
 * no clock (`at` and `newId` are injected).
 *
 * Every builder runs INSIDE the registry write queue (identityRegistryStore.appendEventsChecked)
 * against the registry exactly as it is at that moment, so the revision check and the append are
 * one atomic step. Decisions use the existing Q4 append-only events:
 *  - association-confirmed / -rejected / -retired, with `resolves` = associationModel
 *    .decisionContext — exactly the earlier decisions on that pair this registry holds;
 *  - device-linked ('same', only with shared trusted identifier evidence) and
 *    photographer-linked ('different' only), with `resolves` = linkContext.
 * Nothing is deleted or rewritten: a rejection or retirement leaves every observation and earlier
 * decision in the log, and a correction is two decisions appended together.
 *
 * Revisions: scopeRevision() digests the events that touch the records an action is about (all
 * member IDs of the camera and photographers). The operator's preview is computed from one
 * registry snapshot; the commit is refused if that scope changed since, so a decision is only
 * ever recorded against the evidence the operator saw. Revisions stay in the main process.
 *
 * Not here (later stages, separately authorised): photographer rename, search aliases, profile
 * retirement, merging photographer identities, folder renames, import routing.
 */

'use strict';

const crypto = require('crypto');
const { createEvent } = require('./identityEvents');
const { deriveRegistryState, decisionContext, linkContext } = require('./associationModel');
const { identifierKey } = require('./cameraDeviceIdentity');
const P = require('./photographerIdentity');

const DECISION_EVENT = { confirm: 'association-confirmed', reject: 'association-rejected', retire: 'association-retired' };
const OUTCOMES = Object.freeze(['confirm', 'reject', 'retire']);
const ACTIVE = new Set(['confirmed', 'observed', 'disputed']);
/** Association actions offered per derived state; disputed or unsettled pairs only get "resolve". */
const ACTIONS_BY_STATE = Object.freeze({
  observed: ['confirm', 'reject', 'retire', 'correct'],
  confirmed: ['reject', 'retire', 'correct'],
  rejected: ['confirm'],
  retired: ['confirm'],
});
const RESOLVABLE = new Set(['association-disputed', 'association-unsettled', 'identifier-spans-devices', 'same-name-different-ids']);

function _state(events, shippedNames) {
  const shipped = P.bootstrapShippedIds(shippedNames || []);
  return { shipped, state: deriveRegistryState(events, { shipped }) };
}

function _knownPhotographer(ctx, id) {
  if (!P.isUuid(id)) return null;
  const c = ctx.state.photographerCanonical(id);
  return ctx.state.photographers.has(c) || ctx.shipped.byId.has(c) ? c : null;
}

function _knownDevice(ctx, id) {
  if (!P.isUuid(id)) return null;
  const c = ctx.state.deviceCanonical(id);
  return ctx.state.devices.has(c) ? c : null;
}

function _referencedIds(e) {
  const ids = [];
  for (const k of ['deviceId', 'photographerId', 'suggestedPhotographerId', 'chosenPhotographerId']) if (typeof e[k] === 'string') ids.push(e[k]);
  for (const k of ['deviceIds', 'photographerIds']) if (Array.isArray(e[k])) ids.push(...e[k]);
  if (Array.isArray(e.cameras)) for (const c of e.cameras) if (c && typeof c.deviceId === 'string') ids.push(c.deviceId);
  return ids;
}

/**
 * Digest of every event touching the given cameras and photographers (all their linked member
 * IDs). Main-process only; never sent to a renderer.
 */
function scopeRevision(state, { deviceIds = [], photographerIds = [] } = {}) {
  const members = new Set();
  for (const id of deviceIds) {
    const c = state.deviceCanonical(id);
    members.add(c);
    for (const m of (state.devices.get(c) || { memberIds: [] }).memberIds) members.add(m);
  }
  for (const id of photographerIds) {
    const c = state.photographerCanonical(id);
    members.add(c);
    for (const m of (state.photographers.get(c) || { memberIds: [] }).memberIds) members.add(m);
  }
  const touching = state.events.filter(e => _referencedIds(e).some(id => members.has(id))).map(e => e.eventId).sort();
  return crypto.createHash('sha256').update(`${[...members].sort().join(',')}|${touching.join(',')}`).digest('hex');
}

/** Unsettled explicit decisions on one (camera, photographer) pair: those no later decision lists. */
function decisionHeads(state, deviceId, photographerId) {
  const d = state.deviceCanonical(deviceId), p = state.photographerCanonical(photographerId);
  const decisions = state.events.filter(e => DECISION_EVENT.confirm === e.type || DECISION_EVENT.reject === e.type || DECISION_EVENT.retire === e.type)
    .filter(e => state.deviceCanonical(e.deviceId) === d && state.photographerCanonical(e.photographerId) === p);
  const settled = new Set(decisions.flatMap(e => e.resolves));
  return decisions.filter(e => !settled.has(e.eventId));
}

/**
 * Derived state of a pair plus `unsettled`: several different unsettled decisions that the Q4
 * model does not call disputed (e.g. confirmed on one computer, retired on another). Q4 shows the
 * latest of them; they still need an operator, never a timestamp, to settle.
 */
function associationStatus(state, deviceId, photographerId) {
  const a = state.associations.get(`${state.deviceCanonical(deviceId)}|${state.photographerCanonical(photographerId)}`);
  const heads = decisionHeads(state, deviceId, photographerId);
  const kinds = new Set(heads.map(e => e.type));
  const st = a ? a.state : null;
  return { state: st, unsettled: st !== 'disputed' && kinds.size > 1 };
}

/** Keys `deviceId|photographerId` (canonical) of every unsettled, non-disputed pair — one pass. */
function unsettledPairs(state) {
  const byPair = new Map();
  for (const e of state.events) {
    if (e.type !== DECISION_EVENT.confirm && e.type !== DECISION_EVENT.reject && e.type !== DECISION_EVENT.retire) continue;
    const k = `${state.deviceCanonical(e.deviceId)}|${state.photographerCanonical(e.photographerId)}`;
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(e);
  }
  const out = new Set();
  for (const [k, decisions] of byPair) {
    const settled = new Set(decisions.flatMap(e => e.resolves));
    const kinds = new Set(decisions.filter(e => !settled.has(e.eventId)).map(e => e.type));
    const a = state.associations.get(k);
    if (kinds.size > 1 && (!a || a.state !== 'disputed')) out.add(k);
  }
  return out;
}

/** Actions an operator may take on one association, from its current state. */
function associationActions(state, deviceId, photographerId) {
  const s = associationStatus(state, deviceId, photographerId);
  if (s.state === 'disputed' || s.unsettled) return ['resolve'];
  return [...(ACTIONS_BY_STATE[s.state] || [])];
}

/** Photographers currently associated (confirmed, observed or disputed) with a camera. */
function activePhotographers(state, deviceId) {
  return state.associationsForDevice(deviceId).filter(a => ACTIVE.has(a.state)).map(a => a.photographerId);
}

/** Shared trusted identifiers of two camera records (count only). */
function sharedTrustedIdentifiers(state, a, b) {
  const da = state.devices.get(state.deviceCanonical(a)), db = state.devices.get(state.deviceCanonical(b));
  if (!da || !db) return 0;
  const keys = new Set(da.identifiers.filter(i => i.trusted).map(i => identifierKey(i.ns, i.keyId, i.digest)));
  return db.identifiers.filter(i => i.trusted && keys.has(identifierKey(i.ns, i.keyId, i.digest))).length;
}

/**
 * Whether a review conflict can be settled here, and how.
 * @returns {{ supported: boolean, options: string[], note: string|null }}
 *   note — a reason code when not supported (the browser turns it into operator text)
 */
function conflictResolution(state, conflict, { bodyMatching = false } = {}) {
  switch (conflict && conflict.kind) {
    case 'association-disputed':
    case 'association-unsettled':
      return { supported: true, options: [...OUTCOMES], note: null };
    case 'identifier-spans-devices': {
      const ids = conflict.deviceIds || [];
      if (ids.length !== 2) return { supported: false, options: [], note: 'more-than-two-records' };
      const [a, b] = ids.map(id => state.devices.get(id));
      if (!a || !b || a.make !== b.make || a.modelKey !== b.modelKey) return { supported: false, options: [], note: 'models-differ' };
      if (!sharedTrustedIdentifiers(state, ids[0], ids[1])) return { supported: false, options: [], note: 'no-shared-identifier' };
      if (!bodyMatching) return { supported: false, options: [], note: 'key-unavailable' };
      if (state.conflicts.some(c => c.kind === 'device-link-disputed' && ids.every(id => c.deviceIds.includes(id)))) return { supported: false, options: [], note: 'link-disputed' };
      return { supported: true, options: ['link-same'], note: null };
    }
    case 'same-name-different-ids':
      return (conflict.photographerIds || []).length === 2 ? { supported: true, options: ['mark-different'], note: null } : { supported: false, options: [], note: 'unsupported' };
    default:
      return { supported: false, options: [], note: RESOLVABLE.has(conflict && conflict.kind) ? 'unsupported' : 'deferred' };
  }
}

/**
 * The revision a builder will check, computed the same way from any event set (the operator's
 * snapshot at preview time, the live registry at commit time).
 * @param {{ shippedNames?: string[], deviceId?: string, photographerId?: string, targetPhotographerId?: string,
 *   kind?: string, ids?: string[] }} args
 */
function revisionOf(events, args = {}) {
  const ctx = _state(events, args.shippedNames);
  if (args.kind === 'link-same-cameras') return scopeRevision(ctx.state, { deviceIds: (args.ids || []).map(id => _knownDevice(ctx, id)).filter(Boolean) });
  if (args.kind === 'mark-different-photographers') return scopeRevision(ctx.state, { photographerIds: (args.ids || []).map(id => _knownPhotographer(ctx, id)).filter(Boolean) });
  const d = _knownDevice(ctx, args.deviceId);
  const people = [args.photographerId, args.targetPhotographerId].map(id => (id ? _knownPhotographer(ctx, id) : null)).filter(Boolean);
  return scopeRevision(ctx.state, { deviceIds: d ? [d] : [], photographerIds: people });
}

function _checkOrigin(origin) {
  if (!origin || origin.workflow !== 'registry') return 'registry-workflow-required';
  if (typeof origin.operatorId !== 'string' || !origin.operatorId.trim()) return 'operator-required';
  if (typeof origin.computerId !== 'string' || !origin.computerId.trim()) return 'computer-required';
  return null;
}

const _refuse = (reason, extra = {}) => ({ ok: false, reason, ...extra });

function _decision(ctx, outcome, deviceId, photographerId, { origin, at, newId }) {
  return createEvent(DECISION_EVENT[outcome], { photographerId, deviceId, resolves: decisionContext(ctx.state, deviceId, photographerId) }, { origin, at, newId });
}

/**
 * Plan one association decision.
 * @param {object[]} events  the registry events as they are now
 * @param {{ shippedNames?: string[], action: 'confirm'|'reject'|'retire'|'correct'|'add-photographer'|'resolve',
 *   deviceId: string, photographerId?: string, targetPhotographerId?: string,
 *   priorOutcome?: 'reject'|'retire', outcome?: 'confirm'|'reject'|'retire',
 *   expectedRevision: string, origin: object, at: string, newId?: () => string }} args
 * @returns {{ ok: true, events: object[], result: object } | { ok: false, reason: string }}
 */
function planAssociationDecision(events, args = {}) {
  const originError = _checkOrigin(args.origin);
  if (originError) return _refuse(originError);
  const ctx = _state(events, args.shippedNames);
  const d = _knownDevice(ctx, args.deviceId);
  if (!d) return _refuse('unknown-camera');
  const p = args.photographerId ? _knownPhotographer(ctx, args.photographerId) : null;
  const target = args.targetPhotographerId ? _knownPhotographer(ctx, args.targetPhotographerId) : null;
  const opts = { origin: args.origin, at: args.at, newId: args.newId };
  const action = args.action;

  const people = [p, target].filter(Boolean);
  const revision = scopeRevision(ctx.state, { deviceIds: [d], photographerIds: people });
  if (args.expectedRevision !== revision) return _refuse('stale-revision');

  if (action === 'add-photographer') {
    if (!target) return _refuse('unknown-photographer');
    if (activePhotographers(ctx.state, d).includes(target)) return _refuse('already-associated');
    return { ok: true, events: [_decision(ctx, 'confirm', d, target, opts)], result: { action, deviceId: d, photographerIds: [target], outcomes: ['confirm'] } };
  }
  if (!p) return _refuse('unknown-photographer');
  const allowed = associationActions(ctx.state, d, p);
  if (!allowed.includes(action)) return _refuse('not-available-for-state', { state: associationStatus(ctx.state, d, p).state });

  if (action === 'confirm' || action === 'reject' || action === 'retire') {
    return { ok: true, events: [_decision(ctx, action, d, p, opts)], result: { action, deviceId: d, photographerIds: [p], outcomes: [action] } };
  }
  if (action === 'resolve') {
    if (!OUTCOMES.includes(args.outcome)) return _refuse('invalid-outcome');
    return { ok: true, events: [_decision(ctx, args.outcome, d, p, opts)], result: { action, deviceId: d, photographerIds: [p], outcomes: [args.outcome] } };
  }
  if (action === 'correct') {
    if (!target) return _refuse('unknown-photographer');
    if (target === p) return _refuse('same-photographer');
    if (!['reject', 'retire'].includes(args.priorOutcome)) return _refuse('invalid-outcome');
    const t = associationStatus(ctx.state, d, target);
    if (t.state === 'confirmed' || t.state === 'disputed' || t.unsettled) return _refuse('target-needs-review', { state: t.state });
    // Both decisions are appended together, or neither is.
    const evs = [_decision(ctx, args.priorOutcome, d, p, opts), _decision(ctx, 'confirm', d, target, opts)];
    return { ok: true, events: evs, result: { action, deviceId: d, photographerIds: [p, target], outcomes: [args.priorOutcome, 'confirm'] } };
  }
  return _refuse('unsupported-action');
}

/**
 * Plan settling a supported identity conflict by an explicit link decision.
 * @param {{ shippedNames?: string[], kind: 'link-same-cameras'|'mark-different-photographers', ids: string[],
 *   bodyMatching?: boolean, expectedRevision: string, origin: object, at: string, newId?: () => string }} args
 */
function planIdentityResolution(events, args = {}) {
  const originError = _checkOrigin(args.origin);
  if (originError) return _refuse(originError);
  const ctx = _state(events, args.shippedNames);
  const opts = { origin: args.origin, at: args.at, newId: args.newId };
  const ids = Array.isArray(args.ids) ? args.ids : [];
  if (ids.length !== 2) return _refuse('invalid-request');

  if (args.kind === 'link-same-cameras') {
    const [a, b] = ids.map(id => _knownDevice(ctx, id));
    if (!a || !b) return _refuse('unknown-camera');
    if (a === b) return _refuse('already-linked');
    if (args.expectedRevision !== scopeRevision(ctx.state, { deviceIds: [a, b] })) return _refuse('stale-revision');
    const conflict = ctx.state.conflicts.find(c => c.kind === 'identifier-spans-devices' && c.deviceIds.length === 2 && c.deviceIds.includes(a) && c.deviceIds.includes(b));
    if (!conflict) return _refuse('no-matching-conflict');
    const r = conflictResolution(ctx.state, conflict, { bodyMatching: args.bodyMatching === true });
    if (!r.options.includes('link-same')) return _refuse(r.note || 'unsupported');
    const pair = [a, b].sort();
    const ev = createEvent('device-linked', { deviceIds: pair, decision: 'same', resolves: linkContext(ctx.state, 'device-linked', pair) }, opts);
    return { ok: true, events: [ev], result: { kind: args.kind, deviceIds: pair } };
  }
  if (args.kind === 'mark-different-photographers') {
    const [a, b] = ids.map(id => _knownPhotographer(ctx, id));
    if (!a || !b) return _refuse('unknown-photographer');
    if (a === b) return _refuse('already-linked');
    if (args.expectedRevision !== scopeRevision(ctx.state, { photographerIds: [a, b] })) return _refuse('stale-revision');
    const pair = [a, b].sort();
    const conflict = ctx.state.conflicts.find(c => c.kind === 'same-name-different-ids' && c.photographerIds.join('|') === pair.join('|'));
    if (!conflict) return _refuse('no-matching-conflict');
    const ev = createEvent('photographer-linked', { photographerIds: pair, decision: 'different', resolves: linkContext(ctx.state, 'photographer-linked', pair) }, opts);
    return { ok: true, events: [ev], result: { kind: args.kind, photographerIds: pair } };
  }
  return _refuse('unsupported-action');
}

module.exports = {
  OUTCOMES, ACTIONS_BY_STATE,
  scopeRevision, revisionOf, decisionHeads, associationStatus, unsettledPairs, associationActions, activePhotographers, sharedTrustedIdentifiers,
  conflictResolution, planAssociationDecision, planIdentityResolution,
};
