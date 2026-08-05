'use strict';

// Minimal, dependency-free Markdown structural parsing: headings, GitHub-style
// anchor slugs, the first header table under an H1, named section bodies,
// and [text](path#anchor) links. Intentionally not a full CommonMark parser —
// docs/product/ content is authored consistently enough that this is sufficient,
// and it keeps this tooling stdlib-only per Part 4's dependency-light requirement.

function splitLines(content) {
  return content.replace(/\r\n/g, '\n').split('\n');
}

// GitHub's heading-to-anchor slug algorithm (lowercase, strip non-alphanumeric
// except spaces/hyphens, spaces -> hyphens, collapse, dedupe with -1/-2 suffix).
function slugify(text, seen) {
  let slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, '-');
  if (!seen) return slug;
  if (!seen.has(slug)) {
    seen.set(slug, 0);
    return slug;
  }
  const n = seen.get(slug) + 1;
  seen.set(slug, n);
  return `${slug}-${n}`;
}

// Returns [{ level, text, slug, line }], 1-indexed line numbers.
function extractHeadings(content) {
  const lines = splitLines(content);
  const seen = new Map();
  const headings = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    const text = m[2].replace(/`/g, '');
    headings.push({ level, text, slug: slugify(text, seen), line: i + 1 });
  }
  return headings;
}

// Body text of a named section: from the heading matching `headingText`
// (case-insensitive, exact) up to (not including) the next heading of the
// same or shallower level. Returns null if the heading isn't found.
function extractSection(content, headingText) {
  const lines = splitLines(content);
  const headings = extractHeadings(content);
  const target = headings.find((h) => h.text.toLowerCase() === headingText.toLowerCase());
  if (!target) return null;
  const next = headings.find((h) => h.line > target.line && h.level <= target.level);
  const startLine = target.line; // 1-indexed heading line itself excluded below
  const endLine = next ? next.line - 1 : lines.length;
  return lines.slice(startLine, endLine).join('\n').trim();
}

// Parses the first Markdown table found in `text` into an array of row arrays
// (each cell trimmed), skipping the "|---|---|" separator row.
function parseFirstTable(text) {
  const lines = splitLines(text);
  const tableLines = [];
  let started = false;
  for (const line of lines) {
    const isRow = /^\s*\|.*\|\s*$/.test(line);
    if (isRow) {
      started = true;
      tableLines.push(line);
    } else if (started) {
      break;
    }
  }
  if (tableLines.length < 2) return [];
  const rows = [];
  for (let i = 0; i < tableLines.length; i++) {
    if (i === 1 && /^\s*\|[\s:|-]+\|\s*$/.test(tableLines[i])) continue; // separator row
    const cells = tableLines[i]
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    rows.push(cells);
  }
  return rows;
}

// The header table (Field/Value two-column table) is the first table in the
// whole document, per every template in 06-09_*_TEMPLATE.md. Returns a plain
// object keyed by the Field column (lowercased-trimmed original text kept as
// the raw key), values are raw cell text (markdown links intact).
function extractHeaderTable(content) {
  const rows = parseFirstTable(content);
  const table = {};
  for (const row of rows) {
    if (row.length < 2) continue;
    if (row[0].toLowerCase() === 'field') continue; // header row itself
    table[row[0]] = row[1];
  }
  return table;
}

// Same shape as extractHeaderTable but scoped to a named section (used for
// "## Lifecycle Metadata" tables in feature files).
function extractSectionTable(content, headingText) {
  const section = extractSection(content, headingText);
  if (!section) return null;
  return extractHeaderTable(section);
}

// [{ text, path, anchor, raw, line }] for every [text](path) / [text](path#anchor)
// link in the document. Skips http(s):// links. `path` is '' for pure-anchor
// links like [text](#heading).
function extractLinks(content) {
  const lines = splitLines(content);
  const links = [];
  const re = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  for (let i = 0; i < lines.length; i++) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(lines[i])) !== null) {
      const target = m[2];
      if (/^https?:\/\//.test(target)) continue;
      const hashIdx = target.indexOf('#');
      const pathPart = hashIdx === -1 ? target : target.slice(0, hashIdx);
      const anchorPart = hashIdx === -1 ? null : target.slice(hashIdx + 1);
      links.push({ text: m[1], path: pathPart, anchor: anchorPart, raw: target, line: i + 1 });
    }
  }
  return links;
}

// Bullet-list items under a section, each item's leading `- `/`* ` stripped
// and backtick-wrapped inline code unwrapped when the whole item is code.
function extractBulletList(sectionText) {
  if (!sectionText) return [];
  const lines = splitLines(sectionText);
  const items = [];
  for (const line of lines) {
    const m = /^\s*[-*]\s+(.+)$/.exec(line);
    if (!m) continue;
    items.push(m[1].trim());
  }
  return items;
}

module.exports = {
  slugify,
  extractHeadings,
  extractSection,
  extractSectionTable,
  extractHeaderTable,
  extractLinks,
  extractBulletList,
  parseFirstTable,
};
