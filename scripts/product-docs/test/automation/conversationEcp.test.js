#!/usr/bin/env node
'use strict';

// Unit tests for the pure, in-memory pieces of the Part 8 conversation
// pipeline — ECP schema validation, the significance gate, and content
// fingerprinting. None of these touch the filesystem or the real
// docs/product/ tree; see conversationImport.test.js for the end-to-end
// pipeline tests against a disposable fixture repo.
// Run with: node scripts/product-docs/test/automation/conversationEcp.test.js

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { ECP_VERSION, SOURCE_TOOLS, validateEcp, normalizeEcp } = require('../../automation/conversation/ecp');
const { planConversationCanonicalization } = require('../../automation/conversation/significance');
const { fingerprintPacket } = require('../../automation/conversation/fingerprint');

function minimalPacket(overrides = {}) {
  return {
    ecp_version: ECP_VERSION,
    project: 'AutoIngest',
    source_tool: 'chatgpt',
    conversation_title: 'Test conversation',
    user_goal: 'Decide something',
    ...overrides,
  };
}

async function main() {
  const { t, summarize } = createRunner();

  await t('validateEcp accepts a minimal valid packet', () => {
    const { valid, errors } = validateEcp(minimalPacket());
    assert.equal(valid, true, errors.join('; '));
  });

  await t('validateEcp rejects a missing ecp_version', () => {
    const packet = minimalPacket();
    delete packet.ecp_version;
    const { valid, errors } = validateEcp(packet);
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes('ecp_version')));
  });

  await t('validateEcp rejects an unsupported ecp_version rather than guess-parsing it', () => {
    const { valid, errors } = validateEcp(minimalPacket({ ecp_version: '2.0' }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes('ecp_version')));
  });

  await t('validateEcp rejects an unknown source_tool', () => {
    const { valid, errors } = validateEcp(minimalPacket({ source_tool: 'my-custom-ai' }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes('source_tool')));
  });

  await t('validateEcp requires project and conversation_title', () => {
    const { valid, errors } = validateEcp({ ecp_version: ECP_VERSION, source_tool: 'chatgpt' });
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes('project')));
    assert.ok(errors.some((e) => e.includes('conversation_title')));
  });

  await t('validateEcp rejects a non-object root', () => {
    const { valid, errors } = validateEcp(['not', 'an', 'object']);
    assert.equal(valid, false);
    assert.ok(errors[0].includes('object'));
  });

  await t('validateEcp rejects an array field sent as a non-array', () => {
    const { valid, errors } = validateEcp(minimalPacket({ explicit_requirements: 'should be an array' }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.includes('explicit_requirements')));
  });

  await t('normalizeEcp fills every optional array field with an empty array, never undefined', () => {
    const normalized = normalizeEcp(minimalPacket());
    for (const field of ['explicit_requirements', 'revisions', 'feedback', 'accepted_decisions', 'rejected_approaches', 'bugs_discussed', 'implementation_requests', 'open_questions']) {
      assert.ok(Array.isArray(normalized[field]), `${field} should be an array`);
    }
  });

  await t('normalizeEcp never fabricates a value for an absent field beyond its documented empty default', () => {
    const normalized = normalizeEcp(minimalPacket());
    assert.equal(normalized.source_conversation_id, null);
    assert.deepEqual(normalized.repository_context, { branch: null, base_commit: null, head_commit: null });
  });

  await t('every SOURCE_TOOLS entry round-trips through validateEcp', () => {
    for (const tool of SOURCE_TOOLS) {
      const { valid, errors } = validateEcp(minimalPacket({ source_tool: tool }));
      assert.equal(valid, true, `${tool}: ${errors.join('; ')}`);
    }
  });

  // --- significance gate ---------------------------------------------------

  await t('planConversationCanonicalization is not justified for an engineering-content-free packet', () => {
    const { justified, reason } = planConversationCanonicalization(normalizeEcp(minimalPacket()));
    assert.equal(justified, false);
    assert.ok(reason.includes('No engineering-content signal'));
  });

  await t('planConversationCanonicalization is justified when explicit_requirements is present', () => {
    const packet = normalizeEcp(minimalPacket({ explicit_requirements: ['Must not overwrite files'] }));
    const { justified, reason } = planConversationCanonicalization(packet);
    assert.equal(justified, true);
    assert.ok(reason.includes('explicit requirement'));
  });

  await t('planConversationCanonicalization is justified for a bug-only discussion with no requirements', () => {
    const packet = normalizeEcp(minimalPacket({ bugs_discussed: [{ symptoms: 'crash on import' }] }));
    const { justified } = planConversationCanonicalization(packet);
    assert.equal(justified, true);
  });

  await t('planConversationCanonicalization signals object reports exact per-field counts', () => {
    const packet = normalizeEcp(minimalPacket({ open_questions: ['a', 'b'], deferred_items: ['c'] }));
    const { signals } = planConversationCanonicalization(packet);
    assert.equal(signals.open_questions, 2);
    assert.equal(signals.deferred_items, 1);
    assert.equal(signals.explicit_requirements, 0);
  });

  // --- fingerprint -----------------------------------------------------------

  await t('fingerprintPacket is deterministic for identical engineering content', () => {
    const a = normalizeEcp(minimalPacket({ explicit_requirements: ['x'] }));
    const b = normalizeEcp(minimalPacket({ explicit_requirements: ['x'] }));
    assert.equal(fingerprintPacket(a), fingerprintPacket(b));
  });

  await t('fingerprintPacket differs when engineering content differs', () => {
    const a = normalizeEcp(minimalPacket({ explicit_requirements: ['x'] }));
    const b = normalizeEcp(minimalPacket({ explicit_requirements: ['y'] }));
    assert.notEqual(fingerprintPacket(a), fingerprintPacket(b));
  });

  await t('fingerprintPacket ignores import-metadata-only differences (same content, different conversation_started_at)', () => {
    const a = normalizeEcp(minimalPacket({ explicit_requirements: ['x'], conversation_started_at: '2026-01-01T00:00:00Z' }));
    const b = normalizeEcp(minimalPacket({ explicit_requirements: ['x'], conversation_started_at: '2026-06-01T00:00:00Z' }));
    assert.equal(fingerprintPacket(a), fingerprintPacket(b));
  });

  summarize('conversationEcp.test.js');
}

main();
