'use strict';

// Phase C4 (Ask AutoIngest Electron Product Surface). Model-free tests for
// main/askAutoIngestPresentation.js -- the pure, Electron-independent
// shaping/sanitization layer between C3's answerQuestionWithAuthority()
// and the renderer. Runs the REAL deterministic engine and REAL C1
// authority pipeline (with injected mock judges, never a real model) to
// prove, with real answer objects (not synthetic fixtures), that: (1) raw
// internal IDs never appear in the primary answer fields, (2) they DO
// remain available in technicalDetails for the disclosure panel, and
// (3) the deterministic status/uncertainty presentation mapping is exact.
//
// Run with: node test/askAutoIngestPresentation.test.js

const assert = require('node:assert/strict');
const path = require('node:path');

const PRODUCT_DOCS = path.join(__dirname, '..', 'scripts', 'product-docs');
const build = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
const { buildEngineContext, answerQuestion } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
const { answerQuestionWithAuthority } = require(path.join(PRODUCT_DOCS, 'lib', 'answerWithAuthority.js'));
const { shapeAnswerForUI, shapeModelStatus, QUERY_STATUS_LABELS, MODEL_STATE_LABELS } = require('../main/askAutoIngestPresentation');

const RAW_ID_RE = /\b(AI-FEAT-\d+|AI-WF-\d+|AI-RM-\d+|DEC-\d+|BUG-\d+|PM-\d+|AI-MEM-\d+)\b/;
const READY = () => ({ status: 'READY', detail: {} });

let passed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    console.error(`  FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('askAutoIngestPresentation');
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  // ---------------------------------------------------------------------
  // Part G: no raw IDs in the primary answer, across a representative
  // sweep of real questions spanning HOW_TO/TROUBLESHOOTING/STATUS/etc.
  // ---------------------------------------------------------------------
  const sweepQuestions = [
    'How do I import photographs from an SD card?',
    'What is QMZ?',
    'My transfer stopped halfway. What should I do?',
    'Does AutoIngest support system status monitoring?',
    'Does AutoIngest support telemetry?',
    'What is coming next for AutoIngest?',
    'Can AutoIngest recognize faces?',
    'Why does Transfer Import exist?',
  ];
  // Substring (not \b-bounded) check for the ID family prefixes -- RAW_ID_RE
  // itself requires a trailing word boundary, which a real found-and-fixed
  // defect this checkpoint proved is NOT sufficient: a canonical-doc
  // markdown citation shaped like "DEC-011_QMZ_DEDICATED_DOMAIN_WORKFLOW.md"
  // (a real link path, docs/product/features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md)
  // has "DEC-011" immediately followed by "_", a word character, so \b never
  // matches there -- the ID silently survived sanitizeIdsInProse() past a
  // \b-bounded check. This substring check is deliberately stricter.
  const ID_PREFIX_SUBSTRING_RE = /(AI-FEAT-\d+|AI-WF-\d+|AI-RM-\d+|DEC-\d+|BUG-\d+|PM-\d+|AI-MEM-\d+)/;
  for (const q of sweepQuestions) {
    await t(`no raw IDs in primary answer fields for "${q}"`, async () => {
      const answer = await answerQuestionWithAuthority(q, ctx, { judge: async () => ({ judgment: 'INSUFFICIENT_EVIDENCE', evidenceHandles: [], confidence: 'HIGH' }), getModelAvailability: READY });
      const shaped = shapeAnswerForUI(answer, ctx);
      const primaryFields = [shaped.directAnswer, shaped.guidance, ...(shaped.steps || []), ...(shaped.limitations || [])];
      for (const field of primaryFields) {
        if (typeof field !== 'string') continue;
        assert.ok(!RAW_ID_RE.test(field), `"${q}" leaked a raw ID into a primary field: ${field}`);
        assert.ok(!ID_PREFIX_SUBSTRING_RE.test(field), `"${q}" leaked an ID-shaped substring (e.g. inside a markdown link path) into a primary field: ${field}`);
        assert.ok(!/\]\(/.test(field), `"${q}" leaked raw markdown link syntax into a primary field (Ask AutoIngest renders plain text, not markdown): ${field}`);
      }
      for (const rc of shaped.relatedCapabilities) {
        assert.ok(!RAW_ID_RE.test(rc.title), `"${q}" relatedCapabilities title leaked a raw ID: ${rc.title}`);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Part G regression: the specific found-and-fixed defect above, pinned
  // to the exact real question/citation that exposed it. "What is QMZ?"
  // is trial question #2 (Part N) -- its directAnswer real prose cites
  // DEC-011 via a markdown link whose URL embeds the raw ID in a
  // filename slug ("DEC-011_QMZ_DEDICATED_DOMAIN_WORKFLOW.md"), which
  // sanitizeIdsInProse() alone does not strip (see ID_PREFIX_SUBSTRING_RE
  // comment above). main/askAutoIngestPresentation.js's flattenMarkdownLinks()
  // (applied before sanitizeIdsInProse(), so the surviving link-text token
  // is still converted to its real display name) is what actually fixes
  // this -- this test pins that fix to the exact real citation, not just
  // the general substring sweep above.
  // ---------------------------------------------------------------------
  await t('regression: "What is QMZ?" no longer leaks DEC-011 via its markdown-link citation, and shows a real display name instead', async () => {
    const answer = answerQuestion('What is QMZ?', ctx);
    const shaped = shapeAnswerForUI(answer, ctx);
    assert.ok(!/DEC-011/.test(shaped.directAnswer), `directAnswer still contains the raw "DEC-011" substring: ${shaped.directAnswer}`);
    assert.ok(!/\]\(/.test(shaped.directAnswer), `directAnswer still contains raw markdown link syntax: ${shaped.directAnswer}`);
    assert.ok(/Dedicated Domain Workflow/i.test(shaped.directAnswer), 'expected the real display name to survive in place of the stripped link');
  });

  // ---------------------------------------------------------------------
  // Part G: raw IDs DO remain available in technicalDetails, for the
  // disclosure panel -- proving sanitization is presentation-only, not
  // data loss.
  // ---------------------------------------------------------------------
  await t('raw IDs remain present in technicalDetails.sources for disclosure', async () => {
    const answer = answerQuestion('How do I import photographs from an SD card?', ctx);
    const shaped = shapeAnswerForUI({ ...answer, authority: { required: false, ran: false } }, ctx);
    assert.ok(shaped.technicalDetails.sources.length > 0);
    assert.ok(shaped.technicalDetails.sources.some((s) => RAW_ID_RE.test(s.id)), 'expected at least one real raw ID preserved in technicalDetails.sources');
    assert.ok(shaped.technicalDetails.sources.every((s) => s.title && !RAW_ID_RE.test(s.title)), 'every technicalDetails source must have a real, non-ID title');
  });

  await t('raw IDs remain present in relatedCapabilities[].id even though .title is sanitized', async () => {
    const answer = answerQuestion('How do I import photographs from an SD card?', ctx);
    const shaped = shapeAnswerForUI({ ...answer, authority: { required: false, ran: false } }, ctx);
    assert.ok(shaped.relatedCapabilities.length > 0);
    assert.ok(shaped.relatedCapabilities.every((rc) => RAW_ID_RE.test(rc.id)));
    assert.ok(shaped.relatedCapabilities.every((rc) => !RAW_ID_RE.test(rc.title)));
  });

  // ---------------------------------------------------------------------
  // Part F item 2: status label mapping, never raw enum in the primary UI.
  // ---------------------------------------------------------------------
  for (const [code, label] of Object.entries(QUERY_STATUS_LABELS)) {
    await t(`status label mapping: ${code} -> "${label}"`, () => {
      const shaped = shapeAnswerForUI({ query: 'x', classification: 'CAPABILITY', capabilityStatus: code, directAnswer: 'x', guidance: null, steps: [], limitations: [], relatedCapabilities: [], sources: [], authority: null }, ctx);
      assert.equal(shaped.status.code, code);
      assert.equal(shaped.status.label, label);
      assert.notEqual(shaped.status.label, code, 'label must never be the bare enum string');
    });
  }

  // knowledgeEngine.js's ROADMAP branch sets capabilityStatus to the
  // classification name itself ('ROADMAP'), not a real QUERY_STATUS value
  // -- a real, pre-existing quirk (untouched here). A genuine bug was
  // found and fixed this checkpoint: the presentation layer must never
  // leak this (or any other unrecognized code) as a raw-enum badge label.
  await t('status label mapping: an unrecognized capabilityStatus (e.g. ROADMAP) is never shown as a raw enum -- the badge is omitted, not fabricated', async () => {
    const answer = await answerQuestionWithAuthority("What's coming next for AutoIngest?", ctx, { judge: async () => { throw new Error('must not be called'); }, getModelAvailability: READY });
    assert.equal(answer.capabilityStatus, 'ROADMAP', 'sanity: this is the real, pre-existing knowledgeEngine.js quirk being guarded against');
    const shaped = shapeAnswerForUI(answer, ctx);
    assert.equal(shaped.status.code, null);
    assert.equal(shaped.status.label, null);
  });

  // ---------------------------------------------------------------------
  // Part H: uncertainty presentation -- exact copy, model-unavailable vs
  // generic semantic non-confirmation.
  // ---------------------------------------------------------------------
  await t('uncertainty UX: model-unavailable reason uses the exact Part H copy', async () => {
    const answer = await answerQuestionWithAuthority('Does AutoIngest support drone footage import with GPS flight paths?', ctx, {
      judge: async () => { throw Object.assign(new Error('unavailable'), { modelState: 'NOT_DOWNLOADED', modelUnavailable: true }); },
      getModelAvailability: () => ({ status: 'NOT_DOWNLOADED', detail: {} }),
    });
    const shaped = shapeAnswerForUI(answer, ctx);
    assert.equal(shaped.status.code, 'UNKNOWN');
    assert.equal(shaped.uncertaintyMessage, 'Capability verification is currently unavailable. You can still view the related documentation below.');
    assert.equal(shaped.directAnswer, shaped.uncertaintyMessage);
    assert.ok(!/GGUF|utilityProcess|timeout|checksum|entailment/i.test(shaped.directAnswer), 'must never expose a technical error in the primary answer');
  });

  await t('uncertainty UX: a real semantic non-confirmation (model READY) uses the generic copy, not the model-unavailable copy', async () => {
    const answer = await answerQuestionWithAuthority('Does AutoIngest support drone footage import with GPS flight paths?', ctx, {
      judge: async () => ({ judgment: 'INSUFFICIENT_EVIDENCE', evidenceHandles: [], confidence: 'HIGH' }),
      getModelAvailability: READY,
    });
    const shaped = shapeAnswerForUI(answer, ctx);
    assert.equal(shaped.status.code, 'UNKNOWN');
    assert.equal(shaped.uncertaintyMessage, 'AutoIngest found related documentation, but it does not establish this capability clearly enough to confirm it.');
  });

  await t('uncertainty UX: a non-authority genuinely-UNKNOWN question (no evidence at all) is left as the deterministic engine\'s own text, no uncertaintyMessage override', async () => {
    const answer = await answerQuestionWithAuthority('xyzzy plugh unrelated made up capability qqqqq', ctx, { judge: async () => { throw new Error('must not be called'); }, getModelAvailability: READY });
    const shaped = shapeAnswerForUI(answer, ctx);
    assert.equal(shaped.status.code, 'UNKNOWN');
    assert.equal(shaped.uncertaintyMessage, null, 'authority never ran for this question -- no authority-specific uncertainty message should be synthesized');
  });

  // ---------------------------------------------------------------------
  // Part J: model-state label mapping, never raw enum.
  // ---------------------------------------------------------------------
  for (const [status, label] of Object.entries(MODEL_STATE_LABELS)) {
    await t(`model-state label mapping: ${status} -> human text`, () => {
      const shaped = shapeModelStatus({ status, detail: {} }, {});
      assert.equal(shaped.label, label);
      assert.notEqual(shaped.label, status);
    });
  }

  await t('shapeModelStatus passes through extra fields (downloadSourceApproved, modelId, etc.) unchanged', () => {
    const shaped = shapeModelStatus({ status: 'NOT_DOWNLOADED', detail: {} }, { downloadSourceApproved: false, modelId: 'phi-4-mini-instruct-Q4_K_M' });
    assert.equal(shaped.downloadSourceApproved, false);
    assert.equal(shaped.modelId, 'phi-4-mini-instruct-Q4_K_M');
  });

  // ---------------------------------------------------------------------
  // Never mutates the input answer object.
  // ---------------------------------------------------------------------
  await t('shapeAnswerForUI never mutates the input answer object', async () => {
    const answer = await answerQuestionWithAuthority('How do I import photographs from an SD card?', ctx, { judge: async () => { throw new Error('n/a'); }, getModelAvailability: READY });
    const before = JSON.stringify(answer);
    shapeAnswerForUI(answer, ctx);
    assert.equal(JSON.stringify(answer), before);
  });

  console.log(`askAutoIngestPresentation.test.js: ${passed} passed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
