'use strict';

const fs   = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '../data');
let userDataDir = null;

const FLAT_LISTS = new Set(['cities', 'photographers']);
const TREE_LISTS = new Set(['event-types', 'locations']);
const READ_ONLY  = new Set(['event-types']);

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let _initDone = false;

function init(userDataPath) {
  if (_initDone) return;
  _initDone   = true;
  userDataDir = userDataPath;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function basePath(name)     { return path.join(BASE_DIR, `${name}.json`); }
function overridePath(name) { return path.join(userDataDir, `${name}.override.json`); }

// ── IO helpers ────────────────────────────────────────────────────────────────

function readJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ── Normalization ─────────────────────────────────────────────────────────────

function normalize(str) {
  return str.trim().replace(/\s+/g, ' ');
}

// Proper case: first letter of each word capitalised, rest lowered.
function properCase(str) {
  return str.replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

// ── Dedup helpers ─────────────────────────────────────────────────────────────

function dedupFlat(arr) {
  const seen = new Set();
  return arr.filter(item => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupTree(nodes) {
  const seen = new Set();
  return nodes.filter(node => {
    const key = node.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Public: getList ───────────────────────────────────────────────────────────

/**
 * Returns the merged list for `name`.
 *   'cities'       → string[]
 *   'photographers'→ string[]
 *   'event-types'  → TreeNode[]  (read-only, no override)
 *   'locations'    → TreeNode[]
 */
function getList(name) {
  if (!FLAT_LISTS.has(name) && !TREE_LISTS.has(name)) return [];

  const base = readJSON(basePath(name), []);

  if (READ_ONLY.has(name)) return base;

  const override = readJSON(overridePath(name), []);

  if (TREE_LISTS.has(name)) {
    // override is a flat string[] of new top-level labels
    const newNodes = override.map(label => ({ label }));
    return dedupTree([...base, ...newNodes]);
  }

  // Flat lists
  return dedupFlat([...base, ...override]);
}

// ── Public: addToList ─────────────────────────────────────────────────────────

/**
 * Add a new value to a writable list.
 * Returns { success, value, duplicate, error? }
 */
function addToList(name, rawValue) {
  if (READ_ONLY.has(name)) {
    return { success: false, error: 'read-only' };
  }
  if (!FLAT_LISTS.has(name) && !TREE_LISTS.has(name)) {
    return { success: false, error: 'unknown list' };
  }

  const value = properCase(normalize(rawValue));
  if (!value) return { success: false, error: 'empty value' };

  // Duplicate check against the full merged list
  const current = getList(name);
  const labels  = TREE_LISTS.has(name)
    ? current.map(n => n.label.toLowerCase())
    : current.map(s => s.toLowerCase());

  if (labels.includes(value.toLowerCase())) {
    return { success: true, value, duplicate: true };
  }

  // Append to override file
  const ovPath   = overridePath(name);
  const existing = readJSON(ovPath, []);
  existing.push(value);
  writeJSON(ovPath, existing);

  return { success: true, value, duplicate: false };
}

module.exports = { init, getList, addToList };
