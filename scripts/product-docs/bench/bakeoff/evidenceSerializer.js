'use strict';

// ASK AUTOINGEST — CONVERSATIONAL MODEL BAKE-OFF, clean evidence serializer.
// Benchmark-only. Consumes the REAL, UNMODIFIED evidencePackage.js output
// (buildEvidencePackage/buildEvidencePackageForAuthorityAnswer, and the
// evidenceAtoms/selectEvidenceAtomsForClassification architecture built for
// the prior C8 corrective checkpoint) and formats it into the clean,
// labeled-section operator-relevant structure the Product Owner specified
// for this bake-off (Section 7) -- the SAME text, byte-for-byte, for every
// candidate model. Does not alter evidencePackage.js, does not alter
// production selection logic.
//
// Production's own selectEvidenceAtomsForClassification() never offers
// TECHNICAL/PROVENANCE atoms to any classification (there is no question
// type representing "explain your internals" in this system). For the
// bake-off specifically, the acceptance set (acceptanceSet.js) marks a
// small number of cases category:'TECHNICAL' -- genuinely technical
// questions the operator explicitly asked (e.g. "Where does QMZ store its
// sequencing state?"). ONLY for those cases does this serializer also
// include TECHNICAL atoms, via an explicit `includeTechnical` flag the
// harness passes in -- never a blanket change to what every model sees for
// every other question, and never a change to evidencePackage.js itself.

const { buildEvidenceAtoms, selectEvidenceAtomsForClassification } = require('../../lib/askSynthesis/evidencePackage');

function formatAtomsSection(label, atoms) {
  if (!atoms.length) return null;
  const lines = atoms.map((a) => `- ${a.text}`);
  return `${label}\n${lines.join('\n')}`;
}

// evidencePackage: the real, unmodified output of buildEvidencePackage()/
// buildEvidencePackageForAuthorityAnswer(). includeTechnical: bake-off-only
// override for genuinely technical questions (see header comment above).
function serializeEvidence(question, evidencePackage, { includeTechnical = false } = {}) {
  const atoms = evidencePackage.evidenceAtoms || [];
  let selected = selectEvidenceAtomsForClassification(atoms, evidencePackage.classification);
  if (includeTechnical) {
    const technical = atoms.filter((a) => a.role === 'TECHNICAL');
    selected = [...selected, ...technical];
  }

  const byRole = (role) => selected.filter((a) => a.role === role);
  const sections = [
    `QUESTION\n"${question}"`,
    `STATUS\n${evidencePackage.capabilityStatus === 'ROADMAP' ? '(no fixed status -- this is a roadmap/dashboard question)' : evidencePackage.capabilityStatus}`,
    formatAtomsSection('OPERATOR FACTS', byRole('FACT')),
    formatAtomsSection('ACTIONS', byRole('ACTION')),
    formatAtomsSection('LIMITATIONS', byRole('LIMITATION')),
    includeTechnical ? formatAtomsSection('TECHNICAL DETAILS', byRole('TECHNICAL')) : null,
    formatAtomsSection('RATIONALE', byRole('RATIONALE')),
  ].filter(Boolean);

  return sections.join('\n\n');
}

module.exports = { serializeEvidence, buildEvidenceAtoms };
