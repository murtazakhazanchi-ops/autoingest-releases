'use strict';

const fs = require('fs');
const path = require('path');
const { PRODUCT_DOCS_ROOT } = require('./repoRoot');
const md = require('./markdown');
const ids = require('./ids');

function listMarkdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'generated' || entry.name === 'exports' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listMarkdownFiles(full));
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function relPath(absPath, root) {
  return path.relative(root || PRODUCT_DOCS_ROOT, absPath).split(path.sep).join('/');
}

function readFile(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

// ── Registry (01_FEATURE_REGISTRY.md): category -> ordered [{id, name, status, maturity, parent, roadmap, doc}] ──
function parseRegistry(content) {
  const headings = md.extractHeadings(content).filter((h) => h.level === 2);
  const categories = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    if (h.text === 'Totals' || h.text.startsWith('Cross-Cutting') || h.text.startsWith('Reconciliation')) continue;
    const next = headings[i + 1];
    const sectionLines = lines.slice(h.line, next ? next.line - 1 : lines.length);
    const rows = md.parseFirstTable(sectionLines.join('\n'));
    const features = [];
    for (const row of rows) {
      if (row.length < 7 || row[0] === 'ID') continue;
      const idMatch = /AI-FEAT-\d{3}/.exec(row[0]);
      if (!idMatch) continue;
      features.push({
        id: idMatch[0],
        name: row[1],
        status: row[2],
        maturity: row[3],
        parent: row[4],
        roadmap: row[5],
        doc: row[6],
      });
    }
    if (features.length) categories.push({ category: h.text, features });
  }
  return categories;
}

// ── Roadmap (02_MASTER_ROADMAP.md): [{id, name, header:{...}}] ──
function parseRoadmap(content) {
  const headings = md.extractHeadings(content).filter((h) => h.level === 2);
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const milestones = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const m = /^(AI-RM-\d{3})\s*—\s*(.+)$/.exec(h.text);
    if (!m) continue;
    const next = headings[i + 1];
    const sectionLines = lines.slice(h.line, next ? next.line - 1 : lines.length).join('\n');
    milestones.push({ id: m[1], name: m[2], header: md.extractHeaderTable(sectionLines) });
  }
  return milestones;
}

// ── Architectural evolution (11_ARCHITECTURAL_EVOLUTION.md): relationship map rows ──
// The §5 Relationship Map table's "Architectural stage" cells use short prose
// ("§3A Adobe Bridge workflow...") that does not textually match the actual
// "### A. Established Adobe Bridge Workflow..." H3 headings — both cite the
// same §3<letter> subsection by construction (11_ARCHITECTURAL_EVOLUTION.md's
// own §3/§5 numbering scheme), so the letter prefix is the reliable join key.
function parseArchEvolutionRelationshipMap(content) {
  const section = md.extractSection(content, '5. Relationship Map');
  if (!section) return [];
  const rows = md.parseFirstTable(section);
  const headings = md.extractHeadings(content).filter((h) => h.level === 3);
  const headingsByLetter = new Map();
  for (const h of headings) {
    const m = /^([A-Z])\./.exec(h.text);
    if (m) headingsByLetter.set(m[1], h);
  }
  const out = [];
  for (const row of rows) {
    if (row.length < 3 || row[0] === 'Stage' || row[0] === 'Architectural stage') continue;
    const letterMatch = /§3([A-Z])/.exec(row[0]);
    const heading = letterMatch ? headingsByLetter.get(letterMatch[1]) : null;
    out.push({
      stage: row[0],
      anchorSlug: heading ? heading.slug : null,
      features: ids.extractIds(row[1], 'feature'),
      records: {
        bugs: ids.extractIds(row[3] || '', 'bug'),
        decisions: ids.extractIds(row[3] || '', 'decision'),
        postmortems: ids.extractIds(row[3] || '', 'postmortem'),
      },
    });
  }
  return out;
}

// Part 2 remediation (Decision 2) — the retrieval-surface fields approved
// per record family: Bug = Symptom + Root Cause ("concise defect-defining
// content"); Decision = Context + Decision ("problem/context/reason" plus
// "the actual chosen decision where necessary" — Options Considered is
// explicitly excluded per Decision 2, since rejected-alternative prose could
// wrongly win a match for something not chosen); Postmortem = Summary +
// Impact + Root Cause. Investigation Log/Fix/Prevention (bugs), Consequences/
// Reconciliation Note (decisions), and Timeline/Resolution/Follow-up Actions
// (postmortems) are deliberately excluded — either historical/fix-mechanics
// detail or forward-looking advisory content, not "what identifies this
// record," mirroring the same boundary already drawn for Features'
// Evolution Journal exclusion. See docs/product/07_BUG_TEMPLATE.md,
// 08_DECISION_TEMPLATE.md, 09_POSTMORTEM_TEMPLATE.md for the section names
// this extracts from.
const RETRIEVAL_SECTIONS_BY_FAMILY = {
  bug: ['Symptom', 'Root Cause'],
  decision: ['Context', 'Decision'],
  postmortem: ['Summary', 'Impact', 'Root Cause'],
};

function parseRecordFile(absPath, family, root) {
  const content = readFile(absPath);
  const header = md.extractHeaderTable(content);
  const idMatch = new RegExp(ids.ID_PATTERNS[family].source).exec(path.basename(absPath));
  const id = idMatch ? idMatch[0] : null;
  const nameMatch = /^#\s+\S+\s*—\s*(.+)$/m.exec(content);
  const retrievalSectionNames = RETRIEVAL_SECTIONS_BY_FAMILY[family] || [];
  const retrievalSections = {};
  for (const sectionName of retrievalSectionNames) {
    retrievalSections[sectionName] = md.extractSection(content, sectionName) || '';
  }
  return {
    id,
    name: nameMatch ? nameMatch[1].trim() : path.basename(absPath, '.md'),
    filePath: relPath(absPath, root),
    header,
    body: content,
    headings: md.extractHeadings(content),
    allIds: ids.extractAllIds(content),
    related: md.extractSection(content, 'Related'),
    // Keyed by exact section name (e.g. retrievalSections['Symptom']) so
    // callers don't need to know per-family which sections exist.
    retrievalSections,
  };
}

function parseFeatureFile(absPath, root) {
  const content = readFile(absPath);
  const header = md.extractHeaderTable(content);
  const lifecycle = md.extractSectionTable(content, 'Lifecycle Metadata') || {};
  const idMatch = /AI-FEAT-\d{3}/.exec(path.basename(absPath));
  const nameMatch = /^#\s+AI-FEAT-\d{3}\s*—\s*(.+)$/m.exec(content);
  const relatedFilesSection = md.extractSection(content, 'Related Files');
  const relatedFiles = md.extractBulletList(relatedFilesSection).map((item) => {
    const m = /`([^`]+)`/.exec(item);
    return m ? m[1] : null;
  }).filter(Boolean);
  return {
    id: idMatch ? idMatch[0] : null,
    name: nameMatch ? nameMatch[1].trim() : path.basename(absPath, '.md'),
    filePath: relPath(absPath, root),
    header,
    lifecycle,
    summary: md.extractSection(content, 'Summary'),
    currentBehavior: md.extractSection(content, 'Current Behavior'),
    evolutionJournal: md.extractSection(content, 'Evolution / Implementation Journal'),
    engineeringEvolution: md.extractSection(content, 'Engineering Evolution'),
    knownBugsSection: md.extractSection(content, 'Known Bugs / Troubleshooting'),
    decisionsSection: md.extractSection(content, 'Decisions'),
    futureEnhancements: md.extractSection(content, 'Future Enhancements'),
    relatedFiles,
    headings: md.extractHeadings(content),
    allIds: ids.extractAllIds(content),
    body: content,
  };
}

// Stage 2 — docs/product/workflows/AI-WF-###_NAME.md. Same generic
// header-table + named-section extraction pattern as parseFeatureFile,
// specialized for Workflow's own section names (see
// docs/product/19_WORKFLOW_TEMPLATE.md). Steps is an ORDERED list — the only
// place in this tool that needs md.extractNumberedList instead of
// extractBulletList, since step order is meaningful content, not incidental.
function parseWorkflowFile(absPath, root) {
  const content = readFile(absPath);
  const header = md.extractHeaderTable(content);
  const idMatch = /AI-WF-\d{3}/.exec(path.basename(absPath));
  const nameMatch = /^#\s+AI-WF-\d{3}\s*—\s*(.+)$/m.exec(content);
  return {
    id: idMatch ? idMatch[0] : null,
    name: nameMatch ? nameMatch[1].trim() : path.basename(absPath, '.md'),
    filePath: relPath(absPath, root),
    header,
    whatItDoes: md.extractSection(content, 'What It Does'),
    whenToUseIt: md.extractSection(content, 'When To Use It'),
    beforeYouStart: md.extractSection(content, 'Before You Start'),
    whereToGo: md.extractSection(content, 'Where To Go'),
    steps: md.extractNumberedList(md.extractSection(content, 'Steps')),
    expectedResult: md.extractSection(content, 'What Happens Next / Expected Result'),
    limitations: md.extractSection(content, 'Important Limitations'),
    warnings: md.extractSection(content, 'Warnings'),
    troubleshooting: md.extractSection(content, 'Troubleshooting'),
    relatedActions: md.extractSection(content, 'Related Actions'),
    source: md.extractSection(content, 'Source'),
    headings: md.extractHeadings(content),
    allIds: ids.extractAllIds(content),
    body: content,
  };
}

function loadAll(root) {
  root = root || PRODUCT_DOCS_ROOT;
  const registryPath = path.join(root, '01_FEATURE_REGISTRY.md');
  const roadmapPath = path.join(root, '02_MASTER_ROADMAP.md');
  const dashboardPath = path.join(root, '04_PROJECT_DASHBOARD.md');
  const archPath = path.join(root, '11_ARCHITECTURAL_EVOLUTION.md');
  const changelogPath = path.join(root, '10_CHANGELOG.md');

  const registryContent = readFile(registryPath);
  const roadmapContent = readFile(roadmapPath);
  const dashboardContent = readFile(dashboardPath);
  const archContent = readFile(archPath);

  const featureDir = path.join(root, 'features');
  const bugDir = path.join(root, 'bugs');
  const decisionDir = path.join(root, 'decisions');
  const postmortemDir = path.join(root, 'postmortems');
  // Part 6 — docs/product/memory/ is optional: a repository checked out
  // before Part 6 (or a Part 4/5 test fixture that predates it) has no such
  // directory, and that must not be a parse error — see
  // docs/product/16_ENGINEERING_MEMORY_POLICY.md § 5.
  const memoryDir = path.join(root, 'memory');
  // Part 8 — docs/product/conversations/ is optional for the same reason.
  // See docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 5.
  const conversationDir = path.join(root, 'conversations');
  // Stage 2 — docs/product/workflows/ is optional for the same reason (a
  // repository checked out before Stage 2 has no such directory).
  const workflowDir = path.join(root, 'workflows');

  const featureFiles = fs.readdirSync(featureDir).filter((f) => f.endsWith('.md')).sort();
  const bugFiles = fs.readdirSync(bugDir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
  const decisionFiles = fs.readdirSync(decisionDir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
  const postmortemFiles = fs.readdirSync(postmortemDir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
  const memoryFiles = fs.existsSync(memoryDir)
    ? fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md') && f !== 'README.md' && f !== 'INDEX.md').sort()
    : [];
  const conversationFiles = fs.existsSync(conversationDir)
    ? fs.readdirSync(conversationDir).filter((f) => f.endsWith('.md') && f !== 'README.md' && f !== 'INDEX.md' && f !== 'CHATGPT_HANDOFF.md').sort()
    : [];
  const workflowFiles = fs.existsSync(workflowDir)
    ? fs.readdirSync(workflowDir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()
    : [];

  // idFilesSeen tracks every (id -> [filePath, ...]) pairing BEFORE collapsing
  // into the by-id Maps below, so duplicate-ID detection (validators.js
  // checkDuplicateIds) can see a real same-ID collision across two files of
  // the SAME kind — the Maps themselves necessarily collapse duplicates to
  // last-write-wins. idRowsSeen tracks the separate case of two rows sharing
  // an ID within 01_FEATURE_REGISTRY.md / 02_MASTER_ROADMAP.md. One file plus
  // one row for the same ID is the expected, correct structure — not a
  // duplicate — so files and rows are deliberately never merged into one group.
  const idFilesSeen = { feature: new Map(), bug: new Map(), decision: new Map(), postmortem: new Map(), memory: new Map(), conversation: new Map(), workflow: new Map() };
  const idRowsSeen = { feature: new Map(), roadmap: new Map() };
  const recordSeen = (bucket, family, id, location) => {
    if (!id) return;
    if (!bucket[family].has(id)) bucket[family].set(id, []);
    bucket[family].get(id).push(location);
  };

  const features = new Map();
  for (const f of featureFiles) {
    const parsed = parseFeatureFile(path.join(featureDir, f), root);
    recordSeen(idFilesSeen, 'feature', parsed.id, parsed.filePath);
    if (parsed.id) features.set(parsed.id, parsed);
  }

  const bugs = new Map();
  for (const f of bugFiles) {
    const parsed = parseRecordFile(path.join(bugDir, f), 'bug', root);
    recordSeen(idFilesSeen, 'bug', parsed.id, parsed.filePath);
    if (parsed.id) bugs.set(parsed.id, parsed);
  }

  const decisions = new Map();
  for (const f of decisionFiles) {
    const parsed = parseRecordFile(path.join(decisionDir, f), 'decision', root);
    recordSeen(idFilesSeen, 'decision', parsed.id, parsed.filePath);
    if (parsed.id) decisions.set(parsed.id, parsed);
  }

  const postmortems = new Map();
  for (const f of postmortemFiles) {
    const parsed = parseRecordFile(path.join(postmortemDir, f), 'postmortem', root);
    recordSeen(idFilesSeen, 'postmortem', parsed.id, parsed.filePath);
    if (parsed.id) postmortems.set(parsed.id, parsed);
  }

  // Part 6 — memory capsules reuse the same generic record-file parser
  // (header table + named sections) as bugs/decisions/postmortems; a
  // capsule's own header table uses "## Identity" as its first table, not a
  // bare top-of-file table, so parseRecordFile's extractHeaderTable (which
  // reads the FIRST table in the whole document) still finds it correctly
  // since Identity is the first section after the H1.
  const memory = new Map();
  for (const f of memoryFiles) {
    const parsed = parseRecordFile(path.join(memoryDir, f), 'memory', root);
    recordSeen(idFilesSeen, 'memory', parsed.id, parsed.filePath);
    if (parsed.id) memory.set(parsed.id, parsed);
  }

  // Part 8 — Engineering Conversations reuse the same generic record-file
  // parser as bugs/decisions/postmortems/memory. A conversation's own header
  // table uses "## Identity" as its first table, same as a memory capsule.
  const conversations = new Map();
  for (const f of conversationFiles) {
    const parsed = parseRecordFile(path.join(conversationDir, f), 'conversation', root);
    recordSeen(idFilesSeen, 'conversation', parsed.id, parsed.filePath);
    if (parsed.id) conversations.set(parsed.id, parsed);
  }

  // Stage 2 — Workflow records reuse parseWorkflowFile (its own dedicated
  // section extractor, not the generic parseRecordFile — Workflow's section
  // names/shapes are specific to it, particularly the ordered Steps list).
  const workflows = new Map();
  for (const f of workflowFiles) {
    const parsed = parseWorkflowFile(path.join(workflowDir, f), root);
    recordSeen(idFilesSeen, 'workflow', parsed.id, parsed.filePath);
    if (parsed.id) workflows.set(parsed.id, parsed);
  }

  const registryCategories = parseRegistry(registryContent);
  const categoryByFeatureId = new Map();
  for (const cat of registryCategories) {
    for (const feat of cat.features) {
      categoryByFeatureId.set(feat.id, cat.category);
      recordSeen(idRowsSeen, 'feature', feat.id, `${relPath(registryPath, root)} (${cat.category} row)`);
    }
  }

  const roadmapMilestones = parseRoadmap(roadmapContent);
  const roadmap = new Map();
  for (const m of roadmapMilestones) {
    recordSeen(idRowsSeen, 'roadmap', m.id, relPath(roadmapPath, root));
    roadmap.set(m.id, m);
  }

  const archRelationshipMap = parseArchEvolutionRelationshipMap(archContent);
  const archHeadings = md.extractHeadings(archContent).filter((h) => h.level === 3);

  const allFiles = listMarkdownFiles(root).map((absPath) => {
    const content = readFile(absPath);
    return {
      absPath,
      relPath: relPath(absPath, root),
      content,
      headings: md.extractHeadings(content),
      links: md.extractLinks(content),
    };
  });

  return {
    root,
    idFilesSeen,
    idRowsSeen,
    registryPath: relPath(registryPath, root),
    roadmapPath: relPath(roadmapPath, root),
    dashboardPath: relPath(dashboardPath, root),
    archPath: relPath(archPath, root),
    changelogPath: relPath(changelogPath, root),
    registryCategories,
    categoryByFeatureId,
    dashboardHeader: md.extractHeaderTable(dashboardContent),
    roadmap,
    roadmapOrder: roadmapMilestones.map((m) => m.id),
    archRelationshipMap,
    archHeadings,
    features,
    bugs,
    decisions,
    postmortems,
    memory,
    memoryDirExists: fs.existsSync(memoryDir),
    conversations,
    conversationDirExists: fs.existsSync(conversationDir),
    workflows,
    workflowDirExists: fs.existsSync(workflowDir),
    allFiles,
  };
}

module.exports = {
  loadAll,
  parseWorkflowFile,
  parseRegistry,
  parseRoadmap,
  parseFeatureFile,
  parseRecordFile,
  parseArchEvolutionRelationshipMap,
  listMarkdownFiles,
  relPath,
};
