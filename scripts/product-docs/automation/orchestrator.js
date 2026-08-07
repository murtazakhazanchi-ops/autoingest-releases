'use strict';

// Top-level automation entry points, called by the CLI's `automation *`
// subcommands. Wires together: evidencePacket (state) -> eventCollector
// (deterministic facts) -> changeClassifier (confidence-labeled mapping)
// -> documentationPlanner (evidence-gated plan) -> canonicalUpdater
// (executes only justified actions) -> lifecycleUpdater (rebuild + gate) ->
// validationGate (mode-aware pass/fail) -> auditLog (record the run).

const crypto = require('crypto');
const evidencePacket = require('./evidencePacket');
const { collectGitFacts } = require('./eventCollector');
const { classify } = require('./changeClassifier');
const { planDocumentation } = require('./documentationPlanner');
const { applyPlan } = require('./canonicalUpdater');
const { rebuildGeneratedArtifacts, applyRoadmapTransition } = require('./lifecycleUpdater');
const validationGate = require('./validationGate');
const auditLog = require('./auditLog');
const recovery = require('./recovery');
const build = require('../lib/build');

function resolveMode(explicitMode) {
  if (explicitMode && evidencePacket.AUTOMATION_MODES.includes(explicitMode)) return explicitMode;
  const envMode = (process.env.AUTOINGEST_DOCS_MODE || '').toLowerCase();
  if (evidencePacket.AUTOMATION_MODES.includes(envMode)) return envMode;
  return 'standard';
}

function newRunId() {
  return `run-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function start({ taskType, taskTitle, taskSummary, userRequestSummary, mode }) {
  const packet = evidencePacket.createPacket({ taskType, taskTitle, taskSummary, userRequestSummary, mode: resolveMode(mode) });
  evidencePacket.persist(packet, { event: 'start' });
  return packet;
}

// Merges caller-supplied evidence into the packet's append-only arrays
// (bugs_discovered, decisions_made, alternatives_considered, tests_run,
// etc.) and refreshes deterministic git facts. Never overwrites an
// existing array entry — only appends, matching Append, Never Erase.
function update(sessionId, patch = {}) {
  const found = evidencePacket.loadPacket(sessionId);
  if (!found) throw new Error(`No packet found for session ${sessionId}`);
  const packet = found.packet;
  if (found.dir !== require('./paths').PENDING_DIR) {
    throw new Error(`Session ${sessionId} is not pending (already ${packet.automation_status}) — cannot update`);
  }

  const gitFacts = collectGitFacts(packet);
  packet.head_commit = gitFacts.head_commit;
  packet.affected_files = Array.from(new Set([...(packet.affected_files || []), ...gitFacts.affected_files]));
  packet.commits = gitFacts.commits.length ? gitFacts.commits : packet.commits;

  const arrayFields = [
    'bugs_discovered', 'decisions_made', 'alternatives_considered', 'rejected_solutions',
    'tests_run', 'test_results', 'manual_verification', 'performance_results',
    'risks', 'unresolved_gaps', 'changed_symbols', 'evidence_sources',
  ];
  for (const field of arrayFields) {
    if (Array.isArray(patch[field])) {
      packet[field] = [...(packet[field] || []), ...patch[field]];
    }
  }
  const scalarFields = ['task_summary', 'user_request_summary', 'accepted_solution', 'root_cause', 'implementation_summary', 'release_impact', 'confidence'];
  for (const field of scalarFields) {
    if (patch[field] !== undefined) packet[field] = patch[field];
  }
  if (patch.automation_mode && evidencePacket.AUTOMATION_MODES.includes(patch.automation_mode)) {
    packet.automation_mode = patch.automation_mode;
  }
  packet.automation_status = 'in-progress';
  evidencePacket.persist(packet, { event: 'update' });
  return packet;
}

function status() {
  return {
    pending: recovery.scanPending(),
    stale_locks: recovery.listStaleLocks(),
  };
}

function recoverAll() {
  return recovery.recoverAll();
}

// The core finalize sequence. `applyWrites` controls whether
// canonicalUpdater/lifecycleUpdater actually mutate the filesystem —
// `dryRun()` calls this with applyWrites: false to get the exact same
// classification/plan/gate output with a hard no-write guarantee.
function runFinalizeSequence(packet, { applyWrites, refreshGitFacts = true }) {
  const runId = newRunId();
  const startedAt = Date.now();
  const { parsed, built } = build.assemble();

  if (refreshGitFacts) {
    const gitFacts = collectGitFacts(packet);
    packet.head_commit = gitFacts.head_commit;
    packet.affected_files = Array.from(new Set([...(packet.affected_files || []), ...gitFacts.affected_files]));
    if (gitFacts.commits.length) packet.commits = gitFacts.commits;
  }

  const classification = classify(packet, { parsed, built });
  packet.affected_feature_ids = classification.primary_feature_ids;
  packet.affected_roadmap_ids = classification.affected_roadmap_ids;
  packet.affected_subsystems = classification.affected_subsystems;
  packet.classification = classification;
  packet.confidence = classification.confidence;

  const mode = packet.automation_mode || 'standard';
  const plan = planDocumentation(packet, classification);

  let updateReport = null;
  let rebuildResult = null;
  if (applyWrites && mode !== 'observe') {
    updateReport = applyPlan(packet, classification, plan, parsed);
    // Persist immediately: applyPlan may have mutated packet.bugs_discovered[*]
    // .created_record_id / packet.decision_record_created_id /
    // packet.postmortem_record_created_id. If rebuildGeneratedArtifacts or
    // validationGate.gate below throws, those markers must already be
    // durable on disk — otherwise a retried finalize would re-allocate a
    // second ID for evidence that was already recorded (found in code
    // review; see canonicalUpdater.js's retry-safety comment).
    evidencePacket.persist(packet, { event: 'plan-applied' });
    rebuildResult = rebuildGeneratedArtifacts();
  }

  const gateResult = validationGate.gate(packet, plan, mode);

  const durationMs = Date.now() - startedAt;
  const canonicalFilesModified = updateReport
    ? [
      updateReport.changelog.applied ? updateReport.changelog.path : null,
      ...updateReport.feature_evolution.filter((r) => r.applied).map((r) => r.path),
      ...updateReport.bug_records.filter((r) => r.applied).map((r) => r.path),
      ...updateReport.decision_records.filter((r) => r.applied).map((r) => r.path),
      ...updateReport.postmortems.filter((r) => r.applied).map((r) => r.path),
    ].filter(Boolean)
    : [];
  const recordsCreated = updateReport
    ? [
      ...updateReport.bug_records.filter((r) => r.applied).map((r) => r.id),
      ...updateReport.decision_records.filter((r) => r.applied).map((r) => r.id),
      ...updateReport.postmortems.filter((r) => r.applied).map((r) => r.id),
    ]
    : [];

  const runRecord = {
    run_id: runId,
    mode,
    trigger: applyWrites ? 'finalize' : 'dry-run',
    branch: packet.branch,
    base_commit: packet.base_commit,
    head_commit: packet.head_commit,
    command: applyWrites ? 'automation finalize' : 'automation dry-run',
    files_inspected: packet.affected_files,
    feature_mappings: classification.primary_feature_ids,
    canonical_files_modified: canonicalFilesModified,
    generated_rebuilt: !!(rebuildResult && rebuildResult.ok),
    records_created: recordsCreated,
    validation_summary: { ok: gateResult.ok, blocking_errors: gateResult.blocking_errors.length },
    warnings: gateResult.unjustified_actions.map((a) => a.reason),
    evidence_gaps: packet.unresolved_gaps || [],
    duration_ms: durationMs,
    outcome: gateResult.ok ? 'pass' : 'blocked',
  };

  return { runId, classification, plan, updateReport, rebuildResult, gateResult, runRecord, durationMs };
}

function finalize(sessionId) {
  const found = evidencePacket.loadPacket(sessionId);
  if (!found) throw new Error(`No packet found for session ${sessionId}`);
  if (found.dir !== require('./paths').PENDING_DIR) {
    // Already terminal (completed/failed) — re-finalizing here would be
    // confusing even though canonicalUpdater's own idempotent writes make
    // it safe. Report the prior outcome instead of silently re-running.
    return {
      ok: found.packet.automation_status === 'completed',
      packet: found.packet,
      alreadyTerminal: true,
      gateResult: found.packet.finalize_report || { mode: found.packet.automation_mode, ok: found.packet.automation_status === 'completed', blocking_errors: [] },
      plan: {}, updateReport: null, rebuildResult: null,
      runRecord: { outcome: found.packet.automation_status, note: 'no-op — session already terminal' },
      durationMs: 0,
    };
  }
  const packet = found.packet;
  packet.automation_status = 'finalizing';
  evidencePacket.persist(packet, { event: 'finalize-start' });

  // A thrown exception here must never leave the packet stuck in pending/
  // at automation_status:'finalizing' — recovery.js's scanPending doesn't
  // distinguish that from an ordinary in-progress session, so an operator
  // re-running finalize would silently re-attempt from scratch (found in
  // code review). Any failure — including one canonicalUpdater/lifecycleUpdater
  // itself doesn't turn into a clean {ok:false} result — is caught here,
  // recorded to the audit log, and moves the packet to failed/ with the
  // error preserved as an unresolved gap.
  let result;
  try {
    result = runFinalizeSequence(packet, { applyWrites: true });
  } catch (err) {
    packet.automation_status = 'failed';
    packet.unresolved_gaps = [...(packet.unresolved_gaps || []), `finalize crashed: ${err.message}`];
    evidencePacket.moveToTerminal(packet, 'failed');
    auditLog.recordRun({
      run_id: newRunId(), mode: packet.automation_mode, trigger: 'finalize',
      branch: packet.branch, base_commit: packet.base_commit, head_commit: packet.head_commit,
      command: 'automation finalize', outcome: 'crashed', duration_ms: 0,
      warnings: [err.message], evidence_gaps: packet.unresolved_gaps,
    });
    return {
      ok: false, packet, crashed: true, error: err.message,
      gateResult: { mode: packet.automation_mode, ok: false, blocking_errors: [err.message] },
      plan: {}, updateReport: null, rebuildResult: null,
      runRecord: { outcome: 'crashed' }, durationMs: 0,
    };
  }
  auditLog.recordRun(result.runRecord);

  if (!result.gateResult.ok) {
    packet.automation_status = 'failed';
    packet.finalize_report = result.gateResult;
    evidencePacket.moveToTerminal(packet, 'failed');
    return { ok: false, packet, ...result };
  }

  // Part 6 — Engineering Memory: best-effort, never blocks Part 5's own
  // finalize. Reuses THIS packet's own evidence (bugs_discovered,
  // decisions_made, alternatives_considered, etc.) plus any raw memory
  // events explicitly recorded on the same session_id via `memory <sub>` —
  // see automation/memory/lifecycle.js's maybeCompileFromPacket and
  // docs/product/16_ENGINEERING_MEMORY_POLICY.md § 8/§ 16. A thrown error
  // here is swallowed inside maybeCompileFromPacket itself, never here.
  const memoryResult = require('./memory/lifecycle').maybeCompileFromPacket(packet);
  if (memoryResult && memoryResult.created) {
    packet.memory_capsule_id = memoryResult.capsuleId;
    // A new docs/product/memory/AI-MEM-####_*.md file changes parsed.allFiles
    // (lib/parseProductDocs.js's listMarkdownFiles walks docs/product/memory/
    // generically) even before any memory-specific generated artifact exists
    // for it — so the on-disk generated/ snapshot rebuildGeneratedArtifacts()
    // just wrote above is now stale the instant this file lands. Rebuild
    // again so `validate` never sees a stale-generated-output finding caused
    // by memory compilation itself.
    const memoryRebuildResult = rebuildGeneratedArtifacts();
    if (!memoryRebuildResult.ok) {
      // Unlike the first (Part 5) rebuild, this one's result previously went
      // unrecorded — a failure here left generated/ silently stale with no
      // audit trail until a human happened to re-run `validate` (found in
      // code review). Append a dedicated audit entry so the failure is at
      // least discoverable; still never blocks — this is Part 6's own
      // best-effort guarantee, not Part 5's.
      auditLog.recordRun({
        run_id: newRunId(), mode: packet.automation_mode, trigger: 'finalize',
        branch: packet.branch, base_commit: packet.base_commit, head_commit: packet.head_commit,
        command: 'automation finalize (post-memory-capsule rebuild)', outcome: 'rebuild-failed',
        duration_ms: 0, warnings: [`rebuildGeneratedArtifacts failed after creating ${memoryResult.capsuleId}: ${memoryRebuildResult.output || 'no output captured'}`],
        evidence_gaps: [],
      });
    }
  }

  // Part 7B — Architectural Decision Intelligence: same best-effort,
  // never-blocks-Part-5 contract as the memory compilation step above.
  // Structural-signal detection only (never invents a rationale); creates
  // a canonical Status: Draft record only when the packet's own recorded
  // evidence already clears the same bar Part 5's explicit decision-record
  // path uses, otherwise leaves a local, non-canonical review-required
  // candidate under .autoingest-docs/decision-candidates/.
  let decisionIntelResult = null;
  try {
    decisionIntelResult = require('./decisionIntelligence').scanPacket(packet);
    if (decisionIntelResult && decisionIntelResult.state === 'draft') {
      packet.architectural_decision_draft_id = decisionIntelResult.decision_id;
      const decisionRebuildResult = rebuildGeneratedArtifacts();
      if (!decisionRebuildResult.ok) {
        auditLog.recordRun({
          run_id: newRunId(), mode: packet.automation_mode, trigger: 'finalize',
          branch: packet.branch, base_commit: packet.base_commit, head_commit: packet.head_commit,
          command: 'automation finalize (post-decision-draft rebuild)', outcome: 'rebuild-failed',
          duration_ms: 0, warnings: [`rebuildGeneratedArtifacts failed after creating ${decisionIntelResult.decision_id}: ${decisionRebuildResult.output || 'no output captured'}`],
          evidence_gaps: [],
        });
      }
    }
  } catch (err) {
    auditLog.recordRun({
      run_id: newRunId(), mode: packet.automation_mode, trigger: 'finalize',
      branch: packet.branch, base_commit: packet.base_commit, head_commit: packet.head_commit,
      command: 'automation finalize (decision-intelligence scan)', outcome: 'decision-scan-failed',
      duration_ms: 0, warnings: [err.message], evidence_gaps: [],
    });
  }

  packet.automation_status = 'completed';
  packet.finalize_report = result.gateResult;
  evidencePacket.moveToTerminal(packet, 'completed');
  return { ok: true, packet, memoryResult, decisionIntelResult, ...result };
}

// Same sequence, zero writes — for `--dry-run` review before a real
// finalize. Never touches canonical docs, never rebuilds generated
// artifacts, never allocates an ID, never moves the packet out of pending/.
function dryRunSession(sessionId) {
  const found = evidencePacket.loadPacket(sessionId);
  if (!found) throw new Error(`No packet found for session ${sessionId}`);
  const packet = JSON.parse(JSON.stringify(found.packet)); // work on a copy — never persisted
  return runFinalizeSequence(packet, { applyWrites: false });
}

// Ad-hoc dry run over an arbitrary git range (`automation dry-run <fromRef>
// [toRef]`) — no live session required. Synthesizes an ephemeral,
// never-persisted packet from the range's own commits/changed files so CI
// or a curious operator can preview classification/plan/gate output for
// history that already happened, without ever touching .autoingest-docs/.
function dryRunRange(fromRef, toRef) {
  const gitInfo = require('../lib/gitInfo');
  if (!gitInfo.refExists(fromRef)) throw new Error(`Unknown git ref: ${fromRef}`);
  if (!gitInfo.refExists(toRef)) throw new Error(`Unknown git ref: ${toRef}`);
  const packet = evidencePacket.createPacket({ taskType: 'investigation', taskTitle: `dry-run ${fromRef}..${toRef}`, mode: 'observe' });
  packet.base_commit = gitInfo.resolveCommit(fromRef);
  packet.head_commit = gitInfo.resolveCommit(toRef);
  packet.affected_files = gitInfo.changedFiles(fromRef, toRef);
  packet.commits = gitInfo.log(fromRef, toRef).map((c) => ({ hash: c.hash, short: c.short, date: c.date, subject: c.subject }));
  const result = runFinalizeSequence(packet, { applyWrites: false, refreshGitFacts: false });
  return { packet, ...result };
}

function reconcile() {
  const rebuildResult = rebuildGeneratedArtifacts();
  const gateResult = validationGate.gate(
    evidencePacket.createPacket({ taskType: 'maintenance', taskTitle: 'reconcile' }),
    { changelog: [], feature_evolution: [], bug_records: [], decision_records: [], postmortems: [], roadmap_transitions: [], dependency_links: [] },
    'observe',
  );
  return { rebuildResult, gateResult, pending: recovery.scanPending() };
}

module.exports = {
  resolveMode, start, update, status, recoverAll, finalize, dryRunSession, dryRunRange, reconcile,
  applyRoadmapTransition,
};
