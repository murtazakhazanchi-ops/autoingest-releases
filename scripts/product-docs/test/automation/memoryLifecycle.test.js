#!/usr/bin/env node
'use strict';

// Tests automation/memory/lifecycle.js's finalize sequence: significance
// gating, idempotent repeated finalize, and OBSERVE never writing canonical
// memory. Uses recordAllocator's FAMILY_CONFIG.memory.dir override (scratch,
// inside .autoingest-docs/) so no real docs/product/memory/ file is ever
// written by this test — mirrors memoryAllocator.test.js's pattern. Never
// cites a real AI-FEAT-### ID, so lifecycle.crossLinkFeatures's real
// docs/product/features/ read is always a safe no-op (no matching file).
// Run with: node scripts/product-docs/test/automation/memoryLifecycle.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRunner } = require('../testHarness');
const recordAllocator = require('../../automation/recordAllocator');
const lifecycle = require('../../automation/memory/lifecycle');
const memEvents = require('../../automation/memory/events');
const { STATE_ROOT } = require('../../automation/paths');
const { RAW_DIR } = require('../../automation/memory/paths');

const SCRATCH_DIR = path.join(STATE_ROOT, 'test-scratch', 'memory-lifecycle-test');

function cleanupCapsuleDir() {
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
}

function cleanupSession(sessionId) {
  for (const suffix of ['.events.jsonl', '.meta.json']) {
    try { fs.unlinkSync(path.join(RAW_DIR, `${sessionId}${suffix}`)); } catch { /* already gone */ }
  }
}

async function main() {
  const { t, summarize } = createRunner();
  cleanupCapsuleDir();
  const originalDir = recordAllocator.FAMILY_CONFIG.memory.dir;
  recordAllocator.FAMILY_CONFIG.memory.dir = SCRATCH_DIR;

  const sessionsToClean = [];

  try {
    await t('finalize on an insignificant session creates no capsule', () => {
      const { sessionId } = lifecycle.start({ title: 'Trivial session' });
      sessionsToClean.push(sessionId);
      const result = lifecycle.finalize(sessionId, {});
      assert.equal(result.created, false);
      assert.equal(result.plan.justified, false);
    });

    await t('finalize on a significant session (2+ plan revisions) creates exactly one capsule', () => {
      const { sessionId } = lifecycle.start({ title: 'Significant session' });
      sessionsToClean.push(sessionId);
      memEvents.appendEvent(memEvents.buildEvent({ sessionId, type: 'plan_revised', summary: 'rev 1' }));
      memEvents.appendEvent(memEvents.buildEvent({ sessionId, type: 'plan_revised', summary: 'rev 2' }));
      const result = lifecycle.finalize(sessionId, { title: 'Significant session' });
      assert.equal(result.created, true);
      assert.match(result.capsuleId, /^AI-MEM-\d{4}$/);
      assert.ok(fs.existsSync(path.join(SCRATCH_DIR, path.basename(result.relPath))));
    });

    await t('a repeated finalize on an already-compiled session is a no-op — never allocates a second ID', () => {
      const { sessionId } = lifecycle.start({ title: 'Repeat-finalize session' });
      sessionsToClean.push(sessionId);
      memEvents.appendEvent(memEvents.buildEvent({ sessionId, type: 'user_feedback_received', summary: 'fb' }));
      const first = lifecycle.finalize(sessionId, { title: 'Repeat-finalize session' });
      assert.equal(first.created, true);
      const countAfterFirst = recordAllocator.currentMaxNumber('memory');
      const second = lifecycle.finalize(sessionId, { title: 'Repeat-finalize session' });
      assert.equal(second.created, false);
      assert.equal(second.alreadyCompiled, true);
      assert.equal(second.capsuleId, first.capsuleId);
      assert.equal(recordAllocator.currentMaxNumber('memory'), countAfterFirst, 'no new ID was allocated on the repeated finalize');
    });

    await t('OBSERVE mode never writes a canonical capsule even for a justified session', () => {
      const { sessionId } = lifecycle.start({ title: 'Observe session' });
      sessionsToClean.push(sessionId);
      memEvents.appendEvent(memEvents.buildEvent({ sessionId, type: 'user_feedback_received', summary: 'fb' }));
      const countBefore = recordAllocator.currentMaxNumber('memory');
      const result = lifecycle.finalize(sessionId, { title: 'Observe session', mode: 'observe' });
      assert.equal(result.created, false);
      assert.equal(result.observedOnly, true);
      assert.equal(recordAllocator.currentMaxNumber('memory'), countBefore, 'OBSERVE must never allocate an ID');
    });

    await t('maybeCompileFromPacket never throws even when memory state is in an unexpected shape', () => {
      const badPacket = { session_id: 'sess-does-not-exist', task_type: 'feature', risks: ['x'], bugs_discovered: [], decisions_made: [], alternatives_considered: [] };
      const result = lifecycle.maybeCompileFromPacket(badPacket);
      assert.ok(result); // must return something, not throw
      sessionsToClean.push('sess-does-not-exist');
    });
  } finally {
    recordAllocator.FAMILY_CONFIG.memory.dir = originalDir;
    cleanupCapsuleDir();
    for (const s of sessionsToClean) cleanupSession(s);
  }

  summarize('memoryLifecycle.test.js');
}

main();
