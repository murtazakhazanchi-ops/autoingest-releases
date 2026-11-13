/**
 * companionPhotographerSuggestion.js — camera-based photographer suggestions for the menu-bar
 * companion's Event Dump (AI-FEAT-064 EQI-1.2). Pure: no Electron, no filesystem, no secure
 * storage.
 *
 * It only composes the existing Q3–Q5 pieces — nothing here is a second camera database or
 * learning system:
 *   Q3   cameraAssessmentModel.assessCameras  (the card's camera groups; computed by the
 *        companion's own card assessment)
 *   Q4   cameraDeviceIdentity.protectCameraGroups / matchCamera  (keyed digests → registry device)
 *   Q4/5 photographerSuggestion.suggestForCameras  (confirmed / observed / shared-camera levels,
 *        rejected, retired and disputed handling)
 *   Q5e  photographerNameModel.retiredIds / officialNamesOf  (retired profiles, official names)
 *
 * Statuses for the popup (never a selection — the operator always confirms):
 *   confirmed  one photographer, and the camera association is CONFIRMED (suggestion level strong)
 *   observed   one photographer seen with this camera before, never confirmed (likely / possible)
 *   multiple   several photographers (a shared camera, or several cameras on the card)
 *   unknown    nothing asserted: unrecognised camera, model-only evidence, conflicting evidence,
 *              registry not (yet) open, or no usable key — `reason` says which
 * Model-only evidence never names a photographer here (the registry's "weak" level is not shown).
 * Candidate names are mapped to the app's photographer list; a registry name that is not on the
 * list is not offered (the companion can only select listed names).
 */

'use strict';

const { protectCameraGroups, matchCamera } = require('./cameraDeviceIdentity');
const { suggestForCameras } = require('./photographerSuggestion');
const { officialNamesOf } = require('./photographerNameModel');
const P = require('./photographerIdentity');

const MAX_CANDIDATES = 5;

const _unknown = (reason) => ({ status: 'unknown', reason, candidates: [] });

/** The photographer-list entry for a registry identity (current official name first). */
function _listName(state, shipped, photographerId, listIndex) {
  const names = officialNamesOf(state, shipped, photographerId);
  for (const n of [names.current, ...names.former]) {
    const hit = n && listIndex.get(P.normalizeName(n));
    if (hit) return hit;
  }
  return null;
}

/**
 * @param {{
 *   records: object[]|null,                          // the card's Q3 records (main process only)
 *   assessed: {groups: object[], unknown: number[], conflicts: number[], identities: object[]}|null,
 *   registry: { ok: true, keyring: object|null, keyReason?: string|null, state: object, retired: Set<string>, shipped: object }
 *           | { ok: false, reason: string },
 *   listNames: string[],                             // the app's photographer list
 * }} input
 * @returns {{ status: 'confirmed'|'observed'|'multiple'|'unknown', reason: string|null,
 *             candidates: Array<{ name: string, basis: 'confirmed'|'observed'|'disputed' }> }}
 */
function suggestForCard({ records, assessed, registry, listNames }) {
  if (!assessed || !Array.isArray(assessed.groups) || !assessed.groups.length) return _unknown('no-camera-evidence');
  if (!registry || !registry.ok) return _unknown((registry && registry.reason) || 'registry-not-open');
  if (!registry.keyring) return _unknown(registry.keyReason || 'body-matching-unavailable');

  const { state, retired, shipped } = registry;
  const protectedCard = protectCameraGroups(records, assessed, registry.keyring);
  const cameras = [];
  let conflict = false, modelOnly = 0;
  for (const c of protectedCard.cameras) {
    if (c.kind !== 'body') { modelOnly++; continue; }   // model-only evidence never names anyone
    const m = matchCamera(c, state);
    if (m.status === 'known') cameras.push({ kind: 'body', deviceId: m.deviceId });
    else if (m.status === 'conflict') conflict = true;
  }
  if (!cameras.length) return _unknown(conflict ? 'camera-conflict' : modelOnly && !protectedCard.cameras.some(c => c.kind === 'body') ? 'model-only' : 'camera-not-recognised');

  const result = suggestForCameras(state, cameras, { retired });
  const listIndex = new Map((Array.isArray(listNames) ? listNames : []).filter(n => typeof n === 'string' && n.trim()).map(n => [P.normalizeName(n), n]));
  const offered = new Map();   // list name → strongest basis seen
  const RANK = { confirmed: 0, observed: 1, disputed: 2 };
  let anyStrong = false, levels = new Set();
  for (const { suggestion: s } of result.cameras) {
    levels.add(s.level);
    if (!['strong', 'likely', 'possible', 'alternatives'].includes(s.level)) continue;
    if (s.level === 'strong') anyStrong = true;
    for (const c of s.candidates) {
      const name = _listName(state, shipped, c.photographerId, listIndex);
      if (!name) continue;
      const basis = c.basis === 'confirmed' ? 'confirmed' : c.basis === 'disputed' ? 'disputed' : 'observed';
      if (!offered.has(name) || RANK[basis] < RANK[offered.get(name)]) offered.set(name, basis);
    }
  }
  if (!offered.size) {
    const any = [...levels].some(l => ['strong', 'likely', 'possible', 'alternatives'].includes(l));
    return _unknown(any ? 'photographer-not-in-list' : conflict ? 'camera-conflict' : 'no-history-for-camera');
  }
  const candidates = [...offered].map(([name, basis]) => ({ name, basis }))
    .sort((a, b) => RANK[a.basis] - RANK[b.basis] || a.name.localeCompare(b.name)).slice(0, MAX_CANDIDATES);
  if (candidates.length > 1 || result.handoff || levels.has('alternatives')) return { status: 'multiple', reason: null, candidates };
  const only = candidates[0];
  return { status: anyStrong && only.basis === 'confirmed' ? 'confirmed' : 'observed', reason: null, candidates };
}

module.exports = { suggestForCard, MAX_CANDIDATES };
