# Group Manager

## Group Structure

{
  id,
  label,
  colorIdx,
  files: Set,
  subEventId
}

- id → unique identifier
- label → user-facing name
- colorIdx → UI identifier only (must not affect logic)
- files → set of assigned file references
- subEventId → mapping to event.json subEvent

---

## Rules

- Groups never empty
- Auto-remove when empty
- One group → one sub-event
- Files must belong to exactly one group
- Groups must have valid subEventId before import

---

## Operations

- createGroup
- assignFiles
- unassignFiles
- setSubEvent

- All operations must maintain contract integrity
- Invalid operations must be rejected (not corrected silently)

---

## Constraints

- No duplicate sub-event mapping
- No file can exist in multiple groups
- **Group/component state must never leak across events.** (Previously guaranteed by resetting the singleton on event change; with Multi-Event Import it is guaranteed by isolated per-event GroupManager instances — see *Per-Event Instances* below.)
- Must remain consistent with event.json mappings

---

## Validation

Before import:

- all groups must have subEventId
- no duplicate subEventId across groups
- no unassigned files allowed

If validation fails:
→ block import

---

## State Behavior

- GroupManager is a transient state layer
- Must always sync with event.json
- Each participating event owns its own instance; state is reset (via `ImportSession.reset()`) at true session boundaries — source change, eject/disconnect, leaving to the landing screen — and when data becomes invalid
- Changing the Current Event does **not** reset anything: the facade is rebound to the target event's instance

---

## Contract Alignment

Violations map to:

- GROUP → duplicate or missing mappings
- STATE → desynchronization
- VALIDATION → incomplete grouping

---

## Debugging Role

GroupManager is the primary source for:

- file grouping state
- sub-event mapping

If grouping is incorrect:
→ check GroupManager before routing or UI

---

## Per-Event Instances (Multi-Event Import)

`renderer/groupManager.js` exports a **facade** `GroupManager` bound to the Current Event's instance, plus `createGroupManager()`, which builds independent instances. `ImportSession` (`renderer/importSession.js`) owns one instance per participating event and rebinds the facade with `GroupManager.bind(instance)` when the Current Event changes, so every existing call site (group panel, badges, ⌘G, drag/drop) keeps working unchanged.

- Group ids are positional (1..N) and meaningful only inside one event — Event A's "G1" and Event B's "G1" are unrelated. Isolation is structural: no two events share one instance.
- A file is owned by at most **one** event. `assignFiles()` fires an `onClaim(paths)` hook *before* mutating; `ImportSession` releases those paths from every other event (an emptied group is removed and renumbered by that event's instance). The rule lives in the model, so every UI route is covered.
- Group operations, validation and the "groups never empty / one group → one sub-event" rules are unchanged and apply per instance.
- Reading another event's groups must go through that event's workspace, never through the facade.

Full design, reset boundaries and the extension point for additional event-scoped state: [multi-event-import.md](multi-event-import.md).
