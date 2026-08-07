'use strict';

// Part 7C — Evidence-Based Feature Ownership Engine.
//
// Multi-signal, deterministically-weighted resolution of an arbitrary
// source path to its likely owning feature(s), for cases the Part 4
// "explicit Related Files or containing subsystem directory" resolution
// (lib/changeReport.js's resolveFileOwnership, still the highest-weighted
// signal here) can't answer — an unmapped path, a shared file, a new file
// that hasn't been added to any feature's Related Files yet.
//
// Six signals, all evidence-grounded (never filename/keyword guessing):
//   1. explicit_related_files — path is exactly cited in a feature's own
//      Related Files section (Part 4's `explicit` confidence).
//   2. subsystem_directory     — path's directory is a known subsystem
//      source directory, itself derived from the union of its member
//      features' Related Files (Part 4's `inferred` confidence).
//   3. require_graph           — the file's own `require('./x')` statements
//      resolve to another file with EXPLICIT ownership.
//   4. test_to_source          — a `test/X.test.js` path paired by naming
//      convention to a `main|services|renderer/X.js` file with ownership.
//   5. decision_or_bug_citation — the path is textually cited inside a
//      decisions/DEC-### or bugs/BUG-### record's own body, and that
//      record cites feature(s).
//   6. git_co_change            — across the file's last 50 commits, how
//      often files with EXPLICIT ownership of a given feature changed in
//      the same commit (a ratio, not a raw count, so a file with only 2
//      commits total isn't penalized against one with 200).
//
// Every signal's weight is a named constant below — no opaque model, no
// embeddings, no external service. A path with zero signals stays
// `unknown`, never assigned a plausible-looking owner.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { REPO_ROOT } = require('../lib/repoRoot');
const build = require('../lib/build');
const { resolveFileOwnership } = require('../lib/changeReport');
const { compareIds, extractIds } = require('../lib/ids');

const WEIGHTS = {
  explicit_related_files: 100,
  subsystem_directory: 40,
  require_graph: 15,
  test_to_source: 20,
  decision_or_bug_citation: 10,
  git_co_change_max: 25, // scaled by co-change ratio (0..1), see gitCoChangeSignal
};

// Ordered highest-first; first threshold the score clears wins. Documented
// here rather than left implicit so a future change to these numbers is a
// visible, reviewable diff, not tuning buried in a scoring function.
const CONFIDENCE_THRESHOLDS = [
  { min: 100, level: 'explicit' },
  { min: 60, level: 'very_high' },
  { min: 35, level: 'high' },
  { min: 15, level: 'medium' },
  { min: 1, level: 'low' },
];

function confidenceForScore(score) {
  for (const t of CONFIDENCE_THRESHOLDS) if (score >= t.min) return t.level;
  return 'unknown';
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
  } catch {
    return '';
  }
}

function addScore(map, featureId, weight) {
  map.set(featureId, (map.get(featureId) || 0) + weight);
}

function explicitAndSubsystemSignals(filePath, built) {
  const { confidence, subsystems: subIds } = resolveFileOwnership(filePath, built.sourceIndex);
  const featureScores = new Map();
  const evidence = [];
  const subsystemById = new Map(built.subsystems.map((s) => [s.id, s]));
  const weight = confidence === 'explicit' ? WEIGHTS.explicit_related_files : confidence === 'inferred' ? WEIGHTS.subsystem_directory : 0;
  for (const subId of subIds) {
    const s = subsystemById.get(subId);
    if (!s) continue;
    for (const featId of s.primaryFeatures) addScore(featureScores, featId, weight);
    evidence.push({ signal: confidence === 'explicit' ? 'explicit_related_files' : 'subsystem_directory', subsystem: subId, weight });
  }
  return { featureScores, evidence, baseConfidence: confidence };
}

function resolveRequireTarget(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // only first-party relative requires are evidence here
  const dir = path.dirname(fromFile);
  const target = path.normalize(path.join(dir, spec)).split(path.sep).join('/');
  const candidates = [target, `${target}.js`, `${target}/index.js`];
  return candidates.find((c) => fs.existsSync(path.join(REPO_ROOT, c))) || null;
}

function requireGraphSignal(filePath, built) {
  const featureScores = new Map();
  const evidence = [];
  const abs = path.join(REPO_ROOT, filePath);
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return { featureScores, evidence };
  let content;
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch {
    return { featureScores, evidence };
  }
  const reqRe = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = reqRe.exec(content)) !== null) {
    const resolved = resolveRequireTarget(filePath, m[1]);
    if (!resolved) continue;
    const { confidence, subsystems: subIds } = resolveFileOwnership(resolved, built.sourceIndex);
    if (confidence !== 'explicit') continue;
    for (const subId of subIds) {
      const s = built.subsystems.find((x) => x.id === subId);
      if (!s) continue;
      for (const featId of s.primaryFeatures) addScore(featureScores, featId, WEIGHTS.require_graph);
      evidence.push({ signal: 'require_graph', required_file: resolved, subsystem: subId, weight: WEIGHTS.require_graph });
    }
  }
  return { featureScores, evidence };
}

function testToSourceSignal(filePath, built) {
  const featureScores = new Map();
  const evidence = [];
  const m = /^test\/(.+)\.test\.js$/.exec(filePath);
  if (!m) return { featureScores, evidence };
  const base = m[1];
  const candidates = [`main/${base}.js`, `services/${base}.js`, `renderer/${base}.js`, `${base}.js`];
  for (const c of candidates) {
    if (!fs.existsSync(path.join(REPO_ROOT, c))) continue;
    const { confidence, subsystems: subIds } = resolveFileOwnership(c, built.sourceIndex);
    if (confidence === 'unknown') continue;
    for (const subId of subIds) {
      const s = built.subsystems.find((x) => x.id === subId);
      if (!s) continue;
      for (const featId of s.primaryFeatures) addScore(featureScores, featId, WEIGHTS.test_to_source);
      evidence.push({ signal: 'test_to_source', source_file: c, subsystem: subId, weight: WEIGHTS.test_to_source });
    }
  }
  return { featureScores, evidence };
}

function decisionBugCitationSignal(filePath, parsed) {
  const featureScores = new Map();
  const evidence = [];
  const scan = (map, headerField) => {
    for (const [id, rec] of map) {
      if (!rec.body || !rec.body.includes(filePath)) continue;
      for (const featId of extractIds(String(rec.header[headerField] || ''), 'feature')) {
        addScore(featureScores, featId, WEIGHTS.decision_or_bug_citation);
        evidence.push({ signal: 'decision_or_bug_citation', record: id, feature: featId, weight: WEIGHTS.decision_or_bug_citation });
      }
    }
  };
  scan(parsed.decisions, 'Related feature(s) / roadmap milestone');
  scan(parsed.bugs, 'Related feature(s)');
  return { featureScores, evidence };
}

const GIT_CO_CHANGE_COMMIT_LIMIT = 50;

// `git log --name-only -- <path>` restricts the printed file list to files
// matching the pathspec itself (a real git behavior, not a bug) — it does
// NOT list the other files that changed alongside it in the same commit,
// which is exactly what a co-change signal needs. So this resolves commit
// hashes touching filePath first, then asks `git show --name-only` for each
// commit's FULL file list separately (found in Part 7 code review — the
// single-pathspec-log approach silently produced zero co-change evidence
// for every path, always).
function gitCoChangeSignal(filePath, built) {
  const featureScores = new Map();
  const evidence = [];
  const hashesRaw = git(['log', '-n', String(GIT_CO_CHANGE_COMMIT_LIMIT), '--format=%H', '--', filePath]);
  if (!hashesRaw) return { featureScores, evidence };
  const hashes = hashesRaw.split('\n').filter(Boolean);
  if (hashes.length === 0) return { featureScores, evidence };
  const coCounts = new Map();
  for (const hash of hashes) {
    const filesRaw = git(['show', '--name-only', '--format=', hash]);
    const files = filesRaw ? filesRaw.split('\n').map((f) => f.trim()).filter((f) => f && f !== filePath) : [];
    const seenThisCommit = new Set();
    for (const f of files) {
      const { confidence, subsystems: subIds } = resolveFileOwnership(f, built.sourceIndex);
      if (confidence !== 'explicit') continue;
      for (const subId of subIds) {
        const s = built.subsystems.find((x) => x.id === subId);
        if (!s) continue;
        for (const featId of s.primaryFeatures) seenThisCommit.add(featId);
      }
    }
    for (const featId of seenThisCommit) coCounts.set(featId, (coCounts.get(featId) || 0) + 1);
  }
  const totalCommits = hashes.length;
  for (const [featId, count] of coCounts) {
    const ratio = count / totalCommits;
    const weight = Math.round(WEIGHTS.git_co_change_max * ratio);
    if (weight > 0) {
      addScore(featureScores, featId, weight);
      evidence.push({ signal: 'git_co_change', feature: featId, co_change_ratio: Number(ratio.toFixed(2)), commits_considered: totalCommits, weight });
    }
  }
  return { featureScores, evidence };
}

function mergeScores(...maps) {
  const merged = new Map();
  for (const m of maps) for (const [k, v] of m) addScore(merged, k, v);
  return merged;
}

// opts.skipGitHistory: for callers (e.g. tests, or a hot path scanning many
// files) that want to skip the git-log shell-out — every other signal is
// pure in-memory computation over the already-built indexes.
function resolveOwnership(filePath, opts = {}) {
  const { parsed, built } = build.assemble();
  const explicit = explicitAndSubsystemSignals(filePath, built);
  const requireGraph = requireGraphSignal(filePath, built);
  const testToSource = testToSourceSignal(filePath, built);
  const citation = decisionBugCitationSignal(filePath, parsed);
  const coChange = opts.skipGitHistory ? { featureScores: new Map(), evidence: [] } : gitCoChangeSignal(filePath, built);

  const merged = mergeScores(explicit.featureScores, requireGraph.featureScores, testToSource.featureScores, citation.featureScores, coChange.featureScores);
  const allEvidence = [...explicit.evidence, ...requireGraph.evidence, ...testToSource.evidence, ...citation.evidence, ...coChange.evidence];

  const owners = Array.from(merged.entries())
    .map(([featureId, score]) => ({ feature_id: featureId, score, confidence: confidenceForScore(score) }))
    .sort((a, b) => b.score - a.score || compareIds(a.feature_id, b.feature_id));

  const topScore = owners.length ? owners[0].score : 0;
  const primaryOwners = owners.filter((o) => o.score === topScore);

  return {
    path: filePath,
    owners,
    primary_owner_ids: primaryOwners.map((o) => o.feature_id),
    shared_ownership: primaryOwners.length > 1,
    overall_confidence: owners.length ? owners[0].confidence : 'unknown',
    evidence: allEvidence,
    weights: WEIGHTS,
    thresholds: CONFIDENCE_THRESHOLDS,
    unresolved: owners.length === 0,
    note: owners.length === 0
      ? 'No signal resolved this path to any feature — reported unknown, not guessed. Not implemented in this engine: IPC-channel-name graph matching, memory-capsule citation, live Evidence Packet intent — see docs/product/CLAUDE.md ownership routing for the manual fallback.'
      : null,
  };
}

module.exports = {
  WEIGHTS,
  CONFIDENCE_THRESHOLDS,
  confidenceForScore,
  resolveOwnership,
  explicitAndSubsystemSignals,
  requireGraphSignal,
  testToSourceSignal,
  decisionBugCitationSignal,
  gitCoChangeSignal,
};
