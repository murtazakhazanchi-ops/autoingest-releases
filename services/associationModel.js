/**
 * associationModel.js — derives the Photographer & Camera Identity Registry from its event
 * log (AI-FEAT-063, AI-RM-014 Q4a). Pure and deterministic: the same set of events, in any
 * order and with any duplicates, always derives the same state.
 *
 * Derived, never stored:
 *  - photographers (registered records, renames → current + former names, explicit links)
 *  - camera devices (identifier digests, explicit links → one canonical device)
 *  - photographer↔camera associations and their state:
 *      confirmed  latest settled explicit decision is a confirmation
 *      observed   no explicit decision; seen in imports where it was the only camera, or
 *                 chosen by the operator instead of a suggestion. NEVER a confirmation,
 *                 however many times it is seen.
 *      disputed   unsettled opposite decisions (confirm vs reject made without knowledge of
 *                 each other, e.g. on two offline computers)
 *      rejected   latest settled explicit decision is a rejection
 *      retired    latest settled explicit decision retires the association
 *  - per-model usage (weak hints only) and conflicts for operator review.
 * Co-occurrence on a mixed-camera import is kept as information and never forms an
 * association.
 */

'use strict';

const { validateEvent, canonicalJson, compareEvents } = require('./identityEvents');
const { normalizeName } = require('./photographerIdentity');
const { identifierKey } = require('./cameraDeviceIdentity');

const DECISION_KIND = { 'association-confirmed': 'confirm', 'association-rejected': 'reject', 'association-retired': 'retire' };

function _dsu() {
  const parent = new Map();
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); let r = x; while (parent.get(r) !== r) r = parent.get(r); return r; };
  // Deterministic canonical: the preferred ID (lowest rank, then smallest) becomes the root.
  const union = (a, b, rank) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const [keep, drop] = (rank(ra) - rank(rb) || (ra < rb ? -1 : 1)) < 0 ? [ra, rb] : [rb, ra];
    parent.set(drop, keep);
  };
  return { find, union };
}

/** Unsettled decisions: those no other decision lists in `resolves`. */
function _heads(decisions) {
  const settled = new Set(decisions.flatMap(d => d.resolves || []));
  return decisions.filter(d => !settled.has(d.eventId));
}

/**
 * Validate, de-duplicate by eventId and order. Same eventId + same content is an idempotent
 * duplicate. Same eventId + different content is an INTEGRITY CONFLICT: neither version is
 * trusted for derivation (both are held out and reported), so no conflicting event is ever
 * silently accepted as equivalent. Stores and merges keep the local copy on disk.
 */
function normalizeEventSet(events) {
  const byId = new Map();
  const ignored = [], collisions = new Set();
  for (const e of Array.isArray(events) ? events : []) {
    const res = validateEvent(e);
    if (!res.ok) { ignored.push({ eventId: e && typeof e.eventId === 'string' ? e.eventId : null, reason: 'invalid', errors: res.errors }); continue; }
    const prev = byId.get(e.eventId);
    if (!prev) { byId.set(e.eventId, { e, known: res.known, json: canonicalJson(e) }); continue; }
    if (canonicalJson(e) !== prev.json) collisions.add(e.eventId);
  }
  for (const id of collisions) { byId.delete(id); ignored.push({ eventId: id, reason: 'event-id-collision', errors: ['same eventId with different content'] }); }
  const all = [...byId.values()].sort((a, b) => compareEvents(a.e, b.e));
  return {
    events: all.map(x => x.e),
    knownEvents: all.filter(x => x.known).map(x => x.e),
    unknownTypeEvents: all.filter(x => !x.known).map(x => x.e),
    ignored,
    idCollisions: [...collisions].sort(),
  };
}

function _linkPass(events, type, idsField, rank) {
  const byPair = new Map();
  for (const e of events.filter(x => x.type === type)) {
    const key = [...e[idsField]].sort().join('|');
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push({ eventId: e.eventId, kind: e.decision, resolves: e.resolves, at: e.at });
  }
  const dsu = _dsu();
  const different = new Set(), conflicts = [];
  for (const [key, decisions] of byPair) {
    const heads = _heads(decisions);
    const kinds = new Set(heads.map(h => h.kind));
    const ids = key.split('|');
    if (kinds.size > 1) { conflicts.push({ ids, decisions: heads.map(h => h.eventId) }); continue; }
    if (kinds.has('same')) dsu.union(ids[0], ids[1], rank); else different.add(key);
  }
  return { dsu, different, conflicts };
}

/**
 * @param {object[]} events
 * @param {{ shipped?: { byId: Map<string,{name:string}> } }} [opts]  shipped bootstrap IDs (names for unregistered shipped photographers)
 */
function deriveRegistryState(events, opts = {}) {
  const norm = normalizeEventSet(events);
  const ev = norm.knownEvents;
  const shippedById = opts.shipped ? opts.shipped.byId : new Map();
  const conflicts = [];
  for (const id of norm.idCollisions) conflicts.push({ kind: 'event-id-collision', key: `event-id-collision|${id}`, eventId: id });

  // ── Photographers ──────────────────────────────────────────────────────────────
  const regs = new Map(); // id → { photographerId, idOrigin, names: [{name, at, eventId}], renames: [] }
  for (const e of ev) {
    if (e.type === 'photographer-registered') {
      if (!regs.has(e.photographerId)) regs.set(e.photographerId, { photographerId: e.photographerId, idOrigin: e.idOrigin, registeredName: e.name, renames: [] });
    } else if (e.type === 'photographer-renamed') {
      if (!regs.has(e.photographerId)) regs.set(e.photographerId, { photographerId: e.photographerId, idOrigin: shippedById.has(e.photographerId) ? 'shipped' : 'random', registeredName: e.fromName, renames: [] });
      regs.get(e.photographerId).renames.push(e);
    }
  }
  const pRank = (id) => (shippedById.has(id) ? 0 : 1);
  const pLinks = _linkPass(ev, 'photographer-linked', 'photographerIds', pRank);
  for (const c of pLinks.conflicts) conflicts.push({ kind: 'photographer-link-disputed', key: `photographer-link-disputed|${c.ids.join('|')}`, photographerIds: c.ids, decisions: c.decisions });
  const pCanon = (id) => pLinks.dsu.find(id);

  const photographers = new Map();
  const nameOf = (rec) => {
    const r = rec.renames;
    return r.length ? r[r.length - 1].toName : rec.registeredName;
  };
  const allPhotographerIds = new Set([...regs.keys()]);
  for (const e of ev) {
    for (const k of ['photographerId', 'suggestedPhotographerId', 'chosenPhotographerId']) if (e[k]) allPhotographerIds.add(e[k]);
    if (e.photographerIds) e.photographerIds.forEach(id => allPhotographerIds.add(id));
  }
  for (const id of [...allPhotographerIds].sort()) {
    const c = pCanon(id);
    const rec = regs.get(id);
    const name = rec ? nameOf(rec) : (shippedById.get(id)?.name || null);
    const former = rec ? [rec.registeredName, ...rec.renames.map(r => r.fromName), ...rec.renames.map(r => r.toName)].filter(n => n && n !== name) : [];
    if (rec) {
      // Two renames of the same name to different names, made without seeing each other.
      const byFrom = new Map();
      for (const r of rec.renames) { const k = normalizeName(r.fromName); if (!byFrom.has(k)) byFrom.set(k, new Set()); byFrom.get(k).add(r.toName); }
      for (const [, tos] of byFrom) if (tos.size > 1) conflicts.push({ kind: 'conflicting-renames', key: `conflicting-renames|${id}`, photographerId: id, names: [...tos].sort() });
    }
    if (!photographers.has(c)) photographers.set(c, { photographerId: c, name: null, formerNames: [], idOrigin: shippedById.has(c) ? 'shipped' : (regs.get(c)?.idOrigin || 'unregistered'), memberIds: [] });
    const p = photographers.get(c);
    p.memberIds.push(id);
    if (id === c) p.name = name;
    else if (name) p.formerNames.push(name);
    p.formerNames.push(...former);
  }
  for (const p of photographers.values()) {
    if (!p.name) p.name = p.formerNames[0] || null;
    p.formerNames = [...new Set(p.formerNames.filter(n => n && normalizeName(n) !== normalizeName(p.name || '')))].sort();
    p.memberIds.sort();
  }
  // Same name, different IDs — review only; never merged because names match.
  const byName = new Map();
  const candidates = [...photographers.values()].map(p => ({ id: p.photographerId, name: p.name }));
  for (const [id, s] of shippedById) if (!photographers.has(pCanon(id))) candidates.push({ id, name: s.name });
  for (const c of candidates) { if (!c.name) continue; const k = normalizeName(c.name); if (!byName.has(k)) byName.set(k, new Set()); byName.get(k).add(pCanon(c.id)); }
  for (const [, ids] of byName) {
    const list = [...ids].sort();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const key = [list[i], list[j]].sort().join('|');
      if (pLinks.different.has(key)) continue;
      conflicts.push({ kind: 'same-name-different-ids', key: `same-name-different-ids|${key}`, photographerIds: [list[i], list[j]] });
    }
  }

  // ── Camera devices ─────────────────────────────────────────────────────────────
  const rawDevices = new Map();
  for (const e of ev) {
    if (e.type === 'device-registered') {
      const d = rawDevices.get(e.deviceId) || { deviceId: e.deviceId, make: e.make, modelKey: e.modelKey, modelDisplay: e.modelDisplay, identifiers: [], firstSeenAt: e.at, lastSeenAt: e.at };
      d.identifiers.push(...e.identifiers);
      rawDevices.set(e.deviceId, d);
    }
  }
  for (const e of ev) {
    if (e.type === 'device-identifiers-added' && rawDevices.has(e.deviceId)) rawDevices.get(e.deviceId).identifiers.push(...e.identifiers);
  }
  const dLinks = _linkPass(ev, 'device-linked', 'deviceIds', () => 0);
  for (const c of dLinks.conflicts) conflicts.push({ kind: 'device-link-disputed', key: `device-link-disputed|${c.ids.join('|')}`, deviceIds: c.ids, decisions: c.decisions });
  const dCanon = (id) => dLinks.dsu.find(id);

  const devices = new Map();
  for (const d of [...rawDevices.values()].sort((a, b) => (a.deviceId < b.deviceId ? -1 : 1))) {
    const c = dCanon(d.deviceId);
    if (!devices.has(c)) devices.set(c, { deviceId: c, memberIds: [], make: null, modelKey: null, modelDisplay: null, identifiers: [], firstSeenAt: d.firstSeenAt, lastSeenAt: d.lastSeenAt, models: new Set() });
    const g = devices.get(c);
    g.memberIds.push(d.deviceId);
    if (d.deviceId === c || !g.make) { g.make = d.make; g.modelKey = d.modelKey; g.modelDisplay = d.modelDisplay; }
    g.models.add(`${d.make}|${d.modelKey}`);
    const seen = new Set(g.identifiers.map(i => identifierKey(i.ns, i.keyId, i.digest)));
    for (const i of d.identifiers) { const k = identifierKey(i.ns, i.keyId, i.digest); if (!seen.has(k)) { seen.add(k); g.identifiers.push({ ...i }); } }
    if (d.firstSeenAt < g.firstSeenAt) g.firstSeenAt = d.firstSeenAt;
    if (d.lastSeenAt > g.lastSeenAt) g.lastSeenAt = d.lastSeenAt;
  }
  const conflictedDevices = new Set();
  for (const g of devices.values()) {
    if (g.models.size > 1) { conflicts.push({ kind: 'linked-device-model-mismatch', key: `linked-device-model-mismatch|${g.deviceId}`, deviceId: g.deviceId }); conflictedDevices.add(g.deviceId); }
    delete g.models;
    g.identifiers.sort((a, b) => identifierKey(a.ns, a.keyId, a.digest).localeCompare(identifierKey(b.ns, b.keyId, b.digest)));
    g.memberIds.sort();
  }
  const identifierIndex = new Map();
  for (const g of devices.values()) for (const i of g.identifiers.filter(x => x.trusted)) {
    const k = identifierKey(i.ns, i.keyId, i.digest);
    if (!identifierIndex.has(k)) identifierIndex.set(k, new Set());
    identifierIndex.get(k).add(g.deviceId);
  }
  const spanSeen = new Set();
  for (const [, ids] of identifierIndex) if (ids.size > 1) {
    const list = [...ids].sort();
    list.forEach(id => conflictedDevices.add(id));
    const key = `identifier-spans-devices|${list.join('|')}`;
    if (!spanSeen.has(key)) { spanSeen.add(key); conflicts.push({ kind: 'identifier-spans-devices', key, deviceIds: list }); }
  }

  // ── Associations ───────────────────────────────────────────────────────────────
  const associations = new Map();
  const modelUsage = new Map();
  const provenance = (e) => ({ eventId: e.eventId, type: e.type, at: e.at, computerId: e.origin.computerId, operatorId: e.origin.operatorId, workflow: e.origin.workflow });
  const assoc = (deviceId, photographerId) => {
    const d = dCanon(deviceId), p = pCanon(photographerId);
    const k = `${d}|${p}`;
    if (!associations.has(k)) associations.set(k, { deviceId: d, photographerId: p, decisions: [], observedImports: new Set(), observedDays: new Set(), chosenOverSuggestion: 0, correctedAway: [], cooccurrences: 0, lastSeenAt: null, provenance: [] });
    return associations.get(k);
  };
  const touch = (a, e) => { a.provenance.push(provenance(e)); if (!a.lastSeenAt || e.at > a.lastSeenAt) a.lastSeenAt = e.at; };
  const useModel = (make, modelKey, photographerId, e) => {
    const k = `${make}|${modelKey}`;
    if (!modelUsage.has(k)) modelUsage.set(k, new Map());
    const p = pCanon(photographerId);
    const m = modelUsage.get(k);
    if (!m.has(p)) m.set(p, { photographerId: p, imports: new Set(), days: new Set(), lastSeenAt: null });
    const u = m.get(p);
    u.imports.add(e.importId); u.days.add(e.day);
    if (!u.lastSeenAt || e.at > u.lastSeenAt) u.lastSeenAt = e.at;
  };
  for (const e of ev) {
    switch (e.type) {
      case 'import-observed': {
        const a = assoc(e.deviceId, e.photographerId);
        a.observedImports.add(e.importId); a.observedDays.add(e.day); touch(a, e);
        const dev = devices.get(dCanon(e.deviceId));
        if (dev) useModel(dev.make, dev.modelKey, e.photographerId, e);
        break;
      }
      case 'import-cooccurred':
        for (const c of e.cameras) if (c.deviceId) { const a = assoc(c.deviceId, e.photographerId); a.cooccurrences++; a.provenance.push(provenance(e)); }
        break;
      case 'model-observed':
        useModel(e.make, e.modelKey, e.photographerId, e);
        break;
      case 'association-confirmed': case 'association-rejected': case 'association-retired': {
        const a = assoc(e.deviceId, e.photographerId);
        a.decisions.push({ eventId: e.eventId, kind: DECISION_KIND[e.type], resolves: e.resolves, at: e.at, computerId: e.origin.computerId });
        touch(a, e);
        break;
      }
      case 'suggestion-corrected': {
        const chosen = assoc(e.deviceId, e.chosenPhotographerId);
        chosen.chosenOverSuggestion++; chosen.observedDays.add(e.day); touch(chosen, e);
        const away = assoc(e.deviceId, e.suggestedPhotographerId);
        away.correctedAway.push(e.at); away.provenance.push(provenance(e));
        break;
      }
      default: break;
    }
  }
  const out = new Map();
  for (const [k, a] of associations) {
    const heads = _heads(a.decisions);
    const headKinds = new Set(heads.map(h => h.kind));
    let state;
    if (headKinds.has('confirm') && headKinds.has('reject')) state = 'disputed';
    else if (heads.length) state = { confirm: 'confirmed', reject: 'rejected', retire: 'retired' }[heads[heads.length - 1].kind];
    else if (a.observedImports.size || a.chosenOverSuggestion) state = 'observed';
    else state = null; // co-occurrence or corrected-away only: not an association
    const confirms = a.decisions.filter(d => d.kind === 'confirm');
    const lastConfirmedAt = confirms.length ? confirms[confirms.length - 1].at : null;
    if (state === 'disputed') conflicts.push({ kind: 'association-disputed', key: `association-disputed|${k}`, deviceId: a.deviceId, photographerId: a.photographerId, decisions: heads.map(h => h.eventId) });
    out.set(k, Object.freeze({
      deviceId: a.deviceId, photographerId: a.photographerId, state,
      confirmations: confirms.length,
      rejections: a.decisions.filter(d => d.kind === 'reject').length,
      retirements: a.decisions.filter(d => d.kind === 'retire').length,
      observedImports: a.observedImports.size,
      observedDays: a.observedDays.size,
      chosenOverSuggestion: a.chosenOverSuggestion,
      correctedAway: a.correctedAway.length,
      correctedAwaySinceConfirm: a.correctedAway.filter(t => !lastConfirmedAt || t > lastConfirmedAt).length,
      cooccurrences: a.cooccurrences,
      lastSeenAt: a.lastSeenAt,
      lastConfirmedAt,
      decisionEventIds: a.decisions.map(d => d.eventId),
      provenance: a.provenance,
    }));
  }

  conflicts.sort((x, y) => x.key.localeCompare(y.key));
  return {
    events: norm.events,
    ignored: norm.ignored,
    unknownTypeEvents: norm.unknownTypeEvents,
    photographers, photographerCanonical: pCanon,
    devices, deviceCanonical: dCanon, identifierIndex, conflictedDevices,
    associations: out,
    modelUsage,
    conflicts,
    associationsForDevice: (deviceId) => [...out.values()].filter(a => a.deviceId === dCanon(deviceId)),
  };
}

/**
 * The `resolves` list for a new explicit decision on (device, photographer): every earlier
 * decision on that pair this registry knows about. A decision made with that knowledge
 * settles them; one made elsewhere without it leaves a dispute.
 */
function decisionContext(state, deviceId, photographerId) {
  const a = state.associations.get(`${state.deviceCanonical(deviceId)}|${state.photographerCanonical(photographerId)}`);
  return a ? [...a.decisionEventIds] : [];
}

/** Same for an explicit link decision between two devices or two photographers. */
function linkContext(state, type, ids) {
  const key = [...ids].sort().join('|');
  const field = type === 'device-linked' ? 'deviceIds' : 'photographerIds';
  return state.events.filter(e => e.type === type && [...e[field]].sort().join('|') === key).map(e => e.eventId);
}

module.exports = { deriveRegistryState, normalizeEventSet, decisionContext, linkContext };
