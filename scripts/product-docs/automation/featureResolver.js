'use strict';

// Resolves a packet's affected_files into feature/roadmap/subsystem
// ownership, using ONLY Part 4's existing evidence-grounded resolution
// (scripts/product-docs/lib/changeReport.js's resolveFileOwnership and
// lib/impact.js's buildImpactAnalysis) — never a new blind string-match.
// Per the brief: "Do not perform broad blind string matching when explicit
// mappings exist." A path that resolves to nothing stays `unknown`.

const { resolveFileOwnership } = require('../lib/changeReport');
const { buildImpactAnalysis } = require('../lib/impact');
const { compareIds, extractIds } = require('../lib/ids');

// Per-file ownership resolution, deduplicated and confidence-labeled.
function resolveFiles(affectedFiles, built) {
  const { subsystems, sourceIndex } = built;
  const subsystemById = new Map(subsystems.map((s) => [s.id, s]));
  return affectedFiles.map((file) => {
    const { confidence, subsystems: subIds } = resolveFileOwnership(file, sourceIndex);
    const features = new Set();
    for (const subId of subIds) {
      const s = subsystemById.get(subId);
      if (s) for (const f of s.primaryFeatures) features.add(f);
    }
    return { file, confidence, subsystems: subIds, features: Array.from(features).sort(compareIds) };
  });
}

// Aggregates per-file resolution into the packet-level fields: primary
// feature owner(s), secondary/related features, dependent features,
// governing decisions/bugs, required technical docs, and an overall
// confidence for the whole change set (the weakest confidence among files
// that resolved to *something* — a change touching one explicit file and
// one unknown file is reported as "inferred" overall, not silently
// upgraded to "explicit").
function resolveFeaturesForPacket(affectedFiles, built, parsed) {
  const fileResolutions = resolveFiles(affectedFiles, built);
  const primaryFeatureIds = new Set();
  const relatedFeatureIds = new Set();
  const dependencyIds = new Set();
  const dependentIds = new Set();
  const decisionIds = new Set();
  const bugIds = new Set();
  const technicalDocs = new Set();
  const roadmapIds = new Set();
  const subsystemNames = new Set();
  const unknownFiles = [];

  // First pass: collect every distinct feature ID touched across all files.
  // buildImpactAnalysis rebuilds an O(feature-count) Map internally on each
  // call (scripts/product-docs/lib/impact.js), so calling it once per FILE
  // rather than once per unique FEATURE (a large commit can touch many
  // files owned by the same handful of features) is wasted work at scale —
  // performance review finding. Deduping first makes this O(files +
  // unique-features) instead of O(files × feature-count).
  for (const res of fileResolutions) {
    if (res.confidence === 'unknown') {
      unknownFiles.push(res.file);
      continue;
    }
    for (const subId of res.subsystems) subsystemNames.add(subId);
    for (const featId of res.features) primaryFeatureIds.add(featId);
  }

  for (const featId of primaryFeatureIds) {
    const impact = buildImpactAnalysis(featId, built, parsed);
    for (const x of impact.related_features) relatedFeatureIds.add(x);
    for (const x of impact.dependencies) dependencyIds.add(x);
    for (const x of impact.dependents) dependentIds.add(x);
    for (const x of impact.decisions) decisionIds.add(x);
    for (const x of impact.bugs) bugIds.add(x);
    for (const x of impact.required_technical_docs) technicalDocs.add(x);
    const feat = parsed.features.get(featId);
    if (feat) {
      for (const rm of extractIds(String(feat.header['Related roadmap milestone'] || ''), 'roadmap')) {
        roadmapIds.add(rm);
      }
    }
  }

  const resolvedCount = fileResolutions.length - unknownFiles.length;
  let overallConfidence;
  if (affectedFiles.length === 0) overallConfidence = 'unknown';
  else if (unknownFiles.length === 0 && fileResolutions.every((r) => r.confidence === 'explicit')) overallConfidence = 'explicit';
  else if (resolvedCount === 0) overallConfidence = 'unknown';
  else if (fileResolutions.some((r) => r.confidence === 'explicit')) overallConfidence = 'strong';
  else overallConfidence = 'inferred';

  return {
    file_resolutions: fileResolutions,
    primary_feature_ids: Array.from(primaryFeatureIds).sort(compareIds),
    related_feature_ids: Array.from(relatedFeatureIds).sort(compareIds),
    dependency_ids: Array.from(dependencyIds).sort(compareIds),
    dependent_ids: Array.from(dependentIds).sort(compareIds),
    governing_decision_ids: Array.from(decisionIds).sort(compareIds),
    related_bug_ids: Array.from(bugIds).sort(compareIds),
    required_technical_docs: Array.from(technicalDocs).sort(),
    affected_roadmap_ids: Array.from(roadmapIds).sort(compareIds),
    affected_subsystems: Array.from(subsystemNames).sort(),
    unknown_files: unknownFiles,
    confidence: overallConfidence,
  };
}

module.exports = { resolveFiles, resolveFeaturesForPacket };
