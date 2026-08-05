'use strict';

const path = require('path');

// Hand-curated alias vocabulary per registry category, grounded in the actual
// feature names in that category (01_FEATURE_REGISTRY.md). Not invented terms —
// each alias is either a synonym already used in docs/product/ prose or a
// direct rewording of a member feature's own name. Extend deliberately, not
// by guessing.
const CATEGORY_ALIASES = {
  'Application Platform': ['electron shell', 'security model', 'settings store', 'auto-update', 'telemetry'],
  'Product UI': ['design system', 'ui consistency'],
  'Event Management': ['event creation', 'event editing', 'event.json'],
  'Source Acquisition': ['source detection', 'source selection', 'memory card', 'external drive', 'dcim'],
  'Media Browsing': ['file browser', 'thumbnail', 'media preview', 'media grid'],
  'Grouping and Routing': ['grouping', 'group manager', 'import routing'],
  'Import and Archive Writing': [
    'import pipeline', 'copy engine', 'duplicate detection', 'atomic import', 'photographer folder',
    'quick import', 'source cleanup', 'checksum verification', 'audit integrity', 'activity log',
  ],
  Metadata: [
    'metadata writing', 'exif', 'iptc', 'xmp', 'xmp sidecars', 'raw metadata', 'metadata queue',
    'metadata audit', 'metadata repair', 'metadata audit repair', 'keyword registry', 'metadata reapply',
    'metadata sync', 'metadata verification',
  ],
  'Transfer and Backup': ['transfer export', 'transfer import', 'backup update', 'transfer background'],
  'Archive Operations': [
    'archive root', 'archive root resolution', 'archive health', 'local-first sync', 'stale locks',
    'lock handling', 'archive folder adoption',
  ],
  'Special Workflows': ['qmz', 'qmz sequencing'],
  'Collaboration and Realtime Coordination': ['realtime presence', 'team presence', 'online registry'],
  'Planned Archive Management': ['archive maintenance', 'event maintenance'],
  'Search and Discovery': ['global search'],
  'Reliability and Recovery': ['integrity verification'],
  'Analytics and Intelligence': ['archive analytics', 'ai archive intelligence'],
};

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function parseRelatedTechnicalDocs(raw) {
  if (!raw) return [];
  if (/^(none\b|—$|-$)/i.test(raw.trim())) return [];
  return raw
    .split(',')
    .map((s) => s.trim().replace(/`/g, '').replace(/\s*\([^)]*\)\s*$/, '').trim())
    .filter(Boolean);
}

// Builds one subsystem per registry category. Source files/dirs are derived
// ONLY from each member feature's own authored "Related Files" section
// (explicit evidence) — never inferred from filename/keyword similarity.
function buildSubsystems(parsed) {
  const subsystems = [];
  for (const cat of parsed.registryCategories) {
    const id = 'SUBSYS-' + slug(cat.category);
    const memberIds = cat.features.map((f) => f.id).sort(require('./ids').compareIds);
    const sourceFiles = new Set();
    const sourceDirs = new Set();
    const canonicalDocs = new Set();
    const bugs = new Set();
    const decisions = new Set();
    for (const featId of memberIds) {
      const feat = parsed.features.get(featId);
      if (!feat) continue;
      for (const f of feat.relatedFiles) {
        sourceFiles.add(f);
        sourceDirs.add(path.dirname(f) === '.' ? f : path.dirname(f));
      }
      for (const doc of parseRelatedTechnicalDocs(feat.header['Related technical docs'])) {
        canonicalDocs.add(doc);
      }
      for (const b of (feat.lifecycle['Related bugs'] || feat.allIds.bug || [])) {
        for (const bugId of require('./ids').extractIds(String(b), 'bug')) bugs.add(bugId);
      }
      for (const d of (feat.lifecycle['Related decisions'] || feat.allIds.decision || [])) {
        for (const decId of require('./ids').extractIds(String(d), 'decision')) decisions.add(decId);
      }
    }
    subsystems.push({
      id,
      name: cat.category,
      aliases: CATEGORY_ALIASES[cat.category] || [],
      primaryFeatures: memberIds,
      canonicalProductDoc: 'docs/product/01_FEATURE_REGISTRY.md',
      canonicalTechnicalDocs: Array.from(canonicalDocs).sort(),
      sourceDirectories: Array.from(sourceDirs).sort(),
      sourceFiles: Array.from(sourceFiles).sort(),
      relatedBugs: Array.from(bugs).sort(),
      relatedDecisions: Array.from(decisions).sort(),
      changeImpactChecklist: [
        'Re-read the Related Files section of every primary feature listed above before changing shared source files.',
        'Check relatedBugs/relatedDecisions for constraints before altering resolver or write-path behavior.',
        `Run: node scripts/product-docs/cli.js impact <changed-file-path> to confirm ownership before editing.`,
      ],
    });
  }
  return subsystems;
}

// Inverted index: sourceFile -> [subsystemId], sourceDir -> [subsystemId].
// A file may legitimately belong to more than one subsystem (shared ownership
// is represented explicitly, never collapsed to a single "owner").
function buildSourceIndex(subsystems) {
  const byFile = new Map();
  const byDir = new Map();
  for (const s of subsystems) {
    for (const f of s.sourceFiles) {
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(s.id);
    }
    for (const d of s.sourceDirectories) {
      if (!byDir.has(d)) byDir.set(d, []);
      byDir.get(d).push(s.id);
    }
  }
  return { byFile, byDir };
}

module.exports = { buildSubsystems, buildSourceIndex, parseRelatedTechnicalDocs, CATEGORY_ALIASES };
