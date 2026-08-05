'use strict';

function renderFeatureTimelineMd(timeline) {
  const lines = [];
  lines.push(`# ${timeline.feature_id} — Timeline`);
  lines.push('');
  lines.push(`> Generated artifact — strictly extracted/reformatted from [${timeline.canonical_document}](../${timeline.canonical_document})'s own Evolution / Implementation Journal, header table, Known Bugs, and Decisions sections. No new facts. Regenerate with \`node scripts/product-docs/cli.js build\`.`);
  lines.push('');
  lines.push(`**Feature**: ${timeline.name}`);
  lines.push('');
  if (!timeline.entries.length) {
    lines.push(timeline.evidence_note);
    lines.push('');
    return lines.join('\n') + '\n';
  }
  lines.push('| Date | Event type | Summary | Related IDs | Confidence | Evidence source |');
  lines.push('|---|---|---|---|---|---|');
  for (const e of timeline.entries) {
    lines.push([
      e.date || 'Evidence pending',
      e.event_type,
      e.summary.replace(/\|/g, '\\|'),
      e.related_ids.join(', ') || '—',
      e.confidence,
      e.evidence_source,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  return lines.join('\n') + '\n';
}

module.exports = { renderFeatureTimelineMd };
