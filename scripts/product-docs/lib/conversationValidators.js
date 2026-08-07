'use strict';

// Part 8 — Engineering Conversation validation rules. Same `finding()`
// shape and four-level severity as lib/validators.js (duplicate-ID /
// broken-link / registry-mismatch checks for ENG-CONV-#### are already
// covered for free by that file's generic checkDuplicateIds/checkLinks,
// since Part 8 registered 'conversation' in parsed.idFilesSeen and
// docs/product/conversations/*.md in parsed.allFiles — see
// lib/parseProductDocs.js). This module adds the conversation-specific
// rules that have no generic equivalent. Mirrors lib/memoryValidators.js's
// shape closely — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 15.

const { finding } = require('./validators');
const { extractIds } = require('./ids');
const md = require('./markdown');
const { scanForSecrets } = require('../automation/conversation/redactor');

const VALID_CONVERSATION_STATUSES = new Set([
  'Imported', 'Linked', 'Active', 'Implementation Pending', 'Implementation In Progress',
  'Implemented', 'Partially Implemented', 'Deferred', 'Rejected', 'Superseded', 'Archived',
]);

function checkConversationReferences(parsed) {
  const findings = [];
  if (!parsed.conversations) return findings;
  for (const [id, rec] of parsed.conversations) {
    const relSection = md.extractSection(rec.body, 'Relationships') || '';
    const relTable = relSection ? md.extractHeaderTable(relSection) : {};
    const checkFamily = (fieldName, family, map) => {
      for (const cited of extractIds(String(relTable[fieldName] || ''), family)) {
        if (!map.has(cited)) {
          findings.push(finding('error', 'conversation-broken-reference', `${id} cites nonexistent ${cited} in "${fieldName}"`, rec.filePath));
        }
      }
    };
    checkFamily('Primary feature IDs', 'feature', parsed.features);
    checkFamily('Secondary feature IDs', 'feature', parsed.features);
    checkFamily('Roadmap milestone IDs', 'roadmap', parsed.roadmap);
    checkFamily('Related bugs', 'bug', parsed.bugs);
    checkFamily('Related decisions', 'decision', parsed.decisions);
    if (parsed.memory) checkFamily('Related memory capsules', 'memory', parsed.memory);
    checkFamily('Related conversations', 'conversation', parsed.conversations);
  }
  return findings;
}

function checkConversationStatusVocabulary(parsed) {
  const findings = [];
  if (!parsed.conversations) return findings;
  for (const [id, rec] of parsed.conversations) {
    const status = rec.header['Status'];
    if (status && !VALID_CONVERSATION_STATUSES.has(status)) {
      findings.push(finding('error', 'conversation-invalid-status', `${id} has invalid Status "${status}" — must be one of: ${Array.from(VALID_CONVERSATION_STATUSES).join(', ')}`, rec.filePath));
    }
  }
  return findings;
}

function checkConversationProvenanceSection(parsed) {
  const findings = [];
  if (!parsed.conversations) return findings;
  for (const [id, rec] of parsed.conversations) {
    if (!md.extractSection(rec.body, 'Provenance')) {
      findings.push(finding('error', 'conversation-missing-provenance', `${id} has no "## Provenance" section`, rec.filePath));
    }
    if (!md.extractSection(rec.body, 'Outcome')) {
      findings.push(finding('error', 'conversation-missing-outcome', `${id} has no "## Outcome" section`, rec.filePath));
    }
  }
  return findings;
}

function checkConversationFileIdentityConsistency(parsed) {
  const findings = [];
  if (!parsed.conversations) return findings;
  for (const [id, rec] of parsed.conversations) {
    const identity = md.extractSectionTable(rec.body, 'Identity') || {};
    const declaredId = identity['Conversation ID'];
    if (declaredId && declaredId !== id) {
      findings.push(finding('error', 'conversation-id-mismatch', `${rec.filePath}'s filename implies ${id} but its own Identity table declares "Conversation ID: ${declaredId}"`, rec.filePath));
    }
  }
  return findings;
}

function checkConversationUnredactedSecrets(parsed) {
  const findings = [];
  if (!parsed.conversations) return findings;
  for (const [id, rec] of parsed.conversations) {
    if (scanForSecrets(rec.body).length) {
      findings.push(finding('error', 'conversation-unredacted-secret', `${id} appears to contain an unredacted credential/token pattern — run "node scripts/product-docs/cli.js conversation redact ${id} --text \\"<span>\\""`, rec.filePath));
    }
  }
  return findings;
}

// A conversation whose Implementation Handoff names concrete work must not
// silently claim "Implemented" in its Outcome without ANY linked feature,
// roadmap, or memory evidence — that combination is a structural red flag
// (an implementation claim with literally nothing to point at), not proof
// the work never happened, so this is a warning, never an error.
function checkConversationImplementedWithoutEvidence(parsed) {
  const findings = [];
  if (!parsed.conversations) return findings;
  for (const [id, rec] of parsed.conversations) {
    const outcomeSection = md.extractSection(rec.body, 'Outcome') || '';
    if (!/Implemented/i.test(outcomeSection)) continue;
    const relSection = md.extractSection(rec.body, 'Relationships') || '';
    const relTable = relSection ? md.extractHeaderTable(relSection) : {};
    const hasAnyLink = ['Primary feature IDs', 'Secondary feature IDs', 'Roadmap milestone IDs', 'Related memory capsules']
      .some((f) => relTable[f] && relTable[f] !== 'None');
    if (!hasAnyLink) {
      findings.push(finding('warning', 'conversation-implemented-without-evidence', `${id}'s Outcome claims Implemented but Relationships names no feature/roadmap/memory link to point at`, rec.filePath));
    }
  }
  return findings;
}

function runConversationChecks(parsed) {
  return [
    ...checkConversationReferences(parsed),
    ...checkConversationStatusVocabulary(parsed),
    ...checkConversationProvenanceSection(parsed),
    ...checkConversationFileIdentityConsistency(parsed),
    ...checkConversationUnredactedSecrets(parsed),
    ...checkConversationImplementedWithoutEvidence(parsed),
  ];
}

module.exports = {
  runConversationChecks,
  checkConversationReferences,
  checkConversationStatusVocabulary,
  checkConversationProvenanceSection,
  checkConversationFileIdentityConsistency,
  checkConversationUnredactedSecrets,
  checkConversationImplementedWithoutEvidence,
  VALID_CONVERSATION_STATUSES,
};
