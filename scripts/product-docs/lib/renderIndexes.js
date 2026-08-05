'use strict';

const { compareIds } = require('./ids');

function renderAuthorityIndexMd(authorityIndex, docsysVersion) {
  const lines = [];
  lines.push('# Authority Index');
  lines.push('');
  lines.push(`> Generated artifact — docsys version ${docsysVersion}. Locator only; canonical Markdown under docs/product/ and docs/ remains authoritative. Never edit this file by hand — regenerate with \`node scripts/product-docs/cli.js build\`.`);
  lines.push('');
  lines.push('| Topic | Aliases | AI-FEAT | Roadmap | Canonical product doc | Canonical technical docs | Confidence |');
  lines.push('|---|---|---|---|---|---|---|');
  const sorted = [...authorityIndex].sort((a, b) => compareIds(a.featureId, b.featureId));
  for (const e of sorted) {
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
