'use strict';

/**
 * eventJsonStore.js — the only sanctioned way to read-modify-write event.json.
 *
 * Reading-then-merging-then-atomically-replacing event.json is not safe on its own:
 * two concurrent async writers (e.g. an event edit and a metadata-completion write)
 * can each read the same on-disk state, both correctly preserve unknown fields in
 * isolation, and the second writer still silently clobbers the first writer's change.
 * This module fixes that by serializing all writes to a given event.json path through
 * an in-process promise chain, so every write reads the truly-latest on-disk document.
 */

const fsp = require('fs/promises');
const path = require('path');

// One promise chain per event.json path — not a lock object, just a tail pointer.
const _chains = new Map();

/**
 * @param {string} eventJsonPath Absolute path to an event.json file.
 * @param {(doc: object) => (object|Promise<object>)} mutator Receives the freshly-read
 *   document and returns a *partial* object of only the fields to change. Must not
 *   return the whole document — anything the mutator omits is preserved untouched.
 * @returns {Promise<object>} The full document as written.
 */
function updateEventJsonAtomic(eventJsonPath, mutator) {
  const prior = _chains.get(eventJsonPath) || Promise.resolve();
  const next = prior
    .catch(() => {}) // a prior failure must not permanently jam this path's chain
    .then(() => _runUpdate(eventJsonPath, mutator));
  // Store the settled-or-not promise so the next caller waits on this one, but don't
  // let this call's own rejection propagate into the chain itself.
  _chains.set(eventJsonPath, next.catch(() => {}));
  return next;
}

async function _runUpdate(eventJsonPath, mutator) {
  const raw = await fsp.readFile(eventJsonPath, 'utf8');
  const doc = JSON.parse(raw);

  const partialChanges = await mutator(doc);
  if (!partialChanges || typeof partialChanges !== 'object' || Array.isArray(partialChanges)) {
    throw new Error(`updateEventJsonAtomic: mutator for ${path.basename(eventJsonPath)} must return a partial-update object`);
  }

  const updated = { ...doc, ...partialChanges };

  const tmp = eventJsonPath + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(updated, null, 2), 'utf8');
    try {
      await fsp.rename(tmp, eventJsonPath);
    } catch (renameErr) {
      if (renameErr.code !== 'EXDEV') throw renameErr;
      // Cross-device rename (e.g. NAS or iCloud drive on a different volume from
      // the tmp file) — fall back to copy+unlink, matching the app's other
      // event.json writers.
      await fsp.copyFile(tmp, eventJsonPath);
      await fsp.unlink(tmp).catch(() => {});
    }
  } catch (err) {
    try { await fsp.unlink(tmp); } catch {}
    throw err;
  }

  return updated;
}

module.exports = { updateEventJsonAtomic };
