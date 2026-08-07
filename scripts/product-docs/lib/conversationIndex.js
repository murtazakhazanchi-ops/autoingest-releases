'use strict';

// Part 8 — builds one summary record per
// docs/product/conversations/ENG-CONV-####_*.md record, in the same style
// as lib/memoryIndex.js. Every field here is derived from the record's own
// header tables/sections (never invented).

const md = require('./markdown');
const { extractIds, compareIds } = require('./ids');

function idsFromField(text, family) {
  return extractIds(String(text || ''), family);
}

function buildConversationRecord(convId, rec) {
  const identity = md.extractSectionTable(rec.body, 'Identity') || {};
  const relationships = md.extractSectionTable(rec.body, 'Relationships') || {};

  const evolutionSection = md.extractSection(rec.body, 'Discussion Evolution') || '';
  const revisionCount = (evolutionSection.match(/^-\s+\*\*Revision\s+\d+/gm) || []).length;

  const alternativesSection = md.extractSection(rec.body, 'Alternatives') || '';
  const rejectedCount = (alternativesSection.match(/Accepted or rejected\*\*:\s*Rejected/gi) || []).length;

  // Strips the leading "- **date** — " list-item prefix so this renders
  // cleanly as an inline table-cell/summary value rather than a nested
  // bullet appearing inside another bullet or table cell.
  const outcomeSection = md.extractSection(rec.body, 'Outcome') || '';
  const outcomeLines = outcomeSection.split('\n').filter((l) => /^-\s+\*\*\d{4}-\d{2}-\d{2}\*\*/.test(l));
  const lastOutcomeRaw = outcomeLines[outcomeLines.length - 1] || '';
  const outcomeMatch = /^-\s+\*\*(\d{4}-\d{2}-\d{2})\*\*\s+—\s+(.+)$/.exec(lastOutcomeRaw);
  const lastOutcomeLine = outcomeMatch ? `${outcomeMatch[1]} — ${outcomeMatch[2]}` : lastOutcomeRaw;

  const openQuestionsSection = md.extractSection(rec.body, 'Open Questions') || '';
  const unresolvedMatch = /Unresolved\*\*:\s*(.+)/i.exec(openQuestionsSection);

  const provenanceSection = md.extractSection(rec.body, 'Provenance') || '';
  const evidencePendingMatch = /Evidence-pending items\*\*:\s*(.+)/i.exec(provenanceSection);

  return {
    conversation_id: convId,
    title: rec.name,
    status: identity['Status'] || 'Evidence pending',
    source_tool: identity['Source tool'] || 'Evidence pending',
    conversation_type: identity['Conversation type'] || 'Evidence pending',
    date_started: identity['Date started'] || 'Evidence pending',
    date_completed: identity['Date completed'] || 'Evidence pending',
    import_date: identity['Import date'] || 'Evidence pending',
    provenance_classification: identity['Provenance classification'] || 'Evidence pending',
    feature_ids: idsFromField(relationships['Primary feature IDs'], 'feature').concat(idsFromField(relationships['Secondary feature IDs'], 'feature')).sort(compareIds),
    roadmap_ids: idsFromField(relationships['Roadmap milestone IDs'], 'roadmap'),
    bug_ids: idsFromField(relationships['Related bugs'], 'bug'),
    decision_ids: idsFromField(relationships['Related decisions'], 'decision'),
    memory_ids: idsFromField(relationships['Related memory capsules'], 'memory'),
    related_conversation_ids: idsFromField(relationships['Related conversations'], 'conversation'),
    aliases: [],
    keywords: String(rec.name).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2),
    summary: rec.name,
    revision_count: revisionCount,
    rejected_approach_count: rejectedCount,
    latest_outcome: lastOutcomeLine.trim() || 'Evidence pending',
    open_questions_summary: unresolvedMatch ? unresolvedMatch[1].trim() : 'Evidence pending',
    canonical_path: rec.filePath,
    evidence_pending_summary: evidencePendingMatch ? evidencePendingMatch[1].trim() : 'Evidence pending',
  };
}

function buildConversationIndex(parsed) {
  const records = [];
  if (!parsed.conversations) return records;
  for (const [id, rec] of parsed.conversations) {
    records.push(buildConversationRecord(id, rec));
  }
  records.sort((a, b) => compareIds(a.conversation_id, b.conversation_id));
  return records;
}

module.exports = { buildConversationIndex, buildConversationRecord };
