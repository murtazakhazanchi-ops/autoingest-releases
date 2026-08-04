# Postmortem Template

Copy this structure for every `docs/product/postmortems/PM-###_NAME.md` file. Reserve this for significant incidents (data risk, broken release, major regression) — routine bug fixes belong in `docs/product/bugs/` instead.

---

```markdown
# PM-### — <Short Name>

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-### |
| Severity | Critical / High / Medium |
| Date of incident | <date> |
| Date resolved | <date> |
| Evidence status | Verified from Git history / code / tests, or "Known from project history; repository evidence pending." |

## Summary

One paragraph: what happened, in plain terms.

## Impact

What was actually affected — data, users, workflow, release. Be precise; do not overstate or understate.

## Timeline

Append-only chronological log: detection, investigation, mitigation, resolution.

## Root Cause

The underlying cause, not just the trigger.

## Resolution

What was actually done to fix it.

## Follow-up Actions

Concrete, evidence-grounded prevention work — link to the `AI-FEAT-###` or new roadmap item if follow-up work was scoped. If none, write "None recorded."

## Related

Links to related bugs, decisions, or the feature file(s) affected.
```
