/**
 * photographerRegistryManager.js — main-process write path of the Photographer Registry tab
 * (AI-FEAT-063, AI-RM-014 Q5d): camera-association decisions and the identity conflicts Q4 can
 * settle safely. Electron-free; the store, operator and computer ID are injected.
 *
 * Two steps, both validated here and never trusted from the renderer:
 *  1. prepare(request) — the renderer names an action and opaque handles from the CURRENT browser
 *     snapshot. Handles are resolved to records here; the action is dry-run against the snapshot
 *     the operator is looking at; the preview text (what changes, what it means for future
 *     suggestions) is written here. Returns a single-use confirmation token (5 minutes).
 *  2. commit(token) — re-checks the active operator, the snapshot and the registry, then appends
 *     the planned events in ONE store.appendEventsChecked call: inside the write queue the scope
 *     revision is recomputed from the live registry and must equal the one the operator saw, so a
 *     changed camera, a concurrent decision or a second computer's merge is refused, never
 *     overwritten. Success is reported only after the registry file is durably written.
 * A token commits at most once: a repeated or concurrent commit of the same token returns the
 * first result (`duplicate: true`) and appends nothing.
 *
 * Every payload is rebuilt from allow-listed fields and passes assertRendererSafe (browser.internals.safe):
 * no photographer/camera/operator/computer ID, digest, key ID or path ever reaches the renderer.
 * Q5e-1 adds profile actions (photographerProfileActions: search aliases, retire/reactivate,
 * explicit first registration) on the same path, and renamePreview(), which is READ-ONLY: it
 * validates a proposed name and plans the current event's folders, and nothing can apply it.
 * Identity merges, renames and folder renames are not here.
 */

'use strict';

const crypto = require('crypto');
const C = require('./cameraAssociationCommands');
const { planCurrentEventFolderRename } = require('./photographerFolderRenamePlanner');

const TOKEN_RE = /^t-[0-9a-f]{24}$/;
const TOKEN_TTL_MS = 5 * 60000;
const MAX_TOKENS = 50;
const ASSOCIATION_ACTIONS = new Set(['confirm', 'reject', 'retire', 'correct', 'add-photographer', 'resolve']);
const IDENTITY_OPTIONS = { 'link-same': 'link-same-cameras', 'mark-different': 'mark-different-photographers' };
/** After these refusals the renderer gets a fresh snapshot to review before trying again. */
const REFRESH = new Set(['stale-view', 'registry-changed', 'expired-confirmation', 'not-available-for-state', 'already-associated', 'target-needs-review', 'no-matching-conflict', 'already-linked']);
const STATE_LABEL = { confirmed: 'Confirmed', observed: 'Observed', disputed: 'Needs review', rejected: 'Not this photographer', retired: 'No longer used' };
const OUTCOME_LABEL = { confirm: 'Confirmed', reject: 'Not this photographer', retire: 'No longer used' };
const CONSEQUENCE = {
  confirm: 'AutoIngest may suggest this photographer when this camera is imported. The operator still makes the final selection.',
  reject: 'AutoIngest will not suggest this photographer for this camera. Earlier imports and history are kept.',
  retire: 'AutoIngest will stop suggesting this photographer for this camera. Earlier imports and history are kept.',
};
const CAVEAT = 'A camera match suggests who usually uses a camera. It does not prove who took a particular photo.';

const _str = (s) => (typeof s === 'string' ? s : null);

/**
 * @param {{
 *   browser: ReturnType<import('./photographerRegistryBrowser').createRegistryBrowser>,
 *   getOperator: () => ({ id: string, name: string } | null),
 *   getComputerId: () => string|null,
 *   openStore: () => Promise<{ ok: true, store: object } | { ok: false, reason: string }>,
 *   profile?: ReturnType<import('./photographerProfileActions').createProfileActions>,
 *   getListNames?: () => string[],
 *   resolveCopies?: (eventPath: string) => Promise<object>,   // eventCopyResolver, read-only
 *   fs?: typeof import('fs').promises,                          // read-only folder planning
 *   now?: () => Date, randomBytes?: (n: number) => Buffer,
 * }} deps
 */
function createRegistryManager({ browser, getOperator, getComputerId, openStore, profile = null, getListNames = () => [], resolveCopies = null, fs: fsx = undefined, now = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
  if (!browser || !browser.internals) throw new Error('browser required');
  const I = browser.internals;
  const tokens = new Map(); // token → { gen, plan, revision, operatorId, expires, focusDeviceId, result, running }

  function _operator() {
    try {
      const op = getOperator();
      return op && typeof op.id === 'string' && op.id.trim() && typeof op.name === 'string' && op.name.trim() ? { id: op.id, name: op.name.trim() } : null;
    } catch { return null; }
  }

  /** Whether decisions can be recorded against a snapshot view (shown in the tab). */
  function availability(view) {
    const st = view && view.status ? view.status.state : 'unreadable';
    const op = _operator();
    let computer = null;
    try { computer = getComputerId(); } catch { computer = null; }
    // This computer's ID is saved shortly after the first launch of a new profile; decisions wait for it.
    const reason = st === 'missing' ? 'no-registry' : st === 'locked' ? 'registry-locked' : st !== 'ready' ? `registry-${st}`
      : !op ? 'no-operator' : typeof computer !== 'string' || !computer ? 'computer-not-ready' : null;
    return { available: !reason, reason, operatorName: op ? op.name : null };
  }

  function _prune() {
    const t = now().getTime();
    for (const [k, v] of tokens) if (v.expires < t && !v.running) tokens.delete(k);
    while (tokens.size > MAX_TOKENS) tokens.delete(tokens.keys().next().value);
  }

  const _refuse = (reason, details = {}) => I.safe({ ok: false, reason, ...details });
  // The snapshot may only know the key is present (not yet verified); commit re-checks the open store.
  const _bodyMatchingOf = (snap) => snap.view.status.bodyMatching === 'available' || snap.view.status.bodyMatching === 'unknown';

  /** Resolve a request against the current snapshot into a plan (IDs stay in this process). */
  function _resolve(snap, req) {
    const action = req.action;
    if (profile && profile.ACTIONS.has(action)) return profile.resolve(snap, req, I);
    if (ASSOCIATION_ACTIONS.has(action)) {
      const deviceId = I.cameraIdOf(req.camera);
      if (!deviceId) return { reason: 'stale-view' };
      const photographerId = req.photographer !== undefined && req.photographer !== null ? I.photographerKeyOf(req.photographer) : null;
      const targetPhotographerId = req.target !== undefined && req.target !== null ? I.photographerKeyOf(req.target) : null;
      if (req.photographer && !photographerId) return { reason: 'stale-view' };
      if (req.target && !targetPhotographerId) return { reason: 'stale-view' };
      return {
        kind: 'association', focusDeviceId: deviceId,
        args: { action, deviceId, photographerId, targetPhotographerId, priorOutcome: _str(req.priorOutcome), outcome: _str(req.outcome), shippedNames: snap.shippedNames },
      };
    }
    if (action === 'resolve-review') {
      const conflict = I.reviewOf(req.review);
      if (!conflict) return { reason: 'stale-view' };
      if (conflict.kind === 'photographer-status-disputed') return profile ? profile.resolveStatusReview(snap, conflict, req.outcome) : { reason: 'unsupported-action' };
      // Only an outcome this conflict actually supports, decided here — never the renderer's word.
      const allowed = C.conflictResolution(snap.state, conflict, { bodyMatching: _bodyMatchingOf(snap) });
      if (!allowed.supported) return { reason: allowed.note || 'unsupported-action' };
      if (!allowed.options.includes(req.outcome)) return { reason: 'unsupported-action' };
      if (conflict.kind === 'association-disputed' || conflict.kind === 'association-unsettled') {
        return { kind: 'association', focusDeviceId: conflict.deviceId, args: { action: 'resolve', deviceId: conflict.deviceId, photographerId: conflict.photographerId, outcome: _str(req.outcome), shippedNames: snap.shippedNames } };
      }
      const kind = IDENTITY_OPTIONS[req.outcome];
      if (!kind) return { reason: 'unsupported-action' };
      const ids = kind === 'link-same-cameras' ? conflict.deviceIds : conflict.photographerIds;
      return { kind: 'identity', focusDeviceId: kind === 'link-same-cameras' ? ids[0] : null, args: { kind, ids: Array.isArray(ids) ? [...ids] : [], shippedNames: snap.shippedNames } };
    }
    return { reason: 'unsupported-action' };
  }

  function _build(plan, events, extra) {
    if (plan.kind === 'profile') return profile.build(plan, events, extra);
    return plan.kind === 'association'
      ? C.planAssociationDecision(events, { ...plan.args, ...extra })
      : C.planIdentityResolution(events, { ...plan.args, ...extra });
  }

  function _people(snap, ids) {
    const v = snap.view;
    return ids.map((id) => {
      const p = v.photographers.find(x => x.key === id);
      return p ? p.name : 'Unknown photographer';
    });
  }

  function _camera(snap, deviceId) {
    const c = snap.view.cameras.find(x => x.deviceId === snap.state.deviceCanonical(deviceId));
    return c ? { make: c.make, model: c.model, nickname: _str(c.nickname) } : null;
  }

  /** Operator-facing preview, written here from the snapshot the operator is looking at. */
  function _preview(snap, plan, result) {
    if (plan.kind === 'profile' || plan.kind === 'register') return profile.preview(snap, plan, result);
    if (plan.kind === 'identity') {
      if (result.kind === 'link-same-cameras') {
        const cams = result.deviceIds.map(id => _camera(snap, id));
        return {
          title: 'Link these camera records as one camera?',
          camera: cams[0], rows: cams.map((c, i) => ({ label: `Record ${i + 1}`, current: c ? `${c.make} ${c.model}` : 'Camera', proposed: 'Same camera' })),
          consequences: ['Both records report the same reliable camera identifier, so they describe one camera body. Their photographer history is combined and the review item is settled.', 'Different camera bodies of the same model are never linked: they have different identifiers.'],
          caveat: CAVEAT,
        };
      }
      const names = _people(snap, result.photographerIds);
      return {
        title: 'Record that these are different people?',
        camera: null, rows: names.map((n, i) => ({ label: `Record ${i + 1}`, current: n, proposed: 'Separate person' })),
        consequences: ['Both photographer records stay separate, with their own names, cameras and history. The review item is settled.', 'Nothing is merged and no name or folder changes.'],
        caveat: null,
      };
    }
    const { action, outcomes, photographerIds, deviceId } = result;
    const names = _people(snap, photographerIds);
    const stateOf = (pid) => { const s = C.associationStatus(snap.state, deviceId, pid); return s.unsettled ? 'Needs review' : STATE_LABEL[s.state] || 'No association'; };
    const rows = photographerIds.map((pid, i) => ({ label: names[i], current: stateOf(pid), proposed: OUTCOME_LABEL[outcomes[i]] }));
    const titles = {
      confirm: 'Confirm that this camera is associated with this photographer?',
      reject: 'Mark this camera as not this photographer\'s?',
      retire: 'Mark this camera as no longer used by this photographer?',
      'add-photographer': 'Add another photographer to this camera?',
      resolve: 'Settle this review item?',
      correct: 'Correct this camera\'s photographer?',
    };
    const consequences = outcomes.map((o, i) => (photographerIds.length > 1 ? `${names[i]}: ${CONSEQUENCE[o]}` : CONSEQUENCE[o]));
    if (action === 'add-photographer' && C.activePhotographers(snap.state, deviceId).length) consequences.push('The photographers already associated with this camera stay associated. A shared camera can belong to several photographers.');
    if (action === 'correct') consequences.push(`The earlier decision for ${names[0]} stays in the camera's history.`);
    return { title: titles[action], camera: _camera(snap, deviceId), rows, consequences, caveat: CAVEAT };
  }

  function prepare(request) {
    _prune();
    const req = request && typeof request === 'object' ? request : {};
    const snap = I.snapshot();
    if (!snap || !snap.state) return _refuse('stale-view');
    const avail = availability(snap.view);
    if (!avail.available) return _refuse(avail.reason);
    const plan = _resolve(snap, req);
    if (plan.reason) return _refuse(plan.reason, Array.isArray(plan.blocking) ? { blocking: plan.blocking } : {});
    const op = _operator();
    // Profile plans carry the Q5b profile revision; registration needs none (it is idempotent).
    const revision = plan.kind === 'profile' ? plan.args.expectedRevision : plan.kind === 'register' ? null : C.revisionOf(snap.events, plan.args);
    const bodyMatching = _bodyMatchingOf(snap);
    const dry = plan.kind === 'register' ? { ok: true, result: { name: plan.args.name } }
      : _build(plan, snap.events, { expectedRevision: revision, bodyMatching, origin: { computerId: 'preview', operatorId: op.id, workflow: 'registry' }, at: now().toISOString() });
    if (!dry.ok) return _refuse(dry.reason, profile && plan.kind === 'profile' ? profile.refusalDetails(snap, dry) : {});
    const token = `t-${randomBytes(12).toString('hex')}`;
    tokens.set(token, { gen: snap.generation, plan, revision, bodyMatching, operatorId: op.id, expires: now().getTime() + TOKEN_TTL_MS, focusDeviceId: plan.focusDeviceId || null, focusPhotographerKey: plan.focusPhotographerKey || null, result: null, running: null });
    return I.safe({ ok: true, token, operator: op.name, preview: _preview(snap, plan, dry.result) });
  }

  function _message(snap, plan, result) {
    if (plan.kind === 'profile' || plan.kind === 'register') return profile.message(snap, plan, result);
    if (plan.kind === 'identity') return result.kind === 'link-same-cameras' ? 'Saved. The two camera records are now linked as one camera.' : 'Saved. The photographer records are recorded as different people.';
    const names = _people(snap, result.photographerIds);
    const cam = _camera(snap, result.deviceId);
    const camText = cam ? `${cam.make} ${cam.model}` : 'This camera';
    switch (result.action) {
      case 'confirm': case 'add-photographer': return `Saved. ${camText} is confirmed for ${names[0]}.`;
      case 'reject': return `Saved. ${camText} is marked as not ${names[0]}'s camera.`;
      case 'retire': return `Saved. ${camText} is marked as no longer used by ${names[0]}.`;
      case 'correct': return `Saved. ${camText} is now confirmed for ${names[1]} instead of ${names[0]}.`;
      default: return `Saved. The review item for ${camText} is settled.`;
    }
  }

  async function _withFreshView(payload, focusDeviceId, focusPhotographerKey = null) {
    await browser.load();
    const snap = I.snapshot();
    const camera = focusDeviceId && snap && snap.state ? I.cameraHandleOf(snap.state.deviceCanonical(focusDeviceId)) : null;
    const photographer = focusPhotographerKey && snap && snap.state ? I.photographerHandleOf(focusPhotographerKey) : null;
    return I.safe({ ...payload, focus: { camera, photographer }, overview: browser.overview() });
  }

  function _mapStoreReason(reason) {
    const r = String(reason || '');
    if (r === 'stale-revision') return 'registry-changed';
    if (/^write-failed:(EACCES|EPERM|EROFS)$/.test(r)) return 'registry-read-only';
    if (/^write-failed:ECHANGED$/.test(r) || /registry-changed-externally/.test(r)) return 'registry-changed';
    if (/^write-failed:/.test(r)) return 'write-failed';
    if (/^registry-/.test(r)) return 'registry-unavailable';
    return r || 'not-recorded';
  }

  async function _commit(entry) {
    const snapNow = I.snapshot();
    if (!snapNow || snapNow.generation !== entry.gen) return _withFreshView({ ok: false, reason: 'stale-view' }, entry.focusDeviceId, entry.focusPhotographerKey);
    const op = _operator();
    if (!op) return I.safe({ ok: false, reason: 'no-operator' });
    if (op.id !== entry.operatorId) return I.safe({ ok: false, reason: 'operator-changed' });
    const computerId = getComputerId();
    if (typeof computerId !== 'string' || !computerId) return I.safe({ ok: false, reason: 'computer-not-ready' });
    const opened = await openStore();
    if (!opened || !opened.ok) return I.safe({ ok: false, reason: opened && opened.reason ? opened.reason : 'registry-unavailable' });
    const store = opened.store;
    const bodyMatching = entry.bodyMatching && store.getStatus().bodyMatching === true;
    const origin = { computerId, operatorId: op.id, workflow: 'registry' };
    if (entry.plan.kind === 'register') return _commitRegister(entry, store, origin, snapNow);
    let res;
    try {
      res = await store.appendEventsChecked(events => _build(entry.plan, events, { expectedRevision: entry.revision, bodyMatching, origin, at: now().toISOString() }));
    } catch { res = { ok: false, reason: 'write-failed' }; }
    if (!res || !res.ok) {
      const reason = _mapStoreReason(res && res.reason);
      return REFRESH.has(reason) ? _withFreshView({ ok: false, reason }, entry.focusDeviceId, entry.focusPhotographerKey) : I.safe({ ok: false, reason });
    }
    const message = _message(snapNow, entry.plan, res.result);
    return _withFreshView({ ok: true, message }, entry.focusDeviceId, entry.focusPhotographerKey || (res.result && res.result.photographerId) || null);
  }

  /** First registry record through the store's own validated path (same as an import's first use). */
  async function _commitRegister(entry, store, origin, snapNow) {
    let res;
    try { res = await store.ensurePhotographerId(entry.plan.args.name, { listNames: getListNames(), shippedNames: snapNow.shippedNames, origin, at: now().toISOString() }); }
    catch { res = { ok: false, reason: 'write-failed' }; }
    if (!res || !res.ok) {
      const reason = res && res.reason === 'ambiguous' ? 'ambiguous-profile' : res && res.reason === 'not-in-photographer-list' ? 'not-in-photographer-list' : _mapStoreReason(res && res.reason);
      return _withFreshView({ ok: false, reason }, null, null);
    }
    return _withFreshView({ ok: true, message: _message(snapNow, entry.plan, res) }, null, res.photographerId);
  }

  // ── Rename preview (READ-ONLY; nothing here or anywhere can apply it) ────────
  const SCOPE_ROOT = '__eventRoot__';
  const COPY_LABEL = { 'local-staging': 'Local staging copy', nas: 'NAS copy' };

  function _folderPayload(plan, resolved) {
    const reasonOf = new Map(resolved.copies.map(c => [c.copyId, c.reason]));
    return {
      available: true,
      notes: [...resolved.notes],
      blockers: [...plan.blockers],
      warnings: [...plan.warnings],
      proposedCount: plan.proposedCount || 0,
      copies: plan.copies.map(cp => ({
        label: COPY_LABEL[cp.kind] || 'Copy',
        kind: cp.kind,
        state: cp.state,
        reason: reasonOf.get(cp.copyId) || null,
        scopes: cp.scopes.map(sc => ({
          scope: sc.scopeKey === SCOPE_ROOT ? null : String(sc.scopeKey),
          state: sc.state,
          multipleCandidates: !!sc.multipleCandidates,
          candidates: sc.candidates.map(x => ({
            folderName: x.folderName, sequencePrefix: x.sequencePrefix, match: x.match, proposedFolderName: x.proposedFolderName,
            proposed: !!x.proposed, caseOnly: !!x.caseOnly, unchanged: !!x.unchanged, blockers: [...x.blockers],
          })),
          excluded: (sc.excluded || []).map(x => ({ folderName: x.folderName, reason: x.reason })),
        })),
      })),
    };
  }

  /**
   * @param {{ photographer: string, name: string, eventPath?: string|null }} req
   * eventPath — Metadata Management's own current event (renderer context); never guessed here.
   */
  async function renamePreview(req) {
    const r = req && typeof req === 'object' ? req : {};
    const snap = I.snapshot();
    if (!snap || !snap.state || !profile) return _refuse('stale-view');
    const key = I.photographerKeyOf(r.photographer);
    if (!key) return _refuse('stale-view');
    const prof = snap.view.photographers.find(x => x.key === key);
    let folders = { available: false, reason: 'no-current-event' };
    const base = profile.renamePreview(snap, key, r.name, folders);
    if (!base.ok) return _refuse(base.reason);
    if (typeof r.eventPath === 'string' && r.eventPath && resolveCopies && prof && prof.photographerId) {
      const resolved = await resolveCopies(r.eventPath).catch(() => ({ ok: false, reason: 'event-unreadable' }));
      if (!resolved.ok) folders = { available: false, reason: resolved.reason };
      else if (!base.proposed.storedName || base.blocking.length) folders = { available: false, reason: 'name-not-valid' };
      else {
        const plan = await planCurrentEventFolderRename({ events: snap.events, shippedNames: snap.shippedNames, photographerId: prof.photographerId, newName: base.proposed.storedName, copies: resolved.copies.map(({ copyId, kind, root }) => ({ copyId, kind, root })), ...(fsx ? { fs: fsx } : {}) });
        folders = _folderPayload(plan, resolved);
      }
    }
    return I.safe({ ...base, folders });
  }

  function commit(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return Promise.resolve(_refuse('invalid-request'));
    const entry = tokens.get(token);
    if (!entry) return Promise.resolve(_refuse('expired-confirmation'));
    if (entry.result) return Promise.resolve({ ...entry.result, duplicate: true });
    if (entry.running) return entry.running.then(r => ({ ...r, duplicate: true }));
    if (entry.expires < now().getTime()) { tokens.delete(token); return Promise.resolve(_refuse('expired-confirmation')); }
    entry.running = _commit(entry).catch(() => I.safe({ ok: false, reason: 'write-failed' })).then((r) => {
      entry.running = null;
      // A recorded decision answers every repeat of this token; after a refusal nothing was
      // written, so the operator reviews and confirms again with a new token.
      if (r.ok) entry.result = r; else tokens.delete(token);
      return r;
    });
    return entry.running;
  }

  /** Cancel an unused confirmation (the operator pressed Cancel). */
  function cancel(token) {
    const entry = typeof token === 'string' ? tokens.get(token) : null;
    if (entry && !entry.result && !entry.running) tokens.delete(token);
    return { ok: true };
  }

  return { availability, prepare, commit, cancel, renamePreview, _forTests: { tokens } };
}

module.exports = { createRegistryManager, TOKEN_RE };
