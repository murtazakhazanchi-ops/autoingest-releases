# MX Logitech Plugin (AI-FEAT MX Console — Phase 3A + 3B + 3C + 3D + 3E)

The real Logitech MX Creative Console plugin. Phase 3A proved physical
end-to-end control as an integration smoke test (three actions). Phase 3B
turns it into the first practical Browse/Select operator surface — nine
keypad actions plus the dial, still no Group/QMZ multi-page system. Phase 3C
adds no plugin code at all — it gives that Browse surface its own dedicated,
auto-switching Logi Options+ application profile, so AutoIngest's mappings
no longer have to live permanently on the operator's default/global console
layout. It connects to AutoIngest's existing Phase 2 control transport
(`services/mxControlService.js` — see
[mxControlTransport.md](mxControlTransport.md)).

**This Node plugin (`integrations/logitech/autoingest-mx/`) is the
proven reference implementation and current fallback.** Phase 4A
(see [mxLogitechCSharp.md](mxLogitechCSharp.md)) built a separate C#
plugin (`integrations/logitech/autoingest-mx-csharp/`) as a **parity
candidate** — same actions, same transport, verified end to end against
the real transport and by 32 automated tests. A follow-up physical
parity test then exercised it on the real MX Creative Console against a
real packaged AutoIngest build: all 9 static actions, the dial, the
Options+ application-profile switch, connection/restart recovery, and
offline/error behavior all passed with real server-side log evidence —
see [mxLogitechCSharp.md](mxLogitechCSharp.md)'s "Physical console parity
test" section for the full results; both scenarios originally deferred
there (a multi-file Tag Refinement press, a deep Multi-Event-ownership
regression) were subsequently run and passed. C# was then designated the
primary MX implementation candidate, and **Phase 4B (the real dynamic Tag
Refinement workspace, the actual reason the C# migration exists) is now
software-complete** — a real `PluginDynamicFolder`, built/tested
(58/58 automated tests passing including a real end-to-end transport
test), but **not yet physically verified on the real console** — see
[mxLogitechCSharp.md](mxLogitechCSharp.md)'s "Phase 4B — Dynamic Tag
Refinement workspace" section. This Node
plugin was confirmed still fully intact as a fallback during Phase 4A's
physical test (its source files were never edited or deleted) and keeps working
exactly as documented below regardless of how Phase 4B eventually
concludes.

---

## Plugin location

```
integrations/
  logitech/
    autoingest-mx/          the plugin — its own package.json/node_modules,
                             logically separate from the AutoIngest app
      index.ts               entry point — registers actions, connects
      src/
        descriptor.ts          cross-platform descriptor discovery/validation
        autoIngestClient.ts    connection manager (the AutoIngestClient)
        sharedClient.ts        the one shared AutoIngestClient instance
        groupSlotHelper.ts     Phase 3B: G1/G2/G3 label resolution + assign
        actions/
          toggleSelectionAction.ts    Select (Phase 3A, displayName updated)
          navigateFilesAction.ts      Navigate Files (dial, unchanged)
          previewAction.ts            Preview (Phase 3A, now a standing key)
          selectAllAction.ts          Select All (Phase 3B)
          clearSelectionAction.ts     Clear (Phase 3B)
          unassignGroupAction.ts      Unassign (Phase 3B)
          assignG1Action.ts           G1 (Phase 3B)
          assignG2Action.ts           G2 (Phase 3B)
          assignG3Action.ts           G3 (Phase 3B)
          groupsPagePlaceholderAction.ts   Groups › (Phase 3B, intentional placeholder)
      test/
        testHarness.ts                          shared real-AutoIngest launch helpers
        descriptor.test.ts                      unit tests
        groupSlotHelper.test.ts                 unit tests (Phase 3B)
        browseActions.unit.test.ts              unit tests, mocked client (Phase 3B)
        autoIngestClient.integration.test.ts    integration tests (real transport)
        browsePageActions.integration.test.ts   integration tests (real transport, Phase 3B)
      package/                Logitech plugin metadata + icons
        metadata/LoupedeckPackage.yaml
        actionicons/*.svg   (10 actions — see "Button icon design" below)
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

### Browse page layout (Phase 3B)

```
┌──────────────┬──────────────┬──────────────┐
│    SELECT    │  SELECT ALL  │    CLEAR     │
├──────────────┼──────────────┼──────────────┤
│   PREVIEW    │      G1      │      G2      │
├──────────────┼──────────────┼──────────────┤
│      G3      │   UNASSIGN   │   GROUPS ›   │
└──────────────┴──────────────┴──────────────┘
Main dial: clockwise -> next file, counter-clockwise -> previous file
```

| Action `name` | SDK type | Display name | Commands | Hardware |
|---|---|---|---|---|
| `toggle_selection` | `CommandAction` | Select | `selection.toggleCurrent` | LCD key |
| `select_all` | `CommandAction` | Select All | `selection.selectAll` | LCD key |
| `clear_selection` | `CommandAction` | Clear | `selection.clear` | LCD key |
| `preview_toggle` | `CommandAction` | Preview | `preview.toggle` | LCD key |
| `assign_g1` | `CommandAction` | G1 | `group.assign` (resolved id) | LCD key |
| `assign_g2` | `CommandAction` | G2 | `group.assign` (resolved id) | LCD key |
| `assign_g3` | `CommandAction` | G3 | `group.assign` (resolved id) | LCD key |
| `unassign_group` | `CommandAction` | Unassign | `group.unassign` | LCD key |
| `groups_page_placeholder` | `CommandAction` | Groups | none — intentionally inert | LCD key |
| `navigate_files` | `AdjustmentAction` | Navigate Files | `navigation.nextFile`/`previousFile` | Main dial |
| `refine_tags` | `CommandAction` | Refine Tags | `tagRefinement.open` | Registered, unassigned (Phase 3D) |
| `change_event` | `CommandAction` | Change Event | `event.openChooser` | Registered, unassigned (Phase 3D) |

`refine_tags`/`change_event` (Phase 3D) are registered so both are
available in the Options+ Action Picker for temporary ninth-key physical
testing — see "Phase 3D" below. Neither is assigned to the Browse layout's
ninth key by this change; the eight working keys and the dial above are
unchanged.

Per the SDK's own Command-vs-Adjustment distinction: every discrete button
action is a `CommandAction`, the dial is a real `AdjustmentAction` — never a
fake keyboard-shortcut simulation. `navigate_files` still holds **no
numeric "current file" state**; it reads only `event.tick`'s sign (ignoring
magnitude), issues exactly one command per detent, and lets AutoIngest's
own result (`executed:true/false`) be the sole authority on whether
anything moved.

`toggle_selection`'s `name` deliberately stayed `toggle_selection` (Phase
3A's original identity, so any existing hardware assignment survives);
only its `displayName` changed, from "Toggle Selection" to "Select", to fit
the compact keypad label. `preview_toggle` is unchanged in every respect —
Phase 3A introduced it as an optional second key; Phase 3B's layout simply
makes it a standing one.

**Command availability gating.** `select_all`, `clear_selection`,
`preview_toggle`, `unassign_group`, and `assign_g{1,2,3}` all consult
`autoIngestClient.getLatestState()?.availableCommands` before calling
`executeCommand()`, skipping (and logging why) when the target command
isn't currently in that list. This is a **UX convenience only** — it never
reproduces `canExecute()`'s business rules locally, and if `getLatestState()`
returns `null` (renderer not ready yet) every gate falls through and lets
AutoIngest itself decide, rather than blocking on stale/missing local data.

**Context gating.** `unassign_group` and `assign_g{1,2,3}` additionally skip
when `state.context !== 'browse'` (so they fail safely — no request sent at
all — while QMZ or import is active), matching the Phase 3B brief's "know
the current context, log/ignore Browse-only actions when inappropriate."
`select_all`/`clear_selection`/`preview_toggle` are **not** context-gated —
they remain meaningful outside pure browse too, and `AutoIngestCommands`'
own `check()` already governs their real eligibility either way. No second
mode/context state was invented in the plugin — every gate reads AutoIngest's
own pushed `context` field directly.

`refine_tags`/`change_event` (Phase 3D) follow the exact same two gating
patterns: both consult `availableCommands` (`tagRefinement.open`/
`event.openChooser` respectively) before calling `executeCommand()`, and
both additionally skip when `state.context !== 'browse'` — same reasoning
as `unassign_group`/`assign_g{1,2,3}` above.

No QMZ/import/archive actions exist yet — explicitly out of scope for
Phase 3B (and 3D) too.

---

## Group mapping strategy (Phase 3B)

`src/groupSlotHelper.ts` resolves a keypad "G1"/"G2"/"G3" press to
AutoIngest's real group id and issues `group.assign` through it — shared by
the three thin `AssignG{1,2,3}Action` classes (see "SDK capability matrix"
below for why three classes exist instead of one configurable action).

**Why label resolution, not a hardcoded id.** `renderer/groupManager.js`'s
own header comment documents `id` as a MUTABLE display/order identity,
renumbered sequentially on every `removeGroup()` — but that same function,
and `createGroup()`, always keep `label` in lockstep as `` `G${id}` ``
(verified by reading the module directly, and re-confirmed live: a group
recreated after a full unassign came back as `{id:1, label:'G1'}`, matching
a fresh session exactly). So "the group currently labeled G1" and "the
group whose id is 1" are always the same group at any given moment — but
the plugin still resolves by **label from AutoIngest's own pushed state**
(`state.groups`), never by assuming id 1 means G1, because that is what
AutoIngest actually reports and costs nothing extra to read correctly.

**No new AutoIngest command was needed.** Before writing any plugin code,
`renderer.js`'s `_assignSelectionToGroup(groupId)` — the real primitive the
existing `group.assign` command, the context menu, and the Cmd+G digit-chord
all already share — was read directly:

```js
const existing = groupId != null ? GroupManager.getGroups().find(x => x.id === groupId) : null;
const gid = existing ? existing.id : GroupManager.createGroup();
```

If `groupId` doesn't match an existing group, this **always** falls through
to `GroupManager.createGroup()`, which **ignores the requested id** and
creates the next sequential group. This is confirmed, existing, shipped
behavior — the Cmd+G chord's own toast (`` `Assigned to G${gid}` ``) reports
whatever `gid` actually came back, not the digit the operator pressed. So
`group.assign` already safely expresses exactly what Phase 3B needed
("assign to this existing group, or create-and-assign the next sequential
one") with zero new AutoIngest surface. `assignToGroupSlot()` replicates
this faithfully: if label resolution fails, it passes the slot number
itself as `groupId` — behaviorally identical to passing `null`, since both
fall through to the same `createGroup()` call.

**Known, inherited quirk — not a plugin defect.** If slots are assigned out
of order (e.g. pressing G3 before any group exists), the group that gets
created is labeled by whatever's next sequentially (G1 in that example),
**not** G3 — exactly matching what the keyboard chord has always done.
Verified live and in the integration test suite (creating G1 fresh after a
full unassign correctly came back as `{id:1, label:'G1'}`, never
misnumbered). Documented here rather than "fixed," because fixing it would
mean inventing new AutoIngest grouping semantics the task explicitly
forbade doing speculatively. In real photographer workflows (G1 used
before G2 before G3) this never surfaces.

---

## Profile / application linking

**Resolved in Phase 3C — see the full "Phase 3C" section below for the
complete investigation and physical verification.** Short version: Logi
Options+ (not the plugin) owns application-specific profile switching
entirely, via a `processOrBundleName` field on a `SupportedApplicationInfo`
record under
`~/Library/Application Support/Logi/LogiPluginService/Applications/<deviceType>/<key>/ApplicationInfo.json`.
This is created through Options+'s own application-picker UI, matched
against the OS's real bundle identifier, and **is not and cannot be**
something the plugin declares in its own manifest — confirmed below that
`@logitech/plugin-toolkit@0.1.1`'s `LoupedeckPackage.yaml` has no schema for
it at all.

AutoIngest's real macOS identity for this purpose: `com.autoingest.app`
(from `package.json`'s `build.appId`).

---

## Button icon design

Ten pairs of minimal, hand-authored SVG icons (`package/actionicons/` +
`package/actionsymbols/`, one pair per action, named to match each action's
`name` field — confirmed as the real convention by inspecting the toolkit's
generated example). All 24×24, no embedded text except the three intentional
number badges, and no Logitech branding — simple geometric primitives
authored for this plugin specifically, not derived from any copyrighted
asset.

Two deliberate style tiers, chosen for legibility at the MX Creative
Console's small LCD size (an explicit Phase 3B requirement) over abstract
uniformity:

- **Stroke-only** (`stroke="#e3e3e3"`, `stroke-width="2"`, round caps/joins,
  `fill="none"`), matching Phase 3A's original style — checkmark-in-square
  (Select), a second checkmark with a smaller reflected square behind it
  (Select All), an X-in-square (Clear), double chevrons (Navigate Files), a
  simple eye (Preview), a broken-bracket-with-slash (Unassign — "removed
  from its container"), and two small squares plus a forward chevron
  (Groups — "more pages," honest about being a placeholder rather than
  showing a real page).
- **Solid badge** — for G1/G2/G3 only: a filled circle (`fill="#e3e3e3"`)
  with a bold dark digit centered on top. A stroked/outlined digit at LCD
  key size is measurably harder to read than a solid numbered badge (the
  conventional treatment for numbered UI badges generally); the Phase 3B
  brief explicitly permits this ("a clear group badge/number treatment is
  acceptable"), so these three intentionally break from the stroke-only
  style rather than sacrifice legibility for consistency.

Final icon/branding design remains explicitly deferred past Phase 3B — this
is functional visual design only, per the brief's own instruction.

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

`npm test` (compiles via real `tsc` first, then runs unit then integration —
see "Known limitations" for why not `tsx`) — **80 checks total, all
passing**:

- **`test/descriptor.test.ts`** (17 checks, plain temp-dir I/O, no
  AutoIngest process needed): valid/invalid/missing descriptor parsing,
  every `DescriptorError` code, dev-vs-packaged candidate-path resolution,
  end-to-end `discoverDescriptor()` against a synthetic isolated home.
- **`test/groupSlotHelper.test.ts`** (7 checks, Phase 3B, pure function, no
  client/process needed): `resolveGroupIdByLabel()` against existing/
  missing/empty/undefined `groups`, and a null state — "group label →
  actual group id resolution" and "group missing behavior" from the Phase
  3B test requirements.
- **`test/browseActions.unit.test.ts`** (36 checks — 25 from Phase 3B, 11
  added in Phase 3D for `refine_tags`/`change_event` — the shared
  `autoIngestClient` singleton's public methods temporarily mocked and
  restored per test — no AutoIngest process): command mapping for all 12
  actions, `availableCommands` gating (each gated action verified to send
  **zero** commands when its target is unavailable), context gating (browse
  vs qmz vs import), rejection propagation (a mocked `ok:false` result never
  throws), and no-plugin-local-state-mutation (the same action instance
  called twice with different mocked states behaves purely per-state, never
  per-call-count; `navigate_files` provably holds no numeric position;
  `refine_tags` likewise).
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
  discovery layer feeding it are still 100% real). Unchanged from Phase 3A
  except now importing its launch helpers from the shared `testHarness.ts`.
- **`test/browsePageActions.integration.test.ts`** (7 checks, Phase 3B, same
  real-transport approach): the real mechanism `assignToGroupSlot()`
  depends on, proven end to end — a nonexistent "G1" creates a real group
  labeled G1; `resolveGroupIdByLabel()` then finds its real id from live
  pushed state; reassigning to that resolved id targets the *same* group,
  not a new one; a real `group.unassign` round-trip empties and
  auto-removes it (the same unchanged command whose Tag Refinement
  cleanup/badge sync Phase 1A/1B's own tests already cover exhaustively);
  and a fresh group created afterward is correctly re-labeled G1 from a
  clean slate. Architectural note: the *action classes* themselves import
  the shared singleton directly (not dependency-injected — matching the
  SDK's own generated-example simplicity), which always uses real discovery
  and so cannot safely be pointed at an isolated synthetic AutoIngest
  instance without either touching real settings or a larger refactor; this
  file therefore drives a fresh `AutoIngestClient` plus the real, exported
  `resolveGroupIdByLabel()` — the same mechanism the actions use — while the
  thin action-class glue itself is already fully covered by
  `browseActions.unit.test.ts`'s mocked-client tests.
- A genuine bug was found and fixed *while writing these tests*: two places
  called `selection.selectAll` a second time assuming it would (re)select
  everything — but `renderer.js`'s real `_selectAllVisible()` is a
  **toggle** (if every visible file is already selected, it deselects them
  instead), confirmed by reading the source directly. Not a plugin or
  transport defect — the tests were wrong to assume idempotence; fixed by
  explicitly clearing selection before each intentional re-select.
- A second, unrelated race was found the same way Phase 2/3A's own tests
  found one: `executeCommand()`'s resolution only guarantees the
  `commandResult` reply arrived, not the *separate* `state` push its side
  effects trigger — reading `getLatestState()` immediately afterward without
  waiting could observe stale data. Fixed by waiting for the specific state
  change (e.g. `selectedCount`) before depending on it, the same pattern
  already documented in `mxControlTransportLive.test.js`.

**AutoIngest-side coverage (Phase 3D, in the main repo's own `test/`, not
this plugin's).** `test/mxCommandLayerPhase3DLive.test.js` (41 checks, real
Electron renderer, real `event.json` fixtures, real multi-component groups)
proves `tagRefinement.open`'s scope resolution, `useAllTags`/`clearSelected`
against the real `TagRefinementManager`, `event.openChooser`'s real event
switch, and the subscription gap fix above — end to end, against the real
command layer this plugin's two new actions call into. See
`docs/commandLayer.md` "Tag Refinement commands"/"Change Event" for the
full write-up. The full existing regression suite (Phase 1A/1B command
layer, every Tag Refinement suite, every Multi-Event Import suite, QMZ,
`importSession`/`importSessionRunner`) was re-run after these changes — all
passing, no regression.

---

## Physical test procedure

1. `cd integrations/logitech/autoingest-mx && npm run build && npm run link`
2. Start Logi Plugin Service if not already running (or restart it after
   linking, to pick up newly-added actions — see "Reload does not
   guarantee..." above).
3. Open Logi Options+ → the MX Creative Console's device configuration
   screen → confirm **AutoIngest**'s ten actions appear under "All Actions"
   → assign per the Browse page layout (see "Logitech actions implemented"):
   Navigate Files to the main dial, and the nine `CommandAction`s to the
   nine LCD keys.
4. Launch AutoIngest, select a synthetic memory-card fixture as the source
   (never a real card/archive).
5. Work through the checklist below on the real device while watching
   AutoIngest's `app.log` for `[mx-control]` activity to cross-check every
   physical action against the real command result.

---

## Physical test results — Phase 3A (real MX Creative Console)

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

## Physical test results — Phase 3B (real MX Creative Console)

All items tested live, cross-checked against `app.log`'s real-time
`[mx-control]` activity (command requested/result pairs).

| # | Test | Result |
|---|---|---|
| 1 | SELECT toggles current file | **Pass** — real `selection.toggleCurrent`, `ok:true` × 2 (select, deselect) |
| 2 | SELECT ALL selects all visible files | **Pass** — real `selection.selectAll`, `ok:true` |
| 3 | CLEAR clears them | **Pass** — real `selection.clear`, `ok:true` |
| 4 | PREVIEW opens/closes | **Pass** — real `preview.toggle`, `ok:true` × 2 |
| 5 | G1 assigns current selection | **Pass** — real `selection.selectAll` → `group.assign`, both `ok:true` |
| 6 | G2 reassigns correctly | **Pass** — real `group.assign`, `ok:true` |
| 7 | G3 works | **Pass after a real-world key-mapping fix** — see below |
| 8 | UNASSIGN removes selection from group | **Pass** — real `group.unassign`, `ok:true` |
| 9 | Tag Refinement cleanup still occurs | **Pass by inheritance** — `group.unassign` routes through the same unchanged `_unassignSelectionFromGroup()` primitive Phase 1A/1B's own tests already verify calls `TagRefinementManager.clearFiles()`; this session's own `browsePageActions.integration.test.ts` additionally proved the real round-trip end to end |
| 10 | Multi-Event claim behavior intact | **Pass by inheritance** — same unchanged command/primitive; Phase 1A/1B's own live tests cover this exhaustively, unaffected by Phase 3B |
| 11 | Dial navigation remains responsive | **Pass** — dozens of rapid, correctly-ordered `nextFile`/`previousFile` commands at varied speeds, every one `ok:true`, no gaps or errors, even with the expanded 10-action plugin |
| 12 | Selection remains correct while dialing | **Pass** — user-confirmed across slow/medium/fast rotation |
| 13 | Context change to QMZ fails Browse actions safely | **Deferred** — not exercised this session; the underlying mechanism (context-gating in the action classes, plus `AutoIngestCommands`' own `check()`) is fully covered by `browseActions.unit.test.ts`'s mocked qmz-context tests, but not re-confirmed on physical hardware |
| 14 | AutoIngest restart doesn't require reassigning device actions | **Pass** — killed and relaunched AutoIngest; plugin reconnected in ~200ms on a new port; user confirmed commands worked immediately with zero Options+ changes |
| 15 | Plugin Service reload doesn't corrupt active AutoIngest state | **Pass** — restarted Plugin Service while AutoIngest kept running; fresh plugin process reconnected in ~6s; user confirmed selection/state was untouched and a command still worked afterward |

### A real-world key-mapping issue (not a code bug)

During Test 7, the user reported "G2 is getting tagged by the G3 button."
Before assuming a code defect, the underlying logic was re-traced: with G1
and G2 already created in order, a fresh G3 assignment resolves
`resolveGroupIdByLabel(state, 'G3')` → `null` (no such label yet) → falls
back to `groupId: 3` → AutoIngest's `GroupManager.createGroup()` creates
`id = _groups.length + 1 = 3` — sequentially correct, no skipped-slot
ambiguity in this scenario. The transport's own logs never include command
*payloads* (by design, to avoid leaking state into logs), so the exact
`groupId` sent couldn't be read back directly. Asked the user to check
Options+'s device configuration screen for which **action** was actually
bound to that physical key — it was a manual assignment mix-up (the G2
action was on the key intended for G3), not a plugin defect. Corrected in
Options+, retested, passed cleanly. Documented here as a reminder that
manually assigning nine similar-looking numbered actions is genuinely
error-prone for an operator, not a reason to doubt the code without first
verifying the actual binding.

### Dial-press experiment result

See "Dial-press experiment" under the SDK capability matrix below: tested
live, found to be moot — the physical dial has no press mechanism at all.

---

## SDK capability matrix (Phase 3B investigation)

Investigated by reading `@logitech/plugin-sdk@0.1.1`'s full public `.d.ts`
**and** its compiled runtime (`dist/index.js`, 978 lines — the actual wire
protocol/message-handler implementations, not just the documented surface),
before writing any Phase 3B code. "Present" below means found in the
runtime/protocol; "functional" means it actually does something beyond
being wired up.

| Capability | Status | Evidence |
|---|---|---|
| Folders/pages (device-side) | **Unsupported** | Only `Action.groupName` exists — a flat label for organizing entries in Options+'s own Action Picker UI (its own JSDoc: "The logical group or folder this action will appear in the UI"), not something that changes what the physical LCD shows at runtime. No page/folder message type exists in the protocol. |
| Configurable action parameters | **Unsupported** | Full message-type registry (`InitConnection`, `GetActionsList`, `GetActionText`, `GetActionImage`, `ExecuteCommand`, `ExecuteAdjustment`, `StopPlugin`) has no parameter-schema concept; `ActionData`'s fields are fixed (`name`, `actionType`, `displayName`, `description`, `groupName`). This is why G1/G2/G3 are three thin classes, not one configurable one. |
| Dynamic action images | **Present, non-functional** | `GetActionImageRequestHandler.getDataFromEvent()` unconditionally `return null;` — the request/response machinery exists but is a stub in this SDK version. |
| Dynamic text | **Present, non-functional as an override point** | `GetActionTextRequestHandler.getDataFromEvent(action)` always returns `{ text: action.displayName }` — the static field, with no hook for a subclass to override it per-instance. |
| Action-state change notifications (server→plugin) | **Unsupported** | The message-type registry above is the complete set; no `ActionStateChanged`-style event exists. |
| Dial press | **Moot — hardware does not support it** | `AdjustmentAction.hasReset`/`resetCommandName` are real, JSDoc'd public SDK API, tested live (built, linked, loaded a paired CommandAction named to match), but the physical MX Creative Console's main dial has no press/click mechanism at all — confirmed directly on the real device. **SELECT stays on the keypad**; see "Dial-press experiment" below for the full test. |
| Roller | **Not investigated at the protocol level beyond confirming no distinct API** | Zero matches for "roller" anywhere in the SDK. Presumably usable as another `AdjustmentAction` bound via Options+'s own UI, same mechanism as the dial — left unassigned per the Phase 3B brief regardless. |

### Dial-press experiment

Tested live: `NavigateFilesAction.hasReset` was temporarily set to `true`
and a paired `CommandAction` named exactly `navigate_files_RESET` (matching
`resetCommandName`'s computed value) was registered, built, linked, and
loaded into a fresh Plugin Service process — the SDK side worked without
error, and the action appeared registered.

**Result: moot at the hardware level.** The physical MX Creative Console's
main dial **has no press/click mechanism at all** — confirmed directly on
the real device, independent of anything the SDK does or doesn't support.
The experiment was reverted (`hasReset` back to `false`,
`dialPressExperimentAction.ts` deleted) rather than kept as dead code.
**SELECT remains on the keypad**, per the task brief's own explicit
fallback — this is now a confirmed hardware constraint, not merely an SDK
uncertainty.

---

## Tooling / Plugin Service limitations encountered

Distinct from the plugin-sdk capability matrix above — these are about the
surrounding toolkit and Logi Plugin Service process, found across both
phases:

- **`pluginCapabilities` has no documented schema in toolkit 0.1.1** for
  declaring an application-linked profile — see "Profile / application
  linking" above. Confirmed by inspecting the toolkit's own template source,
  not assumed from missing docs alone.
- **`tsx`/esbuild cannot run tests that call Playwright's `page.evaluate()`
  with inline arrow functions.** esbuild (which `tsx` uses) wraps
  transpiled functions with a `__name(fn, "name")` helper for name
  preservation; when Playwright serializes such a function via
  `.toString()` and evaluates it inside the browser's isolated context, that
  helper doesn't exist there, throwing
  `ReferenceError: __name is not defined`. Root-caused directly (confirmed
  the real, unpackaged `tsc` output has zero `__name` occurrences, while the
  `tsx`-transpiled version does) rather than worked around superficially.
  **Fix**: `test:compile` (used by both `test:unit` and `test:integration`)
  compiles via real `tsc` (`tsconfig.test.json` → `dist-test/`, gitignored)
  and runs plain `node` output instead of running through `tsx` directly.
  This is a general Playwright+esbuild interaction, not specific to the
  Logitech SDK, but worth recording here since it blocked this plugin's own
  tests.
- **Plugin Service does not auto-load a freshly-linked plugin on its own
  startup** — confirmed empirically (started the service, waited, no new
  log/process activity for the linked plugin) — discovery happens lazily,
  triggered by opening the device configuration screen in Options+ (matches
  the toolkit's own README wording: "should now be visible... in the device
  configuration screen").
- **Reload does not guarantee the previous plugin process is terminated
  first** — see Phase 3A's "A real bug found and fixed" in the physical
  test results below.

---

## Phase 3C — AutoIngest-specific Logitech application profile

**No plugin or AutoIngest product code changed in this phase.** Phase 3C is
Options+ configuration, application-identity verification, and physical
testing only — exactly as the brief required ("prefer minimal/zero
AutoIngest product-code changes... only change plugin/app code if a genuine
profile-integration bug is discovered"). None was.

### Goal

AutoIngest's nine Browse-layout actions (Phase 3B) should live on their own
Logi Options+ profile that activates automatically when AutoIngest is the
foreground app, and yields back to the default/global profile the moment
focus moves elsewhere — never permanently occupying the operator's
general-purpose console layout.

### Application identity verification

| Context | Bundle/process identity | Verified how |
|---|---|---|
| Packaged macOS build | `com.autoingest.app` | Built a real local unpacked app (`npx electron-builder --mac --dir --arm64`), read `Info.plist` via `PlistBuddy`: `CFBundleIdentifier=com.autoingest.app`, `CFBundleName=AutoIngest`, `CFBundleExecutable=AutoIngest`. Ad-hoc codesigned (`codesign -dv` → `Signature=adhoc`), sufficient for local Gatekeeper/testing. |
| Dev-mode (`electron .` / `npm start`) macOS | `com.github.Electron` | Read `node_modules/electron/dist/Electron.app/Contents/Info.plist` directly: generic Electron identity, `CFBundleName=Electron`. **Confirmed indistinguishable from any other dev Electron app on the machine** — Options+ cannot tell AutoIngest's dev mode apart from an unrelated Electron project also running `electron .`. |
| Windows | `com.autoingest.app` (inferred) | `package.json`'s `build.win` has no `appId` override and no explicit `AppUserModelId`; electron-builder defaults `AppUserModelId` to `build.appId` when unset. **Not independently verified on real Windows hardware this session** — macOS-only development machine. Executable would be `AutoIngest.exe`. |

**Corrected a Phase 3A assumption**: `app.getName()` resolves from
`package.json`'s `"name"` field (`"auto-ingest"`, lowercase) in **both** dev
and packaged modes, because `app.setName()` is never called anywhere in the
codebase — confirmed by launching the real packaged build and finding its
helper process still used
`--user-data-dir=.../Application Support/auto-ingest` (lowercase), and by a
full directory listing of `~/Library/Application Support/` showing no
`AutoIngest` entry at all, packaged or not. **The userData-folder name is
not a dev-vs-packaged signal.** The only axis that actually matters for
Options+'s foreground-app matching is the OS-level bundle identifier
(`com.github.Electron` vs `com.autoingest.app`), which is completely
separate from Electron's internal userData path naming.

**Consequence for the final product**: the dedicated Options+ profile must
target `com.autoingest.app` — the packaged identity — not the generic dev
Electron identity. A separate, temporary profile against dev-mode Electron
is fine for ongoing development testing but must never be confused with, or
used as, the shipped deliverable.

### How Options+ actually represents an application-linked profile

Read-only inspection of
`~/Library/Application Support/Logi/LogiPluginService/` (never mutated
directly — all mutation went through the Options+ UI):

- Every linked application is one folder under
  `Applications/<deviceType>/<key>/`, containing `ApplicationInfo.json`
  (identity + metadata) and a `Profiles/<GUID>/` subfolder holding the real
  button-layout data (`ProfileInfo.json`).
- Two device-type folders exist on this machine: `Loupedeck70` (the
  stable/base definitions — Logitech's own shipped native-plugin
  applications `@_defaultmac`, `@_lightroom`, `@_photoshop` all live here,
  and this is also where the **manually-added** AutoIngest entry landed)
  and `Loupedeck71` (a live per-connected-device-instance overlay —
  `@_defaultmac`, plus two bundle-id-keyed entries, `com.apple.preview` and
  `com.canon.eos-utility-3`, that already existed from prior,
  unrelated use on this machine).
- `ApplicationInfo.json`'s key field is `processOrBundleName`. For
  Logitech's own native-plugin apps (`@_defaultmac`, `@_lightroom`,
  `@_photoshop`) this is **`null`** — those are matched by their own native
  C# plugin's internal foreground-detection, not by generic bundle-ID
  matching. For every generically-linked app (`com.apple.preview`,
  `com.canon.eos-utility-3`, and now `com.autoingest.app`), this field holds
  the **real OS bundle identifier verbatim**, `hasNativePlugin:false`,
  `nativePluginName:null`. This is the confirmed, generic mechanism any
  third-party app — including a Node-SDK plugin like AutoingestMx — rides
  on, entirely independent of the plugin's own SDK capabilities.
- **Important negative finding**: foregrounding AutoIngest alone, with no
  prior Options+ action, created **no** new entry — tested directly
  (launched the real packaged app, confirmed frontmost via
  `osascript`/System Events for 10+ seconds, re-checked the directory: no
  change). Linking an application is a **manual, explicit step in the
  Options+ UI** (its application-picker / "add application" flow),
  not a passive background auto-detection. Once created, however, the
  resulting `processOrBundleName` entry is what drives genuinely automatic
  switching from then on (see physical test results below).
- `LoupedeckSettings.ini`'s `CurrentApplication/Loupedeck7x=` key looked like
  the obvious live indicator of "which profile is active right now," but
  **it did not reliably update** during live profile switching in this
  session's testing (stayed on `@_defaultmac` through multiple confirmed
  real switches) — **do not trust this file as a live signal**; the
  physical device itself is the only reliable ground truth, which is
  exactly what the physical test matrix below relies on.

### How the AutoIngest profile was actually created

Entirely through the Options+ GUI (user-performed, per the brief's "creation
is UI-driven, I can't interact with native macOS apps directly"
constraint):

1. Opened Logi Options+ → its application list for the MX Creative Console.
2. Used its "add application" control, pointed at the real packaged
   `dist/mac-arm64/AutoIngest.app` build (not dev-mode `electron .`).
3. Enabled **"Adapt to App"** for the new AutoIngest entry.
4. Assigned the Phase 3B Browse layout to its nine keys exactly as
   specified — **not** the tenth "Groups" action:

```
┌──────────────┬──────────────┬──────────────┐
│    SELECT    │  SELECT ALL  │    CLEAR     │
├──────────────┼──────────────┼──────────────┤
│   PREVIEW    │      G1      │      G2      │
├──────────────┼──────────────┼──────────────┤
│      G3      │   UNASSIGN   │  (reserved)  │
└──────────────┴──────────────┴──────────────┘
Main dial: Navigate Files (unchanged)
```

The ninth key is deliberately left **unassigned** — not mapped to "Groups"
— per the brief: since device-side pages are unsupported (see the SDK
capability matrix above), presenting a dead page-navigation concept would
be worse than an honest blank key.

This created
`Applications/Loupedeck70/com.autoingest.app/ApplicationInfo.json`
(`processOrBundleName: "com.autoingest.app"`, `displayName: "AutoIngest"`,
`hasNativePlugin: false`) plus one `Profiles/<GUID>/ProfileInfo.json` for
the layout above — the identical shape as the Preview/Canon entries,
confirming AutoIngest rides the same generic mechanism.

### Physical test results — Phase 3C (real MX Creative Console)

All items driven live: AutoIngest and Logi Options+ both running, the real
device physically connected, foreground switches triggered via
`osascript`/System Events and cross-checked by the user watching the
physical keypad.

| # | Test | Result |
|---|---|---|
| A | Finder foreground → default profile | **Pass** — default/global keys shown |
| B | AutoIngest foreground → AutoIngest profile auto-activates | **Pass** — keypad changed immediately on focus switch |
| C | Verify 8-key mapping | **Pass** — all 8 assigned keys (Select/Select All/Clear/Preview/G1/G2/G3/Unassign) visible; 9th key correctly blank, not "Groups" |
| D | Verify dial | **Pass** — Navigate Files worked under the AutoIngest profile |
| E | Switch to another app (Safari) → AutoIngest mappings disappear | **Pass** |
| F | Return to AutoIngest → mappings restore automatically | **Pass** — no manual reassignment |
| G | AutoIngest running in background (not foreground) → its profile does **not** stay active | **Pass** — confirmed after a 15s background hold, default/Finder keys still showing |
| H | Quit AutoIngest while its profile is active → Options+ safely falls back | **Pass** — no crash/hang; default keys appeared immediately after the process was terminated |
| I | Relaunch and foreground AutoIngest → same profile returns, no reassignment needed | **Pass** — layout and live command execution (dial + a key press) both confirmed working immediately |
| J | Restart Logi Options+ / Plugin Service → profile association survives | **Pass** — user restarted via the Options+ UI itself; AutoIngest profile and auto-activation both still worked afterward |
| K | Restart the Mac → association persists | **Skipped** — optional per the brief ("only if safe/convenient"); user chose to skip |

**Plugin/connection independence, verified alongside the above**: exactly
one `AutoingestMx` plugin Node process and exactly one `AutoIngest.app`
process were confirmed via `pgrep` before and after every profile switch,
and again after the Test I relaunch — no duplicate processes, no stale
connection slots. The plugin's WebSocket connection to AutoIngest is
entirely decoupled from which console profile happens to be visually
active; profile switching never touched the transport layer, and the known
stale-plugin-process characteristic from Phase 3A (a *reload*, not a
*profile switch*, spawning a second process) did not recur here because no
relink/reload happened during this phase.

### Default/global profile cleanup

Phase 3A/3B physical testing (before this dedicated profile existed) had
left AutoIngest's actions assigned directly on the operator's default/global
MX Creative Console profile. After the dedicated profile was confirmed
working, the user removed those AutoIngest-specific key assignments from
the default profile via the Options+ UI, leaving any of their own unrelated
mappings untouched. Verified at the file level: `grep -i autoingest` against
the default profile's `ProfileInfo.json`
(`Applications/Loupedeck70/@_defaultmac/Profiles/.../ProfileInfo.json`)
returns **zero** matches post-cleanup.

### Export / import and `.lp5` findings

- **No `.lp5` file exists anywhere** in the installed
  `LogiPluginService` directory tree on this machine (checked recursively).
  This installed Options+ version does not appear to use that format for
  the application-profile data investigated here.
- **No user-facing export/import feature was found** for an
  application-linked profile. `Applications.Backups/*.zip` exist, but these
  are **automatic, timestamped local backups Options+ maintains for itself**
  (observed growing over this session's testing), not something a user
  triggers to share a profile — inspected read-only, never mutated.
  `Snapshots/*.st4` are opaque binary snapshot files; left entirely
  uninspected beyond confirming their existence and extension, per the
  brief's "inspection allowed, unsupported mutation/reverse-engineering is
  not."
- **Conclusion**: a working AutoIngest profile is, for now, a **local,
  manually-recreated configuration** — not something that can be packaged
  and distributed alongside the plugin yet. If this becomes a real
  deliverable need, the officially-documented path (per
  `@logitech/plugin-toolkit`'s own docs) is C# tooling, not the Node SDK —
  **not pursued this phase**, per the brief's explicit "if Node SDK cannot
  package it, do not migrate to C# yet — just document the limitation."

---

## Phase 3D — Tag Refinement + Event / Workflow controls

**Goal.** Expose and validate high-value operator commands that support
Per-Photo Tag Refinement and the Multi-Event "Change Event" workflow —
decide which one deserves the reserved ninth physical key, without yet
building virtual Logitech pages or redesigning the working Browse profile.
See `docs/commandLayer.md` "Tag Refinement commands" / "Change Event —
`event.openChooser`" / "Resume — investigated, not exposed" / "Ask
AutoIngest — no command layer entry point exists" for the full
investigation each command (or non-command) is built from.

### Authoritative workflows inspected

- **Per-Photo Tag Refinement** (`renderer/tagRefinementManager.js` +
  renderer.js's "Tag Refinement mode" section) — real eligibility rule
  (`isEligible`), real tri-state override semantics, the two real entry
  points (event-scope footer button, group-scope trigger), and exactly
  which panel buttons are parameter-free vs. arbitrary-tag-dependent.
- **Multi-Event / Change Event** (`renderer/importSessionUI.js`) — the
  landing-screen "Change Event" (destructive, session-boundary, unreachable
  from Browse) vs. the real in-workspace `openEventPickerFromWorkspace()`
  (opens the real chooser only; the event switch itself happens later, once
  the operator picks from the real list).
- **Resume** — every `resume`-named function/IPC handler in the codebase,
  individually traced; see commandLayer.md for the full breakdown.
- **Ask AutoIngest** (`AI-FEAT-059`, `scripts/product-docs/knowledge-portal/`)
  — see below.

### Ask AutoIngest — investigated, rejected

**"Ask AutoIngest" is not a renderer feature.** It is a separate, standalone
local-only Node `http` server (`scripts/product-docs/knowledge-portal/server.js`,
bound to `127.0.0.1`) serving its own static page — part of
`scripts/product-docs/`, the developer documentation/engineering-knowledge
tooling, architecturally unrelated to the Electron app's renderer process
this plugin controls. Status per its own feature record
(`docs/product/features/AI-FEAT-059_...md`): "Implemented — evolving",
Maturity "Experimental", explicitly "not the final operator-facing portal."
It is reached via a browser, the `knowledge` CLI, or its own page — never
through `renderer.js`, `window.__autoIngestRendererBridge`, or
`AutoIngestCommands`.

**No `askAutoIngest.open`/`toggle` command was added, and no plugin action
exists for it.** There is no "authoritative renderer function" to delegate
to — not a scope judgment call, an architectural fact. Making AutoIngest's
MX plugin launch this portal would mean inventing an entirely new
mechanism (spawning a browser pointed at a local dev-tool server) with no
corresponding existing in-app operator behavior — exactly what "map cleanly
to existing application behavior" forbids. This also means the reserved
ninth key's candidate set narrows from three to two (see below).

### Reserved ninth key evaluation

| Candidate | Status | Notes |
|---|---|---|
| A. Refine Tags (`refine_tags` → `tagRefinement.open`) | Implemented, registered, unassigned | High-value when applicable; genuinely unavailable in some real sessions (non-refinable component, single-component event with nothing to refine, ambiguous/empty selection in a multi-component event) — see test matrix below. |
| B. Change Event (`change_event` → `event.openChooser`) | Implemented, registered, unassigned | Always applicable in any live Browse session with an active event (not QMZ, not importing) — broader availability than A, but a lower-frequency action per session (an operator changes event far less often than refining tags). |
| C. Ask AutoIngest | **Not implementable this phase** | No renderer entry point exists at all — removed from consideration, not merely deferred. See above. |

Per the brief's own criteria (expected usage frequency, UI steps saved,
context clarity, accidental-trigger risk, usefulness across most Browse
sessions) — not implementation convenience: **Change Event is the
candidate with broader, more predictable availability** (it never depends
on the active event's component shape or the current selection), while
**Refine Tags is the higher-value action when it IS available** (it saves
more real UI steps — selecting a specific group's trigger vs. one key
press). Neither dominates outright. **This document does not pick a
winner** — the brief requires comparing both via physical testing before
permanently assigning the key (see below); that comparison has not yet
been run on the real device as of this phase's close. The ninth key
remains reserved/blank in the working Browse profile until that physical
comparison happens.

### Physical test guidance (not yet run — temporary assignment only)

The eight working keys (`SELECT`/`SELECT ALL`/`CLEAR`/`PREVIEW`/`G1`/`G2`/
`G3`/`UNASSIGN`) and the dial are **unchanged** — per the brief, nothing
here displaces a proven mapping. To compare the two candidates physically:

1. In Logi Options+, temporarily assign **Refine Tags** to the reserved
   ninth key of the dedicated AutoIngest profile (Phase 3C) and test:
   - Select photos in a refinable group/single-component event → press →
     the real refinement panel opens (same path as clicking "Refine Tags").
   - A non-refinable selection/component → press → no-op, no panel, no
     error.
   - No selection in a multi-component event → press → no-op (ambiguous,
     never guesses a group).
   - A selection spanning two groups → press → no-op (ambiguous).
2. Reassign the same key to **Change Event** and test:
   - Press → the real event chooser opens.
   - Pick a different event from the real on-screen list → the switch
     completes exactly as clicking `#ctxChangeEventBtn` would.
   - Press while QMZ is open → no-op (unavailable).
3. Record which felt more useful across a realistic session before
   permanently assigning the key — this is a judgment call the brief
   explicitly reserves for after physical comparison, not something to
   decide from the command-layer investigation alone.

### What changed in the AutoIngest app (not just the plugin)

Minimal, all additive/behavior-preserving, all covered by the full
regression re-run (see "Automated tests" above):

- `renderer/commandManager.js` — 5 new commands
  (`tagRefinement.open`/`close`/`useAllTags`/`clearSelected`,
  `event.openChooser`), 2 new `getState()` fields (`tagRefinement`, `event`).
- `renderer/renderer.js` — new thin composition functions built entirely
  from existing primitives (no new business rules); `renderRefinementPanel()`'s
  inline button-handler closure refactored into a shared module-level
  function so the mouse and the command layer use byte-identical code; a
  real pre-existing gap fixed (refinement mode entry/exit never notified
  `subscribe()`rs — now it does).
- `renderer/importSessionUI.js` — `openEventPickerFromWorkspace()` now
  returns a boolean reporting whether it actually opened the chooser
  (every existing caller already ignored the return value).

---

## Phase 3E — AutoIngest-side foundation for a dynamic Tag Refinement keypad

**No Logitech SDK work in this phase — no plugin code touched at all.**
This phase builds only the AutoIngest-side command/state foundation a
future dynamic hardware keypad would need; see `docs/commandLayer.md` "Tag
Refinement — dynamic tag state (Phase 3E)" for the full technical
write-up (canonical tag identity, draft model, validation rules, and the
UI↔command equivalence/security/transport/performance tests). This section
gives the plugin-facing summary and the intended future workflow.

### What exists now (AutoIngest side only)

- `tagRefinement.setTagState({ tagId, checked })` — sets one tag's desired
  state in a renderer-owned draft, shared with the real UI's own chips
  (same primitive, not two). `tagId` is the composite canonical identity
  `"<category>:<label>"` — there is no separate tag ID anywhere in the real
  system, and none was invented here.
- `tagRefinement.applyToSelected` — commits that draft through the exact
  same path the real "Apply to Selected" button uses.
- `state.tagRefinement.tags[]` — one entry per real, currently-offered tag
  (`{id, category, label, state}`), `state` being draft-aware so a pending
  hardware press is visible in the very next pushed state, before anything
  is committed.
- Both commands ride the existing Phase 2 transport completely unchanged —
  see `docs/mxControlTransport.md` "Phase 3E — dynamic Tag Refinement rode
  the transport unchanged."

### Intended future workflow (NOT YET IMPLEMENTED)

The eventual hardware experience this foundation targets:

1. Operator navigates/selects photographs normally on the MX Creative
   Console (unchanged Browse layout).
2. Presses **Refine Tags** (the Phase 3D `refine_tags` action, still
   registered-but-unassigned — see "Reserved ninth key evaluation" above).
3. The console's dynamic keys/display would populate with the REAL
   refinable tags for the current selection (`state.tagRefinement.tags[]`),
   each key showing that tag's real tri-state.
4. Pressing a key sends `tagRefinement.setTagState` for that exact tag;
   the console's own key redraws from the next pushed state.
5. A dedicated Apply key (or gesture) sends `tagRefinement.applyToSelected`,
   committing exactly what the real "Apply to Selected" button would.

**This requires dynamic per-key content (text and/or icon) the device can
be told to show at runtime — confirmed unsupported in `@logitech/plugin-sdk
0.1.1`'s Node SDK** (see the SDK capability matrix above:
`GetActionImageRequestHandler`/`GetActionTextRequestHandler` are present in
the protocol but non-functional stubs). Per the brief's own framing, the
only currently-documented path to genuine dynamic keypad content in the
Loupedeck/Logitech plugin ecosystem is the **C# toolkit, not the Node
SDK** — and **that migration is explicitly NOT part of this phase, or
authorized by it.** This document records the intended workflow so a
future phase has a traceable target; it is not a commitment to build it a
particular way, and nothing here should be read as C# migration having
begun.

### Readiness assessment

The AutoIngest side (commands, state, validation, subscription,
performance, the real Phase 2 transport) is now genuinely ready to serve a
dynamic hardware keypad the moment one exists — every piece a future
C#/dynamic-folder plugin would need to call is implemented, tested (UI↔
command equivalence proven, not assumed; security/validation covered;
transport proven end to end with a real authenticated client), and
documented. **What does not yet exist is the hardware side**: no
`PluginDynamicFolder`, no C# project, no dynamic icon/text rendering, no
physical device test of any of this — all explicitly out of scope for this
phase and not started.

---

## What Phase 3A/3B/3C/3D/3E explicitly do NOT do

Full multi-page G1–G9 keypad, QMZ sequence-selection UI, import start/
controls, dynamic import progress, Archive Maintenance, Event Maintenance,
the Actions Ring, a final installer, Marketplace packaging/publishing, a C#
toolkit migration (Phase 3E built only the AutoIngest-side foundation a
future C# migration would consume — the migration itself has not begun),
virtual plugin pages, `PluginDynamicFolder`, dynamic icon rendering,
programmatic/undocumented Options+ database mutation, an Ask AutoIngest
mapping (no renderer entry point exists), a resume command (every real
instance is either internal-only or belongs to an out-of-scope screen), a
permanent ninth-key assignment (pending physical comparison), or any merge
to `main`/`stable/0.9`.
