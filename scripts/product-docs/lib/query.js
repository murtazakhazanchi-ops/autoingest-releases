'use strict';

const { idType } = require('./ids');

// Deterministic ranking (documented in scripts/product-docs/README.md):
//   1000  exact stable_id match
//    900  exact alias match (case-insensitive)
//    850  exact title match (case-insensitive)
//    500 + up to 200 * (queryLen/titleLen)   title substring match
//    100 * distinct matched keyword tokens
//     10  summary substring match
// Ties broken by stable_id ascending (localeCompare numeric).
function scoreRecord(queryText, record) {
  const q = queryText.trim().toLowerCase();
  if (!q) return 0;
  let score = 0;
  const reasons = [];

  if (record.stable_id.toLowerCase() === q) {
    score = Math.max(score, 1000);
    reasons.push('exact-id');
  }
  for (const alias of record.aliases) {
    if (alias.toLowerCase() === q) {
      score = Math.max(score, 900);
      reasons.push('exact-alias');
    }
  }
  if (record.title.toLowerCase() === q) {
    score = Math.max(score, 850);
    reasons.push('exact-title');
  }
  if (record.title.toLowerCase().includes(q) && q.length > 2) {
    const ratio = q.length / record.title.length;
    score = Math.max(score, 500 + Math.round(200 * Math.min(ratio, 1)));
    reasons.push('title-substring');
  }
  const qTokens = new Set(q.split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  if (qTokens.size) {
    const keywordSet = new Set(record.keywords);
    let matches = 0;
    for (const t of qTokens) if (keywordSet.has(t)) matches++;
    if (matches) {
      score = Math.max(score, 100 * matches);
      reasons.push(`keyword-overlap:${matches}`);
    }
  }
  if (record.summary && record.summary.toLowerCase().includes(q) && q.length > 2) {
    score = Math.max(score, 10);
    reasons.push('summary-substring');
  }
  return { score, reasons };
}

function runQuery(queryText, searchIndex, opts = {}) {
  const results = [];
  for (const record of searchIndex) {
    if (opts.entityType && record.entity_type !== opts.entityType) continue;
    const { score, reasons } = scoreRecord(queryText, record);
    if (score > 0) results.push({ record, score, reasons });
  }
  results.sort((a, b) => b.score - a.score || a.record.stable_id.localeCompare(b.record.stable_id, 'en', { numeric: true }));
  return opts.limit ? results.slice(0, opts.limit) : results;
}

function lookupById(id, searchIndex) {
  const upper = id.toUpperCase();
  return searchIndex.find((r) => r.stable_id === upper || r.stable_id === id) || null;
}

module.exports = { runQuery, lookupById, scoreRecord };
