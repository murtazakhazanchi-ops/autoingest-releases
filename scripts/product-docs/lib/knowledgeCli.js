'use strict';

// Stage 1 Knowledge Engine — thin dispatcher for
// `node scripts/product-docs/cli.js knowledge <sub>`, mirroring this tool's
// existing "dispatcher thin, logic in a module" convention (see
// automation/contextCli.js). All retrieval/answer logic lives in
// knowledgeEngine.js; all eval-corpus logic lives in knowledgeEval.js.

const build = require('./build');
const { answerQuestion, buildEngineContext } = require('./knowledgeEngine');
const { runEval } = require('./knowledgeEval');

const HELP = `knowledge — Stage 1 AutoIngest Knowledge Engine prototype (AI-FEAT-058)

Usage: node scripts/product-docs/cli.js knowledge <sub> [args]

Subcommands:
  ask "<question>" [--json]     Answer a natural-language operator question
  eval [--out <path>]           Run the 20-question test corpus, print
                                 expected-vs-actual, write a knowledge-gap
                                 report (default:
                                 docs/product/generated/knowledge-gap-report.json)
  serve [--port 5177]           Serve the minimal local static portal
                                 (Node core http only, no dependencies)

Deterministic retrieval only — reuses lib/query.js's existing ranker
unchanged. No embeddings, no external AI, no network calls other than the
local server binding itself to localhost.
`;

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

function renderAnswerText(answer) {
  const lines = [];
  lines.push(`Query: ${answer.query}`);
  lines.push(`Classification: ${answer.classification}`);
  lines.push(`Capability status: ${answer.capabilityStatus}`);
  lines.push(`Confidence: ${answer.confidence}`);
  lines.push('');
  lines.push(answer.directAnswer);
  if (answer.guidance) {
    lines.push('');
    lines.push(`Guidance: ${answer.guidance}`);
  }
  if (answer.limitations.length) {
    lines.push('');
    lines.push('Limitations:');
    for (const l of answer.limitations) lines.push(`  - ${l}`);
  }
  if (answer.relatedCapabilities.length) {
    lines.push('');
    lines.push(`Related capabilities: ${answer.relatedCapabilities.join(', ')}`);
  }
  lines.push('');
  lines.push('Sources:');
  if (answer.sources.length) {
    for (const s of answer.sources) lines.push(`  - ${s.id}${s.title ? ` — ${s.title}` : ''}${s.path ? ` (${s.path})` : ''}`);
  } else {
    lines.push('  (none — no confident match)');
  }
  return lines.join('\n') + '\n';
}

function cmdAsk(args) {
  const { positional, flags } = parseArgs(args);
  if (!positional.length || flags.help) {
    console.log(`Usage: knowledge ask "<question>" [--json]`);
    if (!positional.length) process.exitCode = 1;
    return;
  }
  const question = positional.join(' ');
  const { built } = build.assemble();
  const answer = answerQuestion(question, buildEngineContext(built));
  if (flags.json) {
    console.log(JSON.stringify(answer, null, 2));
  } else {
    console.log(renderAnswerText(answer));
  }
}

function cmdEval(args) {
  const { flags } = parseArgs(args);
  const result = runEval({ outPath: flags.out });
  console.log(result.table);
  console.log(`\n${result.summary}`);
  console.log(`Wrote ${result.outPath}`);
  if (result.failures.length) {
    console.error(`\n${result.failures.length} question(s) did not match expectations — see table above.`);
    process.exitCode = 1;
  }
}

function cmdServe(args) {
  const { flags } = parseArgs(args);
  const port = Number(flags.port) || 5177;
  require('../knowledge-portal/server').startServer(port);
}

function run(args) {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(HELP);
    return;
  }
  switch (sub) {
    case 'ask': return cmdAsk(rest);
    case 'eval': return cmdEval(rest);
    case 'serve': return cmdServe(rest);
    default:
      console.error(`Unknown knowledge subcommand: ${sub}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

module.exports = { run, HELP, renderAnswerText };
