/**
 * photographerRegistryView.js — privacy-safe, read-only view models for the future Photographer
 * Registry (AI-FEAT-063, AI-RM-014 Q5a). Pure: no Electron, no filesystem, no clock.
 *
 * Inputs are the authoritative photographer name list (listManager: shipped + local override),
 * the Q4 identity events, the learned autocomplete shortcuts (aliasEngine) and the operator
 * list. The output is plain JSON a renderer could receive. It deliberately never contains:
 * camera identifier values or digests, key IDs, computer IDs (only "this"/"another" computer),
 * import IDs, file or folder paths, or raw event objects.
 *
 * Identity rules carried forward from Q4 and the approved Q5 architecture:
 *  - One profile per permanent photographer ID. A list name resolves to an ID through the
 *    photographer's current name, its former names and its shipped spelling — never through a
 *    learned shortcut or a search alias. A list name matching several IDs is an "ambiguous"
 *    profile for review; nothing is chosen.
 *  - A local list name not yet used by any import has no ID yet (Q4 assigns it at first use).
 *    It is shown as `identity: 'pending-first-use'` with `photographerId: null` — no ID is
 *    invented here and nothing is written.
 *  - Learned typing shortcuts are search hints, labelled as such, never former names.
 *  - Features later stages add (search aliases, retirement, nicknames, rename, folder rename)
 *    are reported as unavailable, with empty data, rather than simulated.
 *
 * Contract invariants later stages (Q5b, S1–S8) must keep:
 *  - `photographerId` is the permanent identity; `key` is the browsing handle (the ID, or
 *    `name:`/`ambiguous:` + normalised name while no single ID exists). Renames never change it.
 *  - Former names stay on the profile and stay searchable; `nameHistory` is append-only.
 *  - Search aliases and learned shortcuts are never identity (excluded from buildNameIndex).
 *  - A profile carries NO folder name: a photographer may have different folder names in
 *    different events; folder names belong to each event (event.json, S1), not to the profile.
 *  - Nothing here proposes or performs a folder rename; a current-event rename always needs an
 *    explicit operator choice, keeps the PCxx sequence and never creates a duplicate folder.
 */

'use strict';

const crypto = require('crypto');
const { deriveRegistryState } = require('./associationModel');
const { compareEvents } = require('./identityEvents');
const P = require('./photographerIdentity');
const N = require('./photographerNameModel');
const { slugify } = require('../main/aliasEngine');
const { suggestForCamera } = require('./photographerSuggestion');
const { unsettledPairs } = require('./cameraAssociationCommands');

const VIEW_CONTRACT_VERSION = 1;
const ACTIVE = new Set(['confirmed', 'observed', 'disputed']);

const ASSOCIATION_LABEL = {
  confirmed: 'Confirmed',
  observed: 'Observed',
  disputed: 'Needs review',
  rejected: 'Not this photographer',
  retired: 'No longer used',
};
const ASSOCIATION_EXPLANATION = {
  confirmed: 'An operator confirmed this camera belongs to this photographer.',
  observed: 'Seen in imports where it was the only camera. Not confirmed.',
  disputed: 'Confirmed and rejected without seeing each other (for example on two computers).',
  rejected: 'An operator marked this camera as not this photographer\'s.',
  retired: 'An operator marked this camera as no longer used by this photographer.',
};
const SUGGESTION_LABEL = {
  strong: 'Confirmed camera', likely: 'Likely', possible: 'Possible', alternatives: 'Shared camera', weak: 'Model only', none: 'No suggestion',
};
const IDENTIFIER_LABEL = {
  'exif.bodySerial': 'EXIF body serial',
  'dng.cameraSerial': 'DNG camera serial',
  'canon.internal': 'Canon internal ID',
  'sony.internal': 'Sony internal ID',
  'nikon.serial': 'Nikon serial',
};
const WORKFLOW_LABEL = {
  'event-import': 'Event import',
  'multi-event-import': 'Multi-event import',
  'staging-import': 'Staging import',
  'quick-ingest': 'Quick Ingest',
  'import-modal': 'Import confirmation',
  registry: 'Photographer Registry',
  'registry-merge': 'Registry merge',
};
const CONFLICT_TEXT = {
  'event-id-collision': ['Damaged registry record', 'Two different records share one ID. Both are held aside and neither is used.'],
  'photographer-link-disputed': ['Photographer link disputed', 'These records were marked both "same person" and "different people" without seeing each other.'],
  'same-name-different-ids': ['Same name, different photographer records', 'These photographers share a name but have separate identities. They are never merged automatically.'],
  'conflicting-renames': ['Renamed differently', 'This photographer was renamed to different names without the changes seeing each other.'],
  'device-link-disputed': ['Camera link disputed', 'These camera records were marked both "same camera" and "different cameras".'],
  'linked-device-model-mismatch': ['Linked cameras disagree on model', 'Camera records linked as one camera report different models.'],
  'identifier-spans-devices': ['Camera records overlap', 'Two camera records share an identifier. Neither is used for suggestions until reviewed.'],
  'association-disputed': ['Camera confirmation disputed', 'This camera was confirmed and rejected for this photographer without the decisions seeing each other.'],
  'association-unsettled': ['Camera decisions disagree', 'Different decisions were recorded for this camera and photographer without seeing each other. The latest one is shown until an operator settles it.'],
  'ambiguous-name': ['Name matches several photographers', 'This list name belongs to more than one photographer record, so it is not linked to any of them.'],
  'stale-rename': ['Rename made from an older name', 'This rename started from a name the photographer no longer had, usually because it was made on another computer before an earlier rename arrived.'],
  'shared-search-alias': ['Search alias shared', 'This search alias belongs to more than one photographer. Searching for it shows all of them and selects none.'],
  'integrity-conflicts': ['Records held for review', 'Some imported registry records conflicted with existing ones and are held aside.'],
};

const _day = (iso) => (typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : null);
const _maxIso = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
const _minIso = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
const _OBSERVATION = new Set(['import-observed', 'import-cooccurred']);
const _lastObservation = (a) => a.provenance.filter(pv => _OBSERVATION.has(pv.type)).reduce((m, pv) => _maxIso(m, pv.at), null);
const reviewKeyOf = (k) => `r-${crypto.createHash('sha256').update(k).digest('hex').slice(0, 16)}`;

/**
 * Normalised name → Set of canonical photographer IDs, from current names, former names and
 * shipped spellings. Learned shortcuts and search aliases are NOT included: they never prove
 * identity. (Pure; a flattening of photographerNameModel.buildOfficialNameIndex, the index the registry
 * store resolves import names through since Q5b.)
 */
function buildNameIndex(state, shipped) {
  const index = new Map();
  for (const [n, hit] of N.buildOfficialNameIndex(state, shipped)) index.set(n, new Set([...hit.current, ...hit.former]));
  return index;
}

function _operatorName(operators, id) {
  if (id === null || id === undefined) return 'Not recorded';
  return operators.get(id) || 'Unknown operator';
}

/**
 * @param {{
 *   registry: { state: string, reason?: string|null, events?: object[], keyStatus?: string, keyVerified?: boolean,
 *               heldCount?: number, unknownTypeEvents?: number },
 *   listNames?: string[], shippedNames?: string[],
 *   learnedShortcuts?: Record<string, string[]>,
 *   operators?: Array<{ id: string, name: string }>,
 *   thisComputerId?: string|null,
 *   learning?: { enabled?: boolean, pendingCount?: number|null },
 * }} input
 */
function buildRegistryView(input = {}) {
  const reg = input.registry || { state: 'missing' };
  const usable = reg.state === 'ready' || reg.state === 'locked';
  const events = usable && Array.isArray(reg.events) ? reg.events : [];
  const listNames = Array.isArray(input.listNames) ? input.listNames.filter(n => typeof n === 'string' && n.trim()) : [];
  const shipped = P.bootstrapShippedIds(Array.isArray(input.shippedNames) ? input.shippedNames : []);
  const shortcuts = input.learnedShortcuts && typeof input.learnedShortcuts === 'object' ? input.learnedShortcuts : {};
  const operators = new Map((input.operators || []).filter(o => o && typeof o.id === 'string').map(o => [o.id, String(o.name || '')]));
  const thisComputer = input.thisComputerId || null;
  const computerOf = (id) => (thisComputer && id === thisComputer ? 'this' : 'another');

  const state = deriveRegistryState(events, { shipped });
  const unsettled = unsettledPairs(state);
  const officialIndex = N.buildOfficialNameIndex(state, shipped);
  const history = N.deriveNameHistory(events, { state, shipped });
  const registryAliases = N.deriveSearchAliases(events, { state });

  // ── Photographer profiles ──────────────────────────────────────────────────────
  const profiles = new Map();
  const profile = (key, base) => {
    if (!profiles.has(key)) {
      profiles.set(key, {
        key, photographerId: null, identity: 'pending-first-use', name: null, originalName: null,
        formerNames: [], nameHistory: [], listNames: [], inList: false,
        searchAliases: [], learnedShortcuts: [], status: 'active',
        cameras: [], modelsUsed: [], cameraCounts: { confirmed: 0, observed: 0, disputed: 0, rejected: 0, retired: 0, shared: 0 },
        lastObservedDay: null, review: [], ...base,
      });
    }
    return profiles.get(key);
  };

  const registeredName = new Map();
  for (const e of [...events].sort(compareEvents)) {
    if (e.type === 'photographer-registered' && validEvent(e) && !registeredName.has(e.photographerId)) registeredName.set(e.photographerId, e.name);
  }
  for (const p of state.photographers.values()) {
    const id = p.photographerId;
    profile(id, {
      photographerId: id,
      identity: p.idOrigin === 'shipped' ? 'shipped' : p.idOrigin === 'random' ? 'registered' : 'referenced',
      name: p.name,
      formerNames: [...p.formerNames],
    });
  }
  for (const [id, s] of shipped.byId) {
    const c = state.photographerCanonical(id);
    if (!profiles.has(c)) profile(c, { photographerId: c, identity: 'shipped', name: s.name });
  }

  // List names resolve exactly as an import would (photographerNameModel.resolveOfficialName).
  const ambiguous = [];
  for (const name of listNames) {
    const n = P.normalizeName(name);
    const r = N.resolveOfficialName(name, { state, shipped, index: officialIndex });
    if (r.ok && r.photographerId) {
      profile(r.photographerId).listNames.push(name);
    } else if (!r.ok && r.reason === 'ambiguous') {
      const key = `ambiguous:${n}`;
      const pr = profile(key, { identity: 'ambiguous', name });
      pr.listNames.push(name);
      ambiguous.push({ key, name, ids: r.photographerIds });
    } else {
      profile(`name:${n}`, { identity: 'pending-first-use', name }).listNames.push(name);
    }
  }

  // Name history (photographerNameModel): each official rename, attributed and dated.
  const staleRenames = [];
  for (const [id, h] of history) {
    const pr = profiles.get(id);
    if (!pr) continue;
    for (const r of h.history) {
      pr.nameHistory.push({
        day: _day(r.at), at: r.at, fromName: r.fromName, toName: r.toName, stale: r.stale,
        operator: _operatorName(operators, r.operatorId), computer: computerOf(r.computerId),
      });
    }
    for (const c of h.conflicts) staleRenames.push({ id, eventId: c.eventId });
  }
  for (const [id, list] of registryAliases) {
    const pr = profiles.get(id);
    if (pr) pr.searchAliases = list.map(a => ({ text: a.alias, kind: a.kind, addedDay: _day(a.addedAt) }));
  }
  for (const pr of profiles.values()) {
    if (pr.photographerId) {
      const shippedRec = shipped.byId.get(pr.photographerId);
      pr.originalName = shippedRec ? shippedRec.name
        : registeredName.get(pr.photographerId) || (pr.nameHistory[0] && pr.nameHistory[0].fromName) || pr.name;
    } else {
      pr.originalName = pr.name;
    }
    if (!pr.name) pr.name = pr.originalName || 'Unknown photographer';
    const cur = P.normalizeName(pr.name);
    const former = new Map();
    for (const f of [...pr.formerNames, pr.originalName, ...pr.listNames]) {
      const n = P.normalizeName(f);
      if (n && n !== cur && !former.has(n)) former.set(n, f);
    }
    pr.formerNames = [...former.values()].sort((a, b) => a.localeCompare(b));
    pr.inList = pr.listNames.length > 0;
    // Learned autocomplete shortcuts are keyed by the slug of the list label they were learned on.
    const seen = new Set();
    for (const label of [pr.name, ...pr.formerNames, ...pr.listNames]) {
      for (const text of Array.isArray(shortcuts[slugify(label)]) ? shortcuts[slugify(label)] : []) {
        const n = P.normalizeName(text);
        if (!n || seen.has(n) || typeof text !== 'string') continue;
        seen.add(n);
        pr.learnedShortcuts.push({ text: text.trim(), learnedFor: label });
      }
    }
  }

  // ── Cameras ───────────────────────────────────────────────────────────────────
  const modelDisplay = new Map();
  for (const d of state.devices.values()) modelDisplay.set(`${d.make}|${d.modelKey}`, d.modelDisplay);
  const nameOf = (photographerId) => {
    const pr = profiles.get(photographerId);
    return pr ? pr.name : 'Unknown photographer';
  };

  const cameras = new Map();
  for (const d of state.devices.values()) {
    const assocs = state.associationsForDevice(d.deviceId).filter(a => a.state);
    const active = assocs.filter(a => ACTIVE.has(a.state));
    let firstObs = null, lastObs = null;
    const historyById = new Map();
    for (const a of state.associationsForDevice(d.deviceId)) {
      for (const pv of a.provenance) {
        if (_OBSERVATION.has(pv.type)) { firstObs = _minIso(firstObs, pv.at); lastObs = _maxIso(lastObs, pv.at); }
        if (!historyById.has(pv.eventId)) historyById.set(pv.eventId, { pv, photographerIds: new Set() });
        historyById.get(pv.eventId).photographerIds.add(a.photographerId);
      }
    }
    const sug = suggestForCamera(state, { kind: 'body', deviceId: d.deviceId });
    const types = [...new Set(d.identifiers.filter(i => i.trusted).map(i => IDENTIFIER_LABEL[i.ns] || 'Other camera identifier'))].sort();
    cameras.set(d.deviceId, {
      deviceId: d.deviceId,
      make: d.make,
      model: d.modelDisplay,
      nickname: null,
      identified: true,
      identifierTypes: types,
      registeredDay: _day(d.firstSeenAt),
      firstObservedDay: _day(firstObs),
      lastObservedDay: _day(lastObs),
      shared: active.length > 1,
      conflict: state.conflictedDevices.has(d.deviceId),
      associations: assocs.map(a => ({
        photographerKey: a.photographerId,
        photographerId: a.photographerId,
        name: nameOf(a.photographerId),
        state: a.state,
        label: ASSOCIATION_LABEL[a.state],
        explanation: ASSOCIATION_EXPLANATION[a.state],
        unsettled: unsettled.has(`${a.deviceId}|${a.photographerId}`),
        confirmations: a.confirmations,
        observedImports: a.observedImports,
        observedDays: a.observedDays,
        chosenOverSuggestion: a.chosenOverSuggestion,
        correctedAway: a.correctedAway,
        lastConfirmedDay: _day(a.lastConfirmedAt),
        lastObservedDay: _day(_lastObservation(a)),
        lastActivityDay: _day(a.lastSeenAt),
      })).sort((x, y) => (ACTIVE.has(y.state) - ACTIVE.has(x.state)) || x.name.localeCompare(y.name)),
      suggestion: {
        level: sug.level,
        label: SUGGESTION_LABEL[sug.level] || sug.level,
        reasons: [...sug.reasons],
        candidates: sug.candidates.map(c => ({ photographerId: c.photographerId, name: nameOf(c.photographerId), state: c.state, reasons: [...c.reasons] })),
        excluded: (sug.excluded || []).map(x => ({ photographerId: x.photographerId, name: nameOf(x.photographerId), state: x.state, reason: x.reason })),
      },
      history: _cameraHistory(state, d, historyById, { nameOf, computerOf, operatorName: (id) => _operatorName(operators, id) }),
      review: [],
    });
    for (const a of assocs) {
      const pr = profiles.get(a.photographerId) || profile(a.photographerId, { photographerId: a.photographerId, identity: 'referenced', name: 'Unknown photographer', originalName: 'Unknown photographer' });
      pr.cameraCounts[a.state]++;
      if (active.length > 1 && ACTIVE.has(a.state)) pr.cameraCounts.shared++;
      const obsDay = _day(_lastObservation(a));
      pr.lastObservedDay = [pr.lastObservedDay, obsDay].filter(Boolean).sort().pop() || null;
      pr.cameras.push({
        deviceId: d.deviceId, make: d.make, model: d.modelDisplay, nickname: null,
        state: a.state, label: ASSOCIATION_LABEL[a.state],
        shared: active.length > 1 && ACTIVE.has(a.state),
        confirmations: a.confirmations, observedImports: a.observedImports, observedDays: a.observedDays,
        lastObservedDay: obsDay,
      });
    }
  }
  // Model-only usage: imports whose camera had no body identifier (model-observed). Q4's
  // modelUsage also counts identified bodies' models, so it is not used for this list.
  const modelOnly = new Map();
  for (const e of events) {
    if (e.type !== 'model-observed' || !validEvent(e)) continue;
    const pid = state.photographerCanonical(e.photographerId);
    const k = `${pid}|${e.make}|${e.modelKey}`;
    if (!modelOnly.has(k)) modelOnly.set(k, { pid, make: e.make, modelKey: e.modelKey, imports: new Set(), days: new Set(), last: null });
    const u = modelOnly.get(k);
    u.imports.add(e.importId); u.days.add(e.day); u.last = _maxIso(u.last, e.at);
  }
  for (const u of modelOnly.values()) {
    const pr = profiles.get(u.pid);
    if (!pr) continue;
    pr.modelsUsed.push({ make: u.make, model: modelDisplay.get(`${u.make}|${u.modelKey}`) || u.modelKey, imports: u.imports.size, days: u.days.size, lastObservedDay: _day(u.last) });
    pr.lastObservedDay = [pr.lastObservedDay, _day(u.last)].filter(Boolean).sort().pop() || null;
  }

  // ── Review items ──────────────────────────────────────────────────────────────
  const reviewItems = [];
  const cameraRef = (id) => { const c = cameras.get(state.deviceCanonical(id)); return c ? { deviceId: c.deviceId, make: c.make, model: c.model } : null; };
  const personRef = (id) => { const c = state.photographerCanonical(id); return { key: c, photographerId: c, name: nameOf(c) }; };
  const pushItem = (rawKey, kind, people, cams) => {
    const [title, explanation] = CONFLICT_TEXT[kind] || ['Needs review', 'This record needs review.'];
    const item = { key: reviewKeyOf(rawKey), kind, title, explanation, photographers: people, cameras: cams.filter(Boolean) };
    reviewItems.push(item);
    for (const p of people) { const pr = profiles.get(p.key); if (pr && !pr.review.includes(item.key)) pr.review.push(item.key); }
    for (const c of item.cameras) { const cm = cameras.get(c.deviceId); if (cm && !cm.review.includes(item.key)) cm.review.push(item.key); }
  };
  const unsettledConflicts = [...unsettled].sort().map((k) => {
    const [dId, pId] = k.split('|');
    return { kind: 'association-unsettled', key: `association-unsettled|${k}`, deviceId: dId, photographerId: pId };
  });
  for (const c of [...state.conflicts, ...unsettledConflicts]) {
    const people = [...(c.photographerIds || []), ...(c.photographerId ? [c.photographerId] : [])].map(personRef);
    const cams = [...(c.deviceIds || []), ...(c.deviceId ? [c.deviceId] : [])].map(cameraRef);
    pushItem(c.key, c.kind, people, cams);
  }
  for (const a of ambiguous) {
    pushItem(`ambiguous-name|${a.key}`, 'ambiguous-name', [{ key: a.key, photographerId: null, name: a.name }, ...a.ids.map(personRef)], []);
  }
  for (const s of staleRenames) pushItem(`stale-rename|${s.eventId}`, 'stale-rename', [personRef(s.id)], []);
  for (const [n, owners] of N.searchAliasOwners(registryAliases)) {
    if (owners.size > 1) pushItem(`shared-search-alias|${n}`, 'shared-search-alias', [...owners].sort().map(personRef), []);
  }
  if (usable && reg.heldCount > 0) pushItem('integrity-conflicts', 'integrity-conflicts', [], []);

  const photographersOut = [...profiles.values()]
    .map(pr => ({ ...pr, cameras: pr.cameras.sort((x, y) => x.make.localeCompare(y.make) || x.model.localeCompare(y.model)), modelsUsed: pr.modelsUsed.sort((x, y) => x.make.localeCompare(y.make) || x.model.localeCompare(y.model)) }))
    .sort(_byName);

  const keyStatus = usable ? (reg.keyStatus || 'not-loaded') : 'not-applicable';
  return {
    contractVersion: VIEW_CONTRACT_VERSION,
    status: {
      state: reg.state,
      reason: reg.reason || null,
      readOnly: true,
      learningEnabled: input.learning ? input.learning.enabled !== false : true,
      pendingLearning: input.learning && Number.isInteger(input.learning.pendingCount) ? input.learning.pendingCount : null,
      keyStatus,
      keyVerified: !!reg.keyVerified,
      bodyMatching: !usable ? 'not-applicable' : keyStatus === 'ready' ? 'available' : keyStatus === 'present-unverified' ? 'unknown' : 'unavailable',
      integrityConflicts: usable ? (reg.heldCount || 0) : 0,
      unknownEventTypes: usable ? (reg.unknownTypeEvents || 0) : 0,
    },
    // Later stages; reported, never simulated.
    capabilities: { rename: false, searchAliases: false, retire: false, cameraNicknames: false, associationDecisions: false, eventFolderRename: false },
    photographers: photographersOut,
    cameras: [...cameras.values()].sort((x, y) => x.make.localeCompare(y.make) || x.model.localeCompare(y.model) || (x.registeredDay || '').localeCompare(y.registeredDay || '')),
    reviewItems,
    counts: {
      photographers: photographersOut.length,
      withCameraHistory: photographersOut.filter(_hasCameraHistory).length,
      cameras: cameras.size,
      reviewItems: reviewItems.length,
    },
  };
}

function validEvent(e) { return e && typeof e === 'object' && e.origin && typeof e.at === 'string'; }

const _DECISION_KIND = { 'association-confirmed': 'confirmation', 'association-rejected': 'rejection', 'association-retired': 'retirement' };

/**
 * Camera history rows, oldest first. Each operator decision stays visible and is labelled by what it
 * did: a correction (a rejection/retirement and a confirmation recorded together for the same
 * camera) is one row; a decision that settled disagreeing decisions is a conflict resolution.
 */
function _cameraHistory(state, device, historyById, { nameOf, computerOf, operatorName }) {
  const byId = new Map(state.events.map(e => [e.eventId, e]));
  const entries = [...historyById.values()].map(h => ({ ...h, e: byId.get(h.pv.eventId) }));
  for (const e of state.events) {
    if (e.type === 'device-linked' && e.deviceIds.some(id => device.memberIds.includes(id))) entries.push({ pv: { eventId: e.eventId, type: e.type, at: e.at, computerId: e.origin.computerId, operatorId: e.origin.operatorId, workflow: e.origin.workflow }, photographerIds: new Set(), e });
  }
  entries.sort((x, y) => (x.pv.at < y.pv.at ? -1 : x.pv.at > y.pv.at ? 1 : x.pv.eventId < y.pv.eventId ? -1 : 1));
  const isDecision = (e) => !!(e && _DECISION_KIND[e.type]);
  const pairOf = (e) => entries.find(o => o.e !== e && isDecision(o.e) && o.e.at === e.at && o.e.origin.computerId === e.origin.computerId
    && o.e.origin.operatorId === e.origin.operatorId && o.e.origin.workflow === 'registry' && e.origin.workflow === 'registry'
    && (o.e.type === 'association-confirmed') !== (e.type === 'association-confirmed'));
  const settlesDisagreement = (e) => {
    const prior = e.resolves.map(id => byId.get(id)).filter(Boolean);
    const settledInside = new Set(prior.flatMap(x => x.resolves || []));
    return new Set(prior.filter(x => !settledInside.has(x.eventId)).map(x => x.type)).size > 1;
  };
  const rows = [];
  for (const { pv, photographerIds, e } of entries) {
    const names = [...photographerIds].map(nameOf).sort();
    let kind = _OBSERVATION.has(pv.type) ? 'observation' : _DECISION_KIND[pv.type] || (pv.type === 'device-linked' ? 'link' : 'other');
    let what = _historyText(pv.type, names);
    if (isDecision(e)) {
      const other = pairOf(e);
      if (other) {
        if (e.type === 'association-confirmed') continue; // shown once, on the row of the decision it replaced
        kind = 'correction';
        what = `Corrected: ${e.type === 'association-rejected' ? `marked as not ${nameOf(state.photographerCanonical(e.photographerId))}'s camera` : `marked as no longer used by ${nameOf(state.photographerCanonical(e.photographerId))}`} and confirmed for ${nameOf(state.photographerCanonical(other.e.photographerId))}`;
      } else if (settlesDisagreement(e)) {
        kind = 'resolution';
        what = `Review settled: ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
      }
    }
    rows.push({ day: _day(pv.at), kind, what, computer: computerOf(pv.computerId), operator: operatorName(pv.operatorId), workflow: WORKFLOW_LABEL[pv.workflow] || 'Other' });
  }
  return rows;
}

function _historyText(type, names) {
  const who = names.join(', ');
  switch (type) {
    case 'import-observed': return `Seen in an import by ${who} where it was the only camera`;
    case 'import-cooccurred': return `Seen in an import by ${who} together with other cameras`;
    case 'association-confirmed': return `Confirmed for ${who}`;
    case 'association-rejected': return `Marked as not ${who}'s camera`;
    case 'association-retired': return `Marked as no longer used by ${who}`;
    case 'suggestion-corrected': return 'The suggested photographer was changed by the operator';
    case 'device-linked': return 'Linked with another record of the same camera body (shared identifier)';
    default: return 'Recorded';
  }
}

const _hasCameraHistory = (p) => p.cameras.length > 0 || p.modelsUsed.length > 0;
const _byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key);

// ── Pure browsing ─────────────────────────────────────────────────────────────────

const FILTERS = {
  all: () => true,
  'with-cameras': _hasCameraHistory,
  'no-camera-history': (p) => !_hasCameraHistory(p),
  'needs-review': (p) => p.review.length > 0,
  retired: (p) => p.status === 'retired',
};
const SORTS = {
  name: _byName,
  'last-observed': (a, b) => (b.lastObservedDay || '').localeCompare(a.lastObservedDay || '') || _byName(a, b),
  'camera-count': (a, b) => (b.cameras.length - a.cameras.length) || _byName(a, b),
};

function _score(text, q, exact, prefix, contains) {
  const n = P.normalizeName(text);
  if (!n) return 0;
  if (n === q) return exact;
  if (n.startsWith(q)) return prefix;
  return n.includes(q) ? contains : 0;
}

function _matchPhotographer(p, q) {
  let best = { score: 0, matchedOn: null, matchedText: null };
  const consider = (text, on, s) => { if (s > best.score) best = { score: s, matchedOn: on, matchedText: text }; };
  consider(p.name, 'name', _score(p.name, q, 100, 80, 60));
  for (const f of p.formerNames) consider(f, 'former-name', _score(f, q, 95, 75, 55));
  for (const a of p.searchAliases) consider(a.text || a, 'search-alias', _score(a.text || a, q, 70, 50, 40));
  for (const s of p.learnedShortcuts) consider(s.text, 'learned-shortcut', _score(s.text, q, 65, 45, 35));
  for (const c of p.cameras) {
    for (const text of [`${c.make} ${c.model}`, c.model, c.nickname].filter(Boolean)) consider(text, 'camera', _score(text, q, 30, 30, 25));
  }
  return best;
}

/**
 * Search, filter and sort photographer profiles. Never selects one: several matches — and in
 * particular one shortcut or alias shared by several people — are all returned, with
 * `ambiguous: true` when the best match is a shortcut/alias that more than one profile has.
 * @returns {{ query: string, results: Array<{ key: string, name: string, matchedOn: string|null, matchedText: string|null }>, ambiguous: boolean, selected: null }}
 */
function searchPhotographers(view, query = '', { filter = 'all', sort = 'name' } = {}) {
  const f = FILTERS[filter] || FILTERS.all;
  const s = SORTS[sort] || SORTS.name;
  const q = P.normalizeName(query);
  const pool = view.photographers.filter(f);
  if (!q) return { query, results: [...pool].sort(s).map(p => ({ key: p.key, name: p.name, matchedOn: null, matchedText: null })), ambiguous: false, selected: null };
  const hits = pool.map(p => ({ p, m: _matchPhotographer(p, q) })).filter(x => x.m.score > 0);
  hits.sort((a, b) => (b.m.score - a.m.score) || s(a.p, b.p));
  const top = hits.length ? hits[0].m.score : 0;
  const topHits = hits.filter(h => h.m.score === top);
  const ambiguous = topHits.length > 1 && topHits.every(h => h.m.matchedOn === 'search-alias' || h.m.matchedOn === 'learned-shortcut');
  return {
    query,
    results: hits.map(({ p, m }) => ({ key: p.key, name: p.name, matchedOn: m.matchedOn, matchedText: m.matchedText })),
    ambiguous,
    selected: null,
  };
}

/** Cameras by make, model or nickname. */
function searchCameras(view, query = '') {
  const q = P.normalizeName(query);
  const list = view.cameras.filter(c => !q || [c.make, c.model, `${c.make} ${c.model}`, c.nickname].filter(Boolean).some(t => P.normalizeName(t).includes(q)));
  return list.map(c => ({ deviceId: c.deviceId, make: c.make, model: c.model, nickname: c.nickname }));
}

const _clone = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));

/** Detail for one photographer profile (by `key`), with its review items resolved. */
function getPhotographerDetail(view, key) {
  const p = view.photographers.find(x => x.key === key);
  if (!p) return null;
  return _clone({ ...p, reviewItems: view.reviewItems.filter(r => p.review.includes(r.key)) });
}

/** Detail for one camera (by deviceId), with its review items resolved. */
function getCameraDetail(view, deviceId) {
  const c = view.cameras.find(x => x.deviceId === deviceId);
  if (!c) return null;
  return _clone({ ...c, reviewItems: view.reviewItems.filter(r => c.review.includes(r.key)) });
}

module.exports = {
  VIEW_CONTRACT_VERSION, buildRegistryView, buildNameIndex, reviewKeyOf,
  searchPhotographers, searchCameras, getPhotographerDetail, getCameraDetail,
  FILTERS: Object.freeze(Object.keys(FILTERS)), SORTS: Object.freeze(Object.keys(SORTS)),
};
