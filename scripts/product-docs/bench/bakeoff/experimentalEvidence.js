'use strict';

// ASK AUTOINGEST — CONVERSATIONAL ARCHITECTURE A/B EXPERIMENT, evidence
// shaping. Benchmark-only. Does NOT modify evidencePackage.js or
// evidenceSerializer.js -- takes their real, unmodified output
// (evidenceAtoms/selectEvidenceAtomsForClassification, byte-identical to
// the control path) and applies two EXPERIMENTAL, isolated
// post-processing steps this checkpoint explicitly authorizes testing:
//
// 1. Strip backtick-wrapped technical spans out of FACT atom text. The
//    C8 corrective checkpoint (2026-08-24) evaluated this for PRODUCTION
//    and rejected it as too likely to mangle grammar for a permanent
//    change ("papering over the gap with additional keyword/phrase rules
//    is exactly the brittle heuristic this checkpoint's guidance rules
//    out"). This checkpoint explicitly asks whether the evidence
//    REPRESENTATION itself should separate operator facts from
//    implementation facts -- tested here, honestly, accepting that the
//    resulting FACT sentence may read slightly rough. Not a production
//    change; a measurement.
// 2. Remove the redundant "See X for step-by-step instructions." pointer
//    FACT (knowledgeEngine.js's own exact, deterministic guidance
//    template -- verified at knowledgeEngine.js:225-226) when real ACTION
//    atoms already exist for the same record. Forensic finding this
//    checkpoint: this pointer sentence sits in OPERATOR FACTS right next
//    to the real steps, modeling "here's a pointer to read elsewhere"
//    behavior for the model to imitate instead of using the steps it
//    already has. General (matches the deterministic template exactly,
//    not a per-record rule), only fires when ACTIONS are already present
//    (never removes the pointer when it's the ONLY guidance available).

const INLINE_CODE_PAREN_RE = /\s*\((?:`[^`]+`(?:\s*\/\s*`[^`]+`)*)\)/g; // "(`x`)" or "(`x`/`y`)"
const BARE_INLINE_CODE_RE = /`[^`]+`/g;
const SEE_STEP_BY_STEP_RE = /^See .+ for step-by-step instructions\.$/i;

function stripTechnicalSpans(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text
    .replace(INLINE_CODE_PAREN_RE, '') // remove whole "(`x`)" groups first
    .replace(BARE_INLINE_CODE_RE, ''); // then any remaining lone `x` spans
  // Mechanical cleanup of the punctuation/whitespace holes left behind --
  // general string hygiene, not content-aware, so it never risks changing
  // meaning, only removing now-dangling artifacts of the removed spans.
  out = out
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+\./g, '.')
    .trim();
  return out;
}

// evidenceAtoms: the real, unmodified atoms array from evidencePackage.js.
// Returns a NEW array (immutable) with the two experimental transforms
// applied -- never mutates the input.
function shapeExperimentalAtoms(evidenceAtoms) {
  const hasRealActions = evidenceAtoms.some((a) => a.role === 'ACTION');
  return evidenceAtoms
    .filter((a) => {
      // Transform 2: drop the redundant pointer FACT when real steps exist.
      if (a.role === 'FACT' && hasRealActions && SEE_STEP_BY_STEP_RE.test(String(a.text || '').trim())) return false;
      return true;
    })
    .map((a) => {
      // Transform 1: strip technical spans from FACT text only -- ACTION/
      // LIMITATION/RATIONALE text is left exactly as selected today
      // (unchanged from the control path's own selection discipline).
      if (a.role === 'FACT') return { ...a, text: stripTechnicalSpans(a.text) };
      return a;
    })
    .filter((a) => a.role !== 'FACT' || (a.text && a.text.trim().length > 0)); // never emit an empty FACT left by stripping
}

const { selectEvidenceAtomsForClassification } = require('../../lib/askSynthesis/evidencePackage');

function formatAtomsSection(label, atoms) {
  if (!atoms.length) return null;
  return `${label}\n${atoms.map((a) => `- ${a.text}`).join('\n')}`;
}

// Experimental evidence block for ONE turn -- deliberately NOT a "QUESTION"
// field (forensic finding B/D this checkpoint: production flattens the
// operator's own words into an evidence field; here the operator's real
// words are instead the actual chat-history user turn -- see
// experimentalHarness's generateFn -- and this function only supplies the
// grounding evidence attached alongside it).
function serializeExperimentalEvidence(evidencePackage) {
  const atoms = evidencePackage.evidenceAtoms || [];
  const selected = shapeExperimentalAtoms(selectEvidenceAtomsForClassification(atoms, evidencePackage.classification));
  const byRole = (role) => selected.filter((a) => a.role === role);
  const sections = [
    `STATUS\n${evidencePackage.capabilityStatus === 'ROADMAP' ? '(no fixed status -- this is a roadmap/dashboard question)' : evidencePackage.capabilityStatus}`,
    formatAtomsSection('OPERATOR FACTS', byRole('FACT')),
    formatAtomsSection('ACTIONS', byRole('ACTION')),
    formatAtomsSection('LIMITATIONS', byRole('LIMITATION')),
    formatAtomsSection('RATIONALE', byRole('RATIONALE')),
  ].filter(Boolean);
  return sections.join('\n\n');
}

module.exports = { shapeExperimentalAtoms, stripTechnicalSpans, serializeExperimentalEvidence };
