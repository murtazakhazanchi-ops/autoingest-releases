// renderer/tagRefinementManager.js
// ── TagRefinementManager — module singleton ─────────────────────────────────
// Per-file metadata override state for the "Per-Photo Tag Refinement" feature.
// Strictly metadata-only: never touches archive routing, folder naming, or
// GroupManager's group→component mapping. GroupManager owns which component a
// group physically routes to; this module owns an optional, finer-grained
// override of that component's Event Types / Additional Keywords for individual
// files already inside a group. A group still maps to exactly one component —
// this module never creates or implies sub-groups.
//
// Override shape (per group, per file path):
//   { eventTypes: string[], additionalKeywords: string[] }
//
// Tri-state semantics (critical — see spec):
//   no entry for a file       → inherit all of the mapped component's Event Types
//                                 + Additional Keywords (the default).
//   entry with both arrays [] → explicitly no refinable tags for this file.
//   entry with populated arrays → exactly that explicit subset.
// resetToDefault() REMOVES the entry (reverts to inheritance) — it never sets
// empty arrays, which would instead mean "explicitly no tags".
//
// File identity: the same absolute source path GroupManager uses as the unique
// file identifier within a session (see groupManager.js). Overrides are reset
// whenever GroupManager is reset, a group's component mapping changes, or a
// file moves/unassigns out of the group it was refined in — callers are
// responsible for invoking the corresponding clear*/reset methods at those
// points (see renderer.js call sites next to GroupManager.reset()/setSubEvent()/
// assignFiles()/unassignFiles()).
'use strict';

const TagRefinementManager = (() => {

  // groupId -> Map<filePath, {eventTypes:string[], additionalKeywords:string[]}>
  let _overrides = new Map();

  // Refinement-mode UI state: which group (if any) is currently being refined.
  // Purely a view concern (which group's files are shown filtered in the grid /
  // which panel is rendered) — kept here so renderer.js has one source of truth
  // for both the override data and the mode flag.
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
   * A component is eligible for Tag Refinement when it has more than one total
   * refinable tag (Event Types + Additional Keywords combined) — not merely
   * multiple Event Types. `component` is the UI-format shape returned by
   * EventCreator.getEventComps() ({ eventTypes:[{label}], additionalKeywords:[{label}] }).
   */
  function isEligible(component) {
    if (!component) return false;
    const etCount = Array.isArray(component.eventTypes) ? component.eventTypes.length : 0;
    const akCount = Array.isArray(component.additionalKeywords) ? component.additionalKeywords.length : 0;
    return (etCount + akCount) > 1;
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
  }

  /** Clears every override in a group — used when the group's component mapping changes. */
  function clearGroup(groupId) {
    _overrides.delete(groupId);
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
  }

  /** Number of files in a group carrying an explicit override (refined or explicit-none). */
  function groupRefinementCount(groupId) {
    const m = _groupMap(groupId, false);
    return m ? m.size : 0;
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
   * Effective per-tag checkbox state and an overall status for a batch of files,
   * given the mapped component's full Event Type / Additional Keyword lists. A file
   * with no override inherits ALL of `allEventTypes`/`allAdditionalKeywords` — so a
   * default file has every tag "checked" for effective-membership purposes, same as
   * an explicit all-tags override, but the two stay distinguishable via `status`.
   *
   * Read-only: never mutates any override. Callers use this purely to decide what to
   * render — selecting files, mixed or not, never changes stored state on its own.
   *
   * @param {number|string} groupId
   * @param {string[]} filePaths — the current selection, already scoped to this group
   * @param {string[]} allEventTypes
   * @param {string[]} allAdditionalKeywords
   * @returns {{
   *   status: 'empty'|'default'|'refined'|'none'|'mixed',
   *   sampleOverride: {eventTypes:string[], additionalKeywords:string[]}|null,
   *   eventTypes: Object<string,'checked'|'unchecked'|'indeterminate'>,
   *   additionalKeywords: Object<string,'checked'|'unchecked'|'indeterminate'>,
   * }}
   */
  function getSelectionState(groupId, filePaths, allEventTypes, allAdditionalKeywords) {
    if (!filePaths || filePaths.length === 0) {
      return { status: 'empty', sampleOverride: null, eventTypes: {}, additionalKeywords: {} };
    }

    const overrides = filePaths.map(p => getOverride(groupId, p));
    const _key = o => o ? JSON.stringify({ e: [...o.eventTypes].sort(), a: [...o.additionalKeywords].sort() }) : null;
    const firstKey = _key(overrides[0]);
    const uniform = overrides.every(o => _key(o) === firstKey);

    let status;
    if (!uniform) status = 'mixed';
    else if (overrides[0] === null) status = 'default';
    else if (overrides[0].eventTypes.length === 0 && overrides[0].additionalKeywords.length === 0) status = 'none';
    else status = 'refined';

    const tagState = (allTags, pick) => {
      const out = {};
      for (const tag of allTags) {
        let count = 0;
        for (const o of overrides) {
          const effective = o ? pick(o) : allTags; // no override → inherits every tag
          if (effective.includes(tag)) count++;
        }
        out[tag] = count === 0 ? 'unchecked' : (count === overrides.length ? 'checked' : 'indeterminate');
      }
      return out;
    };

    return {
      status,
      sampleOverride: uniform ? overrides[0] : null,
      eventTypes: tagState(allEventTypes, o => o.eventTypes),
      additionalKeywords: tagState(allAdditionalKeywords, o => o.additionalKeywords),
    };
  }

  // ── IPC serialization ────────────────────────────────────────────────────
  // Plain object keyed by absolute source path — the same file identity
  // GroupManager's group.files carries, so it survives Electron's structured-
  // clone IPC boundary alongside the group payload built for import:commitTransaction.
  // Returns null (not {}) when there is nothing to serialize, so callers can
  // cheaply skip persistence work.
  function serializeGroupForImport(groupId) {
    const m = _groupMap(groupId, false);
    if (!m || m.size === 0) return null;
    const out = {};
    for (const [p, o] of m) out[p] = { eventTypes: [...o.eventTypes], additionalKeywords: [...o.additionalKeywords] };
    return out;
  }

  // ── Refinement mode ────────────────────────────────────────────────────────

  function isActive()         { return _activeGroupId !== null; }
  function getActiveGroupId() { return _activeGroupId; }
  function enter(groupId)     { _activeGroupId = groupId; }
  function exit()             { _activeGroupId = null; }

  // ── Reset ──────────────────────────────────────────────────────────────────
  // Call alongside GroupManager.reset() at every one of its call sites (event
  // change, drive change, workspace reset, post-import continuation, etc.) —
  // refinement state must never leak across events/sources/sessions.

  function reset() {
    _overrides = new Map();
    _activeGroupId = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    isEligible,
    getOverride,
    setOverride,
    resetToDefault,
    clearGroup,
    clearFiles,
    groupRefinementCount,
    getSummary,
    getSelectionState,
    serializeGroupForImport,
    isActive,
    getActiveGroupId,
    enter,
    exit,
    reset,
  };

})();

// Node.js / test compatibility — no effect in the browser.
if (typeof module !== 'undefined') module.exports = TagRefinementManager;
