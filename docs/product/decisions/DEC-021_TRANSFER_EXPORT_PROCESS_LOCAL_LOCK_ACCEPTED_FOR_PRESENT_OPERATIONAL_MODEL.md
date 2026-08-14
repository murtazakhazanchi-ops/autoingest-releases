# DEC-021 — Transfer Export Process-Local Lock Accepted for Present Operational Model

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-038 (Transfer Export), AI-FEAT-039 (Transfer Import), AI-FEAT-045 (Archive Lock Handling & Stale-Lock Recovery) |
| Status | Accepted |
| Date | 2026-08-14 |
| Evidence status | Verified from current code (forensic investigation, this pass) + product-owner decision recorded during the Product-Owner Purpose Capture interview |

## Context

A Knowledge Purpose Audit forensic check established that Transfer Export's "single-export-at-a-time" concurrency guard (`_state.running`, `services/transferExportService.js`) is an **in-memory, process-local flag** — it prevents two Export operations from overlapping within one running app instance, but shares no mechanism with AI-FEAT-045's `archiveLockService.js` (a durable, SHA1-keyed, TTL+heartbeat lock scoped to event/photographer editing). Two independent AutoIngest instances on two different machines could, in principle, run Transfer Export against the same physical destination simultaneously without this guard preventing it. AI-FEAT-038's own canonical file had flagged this relationship as *unconfirmed* prior to this investigation; the forensic check resolved the "unconfirmed" status to a confirmed answer, which then required a product-owner decision on whether the resulting gap was acceptable.

## Options Considered

1. **Build durable, destination-level cross-device locking now** — would close the gap immediately but is new implementation work outside the scope of a documentation-canonicalization pass, and addresses a scenario the product owner assessed as low-likelihood under the current operational model.
2. **Accept the current process-local behavior for the present operational model, document it truthfully, and record distributed locking as a future reliability enhancement** — no code change required; matches how the team actually assigns transfer destinations today.

## Decision

Option 2. The product owner's stated rationale: the normal workflow assigns a transfer/backup destination to one dedicated ingester/device at a time, making simultaneous Transfer Export operations from multiple AutoIngest machines against the same physical destination a low-likelihood scenario under present operation. The current process-local guard is accepted as sufficient for this operational model. The absence of a cross-device/durable destination lock does **not** block AI-FEAT-038/039 purpose canonicalization.

## Consequences

- Canonical documentation for AI-FEAT-038 must describe the concurrency guard accurately as process-local, not durable/cross-device, and must not imply that distributed locking currently exists.
- The current one-operator-per-destination operational assumption is now an explicit, documented precondition for AI-FEAT-038/039's safety properties — it is a real-world operating procedure the system currently depends on, not a system-enforced guarantee.
- Durable destination-level / cross-device locking is recorded as a future reliability enhancement (see AI-FEAT-038's Future Enhancements section) — not scheduled, not implemented as part of this pass.
- If the operational model changes (e.g., multiple ingesters routinely sharing a transfer destination unsupervised), this decision should be revisited.

## Reconciliation Note

None — this decision does not conflict with any authoritative technical doc under `docs/`; it resolves a previously-unconfirmed relationship between two `docs/product/` records (AI-FEAT-038 and AI-FEAT-045) in favor of the code's actual, now-verified behavior.
