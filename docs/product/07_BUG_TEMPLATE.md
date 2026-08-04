# Bug Record Template

Copy this structure for every `docs/product/bugs/BUG-###_NAME.md` file. Bug records capture reusable troubleshooting knowledge — not every fixed typo needs one. Use this for bugs whose root cause, symptom, or fix pattern would help diagnose a future issue faster.

---

```markdown
# BUG-### — <Short Name>

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-###, AI-FEAT-### |
| Status | Open / Investigating / Fixed / Won't Fix / Duplicate of BUG-### |
| Severity | Critical / High / Medium / Low |
| Discovered | <date> |
| Fixed | <date, or "Not yet fixed"> |
| Evidence status | Verified from Git history / code / tests, or "Known from project history; repository evidence pending." |

## Symptom

What was observed, in concrete terms (error message, wrong output, crash).

## Root Cause

What actually caused it, once known. If still investigating, write "Investigating — see Investigation Log."

## Investigation Log

Append-only. Each entry: date, what was checked, what was ruled out, what was found.

## Fix

What changed, and where (file/function/commit). If unfixed, write "Not yet fixed."

## Prevention / Reusable Lesson

What should a future agent or engineer check first if something similar happens again? Link to `docs/failure-patterns.md` if this pattern was (or should be) added there — bug records here capture project-history narrative; `docs/failure-patterns.md` remains the authoritative technical symptom→cause map.

## Related

Links to related bugs, decisions, or postmortems.
```
