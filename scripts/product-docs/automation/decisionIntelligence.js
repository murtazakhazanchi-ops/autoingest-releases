'use strict';

// Part 7B — Architectural Decision Intelligence.
//
// Detects when a change plausibly touches an architectural boundary
// (structural, path-pattern-based signals only — this never infers a
// rationale from the shape of a diff, per the brief's "never infer rationale
// solely from structural code change") and combines that with the SAME
// evidence bar documentationPlanner.planDecisionRecords already applies
// (>=2 real alternatives + an accepted solution) to decide what to do:
//
//   no signals                        -> not_warranted
//   signals, insufficient evidence    -> local review-required candidate
//   signals, sufficient evidence,
//     no related existing decision    -> canonical Status: Draft record
//   signals, sufficient evidence,
//     a related decision already
//     exists and looks like a match   -> possible_continuation (no new record)
//
// Deliberately does NOT touch documentationPlanner's own decision-record
// path (packet.decision_record_created_id / applyDecisionRecord) — that
// remains Part 5's existing "the packet already told me two alternatives and
// an accepted solution" pathway for an EXPLICITLY-reported decision. This
// module is the additional, structural-signal-driven detector layered on
// top, using its own marker field so the two never collide or double-allocate.

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, DECISION_CANDIDATES_DIR } = require('./paths');
const { atomicWriteFileSync } = require('./atomicWrite');
const { allocateAndWriteRecord } = require('./recordAllocator');
const build = require('../lib/build');
const { runQuery } = require('../lib/query');
const { compareIds } = require('../lib/ids');

// Deliberately structural and file-path-based, not content-inference-based —
// each pattern names a real architectural boundary this repository's own
// docs already treat as sensitive (docs/CLAUDE.md § Critical Constraints,
// docs/product/05_DOCUMENTATION_WORKFLOW.md § When to Update the
// Architectural-Evolution Document). A file matching a pattern is EVIDENCE
// that an architectural boundary was touched, not a claim about why.
const SIGNAL_PATTERNS = [
  { id: 'service-boundary', re: /^services\//, description: 'change under services/ — possible new/changed service boundary' },
  { id: 'ipc-contract', re: /^(main|preload)\//, description: 'change under main/ or preload/ — possible IPC contract or process-boundary change' },
  { id: 'persistence-model', re: /event\.json|eventJsonStore/i, description: 'change touching the event.json persistence model' },
  { id: 'schema-change', re: /schema/i, description: 'change touching a schema file' },
  { id: 'locking-concurrency', re: /lock/i, description: 'change touching locking/concurrency logic' },
  { id: 'security-model', re: /security|contextIsolation/i, description: 'change touching the security model' },
  { id: 'archive-root-model', re: /archiveRoot|archive-root/i, description: 'change touching archive-root / source-of-truth resolution' },
  { id: 'migration-strategy', re: /migrat/i, description: 'change touching a migration path' },
];

function detectStructuralSignals(packet) {
  const files = packet.affected_files || [];
  const bySignal = new Map();
  for (const file of files) {
    for (const sig of SIGNAL_PATTERNS) {
      if (sig.re.test(file)) {
        if (!bySignal.has(sig.id)) bySignal.set(sig.id, { id: sig.id, description: sig.description, matched_files: [] });
        bySignal.get(sig.id).matched_files.push(file);
      }
    }
  }
  return Array.from(bySignal.values());
}

// Identical threshold to documentationPlanner.planDecisionRecords — kept as
// a literal local re-check (not an import of that private predicate) so
// this module can evolve its own bar independently later without silently
// changing Part 5's existing behavior.
function hasSufficientEvidence(packet) {
  const alternatives = packet.alternatives_considered || [];
  return alternatives.length >= 2 && !!packet.accepted_solution;
}

function findPossibleContinuation(packet, built) {
  if (!packet.task_title) return null;
  const results = runQuery(packet.task_title, built.searchIndex, { entityType: 'decision', limit: 3 });
  const strong = results.find((r) => r.score >= 500);
  return strong ? { decision_id: strong.record.stable_id, title: strong.record.title, score: strong.score } : null;
}

function candidatePath(sessionId) {
  return path.join(DECISION_CANDIDATES_DIR, `${sessionId}.json`);
}

// The one focused engineering question this module is allowed to generate —
// text only, never asked automatically by this module itself. The caller
// (an interactive agent) surfaces it via its own UI at session-completion
// time per the brief's "ask one focused engineering question" rule.
function reviewQuestion(packet, signals) {
  const signalNames = signals.map((s) => s.description).join('; ');
  return `This change (${signalNames}) looks architecturally significant, but fewer than 2 alternatives and an accepted solution were recorded. Was this an intentional architectural decision, or an interim/tactical fix? If intentional, what alternative(s) were considered and why was this one chosen?`;
}

function saveCandidate(packet, signals) {
  fs.mkdirSync(DECISION_CANDIDATES_DIR, { recursive: true });
  const candidate = {
    session_id: packet.session_id,
    task_title: packet.task_title,
    branch: packet.branch,
    created_at: new Date().toISOString(),
    signals: signals.map((s) => ({ id: s.id, description: s.description, matched_files: s.matched_files })),
    affected_feature_ids: packet.affected_feature_ids || [],
    review_question: reviewQuestion(packet, signals),
    state: 'candidate',
  };
  atomicWriteFileSync(candidatePath(packet.session_id), JSON.stringify(candidate, null, 2) + '\n');
  return candidate;
}

function listCandidates() {
  if (!fs.existsSync(DECISION_CANDIDATES_DIR)) return [];
  return fs.readdirSync(DECISION_CANDIDATES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DECISION_CANDIDATES_DIR, f), 'utf8')))
    .sort((a, b) => compareIds(a.session_id, b.session_id));
}

function removeCandidate(sessionId) {
  const p = candidatePath(sessionId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

const EVIDENCE_PENDING = 'Evidence pending — not yet documented as fact.';
const ID_PLACEHOLDER = '{{RECORD_ID}}';

function val(v) {
  return v === null || v === undefined || v === '' ? EVIDENCE_PENDING : String(v);
}

function renderDraftDecision(id, packet, signals) {
  const alts = (packet.alternatives_considered || []).map((a, i) => `${i + 1}. **${a.name || `Option ${i + 1}`}** — ${val(a.description)}`).join('\n') || EVIDENCE_PENDING;
  const signalIds = signals.map((s) => s.id).join(', ');
  const related = [...(packet.affected_feature_ids || []), ...(packet.affected_roadmap_ids || [])];
  return `# ${id} — ${packet.task_title}

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | ${related.length ? related.join(', ') : EVIDENCE_PENDING} |
| Status | Draft — auto-detected architectural signal, pending review |
| Date | ${new Date().toISOString().slice(0, 10)} |
| Evidence status | Auto-drafted by Part 7 decision intelligence from session \`${packet.session_id}\`; signals: ${signalIds} |

## Context

${val(packet.task_summary)}

## Options Considered

${alts}

## Decision

${val(packet.accepted_solution)}

## Consequences

${val(packet.risks && packet.risks.join('; '))}

## Reconciliation Note

None recorded.

## Review Note

Auto-drafted from structural signals (${signalIds}) — a human or a future agent session should confirm this Status should move to Accepted (or Rejected/Deferred) before this record is relied on as settled.
`;
}

function allocateDraft(packet, signals) {
  const draft = renderDraftDecision(ID_PLACEHOLDER, packet, signals);
  const { id, relPath } = allocateAndWriteRecord('decision', packet.task_title, draft);
  const finalPath = path.join(REPO_ROOT, relPath);
  const withId = fs.readFileSync(finalPath, 'utf8').split(ID_PLACEHOLDER).join(id);
  atomicWriteFileSync(finalPath, withId);
  return { id, relPath };
}

// Main entry point. Never throws for "nothing to do" — only for a genuine
// I/O failure. Idempotent: a packet already carrying
// architectural_decision_draft_id or architectural_decision_candidate is
// reported as already-handled rather than re-scanned into a duplicate.
function scanPacket(packet) {
  if (packet.architectural_decision_draft_id) {
    return { state: 'already_drafted', decision_id: packet.architectural_decision_draft_id };
  }
  // Part 5's own explicit decision-record path (documentationPlanner
  // .planDecisionRecords / canonicalUpdater.applyDecisionRecord, gated by
  // packet.decision_record_created_id) may already have written a decision
  // for this exact packet earlier in the same finalize() call, from the
  // SAME alternatives_considered/accepted_solution evidence this module
  // also reads. Short-circuit on that marker directly rather than relying
  // solely on findPossibleContinuation()'s fuzzy title search to catch it
  // (found in Part 7 architecture review — the search-based safety net
  // works today because both paths render an identical title, but that's
  // an indirect guarantee, not a structural one).
  if (packet.decision_record_created_id) {
    return { state: 'already_drafted', decision_id: packet.decision_record_created_id, via: 'explicit-decision-record' };
  }
  const signals = detectStructuralSignals(packet);
  if (signals.length === 0) {
    removeCandidate(packet.session_id);
    return { state: 'not_warranted', signals: [] };
  }
  const { built } = build.assemble();
  if (!hasSufficientEvidence(packet)) {
    const candidate = saveCandidate(packet, signals);
    return { state: 'candidate', signals, candidate };
  }
  const continuation = findPossibleContinuation(packet, built);
  if (continuation) {
    removeCandidate(packet.session_id);
    return { state: 'possible_continuation', signals, continuation };
  }
  const { id, relPath } = allocateDraft(packet, signals);
  removeCandidate(packet.session_id);
  return { state: 'draft', signals, decision_id: id, path: relPath };
}

module.exports = {
  SIGNAL_PATTERNS,
  detectStructuralSignals,
  hasSufficientEvidence,
  findPossibleContinuation,
  saveCandidate,
  listCandidates,
  removeCandidate,
  scanPacket,
  reviewQuestion,
  renderDraftDecision,
};
