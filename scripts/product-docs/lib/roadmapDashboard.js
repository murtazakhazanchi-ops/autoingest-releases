'use strict';

const { extractIds, compareIds } = require('./ids');
const { checkRoadmapConsistency } = require('./validators');

class DashboardDisagreementError extends Error {
  constructor(findings) {
    super(`docs/product/ roadmap sources disagree (${findings.length} issue(s)) — fix canonical Markdown before regenerating the dashboard:\n` +
      findings.map((f) => `  - [${f.rule}] ${f.message} (${f.file})`).join('\n'));
    this.findings = findings;
  }
}

function buildRoadmapDashboard(parsed) {
  const disagreements = checkRoadmapConsistency(parsed);
  if (disagreements.length) throw new DashboardDisagreementError(disagreements);

  const dash = parsed.dashboardHeader;
  const order = parsed.roadmapOrder;
  const completed = order.filter((id) => /Completed/i.test(String(parsed.roadmap.get(id).header['Status'] || '')));
  const currentFromDash = extractIds(String(dash['Current roadmap milestone'] || ''), 'roadmap')[0] || null;
  const currentIdx = currentFromDash ? order.indexOf(currentFromDash) : -1;
  const nextId = currentFromDash;
  const followingId = currentIdx >= 0 && currentIdx + 1 < order.length ? order[currentIdx + 1] : null;

  const featureStatusCountsOverall = {};
  for (const feat of parsed.features.values()) {
    const status = feat.header['Status'] || 'Unknown';
    featureStatusCountsOverall[status] = (featureStatusCountsOverall[status] || 0) + 1;
  }

  const milestones = order.map((id) => {
    const m = parsed.roadmap.get(id);
    const included = extractIds(String(m.header['Included AI-FEAT IDs'] || ''), 'feature');
    const statusCounts = {};
    for (const featId of included) {
      const feat = parsed.features.get(featId);
      const status = feat ? feat.header['Status'] : 'Unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }
    return {
      id,
      name: m.name,
      status: m.header['Status'] || 'Evidence pending',
      objective: m.header['Objective'] || 'Evidence pending',
      included_features: included,
      existing_features_extended: extractIds(String(m.header['Existing features extended'] || ''), 'feature'),
      dependencies: extractIds(String(m.header['Dependencies'] || ''), 'roadmap'),
      feature_status_counts: statusCounts,
      planned_estimate: m.header['Planned estimate'] || 'Evidence pending',
      current_risks: m.header['Current risks'] || 'Evidence pending',
      next_action: m.header['Next action'] || 'Evidence pending',
    };
  });

  return {
    total_milestones: order.length,
    completed_milestones: completed,
    completed_count: completed.length,
    current_milestone_id: currentFromDash,
    next_milestone_id: nextId,
    following_milestone_id: followingId,
    progress_percent: Math.round((completed.length / order.length) * 1000) / 10,
    milestones,
    feature_status_counts_overall: featureStatusCountsOverall,
    total_features: parsed.features.size,
    blockers: dash['Blockers'] || 'Evidence pending',
    current_risks: dash['Current risks'] || 'Evidence pending',
    recently_completed_documentation_work: dash['Recently completed work'] || 'Evidence pending',
    next_planned_action: dash['Next planned action'] || 'Evidence pending',
    evidence_gaps_note: dash['Evidence gaps'] || 'Evidence pending',
    pending_decisions: dash['Pending decisions'] || 'None recorded',
  };
}

module.exports = { buildRoadmapDashboard, DashboardDisagreementError };
