'use strict';

// Builds a release-note DRAFT from a git range — classified, linked to
// features/bugs/decisions, written under docs/product/generated/ (a
// disposable, rebuildable location, same tier as change-reports/). Never
// creates a GitHub release, never writes docs/release-notes-*.md directly —
// that remains a separate, explicitly authorized action per the brief.

const fs = require('fs');
const path = require('path');
const { GENERATED_ROOT } = require('../lib/repoRoot');
const build = require('../lib/build');
const parseProductDocs = require('../lib/parseProductDocs');
const { buildChangeReport } = require('../lib/changeReport');
const { stableStringify } = require('../lib/stableJson');
const { atomicWriteFileSync, assertInsideRepo } = require('./atomicWrite');
const gitInfo = require('../lib/gitInfo');
const validators = require('../lib/validators');
const { HIGH_RISK_SUBSYSTEM_HINTS } = require('./changeClassifier');
const version = require('../lib/version');

// Conventional-commit-ish prefix classification, matching this repository's
// actual commit style (see `git log --oneline`: "fix(ci): ...",
// "docs(product): ...", "feat: ..."). A commit that doesn't match any
// known prefix is classified "Changed" rather than guessed into a more
// specific bucket.
const PREFIX_CATEGORY = [
  [/^feat(\(|:)/i, 'Added'],
  [/^fix(\(|:)/i, 'Fixed'],
  [/^perf(\(|:)/i, 'Performance'],
  [/^refactor(\(|:)/i, 'Changed'],
  [/^docs(\(|:)/i, 'Documentation'],
  [/^test(\(|:)/i, 'Changed'],
  [/^chore(\(|:)/i, 'Changed'],
  [/^ci(\(|:)/i, 'Changed'],
  [/^security(\(|:)/i, 'Security'],
  [/^deprecate(\(|:)/i, 'Deprecated'],
  [/^remove(\(|:)/i, 'Removed'],
];

function classifyCommitSubject(subject) {
  for (const [re, category] of PREFIX_CATEGORY) {
    if (re.test(subject)) return category;
  }
  return 'Changed';
}

// Part 7D — automatically determines the prior release using verified Git
// tags (never a guess, never "the previous commit"). `fromRef` of `'auto'`
// (or omitted) resolves to the newest tag reachable from `toRef` that isn't
// `toRef` itself — see lib/gitInfo.js's priorTag. If no prior tag exists
// (first-ever release), this is reported honestly rather than silently
// defaulting to some arbitrary range.
function resolveFromRef(fromRef, toRef) {
  if (fromRef && fromRef !== 'auto') {
    return { fromRef, resolution: 'explicit', note: null };
  }
  const tag = gitInfo.priorTag(toRef);
  if (!tag) {
    return { fromRef: null, resolution: 'no-prior-tag', note: 'No prior Git tag reachable from this ref — this looks like the first release; nothing to diff against.' };
  }
  return { fromRef: tag, resolution: 'auto-detected-prior-tag', note: null };
}

// Evidence-gated: only ever cites text ALREADY present in a commit subject,
// a decision/bug record's own body, or the changelog — never infers a
// breaking change or migration step from file count or path shape alone
// (the brief's explicit non-goal: "Do not infer a breaking change merely
// from file count").
const BREAKING_MARKER_RE = /^[a-z]+(\([^)]*\))?!:/i; // conventional-commit "feat(x)!: ..." marker
const MIGRATION_KEYWORDS_RE = /\b(migration|schema change|breaking change|persistence format|settings format|installation step|upgrade step)\b/i;

function scanRecordsForKeyword(ids, recordMap, re) {
  const hits = [];
  for (const id of ids) {
    const rec = recordMap.get(id);
    if (rec && re.test(rec.body)) hits.push({ id, file: rec.filePath });
  }
  return hits;
}

function buildBreakingChanges(report, parsed) {
  const commitMarkers = report.commits.filter((c) => BREAKING_MARKER_RE.test(c.subject)).map((c) => ({ commit: c.short, subject: c.subject }));
  const decisionHits = scanRecordsForKeyword(report.decisions_changed.map((f) => (/DEC-\d{3}/.exec(f) || [])[0]).filter(Boolean), parsed.decisions, /breaking/i);
  const bugHits = scanRecordsForKeyword(report.bugs_changed.map((f) => (/BUG-\d{3}/.exec(f) || [])[0]).filter(Boolean), parsed.bugs, /breaking/i);
  const items = [...commitMarkers, ...decisionHits, ...bugHits];
  return {
    items,
    note: items.length ? 'Evidence: conventional-commit "!" marker and/or explicit "breaking" mention in a cited decision/bug record.' : 'No breaking-change evidence found (commit "!" marker, or a cited decision/bug record explicitly saying "breaking") in this range.',
  };
}

function buildMigrationNotes(report, parsed) {
  const decisionHits = scanRecordsForKeyword(report.decisions_changed.map((f) => (/DEC-\d{3}/.exec(f) || [])[0]).filter(Boolean), parsed.decisions, MIGRATION_KEYWORDS_RE);
  const bugHits = scanRecordsForKeyword(report.bugs_changed.map((f) => (/BUG-\d{3}/.exec(f) || [])[0]).filter(Boolean), parsed.bugs, MIGRATION_KEYWORDS_RE);
  const items = [...decisionHits, ...bugHits];
  return {
    items,
    note: items.length ? 'Evidence: a cited decision/bug record explicitly mentions a migration/schema/settings/installation keyword.' : 'No migration-note evidence found in cited decision/bug records for this range.',
  };
}

// Never "not yet fixed" bugs discovered incidentally — an honest scan of
// the CURRENT repository state (not just this range) for anything still
// open, since a release's known-issues section should reflect what's true
// at release time, not only what changed in the diff.
function buildKnownIssues(parsed) {
  const open = [];
  for (const [id, b] of parsed.bugs) {
    const status = String(b.header['Status'] || '');
    if (/^(open|investigating)$/i.test(status.trim())) open.push({ id, status, file: b.filePath });
  }
  return open;
}

function buildRoadmapImpact(report, built) {
  const featureById = new Map(built.featureIndex.map((f) => [f.feature_id, f]));
  const roadmapIds = new Set();
  for (const featId of report.affected_features) {
    const f = featureById.get(featId);
    if (f) for (const rm of f.roadmap_ids) roadmapIds.add(rm);
  }
  return {
    affected_roadmap_ids: Array.from(roadmapIds).sort(),
    milestone_transitions_note: 'A release never automatically completes a milestone — 02_MASTER_ROADMAP.md/04_PROJECT_DASHBOARD.md transitions require explicit human/agent-confirmed acceptance evidence (see docs/product/05_DOCUMENTATION_WORKFLOW.md § Automation and the Update Rule). This report only lists which milestones this range touches.',
  };
}

function buildRiskAssessment(report) {
  const highRisk = report.file_impacts.filter((fi) =>
    fi.subsystems.some((subId) => HIGH_RISK_SUBSYSTEM_HINTS.some((hint) => subId.toLowerCase().includes(hint))));
  return {
    high_risk_files: highRisk.map((fi) => fi.file),
    unknown_ownership_files: report.file_impacts.filter((fi) => fi.confidence === 'unknown').map((fi) => fi.file),
    note: 'Heuristic, evidence-labeled only — file touches a subsystem this system already treats as elevated-risk (event.json/security/ingestion/transaction/archive-writer, per changeClassifier.js), or has unresolved ownership. Not a substitute for human review.',
  };
}

// Takes the caller's already-computed {parsed, built} rather than calling
// build.assemble() again — this function used to re-assemble the whole
// docs/product/ index from scratch a second time within the same
// buildReleaseDraft() call, doubling release-draft cost for no reason
// (found in Part 7 performance review).
function buildDocumentationHealthSummary(parsed, built) {
  const findings = validators.runAllChecks(parsed, built, { gitIsDirty: gitInfo.isWorkingTreeDirty() });
  const summary = { error: 0, warning: 0, information: 0, evidence_gap: 0 };
  for (const f of findings) summary[f.level] = (summary[f.level] || 0) + 1;
  return summary;
}

// Part 9 — QA checklist (RC) / promotion readiness (stable) additions to the
// release draft. Deliberately built ONLY from fields buildReleaseDraft
// already computes (affected_features, bugs_referenced, known_issues,
// report.to_commit) — no new data source, per the "do not duplicate
// infrastructure" instruction.
function buildQaChecklist(report, draft) {
  return {
    build_version: null, // filled in by the caller once package.json's version is known (CLI/CI context, not this pure builder)
    commit_sha: report.to_commit,
    affected_bug_ids: draft.bugs_referenced,
    affected_feature_ids: draft.affected_features,
    known_issues: draft.known_issues,
    tester_instructions: [
      'Install this RC build on the target platform(s).',
      draft.affected_features.length
        ? `Exercise the affected feature area(s): ${draft.affected_features.join(', ')}.`
        : 'No specific feature area flagged — run the general smoke checklist.',
      draft.bugs_referenced.length
        ? `For each affected bug, follow that bug's own record for reproduction/verification steps: ${draft.bugs_referenced.join(', ')}.`
        : 'No specific bug reproduction steps required.',
      'Capture evidence (screenshots, app.log) for each step exercised — matching the evidence bar BUG-011-014 established.',
      'Report PASS/FAIL per affected bug/feature, not just "worked overall".',
    ],
    required_evidence: ['Screenshots or screen recording of the exercised flow(s)', 'app.log covering the session', 'Exact build version and platform tested'],
    risk_summary: draft.risk_assessment,
  };
}

function buildPromotionReadiness(draft, verifiedRcCommit) {
  return {
    verified_rc_commit: verifiedRcCommit || null,
    stable_commit: draft.release_manifest.to_commit,
    note: verifiedRcCommit
      ? 'Run `release gate --channel stable --rc-commit ' + verifiedRcCommit + '` before tagging to confirm zero source drift beyond the version bump.'
      : 'No verified RC commit supplied to this draft — `release gate --channel stable` will require --override-drift-check with an explicit reason.',
    known_issues: draft.known_issues,
  };
}

function buildReleaseDraft(fromRefInput, toRef, opts = {}) {
  const { fromRef, resolution, note } = resolveFromRef(fromRefInput, toRef);
  if (!fromRef) {
    return {
      from_ref: null, to_ref: toRef, resolution, note,
      publish_note: 'DRAFT ONLY. Does not create a GitHub release or docs/release-notes-*.md.',
    };
  }
  const { parsed, built } = build.assemble();
  const report = buildChangeReport(fromRef, toRef, parsed, built.subsystems, built.sourceIndex);

  const byCategory = {};
  for (const c of report.commits) {
    const category = classifyCommitSubject(c.subject);
    (byCategory[category] = byCategory[category] || []).push(c);
  }

  const draft = {
    from_ref: fromRef,
    from_ref_resolution: resolution,
    to_ref: toRef,
    from_commit: report.from_commit,
    to_commit: report.to_commit,
    generated_at: new Date().toISOString(),
    categories: byCategory,
    affected_features: report.affected_features,
    bugs_referenced: report.bugs_changed,
    decisions_referenced: report.decisions_changed,
    breaking_changes: buildBreakingChanges(report, parsed),
    migration_notes: buildMigrationNotes(report, parsed),
    known_issues: buildKnownIssues(parsed),
    roadmap_impact: buildRoadmapImpact(report, built),
    risk_assessment: buildRiskAssessment(report),
    test_verification_summary: { tests_changed: report.tests_changed },
    documentation_health_summary: buildDocumentationHealthSummary(parsed, built),
    release_manifest: {
      docsys_version: version.DOCSYS_VERSION,
      generator_version: version.GENERATOR_VERSION,
      from_commit: report.from_commit,
      to_commit: report.to_commit,
      commit_count: report.commits.length,
      files_changed_count: report.files_changed.length,
      affected_feature_count: report.affected_features.length,
    },
    publish_note: 'DRAFT ONLY. Does not create a GitHub release or docs/release-notes-*.md. Publishing remains a separately authorized human action.',
  };

  if (opts.channel === 'rc') {
    draft.channel = 'rc';
    draft.qa_checklist = buildQaChecklist(report, draft);
  } else if (opts.channel === 'stable') {
    draft.channel = 'stable';
    draft.promotion_readiness = buildPromotionReadiness(draft, opts.verifiedRcCommit);
  } else if (opts.channel) {
    draft.channel = opts.channel;
  }
  return draft;
}

function renderReleaseDraftMd(draft) {
  const lines = [];
  lines.push(`# Release Draft — ${draft.from_ref || '(no prior tag)'} → ${draft.to_ref}`);
  lines.push('');
  lines.push('**DRAFT ONLY — not a published release.** Generated by `node scripts/product-docs/cli.js release prepare`; review before turning into `docs/release-notes-*.md`.');
  lines.push('');
  if (!draft.from_ref) {
    lines.push(`No prior release tag found (${draft.resolution}). ${draft.note || ''}`);
    lines.push('');
    lines.push(draft.publish_note);
    return lines.join('\n') + '\n';
  }
  lines.push(`From-ref resolution: ${draft.from_ref_resolution}`);
  lines.push('');
  const order = ['Added', 'Changed', 'Fixed', 'Performance', 'Reliability', 'Security', 'UI/UX', 'Documentation', 'Deprecated', 'Removed'];
  for (const category of order) {
    const commits = draft.categories[category];
    if (!commits || commits.length === 0) continue;
    lines.push(`## ${category}`);
    for (const c of commits) lines.push(`- ${c.subject} (\`${c.short}\`)`);
    lines.push('');
  }
  lines.push('## Breaking Changes');
  lines.push(draft.breaking_changes.items.length
    ? draft.breaking_changes.items.map((i) => `- ${i.commit ? `\`${i.commit}\` ${i.subject}` : `${i.id} (${i.file})`}`).join('\n')
    : draft.breaking_changes.note);
  lines.push('');
  lines.push('## Migration Notes');
  lines.push(draft.migration_notes.items.length
    ? draft.migration_notes.items.map((i) => `- ${i.id} (${i.file})`).join('\n')
    : draft.migration_notes.note);
  lines.push('');
  lines.push('## Known Issues');
  lines.push(draft.known_issues.length ? draft.known_issues.map((b) => `- ${b.id} — ${b.status} (${b.file})`).join('\n') : 'None currently Open or Investigating.');
  lines.push('');
  lines.push('## Roadmap Impact');
  lines.push(`Affected milestones: ${draft.roadmap_impact.affected_roadmap_ids.join(', ') || 'None detected.'}`);
  lines.push(draft.roadmap_impact.milestone_transitions_note);
  lines.push('');
  lines.push('## Risk Assessment');
  lines.push(`High-risk-subsystem files: ${draft.risk_assessment.high_risk_files.join(', ') || 'None.'}`);
  lines.push(`Unresolved-ownership files: ${draft.risk_assessment.unknown_ownership_files.join(', ') || 'None.'}`);
  lines.push(draft.risk_assessment.note);
  lines.push('');
  lines.push('## Test / Verification Summary');
  lines.push(`Test files changed in this range: ${draft.test_verification_summary.tests_changed.join(', ') || 'None detected.'}`);
  lines.push('');
  lines.push('## Documentation Health Summary');
  lines.push(`errors=${draft.documentation_health_summary.error} warnings=${draft.documentation_health_summary.warning} information=${draft.documentation_health_summary.information} evidence_gap=${draft.documentation_health_summary.evidence_gap}`);
  lines.push('');
  lines.push('## Affected Features');
  lines.push(draft.affected_features.length ? draft.affected_features.join(', ') : 'None detected.');
  lines.push('');
  if (draft.qa_checklist) {
    lines.push('## QA Checklist (RC)');
    lines.push(`Build version: ${draft.qa_checklist.build_version || '(fill in at build time)'} — Commit: \`${draft.qa_checklist.commit_sha}\``);
    lines.push('');
    lines.push('Tester instructions:');
    for (const step of draft.qa_checklist.tester_instructions) lines.push(`- ${step}`);
    lines.push('');
    lines.push('Required evidence:');
    for (const item of draft.qa_checklist.required_evidence) lines.push(`- ${item}`);
    lines.push('');
  }
  if (draft.promotion_readiness) {
    lines.push('## Promotion Readiness (Stable)');
    lines.push(`Verified RC commit: ${draft.promotion_readiness.verified_rc_commit || 'None supplied'}`);
    lines.push(`Stable commit: \`${draft.promotion_readiness.stable_commit}\``);
    lines.push(draft.promotion_readiness.note);
    lines.push('');
  }
  lines.push('## Release Manifest');
  lines.push('```json');
  lines.push(JSON.stringify(draft.release_manifest, null, 2));
  lines.push('```');
  lines.push('');
  lines.push(draft.publish_note);
  return lines.join('\n') + '\n';
}

// opts.dryRun: builds and returns the draft without writing anything.
// opts.outputDir: write under a caller-specified directory instead of the
// default docs/product/generated/release-drafts/ (still validated to stay
// inside the repository root by atomicWriteFileSync's own guard).
function writeReleaseDraft(fromRef, toRef, opts = {}) {
  const draft = buildReleaseDraft(fromRef, toRef, { channel: opts.channel, verifiedRcCommit: opts.verifiedRcCommit });
  const safe = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_');
  const baseName = `${safe(draft.from_ref || 'NO_PRIOR_TAG')}_TO_${safe(toRef)}${opts.channel ? `_${safe(opts.channel)}` : ''}`;
  const md = renderReleaseDraftMd(draft);
  const json = stableStringify(draft);
  if (opts.dryRun) {
    return { dryRun: true, baseName, draft, md, json };
  }
  const dir = opts.outputDir ? path.resolve(opts.outputDir) : path.join(GENERATED_ROOT, 'release-drafts');
  // Validate containment BEFORE any filesystem mutation — mkdirSync-ing an
  // out-of-repo --output-dir and only rejecting the subsequent file write
  // would leave a stray directory outside the repo root (found in Part 7
  // code review). assertInsideRepo throws the same "Refusing to write
  // outside repository root" error atomicWriteFileSync itself would.
  assertInsideRepo(dir);
  fs.mkdirSync(dir, { recursive: true });
  const mdPath = path.join(dir, `${baseName}.md`);
  const jsonPath = path.join(dir, `${baseName}.json`);
  // Routed through the shared atomic-write choke point (temp-then-rename)
  // like every other write path in automation/ — a crash mid-write must
  // never leave a torn file under generated/release-drafts/, which (per
  // Part 4's README) is committed to git, unlike exports/.
  atomicWriteFileSync(mdPath, md);
  atomicWriteFileSync(jsonPath, json);
  return { mdPath, jsonPath, draft };
}

function listReleaseDrafts(dir) {
  const target = dir ? path.resolve(dir) : path.join(GENERATED_ROOT, 'release-drafts');
  if (!fs.existsSync(target)) return [];
  return fs.readdirSync(target).filter((f) => f.endsWith('.json')).sort();
}

// The v0.9.11 release-process incident (docs/product/postmortems/, see the
// commit that added this function): a v0.9.11 git tag was pushed while
// package.json still read 0.9.10. electron-builder derives BOTH its
// published artifact names and which GitHub release it targets from
// package.json's own "version" field — never from the git tag that
// triggered the workflow — so it built and attempted to publish
// 0.9.10-named artifacts, found the already-published v0.9.10 release, and
// its own overwrite-protection guard silently skipped every upload. The
// resulting v0.9.11 release existed but had zero assets. This function
// makes that specific mismatch a checkable, testable precondition instead
// of tribal knowledge — run it BEFORE creating a release tag.
function normalizeVersion(v) {
  return String(v || '').trim().replace(/^v/i, '');
}

// repoRoot is a parameter (not the module-level REPO_ROOT) so this is
// testable against a disposable fixture repo, the same pattern every other
// automation/ module's tests already use (tmpRepoHarness.js).
//
// Reads package.json/package-lock.json off the actual WORKING TREE (not a
// git ref) — code-review note (Part 9): checkChannelReleaseGate's stable
// branch also accepts a --stable-commit override for its git-based
// source-drift check, defaulting to 'HEAD'. If --stable-commit is ever
// passed as a ref other than what's currently checked out, this function's
// disk-based version check and that function's git-ref-based drift check
// would be validating two different snapshots. Not a problem for the
// documented/intended invocation (gate run immediately before tagging the
// currently-checked-out commit), but a caller passing a non-default
// --stable-commit should be aware of this.
function checkVersionTagAlignment(repoRoot, tagOrVersion) {
  const targetVersion = normalizeVersion(tagOrVersion);
  const blocking = [];

  const pkgPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, blocking: [`package.json not found at ${pkgPath}`], packageVersion: null, lockVersion: null, targetVersion };
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const packageVersion = normalizeVersion(pkg.version);
  if (packageVersion !== targetVersion) {
    blocking.push(
      `package.json version (${packageVersion || '(missing)'}) does not match the target release version (${targetVersion}). ` +
      `electron-builder derives its publish target and artifact names from package.json's version, not the git tag — ` +
      `a mismatched tag will build and silently fail to publish (see the v0.9.11 release-process incident). ` +
      `Run "npm version ${targetVersion} --no-git-tag-version" and commit before tagging.`
    );
  }

  // package-lock.json's own root "version" and packages[""].version fields
  // track the project version when npm manages it — only validated if the
  // lockfile exists and actually carries a version field (an older/
  // differently-structured lockfile without one is not itself an error).
  let lockVersion = null;
  const lockPath = path.join(repoRoot, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const rootVersion = lock.version;
    const rootPkgVersion = lock.packages && lock.packages[''] && lock.packages[''].version;
    if (rootVersion !== undefined || rootPkgVersion !== undefined) {
      lockVersion = normalizeVersion(rootVersion !== undefined ? rootVersion : rootPkgVersion);
      if (lockVersion !== targetVersion) {
        blocking.push(
          `package-lock.json version (${lockVersion || '(missing)'}) does not match the target release version (${targetVersion}). ` +
          `Regenerate it (e.g. "npm install" after bumping package.json) so both files agree.`
        );
      }
      if (rootVersion !== undefined && rootPkgVersion !== undefined && normalizeVersion(rootVersion) !== normalizeVersion(rootPkgVersion)) {
        blocking.push(`package-lock.json's own "version" (${rootVersion}) and packages[""].version (${rootPkgVersion}) disagree with each other.`);
      }
    }
  }

  return { ok: blocking.length === 0, blocking, packageVersion, lockVersion, targetVersion };
}

// Part 9 — channel-aware release gate. Wraps checkVersionTagAlignment with
// the channel-shape and (for stable) source-drift checks docs/product's
// Part 9 design calls for. Every failure here is BLOCKING (non-zero exit
// from the CLI) — there is deliberately no warning-only path for a
// release-critical mismatch, per the design's own explicit instruction.
const RC_VERSION_SHAPE = /^\d+\.\d+\.\d+-rc\.\d+$/;
const STABLE_VERSION_SHAPE = /^\d+\.\d+\.\d+$/;

// Files whose version field is EXPECTED to differ between an RC commit and
// its promoted Stable commit (the version bump itself) — excluded from the
// source-drift comparison. Any other changed file means the Stable build
// would not be building the exact source the RC was verified against.
// MUST be kept in lockstep with whatever files a version bump actually
// touches (currently `npm version` writes exactly these two) — if that ever
// changes, every legitimate promotion will hit a false-positive drift block
// (fail-closed, not a correctness hole, but repeated forced
// --override-drift-check use is how a safety gate gets normalized into
// background noise instead of caught).
const VERSION_BUMP_ONLY_FILES = new Set(['package.json', 'package-lock.json']);

function checkSourceDrift(verifiedRcCommit, stableCommit) {
  if (!gitInfo.refExists(verifiedRcCommit)) {
    return { checked: false, drifted: null, changedFiles: [], reason: `verifiedRcCommit "${verifiedRcCommit}" does not resolve to a real commit.` };
  }
  if (!gitInfo.refExists(stableCommit)) {
    return { checked: false, drifted: null, changedFiles: [], reason: `stableCommit "${stableCommit}" does not resolve to a real commit.` };
  }
  const changed = gitInfo.changedFiles(verifiedRcCommit, stableCommit).filter((f) => !VERSION_BUMP_ONLY_FILES.has(f));
  return { checked: true, drifted: changed.length > 0, changedFiles: changed, reason: null };
}

// Part 9 code-review follow-up: the Stable CI path (a plain `push: tags: v*`
// event) has no workflow_dispatch inputs to carry an explicit --rc-commit,
// so without this, wiring the gate into that path would always fall through
// to "no verifiedRcCommit provided" and require a human to remember
// --override-drift-check on every single Stable release — precisely the
// kind of manual step PM-002 showed gets forgotten. Auto-discovers the
// highest-numbered "vX.Y.Z-rc.*" tag for a given Stable version from git
// tag history alone (no human input) via gitInfo.listTagsMatching(), which
// routes through the same execFileSync-based safe git wrapper as every
// other git call in this module. Returns null (not an error) when no RC
// tag exists for this version — a Stable release with no preceding RC is
// legitimate (e.g. an emergency hotfix) and the caller must still supply
// --override-drift-check in that case, exactly as an explicit --rc-commit
// omission already requires.
function resolvePriorRcTag(stableVersion) {
  const pattern = `v${stableVersion}-rc.*`;
  const matches = gitInfo.listTagsMatching(pattern);
  return matches.length > 0 ? matches[0] : null; // pre-sorted -v:refname (highest RC number first)
}

function checkChannelReleaseGate(repoRoot, opts) {
  const { channel, tagOrVersion, stableCommit = 'HEAD', overrideDriftReason, autoDiscoverRcCommit } = opts;
  const blocking = [];
  const versionAlignment = checkVersionTagAlignment(repoRoot, tagOrVersion);
  if (!versionAlignment.ok) blocking.push(...versionAlignment.blocking);

  // Auto-discovery exists because the Stable CI path (a plain `push: tags:
  // v*` event) has no workflow_dispatch inputs to carry an explicit
  // --rc-commit — without this, wiring the gate into that path would always
  // require a human to remember --override-drift-check on every release,
  // exactly the kind of manual step PM-002 showed gets forgotten. Only used
  // when the caller didn't already supply an explicit verifiedRcCommit.
  let verifiedRcCommit = opts.verifiedRcCommit || null;
  let autoDiscoveredRcTag = null;
  if (!verifiedRcCommit && autoDiscoverRcCommit && STABLE_VERSION_SHAPE.test(versionAlignment.targetVersion)) {
    autoDiscoveredRcTag = resolvePriorRcTag(versionAlignment.targetVersion);
    if (autoDiscoveredRcTag) verifiedRcCommit = autoDiscoveredRcTag;
  }

  const result = { channel, ...versionAlignment, blocking, sourceDrift: null, overrideDriftReason: overrideDriftReason || null, autoDiscoveredRcTag };

  if (channel === 'rc') {
    if (!RC_VERSION_SHAPE.test(versionAlignment.targetVersion)) {
      blocking.push(`RC channel requires a version shaped "X.Y.Z-rc.N" (e.g. "0.9.12-rc.1"), got "${versionAlignment.targetVersion}".`);
    }
  } else if (channel === 'stable') {
    if (!STABLE_VERSION_SHAPE.test(versionAlignment.targetVersion)) {
      blocking.push(`Stable channel requires a plain "X.Y.Z" version with no prerelease component, got "${versionAlignment.targetVersion}".`);
    }
    if (verifiedRcCommit) {
      const drift = checkSourceDrift(verifiedRcCommit, stableCommit);
      result.sourceDrift = drift;
      if (!drift.checked) {
        blocking.push(`Could not verify source drift against the approved RC commit: ${drift.reason}`);
      } else if (drift.drifted && !overrideDriftReason) {
        blocking.push(
          `Stable commit differs from the approved RC commit (${verifiedRcCommit}${autoDiscoveredRcTag ? `, auto-discovered from tag ${autoDiscoveredRcTag}` : ''}) in ${drift.changedFiles.length} file(s) beyond the version bump: ${drift.changedFiles.join(', ')}. ` +
          `Stable must build the exact source the RC was verified against — pass --override-drift-check "<reason>" only if this divergence is understood and intentional.`
        );
      }
    } else if (!overrideDriftReason) {
      blocking.push(
        'No verifiedRcCommit provided and none could be auto-discovered from RC tag history — Stable release provenance could not be tied to an approved RC. ' +
        'Pass --rc-commit <sha>, or --override-drift-check "<reason>" if this Stable release is intentionally not preceded by an RC (e.g. an emergency hotfix).'
      );
    }
    // Deliberately parseProductDocs.loadAll() rather than build.assemble() —
    // buildKnownIssues() only ever reads parsed.bugs, and build.assemble()
    // additionally runs the roadmap-dashboard consistency check (throws
    // DashboardDisagreementError on a real disagreement elsewhere in
    // docs/product/, which has nothing to do with what this gate checks) and
    // does the full generated-artifact build — real, avoidable cost and an
    // unrelated failure mode this gate should never be able to trip
    // (code-review finding, Part 9).
    const openIssues = buildKnownIssues(parseProductDocs.loadAll(path.join(repoRoot, 'docs', 'product')));
    if (openIssues.length > 0) {
      blocking.push(`${openIssues.length} bug(s) are currently Open/Investigating and would block Stable: ${openIssues.map((b) => b.id).join(', ')}.`);
      result.blockingBugs = openIssues;
    }
  } else {
    blocking.push(`Unknown channel "${channel}" — expected "rc" or "stable".`);
  }

  result.ok = blocking.length === 0;
  result.blocking = blocking;
  return result;
}

module.exports = {
  buildReleaseDraft, renderReleaseDraftMd, writeReleaseDraft, classifyCommitSubject,
  resolveFromRef, listReleaseDrafts, checkVersionTagAlignment, checkChannelReleaseGate,
};
