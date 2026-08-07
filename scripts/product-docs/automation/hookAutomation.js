'use strict';

// Part 7A — the JS logic behind the version-controlled git hooks
// (hooks/pre-commit, hooks/post-commit, hooks/pre-push). Kept out of the
// shell scripts themselves so it's unit-testable without spawning a real
// git hook, per the same "dispatcher is thin, logic lives in a module"
// convention as cli.js/automation/cli.js.
//
// Reuses Part 5/6 machinery unchanged: evidencePacket for session state,
// orchestrator.finalize/dryRunSession for the only code path that ever
// writes a canonical doc, lib/validators.js for documentation health,
// auditLog for the run trail. Adds no new canonical-write path of its own.

const { execFileSync } = require('child_process');
const { REPO_ROOT, GENERATED_ROOT } = require('../lib/repoRoot');
const evidencePacket = require('./evidencePacket');
const orchestrator = require('./orchestrator');
const auditLog = require('./auditLog');
const gitInfo = require('../lib/gitInfo');
const build = require('../lib/build');
const validators = require('../lib/validators');
const { checkGeneratedSchemas } = require('../lib/validateSchemas');
const { summarize } = require('../lib/renderHealth');
const { rebuildGeneratedArtifacts } = require('./lifecycleUpdater');

// stderr is explicitly ignored, not inherited — several callers (the
// upstream-branch check in buildPushImpactSummary, in particular) expect
// git to fail in an ordinary, already-handled way (e.g. "no upstream
// configured" on a brand-new branch's first push) and must not leak that
// as noise into a hook's own stdout/stderr.
function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function stagedFiles() {
  const raw = git(['diff', '--cached', '--name-only']);
  return raw ? raw.split('\n').filter(Boolean) : [];
}

function intersects(a, b) {
  const setB = new Set(b || []);
  return (a || []).some((x) => setB.has(x));
}

// Same checks cli.js's cmdValidate runs, factored out so hookAutomation
// never has to shell out to its own CLI to answer "would validate pass?" —
// a hook that shells out to itself is harder to unit test and slower.
// Accepts an already-computed `assemble()` result so a caller juggling
// several build-derived checks in one gate (prePushGate below) only pays
// the full docs/product/ parse+index cost once (found in Part 7
// performance review — validate and the push-impact summary were each
// independently re-assembling the whole index).
function runValidate(assembled) {
  const { parsed, built, files } = assembled || build.assemble();
  const gitIsDirty = gitInfo.isWorkingTreeDirty();
  const findings = validators.runAllChecks(parsed, built, { gitIsDirty });
  findings.push(...validators.checkGeneratedFreshness(files, GENERATED_ROOT));
  findings.push(...checkGeneratedSchemas(files));
  const summary = summarize(findings);
  return { findings, summary, ok: summary.error === 0 };
}

// --- pre-commit ----------------------------------------------------------
//
// Fast path: discover pending Evidence Packets, map them against staged
// files, verify docs/product/generated/ freshness when docs/product/ itself
// is staged, and block only on the two hard failures the brief specifies —
// stale/invalid generated output, and an unfinalized STRICT-mode session
// whose affected_files overlap what's being committed. Never auto-finalizes
// here — finalize is a terminal action and a commit is frequently mid-task,
// not task-complete (that stronger signal is reserved for pre-push below).
function preCommitGate({ staged } = {}) {
  const files = staged || stagedFiles();
  if (files.length === 0) return { ok: true, staged: files, blocking: [], notes: ['no staged files'] };

  const blocking = [];
  const notes = [];

  const docsProductStaged = files.filter((f) => f.startsWith('docs/product/') && !f.startsWith('docs/product/generated/'));
  if (docsProductStaged.length > 0) {
    const v = runValidate();
    if (!v.ok) {
      blocking.push({
        rule: 'stale-or-invalid-generated-output',
        message: `${v.summary.error} error-level documentation-health finding(s). Run "node scripts/product-docs/cli.js build && node scripts/product-docs/cli.js validate" and re-stage.`,
      });
    } else {
      notes.push('docs/product/ validation passed.');
    }
  }

  const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const pending = evidencePacket.listPending();
  for (const packet of pending) {
    if (packet.automation_mode !== 'strict') continue;
    if (packet.automation_status !== 'in-progress' && packet.automation_status !== 'pending') continue;
    // Scoped to the session's own branch — a STRICT session started on one
    // branch must never block a commit on a completely unrelated branch in
    // the same clone (found in Part 7 code review: before its first
    // `automation update`, an empty affected_files list combined with an
    // unscoped check blocked EVERY subsequent commit repo-wide, not just
    // overlapping ones).
    if (packet.branch !== currentBranch) continue;
    // An empty affected_files list means the session hasn't recorded which
    // files it touches yet — treat that as "can't rule out overlap" rather
    // than silently skipping the block, matching this system's fail-closed
    // stance on ambiguous evidence.
    const overlaps = (packet.affected_files || []).length === 0 || intersects(packet.affected_files, files);
    if (overlaps) {
      blocking.push({
        rule: 'strict-session-unfinalized',
        message: `STRICT-mode session ${packet.session_id} ("${packet.task_title}") overlaps staged files and is not finalized. Run "node scripts/product-docs/cli.js automation finalize ${packet.session_id}" first, or set AUTOINGEST_DOCS_BYPASS=1 for an audited emergency bypass.`,
        session_id: packet.session_id,
      });
    }
  }

  return { ok: blocking.length === 0, staged: files, blocking, notes, pending_session_count: pending.length };
}

// --- pre-push --------------------------------------------------------------
//
// A push is a stronger "I'm sharing this now" signal than a commit, so this
// is where a pending session that already has recorded evidence and whose
// validation gate would pass cleanly gets auto-finalized — never a session
// that's still `pending` (started but never updated: nothing to finalize)
// and never one whose gate would block (this never invents evidence to make
// a gate pass; it only finalizes what was already going to pass on its own).
function autoFinalizeEligible() {
  const results = [];
  for (const packet of evidencePacket.listPending()) {
    if (packet.automation_status !== 'in-progress') {
      results.push({ session_id: packet.session_id, finalized: false, reason: `status is "${packet.automation_status}", not "in-progress" — no recorded evidence to finalize` });
      continue;
    }
    let dry;
    try {
      dry = orchestrator.dryRunSession(packet.session_id);
    } catch (err) {
      results.push({ session_id: packet.session_id, finalized: false, reason: `dry-run failed: ${err.message}` });
      continue;
    }
    if (!dry.gateResult.ok) {
      results.push({
        session_id: packet.session_id,
        finalized: false,
        reason: 'evidence gate would block — left pending rather than forced through',
        blocking_errors: dry.gateResult.blocking_errors,
      });
      continue;
    }
    const result = orchestrator.finalize(packet.session_id);
    results.push({
      session_id: packet.session_id,
      finalized: !!result.ok,
      records_created: result.runRecord ? result.runRecord.records_created : [],
    });
  }
  return results;
}

function buildPushImpactSummary(assembled) {
  let upstream = null;
  try {
    upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  } catch {
    return { has_upstream: false, note: 'No upstream tracking branch configured — cannot diff against remote for an impact summary yet (expected on a brand-new branch\'s first push).' };
  }
  if (!gitInfo.refExists(upstream)) {
    return { has_upstream: false, note: `Upstream ref "${upstream}" not resolvable locally — run a fetch first for an accurate impact summary.` };
  }
  const { built } = assembled || build.assemble();
  const changed = gitInfo.changedFiles(upstream, 'HEAD');
  const { resolveFileOwnership } = require('../lib/changeReport');
  const subsystemById = new Map(built.subsystems.map((s) => [s.id, s]));
  const features = new Set();
  const unknownFiles = [];
  for (const f of changed) {
    const { confidence, subsystems } = resolveFileOwnership(f, built.sourceIndex);
    if (confidence === 'unknown') { unknownFiles.push(f); continue; }
    for (const subId of subsystems) {
      const s = subsystemById.get(subId);
      if (s) for (const feat of s.primaryFeatures) features.add(feat);
    }
  }
  return {
    has_upstream: true,
    upstream,
    commits_ahead: gitInfo.log(upstream, 'HEAD').length,
    files_changed: changed.length,
    affected_features: Array.from(features).sort(),
    unknown_files: unknownFiles,
  };
}

// autoFinalizeEligible() above may have just written new canonical
// docs/product/ content (changelog entries, feature-evolution appends, a
// bug/decision/postmortem record) and rebuilt generated/ — but nothing
// commits it, and `git push` only ever sends commits that already exist.
// Those writes would otherwise land in the working tree completely
// unannounced, the exact "silently unreported follow-up change" the brief
// warns against for post-commit reconciliation — the same risk applies
// here since pre-push is where auto-finalize actually happens (found in
// Part 7 architecture review). Never auto-commits it (no hidden commit
// mutation, matching the brief's default policy) — only ever reports it
// loudly enough that it can't be missed.
// Deliberately avoids parsing `git status --porcelain`'s status-column
// width (its two-letter status code is one width for an index-staged entry
// and a different width for a worktree-only entry, easy to get wrong) —
// instead combines three unambiguous `--name-only` queries covering
// unstaged, staged, and untracked, matching how `automation update`'s own
// `collectGitFacts` already avoids that class of parsing.
function uncommittedDocsChanges() {
  const unstaged = git(['diff', '--name-only', '--', 'docs/product/']);
  const staged = git(['diff', '--name-only', '--cached', '--', 'docs/product/']);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'docs/product/']);
  const all = new Set();
  for (const block of [unstaged, staged, untracked]) {
    if (!block) continue;
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) all.add(trimmed);
    }
  }
  return Array.from(all).sort();
}

function prePushGate() {
  const autoFinalized = autoFinalizeEligible();
  // One shared assemble() for both validate and the push-impact summary —
  // each used to independently rebuild the whole docs/product/ index
  // (found in Part 7 performance review). autoFinalizeEligible() above
  // still calls into orchestrator.dryRunSession/finalize, which do their
  // own internal assemble() per pending session — that duplication is
  // Part 5's existing, separately-tested finalize sequence and is left
  // alone here rather than risked mid-review.
  const assembled = build.assemble();
  const v = runValidate(assembled);
  const remaining = evidencePacket.listPending();
  const strictBlocking = remaining.filter((p) => p.automation_mode === 'strict' && p.automation_status === 'in-progress');
  const errorLevelPackets = remaining.filter((p) => p.automation_status === 'failed');
  const impactSummary = buildPushImpactSummary(assembled);
  const uncommittedDocs = uncommittedDocsChanges();
  // Part 8 — informational only, never a STANDARD-mode blocker (see
  // docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 19): report how
  // many conversation-sourced implementation requests have no recorded
  // Implemented outcome yet, so they don't silently fall out of view.
  const unimplementedConversationRequirements = (assembled.built.unimplementedRequirements || []).length;
  const ok = v.ok && strictBlocking.length === 0;
  return {
    ok,
    validate_summary: v.summary,
    auto_finalized: autoFinalized,
    strict_blocking_sessions: strictBlocking.map((p) => p.session_id),
    unresolved_failed_sessions: errorLevelPackets.map((p) => p.session_id),
    push_impact_summary: impactSummary,
    uncommitted_canonical_changes: uncommittedDocs,
    uncommitted_canonical_changes_note: uncommittedDocs.length
      ? `${uncommittedDocs.length} file(s) under docs/product/ were written by auto-finalize during this pre-push check and are NOT committed. This push proceeds without them — commit and push again, or they remain only in your local working tree.`
      : null,
    unimplemented_conversation_requirements_count: unimplementedConversationRequirements,
    unimplemented_conversation_requirements_note: unimplementedConversationRequirements
      ? `${unimplementedConversationRequirements} conversation-sourced implementation request(s) have no recorded "Implemented" outcome yet — see docs/product/generated/UNIMPLEMENTED_CONVERSATION_REQUIREMENTS.md. Informational only, never blocks this push.`
      : null,
  };
}

// --- post-commit -----------------------------------------------------------
//
// Never rewrites the commit that just happened. Attaches the new commit
// hash to any pending session it plausibly belongs to (branch match +
// affected_files overlap with what the commit actually touched) — a
// non-canonical, best-effort link recorded on the packet's own `commits`
// array (already a mutable, in-progress structure) and in the audit log.
// Then reconciles generated/ the same way `automation reconcile` already
// does. Failures here are reported, never silently swallowed, and never
// block (the commit already exists).

// Part 8 — best-effort reconciliation of a conversation's Outcome log
// against real commit evidence, extending postCommitLink the same way it
// already extends Evidence Packet sessions. Never imports anything new
// (see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 19 / § 10 —
// this reads existing canonical docs/product/conversations/ records only).
// A conversation is only ever marked Implemented here when its own primary
// feature ownership genuinely overlaps what this commit's changed files
// resolve to — never a keyword guess.
// Cheap pre-check, deliberately callable BEFORE the caller pays for a full
// build.assemble() — an empty commit (no changed files) or a repository
// with no docs/product/conversations/ directory yet has nothing this
// function could possibly do, and the caller (postCommitLink) should never
// spend a full docs/product/ parse to discover that (found in Part 8
// performance review: an earlier version called build.assemble() first,
// unconditionally, even for a commit this function would immediately
// no-op on).
function conversationLinkingCouldApply(changed) {
  if (!changed || changed.length === 0) return false;
  let CONVERSATION_DOCS_ROOT;
  try {
    ({ CONVERSATION_DOCS_ROOT } = require('./conversation/paths'));
  } catch {
    return false; // module not present in an older checkout
  }
  return require('fs').existsSync(CONVERSATION_DOCS_ROOT);
}

function linkCommitToConversations(headCommit, changed, built) {
  const fs = require('fs');
  const path = require('path');
  const { CONVERSATION_DOCS_ROOT } = require('./conversation/paths');
  const { resolveFileOwnership } = require('../lib/changeReport');
  const changedFeatureIds = new Set();
  const subsystemById = new Map((built.subsystems || []).map((s) => [s.id, s]));
  for (const f of changed) {
    const { confidence, subsystems } = resolveFileOwnership(f, built.sourceIndex);
    if (confidence === 'unknown') continue;
    for (const subId of subsystems) {
      const s = subsystemById.get(subId);
      if (s) for (const feat of s.primaryFeatures) changedFeatureIds.add(feat);
    }
  }
  if (changedFeatureIds.size === 0) return [];

  const md = require('../lib/markdown');
  const { atomicWriteFileSync } = require('./atomicWrite');
  const { appendLineToSection } = require('./markdownSections');
  const linked = [];
  for (const file of fs.readdirSync(CONVERSATION_DOCS_ROOT)) {
    if (!/^ENG-CONV-\d{4}_.+\.md$/.test(file)) continue;
    const filePath = path.join(CONVERSATION_DOCS_ROOT, file);
    const content = fs.readFileSync(filePath, 'utf8');
    if (/^-\s+\*\*\d{4}-\d{2}-\d{2}\*\*\s+—\s+Implemented/im.test(md.extractSection(content, 'Outcome') || '')) continue; // already Implemented
    const handoff = md.extractSection(content, 'Implementation Handoff') || '';
    if (/^-\s+\*\*Work requested\*\*:\s*None recorded\.?$/im.test(handoff.trim())) continue; // nothing was ever requested
    const relSection = md.extractSection(content, 'Relationships') || '';
    const relTable = relSection ? md.extractHeaderTable(relSection) : {};
    const primaryFeatureIds = require('../lib/ids').extractIds(String(relTable['Primary feature IDs'] || ''), 'feature');
    if (!primaryFeatureIds.some((id) => changedFeatureIds.has(id))) continue;
    const idMatch = /^(ENG-CONV-\d{4})_/.exec(file);
    const convId = idMatch ? idMatch[1] : null;
    if (!convId) continue;
    const line = `- **${new Date().toISOString().slice(0, 10)}** — Implemented — commit \`${headCommit.slice(0, 8)}\` (post-commit reconciliation; changed file(s) resolved to ${primaryFeatureIds.filter((id) => changedFeatureIds.has(id)).join(', ')}).`;
    const updated = appendLineToSection(content, 'Outcome', line).replace(/(\| Status \|)([^|\n]*)(\|)/, `$1 Implemented $3`);
    if (updated !== content) {
      atomicWriteFileSync(filePath, updated);
      linked.push(convId);
    }
  }
  return linked;
}

function postCommitLink() {
  const headCommit = git(['rev-parse', 'HEAD']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const changedRaw = git(['diff-tree', '--no-commit-id', '--name-only', '-r', headCommit]);
  const changed = changedRaw ? changedRaw.split('\n').filter(Boolean) : [];

  const linked = [];
  for (const packet of evidencePacket.listPending()) {
    if (packet.branch !== branch) continue;
    if ((packet.commits || []).some((c) => (c && (c.hash || c)) === headCommit)) continue;
    if (!intersects(packet.affected_files, changed)) continue;
    packet.commits = [...(packet.commits || []), { hash: headCommit, short: headCommit.slice(0, 8), linked_by: 'post-commit-hook' }];
    evidencePacket.persist(packet, { event: 'post-commit-link' });
    linked.push(packet.session_id);
  }

  let linkedConversations = [];
  if (conversationLinkingCouldApply(changed)) {
    try {
      const { built } = build.assemble();
      linkedConversations = linkCommitToConversations(headCommit, changed, built);
    } catch {
      linkedConversations = []; // best-effort only — never blocks post-commit
    }
  }

  const rebuild = rebuildGeneratedArtifacts();

  auditLog.recordRun({
    run_id: `postcommit-${Date.now()}`,
    mode: 'n/a',
    trigger: 'post-commit',
    branch,
    base_commit: headCommit,
    head_commit: headCommit,
    command: 'automation post-commit-link',
    files_inspected: changed,
    generated_rebuilt: !!rebuild.ok,
    outcome: rebuild.ok ? 'ok' : 'rebuild-failed',
    duration_ms: 0,
    warnings: [
      ...linked.map((id) => `linked commit ${headCommit.slice(0, 8)} to session ${id}`),
      ...linkedConversations.map((id) => `linked commit ${headCommit.slice(0, 8)} to conversation ${id} (Outcome -> Implemented)`),
    ],
    evidence_gaps: [],
  });

  return {
    commit: headCommit, branch, linked_sessions: linked, linked_conversations: linkedConversations,
    changed_files: changed, generated_rebuilt: !!rebuild.ok, rebuild_output: rebuild.ok ? null : rebuild.output,
  };
}

module.exports = {
  stagedFiles,
  preCommitGate,
  autoFinalizeEligible,
  buildPushImpactSummary,
  prePushGate,
  postCommitLink,
  runValidate,
};
