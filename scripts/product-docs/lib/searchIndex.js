'use strict';

const { compareIds } = require('./ids');
const { parseRelatedTechnicalDocs } = require('./subsystems');
// Part 2 remediation — keywordsFrom/STOPWORDS moved to their own module so
// featureIndex.js can use the identical tokenizer for Summary text (Decision
// 2) rather than maintaining a second, potentially-drifting copy. See
// textKeywords.js for the full history/rationale comment.
const { keywordsFrom } = require('./textKeywords');

function rec(entityType, stableId, title, canonicalPath, opts = {}) {
  return {
    entity_type: entityType,
    stable_id: stableId,
    title,
    canonical_path: canonicalPath,
    aliases: opts.aliases || [],
    keywords: opts.keywords || [],
    summary: opts.summary || '',
    // Part 2 remediation (Decision 1) — a second, optional retrieval-only
    // text field beyond `summary`, populated only for bug/decision/
    // postmortem records (see below). `summary` alone (Symptom/Context/
    // Summary) frames the problem; `detail` (Root Cause/Decision/Root
    // Cause) carries the actual conclusion — a governance-record-primary
    // answer (knowledgeEngine.js's answerFromGovernanceRecord) needs both
    // to be a complete, grounded answer rather than half of one. Not added
    // for feature/workflow records — their existing `summary` already IS
    // the complete answer-worthy text for those types.
    detail: opts.detail || '',
    related_ids: opts.relatedIds || [],
    authority_level: opts.authorityLevel || 'canonical',
    evidence_status: opts.evidenceStatus || 'Evidence pending',
  };
}

function buildSearchIndex(parsed, featureIndexRecords, subsystems, memoryIndexRecords, conversationIndexRecords, workflowIndexRecords) {
  const records = [];

  // Stage 2 — Workflow records join the same flat search index as every
  // other entity type, so the existing runQuery()/answerQuestion() path
  // finds them for free — no second retrieval implementation (DEC-020).
  // Keywords are derived from the title/domain/steps text, same
  // keywordsFrom() helper used below for roadmap milestones — Workflow
  // records don't precompute their own search_keywords the way feature
  // records do, since authoring one is a much rarer, more deliberate act.
  for (const w of workflowIndexRecords || []) {
    records.push(rec('workflow', w.id, w.title, w.canonicalDocument, {
      keywords: keywordsFrom(w.title, w.domain, w.whatItDoes, w.whenToUseIt, ...(w.steps || [])),
      summary: w.whatItDoes || '',
      relatedIds: [...w.relatedCapabilities, ...w.roadmapRelationship, ...w.relatedActionIds.workflows, ...w.relatedActionIds.features],
      authorityLevel: 'canonical', // docs/product/workflows/ — authored, human-reviewed, same tier as bugs/decisions
      evidenceStatus: w.evidenceStatus,
    }));
  }

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

  // Part 8 — Engineering Conversation records join the same flat search
  // index, same tier as memory — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 3.
  for (const c of conversationIndexRecords || []) {
    records.push(rec('engineering_conversation', c.conversation_id, c.title, c.canonical_path, {
      keywords: c.keywords,
      summary: c.summary,
      relatedIds: [...c.feature_ids, ...c.bug_ids, ...c.decision_ids, ...c.memory_ids, ...c.roadmap_ids, ...c.related_conversation_ids],
      authorityLevel: 'evidence',
      evidenceStatus: c.provenance_classification,
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

  // Part 2 remediation (Decision 2) — bug keywords now draw from Symptom +
  // Root Cause (the approved "concise defect-defining content"), not just
  // the title. `summary` previously read `b.header['Symptom']`, which is
  // always empty — Symptom is a Markdown section (## Symptom), not a header-
  // table field, so that line silently never populated anything; fixed here
  // to read the actual parsed section (b.retrievalSections['Symptom'],
  // added to parseProductDocs.js's parseRecordFile in this same pass).
  for (const [id, b] of parsed.bugs) {
    const symptom = (b.retrievalSections && b.retrievalSections['Symptom']) || '';
    const rootCause = (b.retrievalSections && b.retrievalSections['Root Cause']) || '';
    records.push(rec('bug', id, b.name, b.filePath, {
      keywords: keywordsFrom(b.name, symptom, rootCause),
      summary: symptom,
      detail: rootCause,
      relatedIds: require('./ids').extractIds(String(b.header['Related feature(s)'] || ''), 'feature'),
      evidenceStatus: b.header['Evidence status'] || 'Evidence pending',
    }));
  }

  // Decision keywords draw from Context + Decision (the approved
  // "problem/context/reason" plus "the actual chosen decision") —
  // explicitly NOT Options Considered (rejected-alternative terminology
  // must not win an ordinary semantic match — Decision 2's explicit
  // exclusion).
  for (const [id, d] of parsed.decisions) {
    const context = (d.retrievalSections && d.retrievalSections['Context']) || '';
    const decisionText = (d.retrievalSections && d.retrievalSections['Decision']) || '';
    records.push(rec('decision', id, d.name, d.filePath, {
      keywords: keywordsFrom(d.name, context, decisionText),
      summary: context,
      detail: decisionText,
      relatedIds: require('./ids').extractIds(String(d.header['Related feature(s) / roadmap milestone'] || ''), 'feature'),
      evidenceStatus: d.header['Evidence status'] || 'Evidence pending',
    }));
  }

  // Postmortem keywords draw from Summary + Impact + Root Cause (the
  // approved "concise incident summary / impact / root-cause-defining
  // content").
  for (const [id, p] of parsed.postmortems) {
    const pmSummary = (p.retrievalSections && p.retrievalSections['Summary']) || '';
    const impact = (p.retrievalSections && p.retrievalSections['Impact']) || '';
    const pmRootCause = (p.retrievalSections && p.retrievalSections['Root Cause']) || '';
    records.push(rec('postmortem', id, p.name, p.filePath, {
      keywords: keywordsFrom(p.name, pmSummary, impact, pmRootCause),
      summary: pmSummary,
      detail: pmRootCause,
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
