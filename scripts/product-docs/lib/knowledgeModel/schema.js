'use strict';

// ASK AUTOINGEST — CANDIDATE C KNOWLEDGE MODEL SCHEMA (Product Owner
// checkpoint, 2026-08-25). Experimental only. Not wired into production,
// not shipped, does not modify docs/product/generated/knowledge-index.json
// or any production lib/ file.
//
// This is the normalized representation the checkpoint asks for: the
// repository, tests and existing documentation (including
// docs/product/generated/knowledge-index.json, itself already a
// substantially source-grounded capability registry, not raw prose) are
// SOURCE EVIDENCE. A KnowledgeRecord is what those sources establish about
// one FEATURE/CONCEPT, organized by DIMENSION so retrieval can select a
// small, relevant slice instead of one undifferentiated blob. Provenance is
// mandatory per non-obvious claim so every fact can be traced back to a
// file, doc, or test and regenerated.
//
// A field that is genuinely not established by any source must be left
// null/empty, never guessed — see recovery/technicalDetail in particular,
// which the checkpoint singles out (Section 6): "do not automatically
// return UNKNOWN merely because the existing documentation lacks the
// answer" AND "do NOT infer recovery behaviour merely because checkpoints,
// locks, temp files, etc. exist." Both directions of that instruction are
// enforced by requiring a real provenance entry for recovery/technicalDetail
// whenever they are non-null.

/**
 * @typedef {Object} ProvenanceEntry
 * @property {string} claim - short label for what this citation supports
 * @property {string} source - file:line, doc path, or test file/case name
 * @property {'code'|'test'|'doc'|'registry'} type
 * @property {'high'|'medium'|'low'} confidence
 */

/**
 * @typedef {Object} RelationshipEntry
 * @property {'uses'|'writesTo'|'readsFrom'|'relatedTo'|'distinctFrom'|'precedesInWorkflow'} type
 * @property {string} targetId - another KnowledgeRecord id
 * @property {string} note
 */

/**
 * @typedef {Object} KnowledgeRecord
 * @property {string} id - 'KM-<slug>', stable, never reused
 * @property {string|null} featureId - linked AI-FEAT-### capability registry id, if any
 * @property {string} title
 * @property {string[]} aliases - operator terminology/shorthand ("portable drive", "SD card")
 * @property {string} purpose - plain-language "what this is for"
 * @property {string[]} operatorWorkflow - ordered, real steps an operator takes
 * @property {string[]} preconditions - what must be true before the workflow applies
 * @property {{label: string, description: string}[]} actions - real UI/app capabilities
 * @property {string} behavior - internal behavior, insofar as it matters to an operator
 * @property {string|null} recovery - interruption/failure/resume/conflict behavior; null = not established by any source
 * @property {RelationshipEntry[]} relationships
 * @property {string[]} limitations - what it cannot do / is not guaranteed
 * @property {'IMPLEMENTED'|'PLANNED'|'NOT_SUPPORTED'|'UNKNOWN'} status
 * @property {string|null} technicalDetail - implementation detail; only surfaced when the operator's question is explicitly technical
 * @property {ProvenanceEntry[]} provenance
 * @property {'forensic-verified'|'registry-reshaped'} extractionTier - forensic-verified: this checkpoint re-read
 *   the actual current source/tests and confirmed or corrected the registry's claims; registry-reshaped: this
 *   record reorganizes docs/product/generated/knowledge-index.json's existing (already code-grounded) fields into
 *   this schema's dimensions without a fresh source re-read this checkpoint. Both are legitimate source evidence;
 *   the tier is disclosed so the report's provenance strategy section can be honest about which records got a
 *   fresh forensic pass and which were reshaped from the prior registry's own already-grounded content.
 * @property {'primary'|'scoped'} [recordRole] - Follow-up checkpoint (multi-record dimension relevance fix).
 *   Optional, defaults to 'primary' when absent (every record written before this field existed is implicitly
 *   'primary' -- fully backward compatible, zero changes needed to any existing single-record feature). 'primary'
 *   records always participate in retrieval for their featureId, exactly as before. 'scoped' records are a
 *   companion record for a featureId that ALREADY has a 'primary' record -- e.g. a symptom-specific
 *   troubleshooting record alongside a feature's core workflow record -- and participate in a given retrieval
 *   ONLY when `scopedQuestionTypes` (below) says this question shape is relevant to them, or the retrieval's own
 *   recovery gate fired and the scoped record has real recovery content. This is what stops a troubleshooting
 *   record's content from dominating an unrelated HOW_TO/EXPLANATION question about the same feature merely
 *   because it shares a featureId -- see retrieval/conceptualRetrieve.js's filterRecordsByRelevance().
 * @property {string[]} [scopedQuestionTypes] - required when recordRole is 'scoped': the questionClassifier.js
 *   QUESTION_TYPES values (e.g. ['TROUBLESHOOTING', 'CONNECTIVITY']) this record is eligible to contribute to.
 */

const EXTRACTION_TIERS = Object.freeze({
  FORENSIC_VERIFIED: 'forensic-verified',
  REGISTRY_RESHAPED: 'registry-reshaped',
});

const STATUS = Object.freeze({
  IMPLEMENTED: 'IMPLEMENTED',
  PLANNED: 'PLANNED',
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  UNKNOWN: 'UNKNOWN',
});

const RELATIONSHIP_TYPES = Object.freeze([
  'uses', 'writesTo', 'readsFrom', 'relatedTo', 'distinctFrom', 'precedesInWorkflow',
]);

const DIMENSIONS = Object.freeze([
  'purpose', 'operatorWorkflow', 'preconditions', 'actions', 'behavior',
  'recovery', 'relationships', 'limitations', 'status', 'technicalDetail',
]);

const RECORD_ROLES = Object.freeze({
  PRIMARY: 'primary',
  SCOPED: 'scoped',
});

function assertValidRecord(rec) {
  const errors = [];
  if (!rec.id || typeof rec.id !== 'string') errors.push('missing id');
  if (!rec.title) errors.push(`${rec.id}: missing title`);
  if (!STATUS[rec.status]) errors.push(`${rec.id}: invalid status "${rec.status}"`);
  if (!Array.isArray(rec.provenance) || rec.provenance.length === 0) errors.push(`${rec.id}: no provenance`);
  if (rec.recovery && !rec.provenance.some((p) => /recover|resum|interrupt|checkpoint|conflict/i.test(p.claim))) {
    errors.push(`${rec.id}: recovery text present without a recovery-labeled provenance entry`);
  }
  if (rec.technicalDetail && !rec.provenance.some((p) => p.type === 'code' || p.type === 'test')) {
    errors.push(`${rec.id}: technicalDetail present without a code/test provenance entry`);
  }
  if (!EXTRACTION_TIERS[rec.extractionTier === 'forensic-verified' ? 'FORENSIC_VERIFIED' : 'REGISTRY_RESHAPED'] && rec.extractionTier !== 'forensic-verified' && rec.extractionTier !== 'registry-reshaped') {
    errors.push(`${rec.id}: invalid extractionTier "${rec.extractionTier}"`);
  }
  if (rec.recordRole !== undefined && rec.recordRole !== RECORD_ROLES.PRIMARY && rec.recordRole !== RECORD_ROLES.SCOPED) {
    errors.push(`${rec.id}: invalid recordRole "${rec.recordRole}"`);
  }
  if (rec.recordRole === RECORD_ROLES.SCOPED && (!Array.isArray(rec.scopedQuestionTypes) || rec.scopedQuestionTypes.length === 0)) {
    errors.push(`${rec.id}: recordRole 'scoped' requires a non-empty scopedQuestionTypes array`);
  }
  if (rec.scopedQuestionTypes !== undefined && rec.recordRole !== RECORD_ROLES.SCOPED) {
    errors.push(`${rec.id}: scopedQuestionTypes present without recordRole 'scoped'`);
  }
  return errors;
}

module.exports = { EXTRACTION_TIERS, STATUS, RELATIONSHIP_TYPES, DIMENSIONS, RECORD_ROLES, assertValidRecord };
