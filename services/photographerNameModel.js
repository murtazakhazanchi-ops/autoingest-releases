/**
 * photographerNameModel.js — official names, name history and search aliases of photographer
 * identities (AI-FEAT-063, AI-RM-014 Q5b). Pure: no Electron, no filesystem, no clock.
 *
 * Three kinds of text point at a photographer, and only one of them is identity:
 *   official names   the registered/shipped name, every rename's from/to name and frozen shipped
 *                    spellings. Current AND former official names resolve to the one permanent ID.
 *   search aliases   registry-managed alternative spellings/abbreviations (photographer-alias-*
 *                    events). Search only: an alias never resolves an import, never names a
 *                    folder, and one alias may point at several photographers.
 *   learned shortcuts  photographers.aliases.json (autocomplete). Search only, read-only here.
 *
 * Resolution never guesses. A name that is an official name of two identities is ambiguous and
 * refused — with one exception kept from Q4: a name that is CURRENTLY a shipped list name of a
 * shipped identity resolves to that identity (Q4's ensurePhotographerId always did this; the
 * overlap stays a review item, 'same-name-different-ids').
 */

'use strict';

const crypto = require('crypto');
const { normalizeEventSet } = require('./associationModel');
const P = require('./photographerIdentity');

const NAME_EVENT_TYPES = new Set(['photographer-registered', 'photographer-renamed', 'photographer-linked', 'photographer-alias-added', 'photographer-alias-removed']);

const _canon = (state, id) => (state && typeof state.photographerCanonical === 'function' ? state.photographerCanonical(id) : id);

/**
 * normalized official name → { current: Set<id>, former: Set<id> } (canonical IDs).
 * Search aliases and learned shortcuts are deliberately absent.
 */
function buildOfficialNameIndex(state, shipped) {
  const index = new Map();
  const add = (name, id, slot) => {
    const n = P.normalizeName(name);
    if (!n || !id) return;
    if (!index.has(n)) index.set(n, { current: new Set(), former: new Set() });
    index.get(n)[slot].add(id);
  };
  for (const p of state.photographers.values()) {
    add(p.name, p.photographerId, 'current');
    for (const f of p.formerNames) add(f, p.photographerId, 'former');
  }
  for (const [id, rec] of shipped.byId) {
    const c = _canon(state, id);
    const p = state.photographers.get(c);
    const cur = p ? P.normalizeName(p.name || '') : P.normalizeName(rec.name);
    for (const f of [rec.name, ...(rec.formerNames || [])]) add(f, c, P.normalizeName(f) === cur ? 'current' : 'former');
  }
  for (const v of index.values()) for (const id of v.current) v.former.delete(id);
  return index;
}

/**
 * Resolve an official name (as written in the photographer list) to one permanent identity.
 * @returns {{ ok: true, photographerId: string|null, via: 'shipped'|'registered'|'former-name'|'unregistered', overlapping?: string[] }
 *         | { ok: false, reason: 'empty-name'|'ambiguous', photographerIds?: string[] }}
 */
function resolveOfficialName(name, { state, shipped, index = buildOfficialNameIndex(state, shipped) }) {
  const n = P.normalizeName(name);
  if (!n) return { ok: false, reason: 'empty-name' };
  const hit = index.get(n);
  const ids = hit ? [...new Set([...hit.current, ...hit.former])].sort() : [];
  const viaFor = (id) => {
    if (!hit.current.has(id)) return 'former-name';
    const p = state.photographers.get(id);
    return !p || p.idOrigin === 'shipped' ? 'shipped' : 'registered';
  };
  if (!ids.length) return { ok: true, photographerId: null, via: 'unregistered' };
  if (ids.length === 1) return { ok: true, photographerId: ids[0], via: viaFor(ids[0]) };
  const s = shipped.byNormalized.get(n);
  if (s && P.normalizeName(s.name) === n) {
    const c = _canon(state, s.photographerId);
    if (hit.current.has(c)) return { ok: true, photographerId: c, via: 'shipped', overlapping: ids.filter(x => x !== c) };
  }
  return { ok: false, reason: 'ambiguous', photographerIds: ids };
}

/** Every official name of one identity (current first), for folder matching and collision checks. */
function officialNamesOf(state, shipped, photographerId) {
  const c = _canon(state, photographerId);
  const p = state.photographers.get(c);
  const out = new Map();
  const add = (x) => { const n = P.normalizeName(x); if (n && !out.has(n)) out.set(n, x); };
  if (p) add(p.name);
  const members = p ? p.memberIds : [c];
  for (const id of members) { const r = shipped.byId.get(id); if (r) { add(r.name); r.formerNames.forEach(add); } }
  if (p) p.formerNames.forEach(add);
  const [current, ...former] = [...out.values()];
  return { photographerId: c, current: current || null, former };
}

/**
 * Official name history per canonical identity.
 * @returns {Map<string, { originalName: string|null, currentName: string|null, formerNames: string[],
 *   history: Array<{ eventId, at, fromName, toName, operatorId, computerId, workflow, stale: boolean }>,
 *   conflicts: Array<{ kind: 'stale-rename', eventId: string }> }>}
 *   stale: the rename's fromName was not the name this identity had at that point of the merged
 *   history — typically made on another computer that had not seen an earlier rename.
 */
function deriveNameHistory(events, { state, shipped }) {
  const ev = normalizeEventSet(events).knownEvents;
  const firstReg = new Map();
  const renames = new Map();
  for (const e of ev) {
    if (e.type === 'photographer-registered' && !firstReg.has(e.photographerId)) firstReg.set(e.photographerId, e.name);
    if (e.type === 'photographer-renamed') { if (!renames.has(e.photographerId)) renames.set(e.photographerId, []); renames.get(e.photographerId).push(e); }
  }
  const out = new Map();
  const ids = new Set([...state.photographers.keys(), ...[...shipped.byId.keys()].map(id => _canon(state, id))]);
  for (const c of ids) {
    const p = state.photographers.get(c);
    const members = p ? p.memberIds : [c];
    const history = [];
    const conflicts = [];
    const startOf = (id) => firstReg.get(id) || (shipped.byId.get(id) || {}).originalName || ((renames.get(id) || [])[0] || {}).fromName || null;
    const original = startOf(c) || members.map(startOf).find(Boolean) || null;
    for (const id of members) {
      const s = shipped.byId.get(id);
      let running = startOf(id);
      let applied = 0;
      for (const r of renames.get(id) || []) {
        // Before the first rename, any shipped spelling of this identity is a valid starting name.
        const okFrom = new Set([running, ...(applied++ === 0 && s ? [s.name, ...s.formerNames] : [])].filter(Boolean).map(P.normalizeName));
        const stale = running !== null && !okFrom.has(P.normalizeName(r.fromName));
        if (stale) conflicts.push({ kind: 'stale-rename', eventId: r.eventId });
        history.push({ eventId: r.eventId, at: r.at, fromName: r.fromName, toName: r.toName, operatorId: r.origin.operatorId, computerId: r.origin.computerId, workflow: r.origin.workflow, stale });
        running = r.toName;
      }
    }
    history.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.eventId < b.eventId ? -1 : 1));
    const names = officialNamesOf(state, shipped, c);
    out.set(c, { originalName: original || names.current, currentName: names.current, formerNames: names.former, history, conflicts });
  }
  return out;
}

/**
 * Live search aliases per canonical identity (observed-remove set).
 * @returns {Map<string, Array<{ alias: string, kind: string, addedAt: string, addEventIds: string[], operatorId: string|null, computerId: string }>>}
 */
function deriveSearchAliases(events, { state }) {
  const ev = normalizeEventSet(events).knownEvents;
  const removed = new Set();
  for (const e of ev) if (e.type === 'photographer-alias-removed') e.resolves.forEach(id => removed.add(id));
  const live = new Map(); // c|norm → adds
  for (const e of ev) {
    if (e.type !== 'photographer-alias-added' || removed.has(e.eventId)) continue;
    const c = _canon(state, e.photographerId);
    const k = `${c}|${P.normalizeName(e.alias)}`;
    if (!live.has(k)) live.set(k, { c, adds: [] });
    live.get(k).adds.push(e);
  }
  const out = new Map();
  for (const { c, adds } of live.values()) {
    const last = adds[adds.length - 1];
    if (!out.has(c)) out.set(c, []);
    out.get(c).push({ alias: last.alias, kind: last.kind, addedAt: adds[0].at, addEventIds: adds.map(a => a.eventId), operatorId: last.origin.operatorId, computerId: last.origin.computerId });
  }
  for (const list of out.values()) list.sort((a, b) => a.alias.localeCompare(b.alias));
  return out;
}

/** normalized alias → Set<canonical id>. Size > 1 is an ambiguous alias: keep all, select none. */
function searchAliasOwners(aliases) {
  const owners = new Map();
  for (const [c, list] of aliases) for (const a of list) {
    const n = P.normalizeName(a.alias);
    if (!owners.has(n)) owners.set(n, new Set());
    owners.get(n).add(c);
  }
  return owners;
}

/**
 * Revision of one identity's name/alias/link record: changes whenever any of those events for
 * any linked member changes. Commands built against an older revision are rejected as stale.
 */
function profileRevision(events, { state, photographerId }) {
  const c = _canon(state, photographerId);
  const p = state.photographers.get(c);
  const members = new Set(p ? p.memberIds : [c]);
  const ids = normalizeEventSet(events).knownEvents
    .filter(e => NAME_EVENT_TYPES.has(e.type) && (members.has(e.photographerId) || (e.photographerIds || []).some(x => members.has(x))))
    .map(e => e.eventId).sort();
  return crypto.createHash('sha256').update(`profile-rev-1|${c}|${ids.join(',')}`).digest('hex').slice(0, 16);
}

module.exports = {
  NAME_EVENT_TYPES, buildOfficialNameIndex, resolveOfficialName, officialNamesOf,
  deriveNameHistory, deriveSearchAliases, searchAliasOwners, profileRevision,
};
