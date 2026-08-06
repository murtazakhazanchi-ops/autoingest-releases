'use strict';

// Rebuilds Part 4's generated artifacts and gates roadmap/dashboard status
// transitions. Rebuilds shell out to the existing, already-tested
// `node scripts/product-docs/cli.js build` rather than re-implementing
// assembly here — one code path, one set of tests, per the brief's
// "Reuse existing Part 4 ... Git helpers" instruction.

const { execFileSync } = require('child_process');
const { CLI_PATH, REPO_ROOT } = require('./paths');

function runCli(args) {
  try {
    const output = execFileSync(process.execPath, [CLI_PATH, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: (err.stdout || '') + (err.stderr || ''), error: err.message };
  }
}

function rebuildGeneratedArtifacts() {
  return runCli(['build']);
}

function validateDocumentation() {
  return runCli(['validate']);
}

// Roadmap/dashboard status transitions are NEVER applied from
// documentationPlanner's proposal alone. This is the single choke point
// that would perform the edit, and it refuses unless the caller passes an
// explicit confirmation — this function exists mainly to make that refusal
// structural (there is no code path that mutates 02_MASTER_ROADMAP.md or
// 04_PROJECT_DASHBOARD.md without going through here and being told no).
function applyRoadmapTransition(proposal, { confirmed } = {}) {
  if (!confirmed) {
    return {
      applied: false,
      reason: 'Roadmap/dashboard transitions require explicit --confirm-roadmap-transition; never inferred automatically from a commit or evidence packet alone.',
    };
  }
  // Even with explicit confirmation, Part 5 does not auto-edit the roadmap
  // prose (status wording, milestone framing) — that remains a human/agent
  // authored edit per docs/product/05_DOCUMENTATION_WORKFLOW.md's narrative
  // standards. What this DOES automate is flagging it for that edit and
  // recording the confirmation in the audit trail (see orchestrator.js).
  return {
    applied: false,
    reason: 'Confirmed — flagged for manual/agent-authored update to 02_MASTER_ROADMAP.md and 04_PROJECT_DASHBOARD.md; Part 5 records the confirmation but does not auto-write roadmap narrative prose.',
    confirmed: true,
  };
}

module.exports = { rebuildGeneratedArtifacts, validateDocumentation, applyRoadmapTransition, runCli };
