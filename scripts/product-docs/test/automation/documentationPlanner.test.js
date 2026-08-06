#!/usr/bin/env node
'use strict';

// Pure in-memory tests over documentationPlanner's evidence-gating rules —
// no filesystem, no git. Run with:
// node scripts/product-docs/test/automation/documentationPlanner.test.js
const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { planDocumentation } = require('../../automation/documentationPlanner');
const evidencePacket = require('../../automation/evidencePacket');

function basePacket(overrides = {}) {
  const p = evidencePacket.createPacket({ taskType: 'feature', taskTitle: 'Test Task' });
  return { ...p, ...overrides };
}

function baseClassification(overrides = {}) {
  return {
    primary_feature_ids: ['AI-FEAT-001'],
    related_feature_ids: [],
    dependency_ids: [],
    dependent_ids: [],
    governing_decision_ids: [],
    related_bug_ids: [],
    required_technical_docs: [],
    affected_roadmap_ids: [],
    affected_subsystems: [],
    unknown_files: [],
    confidence: 'explicit',
    ...overrides,
  };
}

async function main() {
  const { t, summarize } = createRunner();

  await t('feature-evolution is justified for a "feature" task_type with affected files', () => {
    const packet = basePacket({ task_type: 'feature', affected_files: ['a.js'], implementation_summary: 'did work' });
    const plan = planDocumentation(packet, baseClassification());
    assert.equal(plan.feature_evolution.length, 1);
    assert.equal(plan.feature_evolution[0].justified, true);
  });

  await t('feature-evolution is skipped entirely for a trivial maintenance change with no summary', () => {
    const packet = basePacket({ task_type: 'maintenance', affected_files: ['a.js'], implementation_summary: '' });
    const plan = planDocumentation(packet, baseClassification());
    assert.equal(plan.feature_evolution.length, 0, 'trivial changes must not even produce an unjustified plan entry');
  });

  await t('feature-evolution is NOT justified when affected_files is empty (no-op change)', () => {
    const packet = basePacket({ task_type: 'feature', affected_files: [] });
    const plan = planDocumentation(packet, baseClassification());
    assert.equal(plan.feature_evolution.length, 0);
  });

  await t('bug record requires BOTH a symptom and a root cause/status — missing root cause is not justified', () => {
    const packet = basePacket({ bugs_discovered: [{ symptom: 'crashes on save' }] });
    const plan = planDocumentation(packet, baseClassification());
    assert.equal(plan.bug_records.length, 1);
    assert.equal(plan.bug_records[0].justified, false);
    assert.match(plan.bug_records[0].reason, /insufficient evidence/);
  });

  await t('bug record IS justified with a symptom plus a root cause', () => {
    const packet = basePacket({ bugs_discovered: [{ symptom: 'crashes on save', root_cause: 'null pointer' }] });
    const plan = planDocumentation(packet, baseClassification());
    assert.equal(plan.bug_records[0].justified, true);
  });

  await t('bug record IS justified with a symptom plus an honest "investigating" status (no root cause yet)', () => {
    const packet = basePacket({ bugs_discovered: [{ symptom: 'crashes on save', status: 'Investigating' }] });
    const plan = planDocumentation(packet, baseClassification());
    assert.equal(plan.bug_records[0].justified, true);
  });

  await t('decision record requires >= 2 alternatives AND an accepted solution', () => {
    const packet = basePacket({
      alternatives_considered: [{ name: 'A' }],
      accepted_solution: 'chose A',
    });
    const plan = planDocumentation(packet, baseClassification());
    assert.equal(plan.decision_records[0].justified, false, 'only 1 alternative — not enough');
  });

  await t('decision record IS justified with >= 2 alternatives and an accepted solution', () => {
    const packet = basePacket({
      alternatives_considered: [{ name: 'A' }, { name: 'B' }],
      accepted_solution: 'chose A because...',
    });
    const plan = planDocumentation(packet, baseClassification());
    assert.equal(plan.decision_records[0].justified, true);
  });

  await t('no decision-record plan entry at all when nothing decision-shaped was recorded', () => {
    const packet = basePacket({});
    const plan = planDocumentation(packet, baseClassification());
    assert.equal(plan.decision_records.length, 0, 'must not manufacture a decision-record plan out of nothing');
  });

  await t('postmortem is only planned when release_impact.significant_incident is explicitly set', () => {
    const packet = basePacket({ root_cause: 'x', tests_run: ['y'] });
    let plan = planDocumentation(packet, baseClassification());
    assert.equal(plan.postmortems.length, 0);

    const flagged = basePacket({ release_impact: { significant_incident: true }, root_cause: 'x', tests_run: ['y'] });
    plan = planDocumentation(flagged, baseClassification());
    assert.equal(plan.postmortems.length, 1);
    assert.equal(plan.postmortems[0].justified, true);
  });

  await t('roadmap transition is NEVER justified by documentationPlanner alone, even with full completion evidence', () => {
    const packet = basePacket({
      tests_run: ['t1'], manual_verification: ['v1'], unresolved_gaps: [],
    });
    const plan = planDocumentation(packet, baseClassification({ affected_roadmap_ids: ['AI-RM-001'] }));
    assert.equal(plan.roadmap_transitions.length, 1);
    assert.equal(plan.roadmap_transitions[0].justified, false, 'roadmap transitions require explicit human confirmation, never inferred');
  });

  await t('dependency links plan is justified when bugs/decisions are already evidenced by classification', () => {
    const plan = planDocumentation(basePacket({}), baseClassification({ related_bug_ids: ['BUG-001'] }));
    assert.equal(plan.dependency_links.length, 1);
    assert.equal(plan.dependency_links[0].justified, true);
  });

  await t('changelog is justified for a real task summary even with no code files (e.g. investigation)', () => {
    const packet = basePacket({ task_type: 'investigation', affected_files: [], task_summary: 'Investigated the thing and found nothing actionable.' });
    const plan = planDocumentation(packet, baseClassification({ primary_feature_ids: [] }));
    assert.equal(plan.changelog[0].justified, true);
  });

  summarize('documentationPlanner.test.js');
}

main();
