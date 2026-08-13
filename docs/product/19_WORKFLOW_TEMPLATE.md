# Workflow Record Template

Copy this structure for every `docs/product/workflows/AI-WF-###_NAME.md` file. A Workflow record answers **"how do I accomplish this task?"** — the question a `features/AI-FEAT-###` record structurally cannot answer, since a feature record's job is "what capability exists," not "what do I click." See [docs/product/features/AI-FEAT-058_*.md](features/AI-FEAT-058_AUTOINGEST_KNOWLEDGE_ENGINE_STAGE_1.md) § Stage 2 for the full rationale, and [DEC-020](decisions/) (Stage 2) for why Workflow is a separate record family rather than new fields bolted onto Capability.

**The single non-negotiable rule for this record family**: every field either cites verified evidence (real code, real UI text, a real canonical document) or is filled with the literal phrase `Not verified in this pass` / `Evidence pending`. Never invent a menu label, button text, keyboard shortcut, field name, folder name, or step order. If canonical docs and the actual runtime UI disagree, STOP and record the discrepancy in the Evidence status field — do not silently pick one.

---

```markdown
# AI-WF-### — <Task Name, in operator language>

| Field | Value |
|---|---|
| Workflow ID | AI-WF-### |
| Domain | <one of the operator-intent domains — see docs/product/features/AI-FEAT-058_*.md § Stage 2 Intent Map> |
| Related capabilities | AI-FEAT-###, AI-FEAT-### |
| Related roadmap milestone | AI-RM-### or None |
| Navigation verified | Yes / Partial / Not verified in this pass |
| Evidence status | Verified from current code (cite file/component) and/or onboarding UI text (cite exact source), or "Evidence pending" |

## What It Does

One or two sentences, drawn from the related capability's own summary — do not restate capability facts in a way that could drift from the Capability record's own wording.

## When To Use It

The real operator scenario that leads someone here.

## Before You Start

Prerequisites, if any are actually evidenced. Write "None identified" rather than inventing one.

## Where To Go

Exact, verified navigation only — quote real button/tab/menu labels with their source (e.g. "the `qi-title` element reads 'Quick Import', `renderer/index.html:7090`"). If no specific entry-point label was verified, write `Not verified in this pass` — never approximate.

## Steps

Ordered list. Each step must trace to a real source (onboarding screen text, a verified UI control, or an AI-FEAT record's Current Behavior section). Number them.

## What Happens Next / Expected Result

What an operator should observe when the workflow completes, if evidenced.

## Important Limitations

Real, evidenced limitations — reuse the related Capability record's own `knownLimitations`/Future Enhancements content rather than inventing new ones.

## Warnings

Anything an operator should know before proceeding, if evidenced (e.g. "no overwrite ever" from CLAUDE.md's File Copy Rules, if relevant to this workflow).

## Troubleshooting

Links to relevant `bugs/BUG-###` records or Troubleshooting Entries, or "None recorded."

## Related Actions

Other `AI-WF-###` workflows or `AI-FEAT-###` capabilities a reader would plausibly go to next.

## Source

Every file/component actually consulted while authoring this record.
```
