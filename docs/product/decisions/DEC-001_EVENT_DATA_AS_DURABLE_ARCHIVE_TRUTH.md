# DEC-001 — Event Data as Durable Archive Truth

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-004 |
| Status | Accepted |
| Date | v0.7.x (foundational; introduced with `event.json` itself, per `docs/history.md`) |
| Evidence status | Verified from code and docs (`docs/CLAUDE.md`, `docs/data-model.md`, `docs/system-contracts.md` §1-2) |

## Context

An archival ingestion system needs one place that authoritatively answers "what is true about this event" — structure, sub-events, group mappings, ingestion history, metadata state. Without a single authoritative record, the UI, the filesystem, and any in-memory state could each drift into their own version of "current," with no way to know which is correct.

## Options Considered

Only the chosen direction is evidenced in the repository. No alternative data-ownership model (e.g. a database of record, or UI-state-as-truth) appears anywhere in code, tests, or docs — full alternatives-considered detail is **Evidence pending**.

1. **`event.json` as the single source of truth, UI as pure reflection** — the option that was built and is universally enforced.

## Decision

`event.json` is the single, authoritative representation of event structure, sub-events, group mappings, and ingestion state for every AutoIngest event (`docs/CLAUDE.md`: "event.json is the single source of truth"). All system behavior — UI, routing, metadata, archive operations — derives from it. The UI is a pure reflection layer: it "must never diverge from backend state" and "must not maintain independent or derived state" (`docs/CLAUDE.md`). Writes are atomic, crash-safe, and idempotently reconciled (`docs/data-model.md`); the only sanctioned read-modify-write path is `main/eventJsonStore.js`'s `updateEventJsonAtomic` (`docs/metadata-system.md`) — no writer performs an independent read-modify-write of the file.

## Consequences

- Every feature that needs to persist event-level state (metadata's `metadataState` block, QMZ's sequence state, sync's `event.sync.json` manifest) must write through the same sanctioned path, not invent its own writer.
- Unknown or audit-owned fields (e.g. `adoption`, `status`) must be explicitly preserved by every write path that touches the file — a write path that reconstructs its payload from a hardcoded field list rather than spreading the existing document will silently destroy anything not on that list. This was learned the hard way twice (see [BUG-006](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md)).
- New fields must be added in a backward-compatible way — older `event.json` entries without the field must remain valid (`docs/data-model.md`'s `source`/`importedBy` optional-field pattern is the concrete precedent).
- Forecloses any design where the UI, a cache, or a derived in-memory structure is ever treated as authoritative over `event.json` — any such divergence is a contract violation by definition (`docs/system-contracts.md` §2, §6).

## Reconciliation Note

None recorded — this decision has never conflicted with an authoritative technical doc; it *is* the technical contract those docs describe (`docs/system-contracts.md` §1-2, `docs/data-model.md`, `docs/event-system.md`).
