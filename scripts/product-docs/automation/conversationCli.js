'use strict';

// Thin command dispatcher for `node scripts/product-docs/cli.js conversation <sub>`,
// mirroring memoryCli.js's own "dispatcher only, logic lives in
// automation/conversation/*.js" convention. See
// docs/product/conversations/README.md for the full command reference and
// docs/product/18_ENGINEERING_CONVERSATION_POLICY.md for the policy these
// commands implement.

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, INBOX_DIR, PROCESSING_DIR, AUDIT_DIR } = require('./conversation/paths');
const lifecycle = require('./conversation/lifecycle');
const conversationQuery = require('./conversation/query');

const HELP = `conversation — Part 8 Multi-AI Engineering Conversation Integration

Usage: node scripts/product-docs/cli.js conversation <sub> [args]

Subcommands:
  import --format ecp|markdown|json --file <path> [--mode strict|standard|observe] [--json]
  validate --format ecp|markdown|json --file <path>
  preview --format ecp|markdown|json --file <path> [--json]
  finalize <importId>            Retry a staged import stuck in processing/ (recovery path)
  status [--json]                Lists staged (processing/) imports and inbox count
  inbox                          Lists files currently in the local inbox
  process-inbox [--mode strict|standard|observe]
  watch-status                   One-shot status of the last inbox-processing audit runs (not a daemon)
  query <text> | --feature ID | --bug ID | --decision ID | --memory ID
  show <ENG-CONV-####>
  link <ENG-CONV-####> --feature|--decision|--bug|--memory|--conversation ID
  supersede <ENG-CONV-####> --summary "<what changed and why>"
  redact <ENG-CONV-####> --text "<exact matched span>"
  forget-local [importId]
  verify

Modes: STRICT/STANDARD/OBSERVE — same enum as \`automation <sub>\`, see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 18.
`;

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function conversationDocsRoot() {
  return path.join(REPO_ROOT, 'docs', 'product', 'conversations');
}

function findConversationFile(id) {
  const root = conversationDocsRoot();
  return fs.existsSync(root) ? fs.readdirSync(root).find((f) => f.startsWith(`${id}_`)) : null;
}

function cmdImport(args) {
  const { flags } = parseFlags(args);
  if (flags.help) return console.log(HELP);
  if (!flags.format || !flags.file) throw new Error('conversation import requires --format ecp|markdown|json and --file <path>');
  const result = lifecycle.importPacket({ format: flags.format, filePath: flags.file, mode: flags.mode });
  if (flags.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`Import ${result.status}${result.conversationId ? ` — ${result.conversationId} (${result.path})` : ''}${result.reason ? `: ${result.reason}` : ''}${result.duplicateOf ? ` — duplicate of ${result.duplicateOf}` : ''}`);
  if (result.decisionLink) console.log(`Decision linkage: ${result.decisionLink.state}${result.decisionLink.decision_id ? ` (${result.decisionLink.decision_id})` : ''}`);
  if (result.memoryLink) console.log(`Memory linkage: ${result.memoryLink.state}${result.memoryLink.memory_id ? ` (${result.memoryLink.memory_id})` : ''}`);
}

function cmdValidate(args) {
  const { flags } = parseFlags(args);
  if (!flags.format || !flags.file) throw new Error('conversation validate requires --format ecp|markdown|json and --file <path>');
  const result = lifecycle.validatePacket({ format: flags.format, filePath: flags.file });
  console.log(JSON.stringify(result, null, 2));
}

function cmdPreview(args) {
  const { flags } = parseFlags(args);
  if (!flags.format || !flags.file) throw new Error('conversation preview requires --format ecp|markdown|json and --file <path>');
  const result = lifecycle.previewPacket({ format: flags.format, filePath: flags.file });
  if (flags.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`Would import: ${result.would_import}`);
  console.log(`Significance: ${result.significance.reason}`);
  console.log(`Ownership (primary features): ${result.ownership.primary_feature_ids.join(', ') || 'None'}`);
  if (result.duplicate) console.log(`Duplicate of: ${result.duplicate.conversation_id}`);
  if (result.continuation) console.log(`Possible continuation of: ${result.continuation.conversation_id} (score ${result.continuation.score})`);
  if (result.secret_pattern_hits) console.log(`WARNING: ${result.secret_pattern_hits} possible secret pattern(s) detected — will be redacted on import.`);
}

function cmdFinalize(args) {
  const { positional } = parseFlags(args);
  const importId = positional[0];
  if (!importId) throw new Error('Usage: conversation finalize <importId>');
  // Validated against the exact shape lifecycle.js#newImportId produces —
  // a raw CLI argument spliced into a filesystem path must never be
  // trusted as-is, even for a local-operator-only command (found in Part 8
  // security review: every other entry point routes through
  // fileLoader.js's boundary/size/depth checks; this one built a path
  // directly from unvalidated input).
  if (!/^imp-\d+-[0-9a-f]{6}$/.test(importId)) {
    throw new Error(`Invalid import ID "${importId}" — expected the shape produced by "conversation import" (e.g. imp-1700000000000-abc123).`);
  }
  const stagedPath = path.join(PROCESSING_DIR, `${importId}.json`);
  if (!fs.existsSync(stagedPath)) throw new Error(`No staged import ${importId} found in processing/ — nothing to retry.`);
  const staged = JSON.parse(fs.readFileSync(stagedPath, 'utf8'));
  const result = lifecycle.importPacket({ format: staged.format, raw: JSON.stringify(staged.packet), sourceLabel: staged.source_file, mode: staged.mode });
  console.log(JSON.stringify(result, null, 2));
}

function cmdStatus(args) {
  const { flags } = parseFlags(args);
  const processing = fs.existsSync(PROCESSING_DIR) ? fs.readdirSync(PROCESSING_DIR).filter((f) => f.endsWith('.json')) : [];
  const inbox = lifecycle.listInbox();
  if (flags.json) return console.log(JSON.stringify({ processing, inbox }, null, 2));
  console.log(`Staged (processing) imports: ${processing.length}`);
  for (const f of processing) console.log(`  - ${f.replace(/\.json$/, '')}`);
  console.log(`Inbox files: ${inbox.length}`);
}

function cmdInbox() {
  const files = lifecycle.listInbox();
  console.log(`${files.length} file(s) in .autoingest-docs/conversations/inbox/`);
  for (const f of files) console.log(`  - ${f}`);
}

function cmdProcessInbox(args) {
  const { flags } = parseFlags(args);
  const results = lifecycle.processInbox({ mode: flags.mode });
  console.log(JSON.stringify(results, null, 2));
  console.log(`Processed ${results.length} inbox file(s).`);
}

// One-shot status of the last processing runs — NOT a long-running watcher.
// docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 16 deliberately
// avoids a daemon; this is the process-on-demand equivalent.
function cmdWatchStatus() {
  const auditPath = path.join(AUDIT_DIR, 'runs.jsonl');
  if (!fs.existsSync(auditPath)) {
    console.log('No conversation import runs recorded yet.');
    return;
  }
  const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).slice(-10);
  console.log(`Last ${lines.length} conversation import run(s) (this is a one-shot status check, not a running watcher):`);
  for (const line of lines) {
    const entry = JSON.parse(line);
    console.log(`  - ${entry.at} [${entry.outcome}] ${entry.conversation_id || entry.import_id}`);
  }
}

function cmdQuery(args) {
  conversationQuery.run(args);
}

function cmdShow(args) {
  const { positional } = parseFlags(args);
  const id = positional[0];
  if (!id) throw new Error('Usage: conversation show <ENG-CONV-####>');
  const match = findConversationFile(id);
  if (!match) {
    console.log(`No conversation record found for ${id}.`);
    process.exitCode = 1;
    return;
  }
  console.log(fs.readFileSync(path.join(conversationDocsRoot(), match), 'utf8'));
}

function cmdLink(args) {
  const { flags, positional } = parseFlags(args);
  const id = positional[0];
  const targetField = flags.feature ? ['Primary feature IDs', flags.feature]
    : flags.decision ? ['Related decisions', flags.decision]
    : flags.bug ? ['Related bugs', flags.bug]
    : flags.memory ? ['Related memory capsules', flags.memory]
    : flags.conversation ? ['Related conversations', flags.conversation]
    : null;
  if (!id || !targetField) throw new Error('Usage: conversation link <ENG-CONV-####> --feature|--decision|--bug|--memory|--conversation <ID>');
  const [fieldName, newId] = targetField;
  // A raw CLI value spliced into a Markdown table row must be a real,
  // well-formed stable ID — never arbitrary text (found in Part 8 security
  // review: an unvalidated value containing '|' or a newline could corrupt
  // the table row structure).
  if (!require('../lib/ids').idType(newId)) {
    throw new Error(`"${newId}" is not a recognized stable ID (AI-FEAT-###, AI-RM-###, BUG-###, DEC-###, AI-MEM-####, or ENG-CONV-####).`);
  }
  const match = findConversationFile(id);
  if (!match) throw new Error(`No conversation record found for ${id}.`);
  const filePath = path.join(conversationDocsRoot(), match);
  const content = fs.readFileSync(filePath, 'utf8');
  const re = new RegExp(`(\\| ${fieldName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')} \\|)([^|\\n]*)(\\|)`);
  const m = re.exec(content);
  if (!m) throw new Error(`Could not find the "${fieldName}" row in ${id}'s Relationships table.`);
  const current = m[2].trim();
  const currentIds = current === 'None' || !current ? [] : current.split(',').map((s) => s.trim());
  const merged = currentIds.includes(newId) ? current : [...currentIds, newId].join(', ');
  // A replacer FUNCTION, never a string with interpolated data — a string
  // replacement is subject to JS's special $&/$`/$'/$$/$<n> sequences, so a
  // newId containing e.g. "$'" would splice in unrelated trailing document
  // text instead of the literal value (found in Part 8 security review).
  // idType()'s validation above already rules this out for any currently
  // valid ID shape, but the replacer function is the structural fix, not
  // merely a consequence of that validation.
  const updated = content.replace(re, (matched, g1, g2, g3) => `${g1} ${merged} ${g3}`);
  const { atomicWriteFileSync } = require('./atomicWrite');
  atomicWriteFileSync(filePath, updated);
  console.log(`Linked ${newId} into ${id}'s "${fieldName}".`);
}

function cmdSupersede(args) {
  const { flags, positional } = parseFlags(args);
  const id = positional[0];
  if (!id || !flags.summary) throw new Error('Usage: conversation supersede <ENG-CONV-####> --summary "<what changed and why>"');
  const match = findConversationFile(id);
  if (!match) throw new Error(`No conversation record found for ${id}.`);
  const filePath = path.join(conversationDocsRoot(), match);
  const content = fs.readFileSync(filePath, 'utf8');
  const line = `- **${new Date().toISOString().slice(0, 10)}** — Superseded note: ${flags.summary}`;
  const { appendLineToSection } = require('./markdownSections');
  const { atomicWriteFileSync } = require('./atomicWrite');
  const updated = appendLineToSection(content, 'Outcome', line);
  atomicWriteFileSync(filePath, updated);
  console.log(`Appended a supersession note to ${id}'s Outcome log (original text preserved — Append, Never Erase).`);
}

function cmdRedact(args) {
  const { flags, positional } = parseFlags(args);
  const id = positional[0];
  if (!id || !flags.text) throw new Error('Usage: conversation redact <ENG-CONV-####> --text "<exact matched span>"');
  const match = findConversationFile(id);
  if (!match) throw new Error(`No conversation record found for ${id}.`);
  const filePath = path.join(conversationDocsRoot(), match);
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes(flags.text)) {
    console.log('No exact match for the given --text in this record — nothing changed.');
    return;
  }
  const { atomicWriteFileSync } = require('./atomicWrite');
  atomicWriteFileSync(filePath, content.split(flags.text).join('[REDACTED — see explicit redaction record]'));
  console.log(`Redacted the given span from ${id}. This is an explicit, auditable edit — not a silent rewrite (git history retains the prior version).`);
}

function cmdForgetLocal(args) {
  const { positional } = parseFlags(args);
  const importId = positional[0];
  const { PROCESSING_DIR: procDir, IMPORTED_DIR, REJECTED_DIR, DUPLICATES_DIR, FAILED_DIR } = require('./conversation/paths');
  let removed = 0;
  for (const dir of [procDir, REJECTED_DIR, DUPLICATES_DIR, FAILED_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (importId && !f.startsWith(importId)) continue;
      fs.unlinkSync(path.join(dir, f));
      removed++;
    }
  }
  // imported/ is deliberately excluded from bulk removal without an
  // explicit importId — it's the record of what became canonical, kept
  // longer by default; forget-local never touches docs/product/conversations/
  // itself regardless of arguments.
  if (importId) {
    const p = path.join(IMPORTED_DIR, `${importId}.json`);
    if (fs.existsSync(p)) { fs.unlinkSync(p); removed++; }
  }
  console.log(`forget-local removed ${removed} raw local file(s). Canonical docs/product/conversations/ records are never affected by this command.`);
}

function cmdVerify() {
  const root = conversationDocsRoot();
  if (!fs.existsSync(root)) {
    console.log('No docs/product/conversations/ records yet — nothing to verify.');
    return;
  }
  const { scanForSecrets } = require('./conversation/redactor');
  let hits = 0;
  for (const f of fs.readdirSync(root)) {
    if (!f.endsWith('.md') || f === 'README.md' || f === 'INDEX.md') continue;
    const content = fs.readFileSync(path.join(root, f), 'utf8');
    if (scanForSecrets(content).length) {
      hits++;
      console.error(`POSSIBLE SECRET in ${f} — run: node scripts/product-docs/cli.js conversation redact <ID> --text "<span>"`);
    }
  }
  console.log(hits === 0 ? 'verify: no obvious secret patterns found in committed conversation records.' : `verify: ${hits} record(s) flagged.`);
  if (hits > 0) process.exitCode = 1;
}

function run(args) {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(HELP);
    return;
  }
  switch (sub) {
    case 'import': return cmdImport(rest);
    case 'validate': return cmdValidate(rest);
    case 'preview': return cmdPreview(rest);
    case 'finalize': return cmdFinalize(rest);
    case 'status': return cmdStatus(rest);
    case 'inbox': return cmdInbox();
    case 'process-inbox': return cmdProcessInbox(rest);
    case 'watch-status': return cmdWatchStatus();
    case 'query': return cmdQuery(rest);
    case 'show': return cmdShow(rest);
    case 'link': return cmdLink(rest);
    case 'supersede': return cmdSupersede(rest);
    case 'redact': return cmdRedact(rest);
    case 'forget-local': return cmdForgetLocal(rest);
    case 'verify': return cmdVerify();
    default:
      console.error(`Unknown conversation subcommand: ${sub}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

module.exports = { run, HELP, parseFlags };
