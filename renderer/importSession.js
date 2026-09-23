// renderer/importSession.js
// ── ImportSession — source-agnostic multi-event import model ─────────────────
//
//   one opened import source → many event assignments → one import operation
//
// Pure renderer module: no DOM, no IPC, no filesystem. It works identically for a
// camera card, an external drive, a USB stick or an ordinary local folder — nothing
// here knows or cares what kind of source the files came from. File identity is the
// absolute source path (same identity GroupManager uses).
//
// Four distinct concepts (never conflate them):
//
//   UI selection          renderer.js `selectedFiles` — transient highlight. NOT owned here.
//   File → event owner    "this file will import into event E". Persistent for the session;
//                         survives selection changes, folder/view/sort changes and event
//                         switches. Exclusive: a path is owned by at most ONE event.
//   Current Event         the event whose working state the UI is presently editing.
//   Per-event workspace   everything event-scoped: its own GroupManager instance and (for
//                         events without groups) a set of directly-assigned files.
//
// Ownership is DERIVED from the per-event stores (a path is owned by the workspace whose
// GroupManager or directFiles contains it) — there is no parallel ownership index that could
// drift. Exclusivity is enforced by the model: whenever any workspace claims a path (via
// GroupManager.assignFiles' onClaim hook, or assignDirect), every other workspace releases it.
//
// The GroupManager facade stays bound to the CURRENT workspace's instance, so all existing
// group-panel / badge UI code is unchanged.
//
// Per-photo Tag Refinement is event-scoped state exactly like `groups`: each workspace owns
// its own TagRefinementManager instance next to its GroupManager instance (see
// _newInstances/_makeWorkspace), (1) has it released for moved/claimed paths in _claim() and
// release(), (2) has it rebound/reset in _bindTo()/switchTo()/reset() alongside the
// GroupManager facade, and (3) is read from THAT workspace's own instance (never the facade)
// when building each plan item in buildPlan() — the facades only reflect the Current Event.
//
// buildPlan() freezes a deterministic per-event import plan — routing (via ImportRouter,
// not re-implemented here) and metadata context (including tagRefinements) are resolved from
// each file's OWN event workspace, never from mutable Current Event / facade state.
'use strict';

const ImportSession = (() => {

  const _GM     = (typeof GroupManager          !== 'undefined') ? GroupManager          : require('./groupManager');
  const _TRM    = (typeof TagRefinementManager   !== 'undefined') ? TagRefinementManager   : require('./tagRefinementManager');
  const _Router = (typeof ImportRouter          !== 'undefined') ? ImportRouter          : require('./importRouter');

  /** Router validation codes that legacy Event Import already enforces (G4-1 / G4-3). */
  const ROUTER_CODES_ENFORCED = new Set(['MISSING_SUBEVENT', 'DUPLICATE_SUBEVENT']);

  // ── State ──────────────────────────────────────────────────────────────────

  let _workspaces  = new Map();   // eventKey → workspace
  let _ordinals    = new Map();   // eventKey → ordinal (E1, E2…) — stable for the whole session
  let _nextOrdinal = 1;
  let _currentKey  = null;
  let _detached    = null;        // instance pair the facades are bound to before any workspace exists
  let _lastClaim   = null;        // { reassigned:number, fromOrdinals:number[] } from the latest claim

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Stable event identity: the normalized event folder path. */
  function keyOf(eventPath) {
    return String(eventPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  /**
   * One event workspace's concrete manager pair, wired together at creation. The
   * group-removal → refinement-cleanup hook (Follow-up B) is attached HERE, between the
   * two CONCRETE instances, once per workspace — never on the global facade. Fixes the
   * listener-lifecycle bug a facade-level hook would have: a callback registered once on
   * whichever instance happened to be bound at renderer-load time would be orphaned the
   * first time the facade rebinds to a different event's instance. Wiring it at instance
   * creation means every workspace has permanent, correct cleanup regardless of which
   * event is ever the Current Event.
   */
  function _newInstances() {
    const hooks = {};
    const groups = _GM.create(hooks);
    const refinements = _TRM.create();
    groups.onGroupRemoved(uid => refinements.clearGroup(uid));
    return { hooks, groups, refinements };
  }

  function _bindTo(inst) {
    _GM.bind(inst.groups);
    _TRM.bind(inst.refinements);
  }

  function _ownedCount(ws) {
    return ws.groups.getFileGroupMap().size + ws.directFiles.size;
  }

  function _owns(ws, path) {
    return ws.groups.getFileGroupMap().has(path) || ws.directFiles.has(path);
  }

  /**
   * True when a non-current, unowned workspace is safe to discard entirely. Owning zero
   * files is not enough by itself: a single-component (groupless) event can carry real
   * EVENT_SCOPE Tag Refinement state before the operator ever explicitly assigns any file
   * to it (group-scoped refinement can't hit this — a file must already be IN a group,
   * which is itself ownership). Losing that refinement merely because the operator looked
   * at another event next would be exactly the cross-event data loss this whole per-
   * workspace architecture exists to prevent — so a workspace holding refinement state is
   * never disposable, regardless of file ownership.
   */
  function _isDisposable(ws) {
    return _ownedCount(ws) === 0 && !ws.refinements.hasAnyOverrides();
  }

  function _ensureOrdinal(ws) {
    if (ws.ordinal != null) return ws.ordinal;
    let ord = _ordinals.get(ws.key);
    if (ord == null) { ord = _nextOrdinal++; _ordinals.set(ws.key, ord); }
    ws.ordinal = ord;
    return ord;
  }

  function _displayName(eventData) {
    const ev = eventData && eventData.event;
    return (ev && (ev.displayName || ev.name)) || '';
  }

  /** Wraps an instance pair into a workspace and installs its claim hook. */
  function _makeWorkspace(key, eventData, inst) {
    const ws = {
      key,
      eventData,
      ordinal: _ordinals.get(key) ?? null,
      groups: inst.groups,
      refinements: inst.refinements,
      directFiles: new Set(),
      _hooks: inst.hooks,
    };
    inst.hooks.onClaim = (paths) => _claim(ws, paths);
    return ws;
  }

  /**
   * Model-level exclusivity. Called (via the onClaim hook) BEFORE `claimer` takes `paths`:
   * every other workspace releases them — groups and direct files — and the
   * claimer's own direct set drops them (they are about to live in one of its groups).
   *
   * LOCKED semantic (file moves between events): a file's per-photo refinement is
   * relative to the event/component it was refined against — Event B can offer entirely
   * different Event Types / Additional Keywords. So a released file's refinement is
   * cleared from the LOSING workspace's TagRefinementManager instance here, exactly
   * where its group membership is released — it never carries into whichever event
   * claims the file next; the claiming event always starts that file at Default unless
   * the operator explicitly refines it there.
   */
  function _claim(claimer, paths) {
    _ensureOrdinal(claimer);
    let reassigned = 0;
    const fromOrdinals = new Set();
    for (const ws of _workspaces.values()) {
      if (ws === claimer) {
        for (const p of paths) ws.directFiles.delete(p);
        continue;
      }
      const owned = paths.filter(p => _owns(ws, p));
      if (owned.length === 0) continue;
      reassigned += owned.length;
      if (ws.ordinal != null) fromOrdinals.add(ws.ordinal);
      ws.groups.unassignFiles(owned);      // also removes emptied groups + renumbers
      ws.refinements.clearFiles(owned);    // never let a stale override follow the file
      for (const p of owned) ws.directFiles.delete(p);
    }
    _lastClaim = { reassigned, fromOrdinals: [...fromOrdinals].sort((a, b) => a - b) };
    _pruneEmpty(claimer);
  }

  /**
   * Drop non-current, disposable workspaces — see _isDisposable(). `keep` (the claimer,
   * which owns nothing until its claim completes) is never pruned.
   */
  function _pruneEmpty(keep = null) {
    for (const [key, ws] of _workspaces) {
      if (ws !== keep && key !== _currentKey && _isDisposable(ws)) _workspaces.delete(key);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Discard every workspace and ordinal; rebind the facades to fresh detached instances.
   * Call at every true session boundary: source change, eject, disconnect, leaving to the
   * landing screen, starting a new import from scratch.
   */
  function reset() {
    _workspaces  = new Map();
    _ordinals    = new Map();
    _nextOrdinal = 1;
    _currentKey  = null;
    _lastClaim   = null;
    _detached    = _newInstances();
    _bindTo(_detached);
  }

  /**
   * Make `eventData` the Current Event: create its workspace if needed and bind the
   * GroupManager AND TagRefinementManager facades to it. SYNCHRONOUS — callers must
   * resolve every async input (disk reads, modals) BEFORE calling, so the swap is atomic.
   *
   * The first workspace adopts the detached instances the facades were already bound to,
   * so any grouping OR refinement done before the session "started" is not lost.
   *
   * @param {{ eventPath:string, collectionPath?:string, coll?:object, event?:object, idx?:number }} eventData
   * @returns the workspace
   */
  function switchTo(eventData) {
    if (!eventData || !eventData.eventPath) throw new Error('ImportSession.switchTo: eventData.eventPath is required');
    const key = keyOf(eventData.eventPath);
    const prev = _currentKey != null ? _workspaces.get(_currentKey) : null;

    if (prev && prev.key !== key && _isDisposable(prev)) _workspaces.delete(prev.key);

    let ws = _workspaces.get(key);
    if (!ws) {
      const inst = _detached || _newInstances();
      _detached = null;
      ws = _makeWorkspace(key, eventData, inst);
      _workspaces.set(key, ws);
    } else {
      ws.eventData = eventData;   // freshest view of the event object
    }
    _currentKey = key;
    _bindTo(ws);
    return ws;
  }

  function getCurrentKey()    { return _currentKey; }
  function getCurrent()       { return _currentKey != null ? (_workspaces.get(_currentKey) || null) : null; }
  function getWorkspace(key)  { return _workspaces.get(keyOf(key)) || null; }
  function listWorkspaces()   { return [..._workspaces.values()]; }

  // ── Ownership ──────────────────────────────────────────────────────────────

  /** { key, ordinal, ws } of the event that owns `path`, or null. */
  function ownerOf(path) {
    for (const ws of _workspaces.values()) {
      if (_owns(ws, path)) return { key: ws.key, ordinal: _ensureOrdinal(ws), ws };
    }
    return null;
  }

  function isOwnedByCurrent(path) {
    const ws = getCurrent();
    return !!ws && _owns(ws, path);
  }

  function hasAssignments() {
    for (const ws of _workspaces.values()) if (_ownedCount(ws) > 0) return true;
    return false;
  }

  /** Number of events that currently own at least one file. */
  function participatingCount() {
    let n = 0;
    for (const ws of _workspaces.values()) if (_ownedCount(ws) > 0) n++;
    return n;
  }

  /** True when this event has persistent assignments — used to block editing it. */
  function isParticipating(eventPath) {
    const ws = _workspaces.get(keyOf(eventPath));
    return !!ws && _ownedCount(ws) > 0;
  }

  /**
   * Same, matched by collection + event folder name — for callers that only know an event
   * by name (e.g. the event picker), where a path may differ (staging vs archive root).
   */
  function isParticipatingByName(collectionName, eventName) {
    for (const ws of _workspaces.values()) {
      if (_ownedCount(ws) === 0) continue;
      const coll = ws.eventData && ws.eventData.coll;
      const ev = ws.eventData && ws.eventData.event;
      if (coll && ev && coll.name === collectionName && ev.name === eventName) return true;
    }
    return false;
  }

  /**
   * True when the proven single-event import path can run unchanged: no file is assigned
   * directly (only groups exist) and every owned file belongs to the Current Event. That is
   * exactly the situation the pre-multi-event code was written for, so it still runs as-is —
   * a deliberate TRANSITIONAL regression-safety decision, not the intended permanent split:
   * both paths are meant to converge on one runner fed by a one-event plan.
   */
  function isLegacyEligible() {
    for (const ws of _workspaces.values()) {
      if (ws.directFiles.size > 0) return false;
      if (ws.key !== _currentKey && _ownedCount(ws) > 0) return false;
    }
    return true;
  }

  /**
   * Explicitly assign files to the Current Event WITHOUT a group (events that don't use
   * groups). Files already in one of the current event's groups keep their group. Files
   * owned by another event are reassigned (exclusive). Returns { assigned, reassigned }.
   */
  function assignDirect(paths) {
    const ws = getCurrent();
    if (!ws) return { assigned: 0, reassigned: 0 };
    const groupMap = ws.groups.getFileGroupMap();
    const toAdd = [...new Set(paths)].filter(p => !groupMap.has(p) && !ws.directFiles.has(p));
    if (toAdd.length === 0) return { assigned: 0, reassigned: 0 };
    _claim(ws, toAdd);
    const reassigned = _lastClaim ? _lastClaim.reassigned : 0;
    for (const p of toAdd) ws.directFiles.add(p);
    return { assigned: toAdd.length, reassigned };
  }

  /** Release files from whichever event owns them (groups and direct files). Same
   *  refinement-clearing rule as _claim() — a released file starts at Default wherever
   *  (if anywhere) it is owned next. */
  function release(paths) {
    const list = [...new Set(paths)];
    for (const ws of _workspaces.values()) {
      const owned = list.filter(p => _owns(ws, p));
      if (owned.length === 0) continue;
      ws.groups.unassignFiles(owned);
      ws.refinements.clearFiles(owned);
      for (const p of owned) ws.directFiles.delete(p);
    }
    _pruneEmpty();
  }

  /** Consumes the reassignment info recorded by the latest claim (for a UI toast). */
  function takeLastClaim() {
    const c = _lastClaim;
    _lastClaim = null;
    return c;
  }

  // ── Summary (UI strip / import button) ─────────────────────────────────────

  /**
   * @param {string[]} [viewPaths] — files in the current view; used only for the unassigned count.
   * @returns {{ events: Array<{key,ordinal,name,fileCount,isCurrent}>, assignedTotal:number, unassignedInView:number|null }}
   */
  function getSummary(viewPaths) {
    const events = [];
    let assignedTotal = 0;
    for (const ws of _workspaces.values()) {
      const n = _ownedCount(ws);
      if (n === 0) continue;
      assignedTotal += n;
      events.push({ key: ws.key, ordinal: _ensureOrdinal(ws), name: _displayName(ws.eventData), fileCount: n, isCurrent: ws.key === _currentKey });
    }
    events.sort((a, b) => a.ordinal - b.ordinal);
    let unassignedInView = null;
    if (Array.isArray(viewPaths)) {
      unassignedInView = 0;
      for (const p of viewPaths) if (!ownerOf(p)) unassignedInView++;
    }
    return { events, assignedTotal, unassignedInView };
  }

  // ── Post-run cleanup ───────────────────────────────────────────────────────

  /**
   * Remove events whose import fully completed. Failed / not-started events are left
   * untouched so the operator never has to reconstruct them. Ordinals stay reserved: an
   * event that re-participates later gets its original E-number back, and remaining events
   * are never renumbered. If the Current Event completed, it is replaced by an empty
   * workspace so the source workspace stays usable.
   */
  function completeEvents(keys) {
    for (const raw of keys) {
      const key = keyOf(raw);
      const ws = _workspaces.get(key);
      if (!ws) continue;
      if (key === _currentKey) {
        const fresh = _makeWorkspace(key, ws.eventData, _newInstances());
        fresh.ordinal = null;              // owns nothing yet; ordinal resumes from _ordinals on next claim
        _workspaces.set(key, fresh);
        _bindTo(fresh);
      } else {
        _workspaces.delete(key);
      }
    }
  }

  // ── Plan ───────────────────────────────────────────────────────────────────

  /** Pure copy of renderer.js _getMetaGroupingTags(), parameterised by components. */
  function metaGroupingTags(comps) {
    if (!Array.isArray(comps) || comps.length !== 1) return [];
    const raw = (comps[0].eventTypes || [])
      .map(t => (typeof t === 'object' ? (t.label || '') : String(t)))
      .join(',').split(',').map(t => t.trim()).filter(Boolean);
    const seen = new Set();
    return raw.filter(t => seen.has(t) ? false : (seen.add(t), true));
  }

  function _deriveSubEventIds(comps) {
    return (comps || []).map(c => c && c.folderName).filter(Boolean);
  }

  function _deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) _deepFreeze(o[k]);
    }
    return o;
  }

  function _routerGroupsFor(ws, isMulti, metaGrouping) {
    const groupMap = ws.groups.getFileGroupMap();
    const asRouterGroup = (g) => ({
      id: g.id,
      uid: g.uid,   // stable identity — carried through to buildPlan() for refinement lookup
      label: g.label,
      subEventId: g.subEventId,
      metadataTags: g.metadataTags ?? null,
      files: new Set(g.files),
    });

    if (isMulti) return ws.groups.getGroups().map(asRouterGroup);

    if (metaGrouping) {
      const groups = ws.groups.getGroups().map(asRouterGroup);
      const ungrouped = [...ws.directFiles].filter(p => !groupMap.has(p));
      // Mirrors legacy Event Import: ungrouped files in metadata-grouping mode import with
      // an explicit empty keyword set (deterministic "no component keyword").
      if (ungrouped.length > 0) {
        groups.push({ id: -1, uid: null, label: '', subEventId: null, metadataTags: [], files: new Set(ungrouped) });
      }
      return groups;
    }

    // Single component, no grouping: every owned file routes to eventPath/photographer.
    // Union of both stores so an owned file can never be silently dropped.
    const all = new Set(ws.directFiles);
    for (const p of groupMap.keys()) all.add(p);
    return [{ id: 0, uid: null, label: '', subEventId: null, metadataTags: null, files: all }];
  }

  /**
   * Build the deterministic, frozen import plan for every participating event.
   *
   * Routing is ImportRouter's (not re-implemented here); each event is routed from ITS OWN
   * workspace + ITS OWN event data. Nothing here reads Current Event state.
   *
   * @param {object} opts
   * @param {string|null} [opts.photographer]  session-level photographer (stored per event item so a
   *                                           per-event photographer is a UI-only extension later)
   * @param {string|null} [opts.importMode]
   * @param {Map<string, {components:object[], subEventIds?:string[]}|null>} [opts.fresh]
   *        freshly re-read event.json data per eventKey; null value = unreadable (blocking).
   *        Absent key → fall back to the workspace's captured event data.
   * @param {string[]} [opts.viewPaths]  files in the current view, for the unassigned count
   */
  function buildPlan({ photographer = null, importMode = null, fresh = new Map(), viewPaths = null } = {}) {
    const events = [];
    const errors = [];
    const warnings = [];

    const sorted = [...(_workspaces.values())]
      .filter(ws => _ownedCount(ws) > 0)
      .sort((a, b) => _ensureOrdinal(a) - _ensureOrdinal(b));

    for (const ws of sorted) {
      const ordinal = _ensureOrdinal(ws);
      const name    = _displayName(ws.eventData);
      const evErrors = [];
      const evWarnings = [];
      const flag = (list, code, message) => list.push({ eventKey: ws.key, ordinal, eventName: name, code, message });

      const snap = fresh.has(ws.key) ? fresh.get(ws.key) : undefined;
      let comps = (ws.eventData.event && ws.eventData.event.components) || [];
      let subEventIds = _deriveSubEventIds(comps);
      if (snap === null) {
        flag(evErrors, 'EVENT_UNREADABLE', 'Event details could not be read from disk — the event may have been moved or removed.');
      } else if (snap) {
        comps = snap.components;
        subEventIds = Array.isArray(snap.subEventIds) ? snap.subEventIds : _deriveSubEventIds(comps);
      }

      const isMulti = comps.length > 1;
      const metaGrouping = metaGroupingTags(comps).length > 1;

      if (!comps.length) flag(evErrors, 'NO_COMPONENTS', 'This event has no components defined.');
      if (!ws.eventData.collectionPath) flag(evErrors, 'NO_DESTINATION', 'The destination for this event cannot be resolved.');
      if (comps.some(c => !c.eventTypes?.length || !c.city?.label)) {
        flag(evErrors, 'INCOMPLETE_COMPONENT', 'Complete all event details (event type + city) before importing.');
      }
      if (isMulti && !metaGrouping && ws.directFiles.size > 0) {
        flag(evErrors, 'UNGROUPED_FILES', `${ws.directFiles.size} file${ws.directFiles.size === 1 ? ' is' : 's are'} assigned without a group in a multi-component event.`);
      }

      const routerGroups = _routerGroupsFor(ws, isMulti, metaGrouping);

      const routingEventData = {
        coll: ws.eventData.coll,
        event: { ...(ws.eventData.event || {}), components: comps },
        idx: ws.eventData.idx,
        collectionPath: ws.eventData.collectionPath,
        eventPath: ws.eventData.eventPath,
      };

      if (isMulti && routingEventData.coll && routingEventData.event.name) {
        const v = _Router.validateGroups({ groups: routerGroups, eventData: routingEventData });
        for (const e of v.errors)   if (ROUTER_CODES_ENFORCED.has(e.code)) flag(evErrors,   e.code, e.message);
        for (const w of v.warnings) if (ROUTER_CODES_ENFORCED.has(w.code)) flag(evWarnings, w.code, w.message);
        for (const g of routerGroups) {
          if (g.subEventId && !subEventIds.includes(String(g.subEventId))) {
            flag(evErrors, 'STALE_SUBEVENT', `${g.label || `Group ${g.id}`} is mapped to "${g.subEventId}", which no longer exists in this event.`);
          }
        }
      }
      if (metaGrouping) {
        const untagged = routerGroups.filter(g => g.id !== -1 && g.metadataTags === null).length;
        if (untagged > 0) flag(evWarnings, 'UNTAGGED_GROUPS', `${untagged} group${untagged === 1 ? '' : 's'} without keyword assignment — those files will use default tagging.`);
      }

      let fileJobs = [];
      let skippedSrcs = [];
      let summary = { totalFiles: 0, totalGroups: 0, totalSubEvents: 0, videoFiles: 0, imageFiles: 0 };
      const canRoute = photographer && evErrors.length === 0 && routingEventData.coll;
      if (canRoute) {
        ({ fileJobs, skippedSrcs, summary } = _Router.simulateImport({ groups: routerGroups, eventData: routingEventData, photographer }));
        if (fileJobs.length === 0) flag(evErrors, 'NO_FILES', 'No files to import for this event.');
      }

      const item = {
        eventKey: ws.key,
        ordinal,
        name,
        eventPath: ws.eventData.eventPath,
        collectionPath: ws.eventData.collectionPath,
        isMulti,
        metaGrouping,
        // Per-event archive state captured when the event became current (Local First rules).
        isPendingSync: !!ws.eventData.isPendingSync,
        wasLocalStagingEvent: !!ws.eventData.wasLocalStagingEvent,
        photographer: photographer || null,
        importMode: importMode || null,
        fileCount: _ownedCount(ws),
        routingEventData,
        // Per-file Tag Refinement overrides, looked up from THIS WORKSPACE's OWN
        // TagRefinementManager instance (ws.refinements) — never the facade, which only
        // ever reflects whichever event happens to be the Current Event right now. This is
        // the correctness boundary that keeps a multi-event plan's per-event refinement
        // intent from bleeding across events: each item below is built entirely from its
        // own event's captured state, exactly like routing already was.
        //   multi-component  → that group's own scope, by its STABLE uid.
        //   single-component (with or without legacy metadata grouping) → the event scope,
        //     restricted to the files THIS router group actually owns.
        groups: routerGroups.map(g => ({
          id: g.id, label: g.label, subEventId: g.subEventId, metadataTags: g.metadataTags,
          files: [...g.files],
          fileTagRefinements: isMulti
            ? ws.refinements.serializeGroupForImport(g.uid)
            : ws.refinements.serializeGroupForImport(ws.refinements.EVENT_SCOPE, [...g.files]),
        })),
        fileJobs,
        skippedSrcs,
        counts: { photos: summary.imageFiles, videos: summary.videoFiles, total: fileJobs.length },
        errors: evErrors,
        warnings: evWarnings,
      };
      events.push(item);
      errors.push(...evErrors);
      warnings.push(...evWarnings);
    }

    const assigned = events.reduce((s, e) => s + e.fileCount, 0);
    let unassignedInView = null;
    if (Array.isArray(viewPaths)) {
      unassignedInView = 0;
      for (const p of viewPaths) if (!ownerOf(p)) unassignedInView++;
    }

    // routingEventData holds live session objects (coll/event) — keep it out of the deep
    // freeze so the plan freeze never locks EventCreator's own state.
    const plan = {
      photographer: photographer || null,
      importMode: importMode || null,
      events,
      totals: {
        events: events.length,
        assigned,
        routed: events.reduce((s, e) => s + e.fileJobs.length, 0),
        unassignedInView,
      },
      errors,
      warnings,
      hasBlocking: errors.length > 0,
    };
    for (const e of plan.events) {
      const { routingEventData, ...rest } = e;
      _deepFreeze(rest);
      Object.freeze(e);
    }
    Object.freeze(plan.events);
    Object.freeze(plan.errors);
    Object.freeze(plan.warnings);
    Object.freeze(plan.totals);
    return Object.freeze(plan);
  }

  reset();

  return {
    keyOf,
    reset,
    switchTo,
    getCurrentKey,
    getCurrent,
    getWorkspace,
    listWorkspaces,
    ownerOf,
    isOwnedByCurrent,
    hasAssignments,
    participatingCount,
    isParticipating,
    isParticipatingByName,
    isLegacyEligible,
    assignDirect,
    release,
    takeLastClaim,
    getSummary,
    completeEvents,
    metaGroupingTags,
    buildPlan,
  };

})();

// Node.js / test compatibility — no effect in the browser.
if (typeof module !== 'undefined') module.exports = ImportSession;
