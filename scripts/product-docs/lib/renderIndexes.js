'use strict';

const { compareIds } = require('./ids');

function renderAuthorityIndexMd(authorityIndex, docsysVersion) {
  const lines = [];
  lines.push('# Authority Index');
  lines.push('');
  lines.push(`> Generated artifact — docsys version ${docsysVersion}. Locator only; canonical Markdown under docs/product/ and docs/ remains authoritative. Never edit this file by hand — regenerate with \`node scripts/product-docs/cli.js build\`.`);
  lines.push('');

  // Part 2 remediation — authority-index.json now carries two entry shapes
  // (recordType 'feature' / 'workflow'), rendered as two separate tables
  // rather than forced into one column set — a Workflow isn't "a capability
  // with aliases," it's an end-to-end journey exercising capabilities, and
  // giving it the Feature table's columns would silently imply otherwise.
  const featureEntries = authorityIndex.filter((e) => e.recordType !== 'workflow');
  const workflowEntries = authorityIndex.filter((e) => e.recordType === 'workflow');

  lines.push('## Capabilities (Features)');
  lines.push('');
  lines.push('| Topic | Aliases | AI-FEAT | Roadmap | Canonical product doc | Canonical technical docs | Confidence |');
  lines.push('|---|---|---|---|---|---|---|');
  const sortedFeatures = [...featureEntries].sort((a, b) => compareIds(a.featureId, b.featureId));
  for (const e of sortedFeatures) {
    lines.push([
      e.topic,
      e.aliases.join(', ') || '—',
      e.featureId,
      e.roadmapIds.join(', ') || '—',
      `[${e.canonicalProductDoc}](../${e.canonicalProductDoc})`,
      e.canonicalTechnicalDocs.join(', ') || '—',
      e.confidenceLevel,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');

  if (workflowEntries.length) {
    lines.push('## Operational Journeys (Workflows)');
    lines.push('');
    lines.push('| Topic | AI-WF | Exercises (Features) | Roadmap | Related workflows | Canonical product doc | Confidence |');
    lines.push('|---|---|---|---|---|---|---|');
    const sortedWorkflows = [...workflowEntries].sort((a, b) => compareIds(a.workflowId, b.workflowId));
    for (const e of sortedWorkflows) {
      lines.push([
        e.topic,
        e.workflowId,
        e.relatedFeatures.join(', ') || '—',
        e.roadmapIds.join(', ') || '—',
        e.relatedWorkflows.join(', ') || '—',
        `[${e.canonicalProductDoc}](../${e.canonicalProductDoc})`,
        e.confidenceLevel,
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

function renderSubsystemLocatorMd(subsystems, sourceIndex) {
  const lines = [];
  lines.push('# Subsystem Locator');
  lines.push('');
  lines.push('> Generated artifact — locator only. Regenerate with `node scripts/product-docs/cli.js build`. Shared ownership is represented explicitly: a source file or directory may appear under more than one subsystem.');
  lines.push('');
  for (const s of subsystems) {
    lines.push(`## ${s.name} (\`${s.id}\`)`);
    lines.push('');
    if (s.aliases.length) lines.push(`**Aliases**: ${s.aliases.join(', ')}`);
    lines.push(`**Primary features**: ${s.primaryFeatures.join(', ') || 'None'}`);
    lines.push(`**Canonical technical docs**: ${s.canonicalTechnicalDocs.join(', ') || 'None cited'}`);
    lines.push(`**Related bugs**: ${s.relatedBugs.join(', ') || 'None recorded'}`);
    lines.push(`**Related decisions**: ${s.relatedDecisions.join(', ') || 'None recorded'}`);
    lines.push('');
    lines.push('**Source directories**:');
    lines.push(s.sourceDirectories.length ? s.sourceDirectories.map((d) => `- \`${d}\``).join('\n') : '- None cited');
    lines.push('');
    lines.push('**Source files**:');
    lines.push(s.sourceFiles.length ? s.sourceFiles.map((f) => `- \`${f}\``).join('\n') : '- None cited');
    lines.push('');
    lines.push('**Change-impact checklist**:');
    lines.push(s.changeImpactChecklist.map((c) => `- ${c}`).join('\n'));
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

module.exports = { renderAuthorityIndexMd, renderSubsystemLocatorMd };
