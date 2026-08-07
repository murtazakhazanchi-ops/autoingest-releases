'use strict';

// Part 7B — decision-intelligence validation rules, wired into
// lib/validators.js's runAllChecks the same lazy-require way memoryValidators.js
// is (see that file's own module-level comment: avoids a circular require,
// since this file also imports `finding` from validators.js). Checks
// CANONICAL docs/product/decisions/ content only — decision *candidates*
// (evidence-incomplete, held in .autoingest-docs/decision-candidates/) are
// local automation state, never canonical, and are therefore out of scope
// for this file exactly like Evidence Packets are out of scope for it.

const { finding } = require('./validators');
const EVIDENCE_PENDING_ALTS = 'Evidence pending — not yet documented as fact.';

function statusOf(d) {
  return String(d.header['Status'] || '').trim();
}

// Rule: a Draft decision (Part 7B's auto-drafted state) must carry evidence
// tying it back to the session that produced it — a Draft with no such
// citation is indistinguishable from a hand-typed placeholder and should be
// reviewed, not silently trusted.
function checkDecisionDraftsHaveEvidence(parsed) {
  const findings = [];
  for (const [id, d] of parsed.decisions) {
    if (!/^Draft\b/i.test(statusOf(d))) continue;
    const evidenceStatus = String(d.header['Evidence status'] || '');
    if (!/session\s*`?sess-/i.test(evidenceStatus) && !/signals?:/i.test(evidenceStatus)) {
      findings.push(finding('warning', 'decision-draft-missing-evidence', `${id} is Status: Draft but its Evidence status does not cite the originating session or detected signals`, d.filePath));
    }
  }
  return findings;
}

// Rule: an Accepted decision whose Options Considered section is still the
// literal evidence-pending placeholder (canonicalUpdater.renderDecisionRecord's
// own fallback) was accepted without recording what was actually weighed —
// flagged, never blocked, since many legitimate pre-Part-5 decisions predate
// this convention and evidence may simply be unrecoverable.
function checkAcceptedDecisionsHaveEvidence(parsed) {
  const findings = [];
  for (const [id, d] of parsed.decisions) {
    if (statusOf(d) !== 'Accepted') continue;
    const optionsMatch = /##\s*Options Considered\s*\n+([\s\S]*?)(?=\n##\s|\n?$)/i.exec(d.body);
    const optionsText = optionsMatch ? optionsMatch[1].trim() : '';
    if (optionsText === EVIDENCE_PENDING_ALTS) {
      findings.push(finding('evidence_gap', 'decision-accepted-without-alternatives-evidence', `${id} is Status: Accepted but Options Considered has no recorded alternatives`, d.filePath));
    }
  }
  return findings;
}

// Rule: "Superseded by DEC-XXX" must point at a real decision, and that
// target decision should itself reference back (Reconciliation Note or body
// mentioning the superseded ID) — a one-directional supersession link is
// exactly the kind of silent-drift this system's Append, Never Erase rule
// exists to prevent.
function checkSupersededReciprocalLinks(parsed) {
  const findings = [];
  for (const [id, d] of parsed.decisions) {
    const m = /Superseded by (DEC-\d{3})/i.exec(statusOf(d));
    if (!m) continue;
    const targetId = m[1].toUpperCase();
    const target = parsed.decisions.get(targetId);
    if (!target) {
      findings.push(finding('error', 'superseded-target-missing', `${id} claims to be superseded by ${targetId}, which does not exist`, d.filePath));
      continue;
    }
    if (!target.body.includes(id)) {
      findings.push(finding('warning', 'superseded-reciprocal-link-missing', `${id} is marked superseded by ${targetId}, but ${targetId} does not mention ${id} anywhere in its own body`, target.filePath));
    }
  }
  return findings;
}

// Rule (soft/informational): two independently Accepted decisions citing the
// exact same feature/roadmap set are worth a human glance — not necessarily
// a contradiction (two accepted decisions can coexist about the same
// feature), so this is information-level, never a block, and never asserts
// the two actually disagree — only that governance overlap exists.
function checkContradictoryActiveDecisions(parsed) {
  const findings = [];
  const { extractIds } = require('./ids');
  const byFeatureSet = new Map();
  for (const [id, d] of parsed.decisions) {
    if (statusOf(d) !== 'Accepted') continue;
    const raw = String(d.header['Related feature(s) / roadmap milestone'] || '');
    const feats = extractIds(raw, 'feature').sort();
    if (feats.length === 0) continue;
    const key = feats.join(',');
    if (!byFeatureSet.has(key)) byFeatureSet.set(key, []);
    byFeatureSet.get(key).push(id);
  }
  for (const [key, decIds] of byFeatureSet) {
    if (decIds.length > 1) {
      findings.push(finding('information', 'overlapping-active-decisions', `${decIds.length} Accepted decisions (${decIds.join(', ')}) all govern the exact same feature/milestone set (${key}) — worth a human check that they don't contradict each other`, decIds[0]));
    }
  }
  return findings;
}

function runDecisionIntelligenceChecks(parsed) {
  return [
    ...checkDecisionDraftsHaveEvidence(parsed),
    ...checkAcceptedDecisionsHaveEvidence(parsed),
    ...checkSupersededReciprocalLinks(parsed),
    ...checkContradictoryActiveDecisions(parsed),
  ];
}

module.exports = {
  runDecisionIntelligenceChecks,
  checkDecisionDraftsHaveEvidence,
  checkAcceptedDecisionsHaveEvidence,
  checkSupersededReciprocalLinks,
  checkContradictoryActiveDecisions,
};
