// renderer/groupManager.js
// ── GroupManager — module singleton ─────────────────────────────────────────
// Manages temporary file-to-group assignments for the import grouping workflow.
// Groups are reset on drive change / eject (caller must invoke reset()).
'use strict';

const GroupManager = (() => {

  // Catppuccin Mocha colours — cycled as groups are created
  const COLORS = [
    { bg: 'var(--blue)',   fg: 'var(--base)' },
    { bg: 'var(--mauve)',  fg: 'var(--base)' },
    { bg: 'var(--green)',  fg: 'var(--base)' },
    { bg: 'var(--yellow)', fg: 'var(--base)' },
    { bg: 'var(--peach)',  fg: 'var(--base)' },
    { bg: 'var(--red)',    fg: 'var(--base)' },
  ];

  let _groups       = [];          // { id, label, colorIdx, files: Set<string>, subEventIdx: null|number }[]
  let _fileGroupMap = new Map();   // path → groupId
  let _nextId       = 1;
  let _activeTabId  = null;

  // ── CRUD ───────────────────────────────────────────────────────────────────

  function createGroup() {
    const id       = _nextId++;
    const colorIdx = _groups.length % COLORS.length;
    _groups.push({ id, label: `G${id}`, colorIdx, files: new Set(), subEventIdx: null });
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
        if (og) og.files.delete(path);
      }
      g.files.add(path);
      _fileGroupMap.set(path, groupId);
    }
    _activeTabId = groupId;
  }

  function unassignFiles(paths) {
    for (const path of paths) {
      const gid = _fileGroupMap.get(path);
      if (gid === undefined) continue;
      const g = _groups.find(x => x.id === gid);
      if (g) g.files.delete(path);
      _fileGroupMap.delete(path);
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

  // ── Sub-event mapping ──────────────────────────────────────────────────────

  function setSubEvent(groupId, val) {
    const g = _groups.find(x => x.id === groupId);
    if (g) g.subEventIdx = (val === '' || val === null) ? null : Number(val);
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
    hasGroups()       { return _groups.length > 0; },
    getGroups()       { return _groups; },
    getFileGroupMap() { return _fileGroupMap; },
  };

})();
