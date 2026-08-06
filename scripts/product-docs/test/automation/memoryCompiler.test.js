#!/usr/bin/env node
'use strict';

// Tests automation/memory/compiler.js's deterministic compilation — pure
// function, no filesystem I/O, no cleanup needed.
// Run with: node scripts/product-docs/test/automation/memoryCompiler.test.js
const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { compileCapsule, EVIDENCE_PENDING } = require('../../automation/memory/compiler');

async function main() {
  const { t, summarize } = createRunner();

  await t('an empty event list produces "Evidence pending" for every narrative section, never invented prose', () => {
    const md = compileCapsule('AI-MEM-9999', { sessionId: 'sess-x', title: 'Empty Session', events: [], packet: null });
    assert.match(md, new RegExp(EVIDENCE_PENDING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(md, /## Original Request/);
    assert.match(md, /## Provenance/);
  });

  await t('the same inputs compile to byte-identical output twice (determinism)', () => {
    const events = [{ event_id: 'e1', type: 'task_started', summary: 'x', timestamp: '2026-01-01T00:00:00.000Z', related_ids: [], evidence_refs: [] }];
    const a = compileCapsule('AI-MEM-9999', { sessionId: 's', title: 'T', events, packet: null });
    const b = compileCapsule('AI-MEM-9999', { sessionId: 's', title: 'T', events, packet: null });
    assert.equal(a, b);
  });

  await t('a plan_revised event renders as a numbered Revision entry in the Evolution Timeline', () => {
    const events = [
      { type: 'plan_created', summary: 'initial plan', timestamp: '2026-01-01T00:00:00.000Z', detail: {}, related_ids: [], evidence_refs: [] },
      { type: 'plan_revised', summary: 'revised', timestamp: '2026-01-02T00:00:00.000Z', detail: { trigger: 'user pushback', status: 'accepted' }, related_ids: [], evidence_refs: [] },
    ];
    const md = compileCapsule('AI-MEM-9999', { sessionId: 's', title: 'T', events, packet: null });
    assert.match(md, /\*\*Revision 1\*\*/);
    assert.match(md, /Trigger: user pushback/);
    assert.match(md, /Status: accepted/);
  });

  await t('an option_rejected event marks the matching option_considered entry as Rejected, not Accepted', () => {
    const events = [
      { type: 'option_considered', summary: 'Approach A', detail: { option_ref: 'opt1' }, related_ids: [], evidence_refs: [] },
      { type: 'option_rejected', summary: 'Approach A rejected', detail: { option_ref: 'opt1', reason: 'too risky' }, related_ids: [], evidence_refs: [] },
    ];
    const md = compileCapsule('AI-MEM-9999', { sessionId: 's', title: 'T', events, packet: null });
    assert.match(md, /Accepted or rejected\*\*: Rejected/);
    assert.match(md, /Reason\*\*: too risky/);
  });

  await t('feature/bug/decision IDs from event related_ids populate the Scope table', () => {
    const events = [{ type: 'task_started', summary: 'x', related_ids: ['AI-FEAT-034', 'BUG-007'], evidence_refs: [] }];
    const md = compileCapsule('AI-MEM-9999', { sessionId: 's', title: 'T', events, packet: null });
    assert.match(md, /Primary feature IDs \| AI-FEAT-034/);
    assert.match(md, /Related bugs \| BUG-007/);
  });

  await t('a linked packet contributes branch/commits/bugs_discovered into Identity and Scope', () => {
    const packet = {
      task_title: 'Packet Title', branch: 'main', base_commit: 'abc123',
      commits: [{ short: 'def456' }], affected_feature_ids: ['AI-FEAT-001'],
      bugs_discovered: [{ title: 'a bug' }], alternatives_considered: [], risks: [],
    };
    const md = compileCapsule('AI-MEM-9999', { sessionId: 's', title: null, events: [], packet });
    assert.match(md, /Branch \| main/);
    assert.match(md, /Base commit \| abc123/);
    assert.match(md, /Final commit\(s\) \| def456/);
    assert.match(md, /Primary feature IDs \| AI-FEAT-001/);
  });

  await t('Provenance "Evidence-pending items" reflects a gap in ANY section, not just the first three', () => {
    // Regression test for a code-review finding: collectEvidencePendingFields
    // originally only scanned Original Request/Initial Understanding/Initial
    // Plan, so a gap in e.g. Implementation Chronicle rendered "Evidence
    // pending" in its own body while Provenance's summary line still
    // falsely claimed every section was evidence-grounded.
    const events = [
      { type: 'plan_revised', summary: 'x', timestamp: '2026-01-01T00:00:00.000Z', detail: {}, related_ids: [], evidence_refs: [] },
      { type: 'plan_revised', summary: 'y', timestamp: '2026-01-02T00:00:00.000Z', detail: {}, related_ids: [], evidence_refs: [] },
    ];
    const md = compileCapsule('AI-MEM-9999', { sessionId: 's', title: 'T', events, packet: null });
    assert.match(md, /Implementation Chronicle[\s\S]*Evidence pending/);
    assert.doesNotMatch(md, /Evidence-pending items\*\*: None — every section above is evidence-grounded/, 'Provenance must not claim full coverage while Implementation Chronicle still has an unfilled field');
    assert.match(md, /Evidence-pending items\*\*: .*Implementation Chronicle/);
  });

  summarize('memoryCompiler.test.js');
}

main();
