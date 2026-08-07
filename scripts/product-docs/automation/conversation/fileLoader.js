'use strict';

// Safe file loading for `conversation import` — same hardened pattern as
// automation/memory/importAdapter.js's resolveWithinRepo: lexical
// repository-boundary check AND a realpath check (a symlink physically
// inside the repo can still point outside it, and fs.readFileSync follows
// symlinks), size-capped before the content is ever read into memory. Also
// accepts a path inside the local conversation inbox
// (.autoingest-docs/conversations/inbox/), which is itself inside the repo
// so the same boundary check already covers it.

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./paths');

const SUPPORTED_FORMATS = ['ecp', 'markdown', 'json'];
const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5MB — generous for a structured conversation summary, bounded against a bad-faith import
const MAX_JSON_DEPTH = 20; // guards against a pathological/adversarial deeply-nested JSON payload

function resolveWithinRepo(filePath) {
  const abs = path.resolve(filePath);
  const root = path.resolve(REPO_ROOT);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`conversation import refuses to read a file outside the repository: ${filePath}`);
  }
  return abs;
}

function jsonDepth(value, depth = 0) {
  if (depth > MAX_JSON_DEPTH) return depth;
  if (Array.isArray(value)) return Math.max(depth, ...value.map((v) => jsonDepth(v, depth + 1)), depth);
  if (value && typeof value === 'object') {
    const vals = Object.values(value);
    if (!vals.length) return depth;
    return Math.max(depth, ...vals.map((v) => jsonDepth(v, depth + 1)));
  }
  return depth;
}

// Loads and lightly validates a file for import — never executes, never
// evals, never shells out. Returns { raw, format } for a caller-specified
// format; format detection itself (by extension/content-sniff) is the
// caller's job (adapters.js#detectFormat), not this loader's.
function loadFile(format, filePath) {
  if (!SUPPORTED_FORMATS.includes(format)) {
    throw new Error(`Unsupported import format "${format}" — supported: ${SUPPORTED_FORMATS.join(', ')}. Refusing to guess-parse an unrecognized format.`);
  }
  const abs = resolveWithinRepo(filePath);
  if (!fs.existsSync(abs)) throw new Error(`Import file not found: ${filePath}`);
  const realAbs = fs.realpathSync(abs);
  resolveWithinRepo(realAbs); // symlink-escape check — the real target must ALSO be inside the repo
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw new Error(`Import path is not a regular file: ${filePath}`);
  if (stat.size > MAX_IMPORT_BYTES) {
    throw new Error(`Import file exceeds the ${MAX_IMPORT_BYTES}-byte cap (${stat.size} bytes) — trim or split it before importing.`);
  }
  const raw = fs.readFileSync(abs, 'utf8');
  return { raw, absPath: abs, sizeBytes: stat.size };
}

function parseJsonBounded(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Import file is not valid JSON: ${err.message}`);
  }
  const depth = jsonDepth(parsed);
  if (depth > MAX_JSON_DEPTH) {
    throw new Error(`Import JSON exceeds the maximum nesting depth (${MAX_JSON_DEPTH}) — rejected as a pathological/adversarial payload.`);
  }
  return parsed;
}

module.exports = {
  SUPPORTED_FORMATS, MAX_IMPORT_BYTES, MAX_JSON_DEPTH,
  resolveWithinRepo, loadFile, parseJsonBounded, jsonDepth,
};
