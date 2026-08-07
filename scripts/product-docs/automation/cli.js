'use strict';

// Thin command dispatcher for `node scripts/product-docs/cli.js automation <sub>`,
// mirroring the parent cli.js's own "dispatcher only, logic lives in lib/"
// convention. All real behavior lives in orchestrator.js and its collaborators.

const orchestrator = require('./orchestrator');
const evidencePacket = require('./evidencePacket');
const recovery = require('./recovery');
const installHooks = require('../hooks/install-hooks');
const releaseIntelligence = require('./releaseIntelligence');
// hookAutomation/decisionIntelligence/ownershipEngine are required lazily,
// inside the specific command functions that use each one (below) rather
// than at module top — lets each Part 7 milestone's dispatcher wiring land
// in its own commit without any intermediate commit's `automation/cli.js`
// referencing a module that doesn't exist yet at that point in history.

const HELP = `automation — Part 5 documentation-automation orchestration

Usage: node scripts/product-docs/cli.js automation <sub> [args]

Subcommands:
  start --type <type> --title "<title>" [--summary "..."] [--request "..."] [--mode strict|standard|observe]
  update [sessionId] [--summary "..."] [--root-cause "..."] [--accepted "..."] [--test <name>]
         [--verification <text>] [--risk <text>] [--gap <text>] [--bug <json>] [--decision <json>]
         [--alternative <json>] [--evidence-source <source>] [--json '<partial-packet-json>']
  finalize [sessionId]
  status [--json | --check-strict-blocking]
  recover
  dry-run [sessionId | <fromRef> [toRef=HEAD]]
  reconcile
  install-hooks [--dry-run] | uninstall-hooks | verify-hooks
  release-draft <fromRef> [toRef=HEAD]

  Part 7 — Zero-Touch Git Integration:
  pre-commit-gate                 Run the pre-commit checks against currently staged files
  pre-push-gate                   Auto-finalize eligible sessions, validate, report push impact
  post-commit-link                Link the just-made commit into any matching pending session

  Part 7 — Decision Intelligence:
  decision-scan [sessionId]       Detect architectural signals and plan a decision candidate/draft
  decision-candidates             List locally-held (non-canonical) decision candidates

  Part 7 — Ownership:
  ownership <path>                Multi-signal ownership resolution for a source path

Modes: STRICT blocks on any unmet requirement; STANDARD (default) updates docs
and blocks only on hard validation errors; OBSERVE never writes canonical docs.
`;

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function tryParseJson(label, str) {
  try {
    return JSON.parse(str);
  } catch (err) {
    throw new Error(`--${label} expects valid JSON: ${err.message}`);
  }
}

function resolveSingleSession(explicitId) {
  if (explicitId) return explicitId;
  const pending = evidencePacket.listPending();
  if (pending.length === 0) throw new Error('No pending evidence packet — run "automation start" first, or pass a session ID explicitly.');
  if (pending.length > 1) {
    const ids = pending.map((p) => p.session_id).join(', ');
    throw new Error(`Multiple pending sessions — pass one explicitly: ${ids}`);
  }
  return pending[0].session_id;
}

function cmdStart(args) {
  const { flags } = parseFlags(args);
  if (flags.help) return console.log(HELP);
  const packet = orchestrator.start({
    taskType: flags.type,
    taskTitle: flags.title,
    taskSummary: flags.summary,
    userRequestSummary: flags.request,
    mode: flags.mode,
  });
  console.log(`Started session ${packet.session_id} (mode: ${packet.automation_mode}, branch: ${packet.branch}, base: ${packet.base_commit.slice(0, 8)})`);
  console.log(JSON.stringify(packet, null, 2));
}

function cmdUpdate(args) {
  const { flags, positional } = parseFlags(args);
  const sessionId = resolveSingleSession(positional[0]);
  const patch = flags.json ? tryParseJson('json', flags.json) : {};
  if (flags.summary) patch.task_summary = flags.summary;
  if (flags['root-cause']) patch.root_cause = flags['root-cause'];
  if (flags.accepted) patch.accepted_solution = flags.accepted;
  if (flags.test) patch.tests_run = [...(patch.tests_run || []), flags.test];
  if (flags.verification) patch.manual_verification = [...(patch.manual_verification || []), flags.verification];
  if (flags.risk) patch.risks = [...(patch.risks || []), flags.risk];
  if (flags.gap) patch.unresolved_gaps = [...(patch.unresolved_gaps || []), flags.gap];
  if (flags.bug) patch.bugs_discovered = [...(patch.bugs_discovered || []), tryParseJson('bug', flags.bug)];
  if (flags.decision) patch.decisions_made = [...(patch.decisions_made || []), tryParseJson('decision', flags.decision)];
  if (flags.alternative) patch.alternatives_considered = [...(patch.alternatives_considered || []), tryParseJson('alternative', flags.alternative)];
  if (flags['evidence-source']) patch.evidence_sources = [...(patch.evidence_sources || []), flags['evidence-source']];
  if (flags.mode) patch.automation_mode = flags.mode;

  const packet = orchestrator.update(sessionId, patch);
  console.log(`Updated session ${sessionId}.`);
  console.log(JSON.stringify(packet, null, 2));
}

function cmdFinalize(args) {
  const { positional } = parseFlags(args);
  const sessionId = resolveSingleSession(positional[0]);
  const result = orchestrator.finalize(sessionId);
  console.log(`Finalize ${result.ok ? 'PASSED' : 'BLOCKED'} for session ${sessionId} (mode: ${result.gateResult.mode})`);
  console.log(JSON.stringify({
    ok: result.ok,
    gate: result.gateResult,
    plan_summary: Object.fromEntries(Object.entries(result.plan).map(([k, v]) => [k, v.length])),
    canonical_files_modified: result.runRecord.canonical_files_modified,
    records_created: result.runRecord.records_created,
    generated_rebuilt: result.runRecord.generated_rebuilt,
    duration_ms: result.durationMs,
  }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

function cmdStatus(args) {
  const { flags } = parseFlags(args);
  const s = orchestrator.status();
  if (flags['check-strict-blocking']) {
    // Dedicated, script-friendly check for hooks/pre-push — deliberately
    // NOT implemented as `grep` over pretty-printed --json output (a prior
    // version of the pre-push hook did that; `JSON.stringify(x, null, 2)`
    // puts a space after every colon, so the no-space grep pattern never
    // matched, silently disabling the STRICT-mode push gate — found in code
    // review). Prints nothing on success; on a block, prints one line per
    // blocking session and exits 1.
    const blocking = s.pending.filter((e) => e.packet.automation_mode === 'strict' && e.packet.automation_status === 'in-progress');
    for (const e of blocking) console.log(`BLOCKING: ${e.packet.session_id} (strict, in-progress)`);
    if (blocking.length > 0) process.exitCode = 1;
    return;
  }
  if (flags.json) {
    console.log(JSON.stringify(s, null, 2));
    return;
  }
  console.log(`Pending sessions: ${s.pending.length}`);
  for (const entry of s.pending) {
    console.log(`  - ${entry.packet.session_id} [${entry.packet.automation_status}] mode=${entry.packet.automation_mode} branch=${entry.packet.branch} stale_base=${entry.base_commit_stale}`);
  }
  console.log(`Stale locks: ${s.stale_locks.length}`);
}

function cmdRecover() {
  const results = recovery.recoverAll();
  console.log(JSON.stringify(results, null, 2));
}

function cmdDryRun(args) {
  const { positional } = parseFlags(args);
  let result;
  if (positional.length >= 2) {
    result = orchestrator.dryRunRange(positional[0], positional[1]);
  } else if (positional.length === 1 && evidencePacket.loadPacket(positional[0])) {
    result = orchestrator.dryRunSession(positional[0]);
  } else if (positional.length === 1) {
    result = orchestrator.dryRunRange(positional[0], 'HEAD');
  } else {
    result = orchestrator.dryRunSession(resolveSingleSession());
  }
  console.log('[dry-run] No files were written.');
  console.log(JSON.stringify({
    gate: result.gateResult,
    plan_summary: Object.fromEntries(Object.entries(result.plan).map(([k, v]) => [k, v.length])),
    classification: result.classification,
  }, null, 2));
}

function cmdReconcile() {
  const result = orchestrator.reconcile();
  console.log(`Reconcile: rebuild ${result.rebuildResult.ok ? 'ok' : 'FAILED'}, ${result.pending.length} pending session(s).`);
  if (!result.rebuildResult.ok) {
    console.error(result.rebuildResult.output);
    process.exitCode = 1;
  }
}

function cmdReleaseDraft(args) {
  const { positional } = parseFlags(args);
  if (positional.length === 0) {
    console.log('Usage: automation release-draft <fromRef> [toRef=HEAD]');
    process.exitCode = 1;
    return;
  }
  const fromRef = positional[0];
  const toRef = positional[1] || 'HEAD';
  const { mdPath, jsonPath } = releaseIntelligence.writeReleaseDraft(fromRef, toRef);
  console.log(`Wrote release draft: ${mdPath}\n${jsonPath}`);
  console.log('DRAFT ONLY — review before publishing; this command never creates a GitHub release.');
}

function cmdInstallHooks(args) {
  if (args.includes('--dry-run')) {
    console.log(JSON.stringify(installHooks.readiness(), null, 2));
    return;
  }
  console.log(JSON.stringify(installHooks.install(), null, 2));
}

// Prints ONLY the JSON result to stdout (mirroring cmdFinalize's own
// convention) so a caller capturing combined stdout+stderr on a non-zero
// exit — as tmpRepoHarness's `run()` and the version-controlled hook
// scripts both do — still gets parseable JSON. Human-readable remediation
// text lives inside the JSON's own `blocking[].message` fields; the shell
// hook prints its own short banner around this.
function cmdPreCommitGate() {
  const result = require('./hookAutomation').preCommitGate();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

function cmdPrePushGate() {
  const result = require('./hookAutomation').prePushGate();
  console.log(JSON.stringify(result, null, 2));
  // Printed to stderr, not stdout, so it stays visible in a developer's
  // terminal (the shell hook's combined output) without breaking anything
  // that parses stdout as pure JSON on the success path.
  if (result.uncommitted_canonical_changes_note) {
    console.error(`[autoingest-docs] NOTE: ${result.uncommitted_canonical_changes_note}`);
    for (const f of result.uncommitted_canonical_changes) console.error(`[autoingest-docs]   - ${f}`);
  }
  if (!result.ok) process.exitCode = 1;
}

function cmdPostCommitLink() {
  console.log(JSON.stringify(require('./hookAutomation').postCommitLink(), null, 2));
}

function cmdDecisionScan(args) {
  const decisionIntelligence = require('./decisionIntelligence');
  const { positional } = parseFlags(args);
  const sessionId = positional[0] || (() => {
    try { return resolveSingleSession(); } catch { return null; }
  })();
  if (!sessionId) {
    console.log('Usage: automation decision-scan <sessionId>  (or run with exactly one pending session)');
    process.exitCode = 1;
    return;
  }
  const found = evidencePacket.loadPacket(sessionId);
  if (!found) throw new Error(`No packet found for session ${sessionId}`);
  const result = decisionIntelligence.scanPacket(found.packet);
  if (result.state === 'draft' && found.dir === require('./paths').PENDING_DIR) {
    found.packet.architectural_decision_draft_id = result.decision_id;
    evidencePacket.persist(found.packet, { event: 'decision-scan' });
  }
  console.log(JSON.stringify(result, null, 2));
}

function cmdDecisionCandidates() {
  console.log(JSON.stringify(require('./decisionIntelligence').listCandidates(), null, 2));
}

function cmdOwnership(args) {
  if (args.length === 0) {
    console.log('Usage: automation ownership <path>');
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(require('./ownershipEngine').resolveOwnership(args[0]), null, 2));
}

function run(args) {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(HELP);
    return;
  }
  switch (sub) {
    case 'start': return cmdStart(rest);
    case 'update': return cmdUpdate(rest);
    case 'finalize': return cmdFinalize(rest);
    case 'status': return cmdStatus(rest);
    case 'recover': return cmdRecover();
    case 'dry-run': return cmdDryRun(rest);
    case 'reconcile': return cmdReconcile();
    case 'install-hooks': return cmdInstallHooks(rest);
    case 'uninstall-hooks': return console.log(JSON.stringify(installHooks.uninstall(), null, 2));
    case 'verify-hooks': return console.log(JSON.stringify(installHooks.verify(), null, 2));
    case 'release-draft': return cmdReleaseDraft(rest);
    case 'pre-commit-gate': return cmdPreCommitGate();
    case 'pre-push-gate': return cmdPrePushGate();
    case 'post-commit-link': return cmdPostCommitLink();
    case 'decision-scan': return cmdDecisionScan(rest);
    case 'decision-candidates': return cmdDecisionCandidates();
    case 'ownership': return cmdOwnership(rest);
    default:
      console.error(`Unknown automation subcommand: ${sub}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

module.exports = { run, HELP };
