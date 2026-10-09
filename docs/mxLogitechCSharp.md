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
  **Deferred, not yet run**: a true multi-file/mixed-selection REFINE
  TAGS press (tri-state display across files with different tag states).

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
- **Still deferred** (not a defect, just not yet exercised): a
  multi-file/mixed-selection Tag Refinement press, and a deep
  Multi-Event-ownership/claim-reassignment group side-effect scenario.
- **Not yet done** (unchanged, explicitly Phase 4B's scope):
  `PluginDynamicFolder`/dynamic Tag Refinement content.
