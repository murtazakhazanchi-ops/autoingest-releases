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