/**
 * photographerRegistryBrowser.js — main-process, read-only session behind the Photographer
 * Registry tab (AI-FEAT-063, AI-RM-014 Q5c). Electron-free: the view loader is injected.
 *
 * It holds ONE snapshot of the Q5a view (photographerRegistryView.buildRegistryView, produced
 * by photographerLearningRuntime.inspectRegistry — never by the write path) and answers the
 * renderer from it. Nothing here writes, creates or decrypts anything.
 *
 * Renderer payloads are rebuilt field by field (allow-lists, never spreads of view objects):
 *  - photographer IDs, device IDs and name-keys are replaced by opaque per-snapshot handles
 *    ("p-…", "c-…"), so no permanent identity ID reaches the renderer;
 *  - the view itself already excludes identifier values/digests, key IDs, computer IDs, import
 *    IDs and paths; assertRendererSafe() re-checks every outgoing payload for UUID-shaped,
 *    digest-shaped and path-shaped strings and replaces a failing payload with an error.
 * Handles are only valid for the snapshot that issued them; a stale or unknown handle returns
 * { ok:false, reason:'unknown-record' } and is never resolved by name.
 *
 * Q5d: when the loader also returns the snapshot's events, payloads carry the association actions
 * and review resolutions the main process allows (cameraAssociationCommands) — the renderer never
 * decides them. The events stay here; registryManager uses `internals` to resolve handles.
 */

'use strict';

const crypto = require('crypto');
const V = require('./photographerRegistryView');
const C = require('./cameraAssociationCommands');
const { deriveRegistryState } = require('./associationModel');
const { bootstrapShippedIds } = require('./photographerIdentity');

const HANDLE_RE = /^[pc]-[0-9a-f]{16}$/;
const MAX_QUERY = 120;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HEX_DIGEST_RE = /\b[0-9a-f]{32,}\b/i;
const PATH_RE = /(^|[\s"'])(\/(Users|Volumes|private|tmp|var|home)\/|[A-Za-z]:\\|\\\\[^\\\s]+\\)/;
const FORBIDDEN_KEYS = new Set(['photographerId', 'deviceId', 'key', 'photographerKey', 'importId', 'computerId', 'operatorId', 'keyId', 'digest', 'identifiers', 'serial', 'path', 'eventId']);

const OPTION_LABEL = {
  confirm: 'Confirm association', reject: 'Not this photographer', retire: 'No longer associated',
  'link-same': 'Same camera — link the records', 'mark-different': 'Different people — keep separate',
};
const NAMING_LATER = 'Settling this changes photographer names, which is not available yet.';
const RESOLUTION_NOTE = {
  'more-than-two-records': 'More than two camera records share an identifier. This cannot be settled here yet.',
  'models-differ': 'The records report different camera models, so they are not linked.',
  'no-shared-identifier': 'The records do not share a reliable camera identifier, so they are not linked.',
  'key-unavailable': 'Camera-body matching is unavailable on this computer, so camera records cannot be linked here.',
  'link-disputed': 'These records were linked and unlinked on different computers. Settling that is not available yet.',
  'ambiguous-name': NAMING_LATER, 'stale-rename': NAMING_LATER, 'conflicting-renames': NAMING_LATER, 'shared-search-alias': NAMING_LATER,
  'photographer-link-disputed': 'Deciding whether two records are the same person affects names and folders, which is not available yet.',
  'device-link-disputed': 'Changing a camera link is not available yet.',
  'linked-device-model-mismatch': 'Changing a camera link is not available yet.',
  'event-id-collision': 'Damaged or conflicting registry records are kept aside. Repairing them is not available here.',
  'integrity-conflicts': 'Damaged or conflicting registry records are kept aside. Repairing them is not available here.',
};
const SUPPORTED_NOTE = {
  'same-name-different-ids': 'Merging the two records into one person is not available here.',
};

const STATUS_FIELDS = ['state', 'reason', 'readOnly', 'learningEnabled', 'pendingLearning', 'keyStatus', 'bodyMatching', 'integrityConflicts', 'unknownEventTypes'];

/** Throws if a payload carries identity material or paths. Exported for tests. */
function assertRendererSafe(payload) {
  const walk = (v, where) => {
    if (typeof v === 'string') {
      if (UUID_RE.test(v)) throw new Error(`renderer payload carries an ID-shaped value at ${where}`);
      if (HEX_DIGEST_RE.test(v)) throw new Error(`renderer payload carries a digest-shaped value at ${where}`);
      if (PATH_RE.test(v)) throw new Error(`renderer payload carries a path at ${where}`);
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${where}[${i}]`)); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (FORBIDDEN_KEYS.has(k)) throw new Error(`renderer payload carries forbidden field ${where}.${k}`);
        walk(x, `${where}.${k}`);
      }
    }
  };
  walk(payload, '$');
  return payload;
}

const _str = (s) => (typeof s === 'string' ? s : null);
const _num = (n) => (Number.isFinite(n) ? n : 0);

/**
 * @param {{ loadView: () => Promise<object>, secret?: Buffer, manageStatus?: (view: object) => { available: boolean, reason: string|null, operatorName: string|null } }} deps
 *   loadView — returns a photographerRegistryView contract object (read-only accessor), or
 *     { view, events, shippedNames } so association actions can be offered (Q5d)
 *   manageStatus — whether decisions can be recorded now (registry writable, active operator)
 */
function createRegistryBrowser({ loadView, secret = crypto.randomBytes(32), manageStatus = null } = {}) {
  if (typeof loadView !== 'function') throw new Error('loadView required');
  let snap = null;      // { view, events, state, generation, pByHandle, cByHandle, handleOfP, handleOfC, reviewByKey }
  let generation = 0;
  let loading = null;

  const _handle = (prefix, gen, raw) => `${prefix}-${crypto.createHmac('sha256', secret).update(`${gen}|${raw}`).digest('hex').slice(0, 16)}`;

  function _index(view, events, shippedNames) {
    const gen = ++generation;
    const pByHandle = new Map(), cByHandle = new Map(), handleOfP = new Map(), handleOfC = new Map();
    for (const p of view.photographers) {
      const h = _handle('p', gen, p.key);
      pByHandle.set(h, p.key); handleOfP.set(p.key, h);
    }
    for (const c of view.cameras) {
      const h = _handle('c', gen, c.deviceId);
      cByHandle.set(h, c.deviceId); handleOfC.set(c.deviceId, h);
    }
    let state = null;
    const reviewByKey = new Map();
    if (Array.isArray(events)) {
      state = deriveRegistryState(events, { shipped: bootstrapShippedIds(shippedNames || []) });
      for (const c of state.conflicts) reviewByKey.set(V.reviewKeyOf(c.key), c);
      for (const k of C.unsettledPairs(state)) {
        const [deviceId, photographerId] = k.split('|');
        reviewByKey.set(V.reviewKeyOf(`association-unsettled|${k}`), { kind: 'association-unsettled', deviceId, photographerId });
      }
    }
    return { view, events: Array.isArray(events) ? events : null, shippedNames: shippedNames || [], state, generation: gen, pByHandle, cByHandle, handleOfP, handleOfC, reviewByKey, manage: null };
  }

  const _manage = () => (snap && snap.manage ? snap.manage : { available: false, reason: 'read-only' });
  const _canManage = () => !!(snap && snap.state && _manage().available);
  // 'unknown' = key present but not yet verified by an open store; the commit verifies it.
  const _bodyMatching = () => !!(snap && (snap.view.status.bodyMatching === 'available' || snap.view.status.bodyMatching === 'unknown'));

  function _resolution(r) {
    const c = snap.reviewByKey.get(r.key);
    if (!c || !snap.state) return { supported: false, options: [], note: RESOLUTION_NOTE[r.kind] || null };
    const res = C.conflictResolution(snap.state, c, { bodyMatching: _bodyMatching() });
    return {
      supported: res.supported && _canManage(),
      options: res.supported ? res.options.map(o => ({ id: o, label: OPTION_LABEL[o] })) : [],
      note: res.supported ? (SUPPORTED_NOTE[c.kind] || null) : (RESOLUTION_NOTE[res.note] || RESOLUTION_NOTE[c.kind] || null),
    };
  }

  const pH = (key) => (snap && key != null ? snap.handleOfP.get(key) || null : null);
  const cH = (id) => (snap && id != null ? snap.handleOfC.get(id) || null : null);

  function _status(view) {
    const out = {};
    for (const f of STATUS_FIELDS) out[f] = view.status[f] === undefined ? null : view.status[f];
    return out;
  }

  function _row(p) {
    return {
      handle: pH(p.key), name: p.name, identity: p.identity, status: p.status, inList: !!p.inList,
      cameraCount: p.cameras.length, modelOnlyCount: p.modelsUsed.length,
      assignable: !!p.photographerId && p.identity !== 'ambiguous',
      needsReview: p.review.length > 0, reviewCount: p.review.length, lastObservedDay: _str(p.lastObservedDay),
    };
  }

  function _personRef(r) {
    const prof = r.key ? snap.view.photographers.find(p => p.key === r.key) : null;
    return { handle: r.key ? pH(r.key) : null, name: _str(r.name) || 'Unknown photographer', identity: prof ? prof.identity : null };
  }

  function _reviewItem(r) {
    return {
      id: r.key, kind: r.kind, title: r.title, explanation: r.explanation,
      photographers: r.photographers.map(_personRef),
      cameras: r.cameras.map(c => ({ handle: cH(c.deviceId), make: c.make, model: c.model })),
      resolution: _resolution(r),
    };
  }

  function _cameraRow(c) {
    return {
      handle: cH(c.deviceId), make: c.make, model: c.model, nickname: _str(c.nickname),
      shared: !!c.shared, needsReview: c.review.length > 0 || !!c.conflict,
      photographerCount: c.associations.filter(a => ['confirmed', 'observed', 'disputed'].includes(a.state)).length,
      lastObservedDay: _str(c.lastObservedDay),
    };
  }

  function _safe(payload) {
    try { return assertRendererSafe(payload); }
    catch { return { ok: false, reason: 'unsafe-payload' }; }
  }

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const loaded = await loadView();
        const view = loaded && loaded.view ? loaded.view : loaded;
        if (!view || !Array.isArray(view.photographers)) throw new Error('bad view');
        snap = loaded && loaded.view ? _index(view, loaded.events, loaded.shippedNames) : _index(view);
        if (manageStatus && snap.state) {
          try { snap.manage = manageStatus(view); } catch { snap.manage = { available: false, reason: 'unavailable', operatorName: null }; }
        }
      } catch {
        snap = null;
      }
      return overview();
    })();
    try { return await loading; } finally { loading = null; }
  }

  function overview() {
    if (!snap) return _safe({ ok: false, reason: 'unavailable', status: { state: 'unreadable', reason: 'inspection-failed', readOnly: true } });
    const v = snap.view;
    return _safe({
      ok: true,
      contractVersion: v.contractVersion,
      status: _status(v),
      capabilities: { ...v.capabilities, associationDecisions: _canManage() },
      management: { available: _canManage(), reason: _canManage() ? null : _str(_manage().reason), operatorName: _str(_manage().operatorName) },
      counts: { ...v.counts },
      cameras: v.cameras.map(_cameraRow),
      reviewItems: v.reviewItems.map(_reviewItem),
    });
  }

  function search({ query = '', filter = 'all', sort = 'name' } = {}) {
    if (!snap) return _safe({ ok: false, reason: 'unavailable' });
    const q = typeof query === 'string' ? query.slice(0, MAX_QUERY) : '';
    const f = V.FILTERS.includes(filter) ? filter : 'all';
    const s = V.SORTS.includes(sort) ? sort : 'name';
    const res = V.searchPhotographers(snap.view, q, { filter: f, sort: s });
    const byKey = new Map(snap.view.photographers.map(p => [p.key, p]));
    return _safe({
      ok: true, filter: f, sort: s, ambiguous: !!res.ambiguous,
      results: res.results.map(r => ({ ..._row(byKey.get(r.key)), matchedOn: r.matchedOn, matchedText: r.matchedOn && r.matchedOn !== 'name' ? r.matchedText : null })),
    });
  }

  function photographer(handle) {
    if (!snap || typeof handle !== 'string' || !HANDLE_RE.test(handle) || !snap.pByHandle.has(handle)) return { ok: false, reason: 'unknown-record' };
    const d = V.getPhotographerDetail(snap.view, snap.pByHandle.get(handle));
    if (!d) return { ok: false, reason: 'unknown-record' };
    return _safe({
      ok: true,
      profile: {
        ..._row(snap.view.photographers.find(p => p.key === d.key)),
        originalName: d.originalName, formerNames: [...d.formerNames], listNames: [...d.listNames],
        nameHistory: d.nameHistory.map(h => ({ day: _str(h.day), fromName: h.fromName, toName: h.toName, stale: !!h.stale, operator: h.operator, computer: h.computer })),
        searchAliases: d.searchAliases.map(a => ({ text: a.text, kind: a.kind, addedDay: _str(a.addedDay) })),
        learnedShortcuts: d.learnedShortcuts.map(s => ({ text: s.text, learnedFor: s.learnedFor })),
        cameras: d.cameras.map(c => ({
          handle: cH(c.deviceId), make: c.make, model: c.model, nickname: _str(c.nickname), state: c.state, label: c.label,
          shared: !!c.shared, confirmations: _num(c.confirmations), observedImports: _num(c.observedImports), lastObservedDay: _str(c.lastObservedDay),
        })),
        modelsUsed: d.modelsUsed.map(m => ({ make: m.make, model: m.model, imports: _num(m.imports), days: _num(m.days), lastObservedDay: _str(m.lastObservedDay) })),
        cameraCounts: { ...d.cameraCounts },
      },
      reviewItems: d.reviewItems.map(_reviewItem),
    });
  }

  function camera(handle) {
    if (!snap || typeof handle !== 'string' || !HANDLE_RE.test(handle) || !snap.cByHandle.has(handle)) return { ok: false, reason: 'unknown-record' };
    const d = V.getCameraDetail(snap.view, snap.cByHandle.get(handle));
    if (!d) return { ok: false, reason: 'unknown-record' };
    return _safe({
      ok: true,
      camera: {
        ..._cameraRow(snap.view.cameras.find(c => c.deviceId === d.deviceId)),
        identified: !!d.identified, identifierTypes: [...d.identifierTypes],
        registeredDay: _str(d.registeredDay), firstObservedDay: _str(d.firstObservedDay), conflict: !!d.conflict,
        actions: _canManage() ? ['add-photographer'] : [],
        associations: d.associations.map(a => ({
          photographer: { handle: pH(a.photographerKey), name: a.name }, state: a.state, label: a.label, explanation: a.explanation,
          unsettled: !!a.unsettled,
          actions: _canManage() && pH(a.photographerKey) ? C.associationActions(snap.state, d.deviceId, a.photographerKey) : [],
          confirmations: _num(a.confirmations), observedImports: _num(a.observedImports), observedDays: _num(a.observedDays),
          lastConfirmedDay: _str(a.lastConfirmedDay), lastObservedDay: _str(a.lastObservedDay),
        })),
        suggestion: {
          level: d.suggestion.level, label: d.suggestion.label, reasons: [...d.suggestion.reasons],
          candidates: d.suggestion.candidates.map(c => ({ photographer: { handle: pH(c.photographerId), name: c.name }, state: c.state, reasons: [...c.reasons] })),
        },
        history: d.history.map(h => ({ day: _str(h.day), kind: _str(h.kind), what: h.what, computer: h.computer, operator: h.operator, workflow: h.workflow })),
      },
      reviewItems: d.reviewItems.map(_reviewItem),
    });
  }

  /** Main process only (registryManager) — never exposed over IPC. */
  const internals = Object.freeze({
    snapshot: () => snap,
    cameraIdOf: (h) => (snap && typeof h === 'string' && HANDLE_RE.test(h) ? snap.cByHandle.get(h) || null : null),
    photographerKeyOf: (h) => (snap && typeof h === 'string' && HANDLE_RE.test(h) ? snap.pByHandle.get(h) || null : null),
    reviewOf: (id) => (snap && typeof id === 'string' && /^r-[0-9a-f]{16}$/.test(id) ? snap.reviewByKey.get(id) || null : null),
    cameraHandleOf: (deviceId) => cH(deviceId),
    safe: _safe,
  });

  return { load, overview, search, photographer, camera, internals, _forTests: { snapshot: () => snap } };
}

module.exports = { createRegistryBrowser, assertRendererSafe, HANDLE_RE };
