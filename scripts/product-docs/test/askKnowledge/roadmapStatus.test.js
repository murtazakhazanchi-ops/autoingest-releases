#!/usr/bin/env node
'use strict';
// Run with: node scripts/product-docs/test/askKnowledge/roadmapStatus.test.js
// Ask AutoIngest — Stage 2, Section 23. Integration tests for
// lib/askKnowledge/roadmapStatus.js (Section 12: roadmap authority).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { roadmapStatus, classifyMilestone } = require('../../lib/askKnowledge/roadmapStatus');
const { HandleSession } = require('../../lib/askKnowledge/handles');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  await t('classifyMilestone: completed_milestones membership wins as "completed"', () => {
    const dashboard = { completed_milestones: ['AI-RM-001'], current_milestone_id: 'AI-RM-002', next_milestone_id: 'AI-RM-002', milestones: [{ id: 'AI-RM-001' }] };
    assert.equal(classifyMilestone('AI-RM-001', dashboard), 'completed');
  });

  await t('classifyMilestone: current_milestone_id wins over next_milestone_id when they coincide', () => {
    const dashboard = { completed_milestones: [], current_milestone_id: 'AI-RM-002', next_milestone_id: 'AI-RM-002', milestones: [{ id: 'AI-RM-002' }] };
    assert.equal(classifyMilestone('AI-RM-002', dashboard), 'current');
  });

  await t('classifyMilestone: next_milestone_id classifies as "next" when distinct from current', () => {
    const dashboard = { completed_milestones: [], current_milestone_id: 'AI-RM-002', next_milestone_id: 'AI-RM-003', milestones: [{ id: 'AI-RM-003' }] };
    assert.equal(classifyMilestone('AI-RM-003', dashboard), 'next');
  });

  await t('classifyMilestone: any other real milestone is "later"', () => {
    const dashboard = { completed_milestones: [], current_milestone_id: 'AI-RM-002', next_milestone_id: 'AI-RM-003', milestones: [{ id: 'AI-RM-004' }] };
    assert.equal(classifyMilestone('AI-RM-004', dashboard), 'later');
  });

  await t('classifyMilestone: an id not present anywhere in the dashboard is "unknown", never inferred', () => {
    const dashboard = { completed_milestones: [], current_milestone_id: 'AI-RM-002', next_milestone_id: 'AI-RM-003', milestones: [{ id: 'AI-RM-004' }] };
    assert.equal(classifyMilestone('AI-RM-999', dashboard), 'unknown');
  });

  await t('no ctx.dashboard: returns a safe, empty roadmap shape, never throws', () => {
    const result = roadmapStatus('', {}, new HandleSession());
    assert.equal(result.totalMilestones, 0);
    assert.deepEqual(result.milestones, []);
  });

  await t('empty/no handle returns the general roadmap state, reading live from ctx.dashboard (never hardcoded text)', () => {
    const hs = new HandleSession();
    const result = roadmapStatus('', ctx, hs);
    assert.equal(result.totalMilestones, ctx.dashboard.total_milestones);
    assert.equal(result.completedCount, ctx.dashboard.completed_count);
    assert.ok(Array.isArray(result.milestones) && result.milestones.length === ctx.dashboard.total_milestones);
    for (const m of result.milestones) {
      assert.ok(['completed', 'current', 'next', 'later', 'unknown'].includes(m.position));
    }
  });

  await t('an invalid handle is a protocol error, never roadmap evidence', () => {
    const hs = new HandleSession();
    const result = roadmapStatus('H999', ctx, hs);
    assert.equal(result.error, 'invalid_handle');
  });

  await t('a real feature belonging to a milestone (AI-FEAT-049, Archive Maintenance -> AI-RM-002) resolves subjectMilestone correctly', () => {
    const hs = new HandleSession();
    const h = hs.issue('AI-FEAT-049');
    const result = roadmapStatus(h, ctx, hs);
    assert.ok(result.subjectMilestone);
    assert.equal(result.subjectMilestone.id, 'AI-RM-002');
  });

  await t('a real feature with no roadmap milestone (e.g. a long-shipped Application Platform feature) returns subjectMilestone:null with a disclosed, non-error note', () => {
    const hs = new HandleSession();
    const h = hs.issue('AI-FEAT-001'); // Electron shell -- predates milestone tracking
    const result = roadmapStatus(h, ctx, hs);
    assert.equal(result.subjectMilestone, null);
    assert.ok(result.note);
    assert.ok(!result.error);
  });

  await t('deterministic: repeated calls with the same handle return identical results', () => {
    const hs = new HandleSession();
    const h = hs.issue('AI-FEAT-049');
    const a = roadmapStatus(h, ctx, hs);
    const b = roadmapStatus(h, ctx, hs);
    assert.deepEqual(a, b);
  });

  summarize('askKnowledge/roadmapStatus.test.js');
}

main();
