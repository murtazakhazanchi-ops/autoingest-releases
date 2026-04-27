// renderer/groupManager.js
// ── GroupManager — module singleton ─────────────────────────────────────────
// Manages temporary file-to-group assignments for the import grouping workflow.
// Groups are reset on drive change / eject / event change (caller invokes reset()).
//
// Group shape:
//   { id: number, label: string,
//     files: Set<string>,        ← file paths (unique identifiers in this app)
//     subEventId: string | null  ← id from EventCreator.getSubEventNames()
//   }
'use strict';

const GroupManager = (() => {

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

  let _groups       = [];          // Group[]
  let _fileGroupMap = new Map();   // filePath → groupId
  let _activeTabId  = null;

  // ── CRUD ───────────────────────────────────────────────────────────────────

  function createGroup() {
    const id = _groups.length + 1;
    _groups.push({ id, label: `G${id}`, files: new Set(), subEventId: null });
    _activeTabId = id;
    return id;
  }

  function removeGroup(id) {
    const g = _groups.find(x => x.id === id);
    if (!g) return;
    for (const p of g.files) _fileGroupMap.delete(p);
    _groups = _groups.filter(x => x.id !== id);

    // Renumber remaining groups sequentially from 1
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
  }

  function assignFiles(paths, groupId) {
    const g = _groups.find(x => x.id === groupId);
    if (!g) return;
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

  // ── Tab state ──────────────────────────────────────────────────────────────

  function getActiveTabId()   { return _activeTabId; }
  function setActiveTabId(id) { _activeTabId = id; }

  // ── Reset ──────────────────────────────────────────────────────────────────

  function reset() {
    _groups = []; _fileGroupMap = new Map(); _activeTabId = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    createGroup,
    removeGroup,
    assignFiles,
    unassignFiles,
    getGroupForFile,
    getGroupColor,
    getGroupIndex,
    setSubEvent,
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

})();
