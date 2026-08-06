'use strict';

// Part 6 — builds one summary record per docs/product/memory/AI-MEM-####_*.md
// capsule, in the same style as lib/featureIndex.js. Every field here is
// derived from the capsule's own header tables/sections (never invented) —
// see docs/product/16_ENGINEERING_MEMORY_POLICY.md § 15 for the freshness
// guarantee this feeds (checkGeneratedFreshness, once these records are part
// of build.js's files Map).

const md = require('./markdown');
const { extractIds } = require('./ids');
const { compareIds } = require('./ids');

function idsFromField(text, family) {
  return extractIds(String(text || ''), family);
}

function buildMemoryRecord(memId, capsule) {
  const identity = md.extractSectionTable(capsule.body, 'Identity') || {};
  const scope = md.extractSectionTable(capsule.body, 'Scope') || {};

  const evolutionSection = md.extractSection(capsule.body, 'Evolution Timeline') || '';
  const revisionCount = (evolutionSection.match(/^-\s+\*\*Revision\s+\d+/gm) || []).length;

  const alternativesSection = md.extractSection(capsule.body, 'Alternatives Considered') || '';
  const acceptedApproach = /Accepted or rejected\*\*:\s*Accepted/i.test(alternativesSection)
    ? 'At least one alternative explicitly accepted — see capsule §Alternatives Considered'
    : 'Evidence pending';
  const rejectedApproaches = (alternativesSection.match(/Accepted or rejected\*\*:\s*Rejected[^\n]*/gi) || []).map((s) => s.trim());

  const finalOutcomeSection = md.extractSection(capsule.body, 'Final Outcome') || '';
  const followUpMatch = /Follow-up work\*\*:\s*(.+)/i.exec(finalOutcomeSection);
  const unresolved = followUpMatch ? [followUpMatch[1].trim()] : [];

  const provenanceSection = md.extractSection(capsule.body, 'Provenance') || '';
  const evidencePendingMatch = /Evidence-pending items\*\*:\s*(.+)/i.exec(provenanceSection);

  return {
    memory_id: memId,
    title: capsule.name,
    status: identity['Status'] || 'Evidence pending',
    date_started: identity['Date started'] || 'Evidence pending',
    date_completed: identity['Date completed'] || 'Evidence pending',
    evidence_classification: identity['Evidence classification'] || 'Evidence pending',
    feature_ids: idsFromField(scope['Primary feature IDs'], 'feature').concat(idsFromField(scope['Secondary feature IDs'], 'feature')).sort(compareIds),
    roadmap_ids: idsFromField(scope['Roadmap milestone IDs'], 'roadmap'),
    bug_ids: idsFromField(scope['Related bugs'], 'bug'),
    decision_ids: idsFromField(scope['Related decisions'], 'decision'),
    postmortem_ids: idsFromField(scope['Related postmortems'], 'postmortem'),
    commit_ids: (identity['Final commit(s)'] || '').split(',').map((s) => s.trim().replace(/`/g, '')).filter((s) => s && s !== 'Evidence pending'),
    aliases: [],
    keywords: String(capsule.name).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2),
    summary: capsule.name,
    revision_count: revisionCount,
    accepted_approach: acceptedApproach,
    rejected_approaches: rejectedApproaches,
    unresolved_items: unresolved,
    canonical_path: capsule.filePath,
    source_types: identity['Source agents/tools'] || 'Evidence pending',
    evidence_pending_summary: evidencePendingMatch ? evidencePendingMatch[1].trim() : 'Evidence pending',
  };
}

function buildMemoryIndex(parsed) {
  const records = [];
  for (const [id, capsule] of parsed.memory) {
    records.push(buildMemoryRecord(id, capsule));
  }
  records.sort((a, b) => compareIds(a.memory_id, b.memory_id));
  return records;
}

module.exports = { buildMemoryIndex, buildMemoryRecord };
