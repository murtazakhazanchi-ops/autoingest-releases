'use strict';

// Turns a finalized evidence packet + classification into a concrete,
// evidence-gated PLAN of documentation actions. This is where the brief's
// "when to create a record" / "significance" rules live — canonicalUpdater
// only ever executes what this module decided was justified; it never
// makes its own judgment calls about sufficiency.
//
// Every planned action carries `justified: boolean` and `reason`. An
// action with justified: false is still reported (so the operator/agent
// sees what was considered and skipped) but canonicalUpdater must not
// execute it — it becomes an evidence-pending note instead.

const SIGNIFICANT_TASK_TYPES = new Set([
  'feature', 'bugfix', 'reliability', 'performance', 'architecture', 'security', 'ui-ux',
]);

function isTrivialOnlyChange(packet, classification) {
  const files = packet.affected_files || [];
  if (files.length === 0) return true;
  const onlyGenerated = files.every((f) => f.startsWith('docs/product/generated/'));
  const onlyWhitespaceStyle = packet.task_type === 'maintenance' && (packet.implementation_summary || '').trim() === '';
  return onlyGenerated || onlyWhitespaceStyle;
}

// Feature-evolution significance rule (brief § "Automatic Feature
// Evolution"): append only for changes that plausibly changed user-facing
// behavior, architecture, persistence, reliability, performance, a major
// UI workflow, a user/archive-impacting bug, security, new coverage for a
// known risk, or a roadmap transition — not routine/trivial edits.
function planFeatureEvolution(packet, classification) {
  const plans = [];
  if (isTrivialOnlyChange(packet, classification)) return plans;
  const significant = SIGNIFICANT_TASK_TYPES.has(packet.task_type)
    || (packet.bugs_discovered || []).length > 0
    || (packet.decisions_made || []).length > 0
    || (packet.tests_run || []).length > 0;
  for (const featureId of classification.primary_feature_ids) {
    plans.push({
      type: 'feature-evolution',
      feature_id: featureId,
      justified: significant,
      reason: significant
        ? `task_type "${packet.task_type}" or recorded bugs/decisions/tests qualify as significant`
        : 'change did not meet the significance bar (no behavior/architecture/reliability/UI/security impact recorded)',
    });
  }
  return plans;
}

// Bug record rule: requires observable symptom evidence AND (a root cause
// OR an honest "investigating" state) — never fabricated from a diff alone.
// A bug entry already carrying `created_record_id` (set by
// canonicalUpdater.applyBugRecord on a prior, possibly-interrupted finalize
// attempt) is reported as already-recorded rather than re-planned — retrying
// a partially-failed finalize must never allocate a second ID for the same
// evidence.
function planBugRecords(packet) {
  return (packet.bugs_discovered || []).map((bug, idx) => {
    if (bug && bug.created_record_id) {
      return { type: 'bug-record', index: idx, bug, justified: false, reason: `already recorded as ${bug.created_record_id}` };
    }
    const hasSymptom = !!(bug && bug.symptom);
    const hasInvestigationState = !!(bug && (bug.root_cause || bug.status));
    const justified = hasSymptom && hasInvestigationState;
    return {
      type: 'bug-record',
      index: idx,
      bug,
      justified,
      reason: justified
        ? 'observable symptom plus a root cause or explicit investigation state'
        : 'insufficient evidence — needs at least a symptom and a root cause or investigation status; recorded as evidence-pending candidate, not fabricated',
    };
  });
}

// Decision record rule: requires >=2 real alternatives AND an accepted
// choice with consequences beyond a one-line code change. Same
// already-recorded guard as planBugRecords, keyed at the packet level since
// a packet produces at most one decision record.
function planDecisionRecords(packet) {
  if (packet.decision_record_created_id) {
    return [{ type: 'decision-record', justified: false, reason: `already recorded as ${packet.decision_record_created_id}` }];
  }
  const alternatives = packet.alternatives_considered || [];
  const hasAccepted = !!packet.accepted_solution;
  const justified = alternatives.length >= 2 && hasAccepted;
  if ((packet.decisions_made || []).length === 0 && !hasAccepted && alternatives.length === 0) return [];
  return [{
    type: 'decision-record',
    justified,
    reason: justified
      ? `${alternatives.length} alternative(s) considered with an accepted solution`
      : 'fewer than 2 alternatives recorded or no accepted solution — routine implementation choice, not a decision record',
  }];
}

// Postmortem rule: only when the packet explicitly marks a significant
// incident — never inferred from a bug's severity alone. Same
// already-recorded guard as the two rules above.
function planPostmortem(packet) {
  if (packet.postmortem_record_created_id) {
    return [{ type: 'postmortem', justified: false, reason: `already recorded as ${packet.postmortem_record_created_id}` }];
  }
  const flagged = !!(packet.release_impact && packet.release_impact.significant_incident);
  if (!flagged) return [];
  return [{
    type: 'postmortem',
    justified: !!packet.root_cause && (packet.tests_run || []).length > 0,
    reason: 'release_impact.significant_incident explicitly set',
  }];
}

// Changelog entry: near-universal (10-step lifecycle steps 8-10), but
// still skipped for a genuinely no-op / documentation-only pass with
// nothing to report.
function planChangelog(packet, classification) {
  const justified = !isTrivialOnlyChange(packet, classification) || (packet.task_summary && packet.task_summary !== 'Evidence pending — not yet documented as fact.');
  return [{ type: 'changelog', justified, reason: justified ? 'non-trivial change with a recorded summary' : 'no-op / documentation-only pass with nothing to report' }];
}

// Roadmap/dashboard transition: NEVER auto-applied here. Only proposed —
// lifecycleUpdater additionally requires an explicit operator confirmation
// flag before writing. Prevents "a feature commit alone" from inflating
// roadmap progress, per the brief.
function planRoadmapTransition(packet, classification) {
  if (classification.affected_roadmap_ids.length === 0) return [];
  const hasCompletionEvidence = (packet.tests_run || []).length > 0
    && (packet.manual_verification || []).length > 0
    && Array.isArray(packet.unresolved_gaps); // explicitly present, even if empty — not omitted
  return classification.affected_roadmap_ids.map((rmId) => ({
    type: 'roadmap-transition-proposal',
    roadmap_id: rmId,
    justified: false, // always requires explicit human/operator confirmation — see lifecycleUpdater
    reason: hasCompletionEvidence
      ? 'completion evidence present but roadmap transitions always require explicit --confirm-roadmap-transition, never inferred from a commit alone'
      : 'insufficient completion evidence (tests/manual verification/unresolved-gaps not all recorded)',
  }));
}

function planDependencyLinks(packet, classification) {
  const plans = [];
  for (const featureId of classification.primary_feature_ids) {
    const links = [
      ...classification.related_bug_ids.map((id) => ({ kind: 'bug', id })),
      ...classification.governing_decision_ids.map((id) => ({ kind: 'decision', id })),
    ];
    if (links.length > 0) {
      plans.push({ type: 'dependency-link', feature_id: featureId, links, justified: true, reason: 'links already evidenced by existing citations' });
    }
  }
  return plans;
}

function planDocumentation(packet, classification) {
  return {
    feature_evolution: planFeatureEvolution(packet, classification),
    bug_records: planBugRecords(packet),
    decision_records: planDecisionRecords(packet),
    postmortems: planPostmortem(packet),
    changelog: planChangelog(packet, classification),
    roadmap_transitions: planRoadmapTransition(packet, classification),
    dependency_links: planDependencyLinks(packet, classification),
  };
}

module.exports = { planDocumentation, isTrivialOnlyChange };
