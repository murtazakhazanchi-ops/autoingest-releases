'use strict';

const path = require('path');
const { parseRelatedTechnicalDocs } = require('./subsystems');
const { extractIds, compareIds } = require('./ids');

// Hand-curated user-terminology aliases per AI-FEAT-###, grounded in the
// feature's own registry name and in terms already used in docs/product/ or
// docs/CLAUDE.md's Task Documentation Routing table. This is the explicit
// example list from the Part 4 brief plus the closest-matching feature for
// each. Never auto-derived by fuzzy matching.
const TOPIC_ALIASES = {
  'AI-FEAT-004': ['event.json', 'event json', 'persistence contract', 'data model'],
  'AI-FEAT-022': ['photographer sequencing', 'photographer folder sequencing', 'pcxx'],
  'AI-FEAT-023': ['quick import'],
  'AI-FEAT-024': ['source cleanup'],
  'AI-FEAT-029': ['metadata writing', 'exif', 'iptc', 'xmp', 'xmp sidecars', 'raw metadata', 'raw sidecars', 'tagging'],
  'AI-FEAT-030': ['metadata queue', 'durable queue', 'crash recovery'],
  'AI-FEAT-033': ['metadata audit', 'metadata repair', 'audit and repair'],
  'AI-FEAT-036': ['keyword registry', 'controlled keywords'],
  'AI-FEAT-037': ['metadata reapply', 'metadata sync'],
  'AI-FEAT-038': ['transfer export'],
  'AI-FEAT-039': ['transfer import'],
  'AI-FEAT-040': ['backup update', 'backup scanning'],
  'AI-FEAT-042': ['archive root resolution', 'archive root configuration', 'main archive root', 'active archive root'],
  'AI-FEAT-043': ['archive health', 'archive health reporting', 'diagnostics'],
  'AI-FEAT-044': ['local-first sync', 'background archive sync', 'nas sync'],
  'AI-FEAT-045': ['stale locks', 'lock handling', 'archive lock'],
  'AI-FEAT-046': ['archive folder adoption'],
  'AI-FEAT-047': ['qmz', 'qmz sequencing', 'quick mobile zip'],
  'AI-FEAT-049': ['archive maintenance'],
  'AI-FEAT-050': ['event maintenance'],
  'AI-FEAT-051': ['archive browser'],
  'AI-FEAT-052': ['archive repair'],
  'AI-FEAT-053': ['global search', 'search'],
  'AI-FEAT-054': ['integrity verification', 'archive-wide verification'],
  'AI-FEAT-055': ['archive analytics'],
  'AI-FEAT-056': ['ai archive intelligence'],
};

// Part 5 Phase 5.2 (Decision 3) materiality correction — a PURE ADDITION,
// never touching the existing relatedBugs/relatedDecisions/relatedPostmortems
// fields Phase 5.1 already fidelity-audited (byte-identical, 0/58 mismatches
// — unchanged by this function). Captures a second, already-EXISTING,
// systematically-used canonical-text signal that extractIds() alone
// discards: many features' own "Related decisions"/"Related bugs"/"Related
// postmortems" cells mark a specific citation "*(found via reverse lookup —
// not yet cross-linked in the ... section above)*" — an auto-discovered,
// secondary relationship, distinct from a directly-curated one. This is
// NOT invented: the exact phrase already appears, hand-authored, across 18+
// feature files (verified via direct grep during the Phase 5.2 materiality
// investigation), sometimes mixed within the SAME cell (e.g. AI-FEAT-042
// cites both DEC-003 *(reverse lookup)* and DEC-012, no caveat, in one
// cell) — hence the semicolon-segment-aware extraction below, never a
// per-cell blanket flag. No new schema, no new authoring requirement —
// every word consumed here was already written by a prior documentation
// pass for exactly this purpose.
const REVERSE_LOOKUP_MARKER = /reverse lookup/i;

function extractDirectIds(text, family) {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  const segments = raw.split(';');
  const direct = new Set();
  for (const segment of segments) {
    if (REVERSE_LOOKUP_MARKER.test(segment)) continue;
    for (const id of extractIds(segment, family)) direct.add(id);
  }
  return Array.from(direct).sort(compareIds);
}

function buildAuthorityIndex(parsed) {
  const entries = [];
  const featureIds = Array.from(parsed.features.keys()).sort(compareIds);
  for (const featureId of featureIds) {
    const feat = parsed.features.get(featureId);
    const roadmapRaw = feat.header['Related roadmap milestone'] || '';
    const roadmapIds = extractIds(roadmapRaw, 'roadmap');
    const bugs = extractIds(String(feat.lifecycle['Related bugs'] || ''), 'bug');
    const decisions = extractIds(String(feat.lifecycle['Related decisions'] || ''), 'decision');
    const postmortems = extractIds(String(feat.lifecycle['Related postmortems'] || ''), 'postmortem');
    entries.push({
      recordType: 'feature',
      topic: feat.name,
      featureId,
      aliases: TOPIC_ALIASES[featureId] || [],
      canonicalProductDoc: feat.filePath,
      canonicalTechnicalDocs: parseRelatedTechnicalDocs(feat.header['Related technical docs']),
      roadmapIds,
      relatedBugs: bugs,
      relatedDecisions: decisions,
      relatedPostmortems: postmortems,
      // Phase 5.2 addition (see extractDirectIds' own comment) — subsets of
      // the three fields above, excluding any citation the canonical text
      // itself marks as "found via reverse lookup" (auto-discovered,
      // secondary). relatedBugs/relatedDecisions/relatedPostmortems
      // themselves are completely unchanged.
      directBugs: extractDirectIds(feat.lifecycle['Related bugs'], 'bug'),
      directDecisions: extractDirectIds(feat.lifecycle['Related decisions'], 'decision'),
      directPostmortems: extractDirectIds(feat.lifecycle['Related postmortems'], 'postmortem'),
      codeAreas: feat.relatedFiles,
      confidenceLevel: 'explicit',
      evidenceNote: `Derived directly from ${feat.filePath}'s header table and Lifecycle Metadata section.`,
    });
  }

  // Part 2 remediation (Decision 5's prerequisite, Root Cause B) — Workflows
  // get their own entry shape, not the feature shape, since a Workflow isn't
  // "a capability with aliases/bugs/decisions" — it's an end-to-end journey
  // that exercises capabilities. `recordType` lets a consumer of
  // authority-index.json distinguish the two shapes explicitly rather than
  // inferring it from which fields happen to be present.
  if (parsed.workflows) {
    const workflowIds = Array.from(parsed.workflows.keys()).sort(compareIds);
    for (const workflowId of workflowIds) {
      const wf = parsed.workflows.get(workflowId);
      entries.push({
        recordType: 'workflow',
        topic: wf.name,
        workflowId,
        relatedFeatures: extractIds(String(wf.header['Related capabilities'] || ''), 'feature'),
        roadmapIds: extractIds(String(wf.header['Related roadmap milestone'] || ''), 'roadmap'),
        relatedWorkflows: extractIds(String(wf.relatedActions || ''), 'workflow').filter((id) => id !== workflowId),
        canonicalProductDoc: wf.filePath,
        confidenceLevel: 'explicit',
        evidenceNote: `Derived directly from ${wf.filePath}'s header table.`,
      });
    }
  }

  return entries;
}

module.exports = { buildAuthorityIndex, TOPIC_ALIASES, extractDirectIds };
