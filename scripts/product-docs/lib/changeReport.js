'use strict';

const path = require('path');
const gitInfo = require('./gitInfo');

function resolveFileOwnership(filePath, sourceIndex) {
  const explicit = sourceIndex.byFile.get(filePath);
  if (explicit) return { confidence: 'explicit', subsystems: explicit };
  const dir = path.dirname(filePath);
  const inferred = sourceIndex.byDir.get(dir);
  if (inferred) return { confidence: 'inferred', subsystems: inferred };
  return { confidence: 'unknown', subsystems: [] };
}

function buildChangeReport(fromRef, toRef, parsed, subsystems, sourceIndex) {
  const commits = gitInfo.log(fromRef, toRef);
  const changedFiles = gitInfo.changedFiles(fromRef, toRef);

  const subsystemById = new Map(subsystems.map((s) => [s.id, s]));
  const fileImpacts = changedFiles.map((f) => {
    const { confidence, subsystems: subIds } = resolveFileOwnership(f, sourceIndex);
    const features = new Set();
    for (const sId of subIds) {
      const s = subsystemById.get(sId);
      if (s) for (const feat of s.primaryFeatures) features.add(feat);
    }
    return { file: f, confidence, subsystems: subIds, features: Array.from(features).sort() };
  });

  const productDocsChanged = changedFiles.filter((f) => f.startsWith('docs/product/') && !f.startsWith('docs/product/generated/'));
  const technicalDocsChanged = changedFiles.filter((f) => f.startsWith('docs/') && !f.startsWith('docs/product/'));
  const testsChanged = changedFiles.filter((f) => /^test\/.*\.test\.js$/.test(f));
  const bugsChanged = changedFiles.filter((f) => /^docs\/product\/bugs\/BUG-\d{3}/.test(f));
  const decisionsChanged = changedFiles.filter((f) => /^docs\/product\/decisions\/DEC-\d{3}/.test(f));
  const postmortemsChanged = changedFiles.filter((f) => /^docs\/product\/postmortems\/PM-\d{3}/.test(f));
  const archChanged = changedFiles.includes('docs/product/11_ARCHITECTURAL_EVOLUTION.md');
  const roadmapChanged = changedFiles.includes('docs/product/02_MASTER_ROADMAP.md');

  const affectedFeatures = new Set();
  for (const fi of fileImpacts) for (const feat of fi.features) affectedFeatures.add(feat);
  for (const f of productDocsChanged) {
    const m = /AI-FEAT-\d{3}/.exec(f);
    if (m) affectedFeatures.add(m[0]);
  }

  const docUpdateChecklist = Array.from(affectedFeatures).sort().map((featId) => {
    const feat = parsed.features.get(featId);
    return feat ? feat.filePath : featId;
  });

  return {
    from_ref: fromRef,
    to_ref: toRef,
    from_commit: gitInfo.refExists(fromRef) ? gitInfo.resolveCommit(fromRef) : null,
    to_commit: gitInfo.refExists(toRef) ? gitInfo.resolveCommit(toRef) : null,
    commits,
    files_changed: changedFiles,
    file_impacts: fileImpacts,
    product_docs_changed: productDocsChanged,
    technical_docs_changed: technicalDocsChanged,
    tests_changed: testsChanged,
    bugs_changed: bugsChanged,
    decisions_changed: decisionsChanged,
    postmortems_changed: postmortemsChanged,
    architecture_evolution_changed: archChanged,
    roadmap_changed: roadmapChanged,
    affected_features: Array.from(affectedFeatures).sort(),
    documentation_update_checklist: docUpdateChecklist,
    unresolved_follow_ups_note: 'Not computed by this tool — review the Future Enhancements section of each affected feature file listed above.',
    confidence_notes: {
      explicit: fileImpacts.filter((f) => f.confidence === 'explicit').length,
      inferred: fileImpacts.filter((f) => f.confidence === 'inferred').length,
      unknown: fileImpacts.filter((f) => f.confidence === 'unknown').length,
    },
  };
}

module.exports = { buildChangeReport, resolveFileOwnership };
