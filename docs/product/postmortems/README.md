# Postmortems — Significant Incident Records

Each file here is a postmortem: `PM-###_NAME.md`, following [../09_POSTMORTEM_TEMPLATE.md](../09_POSTMORTEM_TEMPLATE.md).

Reserved for significant incidents — data risk, a broken release, a major regression that reached real use. Routine bug fixes belong in [../bugs/](../bugs/) instead. See [../05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for when to create one.

## Index

| ID | Title | Severity | Date | Affected features |
|---|---|---|---|---|
| [PM-001](PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) | Metadata Correctness Gap Found in Production-Readiness Review | High | 2026-08-02 → 2026-08-04 | AI-FEAT-029, AI-FEAT-030, AI-FEAT-031, AI-FEAT-032, AI-FEAT-033, AI-FEAT-047 |
| [PM-002](PM-002_V0_9_11_FIRST_PUBLICATION_ATTEMPT_PRODUCED_AN_EMPTY_GITHUB_RELEASE.md) | v0.9.11 First Publication Attempt Produced an Empty GitHub Release | Medium | 2026-08-11 | AI-FEAT-006 |

PM-001 documents a real, evidenced cluster of metadata-correctness defects and their remediation — not the specific named institutional incident this documentation task was originally briefed to look for (no repository evidence of that named incident exists; see the record's own framing note). Two other postmortem candidates investigated during this pass (a Source Cleanup second-import failure; a general archive/transfer recovery incident) were found, on evidence, to be routine bug fixes rather than distinct incidents with their own timeline/impact/detection — they are documented as bug records instead (see [../bugs/](../bugs/)), not inflated into postmortems.
