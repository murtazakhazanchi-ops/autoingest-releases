'use strict';

const fs   = require('fs');
const path = require('path');

let userDataDir = null;
let _initDone   = false;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function init(userDataPath) {
  if (_initDone) return;
  _initDone   = true;
  userDataDir = userDataPath;
}

// ── String helpers ────────────────────────────────────────────────────────────

/**
 * Normalize a string for comparison: lowercase, collapse whitespace,
 * treat punctuation characters as spaces so "al-ain" == "al ain" == "Al Ain".
 */
function normalize(input) {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/[.\-_,;:'"()/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate a stable, URL-safe ID from a label.
 * "Kuala Lumpur" → "kuala-lumpur"
 */
function slugify(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Alias storage ─────────────────────────────────────────────────────────────

function aliasPath(listName) {
  return path.join(userDataDir, `${listName}.aliases.json`);
}

function loadAliases(listName) {
  try { return JSON.parse(fs.readFileSync(aliasPath(listName), 'utf8')); }
  catch { return {}; }
}

function saveAliases(listName, map) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(aliasPath(listName), JSON.stringify(map, null, 2), 'utf8');
}

// ── Tree flattening ───────────────────────────────────────────────────────────

/**
 * Flatten a list (tree or flat array) to an array of selectable leaf objects.
 * Tree structure is UI-only; matching is always flat.
 *
 * Returns: Array<{ id: string, label: string }>
 *
 * Rules per list type:
 *   event-types : depth-0 nodes (category headers) are NOT selectable.
 *                 All depth-1 and depth-2 nodes are selectable.
 *   locations   : all top-level and sub-location nodes are selectable.
 *   cities      : flat string array → each becomes { id, label }.
 *   photographers: flat string array → each becomes { id, label }.
 */
function flattenToLeaves(listName, data) {
  if (!Array.isArray(data)) return [];
  const out = [];

  if (listName === 'event-types') {
    for (const category of data) {
      if (!Array.isArray(category.children)) continue;
      for (const event of category.children) {
        out.push({ id: slugify(event.label), label: event.label });
        if (Array.isArray(event.children)) {
          for (const sub of event.children) {
            out.push({ id: slugify(sub.label), label: sub.label });
          }
        }
      }
    }
    return out;
  }

  if (listName === 'locations') {
    for (const loc of data) {
      out.push({ id: slugify(loc.label), label: loc.label });
      if (Array.isArray(loc.children)) {
        for (const sub of loc.children) {
          out.push({ id: slugify(sub.label), label: sub.label });
        }
      }
    }
    return out;
  }

  // Flat lists (cities, photographers)
  for (const item of data) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ id: slugify(item), label: item });
    }
  }
  return out;
}

// ── Matching ──────────────────────────────────────────────────────────────────

const SCORE = {
  EXACT:           100,
  ALIAS_EXACT:      90,
  STARTS_WITH:      80,
  ALIAS_STARTS:     70,
  CONTAINS:         60,
  ALIAS_CONTAINS:   50,
};

/**
 * Match `input` against a list and its aliases.
 * Returns matches sorted by score descending.
 *
 * @param {string}   input    — raw user input
 * @param {string}   listName — 'cities' | 'locations' | 'event-types' | 'photographers'
 * @param {Array}    data     — the full list data (from listManager.getList)
 * @returns {Array<{ id, label, score, matchType }>}
 */
function match(input, listName, data) {
  if (!input || !input.trim()) return [];

  const norm   = normalize(input);
  if (!norm) return [];

  const leaves   = flattenToLeaves(listName, data);
  const aliasMap = loadAliases(listName);
  const results  = [];

  for (const leaf of leaves) {
    const leafNorm = normalize(leaf.label);
    const aliases  = aliasMap[leaf.id] || [];

    let score     = 0;
    let matchType = null;

    // Check label
    if (leafNorm === norm) {
      score = SCORE.EXACT;          matchType = 'exact';
    } else if (leafNorm.startsWith(norm)) {
      score = SCORE.STARTS_WITH;    matchType = 'startsWith';
    } else if (leafNorm.includes(norm)) {
      score = SCORE.CONTAINS;       matchType = 'contains';
    }

    // Check aliases (only if label didn't already match)
    if (!matchType) {
      for (const alias of aliases) {
        const aNorm = normalize(alias);
        if (aNorm === norm) {
          score = SCORE.ALIAS_EXACT;    matchType = 'aliasExact';    break;
        } else if (aNorm.startsWith(norm)) {
          score = SCORE.ALIAS_STARTS;   matchType = 'aliasStartsWith'; break;
        } else if (aNorm.includes(norm)) {
          score = SCORE.ALIAS_CONTAINS; matchType = 'aliasContains';   break;
        }
      }
    }

    if (score > 0) results.push({ ...leaf, score, matchType });
  }

  return results.sort((a, b) => b.score - a.score);
}

// ── Alias learning ────────────────────────────────────────────────────────────

/**
 * Record that the user typed `typedInput` and selected the item with
 * `canonicalId` / `canonicalLabel`. Saves the typed input as an alias
 * only when it is genuinely different from the canonical label.
 *
 * Called by the renderer after a user makes a selection in the dropdown.
 */
function learnAlias(listName, canonicalId, canonicalLabel, typedInput) {
  const typedNorm = normalize(typedInput);
  if (!typedNorm) return;
  if (typedNorm === normalize(canonicalLabel)) return; // same as label — nothing to learn

  const aliasMap = loadAliases(listName);
  if (!aliasMap[canonicalId]) aliasMap[canonicalId] = [];

  // Skip if this alias is already stored
  const alreadyKnown = aliasMap[canonicalId].some(a => normalize(a) === typedNorm);
  if (alreadyKnown) return;

  aliasMap[canonicalId].push(typedInput.trim());
  saveAliases(listName, aliasMap);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { init, normalize, slugify, flattenToLeaves, match, learnAlias };
