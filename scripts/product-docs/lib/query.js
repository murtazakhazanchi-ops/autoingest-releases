'use strict';

const { idType } = require('./ids');

// Deterministic ranking (documented in scripts/product-docs/README.md):
//   1000  exact stable_id match
//    900  exact alias match (case-insensitive)
//    850  exact title match (case-insensitive)
//    500 + up to 200 * (queryLen/titleLen)   title substring match (record title contains the whole query)
//    500 + up to 200 * (titleLen/queryLen)   identity-mention match (the query contains the record's whole title/alias)
//    100 * distinct matched keyword tokens
//     10  summary substring match
// Ties broken by stable_id ascending (localeCompare numeric).
//
// Phase C6 — identity-mention tier (the line above marked "identity-mention
// match"). FORENSIC FINDING that motivated this addition (Product Owner
// acceptance trial, post-C5.2): title-substring above only ever rewards a
// record whose OWN title contains the entire query string — true only for
// queries barely longer than the title itself. It structurally never fires
// for a natural multi-word question that simply NAMES an exact feature,
// because the (short) title can't contain the (long) question. Verified via
// lib/knowledgeEngine.js's explainNormalization() diagnostic seam against
// the real corpus: "How do I create a Transfer Export?" scores AI-FEAT-038
// ("Transfer Export", title AND alias both literally present in the query)
// only via the generic keyword-overlap tier (100/token) — tied with 9+
// unrelated records at the same token count, then LOSES the keyword-surface-
// size tiebreak (lib/knowledgeSurfaceNormalization.js) to AI-WF-008 ("Recover
// From an Archive Lock Error", topically unrelated) purely because
// AI-WF-008's keyword list happens to be smaller and so is damped less.
// Same mechanism separately confirmed for "What is Archive Maintenance?"
// (AI-FEAT-049, the exact answer) losing to AI-FEAT-050 "Event Maintenance"
// for the same surface-size-driven reason, and for "Why does Transfer Import
// exist?" (AI-FEAT-039) losing to AI-FEAT-041 "Transfer Background/Minimize
// Operation" via an unrelated raw-token-count tie. This tier is the missing
// reverse direction, using the SAME formula shape as title-substring (500
// base + up to 200 scaled by how much of the query the identity phrase
// accounts for) — not a new heuristic, the other half of one. Requires a
// real word boundary (wordBoundaryIncludes below) so a short title can never
// match inside an unrelated longer word (e.g. a hypothetical "Import" title
// could not match inside "important"), a minimum identity-phrase length of
// 4 chars, and — found necessary empirically, not assumed up front — a
// multi-word requirement (see the identityPhrases filter below for the full
// account: several real aliases, e.g. "search", "diagnostics", "exif", are
// single generic words that must stay recall-only, never identity-tier).
// Deliberately reuses record.aliases (already curated, already used by the
// exact-alias tier above) rather than adding a second alias list — one
// alias vocabulary, not two.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordBoundaryIncludes(haystack, needle) {
  if (!needle) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}($|[^a-z0-9])`, 'i');
  return re.test(haystack);
}

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
  // identity-mention — the reverse direction of title-substring above; see
  // this file's header comment for the full forensic finding and rationale.
  // Multi-word only (must contain a space) — found empirically (Phase C6
  // regression run against the existing 165-question corpus, RF-5.3-004/
  // RF-5.3-011): several real aliases are single, generic words used for
  // recall only (e.g. AI-FEAT-053's alias "search", AI-FEAT-043's
  // "diagnostics", AI-FEAT-029's "exif"/"iptc"/"tagging") — exactly the
  // kind of incidental one-word overlap this tier must NOT reward, since a
  // single common word inside an unrelated longer question is not a
  // genuine "this exact record was named" signal the way a multi-word
  // proper-name phrase is. Every real fix case verified during Phase C6
  // (Transfer Export, Transfer Import, Archive Maintenance, Event
  // Maintenance, Quick Import, Checksum-Based File Verification, ...) is
  // already multi-word, so this guard costs nothing already gained.
  const identityPhrases = [record.title, ...record.aliases].filter((p) => p && p.length >= 4 && p.includes(' '));
  for (const phrase of identityPhrases) {
    const p = phrase.toLowerCase();
    if (wordBoundaryIncludes(q, p)) {
      const ratio = p.length / q.length;
      score = Math.max(score, 500 + Math.round(200 * Math.min(ratio, 1)));
      reasons.push('identity-mention');
    }
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

module.exports = { runQuery, lookupById, scoreRecord, wordBoundaryIncludes };
