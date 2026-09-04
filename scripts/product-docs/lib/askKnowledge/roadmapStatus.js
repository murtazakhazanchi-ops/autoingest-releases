'use strict';
// Ask AutoIngest — Stage 2 deterministic knowledge/tool foundation,
// Section 12 (roadmap authority). Productionized from the Checkpoint 9-14
// `roadmap_status` tool, with one deliberate REIMPLEMENT (Section 3 audit
// finding): the prototype's `query` parameter re-ran a raw string through
// answerQuestion() (the lexical scorer) to resolve a named subject to its
// owning milestone. Stage 2 takes an optional session HANDLE instead --
// structurally consistent with every other tool in this surface (search
// first, then reference by handle), and avoids embedding a second ad hoc
// NL-matching call inside what is otherwise a purely deterministic,
// structured-input API.
//
// Reads live from `ctx.dashboard` (docs/product/generated/roadmap-
// dashboard.json's own structure, built fresh by lib/build.js every run) --
// never hardcoded roadmap text, per Section 12's own explicit instruction.
// Milestone classification (completed/current/next/later) is derived from
// the dashboard's own structural fields (`completed_milestones`,
// `current_milestone_id`, `next_milestone_id`) -- never inferred from
// parsing the free-text `status` string, which is markdown-formatted prose
// meant for human reading, not machine classification.

const { findAllByFeatureId } = require('../knowledgeModel/index');

// completed > current > next > later, in that priority order (a milestone
// cannot be both current and next in this classification -- current wins
// when the dashboard's own current_milestone_id and next_milestone_id
// happen to coincide, since "actively current" is more specific than
// "merely queued next").
function classifyMilestone(milestoneId, dashboard) {
  if ((dashboard.completed_milestones || []).includes(milestoneId)) return 'completed';
  if (milestoneId === dashboard.current_milestone_id) return 'current';
  if (milestoneId === dashboard.next_milestone_id) return 'next';
  if (dashboard.milestones && dashboard.milestones.some((m) => m.id === milestoneId)) return 'later';
  return 'unknown';
}

function summarizeMilestone(m, dashboard) {
  return {
    id: m.id,
    name: m.name,
    position: classifyMilestone(m.id, dashboard),
    objective: m.objective || null,
    plannedEstimate: m.planned_estimate || null,
    nextAction: m.next_action || null,
  };
}

// roadmapStatus(handle, ctx, handleSession) -- `handle` is optional
// (undefined/null/'' means the general roadmap state). When provided, it
// must be a handle already issued by a previous search in this session; an
// unresolvable handle is a protocol error, structurally distinct from
// "this subject has no milestone" (which is a real, disclosed possibility
// -- not every Feature belongs to a roadmap milestone, e.g. long-shipped
// Application Platform features predating the roadmap system).
function roadmapStatus(handle, ctx, handleSession) {
  const dashboard = ctx && ctx.dashboard;
  if (!dashboard) return { totalMilestones: 0, completedCount: 0, milestones: [], note: 'No roadmap data available.' };

  const milestones = (dashboard.milestones || []).map((m) => summarizeMilestone(m, dashboard));
  const out = {
    totalMilestones: dashboard.total_milestones,
    completedCount: dashboard.completed_count,
    progressPercent: dashboard.progress_percent,
    milestones,
  };

  const h = String(handle || '').trim();
  if (!h) return out;

  const realId = handleSession.resolve(h);
  if (!realId) {
    return {
      error: 'invalid_handle',
      note: `"${handle}" was not issued by a previous search in this session. This is a protocol error, not evidence about roadmap status -- search again to get a valid handle, or call roadmap_status with no handle for the general roadmap state.`,
    };
  }

  const owning = (dashboard.milestones || []).find(
    (m) => (m.included_features || []).includes(realId) || (m.existing_features_extended || []).includes(realId),
  );
  if (owning) {
    out.subjectMilestone = summarizeMilestone(owning, dashboard);
  } else {
    // A real, disclosed possibility, never silently converted into an
    // error or into "this feature does not exist" -- roadmap coverage and
    // feature existence are independent facts.
    const kmRecords = findAllByFeatureId(realId);
    out.subjectMilestone = null;
    out.note = kmRecords.length
      ? 'This subject is not associated with any roadmap milestone in AutoIngest\'s knowledge -- this is common for already-shipped Application Platform features that predate the milestone-tracked roadmap. It does not mean the subject is unplanned or unsupported.'
      : 'This subject is not associated with any roadmap milestone in AutoIngest\'s knowledge.';
  }
  return out;
}

module.exports = { roadmapStatus, classifyMilestone };
