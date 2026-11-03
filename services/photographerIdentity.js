/**
 * photographerIdentity.js — stable photographer IDs over the existing name list
 * (AI-FEAT-063 / DEC-029 decision 1, AI-RM-014 Q4a). Pure: no Electron, no filesystem.
 *
 * The existing photographer list (data/photographers.json + the local override, via
 * main/listManager.js) stays the ONLY authority for names. This module only gives those
 * names stable IDs:
 *   - Shipped entries (data/photographers.json) get a deterministic bootstrap ID,
 *     UUIDv5(namespace, normalized name). Every computer ships the same file, so every
 *     computer derives the same ID for the same shipped entry without writing anything.
 *   - Every other photographer (local additions, new profiles) gets an immutable random
 *     UUIDv4 when it is first registered. Two computers that add the same name therefore get
 *     two IDs, and that is surfaced for operator review — never merged because names match.
 * Aliases (main/aliasEngine.js) are typing shortcuts learned from autocomplete — many are
 * just the start of a name, some point at several names — so they are search hints only,
 * never evidence of identity.
 */

'use strict';

const crypto = require('crypto');
const { normalizeForAliasMatch } = require('../main/aliasEngine');

/** Fixed namespace for shipped-photographer bootstrap IDs. Never change it. */
const SHIPPED_PHOTOGRAPHER_NAMESPACE = '9541e5b6-21e8-47a6-9b5f-0da59d5ed1a1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SIMILAR_MIN_LENGTH = 5;
const SIMILAR_MAX_EDITS = 2;

const normalizeName = (name) => normalizeForAliasMatch(typeof name === 'string' ? name : '');
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function _uuidV5(name, namespace) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(ns).update(name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Deterministic ID of a SHIPPED entry. Callers must not use it for local additions. */
function shippedPhotographerId(name) {
  const n = normalizeName(name);
  if (!n) throw new Error('empty photographer name');
  return _uuidV5(`shipped-photographer:${n}`, SHIPPED_PHOTOGRAPHER_NAMESPACE);
}

/** Immutable random ID for a newly registered (non-shipped) photographer. */
function newPhotographerId(randomUUID = crypto.randomUUID) {
  const id = randomUUID();
  if (!isUuid(id)) throw new Error('randomUUID returned an invalid UUID');
  return id;
}

/**
 * Bootstrap IDs for the shipped list. Two shipped entries that normalize to the same name
 * would collapse into one ID, so neither gets a deterministic ID; both are reported.
 * @param {string[]} shippedNames
 * @returns {{ byNormalized: Map<string,{photographerId:string,name:string}>, byId: Map<string,{photographerId:string,name:string}>, problems: object[] }}
 */
function bootstrapShippedIds(shippedNames) {
  const groups = new Map();
  const problems = [];
  for (const name of Array.isArray(shippedNames) ? shippedNames : []) {
    const n = normalizeName(name);
    if (!n) { problems.push({ kind: 'empty-shipped-name' }); continue; }
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(name);
  }
  const byNormalized = new Map();
  const byId = new Map();
  for (const [n, names] of groups) {
    if (names.length > 1) { problems.push({ kind: 'duplicate-shipped-name', names }); continue; }
    const rec = Object.freeze({ photographerId: shippedPhotographerId(names[0]), name: names[0] });
    byNormalized.set(n, rec);
    byId.set(rec.photographerId, rec);
  }
  return { byNormalized, byId, problems };
}

function _editDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function _similar(a, b) {
  if (a.length >= SIMILAR_MIN_LENGTH && _editDistance(a, b, SIMILAR_MAX_EDITS) <= SIMILAR_MAX_EDITS) return 'spelling';
  const ta = a.split(' '), tb = b.split(' ');
  if (ta.length !== tb.length && (ta.every(t => tb.includes(t)) || tb.every(t => ta.includes(t)))) return 'name-parts';
  return null;
}

/**
 * Pre-save collision check for a new name or a rename (DEC-029 decision 2). Pure: callers
 * pass the merged list, the alias map and the registered photographer records.
 * @param {string} candidate
 * @param {{ listNames?: string[], aliases?: Record<string,string[]>, photographers?: Array<{photographerId:string,name:string|null,formerNames?:string[]}>, selfPhotographerId?: string|null }} ctx
 * @returns {{ ok: boolean, blocking: object[], warnings: object[] }}
 */
function checkNameCollision(candidate, ctx = {}) {
  const n = normalizeName(candidate);
  const blocking = [], warnings = [];
  if (!n) return { ok: false, blocking: [{ kind: 'empty-name' }], warnings };
  const self = ctx.selfPhotographerId || null;
  const selfRec = (ctx.photographers || []).find(p => p.photographerId === self);
  const selfNames = new Set(selfRec ? [selfRec.name, ...(selfRec.formerNames || [])].filter(Boolean).map(normalizeName) : []);

  for (const name of ctx.listNames || []) {
    const ln = normalizeName(name);
    if (ln === n && !selfNames.has(ln)) blocking.push({ kind: 'name-exists', name });
  }
  for (const p of ctx.photographers || []) {
    if (p.photographerId === self) continue;
    if (p.name && normalizeName(p.name) === n && !blocking.some(b => normalizeName(b.name) === n)) blocking.push({ kind: 'name-exists', name: p.name, photographerId: p.photographerId });
    for (const f of p.formerNames || []) if (normalizeName(f) === n) blocking.push({ kind: 'former-name-of-another', name: f, photographerId: p.photographerId });
  }
  // Search hints: worth a warning, never a block and never identity.
  const aliasOwners = Object.entries(ctx.aliases || {}).filter(([, list]) => (list || []).some(a => normalizeName(a) === n)).map(([slug]) => slug);
  if (aliasOwners.length) warnings.push({ kind: aliasOwners.length > 1 ? 'matches-ambiguous-search-alias' : 'matches-search-alias', owners: aliasOwners });
  for (const name of ctx.listNames || []) {
    const ln = normalizeName(name);
    if (ln === n || selfNames.has(ln)) continue;
    const how = _similar(n, ln);
    if (how) warnings.push({ kind: 'similar-name', name, how });
  }
  return { ok: blocking.length === 0, blocking, warnings };
}

/**
 * Resolve a name as written (e.g. an import's photographer string) to photographer IDs.
 * Registered records (current or former names) take precedence over shipped bootstrap IDs.
 * @returns {{ photographerIds: string[], via: 'registered'|'former-name'|'shipped'|'unregistered', ambiguous: boolean }}
 */
function resolvePhotographerName(name, { shipped, photographers = [] } = {}) {
  const n = normalizeName(name);
  if (!n) return { photographerIds: [], via: 'unregistered', ambiguous: false };
  const current = photographers.filter(p => p.name && normalizeName(p.name) === n).map(p => p.photographerId);
  if (current.length) return { photographerIds: [...new Set(current)].sort(), via: 'registered', ambiguous: new Set(current).size > 1 };
  const former = photographers.filter(p => (p.formerNames || []).some(f => normalizeName(f) === n)).map(p => p.photographerId);
  if (former.length) return { photographerIds: [...new Set(former)].sort(), via: 'former-name', ambiguous: new Set(former).size > 1 };
  const s = shipped && shipped.byNormalized.get(n);
  if (s) return { photographerIds: [s.photographerId], via: 'shipped', ambiguous: false };
  return { photographerIds: [], via: 'unregistered', ambiguous: false };
}

module.exports = {
  SHIPPED_PHOTOGRAPHER_NAMESPACE, normalizeName, isUuid,
  shippedPhotographerId, newPhotographerId, bootstrapShippedIds,
  checkNameCollision, resolvePhotographerName,
};
