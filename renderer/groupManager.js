// renderer/groupManager.js
// ── GroupManager — module singleton ─────────────────────────────────────────
// Manages temporary file-to-group assignments for the import grouping workflow.
// Groups are reset on drive change / eject / event change (caller invokes reset()).
//
// Group shape:
//   { id: number, label: string, colorIdx: number,
//     files: Set<string>,        ← file paths (unique identifiers in this app)
//     subEventId: string | null  ← id from EventCreator.getSubEventNames()
//   }
'use strict';

const GroupManager = (() => {

  // Catppuccin Mocha palette colours — cycled as groups are created
  const COLORS = [
    { bg: 'var(--blue)',   fg: 'var(--base)' },
    { bg: 'var(--mauve)',  fg: 'var(--base)' },
    { bg: 'var(--green)',  fg: 'var(--base)' },
    { bg: 'var(--yellow)', fg: 'var(--base)' },
    { bg: 'var(--peach)',  fg: 'var(--base)' },
    { bg: 'var(--red)',    fg: 'var(--base)' },
  ];

  let _groups       = [];          // Group[]
  let _fileGroupMap = new Map();   // filePath → groupId
  let _nextId       = 1;
  let _activeTabId  = null;

  // ── CRUD ───────────────────────────────────────────────────────────────────

  function createGroup() {
    const id       = _nextId++;
    const colorIdx = _groups.length % COLORS.length;
    _groups.push({ id, label: `G${id}`, colorIdx, files: new Set(), subEventId: null });
    _activeTabId = id;
    return id;
  }

  function removeGroup(id) {
    const g = _groups.find(x => x.id === id);
    if (!g) return;
    for (const p of g.files) _fileGroupMap.delete(p);
    _groups = _groups.filter(x => x.id !== id);
    if (_activeTabId === id)
      _activeTabId = _groups.length ? _groups[_groups.length - 1].id : null;
  }

  function assignFiles(paths, groupId) {
    const g = _groups.find(x => x.id === groupId);
    if (!g) return;
    for (const path of paths) {
      const old = _fileGroupMap.get(path);
      if (old !== undefined && old !== groupId) {
        const og = _groups.find(x => x.id === old);
        if (og) {
          og.files.delete(path);
          // auto-remove now-empty groups (except the target group mid-assign)
          if (og.files.size === 0) removeGroup(og.id);
        }
      }
      g.files.add(path);
      _fileGroupMap.set(path, groupId);
    }
    _activeTabId = groupId;
  }

  function unassignFiles(paths) {
    // Collect groups that may become empty after unassignment
    const affectedIds = new Set();
    for (const path of paths) {
      const gid = _fileGroupMap.get(path);
      if (gid === undefined) continue;
      const g = _groups.find(x => x.id === gid);
      if (g) { g.files.delete(path); affectedIds.add(gid); }
      _fileGroupMap.delete(path);
    }
    // Auto-remove groups that are now empty
    for (const gid of affectedIds) {
      const g = _groups.find(x => x.id === gid);
      if (g && g.files.size === 0) removeGroup(gid);
    }
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  function getGroupForFile(path) {
    const gid = _fileGroupMap.get(path);
    return gid !== undefined ? (_groups.find(x => x.id === gid) ?? null) : null;
  }

  function getColor(colorIdx) {
    return COLORS[colorIdx % COLORS.length];
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
    _groups = []; _fileGroupMap = new Map(); _nextId = 1; _activeTabId = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    createGroup,
    removeGroup,
    assignFiles,
    unassignFiles,
    getGroupForFile,
    getColor,
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
