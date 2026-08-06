'use strict';

const { compareIds } = require('./ids');
const { parseRelatedTechnicalDocs } = require('./subsystems');

function rec(entityType, stableId, title, canonicalPath, opts = {}) {
  return {
    entity_type: entityType,
    stable_id: stableId,
    title,
    canonical_path: canonicalPath,
    aliases: opts.aliases || [],
    keywords: opts.keywords || [],
    summary: opts.summary || '',
    related_ids: opts.relatedIds || [],
    authority_level: opts.authorityLevel || 'canonical',
    evidence_status: opts.evidenceStatus || 'Evidence pending',
  };
}

function keywordsFrom(...texts) {
  const words = new Set();
  for (const t of texts) {
    if (!t) continue;
    for (const w of String(t).toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length > 2) words.add(w);
    }
  }
  return Array.from(words).sort();
}

function buildSearchIndex(parsed, featureIndexRecords, subsystems, memoryIndexRecords) {
  const records = [];

  // Part 6 — memory capsules join the same flat search index as every other
  // entity type, so `query`/`impact`/`lookupById` pick them up for free —
  // see docs/product/16_ENGINEERING_MEMORY_POLICY.md § 15.
  for (const m of memoryIndexRecords || []) {
    records.push(rec('memory', m.memory_id, m.title, m.canonical_path, {
      keywords: m.keywords,
      summary: m.summary,
      relatedIds: [...m.feature_ids, ...m.bug_ids, ...m.decision_ids, ...m.postmortem_ids, ...m.roadmap_ids],
      authorityLevel: 'evidence', // memory is historical evidence, not canonical — see policy § 3
      evidenceStatus: m.evidence_classification,
    }));
  }

  for (const f of featureIndexRecords) {
    records.push(rec('feature', f.feature_id, f.name, f.canonical_document, {
      aliases: f.aliases,
      keywords: f.search_keywords,
      summary: f.summary,
      relatedIds: [...f.dependencies, ...f.related_bugs, ...f.related_decisions, ...f.roadmap_ids],
      evidenceStatus: f.evidence_status,
    }));
  }

  for (const [id, m] of parsed.roadmap) {
    records.push(rec('roadmap', id, m.name, parsed.roadmapPath, {
      keywords: keywordsFrom(m.name),
      summary: m.header['Objective'] || '',
      relatedIds: require('./ids').extractIds(String(m.header['Included AI-FEAT IDs'] || ''), 'feature'),
      evidenceStatus: m.header['Status'] || 'Evidence pending',
    }));
  }

  for (const [id, b] of parsed.bugs) {
    records.push(rec('bug', id, b.name, b.filePath, {
      keywords: keywordsFrom(b.name),
      summary: b.header['Symptom'] || '',
      relatedIds: require('./ids').extractIds(String(b.header['Related feature(s)'] || ''), 'feature'),
      evidenceStatus: b.header['Evidence status'] || 'Evidence pending',
    }));
  }

  for (const [id, d] of parsed.decisions) {
    records.push(rec('decision', id, d.name, d.filePath, {
      keywords: keywordsFrom(d.name),
      relatedIds: require('./ids').extractIds(String(d.header['Related feature(s) / roadmap milestone'] || ''), 'feature'),
      evidenceStatus: d.header['Evidence status'] || 'Evidence pending',
    }));
  }

  for (const [id, p] of parsed.postmortems) {
    records.push(rec('postmortem', id, p.name, p.filePath, {
      keywords: keywordsFrom(p.name),
      relatedIds: require('./ids').extractIds(String(p.header['Related feature(s)'] || ''), 'feature'),
      evidenceStatus: p.header['Evidence status'] || 'Evidence pending',
    }));
  }

  for (const h of parsed.archHeadings) {
    records.push(rec('architecture_section', 'ARCH-' + h.slug, h.text, parsed.archPath + '#' + h.slug, {
      keywords: keywordsFrom(h.text),
      authorityLevel: 'canonical',
      evidenceStatus: 'Verified from 11_ARCHITECTURAL_EVOLUTION.md',
    }));
  }

  const spineFiles = parsed.allFiles.filter((f) => /^\d{2}_[A-Z_]+\.md$/.test(f.relPath) || f.relPath === 'README.md' || f.relPath === 'CLAUDE.md');
  for (const f of spineFiles) {
    const title = (f.headings[0] && f.headings[0].text) || f.relPath;
    records.push(rec('product_doc', 'DOC:' + f.relPath, title, f.relPath, {
      keywords: keywordsFrom(title),
      authorityLevel: 'canonical',
      evidenceStatus: 'Canonical document',
    }));
  }

  const techDocs = new Set();
  for (const [, feat] of parsed.features) {
    for (const doc of parseRelatedTechnicalDocs(feat.header['Related technical docs'])) techDocs.add(doc);
  }
  for (const doc of Array.from(techDocs).sort()) {
    records.push(rec('technical_doc', 'TECHDOC:' + doc, doc, doc, {
      keywords: keywordsFrom(doc),
      authorityLevel: 'authoritative_technical',
      evidenceStatus: 'Cited by docs/product/ feature files; content owned outside docs/product/',
    }));
  }

  const changelogContent = parsed.allFiles.find((f) => f.relPath === '10_CHANGELOG.md').content;
  const changelogHeadings = changelogContent.split('\n').filter((l) => /^##\s+\d{4}-\d{2}-\d{2}/.test(l));
  for (const h of changelogHeadings) {
    const title = h.replace(/^##\s+/, '').trim();
    const date = /^\d{4}-\d{2}-\d{2}/.exec(title)[0];
    records.push(rec('changelog_entry', 'CHANGELOG:' + date + ':' + title.replace(/\s+/g, '-').toLowerCase(), title, '10_CHANGELOG.md', {
      keywords: keywordsFrom(title),
      authorityLevel: 'canonical',
      evidenceStatus: 'Canonical changelog entry',
    }));
  }

  for (const s of subsystems) {
    records.push(rec('subsystem', s.id, s.name, parsed.registryPath, {
      aliases: s.aliases,
      keywords: keywordsFrom(s.name, ...s.aliases),
      relatedIds: s.primaryFeatures,
      authorityLevel: 'locator',
      evidenceStatus: 'Derived from 01_FEATURE_REGISTRY.md category grouping',
    }));
  }

  const codePathOwners = new Map();
  const testPathOwners = new Map();
  for (const f of featureIndexRecords) {
    for (const p of f.related_code_paths) {
      if (!codePathOwners.has(p)) codePathOwners.set(p, []);
      codePathOwners.get(p).push(f.feature_id);
    }
    for (const t of f.related_tests) {
      if (!testPathOwners.has(t)) testPathOwners.set(t, []);
      testPathOwners.get(t).push(f.feature_id);
    }
  }
  for (const [p, owners] of Array.from(codePathOwners.entries()).sort()) {
    records.push(rec('code_path', 'CODE:' + p, p, p, {
      keywords: keywordsFrom(p),
      relatedIds: owners.sort(compareIds),
      authorityLevel: 'locator',
      evidenceStatus: `Cited as Related Files by ${owners.length} feature file(s)`,
    }));
  }
  for (const [p, owners] of Array.from(testPathOwners.entries()).sort()) {
    records.push(rec('test_path', 'TEST:' + p, p, p, {
      keywords: keywordsFrom(p),
      relatedIds: owners.sort(compareIds),
      authorityLevel: 'locator',
      evidenceStatus: `Cited as Testing coverage by ${owners.length} feature file(s)`,
    }));
  }

  return records;
}

module.exports = { buildSearchIndex };
