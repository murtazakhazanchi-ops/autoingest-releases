'use strict';

// Thin command dispatcher for `node scripts/product-docs/cli.js memory <sub>`,
// mirroring automation/cli.js's own "dispatcher only, logic lives in
// automation/memory/*.js" convention. See
// scripts/product-docs/automation/memory/README.md for the full command
// reference and docs/product/16_ENGINEERING_MEMORY_POLICY.md for the policy
// these commands implement.

const fs = require('fs');
const path = require('path');
const memEvents = require('./memory/events');
const lifecycle = require('./memory/lifecycle');
const importAdapter = require('./memory/importAdapter');
const redactor = require('./memory/redactor');
const { REPO_ROOT } = require('./paths');
const evidencePacket = require('./evidencePacket');

const HELP = `memory — Part 6 Engineering Memory Layer

Usage: node scripts/product-docs/cli.js memory <sub> [args]

Subcommands:
  start --title "<title>" [--task-id <id>] [--source-tool <name>] [--link-packet <sessionId>]
  event --type <event_type> [sessionId] [--summary "..."] [--related <ID,ID>] [--json '<detail-json>']
  feedback [sessionId] --summary "..." [--area "..."] [--action "..."] [--outcome "..."] [--disposition accepted|partial|rejected] [--reason "..."]
  plan [sessionId] --summary "..." [--json '<detail-json>']
  revise-plan [sessionId] --summary "..." [--trigger "..."] [--prior "..."] [--revised "..."] [--reason "..."] [--status accepted|rejected|superseded|deferred]
  investigate [sessionId] --summary "..." [--files "..."] [--commands "..."]
  option --summary "..." [sessionId] [--json '<detail-json>']
  decide [sessionId] --summary "..." [--option-ref <id>] [--reject] [--reason "..."]
  test [sessionId] --summary "..." [--result "..."]
  screenshot [sessionId] --summary "..." [--asset-id <id>] [--before-after before|after]
  finalize [sessionId] [--title "..."] [--mode strict|standard|observe]
  reopen <AI-MEM-####> --summary "..."
  continue <AI-MEM-####> ...   (alias for reopen + event)
  status [--json]
  recover
  import --format markdown|json --file <path>
  query <text> | --feature ID | --bug ID | --decision ID | --commit <hash> | --rejected "<text>" | --feedback "<text>"
  show <AI-MEM-####>
  redact <AI-MEM-####> --text "<exact matched span>"
  supersede <AI-MEM-####> --summary "<what changed and why>"
  forget-local [sessionId]
  verify
  migrate --title "<title>" --source <path-to-draft-markdown>

Modes: STRICT/STANDARD/OBSERVE — same enum as \`automation <sub>\`, see docs/product/16_ENGINEERING_MEMORY_POLICY.md § 16.
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

function resolveSession(explicitId) {
  if (explicitId) return explicitId;
  const open = memEvents.listOpenSessions();
  if (open.length === 0) throw new Error('No open memory session — run "memory start" first, or pass a session ID explicitly.');
  if (open.length > 1) {
    const ids = open.map((s) => s.session_id).join(', ');
    throw new Error(`Multiple open memory sessions — pass one explicitly: ${ids}`);
  }
  return open[0].session_id;
}

function relatedIdsFlag(flags) {
  if (!flags.related) return [];
  return String(flags.related).split(',').map((s) => s.trim()).filter(Boolean);
}

function cmdStart(args) {
  const { flags } = parseFlags(args);
  if (flags.help) return console.log(HELP);
  if (!flags.title) throw new Error('memory start requires --title "<title>"');
  const result = lifecycle.start({
    title: flags.title,
    taskId: flags['task-id'],
    sourceTool: flags['source-tool'],
    linkedPacketSessionId: flags['link-packet'],
  });
  console.log(`Started memory session ${result.sessionId}`);
  console.log(JSON.stringify(result.event, null, 2));
}

function cmdEvent(args) {
  const { flags, positional } = parseFlags(args);
  if (!flags.type) throw new Error('memory event requires --type <event_type>');
  const sessionId = resolveSession(positional[0]);
  const detail = flags.json ? tryParseJson('json', flags.json) : {};
  const ev = memEvents.buildEvent({
    sessionId,
    type: flags.type,
    sourceTool: flags['source-tool'],
    sourceType: flags['source-type'],
    summary: flags.summary,
    relatedIds: relatedIdsFlag(flags),
    evidenceRefs: flags['evidence-ref'] ? [flags['evidence-ref']] : [],
    confidence: flags.confidence,
    detail,
  });
  memEvents.appendEvent(ev);
  console.log(`Recorded ${flags.type} event on session ${sessionId}.`);
  console.log(JSON.stringify(ev, null, 2));
}

function appendTypedEvent(sessionId, type, summary, detail, relatedIds) {
  const ev = memEvents.buildEvent({ sessionId, type, summary, detail, relatedIds: relatedIds || [] });
  return memEvents.appendEvent(ev);
}

function cmdFeedback(args) {
  const { flags, positional } = parseFlags(args);
  if (!flags.summary) throw new Error('memory feedback requires --summary "..."');
  const sessionId = resolveSession(positional[0]);
  const ev = appendTypedEvent(sessionId, 'user_feedback_received', flags.summary, {
    affected_area: flags.area, action_taken: flags.action, outcome: flags.outcome,
    disposition: flags.disposition, reasoning: flags.reason,
  });
  console.log(`Recorded user feedback on session ${sessionId}.`);
  console.log(JSON.stringify(ev, null, 2));
}

function cmdPlan(args) {
  const { flags, positional } = parseFlags(args);
  if (!flags.summary) throw new Error('memory plan requires --summary "..."');
  const sessionId = resolveSession(positional[0]);
  const detail = flags.json ? tryParseJson('json', flags.json) : { architecture: flags.summary };
  const ev = appendTypedEvent(sessionId, 'plan_created', flags.summary, detail);
  console.log(`Recorded plan on session ${sessionId}.`);
  console.log(JSON.stringify(ev, null, 2));
}

function cmdRevisePlan(args) {
  const { flags, positional } = parseFlags(args);
  if (!flags.summary) throw new Error('memory revise-plan requires --summary "..."');
  const sessionId = resolveSession(positional[0]);
  const ev = appendTypedEvent(sessionId, 'plan_revised', flags.summary, {
    trigger: flags.trigger, prior_approach: flags.prior, revised_approach: flags.revised || flags.summary,
    reason: flags.reason, status: flags.status || 'accepted',
  });
  console.log(`Recorded plan revision on session ${sessionId}.`);
  console.log(JSON.stringify(ev, null, 2));
}

function cmdInvestigate(args) {
  const { flags, positional } = parseFlags(args);
  if (!flags.summary) throw new Error('memory investigate requires --summary "..."');
  const sessionId = resolveSession(positional[0]);
  const ev = appendTypedEvent(sessionId, 'investigation_started', flags.summary, {
    files_inspected: flags.files, commands_run: flags.commands,
  });
  console.log(`Recorded investigation on session ${sessionId}.`);
  console.log(JSON.stringify(ev, null, 2));
}

function cmdOption(args) {
  const { flags, positional } = parseFlags(args);
  if (!flags.summary) throw new Error('memory option requires --summary "..."');
  const sessionId = resolveSession(positional[0]);
  const detail = flags.json ? tryParseJson('json', flags.json) : { benefits: flags.benefits, drawbacks: flags.drawbacks };
  const ev = appendTypedEvent(sessionId, 'option_considered', flags.summary, detail);
  console.log(`Recorded option on session ${sessionId}.`);
  console.log(JSON.stringify(ev, null, 2));
}

function cmdDecide(args) {
  const { flags, positional } = parseFlags(args);
  if (!flags.summary) throw new Error('memory decide requires --summary "..."');
  const sessionId = resolveSession(positional[0]);
  const type = flags.reject ? 'option_rejected' : 'decision_accepted';
  const ev = appendTypedEvent(sessionId, type, flags.summary, {
    option_ref: flags['option-ref'], reason: flags.reason,
  });
  console.log(`Recorded ${type} on session ${sessionId}.`);
  console.log(JSON.stringify(ev, null, 2));
}

function cmdTest(args) {
  const { flags, positional } = parseFlags(args);
  if (!flags.summary) throw new Error('memory test requires --summary "..."');
  const sessionId = resolveSession(positional[0]);
  const ev = appendTypedEvent(sessionId, 'test_run', flags.summary, { result: flags.result });
  console.log(`Recorded test run on session ${sessionId}.`);
  console.log(JSON.stringify(ev, null, 2));
}

function cmdScreenshot(args) {
  const { flags, positional } = parseFlags(args);
  if (!flags.summary) throw new Error('memory screenshot requires --summary "..."');
  const sessionId = resolveSession(positional[0]);
  const ev = appendTypedEvent(sessionId, 'screenshot_captured', flags.summary, {
    asset_id: flags['asset-id'], before_or_after: flags['before-after'],
    screen_context: flags.context, provenance: flags.provenance,
  });
  console.log(`Recorded screenshot reference on session ${sessionId}.`);
  console.log(JSON.stringify(ev, null, 2));
}

function cmdFinalize(args) {
  const { flags, positional } = parseFlags(args);
  const sessionId = resolveSession(positional[0]);
  let packet = null;
  const meta = memEvents.loadSessionMeta(sessionId);
  const linkedPacketId = meta && meta.linked_packet_session_id;
  if (linkedPacketId) {
    const found = evidencePacket.loadPacket(linkedPacketId);
    if (found) packet = found.packet;
  }
  const result = lifecycle.finalize(sessionId, { title: flags.title, packet, mode: flags.mode });
  if (result.created) {
    console.log(`Compiled ${result.capsuleId} — ${result.relPath}`);
    console.log(`Cross-linked features: ${result.crossLinkedFeatures.join(', ') || 'none'}`);
  } else if (result.alreadyCompiled) {
    console.log(`Session ${sessionId} already compiled as ${result.capsuleId} — no-op.`);
  } else if (result.observedOnly) {
    console.log('OBSERVE mode — capsule would be justified but nothing was written. Plan:');
    console.log(JSON.stringify(result.plan, null, 2));
  } else {
    console.log(`No capsule created — ${result.plan.reason}`);
  }
}

function cmdStatus(args) {
  const { flags } = parseFlags(args);
  const open = memEvents.listOpenSessions();
  if (flags.json) return console.log(JSON.stringify({ open }, null, 2));
  console.log(`Open memory sessions: ${open.length}`);
  for (const s of open) console.log(`  - ${s.session_id} [${s.status}]${s.memory_capsule_id ? ` -> ${s.memory_capsule_id}` : ''}`);
}

function cmdImport(args) {
  const { flags } = parseFlags(args);
  if (!flags.format || !flags.file) throw new Error('memory import requires --format markdown|json and --file <path>');
  const result = importAdapter.importFile(flags.format, flags.file);
  console.log(`Imported ${flags.format} artifact as ${result.importId}`);
}

function cmdVerify() {
  const memRoot = path.join(REPO_ROOT, 'docs', 'product', 'memory');
  if (!fs.existsSync(memRoot)) {
    console.log('No docs/product/memory/ capsules yet — nothing to verify.');
    return;
  }
  let hits = 0;
  for (const f of fs.readdirSync(memRoot)) {
    if (!f.endsWith('.md') || f === 'README.md' || f === 'INDEX.md') continue;
    const content = fs.readFileSync(path.join(memRoot, f), 'utf8');
    const scan = redactor.scanForSecrets(content);
    if (scan.length) {
      hits++;
      console.error(`POSSIBLE SECRET in ${f} — run: node scripts/product-docs/cli.js memory redact AI-MEM-#### --text "<span>"`);
    }
  }
  console.log(hits === 0 ? 'verify: no obvious secret patterns found in committed capsules.' : `verify: ${hits} capsule(s) flagged.`);
  if (hits > 0) process.exitCode = 1;
}

function cmdShow(args) {
  const { positional } = parseFlags(args);
  const id = positional[0];
  if (!id) throw new Error('Usage: memory show <AI-MEM-####>');
  const memRoot = path.join(REPO_ROOT, 'docs', 'product', 'memory');
  const match = fs.existsSync(memRoot) ? fs.readdirSync(memRoot).find((f) => f.startsWith(`${id}_`)) : null;
  if (!match) {
    console.log(`No capsule found for ${id}.`);
    process.exitCode = 1;
    return;
  }
  console.log(fs.readFileSync(path.join(memRoot, match), 'utf8'));
}

function cmdRecover() {
  const open = memEvents.listOpenSessions();
  console.log(`${open.length} open memory session(s) found — no crash-recovery action needed beyond re-running "memory finalize <sessionId>" for any that should have compiled.`);
  console.log(JSON.stringify(open, null, 2));
}

function cmdForgetLocal(args) {
  const { positional } = parseFlags(args);
  const sessionId = positional[0];
  const { RAW_DIR } = require('./memory/paths');
  if (!fs.existsSync(RAW_DIR)) return console.log('Nothing to forget — no raw memory state exists.');
  let removed = 0;
  for (const f of fs.readdirSync(RAW_DIR)) {
    if (sessionId && !f.startsWith(sessionId)) continue;
    const meta = f.endsWith('.meta.json') ? JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8')) : null;
    if (meta && meta.memory_capsule_id) continue; // never touches anything that produced a committed canonical capsule
    fs.unlinkSync(path.join(RAW_DIR, f));
    removed++;
  }
  console.log(`forget-local removed ${removed} raw local file(s). Canonical docs/product/memory/ capsules are never affected by this command.`);
}

function cmdRedact(args) {
  const { flags, positional } = parseFlags(args);
  const id = positional[0];
  if (!id || !flags.text) throw new Error('Usage: memory redact <AI-MEM-####> --text "<exact matched span>"');
  const memRoot = path.join(REPO_ROOT, 'docs', 'product', 'memory');
  const match = fs.existsSync(memRoot) && fs.readdirSync(memRoot).find((f) => f.startsWith(`${id}_`));
  if (!match) throw new Error(`No capsule found for ${id}.`);
  const filePath = path.join(memRoot, match);
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes(flags.text)) {
    console.log('No exact match for the given --text in this capsule — nothing changed.');
    return;
  }
  const { atomicWriteFileSync } = require('./atomicWrite');
  atomicWriteFileSync(filePath, content.split(flags.text).join('[REDACTED — see explicit redaction record]'));
  console.log(`Redacted the given span from ${id}. This is an explicit, auditable edit — not a silent rewrite (git history retains the prior version).`);
}

function cmdSupersede(args) {
  const { flags, positional } = parseFlags(args);
  const id = positional[0];
  if (!id || !flags.summary) throw new Error('Usage: memory supersede <AI-MEM-####> --summary "<what changed and why>"');
  const memRoot = path.join(REPO_ROOT, 'docs', 'product', 'memory');
  const match = fs.existsSync(memRoot) && fs.readdirSync(memRoot).find((f) => f.startsWith(`${id}_`));
  if (!match) throw new Error(`No capsule found for ${id}.`);
  const filePath = path.join(memRoot, match);
  const content = fs.readFileSync(filePath, 'utf8');
  const line = `- **Superseded note** (${new Date().toISOString().slice(0, 10)}): ${flags.summary}`;
  const { appendLineToSection } = require('./markdownSections');
  const { atomicWriteFileSync } = require('./atomicWrite');
  const updated = appendLineToSection(content, 'Lessons', line);
  atomicWriteFileSync(filePath, updated);
  console.log(`Appended a supersession note to ${id} (original text preserved — Append, Never Erase).`);
}

function cmdReopen(args) {
  const { flags, positional } = parseFlags(args);
  const id = positional[0];
  if (!id || !flags.summary) throw new Error('Usage: memory reopen <AI-MEM-####> --summary "..."');
  const memRoot = path.join(REPO_ROOT, 'docs', 'product', 'memory');
  const match = fs.existsSync(memRoot) && fs.readdirSync(memRoot).find((f) => f.startsWith(`${id}_`));
  if (!match) throw new Error(`No capsule found for ${id}.`);
  const filePath = path.join(memRoot, match);
  const content = fs.readFileSync(filePath, 'utf8');
  const line = `- **Reopened** (${new Date().toISOString().slice(0, 10)}): ${flags.summary}`;
  const { appendLineToSection } = require('./markdownSections');
  const { atomicWriteFileSync } = require('./atomicWrite');
  const updated = appendLineToSection(content, 'Evolution Timeline', line);
  atomicWriteFileSync(filePath, updated.replace(/\| Status \| .+ \|/, '| Status | Reopened |'));
  console.log(`Reopened ${id} with a new Evolution Timeline entry. Start a new "memory start" session to continue capturing events for this story, then link back via "memory continue ${id}".`);
}

function cmdMigrate(args) {
  const { flags } = parseFlags(args);
  if (!flags.title) throw new Error('memory migrate requires --title "<title>" (and, optionally, --source <path> for reference — migration itself is manual per docs/product/16_ENGINEERING_MEMORY_POLICY.md § 17)');
  console.log('memory migrate is a documented workflow, not a fully automatic one — see docs/product/16_ENGINEERING_MEMORY_POLICY.md § 17.');
  console.log('1. Gather already-documented evidence: the feature file(s), bug/decision/postmortem records, 10_CHANGELOG.md, .claude/learning-log.md, and `git log` for the relevant commits.');
  console.log('2. Author a capsule Markdown file by hand following docs/product/15_MEMORY_TEMPLATE.md, marking every section not recoverable from that evidence as "Evidence pending — source conversation unavailable".');
  console.log('3. Allocate its ID via the same mechanism as a live session: automation/memory/allocator.js\'s allocateTemplatedCapsule (see AI-MEM-0001 for the reference implementation of this exact flow).');
  console.log('4. Run `node scripts/product-docs/cli.js build && node scripts/product-docs/cli.js validate`.');
}

function run(args) {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(HELP);
    return;
  }
  switch (sub) {
    case 'start': return cmdStart(rest);
    case 'event': return cmdEvent(rest);
    case 'feedback': return cmdFeedback(rest);
    case 'plan': return cmdPlan(rest);
    case 'revise-plan': return cmdRevisePlan(rest);
    case 'investigate': return cmdInvestigate(rest);
    case 'option': return cmdOption(rest);
    case 'decide': return cmdDecide(rest);
    case 'test': return cmdTest(rest);
    case 'screenshot': return cmdScreenshot(rest);
    case 'finalize': return cmdFinalize(rest);
    case 'reopen': return cmdReopen(rest);
    case 'continue': return cmdReopen(rest); // alias — see HELP
    case 'status': return cmdStatus(rest);
    case 'recover': return cmdRecover();
    case 'import': return cmdImport(rest);
    case 'show': return cmdShow(rest);
    case 'redact': return cmdRedact(rest);
    case 'supersede': return cmdSupersede(rest);
    case 'forget-local': return cmdForgetLocal(rest);
    case 'verify': return cmdVerify();
    case 'migrate': return cmdMigrate(rest);
    case 'query': {
      const memoryQuery = require('./memory/query');
      return memoryQuery.run(rest);
    }
    default:
      console.error(`Unknown memory subcommand: ${sub}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

module.exports = { run, HELP, parseFlags };
