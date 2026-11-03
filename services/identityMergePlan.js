/**
 * identityMergePlan.js — plans merging another computer's registry events into this one
 * (AI-FEAT-063 exchange rules, AI-RM-014 Q4a). Pure: no file is read or written here; Q7 owns
 * export files, preview UI and the transactional apply.
 *
 * Because the registry is an event set, a merge is a union by eventId:
 *  - additive and non-destructive: every local event survives; nothing is removed because
 *    the other computer lacks it;
 *  - order-independent and repeatable: merge(A, B) = merge(B, A), and merging B again adds nothing;
 *  - invalid incoming events are rejected individually and reported;
 *  - an eventId reused with different content is reported and the LOCAL event is kept (with
 *    no such collisions the merged set is identical whichever side is "local").
 * What a merge can NOT decide on its own — the same name under two IDs, an identifier shared
 * by two camera records, an association confirmed on one computer and rejected on another —
 * is surfaced as `newConflicts` for the operator. Nothing is linked, merged or overwritten.
 */

'use strict';

const { validateEvent, canonicalJson } = require('./identityEvents');
const { deriveRegistryState, normalizeEventSet } = require('./associationModel');

/**
 * @param {object[]} localEvents
 * @param {object[]} incomingEvents
 * @param {{ shipped?: object, localComputerId?: string }} [opts]
 */
function planMerge(localEvents, incomingEvents, opts = {}) {
  const local = normalizeEventSet(localEvents);
  const localById = new Map(local.events.map(e => [e.eventId, canonicalJson(e)]));

  const invalid = [], added = [], idCollisions = [];
  let alreadyPresent = 0;
  const seenIncoming = new Set();
  (Array.isArray(incomingEvents) ? incomingEvents : []).forEach((e, index) => {
    const res = validateEvent(e);
    if (!res.ok) { invalid.push({ index, eventId: e && typeof e.eventId === 'string' ? e.eventId : null, errors: res.errors }); return; }
    const json = canonicalJson(e);
    if (localById.has(e.eventId)) {
      if (localById.get(e.eventId) === json) alreadyPresent++;
      else idCollisions.push(e.eventId);
      return;
    }
    if (seenIncoming.has(e.eventId)) return; // duplicate inside the incoming set
    seenIncoming.add(e.eventId);
    added.push(e);
  });

  // Events claiming THIS computer as origin that this computer never wrote: a copied
  // settings folder (cloned computer ID) or a damaged file. Reported, still merged.
  const foreignWithLocalOrigin = opts.localComputerId
    ? added.filter(e => e.origin.computerId === opts.localComputerId).map(e => e.eventId)
    : [];

  // Local events are kept exactly; only genuinely new incoming events are added.
  const merged = normalizeEventSet([...local.events, ...added]).events;
  const before = deriveRegistryState(local.events, opts);
  const after = deriveRegistryState(merged, opts);
  const beforeKeys = new Set(before.conflicts.map(c => c.key));
  const newConflicts = after.conflicts.filter(c => !beforeKeys.has(c.key));

  return {
    summary: {
      localEvents: local.events.length,
      incomingEvents: Array.isArray(incomingEvents) ? incomingEvents.length : 0,
      added: added.length,
      alreadyPresent,
      invalid: invalid.length,
      idCollisions: idCollisions.length,
      mergedEvents: merged.length,
      newConflicts: newConflicts.length,
    },
    added, invalid, idCollisions: [...new Set(idCollisions)].sort(), foreignWithLocalOrigin,
    merged, newConflicts,
  };
}

module.exports = { planMerge };
