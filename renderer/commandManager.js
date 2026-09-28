// renderer/commandManager.js
// ── AutoIngestCommands — internal command registry (Phase 1A) ──────────────
//
// A small, explicit abstraction so external controllers (the future
// Logitech MX Creative Console plugin, keyboard shortcuts, or any other
// hardware controller) can invoke existing AutoIngest behavior WITHOUT
// simulating DOM clicks, depending on CSS selectors, duplicating business
// logic, or bypassing GroupManager/selection/import safety.
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

  /** Returns the live bridge, or null if renderer.js hasn't finished
   * loading yet (e.g. a command fired during startup). Never throws. */
  function _bridge() {
    return (typeof window !== 'undefined' && window.__autoIngestRendererBridge) || null;
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
  };

  // QMZ and Import commands are deferred for Phase 1A — see
  // docs/commandLayer.md "Deferred commands" for exactly why.

  // ── Registry API ─────────────────────────────────────────────────────────

  function getCommands() {
    return Object.keys(COMMANDS);
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
    const def = COMMANDS[commandId];
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

    const def    = COMMANDS[commandId];
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

  return { execute, canExecute, getCommands };
})();

if (typeof window !== 'undefined') {
  window.AutoIngestCommands = AutoIngestCommands;
}
