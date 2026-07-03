'use strict';

const path   = require('path');
const fsp    = require('fs').promises;
const { log } = require('../services/logger');
const config = require('../config/app.config');

const STATE_FILE  = 'qmz-sequences.json';
const UNSEQUENCED = '_Unsequenced';
const SEQ_RE      = /^\d{2}[QMZ]$/;
const LETTER_TYPE = { Q: 'Qadam', M: 'Majlis', Z: 'Ziyafat' };
const LETTER_MAX  = { Q: 50, M: 51, Z: 52 };
const MEDIA_EXT   = new Set([...config.PHOTO_EXTENSIONS, ...config.VIDEO_EXTENSIONS]);
const RAW_EXTS    = new Set(config.RAW_EXTENSIONS);
const PHOTO_EXTS  = new Set(config.PHOTO_EXTENSIONS);
const VIDEO_EXTS  = new Set(config.VIDEO_EXTENSIONS);

// Mirrors main/fileBrowser.js's mediaType() — RAW checked before photo (RAW_EXTS ⊂ PHOTO_EXTS).
// Duplicated locally rather than imported to keep qmzService decoupled from fileBrowser.
function mediaType(filename) {
  const e = path.extname(filename).toLowerCase();
  if (RAW_EXTS.has(e))   return 'raw';
  if (PHOTO_EXTS.has(e)) return 'photo';
  if (VIDEO_EXTS.has(e)) return 'video';
  return null;
}

// Mirrors main/fileBrowser.js's isJunkFile() — macOS AppleDouble sidecars
// (._Foo.ARW) and .DS_Store must never surface as media, even though their
// extension alone would otherwise match MEDIA_EXT (e.g. "._Foo.ARW" → .ARW).
function isJunkFile(filename) {
  return filename.startsWith('._') || filename === '.DS_Store';
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function formatCode(number, letter) {
  return String(number).padStart(2, '0') + String(letter).toUpperCase();
}

function parseCode(code) {
  if (typeof code !== 'string' || !SEQ_RE.test(code)) return null;
  const letter = code[2];
  const number = parseInt(code, 10);
  if (!LETTER_TYPE[letter]) return null;
  return { number, letter, type: LETTER_TYPE[letter], code, folderName: code };
}

function letterToType(letter) {
  return LETTER_TYPE[String(letter ?? '').toUpperCase()] ?? null;
}

// ── Filesystem helpers ────────────────────────────────────────────────────────

async function resolveConflict(filePath) {
  const ext  = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  for (let i = 1; i <= 99; i++) {
    const cand = `${base}_${i}${ext}`;
    try { await fsp.access(cand); } catch { return cand; }
  }
  throw new Error(`Cannot resolve filename conflict: ${path.basename(filePath)}`);
}

// Move a single file with no-overwrite safety. Same size at dest → skip (already moved).
// Conflicting dest → rename source with _1, _2 suffix.
async function safeMoveFile(src, dest) {
  let srcStat;
  try { srcStat = await fsp.stat(src); }
  catch { return { ok: false, reason: 'source-missing' }; }

  let finalDest = dest;
  try {
    const destStat = await fsp.stat(dest);
    if (destStat.size === srcStat.size) return { ok: true, dest, action: 'skipped' };
    finalDest = await resolveConflict(dest);
  } catch { /* dest absent — proceed */ }

  await fsp.mkdir(path.dirname(finalDest), { recursive: true });
  await fsp.rename(src, finalDest);
  return { ok: true, dest: finalDest, action: finalDest === dest ? 'moved' : 'moved-renamed' };
}

// Move a file and co-move its XMP sidecar if one exists alongside it.
async function moveWithSidecar(src, destDir) {
  const result = await safeMoveFile(src, path.join(destDir, path.basename(src)));
  const ext    = path.extname(src);
  const xmpSrc = src.slice(0, -ext.length) + '.xmp';
  try {
    await fsp.access(xmpSrc);
    await safeMoveFile(xmpSrc, path.join(destDir, path.basename(xmpSrc)));
  } catch { /* no sidecar */ }
  return result;
}

async function listChildDirs(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch { return []; }
}

async function listMediaFiles(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const files   = [];
    for (const e of entries) {
      if (!e.isFile() || isJunkFile(e.name) || !MEDIA_EXT.has(path.extname(e.name).toLowerCase())) continue;
      const p = path.join(dir, e.name);
      let size = 0;
      let modifiedAt = null;
      try {
        const stat = await fsp.stat(p);
        size       = stat.size;
        modifiedAt = stat.mtime.toISOString();
      } catch {}
      files.push({ name: e.name, path: p, size, type: mediaType(e.name), modifiedAt });
    }
    return files;
  } catch { return []; }
}

// ── State I/O ────────────────────────────────────────────────────────────────

async function readState(qmzRoot) {
  try {
    const raw = await fsp.readFile(path.join(qmzRoot, STATE_FILE), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, qmzRoot, sequences: [] };
  }
}

async function saveState(qmzRoot, state) {
  const dest = path.join(qmzRoot, STATE_FILE);
  const tmp  = dest + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await fsp.rename(tmp, dest);
    return { ok: true };
  } catch (err) {
    log(`[qmz] saveState failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ── Scan ─────────────────────────────────────────────────────────────────────

/**
 * Scan qmzRoot and return its current structure.
 *   sequences   — sorted array of { code, type, photographers: { name: { count, files[] } } }
 *   unsequenced — { photographerName: { count, files[] } }
 *   other       — plain dirs that are neither sequences nor _Unsequenced (adoption candidates)
 *   state       — parsed qmz-sequences.json (or default)
 */
async function scanRoot(qmzRoot) {
  const [childDirs, state] = await Promise.all([listChildDirs(qmzRoot), readState(qmzRoot)]);
  const sequences   = [];
  const unsequenced = {};
  const other       = [];

  for (const dir of childDirs) {
    if (dir === UNSEQUENCED) {
      const pgDirs = await listChildDirs(path.join(qmzRoot, UNSEQUENCED));
      for (const pg of pgDirs) {
        const files = await listMediaFiles(path.join(qmzRoot, UNSEQUENCED, pg));
        unsequenced[pg] = { count: files.length, files };
      }
    } else if (SEQ_RE.test(dir)) {
      const parsed = parseCode(dir);
      const pgDirs = await listChildDirs(path.join(qmzRoot, dir));
      const photographers = {};
      for (const pg of pgDirs) {
        const files = await listMediaFiles(path.join(qmzRoot, dir, pg));
        photographers[pg] = { count: files.length, files };
      }
      sequences.push({ ...parsed, photographers });
    } else {
      other.push(dir);
    }
  }

  sequences.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { sequences, unsequenced, other, state };
}

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * Adopt plain photographer folders (not sequence dirs, not _Unsequenced) into _Unsequenced/.
 * Uses atomic rename where possible; merges file-by-file when _Unsequenced/<dir> already exists.
 */
async function initRoot(qmzRoot) {
  const scan    = await scanRoot(qmzRoot);
  const adopted = [];
  const errors  = [];

  await fsp.mkdir(path.join(qmzRoot, UNSEQUENCED), { recursive: true });

  for (const dirName of scan.other) {
    const srcDir  = path.join(qmzRoot, dirName);
    const destDir = path.join(qmzRoot, UNSEQUENCED, dirName);
    try {
      await fsp.rename(srcDir, destDir);
      adopted.push(dirName);
    } catch {
      // _Unsequenced/<dirName> already exists — merge file by file
      let srcEntries;
      try { srcEntries = await fsp.readdir(srcDir, { withFileTypes: true }); }
      catch (err) { errors.push({ dir: dirName, error: err.message }); continue; }

      for (const e of srcEntries) {
        if (!e.isFile()) continue;
        const r = await safeMoveFile(path.join(srcDir, e.name), path.join(destDir, e.name));
        if (!r.ok) errors.push({ dir: dirName, file: e.name, error: r.reason });
      }
      try {
        const rem = await fsp.readdir(srcDir);
        if (rem.length === 0) await fsp.rmdir(srcDir);
      } catch {}
      adopted.push(dirName);
    }
  }

  log(`[qmz] initRoot: adopted ${adopted.length} folder(s) into ${UNSEQUENCED}`);
  return { ok: true, adopted, errors };
}

// ── Create sequences ─────────────────────────────────────────────────────────

async function createSequence(qmzRoot, number, letter) {
  letter = String(letter ?? '').toUpperCase();
  if (!LETTER_TYPE[letter]) return { ok: false, error: `Invalid letter: ${letter}` };
  const max = LETTER_MAX[letter];
  if (!Number.isInteger(number) || number < 1 || number > max)
    return { ok: false, error: `Number out of range for ${letter}: ${number} (1–${max})` };

  const code = formatCode(number, letter);
  try { await fsp.mkdir(path.join(qmzRoot, code), { recursive: true }); }
  catch (err) { return { ok: false, error: err.message }; }

  const state   = await readState(qmzRoot);
  const already = state.sequences.some(s => s.code === code);
  if (!already) {
    state.sequences.push({ code, number, letter, type: LETTER_TYPE[letter] });
    state.sequences.sort((a, b) => (a.code < b.code ? -1 : 1));
    const r = await saveState(qmzRoot, state);
    if (!r.ok) return { ok: false, error: r.error };
  }

  return { ok: true, code };
}

async function bulkCreateSequences(qmzRoot, items) {
  const created = [];
  const errors  = [];
  for (const { number, letter } of items) {
    const r = await createSequence(qmzRoot, number, letter);
    if (r.ok) created.push(r.code);
    else errors.push({ number, letter, error: r.error });
  }
  return { ok: errors.length === 0, created, errors };
}

// ── Move files ────────────────────────────────────────────────────────────────

async function moveFilesToSequence(qmzRoot, filePaths, sequenceCode, photographerName) {
  if (!parseCode(sequenceCode)) return { ok: false, error: `Invalid sequence code: ${sequenceCode}` };
  const destDir = path.join(qmzRoot, sequenceCode, photographerName);
  try { await fsp.mkdir(destDir, { recursive: true }); } catch {}

  const moved  = [];
  const errors = [];
  for (const src of filePaths) {
    const r = await moveWithSidecar(src, destDir);
    if (r.ok) moved.push({ src, dest: r.dest, action: r.action });
    else errors.push({ src, error: r.reason });
  }

  log(`[qmz] moveToSequence ${sequenceCode}/${photographerName}: ${moved.length} moved, ${errors.length} errors`);
  return { ok: errors.length === 0, moved, errors };
}

async function moveFilesToUnsequenced(qmzRoot, filePaths, photographerName) {
  const destDir = path.join(qmzRoot, UNSEQUENCED, photographerName);
  try { await fsp.mkdir(destDir, { recursive: true }); } catch {}

  const moved  = [];
  const errors = [];
  for (const src of filePaths) {
    const r = await moveWithSidecar(src, destDir);
    if (r.ok) moved.push({ src, dest: r.dest, action: r.action });
    else errors.push({ src, error: r.reason });
  }

  log(`[qmz] moveToUnsequenced ${photographerName}: ${moved.length} moved, ${errors.length} errors`);
  return { ok: errors.length === 0, moved, errors };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  formatCode,
  parseCode,
  letterToType,
  readState,
  saveState,
  scanRoot,
  initRoot,
  createSequence,
  bulkCreateSequences,
  moveFilesToSequence,
  moveFilesToUnsequenced,
};
