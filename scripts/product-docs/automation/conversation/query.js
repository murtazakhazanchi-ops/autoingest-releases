'use strict';

// `conversation query` — mirrors automation/memory/query.js's shape exactly:
// generic text search reuses the shared search index for free
// (lib/searchIndex.js already indexes engineering_conversation records);
// --feature/--bug/--decision/--memory filters scan canonical record text
// directly for the same reason memory/query.js does (these aren't, and
// shouldn't be, separate search-index fields).

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('../paths');
const build = require('../../lib/build');
const { runQuery, lookupById } = require('../../lib/query');

function conversationDocsRoot() {
  return path.join(REPO_ROOT, 'docs', 'product', 'conversations');
}

function listConversations() {
  const root = conversationDocsRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((f) => /^ENG-CONV-\d{4}_.+\.md$/.test(f))
    .map((f) => ({ file: f, path: path.join(root, f), content: fs.readFileSync(path.join(root, f), 'utf8') }));
}

function idFromFile(file) {
  const m = /^(ENG-CONV-\d{4})_/.exec(file);
  return m ? m[1] : null;
}

function printHit(c, matchedLine) {
  console.log(`${idFromFile(c.file)} — docs/product/conversations/${c.file}`);
  if (matchedLine) console.log(`    ${matchedLine.trim()}`);
}

function run(args) {
  if (args.includes('--help') || args.length === 0) {
    console.log('Usage: conversation query <text> | --feature ID | --bug ID | --decision ID | --memory ID');
    return;
  }
  const conversations = listConversations();
  const flagIdx = args.findIndex((a) => a.startsWith('--'));

  if (flagIdx === -1) {
    const text = args.join(' ');
    const { built } = build.assemble();
    const results = runQuery(text, built.searchIndex, { limit: 20 }).filter((r) => r.record.entity_type === 'engineering_conversation');
    if (!results.length) {
      console.log(`No conversation records for "${text}".`);
      return;
    }
    for (const r of results) console.log(`[${r.score}] ${r.record.stable_id} — ${r.record.title}\n    ${r.record.canonical_path}`);
    return;
  }

  const flag = args[flagIdx];
  const value = args[flagIdx + 1];
  if (!value) throw new Error(`${flag} requires a value`);

  if (flag === '--feature' || flag === '--bug' || flag === '--decision' || flag === '--memory') {
    const hits = conversations.filter((c) => c.content.includes(value));
    if (!hits.length) return console.log(`No conversation cites ${value}.`);
    for (const c of hits) printHit(c);
    return;
  }

  const record = lookupById(value, build.assemble().built.searchIndex);
  if (record && record.entity_type === 'engineering_conversation') {
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  console.log(`No conversation record matching "${value}".`);
}

module.exports = { run, listConversations, idFromFile };
