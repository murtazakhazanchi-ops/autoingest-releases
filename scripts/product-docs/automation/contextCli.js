'use strict';

// Part 7E — thin dispatcher for `node scripts/product-docs/cli.js context <sub>`,
// mirroring this tool's existing "dispatcher thin, logic in a module"
// convention. All bundle-building logic lives in contextEngine.js.

const contextEngine = require('./contextEngine');

const HELP = `context — Part 7E universal repository engineering assistant

Usage: node scripts/product-docs/cli.js context <sub> <input> [--json]

Subcommands:
  feature AI-FEAT-###
  subsystem <name>
  file <path>
  roadmap AI-RM-###
  bug BUG-###
  decision DEC-###
  postmortem PM-###
  memory AI-MEM-####
  conversation ENG-CONV-####
  release <tag | A..B>
  task "<natural-language task>"
  explain "<question>"
  bundle --feature AI-FEAT-### | --file <path>

Output is Markdown by default; pass --json for structured JSON. Deterministic
token/alias matching only — no embeddings, no external AI, no network.

Recommended agent instruction: "Before planning, run the repository context
command for the task and then read the returned canonical documents."
`;

function renderValue(v) {
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'None.';
  if (v && typeof v === 'object') return '```json\n' + JSON.stringify(v, null, 2) + '\n```';
  return v === null || v === undefined || v === '' ? 'None.' : String(v);
}

const SKIP_KEYS = new Set(['kind', 'id', 'found', 'authority_order', 'provenance', 'truncation_notices', 'generated_at']);

function renderBundleMd(bundle) {
  const lines = [];
  lines.push(`# Context — ${bundle.kind} ${bundle.id}`);
  lines.push('');
  if (!bundle.found) {
    lines.push(`**Not found.** ${bundle.note || ''}`);
    lines.push('');
    lines.push('## Authority Order');
    for (const a of bundle.authority_order || []) lines.push(`- ${a}`);
    return lines.join('\n') + '\n';
  }
  lines.push('## Authority Order');
  for (const a of bundle.authority_order) lines.push(`- ${a}`);
  lines.push('');
  for (const [key, value] of Object.entries(bundle)) {
    if (SKIP_KEYS.has(key)) continue;
    const heading = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    lines.push(`## ${heading}`);
    lines.push(renderValue(value));
    lines.push('');
  }
  lines.push('## Provenance');
  lines.push(renderValue(bundle.provenance));
  if (bundle.truncation_notices && bundle.truncation_notices.length) {
    lines.push('');
    lines.push('## Truncation Notices');
    for (const n of bundle.truncation_notices) lines.push(`- ${n}`);
  }
  return lines.join('\n') + '\n';
}

function output(bundle, { json }) {
  if (json) {
    console.log(JSON.stringify(bundle, null, 2));
    return;
  }
  console.log(renderBundleMd(bundle));
}

function parseArgs(args) {
  const positional = [];
  const flags = {};
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
  return { positional, flags };
}

function run(args) {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(HELP);
    return;
  }
  const { positional, flags } = parseArgs(rest);
  const asJson = !!flags.json;

  const simpleKinds = ['feature', 'subsystem', 'file', 'roadmap', 'bug', 'decision', 'postmortem', 'memory', 'conversation', 'release', 'task', 'explain'];
  if (simpleKinds.includes(sub)) {
    if (positional.length === 0) {
      console.log(`Usage: context ${sub} <input> [--json]`);
      process.exitCode = 1;
      return;
    }
    const bundle = contextEngine.buildContext(sub, positional.join(' '));
    output(bundle, { json: asJson });
    if (!bundle.found) process.exitCode = 1;
    return;
  }
  if (sub === 'bundle') {
    const bundle = contextEngine.buildBundle({ feature: flags.feature, file: flags.file });
    output(bundle, { json: asJson });
    if (!bundle.found) process.exitCode = 1;
    return;
  }
  console.error(`Unknown context subcommand: ${sub}\n`);
  console.log(HELP);
  process.exitCode = 1;
}

module.exports = { run, HELP };
