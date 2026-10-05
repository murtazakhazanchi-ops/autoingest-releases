# MX Console Control Transport (AI-FEAT MX Console — Phase 2)

A narrow, local-only WebSocket bridge so a **future** external process (the
Logitech MX Creative Console plugin, or any other local controller) can,
once it exists:

1. query AutoIngest's current command-layer state
2. request execution of an already-registered `AutoIngestCommands` command
3. receive AutoIngest state-change notifications

This document describes the transport built in Phase 2. **No Logitech
plugin, Actions SDK, or `.lplug4` exists yet** — see
[commandLayer.md](commandLayer.md) for the command registry this transport
sits in front of.

---

## Architecture

```
(future) Logitech plugin
      ↕  localhost WebSocket (127.0.0.1 only, ephemeral port)
services/mxControlService.js         Electron main process
      ↕  narrow, explicit IPC (mx-control:* channels — main/preload.js)
renderer/mxControlAdapter.js         renderer (sandboxed)
      ↕
AutoIngestCommands                   renderer/commandManager.js
```

The external process **never** talks to the renderer directly. The
WebSocket server lives entirely in the main process
(`services/mxControlService.js`); the renderer remains fully sandboxed
(`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` —
unchanged, see `main/main.js`'s `createMainWindow()`). The main process
reaches the renderer only through the same narrow, explicit preload
channels every other AutoIngest feature uses — no generic
`invoke(channel, args)` surface was added for this feature.

`mxControlService.js` contains no Logitech-specific code and no command
logic of its own. It is a thin, authenticated relay: it forwards
`executeCommand` requests to `AutoIngestCommands.execute()` in the renderer
(via `mxControlAdapter.js`) and relays whatever real result comes back — it
never re-implements `canExecute()`/`isValid()` eligibility itself.

---

## Localhost-only policy

The server binds to the literal string `127.0.0.1` — never `0.0.0.0`, never
a LAN address, never an IPv6 wildcard (`::`). This is a hardcoded literal in
`_startServer()` (`services/mxControlService.js`), not a configuration
option. `test/mxControlTransportLive.test.js` verifies this two ways: the
server accepts a connection on `127.0.0.1`, and (best-effort, skipped where
the sandbox has no usable second interface) a connection attempt to the
machine's own LAN IP on the same port is refused.

The port is **never hardcoded**. The service binds with `listen(0,
'127.0.0.1', ...)` and lets the OS assign a free ephemeral port, read back
via `httpServer.address().port`.

---

## Discovery

A future plugin discovers the running service by reading a small descriptor
file:

```
<userData>/mx-control.json
{
  "port": 51136,
  "token": "<64 hex chars — 256-bit random>",
  "pid": 64558,
  "protocolVersion": 1
}
```

- **Written atomically** — `services/mxControlService.js`'s
  `_writeDescriptorAtomic()` writes to `mx-control.json.tmp`, `chmod`s it to
  `0600` (POSIX; best-effort elsewhere), then `rename()`s it over the real
  path, mirroring the tmp+rename convention already used elsewhere in this
  codebase (`services/fileUtils.js`'s `safeWrite`, `services/settings.js`).
  A reader never observes a partially-written file.
- **Restrictive permissions** (`0600`, owner read/write only) where the
  platform supports POSIX modes.
- **Never placed in the archive** — it lives in Electron's own `userData`
  directory, which is process/user-local application state, never anywhere
  under an event/archive root.
- **Removed on clean shutdown.** A `before-quit` guard in `main/main.js`
  blocks the *first* `before-quit` just long enough to `await
  mxControlService.shutdown()` (which deletes the descriptor) before
  re-issuing `app.quit()` — this exists specifically because
  `window-all-closed`'s own fire-and-forget shutdown call can otherwise lose
  the race against process exit (confirmed empirically during this phase's
  own testing: a raw process kill, or an unguarded shutdown call, can leave
  the descriptor behind).
- **`pid` lets a stale descriptor be rejected.** An unclean exit (crash,
  `kill -9`, power loss) *can* still leave a stale descriptor on disk — this
  is expected, not a bug, and is exactly why `pid` is included. A future
  plugin should check whether that PID is still a live AutoIngest process
  (e.g. `process.kill(pid, 0)` on POSIX) before trusting the port/token in a
  descriptor it finds; this check is the *plugin's* responsibility and is
  intentionally not implemented on the AutoIngest side (no cross-run
  identity token is embedded beyond `pid` — see "Do not yet" below).

---

## Authentication

**Localhost alone is never treated as sufficient authentication.**

- A 256-bit token (`crypto.randomBytes(32).toString('hex')`, 64 hex chars)
  is generated fresh in memory every time the service starts.
- Never hardcoded, never committed, never persisted anywhere except the
  descriptor file for the lifetime of the running process.
- Invalid the instant the process exits — the next run generates a brand
  new one.
- Compared with `crypto.timingSafeEqual` (constant-time), not `===`.
- **Never logged**, valid or invalid — `services/mxControlService.js` logs
  only that an invalid token was presented, never its value or the real one.
- Every message before a successful `hello` is rejected
  (`{type:'error', code:'unauthenticated'}`, then the socket is closed) —
  verified live: an unauthenticated `getState` receives no application
  state whatsoever.

---

## Protocol version

`protocolVersion: 1`, a small integer independent of AutoIngest's own
application version (`package.json`'s `version` is unrelated). A client
declares its protocol version in `hello`; a mismatch is rejected with
`{type:'error', code:'protocol-mismatch', serverProtocolVersion:1}` and the
socket is closed. Bump this integer only when the wire protocol itself
changes incompatibly, never in lockstep with an AutoIngest release.

---

## Message protocol

### Incoming (client → server)

```jsonc
// 1. Authenticate — must be the first message on every connection.
{ "type": "hello", "token": "<64 hex chars>", "protocolVersion": 1 }

// 2. Ask for the current state (also arrives unsolicited — see State flow).
{ "type": "getState", "requestId": "..." }

// 3. Execute a registered AutoIngestCommands command.
{ "type": "executeCommand", "requestId": "...", "commandId": "navigation.nextFile", "payload": {} }
```

### Outgoing (server → client)

```jsonc
// Accepted hello.
{ "type": "ready", "protocolVersion": 1 }

// Rejected hello, or any other error condition.
{ "type": "error", "code": "invalid-token", "message": "Authentication failed" }

// Response to getState (requestId echoed) AND unsolicited push on a real
// change (requestId omitted) — same message shape either way.
{ "type": "state", "requestId": "...", "state": { /* AutoIngestCommands.getState() shape, see commandLayer.md */ } }

// Result of an executeCommand — result is EXACTLY what
// AutoIngestCommands.execute() resolved to in the renderer.
{ "type": "commandResult", "requestId": "...", "result": { "ok": true, "commandId": "...", "executed": true, "detail": {} } }
```

`error.code` values actually implemented:
`invalid-json`, `invalid-message`, `unauthenticated`, `invalid-token`,
`protocol-mismatch`, `already-connected`, `already-authenticated`,
`unknown-message-type`.

`commandResult.result` is passed through unmodified from
`AutoIngestCommands.execute()` — see
[commandLayer.md](commandLayer.md)'s "Result shape" for the full
`ok`/`executed`/`detail`/`reason` contract, including `reason` values
`unknown-command`, `invalid-payload`, `renderer-not-ready`,
`not-applicable`, `run-threw: ...`, plus one transport-specific addition:
`renderer-timeout` (the renderer never replied within
`COMMAND_TIMEOUT_MS` — see "Command execution flow" below).

There is **no** message type for arbitrary method invocation, renderer
property access, filesystem access, or shell execution — the protocol is
closed to exactly these three request shapes.

---

## Command allowlist

The transport invokes **only** commands already registered in
`AutoIngestCommands` (`renderer/commandManager.js`). `executeCommand`'s
`commandId`/`payload` are forwarded **opaquely** —
`services/mxControlService.js` never inspects, validates, or maintains its
own copy of which commands exist or when they're eligible. All of that
(`isValid()`, `check()`, `canExecute()`) runs exactly once, in the renderer,
inside `AutoIngestCommands.execute()` itself — the same validation every
other caller (keyboard shortcuts, context menu, this transport) goes
through. An unknown `commandId` (including deliberately hostile ones like
`"__proto__"`) resolves to the registry's own ordinary
`{ok:false, reason:'unknown-command'}` — there is no special-case handling
to bypass, and nothing resembling `eval` anywhere in this path.

---

## Phase 3E — dynamic Tag Refinement rode the transport unchanged

`tagRefinement.setTagState`/`applyToSelected` (see `docs/commandLayer.md`
"Tag Refinement — dynamic tag state") and the new `tagRefinement.tags[]`/
`event` state fields required **zero changes to this file's code**
(`services/mxControlService.js`). This is the direct, intended consequence
of "Command allowlist" and "State flow" above already being fully generic:
`executeCommand` already forwards any `commandId`/payload opaquely, and
`_broadcastStateIfChanged()` already pushes whatever `getState()` returns,
whatever shape that happens to be, deduplicated the same way regardless of
size. A larger `tags[]` array is just a larger JSON object to diff/send —
nothing about it is special-cased, and nothing needed to be. Verified
end-to-end with a real authenticated WebSocket client in
`test/mxCommandLayerPhase3ELive.test.js` (receives the real tag list/tri-
state values, executes the tag operation, receives the resulting pushed
state, executes Apply, receives the final state — all over one ordinary
connection).

---

## State flow

```
AutoIngestCommands.subscribe(...)      Phase 1B
    ↓ (renderer/mxControlAdapter.js)
ipcRenderer.send('mx-control:state-changed', state)
    ↓ (main/preload.js — narrow channel)
ipcMain.on('mx-control:state-changed', ...)   services/mxControlService.js
    ↓
connected authenticated WebSocket client (if any)
```

- **Never polled.** The renderer pushes its own state exactly when
  `AutoIngestCommands`'s Phase 1B `subscribe()` fires — the transport adds
  no interval, no `MutationObserver`, no repeated `getState()` calls of its
  own.
- **One extra push on load.** `subscribe()` only fires on the *next* change,
  so `mxControlAdapter.js` also sends one bootstrap
  `mxControlNotifyState(getState())` immediately after wiring up — this is
  what lets a client connecting shortly after the renderer loads receive
  real state instead of `null`.
- **Initial state on connect.** The moment a client authenticates, the
  service sends the current complete cached state once
  (`{type:'state', state: ...}`), before anything else happens.
- **Fail closed, never invented.** If no renderer has reported anything yet
  (service just started, splash screen still showing), the cached state is
  `null` and is sent as `null` — never fabricated. `executeCommand` behaves
  the same way: with no live main window, it resolves immediately to
  `{ok:false, reason:'renderer-not-ready'}` without ever touching the
  renderer.
- **Deduplicated.** `_broadcastStateIfChanged()` compares the new state's
  `JSON.stringify()` against the last value actually sent *to the current
  client* and skips the send if unchanged — `AutoIngestCommands`'s own
  `subscribe()` firing does not by itself guarantee content changed (see
  `commandLayer.md`), so this is a real, needed second layer, not
  redundant. The dedup marker resets whenever a client (re)authenticates,
  so a reconnecting client always gets one fresh, un-suppressed initial
  state regardless of what the previous session last saw.

---

## Command execution flow

```
WS client → { type: "executeCommand", requestId, commandId, payload }
    ↓ (services/mxControlService.js)
win.webContents.send('mx-control:execute-command', { requestId, commandId, payload })
    ↓ (renderer/mxControlAdapter.js)
AutoIngestCommands.execute(commandId, payload)
    ↓
ipcRenderer.send('mx-control:command-result', { requestId, result })
    ↓ (services/mxControlService.js — requestId-correlated pending map)
WS client ← { type: "commandResult", requestId, result }
```

- Correlated by a client-supplied `requestId` (string, required) against an
  in-memory `Map` of pending commands in `mxControlService.js`.
- `COMMAND_TIMEOUT_MS` (8s) is a safety net: if the renderer never replies —
  crashed, mid-reload — the pending entry resolves to
  `{ok:false, commandId, reason:'renderer-timeout'}` instead of hanging the
  WS client forever.
- No renderer available at all (`getMainWindow()` returns `null`/destroyed)
  → immediate `{ok:false, reason:'renderer-not-ready'}`, never forwarded
  anywhere. Fail closed, per the architecture brief.

---

## Client policy

**Exactly one authenticated client at a time.** A second connection that
sends a valid `hello` while another client is already authenticated
receives `{type:'error', code:'already-connected'}` and is closed; the
existing client is completely unaffected. Multiple *unauthenticated*
(pre-`hello`) sockets may exist briefly (capped at
`MAX_PENDING_CONNECTIONS = 5`, a trivial local-flood guard, not a real
concurrency feature) but only one can ever become the active client.

Disconnecting the active client immediately frees the slot — a reconnect
with the same token is treated as an ordinary new authenticated session
(fresh initial state, no special "resume" semantics).

---

## Rate / abuse protection

Deliberately **not** a restrictive general rate limit — an MX dial
generates legitimate rapid-fire navigation commands, and the live test
(`test/mxControlTransportLive.test.js`) proves 20 back-to-back
`executeCommand` messages all resolve individually and correctly.

What IS enforced:

- **Message size** — `ws`'s own `maxPayload: 64 * 1024` (64 KB) terminates
  a connection that sends an oversized frame. JSON command/state payloads
  are tiny; this is a sanity ceiling, not a realistic legitimate size.
- **Message-rate sanity net** — `MAX_MESSAGES_PER_WINDOW = 200` per
  `MESSAGE_WINDOW_MS = 1000`ms, per connection. Generous by design; exists
  only to stop a genuinely broken/runaway client, never to throttle real
  dial usage.
- **Connection cap** — `MAX_PENDING_CONNECTIONS = 5` unauthenticated sockets
  at once.
- **Auth timeout** — `AUTH_TIMEOUT_MS = 5000`ms to send a valid `hello`
  before the socket is dropped.
- **Malformed JSON** is caught (`try`/`catch` around `JSON.parse`) and
  rejected with `{type:'error', code:'invalid-json'}`, never left to throw
  inside an event handler.

None of these can crash the Electron process — every failure path closes
the *offending* socket only; the server and every other connection are
unaffected (verified live).

---

## Dependency choice

Added **`ws`** (`^8.20.1`) as a direct `package.json` dependency (it was
already present transitively via another package, at exactly this
version — declaring it directly makes that dependency explicit and
guarantees it's included in bundled builds rather than relying on an
incidental transitive install).

Why `ws` and not something else:
- Minimal, focused, single-purpose (a WebSocket client/server) —
  no HTTP routing framework, no middleware stack, no bundled body-parser/
  templating/session machinery.
- Mature and extremely widely used; actively maintained.
- Used here on top of a plain `http.createServer()` — no Express, no
  general-purpose web server, per the architecture brief.

---

## Lifecycle

- **Starts** in `main/main.js`'s `app.whenReady()` handler, independent of
  whether a main window exists yet (`getMainWindow` is a lazily-evaluated
  getter closure over a module-level `_mxMainWin` reference, set when
  `splash:complete` creates the real main window and cleared when that
  window closes).
- **Re-armed on `activate`** (macOS reopen from the dock) — `init()` is
  idempotent, so this is a safe no-op if the service is still running, and
  a real restart if `window-all-closed` had already shut it down.
- **Stops** two ways, both calling the same idempotent
  `mxControlService.shutdown()`:
  - `window-all-closed` (fire-and-forget, matching this codebase's existing
    convention for `telemetry.flush()`/`exifService.shutdown()`/etc.).
  - A dedicated `before-quit` guard (see "Discovery" above) that actually
    *awaits* shutdown before letting the app exit — added specifically
    because the fire-and-forget path alone was empirically shown, during
    this phase's own testing, to sometimes lose the race against process
    exit and leave the descriptor behind.
- **Never blocks or crashes startup.** `mxControlService.init(...)` is
  wrapped in `.catch(err => log(...))` in `main.js` — if the loopback server
  somehow fails to start, AutoIngest still starts normally; the control
  surface is simply unavailable (`services/mxControlService.js` is
  optional infrastructure, not core app functionality).
- **Tolerates renderer reload/reconnect.** `mxControlAdapter.js` re-runs
  and re-wires (including a fresh bootstrap state push) whenever the
  renderer reloads — verified live by reloading the main window mid-test
  and confirming a fresh state arrives afterward.
- **Tolerates plugin disconnect/reconnect.** Disconnecting simply frees the
  single-client slot (see "Client policy"); no server-side session state
  survives a disconnect to reconnect against.

---

## Security model summary

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` —
  unchanged (`main/main.js`).
- The renderer is never reachable from the WebSocket client directly; every
  interaction crosses through `services/mxControlService.js`'s own message
  handling and the existing narrow, explicit `mx-control:*` preload
  channels (`mxControlNotifyState`, `onMxControlExecuteCommand`,
  `mxControlSendCommandResult`) — no `window.api.invokeAny(channel, args)`
  style generic surface was added.
- No new arbitrary IPC channel, no filesystem access exposed, no shell
  execution, no `eval`/dynamic code execution anywhere in this path.
- Binds to `127.0.0.1` only; never `0.0.0.0`, a LAN address, or an IPv6
  wildcard.
- A high-entropy, in-memory-only, never-logged token gates every request;
  localhost alone is never sufficient.

---

## Future Logitech plugin responsibilities

**The Logitech plugin is a client of AutoIngest's control interface. It
does not own any AutoIngest state.** Concretely, it does not own:

- selection
- group state
- QMZ state
- import state
- archive state

**AutoIngest remains authoritative** for all of the above at all times. The
plugin's job is limited to: discover the descriptor, authenticate, render
its own UI from `state` pushes, and request commands — exactly the same
three things any other future local controller could do through this same
transport. It must:

- Read `<userData>/mx-control.json` to discover `port`/`token`, and check
  `pid` is a live AutoIngest process before trusting a descriptor it finds
  (see "Discovery").
- Never guess, cache independently, or reconstruct AutoIngest state from
  anything other than the `state` messages this transport sends.
- Never assume a specific QMZ code format beyond
  `main/qmzService.js`'s own `SEQ_RE` (2 digits + Q/M/Z) — see
  `commandLayer.md`'s `qmz.assignToSequence` section.
- Treat every `commandResult` as the sole source of truth for whether its
  requested action actually happened (`executed`/`reason`), never assume
  success from having merely sent the request.

---

## What Phase 2 explicitly does NOT do

- No Logitech Actions SDK, no `.lplug4`, no plugin project, no keypad
  layouts, no MX icons, no Actions Ring.
- No Archive Maintenance / Event Maintenance exposure.
- No `import.start` or any import-execution command (unchanged from
  Phase 1B — see `commandLayer.md`).
- No merge to `main` or `stable/0.9`; no publish.
