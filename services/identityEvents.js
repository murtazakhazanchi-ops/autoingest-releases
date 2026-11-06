/**
 * identityEvents.js — the append-only event schema of the Photographer & Camera Identity
 * Registry (AI-FEAT-063, AI-RM-014 Q4a). Pure: no Electron, no filesystem, no clock.
 *
 * The registry is a set of immutable events; photographers, camera devices, associations
 * and conflicts are DERIVED from them (associationModel.js). Merging two computers'
 * registries is therefore a union of events by eventId: order-independent, repeatable,
 * and nothing is removed because another computer does not have it.
 *
 * Validation is strict: unknown payload keys are rejected, so a raw serial, a file name, a
 * card label, a lens serial or an Artist value cannot ride along in an event. Camera
 * identifiers are keyed digests only (identityKeyring.js).
 *
 * Every event records provenance: origin.computerId (settings.deviceId of the computer that
 * wrote it), origin.operatorId (users.json operator, or null) and origin.workflow.
 */

'use strict';

const crypto = require('crypto');
const { DIGEST_RE, KEY_ID_RE } = require('./identityKeyring');
const { isUuid } = require('./photographerIdentity');

const EVENT_SCHEMA = 1;
const WORKFLOWS = new Set(['event-import', 'multi-event-import', 'staging-import', 'quick-ingest', 'import-modal', 'registry', 'registry-merge']);
const NS_RE = /^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*$/; // e.g. exif.bodySerial, canon.internal
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const MAX_TEXT = 200;
const MAX_RESOLVES = 1000;
const MAX_ALIAS = 80;

// ── Field validators: return an error string or null ─────────────────────────────
const v = {
  uuid: (x) => (isUuid(x) ? null : 'must be a UUID'),
  text: (x) => (typeof x === 'string' && x.trim() && x.length <= MAX_TEXT ? null : `must be a non-empty string ≤ ${MAX_TEXT}`),
  alias: (x) => (typeof x === 'string' && x.trim() && x === x.trim() && x.length <= MAX_ALIAS && !/[\u0000-\u001f\u007f]/.test(x) ? null : `must be a trimmed string ≤ ${MAX_ALIAS} without control characters`),
  day: (x) => (typeof x === 'string' && DAY_RE.test(x) ? null : 'must be YYYY-MM-DD'),
  count: (x) => (Number.isInteger(x) && x >= 1 ? null : 'must be an integer ≥ 1'),
  countOrZero: (x) => (Number.isInteger(x) && x >= 0 ? null : 'must be an integer ≥ 0'),
  oneOf: (set) => (x) => (set.includes(x) ? null : `must be one of ${set.join(', ')}`),
  idPair: (x) => (Array.isArray(x) && x.length === 2 && x.every(isUuid) && x[0] !== x[1] ? null : 'must be two different UUIDs'),
  eventIds: (x) => (Array.isArray(x) && x.length <= MAX_RESOLVES && x.every(isUuid) && new Set(x).size === x.length ? null : `must be an array of distinct UUIDs (≤ ${MAX_RESOLVES})`),
  identifiers: (x) => {
    if (!Array.isArray(x) || x.length === 0) return 'must be a non-empty array';
    for (const i of x) {
      if (!i || typeof i !== 'object' || Array.isArray(i)) return 'identifier must be an object';
      const extra = Object.keys(i).filter(k => !['ns', 'keyId', 'digest', 'trusted'].includes(k));
      if (extra.length) return `identifier has unexpected field(s) ${extra.join(', ')}`;
      if (!NS_RE.test(i.ns || '')) return 'identifier namespace invalid';
      if (!KEY_ID_RE.test(i.keyId || '')) return 'identifier keyId invalid';
      if (!DIGEST_RE.test(i.digest || '')) return 'identifier digest must be 64 hex characters';
      if (typeof i.trusted !== 'boolean') return 'identifier trusted must be boolean';
    }
    return null;
  },
  cameras: (x) => {
    if (!Array.isArray(x) || x.length < 1) return 'must list at least one camera';
    for (const c of x) {
      if (!c || typeof c !== 'object') return 'camera must be an object';
      const keys = Object.keys(c).sort().join(',');
      if (keys === 'deviceId,fileCount') { if (!isUuid(c.deviceId)) return 'camera deviceId must be a UUID'; }
      else if (keys === 'fileCount,make,modelKey') { if (v.text(c.make) || v.text(c.modelKey)) return 'camera make/modelKey invalid'; }
      else return 'camera must be {deviceId, fileCount} or {make, modelKey, fileCount}';
      if (v.count(c.fileCount)) return 'camera fileCount must be an integer ≥ 1';
    }
    return null;
  },
};

/** Payload schema per event type: field → validator. Every field is required. */
const TYPES = {
  'photographer-registered': { photographerId: v.uuid, name: v.text, idOrigin: v.oneOf(['shipped', 'random']) },
  'photographer-renamed': { photographerId: v.uuid, fromName: v.text, toName: v.text },
  // Registry-managed search aliases (Q5b): alternative spellings and abbreviations used to FIND
  // a photographer. Never identity, never a folder name. An observed-remove set: a removal
  // lists the additions it saw (`resolves`), so an alias re-added elsewhere stays.
  'photographer-alias-added': { photographerId: v.uuid, alias: v.alias, kind: v.oneOf(['spelling', 'abbreviation', 'other']) },
  'photographer-alias-removed': { photographerId: v.uuid, alias: v.alias, resolves: v.eventIds },
  'photographer-linked': { photographerIds: v.idPair, decision: v.oneOf(['same', 'different']), resolves: v.eventIds },
  // Profile status (Q5e-1): retired is a registry status, never a deletion — names, cameras,
  // history and the photographer list are untouched. `resolves` lists the earlier status events
  // the operator saw; opposite statuses that never saw each other stay disputed for review.
  'photographer-status-set': { photographerId: v.uuid, status: v.oneOf(['active', 'retired']), resolves: v.eventIds },
  'device-registered': { deviceId: v.uuid, make: v.text, modelKey: v.text, modelDisplay: v.text, identifiers: v.identifiers },
  'device-identifiers-added': { deviceId: v.uuid, identifiers: v.identifiers, basis: v.oneOf(['co-observed']) },
  'device-linked': { deviceIds: v.idPair, decision: v.oneOf(['same', 'different']), resolves: v.eventIds },
  'import-observed': { importId: v.text, photographerId: v.uuid, deviceId: v.uuid, fileCount: v.count, day: v.day },
  // Several cameras (or one camera plus conflicting files) in one import: information only.
  'import-cooccurred': { importId: v.text, photographerId: v.uuid, cameras: v.cameras, conflictFiles: v.countOrZero, day: v.day },
  'model-observed': { importId: v.text, photographerId: v.uuid, make: v.text, modelKey: v.text, fileCount: v.count, day: v.day },
  // Explicit operator decisions. `resolves` lists the earlier decisions on the same pair the
  // operator's registry already held (associationModel.decisionContext): a decision settles
  // what it lists. Opposite decisions that never saw each other (two offline computers) stay
  // unsettled and the association is DISPUTED — never resolved by timestamp alone.
  'association-confirmed': { photographerId: v.uuid, deviceId: v.uuid, resolves: v.eventIds },
  'association-rejected': { photographerId: v.uuid, deviceId: v.uuid, resolves: v.eventIds },
  'association-retired': { photographerId: v.uuid, deviceId: v.uuid, resolves: v.eventIds },
  'suggestion-corrected': { deviceId: v.uuid, suggestedPhotographerId: v.uuid, chosenPhotographerId: v.uuid, day: v.day },
};
const ENVELOPE_KEYS = ['schema', 'eventId', 'type', 'at', 'origin'];

function _validateEnvelope(e) {
  const errors = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['event must be an object'];
  if (e.schema !== EVENT_SCHEMA) errors.push(`schema must be ${EVENT_SCHEMA}`);
  if (!isUuid(e.eventId)) errors.push('eventId must be a UUID');
  if (typeof e.type !== 'string' || !e.type) errors.push('type missing');
  if (typeof e.at !== 'string' || !ISO_RE.test(e.at) || Number.isNaN(Date.parse(e.at))) errors.push('at must be an ISO-8601 UTC timestamp');
  const o = e.origin;
  if (!o || typeof o !== 'object' || Array.isArray(o)) errors.push('origin missing');
  else {
    const extra = Object.keys(o).filter(k => !['computerId', 'operatorId', 'workflow'].includes(k));
    if (extra.length) errors.push(`origin has unexpected field(s) ${extra.join(', ')}`);
    if (v.text(o.computerId)) errors.push('origin.computerId must be a non-empty string');
    if (o.operatorId !== null && v.text(o.operatorId)) errors.push('origin.operatorId must be a string or null');
    if (!WORKFLOWS.has(o.workflow)) errors.push('origin.workflow unknown');
  }
  return errors;
}

/**
 * @returns {{ ok: boolean, known: boolean, errors: string[] }}
 *   known=false: a well-formed event of a type this version does not know (kept by merges
 *   for forward compatibility, ignored by derivation).
 */
function validateEvent(e) {
  const errors = _validateEnvelope(e);
  if (errors.length) return { ok: false, known: false, errors };
  const schema = TYPES[e.type];
  if (!schema) return { ok: true, known: false, errors: [] };
  const payloadKeys = Object.keys(e).filter(k => !ENVELOPE_KEYS.includes(k));
  for (const k of payloadKeys) if (!schema[k]) errors.push(`unexpected field ${k}`);
  for (const [k, check] of Object.entries(schema)) {
    const err = check(e[k]);
    if (err) errors.push(`${k} ${err}`);
  }
  if (!errors.length) {
    if (e.type === 'device-registered' && !e.identifiers.some(i => i.trusted)) errors.push('identifiers must include a trusted identifier');
    if (e.type === 'photographer-alias-removed' && !e.resolves.length) errors.push('resolves must list the alias additions removed');
    if (e.type === 'suggestion-corrected' && e.suggestedPhotographerId === e.chosenPhotographerId) errors.push('chosen photographer must differ from the suggestion');
    if (e.type === 'import-cooccurred' && e.cameras.length + (e.conflictFiles > 0 ? 1 : 0) < 2) errors.push('co-occurrence needs two cameras, or one camera plus conflicting files');
  }
  return { ok: errors.length === 0, known: true, errors };
}

function _deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const x of Object.values(o)) _deepFreeze(x); }
  return o;
}

/**
 * Build and validate one event. `at` and `newId` are injected so callers (and tests) own
 * the clock and randomness.
 * @param {string} type
 * @param {object} payload
 * @param {{ origin: {computerId:string, operatorId:string|null, workflow:string}, at: string, newId?: () => string }} ctx
 */
function createEvent(type, payload, { origin, at, newId = crypto.randomUUID } = {}) {
  if (!TYPES[type]) throw new Error(`unknown event type ${type}`);
  const e = { schema: EVENT_SCHEMA, eventId: newId(), type, at, origin: origin && { computerId: origin.computerId, operatorId: origin.operatorId ?? null, workflow: origin.workflow }, ...payload };
  const res = validateEvent(e);
  if (!res.ok) throw new Error(`invalid ${type} event: ${res.errors.join('; ')}`);
  return _deepFreeze(JSON.parse(JSON.stringify(e)));
}

/** Stable JSON (sorted keys) — content equality and deterministic tie-breaks. */
function canonicalJson(x) {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(x[k])}`).join(',')}}`;
  return JSON.stringify(x);
}

/** Total order used everywhere events are folded: time, then eventId. */
const compareEvents = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0);

module.exports = { EVENT_SCHEMA, EVENT_TYPES: Object.freeze(Object.keys(TYPES)), WORKFLOWS, validateEvent, createEvent, canonicalJson, compareEvents };
