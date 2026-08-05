#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/markdown.test.js
const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const md = require('../lib/markdown');
const ids = require('../lib/ids');

async function main() {
  const { t, summarize } = createRunner();

  await t('extractHeadings finds headings and skips fenced code blocks', () => {
    const content = '# Title\n\n## Section One\n\n```\n## Not a heading\n```\n\n### Sub\n';
    const headings = md.extractHeadings(content);
    assert.deepEqual(headings.map((h) => h.text), ['Title', 'Section One', 'Sub']);
  });

  await t('slugify matches GitHub anchor conventions', () => {
    assert.equal(md.slugify('A. Established Adobe Bridge Workflow (pre-AutoIngest)'), 'a-established-adobe-bridge-workflow-pre-autoingest');
    assert.equal(md.slugify('event.json Data Model & Persistence Contract'), 'eventjson-data-model-persistence-contract');
  });

  await t('slugify dedupes repeated headings with -1/-2 suffixes', () => {
    const seen = new Map();
    assert.equal(md.slugify('Summary', seen), 'summary');
    assert.equal(md.slugify('Summary', seen), 'summary-1');
    assert.equal(md.slugify('Summary', seen), 'summary-2');
  });

  await t('extractHeaderTable parses the first Field/Value table under the H1', () => {
    const content = '# X\n\n| Field | Value |\n|---|---|\n| Status | Implemented |\n| Maturity | Stable |\n\n## Next section\n\n| Field | Value |\n|---|---|\n| Other | Ignored |\n';
    const table = md.extractHeaderTable(content);
    assert.equal(table.Status, 'Implemented');
    assert.equal(table.Maturity, 'Stable');
    assert.equal(table.Other, undefined);
  });

  await t('extractSection returns body between a heading and the next same-or-shallower heading', () => {
    const content = '# X\n\n## Summary\n\nBody text.\nMore body.\n\n## Next\n\nOther.\n';
    assert.equal(md.extractSection(content, 'Summary'), 'Body text.\nMore body.');
    assert.equal(md.extractSection(content, 'Missing'), null);
  });

  await t('extractLinks finds text/path/anchor and skips http(s) links', () => {
    const content = '[Rel](../decisions/DEC-001_X.md#context) and [External](https://example.com) and [Anchor only](#foo)';
    const links = md.extractLinks(content);
    assert.equal(links.length, 2);
    assert.equal(links[0].path, '../decisions/DEC-001_X.md');
    assert.equal(links[0].anchor, 'context');
    assert.equal(links[1].path, '');
    assert.equal(links[1].anchor, 'foo');
  });

  await t('extractBulletList strips leading markers and trims', () => {
    const section = '- `main/exifService.js`\n- `main/some folder/file with space.js`\n';
    assert.deepEqual(md.extractBulletList(section), ['`main/exifService.js`', '`main/some folder/file with space.js`']);
  });

  await t('extractHeaderTable on malformed/short table returns partial data without throwing', () => {
    const content = '# X\n\n| Field |\n|---|\n| OnlyOneColumn |\n';
    assert.doesNotThrow(() => md.extractHeaderTable(content));
  });

  await t('extractIds finds and dedupes IDs, sorted', () => {
    const text = 'See AI-FEAT-033 and AI-FEAT-004, also AI-FEAT-033 again.';
    assert.deepEqual(ids.extractIds(text, 'feature'), ['AI-FEAT-004', 'AI-FEAT-033']);
  });

  await t('extractIds returns empty array for text with no matches', () => {
    assert.deepEqual(ids.extractIds('nothing here', 'bug'), []);
  });

  await t('extractAllIds groups by family', () => {
    const text = 'AI-FEAT-001 BUG-002 DEC-003 PM-004 AI-RM-005';
    const all = ids.extractAllIds(text);
    assert.deepEqual(all.feature, ['AI-FEAT-001']);
    assert.deepEqual(all.bug, ['BUG-002']);
    assert.deepEqual(all.decision, ['DEC-003']);
    assert.deepEqual(all.postmortem, ['PM-004']);
    assert.deepEqual(all.roadmap, ['AI-RM-005']);
  });

  await t('idType classifies a well-formed ID and rejects malformed ones', () => {
    assert.equal(ids.idType('AI-FEAT-001'), 'feature');
    assert.equal(ids.idType('AI-FEAT-1'), null);
    assert.equal(ids.idType('BUG-1234'), null);
  });

  summarize('markdown.test.js');
}

main();
