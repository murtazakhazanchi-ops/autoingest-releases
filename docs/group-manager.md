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
- Must reset on event change
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
- Must reset when:
  - event changes
  - data becomes invalid

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