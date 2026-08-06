'use strict';

const { compareIds } = require('./ids');

// Strips trailing blank entries before the final join, so a per-entry blank
// separator pushed inside a loop (intentional between entries) never becomes
// an accidental blank line at end-of-file for the LAST entry — found by
// `git diff --check` flagging "new blank line at EOF" on these two
// generated files.
function trimTrailingBlanks(lines) {
  const out = lines.slice();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function renderMemoryIndexMd(memoryIndex, docsysVersion) {
  const lines = [];
  lines.push('# Memory Index');
  lines.push('');
  lines.push(`> Generated artifact — docsys version ${docsysVersion}. Locator only; canonical Markdown under docs/product/memory/ remains authoritative — see docs/product/16_ENGINEERING_MEMORY_POLICY.md § 15. Never edit this file by hand — regenerate with \`node scripts/product-docs/cli.js build\`.`);
  lines.push('');
  if (!memoryIndex.length) {
    lines.push('No Memory Capsules recorded yet.');
    lines.push('');
    return trimTrailingBlanks(lines).join('\n') + '\n';
  }
  lines.push('| ID | Title | Status | Features | Bugs | Decisions | Evidence classification | Canonical path |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of memoryIndex) {
    lines.push([
      r.memory_id,
      r.title,
      r.status,
      r.feature_ids.join(', ') || '—',
      r.bug_ids.join(', ') || '—',
      r.decision_ids.join(', ') || '—',
      r.evidence_classification,
      `[${r.canonical_path}](../memory/${r.canonical_path.split('/').pop()})`,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  return trimTrailingBlanks(lines).join('\n') + '\n';
}

function renderEngineeringMemoryTimelineMd(memoryIndex, docsysVersion) {
  const lines = [];
  lines.push('# Engineering Memory Timeline');
  lines.push('');
  lines.push(`> Generated artifact — docsys version ${docsysVersion}. A chronological project-level narrative index over docs/product/memory/, not a duplicate of any individual capsule — open the canonical capsule (linked below) for the full record. Never edit this file by hand — regenerate with \`node scripts/product-docs/cli.js build\`.`);
  lines.push('');
  if (!memoryIndex.length) {
    lines.push('No Memory Capsules recorded yet.');
    lines.push('');
    return trimTrailingBlanks(lines).join('\n') + '\n';
  }
  const sorted = [...memoryIndex].sort((a, b) => {
    const da = a.date_started === 'Evidence pending' ? '' : a.date_started;
    const db = b.date_started === 'Evidence pending' ? '' : b.date_started;
    return da === db ? compareIds(a.memory_id, b.memory_id) : da.localeCompare(db);
  });
  for (const r of sorted) {
    lines.push(`## ${r.date_started} — ${r.memory_id} — ${r.title}`);
    lines.push('');
    lines.push(`- **Feature(s)**: ${r.feature_ids.join(', ') || 'None'}`);
    lines.push(`- **Accepted approach**: ${r.accepted_approach}`);
    lines.push(`- **Rejected alternative(s)**: ${r.rejected_approaches.length ? r.rejected_approaches.join('; ') : 'None recorded'}`);
    lines.push(`- **Related commit(s)**: ${r.commit_ids.join(', ') || 'Evidence pending'}`);
    lines.push(`- **Unresolved follow-up**: ${r.unresolved_items.length ? r.unresolved_items.join('; ') : 'None recorded'}`);
    lines.push(`- **Capsule**: [${r.memory_id}](../memory/${r.canonical_path.split('/').pop()})`);
    lines.push('');
  }
  return trimTrailingBlanks(lines).join('\n') + '\n';
}

module.exports = { renderMemoryIndexMd, renderEngineeringMemoryTimelineMd };
