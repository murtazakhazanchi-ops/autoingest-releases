'use strict';

// `memory query` — richer, memory-specific filters on top of Part 4's
// generic offline query (which already finds memory capsules for free once
// they're in the shared search index, per lib/searchIndex.js). Text filters
// (--rejected/--feedback/--commit) scan capsule body text directly, since
// those concepts aren't (and shouldn't be) modeled as separate search-index
// fields — see docs/product/16_ENGINEERING_MEMORY_POLICY.md § 15.

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('../paths');
const build = require('../../lib/build');
const { runQuery, lookupById } = require('../../lib/query');

function memoryDocsRoot() {
  return path.join(REPO_ROOT, 'docs', 'product', 'memory');
}

function listCapsules() {
  const root = memoryDocsRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((f) => /^AI-MEM-\d{4}_.+\.md$/.test(f))
    .map((f) => ({ file: f, path: path.join(root, f), content: fs.readFileSync(path.join(root, f), 'utf8') }));
}

function idFromFile(file) {
  const m = /^(AI-MEM-\d{4})_/.exec(file);
  return m ? m[1] : null;
}

function printCapsuleHit(c, matchedLine) {
  console.log(`${idFromFile(c.file)} — docs/product/memory/${c.file}`);
  if (matchedLine) console.log(`    ${matchedLine.trim()}`);
}

function textFilter(capsules, needle) {
  const hits = [];
  for (const c of capsules) {
    const line = c.content.split('\n').find((l) => l.toLowerCase().includes(needle.toLowerCase()));
    if (line) hits.push({ capsule: c, line });
  }
  return hits;
}

function run(args) {
  if (args.includes('--help') || args.length === 0) {
    console.log('Usage: memory query <text> | --feature ID | --bug ID | --decision ID | --commit <hash> | --rejected "<text>" | --feedback "<text>"');
    return;
  }
  const capsules = listCapsules();
  const flagIdx = args.findIndex((a) => a.startsWith('--'));

  if (flagIdx === -1) {
    const text = args.join(' ');
    const { built } = build.assemble();
    const results = runQuery(text, built.searchIndex, { limit: 20 }).filter((r) => r.record.entity_type === 'memory');
    if (!results.length) {
      console.log(`No memory records for "${text}".`);
      return;
    }
    for (const r of results) console.log(`[${r.score}] ${r.record.stable_id} — ${r.record.title}\n    ${r.record.canonical_path}`);
    return;
  }

  const flag = args[flagIdx];
  const value = args[flagIdx + 1];
  if (!value) throw new Error(`${flag} requires a value`);

  if (flag === '--feature' || flag === '--bug' || flag === '--decision') {
    const hits = capsules.filter((c) => c.content.includes(value));
    if (!hits.length) return console.log(`No capsule cites ${value}.`);
    for (const c of hits) printCapsuleHit(c);
    return;
  }
  if (flag === '--commit') {
    const hits = textFilter(capsules, value);
    if (!hits.length) return console.log(`No capsule cites commit ${value}.`);
    for (const h of hits) printCapsuleHit(h.capsule, h.line);
    return;
  }
  if (flag === '--rejected' || flag === '--feedback') {
    const sectionHeading = flag === '--rejected' ? 'Alternatives Considered' : 'User Feedback';
    const hits = [];
    for (const c of capsules) {
      const idx = c.content.indexOf(`## ${sectionHeading}`);
      if (idx === -1) continue;
      const section = c.content.slice(idx);
      if (section.toLowerCase().includes(value.toLowerCase())) hits.push(c);
    }
    if (!hits.length) return console.log(`No capsule's "${sectionHeading}" section mentions "${value}".`);
    for (const c of hits) printCapsuleHit(c);
    return;
  }

  const record = lookupById(value, build.assemble().built.searchIndex);
  if (record && record.entity_type === 'memory') {
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  console.log(`No memory record matching "${value}".`);
}

module.exports = { run, listCapsules, idFromFile };
