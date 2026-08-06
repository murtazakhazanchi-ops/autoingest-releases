'use strict';

// Tool-neutral import: node scripts/product-docs/cli.js memory import
// --format markdown|json --file <path>. Per
// docs/product/16_ENGINEERING_MEMORY_POLICY.md § 9/§ 12: only Markdown and
// JSON are supported, the source must be an explicit file argument (never a
// directory scan), size-capped, schema-validated for JSON, never executed,
// and written only into the gitignored raw imports tier — never directly
// into a canonical capsule.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { IMPORTS_DIR, REPO_ROOT } = require('./paths');
const { atomicWriteFileSync } = require('../atomicWrite');
const { redactDeep, redactText } = require('../redact');

const SUPPORTED_FORMATS = ['markdown', 'json'];
const MAX_IMPORT_BYTES = 2 * 1024 * 1024; // 2MB — generous for a session summary, small enough to bound a bad-faith import

function resolveWithinRepo(filePath) {
  const abs = path.resolve(filePath);
  const root = path.resolve(REPO_ROOT);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`memory import refuses to read a file outside the repository: ${filePath}`);
  }
  return abs;
}

// A minimal, honest JSON import shape — a structured session summary another
// agent submits. Anything not matching this shape is rejected outright
// (Scenario F in the Part 6 brief: "import unknown format; reject safely;
// do not fabricate memory") rather than best-effort coerced.
function validateJsonImportShape(obj) {
  const errors = [];
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    errors.push('root must be a JSON object');
    return errors;
  }
  if (obj.summary !== undefined && typeof obj.summary !== 'string') errors.push('"summary" must be a string if present');
  if (obj.events !== undefined && !Array.isArray(obj.events)) errors.push('"events" must be an array if present');
  if (!obj.summary && !obj.events) errors.push('must contain at least "summary" or "events"');
  return errors;
}

function importFile(format, filePath) {
  if (!SUPPORTED_FORMATS.includes(format)) {
    throw new Error(`Unsupported import format "${format}" — supported: ${SUPPORTED_FORMATS.join(', ')}. Refusing to guess-parse an unrecognized format (see docs/product/16_ENGINEERING_MEMORY_POLICY.md § 9).`);
  }
  const abs = resolveWithinRepo(filePath);
  if (!fs.existsSync(abs)) throw new Error(`Import file not found: ${filePath}`);
  // resolveWithinRepo only checks the lexical path; a symlink physically
  // inside the repo can still point OUTSIDE it, and fs.readFileSync below
  // follows symlinks — so the real (resolved) target must also be checked,
  // not just the path the caller typed (found in code review).
  const realAbs = fs.realpathSync(abs);
  resolveWithinRepo(realAbs);
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw new Error(`Import path is not a regular file: ${filePath}`);
  if (stat.size > MAX_IMPORT_BYTES) {
    throw new Error(`Import file exceeds the ${MAX_IMPORT_BYTES}-byte cap (${stat.size} bytes) — trim or split it before importing.`);
  }
  const raw = fs.readFileSync(abs, 'utf8');

  let parsed;
  if (format === 'json') {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Import file is not valid JSON: ${err.message}`);
    }
    const errors = validateJsonImportShape(parsed);
    if (errors.length) throw new Error(`Import JSON failed schema validation: ${errors.join('; ')}`);
  } else {
    // markdown: no execution, no template evaluation — treated as inert
    // text. A minimal structural check (non-empty) is the only gate; content
    // becomes a single 'imported-transcript'-sourced event summary, never
    // interpreted as commands.
    if (!raw.trim()) throw new Error('Import Markdown file is empty.');
    parsed = { summary: raw.trim().slice(0, 20000) };
  }

  const redacted = redactDeep(parsed);
  const importId = `mimp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  fs.mkdirSync(IMPORTS_DIR, { recursive: true });
  const destPath = path.join(IMPORTS_DIR, `${importId}.${format === 'json' ? 'json' : 'md.json'}`);
  atomicWriteFileSync(destPath, JSON.stringify({
    import_id: importId,
    format,
    source_file: path.relative(REPO_ROOT, abs).split(path.sep).join('/'),
    imported_at: new Date().toISOString(),
    size_bytes: stat.size,
    content: redacted,
  }, null, 2) + '\n');

  return { importId, destPath, format };
}

module.exports = { importFile, SUPPORTED_FORMATS, MAX_IMPORT_BYTES, resolveWithinRepo };
