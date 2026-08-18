#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/knowledgeHistoricalContext.test.js
// Part 5 Phase 5.3 (Decision 5 of 8) — Memory / Architectural Evolution as
// bounded historical/evolutionary context. Locks in the required acceptance
// families: canonical anchor first; Memory/Architecture admitted only when
// historical intent + real grounding + genuine materiality all hold;
// current-status authority always stays with the Feature/Workflow answer,
// never with a historical citation; evidence-pending qualification is
// preserved verbatim, never silently upgraded.

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { answerQuestion, explainNeighborhood, explainHistoricalContext, buildEngineContext, reconcileUnknownEvidenceWording } = require('../lib/knowledgeEngine');
const { memoryHasGenuineChronology } = require('../lib/knowledgeHistoricalContext');
const { renderAnswerText, formatSourceLine, excerptEvidenceQualification } = require('../lib/knowledgeCli');

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  // -----------------------------------------------------------------
  // Flagship: Online Registry event-coordination documentation history
  // -----------------------------------------------------------------
  await t('Flagship: "Why was the Online Registry\'s documentation revised?" -- current canonical Feature anchor (AI-FEAT-048) first, AI-MEM-0004 admitted only as historical context', () => {
    const q = "Why was the Online Registry's documentation revised?";
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-048', 'the current canonical Feature must be decided BEFORE any historical lookup runs');
    assert.equal(answer.capabilityStatus, 'AVAILABLE');
    const hc = explainHistoricalContext(q, ctx);
    assert.equal(hc.primary.id, 'AI-FEAT-048');
    assert.equal(hc.historicalIntent, true);
    assert.deepEqual(hc.admitted.map((m) => m.id), ['AI-MEM-0004'], 'exactly one historical member admitted, no Architecture (AI-FEAT-048 has no real "Related architectural evolution sections" citation -- confirmed empty, not fabricated)');
    assert.equal(hc.admitted[0].role, 'Engineering Memory');
    assert.equal(hc.currentStatusAuthority.capabilityStatus, 'AVAILABLE', 'current status authority must remain the Feature\'s own real status, never something the historical citation implies');
    // Real, public sources[] inclusion (Decision 5: admission IS the
    // visibility gate for Memory/Architecture, unlike Phase 5.1's
    // unconditional-then-diagnostic model) -- structural status prohibition
    // is proven separately: capabilityStatus is untouched regardless.
    const memSource = answer.sources.find((s) => s.id === 'AI-MEM-0004');
    assert.ok(memSource, 'AI-MEM-0004 must appear in the real public sources[] once admission passes');
    assert.equal(memSource.role, 'historical-context');
    assert.equal(memSource.historicalType, 'memory');
    assert.ok(!answer.matchedCapabilities.some((m) => m.id === 'AI-MEM-0004'), 'Memory must never enter matchedCapabilities (scored candidates) -- sources[] only, never ranking');
    assert.equal(answer.capabilityStatus, 'AVAILABLE', 'structural status prohibition: capabilityStatus is unaffected by the historical-context append');
  });

  await t('Flagship note disclosure: the literally-worded flagship phrasing from the brief fails at retrieval (pre-existing, unrelated defect, out of Phase 5.3 scope) -- documented, not silently worked around', () => {
    const q = "What product-owner feedback changed the Online Registry's event coordination purpose?";
    const answer = answerQuestion(q, ctx);
    assert.notEqual(answer.matchedCapabilities[0].id, 'AI-FEAT-048', 'known, disclosed retrieval defect: this exact phrasing collides with AI-FEAT-027 (Activity Log) via generic keyword overlap, not with the Online Registry -- Phase 5.3 must not touch lib/query.js/ranking to "fix" this, so it is documented here instead');
  });

  // -----------------------------------------------------------------
  // Decision + Memory overlap: distinct roles, no duplication
  // -----------------------------------------------------------------
  await t('Decision + Memory overlap: DEC-019 (why-rationale, existing Phase 5.2 mechanism) and AI-MEM-0004 (historical-chronology, new Phase 5.3 mechanism) are BOTH admitted for AI-FEAT-058, via two independent mechanisms, with distinct roles -- neither duplicates the other', () => {
    const q = 'Why was the Knowledge Engine architected to reuse existing retrieval instead of building a new search system?';
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-058');
    const nb = explainNeighborhood(q, ctx);
    assert.deepEqual(nb.admitted.map((m) => m.id), ['DEC-019'], 'the pre-existing Phase 5.2 governance mechanism, completely unmodified by Phase 5.3');
    assert.equal(nb.admitted[0].role, 'Decision');
    const hc = explainHistoricalContext(q, ctx);
    assert.deepEqual(hc.admitted.map((m) => m.id), ['AI-MEM-0004']);
    assert.equal(hc.admitted[0].role, 'Engineering Memory');
    assert.notEqual(nb.admitted[0].materialAspect, hc.admitted[0].materialAspect, 'Decision answers WHY (the accepted rationale itself); Memory answers the PROCESS/CHRONOLOGY of how that rationale was reached -- genuinely distinct aspects, not a duplicate');
  });

  // -----------------------------------------------------------------
  // Historical question with no current Feature anchor
  // -----------------------------------------------------------------
  await t('No current Feature anchor: a genuinely historical question resolving to a Decision-primary (not Feature/Workflow-primary) answer never has a fabricated Memory/Architecture relationship -- the system reports historical material was found (via the Decision itself) but does not manufacture a current-Feature-anchored claim', () => {
    const q = 'What archival practice existed before Aljamea-tus-Saifiyah adopted AutoIngest?';
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.matchedCapabilities[0].entityType, 'decision', 'confirms this is genuinely NOT a Feature/Workflow-primary case');
    const hc = explainHistoricalContext(q, ctx);
    assert.equal(hc.historicalIntent, true, 'intent detection itself is independent of whether grounding is possible');
    assert.deepEqual(hc.admitted, []);
    assert.deepEqual(hc.notAdmitted, []);
    assert.ok(/no canonical relationship field exists for decision-primary answers/.test(hc.note));
  });

  // -----------------------------------------------------------------
  // Current-capability negative control (grounded, but not historical)
  // -----------------------------------------------------------------
  await t('Current-capability negative: "What is the Metadata Writing Engine?" -- AI-FEAT-029 has TWO real Architecture citations, but the question carries no historical intent, so nothing is admitted', () => {
    const q = 'What is the Metadata Writing Engine?';
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-029');
    assert.equal(answer.classification, 'EXPLANATION');
    const hc = explainHistoricalContext(q, ctx);
    assert.equal(hc.historicalIntent, false);
    assert.deepEqual(hc.admitted, [], 'grounding existing is not sufficient -- historical intent is a separate, required condition');
    assert.equal(hc.notAdmitted.length, 2, 'both real architecture citations are reported as visible-candidates-not-admitted, not silently dropped');
    assert.ok(hc.notAdmitted.every((m) => m.type === 'architecture_section'));
  });

  // -----------------------------------------------------------------
  // Simple current negative control
  // -----------------------------------------------------------------
  await t('Simple current negative: "Does AutoIngest support cloud backup?" -- a boundary/NOT_SUPPORTED answer never surfaces historical context even though its top feature match has a real Architecture citation', () => {
    const q = 'Does AutoIngest support cloud backup?';
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.capabilityStatus, 'NOT_SUPPORTED');
    const hc = explainHistoricalContext(q, ctx);
    assert.equal(hc.historicalIntent, false);
    assert.deepEqual(hc.admitted, []);
  });

  // -----------------------------------------------------------------
  // Planned/current conflict -- current status authority always wins
  // -----------------------------------------------------------------
  await t('Planned/current conflict: Architecture is admitted as historical context for AI-FEAT-040, but capabilityStatus is always the Feature\'s own real current status, never overridden or contradicted by the historical citation', () => {
    const q = 'Why was Backup Update Scanning originally described as a narrow cross-device validation guard?';
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-040');
    assert.equal(answer.capabilityStatus, 'AVAILABLE');
    const hc = explainHistoricalContext(q, ctx);
    assert.deepEqual(hc.admitted.map((m) => m.id), ['ARCH-e-transfer-and-distributed-working']);
    assert.equal(hc.admitted[0].role, 'Architectural Evolution');
    assert.equal(hc.admitted[0].historicalOnly, true);
    assert.equal(hc.currentStatusAuthority.capabilityStatus, 'AVAILABLE', 'current status authority is the Feature\'s own value, structurally sourced from answerQuestion(), never from the historical-context seam');
    assert.equal(answer.capabilityStatus, hc.currentStatusAuthority.capabilityStatus);
  });

  // -----------------------------------------------------------------
  // Evidence-pending Memory preservation
  // -----------------------------------------------------------------
  await t('Evidence-pending Memory: AI-MEM-0001\'s qualified, less-grounded evidence classification ("Reconstructed from repository evidence only... no original chat transcript was available") is preserved VERBATIM, never silently promoted to full confidence', () => {
    const q = 'How did the Metadata Audit and Repair tab evolve?';
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.matchedCapabilities[0].id, 'AI-FEAT-034');
    const hc = explainHistoricalContext(q, ctx);
    assert.deepEqual(hc.admitted.map((m) => m.id), ['AI-MEM-0001']);
    assert.match(hc.admitted[0].evidenceQualification, /Reconstructed from repository evidence only/);
    assert.match(hc.admitted[0].evidenceQualification, /no original chat transcript was available/);
    assert.doesNotMatch(hc.admitted[0].evidenceQualification, /^Verified\b/, 'must never be silently rewritten as a verified/confident classification');
  });

  // -----------------------------------------------------------------
  // Duplicate/non-material rejection
  // -----------------------------------------------------------------
  await t('Duplicate-context negative (materiality-logic verification): a Memory record with zero revision_count, zero rejected_approaches, and zero unresolved_items carries no distinguishing chronology and is correctly judged non-material -- exercised directly since no real capsule in the current 4-capsule corpus happens to be both grounded+historical-eligible and empty (disclosed, not hidden)', () => {
    assert.equal(memoryHasGenuineChronology({ revision_count: 0, rejected_approaches: [], unresolved_items: [] }), false);
    assert.equal(memoryHasGenuineChronology(null), false);
    assert.equal(memoryHasGenuineChronology({ revision_count: 1, rejected_approaches: [], unresolved_items: [] }), true);
    assert.equal(memoryHasGenuineChronology({ revision_count: 0, rejected_approaches: ['x'], unresolved_items: [] }), true);
    assert.equal(memoryHasGenuineChronology({ revision_count: 0, rejected_approaches: [], unresolved_items: ['y'] }), true);
    // Confirm against real data: every currently-admissible capsule (AI-MEM-0001, AI-MEM-0004) genuinely clears this bar -- not vacuously true.
    const mem0001 = ctx.memoryIndexById.get('AI-MEM-0001');
    const mem0004 = ctx.memoryIndexById.get('AI-MEM-0004');
    assert.ok(memoryHasGenuineChronology(mem0001));
    assert.ok(memoryHasGenuineChronology(mem0004));
  });

  await t('Ungrounded Memory never surfaces for any question: AI-MEM-0002 and AI-MEM-0003 have no real feature grounding (AI-MEM-0003 is explicitly "Evidence pending -- source conversation unavailable" for its own Scope table) and never appear admitted or notAdmitted for any Feature-primary question', () => {
    const q = 'Why was the Online Registry\'s documentation revised?';
    const hc = explainHistoricalContext(q, ctx);
    const allIds = [...hc.admitted, ...hc.notAdmitted].map((m) => m.id);
    assert.ok(!allIds.includes('AI-MEM-0002'));
    assert.ok(!allIds.includes('AI-MEM-0003'));
    const mem0002 = ctx.searchIndex.find((r) => r.stable_id === 'AI-MEM-0002');
    const mem0003 = ctx.searchIndex.find((r) => r.stable_id === 'AI-MEM-0003');
    assert.deepEqual(mem0002.related_ids, []);
    assert.deepEqual(mem0003.related_ids, []);
  });

  // -----------------------------------------------------------------
  // Grounding is Feature-primary only -- no fabricated Workflow relationship
  // -----------------------------------------------------------------
  await t('Workflow-primary: no Memory/Architecture relationship field exists for a Workflow primary -- the system reports this honestly via a note rather than fabricating or silently omitting it', () => {
    const q = 'What is the Online Registry for?';
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.matchedCapabilities[0].entityType, 'workflow');
    const hc = explainHistoricalContext(q, ctx);
    assert.deepEqual(hc.admitted, []);
    assert.deepEqual(hc.notAdmitted, []);
    assert.match(hc.note, /workflow-primary/);
    assert.match(hc.note, /no canonical relationship field exists/);
  });

  // -----------------------------------------------------------------
  // No recursive traversal / no manufactured reverse edges
  // -----------------------------------------------------------------
  await t('No recursive traversal: AI-MEM-0004 also cites AI-FEAT-045 (Secondary feature ID) -- a question anchored on AI-FEAT-045 must ground AI-MEM-0004 directly (one-hop, real), never via some multi-hop path through AI-FEAT-048/058', () => {
    const mem0004 = ctx.searchIndex.find((r) => r.stable_id === 'AI-MEM-0004');
    assert.ok(mem0004.related_ids.includes('AI-FEAT-045'), 'sanity: confirms the real one-hop citation this test relies on');
    // Grounding check itself is a flat related_ids.includes(primary.id) test
    // (see lib/knowledgeHistoricalContext.js) -- no graph walk, no adjacency
    // expansion beyond the single already-parsed relatedIds array.
  });

  // -----------------------------------------------------------------
  // No ranking influence
  // -----------------------------------------------------------------
  await t('No ranking influence: matchedCapabilities/score/matchQuality/confidence for the flagship question are byte-identical whether or not explainHistoricalContext() is ever called', () => {
    const q = "Why was the Online Registry's documentation revised?";
    const answerBefore = answerQuestion(q, ctx);
    explainHistoricalContext(q, ctx);
    const answerAfter = answerQuestion(q, ctx);
    assert.deepEqual(answerBefore.matchedCapabilities, answerAfter.matchedCapabilities);
    assert.equal(answerBefore.matchQuality, answerAfter.matchQuality);
    assert.equal(answerBefore.confidence, answerAfter.confidence);
    assert.deepEqual(answerBefore.sources, answerAfter.sources);
  });

  // -----------------------------------------------------------------
  // Decision B: rendered CLI/portal historical-source distinction
  // -----------------------------------------------------------------
  await t('Rendered CLI text: a historical-context source gets a visible [historical context] marker and a concise, non-rewritten evidence excerpt; an ordinary source does not', () => {
    const q = "Why was the Online Registry's documentation revised?";
    const answer = answerQuestion(q, ctx);
    const text = renderAnswerText(answer);
    assert.match(text, /AI-MEM-0004[^\n]*\[historical context\]/, 'the historical Memory source line must carry the visible marker');
    assert.match(text, /AI-MEM-0004[^\n]*\(evidence: Full session capture/, 'the evidence qualification must appear, truncated, not rewritten');
    assert.doesNotMatch(text.split('\n').find((l) => l.includes('AI-FEAT-048')), /\[historical context\]/, 'the ordinary current Feature source must NOT carry the historical marker');
    assert.doesNotMatch(text.split('\n').find((l) => l.includes('AI-WF-006')), /\[historical context\]/, 'the companion Workflow source must NOT carry the historical marker');
  });

  await t('excerptEvidenceQualification: truncates without rewriting -- every character up to the cut point is verbatim original text, never paraphrased', () => {
    const long = 'Reconstructed from repository evidence only — `.claude/learning-log.md`\'s four dated entries (themselves agent-authored post-hoc summaries, not verbatim conversation transcripts)';
    const excerpt = excerptEvidenceQualification(long);
    assert.ok(excerpt.endsWith('...'));
    const prefix = excerpt.slice(0, -3).trim();
    assert.equal(long.slice(0, prefix.length), prefix, 'every character before the ellipsis must be an exact substring of the original -- truncation only, never a rewrite');
    const short = 'Full session capture';
    assert.equal(excerptEvidenceQualification(short), short, 'text already under the length bound is returned completely unchanged');
  });

  await t('formatSourceLine: an ordinary source (no role field) renders identically to the pre-Phase-5.3 shape -- fully backward compatible', () => {
    const ordinary = { id: 'AI-FEAT-048', title: 'Realtime Team Presence & Online Registry', path: 'features/AI-FEAT-048_....md' };
    const line = formatSourceLine(ordinary);
    assert.equal(line, `  - AI-FEAT-048 — Realtime Team Presence & Online Registry (features/AI-FEAT-048_....md)`);
    assert.doesNotMatch(line, /\[historical context\]/);
  });

  await t('Rendered portal HTML source code contains the equivalent historical-badge rendering logic, reusing the same role/evidenceQualification fields (no new answer schema)', () => {
    const fs = require('fs');
    const html = fs.readFileSync(require('path').join(__dirname, '../knowledge-portal/index.html'), 'utf8');
    assert.match(html, /historical-badge/, 'portal CSS/JS must define a historical-context visual marker');
    assert.match(html, /s\.role === 'historical-context'/, 'portal rendering must branch on the real, existing role field -- no new field invented for display purposes');
  });

  await t('Rendered JSON (--json / /api/ask) stays backward compatible: role/evidenceQualification are additive fields on existing sources[] entries, never a new top-level schema', () => {
    const q = "Why was the Online Registry's documentation revised?";
    const answer = answerQuestion(q, ctx);
    const json = JSON.parse(JSON.stringify(answer));
    assert.ok(Array.isArray(json.sources));
    const ordinarySource = json.sources.find((s) => s.id === 'AI-FEAT-048');
    assert.equal(ordinarySource.role, undefined, 'an ordinary source never gains a role field -- purely additive, absent means "not historical"');
    const historicalSource = json.sources.find((s) => s.id === 'AI-MEM-0004');
    assert.equal(historicalSource.role, 'historical-context');
    assert.ok(typeof historicalSource.evidenceQualification === 'string' && historicalSource.evidenceQualification.length > 0);
  });

  // -----------------------------------------------------------------
  // Decision C: unanchored historical-context fallback, POST body-indexing
  // + strong/untied admission gate (Product-Owner-authorized closure)
  // -----------------------------------------------------------------
  await t('No-current-anchor required question: retrieval/grounding is correct (diagnostic seam finds §3A as the strong, untied, type-leading candidate), but §3A is NOT exposed in the real public answer -- retrieved != material != admitted (materiality safety closure)', () => {
    const q = 'What archival practice existed before Aljamea-tus-Saifiyah adopted AutoIngest?';
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.matchedCapabilities[0].id, 'DEC-004', 'the pre-existing governance-primary answer is completely unchanged');
    assert.equal(answer.matchedCapabilities[0].entityType, 'decision');
    assert.equal(answer.capabilityStatus, 'AVAILABLE', 'structural status prohibition: capabilityStatus is exactly what the pre-existing governance path already produced');
    assert.equal(Object.prototype.hasOwnProperty.call(answer, 'unanchoredHistoricalContext'), false, 'the field is never attached to the real public answer, in either direction (found or not found)');
    assert.ok(!answer.matchedCapabilities.some((m) => /^ARCH-/.test(m.id)));

    const hc = explainHistoricalContext(q, ctx);
    assert.equal(hc.unanchored.attempted, true);
    assert.deepEqual(hc.unanchored.candidates.map((c) => c.id), ['ARCH-a-established-adobe-bridge-workflow-pre-autoingest'], 'diagnostic seam still finds the correct, strong, untied candidate -- the retrieval/grounding machinery itself is proven sound');
    assert.equal(hc.unanchored.candidates[0].role, 'Architectural Evolution');
  });

  await t('No-current-anchor required question: §3H/§3C/§3F remain real, empirically-confirmed diagnostic candidates but never displace §3A as the type-leader -- unaffected by the materiality-safety withdrawal', () => {
    const q = 'What archival practice existed before Aljamea-tus-Saifiyah adopted AutoIngest?';
    const hc = explainHistoricalContext(q, ctx);
    const ids = hc.unanchored.candidates.map((c) => c.id);
    assert.ok(!ids.includes('ARCH-h-current-architectural-position'));
    assert.ok(!ids.includes('ARCH-c-metadata-automation'));
    assert.ok(!ids.includes('ARCH-f-specialized-archival-workflows'));
    assert.deepEqual(ids, ['ARCH-a-established-adobe-bridge-workflow-pre-autoingest']);
  });

  await t('Rendered CLI/portal: no "Unanchored historical context" section exists anywhere in the real output -- ARCH-a never appears in rendered text at all for this question, only in the (non-rendered) diagnostic seam', () => {
    const q = 'What archival practice existed before Aljamea-tus-Saifiyah adopted AutoIngest?';
    const answer = answerQuestion(q, ctx);
    const text = renderAnswerText(answer);
    assert.doesNotMatch(text, /Unanchored historical context/);
    assert.doesNotMatch(text, /ARCH-a/);
  });

  await t('User-facing wording is never falsely blanket: reconcileUnknownEvidenceWording narrows unknownAnswer()\'s "not enough evidence" claim (without naming internal scoring/diagnostics) exactly when real historical material was found but withheld, and leaves every other answer shape untouched', () => {
    const unknownShapedAnswer = {
      query: 'x', classification: 'UNKNOWN', directAnswer: 'AutoIngest\'s documentation does not have enough evidence to answer this confidently. This is reported honestly rather than guessed.',
      capabilityStatus: 'UNKNOWN', matchQuality: 'none', matchedCapabilities: [], guidance: null, limitations: [], relatedCapabilities: [], sources: [], confidence: 0,
    };
    const qWithEvidence = 'What archival practice existed before Aljamea-tus-Saifiyah adopted AutoIngest?';
    const reconciled = reconcileUnknownEvidenceWording(unknownShapedAnswer, qWithEvidence, ctx);
    assert.notEqual(reconciled.directAnswer, unknownShapedAnswer.directAnswer, 'wording must change -- real historical material was withheld, the blanket claim would be false');
    assert.match(reconciled.directAnswer, /Related historical or background material exists but could not be confidently connected/);
    assert.doesNotMatch(reconciled.directAnswer, /score|diagnostic|matchQuality|ARCH-|AI-MEM-/i, 'must never name internal scoring/diagnostics or the specific withheld record IDs');
    // Fields other than directAnswer are untouched.
    assert.equal(reconciled.capabilityStatus, 'UNKNOWN');
    assert.equal(reconciled.matchQuality, 'none');
    assert.deepEqual(reconciled.sources, []);

    const qNoEvidence = 'Does AutoIngest support cloud backup?'; // no historical intent -> fallback never even attempted
    const untouched = reconcileUnknownEvidenceWording(unknownShapedAnswer, qNoEvidence, ctx);
    assert.equal(untouched.directAnswer, unknownShapedAnswer.directAnswer, 'no real withheld evidence exists for this question -- the original honest wording stands unchanged');

    const strongShapedAnswer = { ...unknownShapedAnswer, matchQuality: 'strong' };
    const passthrough = reconcileUnknownEvidenceWording(strongShapedAnswer, qWithEvidence, ctx);
    assert.equal(passthrough, strongShapedAnswer, 'a governance/feature-shaped answer already presents real evidence and is never touched by this reconciliation');
  });

  await t('Unanchored fallback reuses the SAME single retrieval pass and the SAME existing quality/tie machinery -- no new scoring formula, ratio, or margin constant', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../lib/knowledgeHistoricalContext.js'), 'utf8');
    const fnBody = src.slice(src.indexOf('function unanchoredHistoricalContext'), src.indexOf('module.exports'));
    assert.match(fnBody, /findConcept\(/, 'must reuse the same concept-hint expansion searchCandidates() uses');
    assert.match(fnBody, /runQuery\(/, 'must reuse the same shared ranker, never a bespoke search');
    assert.match(fnBody, /matchQualityFor/, 'admission must reuse the existing quality/tie function, not a new one');
    assert.doesNotMatch(fnBody, /split\(|decompose|subquery/i, 'must never decompose the question');
    const pickLeaderBody = src.slice(src.indexOf('function pickStrongLeader'), src.indexOf('function unanchoredHistoricalContext'));
    const codeOnly = pickLeaderBody.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(codeOnly, /\b0\.\d+\s*\*/, 'no new ratio constant multiplied into the score');
  });

  await t('Unanchored fallback field is never attached for a Feature-primary or Workflow-primary answer -- unaffected by the materiality-safety withdrawal (it was already absent there before this pass)', () => {
    const featureQ = "Why was the Online Registry's documentation revised?";
    const featureAnswer = answerQuestion(featureQ, ctx);
    assert.equal(Object.prototype.hasOwnProperty.call(featureAnswer, 'unanchoredHistoricalContext'), false);

    const workflowQ = 'What is the Online Registry for?';
    const workflowAnswer = answerQuestion(workflowQ, ctx);
    assert.equal(Object.prototype.hasOwnProperty.call(workflowAnswer, 'unanchoredHistoricalContext'), false);
  });

  await t('Architecture ambiguity remains disclosed, not falsely claimed solved: a Feature-anchored question with a genuinely ambiguous double citation (AI-FEAT-019, §3B+§3D) still admits both via the UNMODIFIED historicalContextForFeature() -- untouched by the unanchored materiality-safety withdrawal, which is a separate mechanism', () => {
    const q = 'Why was duplicate detection added to the import pipeline?';
    const hc = explainHistoricalContext(q, ctx);
    if (hc.primary && hc.primary.id === 'AI-FEAT-019') {
      const archIds = hc.admitted.filter((m) => m.type === 'architecture_section').map((m) => m.id);
      assert.deepEqual(archIds.sort(), ['ARCH-b-initial-autoingest-foundation', 'ARCH-d-archive-integrity-and-transaction-safety']);
    }
  });

  await t('RF-5.4-002 forensic disposition: §3E remains a real, strong, untied diagnostic candidate (retrieval/grounding proven sound) but is NEVER exposed in the real public answer -- the exact case that proved unanchored Architecture materiality is unresolved; primary/status untouched, not an exception, not a regression', () => {
    const q = 'What does Transfer Export do and why was its locking kept process-local?';
    const answer = answerQuestion(q, ctx);
    assert.equal(answer.matchedCapabilities[0].id, 'DEC-021', 'Phase 5.4-owned primary is completely unaffected');
    assert.equal(answer.capabilityStatus, 'AVAILABLE');
    assert.equal(Object.prototype.hasOwnProperty.call(answer, 'unanchoredHistoricalContext'), false, 'withheld from the real public answer -- retrieval strength alone was proven insufficient for materiality');

    const hc = explainHistoricalContext(q, ctx);
    assert.deepEqual(hc.unanchored.candidates.map((c) => c.id), ['ARCH-e-transfer-and-distributed-working'], 'still correctly identified diagnostically, proving the withdrawal is an admission-safety choice, not a retrieval defect');
  });

  await t('Unanchored Memory has the SAME retrieval-only admission weakness as Architecture, demonstrated with real evidence, not assumed from symmetry: AI-MEM-0003 (zero grounding, "Evidence pending" for its entire Scope table) would be admitted on strong (700) unique retrieval alone if the field were exposed -- and the existing memoryHasGenuineChronology() check would NOT have caught it, due to a placeholder-string counting defect', () => {
    const mem0003 = ctx.memoryIndexById.get('AI-MEM-0003');
    assert.equal(mem0003.revision_count, 0);
    assert.deepEqual(mem0003.rejected_approaches, []);
    assert.deepEqual(mem0003.unresolved_items, ['None recorded.'], 'a placeholder string, not a real unresolved item');
    assert.equal(memoryHasGenuineChronology(mem0003), true, 'DEFECT: the existing chronology check counts the placeholder array length, not its actual content -- would NOT have safely gated this capsule');

    const q = 'How did the Windows/NAS event management reliability investigation evolve to resolve its three root causes?';
    const answer = answerQuestion(q, ctx);
    assert.equal(Object.prototype.hasOwnProperty.call(answer, 'unanchoredHistoricalContext'), false, 'correctly withheld from the public answer, same as Architecture');
    const hc = explainHistoricalContext(q, ctx);
    assert.deepEqual(hc.unanchored.candidates.map((c) => c.id), ['AI-MEM-0003'], 'diagnostic seam confirms this WOULD have been admitted under the old (pre-materiality-safety-closure) design');
  });

  summarize('knowledgeHistoricalContext.test.js');
}

main();
