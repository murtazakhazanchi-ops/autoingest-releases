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

// Final acceptance checkpoint (2026-08-24), Product Owner-authorized answer-
// quality correction. Deliberately narrow, and deliberately NOT a general
// technical-vocabulary blacklist: the Product Owner explicitly ruled that
// out ("must not reject a valid answer merely because words such as JSON,
// IPC, renderer, metadata, XMP, checksum, NAS appear when the user's
// question genuinely calls for those concepts... any technical-register
// check must be relevance-aware or limited to unmistakable internal/
// provenance leakage"). Whether a technical TERM is relevant depends on
// what the operator actually asked -- that is a real semantic judgment this
// mechanical regex cannot reliably make without becoming exactly the kind
// of brittle heuristic the Product Owner ruled out, so it is not
// attempted here (see the C8 final-answer-quality report's own "why not a
// broader guard" section).
//
// What CAN be checked mechanically, with no relevance ambiguity at all: the
// corpus's own internal evidentiary/provenance CITATION CONVENTION --
// phrases like "captured during the Product-Owner Purpose Capture
// interview, 2026-08-14" or "Known from project history; repository
// evidence pending" -- observed verbatim in real synthesized answers this
// checkpoint. These are documentation/audit-trail annotations, not
// language a person would ever use explaining something to another person
// -- unmistakable leakage regardless of what the operator asked, even a
// genuine history/"why" question (which should get Phi's own natural
// explanation, with historicalNote as the structurally separate place for
// "how this came to be" -- never this citation-formatting artifact bleeding
// into "answer").
// Scoped to specific citation-convention phrases only (not a bare "evidence
// gap"/"evidence pending" fragment) -- "evidence gap" on its own can be a
// legitimate, useful operator-facing caveat when it genuinely appears in a
// limitations/warning ("some detail may be incomplete"), so this is
// deliberately the exact, distinctive citation phrasing observed, not the
// individual words.
const PROVENANCE_ANNOTATION_LEAK_RE = /\b(known from project history|repository evidence pending|purpose capture interview|captured (?:during|on) the|captured \d{4}-\d{2}-\d{2})\b/i;

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

// Final acceptance checkpoint (2026-08-24): catches the corpus's own
// internal evidentiary-citation formatting bleeding verbatim into
// operator-facing prose (see this file's own PROVENANCE_ANNOTATION_LEAK_RE
// header comment for why this is safe to check mechanically without being
// a technical-vocabulary blacklist). Scoped to "answer"/"historicalNote"
// only -- the two fields observed carrying this leak in real testing --
// not steps/warnings, where a limitations-derived caveat mentioning a
// genuine "evidence gap" is legitimate operator-facing content, not a
// citation-format leak.
function checkNoProvenanceAnnotationLeak(candidate) {
  const leaks = [];
  const scan = (text, where) => {
    if (typeof text !== 'string') return;
    if (PROVENANCE_ANNOTATION_LEAK_RE.test(text)) leaks.push({ where, snippet: text.slice(0, 160) });
  };
  scan(candidate.answer, 'answer');
  scan(candidate.historicalNote, 'historicalNote');
  return { ok: leaks.length === 0, leaks };
}

// C8 corrective checkpoint (2026-08-24), Defect 2 -- the structural
// backstop for evidencePackage.js's TECHNICAL evidence atoms (backtick-
// delimited implementation identifiers extracted from directAnswer --
// qmzRoot, qmz-sequences.json, _qmz*, event.json, BrowserWindow, etc.; see
// evidencePackage.js's extractTechnicalAtoms()/buildEvidenceAtoms() own
// header comments for the forensic trace). TECHNICAL atoms are never
// selected into ANY synthesis prompt payload (evidencePackage.js's
// selectEvidenceAtomsForClassification() excludes them unconditionally) --
// this check is the safety net for the case that matters most: Phi copying
// one verbatim from directAnswer's own prose anyway, despite BASE_CONTRACT
// rule 4's instruction not to. Deliberately NOT a hardcoded technical-
// vocabulary blacklist -- exactly like checkNoIdLeakInProse/
// checkNoHandleLeakInProse above, the forbidden-token set is derived
// entirely from THIS evidence package's own extracted atoms (this
// record's real identifiers, for this question, nothing else), so a
// legitimate answer that happens to use an unrelated technical word (JSON,
// IPC, renderer, checksum) the operator's own question called for is never
// at risk -- only this record's own already-identified internal
// identifiers are checked.
function checkNoTechnicalIdentifierLeak(candidate, evidencePackage) {
  const technicalAtoms = (evidencePackage.evidenceAtoms || []).filter((a) => a.role === 'TECHNICAL');
  if (!technicalAtoms.length) return { ok: true, leaks: [] };
  const leaks = [];
  const scan = (text, where) => {
    if (typeof text !== 'string' || !text) return;
    for (const atom of technicalAtoms) {
      if (atom.text && text.includes(atom.text)) leaks.push({ where, identifier: atom.text });
    }
  };
  scan(candidate.answer, 'answer');
  scan(candidate.historicalNote, 'historicalNote');
  for (const [i, s] of (candidate.steps || []).entries()) scan(s.text, `steps[${i}].text`);
  for (const [i, w] of (candidate.warnings || []).entries()) scan(w.text, `warnings[${i}].text`);
  return { ok: leaks.length === 0, leaks };
}

// C8 corrective checkpoint (2026-08-24), Defect 2 -- the equivalent
// structural backstop for PROVENANCE evidence atoms (this record's own
// citation/evidence-qualification commentary, e.g. "captured during the
// Product-Owner Purpose Capture interview, 2026-08-14" -- split out by
// evidencePackage.js's splitRationaleFromProvenanceQualifier() and, like
// TECHNICAL atoms, never selected into any synthesis prompt payload).
// Complements (does not replace) PROVENANCE_ANNOTATION_LEAK_RE above: that
// phrase-based check catches the general citation-formatting CONVENTION
// even if paraphrased; this one catches an exact, this-record's-own
// provenance text being reproduced verbatim, the same evidence-package-
// derived pattern as checkNoTechnicalIdentifierLeak.
function checkNoProvenanceAtomLeak(candidate, evidencePackage) {
  const provenanceAtoms = (evidencePackage.evidenceAtoms || []).filter((a) => a.role === 'PROVENANCE');
  if (!provenanceAtoms.length) return { ok: true, leaks: [] };
  const leaks = [];
  const scan = (text, where) => {
    if (typeof text !== 'string' || !text) return;
    for (const atom of provenanceAtoms) {
      if (atom.text && atom.text.length > 8 && text.includes(atom.text)) leaks.push({ where, snippet: atom.text.slice(0, 160) });
    }
  };
  scan(candidate.answer, 'answer');
  scan(candidate.historicalNote, 'historicalNote');
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
    noProvenanceAnnotationLeak: checkNoProvenanceAnnotationLeak(candidate),
    noTechnicalIdentifierLeak: checkNoTechnicalIdentifierLeak(candidate, evidencePackage),
    noProvenanceAtomLeak: checkNoProvenanceAtomLeak(candidate, evidencePackage),
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
  checkNoProvenanceAnnotationLeak,
  checkNoTechnicalIdentifierLeak,
  checkNoProvenanceAtomLeak,
  checkHistoricalNotGrounded,
  ID_SHAPE_RE,
  HANDLE_SHAPE_RE,
  PROVENANCE_ANNOTATION_LEAK_RE,
};
