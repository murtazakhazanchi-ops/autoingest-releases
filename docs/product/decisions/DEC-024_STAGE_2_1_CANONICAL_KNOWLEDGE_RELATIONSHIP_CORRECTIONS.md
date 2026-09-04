# DEC-024 — Stage 2.1: Canonical Knowledge Relationship Corrections (Transfer Export/Import, QMZ, event.json Contract)

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-058 / AI-RM-011 |
| Status | Accepted |
| Date | 2026-09-04 |
| Evidence status | Verified from code (`scripts/product-docs/lib/knowledgeModel/records/*.js`), canonical Feature/Workflow documentation (`docs/product/features/AI-FEAT-038_TRANSFER_EXPORT.md`, `AI-FEAT-039_TRANSFER_IMPORT.md`), a cited Decision record (`DEC-011`), `docs/product/11_ARCHITECTURAL_EVOLUTION.md` §3E, and a corpus-wide same-class forensic scan run twice (before and after correction) |

## Context

Stage 2's own corpus audit found one genuine, pre-existing Knowledge Model contradiction (`KM-transfer-export`/`KM-transfer-import`, contradictory `precedesInWorkflow` edges) and one incomplete relationship (`KM-qmz-sequencing`, a `distinctFrom` edge with `targetId: null`), both reported but deliberately left uncorrected pending Product Owner review, per Stage 2's own scope discipline against silently editing Tier-1 hand-authored content. The Product Owner reviewed and approved Stage 2, then authorized this narrow Stage 2.1 data-maintenance step to close both issues from authoritative evidence before Stage 3 (the Qwen runtime) begins — explicitly not a new architecture experiment, not retrieval tuning, and not Stage 3 itself.

## Issue A — Transfer Export/Import ordering

**Forensic trace.** `KM-transfer-export`'s own `precedesInWorkflow` edge (`→ AI-FEAT-039`) reads: "Transfer Export writes to the Transfer Drive; Transfer Import later reads that drive into the Main Archive Root." `KM-transfer-import`'s own `precedesInWorkflow` edge (`→ AI-FEAT-038`) reads: "Reverse direction of the same physical Transfer Drive workflow — Import reads what Export wrote." Both notes **already agreed in substance** (Export happens first) — the defect was structural, not evidential: under this corpus's own established `direction: subject->object` convention (the edge is stored on the subject's own record, subject is the grammatical subject of the relation), Import's own edge literally asserted "Import precedes Export," the opposite of its own note.

**Authoritative evidence consulted:**
- `docs/product/features/AI-FEAT-038_TRANSFER_EXPORT.md` Summary: "Writes a clean, archive-aware mirror of selected events from the Active Archive Root to a Transfer Drive, **for physical transport to the Main Archive Root**."
- `docs/product/features/AI-FEAT-039_TRANSFER_IMPORT.md` Summary: "Imports content from a Transfer Drive into the Main Archive Root... **the receiving/consolidating counterpart to Transfer Export**."
- `docs/product/11_ARCHITECTURAL_EVOLUTION.md` §3E: "AutoIngest added Transfer Export and Transfer Import... to move content between a portable Active Archive Root and a permanent Main Archive Root via a physical transfer drive."
- This corpus's own established single-edge convention for `precedesInWorkflow` (confirmed via `AI-FEAT-019`→`AI-FEAT-026`: only the earlier-step record carries the edge; the later-step record carries a `relatedTo` back-reference, never an independent, potentially-inconsistent second `precedesInWorkflow` edge).

**Classification: A — Export precedes Import.** Every source agrees; there is no genuine ambiguity or conflict in the underlying facts, only in how one edge was structurally encoded.

**Correction:** `KM-transfer-import`'s edge changed from `type: 'precedesInWorkflow'` to `type: 'relatedTo'`, matching the corpus's own established convention. Its note is preserved in substance, lightly reworded to state plainly that the temporal fact is asserted once, on Export's own edge, and this is a non-directional back-reference to that same fact.

## Issue B — QMZ null relationship target

**Forensic trace.** `KM-qmz-sequencing`'s `distinctFrom` edge (`targetId: null`) reads: "Distinct from standard Event Import: QMZ has its own root (`qmzRoot`), durable state file, renderer namespace, and IPC surface — not a reuse of Import's equivalents. See DEC-011."

**Authoritative evidence consulted:**
- `DEC-011` (cited directly in the note): uses the parallel phrase "the generic single/multi-component Event Import model," and "Force QMZ's sequencing needs into the existing generic Event Import/grouping model."
- `KM-import-pipeline`'s own record (`AI-FEAT-019`) independently uses the term "full Event Import" in an identically-shaped `distinctFrom` comparison against Quick Import — the corpus's own established term for itself.
- The comparison points in the QMZ note (own root, durable state file, IPC surface) are backend-service-level, matching `AI-FEAT-019`'s nature as a real service (`main/fileManager.js`) — not `AI-FEAT-018`'s pure routing/derivation logic (no service footprint of its own) or `AI-WF-001`'s end-to-end operator workflow.
- A corpus-wide scan found **zero** other `distinctFrom` edges anywhere targeting a Workflow id — every one targets a Feature or Knowledge Model id, structurally ruling out `AI-WF-001`.

**Resolution: unambiguous.** The target is `AI-FEAT-019` (Import Pipeline & Copy Engine).

**Correction:** `KM-qmz-sequencing`'s edge `targetId` changed from `null` to `'AI-FEAT-019'`. Type (`distinctFrom`) and note text unchanged — only the missing reference was repaired.

## Same-class corpus-wide audit (Section 4)

A forensic script checked four defect classes exhaustively across all 66 Knowledge Model records (165 relationship edges): (1) same-type opposite-direction `precedesInWorkflow` edges, (2) edges with `targetId: null`, (3) edges whose `targetId` resolves to no real record, (4) bidirectional directional-type (`uses`/`writesTo`/`readsFrom`/`precedesInWorkflow`) pairs, manually reviewed for note-text/direction consistency.

**Additional defect found, same class as Issue A:** `KM-event-json-contract` (`AI-FEAT-004`) carried **three** relationship edges — `writesTo → KM-metadata-writing-engine`, `writesTo → KM-metadata-durable-queue`, `readsFrom → KM-metadata-audit-repair` — every one backwards for the identical structural reason as Issue A: each note's own text describes the *other* record writing into or reading from event.json, not the reverse, but the edge was stored on event.json's own record, asserting the opposite direction under this corpus's subject-first convention. Not previously reported by Stage 2 because it involves different types (`writesTo`/`readsFrom`, not `precedesInWorkflow`) and different-typed edges on each side (e.g. `uses` on one side, `writesTo` on the other), which Stage 2's own same-type CONFLICT check did not compare.

**Two candidate pairs reviewed and confirmed NOT defects** (both `uses`, both sides' notes genuinely agree on shared/mutually-embedded logic, consistent with Stage 2's own `DEC-023` finding for this exact class): `KM-import-pipeline`↔`KM-duplicate-detection`, `KM-metadata-durable-queue`↔`KM-metadata-audit-repair`.

**Correction:** all three `KM-event-json-contract` edges changed from `writesTo`/`readsFrom` to `relatedTo`, notes lightly reworded to state the correct direction explicitly rather than relying on a structurally-backwards edge. No new relationship was added — only existing, already-backwards edges were corrected, per the governing brief's explicit "do not add missing relationships merely because they might be useful."

## Decision

1. `KM-transfer-import`'s `precedesInWorkflow → AI-FEAT-038` edge corrected to `relatedTo`.
2. `KM-qmz-sequencing`'s `distinctFrom → null` edge corrected to `distinctFrom → AI-FEAT-019`.
3. `KM-event-json-contract`'s three `writesTo`/`readsFrom` edges corrected to `relatedTo`.
4. No other same-class defects exist in the corpus as of this correction (verified by re-running the same forensic scan after correction: zero temporal contradictions, zero null targets, zero unresolved targets, zero remaining inverse-directional inconsistencies).
5. Both defects predate Stage 2 and predate this entire "Ask AutoIngest — Production Implementation" track — they were authored during the original Candidate C Knowledge Model checkpoint (2026-08-25, commit `7ff5299`) and have existed, undetected, since before Stage 1 began. This is not hidden: Stage 2's own corpus audit found and disclosed two of the five corrected edges; the other three were found only by this stage's own broader same-class sweep.

## Consequences

- `check_relationship('AI-FEAT-038', 'AI-FEAT-039')` now returns `SUPPORTED` with a correct directional `precedesInWorkflow` meaning ("Transfer Export happens before Transfer Import"), not `CONFLICT`.
- `check_relationship('AI-FEAT-047', 'AI-FEAT-019')` now returns `CONTRADICTED` (QMZ documented as distinct from standard Event Import) instead of never resolving at all (the edge previously could not be looked up by target, since `targetId` was `null`).
- The Stage 2 corpus audit's own relationship-edge classification counts shift accordingly: directional edges 23→19 (the four corrected edges reclassify as generic/`relatedTo`), generic edges 120→124, symmetric unchanged at 22 (QMZ's edge stays `distinctFrom`, only its target was repaired) — total edge count unchanged at 165, since no edge was added or removed, only corrected.
- This correction changes zero retrieval behavior — relationship edges are not part of Stage 1's retrieval surface (BM25 documents do not include relationship data) — confirmed by rerunning `retrieval250`/holdout131 after correction (see the regression results this stage's own final report records).

## Reconciliation Note

None recorded — this decision resolves, rather than contradicts, the defects [DEC-023](DEC-023_ASK_AUTOINGEST_STAGE_2_DECISION_BACKED_KNOWLEDGE_AND_RELATIONSHIP_CONFLICT_POLICY.md) already found and disclosed.
