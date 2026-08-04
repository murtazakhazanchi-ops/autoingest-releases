# DEC-009 — Copy Idempotency Must Not Suppress Metadata Repair

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-019, AI-FEAT-032 |
| Status | Accepted |
| Date | 2026-08-02 (commit `95af167`) |
| Evidence status | Verified from Git history and code (`main/metadataVerificationService.js`, `docs/metadata-system.md` § Import Path Coverage) |

## Context

The "same file → skip" copy-idempotency rule (see [DEC-005](DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md)) is correct and necessary for the copy decision — a same-size pre-existing destination file genuinely does not need to be copied again. But before this decision, that same skip was implicitly treated as meaning nothing further needed to happen for that file at all, including metadata — leaving same-size-skip files with metadata correctness that was never checked (see [BUG-009](../bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md)).

## Options Considered

1. **A copy skip implies no further processing needed** — the pre-existing implicit behavior. Rejected: directly evidenced as leaving same-size-skip files with unverified metadata.
2. **A copy skip is answered separately from a metadata-processing-needed question, with a dedicated post-hoc verification pass for copy-only paths** — the option that was built.

## Decision

"Do I need to copy this file?" and "does this file still need metadata verification or repair?" are two separate questions, answered separately. `main/metadataVerificationService.js` provides read-only, post-hoc verification for any file that lands via a copy-only path where the copy step itself never checked metadata — Transfer Import, Transfer Update, and Standard Import's same-size-skip. This verification runs regardless of whether the import's own copy batch had metadata enabled (`docs/metadata-system.md` § Import Path Coverage). Files awaiting this check land in the explicit `metadata-verification-required` state (AI-FEAT-031), not silently assumed complete.

## Consequences

- Any future copy-only or bypass path (a new import mode, a new sync mechanism) must be evaluated against this same question — "does landing via this path imply metadata was ever checked?" — and wired into verification if the answer is no.
- The nine-state metadata derivation (AI-FEAT-031) must keep `metadata-verification-required` as a distinct, non-`complete` state — collapsing it into `metadata-complete` for UI simplicity would silently reintroduce the false-completion risk this decision closed.
- Reinforces [DEC-005](DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md)'s copy-idempotency rule rather than conflicting with it — the copy decision itself is unchanged; only the assumption about what that decision implies for other subsystems was corrected.

## Reconciliation Note

None recorded — matches `docs/metadata-system.md`'s current § Import Path Coverage exactly.
