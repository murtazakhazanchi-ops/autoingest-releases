'use strict';

function renderChangeReportMd(report) {
  const lines = [];
  lines.push(`# What Changed: ${report.from_ref} → ${report.to_ref}`);
  lines.push('');
  lines.push('> Generated artifact — advisory only. Does not authorize or apply any canonical documentation edit automatically.');
  lines.push('');
  lines.push(`**Range**: \`${report.from_ref}\` (${report.from_commit || 'unresolved'}) → \`${report.to_ref}\` (${report.to_commit || 'unresolved'})`);
  lines.push(`**Commits**: ${report.commits.length}`);
  lines.push(`**Files changed**: ${report.files_changed.length}`);
  lines.push('');

  lines.push('## Commits');
  lines.push('');
  if (!report.commits.length) {
    lines.push('None.');
  } else {
    for (const c of report.commits) lines.push(`- \`${c.short}\` (${c.date}) ${c.subject}`);
  }
  lines.push('');

  lines.push('## Affected features');
  lines.push('');
  lines.push(report.affected_features.length ? report.affected_features.join(', ') : 'None identified.');
  lines.push('');

  lines.push('## File impact (confidence-labeled)');
  lines.push('');
  lines.push(`explicit: ${report.confidence_notes.explicit}, inferred: ${report.confidence_notes.inferred}, unknown: ${report.confidence_notes.unknown}`);
  lines.push('');
  lines.push('| File | Confidence | Features |');
  lines.push('|---|---|---|');
  for (const fi of report.file_impacts) {
    lines.push(`| ${fi.file} | ${fi.confidence} | ${fi.features.join(', ') || '—'} |`);
  }
  lines.push('');

  lines.push('## docs/product/ changes');
  lines.push('');
  lines.push(`Product docs changed: ${report.product_docs_changed.length ? report.product_docs_changed.join(', ') : 'None'}`);
  lines.push(`Bugs changed: ${report.bugs_changed.length ? report.bugs_changed.join(', ') : 'None'}`);
  lines.push(`Decisions changed: ${report.decisions_changed.length ? report.decisions_changed.join(', ') : 'None'}`);
  lines.push(`Postmortems changed: ${report.postmortems_changed.length ? report.postmortems_changed.join(', ') : 'None'}`);
  lines.push(`Architectural evolution changed: ${report.architecture_evolution_changed}`);
  lines.push(`Roadmap changed: ${report.roadmap_changed}`);
  lines.push('');

  lines.push('## Other');
  lines.push('');
  lines.push(`Technical docs changed (docs/ outside docs/product/): ${report.technical_docs_changed.length ? report.technical_docs_changed.join(', ') : 'None'}`);
  lines.push(`Tests changed: ${report.tests_changed.length ? report.tests_changed.join(', ') : 'None'}`);
  lines.push('');

  lines.push('## Documentation update checklist');
  lines.push('');
  lines.push(report.documentation_update_checklist.length ? report.documentation_update_checklist.map((f) => `- [ ] ${f}`).join('\n') : 'None identified.');
  lines.push('');

  lines.push('## Unresolved follow-ups');
  lines.push('');
  lines.push(report.unresolved_follow_ups_note);
  lines.push('');

  return lines.join('\n') + '\n';
}

module.exports = { renderChangeReportMd };
