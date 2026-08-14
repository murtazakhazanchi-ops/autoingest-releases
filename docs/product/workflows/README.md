# Workflows — Operator Task Knowledge

Each file here is a `AI-WF-###_NAME.md` Workflow record, following [../19_WORKFLOW_TEMPLATE.md](../19_WORKFLOW_TEMPLATE.md). A Workflow answers **"how do I accomplish this task"** — distinct from a `features/AI-FEAT-###` record, which answers "what capability exists." See [docs/product/features/AI-FEAT-058_*.md](../features/AI-FEAT-058_AUTOINGEST_KNOWLEDGE_ENGINE_STAGE_1.md) § Stage 2 for the full architecture this supports.

This is a deliberately bounded, non-exhaustive set (Stage 2) covering the highest-value operator paths identified in the Stage 2 operator intent audit — not every intent in that audit has a Workflow yet. Every field either cites verified evidence or is marked `Not verified in this pass` / `Not located in this pass` — never invented.

## Index

| ID | Title | Domain | Navigation verified |
|---|---|---|---|
| [AI-WF-001](AI-WF-001_IMPORT_PHOTOGRAPHS_FROM_A_MEMORY_CARD_OR_FOLDER.md) | Import Photographs From a Memory Card or Folder | Import | Partial |
| [AI-WF-002](AI-WF-002_CREATE_A_NEW_EVENT.md) | Create a New Event | Events | Yes |
| [AI-WF-003](AI-WF-003_USE_QUICK_IMPORT_FOR_A_SMALL_BATCH.md) | Use Quick Import for a Small Batch | Import | Yes |
| [AI-WF-004](AI-WF-004_REPAIR_MISSING_OR_INCORRECT_METADATA.md) | Repair Missing or Incorrect Metadata | Metadata | Yes |
| [AI-WF-005](AI-WF-005_EXPORT_OR_UPDATE_A_TRANSFER_DRIVE.md) | Export or Update a Transfer Drive | Transfer & Backup | Yes |
| [AI-WF-006](AI-WF-006_SEE_WHO_ELSE_IS_ONLINE_AND_WHAT_THEYRE_WORKING_ON.md) | See Who Else Is Online and What They're Working On | Online Registry & Teamwork | Yes |
| [AI-WF-007](AI-WF-007_SORT_QMZ_PHOTOGRAPHS.md) | Sort QMZ Photographs | QMZ | Partial |
| [AI-WF-008](AI-WF-008_RECOVER_FROM_AN_ARCHIVE_LOCK_ERROR.md) | Recover From an Archive Lock Error | Archive Management | Yes |
| [AI-WF-009](AI-WF-009_IMPORT_OR_UPDATE_FROM_A_TRANSFER_DRIVE.md) | Import or Update From a Transfer Drive | Transfer & Backup | Yes |

## Not yet covered

Events (editing/finding an existing event), Application/Settings, Roadmap/Status routing (handled separately — see AI-FEAT-058 § Stage 2 roadmap routing, not a Workflow record), and most of the ~50 intents identified in the Stage 2 audit that didn't make this bounded set. Recorded as a knowledge gap, not silently absent — see AI-FEAT-058's Stage 2 section for the full list.

**Transfer Import is now covered** (AI-WF-009, added by the Part 2 Knowledge Architecture remediation, 2026-08-14) — previously the highest-ranked gap in this list (Part 2 Findings Report F8 #1). The Part 2 Findings Report's F8 ranking named 4 further specific high-value gaps that remain open, still unauthored, listed here per that report's own ranking so the disclosure stays current rather than reverting to a generic "~50 intents" catch-all:

1. **Source Cleanup** ("when is it safe to erase my card") — AI-FEAT-024, an 8-step validation with DEC-005-backed data-loss stakes, zero workflow coverage.
2. **Import interruption/recovery** — AI-WF-001 explicitly punts to AI-FEAT-021 directly today; a self-acknowledged gap in that workflow's own Troubleshooting section, not inferred here.
3. **Archive Folder Adoption** — AI-FEAT-046, moderate priority.
4. **Full live multi-operator event coordination** — lower priority; constituent pieces (AI-WF-001, AI-WF-006) already separately cover parts of it.

None of these 4 are authored by this pass — recorded as backlog per the Part 2 Consolidated Remediation Plan's Phase 8 ("not blocking, ongoing"), not silently dropped. See [10_CHANGELOG.md](../10_CHANGELOG.md) for the full Part 2 remediation record.
