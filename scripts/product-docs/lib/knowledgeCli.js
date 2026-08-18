'use strict';

// Stage 1 Knowledge Engine — thin dispatcher for
// `node scripts/product-docs/cli.js knowledge <sub>`, mirroring this tool's
// existing "dispatcher thin, logic in a module" convention (see
// automation/contextCli.js). All retrieval/answer logic lives in
// knowledgeEngine.js; all eval-corpus logic lives in knowledgeEval.js.

const build = require('./build');
const { answerQuestion, buildEngineContext } = require('./knowledgeEngine');
const { runEval, runEvalV2, runHardenedEval } = require('./knowledgeEval');

const HELP = `knowledge — AutoIngest Knowledge Engine (AI-FEAT-058, Stage 1 + Stage 2)

Usage: node scripts/product-docs/cli.js knowledge <sub> [args]

Subcommands:
  ask "<question>" [--json]     Answer a natural-language operator question
  eval [--out <path>]           Run the Stage 1 20-question test corpus,
                                 print expected-vs-actual, write a
                                 knowledge-gap report (default:
                                 docs/product/generated/knowledge-gap-report.json)
  eval-v2 [--out <path>]        Run the Stage 2 Phase 20 expanded 99-question
                                 corpus (paraphrase families, Online Registry/
                                 teamwork/offline coverage, adversarial cases —
                                 knowledgeTestCorpusV2.js), write a separate
                                 gap report (default:
                                 docs/product/generated/knowledge-gap-report-v2.json)
  eval-hardened [--out <path>]  Part 3 Phase 4.1 (Decision 7) — re-runs the
                                 full 119-question V1+V2 corpus unchanged
                                 (regression proof) plus the new decision-
                                 specific regression-family corpus
                                 (knowledgeRegressionCorpusV3.js) through the
                                 hardened evaluator, writes the frozen
                                 baseline snapshot every later phase's
                                 Improvement/Acceptable/Regression
                                 classification compares against (default:
                                 docs/product/generated/knowledge-eval-hardened-baseline.json)
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

// Part 5 Phase 5.3 Decision B (Product Owner directive) — a concise,
// non-rewriting excerpt of a Memory capsule's own evidence-classification
// text. Truncation (never paraphrase, never a summary in different words)
// is the only operation applied, so the qualification is never rewritten or
// upgraded in meaning — just shortened to fit a one-line Sources entry, with
// an ellipsis marking that more detail exists (full text remains available
// verbatim via `--json`/`/api/ask`).
const EVIDENCE_QUALIFICATION_EXCERPT_LENGTH = 70;
function excerptEvidenceQualification(text) {
  const s = String(text || '');
  if (s.length <= EVIDENCE_QUALIFICATION_EXCERPT_LENGTH) return s;
  const cut = s.slice(0, EVIDENCE_QUALIFICATION_EXCERPT_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + '...';
}

// Renders one sources[] line, marking historical-context entries distinctly
// from ordinary current sources (Decision 5's "visibly subordinate"
// requirement) using ONLY the already-existing `role`/`evidenceQualification`
// fields lib/knowledgeHistoricalContext.js already attaches — no new answer
// field added for rendering.
function formatSourceLine(s) {
  const base = `  - ${s.id}${s.title ? ` — ${s.title}` : ''}${s.path ? ` (${s.path})` : ''}`;
  if (s.role !== 'historical-context') return base;
  const evidence = s.evidenceQualification ? ` (evidence: ${excerptEvidenceQualification(s.evidenceQualification)})` : '';
  return `${base} [historical context]${evidence}`;
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
    for (const s of answer.sources) lines.push(formatSourceLine(s));
  } else {
    lines.push('  (none — no confident match)');
  }
  // Part 5 Phase 5.3 Decision C materiality safety closure (Product Owner
  // directive) — unanchored Architecture/Memory historical context is
  // deliberately NEVER attached to the real answer object (retrieved !=
  // material != admitted; see lib/knowledgeEngine.js's own header comment
  // on reconcileUnknownEvidenceWording for the full rationale). There is
  // therefore nothing to render here beyond ordinary Sources: above — the
  // withheld candidates remain inspectable only via the diagnostic seam
  // (explainHistoricalContext()), never the public CLI/portal output.
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

function cmdEvalV2(args) {
  const { flags } = parseArgs(args);
  const result = runEvalV2({ outPath: flags.out });
  console.log(result.table);
  console.log(`\n${result.summary}`);
  console.log(`Wrote ${result.outPath}`);
  if (result.failures.length) {
    console.error(`\n${result.failures.length} question(s) did not match expectations — see table above.`);
    process.exitCode = 1;
  }
}

function cmdEvalHardened(args) {
  const { flags } = parseArgs(args);
  const result = runHardenedEval({ outPath: flags.out });
  console.log(`V1 (20-question baseline): ${result.v1Summary.pass}/${result.v1Summary.total} pass, ${result.v1Summary.knownMiss} known-miss, ${result.v1Summary.unexplained} unexplained`);
  console.log(`V2 (99-question expanded):  ${result.v2Summary.pass}/${result.v2Summary.total} pass, ${result.v2Summary.knownMiss} known-miss, ${result.v2Summary.unexplained} unexplained`);
  console.log(`V3 (regression families):   ${result.v3Summary.controlsPassing}/${result.v3Summary.controlCount} controls passing, ${result.v3Summary.knownBaselineFailuresConfirmedFailing}/${result.v3Summary.knownBaselineFailureCount} known-baseline-failures confirmed still failing, ${result.v3Summary.schemaPlaceholderCount} schema-placeholders recorded`);
  if (result.v3Summary.anomalies.length) {
    console.error(`\n${result.v3Summary.anomalies.length} anomaly(ies) — needs review before Phase 4.1 can close:`);
    for (const a of result.v3Summary.anomalies) console.error(`  [${a.kind}] ${a.id}: ${a.note}`);
    process.exitCode = 1;
  }
  console.log(`\nWrote ${result.outPath}`);
  if (result.v1Summary.unexplained || result.v2Summary.unexplained) {
    console.error(`\n${result.v1Summary.unexplained + result.v2Summary.unexplained} unexplained failure(s) in the existing V1/V2 corpus — this must be zero for Phase 4.1 to have introduced no regressions.`);
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
    case 'eval-v2': return cmdEvalV2(rest);
    case 'eval-hardened': return cmdEvalHardened(rest);
    case 'serve': return cmdServe(rest);
    default:
      console.error(`Unknown knowledge subcommand: ${sub}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

module.exports = { run, HELP, renderAnswerText, formatSourceLine, excerptEvidenceQualification };
