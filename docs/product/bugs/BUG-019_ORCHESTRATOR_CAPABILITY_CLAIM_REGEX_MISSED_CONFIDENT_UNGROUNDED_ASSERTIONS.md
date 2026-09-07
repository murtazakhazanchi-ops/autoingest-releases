# BUG-019 — Orchestrator capability-claim regex missed confident, ungrounded assertions

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-058 |
| Status | Fixed (specific reproduced phrasing family); residual risk for other phrasings — see Prevention |
| Severity | High |
| Discovered | 2026-09-07 (Stage 4.2 real-model qualification) |
| Fixed | 2026-09-07 |
| Evidence status | Verified directly from real-model transcripts (Stage 4.2 harness output) and the actual `services/qwenOrchestrator/answerValidator.js` source before and after the fix. |

## Symptom

Asked genuine capability-boundary questions against the real Qwen3.5-4B orchestrator, the model sometimes asserted a specific, confident AutoIngest capability claim with **zero** grounding-tool evidence supporting it, and the mechanical answer validator (`checkCapabilityGrounding`) let it through as `validation.ok: true` with no findings — the claim reached the (simulated) operator unchallenged.

Two confirmed real instances:
1. **Cloud storage** (first surfaced in Stage 4.1, reproduced 5/5 identically in Stage 4.2): "AutoIngest does support importing from cloud storage, but only through its Transfer Drive mechanism... Transfer Drives can be configured to connect to cloud storage accounts." No tool result anywhere in the conversation supports the "connect to cloud storage accounts" claim.
2. **Linux platform support**: "AutoIngest runs natively on Linux... with Linux being a fully supported platform for all its core features and workflows." `search_autoingest` was called twice and returned zero relevant candidates (nothing about platform/OS support at all); no `capability_status`/`read_autoingest`/`roadmap_status` was ever called. The claim is flatly false — Linux support appears nowhere in the real feature registry.

## Root Cause

`checkCapabilityGrounding` (`services/qwenOrchestrator/answerValidator.js`) only fires when the final answer text matches `CAPABILITY_CLAIM_RE`. The original regex only recognized phrasings built around `AutoIngest supports/does/can/is available` or `X is supported/available/planned/implemented by/in/with AutoIngest`. Both real failing answers used different, equally natural phrasings — "AutoIngest runs natively on X", "AutoIngest is a fully supported platform" — that never matched any alternative in the regex, so the grounding check never ran at all, regardless of how little (or no) grounding evidence actually existed.

This is a coverage gap in the mechanical trigger condition, not a retrieval or model-reasoning defect — confirmed by the fact that once the regex was widened, the model's own drafting behavior on the same real questions was unchanged (the same first-draft overclaim was still produced), but the validator now correctly caught it, forced a bounded regeneration, and — since no better grounding was available to regenerate from — the session correctly fell back to a safe "I don't have enough confirmed AutoIngest information" answer instead of asserting the false claim.

## Investigation Log

- 2026-09-07 — Stage 4.2 harness (`electronQualificationHarnessStage42.js`) ran 5 fresh-session exact repeats of the cloud-storage question plus 20 newly-authored, individually-grounded capability-boundary questions across 10 categories (cloud/network, automated behavior, configuration, cross-feature, third-party, AI capability, archive/network, platform, export/import, roadmap-vs-current). 5/5 exact repeats produced byte-identical overclaim text — confirmed deterministic, not stochastic. The Linux question (`cap-platform-1`) and an Archive Analytics false-premise question (`cap-roadmap-2`, see Related) were the two additional confirmed failures among the 20.
- Deep-dive re-run with full per-attempt tool-call/validation-finding instrumentation (a temporary, non-committed script wrapping `session._promptOnce` from outside — no production code touched for this step) confirmed: the Linux answer's own `validation` object was `{ok: true, findings: []}` despite zero grounding tool calls, proving the trigger regex, not the grounding-tool bookkeeping, was the gap.
- Widened `CAPABILITY_CLAIM_RE` to also recognize "runs (natively) on", "works with/on", "is compatible with", and a standalone "fully/natively supported platform/feature/capability" phrasing, plus broadened the "supported ... AutoIngest" preposition list from `by/in/with` to also include `as/on`.
- Re-ran the exact cloud-storage question 5x, all 20 analogous questions, 20 previously-passing real Stage 4.1 questions, and the exact `long-context-0` reconstruction (51 real-model turns total) against the fixed code. Cloud-storage and Linux both now correctly trigger regeneration and a safe fallback instead of the overclaim reaching the answer. Zero new false refusals or new fabrication observed across the 20 previously-passing questions (one, unrelated to this fix, correctly still falls back — a genuine unsupported-capability question that has always fallen back).

## Fix

`services/qwenOrchestrator/answerValidator.js`, `CAPABILITY_CLAIM_RE`: widened to cover the additional phrasing family described above. No new logic, no per-topic special-casing (no mention of "cloud storage", "Transfer Drives", or "Linux" appears in the regex or its surrounding code) — purely a broader set of general capability-claim sentence shapes.

Also added, as a second, independent, general mitigation: a durable system-prompt principle (`services/qwenOrchestrator/systemPrompt.js`) instructing the model to keep confirmed fact separate from its own plausible inference, to check a specifically-named matching subject's own status directly rather than letting an adjacent result stand in for it, and to correct a question's false premise rather than silently answering around it. This did **not** demonstrably fix the one confirmed instance of the adjacent "evidence retrieved but not used to correct a premise" pattern (see BUG-020) in re-test, and is disclosed honestly as a good-faith general mitigation rather than a confirmed fix for that narrower pattern.

Regression tests added to `test/qwenOrchestratorPureModules.test.js`: one confirms the widened regex now flags the real Linux-claim phrasing; one confirms a "works with/is compatible with" phrasing is also caught; existing tests confirming a properly-grounded capability claim still passes cleanly were re-run unchanged.

## Prevention / Reusable Lesson

`CAPABILITY_CLAIM_RE`-style trigger regexes are a whack-a-mole risk by construction — a real-model qualification pass that authors deliberately varied natural phrasings (not just the phrasings the regex's own author anticipated) is the only reliable way to find gaps like this one. A **residual risk remains**: the fix closes the specific phrasing family demonstrated by the cloud-storage and Linux failures, but any other capability-adjacent claim shape not yet tested (e.g., a claim about how two features interact, phrased as a safety/behavior assertion rather than a support/availability assertion) could still evade the current regex. One such candidate (`cap-cross-1`, "will AutoIngest handle that safely?") was checked in this same session and found to be genuinely, thoroughly grounded (not a defect) — but that was a spot-check, not exhaustive coverage. A future qualification pass should specifically probe cross-feature-interaction and behavioral-safety phrasings for the same class of gap.

## Related

- [BUG-020](BUG-020_ORCHESTRATOR_IDENTITY_CLAIM_VALIDATOR_FALSE_POSITIVE_ON_PLURAL_LABEL.md) — the other Stage 4.2 finding (long-context fallback cluster), a different validator check, found and fixed in the same session.
- [DEC-026](../decisions/DEC-026_ASK_AUTOINGEST_STAGE_4_ONE_BRAIN_ORCHESTRATOR_ARCHITECTURE.md)'s Stage 4.2 Postscript — full qualification methodology, reproduction evidence, and re-verification results.
