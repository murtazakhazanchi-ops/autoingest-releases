'use strict';

// Stable ID patterns used across docs/product/. See docs/product/README.md
// "Two separate ID systems" and docs/product/05_DOCUMENTATION_WORKFLOW.md "Stable IDs".
//
// AI-MEM-#### (Part 6, Engineering Memory) is deliberately 4 digits, not 3
// like every other family here — see docs/product/16_ENGINEERING_MEMORY_POLICY.md
// § ID Model. ID_DIGIT_WIDTH exists so extractIds' range-expansion regex
// (below) stays correct for a family whose digit width differs from the rest,
// rather than hardcoding \d{3} the way earlier callers of this pattern did.
// AI-MEM-#### and ENG-CONV-#### are deliberately 4 digits, not 3 like the
// other families — both are expected to accumulate faster than product
// features or roadmap milestones (potentially one record per significant
// session, over years). See docs/product/16_ENGINEERING_MEMORY_POLICY.md §
// ID Model and docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § ID Model.
const ID_DIGIT_WIDTH = {
  feature: 3, roadmap: 3, bug: 3, decision: 3, postmortem: 3, memory: 4, conversation: 4,
};

const ID_PATTERNS = {
  feature: /AI-FEAT-(\d{3})/g,
  roadmap: /AI-RM-(\d{3})/g,
  bug: /BUG-(\d{3})/g,
  decision: /DEC-(\d{3})/g,
  postmortem: /PM-(\d{3})/g,
  memory: /AI-MEM-(\d{4})/g,
  conversation: /ENG-CONV-(\d{4})/g,
};

const ID_PREFIXES = {
  feature: 'AI-FEAT-',
  roadmap: 'AI-RM-',
  bug: 'BUG-',
  decision: 'DEC-',
  postmortem: 'PM-',
  memory: 'AI-MEM-',
  conversation: 'ENG-CONV-',
};

function idType(id) {
  if (/^AI-FEAT-\d{3}$/.test(id)) return 'feature';
  if (/^AI-RM-\d{3}$/.test(id)) return 'roadmap';
  if (/^BUG-\d{3}$/.test(id)) return 'bug';
  if (/^DEC-\d{3}$/.test(id)) return 'decision';
  if (/^PM-\d{3}$/.test(id)) return 'postmortem';
  if (/^AI-MEM-\d{4}$/.test(id)) return 'memory';
  if (/^ENG-CONV-\d{4}$/.test(id)) return 'conversation';
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
  const digits = ID_DIGIT_WIDTH[family] || 3;
  const found = new Set();

  const rangeRe = new RegExp(
    `${escapeRegex(prefix)}(\\d{${digits}})\\s*(?:–|—|-{1,2}|through|to)\\s*${escapeRegex(prefix)}(\\d{${digits}})`,
    'gi',
  );
  let rm;
  while ((rm = rangeRe.exec(text)) !== null) {
    const start = parseInt(rm[1], 10);
    const end = parseInt(rm[2], 10);
    if (start <= end && end - start <= MAX_RANGE_SPAN) {
      for (let n = start; n <= end; n++) found.add(prefix + String(n).padStart(digits, '0'));
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

module.exports = { ID_PATTERNS, ID_PREFIXES, ID_DIGIT_WIDTH, idType, extractIds, extractAllIds, compareIds };
