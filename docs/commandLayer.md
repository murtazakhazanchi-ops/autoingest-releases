# Command Layer (AI-FEAT MX Console — Phase 1A)

Internal abstraction so external controllers (the future Logitech MX
Creative Console plugin, keyboard shortcuts, or any other hardware
controller) can invoke existing AutoIngest behavior without simulating DOM
clicks, depending on CSS selectors, duplicating business logic, or
bypassing GroupManager / selection / import safety.

**Provenance.** This is Phase 1A re-derived on `feature/mx-creative-console-v2`
against `integration/main-stable-reconcile` — the development base that
carries both `main` (Ask AutoIngest) and the shipped `stable/0.9` v0.9.13
production line (Multi-Event Single-Pass Import, Per-Photo Tag Refinement,
durable metadata intent). The original Phase 1A commit, `f217891` on
`feature/mx-creative-console`, is kept untouched as the historical record of
this design validated against the pre-reconciliation `main` line — it
predates Multi-Event Import/Tag Refinement's presence in the group-assignment
code path (see "Group assignment" below) and should not be built on directly.

```
(future) MX Creative Console
      -> (future) Logitech Actions SDK Plugin
      -> AutoIngestCommands            renderer/commandManager.js
      -> window.__autoIngestRendererBridge   renderer.js (end of file)
      -> existing authoritative renderer functions/state
```

`commandManager.js` contains no Logitech-specific code and no transport of
any kind (no WebSocket/HTTP server) — that is a later, separate phase. It
never touches Node/Electron APIs; it runs in the same sandboxed,
context-isolated renderer world as `renderer.js` and only ever reaches
application state through the bridge object.

---

## Ownership of state

The command layer owns none of AutoIngest's state. Every command is a thin
call into an already-authoritative renderer.js function/accessor, listed
explicitly on `window.__autoIngestRendererBridge` (see the "COMMAND LAYER
BRIDGE" section near the end of `renderer.js`). `GroupManager` remains the
sole owner of group state; `selectedFiles`/`tileMap`/`lastClickedPath`
remain the sole owner of import-screen selection/focus state; QMZ's
`_qmzSelectedFiles`/`_qmzTileMap`/`_qmzLastClickedPath` remain the sole
owner of QMZ's own selection/focus state. Adapters must never read or
write AutoIngest state by any other path (no reaching into `window`
globals directly, no DOM inspection) — always through
`AutoIngestCommands.execute()`/`canExecute()`.

---

## API

```js
AutoIngestCommands.getCommands()               // -> string[] of registered command ids
AutoIngestCommands.canExecute(commandId, payload)  // -> { ok, commandId, reason? }  (sync)
AutoIngestCommands.execute(commandId, payload)     // -> Promise<{ ok, commandId, executed?, detail?, reason? }>
```

`execute()` always returns a Promise (some underlying operations, e.g.
navigating while the preview overlay is open, are genuinely async);
awaiting a synchronous command's result is a no-op, so callers who don't
care about the outcome can call it without `await`.

Result shape:

- `ok: false` — the command was **not run at all**. `reason` is one of
  `unknown-command`, `invalid-payload`, `renderer-not-ready`,
  `not-applicable` (its `check()` failed), or `run-threw: <message>` (a
  thrown/rejected error deep inside an existing renderer function — never
  propagates to the caller).
- `ok: true, executed: false` — the command ran but had nothing to do
  (e.g. navigation at the last file, clearing an empty selection). This is
  a normal outcome, not an error.
- `ok: true, executed: true` — the command ran and had an effect. `detail`
  carries whatever JSON-safe value the underlying function returned, when
  there is one (e.g. `group.assign`'s `{ groupId, claim }` — see "Group
  assignment" below). A command whose `run()` returns a detail object
  rather than a boolean/nullable value declares `computeExecuted(result)`
  so `executed` is derived correctly instead of via the generic
  `result != null` fallback (which would be wrong for an always-non-null
  object) — see `group.assign`'s definition in `commandManager.js`.

Unknown commands and malformed payloads are rejected by `canExecute()`
before anything is attempted; a thrown error inside `run()` is caught and
reported, never left to crash the renderer.

---

## Initial commands (Phase 1A)

| Command | Payload | Applicable when | Calls |
|---|---|---|---|
| `navigation.nextFile` | — | always attemptable | `_navigateActiveFile(1)` |
| `navigation.previousFile` | — | always attemptable | `_navigateActiveFile(-1)` |
| `selection.toggleCurrent` | — | an active file is resolvable | `_toggleSelectionForActiveFile()` |
| `selection.selectAll` | — | ≥1 visible file | `_selectAllVisible()` |
| `selection.clear` | — | selection is non-empty | `_clearSelection()` |
| `preview.toggle` | — | preview is open, or an active file is resolvable | `_togglePreviewForActiveFile()` |
| `group.assign` | `{ groupId?: number \| null }` | not in QMZ, selection is non-empty | `_assignSelectionToGroup(groupId)` |
| `group.unassign` | — | not in QMZ, selection is non-empty | `_unassignSelectionFromGroup()` |

All eight are context-aware: navigation/selection/preview automatically
operate on whichever screen is active (the normal import screen or QMZ —
QMZ has its own, separate selection/focus state, see `renderer.js`'s QMZ
section); grouping only ever operates on the import screen, since
`GroupManager` has no QMZ concept.

`group.assign`'s `groupId`: omit it (or pass `null`) to always create a
new group. Passing an existing group's id assigns to it; passing an id
that doesn't currently exist also creates a new group — this mirrors the
existing Cmd+G digit-chord's behavior (`GroupManager.createGroup()` always
allocates the next sequential id, which may not equal the requested id).

### Group assignment — production side effects preserved

`_assignSelectionToGroup`/`_unassignSelectionFromGroup` are shared by the
context menu, the Cmd+G digit chord, **and** the command layer — genuinely
one implementation, not three. Since Phase 1A's original extraction
(`f217891`), `stable/0.9`'s shipped work added real production behavior to
this exact code path; the re-derivation folds it into the shared primitive
itself (not duplicated per caller):

- **Per-Photo Tag Refinement cleanup.** `TagRefinementManager.clearFiles(paths)`
  runs before every group mutation (assign, new-group, and unassign) — a
  file moving between groups, or out of one, must not carry its old
  component's refinement forward. `syncAllRefinementBadges()` re-syncs the
  visible badges afterward, alongside the existing `syncAllGroupBadges()`.
- **Multi-Event Import claim tracking** is deliberately **not** inside the
  shared primitive — it was never part of the context menu's behavior (only
  the Cmd+G chord reads/surfaces it), so folding it in unconditionally would
  change the context menu's behavior. Instead each caller that wants it
  layers `ImportSession.takeLastClaim()` (flush stale info) / call the
  primitive / `takeLastClaim()` (capture this operation's result) around the
  primitive call — exactly what the Cmd+G chord already did, and what
  `bridge.assignSelectionToGroup()` now does too. `group.assign`'s `detail`
  is therefore `{ groupId, claim }`, where `claim` is `null` or
  `{ reassigned, fromOrdinals }` — the same information the chord's toast
  ("N moved from E&lt;ordinal&gt;") already showed. `group.unassign` never
  triggers a claim (`GroupManager`'s `onClaim` hook only fires from
  `assignFiles`), so its result stays a plain boolean.
- Verified with a dedicated live regression
  (`test/mxCommandLayerLive.test.js` §§11-12): a refinement override is
  genuinely cleared by a command-driven assignment (checked against
  `TagRefinementManager`'s own state, not inferred), the same clearing
  happens identically through the pre-existing UI-path primitive body
  (proving equivalence, not parallel implementations), and a real two-workspace
  `ImportSession` claim (via its own `switchTo`/`ownerOf`/`getWorkspace` API,
  no UI simulation) is correctly reassigned and surfaced through
  `group.assign`'s `detail.claim`.

### Deferred commands, and why

- **QMZ (`qmz.assignQ`/`assignM`/`assignZ`, `qmz.nextSequence`/`previousSequence`).**
  Inspected `_qmzAssignToSequence(sequenceCode)`, `_qmzHandleAssignByNumber()`
  and `_qmzShowTypeChooser()` (`renderer.js`) before deciding this. QMZ
  assignment requires a **specific, existing or to-be-created sequence
  code** (e.g. `"Q05"`), resolved today via a numeric input plus, on
  ambiguity, a type-chooser UI flow (multiple sequences sharing a number,
  or none existing yet). There is no authoritative "assign to type Q, pick
  whatever sequence" primitive — inventing a default (next available? the
  currently viewed sequence?) would be new behavior, not a reuse of
  existing behavior, which the architecture explicitly rules out. A
  `qmz.assignToSequence({ sequenceCode })` command reusing
  `_qmzAssignToSequence` directly (no invented defaulting) is a reasonable
  Phase 1B candidate once QMZ has a concrete console-page design; `nextSequence`/
  `previousSequence` have the same issue (there is no single "current
  sequence" state to step through — QMZ is scoped by photographer/view,
  not one active sequence).
- **Import (start/confirm an import).** Explicitly out of scope for this
  slice per the architecture brief — the existing confirmation/validation
  path needs its own review before any command can invoke it without
  weakening a safety check.
- **Archive Maintenance / Event Maintenance / Archive Browser.** Not
  started (later roadmap milestones); no authoritative implementation
  exists yet to reuse.

---

## Context / mode

Every command's `check(payload, bridge)` reads live renderer state through
the bridge (`isQmzOpen()`, `isPreviewOpen()`, `getSelectionSize()`,
`getActiveFilePath()`, `getVisibleFileCount()`) — nothing is cached. This
is deliberately minimal: there is no formal "console page" mode system
yet (Browse / Group / QMZ / Import / Audit / Archive). Adding one later —
so a specific console page can ask "is this command relevant to what I'm
showing" — only means adding more bridge accessors and `check()`
conditions; it does not require changing the registry shape, `execute()`,
or any existing command.

---

## Adding a new command

1. If the behavior isn't already a standalone renderer.js function callable
   without touching the DOM by selector, extract the smallest such function
   from wherever it's currently trapped (an event handler), and have the
   existing handler call it too — never duplicate the logic. See the
   "ACTIVE-FILE RESOLUTION + COMMAND-LAYER PRIMITIVES" section and the
   group-assignment primitives in `renderer.js` for the pattern.
2. Expose it on `window.__autoIngestRendererBridge` (end of `renderer.js`)
   — the bridge is the *only* surface `commandManager.js` is allowed to
   touch.
3. Add an entry to `COMMANDS` in `commandManager.js`: `run()` (required),
   `check()` (when the command isn't always applicable), `isValid()` (when
   it takes a payload that could be malformed).
4. Add a live test case to `test/mxCommandLayerLive.test.js` exercising it
   against real fixture data, following the existing cases' pattern.

**Adapters must never manipulate AutoIngest state independently.** Every
effect a controller (Logitech plugin, keyboard shortcut, anything else)
produces must go through `AutoIngestCommands.execute()`. Nothing outside
`renderer.js`/`commandManager.js` should ever call
`window.__autoIngestRendererBridge` directly, read/write `selectedFiles`/
`GroupManager`/etc. directly, or simulate clicks on command-layer-covered
UI.

---

## Security

Unchanged: `contextIsolation: true`, `nodeIntegration: false`, `sandbox:
true` (`main/main.js`). `commandManager.js` is a plain renderer script with
no Node/Electron access, same as `renderer.js` — it only reaches the main
process indirectly, through whatever `window.api` calls the bridged
renderer functions already made before this change. No new IPC channel,
no new preload surface, no `eval`/dynamic code execution, no network
server. The transport that will eventually carry Logitech Actions SDK
calls into this registry is a separate, later design.
