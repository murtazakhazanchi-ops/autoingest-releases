# Event System

## EventCreator

Steps:
1. Define Collection (top-level grouping)
2. Define Event metadata (components)
3. Generate event.json structure
4. Preview final folder structure before commit

---

## Naming

Collection:
{HijriDate}_{Label}

Event:
- Deterministically generated from components
- Must remain stable once created
- Must not change during import

---

## Components

- EventType
- Location (optional)
- City

- Components define subEvents and folder structure
- Each component must produce a valid folderName

---

## Folder Structure

Collection → Event → SubEvent → Photographer → VIDEO

- Structure must be derived from event.json only
- Must be deterministic and reproducible

---

## Editing

- Safe rename with validation
- No overwriting
- Legacy events handled separately

- Must update event.json before filesystem changes
- Must preserve mapping integrity

---

## Routing Relationship

- ImportRouter must use event.json for path generation
- No dynamic path logic outside event.json

---

## Validation

Before event creation or edit:

- all required components must exist
- generated folder names must be valid
- no duplicate subEvents allowed

If validation fails:
→ block operation

---

## Rules

- Single source of truth = event.json
- Folder names persisted
- No recomputation during import
- event.json defines all routing decisions
- UI must not alter structure independently
- Changes must pass validation before applying

---

## Contract Alignment

Violations map to:

- DATA → invalid event.json
- GROUP → invalid mappings
- ROUTING → invalid folder structure
- VALIDATION → incomplete configuration