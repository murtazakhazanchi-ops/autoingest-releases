/**
 * photographerSuggestion.js — deterministic, explainable photographer suggestions from the
 * derived registry (AI-FEAT-063, AI-RM-014 Q4a). Pure. No model, no training, no automatic
 * choice: every result is a suggestion the operator confirms or changes.
 *
 * Levels for one camera:
 *   strong        identified body; exactly one active association and it is CONFIRMED,
 *                 not contradicted since, not disputed, device not in conflict.
 *                 The only level that may be offered preselected (still needs confirmation).
 *   likely        identified body; exactly one active association, OBSERVED (never confirmed)
 *                 in ≥ LIKELY_MIN_DAYS distinct import days, never corrected away.
 *                 Evidence stays "observed"; not preselected.
 *   possible      one active association with weaker evidence (fewer days, or a confirmation
 *                 contradicted since by a correction).
 *   alternatives  two or more active associations (shared camera): listed, none chosen.
 *   weak          model-only evidence: photographers who used this model. Never preselected.
 *   none          unknown camera, conflicting evidence, or no history.
 * Rejected and retired associations are never suggested; they are listed under `excluded`
 * with their reason. Disputed associations are listed, flagged, and never strong.
 * Q5e-1: photographers whose PROFILE is retired (opts.retired) are excluded the same way, with
 * their own reason; their associations and history are unchanged.
 */

'use strict';

const LIKELY_MIN_DAYS = 3;
const STATE_RANK = { confirmed: 0, observed: 1, disputed: 2 };
const ACTIVE = new Set(['confirmed', 'observed', 'disputed']);

const _times = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const _day = (iso) => (iso ? iso.slice(0, 10) : null);

function _candidate(state, a) {
  const p = state.photographers.get(a.photographerId);
  const reasons = [];
  if (a.state === 'confirmed') reasons.push(`Confirmed for this camera ${_times(a.confirmations, 'time')} (last ${_day(a.lastConfirmedAt)})`);
  if (a.state === 'disputed') reasons.push('Disputed: confirmed and rejected on different computers without seeing each other');
  if (a.observedImports) reasons.push(`Seen in ${_times(a.observedImports, 'import')} on ${_times(a.observedDays, 'day')} where it was the only camera — observed, not confirmed`);
  if (a.chosenOverSuggestion) reasons.push(`Chosen instead of a suggestion ${_times(a.chosenOverSuggestion, 'time')}`);
  if (a.correctedAway) reasons.push(`Suggested but changed by the operator ${_times(a.correctedAway, 'time')}`);
  return {
    photographerId: a.photographerId,
    name: p ? p.name : null,
    state: a.state,
    basis: a.state === 'confirmed' ? 'confirmed' : a.state === 'observed' ? 'observed' : 'disputed',
    confirmations: a.confirmations,
    observedImports: a.observedImports,
    observedDays: a.observedDays,
    correctedAway: a.correctedAway,
    lastSeenAt: a.lastSeenAt,
    reasons,
  };
}

function _order(a, b) {
  return STATE_RANK[a.state] - STATE_RANK[b.state] || b.confirmations - a.confirmations || b.observedDays - a.observedDays ||
    (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '') || a.photographerId.localeCompare(b.photographerId);
}

const _none = (reason, extra = {}) => ({ level: 'none', preselectable: false, candidates: [], excluded: [], reasons: [reason], ...extra });

function _forDevice(state, deviceId, retired) {
  const canon = state.deviceCanonical(deviceId);
  if (!state.devices.has(canon)) return _none('Camera not in the registry');
  const all = state.associationsForDevice(canon).filter(a => a.state);
  const excluded = all.filter(a => !ACTIVE.has(a.state)).map(a => ({ photographerId: a.photographerId, state: a.state, reason: a.state === 'rejected' ? 'Rejected by the operator for this camera' : 'Retired by the operator for this camera' }));
  for (const a of all.filter(x => ACTIVE.has(x.state) && retired.has(x.photographerId))) excluded.push({ photographerId: a.photographerId, state: a.state, reason: 'Photographer profile is retired' });
  const active = all.filter(a => ACTIVE.has(a.state) && !retired.has(a.photographerId)).map(a => _candidate(state, a)).sort(_order);
  const inConflict = state.conflictedDevices.has(canon);
  const reasons = inConflict ? ['This camera has conflicting identity records — review needed'] : [];
  if (!active.length) return { ..._none('No photographer history for this camera'), excluded, deviceConflict: inConflict };
  if (active.length > 1) return { level: 'alternatives', preselectable: false, candidates: active, excluded, reasons: ['Several photographers use this camera — choose one', ...reasons], deviceConflict: inConflict };

  const only = active[0];
  const a = state.associations.get(`${canon}|${only.photographerId}`);
  let level;
  if (only.state === 'confirmed' && a.correctedAwaySinceConfirm === 0 && !inConflict) level = 'strong';
  else if (only.state === 'observed' && a.observedDays >= LIKELY_MIN_DAYS && a.correctedAway === 0 && !inConflict) level = 'likely';
  else level = 'possible';
  return { level, preselectable: level === 'strong', candidates: [only], excluded, reasons, deviceConflict: inConflict };
}

function _forModel(state, make, modelKey, retired) {
  const usage = state.modelUsage.get(`${make}|${modelKey}`);
  const users = usage ? [...usage.values()].filter(u => !retired.has(u.photographerId)) : [];
  if (!users.length) return _none('No photographer history for this camera model');
  const candidates = users.map(u => ({
    photographerId: u.photographerId,
    name: state.photographers.get(u.photographerId)?.name || null,
    state: 'model-usage', basis: 'model',
    confirmations: 0, observedImports: u.imports.size, observedDays: u.days.size, correctedAway: 0, lastSeenAt: u.lastSeenAt,
    reasons: [`Has used this camera model (${_times(u.days.size, 'day')}) — the body is not identified, so this is only a possibility`],
  })).sort((a, b) => b.observedDays - a.observedDays || (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '') || a.photographerId.localeCompare(b.photographerId));
  return { level: 'weak', preselectable: false, candidates, excluded: [], reasons: ['Camera model only — no body identifier'] };
}

/**
 * @param {ReturnType<import('./associationModel').deriveRegistryState>} state
 * @param {{ kind: 'body', deviceId: string } | { kind: 'model', make: string, modelKey: string } | { kind: 'unknown' } | { kind: 'conflict' }} camera
 */
function suggestForCamera(state, camera, { retired = new Set() } = {}) {
  switch (camera && camera.kind) {
    case 'body': return _forDevice(state, camera.deviceId, retired);
    case 'model': return _forModel(state, camera.make, camera.modelKey, retired);
    case 'conflict': return _none('Conflicting camera information — cannot establish a photographer');
    default: return _none('Unknown camera — no camera-based suggestion');
  }
}

/**
 * Card / selection level. Several cameras pointing at different photographers → hand off to
 * the full workspace (DEC-029 decision 3); nothing is assigned automatically.
 */
function suggestForCameras(state, cameras, opts = {}) {
  const perCamera = cameras.map(c => ({ camera: c, suggestion: suggestForCamera(state, c, opts) }));
  const tops = new Set(perCamera.filter(x => ['strong', 'likely', 'possible'].includes(x.suggestion.level)).map(x => x.suggestion.candidates[0].photographerId));
  const anyAlternatives = perCamera.some(x => x.suggestion.level === 'alternatives');
  return {
    cameras: perCamera,
    distinctSuggestedPhotographers: tops.size,
    handoff: tops.size > 1 || (anyAlternatives && cameras.length > 1),
  };
}

module.exports = { suggestForCamera, suggestForCameras, LIKELY_MIN_DAYS };
