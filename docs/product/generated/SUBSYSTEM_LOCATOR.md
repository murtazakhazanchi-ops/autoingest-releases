# Subsystem Locator

> Generated artifact — locator only. Regenerate with `node scripts/product-docs/cli.js build`. Shared ownership is represented explicitly: a source file or directory may appear under more than one subsystem.

## Application Platform (`SUBSYS-application-platform`)

**Aliases**: electron shell, security model, settings store, auto-update, telemetry
**Primary features**: AI-FEAT-001, AI-FEAT-002, AI-FEAT-003, AI-FEAT-004, AI-FEAT-005, AI-FEAT-006, AI-FEAT-007, AI-FEAT-057
**Canonical technical docs**: .github/workflows/release.yml, CLAUDE.md § Security Model, docs/README.md § Security Model, docs/data-model.md, docs/event-system.md, docs/features.md #7 "UI Dashboard", docs/history.md v0.8.1, docs/system-contracts.md §1-2, docs/ui-system.md § Dashboard, scripts/product-docs/README.md
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- `.github/workflows`
- `main`
- `renderer`
- `scripts/product-docs`
- `scripts/product-docs/automation`
- `scripts/product-docs/lib`
- `services`

**Source files**:
- `.github/workflows/release.yml`
- `main/eventJsonStore.js`
- `main/main.js`
- `main/preload.js`
- `main/userManager.js`
- `renderer/index.html`
- `renderer/renderer.js`
- `renderer/splash.html`
- `renderer/theme-init.js`
- `scripts/product-docs/automation/releaseIntelligence.js`
- `scripts/product-docs/cli.js`
- `scripts/product-docs/lib/updateChannelModel.js`
- `services/autoUpdater.js`
- `services/settings.js`
- `services/telemetry.js`

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Product UI (`SUBSYS-product-ui`)

**Aliases**: design system, ui consistency
**Primary features**: AI-FEAT-008
**Canonical technical docs**: docs/design-system.md, docs/ui-system.md
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- `renderer`

**Source files**:
- `renderer/index.html`

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Event Management (`SUBSYS-event-management`)

**Aliases**: event creation, event editing, event.json
**Primary features**: AI-FEAT-009, AI-FEAT-010
**Canonical technical docs**: #12, docs/event-system.md § Editing, docs/event-system.md § EventCreator, docs/failure-patterns.md #1, docs/features.md #4
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- `renderer`

**Source files**:
- `renderer/eventCreator.js`
- `renderer/eventMgmt.js`
- `renderer/folderNameHelper.js`
- `renderer/treeAutocomplete.js`

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Source Acquisition (`SUBSYS-source-acquisition`)

**Aliases**: source detection, source selection, memory card, external drive, dcim
**Primary features**: AI-FEAT-011, AI-FEAT-012
**Canonical technical docs**: docs/architecture.md § Drive Detection, docs/failure-patterns.md #16, docs/system-contracts.md §4
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- `main`
- `renderer`

**Source files**:
- `main/driveDetector.js`
- `main/fileBrowser.js`
- `renderer/renderer.js`

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Media Browsing (`SUBSYS-media-browsing`)

**Aliases**: file browser, thumbnail, media preview, media grid
**Primary features**: AI-FEAT-013, AI-FEAT-014, AI-FEAT-015, AI-FEAT-016
**Canonical technical docs**: docs/features.md #12, docs/features.md #13, docs/features.md #2, docs/ui-system.md § File Panel, docs/ui-system.md § Selection System
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- `main`
- `renderer`
- `services`

**Source files**:
- `main/fileBrowser.js`
- `main/rawPreviewService.js`
- `main/videoThumbService.js`
- `renderer/renderer.js`
- `services/thumbnailCache.js`

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Grouping and Routing (`SUBSYS-grouping-and-routing`)

**Aliases**: grouping, group manager, import routing
**Primary features**: AI-FEAT-017, AI-FEAT-018
**Canonical technical docs**: docs/event-system.md § Routing Relationship, docs/features.md #3, docs/group-manager.md, docs/ingestion-flow.md § Routing
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- `renderer`

**Source files**:
- `renderer/groupManager.js`
- `renderer/importRouter.js`

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Import and Archive Writing (`SUBSYS-import-and-archive-writing`)

**Aliases**: import pipeline, copy engine, duplicate detection, atomic import, photographer folder, quick import, source cleanup, checksum verification, audit integrity, activity log
**Primary features**: AI-FEAT-019, AI-FEAT-020, AI-FEAT-021, AI-FEAT-022, AI-FEAT-023, AI-FEAT-024, AI-FEAT-025, AI-FEAT-026, AI-FEAT-027, AI-FEAT-028
**Canonical technical docs**: CLAUDE.md § Transactional Ingest Layer, docs/data-model.md § Import Entry Schema, docs/failure-patterns.md #12, docs/failure-patterns.md #16, docs/features.md #10, docs/features.md #11, docs/features.md #5, docs/features.md #6, docs/features.md #8, docs/features.md #9, docs/ingestion-flow.md, docs/ingestion-flow.md § Duplicate Handling, docs/metadata-system.md § Non-Goals, docs/system-contracts.md §13, docs/system-contracts.md §4, docs/system-contracts.md §4-5
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- `main`
- `renderer`
- `services`

**Source files**:
- `main/eventJsonStore.js`
- `main/fileManager.js`
- `main/main.js`
- `renderer/renderer.js`
- `services/photographerSequenceService.js`

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Metadata (`SUBSYS-metadata`)

**Aliases**: metadata writing, exif, iptc, xmp, xmp sidecars, raw metadata, metadata queue, metadata audit, metadata repair, metadata audit repair, keyword registry, metadata reapply, metadata sync, metadata verification
**Primary features**: AI-FEAT-029, AI-FEAT-030, AI-FEAT-031, AI-FEAT-032, AI-FEAT-033, AI-FEAT-034, AI-FEAT-035, AI-FEAT-036, AI-FEAT-037
**Canonical technical docs**: docs/features.md #15, docs/metadata-system.md, docs/metadata-system.md § Durable Queue Storage and Recovery Behavior, docs/metadata-system.md § Event-Level Metadata State, docs/metadata-system.md § Import Path Coverage, docs/metadata-system.md § Metadata Audit, § Repair
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- `data`
- `main`
- `renderer`
- `services`
- `test`

**Source files**:
- `data/keywords.registry.json`
- `main/eventJsonStore.js`
- `main/exifService.js`
- `main/main.js`
- `main/metadataQueueRecovery.js`
- `main/metadataQueueStore.js`
- `main/metadataRepairService.js`
- `main/metadataStateService.js`
- `main/metadataSyncService.js`
- `main/metadataVerificationService.js`
- `renderer/index.html`
- `renderer/renderer.js`
- `services/metadataAuditExport.js`
- `services/metadataAuditService.js`
- `services/metadataExpectationService.js`
- `test/dashboardMetadataHealthCard.test.js`
- `test/metadataManagementModalUI.test.js`

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Transfer and Backup (`SUBSYS-transfer-and-backup`)

**Aliases**: transfer export, transfer import, backup update, transfer background
**Primary features**: AI-FEAT-038, AI-FEAT-039, AI-FEAT-040, AI-FEAT-041
**Canonical technical docs**: docs/archive-operations-layer.md § Transfer Workflow
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- `renderer`
- `services`
- `test`

**Source files**:
- `renderer/index.html`
- `services/transferExportService.js`
- `services/transferImportService.js`
- `test/transferImportOutcomeManifest.test.js`

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Archive Operations (`SUBSYS-archive-operations`)

**Aliases**: archive root, archive root resolution, archive health, local-first sync, stale locks, lock handling, archive folder adoption
**Primary features**: AI-FEAT-042, AI-FEAT-043, AI-FEAT-044, AI-FEAT-045, AI-FEAT-046
**Canonical technical docs**: 13D-2, 13D-4, 13D-5), docs/archive-adoption-contract.md, docs/archive-adoption-workflow.md, docs/archive-operations-layer.md § Direct Archive, docs/archive-operations-layer.md § Local First, docs/archive-operations-layer.md § Reporting Layer (Phases 13D-1, docs/archive-operations-layer.md § Three-Root Model, § Safety Guarantees
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- `services`

**Source files**:
- `services/adoptionDryRunService.js`
- `services/adoptionPreviewService.js`
- `services/adoptionWriteContract.js`
- `services/adoptionWriteService.js`
- `services/archiveConsistencyService.js`
- `services/archiveLockService.js`
- `services/archiveSyncService.js`
- `services/localSyncManifest.js`
- `services/nasEventCache.js`
- `services/offlineCollectionRegistryService.js`
- `services/settings.js`
- `services/syncQueueService.js`
- `services/syncReviewService.js`

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Special Workflows (`SUBSYS-special-workflows`)

**Aliases**: qmz, qmz sequencing
**Primary features**: AI-FEAT-047
**Canonical technical docs**: docs/metadata-system.md § Import Path Coverage
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- `main`
- `renderer`
- `test`

**Source files**:
- `main/qmzService.js`
- `renderer/renderer.js`
- `test/qmzLiveE2E.test.js`

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Collaboration and Realtime Coordination (`SUBSYS-collaboration-and-realtime-coordination`)

**Aliases**: realtime presence, team presence, online registry
**Primary features**: AI-FEAT-048
**Canonical technical docs**: realtime-server/README.md
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- `realtime-server/`
- `services`

**Source files**:
- `realtime-server/`
- `services/offlineCollectionRegistryService.js`
- `services/realtimeOperationsService.js`

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Planned Archive Management (`SUBSYS-planned-archive-management`)

**Aliases**: archive maintenance, event maintenance
**Primary features**: AI-FEAT-049, AI-FEAT-050, AI-FEAT-051, AI-FEAT-052
**Canonical technical docs**: None cited
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- None cited

**Source files**:
- None cited

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Search and Discovery (`SUBSYS-search-and-discovery`)

**Aliases**: global search
**Primary features**: AI-FEAT-053
**Canonical technical docs**: None cited
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- None cited

**Source files**:
- None cited

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Reliability and Recovery (`SUBSYS-reliability-and-recovery`)

**Aliases**: integrity verification
**Primary features**: AI-FEAT-054
**Canonical technical docs**: None cited
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- None cited

**Source files**:
- None cited

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Analytics and Intelligence (`SUBSYS-analytics-and-intelligence`)

**Aliases**: archive analytics, ai archive intelligence
**Primary features**: AI-FEAT-055, AI-FEAT-056
**Canonical technical docs**: None cited
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- None cited

**Source files**:
- None cited

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

## Knowledge & Onboarding (`SUBSYS-knowledge-onboarding`)

**Primary features**: AI-FEAT-058
**Canonical technical docs**: None cited
**Related bugs**: None recorded
**Related decisions**: None recorded

**Source directories**:
- `docs/product`
- `docs/product/decisions`
- `docs/product/generated`
- `docs/product/workflows`
- `scripts/product-docs`
- `scripts/product-docs/knowledge-portal`
- `scripts/product-docs/lib`
- `scripts/product-docs/test`

**Source files**:
- `docs/product/19_WORKFLOW_TEMPLATE.md`
- `docs/product/decisions/DEC-020_STAGE_2_KNOWLEDGE_ARCHITECTURE_WORKFLOW_RECORDS_AND_CONCEPT_LAYER.md`
- `docs/product/generated/knowledge-gap-report.json`
- `docs/product/generated/knowledge-index.json`
- `docs/product/generated/workflow-index.json`
- `docs/product/workflows/README.md`
- `scripts/product-docs/cli.js`
- `scripts/product-docs/knowledge-portal/index.html`
- `scripts/product-docs/knowledge-portal/server.js`
- `scripts/product-docs/lib/build.js`
- `scripts/product-docs/lib/ids.js`
- `scripts/product-docs/lib/intentConcepts.js`
- `scripts/product-docs/lib/knowledgeCli.js`
- `scripts/product-docs/lib/knowledgeEngine.js`
- `scripts/product-docs/lib/knowledgeEval.js`
- `scripts/product-docs/lib/knowledgeIndex.js`
- `scripts/product-docs/lib/knowledgeTestCorpus.js`
- `scripts/product-docs/lib/markdown.js`
- `scripts/product-docs/lib/parseProductDocs.js`
- `scripts/product-docs/lib/questionClassifier.js`
- `scripts/product-docs/lib/searchIndex.js`
- `scripts/product-docs/lib/statusResolution.js`
- `scripts/product-docs/lib/validators.js`
- `scripts/product-docs/lib/version.js`
- `scripts/product-docs/lib/workflowIndex.js`
- `scripts/product-docs/test/knowledge.test.js`

**Change-impact checklist**:
- Re-read the Related Files section of every primary feature listed above before changing shared source files.
- Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.
- Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.

