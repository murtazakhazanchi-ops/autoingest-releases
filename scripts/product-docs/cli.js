#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { GENERATED_ROOT, PRODUCT_DOCS_ROOT, REPO_ROOT } = require('./lib/repoRoot');
const build = require('./lib/build');
const validators = require('./lib/validators');
const { renderDocumentationHealthMd, summarize } = require('./lib/renderHealth');
const { stableStringify } = require('./lib/stableJson');
const { runQuery, lookupById } = require('./lib/query');
const { checkGeneratedSchemas } = require('./lib/validateSchemas');
const { buildImpactAnalysis } = require('./lib/impact');
const { buildChangeReport } = require('./lib/changeReport');
const { renderChangeReportMd } = require('./lib/renderChanges');
const gitInfo = require('./lib/gitInfo');
const version = require('./lib/version');
const { computeDependencyModelRegions, applyGeneratedRegions } = require('./lib/dependencyModelFragments');
const automationCli = require('./automation/cli');
const memoryCli = require('./automation/memoryCli');
const conversationCli = require('./automation/conversationCli');
const releaseIntelligence = require('./automation/releaseIntelligence');
// contextCli required lazily at its one call site (below) — Part 7E's
// dispatcher wiring lands in its own commit, after Part 7D's `release`
// command wiring, without this file referencing a module that doesn't
// exist yet at that point in history.

const HELP = `product-docs — Part 4/5/7 documentation intelligence & automation tooling for docs/product/

Usage: node scripts/product-docs/cli.js <command> [args]

Commands:
  build                     Regenerate all docs/product/generated/ artifacts
  validate                  Run the documentation health checks (exit 1 on error-level findings)
  query <text>              Search the offline index (or use --feature/--bug/--decision/--roadmap/--subsystem/--file)
  impact <input>            Advisory impact analysis for a feature/roadmap/subsystem/source-path
  changes <fromRef> [toRef] Generate a "what changed" report between two git refs (default toRef: HEAD)
  all                       build, then validate
  automation <sub>          Part 5/7 engineering-documentation orchestration — see "automation --help"
  memory <sub>              Part 6 engineering memory layer — see "memory --help"
  release <sub>             Part 7D release intelligence (drafts only, never publishes) — see "release --help"
  context <sub>             Part 7E universal repository context assistant — see "context --help"
  conversation <sub>        Part 8 multi-AI engineering conversation integration — see "conversation --help"
  knowledge <sub>           Stage 1 AutoIngest Knowledge Engine prototype (AI-FEAT-058) — see "knowledge --help"

Run any command with --help for command-specific usage.
`;

function writeGeneratedFiles(files) {
  const written = [];
  for (const [relPath, content] of files) {
    const abs = path.join(GENERATED_ROOT, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    written.push(relPath);
  }
  return written;
}

function readmeContent() {
  return `# docs/product/generated/\n\n` +
    `Derived artifacts produced by \`scripts/product-docs/cli.js build\`. **Never hand-edit anything in this directory** — regenerate it instead.\n\n` +
    `Canonical Markdown under \`docs/product/\` (and, one level further up the authority chain, the technical docs under \`docs/\`) is always the source of truth. Everything here is a locator/index layer over that Markdown — see \`docs/product/CLAUDE.md\` and \`scripts/product-docs/README.md\` for the full authority model.\n\n` +
    `Regenerate with: \`node scripts/product-docs/cli.js build\`\nValidate with: \`node scripts/product-docs/cli.js validate\`\n\n` +
    `docsys version: ${version.DOCSYS_VERSION}\n`;
}

// Part 2 remediation (Decision 5) — the hybrid dependency-model file lives
// under docs/product/ (a canonical spine document, per docs/product/
// CLAUDE.md's hierarchy), never under generated/, so it needs its own
// read-modify-write step distinct from writeGeneratedFiles above: only the
// content between a matching `<!-- GENERATED:BEGIN id --> ... <!--
// GENERATED:END id -->` marker pair is ever replaced, every other byte
// (interpretive prose, the Methodology section, tables not yet mechanized)
// is preserved untouched. Returns null if the file has no generated regions
// to update (nothing written) or the file already matches a fresh build.
function updateDependencyModelFile(parsed, built) {
  const docPath = path.join(PRODUCT_DOCS_ROOT, '12_DEPENDENCY_MODEL.md');
  if (!fs.existsSync(docPath)) return null;
  const before = fs.readFileSync(docPath, 'utf8');
  const regions = computeDependencyModelRegions(parsed, built);
  const after = applyGeneratedRegions(before, regions);
  if (after === before) return null;
  fs.writeFileSync(docPath, after);
  return '12_DEPENDENCY_MODEL.md';
}

function cmdBuild() {
  const start = Date.now();
  const { parsed, built, files, manifest } = build.assemble();
  files.set('README.md', readmeContent());
  const written = writeGeneratedFiles(files);
  const dependencyModelUpdated = updateDependencyModelFile(parsed, built);
  const elapsed = Date.now() - start;
  console.log(`Built ${written.length} file(s) under docs/product/generated/ in ${elapsed}ms.`);
  if (dependencyModelUpdated) console.log(`Updated generated regions in docs/product/${dependencyModelUpdated}.`);
  console.log(`Entities: ${JSON.stringify(manifest.entity_counts)}`);
  console.log(`Source commit: ${manifest.source_commit}`);
  return { files, manifest, elapsed };
}

function cmdValidate() {
  const start = Date.now();
  const { parsed, built, files } = build.assemble();
  const gitIsDirty = gitInfo.isWorkingTreeDirty();
  const findings = validators.runAllChecks(parsed, built, { gitIsDirty });
  findings.push(...validators.checkGeneratedFreshness(files, GENERATED_ROOT));
  findings.push(...validators.checkDependencyModelFreshness(parsed, built, PRODUCT_DOCS_ROOT));
  findings.push(...validators.checkManifestCommit(path.join(GENERATED_ROOT, 'manifest.json'), gitInfo.currentCommit()));
  findings.push(...checkGeneratedSchemas(files));

  const summary = summarize(findings);
  const meta = { sourceCommit: gitInfo.currentCommit() };
  const md = renderDocumentationHealthMd(findings, summary, meta);
  const json = stableStringify({
    schema_version: version.SCHEMA_VERSION,
    docsys_version: version.DOCSYS_VERSION,
    source_commit: meta.sourceCommit,
    summary,
    findings,
  });
  fs.mkdirSync(GENERATED_ROOT, { recursive: true });
  fs.writeFileSync(path.join(GENERATED_ROOT, 'documentation-health.md'), md);
  fs.writeFileSync(path.join(GENERATED_ROOT, 'documentation-health.json'), json);

  const elapsed = Date.now() - start;
  console.log(`Validated in ${elapsed}ms. errors=${summary.error} warnings=${summary.warning} information=${summary.information} evidence_gap=${summary.evidence_gap}`);
  console.log('Wrote docs/product/generated/documentation-health.md and .json');
  if (summary.error > 0) {
    console.error(`FAIL — ${summary.error} error-level finding(s). See documentation-health.md.`);
    process.exitCode = 1;
  } else {
    console.log('PASS');
  }
  return { findings, summary, elapsed };
}

function formatQueryResult(r) {
  return `[${r.score}] ${r.record.entity_type} ${r.record.stable_id} — ${r.record.title}\n    ${r.record.canonical_path}${r.record.authority_level !== 'canonical' ? ` (authority: ${r.record.authority_level})` : ''}${r.record.evidence_status ? `\n    evidence: ${r.record.evidence_status}` : ''}${r.record.related_ids.length ? `\n    related: ${r.record.related_ids.join(', ')}` : ''}`;
}

function cmdQuery(args) {
  if (args.includes('--help') || args.length === 0) {
    console.log(`Usage: query <text> | --feature ID | --bug ID | --decision ID | --roadmap ID | --subsystem NAME | --file PATH | --impact PATH`);
    return;
  }
  const { built } = build.assemble();
  const flagIdx = args.findIndex((a) => a.startsWith('--'));
  if (flagIdx === -1) {
    const text = args.join(' ');
    const results = runQuery(text, built.searchIndex, { limit: 20 });
    if (!results.length) {
      console.log(`No results for "${text}".`);
      return;
    }
    for (const r of results) console.log(formatQueryResult(r));
    return;
  }
  const flag = args[flagIdx];
  const value = args[flagIdx + 1];
  if (!value) {
    console.error(`${flag} requires a value`);
    process.exitCode = 1;
    return;
  }
  if (flag === '--impact') {
    const { parsed } = build.assemble();
    printImpact(buildImpactAnalysis(value, built, parsed));
    return;
  }
  if (flag === '--subsystem') {
    const s = built.subsystems.find((x) => x.id.toLowerCase() === value.toLowerCase() || x.name.toLowerCase() === value.toLowerCase() || x.aliases.some((a) => a.toLowerCase() === value.toLowerCase()));
    console.log(s ? JSON.stringify(s, null, 2) : `No subsystem matching "${value}".`);
    return;
  }
  if (flag === '--file') {
    const { resolveFileOwnership } = require('./lib/changeReport');
    console.log(JSON.stringify(resolveFileOwnership(value, built.sourceIndex), null, 2));
    return;
  }
  const record = lookupById(value, built.searchIndex);
  console.log(record ? JSON.stringify(record, null, 2) : `No record matching "${value}".`);
}

function printImpact(impact) {
  console.log(`Impact analysis for: ${impact.input}`);
  console.log(`Resolution: ${impact.resolution_method} (confidence: ${impact.confidence})`);
  console.log(`Primary ownership: ${impact.primary_ownership.join(', ') || 'None — evidence pending'}`);
  console.log(`Related features: ${impact.related_features.join(', ') || 'None'}`);
  console.log(`Dependencies: ${impact.dependencies.join(', ') || 'None'}`);
  console.log(`Dependents: ${impact.dependents.join(', ') || 'None'}`);
  console.log(`Decisions: ${impact.decisions.join(', ') || 'None'}`);
  console.log(`Bugs: ${impact.bugs.join(', ') || 'None'}`);
  console.log(`Required technical docs: ${impact.required_technical_docs.join(', ') || 'None'}`);
  console.log(`Tests: ${impact.tests.join(', ') || 'None'}`);
  console.log(`Documentation update checklist:\n${impact.documentation_update_checklist.map((f) => `  - ${f}`).join('\n') || '  (none)'}`);
  console.log(`Generated artifacts to rebuild:\n${impact.generated_artifacts_to_rebuild.map((f) => `  - ${f}`).join('\n')}`);
  console.log(impact.advisory_note);
}

function cmdImpact(args) {
  if (args.includes('--help') || args.length === 0) {
    console.log('Usage: impact <AI-FEAT-### | AI-RM-### | subsystem-name | source/path>');
    return;
  }
  const { parsed, built } = build.assemble();
  printImpact(buildImpactAnalysis(args[0], built, parsed));
}

function cmdChanges(args) {
  if (args.includes('--help') || args.length === 0) {
    console.log('Usage: changes <fromRef> [toRef=HEAD]');
    return;
  }
  const fromRef = args[0];
  const toRef = args[1] || 'HEAD';
  if (!gitInfo.refExists(fromRef)) {
    console.error(`Unknown git ref: ${fromRef}`);
    process.exitCode = 1;
    return;
  }
  if (!gitInfo.refExists(toRef)) {
    console.error(`Unknown git ref: ${toRef}`);
    process.exitCode = 1;
    return;
  }
  const { parsed, built } = build.assemble();
  const report = buildChangeReport(fromRef, toRef, parsed, built.subsystems, built.sourceIndex);
  const safe = (s) => s.replace(/[^a-zA-Z0-9._-]/g, '_');
  const baseName = `${safe(fromRef)}_TO_${safe(toRef)}`;
  const dir = path.join(GENERATED_ROOT, 'change-reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${baseName}.md`), renderChangeReportMd(report));
  fs.writeFileSync(path.join(dir, `${baseName}.json`), stableStringify(report));
  console.log(`Wrote docs/product/generated/change-reports/${baseName}.md and .json`);
  console.log(`${report.commits.length} commit(s), ${report.files_changed.length} file(s) changed, ${report.affected_features.length} feature(s) affected.`);
}

const RELEASE_HELP = `release — Part 7D autonomous release intelligence (drafts only, never publishes)

Usage: node scripts/product-docs/cli.js release <sub> [args]

Subcommands:
  prepare --to <ref> [--from <ref>|auto] [--dry-run] [--output-dir <dir>] [--json-only]
          [--channel rc|stable] [--rc-commit <sha>]
      Generates a full release draft (Markdown + JSON) for the range from the
      auto-detected prior Git tag (or --from) up to --to. --from defaults to
      "auto" (newest tag reachable from --to, excluding --to itself).
      --channel rc additionally renders a QA checklist (affected bugs/
      features, tester instructions, required evidence). --channel stable
      additionally renders a promotion-readiness section citing --rc-commit.
  status [--dir <dir>]
      Lists previously generated release drafts.
  gate --tag <vX.Y.Z|X.Y.Z> [--channel rc|stable] [--rc-commit <sha>]
       [--auto-rc-commit] [--stable-commit <ref>]
       [--override-drift-check "<reason>"] [--json]
      Checks package.json's (and package-lock.json's) version against the
      given target release version BEFORE a tag is created. electron-builder
      derives its publish target and artifact names from package.json's
      version, never from the git tag — a mismatch builds real artifacts but
      silently fails to publish them (see the v0.9.11 release-process
      incident, docs/product/postmortems/PM-002_*.md). Exits non-zero on
      mismatch.
      With --channel rc: additionally requires an "X.Y.Z-rc.N" version shape.
      With --channel stable: additionally requires a plain "X.Y.Z" version,
      zero source drift from --rc-commit/--auto-rc-commit (excluding the
      version-bump files themselves) unless --override-drift-check gives an
      explicit reason, and zero currently-Open/Investigating bugs. All
      channel-gate failures are BLOCKING — there is no warning-only outcome
      for these checks.
      --auto-rc-commit discovers the highest-numbered "vX.Y.Z-rc.*" tag for
      this Stable version from git tag history alone (no --rc-commit needed)
      — used by the automated stable-release-gate CI job, since a plain
      "push: tags: v*" event has no workflow_dispatch input to carry one.

Never creates a GitHub release, never writes docs/release-notes-*.md, never
completes a roadmap milestone. Publishing remains a separately authorized
human action.
`;

function parseReleaseFlags(args) {
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

function cmdReleasePrepare(args) {
  const { flags } = parseReleaseFlags(args);
  if (flags.help || !flags.to) {
    console.log(RELEASE_HELP);
    if (!flags.to) process.exitCode = 1;
    return;
  }
  const toRef = flags.to;
  if (!gitInfo.refExists(toRef)) {
    console.error(`Unknown git ref: ${toRef}`);
    process.exitCode = 1;
    return;
  }
  const fromRef = flags.from || 'auto';
  const result = releaseIntelligence.writeReleaseDraft(fromRef, toRef, {
    dryRun: !!flags['dry-run'],
    outputDir: flags['output-dir'],
    channel: flags.channel || null,
    verifiedRcCommit: flags['rc-commit'] || null,
  });
  if (result.dryRun) {
    console.log(`[dry-run] release draft for ${result.draft.from_ref || '(no prior tag)'} → ${toRef} — no files written.`);
    console.log(flags['json-only'] ? result.json : result.md);
    return;
  }
  console.log(`Wrote release draft: ${result.mdPath}\n${result.jsonPath}`);
  console.log(`From-ref resolution: ${result.draft.from_ref_resolution || result.draft.resolution}`);
  console.log('DRAFT ONLY — review before publishing; this command never creates a GitHub release.');
}

function cmdReleaseStatus(args) {
  const { flags } = parseReleaseFlags(args);
  const drafts = releaseIntelligence.listReleaseDrafts(flags.dir);
  console.log(`${drafts.length} release draft(s) found${flags.dir ? ` under ${flags.dir}` : ''}.`);
  for (const d of drafts) console.log(`  - ${d}`);
}

function cmdReleaseGate(args) {
  const { flags } = parseReleaseFlags(args);
  if (flags.help || !flags.tag) {
    console.log(RELEASE_HELP);
    if (!flags.tag) process.exitCode = 1;
    return;
  }
  const result = flags.channel
    ? releaseIntelligence.checkChannelReleaseGate(REPO_ROOT, {
        channel: flags.channel,
        tagOrVersion: flags.tag,
        verifiedRcCommit: flags['rc-commit'] || null,
        stableCommit: flags['stable-commit'] || 'HEAD',
        overrideDriftReason: flags['override-drift-check'] || null,
        autoDiscoverRcCommit: !!flags['auto-rc-commit'],
      })
    : releaseIntelligence.checkVersionTagAlignment(REPO_ROOT, flags.tag);
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`PASS${flags.channel ? ` (${flags.channel})` : ''} — package.json (${result.packageVersion})${result.lockVersion ? ` and package-lock.json (${result.lockVersion})` : ''} match target release version ${result.targetVersion}.`);
    if (result.autoDiscoveredRcTag) console.log(`  Auto-discovered prior RC tag: ${result.autoDiscoveredRcTag}`);
    if (result.overrideDriftReason) console.log(`  NOTE: drift/provenance check was overridden — reason: ${result.overrideDriftReason}`);
  } else {
    console.error(`BLOCKED${flags.channel ? ` (${flags.channel})` : ''} — release gate failed for target ${result.targetVersion}:`);
    for (const b of result.blocking) console.error(`  - ${b}`);
  }
  if (!result.ok) process.exitCode = 1;
}

function cmdRelease(args) {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(RELEASE_HELP);
    return;
  }
  switch (sub) {
    case 'prepare': return cmdReleasePrepare(rest);
    case 'gate': return cmdReleaseGate(rest);
    case 'status': return cmdReleaseStatus(rest);
    default:
      console.error(`Unknown release subcommand: ${sub}\n`);
      console.log(RELEASE_HELP);
      process.exitCode = 1;
  }
}

function main() {
  const [, , command, ...rest] = process.argv;
  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exitCode = command ? 0 : 1;
    return;
  }
  try {
    switch (command) {
      case 'build':
        cmdBuild();
        break;
      case 'validate':
        cmdValidate();
        break;
      case 'query':
        cmdQuery(rest);
        break;
      case 'impact':
        cmdImpact(rest);
        break;
      case 'changes':
        cmdChanges(rest);
        break;
      case 'all': {
        cmdBuild();
        cmdValidate();
        break;
      }
      case 'automation':
        automationCli.run(rest);
        break;
      case 'memory':
        memoryCli.run(rest);
        break;
      case 'conversation':
        conversationCli.run(rest);
        break;
      case 'release':
        cmdRelease(rest);
        break;
      case 'context':
        require('./automation/contextCli').run(rest);
        break;
      case 'knowledge':
        require('./lib/knowledgeCli').run(rest);
        break;
      default:
        console.error(`Unknown command: ${command}\n`);
        console.log(HELP);
        process.exitCode = 1;
    }
  } catch (err) {
    console.error(`product-docs ${command} failed: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exitCode = 1;
  }
}

main();
