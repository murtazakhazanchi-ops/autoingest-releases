'use strict';

const parseProductDocs = require('./parseProductDocs');
const { buildSubsystems, buildSourceIndex } = require('./subsystems');
const { buildFeatureIndex } = require('./featureIndex');
const { buildAuthorityIndex } = require('./authorityTopics');
const { buildGraph } = require('./dependencyGraph');
const { buildSearchIndex } = require('./searchIndex');
const { buildRoadmapDashboard } = require('./roadmapDashboard');
const { buildFeatureTimeline } = require('./featureTimeline');
const { stableStringify } = require('./stableJson');
const gitInfo = require('./gitInfo');
const version = require('./version');
const { renderAuthorityIndexMd, renderSubsystemLocatorMd } = require('./renderIndexes');
const { renderDependencyGraphMd } = require('./renderGraph');
const { renderFeatureTimelineMd } = require('./renderTimeline');
const { renderRoadmapDashboardMd } = require('./renderDashboard');
const { compareIds } = require('./ids');
const { buildMemoryIndex } = require('./memoryIndex');
const { renderMemoryIndexMd, renderEngineeringMemoryTimelineMd } = require('./renderMemory');

// Assembles every Part 4 generated artifact in memory. Returns:
//   - `parsed`: the raw parsed docs/product/ structures (lib/parseProductDocs)
//   - `built`: derived intermediate structures shared by validate/query/impact
//   - `files`: Map<relPathUnderGenerated, content> — everything `build` writes
function assemble() {
  const parsed = parseProductDocs.loadAll();
  const subsystems = buildSubsystems(parsed);
  const sourceIndex = buildSourceIndex(subsystems);
  const featureIndex = buildFeatureIndex(parsed, sourceIndex);
  const authorityIndex = buildAuthorityIndex(parsed);
  const graph = buildGraph(parsed);
  const memoryIndex = buildMemoryIndex(parsed);
  const searchIndex = buildSearchIndex(parsed, featureIndex, subsystems, memoryIndex);
  const dashboard = buildRoadmapDashboard(parsed); // throws DashboardDisagreementError on real disagreement

  const timelines = [];
  for (const [id, feat] of parsed.features) {
    timelines.push(buildFeatureTimeline(id, feat, parsed));
  }
  timelines.sort((a, b) => compareIds(a.feature_id, b.feature_id));

  const built = { subsystems, sourceIndex, featureIndex, authorityIndex, graph, searchIndex, dashboard, timelines, memoryIndex };

  const files = new Map();

  files.set('feature-index.json', stableStringify({
    schema_version: version.SCHEMA_VERSION,
    docsys_version: version.DOCSYS_VERSION,
    features: featureIndex,
  }));
  files.set('feature-index.jsonl', featureIndex.map((r) => JSON.stringify(r)).join('\n') + '\n');
  files.set('search-index.jsonl', searchIndex.map((r) => JSON.stringify(r)).join('\n') + '\n');

  files.set('authority-index.json', stableStringify({
    schema_version: version.SCHEMA_VERSION,
    docsys_version: version.DOCSYS_VERSION,
    topics: authorityIndex,
  }));
  files.set('AUTHORITY_INDEX.md', renderAuthorityIndexMd(authorityIndex, version.DOCSYS_VERSION));

  files.set('subsystem-locator.json', stableStringify({
    schema_version: version.SCHEMA_VERSION,
    docsys_version: version.DOCSYS_VERSION,
    subsystems,
  }));
  files.set('SUBSYSTEM_LOCATOR.md', renderSubsystemLocatorMd(subsystems, sourceIndex));

  files.set('dependency-graph.json', stableStringify({
    schema_version: version.SCHEMA_VERSION,
    docsys_version: version.DOCSYS_VERSION,
    nodes: graph.nodes,
    edges: graph.edges,
  }));
  files.set('dependency-graph.md', renderDependencyGraphMd(graph, subsystems, parsed));

  for (const t of timelines) {
    files.set(`feature-timelines/${t.feature_id}_TIMELINE.md`, renderFeatureTimelineMd(t));
  }

  files.set('roadmap-dashboard.json', stableStringify({
    schema_version: version.SCHEMA_VERSION,
    docsys_version: version.DOCSYS_VERSION,
    ...dashboard,
  }));
  files.set('roadmap-dashboard.md', renderRoadmapDashboardMd(dashboard));

  files.set('memory-index.json', stableStringify({
    schema_version: version.SCHEMA_VERSION,
    docsys_version: version.DOCSYS_VERSION,
    memory: memoryIndex,
  }));
  files.set('memory-index.jsonl', memoryIndex.map((r) => JSON.stringify(r)).join('\n') + (memoryIndex.length ? '\n' : ''));
  files.set('MEMORY_INDEX.md', renderMemoryIndexMd(memoryIndex, version.DOCSYS_VERSION));
  files.set('ENGINEERING_MEMORY_TIMELINE.md', renderEngineeringMemoryTimelineMd(memoryIndex, version.DOCSYS_VERSION));

  const manifest = {
    docsys_version: version.DOCSYS_VERSION,
    schema_version: version.SCHEMA_VERSION,
    generator_version: version.GENERATOR_VERSION,
    source_commit: gitInfo.currentCommit(),
    generation_command: 'node scripts/product-docs/cli.js build',
    generated_files: Array.from(files.keys()).sort().concat(['manifest.json']),
    source_file_count: parsed.allFiles.length,
    entity_counts: {
      features: parsed.features.size,
      roadmap_milestones: parsed.roadmap.size,
      bugs: parsed.bugs.size,
      decisions: parsed.decisions.size,
      postmortems: parsed.postmortems.size,
      subsystems: subsystems.length,
      search_index_records: searchIndex.length,
      memory_capsules: memoryIndex.length,
    },
    relationship_counts: {
      dependency_graph_edges: graph.edges.length,
      dependency_graph_nodes: graph.nodes.length,
    },
  };
  files.set('manifest.json', stableStringify(manifest));

  return { parsed, built, files, manifest };
}

module.exports = { assemble };
