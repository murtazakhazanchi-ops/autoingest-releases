# UI System

## Principles

- UI reflects backend state
- No independent state
- All actions validated
- UI must never mutate system state directly
- All state changes must originate from backend or validated actions

---

## Design System Dependency

- All visual styling must follow design-system.md
- UI must not define independent styling rules
- Components must reuse defined design patterns

---

## Layout

- Dashboard (landing)
- Source selection cards
- File browser
- Group panel
- Import modal

---

## File Panel

- Grid/List view
- Grouped sections (RAW / Images / Video)
- Selection controls

- Must reflect grouping and state from GroupManager

---

## Selection System

Two separate concepts — must never be conflated:

**Import selection** (`selectedFiles: Set`)
- Controlled by: Cmd/Ctrl-click, Shift-click range, Cmd/Ctrl+A (select all), Cmd/Ctrl+D (deselect all), Clear button, checkboxes
- Source of truth for import, group assignment, and selected counter
- O(1) tile updates via tileMap

**Preview focus** (`lastClickedPath`)
- Set by: any click (normal, Cmd/Ctrl, Shift), arrow key navigation
- Used only for Space-bar preview open; never affects import or group logic
- Visual indicator: `.pv-focused` CSS class (see design-system.md)
- Cleared only on source/folder change — not on deselect operations

**Shift-click anchor** (`_selectionAnchor`)
- Separate from `lastClickedPath`
- Set only on Cmd/Ctrl-click or first shift-click; cleared on deselect/source change
- Validated against `currentFiles` before each shift-range to prevent stale anchor

**Keyboard shortcuts**
- Cmd/Ctrl+A: select all visible files for import
- Cmd/Ctrl+D: deselect all import selection; preview focus preserved
- Arrow Left/Right/Up/Down (preview closed): move preview focus through rendered order
- Space: open preview for focused file (fallback: first selected → first in view)

- Import selection state must not affect system logic directly

---

## Dashboard

- Hero card (event state)
- Mode toggle (Event / Quick)
- Source cards
- Overview stats

- All displayed data must derive from event.json or system state

---

## UI Rules

- No full re-render on minor updates
- Use sync functions instead
- Maintain visual hierarchy
- UI must not contain business logic
- UI must not correct invalid backend state
- All updates must be triggered by explicit state changes
- UI must follow design-system.md for all visual elements
- No ad-hoc styling or inconsistent components allowed

---

## State Synchronization

- UI must sync from:
  - event.json
  - GroupManager
  - import state

- Sync must be explicit (no implicit refresh)
- UI must update only affected components

---

## Validation Interaction

- UI must trigger validation before critical actions (e.g., import)
- UI must block actions if validation fails
- UI must display validation errors clearly

---

## Contract Alignment

Violations map to:

- UI → incorrect rendering or stale display
- STATE → desynchronization between UI and backend

UI must never violate system contracts

---

## Debugging Role

UI is the final layer in the system.

If UI shows incorrect data:
→ verify backend (event.json, GroupManager) first

Only debug UI after backend is confirmed correct

---

## Component Responsibility

- UI System defines behavior and structure
- Design System defines appearance and styling
- Components must not mix logic and styling concerns