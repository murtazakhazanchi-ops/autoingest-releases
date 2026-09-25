'use strict';

/**
 * legacyKeywordFallback.js — D2: leaf-safe legacy fallback for the keyword-registry
 * autocomplete (Event Type / Location / City).
 *
 * CORE INVARIANT: only true selectable leaves may become committed keyword/Event-Type/
 * Location values. A listManager node with children (at ANY depth — the real data goes
 * three levels deep, e.g. "04 Majlis" > "Misaq" > "Ahed al-Awliyah") is structural/
 * navigation context, never a value in its own right. A flat list (cities) is the
 * degenerate zero-children case of the same shape and needs no special-casing.
 *
 * Two consumers, two shapes, one shared classification:
 *   collectLegacyLeaves — flat, leaf-only, for search (main.js's _registryMatch). A
 *     parent label must NEVER be returned merely because it matches the query text.
 *   pruneLegacyTree — keeps the real nested shape (so TreeAutocomplete's existing,
 *     already-correct browse renderer — which already treats a category header as
 *     expand-only and only a true leaf as selectable — renders it correctly), but with
 *     already-registry-covered leaves removed and any node left with zero children
 *     dropped entirely rather than shown as an empty, dead-end expandable header.
 * Both dedupe against `have` (registry labels) at the LEAF level only — a category is
 * never considered "covered" merely because the registry has one of its leaves; its
 * other, still-uncovered siblings must keep appearing.
 */

/** Normalize one listManager tree/flat-list entry to {label, children}, or null if malformed. */
function _legacyNode(n) {
  if (typeof n === 'string') return n ? { label: n, children: [] } : null;
  if (!n || typeof n !== 'object' || !n.label) return null;
  return { label: n.label, children: Array.isArray(n.children) ? n.children : [] };
}

/**
 * Recursively collect only TRUE leaf labels (nodes with no children, at any depth) from
 * a legacy listManager tree/flat-list, excluding any leaf already covered by `have`
 * (a lowercase Set of registry labels). Malformed nodes are safely ignored.
 * @param {Array} nodes
 * @param {Set<string>} have  Lowercase registry labels already covered.
 * @returns {string[]}
 */
function collectLegacyLeaves(nodes, have) {
  const out = [];
  const seen = new Set();
  const walk = (list) => {
    for (const raw of (list || [])) {
      const n = _legacyNode(raw);
      if (!n) continue;
      if (n.children.length > 0) { walk(n.children); continue; }
      const key = n.label.toLowerCase();
      if (have.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(n.label);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Recursively rebuild a legacy listManager tree, keeping its real shape, with every leaf
 * already covered by `have` removed and every node left with zero surviving children
 * dropped entirely (never an empty, dead-end expandable header).
 * @param {Array} nodes
 * @param {Set<string>} have
 * @returns {Array<{label: string, children?: Array}>}
 */
function pruneLegacyTree(nodes, have) {
  const out = [];
  for (const raw of (nodes || [])) {
    const n = _legacyNode(raw);
    if (!n) continue;
    if (n.children.length === 0) {
      if (!have.has(n.label.toLowerCase())) out.push({ label: n.label });
      continue;
    }
    const prunedChildren = pruneLegacyTree(n.children, have);
    if (prunedChildren.length > 0) out.push({ label: n.label, children: prunedChildren });
    // else: every leaf under this category/intermediate node is already registry-covered
    // (or it had none) — drop the whole node rather than leave an empty dead end.
  }
  return out;
}

module.exports = { collectLegacyLeaves, pruneLegacyTree };
