'use strict';

// Stable ID patterns used across docs/product/. See docs/product/README.md
// "Two separate ID systems" and docs/product/05_DOCUMENTATION_WORKFLOW.md "Stable IDs".
const ID_PATTERNS = {
  feature: /AI-FEAT-(\d{3})/g,
  roadmap: /AI-RM-(\d{3})/g,
  bug: /BUG-(\d{3})/g,
  decision: /DEC-(\d{3})/g,
  postmortem: /PM-(\d{3})/g,
};

const ID_PREFIXES = {
  feature: 'AI-FEAT-',
  roadmap: 'AI-RM-',
  bug: 'BUG-',
  decision: 'DEC-',
  postmortem: 'PM-',
};

function idType(id) {
  if (/^AI-FEAT-\d{3}$/.test(id)) return 'feature';
  if (/^AI-RM-\d{3}$/.test(id)) return 'roadmap';
  if (/^BUG-\d{3}$/.test(id)) return 'bug';
  if (/^DEC-\d{3}$/.test(id)) return 'decision';
  if (/^PM-\d{3}$/.test(id)) return 'postmortem';
  return null;
}

const MAX_RANGE_SPAN = 500; // guards against a pathological/malformed range expanding unboundedly

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Extract every occurrence of a given ID family from free text, deduplicated,
// sorted ascending. Does not care about surrounding markdown link syntax.
//
// Also expands the "A through B" / "A – B" / "A—B" / "A-B" range prose
// convention used throughout docs/product/ (e.g. 11_ARCHITECTURAL_EVOLUTION.md
// §5's "AI-FEAT-049 – AI-FEAT-056", DEC-015's "AI-RM-002 through AI-RM-009")
// — without this, only the two range endpoints would be captured and every
// interior ID would silently vanish from the generated indexes.
function extractIds(text, family) {
  const pattern = ID_PATTERNS[family];
  const prefix = ID_PREFIXES[family];
  if (!pattern) throw new Error('Unknown ID family: ' + family);
  const found = new Set();

  const rangeRe = new RegExp(
    `${escapeRegex(prefix)}(\\d{3})\\s*(?:–|—|-{1,2}|through|to)\\s*${escapeRegex(prefix)}(\\d{3})`,
    'gi',
  );
  let rm;
  while ((rm = rangeRe.exec(text)) !== null) {
    const start = parseInt(rm[1], 10);
    const end = parseInt(rm[2], 10);
    if (start <= end && end - start <= MAX_RANGE_SPAN) {
      for (let n = start; n <= end; n++) found.add(prefix + String(n).padStart(3, '0'));
    }
  }

  const re = new RegExp(pattern.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    found.add(prefix + m[1]);
  }
  return Array.from(found).sort();
}

// Extract every ID of any family from free text, deduplicated, sorted ascending
// within each family, grouped by family.
function extractAllIds(text) {
  const result = {};
  for (const family of Object.keys(ID_PATTERNS)) {
    result[family] = extractIds(text, family);
  }
  return result;
}

function compareIds(a, b) {
  return a.localeCompare(b, 'en', { numeric: true });
}

module.exports = { ID_PATTERNS, ID_PREFIXES, idType, extractIds, extractAllIds, compareIds };
