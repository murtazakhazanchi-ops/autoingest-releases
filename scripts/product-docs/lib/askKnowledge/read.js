'use strict';
// Ask AutoIngest — Stage 2 deterministic knowledge/tool foundation,
// Section 16 (read_autoingest) + Section 17 (knowledgeState). Productionized
// from Checkpoint 14's `readAutoIngest` (which corrected C9-C12's partial
// leak-boundary coverage into a uniform one -- see leakBoundary.js's own
// header).
//
// `dimensions` is an explicit, enumerable array the caller supplies
// directly (VALID_DIMENSIONS below) -- never inferred from a conversational
// question type or free-text intent. This is deliberate: Section 16
// explicitly forbids read_autoingest becoming "a second natural-language
// reasoning engine". Candidate C's own lib/knowledgeModel/retrieval.js
// (DIMENSIONS_BY_TYPE, isTechnicalQuestion/isRecoveryQuestion regex gates)
// does exactly that conversational inference and is deliberately NOT
// reused here -- see the Section 3 audit's OBSOLETE classification for it.

const { findAllByFeatureId } = require('../knowledgeModel/index');
const { resolveThenSanitize, titleForFeatureId } = require('./leakBoundary');
const { decisionFactsFor } = require('./decisionFacts');
const { describeEdge } = require('./relationships');

const VALID_DIMENSIONS = Object.freeze([
  'purpose', 'behavior', 'operatorWorkflow', 'preconditions',
  'actions', 'recovery', 'limitations', 'relationships', 'technicalDetail',
]);

// readAutoIngest(handle, dimensions, ctx, handleSession)
function readAutoIngest(handle, dimensions, ctx, handleSession) {
  const realId = handleSession.resolve(handle);
  if (!realId) {
    return {
      error: 'invalid_handle',
      note: `"${handle}" was not issued by a previous search in this session. This is a protocol error, not evidence AutoIngest lacks this feature -- search again to get a valid handle.`,
    };
  }
  const records = findAllByFeatureId(realId);
  if (!records.length) {
    return {
      knowledgeState: 'EMPTY',
      dimensions: {},
      note: 'THIS SUBJECT HAS NO DETAILED KNOWLEDGE BASE RECORD. Nothing below is established fact -- do not describe how this works, where it stores anything, or what it does beyond the title/purpose already known. This does NOT mean AutoIngest lacks the capability. Either say plainly that the detailed mechanism is not documented, or (if a related subject with real detail exists) read that one instead.',
    };
  }

  const requested = (Array.isArray(dimensions) ? dimensions : []).filter((d) => VALID_DIMENSIONS.includes(d));
  const out = {};
  let establishedCount = 0;
  let totalCount = 0;
  const subjectTitle = records[0].title || null;

  for (const dim of requested.length ? requested : VALID_DIMENSIONS.slice(0, 2)) {
    let text = null;
    // resolveThenSanitize is applied UNIFORMLY to every dimension (the
    // Checkpoint 14 corpus-wide fix over C9-C12, which only sanitized
    // limitations/technicalDetail -- purpose/behavior are the DEFAULT
    // dimensions returned when a caller requests none explicitly, so
    // leaving them raw was the single biggest exposure).
    if (dim === 'purpose') text = resolveThenSanitize(records.map((r) => r.purpose).filter(Boolean).join(' '));
    else if (dim === 'behavior') text = resolveThenSanitize(records.map((r) => r.behavior).filter(Boolean).join(' '));
    else if (dim === 'operatorWorkflow') text = resolveThenSanitize(records.flatMap((r) => r.operatorWorkflow).filter(Boolean).join(' | '));
    else if (dim === 'preconditions') text = resolveThenSanitize(records.flatMap((r) => r.preconditions).filter(Boolean).join(' | '));
    else if (dim === 'actions') text = resolveThenSanitize(records.flatMap((r) => r.actions.map((a) => `${a.label}: ${a.description}`)).filter(Boolean).join(' | '));
    else if (dim === 'recovery') text = resolveThenSanitize(records.map((r) => r.recovery).filter(Boolean).join(' '));
    else if (dim === 'limitations') {
      // Section 6(A): Decision-backed facts are folded into limitations --
      // a documented design decision constraining a feature's behavior is
      // naturally a limitation on it. No new dimension, no new tool.
      const kmLimitations = records.flatMap((r) => r.limitations).filter(Boolean);
      const decisionFacts = decisionFactsFor(realId, ctx);
      text = resolveThenSanitize([...kmLimitations, ...decisionFacts].join(' | '));
    } else if (dim === 'relationships') {
      text = records.flatMap((r) => (r.relationships || []).map((rel) => {
        const targetTitle = titleForFeatureId(rel.targetId) || null;
        const safeNote = resolveThenSanitize(rel.note);
        if (!targetTitle) return `${rel.type} another AutoIngest capability: ${safeNote}`;
        const meaning = describeEdge(rel.type, 'subject->object', subjectTitle, targetTitle);
        return `${rel.type} ${targetTitle}: ${safeNote} (${meaning})`;
      })).join(' | ');
    } else if (dim === 'technicalDetail') {
      text = resolveThenSanitize(records.map((r) => r.technicalDetail).filter(Boolean).join(' '));
    }
    totalCount++;
    if (text) establishedCount++;
    out[dim] = text || 'Not established in AutoIngest\'s evidence -- do not guess at this.';
  }

  // Section 17: knowledgeState is derived mechanically from what actually
  // came back, never used as a quality opinion, never allowed to mean
  // "unsupported". EMPTY (handled above, no KM record at all) is distinct
  // from THIN (a record exists but most requested dimensions are not
  // established) and DOCUMENTED (real, substantive content).
  const knowledgeState = establishedCount === 0 ? 'EMPTY' : (establishedCount < totalCount / 2 ? 'THIN' : 'DOCUMENTED');
  const extractionTier = records.every((r) => r.extractionTier === 'forensic-verified')
    ? 'forensic-verified'
    : (records.some((r) => r.extractionTier === 'forensic-verified') ? 'mixed' : 'registry-reshaped');
  const stateNote = knowledgeState === 'THIN'
    ? 'THIN: most of what was requested is not established. Do not fill the gaps with a plausible guess -- state plainly what is and is not known.'
    : undefined;

  return { knowledgeState, extractionTier, dimensions: out, ...(stateNote ? { note: stateNote } : {}) };
}

module.exports = { readAutoIngest, VALID_DIMENSIONS };
