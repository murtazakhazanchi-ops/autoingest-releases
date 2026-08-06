'use strict';

// Append-only audit log for every automation run — one JSON line per run
// under .autoingest-docs/audit/runs.jsonl. Never logs secrets (redact.js)
// or full user prompts, per the SECURITY / AUDITABILITY sections.

const path = require('path');
const { AUDIT_DIR } = require('./paths');
const { appendJsonLineSync } = require('./atomicWrite');
const { redactDeep } = require('./redact');

const RUNS_LOG = path.join(AUDIT_DIR, 'runs.jsonl');

function recordRun(entry) {
  const record = redactDeep({
    at: new Date().toISOString(),
    run_id: entry.run_id,
    mode: entry.mode,
    trigger: entry.trigger,
    branch: entry.branch,
    base_commit: entry.base_commit,
    head_commit: entry.head_commit,
    command: entry.command,
    files_inspected: entry.files_inspected,
    feature_mappings: entry.feature_mappings,
    canonical_files_modified: entry.canonical_files_modified,
    generated_rebuilt: entry.generated_rebuilt,
    records_created: entry.records_created,
    validation_summary: entry.validation_summary,
    warnings: entry.warnings,
    evidence_gaps: entry.evidence_gaps,
    duration_ms: entry.duration_ms,
    outcome: entry.outcome,
  });
  appendJsonLineSync(RUNS_LOG, record);
  return record;
}

module.exports = { recordRun, RUNS_LOG };
