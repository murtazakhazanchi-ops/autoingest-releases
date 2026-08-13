'use strict';

const fs = require('fs');
const path = require('path');
const { compareIds, extractIds } = require('./ids');
const { slugify } = require('./markdown');

const VALID_STATUSES = new Set([
  'Implemented', 'Implemented — evolving', 'Partially implemented', 'In active development',
  'Planned', 'Deferred', 'Deprecated', 'Superseded',
]);
const VALID_MATURITIES = new Set(['Foundational', 'Stable', 'Operational', 'Evolving', 'Experimental', 'Planned']);

function finding(level, rule, message, file, note) {
  return { level, rule, message, file: file || null, note: note || null };
}

// Rule 1 — Duplicate IDs. Reads parsed.idFilesSeen (files) and parsed.idRowsSeen
// (registry/roadmap table rows) SEPARATELY — both are recorded BEFORE
// parseProductDocs.loadAll() collapses same-ID entries into its by-id Maps,
// since the Maps alone can never reveal a same-ID collision (Map construction
// silently keeps only the last write). One file plus one row for the same ID
// is the expected, correct structure, not a duplicate, so the two are never
// merged into a single group — see parseProductDocs.js's own comment on this.
function checkDuplicateIds(parsed) {
  const findings = [];
  for (const family of Object.keys(parsed.idFilesSeen)) {
    for (const [id, files] of parsed.idFilesSeen[family]) {
      if (files.length > 1) {
        findings.push(finding('error', 'duplicate-id', `ID ${id} assigned to ${files.length} files`, files.join(', ')));
      }
    }
  }
  for (const family of Object.keys(parsed.idRowsSeen)) {
    for (const [id, rows] of parsed.idRowsSeen[family]) {
      if (rows.length > 1) {
        findings.push(finding('error', 'duplicate-id', `ID ${id} assigned to ${rows.length} rows`, rows.join(', ')));
      }
    }
  }
  return findings;
}

// Registry/file mismatches: every feature file must have exactly one
// corresponding 01_FEATURE_REGISTRY.md row, and vice versa.
function checkRegistryFileMismatch(parsed) {
  const findings = [];
  const fileIds = new Set(parsed.idFilesSeen.feature.keys());
  const rowIds = new Set(parsed.idRowsSeen.feature.keys());
  for (const id of fileIds) {
    if (!rowIds.has(id)) findings.push(finding('error', 'registry-file-mismatch', `${id} has a features/ file but no row in 01_FEATURE_REGISTRY.md`, parsed.idFilesSeen.feature.get(id).join(', ')));
  }
  for (const id of rowIds) {
    if (!fileIds.has(id)) findings.push(finding('error', 'registry-file-mismatch', `${id} has a 01_FEATURE_REGISTRY.md row but no features/ file`, parsed.idRowsSeen.feature.get(id).join(', ')));
  }
  return findings;
}

// Rule 2 — Broken links and anchors
function checkLinks(parsed) {
  const findings = [];
  const byRelPath = new Map(parsed.allFiles.map((f) => [f.relPath, f]));
  for (const f of parsed.allFiles) {
    for (const link of f.links) {
      if (!link.path) {
        if (link.anchor) {
          const seen = new Map();
          const slugs = f.headings.map((h) => slugify(h.text, seen));
          if (!slugs.includes(link.anchor)) {
            findings.push(finding('error', 'broken-anchor', `#${link.anchor} does not resolve in ${f.relPath}`, `${f.relPath}:${link.line}`));
          }
        }
        continue;
      }
      const targetAbs = path.normalize(path.join(path.dirname(f.absPath), link.path));
      const targetRel = path.relative(parsed.root, targetAbs).split(path.sep).join('/');
      if (!fs.existsSync(targetAbs)) {
        findings.push(finding('error', 'broken-link', `Link to '${link.path}' does not resolve`, `${f.relPath}:${link.line}`));
        continue;
      }
      if (link.anchor) {
        const target = byRelPath.get(targetRel);
        if (target) {
          const seen = new Map();
          const slugs = target.headings.map((h) => slugify(h.text, seen));
          if (!slugs.includes(link.anchor)) {
            findings.push(finding('error', 'broken-anchor', `#${link.anchor} does not resolve in ${targetRel}`, `${f.relPath}:${link.line}`));
          }
        }
      }
    }
  }
  return findings;
}

// Rule 3 — Missing roadmap references
function checkRoadmapReferences(parsed) {
  const findings = [];
  for (const [id, feat] of parsed.features) {
    for (const rm of extractIds(String(feat.header['Related roadmap milestone'] || ''), 'roadmap')) {
      if (!parsed.roadmap.has(rm)) {
        findings.push(finding('error', 'missing-roadmap-reference', `${id} cites nonexistent milestone ${rm}`, feat.filePath));
      }
    }
  }
  for (const [rmId, m] of parsed.roadmap) {
    for (const featId of extractIds(String(m.header['Included AI-FEAT IDs'] || ''), 'feature')) {
      if (!parsed.features.has(featId)) {
        findings.push(finding('error', 'missing-feature-in-roadmap', `${rmId} includes nonexistent feature ${featId}`, parsed.roadmapPath));
      }
    }
  }
  return findings;
}

// Rule 4 — Missing feature references (bugs/decisions/postmortems/architecture)
function checkFeatureReferences(parsed) {
  const findings = [];
  const check = (idList, source, filePath) => {
    for (const id of idList) {
      if (!parsed.features.has(id)) {
        findings.push(finding('error', 'missing-feature-reference', `${source} cites nonexistent feature ${id}`, filePath));
      }
    }
  };
  for (const [id, b] of parsed.bugs) check(extractIds(String(b.header['Related feature(s)'] || ''), 'feature'), id, b.filePath);
  for (const [id, d] of parsed.decisions) check(extractIds(String(d.header['Related feature(s) / roadmap milestone'] || ''), 'feature'), id, d.filePath);
  for (const [id, p] of parsed.postmortems) check(extractIds(String(p.header['Related feature(s)'] || ''), 'feature'), id, p.filePath);
  for (const row of parsed.archRelationshipMap) check(row.features, row.stage, parsed.archPath);
  return findings;
}

// Stage 2 — Workflow reference integrity. Mirrors checkFeatureReferences'
// pattern: every AI-FEAT/AI-WF ID a Workflow record cites must exist, and
// every Workflow must cite at least one real capability (an orphan Workflow
// with no capability grounding is exactly the kind of drift this system's
// evidence discipline exists to catch).
function checkWorkflowReferences(parsed) {
  const findings = [];
  if (!parsed.workflows) return findings;
  for (const [id, w] of parsed.workflows) {
    const relatedCaps = extractIds(String(w.header['Related capabilities'] || ''), 'feature');
    const relatedRoadmap = extractIds(String(w.header['Related roadmap milestone'] || ''), 'roadmap');
    if (relatedCaps.length === 0) {
      findings.push(finding('error', 'orphan-workflow', `${id} cites no valid Related capability`, w.filePath));
    }
    for (const featId of relatedCaps) {
      if (!parsed.features.has(featId)) {
        findings.push(finding('error', 'missing-feature-reference', `${id} cites nonexistent feature ${featId}`, w.filePath));
      }
    }
    for (const rmId of relatedRoadmap) {
      if (!parsed.roadmap.has(rmId)) {
        findings.push(finding('error', 'missing-roadmap-reference', `${id} cites nonexistent roadmap milestone ${rmId}`, w.filePath));
      }
    }
    const relatedWfIds = extractIds(String(w.relatedActions || ''), 'workflow');
    for (const wfId of relatedWfIds) {
      if (wfId !== id && !parsed.workflows.has(wfId)) {
        findings.push(finding('error', 'missing-workflow-reference', `${id}'s Related Actions cites nonexistent workflow ${wfId}`, w.filePath));
      }
    }
    const navVerified = String(w.header['Navigation verified'] || '').trim();
    if (!/^(Yes|Partial|Not verified in this pass)$/.test(navVerified)) {
      findings.push(finding('warning', 'workflow-navigation-vocabulary', `${id}'s "Navigation verified" field ("${navVerified}") is not one of the expected values (Yes / Partial / Not verified in this pass)`, w.filePath));
    }
    if (!w.steps || w.steps.length === 0) {
      findings.push(finding('information', 'workflow-no-steps', `${id} has no ordered Steps recorded`, w.filePath));
    }
  }
  return findings;
}

// Rules 5-7 — Orphan bugs / decisions / postmortems
function checkOrphans(parsed) {
  const findings = [];
  for (const [id, b] of parsed.bugs) {
    if (extractIds(String(b.header['Related feature(s)'] || ''), 'feature').length === 0) {
      findings.push(finding('error', 'orphan-bug', `${id} cites no valid feature`, b.filePath));
    }
  }
  for (const [id, d] of parsed.decisions) {
    const raw = String(d.header['Related feature(s) / roadmap milestone'] || '');
    if (extractIds(raw, 'feature').length === 0 && extractIds(raw, 'roadmap').length === 0) {
      findings.push(finding('error', 'orphan-decision', `${id} cites no valid feature or milestone`, d.filePath));
    }
  }
  for (const [id, p] of parsed.postmortems) {
    if (extractIds(String(p.header['Related feature(s)'] || ''), 'feature').length === 0) {
      findings.push(finding('error', 'orphan-postmortem', `${id} cites no valid feature`, p.filePath));
    }
  }
  return findings;
}

// Rule 8 — Architecture links (hard: bad citation already covered by checkFeatureReferences;
// soft: features with zero architectural-evolution placement — informational)
function checkArchitectureCoverage(parsed) {
  const findings = [];
  const placed = new Set();
  for (const row of parsed.archRelationshipMap) for (const f of row.features) placed.add(f);
  const unplaced = Array.from(parsed.features.keys()).filter((id) => !placed.has(id)).sort(compareIds);
  findings.push(finding('information', 'architecture-coverage', `${placed.size}/${parsed.features.size} features placed in the architectural-evolution relationship map`, parsed.archPath, unplaced.length ? `Unplaced: ${unplaced.join(', ')}` : null));
  return findings;
}

// Rule 9 — Missing changelog references (best-effort: every dated changelog
// section should be discoverable; this does not shell out to `git log` by
// default since that's a Part 4 tooling addition, not the original spec's rule —
// callers may pass gitDocsCommits for the fuller cross-reference.
function checkChangelogCoverage(parsed, gitDocsCommits) {
  const findings = [];
  if (!gitDocsCommits) return findings;
  const changelogContent = parsed.allFiles.find((f) => f.relPath === '10_CHANGELOG.md').content;
  for (const commit of gitDocsCommits) {
    const dateInSubject = /(\d{4}-\d{2}-\d{2})/.exec(commit.date || '');
    const date = dateInSubject ? dateInSubject[1] : null;
    if (date && !changelogContent.includes(date)) {
      findings.push(finding('warning', 'missing-changelog-entry', `Commit ${commit.short} (${commit.date}) touches docs/product/ with no matching 10_CHANGELOG.md date section`, '10_CHANGELOG.md', commit.subject));
    }
  }
  return findings;
}

// Rule 10 — Implemented features without documentation
function checkImplementedDocumentation(parsed) {
  const findings = [];
  for (const [id, feat] of parsed.features) {
    const status = feat.header['Status'] || '';
    if (!/^Implemented/.test(status)) continue;
    const behaviorEmpty = !feat.currentBehavior || /evidence pending/i.test(feat.currentBehavior);
    const filesEmpty = feat.relatedFiles.length === 0;
    if (behaviorEmpty && filesEmpty) {
      findings.push(finding('error', 'implemented-without-documentation', `${id} is Implemented but has no Current Behavior or Related Files`, feat.filePath));
    }
  }
  return findings;
}

// Rule 11 — Planned features missing roadmap entries
function checkPlannedRoadmap(parsed) {
  const findings = [];
  for (const [id, feat] of parsed.features) {
    if ((feat.header['Status'] || '') !== 'Planned') continue;
    const rm = extractIds(String(feat.header['Related roadmap milestone'] || ''), 'roadmap');
    if (rm.length === 0 || !rm.every((r) => parsed.roadmap.has(r))) {
      findings.push(finding('error', 'planned-missing-roadmap', `${id} is Planned but has no valid roadmap milestone`, feat.filePath));
    }
  }
  return findings;
}

// Rule 12 — Roadmap inconsistencies (roadmap vs dashboard vs registry status agreement)
function checkRoadmapConsistency(parsed) {
  const findings = [];
  const dash = parsed.dashboardHeader;
  const completedInDash = extractIds(String(dash['Completed roadmap milestones'] || ''), 'roadmap');
  const currentInDash = extractIds(String(dash['Current roadmap milestone'] || ''), 'roadmap');
  for (const [rmId, m] of parsed.roadmap) {
    const status = String(m.header['Status'] || '');
    const isCompleteInRoadmap = /Completed/i.test(status);
    const isCompleteInDash = completedInDash.includes(rmId);
    if (isCompleteInRoadmap !== isCompleteInDash) {
      findings.push(finding('error', 'roadmap-dashboard-disagreement', `${rmId} completion status disagrees between 02_MASTER_ROADMAP.md ("${status}") and 04_PROJECT_DASHBOARD.md`, parsed.dashboardPath));
    }
    if (isCompleteInRoadmap) {
      for (const featId of extractIds(String(m.header['Included AI-FEAT IDs'] || ''), 'feature')) {
        const feat = parsed.features.get(featId);
        if (feat && !/^Implemented/.test(feat.header['Status'] || '')) {
          findings.push(finding('error', 'completed-milestone-non-implemented-feature', `${rmId} is Completed but includes ${featId} with status "${feat.header['Status']}"`, feat.filePath));
        }
      }
    }
  }
  if (currentInDash.length && !currentInDash.every((r) => parsed.roadmap.has(r))) {
    findings.push(finding('error', 'dashboard-invalid-current-milestone', `04_PROJECT_DASHBOARD.md cites a current milestone not present in 02_MASTER_ROADMAP.md`, parsed.dashboardPath));
  }
  return findings;
}

// Rule 13 — Documentation completeness gaps (report only, never fails alone)
function checkDocumentationCompleteness(parsed) {
  const { countEvidenceGaps } = require('./featureIndex');
  const findings = [];
  for (const [id, feat] of parsed.features) {
    const gaps = countEvidenceGaps(feat.body);
    if (gaps > 0) {
      findings.push(finding('evidence_gap', 'documentation-completeness', `${id} has ${gaps} evidence-pending marker(s)`, feat.filePath));
    }
  }
  return findings;
}

// Part 4 additions beyond the original 13 specified rules ------------------

function checkVocabulary(parsed) {
  const findings = [];
  for (const [id, feat] of parsed.features) {
    const status = feat.header['Status'];
    if (status && !VALID_STATUSES.has(status)) {
      findings.push(finding('error', 'invalid-status-vocabulary', `${id} has non-standard Status "${status}"`, feat.filePath));
    }
    const maturity = feat.header['Maturity'];
    if (maturity && !VALID_MATURITIES.has(maturity)) {
      findings.push(finding('error', 'invalid-maturity-vocabulary', `${id} has non-standard Maturity "${maturity}"`, feat.filePath));
    }
  }
  return findings;
}

function checkEvidenceLabels(parsed) {
  const findings = [];
  for (const [id, feat] of parsed.features) {
    if (!feat.header['Evidence status']) {
      findings.push(finding('warning', 'missing-evidence-status', `${id} header table has no Evidence status field`, feat.filePath));
    }
  }
  return findings;
}

function checkLifecycleSections(parsed) {
  const findings = [];
  for (const [id, feat] of parsed.features) {
    if (Object.keys(feat.lifecycle).length === 0) {
      findings.push(finding('warning', 'missing-lifecycle-metadata', `${id} has no Lifecycle Metadata section`, feat.filePath));
    }
    if (!feat.engineeringEvolution) {
      findings.push(finding('warning', 'missing-engineering-evolution', `${id} has no Engineering Evolution section`, feat.filePath));
    }
  }
  return findings;
}

function checkRelatedTechnicalDocs(parsed) {
  const findings = [];
  for (const [id, feat] of parsed.features) {
    if (!/^Implemented/.test(feat.header['Status'] || '')) continue;
    if (!feat.header['Related technical docs'] || /^(none\b|—$|-$)/i.test(feat.header['Related technical docs'].trim())) {
      findings.push(finding('warning', 'missing-related-technical-docs', `${id} is Implemented but cites no Related technical docs`, feat.filePath));
    }
  }
  return findings;
}

function checkDuplicateAliases(authorityIndex) {
  const findings = [];
  const byAlias = new Map();
  for (const entry of authorityIndex) {
    for (const alias of entry.aliases) {
      const key = alias.toLowerCase();
      if (!byAlias.has(key)) byAlias.set(key, new Set());
      byAlias.get(key).add(entry.featureId);
    }
  }
  for (const [alias, featureIds] of byAlias) {
    if (featureIds.size > 1) {
      findings.push(finding('warning', 'ambiguous-alias', `Alias "${alias}" routes to ${featureIds.size} different features`, 'generated/authority-index.json', Array.from(featureIds).sort(compareIds).join(', ')));
    }
  }
  return findings;
}

function checkGraphIntegrity(graph) {
  const findings = [];
  for (const e of graph.danglingEdges) {
    findings.push(finding('error', 'invalid-dependency-edge', `Edge ${e.source} -[${e.relationship}]-> ${e.target} references a node that doesn't exist`, e.provenance_path));
  }
  // cycle detection restricted to depends_on edges only
  const adj = new Map();
  for (const e of graph.edges) {
    if (e.relationship !== 'depends_on') continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const cycles = [];
  function visit(node, stack) {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adj.get(node) || []) {
      if (color.get(next) === GRAY) {
        const idx = stack.indexOf(next);
        cycles.push(stack.slice(idx).concat(next));
      } else if (!color.get(next)) {
        visit(next, stack);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }
  for (const node of adj.keys()) {
    if (!color.get(node)) visit(node, []);
  }
  for (const cycle of cycles) {
    findings.push(finding('warning', 'cyclic-dependency', `Undocumented dependency cycle: ${cycle.join(' -> ')}`, 'generated/dependency-graph.json'));
  }
  return findings;
}

// Narrative-freshness spot check: docs/product/04_PROJECT_DASHBOARD.md is
// prose, not a structured field the other rules can cross-check, but a
// dashboard that still says "uncommitted" while the working tree is clean at
// HEAD is a real, concrete drift signal worth surfacing (found by hand during
// this Part 4 build; see docs/product/04_PROJECT_DASHBOARD.md line 9-11).
function checkDashboardNarrativeFreshness(parsed, gitIsDirty) {
  const findings = [];
  const dashFile = parsed.allFiles.find((f) => f.relPath === '04_PROJECT_DASHBOARD.md');
  if (dashFile && /uncommitted/i.test(dashFile.content) && !gitIsDirty) {
    findings.push(finding(
      'warning',
      'stale-dashboard-narrative',
      '04_PROJECT_DASHBOARD.md narrative mentions "uncommitted" documentation work, but the working tree has no uncommitted docs/product/ changes at HEAD — likely prose left over from before the referenced commit landed',
      '04_PROJECT_DASHBOARD.md',
    ));
  }
  return findings;
}

function checkSharedCodePaths(featureIndexRecords) {
  const findings = [];
  const byPath = new Map();
  for (const f of featureIndexRecords) {
    for (const p of f.related_code_paths) {
      if (!byPath.has(p)) byPath.set(p, []);
      byPath.get(p).push(f.feature_id);
    }
  }
  for (const [p, owners] of byPath) {
    if (owners.length > 1) {
      findings.push(finding('information', 'shared-code-path', `${p} is explicitly owned by ${owners.length} features (shared, not exclusive)`, p, owners.sort(compareIds).join(', ')));
    }
  }
  return findings;
}

// manifest.json's own `source_commit` field can structurally never be
// self-consistent for the commit that FIRST introduces a given rebuild: a
// commit's hash is computed from its tree (which includes manifest.json),
// so a `build` run before that commit necessarily embeds the commit's
// PARENT hash, one commit behind the hash the commit will actually get
// (found in Part 7 review — this made checkGeneratedFreshness permanently
// flag a freshly-committed, correctly-built manifest.json as stale, which
// would have made the Part 7A zero-touch hooks perpetually misfire on
// ordinary commits). checkManifestCommit already carries the dedicated,
// warning-level check for this exact field/drift; stale-generated-output
// compares everything else in manifest.json (and every other generated
// file) at full byte-for-byte strictness.
function manifestContentIgnoringSourceCommit(jsonText) {
  try {
    const parsed = JSON.parse(jsonText);
    delete parsed.source_commit;
    return JSON.stringify(parsed);
  } catch {
    return jsonText; // not valid JSON — fall through to a normal strict compare, which will correctly flag it
  }
}

// Stale-generated-output check: compares a freshly-built in-memory file map
// against what's currently committed under docs/product/generated/. Any
// difference means `build` must be re-run before this commit is trusted.
function checkGeneratedFreshness(freshFiles, generatedRoot) {
  const findings = [];
  if (!fs.existsSync(generatedRoot)) {
    findings.push(finding('information', 'no-generated-baseline', 'docs/product/generated/ does not exist yet — run `build` to create it', generatedRoot));
    return findings;
  }
  for (const [relPath, content] of freshFiles) {
    const onDisk = path.join(generatedRoot, relPath);
    if (!fs.existsSync(onDisk)) {
      findings.push(finding('error', 'stale-generated-output', `${relPath} is missing from docs/product/generated/ — run \`build\``, relPath));
      continue;
    }
    const existing = fs.readFileSync(onDisk, 'utf8');
    const mismatch = relPath === 'manifest.json'
      ? manifestContentIgnoringSourceCommit(existing) !== manifestContentIgnoringSourceCommit(content)
      : existing !== content;
    if (mismatch) {
      findings.push(finding('error', 'stale-generated-output', `${relPath} on disk differs from a fresh rebuild — run \`build\` before committing`, relPath));
    }
  }
  return findings;
}

function checkManifestCommit(manifestPath, currentCommit) {
  const findings = [];
  if (!fs.existsSync(manifestPath)) return findings;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.source_commit && manifest.source_commit !== currentCommit) {
    findings.push(finding('warning', 'generated-source-commit-mismatch', `manifest.json's source_commit (${manifest.source_commit}) does not match current HEAD (${currentCommit}) — expected if docs/product/ has uncommitted changes since the last build`, 'generated/manifest.json'));
  }
  return findings;
}

function runAllChecks(parsed, built, opts = {}) {
  const findings = [
    ...checkDuplicateIds(parsed),
    ...checkRegistryFileMismatch(parsed),
    ...checkLinks(parsed),
    ...checkRoadmapReferences(parsed),
    ...checkFeatureReferences(parsed),
    ...checkWorkflowReferences(parsed),
    ...checkOrphans(parsed),
    ...checkArchitectureCoverage(parsed),
    ...checkChangelogCoverage(parsed, opts.gitDocsCommits),
    ...checkImplementedDocumentation(parsed),
    ...checkPlannedRoadmap(parsed),
    ...checkRoadmapConsistency(parsed),
    ...checkDocumentationCompleteness(parsed),
    ...checkVocabulary(parsed),
    ...checkEvidenceLabels(parsed),
    ...checkLifecycleSections(parsed),
    ...checkRelatedTechnicalDocs(parsed),
    ...checkDuplicateAliases(built.authorityIndex),
    ...checkGraphIntegrity(built.graph),
    ...checkSharedCodePaths(built.featureIndex),
    ...checkDashboardNarrativeFreshness(parsed, opts.gitIsDirty),
    // Part 6 — required lazily (not at module top) to avoid a circular
    // require: memoryValidators.js itself imports `finding` from this file.
    ...(parsed.memory ? require('./memoryValidators').runMemoryChecks(parsed) : []),
    // Part 7B — same lazy-require pattern; decisionValidators.js also
    // imports `finding` from this file.
    ...require('./decisionValidators').runDecisionIntelligenceChecks(parsed),
    // Part 8 — same lazy-require pattern; conversationValidators.js also
    // imports `finding` from this file.
    ...(parsed.conversations ? require('./conversationValidators').runConversationChecks(parsed) : []),
  ];
  return findings;
}

module.exports = {
  finding,
  runAllChecks,
  checkGeneratedFreshness,
  checkManifestCommit,
  checkDuplicateIds,
  checkRegistryFileMismatch,
  checkLinks,
  checkRoadmapReferences,
  checkFeatureReferences,
  checkWorkflowReferences,
  checkOrphans,
  checkArchitectureCoverage,
  checkChangelogCoverage,
  checkImplementedDocumentation,
  checkPlannedRoadmap,
  checkRoadmapConsistency,
  checkDocumentationCompleteness,
  checkVocabulary,
  checkEvidenceLabels,
  checkLifecycleSections,
  checkRelatedTechnicalDocs,
  checkDuplicateAliases,
  checkGraphIntegrity,
  checkSharedCodePaths,
  checkDashboardNarrativeFreshness,
  VALID_STATUSES,
  VALID_MATURITIES,
};
