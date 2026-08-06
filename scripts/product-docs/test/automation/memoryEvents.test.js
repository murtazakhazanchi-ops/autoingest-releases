#!/usr/bin/env node
'use strict';

// Tests automation/memory/events.js's event schema, redaction-before-write
// guarantee, and journal round-trip. Writes only under the real repo's
// .autoingest-docs/memory/raw/ (gitignored scratch) — never docs/product/.
// Run with: node scripts/product-docs/test/automation/memoryEvents.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const { createRunner } = require('../testHarness');
const memEvents = require('../../automation/memory/events');
const { RAW_DIR } = require('../../automation/memory/paths');

function cleanupSession(sessionId) {
  for (const suffix of ['.events.jsonl', '.meta.json']) {
    try { fs.unlinkSync(require('path').join(RAW_DIR, `${sessionId}${suffix}`)); } catch { /* already gone */ }
  }
}

async function main() {
  const { t, summarize } = createRunner();
  let sessionId;

  await t('buildEvent rejects an unknown event type', () => {
    assert.throws(() => memEvents.buildEvent({ sessionId: 'x', type: 'not_a_real_type', summary: 'x' }), /Invalid memory event type/);
  });

  await t('buildEvent rejects an unknown source_type', () => {
    assert.throws(() => memEvents.buildEvent({ sessionId: 'x', type: 'task_started', sourceType: 'not-a-real-source' }), /Invalid source_type/);
  });

  await t('buildEvent rejects an unknown confidence level', () => {
    assert.throws(() => memEvents.buildEvent({ sessionId: 'x', type: 'task_started', confidence: 'super-sure' }), /Invalid confidence/);
  });

  await t('buildEvent defaults summary to the evidence-pending phrase when omitted', () => {
    const ev = memEvents.buildEvent({ sessionId: 'x', type: 'task_started' });
    assert.match(ev.summary, /Evidence pending/);
  });

  await t('appendEvent + loadEvents round-trips an event and redacts a secret before it ever touches disk', () => {
    sessionId = memEvents.newSessionId();
    const ev = memEvents.buildEvent({
      sessionId, type: 'task_started', summary: 'contains api_key=abcdef0123456789ZZZZ which must be redacted',
    });
    memEvents.appendEvent(ev);
    const loaded = memEvents.loadEvents(sessionId);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].redaction_status, 'applied');
    assert.doesNotMatch(loaded[0].summary, /abcdef0123456789ZZZZ/);
    assert.match(loaded[0].summary, /\[REDACTED\]/);
  });

  await t('events append in order and loadEvents preserves chronology', () => {
    memEvents.appendEvent(memEvents.buildEvent({ sessionId, type: 'plan_created', summary: 'first' }));
    memEvents.appendEvent(memEvents.buildEvent({ sessionId, type: 'plan_revised', summary: 'second' }));
    const loaded = memEvents.loadEvents(sessionId);
    assert.equal(loaded.length, 3);
    assert.equal(loaded[1].summary, 'first');
    assert.equal(loaded[2].summary, 'second');
  });

  await t('touchSessionMeta/loadSessionMeta/setSessionStatus round-trip session status', () => {
    memEvents.touchSessionMeta(sessionId);
    memEvents.setSessionStatus(sessionId, 'compiled');
    const meta = memEvents.loadSessionMeta(sessionId);
    assert.equal(meta.status, 'compiled');
  });

  await t('listOpenSessions excludes a session whose status has moved past "open"', () => {
    const otherSession = memEvents.newSessionId();
    memEvents.touchSessionMeta(otherSession);
    const open = memEvents.listOpenSessions();
    assert.ok(open.some((s) => s.session_id === otherSession));
    assert.ok(!open.some((s) => s.session_id === sessionId), 'the compiled session from the prior test must not appear as open');
    cleanupSession(otherSession);
  });

  cleanupSession(sessionId);
  summarize('memoryEvents.test.js');
}

main();
