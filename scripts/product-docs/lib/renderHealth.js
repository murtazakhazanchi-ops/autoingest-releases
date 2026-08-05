'use strict';

const LEVEL_ORDER = { error: 0, warning: 1, information: 2, evidence_gap: 3 };
const LEVEL_LABEL = { error: 'Error', warning: 'Warning', information: 'Information', evidence_gap: 'Evidence gap' };

function summarize(findings) {
  const summary = { error: 0, warning: 0, information: 0, evidence_gap: 0 };
  for (const f of findings) summary[f.level] = (summary[f.level] || 0) + 1;
  return summary;
}

function renderDocumentationHealthMd(findings, summary, meta) {
  const lines = [];
  lines.push('# Documentation Health Report');
  lines.push('');
  lines.push(`> Generated artifact. Implements the 13 rules specified in [14_VALIDATION_SPECIFICATION.md](../14_VALIDATION_SPECIFICATION.md) plus Part 4 tooling-integrity checks. Regenerate with \`node scripts/product-docs/cli.js validate\`.`);
  lines.push('');
  lines.push(`Generated against source commit \`${meta.sourceCommit}\`.`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Level | Count | Exit policy |');
  lines.push('|---|---|---|');
  lines.push(`| Error | ${summary.error} | Fails the build (non-zero exit) |`);
  lines.push(`| Warning | ${summary.warning} | Reported, does not fail the build |`);
  lines.push(`| Information | ${summary.information} | Reported, does not fail the build |`);
  lines.push(`| Evidence gap | ${summary.evidence_gap} | Reported, does not fail the build — visibility only, per 14_VALIDATION_SPECIFICATION.md Rule 13 |`);
  lines.push('');
  lines.push(`**Result**: ${summary.error > 0 ? 'FAIL — error-level findings present' : 'PASS'}`);
  lines.push('');

  const sorted = [...findings].sort((a, b) => (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || a.rule.localeCompare(b.rule));
  const byLevel = { error: [], warning: [], information: [], evidence_gap: [] };
  for (const f of sorted) byLevel[f.level].push(f);

  for (const level of ['error', 'warning', 'information', 'evidence_gap']) {
    const items = byLevel[level];
    lines.push(`## ${LEVEL_LABEL[level]} (${items.length})`);
    lines.push('');
    if (!items.length) {
      lines.push('None.');
      lines.push('');
      continue;
    }
    lines.push('| Rule | Message | File | Note |');
    lines.push('|---|---|---|---|');
    for (const f of items) {
      lines.push([f.rule, f.message.replace(/\|/g, '\\|'), f.file || '—', (f.note || '—').toString().replace(/\|/g, '\\|')]
        .join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

module.exports = { renderDocumentationHealthMd, summarize };
