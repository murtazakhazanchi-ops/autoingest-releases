'use strict';

// Phase C8 — pure helpers the clarification-decision layer uses to tell
// "the same underlying subject, described two ways" apart from "two
// genuinely different subjects." Reuses ALREADY-CANONICAL fields (a
// Feature's own `category`, a Workflow's own `domain`, a Workflow's own
// `relatedCapabilities` back-reference to its companion Feature(s)) --
// no new taxonomy is invented, no per-record special case.

function normalizeGroup(s) {
  return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

// The canonical "subject group" for a record id: a Feature's own
// `category`, a Workflow's own `domain` -- both already-authored,
// human-curated groupings (see lib/featureIndex.js's categoryByFeatureId /
// lib/workflowIndex.js's domain field), never re-derived here. Governance
// records (bug/decision/postmortem) have no such field; they return null,
// which the clarification layer treats conservatively (never asserted to
// "agree" or "disagree" with anything on group alone -- see
// clarificationDecision.js).
function subjectGroupOf(recordId, ctx) {
  if (!recordId) return null;
  const feature = ctx.knowledgeIndexById && ctx.knowledgeIndexById.get(recordId);
  if (feature && feature.category) return normalizeGroup(feature.category);
  const workflow = ctx.workflowIndexById && ctx.workflowIndexById.get(recordId);
  if (workflow && workflow.domain) return normalizeGroup(workflow.domain);
  return null;
}

// Two records are "companions" (the same real-world subject, described
// from two angles -- a Feature and its own authored Workflow, or vice
// versa) when either explicitly cites the other: a Workflow's own
// `relatedCapabilities` list, or -- symmetrically -- any Workflow whose
// `relatedCapabilities` includes the Feature id. Reuses the EXACT
// relationship knowledgeEngine.js's own findCompanionWorkflow() already
// established as canonical (Part 5 Phase 5.2) -- not a new relationship.
function areCompanions(idA, idB, ctx) {
  if (!idA || !idB || idA === idB) return idA === idB;
  const wfA = ctx.workflowIndexById && ctx.workflowIndexById.get(idA);
  if (wfA && wfA.relatedCapabilities && wfA.relatedCapabilities.includes(idB)) return true;
  const wfB = ctx.workflowIndexById && ctx.workflowIndexById.get(idB);
  if (wfB && wfB.relatedCapabilities && wfB.relatedCapabilities.includes(idA)) return true;
  return false;
}

module.exports = { normalizeGroup, subjectGroupOf, areCompanions };
