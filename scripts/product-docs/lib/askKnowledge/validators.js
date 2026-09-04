'use strict';
// Ask AutoIngest — Stage 2 deterministic knowledge/tool foundation,
// Section 21. Deterministic validators scoped to the Knowledge Base/tool
// layer only -- NOT the full conversational answer validator (that belongs
// with a later Qwen-orchestrator stage, per the brief's own explicit
// boundary). Every function here is pure and synchronous; none requires a
// model, network, or GPU.

const { findAllByFeatureId, KNOWLEDGE_MODEL } = require('../knowledgeModel/index');
const { assertValidRecord, RELATIONSHIP_TYPES } = require('../knowledgeModel/schema');
const { containsUnresolvedInternalReference } = require('./leakBoundary');
const { DIRECTIONAL_TYPES, SYMMETRIC_TYPES } = require('./relationships');

// A handle is "valid" only relative to a specific session -- this checks
// the STRUCTURAL shape (H<n>) a well-formed handle must have, independent
// of whether any particular HandleSession actually issued it (that check
// is handleSession.resolve() itself, exercised by the integration tests).
const HANDLE_SHAPE_RE = /^H\d+$/;
function isWellFormedHandleShape(handle) {
  return typeof handle === 'string' && HANDLE_SHAPE_RE.test(handle);
}

// True when `handle` collides with a real internal id shape -- this should
// be structurally impossible (HandleSession.issue() only ever produces
// "H<n>"), but is checked directly rather than assumed, since a false
// collision would be exactly the leak Section 13 exists to prevent.
const INTERNAL_ID_SHAPE_RE = /^(?:KM|AI-FEAT|AI-WF|AI-MEM|AI-DEC|AI-BUG|AI-RM|DEC|BUG|PM)-/;
function handleCollidesWithInternalIdShape(handle) {
  return typeof handle === 'string' && INTERNAL_ID_SHAPE_RE.test(handle);
}

// A relation TYPE is "valid" when it is one of schema.js's own
// RELATIONSHIP_TYPES -- an edge with any other type is malformed data, not
// a new, silently-accepted relationship kind.
function isValidRelationType(type) {
  return RELATIONSHIP_TYPES.includes(type);
}

// A relation type must be classified into exactly one of DIRECTIONAL,
// SYMMETRIC, or the safe GENERIC/UNKNOWN default -- never left ambiguous
// or double-classified. Used by the corpus audit to confirm every type in
// RELATIONSHIP_TYPES has an unambiguous classification.
function classifyRelationType(type) {
  if (DIRECTIONAL_TYPES.has(type)) return 'DIRECTIONAL';
  if (SYMMETRIC_TYPES.has(type)) return 'SYMMETRIC';
  return 'GENERIC_UNKNOWN';
}

// A "known record" is one that resolves to at least one real Knowledge
// Model record via findAllByFeatureId. Note EMPTY (zero KM records) is a
// legitimate, real state for a valid Feature/Workflow id -- this validator
// only confirms the id itself is a real, recognized AI-FEAT-###/AI-WF-###
// shape, not that detailed knowledge exists for it (see knowledgeState.js
// / read.js for that distinction).
const RECORD_ID_SHAPE_RE = /^AI-(FEAT|WF)-\d+$/;
function isRecognizedRecordIdShape(id) {
  return typeof id === 'string' && RECORD_ID_SHAPE_RE.test(id);
}

// Recursively scans a plain JSON-like value (the shape every tool
// operation in this module tree returns) for a leaked internal reference
// or an unresolved backtick span. Returns the list of offending string
// values found (empty = clean). Used by the corpus audit and by
// integration tests asserting a full tool-response object never leaks.
function scanForLeaks(value, path = '$', found = []) {
  if (typeof value === 'string') {
    if (containsUnresolvedInternalReference(value)) found.push({ path, value });
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanForLeaks(v, `${path}[${i}]`, found));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) scanForLeaks(v, `${path}.${k}`, found);
    return found;
  }
  return found;
}

// Validates a single Knowledge Model record against schema.js's own
// assertValidRecord -- reused directly, not reimplemented (schema.js is
// this project's own single source of truth for record validity).
function validateKnowledgeRecord(record) {
  return assertValidRecord(record);
}

// Validates the WHOLE loaded corpus in one pass -- every record must be
// individually schema-valid (already enforced at require-time by
// knowledgeModel/index.js, re-run here explicitly so a corpus-audit
// consumer gets the full error list rather than a thrown exception on the
// first bad record).
function validateFullCorpus() {
  return KNOWLEDGE_MODEL.flatMap((r) => validateKnowledgeRecord(r).map((e) => ({ recordId: r.id, error: e })));
}

// "Impossible state combination" checks -- structural invariants a
// well-formed tool-operation RESULT object must never violate, regardless
// of which code path produced it. Each check names the specific
// combination it forbids; none requires re-deriving the underlying
// knowledge, only inspecting the shape of an already-produced result.
function checkImpossibleStates(result) {
  const violations = [];
  if (result && typeof result === 'object') {
    // read_autoingest: EMPTY knowledgeState must never carry non-empty
    // dimension content (Section 17 -- EMPTY means no record, full stop).
    if (result.knowledgeState === 'EMPTY' && result.dimensions && Object.keys(result.dimensions).length > 0) {
      violations.push('knowledgeState EMPTY but dimensions object is non-empty');
    }
    // Any *_status tool result: 'error' and a real status/edges payload
    // must never coexist -- a protocol error is a DISTINCT shape from a
    // real answer, never a real answer with an error flag bolted on.
    if (result.error && (result.status !== undefined || result.edges !== undefined || result.dimensions !== undefined)) {
      violations.push('error field coexists with a real result payload (status/edges/dimensions) -- protocol errors must be a distinct shape');
    }
    // check_relationship: CONTRADICTED/CONFLICT must carry at least one
    // edge as evidence -- an authority state with no supporting edge is
    // internally inconsistent.
    if ((result.status === 'CONTRADICTED' || result.status === 'CONFLICT' || result.status === 'SUPPORTED') && Array.isArray(result.edges) && result.edges.length === 0 && result.status !== 'SUPPORTED') {
      violations.push(`status ${result.status} with zero supporting edges`);
    }
  }
  return violations;
}

module.exports = {
  isWellFormedHandleShape, handleCollidesWithInternalIdShape,
  isValidRelationType, classifyRelationType, isRecognizedRecordIdShape,
  scanForLeaks, validateKnowledgeRecord, validateFullCorpus, checkImpossibleStates,
};
