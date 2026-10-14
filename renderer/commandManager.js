// renderer/commandManager.js
// ── AutoIngestCommands — internal command registry (Phase 1A + 1B) ─────────
//
// A small, explicit abstraction so external controllers (the future
// Logitech MX Creative Console plugin, keyboard shortcuts, or any other
// hardware controller) can invoke existing AutoIngest behavior WITHOUT
// simulating DOM clicks, depending on CSS selectors, duplicating business
// logic, or bypassing GroupManager/QMZ/ImportSession/selection/import safety.
//
// Phase 1B adds observability on top of Phase 1A's execute()/canExecute():
// getContext()/getState()/getAvailableCommands() so a future adapter can
// read compact, authoritative state instead of guessing, and subscribe()
// so it can react to changes instead of polling. Still no transport, no
// Logitech code — see docs/commandLayer.md.
//
// Architecture:
//   (future) MX Creative Console
//         -> (future) Logitech Actions SDK Plugin
//         -> AutoIngestCommands (this file)
//         -> renderer.js's window.__autoIngestRendererBridge
//         -> existing authoritative renderer functions/state
//
// This file contains NO Logitech-specific code and no transport of any
// kind (no WebSocket/HTTP server) — see docs/commandLayer.md. It only
// calls window.__autoIngestRendererBridge, never renderer.js internals
// directly, and never Node/Electron APIs (contextIsolation/sandbox stay
// intact — this file runs in the same isolated renderer world as
// renderer.js and only ever touches window.api indirectly, through the
// bridge, exactly as renderer.js already does).
//
// Load order: this script MUST be loaded after renderer.js (and after
// groupManager.js, which renderer.js itself depends on) — see index.html.
'use strict';

const AutoIngestCommands = (() => {

  // ── State-change subscription (Phase 1B) ────────────────────────────────
  // Owned entirely here, not in renderer.js: renderer.js's small set of
  // already-shared sync/refresh functions (syncAllTiles, _setPreviewFocus,
  // openPreview/closePreview, syncAllGroupBadges, the QMZ equivalents,
  // _qmzRefresh, _closeQMZManager, and the import-start/end points — see
  // "COMPACT STATE DERIVATION" in renderer.js) each call
  // bridge.notifyStateChange() after the state they own changes. That
  // function is a no-op until _bridge() below overwrites it with _notify
  // the first time this module talks to the bridge — no polling, no
  // MutationObserver, no dependency on WHEN renderer.js finishes loading
  // relative to this file (which is guaranteed anyway — see load order
  // above — this is just defensive).
  const _listeners = new Set();
  let _bridgeWired = false;

  /** Returns the live bridge, or null if renderer.js hasn't finished
   * loading yet (e.g. a command fired during startup). Never throws.
   * Also wires this module's _notify into the bridge's notification slot,
   * exactly once, the first time the bridge is genuinely available. */
  function _bridge() {
    const bridge = (typeof window !== 'undefined' && window.__autoIngestRendererBridge) || null;
    if (bridge && !_bridgeWired) {
      bridge.notifyStateChange = _notify;
      _bridgeWired = true;
    }
    return bridge;
  }

  /**
   * Subscribes to compact state-change notifications (see getState() for
   * the shape). Fires after any command-visible state change — from a
   * command, a keyboard shortcut, or a plain mouse click; see the ownership
   * note above.
   * @param {(state: object) => void} listener
   * @returns {() => void} an unsubscribe function.
   */
  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('AutoIngestCommands.subscribe: listener must be a function');
    }
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }

  /** Fans the current state out to every subscriber. Iterates a snapshot so
   * a listener unsubscribing itself (or another listener) mid-notify never
   * skips/double-calls anyone; one listener throwing never stops the rest. */
  function _notify() {
    const state = getState();
    for (const fn of [..._listeners]) {
      try {
        fn(state);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[AutoIngestCommands] a state-change listener threw:', err);
      }
    }
  }

  // ── Command definitions ─────────────────────────────────────────────────
  // Each entry:
  //   run(payload, bridge)         -> the actual effect. May return any
  //                                    JSON-safe value as extra detail.
  //   isValid(payload)             -> optional. Rejects a malformed payload
  //                                    BEFORE run() is ever called.
  //   check(payload, bridge)       -> optional. True if the command is
  //                                    currently meaningful, given live
  //                                    renderer context (selection size,
  //                                    active file, which screen is open,
  //                                    blocking overlays). Commands with no
  //                                    check() are always considered valid
  //                                    to attempt (run() itself still fails
  //                                    safely with nothing to do).
  //   computeExecuted(result)      -> optional. For a command whose run()
  //                                    returns a plain detail object rather
  //                                    than a boolean/nullable id, derives
  //                                    `executed` from it explicitly instead
  //                                    of execute()'s generic `!= null`
  //                                    fallback (which would be wrong for an
  //                                    always-non-null object).
  //
  // Grouped by area to match the console pages this will eventually back:
  // Browse (navigation/selection/preview) and Group (grouping). QMZ and
  // Import commands are intentionally deferred — see docs/commandLayer.md.
  const COMMANDS = {

    'navigation.nextFile': {
      check: () => true, // always attemptable; run() no-ops safely at a boundary
      run: (_p, b) => b.navigateActiveFile(1),
    },
    'navigation.previousFile': {
      check: () => true,
      run: (_p, b) => b.navigateActiveFile(-1),
    },

    'selection.toggleCurrent': {
      check: (_p, b) => b.getActiveFilePath() !== null,
      run: (_p, b) => b.toggleSelectionForActiveFile(),
    },
    'selection.selectAll': {
      check: (_p, b) => b.getVisibleFileCount() > 0,
      run: (_p, b) => b.selectAllVisible(),
    },
    'selection.clear': {
      check: (_p, b) => b.getSelectionSize() > 0,
      run: (_p, b) => b.clearSelection(),
    },

    'preview.toggle': {
      check: (_p, b) => b.isPreviewOpen() || b.getActiveFilePath() !== null,
      run: (_p, b) => b.togglePreviewForActiveFile(),
    },

    // payload: { groupId?: number | null }. Omitted/null groupId always
    // creates a new group (mirrors the context menu's "New Group" action).
    // A groupId that doesn't currently exist also creates a new group
    // (mirrors the Cmd+G digit-chord's existing behavior) — see
    // _assignSelectionToGroup in renderer.js. `detail` is
    // { groupId, claim }: `claim` mirrors the Cmd+G chord's own Multi-Event
    // Import claim-tracking (null, or { reassigned, fromOrdinals } when
    // files were reassigned away from another event's workspace by this
    // assignment) — see renderer.js's bridge.assignSelectionToGroup.
    'group.assign': {
      isValid: (p) => p === undefined || p === null ||
        (typeof p === 'object' && (p.groupId === undefined || p.groupId === null || Number.isInteger(p.groupId))),
      check: (_p, b) => !b.isQmzOpen() && b.getSelectionSize() > 0,
      run: (p, b) => b.assignSelectionToGroup(p && p.groupId != null ? p.groupId : null),
      computeExecuted: (result) => !!result && result.groupId != null,
    },
    'group.unassign': {
      check: (_p, b) => !b.isQmzOpen() && b.getSelectionSize() > 0,
      run: (_p, b) => b.unassignSelectionFromGroup(),
    },

    // Maps an existing group to one of the active event's real sub-events/
    // components — the console-driven equivalent of the Group Panel's own
    // sub-event dropdown (AI-FEAT MX Console Phase 4C). Only meaningful for
    // multi-component events (getAvailableSubEvents() is [] otherwise, same
    // "command unavailable where the concept doesn't exist" convention the
    // Tag Refinement commands already use). groupId is an explicit payload
    // field, same shape as group.assign — the CALLER (the C# dynamic
    // workspace) resolves which group via resolveTargetGroupForMapping()
    // before sending, never this command itself.
    'group.setSubEvent': {
      isValid: (p) => !!p && typeof p === 'object'
        && Number.isInteger(p.groupId)
        && typeof p.subEventId === 'string' && p.subEventId.length > 0,
      check: (_p, b) => !b.isQmzOpen() && b.getAvailableSubEvents().length > 0,
      run: (p, b) => b.setGroupSubEvent(p.groupId, p.subEventId),
      // run() resolves to a real boolean (true = applied, false = rejected:
      // unknown group, stale/unknown subEventId, duplicate already taken by
      // another group, or the operator cancelled the real "clear
      // refinements?" confirmation) — a well-formed-but-rejected payload is
      // NOT a check() failure, same established lesson as
      // tagRefinement.setTagState/qmz.assignToSequence above.
      computeExecuted: (result) => result === true,
    },

    // payload: { sequenceCode: string }, e.g. "01Q", "12M", "52Z" — exactly
    // main/qmzService.js's own SEQ_RE format (2 digits + Q/M/Z; there is no
    // lowercase-suffix variant anywhere in the current QMZ implementation —
    // see docs/commandLayer.md "QMZ — qmz.assignToSequence" for the
    // Phase 1B investigation that confirmed this before writing this regex).
    // Never creates the sequence and never guesses a type: the code must
    // already exist in the live QMZ workspace (bridge.qmzAssignSelectionToSequence
    // -> _qmzAssignSelectionToSequenceCode's own existence check).
    'qmz.assignToSequence': {
      isValid: (p) => !!p && typeof p === 'object' &&
        typeof p.sequenceCode === 'string' && /^\d{2}[QMZ]$/.test(p.sequenceCode),
      check: (_p, b) => b.isQmzOpen() && b.getSelectionSize() > 0,
      run: (p, b) => b.qmzAssignSelectionToSequence(p.sequenceCode),
      // Same lesson as group.assign: run() resolves to a plain boolean here
      // (true only if a real, existing sequence code was matched and the
      // move was attempted), but `false` is still != null, so the generic
      // `result != null` fallback would wrongly report executed:true for a
      // well-formed payload naming a sequence that doesn't exist. A
      // nonexistent code is a normal "ran, nothing to do" outcome (check()
      // deliberately does not inspect the payload to pre-reject it — see
      // the comment above isValid — so this must resolve here instead).
      computeExecuted: (result) => result === true,
    },

    // ── Tag Refinement (Phase 3D) ────────────────────────────────────────
    // See docs/commandLayer.md "Tag Refinement commands" for the full
    // investigation this grouping is built from (renderer/tagRefinementManager.js
    // + the "Tag Refinement mode" section of renderer.js). Phase 3D rejected
    // `applyToSelected`/`toggleTag` verbatim (the real Apply button commits
    // whichever tags are checked in the DOM — nothing a hardware payload
    // could specify yet); Phase 3E adds the missing piece — an explicit,
    // renderer-owned draft (`setTagState`) — then implements `applyToSelected`
    // properly on top of it. See "Tag Refinement — dynamic tag state
    // (Phase 3E)" in commandLayer.md.
    'tagRefinement.open': {
      // isRefinementTargetAvailable() mirrors _resolveRefinementTargetScope()
      // != null — the exact same resolution run() uses, evaluated for
      // availability rather than effect. Not a second eligibility table.
      check: (_p, b) => b.isRefinementTargetAvailable(),
      run: (_p, b) => b.openTagRefinementForSelection(),
    },
    'tagRefinement.close': {
      check: (_p, b) => b.isTagRefinementActive(),
      run: (_p, b) => b.closeTagRefinement(),
    },
    // The real, parameter-free replacement for the brief's rejected
    // `applyToSelected` candidate — see commandLayer.md for why "whatever
    // tags happen to be checked in the panel" cannot be a hardware command.
    'tagRefinement.useAllTags': {
      check: (_p, b) => b.isTagRefinementActive() && b.getTagRefinementSelectedCount() > 0,
      run: (_p, b) => b.applyAllTagsToRefinementSelection(),
      // run() resolves to a file count (0 is a normal no-op), not a boolean —
      // same lesson as group.assign/qmz.assignToSequence above.
      computeExecuted: (result) => result > 0,
    },
    'tagRefinement.clearSelected': {
      check: (_p, b) => b.isTagRefinementActive() && b.getTagRefinementSelectedCount() > 0,
      run: (_p, b) => b.resetRefinementSelectionToDefault(),
      computeExecuted: (result) => result > 0,
    },
    // Sets one tag's desired draft state — the dynamic-keypad primitive
    // (Phase 3E). payload.tagId is the composite canonical identity
    // ("<category>:<label>", e.g. "eventTypes:Waaz" — the real system has
    // no separate tag ID; see state.tagRefinement.tags[].id). A well-formed
    // but unknown/stale/wrong-category tagId is NOT rejected by check() —
    // existence is a payload-dependent fact, not context eligibility, same
    // established rule as qmz.assignToSequence's nonexistent-code case — it
    // genuinely runs, is rejected internally, and resolves to
    // { ok: true, executed: false }, never mutating anything.
    'tagRefinement.setTagState': {
      isValid: (p) => !!p && typeof p === 'object' && typeof p.tagId === 'string' && p.tagId.length > 0 && typeof p.checked === 'boolean',
      check: (_p, b) => b.isTagRefinementActive() && b.getTagRefinementSelectedCount() > 0,
      run: (p, b) => b.setRefinementTagState(p.tagId, p.checked),
      // run() already resolves to a real boolean (true = applied, false =
      // rejected) — the generic fallback handles it correctly as-is.
    },
    // Commits the EFFECTIVE (draft-aware) tag state to the real
    // TagRefinementManager — exactly what the panel's own Apply button does.
    // check() mirrors that button's own disabled-state rule EXACTLY
    // (isRefinementApplyBlocked -> the real _rpApplyBlocked), not an
    // approximation of it — see commandLayer.md.
    'tagRefinement.applyToSelected': {
      check: (_p, b) => b.isTagRefinementActive() && !b.isRefinementApplyBlocked(),
      run: (_p, b) => b.applyEffectiveRefinementToSelection(),
      computeExecuted: (result) => result > 0, // a file count, same lesson as useAllTags/clearSelected above
    },

    // ── Change Event (Phase 3D) ──────────────────────────────────────────
    // Opens the real event chooser/creator (openEventPickerFromWorkspace) —
    // the operator still picks the target event from the real on-screen
    // list. See docs/commandLayer.md "Change Event — event.openChooser" for
    // why no command encodes a specific target event.
    'event.openChooser': {
      // Mirrors group.assign/group.unassign's own "!isQmzOpen()" gate — QMZ
      // is a separate full-screen overlay the context bar (and this button)
      // is already unreachable from, same established pattern, not a new
      // rule invented for this command.
      check: (_p, b) => !b.isQmzOpen() && !b.isImportRunning(),
      run: (_p, b) => b.openEventChooser(),
    },
  };

  // Import commands (import.start/confirm) are deferred for Phase 1B — see
  // docs/commandLayer.md "Deferred commands" for exactly why.

  // ── Registry API ─────────────────────────────────────────────────────────

  /**
   * Safe registry lookup — COMMANDS is a plain object literal, so a naive
   * COMMANDS[commandId] resolves inherited Object.prototype members for
   * commandId values like "__proto__", "toString", "constructor", etc.,
   * returning a truthy non-command object instead of undefined and letting
   * an attacker-controlled commandId slip past the "!def -> unknown-command"
   * check. Found live via test/mxControlTransportLive.test.js (Phase 2)
   * sending commandId:"__proto__" over the WS transport — exactly the kind
   * of untrusted string this registry must reject outright, not partially
   * execute against. hasOwnProperty restricts the lookup to COMMANDS' own
   * registered entries only.
   */
  function _lookupCommand(commandId) {
    return Object.prototype.hasOwnProperty.call(COMMANDS, commandId) ? COMMANDS[commandId] : undefined;
  }

  function getCommands() {
    return Object.keys(COMMANDS);
  }

  /**
   * Command ids currently eligible to attempt, given live renderer state —
   * the SAME check(payload, bridge) predicate canExecute() itself calls for
   * each command (not a second eligibility table). Evaluated with an
   * undefined payload: every command's check() in this registry only reads
   * bridge/context state, never the payload (payload-shape validity is
   * isValid()'s job, evaluated separately inside canExecute()) — so a
   * parameterized command like group.assign or qmz.assignToSequence still
   * appears here whenever its general context is valid (selection present,
   * right screen open), even with no specific groupId/sequenceCode chosen
   * yet. A caller must still call canExecute(commandId, payload) with the
   * REAL payload before executing — this list is a discovery aid, not a
   * pre-validated payload-free execute() shortcut.
   * @returns {string[]}
   */
  function getAvailableCommands() {
    const bridge = _bridge();
    if (!bridge) return [];
    return Object.entries(COMMANDS)
      .filter(([, def]) => {
        if (!def.check) return true;
        try {
          return !!def.check(undefined, bridge);
        } catch {
          return false;
        }
      })
      .map(([id]) => id);
  }

  /** "browse" | "import" | "qmz" — see renderer.js's _getCommandContext for
   * exactly which state each is derived from and why there is no separate
   * "group" context. Returns null if the renderer isn't ready yet. */
  function getContext() {
    return _bridge()?.getContext() ?? null;
  }

  /**
   * Compact, read-only, JSON-safe snapshot of everything a future console
   * page needs: never a Set, DOM node, or large file array. See
   * docs/commandLayer.md "State schema" for the authoritative field list —
   * every field is read fresh from the bridge on each call (or each
   * subscribe() notification), nothing here is cached.
   * @returns {object|null} null if the renderer isn't ready yet.
   */
  function getState() {
    const bridge = _bridge();
    if (!bridge) return null;
    const context = bridge.getContext();
    const selectedCount = bridge.getSelectionSize();
    const state = {
      context,
      activeFile: bridge.getActiveFilePath(),
      selectedCount,
      hasSelection: selectedCount > 0,
      previewOpen: bridge.isPreviewOpen(),
      availableCommands: getAvailableCommands(),
    };
    // Group state and QMZ sequence state are mutually exclusive by
    // construction (GroupManager has no QMZ concept, QMZ has no groups) —
    // exposed only for the context where each is meaningful, matching
    // the compactness requirement rather than always sending both.
    if (context === 'qmz') {
      state.sequences = bridge.getQmzSequencesCompact();
    } else {
      state.groups = bridge.getGroupsCompact();
      // Phase 4C: only present for a multi-component event (the only
      // context group.setSubEvent is ever meaningful in) — omitted
      // entirely, not sent as [], matching getState()'s existing
      // compactness convention (see tagRefinement/event below).
      const subEvents = bridge.getAvailableSubEvents();
      if (subEvents.length > 0) {
        state.availableSubEvents = subEvents;
        // Only meaningful alongside availableSubEvents itself — resolved
        // authoritatively here (same rule tagRefinement.open's own
        // group-scope resolution uses), so the C# dynamic workspace never
        // has to re-derive "which group does this selection target" itself.
        state.targetGroupIdForMapping = bridge.resolveTargetGroupForMapping();
      }
    }
    // Tag Refinement and the active event are both browse-only concepts in
    // the current codebase (refinement mode can only be entered from browse;
    // "Change Event" from the workspace is unreachable from qmz/import) — see
    // docs/commandLayer.md "State schema (Phase 3D additions)". Present only
    // when meaningful, same convention as groups/sequences above, and each
    // omitted entirely (not `null`) rather than always present-but-null, to
    // match getState()'s existing compactness convention.
    if (context === 'browse') {
      const tr = bridge.getTagRefinementCompact();
      if (tr) state.tagRefinement = tr;
      const ev = bridge.getEventStateCompact();
      if (ev) state.event = ev;
    }
    return state;
  }

  /**
   * @param {string} commandId
   * @param {*}      [payload]
   * @returns {{ ok: boolean, commandId: string, reason?: string }}
   *   ok=true does not guarantee the command changed anything — see execute()'s
   *   `executed` flag for that. ok=false means the command could not even be
   *   attempted (unknown id, malformed payload, or check() failed).
   */
  function canExecute(commandId, payload) {
    const def = _lookupCommand(commandId);
    if (!def) return { ok: false, commandId, reason: 'unknown-command' };
    if (def.isValid && !def.isValid(payload)) {
      return { ok: false, commandId, reason: 'invalid-payload' };
    }
    const bridge = _bridge();
    if (!bridge) return { ok: false, commandId, reason: 'renderer-not-ready' };
    if (def.check) {
      let checkOk;
      try {
        checkOk = !!def.check(payload, bridge);
      } catch (err) {
        return { ok: false, commandId, reason: 'check-threw: ' + (err && err.message) };
      }
      if (!checkOk) return { ok: false, commandId, reason: 'not-applicable' };
    }
    return { ok: true, commandId };
  }

  /**
   * Executes a command. Always returns a Promise (some underlying
   * operations — e.g. navigation while the preview overlay is open — are
   * genuinely async; awaiting a synchronous command's result is a no-op).
   * Never throws or rejects — every failure mode (unknown command,
   * malformed payload, inapplicable context, or a thrown/rejected error
   * deep inside an existing renderer function) is reported in the resolved
   * value instead.
   * @param {string} commandId
   * @param {*}      [payload]
   * @returns {Promise<{ ok: boolean, commandId: string, executed?: boolean, detail?: *, reason?: string }>}
   *   ok=false     -> command was not run at all (see reason).
   *   ok=true,
   *   executed=false -> the command ran but had nothing to do (e.g.
   *                      navigation at a boundary, an empty selection) —
   *                      this is a normal, non-error outcome.
   *   ok=true,
   *   executed=true  -> the command ran and had an effect. `detail` carries
   *                      whatever JSON-safe value the underlying function
   *                      returned (e.g. the assigned group id), if any.
   */
  async function execute(commandId, payload) {
    const gate = canExecute(commandId, payload);
    if (!gate.ok) return gate;

    const def    = _lookupCommand(commandId);
    const bridge = _bridge();
    try {
      // run() may be sync or async, and may return a plain boolean ("did
      // something happen") or a non-boolean detail value (e.g.
      // group.assign's assigned id) — awaiting a non-Promise is a no-op,
      // so this handles both uniformly.
      const result = await def.run(payload, bridge);
      if (def.computeExecuted) {
        return { ok: true, commandId, executed: !!def.computeExecuted(result), detail: result };
      }
      if (typeof result === 'boolean') {
        return { ok: true, commandId, executed: result };
      }
      return { ok: true, commandId, executed: result != null, detail: result };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[AutoIngestCommands] ${commandId} threw:`, err);
      return { ok: false, commandId, reason: 'run-threw: ' + (err && err.message) };
    }
  }

  return {
    execute,
    canExecute,
    getCommands,
    getAvailableCommands,
    getContext,
    getState,
    subscribe,
  };
})();

if (typeof window !== 'undefined') {
  window.AutoIngestCommands = AutoIngestCommands;
}
