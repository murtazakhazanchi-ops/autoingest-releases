# MX Logitech Plugin (AI-FEAT MX Console — Phase 3A)

The first real Logitech MX Creative Console plugin — an integration/smoke-test
milestone proving physical end-to-end control, not the final console UX. It
connects to AutoIngest's existing Phase 2 control transport
(`services/mxControlService.js` — see
[mxControlTransport.md](mxControlTransport.md)) and exposes three of
`AutoIngestCommands`' commands on real hardware: the main dial and one LCD
key (two, optionally).

---

## Plugin location

```
integrations/
  logitech/
    autoingest-mx/          the plugin — its own package.json/node_modules,
                             logically separate from the AutoIngest app
      index.ts               entry point — registers actions, connects
      src/
        descriptor.ts         cross-platform descriptor discovery/validation
        autoIngestClient.ts    connection manager (the AutoIngestClient)
        sharedClient.ts        the one shared AutoIngestClient instance
        actions/
          toggleSelectionAction.ts
          navigateFilesAction.ts
          previewAction.ts
      test/
        descriptor.test.ts               unit tests
        autoIngestClient.integration.test.ts   integration tests (real transport)
      package/                Logitech plugin metadata + icons
        metadata/LoupedeckPackage.yaml
        actionicons/*.svg
        actionsymbols/*.svg
```

`integrations/` was chosen over, say, a top-level `plugins/` directory
because it's an accurate name for what this is — a companion integration
with a third-party platform — and keeps room for other future integrations
without implying they belong inside the AutoIngest app itself. The AutoIngest
Electron app remains vanilla JS; only this companion plugin uses TypeScript
and the SDK's generated project structure. No Logitech SDK package was added
to the main AutoIngest `package.json` — the plugin owns its own
`package.json`/`node_modules`/`package-lock.json` entirely.

---

## SDK / toolkit versions

- `@logitech/plugin-toolkit`: **0.1.1** (scaffolding CLI — `npx
  @logitech/plugin-toolkit create autoingest-mx`)
- `@logitech/plugin-sdk`: **0.1.1** (runtime library the plugin imports)
- Both are genuinely early/beta (0.1.x) — see "Known limitations" below.

## Development prerequisites (verified on this machine)

| Item | Found |
|---|---|
| macOS | 26.4.1, arm64 (Apple M3 Pro) |
| Node.js | v24.14.1 (SDK requires `>=22.0.0` — satisfied) |
| npm | 11.11.0 |
| Logi Options+ | 2.7.961922, installed and running |
| Logi Plugin Service | `LogiPluginService.app` 6.4.1.3246, installed — **not running by default**; must be started explicitly (`open -a "/Applications/Utilities/LogiPluginService.app"`) or triggered by opening the device configuration screen in Options+ |
| MX Creative Console | Detected via USB (`ioreg` reports `"MX Creative Keypad"`, vendor `Logitech`) once physically connected — not detected at all before that (confirmed empirically, not assumed) |

The underlying plugin runtime is genuinely built on the former **Loupedeck**
platform (Logitech's acquisition) — evidenced by `LoupedeckPackage.yaml` as
the manifest filename, `LoupedeckSettings.ini`, and
`~/Library/Application Support/Logi/LogiPluginService/Applications/Loupedeck7x/`
directories present on a machine with prior Logitech plugin activity.

---

## Build / watch workflow

```bash
cd integrations/logitech/autoingest-mx
npm install            # plugin's own, isolated node_modules
npm run build           # typecheck + tsup -> dist/
npm run link             # symlinks dist/ into Logi Plugin Service's Plugins folder
npm run watch            # typecheck + tsup --watch; unlinks cleanly on Ctrl+C
npm run unlink           # removes the symlink
npm run build:pack       # production build + .lplug4 package (not used in Phase 3A)
```

`npm run link` creates:

```
~/Library/Application Support/Logi/LogiPluginService/Plugins/AutoingestMx
  -> integrations/logitech/autoingest-mx/dist
```

It also attempts a `loupedeck://plugin/AutoingestMx/reload` deeplink to hot-
reload an already-running Plugin Service; this fails harmlessly
(`kLSApplicationNotFoundErr`) if the service isn't running yet — start it
first, or just restart it after linking.

### Tests

```bash
npm run test:unit          # 17 checks — descriptor.ts, isolated temp dirs only
npm run test:integration   # 13 checks — real AutoIngest app + real transport
npm test                    # compile (real tsc) + both suites
```

**Why real `tsc`, not `tsx`, runs the tests** (see "Known limitations"
below): `tsc -p tsconfig.test.json` compiles `src/` + `test/` to
`dist-test/` (gitignored), then plain `node` runs the compiled output.

---

## Descriptor discovery

Implemented in `src/descriptor.ts`. Tries, in order, on the current OS:

- macOS: `~/Library/Application Support/auto-ingest/mx-control.json` (dev/
  unpackaged run — the app's `package.json` `"name"`, confirmed empirically
  against a real running unpackaged instance: `app.getName()` returns
  `"auto-ingest"` there), then `~/Library/Application Support/AutoIngest/mx-control.json`
  (packaged build — electron-builder's `productName`).
- Windows: the same two names under `%APPDATA%`.

Never hardcodes a username or absolute path — always derived from
`os.homedir()` (or a test-only override — see below). Every failure mode
(`missing`, `invalid-json`, `invalid-shape`, `stale-pid`, `unreadable`) is a
typed `DescriptorError`, never a raw exception — `AutoIngestClient` treats
all of them identically, as "AutoIngest unavailable right now."

`isProcessAlive(pid)` (via `process.kill(pid, 0)`) rejects a descriptor whose
`pid` isn't a running process before ever attempting a connection — confirmed
necessary in practice, not theoretical: a raw process kill during Phase 2's
own testing left a stale descriptor on disk (see mxControlTransport.md).

A `homeOverride` parameter threads through `candidateUserDataDirs()` →
`findDescriptorPath()` → `discoverDescriptor()` → `AutoIngestClient`'s
constructor, used **only by tests**, so discovery can be pointed at an
isolated synthetic "home" directory without monkey-patching `os.homedir()`
or ever touching real user settings.

---

## AutoIngestClient architecture

`src/autoIngestClient.ts` — the connection manager every action calls
through (`src/sharedClient.ts` holds the one shared instance):

```ts
class AutoIngestClient {
  connect(): Promise<void>
  disconnect(): void
  executeCommand(commandId, payload?): Promise<CommandResult>
  getLatestState(): AutoIngestState | null
  getConnectionState(): ConnectionState
  subscribe(listener): () => void   // fires immediately, then on every change
}
```

- Owns discovery, the WebSocket, authentication (`hello`/`ready`/`error`
  handling per the real transport protocol), a requestId-correlated pending-
  command map, and reconnect/backoff — individual actions never touch a
  socket, the descriptor, or the wire protocol.
- `executeCommand()` forwards `commandId`/`payload` **opaquely** to
  AutoIngest's real `AutoIngestCommands.execute()` and resolves with exactly
  what came back — no `canExecute()`/`isValid()` logic is duplicated here.
  Resolves (never rejects, never hangs) even when not connected
  (`{ok:false, reason:'not-connected'}`) or if AutoIngest never replies
  (`{ok:false, reason:'plugin-timeout'}`, 8s).
- `getLatestState()` is a passive cache updated only by real `state` pushes
  from AutoIngest — never polled.
- Never logs the token, an invalid token, or a full state snapshot — only
  event names and outcome summaries (see "Logging" below).

---

## Reconnect behavior

Modest exponential backoff: `1000ms * 2^attempt`, capped at `15000ms`, reset
to `1000ms` on every successful `ready`. This is deliberately process
*discovery* pacing ("is AutoIngest running yet/again?"), not application-
state polling — AutoIngest's own state still arrives purely by push, never
by the plugin asking again. Never hammers the descriptor file or a closed
socket.

Verified against the real transport (both in automated tests and the live
physical session — see "Physical test results"):
- AutoIngest not running yet at plugin start → clean retry loop, no crash.
- AutoIngest restarts → **old token/port are never reused**; discovery re-
  reads the descriptor fresh on every attempt, and the regenerated token
  differs every time (confirmed both ways: the automated integration test
  asserts inequality directly, and the live session showed three different
  ports across three real starts: 52867 → 53129 → 54524).
- Logi Plugin Service itself restarts (a fresh plugin process spawns) →
  rediscovers and reconnects to an *already-running* AutoIngest in ~4s, no
  AutoIngest restart needed.
- Renderer reload (Phase 2's own tested scenario) → covered transitively:
  the plugin only ever sees state via `state` pushes, so it's agnostic to
  whether the push followed a renderer reload or not.

---

## Logitech actions implemented

| Action | SDK type | Display name | Commands | Hardware (Phase 3A) |
|---|---|---|---|---|
| `toggle_selection` | `CommandAction` | Toggle Selection | `selection.toggleCurrent` | One LCD key |
| `navigate_files` | `AdjustmentAction` | Navigate Files | `navigation.nextFile` (tick>0) / `navigation.previousFile` (tick<0) | Main dial |
| `preview_toggle` | `CommandAction` | Preview | `preview.toggle` | Optional second LCD key |

Per the SDK's own Command-vs-Adjustment distinction: the two discrete button
actions are `CommandAction`s, the dial is a real `AdjustmentAction` — never
a fake keyboard-shortcut simulation. `navigate_files` holds **no numeric
"current file" state**; it reads only `event.tick`'s sign (ignoring
magnitude, so multi-tick SDK events never batch several moves), issues
exactly one command per detent, and lets AutoIngest's own result
(`executed:true/false`) be the sole authority on whether anything moved —
confirmed live: rotating past the first/last of 5 fixture files left
AutoIngest stable with no corruption (Test C).

No group/QMZ/import/archive actions exist yet — explicitly out of scope.

---

## Profile / application linking

**Investigated, not implemented in the plugin manifest.** Logi Options+'s
own runtime represents an app-linked profile via a
`processOrBundleName` field on a `SupportedApplicationInfo` record (found by
inspecting an existing installed profile's `ApplicationInfo.json` under
`~/Library/Application Support/Logi/LogiPluginService/Applications/`) — this
is **configured through Options+'s own "Applications" UI** (Settings →
Applications → Add Application → select the app), using the OS's real
bundle/process identity, **not** something a plugin declares in its own
manifest.

AutoIngest's real macOS identity for this purpose: `com.autoingest.app`
(from `package.json`'s `build.appId`).

`@logitech/plugin-toolkit@0.1.1`'s generated `LoupedeckPackage.yaml` has an
empty `pluginCapabilities:` field with no bundled schema or example for
declaring app-linking there — confirmed by inspecting the toolkit's own
template source, which contains no reference to `pluginCapabilities`,
`linkedApplication`, `bundleIdentifier`, or similar keys anywhere. This is a
genuine, documented current-toolkit limitation, not an oversight — see
below.

**For Phase 3A**, the AutoIngest MX profile was assigned manually in Options+
(the "manually assignable development profile" the task brief anticipated).
Automatic foreground-app activation is Phase 3B+ scope, pending either newer
toolkit support or reverse-engineering the `ApplicationInfo.json` format
further.

---

## Assets

Three pairs of minimal, hand-authored SVG icons (`package/actionicons/` +
`package/actionsymbols/`, one pair per action, named to match each action's
`name` field — confirmed as the real convention by inspecting the toolkit's
generated example): a checkmark-in-square (Toggle Selection), double
chevrons (Navigate Files), and a simple eye (Preview). 24×24, stroke-only,
neutral gray (`#e3e3e3`), matching the generated example's style. Not
derived from any copyrighted Logitech asset — simple geometric primitives
authored for this plugin specifically. Final icon design is explicitly
deferred past Phase 3A.

---

## Logging

`src/sharedClient.ts` routes `AutoIngestClient`'s diagnostics to
`console.log`/`warn`/`error`, prefixed `[autoingest-mx]`. Concise, one line
per event:

- `plugin loaded` (index.ts, on startup)
- `connecting to AutoIngest on 127.0.0.1:<port>`
- `authenticated`
- `AutoIngest disconnected`
- `reconnect scheduled in <ms>ms`
- `protocol mismatch (server=<n>, plugin=<n>) — disconnecting`
- a one-line reason on a rejected/failed command (`<action>: not executed (<reason>)`)

**Never logs**: the token (valid or invalid — checked directly by the
integration test, which asserts no 64-hex-char string appears anywhere in
captured log output across a full session), a full descriptor, sensitive
file paths beyond what's operationally necessary, or a continuous state
snapshot dump (state changes are cached silently; only connection-lifecycle
and command-outcome events are logged).

---

## Automated tests (no hardware required)

`npm test` — 30 checks total, all passing:

- **`test/descriptor.test.ts`** (17 checks, plain temp-dir I/O, no
  AutoIngest process needed): valid/invalid/missing descriptor parsing,
  every `DescriptorError` code, dev-vs-packaged candidate-path resolution,
  end-to-end `discoverDescriptor()` against a synthetic isolated home.
- **`test/autoIngestClient.integration.test.ts`** (13 checks, launches the
  **real** AutoIngest app via `playwright-core`'s `_electron`, exactly like
  the AutoIngest repo's own `test/mxControlTransportLive.test.js` — reuses
  the real Phase 2 transport, not a second mock protocol): `connect()`
  reaching `"connected"`, real initial state, `subscribe()` firing
  immediately then on real pushes, command/result correlation, rejected
  commands, state-push updates, no-token-in-logs, `disconnect()`, and — the
  most valuable ones — a full **restart-with-regenerated-credentials**
  cycle (close AutoIngest, confirm descriptor removal, relaunch, confirm the
  token genuinely differs and the client rediscovers/reconnects) and a
  **protocol-mismatch** reaction test (one deliberate, minimal exception: a
  tiny local `ws` server sending the one real message shape
  `{type:'ready',protocolVersion:999}`, since the real server can never
  itself produce a mismatch against its own version — the descriptor and
  discovery layer feeding it are still 100% real).

---

## Physical test procedure

1. `cd integrations/logitech/autoingest-mx && npm run build && npm run link`
2. Start Logi Plugin Service if not already running.
3. Open Logi Options+ → the MX Creative Console's device configuration
   screen → confirm **AutoIngest**'s three actions appear under "All
   Actions" → assign Navigate Files to the main dial, Toggle Selection (and
   optionally Preview) to LCD keys.
4. Launch AutoIngest, select a synthetic memory-card fixture as the source
   (never a real card/archive).
5. Work through the checklist below on the real device while watching
   AutoIngest's `app.log` for `[mx-control]` activity to cross-check every
   physical action against the real command result.

---

## Physical test results (real MX Creative Console, this session)

All items tested on the actual hardware, cross-checked against live
`app.log` `[mx-control]` activity in real time.

| # | Test | Result |
|---|---|---|
| A | Dial clockwise → active file +1 | **Pass** — real `navigation.nextFile` commands, `ok:true`, matching dial detents |
| B | Dial counter-clockwise → active file −1 | **Pass** — real `navigation.previousFile` commands, `ok:true` |
| C | Boundary (past first/last of 5 fixture files) | **Pass** — AutoIngest stayed stable, no corruption |
| D | Toggle Selection → selects active file | **Pass** — real `selection.toggleCurrent`, `ok:true`, visually selected |
| E | Press again → deselects | **Pass** — same command, visually deselected |
| F | Dial while selected → selection stays correct | **Pass** — user-confirmed, no corruption across navigation |
| G | AutoIngest closed → device action does nothing harmful | **Pass** — clean `before-quit` shutdown (`service stopped, descriptor removed`), plugin process survived, no crash/hang on a subsequent key/dial press |
| H | Start AutoIngest afterward → plugin reconnects | **Pass** — `client authenticated` ~1.3s after `service started`, on a genuinely new port |
| I | Restart AutoIngest → new descriptor, old credentials discarded | **Pass** — same restart cycle as H; port differed across all three real starts observed this session (52867 → 53129 → 54524); automated test additionally proves the token itself differs |
| J | Logi Plugin Service restart → reconnects to already-running AutoIngest | **Pass** — killed and restarted the service; a fresh plugin process spawned and authenticated ~4s later, with AutoIngest never restarted |
| K | Rapid dial rotation → stays ordered/responsive | **Pass** — dozens of rapid back-and-forth `nextFile`/`previousFile` commands, individually resolved, correctly ordered, no crash; the log monitor itself rate-limited from the speed |

### A real bug found and fixed during this session

**Symptom**: after assigning actions in Options+, `app.log` showed
`[mx-control] rejected second client — one already connected` repeating
every ~15s indefinitely (matching `AutoIngestClient`'s own backoff cap) —
the device would never have worked.

**Root cause**: Options+/Plugin Service spawned a *new* plugin process for
the action-assignment reload without first terminating the *original* one
(from the initial `npm run link`). The original process's WebSocket
connection was still open and authenticated, so AutoIngest's transport —
correctly enforcing its documented single-active-client policy — rejected
the new process every time it tried to connect. This is **not** a bug in
`AutoIngestClient` or the transport (both behaved exactly per spec); it's a
process-lifecycle characteristic of the current Plugin Service that any
integration relying on process-restart-on-reload should account for.

**Fix applied**: manually killed the stale process (`kill <old pid>`); its
connection closed, the slot freed, and the current process reconnected on
its very next backoff attempt.

**Implication for real-world use**: a user relinking/reloading the plugin
mid-session may need to fully quit and restart the Logi Plugin Service (not
just re-link) if a stale process lingers — worth a short troubleshooting
note if this becomes a recurring Phase 3B+ complaint; not fixed at the
AutoIngest transport level, since the transport's single-client rejection is
the *correct* behavior given two genuinely separate processes were both
trying to hold the connection.

---

## Known Node SDK / tooling limitations encountered

- **`pluginCapabilities` has no documented schema in toolkit 0.1.1** for
  declaring an application-linked profile — see "Profile / application
  linking" above. Confirmed by inspecting the toolkit's own template source,
  not assumed from missing docs alone.
- **No dynamic key/LCD text or icon update API** in `@logitech/plugin-sdk@0.1.1`'s
  type definitions (`Action`/`CommandAction`/`AdjustmentAction` — no
  `setTitle`/`setIcon`/similar method exists). Per the task brief's own
  fallback, a dedicated connection-status action/button was **not** built;
  connection state is surfaced through plugin logs only (see "Logging").
  Revisit if a future SDK version adds this.
- **`tsx`/esbuild cannot run tests that call Playwright's `page.evaluate()`
  with inline arrow functions.** esbuild (which `tsx` uses) wraps
  transpiled functions with a `__name(fn, "name")` helper for name
  preservation; when Playwright serializes such a function via
  `.toString()` and evaluates it inside the browser's isolated context, that
  helper doesn't exist there, throwing
  `ReferenceError: __name is not defined`. Root-caused directly (confirmed
  the real, unpackaged `tsc` output has zero `__name` occurrences, while the
  `tsx`-transpiled version does) rather than worked around superficially.
  **Fix**: `test:integration` compiles via real `tsc`
  (`tsconfig.test.json` → `dist-test/`, gitignored) and runs the plain
  `node` output instead of running through `tsx` directly. This is a
  general Playwright+esbuild interaction, not specific to the Logitech SDK,
  but worth recording here since it blocked this plugin's own tests.
- **Plugin Service does not auto-load a freshly-linked plugin on its own
  startup** — confirmed empirically (started the service, waited, no new
  log/process activity for the linked plugin) — discovery happens lazily,
  triggered by opening the device configuration screen in Options+ (matches
  the toolkit's own README wording: "should now be visible... in the device
  configuration screen").
- **Reload does not guarantee the previous plugin process is terminated
  first** — see "A real bug found and fixed" above.

---

## What Phase 3A explicitly does NOT do

Full keypad pages, dynamic-folder navigation beyond what was needed to load/
test, G1–G9 group buttons, `group.assign` UI, QMZ sequence-selection UI,
import controls, Archive Maintenance, the Actions Ring, Marketplace
packaging/publishing, a final `.lplug4` release, or any merge to `main`/
`stable/0.9`.
