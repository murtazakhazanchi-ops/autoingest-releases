'use strict';

const { compareIds } = require('./ids');

function trimTrailingBlanks(lines) {
  const out = lines.slice();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function renderConversationIndexMd(conversationIndex, docsysVersion) {
  const lines = [];
  lines.push('# Conversation Index');
  lines.push('');
  lines.push(`> Generated artifact — docsys version ${docsysVersion}. Locator only; canonical Markdown under docs/product/conversations/ remains authoritative — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 15. Never edit this file by hand — regenerate with \`node scripts/product-docs/cli.js build\`.`);
  lines.push('');
  if (!conversationIndex.length) {
    lines.push('No Engineering Conversation records yet.');
    lines.push('');
    return trimTrailingBlanks(lines).join('\n') + '\n';
  }
  lines.push('| ID | Title | Status | Source | Features | Decisions | Latest outcome | Canonical path |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of conversationIndex) {
    lines.push([
      r.conversation_id,
      r.title,
      r.status,
      r.source_tool,
      r.feature_ids.join(', ') || '—',
      r.decision_ids.join(', ') || '—',
      r.latest_outcome,
      `[${r.canonical_path}](../conversations/${r.canonical_path.split('/').pop()})`,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  return trimTrailingBlanks(lines).join('\n') + '\n';
}

function renderConversationTimelineMd(conversationIndex, docsysVersion) {
  const lines = [];
  lines.push('# Conversation Timeline');
  lines.push('');
  lines.push(`> Generated artifact — docsys version ${docsysVersion}. A chronological index over docs/product/conversations/, not a duplicate of any individual record — open the canonical record (linked below) for the full discussion. Never edit this file by hand — regenerate with \`node scripts/product-docs/cli.js build\`.`);
  lines.push('');
  if (!conversationIndex.length) {
    lines.push('No Engineering Conversation records yet.');
    lines.push('');
    return trimTrailingBlanks(lines).join('\n') + '\n';
  }
  const sorted = [...conversationIndex].sort((a, b) => {
    const da = a.date_started === 'Evidence pending' ? '' : a.date_started;
    const db = b.date_started === 'Evidence pending' ? '' : b.date_started;
    return da === db ? compareIds(a.conversation_id, b.conversation_id) : da.localeCompare(db);
  });
  for (const r of sorted) {
    lines.push(`## ${r.date_started} — ${r.conversation_id} — ${r.title}`);
    lines.push('');
    lines.push(`- **Source**: ${r.source_tool} (${r.conversation_type})`);
    lines.push(`- **Feature(s)**: ${r.feature_ids.join(', ') || 'None'}`);
    lines.push(`- **Latest outcome**: ${r.latest_outcome}`);
    lines.push(`- **Open questions**: ${r.open_questions_summary}`);
    lines.push(`- **Record**: [${r.conversation_id}](../conversations/${r.canonical_path.split('/').pop()})`);
    lines.push('');
  }
  return trimTrailingBlanks(lines).join('\n') + '\n';
}

module.exports = { renderConversationIndexMd, renderConversationTimelineMd };
