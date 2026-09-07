# BUG-020 — Orchestrator identity-claim validator false-positived on a plural bolded label, causing a reproducible long-conversation fallback cluster

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-058 |
| Status | Fixed |
| Severity | High |
| Discovered | 2026-09-06/07 (Stage 4.1 disclosed the symptom; Stage 4.2 root-caused and fixed it) |
| Fixed | 2026-09-07 |
| Evidence status | Verified directly from real-model transcripts (Stage 4.1 and 4.2 harness output) and the actual `services/qwenOrchestrator/answerValidator.js` source before and after the fix. |

## Symptom

Stage 4.1's real long-context qualification found an unexplained cluster of regenerations/fallbacks concentrated inside one 6-turn long conversation (`long-context-0`), based on indirect cumulative-diagnostic-counter evidence only (the harness at that point did not retain full per-turn detail). Stage 4.2 reconstructed the exact conversation 5 independent times, fresh session each time, with full per-attempt instrumentation, and found the pattern **perfectly, 100% reproducible**: turns 1, 2, and 6 (duplicate detection, archive locking, metadata durable queue) always answered cleanly with byte-identical text lengths every single run; turns 3, 4, and 5 (QMZ, transfer export, transfer import) always regenerated and then fell back to the safe generic "I don't have enough confirmed AutoIngest information" answer, also with byte-identical (80-character) fallback text every single run.

Critically, 5 newly-authored analogous long conversations (35 turns total, completely different subjects, same 7-turn structure, run in the same session immediately afterward) showed **zero** regenerations and **zero** fallbacks — ruling out a generic "answers degrade as conversation history grows" explanation. The context-token budget was also nowhere near its limit at the failing turns (per Stage 4.1's own original measurement: turn 3 sat at ~6,432 of 21,840 available tokens). The cause was specific to this exact topic sequence, not conversation length or budget pressure.

## Root Cause

A deep-dive re-run of the first 3 turns with full attempt logging captured the exact validator finding on turn 3 ("What is QMZ?"):

```
severity: HARD_SAFETY
code: ungrounded-identity-claim
detail: Answer names "File dates" as if it were a specific AutoIngest term, but this does not appear anywhere in the AutoIngest knowledge actually retrieved this conversation.
```

The model's real answer used `**File dates**` as an ordinary bolded bullet-point label (a formatting choice for readability — "**File dates** are read from the original embedded capture date... not the copy date on disk"), not a claimed AutoIngest-specific term. `checkUngroundedIdentityClaim` (`services/qwenOrchestrator/answerValidator.js`) extracts bolded spans and checks whether each one traces to retrieved evidence, with a partial-credit path for genuine paraphrase. Two compounding bugs in that partial-credit path caused the false positive:

1. The partial-credit path only activated when a bolded phrase reduced to **2 or more** distinctive (4+ character, non-generic) words after filtering. "File dates" reduces to exactly **one** such word — "file" is itself in the existing `GENERIC_MATCH_WORDS` exclusion list — so the phrase got no partial-credit opportunity at all and went straight to a hard failure.
2. Even if it had reached the matching step, the check does simple substring matching with no singular/plural normalization: the model wrote "dates" (plural); the real retrieved KM record's `behavior` dimension text uses "date"/"capture date" (singular) throughout, never the plural form verbatim. The substring check therefore failed even though the underlying fact was genuinely, correctly grounded.

The QMZ, transfer-export, and transfer-import answers each happened to include a short two-word bolded label with this same generic-word-plus-singular/plural-mismatch shape (confirmed for QMZ directly via the deep-dive; consistent with the identical failure signature on the other two turns), while the 5 analogous conversations' answers did not happen to produce a bolded label with this exact shape — explaining why the defect was perfectly reproducible for this specific sequence and completely silent elsewhere.

## Investigation Log

- 2026-09-06 (Stage 4.1) — Real long-context qualification observed `long-context-0`'s cumulative `regenerationCount`/`fallbackCount` rise by roughly 3 and 3 respectively across its own 6 turns, with two turns producing suspiciously short (80-character) answers, but the harness did not retain per-turn `regenerated`/`usedFallback`/full-text fields to confirm directly. Disclosed as an open, unresolved finding in DEC-026's Stage 4.1 Postscript.
- 2026-09-07 (Stage 4.2) — New harness (`electronQualificationHarnessStage42.js`) reconstructed the exact sequence 5x with full instrumentation: confirmed 3/6 regenerations+fallbacks every single run, on the identical 3 turns, with byte-identical output. 5 new analogous long conversations (35 turns) run immediately after showed zero such events, isolating the cause to this specific topic sequence rather than a generic long-context mechanism.
- A temporary, non-committed deep-dive script (wrapping `session._promptOnce` from outside — no production file touched for this step) re-ran turns 1–3 with full tool-call/validation-finding logging, capturing the exact `ungrounded-identity-claim` finding and its `"File dates"` detail text quoted above.
- Traced `checkUngroundedIdentityClaim`'s source directly: confirmed the `words.length >= 2` gate and the lack of singular/plural stemming as the precise, reproducible cause.

## Fix

`services/qwenOrchestrator/answerValidator.js`, `checkUngroundedIdentityClaim`:
- Lowered the partial-credit gate from `words.length >= 2` to `words.length >= 1`, so a single-distinctive-word bolded phrase gets the same proportional partial-credit opportunity (`Math.ceil(words.length / 2)` matches required) that a multi-word phrase already had, rather than an automatic hard failure.
- Added a simple trailing-`s` stem comparison (`retrievedText.includes(w) || retrievedText.includes(stem(w))`) so a legitimate singular/plural paraphrase of a real, retrieved word is recognized as grounded.

Both changes are general improvements to the existing "distinctive word" matching logic already in place — no per-topic special-casing, no mention of QMZ/transfer-export/transfer-import anywhere in the fix. A genuinely fabricated multi-word term with zero grounding is still correctly caught (confirmed by a new regression test using an invented two-word term with no matching evidence at all).

Regression tests added to `test/qwenOrchestratorPureModules.test.js`: one reproduces the exact real "File dates" false positive and confirms it no longer fires; one confirms a genuinely fabricated bolded term is still flagged.

**Re-verified against the real model**: the exact `long-context-0` sequence, reconstructed once more after the fix, now completes with **zero** regenerations and **zero** fallbacks across all 6 turns (down from 3/3 every time before the fix).

## Prevention / Reusable Lesson

A mechanical validator that does exact/near-exact substring matching against retrieved evidence needs explicit handling for ordinary English morphological variation (at minimum, singular/plural) — the model's own natural paraphrasing of a genuinely grounded fact should never be indistinguishable from a fabricated one. When a "distinctive word" gate excludes common words (like "file") to reduce noise, check what happens when that exclusion leaves zero or one word behind — a gate tuned for the "usual" multi-word case can silently produce a much stricter (or here, completely absent) check for the shorter case, which is exactly the shape that a natural, low-key bullet-point label tends to take.

## Related

- [BUG-019](BUG-019_ORCHESTRATOR_CAPABILITY_CLAIM_REGEX_MISSED_CONFIDENT_UNGROUNDED_ASSERTIONS.md) — the other Stage 4.2 finding (capability over-extrapolation), a different validator check, found and fixed in the same session.
- [DEC-026](../decisions/DEC-026_ASK_AUTOINGEST_STAGE_4_ONE_BRAIN_ORCHESTRATOR_ARCHITECTURE.md)'s Stage 4.1 Postscript (original disclosure) and Stage 4.2 Postscript (root cause, fix, re-verification).
