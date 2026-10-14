# Command Layer (AI-FEAT MX Console — Phase 1A + 1B)

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

**Phase 1B**, on the same `feature/mx-creative-console-v2` branch, adds the
observability surface a future external adapter needs before any transport
exists: `getContext()`/`getState()`/`getAvailableCommands()`, a minimal
`subscribe()` mechanism, and one new command, `qmz.assignToSequence`. It adds
no transport, no new IPC channel, and no Logitech-specific code — see
"State & discovery API" and "QMZ — qmz.assignToSequence" below.

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
AutoIngestCommands.getCommands()               // -> string[] of ALL registered command ids
AutoIngestCommands.canExecute(commandId, payload)  // -> { ok, commandId, reason? }  (sync)
AutoIngestCommands.execute(commandId, payload)     // -> Promise<{ ok, commandId, executed?, detail?, reason? }>

// Phase 1B — observability, no transport:
AutoIngestCommands.getContext()                // -> 'browse' | 'qmz' | 'import' | null
AutoIngestCommands.getAvailableCommands()      // -> string[] of ids currently eligible (see below)
AutoIngestCommands.getState()                  // -> compact state snapshot (see "State schema")
AutoIngestCommands.subscribe(listener)         // -> unsubscribe: () => void
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

- **QMZ explicit-sequence assignment** was deferred in Phase 1A for the
  reason recorded here at the time: no authoritative "assign to type Q, pick
  whatever sequence" primitive exists, and inventing a default would be new
  behavior. Phase 1B implements exactly the non-defaulting form this note
  anticipated — `qmz.assignToSequence({ sequenceCode })`, requiring an
  **exact, already-existing** code, never a type/number pair to resolve
  ambiguously. See "QMZ — `qmz.assignToSequence`" below.
- **QMZ `nextSequence`/`previousSequence`.** Still deferred — there is no
  single "current sequence" state to step through (QMZ is scoped by
  photographer/view, not one active sequence). Unchanged from Phase 1A.
- **Import (start/confirm an import).** Explicitly out of scope for this
  slice per the architecture brief — the existing confirmation/validation
  path needs its own review before any command can invoke it without
  weakening a safety check.
- **Archive Maintenance / Event Maintenance / Archive Browser.** Not
  started (later roadmap milestones); no authoritative implementation
  exists yet to reuse.

---

## State & discovery API (Phase 1B)

```js
AutoIngestCommands.getContext()            // -> 'browse' | 'qmz' | 'import' | null
AutoIngestCommands.getAvailableCommands()  // -> string[]
AutoIngestCommands.getState()              // -> state snapshot, see schema below
```

All three read live renderer state through the bridge on every call —
nothing is cached, nothing is derived independently of the same state
`canExecute()`/`execute()` already read. `getState()` returns `null` (and
`getContext()` returns `null`, `getAvailableCommands()` returns `[]`) only
if the bridge itself isn't wired up yet (`renderer.js` hasn't finished
loading) — this mirrors `execute()`'s own `renderer-not-ready` case.

### Context values

Only three values exist, because only three are genuinely distinct,
authoritative modes in this codebase today:

- `'browse'` — the normal import screen (file grid, selection, grouping,
  preview). This is the default/fallback.
- `'qmz'` — the QMZ Sequence Manager overlay is open (`_qmzOpen`).
- `'import'` — an import is actively running (`importRunning`), tied to the
  same flag that drives `showProgress()`/the progress modal. Cheap,
  authoritative, and already read by other code — worth exposing even
  though Phase 1B adds no commands that run *during* an import.

**There is deliberately no `'group'` context.** Grouping is an *activity*
available within `'browse'`, not a distinct mode the UI itself switches
into — `isMetadataGroupingMode()` is a capability flag (whether grouping UI
affordances are shown), not evidence of a separate screen. Fabricating a
`'group'` context here would invent a UI concept that doesn't exist rather
than reflect one that does; if grouping ever becomes a real distinct screen,
add its context value then; do not add it speculatively now.

### State schema

```ts
{
  context: 'browse' | 'qmz' | 'import',
  activeFile: string | null,     // _resolveActiveFilePath() — same resolution execute() uses
  selectedCount: number,
  hasSelection: boolean,         // selectedCount > 0
  previewOpen: boolean,
  availableCommands: string[],   // see "Availability semantics" below

  // Exactly one of these two is present, never both, based on `context`:
  groups?: [{ id, label, fileCount, subEventId, colorIndex }],   // absent when context === 'qmz'
  sequences?: [{ code, count }],                                  // present only when context === 'qmz'
}
```

- `groups` (browse/import) mirrors `GroupManager.getGroups()` read-only —
  `id`, `label`, `fileCount` (`files.size`, never the raw `Set`),
  `subEventId`, and `colorIndex` (`GroupManager.getGroupIndex`/color-coding
  position). No new mutation API is added beyond the existing
  `group.assign`/`group.unassign` commands.
- `sequences` (qmz only) mirrors the live `_qmzData.sequences` list —
  `code` and `count` (total files across all photographers in that
  sequence). Read-only; the only way to change it is
  `qmz.assignToSequence` (assign into an existing one) or the pre-existing
  UI (create/remove a sequence) — the command layer adds no sequence
  create/remove/edit command in Phase 1B.
- `activeFile` while the preview overlay is open resolves to the
  previewed file (`_previewPath`), not whatever was focused/selected
  before opening it — `_resolveActiveFilePath()` was made preview-aware for
  this (previously only call sites that already short-circuited on
  `_previewOpen` needed it; `getState()` is the first caller that needs the
  resolution itself to be preview-aware).

### Availability semantics

`getAvailableCommands()` filters `getCommands()` down to the ids whose
`check(undefined, bridge)` currently returns true — **the exact same
`check()` every command already declares for `canExecute()`/`execute()`**,
not a second table. A command with no `check()` is always considered
available (matches `canExecute()`'s own "no check ⇒ always eligible" rule).

For a parameterized command (`group.assign`, `qmz.assignToSequence`),
`getAvailableCommands()` reflects only the **context/selection**
eligibility (`check()`), never a specific payload — it answers "is this
command worth offering right now", not "would this exact payload succeed".
A caller (future adapter) must still call
`canExecute(commandId, realPayload)` before actually executing, exactly as
already documented above for `canExecute()`/`execute()`. For example,
`qmz.assignToSequence` appears in `availableCommands` as soon as the QMZ
overlay is open with a non-empty selection, regardless of which sequence
code will eventually be passed — a specific nonexistent or malformed code
is still rejected at `canExecute()`/`execute()` time (see below).

---

## Subscription (Phase 1B)

```js
const unsubscribe = AutoIngestCommands.subscribe(listener);
// listener(state) is called with the same shape getState() returns,
// every time AutoIngest's own state actually changes.
unsubscribe(); // stop receiving further notifications
```

- **Event-driven, not polled.** `commandManager.js` wires
  `window.__autoIngestRendererBridge.notifyStateChange` to its internal
  `_notify()` the first time the bridge is observed — lazily, inside the
  shared `_bridge()` helper every one of `getAvailableCommands()`,
  `getState()`, `canExecute()`, and `execute()` already calls, so it's wired
  before `subscribe()`'s listener could ever matter in practice (call any
  one of those four, or just `execute()` a command, before relying on a
  subscription). `renderer.js` calls `_notifyCommandLayer()`
  (a thin wrapper around that same hook) from the small set of
  already-shared low-level functions every UI and command-driven mutation
  path already funnels through: `_setPreviewFocus`, `syncOneTile`,
  `syncAllTiles`, `syncAllGroupBadges`, `openPreview`, `closePreview`,
  `navigatePreview`, the QMZ equivalents (`_qmzSetPreviewFocus`,
  `_qmzSyncOneTile`, `_qmzSyncAllTiles`, `_qmzRefresh`,
  `_closeQMZManager`), and every `importRunning` assignment site. This was
  the deliberate alternative to sprinkling a notify call into every
  individual UI event handler — no new state-change source was added, only
  a hook onto the ones that already exist and that every path already
  passes through. There is no `MutationObserver`, no polling interval, no
  timer of any kind.
- **A throwing listener never breaks another listener.** Each listener runs
  in its own `try/catch` inside `_notify()`; a thrown error is logged
  (`console.error`) and the remaining listeners still run.
- **No dedicated "unsubscribe all" / listener-count API** — not needed for
  a single future adapter's lifecycle; add one only if a real second
  consumer needs it.

---

## QMZ — `qmz.assignToSequence` (Phase 1B)

| Command | Payload | Applicable when | Calls |
|---|---|---|---|
| `qmz.assignToSequence` | `{ sequenceCode: string }` | QMZ is open, selection is non-empty | `_qmzAssignSelectionToSequenceCode(sequenceCode)` |

**Payload format.** `sequenceCode` must match `main/qmzService.js`'s own
`SEQ_RE`: exactly two digits followed by one of `Q`/`M`/`Z` — e.g. `"01Q"`,
`"12M"`, `"52Z"`. **Before writing this command's validation, `SEQ_RE`,
`parseCode()`, `formatCode()`, and every other QMZ code-format reference in
`main/qmzService.js` were checked exhaustively: no lowercase-suffix variant
(e.g. `"05aQ"`, `"05bM"`) exists anywhere in the current QMZ implementation.**
Such codes are rejected by `isValid()` as malformed, the same as any other
string that doesn't match `SEQ_RE` — this command does not invent grammar
the rest of QMZ doesn't already accept.

**Authoritative primitive.** `_qmzAssignSelectionToSequenceCode(sequenceCode)`
(`renderer.js`) is the shared primitive reused by both `qmz.assignToSequence`
and the pre-existing `_qmzHandleAssignByNumber()`'s single-match branch —
genuinely one implementation, not two. It never creates a sequence and
never guesses a type: it checks the code against the live
`_qmzData.sequences` list and, only if a real match exists, delegates to
`_qmzAssignToSequence(sequenceCode)` — the same real-move-on-disk primitive
every existing QMZ assignment path (numeric-input assign, type-chooser
assign) already uses (`window.api.qmzMoveToSequence`, then
`_qmzAutoQueueMetadata`). Selection is cleared and QMZ state is refreshed
exactly as it is for every other QMZ assignment path — no separate
behavior for the command-layer caller.

**Validation and result semantics:**

- Missing payload, a non-string `sequenceCode`, a blank string, or a string
  not matching `SEQ_RE` (including a lowercase-suffix code) → rejected by
  `isValid()`: `{ ok: false, reason: 'invalid-payload' }`. Nothing is
  touched.
- Outside QMZ mode, or with an empty selection → rejected by `check()`:
  `{ ok: false, reason: 'not-applicable' }`. Nothing is touched.
- A **well-formed but nonexistent** code (e.g. `"02M"` when no such
  sequence has been created) is **not** rejected by `canExecute()` — code
  existence is a payload-dependent fact, not context eligibility, and
  `check()` deliberately never inspects the payload (consistent with every
  other command here). It genuinely runs, finds no match, and resolves to
  `{ ok: true, executed: false }` — the normal "ran, nothing to do" outcome,
  the same category as navigating past the last file. The sequence is never
  auto-created and no type is ever guessed.
- A well-formed, existing code with a non-empty selection →
  `{ ok: true, executed: true }`; `computeExecuted(result)` is required
  here for the same reason as `group.assign`: the underlying primitive
  resolves to a plain boolean (`true`/`false`), and `false != null` would
  otherwise make the generic fallback report `executed: true` even when
  nothing happened (see `commandManager.js`'s `computeExecuted` comment on
  this command — this exact bug was caught by the Phase 1B live test before
  being fixed, not assumed benign).

**QMZ state (`state.sequences`) is read-only.** Phase 1B adds no
create/remove/edit-sequence command; `qmz.assignToSequence` is the only new
QMZ mutation.

---

## Tag Refinement commands (Phase 3D)

| Command | Payload | Applicable when | Calls |
|---|---|---|---|
| `tagRefinement.open` | — | not already active, AND a scope resolves (see below) | `_openTagRefinementForSelection()` |
| `tagRefinement.close` | — | refinement is active | `_closeTagRefinement()` |
| `tagRefinement.useAllTags` | — | active, selection-within-scope non-empty | `_applyAllTagsToRefinementSelection()` |
| `tagRefinement.clearSelected` | — | active, selection-within-scope non-empty | `_resetRefinementSelectionToDefault()` |

**Investigated before writing any command** (`renderer/tagRefinementManager.js`
+ the "Tag Refinement mode" section of `renderer.js`): refinement has exactly
two real entry points — the footer "Refine Tags" button (single-component
events, `EVENT_SCOPE`, no selection precondition to enter) and a specific
group's own `.gc-refine-trigger` (multi-component events, that group's
stable `uid`). There is no existing "resolve refinement scope from the
current selection" primitive — `_resolveRefinementTargetScope()` is a new,
genuinely new composition, but built **entirely** from already-existing
accessors (`_isEventRefineAvailable()`, `GroupManager.getGroupForFile()`,
`EventCreator.getEventComps()`, `TagRefinementManager.isEligible()`), the
same way `_assignSelectionToGroup`/`group.assign` already compose existing
primitives rather than add a business rule. It resolves to:

- `TagRefinementManager.EVENT_SCOPE` when the single-component event's
  footer control would itself be available (selection not required).
- A specific group's `uid` when **every** currently selected file resolves
  (via `GroupManager.getGroupForFile`) to the **same** group, and that
  group's mapped component is itself refinement-eligible
  (`TagRefinementManager.isEligible`).
- `null` — refinement already active, an empty selection in a multi-component
  event, a selection spanning more than one group, a file with no group at
  all, or a group mapped to a non-eligible component. `tagRefinement.open`'s
  `check()` is exactly `_resolveRefinementTargetScope() != null` — since it
  fully pre-validates, `canExecute()` rejects an inapplicable attempt
  (`{ok:false, reason:'not-applicable'}`) **before** `run()` is ever called,
  the same established pattern as `selection.clear` on an empty selection —
  never AutoIngest's own `ok:true, executed:false` "ran, nothing to do" shape
  for these four commands specifically (all four pre-validate fully; only
  commands whose `check()` is `() => true`, like navigation at a boundary,
  use that shape).

**Why `tagRefinement.applyToSelected`/`toggleTag` (the original candidates)
are NOT implemented.** The real "Apply to Selected" button (`#rpApplyBtn`)
applies whichever Event Type/Additional Keyword checkboxes are currently
**checked in the panel's own DOM** — an arbitrary, UI-held tag combination
with no server-side representation outside that render. A hardware command
cannot specify that without either hardcoding tag names (brittle — tags
differ per event/component) or building a tag-picking/list mechanism on the
console (no dynamic text/list affordance exists — see the SDK capability
matrix in `docs/mxLogitechPlugin.md`) — and either path is exactly what "do
NOT let the plugin construct its own tag sets" forbids. `toggleTag({tag})`
has the identical problem one level down (naming one specific tag). The two
real, existing, **parameter-free** buttons that DO map cleanly —
"Use All Component Tags" (`#rpAllBtn`) and "Reset Selected to Defaults"
(`#rpResetBtn`) — are what `tagRefinement.useAllTags`/`clearSelected` reuse
instead; `clearSelected`'s real name was literally reusable as-is.
`useAllTags` is the closest honest replacement for what `applyToSelected`
was trying to express.

**No logic duplicated between the mouse and the command layer.**
`renderRefinementPanel()`'s own Apply/Use All/Use None/Reset button handlers
were refactored to call the same module-level `_applyRefinementOverride()`
the command layer's `useAllTags`/`clearSelected` call — previously an inline
closure re-created on every panel render, now one shared function. A click
and a command-driven call are byte-identical from that point on, never two
parallel implementations.

**A real gap found and fixed while building this.** Entering/exiting
refinement mode (`_enterRefinementMode`/`_exitRefinementMode`) called none
of the existing notify-hook functions (`syncAllTiles`, `syncAllGroupBadges`,
etc. — see "State-change subscription" above) — a `subscribe()`r would never
have learned that `tagRefinement` state changed. Fixed by adding an explicit
`_notifyCommandLayer()` call at the end of `_enterRefinementMode`,
`_exitRefinementMode`, and `_applyRefinementOverride` — not a new polling
path, just completing the existing hook coverage for a genuinely new state
source this phase introduces.

---

## Tag Refinement — dynamic tag state (Phase 3E)

**AutoIngest-side foundation for a future dynamic hardware keypad — no
hardware/plugin work in this phase.** Builds on Phase 3D's `tagRefinement.*`
commands to let an external controller participate in the real
select→refine→Apply flow per tag, not just at the whole-session granularity
Phase 3D stopped at.

### The existing model, traced first (before any edits)

- **No separate tag ID exists anywhere.** A tag's only identity in the real
  system is `{category: 'eventTypes'|'additionalKeywords', label: string}` —
  labels are used directly as chip `value`s and directly as override array
  members. The canonical identity exposed to commands is the composite
  string `` `${category}:${label}` `` (e.g. `"eventTypes:Waaz"`) — not an
  invented numeric ID, and not just the bare label (which could collide
  across the two categories).
- **The real tri-state enum is `checked`/`unchecked`/`indeterminate`**
  (`TagRefinementManager.getSelectionState()`'s own values) — used verbatim
  here, not the placeholder `on`/`off`/`mixed` names an earlier draft of
  this feature used informally.
- **Chip interaction was draft-only, held ONLY in the DOM** before this
  phase: the panel's `change` listener touched nothing but a `_rpDirty` flag
  and the Apply button's `disabled` attribute — the checkbox's own native
  `.checked` was the only record of "what will be applied." **Apply to
  Selected is a real, distinct commit step** (`#rpApplyBtn`'s click handler
  read `:checked` from the DOM and called `TagRefinementManager.setOverride`)
  — chip changes never touched `TagRefinementManager` on their own.
- **Promoted to an explicit, renderer-owned draft** (`_rpDraft` in
  `renderer.js`) so a headless command-layer caller can participate in the
  identical draft a mouse click would — the real chip `change` handler and
  `tagRefinement.setTagState` now both call the same
  `_setRefinementDraftTag()` primitive; `#rpApplyBtn`'s click handler and
  `tagRefinement.applyToSelected` both call the same
  `_applyEffectiveRefinementToSelection()`. Neither path duplicates the
  other's logic.
- **Selection changes while refinement is active do not re-render the
  panel** (a DOM-render-cost optimization, not a business rule — only the
  selected-count label updates). `getState()`'s `tagRefinement.tags[]` is
  computed **live** against the current selection on every call instead,
  consistent with every other `getState()` field — not replicated staleness.

### Commands

| Command | Payload | Applicable when | Calls |
|---|---|---|---|
| `tagRefinement.setTagState` | `{ tagId: string, checked: boolean }` | active, selection-within-scope non-empty | `_setRefinementDraftTag()` |
| `tagRefinement.applyToSelected` | — | active, Apply not blocked (see below) | `_applyEffectiveRefinementToSelection()` |

**Why `setTagState`, not `toggleTag`.** The real underlying primitive (a
checkbox) is a desired-boolean-state setter, not a toggle: a DOM `change`
event always reports the checkbox's new, definite value directly, never "please
flip whatever it currently is." An explicit `{tagId, checked}` avoids the
command layer (or the plugin) ever having to track/guess a prior state to
know what to toggle to — the brief's own escape hatch ("if the UI actually
sets a desired tri-state rather than simply toggling, expose the appropriate
operation instead") is exactly this case.

**Validation — the tag must exist in the CURRENT scope's real tag set,
checked fresh on every call, never a cached/trusted list:**
`_setRefinementDraftTag()` reads `RefinableTags.availableTags(scope.comp)`
directly each time. An arbitrary tag, a real label under the WRONG category,
a malformed `tagId` (no `:` separator), or a stale `tagId` left over from a
previous event/component are all rejected identically — **not** by
`isValid()`/`check()` (existence is payload-dependent, not context
eligibility — same established rule as `qmz.assignToSequence`'s nonexistent-
code case), but by `run()` itself returning `false`, resolving to
`{ ok: true, executed: false }`. Nothing is ever mutated by a rejected
attempt. `isValid()` only rejects shape errors (missing/non-string `tagId`,
missing/non-boolean `checked`) before anything is attempted.

**`tagRefinement.applyToSelected`'s `check()` mirrors the real Apply
button's own disabled-state rule EXACTLY**
(`isRefinementApplyBlocked()` → the real, unchanged `_rpApplyBlocked()`),
not an approximation: blocked when there is no selection in scope, or when
the selection is `'mixed'` and the operator hasn't explicitly touched any
tag yet (`_rpDirty`) — exactly the same rule that disables the real button.
`applyToSelected` is implemented now (Phase 3D explicitly did NOT implement
it verbatim, because the real Apply button committed whichever tags were
checked in the DOM — an arbitrary, unspecifiable-by-hardware state. The
draft model this phase adds is the missing piece: `setTagState` lets a
caller build that same explicit state first, so `applyToSelected` can
commit it through the identical primitive the mouse uses).

### State schema (Phase 3E addition)

```ts
tagRefinement?: {
  active: boolean,
  scopeLabel: string | null,
  componentLabel: string | null,
  selectedCount: number,
  status: 'empty'|'default'|'refined'|'none'|'mixed',
  tags: Array<{
    id: string,                                   // "<category>:<label>"
    category: 'eventTypes' | 'additionalKeywords',
    label: string,
    state: 'checked' | 'unchecked' | 'indeterminate', // draft-aware — see below
  }>,
}
```

- `tags[]` has one entry per real, currently-offered tag for the active
  scope's component — **never a fixed/padded size**, and never includes a
  tag that isn't genuinely available right now.
- `state` is **draft-aware**: once the operator (mouse or hardware) has
  touched any tag since the last full render/reset, every tag's `state`
  reflects the pending draft (`checked`/`unchecked` only — a native
  checkbox always resolves `indeterminate` to a definite value on
  interaction, never cycles through "mixed" as a settable state) rather than
  the live `getSelectionState()` computation. This is required for the
  brief's own desired workflow ("each key press... the console will show the
  current tri-state") — a `setTagState` press must be visible in the very
  next pushed state, before Apply commits anything to the real
  `TagRefinementManager`.
- **No `canApply` boolean** — same reasoning as Phase 3D's `available`
  omission: `'tagRefinement.applyToSelected' in availableCommands` already
  encodes exactly that answer; a second copy would be the redundant
  eligibility table `getAvailableCommands()`'s own doc comment warns against.
- **No per-photo tag maps, ever** — `tags[]` is scoped to the whole current
  selection, computed from `getSelectionState()`, never a per-file
  breakdown.

### Live state updates (subscription coverage)

Every one of the brief's required redraw triggers was checked against the
existing notify-hook chain:

| Trigger | Already notifies? | How |
|---|---|---|
| Refinement mode opens/closes | **Fixed this phase** (see Phase 3D's own "a real gap found and fixed") | explicit `_notifyCommandLayer()` in `_enterRefinementMode`/`_exitRefinementMode` |
| Selection changes | Yes, pre-existing | `syncAllTiles()` (every selection-mutating path already calls it) |
| A tag/chip state changes | **New this phase** | `_setRefinementDraftTag()` calls `_notifyCommandLayer()` directly |
| Use All Tags / Clear Selected / Apply run | Yes (Phase 3D) | `_applyRefinementOverride()` already notifies |
| Refinement scope changes | Yes | covered by open/close above (a scope change is always an exit+re-entry) |
| Active group changes | Yes, pre-existing | `syncAllGroupBadges()` |

No polling anywhere; no new notification source beyond the one genuine gap
(tag/chip state) this phase had to add.

### Performance

`tags[]`'s cost is bounded by **(available tags for the active component) ×
(selected files within scope)** — never the archive or card size, since it
is computed from `RefinableTags.availableTags()` (fixed, small, per-event)
and `TagRefinementManager.getSelectionState()` (iterates only the files
passed in, never all files on disk). Verified with a synthetic 150-file
selection in `test/mxCommandLayerPhase3ELive.test.js` — `getState()`
completed in single-digit milliseconds. No caching/memoization was added
speculatively; none was needed.

### UI ↔ command equivalence (proven, not assumed)

`test/mxCommandLayerPhase3ELive.test.js` performs the SAME refinement
operation twice on two fresh files — once via real DOM events (an actual
chip checkbox click + an actual `#rpApplyBtn`/`#rpAllBtn`/`#rpResetBtn`
click) and once via `AutoIngestCommands` only — and asserts the resulting
`TagRefinementManager.getOverride()` is identical, for: a single tag turned
ON, Use All Tags, and Clear/Reset. This is possible, and meaningful, only
because both paths were refactored onto the exact same shared primitives
above — not because the two implementations happen to agree today.

### Security / validation tests

Also in `test/mxCommandLayerPhase3ELive.test.js`: an arbitrary tag not in
the current scope, a real label under the wrong category, a `tagId` with no
category prefix, a stale `tagId` from a previously-active different
component (switched via a real Change Event), and every malformed-payload
shape (`isValid()`'s job) — each resolves safely (`ok:true,executed:false`
or `ok:false,reason:'invalid-payload'`, never a throw) and a before/after
snapshot confirms **zero** of them mutated the real
`TagRefinementManager` override.

### Transport test (Phase 2, real WebSocket client)

`test/mxCommandLayerPhase3ELive.test.js` also drives the real authenticated
WS transport end to end (the same `ws`-package client role
`test/mxControlTransportLive.test.js` established): receives the real tag
list with real tri-state values in the initial/subsequent state pushes,
executes `tagRefinement.setTagState` and observes the draft reflected in the
very next push, executes `tagRefinement.applyToSelected`, and confirms the
real `TagRefinementManager` override on the other side — all over one
ordinary authenticated connection, no Logitech SDK involved.

---

## Change Event — `event.openChooser` (Phase 3D)

| Command | Payload | Applicable when | Calls |
|---|---|---|---|
| `event.openChooser` | — | not in QMZ, not importing | `openEventPickerFromWorkspace()` |

**Investigated before deciding the name.** "Change Event" from the LANDING
screen (`showEventCreatorResume`) resets the whole workspace (groups, QMZ,
import session) — a true session boundary, and not reachable from the
`'browse'` context this console operates in anyway. The REAL in-workspace
"Change Event" is `openEventPickerFromWorkspace()`
(`renderer/importSessionUI.js`, bound to `#ctxChangeEventBtn`): it **only
opens** the real event chooser/creator modal and returns; the actual switch
happens asynchronously, later, once the operator picks a specific event
from the real on-screen list (`_returnToWorkspaceFromPicker`). There is no
authoritative way to target a *specific* event without that list — exactly
the brief's own anticipated fallback: "the safest first command may simply
be `event.openChooser`." No command encodes a target event; the hardware is
a launcher for the real chooser, same principle as Ask AutoIngest's "console
is only the launcher, not a replacement text-input mechanism" (see
`docs/mxLogitechPlugin.md` for why Ask AutoIngest itself has no command at
all).

**`check()` mirrors `group.assign`/`group.unassign`'s own `!isQmzOpen()`
gate** — not a new rule, the same established "QMZ is a separate full-screen
overlay this is already unreachable from" pattern — plus `!isImportRunning()`
(the same pre-existing `importRunning` flag every other import-aware check
already reads). `openEventPickerFromWorkspace()` additionally no-ops safely
on its own remaining guard (`_sessionRunBusy`, no active event) and now
*reports* that outcome as a boolean return value (a purely additive change —
every pre-existing caller already ignored the return value).

**State: `state.event`.** `{ activeEventName, participatingCount }` —
present only when an event is actually active (omitted entirely otherwise,
same "only where meaningful" convention as `groups`/`sequences`/
`tagRefinement`). Deliberately just two scalars: no event id, no event list,
no `event.json` fields. Exposing the active event's name needs nothing more
than that to be useful on its own, and nothing this phase adds needs to
*target* a specific event without going through the real chooser.

---

## State schema (Phase 3D additions)

**`tagRefinement` gained a `tags[]` field in Phase 3E** — see "Tag
Refinement — dynamic tag state (Phase 3E)" above for its full shape. The
original Phase 3D fields below are unchanged.

```ts
{
  ...                              // unchanged Phase 1B fields, see above
  tagRefinement?: {
    active: boolean,
    scopeLabel: string | null,      // e.g. "Current Event" or a group's label
    componentLabel: string | null,  // the mapped component's folder/display name
    selectedCount: number,          // selection within the active scope only
    status: 'empty'|'default'|'refined'|'none'|'mixed',
    tags: Array<{...}>,             // Phase 3E — see the dedicated section above
  },
  event?: {
    activeEventName: string | null,
    participatingCount: number,     // ImportSession.participatingCount()
  },
}
```

Both fields are **omitted entirely** (not present-but-`null`) outside
`context === 'browse'` — refinement can only be active, and "Change Event"
is only reachable, from browse in the current codebase. Both are
deliberately minimal:

- `tagRefinement` has **no `available` boolean** — whether `tagRefinement.open`
  would succeed is already exactly what `availableCommands` encodes
  (`'tagRefinement.open' in availableCommands`); a second copy of that same
  answer would be the redundant eligibility table `getAvailableCommands()`'s
  own doc comment already warns against.
- `tagRefinement` has **no per-tag checkbox-state array** (the task brief's
  own example `tags: [...]` field). Nothing this phase exposes on hardware
  ever needs to pick an individual tag, so shipping that array would be
  unused weight with no consumer — the one thing the "cheap to derive,
  actually needed" compactness rule exists to prevent.
- `event` has **no event id, no full event list, no `event.json` fields** —
  see "Change Event — `event.openChooser`" above for why nothing needs to
  target a specific event without the real chooser.

---

## Group → Sub-Event Mapping — `group.setSubEvent` (Phase 4C)

Added after Phase 4B physical closure found a real workflow gap: the
console could assign files to G1/G2/G3 (`group.assign`) but had no way to
map a group to one of a multi-component event's real sub-events/
components, so `tagRefinement.open` correctly stayed unavailable until the
operator used the computer. Traced the authoritative UI path first (the
Group Panel's own sub-event dropdown, `renderer.js`'s delegated
`.gc-sub-trigger` click handler) before adding anything — the new command
reuses that exact primitive, extracted into `_setGroupSubEvent(groupId,
subEventId)`, rather than duplicating its logic.

### Commands

```js
'group.setSubEvent': {
  isValid: (p) => !!p && typeof p === 'object'
    && Number.isInteger(p.groupId)
    && typeof p.subEventId === 'string' && p.subEventId.length > 0,
  check: (_p, b) => !b.isQmzOpen() && b.getAvailableSubEvents().length > 0,
  run: (p, b) => b.setGroupSubEvent(p.groupId, p.subEventId),
  computeExecuted: (result) => result === true,
}
```

`groupId` is an explicit payload field (same shape as `group.assign`) — the
**caller** (the C# dynamic workspace) resolves which group via the new
`targetGroupIdForMapping` state field below, never this command itself.
`check()` only validates general applicability (a multi-component event
exists); `run()` does the real per-payload validation and resolves to
`false` — not an `ok:false` check failure — for any rejection: unknown
group, stale/unknown `subEventId`, or a duplicate already taken by another
group. Same established lesson `tagRefinement.setTagState`/
`qmz.assignToSequence` already document: existence/validity of a specific
payload value is a payload-dependent fact, not a context-eligibility one.

### Target-group resolution

Evaluated the brief's three options (map the selection's group; map the
most-recently-active group; a first dynamic level that asks which group)
and chose **"map the group the current selection unambiguously belongs
to,"** reusing — not reinventing — the exact rule `tagRefinement.open`'s
own group-scope resolution already established
(`_resolveRefinementTargetScope()`'s "every selected file must resolve to
the SAME group" check). `_resolveTargetGroupForMapping()` is the same
pattern applied to this command: null for an empty, ambiguous (spans two
groups), or ungrouped selection — never a guess.

### Side effects preserved exactly (brief §2/§11)

`_setGroupSubEvent` reproduces the real dropdown's own side effects, not an
approximation:
- A duplicate `subEventId` (already taken by a *different* group) is
  rejected — the real dropdown has never allowed reaching this value
  either (a `disabled` item is unclickable); the console enforces the same
  rule programmatically, since it has no "disabled" affordance of its own.
  **Current AutoIngest policy blocks duplicates at the UI level** (not a
  later import-time-only warning), so the console blocks them too, per the
  brief's own "do not impose stricter or looser C# behavior" instruction.
- Remapping a group that already has per-file Tag Refinement overrides to
  a **different** component shows the real "clear refinements?"
  confirmation (`showClearRefinementsOnRemapModal`) on the **computer
  screen** and awaits it — console-triggered or not. Only on confirmation
  does it clear the group's refinement contents (never its `uid`/identity)
  and apply the remap. A console press that triggers this blocks on a
  human answering the computer, exactly as a mouse click already does —
  not a new condition this command introduces.
- Mapping a group to a component changes **only** that group's
  `subEventId`. It never touches file→group membership, ImportSession
  claims/ownership, or file paths — verified with a dedicated regression
  test (`mxCommandLayerPhase4CLive.test.js`, section 3).

### State schema (Phase 4C additions)

```ts
{
  ...
  groups?: Array<{ id, label, fileCount, subEventId, colorIndex }>, // subEventId unchanged, already existed
  availableSubEvents?: Array<{ id: string, name: string }>, // NEW — EventCreator.getSubEventNames()'s own real shape, verbatim
  targetGroupIdForMapping?: number | null,                  // NEW — see "Target-group resolution" above
}
```

Both new fields are **omitted entirely** (not present-but-`[]`/`null`)
outside a multi-component event — `getAvailableSubEvents()` returning `[]`
is itself the single source of truth for "this concept doesn't apply here"
(single-component events, no active event), same compactness convention
`tagRefinement`/`event` already use. `id === name` — both are the real
component folder name `EventCreator.getSubEventNames()` already computes;
nothing is rebuilt from event types/city/location here (brief §4/§8).

### Live state updates (subscription coverage)

`_setGroupSubEvent` now calls `_notifyCommandLayer()` on a real change — a
genuine pre-existing gap found while building this: the mouse-only dropdown
never needed to (nothing was watching before the command layer existed).
Covered by `mxCommandLayerPhase4CLive.test.js`'s own subscription check.

### UI ↔ command equivalence (proven, not assumed)

`mxCommandLayerPhase4CLive.test.js` section 7 drives an equivalent remap
through BOTH the real `.gc-sub-trigger` dropdown click path and
`group.setSubEvent`, and asserts the resulting `GroupManager` state is
identical — not "should be the same because the code looks similar," a
structural guarantee from both paths calling the exact same
`_setGroupSubEvent` primitive, proven end-to-end.

### Tests

- **`GroupMappingWorkspaceModelTests.cs`** (16 tests, C#, pure model):
  Unavailable fallback (no components / no target group), real component
  list mapping with the real display name passed through unmodified,
  current-mapping rendering, taken-by-another-group rendering (and that a
  group's own existing mapping is never confused with "taken by another"),
  stale-state replacement, `ResolveSubEventId`'s `JsonElement` handling,
  long names never truncated at the model layer.
- **`GroupMappingTransportIntegrationTests.cs`** (2 tests, C#, real
  transport): the real `AutoIngestClient` against `MockAutoIngestServer`'s
  real WebSocket/JSON path — an unmapped group's workspace (Tag Refinement
  correctly unavailable) → `group.setSubEvent` → the pushed state reflects
  the real mapping AND `tagRefinement.open` becomes available, no
  restart/reload — plus a dedicated duplicate-rejection transport test.
- **`mxCommandLayerPhase4CLive.test.js`** (JS, real Electron renderer):
  single-component unavailability, the full state schema, malformed/
  invalid/stale payload rejection, a valid mapping and its state update,
  subscription coverage, group-membership/ImportSession-ownership
  invariance across a remap, duplicate-mapping rejection, ambiguous-
  selection resolution, a stale `subEventId` after Change Event, and the
  UI↔command equivalence test above.

---

## Resume — investigated, not exposed (Phase 3D)

No genuinely Browse-context, operator-facing "resume" command was added.
Every `resume`-named thing in the codebase was traced individually:

- **Genuinely internal automatic recovery, never operator-facing**:
  `main/metadataQueueStore.js`/`main/main.js`'s metadata-batch resume
  (`resumeInterruptedBatches`, run once at startup), `main/exifService.js`'s
  `resumeFrozenFile` (an internal retry primitive), and
  `main/metadataAuditService.js`'s audit resume (`resumeMetadataAudit`,
  called from the Archive Maintenance screen's own retry UI, not Browse).
- **`EventCreator.resume()`** (`renderer/eventCreator.js`) is an internal
  wizard-step-navigation helper ("resume at step 3"), not reachable from
  Browse and not a standalone operator concept.
- **Real, operator-facing resume buttons DO exist**, but each belongs to a
  screen/pipeline explicitly out of this phase's (and the current roadmap's)
  scope, not to "internal-only" automatic recovery: the active-import
  pause/resume control (`#progressResumeBtn`, `copy:resume` IPC) belongs to
  the import-progress screen — import start/confirm/control remains
  deferred per this document's own existing "Deferred commands" section;
  the Archive Sync Queue's "Resume Sync" button (`.sq-resume-btn`) belongs to
  Archive Maintenance — not started, per the same section.

Per the brief's own instruction ("If resume is only internal automatic
recovery: do NOT expose it on MX"), extended to cover the second case found
here too: a real operator action that exists but belongs to an
out-of-current-scope screen is reported as such, not quietly treated as
equivalent to "doesn't exist." Nothing is hardware-mapped this phase.

---

## Ask AutoIngest — no command layer entry point exists (Phase 3D)

Investigated and found to be architecturally outside this file's scope
entirely, not merely deferred: "Ask AutoIngest" (`AI-FEAT-059`, the Knowledge
Engine) lives **entirely** under `scripts/product-docs/knowledge-portal/` —
a separate, standalone Node `http` server (`server.js`, bound to
`127.0.0.1`) serving its own static page, with **no connection whatsoever**
to `renderer.js`, `window.__autoIngestRendererBridge`, or
`AutoIngestCommands`. It is reached via a browser, the `knowledge` CLI
(`knowledge ask`/`knowledge serve`), or its own portal page — never through
the Electron app's renderer at all. There is therefore no "authoritative
renderer function" this command layer could ever delegate to for it, by
construction, not by choice. See `docs/mxLogitechPlugin.md` "Ask AutoIngest
— investigated, rejected" for the full finding and its effect on the
reserved-ninth-key evaluation.

---

## Context / mode

Every command's `check(payload, bridge)` reads live renderer state through
the bridge (`isQmzOpen()`, `isPreviewOpen()`, `getSelectionSize()`,
`getActiveFilePath()`, `getVisibleFileCount()`) — nothing is cached.
`AutoIngestCommands.getContext()`/`getState().context` (Phase 1B, see
above) expose the coarse-grained summary of that same state as one of
`'browse'` / `'qmz'` / `'import'` — see "Context values" above for exactly
what exists and, just as importantly, what was deliberately **not** added
(no `'group'` context — grouping is an activity within `'browse'`, not a
distinct mode). Adding a genuinely new mode later — so a specific console
page can ask "is this command relevant to what I'm showing" — only means
adding more bridge accessors, `check()` conditions, and a new
`_getCommandContext()` branch; it does not require changing the registry
shape, `execute()`, or any existing command.

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
   it takes a payload that could be malformed), and — **before assuming the
   generic `executed` fallback is fine** — check whether `run()`'s resolved
   value is ever a non-null "no effect" result (an object, or `false`); if
   so, add `computeExecuted(result)` too. This was missed once for
   `qmz.assignToSequence` in Phase 1B and caught only by its own live test
   (see the QMZ section above) — treat it as a required checklist item for
   every new command, not an occasional fix.
4. Add a live test case exercising it against real fixture data, following
   the existing cases' pattern — either in `test/mxCommandLayerLive.test.js`
   (Phase 1A's registry/navigation/selection/preview/grouping coverage) or
   `test/mxCommandLayerPhase1BLive.test.js` (state/discovery/subscription/QMZ
   coverage), whichever the new command's area matches; split into a further
   new file if either grows unwieldy, following the same pattern.

**Adapters must never manipulate AutoIngest state independently.** Every
effect a controller (Logitech plugin, keyboard shortcut, anything else)
produces must go through `AutoIngestCommands.execute()`. Nothing outside
`renderer.js`/`commandManager.js` should ever call
`window.__autoIngestRendererBridge` directly, read/write `selectedFiles`/
`GroupManager`/etc. directly, or simulate clicks on command-layer-covered
UI.

---

## What an external adapter may / may not do (as of Phase 1B)

A future adapter (Logitech plugin or otherwise) may, once a transport
exists:

- Call `getContext()`/`getState()`/`getAvailableCommands()` to render its
  own UI (e.g. relabeling MX Console dial/button actions per context).
- Call `subscribe()` to keep that UI in sync without polling.
- Call `canExecute()`/`execute()` for any of the nine registered commands,
  including `qmz.assignToSequence` with a real, existing sequence code.

It may **not**, and nothing in Phase 1B adds a way to:

- Read or write any AutoIngest state by a path other than
  `AutoIngestCommands` (no direct `window.__autoIngestRendererBridge`
  access, no DOM inspection/simulation, no reaching into `GroupManager`/
  `selectedFiles`/QMZ state directly).
- Create, remove, or edit a QMZ sequence (only assignment into an
  *existing* one is exposed).
- Start, confirm, or otherwise drive an import (`import.start` and
  everything import-execution-related remains unexposed).
- Touch Archive Maintenance, Event Maintenance, or the Archive Browser
  (unimplemented in the command layer — no authoritative primitive exists
  yet to reuse).
- Reach the renderer over a network port, WebSocket, or HTTP server — no
  such transport exists in this codebase; Phase 1B is transport-free by
  design, same as Phase 1A.
- Bypass `isValid()`/`check()` validation for any command, including
  guessing/accepting a QMZ code format (such as a lowercase-suffix code)
  that `main/qmzService.js` itself doesn't support.

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
