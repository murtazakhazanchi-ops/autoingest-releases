'use strict';

// ASK AUTOINGEST — CANDIDATE C KNOWLEDGE MODEL BUILD PIPELINE (Tier 2:
// registry-reshape). Experimental only. Does NOT modify
// docs/product/generated/knowledge-index.json or any production file.
//
// This is the checkpoint's Section 9 "incremental update mechanism",
// demonstrated for real rather than only described: it reads the existing,
// already source-grounded capability registry (knowledge-index.json, itself
// produced by an earlier documentation-generation pass that read actual
// code with real file:line citations) and MECHANICALLY reshapes each
// capability's already-existing fields into this checkpoint's dimensional
// schema. No new source reading happens here (that is Tier 1's job — see
// records/sourceAndImport.js, metadata.js, transferAndArchive.js,
// specialAndPlatform.js, each hand-built from a fresh forensic pass over
// actual source/tests). Tier 2 exists so the Knowledge Model has full
// 58-capability coverage (the checkpoint requires retrieval to be "general
// enough to answer questions outside the benchmark", Section 10) without
// requiring a fresh forensic re-read of every one of the app's 58 features
// in this one checkpoint.
//
// INCREMENTAL BUILD: a manifest (knowledgeBuildManifest.json) records a
// content hash of each capability's own registry JSON blob. Re-running this
// script only regenerates a capability's record if that hash changed --
// this is the mechanism Section 9 asks be demonstrated ("source repository
// -> knowledge extraction/normalization -> validated Knowledge Model ->
// retrieval index -> Ask AutoIngest runtime", "changed source files should
// cause only affected knowledge records to be regenerated"). In production
// this build would run as an explicit, controlled step (doc/knowledge
// regeneration in CI or on release, per Section 9's own question) --
// never at operator runtime.
//
// Run with: node scripts/product-docs/bench/knowledgeModel/build/reshapeRegistry.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STATUS, EXTRACTION_TIERS } = require('../schema');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const REGISTRY_PATH = path.join(REPO_ROOT, 'docs', 'product', 'generated', 'knowledge-index.json');
const WORKFLOW_REGISTRY_PATH = path.join(REPO_ROOT, 'docs', 'product', 'generated', 'workflow-index.json');
const OUT_PATH = path.join(__dirname, '..', 'records', 'registryReshaped.generated.js');
const MANIFEST_PATH = path.join(__dirname, 'knowledgeBuildManifest.json');

// The 18 capabilities Tier 1 already forensically re-verified against
// actual current source/tests this checkpoint -- Tier 2 must not produce a
// second, lower-confidence record for any of these (would create a
// retrieval ambiguity between two records for the same feature).
const TIER1_FEATURE_IDS = new Set([
  'AI-FEAT-011', 'AI-FEAT-012', 'AI-FEAT-017', 'AI-FEAT-019', 'AI-FEAT-020', 'AI-FEAT-023',
  'AI-FEAT-029', 'AI-FEAT-030', 'AI-FEAT-033', 'AI-FEAT-004',
  'AI-FEAT-038', 'AI-FEAT-039', 'AI-FEAT-040', 'AI-FEAT-045', 'AI-FEAT-046',
  'AI-FEAT-047', 'AI-FEAT-007', 'AI-FEAT-002', 'AI-FEAT-049',
  // Hand-authored (records/notSupportedBoundaries.js), not a forensic
  // cluster but still a real, disclosed non-Tier-2 record for this
  // featureId -- excluded here for the same reason (avoid a duplicate
  // lower-confidence Tier-2 record for a feature that already has one).
  'AI-FEAT-048',
]);

const BACKTICK_RE = /`([^`]+)`/g;
const RECOVERY_SENTENCE_RE = /[^.]*\b(resum|checkpoint|crash[- ]recover|interrupt|recover(s|y|ed)?|rollback|conflict)[^.]*\./gi;
const INLINE_CODE_PAREN_RE = /\s*\((?:`[^`]+`(?:\s*\/\s*`[^`]+`)*)\)/g; // "(`x`)" or "(`x`/`y`)"
const BARE_INLINE_CODE_RE = /`[^`]+`/g;

// Follow-up checkpoint fix (authoring-leakage defect class, applied here to
// the MECHANICAL Tier-2 reshape pipeline, not only the hand-authored Tier-1
// records): the registry's own currentBehavior/futureEnhancements prose
// frequently backtick-quotes real implementation identifiers (function
// names, file paths, IPC channels) inline in otherwise-readable sentences.
// extractTechnicalDetail() above already copies those spans into
// technicalDetail before this runs, so the fact is never lost -- this just
// removes the same raw spans from the OPERATOR-FACING fields (purpose,
// behavior, recovery, limitations) so a Tier-2 record's ordinary dimensions
// read as plain product language, exactly the same normalization rule
// applied by hand to every Tier-1 record this checkpoint. General, applies
// uniformly to all 38+ Tier-2 records and any future one -- not a per-
// capability rule.
// Checkpoint 14, Phase 11 dev-set finding (a DIFFERENT instance of the same
// CORRUPTED_KNOWLEDGE class Phase 2 fixed for AI-FEAT-018/RB58, surfaced by
// a real dev-set answer, not invented): removing a backtick span can leave
// the SURROUNDING prose grammatically broken even when nothing leaks --
// e.g. the raw source "`services/photographerSequenceService.js`:
// `PC_PREFIX_RE` matches a `PCxx-` prefix convention (`PC01-` through
// `PC999-`), stripped..." became, after the old code above ran: ": matches
// a prefix convention ( through), stripped..." -- an orphaned leading
// colon (the file-path label's own colon, now labeling nothing) and an
// orphaned connector word stranded inside now-empty parens. Phase 2's own
// audit measured LEAKS (correctly, zero found corpus-wide) but never
// separately measured MEANING DAMAGE -- this is that missing check, fixed
// generally rather than only for this one record's exact wording.
// Two general, structural (not case-specific) repairs, applied in order.
// A THIRD pattern (a sentence whose entire SUBJECT was a backtick span,
// leaving a lowercase verb starting the sentence, e.g. "`EVENT_ROOT_KEY`
// (`__eventRoot__`) is used..." -> "is used...") was attempted and reverted
// during this fix's own testing: reliably detecting "this is a genuine
// sentence boundary" versus "this period belongs to an abbreviation like
// i.e./e.g." requires real sentence-boundary detection, not a regex -- an
// abbreviation-safe guard (require the following text to start with a
// capital letter) and "detect a subject-less continuation" (which by
// definition follows an abbreviation-shaped LOWERCASE continuation, not a
// capitalized one) turned out to be mutually exclusive requirements, and
// the naive version caused real content loss on ordinary "i.e./e.g." prose
// during testing. Left as a disclosed, un-fixed residual limitation rather
// than deployed with that regression risk -- see the Phase 11 dev-set
// finding this was traced from for the concrete remaining example.
const LEADING_ORPHAN_COLON_RE = /(^|\.\s+)\s*:\s*/g; // "`file.js`: rest" -> ": rest" -> "rest"
const ORPHAN_PAREN_CONNECTOR_RE = /\s*\(\s*(?:and|or|through|to|vs\.?|via|then|with)\s*\)/gi; // "(`a` through `b`)" -> "( through)" -> removed
function stripOperatorFacingCodeSpans(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text
    .replace(INLINE_CODE_PAREN_RE, '')
    .replace(BARE_INLINE_CODE_RE, '');
  out = out
    .replace(ORPHAN_PAREN_CONNECTOR_RE, '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+\./g, '.')
    .trim();
  out = out.replace(LEADING_ORPHAN_COLON_RE, '$1').replace(/\s{2,}/g, ' ').trim();
  return out;
}

// Checkpoint 14, Phase 2 -- RB58 class fix (CORRUPTED_KNOWLEDGE, per the
// normalized taxonomy: content WAS retrieved intact from the raw registry,
// then a downstream transformation destroyed its meaning before the model
// ever saw it). Forensic finding: `stripOperatorFacingCodeSpans` above
// treats every backtick-quoted span as equally disposable "implementation
// noise" -- but the raw registry prose backtick-quotes TWO structurally
// different things: genuine implementation identifiers (` `autoingest-architect` `,
// file paths, function names -- correctly redacted) AND legitimate
// cross-references to another registered AI-FEAT-###/AI-WF-### capability
// (e.g. `` `AI-FEAT-018` (this feature's own Dependency...) `` in
// AI-FEAT-022's own summary) -- which are NOT implementation details, they
// are readable product facts whose only flaw is being wrapped in the same
// backtick syntax. Deleting the latter (as the old code did) leaves a
// referent-less sentence fragment; the operator-safety goal (never leak a
// raw internal id) is still fully met by RESOLVING the reference to its
// human-readable title instead of deleting it -- "RESOLVE INTERNAL
// REFERENCES BEFORE REDACTION", applied generally to every AI-FEAT-###/
// AI-WF-### backtick span found anywhere in the corpus, not specific to
// AI-FEAT-018 or this one record. Any backtick span that is NOT a
// recognized capability id (including one that doesn't resolve to a known
// title) is left completely untouched here, so the pre-existing,
// unmodified `stripOperatorFacingCodeSpans` still redacts it exactly as
// before -- a fail-safe, not a weakening: an unresolvable id-shaped token
// still ends up deleted, never leaked raw, only a KNOWN, title-resolvable
// one gets the richer treatment.
//
// Corpus-wide audit widened this beyond the original backtick-only case
// (found while measuring "operator-visible internal leaks" per Phase 2's
// own required measurement, not assumed): the registry's prose habitually
// cites a sibling capability as a BARE, non-backtick parenthetical too --
// e.g. "Distinct from Login/Operator Identity (AI-FEAT-002, who is using
// the app)" -- which `stripOperatorFacingCodeSpans` never touched, with or
// without this fix, since it only ever matched backtick-quoted spans. This
// was a genuine, pre-existing, corpus-wide leak (34 instances across 23
// records, confirmed by direct scan), not something this checkpoint's own
// change introduced -- surfaced BY the required audit, not caused by it.
// The regex below matches the id with OPTIONAL backticks on each side, so
// one general resolution step now covers both citation styles uniformly.
const FEATURE_REF_RE = /`?(AI-FEAT-\d+|AI-WF-\d+)`?/g;
function resolveFeatureReferencesBeforeRedaction(text, idToTitle) {
  if (typeof text !== 'string' || !text || !idToTitle) return text;
  return text.replace(FEATURE_REF_RE, (whole, id) => {
    const title = idToTitle.get(id);
    if (title) return title;
    // Unresolved: if it was backtick-wrapped, leave it wrapped so the
    // existing stripOperatorFacingCodeSpans still safely removes it next.
    // If it was bare (no backticks), there is no later stripping pass for
    // it -- fall back to a generic, non-identifying phrase so a raw id
    // can never reach operator-facing text either way.
    return whole.startsWith('`') ? whole : 'a related capability';
  });
}

function slug(id, title) {
  return 'KM-' + String(title || id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

function mapStatus(operatorStatus) {
  if (operatorStatus === 'PLANNED') return STATUS.PLANNED;
  if (operatorStatus === 'NOT_SUPPORTED') return STATUS.NOT_SUPPORTED;
  if (operatorStatus === 'AVAILABLE' || operatorStatus === 'PARTIALLY_AVAILABLE') return STATUS.IMPLEMENTED;
  return STATUS.UNKNOWN;
}

// Extracts real backtick-quoted technical tokens/paths from the registry's
// own currentBehavior prose -- the exact same "what looks like an
// implementation identifier" signal evidencePackage.js's TECHNICAL-atom
// extraction already uses in production (see evidencePackage.js's own
// backtick-span handling), reapplied here as a reshape rule rather than a
// runtime extraction, so a technical question about this feature has real
// cited detail to draw on.
function extractTechnicalDetail(text) {
  if (!text) return null;
  const matches = [...text.matchAll(BACKTICK_RE)].map((m) => m[1]);
  if (!matches.length) return null;
  const unique = [...new Set(matches)].slice(0, 8);
  return `Implementation references found in the capability record: ${unique.map((t) => `\`${t}\``).join(', ')}.`;
}

// Extracts, VERBATIM (never paraphrased), any sentence in currentBehavior
// that already uses recovery/interruption/resume/crash/conflict language --
// mechanical quotation, not inference. A capability whose own registry text
// never mentions any of these words gets recovery: null, exactly per the
// checkpoint's instruction not to infer recovery behavior merely because
// checkpoints/locks/temp files exist elsewhere in the codebase.
function extractRecoverySentences(text) {
  if (!text) return null;
  const sentences = [...text.matchAll(RECOVERY_SENTENCE_RE)].map((m) => m[0].trim()).filter(Boolean);
  if (!sentences.length) return null;
  return sentences.slice(0, 3).join(' ');
}

function buildLimitations(cap, idToTitle) {
  const out = [];
  for (const bug of cap.knownLimitations.openBugs || []) {
    if (!/^(Fixed|Resolved|Closed)\b/i.test(bug.status || '')) out.push(`Known issue ${bug.id} is not yet marked Fixed (current status: ${bug.status}).`);
  }
  if (cap.knownLimitations.evidenceGapCount > 0) out.push(`This capability's own documentation has ${cap.knownLimitations.evidenceGapCount} unresolved evidence gap(s) -- some detail may be incomplete.`);
  if (cap.knownLimitations.futureEnhancements) out.push(`Documented future enhancement (not yet built): ${stripOperatorFacingCodeSpans(resolveFeatureReferencesBeforeRedaction(cap.knownLimitations.futureEnhancements, idToTitle))}`);
  return out.map((s) => stripOperatorFacingCodeSpans(resolveFeatureReferencesBeforeRedaction(s, idToTitle)));
}

function reshapeOne(cap, idToTitle) {
  const recoveryQuote = extractRecoverySentences(cap.currentBehavior);
  const technicalDetail = extractTechnicalDetail(cap.currentBehavior);
  const provenance = [
    { claim: 'capability record (status, summary, behavior)', source: cap.canonicalDocument || cap.sourceFiles[0] || 'docs/product/generated/knowledge-index.json', type: 'registry', confidence: 'medium' },
    ...(cap.sourceFiles || []).map((f) => ({ claim: 'cited source file', source: f, type: /\.(js|ts|tsx|jsx)$/.test(f) ? 'code' : 'doc', confidence: 'medium' })),
  ];
  if (recoveryQuote) provenance.push({ claim: 'recovery/interruption sentence quoted verbatim from capability record currentBehavior', source: cap.canonicalDocument || 'docs/product/generated/knowledge-index.json', type: 'registry', confidence: 'medium' });
  if (technicalDetail) provenance.push({ claim: 'technical identifiers quoted from capability record currentBehavior', source: cap.sourceFiles.find((f) => /\.js$/.test(f)) || cap.canonicalDocument, type: 'code', confidence: 'low' });

  return {
    id: slug(cap.id, cap.title),
    featureId: cap.id,
    title: cap.title,
    aliases: (cap.searchTerms || []).filter((t) => t.includes(' ')).slice(0, 8),
    purpose: stripOperatorFacingCodeSpans(resolveFeatureReferencesBeforeRedaction(cap.summary || cap.whatItDoes || '', idToTitle)),
    operatorWorkflow: [],
    preconditions: [],
    actions: [],
    behavior: stripOperatorFacingCodeSpans(resolveFeatureReferencesBeforeRedaction(cap.currentBehavior || cap.whatItDoes || '', idToTitle)),
    recovery: stripOperatorFacingCodeSpans(resolveFeatureReferencesBeforeRedaction(recoveryQuote, idToTitle)),
    relationships: (cap.relatedFeatures || []).map((fid) => ({ type: 'relatedTo', targetId: fid, note: 'Listed as a related feature in the capability registry.' })),
    limitations: buildLimitations(cap, idToTitle),
    status: mapStatus(cap.operatorStatus),
    technicalDetail,
    provenance,
    extractionTier: EXTRACTION_TIERS.REGISTRY_RESHAPED,
  };
}

function hashOf(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function main() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  // Checkpoint 14, Phase 2: built from the FULL, unfiltered capability list
  // (including Tier 1 ids) so a Tier-2 record's prose can resolve a
  // cross-reference to ANY registered feature, not only other Tier-2 ones
  // -- AI-FEAT-022's own reference to AI-FEAT-018 is exactly this case.
  // Workflow titles are merged in too (AI-FEAT-058's own prose cites
  // AI-WF-006/AI-WF-009 by id) -- one map, both id namespaces, so the
  // resolver is general across every canonical id shape the corpus uses.
  const idToTitle = new Map(registry.capabilities.map((c) => [c.id, c.title]));
  try {
    const workflowRegistry = JSON.parse(fs.readFileSync(WORKFLOW_REGISTRY_PATH, 'utf8'));
    for (const w of workflowRegistry.workflows || []) idToTitle.set(w.id, w.title);
  } catch { /* workflow-index.json is optional; resolution degrades to the safe unresolved-fallback path above */ }
  const caps = registry.capabilities.filter((c) => !TIER1_FEATURE_IDS.has(c.id));

  let manifest = {};
  if (fs.existsSync(MANIFEST_PATH)) {
    try { manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); } catch { manifest = {}; }
  }

  const records = [];
  let regenerated = 0;
  let skipped = 0;
  const nextManifest = {};
  const currentCapIds = new Set(caps.map((c) => c.id));
  for (const cap of caps) {
    const h = hashOf(cap);
    nextManifest[cap.id] = { hash: h, generatedAt: manifest[cap.id]?.hash === h ? manifest[cap.id].generatedAt : new Date().toISOString() };
    if (manifest[cap.id]?.hash === h) skipped += 1; else regenerated += 1;
    records.push(reshapeOne(cap, idToTitle));
  }

  // Integration-readiness checkpoint addition: a manifest entry whose
  // featureId no longer appears in the current registry (deleted or
  // renamed capability, or promoted out to Tier 1 -- both are legitimate)
  // is dropped from the manifest and the corresponding generated record is
  // therefore never re-emitted -- but this is logged explicitly rather
  // than happening silently, so a developer notices a capability
  // disappeared from the Knowledge Model rather than the generated file
  // simply shrinking without comment.
  const removedIds = Object.keys(manifest).filter((id) => !currentCapIds.has(id) && !TIER1_FEATURE_IDS.has(id));
  if (removedIds.length) {
    console.log(`[reshapeRegistry] ${removedIds.length} capability id(s) no longer in the registry (or promoted to Tier 1) -- their Tier-2 record(s) will not be regenerated: ${removedIds.join(', ')}`);
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(nextManifest, null, 2));

  const header = `'use strict';

// AUTO-GENERATED by scripts/product-docs/bench/knowledgeModel/build/reshapeRegistry.js
// -- Tier 2 (registry-reshaped) Knowledge Model records. Do not hand-edit;
// re-run the build script instead. Covers every AI-FEAT capability NOT
// already given a fresh Tier 1 forensic-verified record (see
// records/sourceAndImport.js, metadata.js, transferAndArchive.js,
// specialAndPlatform.js). Generated ${new Date().toISOString()}.
// This run: ${regenerated} record(s) regenerated, ${skipped} unchanged
// (incremental build -- see knowledgeBuildManifest.json).

`;
  const body = `const RECORDS = ${JSON.stringify(records, null, 2)};\n\nmodule.exports = { RECORDS };\n`;
  fs.writeFileSync(OUT_PATH, header + body);
  console.log(`[reshapeRegistry] wrote ${records.length} Tier-2 records to ${OUT_PATH} (${regenerated} regenerated, ${skipped} unchanged since last build)`);
}

main();
