'use strict';

// ASK AUTOINGEST — CANDIDATE C CONCEPTUAL RETRIEVAL. Experimental only.
//
// Deliberately reuses the existing, already-validated C8 deterministic
// authority/retrieval/clarification layer UNCHANGED (answerQuestionWithAuthority,
// assessPrimaryFit, decideClarification -- see candidateC/orchestrator.js) --
// this module never re-decides WHICH feature/boundary/roadmap answer is
// correct, never re-decides capabilityStatus, never re-decides whether to
// ask a clarifying question. Its only job is the one the checkpoint asks to
// test: once the C8 authority layer has already resolved an `answer`, select
// a SMALL, RELEVANT slice of the Knowledge Model's own dimensions --
// concept/workflow/troubleshooting/recovery/limitation/relationship/
// technical -- instead of the production path's undifferentiated FACT/
// ACTION/LIMITATION atom blob (evidencePackage.js), and gate technical
// detail to explicitly-technical questions only (Section 5/7 of the
// checkpoint).
//
// Section 6 discipline, enforced directly here: when the operator's
// question is asking about a dimension (e.g. recovery) that the matched
// Knowledge Model record(s) leave null because no source established it,
// this module says so EXPLICITLY in the evidence block ("No AutoIngest
// evidence establishes ...") rather than silently omitting the section --
// so the model is grounded to answer honestly instead of inventing, and
// never silently gets weaker evidence than a NOT_ESTABLISHED fact deserves.
//
// One featureId can resolve to MORE THAN ONE Knowledge Model record --
// different records covering different facets of the same feature (e.g.
// QMZ's core record plus a dedicated troubleshooting record for a specific
// symptom; Login's core workflow record plus the separately-authored
// NOT_SUPPORTED multi-user-roles boundary record). This module merges the
// selected dimensions across every record sharing the resolved featureId,
// rather than arbitrarily picking one and discarding the rest.

const { KNOWLEDGE_MODEL, findAllByFeatureId, findByBoundaryId } = require('./index');

// A question is asking a genuinely TECHNICAL question -- distinct from the
// question-TYPE classifier (HOW_TO/TROUBLESHOOTING/etc, which is about
// intent shape, not about whether implementation detail was actually
// requested) -- mirrors evidenceSerializer.js's own `includeTechnical` gate
// intent for the production path, reimplemented here as an explicit,
// disclosed heuristic rather than reused code (the production gate lives
// inside evidencePackage.js's atom selection, tightly coupled to atom
// roles, not exposed as a standalone predicate).
const TECHNICAL_QUESTION_RE = /\bwhere does\b.*\bstore\b|\bwhat file\b|\bfile format\b|\bwhich file\b|\bunder the hood\b|\bimplementation\b|\bhow is\b.*\bstored\b|\bsequencing state\b|\bstorage (location|mechanism)\b|\bwhat table\b|\bdatabase\b/i;

// Same idea as the technical gate, applied to RECOVERY: a follow-up like
// "Can I resume it afterward?" classifies CAPABILITY by questionClassifier.js
// (its own `^\s*(can i|can we)\b` rule, designed for capability-existence
// questions in general, not specifically resume questions), whose default
// dimension set (purpose/limitations) would miss the one dimension that
// actually answers it. This is a general, keyword-driven addition (not a
// per-benchmark-case rule) -- any question about resuming/continuing/
// restarting an interrupted operation pulls in the recovery dimension
// regardless of its questionClassifier TYPE.
const RECOVERY_QUESTION_RE = /\bresum(e|ing|able)\b|\bstart over\b|\bpick up where\b|\bcontinue where\b|\bkeep going\b|\bafter (it|that) (stops|stopped|fails|failed|disconnects|disconnected)\b/i;

// Ordered dimension sets per question TYPE (questionClassifier.js's
// QUESTION_TYPES) -- a small, relevant slice per Section 7's own examples
// ("What is Transfer Export?" vs "My transfer stopped halfway." vs "Can I
// resume it?" vs "Where does Transfer Export store its state?" each need a
// DIFFERENT dimension, not the whole record).
const DIMENSIONS_BY_TYPE = {
  EXPLANATION: ['purpose', 'behavior', 'relationships'],
  HOW_TO: ['operatorWorkflow', 'preconditions', 'actions', 'limitations'],
  TROUBLESHOOTING: ['recovery', 'behavior', 'limitations'],
  CONNECTIVITY: ['recovery', 'limitations'],
  NAVIGATION: ['operatorWorkflow', 'actions', 'behavior'],
  STATUS: ['purpose', 'limitations'],
  CAPABILITY: ['purpose', 'limitations'],
  ROADMAP: ['behavior', 'limitations'],
  COMPARISON: ['relationships', 'purpose'],
  TEAM_ACTIVITY: ['behavior', 'limitations'],
  UNKNOWN: ['purpose', 'behavior'],
};

function isTechnicalQuestion(userText) {
  return TECHNICAL_QUESTION_RE.test(String(userText || ''));
}

function isRecoveryQuestion(userText) {
  return RECOVERY_QUESTION_RE.test(String(userText || ''));
}

// Resolves which Knowledge Model record(s) (if any) correspond to the C8
// authority layer's already-decided `answer`. Returns an empty array when
// the resolved feature/boundary has no Knowledge Model coverage -- the
// caller (candidateC/evidence.js) falls back to the production evidence
// path in that case, a deliberate, disclosed degrade rather than a gap
// that silently produces no evidence at all.
function resolveKnowledgeRecords(answer) {
  if (!answer) return [];
  if (answer.classification === 'ROADMAP') {
    const rm = KNOWLEDGE_MODEL.find((r) => r.id === 'KM-roadmap-status');
    return rm ? [rm] : [];
  }
  if (answer.matchQuality === 'boundary') {
    const boundaryId = answer.sources && answer.sources[0] && answer.sources[0].id;
    const rec = findByBoundaryId(boundaryId);
    return rec ? [rec] : [];
  }
  // Primary: the C8 authority layer's own top-ranked match (unchanged
  // ranking, never re-decided here). Forensic finding this checkpoint:
  // for some queries (e.g. "Can I resume the export or do I have to start
  // over?") the deterministic ranker's #1 match is a BUG/DECISION record
  // (real evidence about the feature, but not itself an operator-facing
  // Knowledge Model subject), while the actual Feature record still
  // appears in `answer.sources` as a related citation. Rather than only
  // ever looking at matchedCapabilities[0] and silently falling back to
  // Candidate B's evidence path whenever that top slot happens to be a
  // bug/decision/postmortem, this checks every matchedCapabilities entry
  // in the SAME already-decided rank order first, then falls back to
  // scanning `sources` for an AI-FEAT-* id the Knowledge Model covers --
  // still zero re-ranking, only widening which of the authority layer's
  // OWN already-surfaced ids are allowed to resolve to a Knowledge Model
  // record.
  const candidates = [...(answer.matchedCapabilities || []), ...(answer.sources || [])];
  for (const c of candidates) {
    if (!c || !c.id) continue;
    const recs = findAllByFeatureId(c.id);
    if (recs.length) return recs;
  }
  return []; // disclosed coverage gap (AI-WF-* Workflow matches, or a feature genuinely outside this checkpoint's coverage) -- caller falls back to Candidate B's own evidence path
}

// Follow-up checkpoint fix (multi-record dimension relevance). Forensic
// finding: when a featureId resolves to more than one record (e.g. QMZ's
// core workflow record plus a dedicated troubleshooting record for one
// symptom), the ORIGINAL Candidate C blanket-merged every matching
// record's dimensions into every retrieval for that featureId -- so a
// plain "how do I sort QMZ photos" question (which, via a topic-change
// path, classified as questionClassifier.js's QUESTION_TYPES.UNKNOWN
// rather than HOW_TO because the message started with "Actually,")
// pulled in the troubleshooting record's grid-sort-vs-sequence-number
// framing alongside the real workflow record's own content, and the
// troubleshooting framing dominated the answer.
//
// General rule, not QMZ-specific: a record with recordRole 'primary' (the
// default -- every record written before this field existed, and any
// future feature's own core record) always participates, exactly as
// before. A record with recordRole 'scoped' participates ONLY when this
// specific retrieval's questionType is one of that record's own declared
// scopedQuestionTypes, OR the recovery gate fired for this turn and the
// scoped record actually has recovery content to contribute -- a
// recovery/interruption question should still be able to reach a
// symptom-specific record even if its author only tagged it for
// TROUBLESHOOTING, since Section 8/12's own recovery-gate heuristic
// already broadens the dimension set the same way for primary records.
// This makes participation depend on question intent/relevance per
// RECORD, not on shared featureId membership alone, and it generalizes to
// any future feature that grows more than one KnowledgeRecord: a
// troubleshooting-flavored companion record for a DIFFERENT feature would
// get the identical treatment with zero code changes here, only its own
// `recordRole`/`scopedQuestionTypes` declaration.
// Integration-readiness checkpoint addition: the technical gate gets the
// exact same symmetric treatment the recovery gate already had -- a scoped
// record with real `technicalDetail` can participate purely because the
// operator's question is explicitly technical, even without a matching
// declared scopedQuestionTypes entry, mirroring how a recovery/interruption
// question already reaches a scoped record regardless of its declared
// types. Same general mechanism, not a new one; reviewed and approved as
// "genuinely the same generalized mechanism" before promotion (integration
// readiness report, Section 11).
function filterRecordsByRelevance(records, questionType, includeRecovery, includeTechnical) {
  return records.filter((r) => {
    if (r.recordRole !== 'scoped') return true; // primary (default) -- always eligible
    if (Array.isArray(r.scopedQuestionTypes) && r.scopedQuestionTypes.includes(questionType)) return true;
    if (includeRecovery && r.recovery) return true;
    if (includeTechnical && r.technicalDetail) return true;
    return false;
  });
}

function formatList(items) {
  return items.filter(Boolean).map((s) => `- ${s}`).join('\n');
}

function formatRelationships(relationships) {
  return relationships.map((r) => `- ${r.type} ${r.targetId}: ${r.note}`).join('\n');
}

function dedupJoin(strings, sep) {
  return [...new Set(strings.filter(Boolean))].join(sep);
}

// Builds the compact, dimension-selected evidence block for ONE turn,
// merging the selected dimensions across every record sharing the resolved
// featureId. Never dumps a full KnowledgeRecord -- only the dimensions
// `dimensionKeys` selects, plus technicalDetail only when `includeTechnical`
// is true.
function buildEvidenceBlock(records, dimensionKeys, { includeTechnical, capabilityStatus } = {}) {
  const sections = [`STATUS\n${capabilityStatus === 'ROADMAP' ? '(no fixed status -- this is a roadmap/dashboard question)' : capabilityStatus}`];
  const keys = includeTechnical ? [...new Set([...dimensionKeys, 'technicalDetail'])] : dimensionKeys;

  for (const key of keys) {
    if (key === 'purpose') {
      const text = dedupJoin(records.map((r) => r.purpose), '\n');
      if (text) sections.push(`WHAT IT'S FOR\n${text}`);
    }
    if (key === 'operatorWorkflow') {
      const items = records.flatMap((r) => r.operatorWorkflow);
      if (items.length) sections.push(`HOW OPERATORS DO THIS\n${formatList(items)}`);
    }
    if (key === 'preconditions') {
      const items = records.flatMap((r) => r.preconditions);
      if (items.length) sections.push(`BEFORE YOU START\n${formatList(items)}`);
    }
    if (key === 'actions') {
      const items = records.flatMap((r) => r.actions.map((a) => `${a.label}: ${a.description}`));
      if (items.length) sections.push(`AVAILABLE ACTIONS\n${formatList(items)}`);
    }
    if (key === 'behavior') {
      const text = dedupJoin(records.map((r) => r.behavior), '\n');
      if (text) sections.push(`HOW IT BEHAVES\n${text}`);
    }
    if (key === 'recovery') {
      const text = dedupJoin(records.map((r) => r.recovery), '\n');
      sections.push(`IF INTERRUPTED / RECOVERY\n${text || 'No AutoIngest evidence establishes resume/recovery behavior for this specific feature. Do not guess -- say plainly that this is not established rather than inventing a resume procedure.'}`);
    }
    if (key === 'relationships') {
      const items = records.flatMap((r) => r.relationships);
      if (items.length) sections.push(`HOW THIS RELATES TO OTHER FEATURES\n${formatRelationships(items)}`);
    }
    if (key === 'limitations') {
      const items = records.flatMap((r) => r.limitations);
      if (items.length) sections.push(`LIMITATIONS\n${formatList(items)}`);
    }
    if (key === 'technicalDetail') {
      const text = dedupJoin(records.map((r) => r.technicalDetail), '\n');
      sections.push(`TECHNICAL DETAIL (only because the operator explicitly asked a technical question)\n${text || 'No specific technical implementation detail is established in AutoIngest\'s evidence for this.'}`);
    }
  }
  return sections.join('\n\n');
}

// Main entry point. `questionType` is questionClassifier.js's own
// classifyQuestion() output (unchanged, reused). `userText` is the
// operator's actual current-turn words (used only for the technical/
// recovery gate heuristics above, never for retrieval matching -- matching
// is entirely the C8 authority layer's job, already done before this is
// called).
function conceptualRetrieve({ answer, questionType, userText }) {
  const allRecords = resolveKnowledgeRecords(answer);
  if (!allRecords.length) return null;

  const includeTechnical = isTechnicalQuestion(userText);
  const includeRecovery = isRecoveryQuestion(userText);
  // Multi-record relevance filter (follow-up checkpoint fix) -- applied
  // BEFORE dimension selection, so a 'scoped' companion record (e.g. a
  // troubleshooting record) that isn't relevant to this question's own
  // type/intent never gets the chance to contribute any dimension at all,
  // not even by accident through a shared featureId.
  const records = filterRecordsByRelevance(allRecords, questionType, includeRecovery, includeTechnical);
  if (!records.length) return null; // every matching record was scoped-out for this question shape -- caller falls back, same as "no coverage"

  let dimensionKeys = DIMENSIONS_BY_TYPE[questionType] || DIMENSIONS_BY_TYPE.UNKNOWN;
  if (includeRecovery) dimensionKeys = [...new Set([...dimensionKeys, 'recovery'])];
  const evidenceBlock = buildEvidenceBlock(records, dimensionKeys, { includeTechnical, capabilityStatus: answer.capabilityStatus });

  return {
    kmRecordId: records.map((r) => r.id).join('+'),
    extractionTier: records.every((r) => r.extractionTier === 'forensic-verified') ? 'forensic-verified' : (records.some((r) => r.extractionTier === 'forensic-verified') ? 'mixed' : 'registry-reshaped'),
    dimensionsUsed: includeTechnical ? [...dimensionKeys, 'technicalDetail'] : dimensionKeys,
    technicalGateOpen: includeTechnical,
    recoveryGateOpen: includeRecovery,
    recordsConsideredButExcluded: allRecords.length - records.length,
    evidenceBlock,
  };
}

module.exports = { conceptualRetrieve, resolveKnowledgeRecords, filterRecordsByRelevance, isTechnicalQuestion, isRecoveryQuestion, DIMENSIONS_BY_TYPE };
