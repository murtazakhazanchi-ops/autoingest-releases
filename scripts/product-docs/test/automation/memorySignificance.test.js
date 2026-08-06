#!/usr/bin/env node
'use strict';

// Tests automation/memory/significance.js's evidence-gated planMemoryCapsule
// predicate — a pure function, no filesystem I/O, no cleanup needed.
// Run with: node scripts/product-docs/test/automation/memorySignificance.test.js
const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { planMemoryCapsule } = require('../../automation/memory/significance');

async function main() {
  const { t, summarize } = createRunner();

  await t('no packet, no events -> not justified (evidence-poor task, never invents significance)', () => {
    const result = planMemoryCapsule(null, []);
    assert.equal(result.justified, false);
  });

  await t('a single plan_revised event alone does not clear the revision floor', () => {
    const result = planMemoryCapsule(null, [{ type: 'plan_revised' }]);
    assert.equal(result.justified, false, 'one revision is routine engineering, not yet a story worth a permanent capsule');
  });

  await t('two or more plan_revised events clears the revision floor', () => {
    const result = planMemoryCapsule(null, [{ type: 'plan_revised' }, { type: 'plan_revised' }]);
    assert.equal(result.justified, true);
    assert.match(result.reason, /2 plan revisions/);
  });

  await t('a single user_feedback_received event alone is sufficient', () => {
    const result = planMemoryCapsule(null, [{ type: 'user_feedback_received' }]);
    assert.equal(result.justified, true);
  });

  await t('a rejected option only counts when at least 2 options were considered', () => {
    const onlyRejected = planMemoryCapsule(null, [{ type: 'option_rejected' }]);
    assert.equal(onlyRejected.justified, false, 'a single option_rejected with no considered options recorded is not itself evidence of a real alternatives-evaluation story');
    const withConsidered = planMemoryCapsule(null, [
      { type: 'option_considered' }, { type: 'option_considered' }, { type: 'option_rejected' },
    ]);
    assert.equal(withConsidered.justified, true);
  });

  await t('a routine feature-type packet with no risks and no events is not justified', () => {
    const packet = { task_type: 'feature', bugs_discovered: [], decisions_made: [], alternatives_considered: [], risks: [] };
    const result = planMemoryCapsule(packet, []);
    assert.equal(result.justified, false, 'task_type alone must never be sufficient — see the code comment on why the bare task_type trigger was removed');
  });

  await t('a feature-type packet WITH recorded risks is justified', () => {
    const packet = { task_type: 'feature', bugs_discovered: [], decisions_made: [], alternatives_considered: [], risks: ['data loss on crash mid-write'] };
    const result = planMemoryCapsule(packet, []);
    assert.equal(result.justified, true);
  });

  await t('a linked Evidence Packet with confirmed bugs is justified even with zero memory events', () => {
    const packet = { bugs_discovered: [{ title: 'x' }], decisions_made: [], alternatives_considered: [], risks: [] };
    const result = planMemoryCapsule(packet, []);
    assert.equal(result.justified, true);
    assert.match(result.reason, /1 bug/);
  });

  await t('signals object reports accurate counts for downstream inspection', () => {
    const result = planMemoryCapsule(null, [
      { type: 'plan_revised' }, { type: 'plan_revised' }, { type: 'plan_revised' },
      { type: 'correction_applied' }, { type: 'follow_up_created' },
    ]);
    assert.equal(result.signals.planRevisions, 3);
    assert.equal(result.signals.corrections, 1);
    assert.equal(result.signals.followUps, 1);
  });

  summarize('memorySignificance.test.js');
}

main();
