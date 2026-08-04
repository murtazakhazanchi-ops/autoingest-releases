# Feature Template

Copy this structure for every `docs/product/features/AI-FEAT-###_NAME.md` file. Delete this comment block when instantiating. Keep every section — write "Evidence pending — not yet documented as fact." rather than deleting a section that has nothing to report yet.

---

```markdown
# AI-FEAT-### — <Feature Name>

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-### |
| Category | <one of the categories in 01_FEATURE_REGISTRY.md> |
| Status | Implemented / Implemented — evolving / Partially implemented / In active development / Planned / Deferred / Deprecated / Superseded |
| Maturity | Foundational / Stable / Operational / Evolving / Experimental / Planned |
| Parent feature | AI-FEAT-### or None |
| Subfeatures | AI-FEAT-###, AI-FEAT-### or None |
| Dependencies | AI-FEAT-###, AI-FEAT-### or None |
| Related roadmap milestone | AI-RM-### or None |
| Related technical docs | docs/x.md, docs/y.md |
| Evidence status | Verified from current code / tests / docs / Git history / UI, or "Known from project history; repository evidence pending." |
| First-known implementation | <date, only if verified> or "Evidence pending" |
| Latest major update | <date, only if verified> or "Evidence pending" |

## Summary

One paragraph: what this feature does and why it exists.

## Current Behavior

What is true today, grounded in evidence. Cite files, functions, IPC channels, tests.

## Original Plan / Intent

What this was originally scoped to do, if known. If not known, write "Evidence pending — not yet documented as fact."

## Evolution / Implementation Journal

Append-only. Each entry: date (if known), what changed, why, evidence (commit/file/test). Never delete a prior entry; mark superseded approaches as such in place.

## Known Bugs / Troubleshooting

Links to `docs/product/bugs/*.md` entries relevant to this feature, or "None recorded."

## Decisions

Links to `docs/product/decisions/*.md` entries relevant to this feature, or "None recorded."

## Future Enhancements

Documented, evidence-grounded follow-up ideas — not speculative feature creep. If none, write "None recorded."

## Related Files

Concrete file paths in the codebase that implement this feature.
```
