#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/knowledge.test.js
// Stage 1 Knowledge Engine (AI-FEAT-058) regression suite — Phase 12 of its
// brief. Reads the real docs/product/ tree read-only, same convention as
// integration.test.js. Section 2 below is Phase 8's mandatory negative/
// hallucination testing.

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { REPO_ROOT, PRODUCT_DOCS_ROOT } = require('../lib/repoRoot');
const { stableStringify } = require('../lib/stableJson');
const { buildKnowledgeIndex } = require('../lib/knowledgeIndex');
const { resolveFeatureOperatorStatus, RECORD_STATUS, QUERY_STATUS, matchKnownBoundary } = require('../lib/statusResolution');
const { answerQuestion, knowledgeIndexMap, buildEngineContext } = require('../lib/knowledgeEngine');
const validators = require('../lib/validators');

const FIXED_GUIDANCE = 'AutoIngest supports this capability, but detailed operator instructions are not yet documented.';
const FEATURE_ID_RE = /AI-FEAT-\d{3}/g;

// sourceFiles entries are free-text citations, not clean paths (e.g.
// "docs/history.md v0.8.1", "docs/metadata-system.md § Import Path
// Coverage") — extract the leading path-shaped token (up to the first
// recognized extension) rather than assuming one specific separator.
const LEADING_PATH_RE = /^`?([^\s`]+\.(?:md|js|json))\b/;

function resolveSourcePath(p) {
  const m = LEADING_PATH_RE.exec(p.trim());
  const cleaned = m ? m[1] : p.split(/\s+§\s+/)[0].trim();
  const repoRel = path.join(REPO_ROOT, cleaned);
  if (fs.existsSync(repoRel)) return true;
  const productRel = path.join(PRODUCT_DOCS_ROOT, cleaned);
  if (fs.existsSync(productRel)) return true;
  return false;
}

// Pre-existing broken reference discovered BY this test (docs/README.md
// does not exist — AI-FEAT-001's "Related technical docs" field cites it
// alongside the correct `CLAUDE.md`). This is a real gap in the canonical
// feature record, not in this Stage 1 compiler — knowledge-index.json's
// sourceFiles is a faithful passthrough of feature-index.json's own
// related_technical_docs field, and rewriting the 57 feature records is
// explicitly out of Stage 1's scope. Documented as a known exception,
// exactly like the corpus's knownLimitation notes, rather than silently
// loosened for everything. See AI-FEAT-058 Architectural Review — the
// existing `checkRelatedTechnicalDocs` validator only checks for an EMPTY
// field, never whether a cited path resolves; this is a genuine, newly
// found gap in docs/product/'s own existing validation coverage.
const KNOWN_BROKEN_SOURCE_PATHS = new Set(['docs/README.md']);

async function main() {
  const { t, summarize } = createRunner();
  const { parsed, built } = build.assemble();
  // Full production context (Stage 2) — every existing Stage 1 assertion
  // below must hold true even with workflowIndexById/dashboard populated,
  // since that's what the CLI/portal/eval harness actually use.
  const ctx = buildEngineContext(built);
  const realFeatureIds = new Set(parsed.features.keys());

  // ── Section 1: Phase 12 checklist ─────────────────────────────────────

  await t('1. knowledge index builds deterministically', () => {
    const a = buildKnowledgeIndex(parsed, { featureIndex: built.featureIndex, dashboard: built.dashboard });
    const b = buildKnowledgeIndex(parsed, { featureIndex: built.featureIndex, dashboard: built.dashboard });
    assert.equal(stableStringify(a), stableStringify(b));
  });

  await t('2. every capability references a valid canonical feature', () => {
    for (const rec of built.knowledgeIndex) {
      assert.ok(realFeatureIds.has(rec.id), `${rec.id} has no matching parsed.features entry`);
      const feat = parsed.features.get(rec.id);
      assert.ok(rec.sourceFiles.includes(feat.filePath), `${rec.id}'s sourceFiles is missing its own canonical document ${feat.filePath}`);
      assert.equal(rec.canonicalDocument, feat.filePath, `${rec.id}'s canonicalDocument field does not match its own feature file path`);
    }
  });

  await t('2b. the primary cited source for every answer is always the matched record\'s own canonical document, never an arbitrary related file (PR #5 forensic-review regression guard)', () => {
    // Found during PR #5's review: sourceFiles[0] (an alphabetically-sorted
    // merge of canonical doc + code paths + technical docs) was being used
    // as "the" primary citation — wrong for 39/58 records, and outright
    // pathless/garbled ("#12") for 5 of them. Assert the fix holds for
    // EVERY record, not just a sample: querying by each record's own exact
    // title (a strong, unambiguous match) must cite exactly its own
    // canonical document as sources[0].path.
    for (const rec of built.knowledgeIndex) {
      const answer = answerQuestion(rec.title, ctx);
      assert.equal(answer.sources[0] && answer.sources[0].path, rec.canonicalDocument,
        `${rec.id}: querying by its own exact title did not cite its own canonical document as the primary source (got "${answer.sources[0] && answer.sources[0].path}")`);
    }
  });

  await t('3. no generated capability invents a status', () => {
    for (const rec of built.knowledgeIndex) {
      assert.ok(Object.values(RECORD_STATUS).includes(rec.operatorStatus), `${rec.id} has non-canonical operatorStatus "${rec.operatorStatus}"`);
      // Re-derive independently from the same raw record and assert equality
      // — the compiled index must never diverge from a fresh resolution.
      const featureIndexRecord = built.featureIndex.find((f) => f.feature_id === rec.id);
      const openBugCount = rec.knownLimitations.openBugs.filter((b) => !/^(Fixed|Resolved|Closed)\b/i.test(b.status)).length;
      const rederived = resolveFeatureOperatorStatus(featureIndexRecord, { openBugCount });
      assert.equal(rec.operatorStatus, rederived.operatorStatus, `${rec.id} operatorStatus does not match a fresh re-derivation`);
    }
  });

  await t('4. Planned cannot become Available (or Partially Available)', () => {
    const plannedRecords = built.knowledgeIndex.filter((r) => r.status === 'Planned');
    assert.ok(plannedRecords.length > 0, 'expected at least one Planned feature in the real registry');
    for (const rec of plannedRecords) {
      assert.equal(rec.operatorStatus, RECORD_STATUS.PLANNED, `${rec.id} is canonically Planned but resolved to ${rec.operatorStatus}`);
    }
    // And the reverse direction never happens either: nothing whose raw
    // status is Implemented-family resolves to PLANNED.
    for (const rec of built.knowledgeIndex) {
      if (/^Implemented/i.test(rec.status)) {
        assert.notEqual(rec.operatorStatus, RECORD_STATUS.PLANNED, `${rec.id} is canonically "${rec.status}" but resolved to PLANNED`);
      }
    }
  });

  await t('5. source references resolve', () => {
    let checked = 0;
    for (const rec of built.knowledgeIndex) {
      for (const src of rec.sourceFiles) {
        // Only assert resolution for path-shaped entries (skip bare
        // section-citation prose with no real file component).
        if (!/[\\/.]/.test(src)) continue;
        const m = LEADING_PATH_RE.exec(src.trim());
        const cleaned = m ? m[1] : src.split(/\s+§\s+/)[0].trim();
        if (KNOWN_BROKEN_SOURCE_PATHS.has(cleaned)) continue;
        checked++;
        assert.ok(resolveSourcePath(src), `${rec.id}: source path "${src}" does not resolve on disk`);
      }
    }
    assert.ok(checked > 50, `expected to have checked a meaningful number of source paths, only checked ${checked}`);
  });

  await t('6. unsupported vs unknown remain distinct', () => {
    assert.equal(matchKnownBoundary('face recognition'), matchKnownBoundary('face recognition')); // stable
    assert.ok(matchKnownBoundary('Can AutoIngest recognize faces?'));
    assert.equal(matchKnownBoundary('completely unrelated gibberish xyz123'), null);
    const nonsense = answerQuestion('flibbertigibbet unrelated nonsense xyz123', ctx);
    assert.equal(nonsense.capabilityStatus, QUERY_STATUS.UNKNOWN);
    const boundary = answerQuestion('Can AutoIngest recognize faces?', ctx);
    assert.equal(boundary.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
    assert.notEqual(nonsense.capabilityStatus, boundary.capabilityStatus);
  });

  await t('7. representative retrieval works', () => {
    const qmz = answerQuestion('What is QMZ?', ctx);
    assert.ok(qmz.matchedCapabilities.some((m) => m.id === 'AI-FEAT-047'));
    const metadata = answerQuestion('Can AutoIngest repair missing metadata?', ctx);
    // Stage 2: the top match may legitimately be the Capability (AI-FEAT-033)
    // OR its companion Workflow (AI-WF-004, which itself cites AI-FEAT-033
    // in relatedCapabilities) — both are correctly-grounded answers to this
    // question; which one fronts the answer depends on question-type-aware
    // preference (see knowledgeEngine.js), not a regression either way.
    const top = metadata.matchedCapabilities[0].id;
    const correctlyGrounded = top === 'AI-FEAT-033' || metadata.relatedCapabilities.includes('AI-FEAT-033') || (metadata.sources || []).some((s) => s.id === 'AI-FEAT-033');
    assert.ok(correctlyGrounded, `expected the metadata-repair answer to be grounded in AI-FEAT-033 one way or another, got top=${top}, related=${JSON.stringify(metadata.relatedCapabilities)}`);
    assert.equal(metadata.capabilityStatus, QUERY_STATUS.AVAILABLE);
  });

  await t('8. face-recognition query does not hallucinate support', () => {
    const answer = answerQuestion('Can AutoIngest recognize faces in my photographs?', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
    assert.equal(answer.guidance, null);
    // The answer must never cite a fabricated feature ID as if it were the
    // supporting evidence for a real capability.
    const citedIds = answer.sources.map((s) => s.id).filter((id) => /^AI-FEAT-/.test(id));
    assert.equal(citedIds.length, 0, 'a NOT_SUPPORTED answer must not cite a feature ID as if it supports the claim');
  });

  await t('9. generated output rebuild is deterministic', () => {
    const first = build.assemble().files.get('knowledge-index.json');
    const second = build.assemble().files.get('knowledge-index.json');
    assert.equal(first, second);
  });

  await t('10. existing product-docs validation remains green (no new error-level findings)', () => {
    const gitInfo = require('../lib/gitInfo');
    const findings = validators.runAllChecks(parsed, built, { gitIsDirty: gitInfo.isWorkingTreeDirty() });
    const errors = findings.filter((f) => f.severity === 'error');
    assert.deepEqual(errors, [], `expected zero error-level findings, got: ${JSON.stringify(errors)}`);
  });

  // ── Section 2: Phase 8 — negative / hallucination tests (mandatory) ───

  await t('negative: matched capabilities are always real, never fabricated IDs', () => {
    const questions = ['What is QMZ?', 'Can I delete an event?', 'Does AutoIngest offer cloud backup?', 'Can AutoIngest generate automatic photo captions?', 'nonsense xyz'];
    for (const q of questions) {
      const answer = answerQuestion(q, ctx);
      for (const m of answer.matchedCapabilities) {
        assert.ok(realFeatureIds.has(m.id), `"${q}" produced a matched capability ID "${m.id}" that does not exist in the real feature registry`);
      }
    }
  });

  await t('negative: guidance is never anything other than the fixed fallback sentence, null, a citation to a real AI-WF workflow, or a real workflow\'s own "When To Use It" text verbatim', () => {
    // Stage 2 addition: when a companion Workflow record exists for the
    // matched capability, guidance may cite it by ID (answerFromRecord path)
    // or, when the match IS the workflow itself (answerFromWorkflow path),
    // guidance is that workflow's own "When To Use It" field verbatim. Both
    // are real evidence, never invention — checked by requiring an EXACT
    // match against real, already-authored text, not just "looks plausible."
    const WORKFLOW_CITATION_RE = /^See (AI-WF-\d{3}) \(.+\) for step-by-step instructions\.$/;
    const realWhenToUseItTexts = new Set(Array.from(ctx.workflowIndexById.values()).map((w) => w.whenToUseIt).filter(Boolean));
    const questions = ['What is QMZ?', 'How do I create a new event?', 'Can AutoIngest repair missing metadata?', 'What routine maintenance does AutoIngest do on my archive?', 'Can AutoIngest recognize faces?', 'nonsense xyz'];
    for (const q of questions) {
      const answer = answerQuestion(q, ctx);
      if (answer.guidance === null || answer.guidance === FIXED_GUIDANCE) continue;
      if (realWhenToUseItTexts.has(answer.guidance)) continue;
      const m = WORKFLOW_CITATION_RE.exec(answer.guidance);
      assert.ok(m, `"${q}" produced guidance text matching none of the allowed forms: ${answer.guidance}`);
      assert.ok(ctx.workflowIndexById.has(m[1]), `"${q}" guidance cites nonexistent workflow ${m[1]}`);
    }
  });

  await t('negative: no answer ever invents UI navigation or settings instructions', () => {
    const NAV_PHRASES = /click (the|on)|navigate to|go to (the )?settings|select .* from the menu|open the .* menu/i;
    const questions = ['How do I import photographs from an SD card?', 'What is QMZ?', 'How do I switch between Stable and Preview versions?', 'Can AutoIngest repair missing metadata?'];
    for (const q of questions) {
      const answer = answerQuestion(q, ctx);
      assert.ok(!NAV_PHRASES.test(answer.directAnswer), `"${q}" directAnswer appears to invent navigation instructions: ${answer.directAnswer}`);
      if (answer.guidance) assert.ok(!NAV_PHRASES.test(answer.guidance));
    }
  });

  await t('negative: a Planned capability is never presented as currently available', () => {
    const answer = answerQuestion('What routine maintenance does AutoIngest do on my archive?', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.PLANNED);
    assert.ok(!/AutoIngest supports this:/.test(answer.directAnswer), 'Planned answer used the Available-only phrasing');
    assert.ok(/planned for AutoIngest but not yet implemented/.test(answer.directAnswer));
    assert.equal(answer.guidance, null, 'a Planned capability must never receive "how to do it" guidance');
  });

  await t('negative: a genuinely unmatched query never becomes NOT_SUPPORTED without a cited boundary', () => {
    const answer = answerQuestion('xyzzy plugh unrelated made up capability qqqqq', ctx);
    assert.equal(answer.capabilityStatus, QUERY_STATUS.UNKNOWN);
    assert.notEqual(answer.capabilityStatus, QUERY_STATUS.NOT_SUPPORTED);
  });

  await t('negative: plausible-but-nonexistent capabilities are not confidently affirmed', () => {
    const questions = [
      'Can AutoIngest auto-generate photo captions using AI?',
      'Does AutoIngest support drone footage import with GPS flight paths?',
      'Can I schedule AutoIngest to run automatic nightly backups at a set time?',
    ];
    for (const q of questions) {
      const answer = answerQuestion(q, ctx);
      // None of these should resolve as a confident, unhedged AVAILABLE —
      // either genuinely UNKNOWN, a cited NOT_SUPPORTED boundary, or a
      // hedged 'weak' match (never 'strong').
      if (answer.capabilityStatus === QUERY_STATUS.AVAILABLE || answer.capabilityStatus === QUERY_STATUS.PARTIALLY_AVAILABLE) {
        assert.notEqual(answer.matchQuality, 'strong', `"${q}" was confidently affirmed (strong match) — investigate for a real false positive`);
      }
    }
  });

  await t('negative: every AI-FEAT ID mentioned anywhere in an answer is a real, existing feature', () => {
    const questions = ['What is QMZ?', 'How do I create a new event?', 'Can AutoIngest repair missing metadata?', 'Does AutoIngest offer cloud backup?', 'Can AutoIngest recognize faces?'];
    for (const q of questions) {
      const answer = answerQuestion(q, ctx);
      const haystacks = [answer.directAnswer, ...(answer.limitations || []), ...(answer.relatedCapabilities || [])];
      for (const text of haystacks) {
        const ids = String(text).match(FEATURE_ID_RE) || [];
        for (const id of ids) assert.ok(realFeatureIds.has(id), `"${q}" answer text cites nonexistent ${id}`);
      }
    }
  });

  summarize('knowledge.test.js');
}

main();
