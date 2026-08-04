# BUG-009 — Same-Size Skip Left Metadata Unverified

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-019, AI-FEAT-032 |
| Status | Fixed |
| Severity | Medium |
| Discovered | Evidence pending exact discovery date — fixed 2026-08-02 |
| Fixed | 2026-08-02 |
| Evidence status | Verified from Git history (commit `95af167`) and code (`main/metadataVerificationService.js` has no commits before `95af167`) |

## Symptom

When Standard Import's copy step legitimately skipped a file because a same-size destination already existed (the copy-idempotency "same file → skip" contract, `docs/system-contracts.md` §4), that file's metadata correctness was **never checked by anything**. The copy decision ("bytes already present, nothing to copy") was silently treated as equivalent to "nothing more needs to happen for this file" — including for metadata, which the copy step itself had never verified for a pre-existing file.

## Root Cause

Copy idempotency and downstream-processing eligibility were conflated: the same-size-skip logic answered "do I need to copy this file?" but nothing separately asked "does this file still need metadata verification or writing?" for files that took the skip path. `main/metadataVerificationService.js` — the component whose entire purpose is to answer that second question for copy-only paths — did not exist before the fix; `git log --follow` on that file shows its first commit is the fix itself.

## Investigation Log

- No separate "discovered, then later fixed" timeline is evidenced — the gap and its fix land in the same architectural commit alongside the durable metadata queue and Transfer Import verification work. `docs/product/features/AI-FEAT-032_METADATA_VERIFICATION.md`'s description of the current (fixed) behavior explicitly notes verification runs on same-size-skip files "regardless of whether this import's own copy batch had metadata enabled" — phrasing that only makes sense in contrast to a prior state where it did not.

## Fix

Commit `95af167` (2026-08-02) — "feat(metadata): add durable queue recovery and derived event states." Introduced `main/metadataVerificationService.js`: a dedicated, read-only, post-hoc verification pass for files that reach the archive outside the normal write path — used by both Transfer Import and Standard Import's same-size-skip. Files land in `metadata-verification-required` (with a "Verify Metadata" UI action) until this pass runs, rather than being silently assumed complete because the copy step skipped them.

## Prevention / Reusable Lesson

"No bytes need copying" and "no further processing needed for this file" are two separate questions with two separate answers — a copy-idempotency skip must never be silently read as a downstream-processing skip. Any feature that has a "skip because already present" path needs its own explicit statement of what, if anything, still needs to happen for a skipped item — do not assume a skip means "done." See [DEC-009](../decisions/DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md) for the decision this fix established.

## Related

- [AI-FEAT-019 — Import Pipeline & Copy Engine](../features/AI-FEAT-019_IMPORT_PIPELINE_COPY_ENGINE.md)
- [AI-FEAT-032 — Metadata Verification](../features/AI-FEAT-032_METADATA_VERIFICATION.md)
- [DEC-009 — Copy Idempotency Must Not Suppress Metadata Repair](../decisions/DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md)
- [BUG-010 — Metadata Batches Held Only In-Memory, Lost on Crash/Restart](BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md) (fixed in the same commit cluster)
