// renderer/tagRefinementManager.js
// ── TagRefinementManager — instantiable manager + bound facade ───────────────
// Per-file metadata override state for the "Per-Photo Tag Refinement" feature.
// Strictly metadata-only: never touches archive routing, folder naming, or
// GroupManager's group→component mapping. GroupManager owns which component a
// group physically routes to; this module owns an optional, finer-grained
// override of that component's Event Types / Additional Keywords for individual
// files. It never creates or implies sub-groups.
//
// Per-event isolation (mirrors groupManager.js): createTagRefinementManager()
// builds an independent instance — its own `_overrides` Map, its own active-scope
// state, its own revision counter. The exported `TagRefinementManager` is a thin
// facade bound to ONE instance at a time (the Current Event's — see
// importSession.js). Multi-Event Import gives each event workspace its OWN
// TagRefinementManager instance, created and bound alongside its GroupManager
// instance, so refinement state can never leak or collide across events even
// though every event's groups independently start their `uid` numbering at
// "group-1" — the isolation comes from being different manager INSTANCES
// entirely, not from the scope-id strings being distinguishable. Unbound (no
// ImportSession involved), the facade behaves exactly like the original
// module-global singleton.
//
// reset() clears the bound instance only — same convention as GroupManager.
//
// Scopes. Inside ONE instance, overrides live under a scope id, which is either
//   • a GroupManager group's STABLE `uid` (string, e.g. "group-3") — multi-component
//     events, where the group's mapped component is the refinable component. This is
//     deliberately the group's `uid`, NOT its mutable, renumbered `id` — GroupManager
//     renumbers surviving groups' `id`s whenever one is removed, and keying refinement
//     state by that mutable id let a survivor's overrides go orphaned under its old
//     number while a stranger's could appear to live under its new one (Follow-up B). A
//     group's `uid` is assigned once at creation and never changes or gets reused, so
//     scope identity here is stable across any amount of removal/renumbering churn; or
//   • EVENT_SCOPE (the reserved string 'event') — single-component events, where the
//     one component is already the destination, so no group is needed or created.
// EVENT_SCOPE is a single module-level constant shared by every instance (it never needs
// to vary per instance — cross-event isolation already comes from separate instances) and
// can never collide with a group uid — see groupManager.js's `group-N` uid format. Every
// function below takes the scope id in the position formerly called groupId; the two
// scopes share one engine within an instance. This module has no idea what a "uid" is —
// it just holds a Map keyed by whatever scope id the caller passes; the STABILITY
// guarantee lives entirely in what the caller (renderer.js / importSession.js) passes.
//
// Override shape (per scope, per file path):
//   { eventTypes: string[], additionalKeywords: string[] }
//
// Tri-state semantics (critical — see spec):
//   no entry for a file       → inherit whatever the metadata pipeline would normally
//                                 resolve for that file (the "effective default"). This
//                                 is NOT always "every component tag": a single-component
//                                 event with 2+ Event Types deliberately inherits none.
//                                 See renderer/refinableTags.js effectiveDefaults().
//   entry with both arrays [] → explicitly no refinable tags for this file.
//   entry with populated arrays → exactly that explicit subset.
// Default and explicit-none are distinct STATES even when they resolve to the same
// output today — default stays dynamic (tracks the pipeline), explicit-none is fixed.
// resetToDefault() REMOVES the entry (reverts to inheritance) — it never sets
// empty arrays, which would instead mean "explicitly no tags".
//
// File identity: the same absolute source path GroupManager uses as the unique
// file identifier within a session (see groupManager.js). Overrides are reset
// whenever GroupManager is reset, a group's component mapping changes, or a
// file moves/unassigns out of the group it was refined in — callers are
// responsible for invoking the corresponding clear*/reset methods at those
// points (see renderer.js call sites next to GroupManager.reset()/setSubEvent()/
// assignFiles()/unassignFiles(), and importSession.js's _claim()/release(), which
// clear a moved/released file's override from its OLD event's instance so it never
// carries into whichever event claims the file next — see LOCKED semantics there).
'use strict';

// Shared refinable-tag model (eligibility input + effective defaults). Browser: the
// renderer loads refinableTags.js first via <script>; Node tests: plain require.
const _RefinableTags = (typeof module === 'object' && module.exports)
  ? require('./refinableTags')
  : window.RefinableTags;

/** Reserved scope id for single-component events (no groups). Never a number. Module-level
 *  (not per-instance) — every instance uses the exact same reserved string; cross-event
 *  isolation comes from separate instances, not from this string varying. */
const EVENT_SCOPE = 'event';

function createTagRefinementManager() {

  // scopeId -> Map<filePath, {eventTypes:string[], additionalKeywords:string[]}>
  let _overrides = new Map();

  // Monotonic mutation counter — lets the UI memoize O(n) summaries and skip rescans
  // on selection changes that did not touch any override.
  let _rev = 0;

  // Refinement-mode UI state: which scope (group id or EVENT_SCOPE), if any, is
  // currently being refined. Purely a view concern (which files are shown filtered in
  // the grid / which panel is rendered) — kept here so renderer.js has one source of
  // truth for both the override data and the mode flag.
  let _activeGroupId = null;

  function _groupMap(groupId, create) {
    let m = _overrides.get(groupId);
    if (!m && create) {
      m = new Map();
      _overrides.set(groupId, m);
    }
    return m || null;
  }

  // ── Eligibility ────────────────────────────────────────────────────────────

  /**
   * THE authoritative eligibility rule — every "should Refine Tags be offered / stay
   * open" decision (group card, single-component footer button, panel render guard,
   * mode-validity guard) must call this, never re-derive it.
   *
   * A component is eligible when it offers at least ONE refinable tag (an Event Type or
   * an Additional Keyword): even a lone Event Type is eligible, so the operator can drop
   * it from individual photographs. Only a component with nothing to refine is not.
   * `component` may be UI-format (EventCreator.getEventComps()) or disk-format.
   */
  function isEligible(component) {
    return _RefinableTags.countRefinable(component) >= 1;
  }

  // ── Overrides ──────────────────────────────────────────────────────────────

  /** Returns the override for a file, or null when it inherits component defaults. */
  function getOverride(groupId, filePath) {
    const m = _groupMap(groupId, false);
    return m ? (m.get(filePath) || null) : null;
  }

  /**
   * Applies an explicit tag combination to a batch of files in one group.
   * eventTypes/additionalKeywords are string[] — pass [] for "explicitly none".
   */
  function setOverride(groupId, filePaths, { eventTypes, additionalKeywords }) {
    const m = _groupMap(groupId, true);
    const et = Array.isArray(eventTypes) ? [...eventTypes] : [];
    const ak = Array.isArray(additionalKeywords) ? [...additionalKeywords] : [];
    for (const p of filePaths) m.set(p, { eventTypes: [...et], additionalKeywords: [...ak] });
    _rev++;
  }

  /**
   * Removes the override for a batch of files — they revert to inheriting the
   * mapped component's defaults. This is NOT the same as setOverride with full
   * tag arrays: inheritance stays correct if the component's tags later change,
   * an explicit "all tags" override does not.
   */
  function resetToDefault(groupId, filePaths) {
    const m = _groupMap(groupId, false);
    if (!m) return;
    for (const p of filePaths) m.delete(p);
    if (m.size === 0) _overrides.delete(groupId);
    _rev++;
  }

  /** Clears every override in a group — used when the group's component mapping changes. */
  function clearGroup(groupId) {
    _overrides.delete(groupId);
    _rev++;
  }

  /**
   * Clears overrides for specific files across ALL groups — used when files move
   * to a different group or are unassigned. A stale override must never survive
   * a group/component change; this is a no-op for files that had no override.
   */
  function clearFiles(filePaths) {
    if (!filePaths || filePaths.length === 0 || _overrides.size === 0) return;
    for (const [gid, m] of _overrides) {
      for (const p of filePaths) m.delete(p);
      if (m.size === 0) _overrides.delete(gid);
    }
    _rev++;
  }

  /** Number of files in a group carrying an explicit override (refined or explicit-none). */
  function groupRefinementCount(groupId) {
    const m = _groupMap(groupId, false);
    return m ? m.size : 0;
  }

  /**
   * True when this instance holds ANY override, in any scope (group or EVENT_SCOPE).
   * Used by importSession.js to decide whether a workspace with zero OWNED files still
   * holds operator work worth keeping — e.g. EVENT_SCOPE refinement done on a
   * single-component (groupless) event before the operator ever explicitly assigned
   * those files to it. Without this, an ownerless-but-refined workspace looks identical
   * to a genuinely empty one and would be silently discarded on switching away.
   */
  function hasAnyOverrides() {
    return _overrides.size > 0;
  }

  /**
   * Summary counts for a group given its current file list.
   * @param {number|string} groupId
   * @param {string[]} filePaths — every file currently in the group
   * @returns {{ total:number, default:number, refined:number, noTags:number }}
   */
  function getSummary(groupId, filePaths) {
    const m = _groupMap(groupId, false);
    let refined = 0, noTags = 0;
    for (const p of filePaths) {
      const o = m ? m.get(p) : undefined;
      if (!o) continue;
      const isEmpty = o.eventTypes.length === 0 && o.additionalKeywords.length === 0;
      if (isEmpty) noTags++;
      else refined++;
    }
    return { total: filePaths.length, default: filePaths.length - refined - noTags, refined, noTags };
  }

  /**
   * Effective per-tag checkbox state and an overall status for a batch of files.
   *
   * `allEventTypes` / `allAdditionalKeywords` are the AVAILABLE tags (what the panel
   * offers as chips). `defaults` is what a file with NO override actually inherits from
   * the metadata pipeline — a separate concept, because available ≠ inherited (a
   * single-component event with 2+ Event Types offers all of them but inherits none).
   * `defaults` may be:
   *   • omitted            → legacy behavior: an untouched file inherits every available tag
   *   • { eventTypes, additionalKeywords } → the same defaults for every file
   *   • (filePath) => { eventTypes, additionalKeywords } → per-file defaults (e.g. files in
   *     different legacy metadata groups inherit different Event Types)
   * A default file's checkbox state is derived from its defaults, and stays
   * distinguishable from an explicit override via `status` even when the two would
   * resolve to identical output.
   *
   * Read-only: never mutates any override. Callers use this purely to decide what to
   * render — selecting files, mixed or not, never changes stored state on its own.
   *
   * @param {number|string} groupId — scope id (group id or EVENT_SCOPE)
   * @param {string[]} filePaths — the current selection, already scoped to this scope
   * @param {string[]} allEventTypes
   * @param {string[]} allAdditionalKeywords
   * @param {object|Function} [defaults]
   * @returns {{
   *   status: 'empty'|'default'|'refined'|'none'|'mixed',
   *   sampleOverride: {eventTypes:string[], additionalKeywords:string[]}|null,
   *   eventTypes: Object<string,'checked'|'unchecked'|'indeterminate'>,
   *   additionalKeywords: Object<string,'checked'|'unchecked'|'indeterminate'>,
   * }}
   */
  function getSelectionState(groupId, filePaths, allEventTypes, allAdditionalKeywords, defaults) {
    if (!filePaths || filePaths.length === 0) {
      return { status: 'empty', sampleOverride: null, eventTypes: {}, additionalKeywords: {} };
    }

    const defaultsFor = typeof defaults === 'function'
      ? defaults
      : () => defaults || { eventTypes: allEventTypes, additionalKeywords: allAdditionalKeywords };

    const overrides = filePaths.map(p => getOverride(groupId, p));
    const _key = o => o ? JSON.stringify({ e: [...o.eventTypes].sort(), a: [...o.additionalKeywords].sort() }) : null;
    const firstKey = _key(overrides[0]);
    const uniform = overrides.every(o => _key(o) === firstKey);

    let status;
    if (!uniform) status = 'mixed';
    else if (overrides[0] === null) status = 'default';
    else if (overrides[0].eventTypes.length === 0 && overrides[0].additionalKeywords.length === 0) status = 'none';
    else status = 'refined';

    // Resolve each no-override file's inherited defaults ONCE (n calls), not once per
    // tag — the per-tag loops below then only do small-array membership checks.
    const inherited = overrides.map((o, i) => (o ? null : (defaultsFor(filePaths[i]) || {})));

    const tagState = (allTags, category) => {
      const out = {};
      for (const tag of allTags) {
        let count = 0;
        for (let i = 0; i < overrides.length; i++) {
          const o = overrides[i];
          const effective = o ? o[category] : (inherited[i][category] || []);
          if (effective.includes(tag)) count++;
        }
        out[tag] = count === 0 ? 'unchecked' : (count === overrides.length ? 'checked' : 'indeterminate');
      }
      return out;
    };

    return {
      status,
      sampleOverride: uniform ? overrides[0] : null,
      eventTypes: tagState(allEventTypes, 'eventTypes'),
      additionalKeywords: tagState(allAdditionalKeywords, 'additionalKeywords'),
    };
  }

  // ── IPC serialization ────────────────────────────────────────────────────
  // Plain object keyed by absolute source path — the same file identity
  // GroupManager's group.files carries, so it survives Electron's structured-
  // clone IPC boundary alongside the group payload built for import:commitTransaction.
  // Returns null (not {}) when there is nothing to serialize, so callers can
  // cheaply skip persistence work.
  //
  // `filePaths` (optional) restricts the output to those files — used for EVENT_SCOPE,
  // where the scope spans the whole loaded source but a given import payload group only
  // owns the files actually being imported. Omitted for group scopes, where the scope's
  // own file set is already the payload group's.
  function serializeGroupForImport(groupId, filePaths) {
    const m = _groupMap(groupId, false);
    if (!m || m.size === 0) return null;
    const out = {};
    let any = false;
    const emit = (p, o) => { out[p] = { eventTypes: [...o.eventTypes], additionalKeywords: [...o.additionalKeywords] }; any = true; };
    if (Array.isArray(filePaths)) {
      for (const p of filePaths) { const o = m.get(p); if (o) emit(p, o); }
    } else {
      for (const [p, o] of m) emit(p, o);
    }
    return any ? out : null;
  }

  // ── Refinement mode ────────────────────────────────────────────────────────

  function isActive()         { return _activeGroupId !== null; }
  function getActiveGroupId() { return _activeGroupId; }
  /** True when the active refinement session is the single-component (no-groups) one. */
  function isEventScopeActive() { return _activeGroupId === EVENT_SCOPE; }
  function isEventScope(scopeId) { return scopeId === EVENT_SCOPE; }
  /** Bumps on every override mutation; stable across pure reads. */
  function getRevision()      { return _rev; }
  function enter(groupId)     { _activeGroupId = groupId; }
  function exit()             { _activeGroupId = null; }

  // ── Reset ──────────────────────────────────────────────────────────────────
  // Call alongside GroupManager.reset() at every one of its call sites (event
  // change, drive change, workspace reset, post-import continuation, etc.) —
  // refinement state must never leak across events/sources/sessions.

  function reset() {
    _overrides = new Map();
    _activeGroupId = null;
    _rev++;
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  // EVENT_SCOPE is included here (a plain string, not a function) so every concrete
  // instance — not just the bound facade — can be used directly by callers that hold an
  // instance reference themselves (importSession.js's per-workspace `ws.refinements`,
  // never the facade, when building a multi-event import plan — see buildPlan()).

  return {
    EVENT_SCOPE,
    isEventScope,
    isEventScopeActive,
    getRevision,
    isEligible,
    getOverride,
    setOverride,
    resetToDefault,
    clearGroup,
    clearFiles,
    groupRefinementCount,
    hasAnyOverrides,
    getSummary,
    getSelectionState,
    serializeGroupForImport,
    isActive,
    getActiveGroupId,
    enter,
    exit,
    reset,
  };

}

// ── Facade — the bound-instance singleton the rest of the renderer uses ───────
// Mirrors groupManager.js's facade exactly, with one adjustment: EVENT_SCOPE (above) is a
// plain string, not a function, so it is skipped by the generic per-key proxy loop (which
// would otherwise try to make it callable) and aliased directly instead — its value is
// identical on every instance, so aliasing once is equivalent to proxying it per-call.
const TagRefinementManager = (() => {
  let _bound = createTagRefinementManager();
  const facade = {};
  for (const key of Object.keys(_bound)) {
    if (typeof _bound[key] !== 'function') continue;
    facade[key] = (...args) => _bound[key](...args);
  }
  facade.EVENT_SCOPE = EVENT_SCOPE;
  /** Point the facade at another instance (the Current Event's). */
  facade.bind     = (instance) => { _bound = instance; };
  facade.getBound = () => _bound;
  facade.create   = createTagRefinementManager;
  return facade;
})();

// Node.js / test compatibility — no effect in the browser.
if (typeof module !== 'undefined') module.exports = TagRefinementManager;
