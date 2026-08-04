# DEC-006 — RAW Files Use XMP Sidecars

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-029 |
| Status | Accepted |
| Date | Evidence pending exact date; part of AI-FEAT-029's foundational metadata design |
| Evidence status | Verified from code and docs (`docs/metadata-system.md` § RAW + Sidecar Rules, `test/rawXmpReadback.test.js`) |

## Context

RAW image formats generally cannot have arbitrary metadata tags written directly into the file the way JPEG/TIFF can without risking corruption or vendor-specific compatibility issues. AutoIngest still needs to attach the same Creator/Copyright/Keywords/Location/Hijri-date fields to RAW files as it does to direct-writable formats.

## Options Considered

Only the chosen direction is evidenced. Full alternatives-considered detail: **Evidence pending**.

1. **XMP sidecar files for RAW, direct write for JPEG/TIFF** — the option that was built.

## Decision

RAW formats get their metadata written to an XMP sidecar file placed beside the RAW file: created fresh if missing, merged in place (never deleted and recreated) if present (`docs/metadata-system.md` § RAW + Sidecar Rules). The sidecar filename matches the RAW filename with a `.xmp` extension. Pre-existing unrelated sidecar fields (e.g. `Rating`, `Instructions`) survive every write path, including repair specifically — proven by a dedicated repair-path regression test, not only the original import write path. Reading a RAW file's own embedded tags never shows sidecar-only content, and verification always reads the sidecar path it actually wrote to — proven by `test/rawXmpReadback.test.js`, not assumed.

## Consequences

- Any code path that copies, cleans up, or moves a RAW file must also handle its XMP sidecar as a paired unit — an operation that moves the RAW without its sidecar (or vice versa) breaks this contract.
- Future metadata fields must be added to the sidecar merge logic in a way that preserves unrelated pre-existing sidecar fields — a naive overwrite-the-sidecar approach would violate this decision.
- Forecloses direct/destructive RAW tag writing as a "simpler" alternative — this decision treats sidecar-based RAW metadata as a hard rule, not a fallback.

## Reconciliation Note

None recorded — matches `docs/metadata-system.md`'s current RAW + Sidecar Rules exactly.
