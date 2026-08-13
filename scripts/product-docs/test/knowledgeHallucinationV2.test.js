#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/knowledgeHallucinationV2.test.js
// Stage 2, Phase 21 — expanded hallucination/grounding regression suite.
// Complements knowledge.test.js's Phase 8 negative tests (kept there,
// unchanged) with Phase 21's specifically-required checks: no invented
// Registry/server/sync/locking/collaboration behavior, paraphrases preserve
// capability status, synonyms/concept-hints cannot change availability,
// presence != locking, progress != file-sync, and conflict:warning is never
// presented as an active/available capability. Also runs the Phase 20 V2
// corpus (99 questions) as a hard regression gate: zero unexplained
// failures, always — a new failure with no knownLimitation note means a
// real, undocumented regression and must fail this suite.

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { QUERY_STATUS } = require('../lib/statusResolution');
const { answerQuestion, buildEngineContext } = require('../lib/knowledgeEngine');
const { runEvalV2 } = require('../lib/knowledgeEval');
const { CORPUS_V2 } = require('../lib/knowledgeTestCorpusV2');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  // ── Phase 20 regression gate ───────────────────────────────────────────

  await t('Phase 20 corpus: zero unexplained failures (every deviation from expectation is already documented)', () => {
    const result = runEvalV2({});
    assert.equal(
      result.failures.length, 0,
      `${result.failures.length} unexplained failure(s) in the V2 corpus:\n` +
      result.failures.map((f) => `  ${f.id}: "${f.question}" — got ${f.actualStatus}/${f.actualMatchQuality}, expected ${f.expectedStatus}/${f.expectedMatchQuality}`).join('\n')
    );
  });

  await t('Phase 20 corpus: at least 100 total questions across V1 + V2', () => {
    const { CORPUS } = require('../lib/knowledgeTestCorpus');
    assert.ok(CORPUS.length + CORPUS_V2.length >= 100, `only ${CORPUS.length + CORPUS_V2.length} total questions`);
  });

  // ── No invented Registry/server/sync/locking/collaboration behavior ────

  await t('conflict:warning is never presented as an active/available capability, under any phrasing', () => {
    const questions = [
      'Is conflict:warning something I will see in the app today?',
      'Is conflict detection active in AutoIngest today?',
      'If two people import into the same archive at the same time, will there be a conflict warning?',
      'Does AutoIngest warn me if someone else is editing the same event?',
      'Can two operators edit the same event simultaneously without a warning?',
      'Will AutoIngest flag a conflict if we both import at once?',
    ];
    for (const q of questions) {
      const answer = answerQuestion(q, ctx);
      assert.notEqual(answer.capabilityStatus, QUERY_STATUS.AVAILABLE, `"${q}" presented conflict detection as AVAILABLE`);
      assert.notEqual(answer.capabilityStatus, QUERY_STATUS.PARTIALLY_AVAILABLE, `"${q}" presented conflict detection as PARTIALLY_AVAILABLE`);
    }
  });

  await t('the Online Registry is never described as storing or transmitting photograph/media bytes', () => {
    const questions = [
      'Does the Online Registry store my photographs?',
      'Can someone see my photos over the network while I\'m importing?',
      'Does activity visibility mean my photos are being uploaded somewhere?',
    ];
    for (const q of questions) {
      const answer = answerQuestion(q, ctx);
      assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED, `"${q}" did not correctly deny Registry media storage`);
    }
  });

  await t('the Online Registry is never described as replacing the archive/event.json as source of truth', () => {
    const answer = answerQuestion('Does the Online Registry replace the archive as the source of truth?', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
  });

  await t('activity/progress visibility is never claimed for operations outside Import and Transfer/Sync', () => {
    const questions = [
      'Does QMZ sorting show up as activity to other operators?',
      'Does metadata audit activity show up to other operators?',
    ];
    for (const q of questions) {
      const answer = answerQuestion(q, ctx);
      assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED, `"${q}" incorrectly claimed activity visibility outside Import/Transfer-Sync`);
    }
  });

  // ── presence != locking, progress != file-sync, presence != activity ───

  await t('presence is never conflated with active file-editing or exclusive access', () => {
    const answer = answerQuestion('If presence shows someone online, are they editing my files right now?', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
  });

  await t('archive-level locking (AI-FEAT-045) and Online Registry presence remain distinct concepts in retrieval', () => {
    // Both concepts may legitimately appear in the SAME answer (they are
    // related, cross-referenced mechanisms per AI-WF-006) but a question
    // specifically ABOUT one must never resolve as if it silently answered
    // the other with no distinction drawn.
    const answer = answerQuestion('How does archive locking differ from the Online Registry?', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.AVAILABLE);
    assert.equal(answer.matchedCapabilities[0]?.id, 'AI-FEAT-048', 'expected the Online Registry feature (which documents the distinction) to be the primary match');
  });

  // ── Synonyms/concept-hints cannot change availability ───────────────────

  await t('a concept-hint-driven paraphrase of a NOT_SUPPORTED boundary question never resolves AVAILABLE', () => {
    // Every one of these deliberately triggers a CONCEPT_CLUSTERS hint
    // (recall-widening, e.g. "team-collaboration") while ALSO being a real
    // boundary-covered question — the hint must never be strong enough to
    // flip status away from the boundary (DEC-020's raw-vs-hint safety
    // property, re-verified here specifically at the Registry boundary
    // layer, where the original regression was found).
    const questions = [
      'Can several people use the same archive at once, with a conflict warning if we collide?',
      'We work as a team on the same archive — will the registry warn us about conflicts?',
      'Multiple operators collaborate on one archive — does presence mean someone is working on my files?',
    ];
    for (const q of questions) {
      const answer = answerQuestion(q, ctx);
      assert.notEqual(answer.capabilityStatus, QUERY_STATUS.AVAILABLE, `"${q}" — a recall-widening hint overrode a boundary (the exact regression class DEC-020 exists to prevent)`);
    }
  });

  await t('paraphrase families that share an underlying fact do not silently diverge to opposite capability statuses', () => {
    // Group V2 entries by `family` (a link back to the V1 question they
    // paraphrase) and assert every member without its OWN knownLimitation
    // resolves to the same capabilityStatus as the family's canonical (V1)
    // question — catching a paraphrase that accidentally answers a
    // DIFFERENT underlying question rather than the same one worded
        // differently.
    const { CORPUS: V1 } = require('../lib/knowledgeTestCorpus');
    const v1ById = new Map(V1.map((e) => [e.id, e]));
    const families = new Map();
    for (const entry of CORPUS_V2) {
      if (!entry.family) continue;
      if (!families.has(entry.family)) families.set(entry.family, []);
      families.get(entry.family).push(entry);
    }
    for (const [familyId, members] of families) {
      const canonical = v1ById.get(familyId);
      if (!canonical) continue;
      for (const member of members) {
        if (member.knownLimitation) continue; // already-documented, legitimate deviation
        assert.equal(
          member.expectedStatus, canonical.expectedStatus,
          `paraphrase family ${familyId}: "${member.question}" expects ${member.expectedStatus} but canonical "${canonical.question}" expects ${canonical.expectedStatus}`
        );
      }
    }
  });

  summarize('knowledgeHallucinationV2.test.js');
}

main();
