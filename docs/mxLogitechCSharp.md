# MX Logitech Plugin — C# Parity Migration (AI-FEAT MX Console — Phase 4A)

**Status: parity candidate, not yet the primary implementation.** The proven
Node plugin (`integrations/logitech/autoingest-mx/`, see
[mxLogitechPlugin.md](mxLogitechPlugin.md)) remains the reference/fallback
implementation. This phase builds a C# plugin that reaches functional
parity with it — same actions, same transport, same behavior — as the
prerequisite for Phase 4B's dynamic Tag Refinement keypad, which requires
`PluginDynamicFolder` (a capability the Node SDK does not expose; see
`docs/mxLogitechPlugin.md`'s SDK capability matrix). **No dynamic folders,
no dynamic icons, and no Phase 4B work exist in this phase.**

---

## Why C# migration exists

Phase 3E built the full AutoIngest-side command/state foundation for a
dynamic Tag Refinement keypad (`tagRefinement.setTagState`/
`applyToSelected`, `state.tagRefinement.tags[]`). That foundation is
genuinely ready, but the Node SDK (`@logitech/plugin-sdk@0.1.1`) cannot
render it on hardware: no dynamic per-key text, no dynamic per-key icons, no
device-side folders/pages — confirmed in Phase 3B's own SDK capability
matrix by reading the SDK's compiled runtime directly, not assumed. The
officially-documented path to `PluginDynamicFolder` and dynamic action
content is the **C# SDK**, built on the same underlying Loupedeck/Logi
Plugin Service platform. This phase proves the language/runtime migration
itself, in isolation, before any dynamic-folder work begins.

---

## Project location and identity

```
integrations/logitech/autoingest-mx-csharp/
  AutoIngestMxCsDevPlugin.sln
  src/
    AutoIngestMxCsDevPlugin.cs          plugin entry point (Load/Unload)
    AutoIngestMxCsDevPlugin.csproj
    AutoIngestMxCsDevApplication.cs     generated, UNUSED (see "Architecture notes")
    Directory.Build.props
    Helpers/
      PluginLog.cs / PluginResources.cs generated logging/resource helpers
      ActionRunner.cs                   fire-and-forget-with-logged-exceptions for sync SDK callbacks
      GatedCommand.cs                   shared availableCommands/context gating (6 of 9 actions)
      GroupSlotHelper.cs                G1/G2/G3 label resolution — port of groupSlotHelper.ts
    Transport/
      Descriptor.cs                     port of descriptor.ts
      AutoIngestState.cs                state/result/connection-state models
      AutoIngestClient.cs               port of autoIngestClient.ts
      SharedClient.cs                   the one shared instance, routed through PluginLog
    Actions/                            9 parity actions — see "Static action mapping"
    package/metadata/LoupedeckPackage.yaml
  test/
    AutoIngestMxCsDevPlugin.Tests/      xUnit test project — see "Testing"
```

**Identity**: internal plugin name `AutoIngestMxCsDev`, display name
"AutoIngest MX (C# Dev)" — a deliberately **temporary, development-safe**
identity, generated via `logiplugintool generate AutoIngestMxCsDev`. Per the
brief: Logitech plugin package names become significant once published, so
the final immutable Marketplace identity was NOT decided during this
experimental migration. Nothing here should be read as the final package
name.

---

## Installed C# toolchain (verified on this machine)

| Item | Found |
|---|---|
| macOS | arm64 (Apple Silicon), same machine as the Node plugin's own prerequisites |
| .NET SDK | **8.0.425** (per the SDK's own current docs: "Install the .NET 8 SDK") AND **10.0.401** (see "A real version-skew finding" below) — both installed side by side via the official `dotnet-install.sh` script into `~/.dotnet` (no sudo; see "Installation notes") |
| Logi Plugin Tool (`logiplugintool`) | **6.1.4.22672**, installed via `dotnet tool install --global LogiPluginTool` |
| Logi Plugin Service | **6.4.2.3414** (current; Phase 3A/3C recorded 6.4.1.3246 — auto-updated since) |
| Logi Options+ | **2.8.981479** (current; Phase 3A/3C recorded 2.7.961922 — auto-updated since) |
| Generated project target framework (as generated) | `net8.0` |
| Generated project target framework (as actually required) | **`net10.0`** — see below |
| IDEs the SDK docs list as compatible | Visual Studio Code, Visual Studio 2022+, JetBrains Rider — **not Visual Studio-only**, despite one doc page's debug-workflow wording implying it. This migration used the `dotnet` CLI directly, no IDE. |

### A real version-skew finding (installed tooling vs. current docs)

The generated project's default `<TargetFramework>net8.0</TargetFramework>`
matches the SDK's own documented ".NET 8 SDK" requirement — but building
against it failed with a real, reproducible error:

```
CSC : error CS1705: Assembly 'PluginApi' with identity
'PluginApi, Version=6.4.2.3414, ...' uses 'System.Runtime, Version=10.0.0.0'
which has a higher version than referenced assembly 'System.Runtime' with
identity 'System.Runtime, Version=8.0.0.0, ...'
```

The **currently-installed** Logi Plugin Service (6.4.2.3414, auto-updated
past whatever version the SDK docs/tool were last written against) ships a
`PluginApi.dll` built against **.NET 10**, not .NET 8. Retargeting the
project to `net10.0` (after installing the .NET 10 SDK alongside .NET 8)
resolved this with **zero further errors or warnings**. This is exactly the
brief's own anticipated scenario ("do not rely on outdated tutorials when
installed/current docs differ") — resolved by matching the **installed**
Plugin Service, not the documented default.

**Practical implication**: a from-scratch setup on another machine should
attempt `net8.0` first (matching current public docs), but if Logi Plugin
Service has been auto-updated past whatever version those docs assumed, the
same `CS1705` failure — and the same fix (install .NET 10 SDK, retarget to
`net10.0`) — should be expected. This is a property of the **installed
Plugin Service version**, not of this specific machine.

### Installation notes

- No sudo/admin password was available in this environment. `dotnet-sdk@8`
  as a Homebrew **cask** requires admin rights to run its signed `.pkg`
  installer; `brew install --cask` failed for the same "a password is
  required" reason `sudo installer` did directly.
- Used Microsoft's own official **non-sudo** installer instead:
  `curl -sSL https://dot.net/v1/dotnet-install.sh | bash /dev/stdin --channel 8.0 --install-dir ~/.dotnet`
  (and again with `--channel 10.0`). This installs entirely under the
  user's home directory — the officially-supported path for exactly this
  constraint (CI/sandboxed environments), not a workaround specific to this
  session.
- `LogiPluginTool` requires `DOTNET_ROOT` set (not just `PATH`) to resolve
  its runtime via `apphost`/`libhostfxr.dylib` — `export DOTNET_ROOT=~/.dotnet`
  alongside `PATH=~/.dotnet:~/.dotnet/tools:$PATH`.
- A genuinely slow network path to `builds.dotnet.microsoft.com` was
  observed in this environment (~25-40 KB/s, independent of Microsoft's own
  servers — a separate, unrelated site was also slow/unreachable) — each
  ~200-230MB SDK download took real wall-clock time. Not a toolchain issue;
  recorded here only because it shaped how the installs were attempted
  (Homebrew's cask dependency chain was abandoned in favor of the direct
  official script once this was understood).

---

## Build / install workflow

```bash
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$HOME/.dotnet:$HOME/.dotnet/tools:$PATH"

cd integrations/logitech/autoingest-mx-csharp
dotnet build src/AutoIngestMxCsDevPlugin.csproj   # also writes the .link file + sends the reload deeplink
dotnet test test/AutoIngestMxCsDevPlugin.Tests/AutoIngestMxCsDevPlugin.Tests.csproj
```

`dotnet build`'s own `PostBuild` MSBuild target (generated by
`logiplugintool`, unmodified) does two things automatically, matching the
Node plugin's `npm run link`'s own two responsibilities:

1. Writes `~/Library/Application Support/Logi/LogiPluginService/Plugins/AutoIngestMxCsDevPlugin.link`
   — a plain text file containing the build output path (`bin/Debug/bin/`),
   the same ".link file tells the Plugin Service where to find your plugin"
   mechanism the SDK docs describe. Confirmed working — Logi Plugin Service
   loaded it and produced its own dedicated log file,
   `Logs/plugin_logs/AutoIngestMxCsDev.log`.
2. Sends `open loupedeck:plugin/AutoIngestMxCsDev/reload` — the exact same
   URL-scheme reload mechanism the Node plugin's own `npm run link` uses.

**Architectural difference from the Node plugin, confirmed empirically**:
the Node plugin runs as a **separate child OS process**
(`PluginHosts/node22/node/bin/node .../index.mjs`, visible via `pgrep`). The
C# plugin runs **in-process**, loaded as a .NET assembly directly into
`LogiPluginService`'s own Mono-hosted runtime
(`Contents/MonoBundle/PluginApi.dll` and friends) — there is no separate
child process to observe via `pgrep`; its lifecycle is entirely internal to
`LogiPluginService` itself. Confirmed via `LogiPluginService`'s own log
("Started loading plugin 'AutoIngestMxCsDev'") and the plugin's own
dedicated log file, not inferred.

---

## Transport reuse — zero protocol changes

The C# `AutoIngestClient` consumes the **exact same, unmodified** Phase 2
protocol: `<userData>/mx-control.json` (`port`/`token`/`pid`/
`protocolVersion`), the same message types (`hello`/`ready`/`state`/
`executeCommand`/`commandResult`/`error`), `protocolVersion: 1`, unchanged.
No `services/mxControlService.js` code was touched — **the migration
required zero AutoIngest source changes**, verified by `git status` showing
no diff under `renderer/`, `services/`, or `main/` for this phase.

Built with `System.Net.WebSockets.ClientWebSocket` + `System.Text.Json`
(camelCase naming policy) — no third-party WebSocket or JSON package, per
the brief's own preference; the generated `PluginApi.dll` already carries a
`websocket-sharp.dll` reference for the SDK's own internal use, but this
plugin's own AutoIngest-facing socket is independent of it.

### Real end-to-end connection — verified, not assumed

Confirmed on **both sides** of the real transport (not just unit-tested
against a mock):

- C# plugin's own log (`Logs/plugin_logs/AutoIngestMxCsDev.log`):
  `connecting to AutoIngest on 127.0.0.1:49779` → `authenticated`.
- AutoIngest's own `app.log`, independently:
  `[mx-control] service started on 127.0.0.1:49779 (pid ..., protocolVersion 1)`
  → `[mx-control] client authenticated`.

Same port in both logs, same moment — the C# plugin genuinely authenticated
against a real, running AutoIngest instance, with the Node plugin's own
process stopped first (see "Node/C# coexistence" below).

---

## Descriptor discovery parity

`Transport/Descriptor.cs` is a semantics-for-semantics port of
`descriptor.ts` — same candidate paths (dev name `auto-ingest` tried before
packaged name `AutoIngest`, both on macOS `~/Library/Application Support/`
and the Windows `%APPDATA%` equivalent), same five-case error taxonomy
(`Missing`/`InvalidJson`/`InvalidShape`/`StalePid`/`Unreadable`), same
stale-PID liveness check (via `Process.GetProcessById`/`HasExited`,
.NET's own process-table equivalent of the Node client's
`process.kill(pid, 0)`), same `homeOverride` test seam. **Not a different
discovery algorithm** — the C# and Node clients discover the exact same
AutoIngest instance, from the exact same files, by the exact same rules.

---

## Authentication / reconnection behavior

Matches the proven Node behavior exactly:

- Connects only to `127.0.0.1`, never logs the token (verified by an
  automated test — see "Testing"), discards stale credentials on every
  reconnect (descriptor re-read fresh on every attempt, never cached across
  attempts).
- Modest exponential backoff (`1000ms * 2^attempt`, capped at `15000ms`,
  reset on every successful `ready`) — confirmed live in the plugin's own
  log: `reconnect scheduled in 4000ms` → `8000ms` → `15000ms` (capped),
  never hammering the descriptor file or a closed socket.
- AutoIngest unavailable → plugin stays healthy, logs
  `descriptor not available (Missing) — will retry`, keeps retrying.
- AutoIngest restarts with a new port/token → old credentials discarded,
  descriptor re-read fresh, reconnects (automated test:
  `AutoIngestRestartWithNewPortAndToken_ClientRediscoversAndReconnects`).
- Plugin Service restart → reconnects to an already-running AutoIngest (not
  re-tested with the physical device this phase — see the final report's
  "physical console parity results").

---

## Threading / async design

This is the genuinely new risk C# introduces (the Node SDK's single-
threaded event loop has no equivalent concern). Addressed directly:

- **The SDK's own action callbacks (`RunCommand`, `ApplyAdjustment`) are
  synchronous (`void`), called by the plugin host's own thread.**
  `Helpers/ActionRunner.FireAndForget` bridges to the async
  `AutoIngestClient` via `Task.Run(...)`, never `.Result`/`.Wait()` — the
  calling (host) thread returns immediately every time. Every exception
  inside the fire-and-forget Task is caught and logged via `PluginLog`,
  never silently swallowed.
- **`AutoIngestClient` itself uses `ConfigureAwait(false)` throughout** its
  internals, so none of its continuations depend on capturing the plugin
  host's own synchronization context — this is what makes even the one
  deliberately-synchronous bridge point (`Plugin.Unload()`, which the SDK
  declares as `void` with no async override available) safe to call via
  `.GetAwaiter().GetResult()`: nothing it awaits needs to resume on the
  calling thread, so there is no context-capture deadlock to create.
- **State updates are thread-safe**: a single `lock (_sync)` guards
  `_connectionState`/`_latestState`/the listener list; notifications are
  dispatched from a **copy** of the listener list taken under the lock,
  then invoked outside it — a listener re-entering the client (e.g. calling
  `GetLatestState()` from inside its own callback) can never deadlock on
  the same lock.
- **requestId correlation is thread-safe**: `ConcurrentDictionary<string,
  TaskCompletionSource<CommandResult>>` — no explicit locking needed for
  the pending-command map itself.
- **Disconnect/reconnect cannot race destructively**: a single
  `CancellationTokenSource` (`_runCts`) created in `Connect()` and
  cancelled in `DisconnectAsync()` is observed throughout the receive loop,
  the reconnect backoff delay, and the connect attempt itself;
  `DisconnectAsync()` awaits the background loop Task's own clean exit
  (bounded to 5s) before returning, so no receive/reconnect work survives
  past a `Unload()` call returning.
- **Verified by automated tests**, not just reasoned about: concurrent
  command execution (20 simultaneous calls, each resolving independently),
  transport loss during an outstanding command (resolves rather than
  hanging), and plugin shutdown while mid-reconnect-backoff (completes
  within the bounded wait, never hangs) — see "Testing" below.

---

## State model

`Transport/AutoIngestState.cs` deserializes AutoIngest's real `getState()`
shape: `context`, `activeFile`, `selectedCount`, `hasSelection`,
`previewOpen`, `availableCommands` (always present), plus the optional
`groups`/`sequences`/`tagRefinement`/`event` objects (present only when
AutoIngest itself includes them). **System.Text.Json's default behavior
already satisfies "unknown future JSON fields should not break the C#
client"** — an unrecognized property is silently ignored during
deserialization; no special-case code was needed, and this is verified by
an automated test (`UnknownJsonFields_DoNotBreakStateDeserialization`)
pushing a state object with a field this client has never heard of.

`AutoIngestClient` caches only the **latest pushed** state, exactly like
the Node client — never a competing business-state model, never polled,
never independently derived.

## Command result model

`CommandResult` preserves `ok`/`commandId`/`executed`/`detail`/`reason`
exactly as the real transport sends them — `executed` and `reason` are
never collapsed to a generic truthy/falsy check (verified by
`ExecutedFalse_IsPreservedFromTheRealResult_NotCollapsedToTruthy`). Unknown
extra result fields are ignored the same way unknown state fields are.

---

## Static action mapping (parity set)

| Node action | C# action | Command | Context-gated |
|---|---|---|---|
| `toggleSelectionAction.ts` | `SelectCommand` | `selection.toggleCurrent` | no |
| `selectAllAction.ts` | `SelectAllCommand` | `selection.selectAll` | no |
| `clearSelectionAction.ts` | `ClearCommand` | `selection.clear` | no |
| `previewAction.ts` | `PreviewCommand` | `preview.toggle` | no |
| `assignG1Action.ts` | `AssignG1Command` | `group.assign` (resolved id) | yes (browse) |
| `assignG2Action.ts` | `AssignG2Command` | `group.assign` (resolved id) | yes (browse) |
| `assignG3Action.ts` | `AssignG3Command` | `group.assign` (resolved id) | yes (browse) |
| `unassignGroupAction.ts` | `UnassignCommand` | `group.unassign` | yes (browse) |
| `changeEventAction.ts` | `ChangeEventCommand` | `event.openChooser` | yes (browse) |
| `refineTagsAction.ts` | `RefineTagsCommand` | `tagRefinement.open` | yes (browse) |
| `navigateFilesAction.ts` | `NavigateFilesAdjustment` | `navigation.nextFile`/`previousFile` | no |

No new AutoIngest command was added for C# convenience, per the brief. The
C# SDK's `ApplyAdjustment(String actionParameter, Int32 diff)` gives the
per-call tick delta directly (cleaner than the Node SDK's `event.tick`) —
`diff`'s **sign** alone is used, its magnitude ignored, for identical
one-detent-one-command behavior regardless of host batching. `hasReset` is
left at its SDK default (`false`) — Phase 3B's real hardware test already
found the physical MX Creative Console's main dial has no press mechanism
at all, a hardware fact independent of which SDK drives it; not re-tested
here.

### Group resolution parity

`Helpers/GroupSlotHelper.cs` ports `groupSlotHelper.ts` exactly: resolves
"G1"/"G2"/"G3" to AutoIngest's real current group id via `state.Groups`
(by **label**, never assuming `groupId == G-number`), falls back to passing
the slot number itself as `groupId` when the label doesn't currently exist
(`group.assign`'s own existing "create the next sequential group"
behavior — the same the Cmd+G chord already relies on). No new AutoIngest
command, no plugin-local group creation.

---

## availableCommands gating

Every gated action consults `state.AvailableCommands` (and, for six of the
nine, `state.Context == "browse"`) before calling `ExecuteCommandAsync` —
UX convenience only, factored into one shared `Helpers/GatedCommand.cs`
rather than duplicated nine times (the Node plugin duplicates this gating
per-file; this port consolidates it, since C# makes that trivial without
losing per-action readability). **AutoIngest's own `canExecute()` remains
the sole authority** — if `GetLatestState()` is `null` (renderer not ready
yet), every gate falls through and lets AutoIngest itself decide, exactly
like the Node plugin.

---

## Node / C# coexistence rule

**AutoIngest's Phase 2 transport permits only one authenticated client —
this was never weakened, and must never be, for this migration.** During
this phase's development and testing:

1. The Node plugin's own files/symlink/`package.json`/tests/docs were
   **never modified or deleted** — `integrations/logitech/autoingest-mx/`
   is untouched by this phase (confirmed via `git status`).
2. Before any C# connection test, the Node plugin's **running child
   process** was stopped (`kill <pid>`) — reversible, and does not touch
   its symlink. **Finding**: Logi Plugin Service auto-respawns any
   plugin it has previously loaded (including by its OWN internal
   registration, not just by rescanning the `Plugins/` directory) on its
   own next restart — renaming the symlink did NOT prevent this; only
   killing the live child process, immediately before each test, reliably
   kept the slot free. This is documented here as a real operational
   characteristic for future sessions, not treated as a bug to fix.
3. Verified via the real transport (both the plugin's own log and
   AutoIngest's `app.log`) that exactly **one** client authenticated during
   every C# test session.
4. At the end of this phase, Logi Plugin Service was restarted once more
   with the Node plugin's (unmodified) symlink in place — restoring the
   pre-phase default (Node plugin active) rather than leaving the C# one
   as the environment's standing state.

---

## Testing

`test/AutoIngestMxCsDevPlugin.Tests/` (xUnit, referencing the main plugin
project directly) — **32 checks, all passing**:

- **`MockAutoIngestServer.cs`** (test infrastructure, not a test file
  itself): a real `HttpListener`-based WebSocket server speaking the exact
  real message shapes (`hello`/`ready`/`state`/`executeCommand`/
  `commandResult`/`error`) — `AutoIngestClient` is exercised through its
  real network code path in every test below, never a stubbed interface.
  BCL-only (no third-party WebSocket/JSON package).
- **`DescriptorTests.cs`** (9 checks): valid descriptor, invalid JSON, six
  missing/malformed-field shape variants, a non-1 protocol version
  (confirmed to parse correctly — rejection is a connection-time concern,
  not a descriptor-shape one), stale PID (via a genuinely-exited real
  process, not a faked one), missing descriptor file, dev-name-before-
  packaged-name candidate ordering, packaged-name fallback when the dev
  path is absent.
- **`ConnectionTests.cs`** (7 checks): successful authentication with a
  real initial state, invalid-credentials handling (never reaches
  Connected), a real state push updating both the subscriber and
  `GetLatestState()`, disconnect (clears state, stays disconnected),
  server-initiated close (client detects it and reconnects to the same
  still-running server), a full restart-with-regenerated-port-and-token
  cycle, protocol mismatch (never reaches Connected).
- **`CommandTests.cs`** (6 checks): requestId correlation across two calls,
  `executed:true` and `executed:false` both preserved faithfully (never
  collapsed to generic truthiness), a rejected command's `reason` preserved,
  20 concurrent requests each resolving independently and correctly, and a
  genuine timeout (server receives the request but never replies) resolving
  safely to `{ok:false, reason:"plugin-timeout"}` rather than hanging.
- **`ResilienceTests.cs`** (4 checks): a malformed non-JSON server frame is
  ignored and the connection stays usable afterward (not just "unchanged by
  accident" — a real subsequent command still executes), unknown future
  JSON fields in a state push never break deserialization, plugin shutdown
  while mid-reconnect-backoff completes within a bounded wait rather than
  hanging, and transport loss during an outstanding command resolves that
  command rather than leaving it pending forever.
- **`SecurityTests.cs`** (2 checks): the real token never appears in any
  logged line across a full connect/authenticate/command/state-push/
  disconnect session, and an invalid-token attempt never logs the attempted
  (wrong) token either.

```bash
dotnet test test/AutoIngestMxCsDevPlugin.Tests/AutoIngestMxCsDevPlugin.Tests.csproj
```

### Real transport integration (not just the mock)

Beyond the xUnit suite above (which uses `MockAutoIngestServer`), the real
end-to-end connection was separately verified against a genuinely running
AutoIngest dev instance (`npx electron . --no-sandbox`) with the Node
plugin's process stopped first — see "Transport reuse" above for the
cross-checked log evidence from both sides. This covered the minimum the
brief asked for (connection + authentication); a full physical-hardware
command-by-command parity pass (navigation/selection/preview/group
commands triggered by real key presses) is recorded separately in the
Phase 4A final report's "physical console parity results" and was not
completed within this phase — it requires the Options+ Action Picker and
the physical device, both outside what this automated session can drive
alone.

---

## Architecture notes

- `AutoIngestMxCsDevApplication.cs` (generated, extends `ClientApplication`)
  is **unused** — `UsesApplicationApiOnly = true` and `HasNoApplication =
  true` on the main `Plugin` subclass mean this plugin never declares a
  native OS-level application link. AutoIngest's foreground-profile
  switching is handled entirely by Logi Options+'s own generic bundle-ID
  "Adapt to App" mechanism (Phase 3C) — completely independent of, and not
  affected by, which language implements the plugin's actions.
- `<Nullable>disable</Nullable>` in the main plugin project is the
  **tool-generated default**, left unchanged — fighting it would mean
  deviating from Logitech's own template for no behavioral benefit, since
  `PluginApi.dll`'s own surface is not nullable-annotated either. The test
  project (generated separately by `dotnet new xunit`) defaults to
  `<Nullable>enable</Nullable>` and was left as generated there too — the
  two projects intentionally differ, matching each one's own template
  default rather than a single rule imposed across both.

---

## Physical console parity test (post-Phase 4A)

Run against the real MX Creative Console, the real Logi Options+ "AutoIngest"
profile (Phase 3C), and a packaged (not dev-mode) AutoIngest build — dev-mode
reports as `com.github.Electron` to macOS, so Options+'s Adapt-to-App never
activated the AutoIngest profile for it; this was the root cause of an
initial "profile not switching" report, not a C# defect.

**Pre-existing packaging bugs found and fixed** (electron-builder's
dependency walker, not the C# migration): the packaged build's main
process crashed before creating any window with a cascading
`Cannot find module` chain (`bindings` → `file-uri-to-path` →
`graceful-fs` → `builder-util-runtime` → the rest of `electron-updater`'s
transitive tree — 18 packages total), because `build.files` never included
a general `node_modules` glob and electron-builder's own native-module
walker only reliably caught `drivelist` itself, not its pure-JS
dependents. Separately, `sharp`'s actual native binary
(`@img/sharp-darwin-arm64` / `@img/sharp-libvips-darwin-arm64`, both
`optionalDependencies` of a scoped sub-package) never made it into the
asar at all, causing `Could not load the "sharp" module` and indefinitely
stalled thumbnails. Fixed both by adding each missing package as an
explicit direct dependency in root `package.json` (plus `asarUnpack` for
the two native-binary chains), matching how `drivelist` itself was already
declared. Zero AutoIngest *logic* changed — this is packaging
configuration only, pre-dating all MX console phases (confirmed via git
history).

**New diagnostic logging added** (by explicit request, not a bug fix):
`services/mxControlService.js`'s existing command-result log line now
also prints the resolved `groupId` when a `group.assign` result carries
one (`result.detail.groupId`, per `commandManager.js`'s own
`computeExecuted`/`detail` shape) — e.g.
`command result: group.assign ok=true groupId=2`. This reads a field the
renderer's result object already provided; the "payload forwarded
opaquely" request-side rule is untouched. Verified: G1/G2/G3 pressed
separately now log three genuinely distinct group IDs (1, 2, 3), not just
three `ok=true` lines.

**Single-client arbitration** — proven repeatedly, in both directions,
with zero code changes: when Node held the connection, every C# retry was
rejected (`already-connected`) and logged as such on *both* sides; when
C# held it, every Node respawn was rejected the same way. Node's own
Plugin-Service-level auto-respawn (near-instantaneous, faster than C#'s
15s backoff) made it necessary to temporarily move the Node plugin's
`index.mjs` aside during C#-focused test windows (reversible — restored
and re-verified working, see below — never deleted, never edited).

**Command parity (A–J)** — all 9 static actions plus the dial confirmed
with real server-side evidence (`app.log` `command requested`/`command
result` pairs, not just console-side appearance): SELECT
(`selection.toggleCurrent`), SELECT ALL (`selection.selectAll`), CLEAR
(`selection.clear`), PREVIEW (`preview.toggle`), G1/G2/G3
(`group.assign`, now with distinct logged `groupId`s), UNASSIGN
(`group.unassign`), REFINE TAGS (`tagRefinement.open`), CHANGE EVENT
(`event.openChooser`). Dial (`navigation.previousFile`/`nextFile`)
confirmed at slow and rapid rotation (a ~40ms-apart burst occurred
naturally) and at both boundaries (stops safely at the first/last file,
no wraparound, no error).

**Tag Refinement regression** — two console observations traced to exact,
pre-existing `renderer.js` code paths rather than defects:
- REFINE TAGS opened with **zero files selected** — this is the existing
  footer "Refine Tags" button's own event-scope behavior
  (`_isEventRefineAvailable()` is checked *before* `selectedFiles.size`
  in `_resolveRefinementTargetScope()`, for single-component events) —
  the C# command reproduces this faithfully, it did not invent it.
- Pressing REFINE TAGS again while **already open** is a no-op — the same
  function's first line (`if (TagRefinementManager.isActive()) return
  null;`) gates it off, identical to a second click on the real button.
  (`ok` stays `true` either way — `ok` means "ran without error," not
  "did something"; `executed` is the separate field that would read
  `false` here, consistent with the design `commandManager.js`'s own
  comments describe.)

  Both results are good UI↔command-equivalence evidence per se, not gaps.

**Scenario A closure — multi-file/mixed-selection Tag Refinement** (originally
deferred, later completed): using a disposable two-component synthetic event
(`Fajr Namaz`/`Majlis` on component 1), two synthetic files were grouped
together (G1) and given deliberately conflicting per-file overrides via the
real panel (file 1: `Fajr Namaz` only; file 2: `Majlis` only — the panel's
chips are real `<input type="checkbox">` elements, confirmed keyboard-
operable without a trackpad, though not needed once a trackpad became
available). Selecting both files *within the refinement workspace itself*
(entering refinement mode clears the outer grid selection by design —
`_enterRefinementMode()`'s `selectedFiles.clear()` — so the operator
re-selects inside that view, not before entering it) and pressing REFINE TAGS
again produced **both tags showing mixed/indeterminate**, confirmed both via
your visual report and via `app.log` (two `selection.toggleCurrent ok=true`
calls inside the refinement workspace). This is exactly Phase 3E's documented
tri-state semantics, driven end to end by the C# console action.

**Scenario B closure — deep Multi-Event claim regression** (originally
deferred, later completed): built a second disposable synthetic event
(Event B, 2 components) alongside Event A from Scenario A, via AutoIngest's
real "Change Event → create new event" workspace flow. This incidentally
surfaced a genuine, pre-existing, unrelated defect
([BUG-017](product/bugs/BUG-017_EVENT_CREATE_SUBFOLDER_PATH_DIVERGES_FROM_EVENT_JSON_WRITE_PATH_AFTER_OFFLINE_EPISODE.md)):
`event.json` and an event's sub-component folders could land in two
different physical locations after an offline/`invalid-nas` episode,
leaving a folder structure with no readable `event.json` ("legacy event").
Root-caused, fixed, tested, and merged into this branch (`fix/event-json-
path-divergence` → `feature/mx-creative-console-v2`, commit `24db767`)
before continuing — zero MX-console/C# code involved; the C# work here was
purely the trigger context that happened to expose it. Re-ran the exact
"Change Event → create new event" repro against the fixed build: `event.json`
and both sub-component folders now land in the same folder, confirmed by
direct filesystem read.

With Event B created, files assigned to it via console G-presses
(`group.assign ok=true groupId=1`, logged), the actual claim-reassignment
test: with Event B current, selected both of Event A's files (owned by
Event A's G1) and pressed **G2** on the console — AutoIngest's real UI
showed the documented "moved from E1" toast, and `app.log` confirmed
`group.assign ok=true groupId=2`. Verified: Event A's now-empty workspace
was pruned from the session strip entirely (not just its group); the
"Import N Assigned Files" count stayed correct (no duplicate
claims — each file attributed to exactly one event); and re-opening REFINE
TAGS on the reassigned files inside Event B's newly-mapped group showed a
**clean default state for Event B's own tag vocabulary, with no leftover
trace of Event A's per-file overrides** — confirming `GroupManager
.assignFiles()`'s `onClaim` hook correctly clears the losing event's
refinement state on cross-event reassignment, exactly as
`docs/multi-event-import.md` and `refinableTags.js`'s own comments describe.
All of this exercised through the same proven console actions (G1/G2/G3,
SELECT, REFINE TAGS) — no new C# behavior, no AutoIngest code changes
required for the claim-reassignment mechanics themselves (only the
incidentally-discovered, unrelated path-divergence bug above needed one).

**Connection/restart tests** — all passed: two independent AutoIngest
quit/relaunch cycles each produced a new port/token and a clean C#
reconnect in ~4s; a Logi Plugin Service restart produced a clean C#
reconnect in ~3s with no duplicate host processes (one benign
`Cannot load plugin ... already loaded` log line appeared from the
freshly-spawned host losing an internal reload race to the surviving
in-process instance, but the live connection itself never actually broke).

**Application profile test** — confirmed: the console's control layout
switches correctly on every app-focus change (AutoIngest → other app →
back), independent of WebSocket connectivity, exactly as Phase 3C
predicted.

**Offline/error behavior** — passed cleanly: quitting AutoIngest removes
the matching bundle identity, so Options+ itself falls back away from the
AutoIngest profile — there is no way to even attempt a stale command
against a dead target, let alone hang or crash. Relaunching restored a
working connection (C#, ~11s) and a working console within the same
session.

**Node fallback — confirmed intact** (connection level, by explicit
instruction, not re-run as a full physical command matrix — that was
already proven in Phase 3C): with `index.mjs` restored, a fresh
AutoIngest relaunch let Node win the connection race outright, authenticate
cleanly, and have its own log show a clean `authenticated` line with zero
contention once it held the slot. Node's plugin source files were at no
point deleted, edited, or migrated — only its live process was
temporarily stopped and its entry file briefly relocated (both reversed).

**One test-setup mismatch, not a bug**: with Node holding the connection,
pressing the physical SELECT key (still mapped to the *C#* `SelectCommand`
from Step 3's profile swap) produced no visible effect. Root cause: C#'s
own command path requires C# itself to be the connected client; since
Node held the slot, C# was rejected (`already-connected`) and the key
press could not reach AutoIngest at all — `app.log` shows zero
`command requested` lines for that press. This is a direct, expected
consequence of swapping the physical profile to C#'s actions while
testing Node's connection fallback with the *same* profile still active —
not a Node defect and not an AutoIngest transport regression. Confirmed
resolved by re-swapping to C# as the sole client: the identical key press
immediately produced `command result: ... ok=true` again.

**Separate pre-existing issue, out of scope**: `IMG_0004.jpg` and
`IMG_0005.jpg` (two of the six synthetic test fixtures, byte-identical in
size to the four that work) consistently stall thumbnail generation
(`[perf] Thumbnail stalled ... never resolved`) on every run, before and
after the `sharp` packaging fix — unrelated to that fix, since it affects
only these two specific files, not thumbnails generally, and the same
`[perf] Thumbnail stalled` pattern appears routinely in AutoIngest's real
production logs going back months across unrelated RAW formats (CR2,
ARW, CR3, DNG, 3FR). Not investigated further per instruction, since
nothing ties it specifically to the C# migration.

**Node vs C# comparison**: reconnect speed (~3–4s both), stability
(both single-client-arbitrated correctly, no crashes), Action Picker
visibility (both fully visible), profile-switch behavior (identical,
since both are governed by the same Options+ bundle-ID mechanism, not
plugin language), logging (both avoid leaking the auth token). Resource
usage was *not* cleanly comparable: Node gets its own dedicated OS
process (~44MB RSS observed) exclusively for this plugin, while C# runs
in-process inside Logi Plugin Service alongside every other loaded
plugin (Lightroom, Photoshop, etc.), so LogiPluginService's total
footprint (~271MB observed) cannot be attributed to the AutoIngest plugin
alone. One asymmetry worth noting: Node's Plugin-Service-level respawn is
near-instantaneous (sub-second) on process death, while C#'s own
reconnect backoff starts at ~2–4s and grows — not a defect in either, just
a architectural difference between a separately-spawned child process and
an in-process-hosted plugin.

---

## Current status (end of Phase 4A physical parity test)

- Builds cleanly: **0 warnings, 0 errors** (main plugin project).
- Loads into Logi Plugin Service successfully, in-process, confirmed via
  its own dedicated log file.
- Connects and authenticates against the real, unmodified Phase 2
  transport — confirmed on both sides of the connection, including after
  two independent app restarts and one Plugin Service restart.
- 32/32 automated tests passing, covering descriptor discovery, connection
  lifecycle, command execution, resilience, and security.
- **Physical console parity test now complete**: all 9 static actions,
  the dial (including boundaries), the application-profile switch, and
  offline/error behavior all confirmed on the real MX Creative Console
  against a real packaged AutoIngest build, with real server-side log
  evidence for every result. Node plugin confirmed intact as fallback.
- **Both previously-deferred scenarios now closed**: a multi-file/mixed-
  selection Tag Refinement press (correct mixed/indeterminate tri-state)
  and a deep Multi-Event-ownership/claim-reassignment scenario (correct
  claim transfer, workspace pruning, no duplicate claims, correct
  cross-event Tag Refinement cleanup) both passed. The latter incidentally
  surfaced and led to fixing an unrelated, pre-existing defect
  (BUG-017 — see docs/product/bugs/), merged into this branch.
- **Phase 4B (dynamic Tag Refinement workspace) — software complete,
  physical device testing pending.** See the dedicated section below.

---

## Phase 4B — Dynamic Tag Refinement workspace

The real dynamic workspace: pressing REFINE TAGS enters a live `PluginDynamicFolder`
showing AutoIngest's actual refinable tags for the current selection, with
real tri-state rendering and direct hardware editing — mirroring the real
panel's draft/Apply semantics exactly, never a second model.

### Architecture — three layers, deliberately separated

1. **`RefinementWorkspaceModel.cs`** (`Helpers/`) — pure, Logitech-free logic.
   Every state/identity/transition decision lives here: `BuildButtonSpecs`
   (state → ordered button list), `ComputeNextChecked` (the press→target-
   state rule), `ResolveTag` (fresh re-validation against the latest state),
   `IsControlAction`, `TruncateForDisplay`. No `BitmapBuilder`, no SDK type,
   anywhere in this file — fully unit-testable without a Logitech host.
2. **`RefinementButtonImageRenderer.cs`** (`Helpers/`) — the ONLY file that
   touches `BitmapBuilder`/`BitmapColor`. Renders one `RefinementButtonSpec`
   into a `BitmapImage`. Nothing else in this layer makes a decision; it just
   draws what it's told.
3. **`RefineTagsFolder.cs`** (`Actions/`) — the actual `PluginDynamicFolder`
   subclass. A thin shell: SDK lifecycle wiring + the `AutoIngestClient`
   subscription, calling into the two layers above for everything else.

This mirrors Phase 4A's own command/model/render separation and directly
satisfies the brief's "testable model separate from Logitech rendering"
requirement (§23) — `RefinementWorkspaceModelTests.cs` exercises layer 1
with zero SDK dependency at all.

### Tag identity — no custom encoding introduced

AutoIngest's own `tagRefinement.tags[].id` (`"<category>:<label>"`, e.g.
`"eventTypes:Waaz"` — `renderer.js`'s `_getTagRefinementCompact()`) is
already a plain string and already collision-free (every real id starts
with `eventTypes:` or `additionalKeywords:`, the only two categories
`commandManager.js` validates). It is used completely unmodified as the
Loupedeck `actionParameter`. The three control buttons use fixed sentinel
strings (`__apply__`, `__allTags__`, `__resetTags__`) that can never collide
with a real tag id for the same reason. **No encoding/decoding step exists
anywhere in this code** — introducing one on top of an already-canonical
string would be the mistake, not the fix.

### Lifecycle

- **`Load()`/`Unload()`**: no-ops (`return true`) — nothing plugin-lifetime
  to prepare; everything meaningful happens per-entry.
- **`Activate()`**: subscribes to `SharedClient.Instance` state changes,
  then (fire-and-forget, never blocking the SDK's synchronous callback)
  checks whether `tagRefinement.Active` is already true; if not, executes
  `tagRefinement.open` and waits (4s timeout) for the resulting state push
  before populating the button list. If refinement never becomes available
  (no refinable selection), logs the reason and calls `Close()` rather than
  showing a fabricated empty editor.
- **`Deactivate()`**: disposes the subscription, clears the local button-
  spec cache. **Does not call `tagRefinement.close`** — leaving the
  hardware workspace is not the same action as the real panel's own "Done
  Refining" button; the operator's draft and AutoIngest's own refinement
  session are untouched, resumable from the real on-screen panel or by
  re-entering the folder.

### Press semantics — confirmed from the real UI, not assumed

Traced `renderer.js`'s `_refinementTagDisplayState`/`_setRefinementDraftTag`
before writing any transition logic. `tagRefinement.setTagState` **sets** an
explicit target `checked: boolean` — it is not a cycle. The real
transition table (verified, not guessed):

| Current display state | Press result |
|---|---|
| `unchecked` | → `checked` |
| `indeterminate` | → `checked` (same as any native checkbox: a click always resolves to a definite value; an untouched indeterminate tag's underlying `.checked` is already `false`) |
| `checked` | → `unchecked` |

`RefinementWorkspaceModel.ComputeNextChecked(currentState)` implements
exactly this, nothing else.

### Draft state — no optimistic redraw

A tag press sends `tagRefinement.setTagState` and stops. The redraw happens
only when the next state push arrives (`OnStateChanged`, subscribed once per
`Activate()`), driven by AutoIngest's own authoritative draft — never a
locally-guessed value. This is the same "wait for confirmation, never
optimistic" rule Phase 4A's own command actions already follow.

### Apply / All Tags / Reset Tags

- **Apply** (`tagRefinement.applyToSelected`) — commits the draft via the
  real `TagRefinementManager`. The folder **stays open** afterward (per the
  brief's explicit instruction); the next state push shows the newly
  committed state, and the operator can keep refining the same selection.
- **All Tags** (`tagRefinement.useAllTags`) — "Use All Component Tags"
  (`#rpAllBtn`'s real effect): every available tag applied to the draft.
- **Reset Tags** (`tagRefinement.clearSelected`) — **verified against the
  real implementation before labeling it** (`_resetRefinementSelectionToDefault`,
  the real panel's `#rpResetBtn` "Reset Selected to Defaults"): reverts to
  **inheriting the component's defaults**, which may still leave tags
  checked. It is explicitly **not** "no tags"/"clear all" — an earlier draft
  of this feature mislabeled it "Clear Tags" before this was checked against
  source, caught during implementation, and corrected. Labeled "Reset Tags"
  on the hardware.

All three control buttons appear only when `availableCommands` actually
contains their real command id right now — the same availableCommands-
gating every other action in this plugin already uses, never a separately
re-derived eligibility rule. (AutoIngest deliberately omits a `canApply`
state field for exactly this reason — see `_getTagRefinementCompact()`'s own
doc comment.)

### Visual rendering

Label is the dominant element (the brief: "the tag value/name is the most
important information") — centered, wrapping `DrawText`, truncated only
when a label is long enough to need it (never replaced with a placeholder
like "Tag 1"). A small, high-contrast state badge sits in the top-right
corner, shape-coded (not color-only, per the brief's explicit rule):
filled checkmark (checked), outlined ring (unchecked), filled dash (mixed/
indeterminate). Control buttons (Apply/All Tags/Reset Tags) use a distinct
background tint from plain tag buttons, label only, no state badge.

### List refresh vs. single-image refresh — revised after physical testing

Original design (above the line): diff the button-spec set on every push,
use `ButtonActionNamesChanged()` for a list-membership change and
`CommandImageChanged(actionName)` per-button for a same-list state-only
change (e.g. a tag's checkmark flipping). **Physical testing found this
does not work as designed, and the eventual fix is a behavior change, not
a rendering detail:**

- `CommandImageChanged()` does not cause any `GetCommandImage` requery at
  all in this installed SDK (v6.4.2.3414) — confirmed across three separate
  attempts with diagnostic logging, both the `CreateCommandName()`-wrapped
  and raw-`actionParameter` forms, from multiple execution contexts.
- An interim fix forced a state-only change to "really" change the list
  twice (drop to empty, notify, restore the real list, notify again) so
  every button looked "new" to `ButtonActionNamesChanged()`'s own working
  mechanism. This visually updated ticks, inconsistently — **and pagination
  testing (brief §13) found it had a 100%-reproducible, far worse cost: any
  tag press on page 2+ of a multi-page scope snapped the device back to
  page 1**, making multi-page refinement practically unusable.
- **Final, shipped behavior**: a same-list, state-only change is now a
  genuine no-op. Only a real list-membership change calls
  `ButtonActionNamesChanged()`. Tag ticks are correct on every fresh
  `Activate()` or list-changing redraw; they do not flip live in place
  while the same button list stays on screen (e.g. after a same-session
  selection change). Confirmed as the deliberate, user-accepted trade-off:
  never fight pagination to chase a redraw mechanism this SDK build does
  not reliably support.

### Pagination

No fixed tag limit anywhere in this code. `GetButtonPressActionNames`
returns the real, unbounded tag list every time; Logitech's own
`PluginDynamicFolder` is documented to paginate automatically when content
exceeds one page. **Not yet physically verified** how many usable slots the
real MX Creative Keypad gives per page, or how Apply/All Tags/Reset Tags lay
out once pagination kicks in — see "Physical testing — pending" below.

### Back / navigation

`GetNavigationArea` returns `PluginDynamicFolderNavigation.ButtonArea` —
Logitech supplies the Back button automatically on touch pages, the brief's
preferred first implementation. (An earlier draft set the `Navigation`
property directly in the constructor; the compiler flagged it as obsolete
in this SDK version — `GetNavigationArea` is the supported mechanism, fixed
before this was committed.) Back is never wired to `tagRefinement.close` —
leaving the folder and closing AutoIngest's own refinement session are
different actions (see Lifecycle above).

### Selection/scope changes while the folder is open

Every state push rebuilds the button list from scratch — there is no
"stale tag" state to accidentally preserve. A tag press always re-resolves
against `SharedClient.Instance.GetLatestState()` fresh (`RunCommand` never
consults the cached button-spec dictionary for validation, only for
display) — an id from a scope that no longer exists resolves to `null` and
is silently ignored (logged, never mutated).

**Revised after physical testing**: the folder no longer closes itself when
`tagRefinement.Active` becomes `false` — see "`Close()` removed" below for
why. `BuildButtonSpecs` renders a single informational `Unavailable` button
instead, and pressing it retries the open attempt (see "Stuck-state retry"
below).

Confirmed group-change-while-open (brief §16) is **blocked by AutoIngest's
own pre-existing architecture**, not something this folder needs to defend
against: `getVisibleFiles()` filters the entire grid to the active
refinement scope while refinement is active, so another group's files are
never reachable to re-map in the first place. Change-Event-while-open
(brief §17) IS allowed by AutoIngest and does **not** auto-close an active
refinement session — confirmed as a genuine, pre-existing condition in
`renderer.js`'s `_resolveRefinementTargetScope()`/`event.openChooser`, not
a Phase 4B defect. See "Physical closure findings" below for the full,
initially-confusing repro and its real root cause (a missing
group→sub-event console command, not Dynamic Tag Refinement).

### `Close()` removed — a core architectural pivot from physical testing

`RefineTagsFolder` never calls `this.Close()`, on itself or reactively.
An earlier revision did call it from `OnStateChanged` whenever refinement
became unavailable. Physically, this produced a zombie-session bug:
repeated, apparently-ineffective `Close()` calls while the device kept
routing presses to the same stale instance, and the physical REFINE TAGS
key then appeared to open nothing on the next press. Removed entirely;
`BuildButtonSpecs` shows an informational `Unavailable` button instead, and
the operator exits via the real hardware Back button.

### Offline / disconnect behavior

**Revised after physical testing** — the folder does not close itself on
disconnect (see "`Close()` removed" above); a disconnected/null state
pushes through `BuildButtonSpecs` to the same `Unavailable` rendering.
Confirmed via the real AutoIngest-quit-while-folder-open scenario (brief
§18): the console correctly fell back to its normal (non-AutoIngest)
profile with no crash, and relaunching AutoIngest reconnected cleanly.

### Stuck-state retry — the Unavailable button is a retry lever

Confirmed via plugin-log evidence (not guessed) that this SDK build does
not reliably call `Activate()` again on a later re-entry to the same
dynamic-folder instance — in one observed session it fired exactly once for
the whole session, including across a full AutoIngest quit/relaunch cycle.
Without a fix, a press that landed on `Unavailable` for a reason that had
since resolved (a file now selected, AutoIngest reconnected) was a dead
end — the only recovery was restarting the Logi Plugin Service. Pressing
the `Unavailable` button itself now retries `EnsureOpenAndPopulateAsync`
directly, giving the operator an in-band recovery path.

Separately, a full Logi Plugin Service restart (killing its processes; the
service auto-respawns) was confirmed, as its own deliberate test, to always
cleanly recover the plugin and reconnect — a legitimate fallback recovery
step for an operator, not something to rely on for routine use.

### Testing

- **`RefinementWorkspaceModelTests.cs`** (28+ tests): state→button-list
  mapping, tag-order stability, identity passthrough/non-collision,
  duplicate labels across categories, all three display states preserved
  verbatim, the confirmed transition table, stale/unknown tag rejection,
  full tag-set replacement on a new state, per-command availableCommands
  gating (Apply/All Tags/Reset Tags/Select/Clear), the corrected "Reset
  Tags" wording pinned against regression, button ordering (Select/Clear
  first, then tags, then All Tags/Reset Tags/Apply), the single-entry
  `Unavailable` fallback, null-safety, the corrected word-boundary-aware
  truncation (both the "has a wrap point" and "no wrap point" cases pinned
  against the real physical overflow this replaced), and
  `System.Text.Json`'s default tolerance of unknown future fields.
- **`RefinementTransportIntegrationTests.cs`** (1 comprehensive test): the
  real `AutoIngestClient` against `MockAutoIngestServer`'s real WebSocket/
  JSON path — open → real mixed-state tag list arrives → press an
  indeterminate tag → verify the server received the exact real payload
  shape (`{tagId, checked}`) → draft state pushed and redrawn from the
  server's own authoritative value (never the locally-sent guess) → Apply
  → committed `status: "refined"` pushed and observed. Found and fixed one
  real latent bug in the shared test harness while writing this
  (`MockAutoIngestServer` stored a `JsonElement` view into a `JsonDocument`
  it then disposed — any test that inspected payload contents *after* the
  handler returned would throw `ObjectDisposedException`; no prior test had
  done so. Fixed with `.Clone()`).
- Full suite: **63/63 passing** (32 from Phase 4A + 26 Phase 4B software +
  5 physical-closure regression tests).

### Physical closure findings (Phase 4B closure session)

Full on-device walkthrough completed — real tag labels, real
checked/unchecked/indeterminate rendering, press transitions, pagination
with a 15+ tag scope, long-label truncation, Apply/All Tags/Reset Tags,
Select/Clear, Back, AutoIngest quit/relaunch, and a Logi Plugin Service
restart. Six real, confirmed issues found and fixed (see each one's own
section above for detail):

1. **Zombie-subscription spam** after leaving the folder — fixed with the
   `_isActive` guard (set in `Activate()`, cleared first in `Deactivate()`).
2. **`Close()` unreliable from a background thread** — removed entirely;
   see "`Close()` removed" above. The single biggest architectural pivot
   from physical testing.
3. **Selection unreachable inside the workspace** — entering refinement
   mode has always cleared the outer file-grid selection
   (`_enterRefinementMode()`, pre-existing, unrelated to Phase 4B); the
   dynamic folder replacing the whole Keypad grid removed the operator's
   only way back to the real SELECT key. Fixed by adding `Select`/`Clear`
   buttons mapped to the existing `selection.toggleCurrent`/`selection.clear`
   commands, placed first in the button order.
4. **Live tick redraw vs. pagination** — see "List refresh vs.
   single-image refresh — revised after physical testing" above. The
   state-only redraw trick was removed after it was found to snap the
   device back to page 1 on every tag press on a multi-page scope.
5. **Stuck `Unavailable` with no re-entry path** — see "Stuck-state retry"
   above.
6. **Long-label overflow** — `TruncateForDisplay`'s original budget assumed
   ~7px/char across two lines unconditionally. Physical testing with a
   hyphenated (no-space) long keyword overflowed the LCD key badly.
   Rendered the real font via a `SkiaSharp.MeasureText` reflection probe
   against the installed `PluginApi.dll` (same discipline as the rest of
   this document — measured, not guessed): ~9.3px/char at this button's
   fontSize. `BitmapBuilder.DrawText` only wraps at whitespace — confirmed
   by rendering "Test Tag One" (wraps correctly) vs. the hyphenated label
   (renders as one unbroken, clipped line). Fixed: a label with no wrap
   point gets one line's worth of budget; a label with a real wrap point
   still gets the original two-line budget. Known residual limitation
   (not fixed, out of smallest-fix scope): an individual word inside a
   multi-word label that is itself longer than one line's budget can still
   overflow that wrapped line — not observed with this product's real
   (short) tag labels.

Two additional real findings that are **not** Phase 4B defects, confirmed
by checking real behavior before concluding anything:

- **Apply can cause AutoIngest's own on-screen refinement panel to exit.**
  Initially suspected as a console-side bug; the user confirmed the
  computer's own panel closed too. Accurate mirroring of real behavior, not
  a defect — this supersedes the original brief's own assumption that Apply
  should never auto-close.
- **A multi-component event's "no console command to assign a group to a
  sub-event" gap** blocked REFINE TAGS after Change Event in a way that
  initially looked like a stale-state bug. Traced conclusively: Change
  Event itself works fine on the console; `tagRefinement.open`'s real
  eligibility check (`_resolveRefinementTargetScope()`) correctly requires
  the selected file's group to already have a `subEventId` mapping to one
  of the event's components, and `group.assign` (the only console group
  command that exists) only assigns a file to a group — it does not assign
  a group to a sub-event. That mapping currently only exists via the Group
  Manager UI on the computer. Confirmed as the true root cause by assigning
  the sub-event via the computer, then immediately re-trying REFINE TAGS on
  the console for that file — it opened. This is a real, legitimate gap,
  but in the group-management command surface (Phase 1A/3), not in Dynamic
  Tag Refinement — recommended as a future console command
  (`group.assignSubEvent` or similar), not built in this session.

The physical REFINE TAGS key is remapped in Options+ to this folder's own
entry action (done during this closure session); the Phase 4A static
`RefineTagsCommand` action remains intact, unmapped, as reference/fallback.

### Code changes outside the C# plugin

None. `GatedCommand.cs` gained one optional `payload` parameter (backward-
compatible, used only by `setTagState`) — an extension of this plugin's own
internal helper, not an AutoIngest API change. Zero renderer/main/transport
changes, per the brief's §33 preference.

### Phase 4B closure verdict

**Dynamic Tag Refinement is production-usable**, with one accepted,
documented limitation: tag ticks do not live-redraw in place while the
folder stays open on a same-list state change (deliberate trade-off vs.
breaking pagination — see "List refresh vs. single-image refresh" above).
All six real defects found during physical closure were fixed, covered by
automated regression tests, and re-verified live. Two additional findings
(Apply exits the real panel; no console command to assign a group's
sub-event) are confirmed accurate/out-of-scope, not defects. **C# is
confirmed the primary MX Creative Console implementation** — the Node
plugin remains intact as reference/fallback, unchanged, not deleted.
Recommended next phase: continue with QMZ/Import console work, or a
dedicated session to add the missing group→sub-event console command,
per the user's own prioritization — not started automatically.

---

## Phase 4C — Group → Sub-Event Mapping workspace

Closes the gap Phase 4B closure found: the console could assign files to
G1/G2/G3 but had no way to map a group to one of a multi-component event's
real components, so Tag Refinement correctly stayed unavailable until the
operator used the computer. See `docs/commandLayer.md`'s own "Group →
Sub-Event Mapping — `group.setSubEvent` (Phase 4C)" section for the full
command-layer design (authoritative UI path traced first, side effects
preserved exactly, target-group resolution, state schema) — this section
covers the C# dynamic workspace built on top of it.

### Architecture — same three-layer split Phase 4B established

- **`GroupMappingWorkspaceModel.cs`**: pure, Logitech-free logic. Builds
  the button list from `availableSubEvents`/`targetGroupIdForMapping`/
  `groups` (all already resolved authoritatively by the renderer — no
  business-rule duplication here), marks the current mapping and any
  component already taken by a different group. Fully unit-tested, zero
  SDK dependency.
- **`GroupMappingButtonImageRenderer.cs`**: the only file touching
  `BitmapBuilder`/`BitmapColor` for this feature — a green check badge for
  the current mapping, a red "x" badge for a component taken by another
  group, reusing `RefinementWorkspaceModel.TruncateForDisplay` for the
  label (brief §9's "never color-only" rule, same visual language Phase
  4B's tag badges already established).
- **`GroupMappingFolder.cs`**: the actual `PluginDynamicFolder` — SDK
  lifecycle + `AutoIngestClient` subscription wiring only.

### Every Phase 4B physical-closure lesson applied from the start

Rather than rediscover these live again, `GroupMappingFolder` is built with
every confirmed finding already in place:
- **Never calls `Close()`** — same zombie-session risk `RefineTagsFolder`
  found; an informational `Unavailable` button instead, exited via the
  real hardware Back button.
- **The `Unavailable` button is a retry lever**, not a dead end — this SDK
  build does not reliably call `Activate()` again on a later re-entry to
  the same folder instance; pressing it forces `RefreshButtonList()`
  directly.
- **Only a real list-membership change calls `ButtonActionNamesChanged()`**
  — a same-list `IsCurrent`/`IsTakenByOtherGroup` flip is not live-
  redrawn in place (visible on the next real redraw instead), the same
  pagination-safety trade-off `RefineTagsFolder`'s own "List refresh" doc
  comment explains in full.
- **Every mutating press re-resolves fresh** against
  `SharedClient.Instance.GetLatestState()` — both `targetGroupIdForMapping`
  and the pressed component id, never a cached value.
- **Threaded through `ActionRunner.FireAndForget`**, not called directly
  from the WS receive-loop thread, matching the fix `ButtonActionNamesChanged()`
  needed to reliably take effect in `RefineTagsFolder`.

### Component mapping UX

No "open" step is needed (unlike `tagRefinement.open`) — the workspace only
ever reads already-authoritative state, so `Activate()` populates
immediately from the latest snapshot. One button per real available
component, in `EventCreator`'s own order (never resorted). Pressing a
component sends `group.setSubEvent({ groupId: <resolved fresh>, subEventId:
<the pressed component's real id> })`; pressing an already-current or
already-taken component is rejected safely by the real renderer-side
validation (defense in depth — the same "never trust a stale cache for a
mutating action" rule every other press in this plugin already follows).

### Single-component events

`availableSubEvents` is `[]` for a single-component event (the underlying
`EventCreator.getSubEventNames()` already returns `[]` — no behavior to
preserve or invent here); `BuildButtonSpecs` renders the same informational
`Unavailable` entry it would for "no target group" — there is nothing
console-specific to add, since the real UI itself has no sub-event dropdown
for this case either.

### Tag Refinement integration — confirmed end-to-end

`GroupMappingTransportIntegrationTests.cs`'s
`FullMappingFlow_UnmappedToMapped_UnlocksTagRefinementEligibility` proves
the exact chain brief §10 asked to verify, over the real transport: an
unmapped group's workspace shows no current mapping and
`tagRefinement.open` is absent from `availableCommands` → `group.setSubEvent`
→ the pushed state shows the real mapping AND `tagRefinement.open` becomes
available — no restart, no reload.

### Physical key placement — reported, not forced (brief §18)

The Browse profile's 3×3 layout is already fully occupied (SELECT / SELECT
ALL / CLEAR / PREVIEW / G1 / G2 / G3 / UNASSIGN / REFINE TAGS — all nine
slots). No clean permanent entry point exists for a tenth action without
displacing an existing one. Per the brief's own instruction, this is
reported rather than forced: the software (command, state, dynamic
workspace, all automated tests) is complete and ready to physically test,
but which physical key (if any) the operator is willing to temporarily
reassign for testing — and permanently, if they choose — is their call, not
assumed here.

### Testing

- **`GroupMappingWorkspaceModelTests.cs`**: 16 tests — see
  `docs/commandLayer.md`'s own test summary for the full list.
- **`GroupMappingTransportIntegrationTests.cs`**: 2 tests — the full
  unmapped→mapped→Tag-Refinement-unlocked flow over the real transport,
  plus a dedicated duplicate-rejection transport test.
- **`mxCommandLayerPhase4CLive.test.js`**: the full command-layer test
  battery (brief §14) against the real Electron renderer.
- Full C# suite: **81/81 passing** (63 Phase 4B closure + 18 new).

### Physical device testing — pending

Not yet run: the real on-device walkthrough (brief §17) — real component
names on the real Keypad, pressing a component and confirming the real
AutoIngest mapping updates, re-opening the workspace to confirm the current
mapping is visibly marked, remapping and confirming Tag Refinement's
available tag set changes accordingly, Change Event replacing a stale
component list, Back without changing anything, and pagination if the
event has enough components. Requires deciding, with the operator, which
physical key temporarily hosts this workspace's entry action for testing
(see "Physical key placement" above).
