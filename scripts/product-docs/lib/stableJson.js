'use strict';

// Deterministic JSON serialization: object keys sorted recursively, 2-space
// indent, LF line endings, single trailing newline. Two runs over identical
// input always produce byte-identical output — required for the "deterministic
// rebuild produces no diff" guarantee.
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(sortKeysDeep(value), null, 2).replace(/\r\n/g, '\n') + '\n';
}

module.exports = { stableStringify, sortKeysDeep };
