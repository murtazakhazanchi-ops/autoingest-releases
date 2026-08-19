'use strict';

// Ask AutoIngest — deterministic safety validation, Phase A.2 revision.
// Every check from Phase A is preserved UNCHANGED in what it verifies —
// Phase A.2 only adds handle resolution as a first step (Track 2.A) and one
// new check for handle-shaped leaks (a UI-cleanliness signal, kept
// structurally separate from the real ID-hallucination check, which is now
// a stronger signal than before: the model's input never contains a raw ID,
// so any raw ID appearing in output is prior-knowledge hallucination, not
// copy-through). No existing check was weakened or removed.

const ID_SHAPE_RE = /\b(AI-FEAT-\d+|AI-WF-\d+|AI-RM-\d+|DEC-\d+|BUG-\d+|PM-\d+|AI-MEM-\d+)\b/g;
const HANDLE_SHAPE_RE = /\bS\d+\b/g;

function resolveHandles(candidate, handleMap) {
  const toId = (h) => handleMap.idByHandle.get(h) || null;
  const mapArr = (arr) => (arr || []).map((h) => toId(h)).filter(Boolean);
  return {
    ...candidate,
    sourceIds: mapArr(candidate.sourceIds),
    steps: (candidate.steps || []).map((s) => ({ ...s, sourceIds: mapArr(s.sourceIds) })),
    warnings: (candidate.warnings || []).map((w) => ({ ...w, sourceIds: mapArr(w.sourceIds) })),
    related: (candidate.related || []).map((r) => ({ ...r, sourceIds: mapArr(r.sourceIds) })),
    _rawHandleCounts: {
      sourceIds: (candidate.sourceIds || []).length,
      resolvedSourceIds: mapArr(candidate.sourceIds).length,
    },
  };
}

function checkSchemaShape(candidate) {
  const errors = [];
  if (typeof candidate !== 'object' || candidate === null) return { ok: false, errors: ['not an object'] };
  if (typeof candidate.answer !== 'string' || !candidate.answer.trim()) errors.push('missing/empty "answer"');
  if (typeof candidate.capabilityStatus !== 'string') errors.push('missing "capabilityStatus"');
  if (candidate.steps && !Array.isArray(candidate.steps)) errors.push('"steps" present but not an array');
  if (candidate.warnings && !Array.isArray(candidate.warnings)) errors.push('"warnings" present but not an array');
  if (candidate.sourceIds && !Array.isArray(candidate.sourceIds)) errors.push('"sourceIds" present but not an array');
  return { ok: errors.length === 0, errors };
}

// Handles that failed to resolve are, by construction, either a grammar
// violation (should be structurally impossible under a correctly-applied
// enum-constrained grammar) or evidence the runtime did not honor the
// grammar -- either way a real, reportable finding, not silently dropped.
function checkSourceIdsExist(candidate, handleMap) {
  const bad = [];
  const collect = (ids, where) => {
    for (const h of ids || []) if (!handleMap.idByHandle.has(h)) bad.push({ handle: h, where });
  };
  collect(candidate.sourceIds, 'top-level sourceIds');
  for (const [i, s] of (candidate.steps || []).entries()) collect(s.sourceIds, `steps[${i}]`);
  for (const [i, w] of (candidate.warnings || []).entries()) collect(w.sourceIds, `warnings[${i}]`);
  for (const [i, r] of (candidate.related || []).entries()) collect(r.sourceIds, `related[${i}]`);
  return { ok: bad.length === 0, invalidReferences: bad };
}

function checkEveryClaimCited(candidate) {
  const uncited = [];
  for (const [i, s] of (candidate.steps || []).entries()) {
    if (!Array.isArray(s.sourceIds) || s.sourceIds.length === 0) uncited.push(`steps[${i}]: "${s.text}"`);
  }
  for (const [i, w] of (candidate.warnings || []).entries()) {
    if (!Array.isArray(w.sourceIds) || w.sourceIds.length === 0) uncited.push(`warnings[${i}]: "${w.text}"`);
  }
  return { ok: uncited.length === 0, uncitedClaims: uncited };
}

function checkCapabilityStatusMatches(candidate, evidencePackage) {
  const ok = candidate.capabilityStatus === evidencePackage.capabilityStatus;
  return { ok, expected: evidencePackage.capabilityStatus, actual: candidate.capabilityStatus };
}

// Raw internal IDs: now a strictly stronger signal than in Phase A, since
// the model's own input never contains one -- any occurrence is
// prior-knowledge hallucination or leakage from training data, not
// copy-through of something it was shown.
function checkNoIdLeakInProse(candidate) {
  const leaks = [];
  const scan = (text, where) => {
    if (typeof text !== 'string') return;
    const matches = text.match(ID_SHAPE_RE);
    if (matches && matches.length) leaks.push({ where, ids: matches });
  };
  scan(candidate.answer, 'answer');
  scan(candidate.historicalNote, 'historicalNote');
  for (const [i, s] of (candidate.steps || []).entries()) scan(s.text, `steps[${i}].text`);
  for (const [i, w] of (candidate.warnings || []).entries()) scan(w.text, `warnings[${i}].text`);
  for (const [i, r] of (candidate.related || []).entries()) scan(r.title, `related[${i}].title`);
  return { ok: leaks.length === 0, leaks };
}

// New in Phase A.2 (Track 2.A): a handle (e.g. "S1") leaking into prose is
// NOT a hallucination -- it's a real reference to real evidence -- but it
// is still an operator-facing UI defect (a meaningless token in the answer
// text) and is tracked SEPARATELY from ID leakage, never conflated with it.
function checkNoHandleLeakInProse(candidate) {
  const leaks = [];
  const scan = (text, where) => {
    if (typeof text !== 'string') return;
    const matches = text.match(HANDLE_SHAPE_RE);
    if (matches && matches.length) leaks.push({ where, handles: matches });
  };
  scan(candidate.answer, 'answer');
  scan(candidate.historicalNote, 'historicalNote');
  for (const [i, s] of (candidate.steps || []).entries()) scan(s.text, `steps[${i}].text`);
  for (const [i, w] of (candidate.warnings || []).entries()) scan(w.text, `warnings[${i}].text`);
  for (const [i, r] of (candidate.related || []).entries()) scan(r.title, `related[${i}].title`);
  return { ok: leaks.length === 0, leaks };
}

function checkHistoricalNotGrounded(candidate, evidencePackage) {
  const hasNote = typeof candidate.historicalNote === 'string' && candidate.historicalNote.trim().length > 0;
  const hasAdmittedHistory = (evidencePackage.historical.admitted || []).length > 0;
  if (hasNote && !hasAdmittedHistory) {
    return { ok: false, reason: 'historicalNote present but evidence package has zero admitted historical context -- this should be structurally impossible under the Phase A.2 dynamic schema (property omitted entirely); if this fires, the runtime did not honor the schema/grammar and that is itself a reportable finding' };
  }
  return { ok: true, reason: null };
}

// candidate is the RAW model output (handles, not IDs). handleMap is
// required in Phase A.2 (sourceHandles.js's assignHandles() output) --
// every downstream check operates on real IDs, resolved once here.
function validateSynthesis(candidate, evidencePackage, handleMap) {
  const shape = checkSchemaShape(candidate);
  if (!shape.ok) {
    return { ok: false, failedChecks: ['schemaShape'], details: { schemaShape: shape } };
  }
  const handleExistence = checkSourceIdsExist(candidate, handleMap);
  const resolved = resolveHandles(candidate, handleMap);
  const checks = {
    handlesExist: handleExistence,
    everyClaimCited: checkEveryClaimCited(resolved),
    capabilityStatusMatches: checkCapabilityStatusMatches(resolved, evidencePackage),
    noIdLeakInProse: checkNoIdLeakInProse(candidate),
    noHandleLeakInProse: checkNoHandleLeakInProse(candidate),
    historicalGrounded: checkHistoricalNotGrounded(candidate, evidencePackage),
  };
  const failedChecks = Object.entries(checks).filter(([, v]) => !v.ok).map(([k]) => k);
  return { ok: failedChecks.length === 0, failedChecks, details: checks, resolved };
}

module.exports = {
  validateSynthesis,
  resolveHandles,
  checkSchemaShape,
  checkSourceIdsExist,
  checkEveryClaimCited,
  checkCapabilityStatusMatches,
  checkNoIdLeakInProse,
  checkNoHandleLeakInProse,
  checkHistoricalNotGrounded,
  ID_SHAPE_RE,
  HANDLE_SHAPE_RE,
};
