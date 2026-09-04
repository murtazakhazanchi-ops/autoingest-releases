#!/usr/bin/env node
'use strict';
// Run with: node scripts/product-docs/test/askKnowledge/handles.test.js
// Ask AutoIngest — Stage 2, Section 23. Pure unit tests for
// lib/askKnowledge/handles.js's HandleSession (Section 13).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { HandleSession } = require('../../lib/askKnowledge/handles');

async function main() {
  const { t, summarize } = createRunner();

  await t('issue() returns a well-formed H<n> handle', () => {
    const hs = new HandleSession();
    const h = hs.issue('AI-FEAT-001');
    assert.match(h, /^H\d+$/);
  });

  await t('issue() is idempotent per session: same realId returns the same handle', () => {
    const hs = new HandleSession();
    const a = hs.issue('AI-FEAT-001');
    const b = hs.issue('AI-FEAT-001');
    assert.equal(a, b);
  });

  await t('issue() gives distinct handles to distinct ids, deterministically incrementing', () => {
    const hs = new HandleSession();
    assert.equal(hs.issue('AI-FEAT-001'), 'H1');
    assert.equal(hs.issue('AI-FEAT-002'), 'H2');
    assert.equal(hs.issue('AI-FEAT-003'), 'H3');
  });

  await t('resolve() returns the real id for a handle issued in this session', () => {
    const hs = new HandleSession();
    const h = hs.issue('AI-FEAT-011');
    assert.equal(hs.resolve(h), 'AI-FEAT-011');
  });

  await t('resolve() returns null for a handle never issued (invalid, not evidence)', () => {
    const hs = new HandleSession();
    assert.equal(hs.resolve('H999'), null);
  });

  await t('resolve() returns null for garbage input, never throws', () => {
    const hs = new HandleSession();
    assert.doesNotThrow(() => hs.resolve(undefined));
    assert.doesNotThrow(() => hs.resolve(null));
    assert.doesNotThrow(() => hs.resolve(42));
    assert.doesNotThrow(() => hs.resolve({}));
    assert.equal(hs.resolve(undefined), null);
  });

  await t('a handle issued in one session is never valid in a different session (scoped, not global)', () => {
    const hsA = new HandleSession();
    const hsB = new HandleSession();
    const h = hsA.issue('AI-FEAT-001');
    assert.equal(hsB.resolve(h), null);
  });

  await t('noteSearchAndCheckRepeat: the first search in a session is never a repeat', () => {
    const hs = new HandleSession();
    assert.equal(hs.noteSearchAndCheckRepeat('first query'), false);
  });

  await t('noteSearchAndCheckRepeat: a second, DIFFERENT query is a repeat; the same query again is not', () => {
    const hs = new HandleSession();
    hs.noteSearchAndCheckRepeat('first query');
    assert.equal(hs.noteSearchAndCheckRepeat('second different query'), true);
    // Re-issuing the exact same first query again is not itself flagged as
    // a NEW repeat signal (it was already seen).
    assert.equal(hs.noteSearchAndCheckRepeat('first query'), false);
  });

  await t('noteSearchAndCheckRepeat normalizes case/whitespace when comparing queries', () => {
    const hs = new HandleSession();
    hs.noteSearchAndCheckRepeat('  Memory Card  ');
    assert.equal(hs.noteSearchAndCheckRepeat('memory card'), false);
  });

  await t('size() reports the number of distinct handles issued', () => {
    const hs = new HandleSession();
    hs.issue('AI-FEAT-001');
    hs.issue('AI-FEAT-002');
    hs.issue('AI-FEAT-001'); // idempotent, not a new handle
    assert.equal(hs.size(), 2);
  });

  summarize('askKnowledge/handles.test.js');
}

main();
