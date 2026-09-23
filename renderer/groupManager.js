// renderer/groupManager.js
// ── GroupManager — module singleton ─────────────────────────────────────────
// Manages temporary file-to-group assignments for the import grouping workflow.
//
// Per-event isolation: createGroupManager() builds an independent instance. The
// exported `GroupManager` is a thin facade bound to ONE instance at a time (the
// Current Event's — see importSession.js). Group ids are positional (1..N) and
// only meaningful inside one event, so every participating event owns its own
// instance; group/component state can never leak across events because no two
// events ever share one. Unbound, the facade behaves exactly like the original
// singleton (one implicit instance).
//
// reset() clears the bound instance only. Session-level teardown (source change,
// eject, …) is ImportSession.reset()'s job.
//
// Group shape:
//   { uid: string,              ← STABLE logical identity — assigned once at creation,
//                                  never reused within a session, never changes for the
//                                  life of the group (survives removeGroup() renumbering
//                                  every OTHER group's `id`). This is what TagRefinementManager
//                                  keys its per-group override state by — see uid note below.
//     id: number, label: string, ← MUTABLE display/order identity. Renumbered sequentially
//                                  from 1 whenever a group is removed, purely for "G1"/"G2"/…
//                                  labels and panel ordering. Never use `id` as a durable key.
//     files: Set<string>,        ← file paths (unique identifiers in this app)
//     subEventId: string | null  ← id from EventCreator.getSubEventNames()
//   }
//
// Why a separate uid: removeGroup() renumbers surviving groups' `id`s to keep them
// sequential (G1/G2/G3 after removing the old G2). A consumer that keyed state by `id`
// (TagRefinementManager did, historically — see Follow-up B) would silently have a
// survivor's state orphaned under its old numeric key and picked up a stranger's state
// under its new one. `uid` never changes and is never reused, so keying by it is safe
// across any amount of removal/renumbering churn.
'use strict';

// 10 pastel group colours keyed by --group-N CSS custom properties.
// Index is stable while a group exists; colour is derived at render time from
// the group's position in _groups, so no drift after deletions.
const GROUP_COLORS = [
  'var(--group-1)',
  'var(--group-2)',
  'var(--group-3)',
  'var(--group-4)',
  'var(--group-5)',
  'var(--group-6)',
  'var(--group-7)',
  'var(--group-8)',
  'var(--group-9)',
  'var(--group-10)',
];

/**
 * @param {{ onClaim?: (paths: string[]) => void }} [hooks]
 *   onClaim — invoked at the top of assignFiles(), before any mutation, with the
 *   paths about to be owned by this instance. ImportSession uses it to enforce
 *   file→event exclusivity at the model level (release from every other event).
 */
function createGroupManager(hooks = {}) {

  let _groups       = [];          // Group[]
  let _fileGroupMap = new Map();   // filePath → groupId
  let _activeTabId  = null;

  // Monotonic source for `uid`. Session-local (resets with the rest of GroupManager's
  // state in reset() — every caller resets TagRefinementManager in lockstep, so there is
  // never live refinement state that could collide with a post-reset counter restart).
  // Never depends on _groups.length, so a deleted group's uid is never reissued even if
  // the live group count returns to the same number.
  let _uidCounter = 0;
  function _nextUid() { return `group-${++_uidCounter}`; }

  // Subscribers notified with a removed group's stable `uid`, once per actual removal —
  // the single lifecycle hook other modules (TagRefinementManager) hang cleanup off of,
  // instead of every UI call site remembering to clear state manually. Fires for EVERY
  // removal route (explicit Remove button, and auto-removal of an emptied source group
  // from assignFiles/unassignFiles), because they all funnel through removeGroup().
  let _removalListeners = [];
  function onGroupRemoved(cb) { _removalListeners.push(cb); }
  function _notifyRemoved(uid) { for (const cb of _removalListeners) cb(uid); }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  function createGroup() {
    const id = _groups.length + 1;
    const uid = _nextUid();
    _groups.push({ uid, id, label: `G${id}`, files: new Set(), subEventId: null, metadataTags: null });
    _activeTabId = id;
    return id;
  }

  function removeGroup(id) {
    const g = _groups.find(x => x.id === id);
    if (!g) return;
    for (const p of g.files) _fileGroupMap.delete(p);
    _groups = _groups.filter(x => x.id !== id);

    // Renumber remaining groups' DISPLAY id/label sequentially from 1. `uid` is never
    // touched here — it is the whole point of the field.
    _groups.forEach((group, idx) => {
      const newId = idx + 1;
      if (group.id !== newId) {
        for (const p of group.files) _fileGroupMap.set(p, newId);
        if (_activeTabId === group.id) _activeTabId = newId;
        group.id    = newId;
        group.label = `G${newId}`;
      }
    });

    if (_activeTabId === id)
      _activeTabId = _groups.length ? _groups[_groups.length - 1].id : null;

    _notifyRemoved(g.uid);
  }

  function assignFiles(paths, groupId) {
    const g = _groups.find(x => x.id === groupId);
    if (!g) return;
    if (typeof hooks.onClaim === 'function') hooks.onClaim([...paths]);
    // Collect emptied source groups as object refs — defer removal until after the
    // full loop so mid-loop renumbering can't corrupt subsequent _fileGroupMap writes.
    const toRemove = [];
    for (const path of paths) {
      const old = _fileGroupMap.get(path);
      if (old !== undefined && old !== g.id) {
        const og = _groups.find(x => x.id === old);
        if (og) {
          og.files.delete(path);
          if (og.files.size === 0 && !toRemove.includes(og)) toRemove.push(og);
        }
      }
      g.files.add(path);
      _fileGroupMap.set(path, g.id); // use g.id — stays correct if g is renumbered later
    }
    // Remove empty source groups; renumbering updates g.id via object ref so
    // _activeTabId = g.id below always reflects the final id.
    for (const og of toRemove) removeGroup(og.id);
    _activeTabId = g.id;
  }

  function unassignFiles(paths) {
    const toRemove = [];
    for (const path of paths) {
      const gid = _fileGroupMap.get(path);
      if (gid === undefined) continue;
      const g = _groups.find(x => x.id === gid);
      if (g) {
        g.files.delete(path);
        if (g.files.size === 0 && !toRemove.includes(g)) toRemove.push(g);
      }
      _fileGroupMap.delete(path);
    }
    // Remove empty groups after the full loop; renumbering propagates through object refs.
    for (const g of toRemove) removeGroup(g.id);
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  function getGroupForFile(path) {
    const gid = _fileGroupMap.get(path);
    return gid !== undefined ? (_groups.find(x => x.id === gid) ?? null) : null;
  }

  /** Returns the CSS var string for a group at position `idx` in _groups. */
  function getGroupColor(idx) {
    return GROUP_COLORS[Math.max(0, idx) % GROUP_COLORS.length];
  }

  /** Returns the current array index (0-based) for the group with `groupId`, or -1. */
  function getGroupIndex(groupId) {
    return _groups.findIndex(x => x.id === groupId);
  }

  /** Returns file paths from `allPaths` that are not assigned to any group. */
  function getUnassignedFiles(allPaths) {
    return allPaths.filter(p => !_fileGroupMap.has(p));
  }

  /** True if any group has subEventId === null (missing sub-event mapping). */
  function hasMissingSubEvents() {
    return _groups.some(g => g.subEventId === null);
  }

  /**
   * Returns subEventIds that are used by more than one group.
   * Empty array if no duplicates.
   */
  function getDuplicateSubEvents() {
    const seen = new Map();  // subEventId → count
    for (const g of _groups) {
      if (g.subEventId === null) continue;
      seen.set(g.subEventId, (seen.get(g.subEventId) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  }

  // ── Sub-event mapping ──────────────────────────────────────────────────────

  /** val: string id from EventCreator.getSubEventNames(), or null/'' to unmap. */
  function setSubEvent(groupId, val) {
    const g = _groups.find(x => x.id === groupId);
    if (g) g.subEventId = (val === '' || val === null) ? null : String(val);
  }

  /** tags: string[] of keyword tags, or null to clear the assignment. */
  function setMetadataTags(groupId, tags) {
    const g = _groups.find(x => x.id === groupId);
    if (g) g.metadataTags = Array.isArray(tags) ? [...tags] : null;
  }

  // ── Tab state ──────────────────────────────────────────────────────────────

  function getActiveTabId()   { return _activeTabId; }
  function setActiveTabId(id) { _activeTabId = id; }

  // ── Reset ──────────────────────────────────────────────────────────────────

  function reset() {
    // _uidCounter resets too: every reset() call site resets TagRefinementManager in the
    // same breath (source/event/workspace change), so no refinement state keyed by an
    // old uid survives to collide with a post-reset "group-1". _removalListeners is NOT
    // cleared — that is one-time module wiring (see onGroupRemoved), not per-session state.
    _groups = []; _fileGroupMap = new Map(); _activeTabId = null; _uidCounter = 0;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    createGroup,
    removeGroup,
    onGroupRemoved,
    assignFiles,
    unassignFiles,
    getGroupForFile,
    getGroupColor,
    getGroupIndex,
    setSubEvent,
    setMetadataTags,
    getActiveTabId,
    setActiveTabId,
    reset,
    // Queries
    hasGroups()              { return _groups.length > 0; },
    getGroups()              { return _groups; },
    getFileGroupMap()        { return _fileGroupMap; },
    getUnassignedFiles,
    hasMissingSubEvents,
    getDuplicateSubEvents,
  };

}

// ── Facade — the bound-instance singleton the rest of the renderer uses ───────
const GroupManager = (() => {
  let _bound = createGroupManager();
  const facade = {};
  for (const key of Object.keys(_bound)) {
    facade[key] = (...args) => _bound[key](...args);
  }
  /** Point the facade at another instance (the Current Event's). */
  facade.bind     = (instance) => { _bound = instance; };
  facade.getBound = () => _bound;
  facade.create   = createGroupManager;
  return facade;
})();

// Node.js / test compatibility — no effect in the browser.
if (typeof module !== 'undefined') module.exports = GroupManager;
