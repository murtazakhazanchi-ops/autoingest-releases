# Design System — UI Consistency Rules

This document defines the visual and component system.

All UI must follow these rules.

---

## 1. Core Principles

- Consistency over variation
- Reuse existing components
- No one-off styling
- Maintain visual hierarchy

---

## 2. Visual Style

- Glassmorphism-based UI
- Must work in light and dark modes
- Use consistent blur, opacity, and shadow values

---

## 3. Icons

- SVG icons only
- No emoji usage anywhere
- Icons must be consistent in:
  - size
  - stroke width
  - style

---

## 4. Component Consistency

### Buttons

- Same height across app
- Same padding and font size
- Same border radius
- Variants allowed:
  - primary
  - secondary
  - destructive
- All close/dismiss buttons inside modals must carry `type="button"` — omitting this causes the browser engine to treat the button as a submit trigger inside any ancestor `<form>`, which can fire unintended form-submission side effects in Electron renderer contexts

---

### Cards

- Same border radius
- Same padding system
- Same shadow/blur style
- No inconsistent sizes without reason

---

### Modals

- Same spacing system
- Same header + body + footer structure
- Same animation behavior
- Multi-tab modals that share a shell class (e.g. `.emm-box`) must use a scoped `height` rule on the specific modal ID to pin the shell to a stable full height — `max-height` alone allows the shell to collapse when a tab renders short content, causing visual jumping across tab switches. The shared class must not be modified; always scope the fix to the modal's own ID selector.

---

### Action Row Token

`.al-action-row` is the reusable spacing token for section-level action areas within panels and modal tabs (e.g. "Verify Integrity", "Re-apply Metadata").

Rules:
- Apply `margin-top`, `padding-top`, `padding-bottom`, and a `border-top` using `var(--border-subtle)` — this visually separates the action area from the content above
- Use `.al-action-row` directly on new action areas; do not invent one-off rules
- Existing named variants (`.al-verify-area`, `.al-reapply-area`) share the same rule block and are kept for backward compatibility

---

## 5. Spacing System

- Use consistent spacing scale (e.g., 8px grid)
- No arbitrary spacing values
- Maintain vertical rhythm

---

## 6. Typography

- Consistent font sizes
- Consistent hierarchy:
  - headings
  - body text
  - labels

---

## 7. Layout Rules

- Maintain alignment across components
- Avoid visual imbalance
- Respect grid structure

---

## 8. Interaction Consistency

- Same hover states
- Same active states
- Same transitions

---

## 8a. File Tile Visual States

Four distinct states — must not be visually confused:

| State | Class | Visual |
|---|---|---|
| Default | (none) | Surface background, subtle border |
| Hovered | `:hover` | Accent-tinted background, slight lift |
| Import selected | `.selected` | Strong accent background + visible checkbox |
| Preview focused | `.pv-focused` | Accent outline ring only |

**Focus ring strength adapts to context (`body.has-import-selection`):**
- No import selection → strong ring + faint bg tint (focus is the primary affordance)
- Import selection exists → subtle ring, no bg (selection dominates)
- Both selected and focused → selected bg + solid accent ring (combined state)

**List view:** left-edge `inset box-shadow` instead of outline.

Rules:
- `.pv-focused` must never imply import selection
- `.selected` must never imply preview focus
- Both can coexist on the same tile simultaneously

---

## 8b. Multi-Row Panels with Dropdowns and `backdrop-filter`

`backdrop-filter` on a row element creates a CSS stacking context. In a multi-row panel (e.g., `.ec-comp-row` in the Event Creator), later sibling rows will paint over the dropdown of an earlier row because the stacking context is local to each row.

Rules:
- Always set `position: relative; z-index: 1` on the row element so it participates in the parent stacking context
- Elevate the row whose dropdown is open via `:has(.tac[data-open]) { z-index: 100 }` (or equivalent open-state selector)
- Do not rely solely on a high `z-index` inside the dropdown itself; the stacking context boundary prevents it from escaping the row

This pattern applies to any multi-row panel where rows carry `backdrop-filter` and each row contains a dropdown or floating overlay.

---

## 9. Forbidden

- No emoji usage
- No random font sizes
- No inconsistent button sizes
- No ad-hoc styling

---

## 10. Reuse Rule

Before creating any new UI element:

- Check if an existing component can be reused
- Extend existing patterns instead of creating new ones

---

## 11. Enforcement

If UI violates design system:

→ STOP  
→ Identify inconsistency  
→ Refactor to match system  

Never introduce inconsistent UI