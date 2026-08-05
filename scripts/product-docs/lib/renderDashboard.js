'use strict';

function renderRoadmapDashboardMd(dashboard) {
  const lines = [];
  lines.push('# Roadmap Dashboard (Generated)');
  lines.push('');
  lines.push('> Generated artifact — cross-checked against 01_FEATURE_REGISTRY.md, 02_MASTER_ROADMAP.md, 03_IMPLEMENTATION_TIMELINE.md, and 04_PROJECT_DASHBOARD.md at generation time; generation fails with a diagnostic instead of silently picking a side if those sources disagree. Regenerate with `node scripts/product-docs/cli.js build`.');
  lines.push('');
  lines.push(`**Progress**: ${dashboard.completed_count}/${dashboard.total_milestones} milestones complete (${dashboard.progress_percent}%)`);
  lines.push(`**Current milestone**: ${dashboard.current_milestone_id || 'None'}`);
  lines.push(`**Following milestone**: ${dashboard.following_milestone_id || 'None'}`);
  lines.push(`**Total features**: ${dashboard.total_features}`);
  lines.push('');
  lines.push('## Feature status counts (overall)');
  lines.push('');
  lines.push('| Status | Count |');
  lines.push('|---|---|');
  for (const [status, count] of Object.entries(dashboard.feature_status_counts_overall).sort()) {
    lines.push(`| ${status} | ${count} |`);
  }
  lines.push('');
  lines.push('## Milestones');
  lines.push('');
  lines.push('| ID | Name | Status | Included features | Dependencies | Planned estimate | Next action |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const m of dashboard.milestones) {
    lines.push([
      m.id, m.name, m.status, m.included_features.join(', ') || '—',
      m.dependencies.join(', ') || '—', m.planned_estimate, m.next_action,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  lines.push('## Blockers and risks');
  lines.push('');
  lines.push(`**Blockers**: ${dashboard.blockers}`);
  lines.push('');
  lines.push(`**Current risks**: ${dashboard.current_risks}`);
  lines.push('');
  lines.push('## Recent and next');
  lines.push('');
  lines.push(`**Recently completed documentation work**: ${dashboard.recently_completed_documentation_work}`);
  lines.push('');
  lines.push(`**Next planned action**: ${dashboard.next_planned_action}`);
  lines.push('');
  lines.push(`**Pending decisions**: ${dashboard.pending_decisions}`);
  lines.push('');
  lines.push(`**Evidence gaps**: ${dashboard.evidence_gaps_note}`);
  lines.push('');
  return lines.join('\n') + '\n';
}

module.exports = { renderRoadmapDashboardMd };
