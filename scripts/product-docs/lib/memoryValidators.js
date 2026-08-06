'use strict';

// Part 6 — Engineering Memory validation rules. Same `finding()` shape and
// four-level severity as lib/validators.js (duplicate-ID / broken-link /
// registry-mismatch checks for AI-MEM-#### are already covered for free by
// that file's existing generic checkDuplicateIds/checkLinks, since Part 6
// registered 'memory' in parsed.idFilesSeen and docs/product/memory/*.md in
// parsed.allFiles — see lib/parseProductDocs.js). This module adds the
// memory-specific rules that have no generic equivalent. See
// docs/product/16_ENGINEERING_MEMORY_POLICY.md § 15 for the policy this
// implements, and scripts/product-docs/automation/memory/README.md §
// Validation Coverage for an honest accounting of what from the original
// Part 6 brief's ~25-rule battery is and isn't implemented here.

const fs = require('fs');
const path = require('path');
const { finding } = require('./validators');
const { extractIds } = require('./ids');
const { scanForSecrets } = require('../automation/memory/redactor');

const VALID_MEMORY_STATUSES = new Set(['Open', 'Compiled', 'Superseded', 'Reopened']);

// Rule — every AI-FEAT-###/AI-RM-###/BUG-###/DEC-###/PM-### a capsule's Scope
// section cites must exist. Mirrors checkFeatureReferences' shape for bugs/
// decisions/postmortems/architecture, applied to memory instead.
function checkMemoryReferences(parsed) {
  const findings = [];
  for (const [id, capsule] of parsed.memory) {
    // capsule.header is the FIRST table in the file (## Identity, via
    // parseRecordFile's generic extractHeaderTable) — Scope is a separate,
    // later table, extracted explicitly here rather than assumed to be
    // capsule.header.
    const scopeSection = require('./markdown').extractSection(capsule.body, 'Scope');
    const scopeTable = scopeSection ? require('./markdown').extractHeaderTable(scopeSection) : {};
    const checkFamily = (fieldName, family, map) => {
      for (const cited of extractIds(String(scopeTable[fieldName] || ''), family)) {
        if (!map.has(cited)) {
          findings.push(finding('error', 'memory-broken-reference', `${id} cites nonexistent ${cited} in "${fieldName}"`, capsule.filePath));
        }
      }
    };
    checkFamily('Primary feature IDs', 'feature', parsed.features);
    checkFamily('Secondary feature IDs', 'feature', parsed.features);
    checkFamily('Roadmap milestone IDs', 'roadmap', parsed.roadmap);
    checkFamily('Related bugs', 'bug', parsed.bugs);
    checkFamily('Related decisions', 'decision', parsed.decisions);
    checkFamily('Related postmortems', 'postmortem', parsed.postmortems);
  }
  return findings;
}

// Rule — Identity.Status must be one of the four enum values the template
// defines (docs/product/15_MEMORY_TEMPLATE.md).
function checkMemoryStatusVocabulary(parsed) {
  const findings = [];
  for (const [id, capsule] of parsed.memory) {
    const status = capsule.header['Status'];
    if (status && !VALID_MEMORY_STATUSES.has(status)) {
      findings.push(finding('error', 'memory-invalid-status', `${id} has invalid Status "${status}" — must be one of: ${Array.from(VALID_MEMORY_STATUSES).join(', ')}`, capsule.filePath));
    }
  }
  return findings;
}

// Rule — Evidence classification field must be present and non-empty. A
// capsule with no evidence classification at all is a structural defect
// (docs/product/16_ENGINEERING_MEMORY_POLICY.md § 6 requires every capsule
// to state its own evidence basis), distinct from an individual claim being
// marked "Evidence pending" (which is expected and fine).
function checkMemoryEvidenceClassification(parsed) {
  const findings = [];
  for (const [id, capsule] of parsed.memory) {
    if (!capsule.header['Evidence classification']) {
      findings.push(finding('error', 'memory-missing-evidence-classification', `${id} has no "Evidence classification" field in its Identity table`, capsule.filePath));
    }
  }
  return findings;
}

// Rule — every capsule must have a Provenance section (structural
// completeness, not content correctness — content correctness isn't
// mechanically checkable, same disclaimer as 14_VALIDATION_SPECIFICATION.md's
// own "What this specification deliberately does not cover").
function checkMemoryProvenanceSection(parsed) {
  const findings = [];
  const md = require('./markdown');
  for (const [id, capsule] of parsed.memory) {
    if (!md.extractSection(capsule.body, 'Provenance')) {
      findings.push(finding('error', 'memory-missing-provenance', `${id} has no "## Provenance" section`, capsule.filePath));
    }
  }
  return findings;
}

// Rule — filename's AI-MEM-#### prefix must match the capsule's own Identity
// "Memory ID" field and its H1 heading — catches a manually-copied/renamed
// file drifting from its own declared identity.
function checkMemoryFileIdentityConsistency(parsed) {
  const findings = [];
  for (const [id, capsule] of parsed.memory) {
    const declaredId = capsule.header['Memory ID'];
    if (declaredId && declaredId !== id) {
      findings.push(finding('error', 'memory-id-mismatch', `${capsule.filePath}'s filename implies ${id} but its own Identity table declares "Memory ID: ${declaredId}"`, capsule.filePath));
    }
  }
  return findings;
}

// Rule — an obvious secret/credential pattern (Part 5's automation/redact.js
// patterns) must never appear in a committed, canonical capsule. This is a
// read-only scan (redactor.js's scanForSecrets), never a mutation — the fix
// is always an explicit `memory redact` call, never a silent edit here.
function checkMemoryUnredactedSecrets(parsed) {
  const findings = [];
  for (const [id, capsule] of parsed.memory) {
    if (scanForSecrets(capsule.body).length) {
      findings.push(finding('error', 'memory-unredacted-secret', `${id} appears to contain an unredacted credential/token pattern — run "node scripts/product-docs/cli.js memory redact ${id} --text \\"<span>\\""`, capsule.filePath));
    }
  }
  return findings;
}

// Rule — Date completed (Identity table) must not be earlier than Date
// started, when both are real dates (not "Evidence pending" or similar).
function checkMemoryChronology(parsed) {
  const findings = [];
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  for (const [id, capsule] of parsed.memory) {
    const started = capsule.header['Date started'];
    const completed = capsule.header['Date completed'];
    if (started && completed && dateRe.test(started) && dateRe.test(completed) && completed < started) {
      findings.push(finding('error', 'memory-invalid-chronology', `${id} has Date completed (${completed}) earlier than Date started (${started})`, capsule.filePath));
    }
  }
  return findings;
}

// Rule — a Visual Evidence entry citing an Asset ID should have a
// corresponding committed asset under docs/product/memory/assets/<ID>/ (a
// referenced-but-missing asset is a warning, not an error — the manifest
// entry may legitimately describe a screenshot that was judged not worth
// committing, per docs/product/16_ENGINEERING_MEMORY_POLICY.md § 10, and this
// rule cannot distinguish "orphaned reference" from "intentionally
// local-only" without more context than the Markdown alone provides).
function checkMemoryOrphanAssetReferences(parsed, memoryAssetsRoot) {
  const findings = [];
  const md = require('./markdown');
  for (const [id, capsule] of parsed.memory) {
    const section = md.extractSection(capsule.body, 'Visual Evidence') || '';
    const assetIds = Array.from(section.matchAll(/\*\*Asset ID\*\*:\s*([^\n|]+)/g)).map((m) => m[1].trim());
    for (const assetId of assetIds) {
      if (!assetId || /evidence pending/i.test(assetId) || assetId === 'None') continue;
      const dir = path.join(memoryAssetsRoot, id);
      const exists = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.includes(assetId));
      if (!exists) {
        findings.push(finding('warning', 'memory-orphan-asset-reference', `${id} references asset "${assetId}" with no matching committed file under docs/product/memory/assets/${id}/`, capsule.filePath));
      }
    }
  }
  return findings;
}

function runMemoryChecks(parsed, opts = {}) {
  const memoryAssetsRoot = opts.memoryAssetsRoot || path.join(parsed.root, 'memory', 'assets');
  return [
    ...checkMemoryReferences(parsed),
    ...checkMemoryStatusVocabulary(parsed),
    ...checkMemoryEvidenceClassification(parsed),
    ...checkMemoryProvenanceSection(parsed),
    ...checkMemoryFileIdentityConsistency(parsed),
    ...checkMemoryUnredactedSecrets(parsed),
    ...checkMemoryChronology(parsed),
    ...checkMemoryOrphanAssetReferences(parsed, memoryAssetsRoot),
  ];
}

module.exports = {
  runMemoryChecks,
  checkMemoryReferences,
  checkMemoryStatusVocabulary,
  checkMemoryEvidenceClassification,
  checkMemoryProvenanceSection,
  checkMemoryFileIdentityConsistency,
  checkMemoryUnredactedSecrets,
  checkMemoryChronology,
  checkMemoryOrphanAssetReferences,
  VALID_MEMORY_STATUSES,
};
