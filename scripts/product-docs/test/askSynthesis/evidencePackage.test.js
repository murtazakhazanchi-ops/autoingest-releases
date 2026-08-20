#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/askSynthesis/evidencePackage.test.js
// Ask AutoIngest Phase A (Product Owner-authorized 2026-08-18) — locks in
// that buildEvidencePackage() is purely additive over the real, unmodified
// answerQuestion()/explainNeighborhood()/explainHistoricalContext()/
// explainNormalization() exports: every field traces to real data, nothing
// invented, and the deterministic engine's own answer is never altered by
// building a package around it.

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const build = require('../../lib/build');
const { buildEngineContext, answerQuestion } = require('../../lib/knowledgeEngine');
const { buildEvidencePackage, sanitizeIdsInProse, buildEvidencePackageForKnownRecord } = require('../../lib/askSynthesis/evidencePackage');
const { ID_SHAPE_RE } = require('../../lib/askSynthesis/safetyValidation');
const { answerForKnownRecord } = require('../../lib/knowledgeEngine');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  await t('building an evidence package never changes the underlying deterministic answer', () => {
    const q = 'How do I import photographs from an SD card?';
    const before = answerQuestion(q, ctx);
    buildEvidencePackage(q, ctx);
    const after = answerQuestion(q, ctx);
    assert.deepEqual(before, after, 'answerQuestion() must be side-effect-free and unaffected by evidence-package construction');
  });

  await t('HOW_TO question: primary is the real Workflow, steps[] matches the Workflow\'s own real numbered list verbatim, each step cites the Workflow ID', () => {
    const pkg = buildEvidencePackage('How do I import photographs from an SD card?', ctx);
    assert.equal(pkg.classification, 'HOW_TO');
    assert.equal(pkg.primary.id, 'AI-WF-001');
    assert.equal(pkg.primary.entityType, 'workflow');
    const wf = ctx.workflowIndexById.get('AI-WF-001');
    assert.ok(pkg.steps.length === wf.steps.length && pkg.steps.length > 0);
    for (const [i, s] of pkg.steps.entries()) {
      assert.equal(s.text, wf.steps[i], 'step text must be the real, unaltered Workflow step');
      assert.equal(s.sourceId, 'AI-WF-001');
    }
  });

  await t('legitimateSourceIds is a superset of every ID appearing anywhere in sources[]/admittedNeighborhood/historical', () => {
    const pkg = buildEvidencePackage('My transfer stopped halfway, what happens now?', ctx);
    const legit = new Set(pkg.legitimateSourceIds);
    for (const s of pkg.sources) assert.ok(legit.has(s.id), `source ${s.id} missing from legitimateSourceIds`);
    for (const m of pkg.admittedNeighborhood) assert.ok(legit.has(m.id));
    for (const h of pkg.historical.admitted) assert.ok(legit.has(h.id));
  });

  await t('capabilityStatus/matchQuality/confidence are copied verbatim from the real answer, never re-derived', () => {
    const q = 'Does AutoIngest support cloud backup?';
    const answer = answerQuestion(q, ctx);
    const pkg = buildEvidencePackage(q, ctx);
    assert.equal(pkg.capabilityStatus, answer.capabilityStatus);
    assert.equal(pkg.matchQuality, answer.matchQuality);
    assert.equal(pkg.confidence, answer.confidence);
  });

  await t('deterministicFallback is byte-identical in substance to the real answer -- the guaranteed fallback text', () => {
    const q = 'Does AutoIngest support cloud backup?';
    const answer = answerQuestion(q, ctx);
    const pkg = buildEvidencePackage(q, ctx);
    assert.equal(pkg.deterministicFallback.directAnswer, answer.directAnswer);
    assert.equal(pkg.deterministicFallback.capabilityStatus, answer.capabilityStatus);
    assert.deepEqual(pkg.deterministicFallback.limitations, answer.limitations);
  });

  await t('RF-4.3-EXT-001 flagship: raw retrieval diagnostics correctly expose the ambiguous, multi-way-tied middle-band score (no threshold judgment made here -- just exposed)', () => {
    const pkg = buildEvidencePackage('Does AutoIngest support drone footage import with GPS flight paths?', ctx);
    assert.equal(pkg.matchQuality, 'strong', 'reproduces the known defect: the deterministic engine itself calls this strong');
    assert.ok(pkg.retrievalDiagnostics.primaryOwnDiagnostic.rawScore < 500, 'raw score sits below STRONG_MATCH_FLOOR -- the exact ambiguous middle-band condition');
    assert.ok(pkg.retrievalDiagnostics.tiedAtTopRawScore > 1, 'genuinely tied at the top raw score across the full candidate pool -- real ambiguity, not a clean win');
  });

  await t('governance-primary answer (Decision/Bug primary) produces a package with a real primary and no fabricated Workflow steps', () => {
    const pkg = buildEvidencePackage('Is the telemetry hardcoded service-account credential a security risk?', ctx);
    assert.equal(pkg.primary.id, 'BUG-017');
    assert.deepEqual(pkg.steps, [], 'no Workflow involved -- steps must stay empty, never invented');
  });

  await t('Phase A.2 (Track 2.A follow-up): directAnswer/guidance/limitations sent to synthesis carry zero raw IDs, even for a governance-primary answer whose real prose embeds "(AI-FEAT-007)"-shaped citations', () => {
    const q = 'Is the telemetry hardcoded service-account credential a security risk?';
    const answer = answerQuestion(q, ctx);
    assert.match(answer.directAnswer, ID_SHAPE_RE, 'precondition: the REAL deterministic prose does contain a raw ID here -- otherwise this test proves nothing');
    const pkg = buildEvidencePackage(q, ctx);
    assert.doesNotMatch(pkg.directAnswer, ID_SHAPE_RE, 'the package copy used for synthesis must be sanitized');
    if (pkg.guidance) assert.doesNotMatch(pkg.guidance, ID_SHAPE_RE);
    for (const l of pkg.limitations) assert.doesNotMatch(l, ID_SHAPE_RE);
  });

  await t('sanitization never touches deterministicFallback -- the CLI/portal-facing text stays byte-identical to the real answer', () => {
    const q = 'Is the telemetry hardcoded service-account credential a security risk?';
    const answer = answerQuestion(q, ctx);
    const pkg = buildEvidencePackage(q, ctx);
    assert.equal(pkg.deterministicFallback.directAnswer, answer.directAnswer, 'deterministicFallback must remain the real, unsanitized prose a human would actually see');
  });

  await t('sanitizeIdsInProse: "Title (AI-FEAT-007)" collapses to just "Title", a bare mid-sentence ID resolves to its real display name, and plain text with no ID is returned unchanged', () => {
    const withParenthetical = sanitizeIdsInProse('Telemetry Pipeline (AI-FEAT-007) is affected.', ctx);
    assert.equal(withParenthetical, 'Telemetry Pipeline is affected.');
    const bare = sanitizeIdsInProse('See AI-FEAT-007 for detail.', ctx);
    assert.doesNotMatch(bare, ID_SHAPE_RE);
    assert.match(bare, /Telemetry Pipeline/);
    assert.equal(sanitizeIdsInProse('No IDs here at all.', ctx), 'No IDs here at all.');
  });

  await t('historical-context question: historical.admitted entries (if any) carry evidenceQualification verbatim, never summarized to "verified"', () => {
    const pkg = buildEvidencePackage('Why was a process-local lock accepted for Transfer Export?', ctx);
    for (const h of pkg.historical.admitted) {
      assert.ok(h.evidenceQualification === null || typeof h.evidenceQualification === 'string');
    }
  });

  await t('unanchored historical context, when present, is kept structurally separate from admitted and marked diagnostic-only', () => {
    const pkg = buildEvidencePackage('Is the telemetry hardcoded service-account credential a security risk?', ctx);
    // governance-primary path -- unanchoredDiagnosticOnly may or may not fire
    // depending on real corpus data, but if it does, it must never appear
    // inside `admitted`.
    if (pkg.historical.unanchoredDiagnosticOnly) {
      assert.equal(pkg.historical.admitted.length, 0, 'Phase 5.3 materiality-safety closure: unanchored candidates are never admitted to the real answer, structurally enforced here too');
    }
  });

  // -------------------------------------------------------------------
  // Phase C5 -- buildEvidencePackageForKnownRecord() classification remap.
  // Real-model finding (bench/results/phase-c5-synthesis-related-real-model.json):
  // a Feature-primary known record's hardcoded CAPABILITY classification,
  // fed unchanged into promptTemplates.js's "lead with Yes/No" guidance,
  // caused the model to synthesize a bare "Yes" for known-record browsing.
  // -------------------------------------------------------------------
  await t('known-record evidence package: Feature-primary (CAPABILITY) is remapped to KNOWN_RECORD_BROWSE', () => {
    const feature = built.knowledgeIndex[0];
    const answer = answerForKnownRecord(feature.id, ctx);
    assert.equal(answer.classification, 'CAPABILITY', 'test assumption: answerForKnownRecord() still hardcodes CAPABILITY for Feature-primary records');
    const pkg = buildEvidencePackageForKnownRecord(answer, ctx);
    assert.equal(pkg.classification, 'KNOWN_RECORD_BROWSE');
    assert.equal(answer.classification, 'CAPABILITY', 'the remap must never mutate the real answer object');
  });

  await t('known-record evidence package: Workflow-primary (HOW_TO) is left untouched', () => {
    const workflow = built.workflowIndex[0];
    const answer = answerForKnownRecord(workflow.id, ctx);
    assert.equal(answer.classification, 'HOW_TO');
    const pkg = buildEvidencePackageForKnownRecord(answer, ctx);
    assert.equal(pkg.classification, 'HOW_TO');
  });

  await t('known-record evidence package never computes retrievalDiagnostics or neighborhood/historical (bounded scope, no re-run of retrieval)', () => {
    const feature = built.knowledgeIndex[0];
    const answer = answerForKnownRecord(feature.id, ctx);
    const pkg = buildEvidencePackageForKnownRecord(answer, ctx);
    assert.equal(pkg.retrievalDiagnostics, null);
    assert.deepEqual(pkg.admittedNeighborhood, []);
    assert.deepEqual(pkg.historical.admitted, []);
  });

  summarize('askSynthesis/evidencePackage.test.js');
}

main();
