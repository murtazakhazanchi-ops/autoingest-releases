'use strict';

// MX Console control transport — renderer-side glue (AI-FEAT MX Console
// Phase 2). Wires AutoIngestCommands (renderer/commandManager.js) to the
// main-process control service (services/mxControlService.js) through the
// narrow, explicit mx-control:* preload channels ONLY. Contains no Logitech
// code and no transport logic of its own — see docs/mxControlTransport.md.
//
// Must load after commandManager.js (see index.html): it only calls
// window.AutoIngestCommands and window.api — never window internals
// directly, never AutoIngest state directly.

(function () {
  function _wire() {
    if (typeof window.AutoIngestCommands !== 'object' || !window.AutoIngestCommands) return false;
    if (!window.api || typeof window.api.mxControlNotifyState !== 'function') return false;

    // Push AutoIngest's own state to main every time it genuinely changes —
    // event-driven via Phase 1B's subscribe(), never polled here either.
    window.AutoIngestCommands.subscribe((state) => {
      try { window.api.mxControlNotifyState(state); }
      catch (err) { console.error('[mxControlAdapter] notifyState failed:', err); }
    });

    // subscribe() only fires on the NEXT change — push one bootstrap
    // snapshot now so the control service has real state (not null) as
    // early as possible, before any external client could plausibly connect.
    try { window.api.mxControlNotifyState(window.AutoIngestCommands.getState()); }
    catch (err) { console.error('[mxControlAdapter] bootstrap notifyState failed:', err); }

    // Relay a main-process-forwarded executeCommand request straight into
    // AutoIngestCommands.execute() — the ONLY command entry point, so
    // isValid()/check() validation is never duplicated or bypassed here —
    // and send the real, awaited result back for the WS client.
    if (typeof window.api.onMxControlExecuteCommand === 'function') {
      window.api.onMxControlExecuteCommand(async ({ requestId, commandId, payload }) => {
        let result;
        try {
          result = await window.AutoIngestCommands.execute(commandId, payload);
        } catch (err) {
          // AutoIngestCommands.execute() already catches internally and
          // never throws in practice (see docs/commandLayer.md) — this is
          // an extra safety net so a truly unexpected error still resolves
          // the pending WS request instead of hanging it until the main
          // process's own renderer-timeout fires.
          result = { ok: false, commandId, reason: `adapter-threw: ${err.message}` };
        }
        window.api.mxControlSendCommandResult(requestId, result);
      });
    }

    return true;
  }

  if (!_wire()) {
    console.error('[mxControlAdapter] AutoIngestCommands/window.api not ready — MX control bridge not wired');
  }
})();
