# AI-FEAT-026 — Audit Integrity Verification (Count-Based)

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-026 |
| Category | Import and Archive Writing |
| Status | Implemented |
| Maturity | Operational |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-027 (surfaced inside the Activity Log), AI-FEAT-019 (distinct, automatic sibling layer — see Current Behavior's three-layer note) |
| Related roadmap milestone | None |
| Related technical docs | `docs/features.md` #10 |
| Evidence status | Verified from `docs/features.md` (already fully read as required context) and confirmed distinct from AI-FEAT-025 by direct code reading |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-025](AI-FEAT-025_CHECKSUM_BASED_FILE_VERIFICATION.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Evidence pending — this feature's related files are shared, multi-feature modules (e.g. `main/main.js`, `renderer/renderer.js`); automated basename matching against test/ is unreliable for these and was not attempted |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

On-demand "Verify Integrity" button in the Activity Log. Compares the expected media count from `imports[].counts` totals against the actual files found on disk — **pure file-count comparison, no hashing at all**. Named "(Count-Based)" specifically to disambiguate from AI-FEAT-025's hash-based Checksum Verification. **Why this exists**: a fast, lightweight, operator-triggered completeness check ("are all expected files present?") distinct from AI-FEAT-025's deeper, slower content-level verification ("are these files byte-identical?") — the two serve different assurance needs at different costs, forming one of three distinct integrity layers alongside AI-FEAT-019's own per-file copy-time validation (see the three-layer note below).

## Current Behavior

Recursive folder walk (depth ≤ 8) counting files by extension; no minimum size filter. Result shown inline: green (match), amber (mismatch with delta), or error (unreadable). Non-blocking: no auto-scan, no renderer blocking.

**This audit is manual-only — confirmed, not automatic** (forensic code verification, 2026-08-14): `audit:verifyEvent` (`main/main.js`) is explicitly commented "read-only, on-demand," with exactly one call site — the "Verify Integrity" button's click handler in the Activity Log modal (`_runAlVerify()`, `renderer/renderer.js`). There is no automatic post-import count reconciliation anywhere in the codebase. A product-owner recollection during the Purpose Capture interview (2026-08-14) that count verification is "already integrated into the import workflow" and "flagged automatically" was investigated and found to describe a **different, genuinely automatic mechanism** belonging to AI-FEAT-019 (the import pipeline's own always-on per-file size check inside `copyFiles()`, plus automatic telemetry firing when copy errors occur — see AI-FEAT-019's Current Behavior) — not this feature. The product owner reviewed this finding and confirmed the current manual-only design should be **retained**, not made automatic to match the earlier recollection.

**Three integrity layers, not to be conflated** (see AI-FEAT-019 and AI-FEAT-025 for the other two):

```
Normal Import Validation (AI-FEAT-019)  — automatic, per-file, during every copy
        ↓
Lightweight Count Audit (this feature)  — operator-triggered, on demand
        ↓
SHA-256 Content Verification (AI-FEAT-025) — operator-triggered, on demand, deeper
```

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries found in this pass beyond the 2026-08-14 entry below.

- **2026-08-14 — Purpose captured; manual-only design confirmed and retained.** A Product-Owner Purpose Capture interview surfaced an apparent contradiction between the product owner's recollection (automatic post-import flagging) and this file's documented manual-only behavior. Forensic code verification confirmed the manual-only behavior is accurate, and that the product owner's recollection describes AI-FEAT-019's separate, genuinely-automatic per-file validation instead. The product owner reviewed this finding and decided to retain the current manual-only design rather than add automatic reconciliation merely to match the original recollection. No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- Renderer Activity Log module (`renderer/renderer.js`)
