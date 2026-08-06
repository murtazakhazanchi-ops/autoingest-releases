'use strict';

// Deterministic-first classification: combines featureResolver's
// evidence-grounded feature/subsystem resolution with the packet's own
// AI-provided evidence (bugs_discovered, decisions_made, task_type) to
// decide what documentation this change requires. Never promotes an
// `unknown`/`inferred` mapping to canonical fact — see documentationPlanner
// for how confidence gates what actually gets written.

const { resolveFeaturesForPacket } = require('./featureResolver');

// Subsystems whose changes are treated as elevated risk regardless of
// task_type — matches docs/CLAUDE.md's Critical Constraints (event.json
// source of truth, Electron security model, file-copy no-overwrite rule).
const HIGH_RISK_SUBSYSTEM_HINTS = [
  'event-system', 'event-json', 'security', 'ingestion', 'transaction', 'archive-writer',
];

const TASK_TYPE_TO_RELEASE_CATEGORY = {
  feature: 'Added',
  enhancement: 'Changed',
  bugfix: 'Fixed',
  refactor: 'Changed',
  performance: 'Performance',
  reliability: 'Reliability',
  'ui-ux': 'UI/UX',
  architecture: 'Changed',
  documentation: 'Documentation',
  test: 'Changed',
  release: 'Changed',
  investigation: 'Documentation',
  maintenance: 'Changed',
};

function classifyRisk(resolution, packet) {
  const subsystemsLower = resolution.affected_subsystems.map((s) => s.toLowerCase());
  const touchesHighRisk = HIGH_RISK_SUBSYSTEM_HINTS.some((hint) =>
    subsystemsLower.some((s) => s.includes(hint)));
  if (touchesHighRisk) return 'high';
  if (resolution.unknown_files.length > 0 && resolution.primary_feature_ids.length === 0) return 'medium';
  if ((packet.bugs_discovered || []).length > 0) return 'medium';
  return 'low';
}

// Which record types this change plausibly requires, WITHOUT deciding
// whether the evidence is sufficient to create them yet (that's
// documentationPlanner's job, applying the "when to create a record" rules
// from docs/product/05_DOCUMENTATION_WORKFLOW.md).
function requiredRecordTypes(packet) {
  const types = new Set();
  if ((packet.bugs_discovered || []).length > 0) types.add('bug');
  if ((packet.decisions_made || []).length > 0 || (packet.alternatives_considered || []).length > 0) types.add('decision');
  if (packet.release_impact && packet.release_impact.significant_incident) types.add('postmortem');
  types.add('changelog'); // near-universal per the 10-step lifecycle (steps 1, 8, 9, 10)
  return Array.from(types);
}

function classify(packet, { parsed, built }) {
  const resolution = resolveFeaturesForPacket(packet.affected_files || [], built, parsed);
  const risk = classifyRisk(resolution, packet);
  const releaseCategory = TASK_TYPE_TO_RELEASE_CATEGORY[packet.task_type] || 'Changed';
  const recordTypes = requiredRecordTypes(packet);

  return {
    ...resolution,
    risk_level: risk,
    release_note_category: releaseCategory,
    required_record_types: recordTypes,
    classified_at: new Date().toISOString(),
  };
}

module.exports = { classify, TASK_TYPE_TO_RELEASE_CATEGORY, HIGH_RISK_SUBSYSTEM_HINTS };
