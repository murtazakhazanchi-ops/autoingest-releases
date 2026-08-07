'use strict';

// Part 8 — Unimplemented Conversation Requirements Detector.
// docs/product/18_ENGINEERING_CONVERSATION_POLICY.md's authority model
// requires that "Implemented" only ever be set on a conversation's Outcome
// from repository evidence (a linked commit/Evidence Packet), never
// inferred from the conversation text alone — this module is the read side
// of that same discipline: it classifies every conversation that made an
// implementation request by what its own Outcome log actually says, never
// by scanning source code for a keyword match (a keyword's absence from
// code proves nothing — the brief is explicit about this).

const md = require('./markdown');
const { compareIds } = require('./ids');

const CATEGORIES = [
  'explicitly_planned', 'implementation_pending', 'deferred', 'rejected',
  'evidence_pending', 'possibly_implemented_but_unlinked', 'implemented',
];

function classifyOutcome(outcomeSection, hasRoadmapLink) {
  const text = outcomeSection || '';
  if (/Implemented/i.test(text) && !/Not\s+Implemented/i.test(text)) return 'implemented';
  if (/Rejected/i.test(text)) return 'rejected';
  if (/Deferred/i.test(text)) return 'deferred';
  if (/Superseded|Archived/i.test(text)) return 'possibly_implemented_but_unlinked';
  if (hasRoadmapLink) return 'explicitly_planned';
  return 'implementation_pending';
}

function buildUnimplementedRequirements(parsed, conversationIndex) {
  if (!parsed.conversations) return [];
  // Built once, outside the loop below, so the id -> index-record lookup is
  // O(1) per conversation instead of an O(n) .find() inside an O(n) loop
  // (found in Part 8 performance review — negligible at current corpus
  // size, but a free, trivial fix consistent with this codebase's other
  // index-building conventions).
  const conversationIndexById = new Map((conversationIndex || []).map((r) => [r.conversation_id, r]));
  const out = [];
  for (const [id, rec] of parsed.conversations) {
    const handoffSection = md.extractSection(rec.body, 'Implementation Handoff') || '';
    const hasRequest = handoffSection && !/^-\s+\*\*Work requested\*\*:\s*None recorded\.?$/im.test(handoffSection.trim());
    if (!hasRequest) continue; // no implementation request in this conversation at all — not in scope for this report

    const outcomeSection = md.extractSection(rec.body, 'Outcome') || '';
    const relationships = md.extractSectionTable(rec.body, 'Relationships') || {};
    const hasRoadmapLink = !!(relationships['Roadmap milestone IDs'] && relationships['Roadmap milestone IDs'] !== 'None');
    const category = classifyOutcome(outcomeSection, hasRoadmapLink);
    if (category === 'implemented') continue; // resolved — not an open gap

    const indexRec = conversationIndexById.get(id);
    out.push({
      conversation_id: id,
      title: rec.name,
      category,
      feature_ids: indexRec ? indexRec.feature_ids : [],
      roadmap_ids: indexRec ? indexRec.roadmap_ids : [],
      canonical_path: rec.filePath,
      latest_outcome: indexRec ? indexRec.latest_outcome : 'Evidence pending',
    });
  }
  out.sort((a, b) => compareIds(a.conversation_id, b.conversation_id));
  return out;
}

function trimTrailingBlanks(lines) {
  const out = lines.slice();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function renderUnimplementedRequirementsMd(requirements, docsysVersion) {
  const lines = [];
  lines.push('# Unimplemented Conversation Requirements');
  lines.push('');
  lines.push(`> Generated artifact — docsys version ${docsysVersion}. Every conversation whose Implementation Handoff names concrete work and whose Outcome log has not recorded "Implemented" from repository evidence. A missing keyword in source code is never used as evidence here — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md. Never edit this file by hand — regenerate with \`node scripts/product-docs/cli.js build\`.`);
  lines.push('');
  if (!requirements.length) {
    lines.push('None — every conversation with an implementation request has a recorded Implemented outcome, or no conversation has made one yet.');
    lines.push('');
    return trimTrailingBlanks(lines).join('\n') + '\n';
  }
  for (const cat of CATEGORIES) {
    const inCat = requirements.filter((r) => r.category === cat);
    if (!inCat.length) continue;
    lines.push(`## ${cat.replace(/_/g, ' ')}`);
    lines.push('');
    for (const r of inCat) {
      lines.push(`- [${r.conversation_id}](../conversations/${r.canonical_path.split('/').pop()}) — ${r.title} (features: ${r.feature_ids.join(', ') || 'None'}; latest outcome: ${r.latest_outcome})`);
    }
    lines.push('');
  }
  return trimTrailingBlanks(lines).join('\n') + '\n';
}

module.exports = { buildUnimplementedRequirements, renderUnimplementedRequirementsMd, classifyOutcome, CATEGORIES };
