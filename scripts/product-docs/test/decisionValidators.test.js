#!/usr/bin/env node
'use strict';

// Part 7B — unit tests for lib/decisionValidators.js. Synthetic in-memory
// `parsed.decisions` Maps only — never reads or mutates the real
// docs/product/ tree, matching this directory's other pure-unit test files
// (validators.test.js's fixture pattern, one level lighter here since these
// rules only need `parsed.decisions`).
// Run with: node scripts/product-docs/test/decisionValidators.test.js

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const {
  checkDecisionDraftsHaveEvidence,
  checkAcceptedDecisionsHaveEvidence,
  checkSupersededReciprocalLinks,
  checkContradictoryActiveDecisions,
} = require('../lib/decisionValidators');

function decision(id, header, body) {
  return [id, { header, body, filePath: `decisions/${id}_FIXTURE.md` }];
}

async function main() {
  const { t, summarize } = createRunner();

  await t('checkDecisionDraftsHaveEvidence flags a Draft with no session/signal citation', () => {
    const parsed = { decisions: new Map([
      decision('DEC-001', { Status: 'Draft — auto-detected architectural signal, pending review', 'Evidence status': 'hand-typed, no citation' }, '# DEC-001\n'),
    ]) };
    const findings = checkDecisionDraftsHaveEvidence(parsed);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'decision-draft-missing-evidence');
  });

  await t('checkDecisionDraftsHaveEvidence does not flag a Draft with a proper session citation', () => {
    const parsed = { decisions: new Map([
      decision('DEC-001', { Status: 'Draft — auto-detected architectural signal, pending review', 'Evidence status': 'Auto-drafted by Part 7 decision intelligence from session `sess-123`; signals: service-boundary' }, '# DEC-001\n'),
    ]) };
    assert.deepEqual(checkDecisionDraftsHaveEvidence(parsed), []);
  });

  await t('checkAcceptedDecisionsHaveEvidence flags an Accepted decision with the literal evidence-pending Options Considered placeholder', () => {
    const parsed = { decisions: new Map([
      decision('DEC-002', { Status: 'Accepted' }, '# DEC-002\n\n## Options Considered\n\nEvidence pending — not yet documented as fact.\n\n## Decision\n\nSomething.\n'),
    ]) };
    const findings = checkAcceptedDecisionsHaveEvidence(parsed);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].level, 'evidence_gap');
    assert.equal(findings[0].rule, 'decision-accepted-without-alternatives-evidence');
  });

  await t('checkAcceptedDecisionsHaveEvidence does not flag an Accepted decision with real recorded alternatives', () => {
    const parsed = { decisions: new Map([
      decision('DEC-003', { Status: 'Accepted' }, '# DEC-003\n\n## Options Considered\n\n1. **A** — desc\n2. **B** — desc\n\n## Decision\n\nChose A.\n'),
    ]) };
    assert.deepEqual(checkAcceptedDecisionsHaveEvidence(parsed), []);
  });

  await t('checkSupersededReciprocalLinks errors when the superseding decision does not exist', () => {
    const parsed = { decisions: new Map([
      decision('DEC-004', { Status: 'Superseded by DEC-999' }, '# DEC-004\n'),
    ]) };
    const findings = checkSupersededReciprocalLinks(parsed);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].level, 'error');
    assert.equal(findings[0].rule, 'superseded-target-missing');
  });

  await t('checkSupersededReciprocalLinks warns when the superseding decision exists but does not reference back', () => {
    const parsed = { decisions: new Map([
      decision('DEC-005', { Status: 'Superseded by DEC-006' }, '# DEC-005\n'),
      decision('DEC-006', { Status: 'Accepted' }, '# DEC-006\n\nNo mention of the superseded record here.\n'),
    ]) };
    const findings = checkSupersededReciprocalLinks(parsed);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'superseded-reciprocal-link-missing');
  });

  await t('checkSupersededReciprocalLinks is clean when the reciprocal link is present', () => {
    const parsed = { decisions: new Map([
      decision('DEC-007', { Status: 'Superseded by DEC-008' }, '# DEC-007\n'),
      decision('DEC-008', { Status: 'Accepted' }, '# DEC-008\n\nSupersedes DEC-007 because of X.\n'),
    ]) };
    assert.deepEqual(checkSupersededReciprocalLinks(parsed), []);
  });

  await t('checkContradictoryActiveDecisions reports (information-level) when two Accepted decisions govern the exact same feature set', () => {
    const parsed = { decisions: new Map([
      decision('DEC-009', { Status: 'Accepted', 'Related feature(s) / roadmap milestone': 'AI-FEAT-005' }, '# DEC-009\n'),
      decision('DEC-010', { Status: 'Accepted', 'Related feature(s) / roadmap milestone': 'AI-FEAT-005' }, '# DEC-010\n'),
    ]) };
    const findings = checkContradictoryActiveDecisions(parsed);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].level, 'information');
    assert.equal(findings[0].rule, 'overlapping-active-decisions');
  });

  await t('checkContradictoryActiveDecisions is silent for decisions governing different feature sets', () => {
    const parsed = { decisions: new Map([
      decision('DEC-011', { Status: 'Accepted', 'Related feature(s) / roadmap milestone': 'AI-FEAT-005' }, '# DEC-011\n'),
      decision('DEC-012', { Status: 'Accepted', 'Related feature(s) / roadmap milestone': 'AI-FEAT-006' }, '# DEC-012\n'),
    ]) };
    assert.deepEqual(checkContradictoryActiveDecisions(parsed), []);
  });

  summarize('decisionValidators.test.js');
}

main();
