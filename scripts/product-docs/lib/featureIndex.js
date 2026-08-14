'use strict';

const { extractIds, compareIds } = require('./ids');
const { parseRelatedTechnicalDocs } = require('./subsystems');
const { TOPIC_ALIASES } = require('./authorityTopics');
// Part 2 remediation (Decision 2, Root Cause A) — a feature's search surface
// previously came only from its name/category/curated-alias list; Summary
// text (the template's own "what this feature does and why it exists"
// field) is now included, using the same stopword-aware tokenizer
// searchIndex.js already uses for every other entity type.
const { keywordsFrom, EVIDENCE_MARKERS } = require('./textKeywords');

function countEvidenceGaps(text) {
  let count = 0;
  for (const marker of EVIDENCE_MARKERS) {
    const re = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const m = text.match(re);
    if (m) count += m.length;
  }
  return count;
}

function extractTestPaths(text) {
  if (!text) return [];
  const re = /`(test\/[^`]+\.test\.js)`/g;
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  return Array.from(found).sort();
}

function extractChangelogMentions(changelogContent, featureId) {
  const lines = changelogContent.split('\n');
  const mentions = [];
  let currentDate = null;
  for (const line of lines) {
    const dateMatch = /^##\s+(\d{4}-\d{2}-\d{2})/.exec(line);
    if (dateMatch) currentDate = dateMatch[1];
    if (line.includes(featureId)) {
      mentions.push({ date: currentDate, excerpt: line.trim().replace(/^-\s*/, '').slice(0, 200) });
    }
  }
  return mentions;
}

function buildFeatureIndex(parsed, sourceIndex) {
  const changelogContent = parsed.allFiles.find((f) => f.relPath === '10_CHANGELOG.md').content;
  const records = [];
  const featureIds = Array.from(parsed.features.keys()).sort(compareIds);

  // dependents: reverse of Dependencies field
  const dependents = new Map();
  for (const [id, feat] of parsed.features) {
    for (const dep of extractIds(String(feat.header['Dependencies'] || ''), 'feature')) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep).push(id);
    }
  }

  for (const id of featureIds) {
    const feat = parsed.features.get(id);
    const category = parsed.categoryByFeatureId.get(id) || 'Uncategorized';
    const aliases = TOPIC_ALIASES[id] || [];
    const searchKeywords = new Set([
      ...feat.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2),
      ...aliases.map((a) => a.toLowerCase()),
      category.toLowerCase(),
      // Decision 2 — Summary is the template's own "what and why" field;
      // Evolution Journal / Engineering Evolution / Known Bugs / Decisions /
      // Future Enhancements / Related Files sections are deliberately NOT
      // included (history/boilerplate/citation-only content — same boundary
      // as the bug/decision/postmortem exclusions in parseProductDocs.js).
      ...keywordsFrom(feat.summary),
    ]);
    records.push({
      feature_id: id,
      name: feat.name,
      aliases,
      category,
      status: feat.header['Status'] || 'Evidence pending',
      maturity: feat.header['Maturity'] || 'Evidence pending',
      summary: (feat.summary || '').trim() || 'Evidence pending — not yet documented as fact.',
      canonical_document: feat.filePath,
      roadmap_ids: extractIds(String(feat.header['Related roadmap milestone'] || ''), 'roadmap'),
      parent_feature: extractIds(String(feat.header['Parent feature'] || ''), 'feature'),
      subfeatures: extractIds(String(feat.header['Subfeatures'] || ''), 'feature'),
      dependencies: extractIds(String(feat.header['Dependencies'] || ''), 'feature'),
      dependents: (dependents.get(id) || []).sort(compareIds),
      related_features: extractIds(String(feat.lifecycle['Related features'] || ''), 'feature'),
      related_bugs: extractIds(String(feat.lifecycle['Related bugs'] || ''), 'bug'),
      related_decisions: extractIds(String(feat.lifecycle['Related decisions'] || ''), 'decision'),
      related_postmortems: extractIds(String(feat.lifecycle['Related postmortems'] || ''), 'postmortem'),
      related_architecture_sections: (String(feat.lifecycle['Related architectural evolution sections'] || ''))
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s && !s.toLowerCase().startsWith('evidence pending')),
      related_changelog_entries: extractChangelogMentions(changelogContent, id),
      related_technical_docs: parseRelatedTechnicalDocs(feat.header['Related technical docs']),
      related_tests: extractTestPaths(String(feat.lifecycle['Testing coverage'] || '')),
      related_code_paths: feat.relatedFiles,
      evidence_status: feat.header['Evidence status'] || 'Evidence pending',
      documentation_completeness: {
        evidence_gap_count: countEvidenceGaps(feat.body),
        narrative: feat.lifecycle['Documentation completeness'] || 'Evidence pending',
      },
      introduced_version: feat.header['First-known implementation'] || 'Evidence pending',
      last_modified_version: feat.header['Latest major update'] || 'Evidence pending',
      timeline_path: `generated/feature-timelines/${id}_TIMELINE.md`,
      search_keywords: Array.from(searchKeywords).sort(),
    });
  }
  return records;
}

module.exports = { buildFeatureIndex, countEvidenceGaps, extractTestPaths, extractChangelogMentions };
