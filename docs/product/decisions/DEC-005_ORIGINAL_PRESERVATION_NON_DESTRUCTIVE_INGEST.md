# DEC-005 — Original Preservation and Non-Destructive Ingest

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-019, AI-FEAT-020, AI-FEAT-024, AI-FEAT-025 |
| Status | Accepted |
| Date | Foundational — "hard rule from the start" (`docs/product/11_ARCHITECTURAL_EVOLUTION.md` §3B) |
| Evidence status | Verified from code and docs (`docs/system-contracts.md` §4, `docs/CLAUDE.md` File Copy Rules) |

## Context

An archival ingestion system that deletes or silently loses source material on a bug, a crash, or a conflicting filename is unacceptable for institutional archival use — the cost of losing an original is far higher than the cost of extra disk usage or a slower operation.

## Options Considered

Only the chosen direction is evidenced. Full alternatives-considered detail: **Evidence pending**.

1. **No file overwrites, ever; conflicts rename; cleanup only after verified copy** — the option that was built and is enforced as a non-negotiable contract.

## Decision

No file is ever overwritten (`docs/CLAUDE.md`: "No overwrite ever"). Same file → skip. Conflict → rename with a `_1`/`_2` suffix. All ingestion operations must be idempotent — the same input always produces the same output (`docs/system-contracts.md` §4, §10). Source-file cleanup (AI-FEAT-024) is gated by a strict 8-step validation order that must never delete a file that wasn't verifiably and completely copied — `copyVerified` is set only after `verifyFile()` passes during the copy phase, and a size mismatch on an unverified entry blocks deletion (`docs/system-contracts.md` §4). Checksum-based verification (AI-FEAT-025) provides an additional, independent confirmation layer beyond size comparison.

## Consequences

- Any new import or transfer path must inherit this contract by construction — no feature may introduce its own overwrite-capable write path without this decision being explicitly revisited.
- Cleanup/deletion of any kind must always be gated on independently-verified copy success, never on "the copy operation reported success" alone (see [BUG-001](../bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md) for a case where the *state used to decide cleanup eligibility* — not the underlying safety rule itself — had a bug).
- Forecloses any future "fast path" that skips verification to save time, unless a new decision explicitly and narrowly re-scopes this contract.

## Reconciliation Note

None recorded — this decision matches `docs/system-contracts.md` §4 and `docs/CLAUDE.md`'s File Copy Rules exactly, with no known divergence.
