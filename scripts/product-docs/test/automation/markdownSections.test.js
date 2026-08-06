#!/usr/bin/env node
'use strict';

// Pure in-memory tests — no filesystem, no git. Run with:
// node scripts/product-docs/test/automation/markdownSections.test.js
const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { appendLineToSection, insertAfterFirstRule, findSectionBody } = require('../../automation/markdownSections');

async function main() {
  const { t, summarize } = createRunner();

  await t('appendLineToSection appends within the section body, before the next heading', () => {
    const content = `# Title\n\n## Evolution / Implementation Journal\n\n- existing entry\n\n## Known Bugs\n\nNone recorded.\n`;
    const out = appendLineToSection(content, 'Evolution / Implementation Journal', '- new entry');
    assert.ok(out.includes('- existing entry\n- new entry'));
    assert.ok(out.indexOf('- new entry') < out.indexOf('## Known Bugs'));
  });

  await t('appendLineToSection is idempotent — the same line is not duplicated', () => {
    const content = `## Evolution / Implementation Journal\n\n- entry one\n\n## Next\n`;
    const once = appendLineToSection(content, 'Evolution / Implementation Journal', '- entry one');
    assert.equal(once, content, 'appending an already-present line must be a no-op');
  });

  await t('appendLineToSection throws when the heading does not exist (never guesses a location)', () => {
    const content = `## Some Other Heading\n\nbody\n`;
    assert.throws(() => appendLineToSection(content, 'Evolution / Implementation Journal', '- x'));
  });

  await t('appendLineToSection preserves content in unrelated sections byte-for-byte', () => {
    const content = `## A\n\nfoo\n\n## Evolution / Implementation Journal\n\n- e1\n\n## B\n\nbar\n`;
    const out = appendLineToSection(content, 'Evolution / Implementation Journal', '- e2');
    assert.ok(out.startsWith('## A\n\nfoo\n\n'));
    assert.ok(out.endsWith('## B\n\nbar\n'));
  });

  await t('appendLineToSection appends to the LAST matching section boundary, not into a later section', () => {
    const content = `## Evolution / Implementation Journal\n\n- e1\n\n## Known Bugs / Troubleshooting\n\nNone recorded.\n\n## Decisions\n\nNone recorded.\n`;
    const out = appendLineToSection(content, 'Known Bugs / Troubleshooting', '- BUG-001 link');
    const bugsSection = findSectionBody(out, 'Known Bugs / Troubleshooting');
    const body = out.slice(bugsSection.bodyStart, bugsSection.bodyEnd);
    assert.ok(body.includes('BUG-001 link'));
    const decisionsSection = findSectionBody(out, 'Decisions');
    const decisionsBody = out.slice(decisionsSection.bodyStart, decisionsSection.bodyEnd);
    assert.ok(!decisionsBody.includes('BUG-001'));
  });

  await t('insertAfterFirstRule inserts a new entry right after the first standalone "---"', () => {
    const content = `# Changelog\n\nAppend newest first.\n\n---\n\n## 2026-01-01 — Old Entry\n\n- old\n`;
    const out = insertAfterFirstRule(content, '## 2026-02-01 — New Entry\n\n- new');
    const newIdx = out.indexOf('## 2026-02-01 — New Entry');
    const oldIdx = out.indexOf('## 2026-01-01 — Old Entry');
    assert.ok(newIdx > -1 && oldIdx > -1 && newIdx < oldIdx, 'new entry must appear before the old entry (newest-first)');
  });

  await t('insertAfterFirstRule never deletes or rewrites the prior entry', () => {
    const content = `# Changelog\n\n---\n\n## 2026-01-01 — Old Entry\n\n- old detail one\n- old detail two\n`;
    const out = insertAfterFirstRule(content, '## 2026-02-01 — New Entry\n\n- new');
    assert.ok(out.includes('- old detail one'));
    assert.ok(out.includes('- old detail two'));
  });

  await t('insertAfterFirstRule is idempotent — repeating the same heading is a no-op', () => {
    const content = `# Changelog\n\n---\n\n## 2026-01-01 — Old Entry\n\n- old\n`;
    const once = insertAfterFirstRule(content, '## 2026-01-01 — Old Entry\n\n- duplicate attempt');
    assert.equal(once, content);
  });

  await t('insertAfterFirstRule throws when there is no standalone "---" anchor', () => {
    const content = `# Changelog\n\nno rule here\n`;
    assert.throws(() => insertAfterFirstRule(content, '## x\n\n- y'));
  });

  await t('insertAfterFirstRule does NOT skip a genuinely different entry whose heading is a text-prefix of an already-present one', () => {
    // Regression test for a code-review finding: the prior implementation
    // used raw String.includes(), so inserting "## 2026-08-05 — Fix login"
    // after "## 2026-08-05 — Fix login flow" already existed was silently
    // treated as a duplicate and dropped — even though it's a different task.
    const content = `# Changelog\n\n---\n\n## 2026-08-05 — Fix login flow\n\n- fixed the flow\n`;
    const out = insertAfterFirstRule(content, '## 2026-08-05 — Fix login\n\n- fixed login (different task)');
    assert.ok(out.includes('## 2026-08-05 — Fix login\n'), 'the new, textually-shorter entry must actually be inserted');
    assert.ok(out.includes('## 2026-08-05 — Fix login flow'), 'the original entry must remain untouched');
  });

  await t('appendLineToSection does NOT skip a genuinely different line whose text is a prefix of an already-present line', () => {
    const content = `## Evolution / Implementation Journal\n\n- **2026-08-05** — Fixed the bug\n\n## Next\n`;
    const out = appendLineToSection(content, 'Evolution / Implementation Journal', '- **2026-08-05** — Fixed the bug in the other module');
    assert.ok(out.includes('- **2026-08-05** — Fixed the bug in the other module'));
    assert.ok(out.includes('- **2026-08-05** — Fixed the bug\n'));
  });

  summarize('markdownSections.test.js');
}

main();
