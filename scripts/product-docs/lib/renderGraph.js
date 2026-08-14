'use strict';

function mermaidId(id) {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

function mermaidLabel(text) {
  return String(text).replace(/"/g, "'").slice(0, 70);
}

const NODE_SHAPE = {
  feature: (id, label) => `${mermaidId(id)}["${mermaidLabel(id)}: ${mermaidLabel(label)}"]`,
  milestone: (id, label) => `${mermaidId(id)}(("${mermaidLabel(id)}: ${mermaidLabel(label)}"))`,
  bug: (id, label) => `${mermaidId(id)}{{"${mermaidLabel(id)}: ${mermaidLabel(label)}"}}`,
  decision: (id, label) => `${mermaidId(id)}[/"${mermaidLabel(id)}: ${mermaidLabel(label)}"/]`,
  postmortem: (id, label) => `${mermaidId(id)}[["${mermaidLabel(id)}: ${mermaidLabel(label)}"]]`,
  architecture_section: (id, label) => `${mermaidId(id)}>"${mermaidLabel(label)}"]`,
  // Part 2 remediation — a distinct shape from 'feature' so a rendered
  // diagram doesn't visually imply a Workflow is a capability.
  workflow: (id, label) => `${mermaidId(id)}(["${mermaidLabel(id)}: ${mermaidLabel(label)}"])`,
};

function renderMermaid(nodeIds, graph, title) {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const idSet = new Set(nodeIds);
  const lines = ['```mermaid', 'flowchart LR', `  %% ${title}`];
  for (const id of nodeIds) {
    const node = nodesById.get(id);
    if (!node) continue;
    const shapeFn = NODE_SHAPE[node.type] || NODE_SHAPE.feature;
    lines.push('  ' + shapeFn(id, node.label));
  }
  const edgesInView = graph.edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
  for (const e of edgesInView) {
    lines.push(`  ${mermaidId(e.source)} -->|${e.relationship}| ${mermaidId(e.target)}`);
  }
  lines.push('```');
  return { mermaid: lines.join('\n'), edgeCount: edgesInView.length };
}

function boundedView(title, nodeIds, graph) {
  const { mermaid, edgeCount } = renderMermaid(nodeIds, graph, title);
  return `### ${title}\n\n${nodeIds.length} node(s), ${edgeCount} edge(s) in this view.\n\n${mermaid}\n`;
}

function renderDependencyGraphMd(graph, subsystems, parsed) {
  const lines = [];
  lines.push('# Dependency Graph');
  lines.push('');
  lines.push('> Generated artifact — locator only. Regenerate with `node scripts/product-docs/cli.js build`. Full machine-readable graph: `dependency-graph.json`. Views below are deliberately bounded (one subsystem or milestone chain per diagram) rather than one unreadable graph of every node.');
  lines.push('');
  lines.push(`Total: ${graph.nodes.length} nodes, ${graph.edges.length} edges.`);
  lines.push('');

  // Roadmap milestone relationships
  const milestoneIds = Array.from(parsed.roadmap.keys());
  lines.push(boundedView('Roadmap milestone relationships', milestoneIds, graph));

  // Feature dependency overview: features that have at least one depends_on/extended_by edge to another feature
  const featureIds = new Set(graph.nodes.filter((n) => n.type === 'feature').map((n) => n.id));
  const connectedFeatureIds = new Set();
  for (const e of graph.edges) {
    if ((e.relationship === 'depends_on' || e.relationship === 'extended_by') && featureIds.has(e.source) && featureIds.has(e.target)) {
      connectedFeatureIds.add(e.source);
      connectedFeatureIds.add(e.target);
    }
  }
  lines.push(boundedView('Feature dependency overview (features with a depends_on/extended_by edge)', Array.from(connectedFeatureIds).sort(), graph));

  // Per-subsystem bounded views for the subsystems named in the Part 4 brief
  const namedSubsystems = [
    'Metadata', 'Import and Archive Writing', 'Transfer and Backup', 'Special Workflows', 'Archive Operations',
  ];
  for (const subName of namedSubsystems) {
    const s = subsystems.find((x) => x.name === subName);
    if (!s) continue;
    const nodeIds = Array.from(new Set([...s.primaryFeatures, ...s.relatedBugs, ...s.relatedDecisions]));
    lines.push(boundedView(`${subName} subsystem`, nodeIds, graph));
  }

  // Planned archive-management direction
  const planned = graph.nodes.filter((n) => n.type === 'feature' && /^AI-FEAT-(04[9]|05[0-6])$/.test(n.id)).map((n) => n.id);
  const plannedMilestones = graph.nodes.filter((n) => n.type === 'milestone' && n.id !== 'AI-RM-001').map((n) => n.id);
  lines.push(boundedView('Planned archive-management direction', [...planned, ...plannedMilestones], graph));

  return lines.join('\n') + '\n';
}

module.exports = { renderDependencyGraphMd, renderMermaid, mermaidId };
