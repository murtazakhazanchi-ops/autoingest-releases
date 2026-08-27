#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/conversationalAsk.test.js
// Phase C8 — dedicated conversational-layer regression suite. Product
// Owner directive (2026-08-24): "RETRIEVAL CONFIDENCE != CONVERSATIONAL
// CERTAINTY." knowledgeTestCorpus.js's existing entry for "My transfer
// stopped halfway — what happens now?" (expectedMatchQuality: 'strong',
// expectedStatus: 'AVAILABLE') belongs to the underlying deterministic
// retrieval/answer layer and stays untouched and green. C8 adds a NEW
// decision layer ABOVE that unchanged layer: the same question is allowed
// (and, per this checkpoint, REQUIRED) to independently resolve to
// MISSING_REQUIRED_DETAIL at the conversational layer, because a strong
// lexical match proves relevant evidence exists, not that the operator's
// intent is uniquely resolved among "Export or Update a Transfer Drive",
// "Import or Update From a Transfer Drive", and "Backup Update Scanning" —
// three real, different operations sharing the "transfer and backup"
// subject group and the same vague trigger phrase. This file asserts BOTH
// results side-by-side for the exact same question, on the exact same
// production context, so the two layers' independence is a locked
// contract, not merely a passing coincidence.
//
// Also locks the two counter-examples discovered while building this
// layer (real, measured false-positive triggers that were then fixed):
// same-group deterministic rivals must NOT cause clarification when the
// independent semantic signal decisively confirms the single top pick
// (Import Photographs From a Memory Card / Use Quick Import for a Small
// Batch — same goal, different method, not different goals), and
// EXPLANATION/COMPARISON/TEAM_ACTIVITY/CAPABILITY-classified questions
// must never be escalated into a multi-way "which one do you mean" menu
// regardless of same-group score overlap.

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { buildEngineContext, answerQuestion } = require('../lib/knowledgeEngine');
const { assessPrimaryFit } = require('../lib/askSynthesis/retrievalConfidence');
const { decideClarification } = require('../lib/askSynthesis/clarificationDecision');
const { askConversational } = require('../lib/conversationalAsk');
const CS = require('../lib/conversationState');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  await t('deterministic layer: "My transfer stopped halfway — what happens now?" remains strong/AVAILABLE, unchanged by C8', () => {
    const answer = answerQuestion('My transfer stopped halfway — what happens now?', ctx);
    assert.equal(answer.matchQuality, 'strong');
    assert.equal(answer.capabilityStatus, 'AVAILABLE');
    assert.ok(answer.guidance, 'instructions/guidance must still exist at the deterministic layer');
  });

  // Mirrors the REAL embedding model's own measured scores for "My
  // transfer stopped halfway." (captured this session against the real
  // bge-small-en-v1.5-q8_0 model): several closely-clustered candidates,
  // all below SEMANTIC_RELEVANCE_FLOOR (0.75) -- semantic itself has no
  // decisive opinion, which is exactly the corroboration this layer
  // requires before trusting a same-group deterministic rival as genuine
  // ambiguity. A fixture, not a live model call, so this suite runs fast
  // and without a model dependency while still exercising the real
  // decision path with real measured numbers.
  const MEASURED_INDECISIVE_SEMANTIC_TOP = [
    { id: 'DEC-010', type: 'decision', title: 'Transfer Update Is Missing-Files-Only', score: 0.6900 },
    { id: 'AI-FEAT-039', type: 'feature', title: 'Transfer Import', score: 0.6834 },
    { id: 'AI-FEAT-038', type: 'feature', title: 'Transfer Export', score: 0.6832 },
  ];

  await t('C8 conversational layer: the SAME question independently resolves to MISSING_REQUIRED_DETAIL (retrieval confidence != conversational certainty)', () => {
    const q = 'My transfer stopped halfway — what happens now?';
    const answer = answerQuestion(q, ctx);
    const primaryFit = assessPrimaryFit(q, answer, ctx);
    // Same-group deterministic rivals (Export vs. Import vs. Backup Update
    // Scanning, all independently clearing CONFIDENCE_FLOOR in the SAME
    // subject group), corroborated by indecisive semantic evidence (no
    // candidate clears SEMANTIC_RELEVANCE_FLOOR) -- together, genuine
    // measured ambiguity, not deterministic-scoring noise alone.
    const clarify = decideClarification(answer, primaryFit, MEASURED_INDECISIVE_SEMANTIC_TOP, ctx);
    assert.equal(clarify.decision, 'MISSING_REQUIRED_DETAIL');
    const ids = clarify.candidates.map((c) => c.id);
    assert.ok(ids.includes('AI-WF-005'), 'Export or Update a Transfer Drive must be offered');
    assert.ok(ids.includes('AI-WF-009'), 'Import or Update From a Transfer Drive must be offered');
  });

  await t('side-by-side: deterministic AVAILABLE/strong and C8 MISSING_REQUIRED_DETAIL are simultaneously true for the same question/context (not contradictory)', () => {
    const q = 'My transfer stopped halfway — what happens now?';
    const answer = answerQuestion(q, ctx);
    const primaryFit = assessPrimaryFit(q, answer, ctx);
    const clarify = decideClarification(answer, primaryFit, MEASURED_INDECISIVE_SEMANTIC_TOP, ctx);
    assert.equal(answer.matchQuality, 'strong');
    assert.equal(answer.capabilityStatus, 'AVAILABLE');
    assert.equal(clarify.decision, 'MISSING_REQUIRED_DETAIL');
  });

  await t('deterministic-only fallback: with NO semantic evidence available at all (offline/model-not-loaded), this layer degrades to the pre-C8 safe default (CLEAR) rather than inventing an uncorroborated ambiguity signal', () => {
    const q = 'My transfer stopped halfway — what happens now?';
    const answer = answerQuestion(q, ctx);
    const primaryFit = assessPrimaryFit(q, answer, ctx);
    const clarify = decideClarification(answer, primaryFit, [], ctx);
    assert.equal(clarify.decision, 'CLEAR');
  });

  await t('orchestrator: askConversational asks a clarifying question (not a confident guess) for the bare ambiguous phrase, then resolves on the second turn', async () => {
    // Query-aware fixture: once the operator names "Transfer Export"
    // explicitly, a real embedding query would decisively favor
    // AI-FEAT-038 (as measured for the SD-card/Quick-Import counter-
    // example elsewhere in this file) -- the static indecisive fixture
    // only models the FIRST, genuinely vague turn.
    const semanticTopK = async (queryText) => (/Transfer Export/i.test(queryText)
      ? [{ id: 'AI-FEAT-038', type: 'feature', title: 'Transfer Export', score: 0.93 }]
      : MEASURED_INDECISIVE_SEMANTIC_TOP);
    let state = CS.createConversation();
    const first = await askConversational(state, 'My transfer stopped halfway.', ctx, { semanticTopK });
    assert.equal(first.response.kind, 'clarification');
    assert.ok(first.response.choices.some((c) => /Export/i.test(c)));
    assert.ok(first.response.choices.some((c) => /Import/i.test(c)));
    const second = await askConversational(first.state, 'Transfer Export.', ctx, { semanticTopK });
    assert.equal(second.response.kind, 'final');
    assert.equal(second.response.answer.matchQuality, 'strong');
  });

  await t('regression guard: same-group deterministic rival does NOT trigger clarification when semantic decisively confirms the single top pick (measured counter-example: SD-card import vs. Quick Import variant)', async () => {
    const q = 'How do I import photographs from an SD card?';
    const answer = answerQuestion(q, ctx);
    const primaryFit = assessPrimaryFit(q, answer, ctx);
    // Simulate a decisive semantic vote for the deterministic top pick
    // (AI-WF-001), matching what the real embedding model measured for
    // this exact question (raw top score 0.927, gap 0.219 to #2).
    const semTop = [{ id: 'AI-WF-001', type: 'workflow', title: answer.matchedCapabilities[0].title, score: 0.93 }];
    const clarify = decideClarification(answer, primaryFit, semTop, ctx);
    assert.equal(clarify.decision, 'CLEAR');
  });

  await t('regression guard: a COMPARISON question naming two things is never escalated into a "which one do you mean" menu', () => {
    const q = 'What’s the difference between Quick Import and regular import?';
    const answer = answerQuestion(q, ctx);
    if (answer.matchQuality !== 'strong') return; // corpus/generated-docs drift guard -- assertion only meaningful when deterministic is strong
    assert.equal(answer.classification, 'COMPARISON');
    const primaryFit = assessPrimaryFit(q, answer, ctx);
    const clarify = decideClarification(answer, primaryFit, [], ctx);
    assert.equal(clarify.decision, 'CLEAR');
  });

  await t('regression guard: boundary/roadmap answers are always UNSUPPORTED, never routed into clarification', () => {
    const q = 'Can AutoIngest recognize faces in my photographs?';
    const answer = answerQuestion(q, ctx);
    const primaryFit = assessPrimaryFit(q, answer, ctx);
    const clarify = decideClarification(answer, primaryFit, [], ctx);
    assert.equal(clarify.decision, 'UNSUPPORTED');
  });

  await t('regression guard: an overwhelming deterministic score (>= STRONG_MATCH_FLOOR) is trusted even with a distant same-group rival, so a just-answered clarification is never re-asked (measured bug: M1 multi-turn asked twice)', () => {
    // Mirrors the real embedding model's own measured scores once the
    // operator names the operation explicitly ("...Transfer Export."):
    // deterministic's own top score jumps to 565 (>= STRONG_MATCH_FLOOR),
    // but AI-FEAT-040 (Backup Update Scanning, same "transfer and backup"
    // group) still independently clears CONFIDENCE_FLOOR at 169 -- without
    // this guard, that distant same-group rival alone was enough to
    // trigger a second, redundant clarification for a question the
    // operator had just answered.
    const q = 'My transfer stopped halfway.. Transfer Export.';
    const answer = answerQuestion(q, ctx);
    const primaryFit = assessPrimaryFit(q, answer, ctx);
    if (!answer.matchedCapabilities[0] || answer.matchedCapabilities[0].score < 500) return; // corpus-drift guard
    const semTop = [
      { id: 'AI-FEAT-038', type: 'feature', title: 'Transfer Export', score: 0.812 },
      { id: 'BUG-005', type: 'bug', title: 'Transfer Export/Backup-Update Resume State Diverges From Backend Progress', score: 0.774 },
    ];
    const clarify = decideClarification(answer, primaryFit, semTop, ctx);
    assert.equal(clarify.decision, 'CLEAR');
  });

  await t('regression guard: a gray-zone "strong" verdict (barely above the weak-score ceiling) that semantic actively fails to corroborate is NOT treated as confident (measured bug: "It didn\'t copy everything." confidently answered QMZ)', () => {
    const q = "It didn't copy everything.";
    const answer = answerQuestion(q, ctx);
    const primaryFit = assessPrimaryFit(q, answer, ctx);
    if (!answer.matchedCapabilities[0] || answer.matchedCapabilities[0].score >= 500) return; // corpus-drift guard -- this test targets the gray-zone case specifically
    // Mirrors the real embedding model's own measured scores: several
    // real candidates found, none clearing SEMANTIC_RELEVANCE_FLOOR (0.75)
    // -- semantic genuinely could not confirm the deterministic top pick,
    // not merely silent.
    const semTop = [
      { id: 'BUG-009', type: 'bug', title: 'placeholder', score: 0.714 },
      { id: 'AI-WF-003', type: 'workflow', title: 'Use Quick Import for a Small Batch', score: 0.690 },
    ];
    const clarify = decideClarification(answer, primaryFit, semTop, ctx);
    assert.notEqual(clarify.decision, 'CLEAR');
  });

  await t('multi-turn: a message that resolves a clarification becomes part of the accumulated context for the NEXT turn (measured bug: the resolving answer was dropped, sending the conversation back into the same ambiguity one turn later)', async () => {
    const semanticTopK = async (queryText) => {
      if (/Transfer Export/i.test(queryText) && !/NAS/i.test(queryText)) {
        return [{ id: 'AI-FEAT-038', type: 'feature', title: 'Transfer Export', score: 0.93 }];
      }
      return [
        { id: 'DEC-010', type: 'decision', title: 'Transfer Update Is Missing-Files-Only', score: 0.69 },
        { id: 'AI-FEAT-039', type: 'feature', title: 'Transfer Import', score: 0.68 },
      ];
    };
    let state = CS.createConversation();
    const t1 = await askConversational(state, 'My transfer stopped halfway.', ctx, { semanticTopK });
    state = t1.state;
    const t2 = await askConversational(state, 'Transfer Export.', ctx, { semanticTopK });
    state = t2.state;
    assert.equal(t2.response.kind, 'final');
    assert.ok(state.conversationFacts.includes('Transfer Export.'), 'the resolving message must be recorded as a fact for later turns');
  });

  await t('topic change into a NEW ambiguity: a resolved conversation followed by an unrelated, itself-ambiguous question must not glue stale context onto it (measured bug, real Electron + real embedding model: "What is QMZ?" then "My transfer stopped halfway." confidently answered QMZ again)', async () => {
    const semanticTopK = async (queryText) => {
      if (/QMZ/i.test(queryText)) return [{ id: 'AI-FEAT-047', type: 'feature', title: 'QMZ Sequencing Workspace', score: 0.9 }];
      return [
        { id: 'DEC-010', type: 'decision', title: 'Transfer Update Is Missing-Files-Only', score: 0.69 },
        { id: 'AI-FEAT-039', type: 'feature', title: 'Transfer Import', score: 0.68 },
      ];
    };
    let state = CS.createConversation();
    const t1 = await askConversational(state, 'What is QMZ?', ctx, { semanticTopK });
    assert.equal(t1.response.kind, 'final');
    state = t1.state;
    const t2 = await askConversational(state, 'My transfer stopped halfway.', ctx, { semanticTopK });
    assert.equal(t2.response.kind, 'clarification', 'a new, unrelated, itself-ambiguous question must ask about ITS OWN subject, never inherit the prior resolved topic');
    assert.equal(t2.response.topicChanged, true);
    assert.ok(t2.response.choices.some((c) => /Export/i.test(c)));
    assert.ok(!t2.response.text.includes('QMZ'), 'the stale topic must not leak into the new clarification wording');
  });

  // C8 corrective checkpoint (2026-08-24) — "answer object integrity"
  // regression guards. A prior test-harness JSON report appeared to show
  // three "impossible" cross-turn contaminations: an SD-card-import answer
  // whose steps included the QMZ workflow, a face-recognition answer whose
  // steps included Transfer Export instructions, and a roadmap answer
  // whose status read "Not supported". Forensic trace (direct raw-IPC-
  // object inspection, bypassing the DOM entirely, via
  // main/askAutoIngestDataIntegrityVerify.js against the real running app)
  // proved the DATA pipeline was never contaminated: every turn below is
  // built by trySynthesize()/mergeSynthesizedAnswer() as `{ ...answer,
  // ... }` from that turn's OWN freshly-resolved `answer` object
  // (answerQuestionWithAuthority() is called fresh per turn in
  // retrieveAndDecide() above — nothing threads a previous turn's answer
  // forward). The actual defect was isolated to renderer.js's
  // _renderAnswer(), which hid empty sections via `.hidden = true` without
  // clearing their textContent/innerHTML — invisible to a real operator,
  // but readable by a DOM query that (like the flawed prior harness) reads
  // an element directly instead of respecting its `hidden` flag. That has
  // since been fixed generally (every else/empty branch in _renderAnswer()
  // and _resetPanels() now clears content, not just hides it) and reverified
  // deterministically (stubbed IPC responses, zero model dependency) via
  // /Users/funun_pa/.claude/jobs/6629ed37/tmp/verify_dom_fix.js. These
  // three guards pin the DATA-layer half of that proof permanently: each
  // question, asked immediately after a turn with real steps/status, must
  // get ONLY its own fresh, correct steps/status — never the prior turn's.
  await t('C8 regression: SD-card import answer never inherits the prior turn\'s QMZ steps', async () => {
    const options = { synthesize: async () => ({ refused: true }) };
    let state = CS.createConversation();
    const t1 = await askConversational(state, 'How do I sort QMZ photos?', ctx, options);
    assert.equal(t1.response.kind, 'final');
    assert.ok(t1.response.answer.steps.some((s) => /QMZ/i.test(s)), 'sanity: turn 1 must actually have QMZ steps for this guard to mean anything');
    state = t1.state;
    const t2 = await askConversational(state, 'How do I import photographs from an SD card?', ctx, options);
    assert.equal(t2.response.kind, 'final');
    assert.ok(!t2.response.answer.steps.some((s) => /QMZ/i.test(s)), `SD-card import steps must never contain QMZ content, got: ${JSON.stringify(t2.response.answer.steps)}`);
    assert.ok(t2.response.answer.steps.some((s) => /card|source/i.test(s)), 'SD-card import must have its OWN, correct steps');
  });

  await t('C8 regression: face-recognition answer never inherits the prior turn\'s Transfer Export steps, and correctly reports NOT_SUPPORTED', async () => {
    const options = { synthesize: async () => ({ refused: true }) };
    let state = CS.createConversation();
    const t1 = await askConversational(state, 'My transfer stopped halfway.. Transfer Export.', ctx, options);
    assert.equal(t1.response.kind, 'final');
    if (!(t1.response.answer.steps && t1.response.answer.steps.length)) return; // corpus-drift guard -- this test targets the case where turn 1 genuinely has steps to leak
    state = t1.state;
    const t2 = await askConversational(state, 'Does AutoIngest support face recognition?', ctx, options);
    assert.equal(t2.response.kind, 'final');
    assert.equal(t2.response.answer.capabilityStatus, 'NOT_SUPPORTED');
    assert.ok(!(t2.response.answer.steps && t2.response.answer.steps.length), `face recognition must have zero inherited steps, got: ${JSON.stringify(t2.response.answer.steps)}`);
  });

  await t('C8 regression: roadmap answer never inherits a prior turn\'s capabilityStatus or steps', async () => {
    const options = { synthesize: async () => ({ refused: true }) };
    let state = CS.createConversation();
    const t1 = await askConversational(state, 'Does AutoIngest support face recognition?', ctx, options);
    assert.equal(t1.response.kind, 'final');
    assert.equal(t1.response.answer.capabilityStatus, 'NOT_SUPPORTED');
    state = t1.state;
    const t2 = await askConversational(state, "What's coming next for AutoIngest?", ctx, options);
    assert.equal(t2.response.kind, 'final');
    assert.notEqual(t2.response.answer.capabilityStatus, 'NOT_SUPPORTED', 'roadmap must not inherit the prior turn\'s capabilityStatus');
    assert.equal(t2.response.answer.classification, 'ROADMAP');
    assert.ok(!(t2.response.answer.steps && t2.response.answer.steps.length), `roadmap must have zero inherited steps, got: ${JSON.stringify(t2.response.answer.steps)}`);
  });

  summarize('conversationalAsk.test.js');
}

main();
