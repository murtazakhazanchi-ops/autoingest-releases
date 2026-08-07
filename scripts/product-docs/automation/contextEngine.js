'use strict';

// Part 7E — Universal Repository Engineering Assistant. Core logic behind
// `node scripts/product-docs/cli.js context <sub>`. Builds a BOUNDED
// context bundle for a feature/subsystem/file/roadmap/bug/decision/memory/
// release/natural-language task — reusing Part 4/5/7's existing,
// evidence-grounded resolution (query.js, impact.js, ownershipEngine.js,
// changeReport.js) rather than inventing a second lookup path. No
// embeddings, no external AI, no network — deterministic token/keyword
// matching only (lib/query.js's scoreRecord), per the brief's explicit
// non-goal for this layer.

const build = require('../lib/build');
const { runQuery, lookupById } = require('../lib/query');
const { buildImpactAnalysis } = require('../lib/impact');
const { resolveOwnership } = require('./ownershipEngine');
const { buildChangeReport } = require('../lib/changeReport');
const gitInfo = require('../lib/gitInfo');
const { extractIds, compareIds } = require('../lib/ids');

// Static, documented authority order — see docs/product/README.md
// "Authority and scope", scripts/product-docs/README.md "Authority model",
// and docs/product/16_ENGINEERING_MEMORY_POLICY.md § 3. Restated here
// rather than re-derived so every context bundle carries it explicitly —
// the brief's "Before planning, run the repository context command... then
// read the returned canonical documents" instruction only works if the
// bundle itself states which of its own contents outranks which.
const AUTHORITY_ORDER = [
  '1. Authoritative technical docs under docs/ (see docs/CLAUDE.md Task Documentation Routing) — always wins on runtime-behavior, contract, or architecture questions.',
  '2. Canonical docs/product/ records (features/, bugs/, decisions/, postmortems/) — authoritative for product planning, feature history, and roadmap progress.',
  '3. docs/product/generated/ (this tool\'s own output, including this context bundle) — a locator/index layer only; regenerate rather than trust stale, never cite as evidence in a canonical record.',
  '4. docs/product/memory/AI-MEM-#### capsules — historical evidence explaining WHY a canonical record evolved the way it did; never overrides WHAT the canonical record currently says.',
  '5. Agent inference — lowest tier; verify against tiers 1-4 above before acting on it.',
];

const MAX_SUMMARY_CHARS = 700;
const MAX_LIST_ITEMS = 25;

function truncateText(text, max = MAX_SUMMARY_CHARS) {
  if (!text) return { text: '', truncated: false };
  const trimmed = String(text).trim();
  if (trimmed.length <= max) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, max) + '…', truncated: true };
}

function boundList(items, max = MAX_LIST_ITEMS) {
  const arr = items || [];
  if (arr.length <= max) return { items: arr, truncated: false, total: arr.length };
  return { items: arr.slice(0, max), truncated: true, total: arr.length };
}

const EVIDENCE_MARKERS = ['Evidence pending', 'Not yet documented as fact', 'Known from project history; repository evidence pending'];
function hasEvidenceGap(text) {
  if (!text) return false;
  return EVIDENCE_MARKERS.some((m) => text.includes(m));
}

function baseBundle(kind, id) {
  return {
    kind,
    id,
    authority_order: AUTHORITY_ORDER,
    generated_at: new Date().toISOString(),
    provenance: [],
    truncation_notices: [],
    found: true,
  };
}

function notFound(kind, id, note) {
  return { kind, id, authority_order: AUTHORITY_ORDER, found: false, note };
}

function featureBundle(featureId, { parsed, built }) {
  const id = String(featureId).toUpperCase();
  const feat = parsed.features.get(id);
  if (!feat) return notFound('feature', id, `No such feature: ${id}`);
  const impact = buildImpactAnalysis(id, built, parsed);
  const summary = truncateText(feat.summary);
  const bundle = baseBundle('feature', id);
  bundle.title = feat.name;
  bundle.status = feat.header['Status'] || 'Evidence pending';
  bundle.maturity = feat.header['Maturity'] || 'Evidence pending';
  bundle.canonical_document = feat.filePath;
  bundle.summary = summary.text;
  if (summary.truncated) bundle.truncation_notices.push('summary truncated to ' + MAX_SUMMARY_CHARS + ' chars');
  bundle.roadmap_ids = extractIds(String(feat.header['Related roadmap milestone'] || ''), 'roadmap');
  bundle.dependencies = boundList(impact.dependencies).items;
  bundle.dependents = boundList(impact.dependents).items;
  bundle.related_features = boundList(impact.related_features).items;
  bundle.decisions = boundList(impact.decisions).items;
  bundle.bugs = boundList(impact.bugs).items;
  bundle.required_technical_docs = boundList(impact.required_technical_docs).items;
  bundle.tests = boundList(impact.tests).items;
  bundle.code_paths = boundList(feat.relatedFiles).items;
  bundle.evidence_gap_present = hasEvidenceGap(feat.body);
  bundle.provenance = [feat.filePath, ...impact.required_technical_docs];
  bundle.implementation_constraints = [
    'Never contradict an authoritative technical doc under docs/ — if this feature file and a technical doc disagree, the technical doc wins (see docs/product/05_DOCUMENTATION_WORKFLOW.md § Authority Boundary).',
    'Update this feature file\'s Evolution / Implementation Journal alongside the work, not after (see docs/product/05_DOCUMENTATION_WORKFLOW.md § The Update Rule).',
  ];
  return bundle;
}

function subsystemBundle(name, { built }) {
  const q = String(name).toLowerCase();
  const s = built.subsystems.find((x) => x.id.toLowerCase() === q || x.name.toLowerCase() === q || x.aliases.some((a) => a.toLowerCase() === q));
  if (!s) return notFound('subsystem', name, `No subsystem matching "${name}".`);
  const bundle = baseBundle('subsystem', s.id);
  bundle.name = s.name;
  bundle.aliases = s.aliases;
  bundle.primary_features = s.primaryFeatures;
  bundle.canonical_product_doc = s.canonicalProductDoc;
  bundle.canonical_technical_docs = boundList(s.canonicalTechnicalDocs).items;
  bundle.source_directories = s.sourceDirectories;
  bundle.source_files = boundList(s.sourceFiles).items;
  bundle.related_bugs = s.relatedBugs;
  bundle.related_decisions = s.relatedDecisions;
  bundle.change_impact_checklist = s.changeImpactChecklist;
  bundle.provenance = [s.canonicalProductDoc, ...s.canonicalTechnicalDocs];
  return bundle;
}

function fileBundle(filePath, { parsed, built }) {
  const ownership = resolveOwnership(filePath);
  const bundle = baseBundle('file', filePath);
  bundle.owners = ownership.owners;
  bundle.primary_owner_ids = ownership.primary_owner_ids;
  bundle.shared_ownership = ownership.shared_ownership;
  bundle.overall_confidence = ownership.overall_confidence;
  bundle.evidence = ownership.evidence;
  bundle.unresolved = ownership.unresolved;
  if (ownership.unresolved) {
    bundle.note = ownership.note;
    return bundle;
  }
  // For each primary owner, fold in a compact (not full) feature bundle so
  // the caller doesn't have to make a second round-trip for the common case.
  bundle.owning_features = ownership.primary_owner_ids.map((id) => {
    const fb = featureBundle(id, { parsed, built });
    return fb.found ? { feature_id: id, title: fb.title, canonical_document: fb.canonical_document, required_technical_docs: fb.required_technical_docs } : { feature_id: id, found: false };
  });
  return bundle;
}

function roadmapBundle(roadmapId, { parsed }) {
  const id = String(roadmapId).toUpperCase();
  const m = parsed.roadmap.get(id);
  if (!m) return notFound('roadmap', id, `No such roadmap milestone: ${id}`);
  const bundle = baseBundle('roadmap', id);
  bundle.status = m.header['Status'] || 'Evidence pending';
  bundle.included_feature_ids = extractIds(String(m.header['Included AI-FEAT IDs'] || ''), 'feature');
  bundle.canonical_document = '02_MASTER_ROADMAP.md';
  bundle.provenance = ['docs/product/02_MASTER_ROADMAP.md', 'docs/product/04_PROJECT_DASHBOARD.md'];
  bundle.implementation_constraints = ['A roadmap milestone is never marked Complete by automation alone — requires explicit human/agent-confirmed acceptance evidence (see docs/product/05_DOCUMENTATION_WORKFLOW.md § Automation and the Update Rule).'];
  return bundle;
}

// Shared shape for bug/decision/postmortem/memory — all four are parsed by
// the same lib/parseProductDocs.js `parseRecordFile` and expose the same
// {header, body, filePath} shape.
function recordBundle(kind, familyMap, id, headerFeatureField) {
  const rec = familyMap.get(id.toUpperCase());
  if (!rec) return notFound(kind, id, `No such ${kind}: ${id}`);
  const bundle = baseBundle(kind, rec.id);
  bundle.title = rec.name;
  bundle.canonical_document = rec.filePath;
  bundle.header = rec.header;
  bundle.related_feature_ids = extractIds(String(rec.header[headerFeatureField] || ''), 'feature');
  const summary = truncateText(rec.body.split('\n').slice(0, 12).join('\n'));
  bundle.excerpt = summary.text;
  if (summary.truncated) bundle.truncation_notices.push('body excerpt truncated');
  bundle.evidence_gap_present = hasEvidenceGap(rec.body);
  bundle.provenance = [rec.filePath];
  return bundle;
}

function bugBundle(id, { parsed }) { return recordBundle('bug', parsed.bugs, id, 'Related feature(s)'); }
function decisionBundle(id, { parsed }) { return recordBundle('decision', parsed.decisions, id, 'Related feature(s) / roadmap milestone'); }
function postmortemBundle(id, { parsed }) { return recordBundle('postmortem', parsed.postmortems, id, 'Related feature(s)'); }
function memoryBundle(id, { parsed }) {
  if (!parsed.memory) return notFound('memory', id, 'docs/product/memory/ does not exist in this repository.');
  const bundle = recordBundle('memory', parsed.memory, id, 'Related feature(s)');
  if (bundle.found) {
    bundle.implementation_constraints = ['Historical evidence only — never cite this capsule as authority for a current-behavior claim; cite the canonical record it explains instead (see docs/product/16_ENGINEERING_MEMORY_POLICY.md § 3).'];
  }
  return bundle;
}

// context release <tag-or-range>: accepts either a single ref (context =
// the range from its auto-detected prior tag up to it) or an explicit
// "A..B" range. Read-only summary, not the full release-draft artifact
// (see `release prepare` for that) — bounded, for quick orientation.
function releaseBundle(input, { parsed, built }) {
  let fromRef;
  let toRef;
  if (input.includes('..')) {
    [fromRef, toRef] = input.split('..');
  } else {
    toRef = input;
    fromRef = gitInfo.priorTag(input);
  }
  if (!fromRef) return notFound('release', input, 'No prior tag found and no explicit "A..B" range given.');
  if (!gitInfo.refExists(fromRef) || !gitInfo.refExists(toRef)) {
    return notFound('release', input, `One or both refs do not resolve (${fromRef}, ${toRef}).`);
  }
  const report = buildChangeReport(fromRef, toRef, parsed, built.subsystems, built.sourceIndex);
  const bundle = baseBundle('release', `${fromRef}..${toRef}`);
  bundle.commit_count = report.commits.length;
  bundle.files_changed_count = report.files_changed.length;
  bundle.affected_features = boundList(report.affected_features).items;
  bundle.bugs_changed = report.bugs_changed;
  bundle.decisions_changed = report.decisions_changed;
  bundle.roadmap_changed = report.roadmap_changed;
  bundle.note = 'Summary only — run "release prepare --to " + toRef + " --from " + fromRef + " for the full release-intelligence draft.';
  return bundle;
}

// Deterministic natural-language routing: token/keyword matching only
// (lib/query.js's existing scoreRecord), never embeddings. Returns bundles
// for the top-scoring matches, bounded.
function taskBundle(text, { parsed, built }) {
  const results = runQuery(text, built.searchIndex, { limit: 5 });
  const bundle = baseBundle('task', text);
  bundle.matches = results.map((r) => ({ entity_type: r.record.entity_type, stable_id: r.record.stable_id, title: r.record.title, score: r.score, canonical_path: r.record.canonical_path }));
  if (results.length === 0) {
    bundle.found = false;
    bundle.note = `No deterministic keyword/alias match for "${text}" — this is reported as unknown, not guessed. Try "context explain" with a more specific term, or "query" for the raw ranked list.`;
    return bundle;
  }
  const top = results[0].record;
  bundle.primary_match = resolveBundleFor(top.entity_type, top.stable_id, { parsed, built });
  return bundle;
}

function resolveBundleFor(entityType, id, ctx) {
  switch (entityType) {
    case 'feature': return featureBundle(id, ctx);
    case 'bug': return bugBundle(id, ctx);
    case 'decision': return decisionBundle(id, ctx);
    case 'postmortem': return postmortemBundle(id, ctx);
    case 'memory': return memoryBundle(id, ctx);
    case 'roadmap': return roadmapBundle(id, ctx);
    case 'subsystem': return subsystemBundle(id, ctx);
    default: return notFound(entityType, id, `Unsupported entity_type for a bundle: ${entityType}`);
  }
}

// context explain "<question>" — same deterministic routing as `task`, but
// framed as an explanation: returns the bundle plus a short routing note
// pointing at which canonical document actually answers the question.
function explainBundle(question, { parsed, built }) {
  const task = taskBundle(question, { parsed, built });
  if (!task.found) return task;
  const bundle = { ...task, kind: 'explain' };
  bundle.routing_note = `Best deterministic match: ${task.matches[0].entity_type} ${task.matches[0].stable_id} ("${task.matches[0].title}"). Read ${task.primary_match.canonical_document || task.primary_match.canonical_product_doc || '(see provenance)'} directly before acting — this bundle is a locator, not the source itself.`;
  return bundle;
}

function buildContext(kind, input) {
  const { parsed, built } = build.assemble();
  const ctx = { parsed, built };
  switch (kind) {
    case 'feature': return featureBundle(input, ctx);
    case 'subsystem': return subsystemBundle(input, ctx);
    case 'file': return fileBundle(input, ctx);
    case 'roadmap': return roadmapBundle(input, ctx);
    case 'bug': return bugBundle(input, ctx);
    case 'decision': return decisionBundle(input, ctx);
    case 'postmortem': return postmortemBundle(input, ctx);
    case 'memory': return memoryBundle(input, ctx);
    case 'release': return releaseBundle(input, ctx);
    case 'task': return taskBundle(input, ctx);
    case 'explain': return explainBundle(input, ctx);
    default: throw new Error(`Unknown context kind: ${kind}`);
  }
}

// A bundle for an explicit feature or file — the two forms `context bundle`
// exposes (`--feature ID` / `--file PATH`), sharing the same builders.
function buildBundle({ feature, file }) {
  const { parsed, built } = build.assemble();
  if (feature) return featureBundle(feature, { parsed, built });
  if (file) return fileBundle(file, { parsed, built });
  throw new Error('context bundle requires --feature <ID> or --file <path>');
}

module.exports = {
  AUTHORITY_ORDER,
  buildContext,
  buildBundle,
  featureBundle,
  subsystemBundle,
  fileBundle,
  roadmapBundle,
  bugBundle,
  decisionBundle,
  postmortemBundle,
  memoryBundle,
  releaseBundle,
  taskBundle,
  explainBundle,
};
