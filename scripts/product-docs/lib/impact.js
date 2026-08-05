'use strict';

const { resolveFileOwnership } = require('./changeReport');
const { compareIds } = require('./ids');

function findSubsystem(input, subsystems) {
  const q = input.toLowerCase();
  return subsystems.find((s) => s.id.toLowerCase() === q || s.name.toLowerCase() === q || s.aliases.some((a) => a.toLowerCase() === q));
}

function looksLikePath(input) {
  return input.includes('/') || /\.(js|ts|jsx|tsx|css|md|json)$/.test(input);
}

// Resolves `input` (a feature ID, roadmap ID, subsystem name/id, source path,
// or technical doc path) to a primary-ownership set, then expands to the
// full advisory impact-analysis report. Never authorizes code changes.
function buildImpactAnalysis(input, built, parsed) {
  const { featureIndex, subsystems, sourceIndex } = built;
  const featureById = new Map(featureIndex.map((f) => [f.feature_id, f]));
  let primaryFeatureIds = [];
  let resolutionMethod = 'unknown';
  let confidence = 'unknown';

  if (/^AI-FEAT-\d{3}$/i.test(input)) {
    const id = input.toUpperCase();
    if (featureById.has(id)) {
      primaryFeatureIds = [id];
      resolutionMethod = 'exact feature ID';
      confidence = 'explicit';
    }
  } else if (/^AI-RM-\d{3}$/i.test(input)) {
    const id = input.toUpperCase();
    const m = parsed.roadmap.get(id);
    if (m) {
      primaryFeatureIds = require('./ids').extractIds(String(m.header['Included AI-FEAT IDs'] || ''), 'feature');
      resolutionMethod = `roadmap milestone ${id} Included AI-FEAT IDs`;
      confidence = 'explicit';
    }
  } else {
    const subsystem = findSubsystem(input, subsystems);
    if (subsystem) {
      primaryFeatureIds = subsystem.primaryFeatures;
      resolutionMethod = `subsystem ${subsystem.id} (${subsystem.name})`;
      confidence = 'explicit';
    } else if (looksLikePath(input)) {
      const { confidence: ownershipConfidence, subsystems: subIds } = resolveFileOwnership(input, sourceIndex);
      const features = new Set();
      for (const subId of subIds) {
        const s = subsystems.find((x) => x.id === subId);
        if (s) for (const f of s.primaryFeatures) features.add(f);
      }
      primaryFeatureIds = Array.from(features).sort(compareIds);
      resolutionMethod = ownershipConfidence === 'explicit'
        ? `exact match in a feature's Related Files section`
        : ownershipConfidence === 'inferred'
          ? `directory containment within a subsystem's known source directories`
          : `no Related Files citation and no known subsystem directory contains this path`;
      confidence = ownershipConfidence;
    }
  }

  const primaryFeatures = primaryFeatureIds.map((id) => featureById.get(id)).filter(Boolean);

  const relatedFeatures = new Set();
  const dependencies = new Set();
  const dependents = new Set();
  const decisions = new Set();
  const bugs = new Set();
  const technicalDocs = new Set();
  const tests = new Set();
  const docChecklist = new Set();

  for (const f of primaryFeatures) {
    docChecklist.add(f.canonical_document);
    for (const x of f.related_features) relatedFeatures.add(x);
    for (const x of f.dependencies) dependencies.add(x);
    for (const x of f.dependents) dependents.add(x);
    for (const x of f.related_decisions) decisions.add(x);
    for (const x of f.related_bugs) bugs.add(x);
    for (const x of f.related_technical_docs) technicalDocs.add(x);
    for (const x of f.related_tests) tests.add(x);
    for (const rmId of f.roadmap_ids) docChecklist.add('docs/product/02_MASTER_ROADMAP.md');
  }
  for (const id of relatedFeatures) {
    const f = featureById.get(id);
    if (f) docChecklist.add(f.canonical_document);
  }

  const generatedArtifactsToRebuild = [
    'docs/product/generated/feature-index.json', 'docs/product/generated/feature-index.jsonl',
    'docs/product/generated/search-index.jsonl', 'docs/product/generated/dependency-graph.json',
    'docs/product/generated/dependency-graph.md',
  ];
  for (const id of primaryFeatureIds) generatedArtifactsToRebuild.push(`docs/product/generated/feature-timelines/${id}_TIMELINE.md`);

  return {
    input,
    resolution_method: resolutionMethod,
    confidence,
    primary_ownership: primaryFeatureIds,
    related_features: Array.from(relatedFeatures).sort(compareIds),
    dependencies: Array.from(dependencies).sort(compareIds),
    dependents: Array.from(dependents).sort(compareIds),
    decisions: Array.from(decisions).sort(compareIds),
    bugs: Array.from(bugs).sort(compareIds),
    required_technical_docs: Array.from(technicalDocs).sort(),
    tests: Array.from(tests).sort(),
    documentation_update_checklist: Array.from(docChecklist).sort(),
    generated_artifacts_to_rebuild: Array.from(new Set(generatedArtifactsToRebuild)).sort(),
    advisory_note: 'Advisory only — does not authorize any code or documentation change.',
  };
}

module.exports = { buildImpactAnalysis };
