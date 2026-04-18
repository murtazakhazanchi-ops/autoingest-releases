/**
 * fileBrowser.js — Main-process module.
 *
 * ╔═════════════════════════════════════════════════════════════════════════╗
 * ║  EXTENSION HANDLING RULES — DO NOT BYPASS                              ║
 * ║  • Supported formats come EXCLUSIVELY from config/app.config.js.       ║
 * ║  • Extensions use path.extname(filename).toLowerCase() — case-safe.    ║
 * ║  • NEVER hardcode extension lists in this file.                        ║
 * ╚═════════════════════════════════════════════════════════════════════════╝
 *
 * Part 2 (this update): Filter macOS junk files:
 *   - filenames starting with '._'  (resource fork companions)
 *   - '.DS_Store'
 */

'use strict';

const fs     = require('fs');
const fsp    = require('fs').promises;
const path   = require('path');
const config = require('../config/app.config');

// ── Extension Sets — built from config, never hardcoded ──────────────────────
const PHOTO_EXTS = new Set(config.PHOTO_EXTENSIONS);
const RAW_EXTS   = new Set(config.RAW_EXTENSIONS);
const VIDEO_EXTS = new Set(config.VIDEO_EXTENSIONS);

// ── Filesystem helpers ────────────────────────────────────────────────────────
async function safeExists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function safeStat(p) {
  try { return await fsp.stat(p); } catch { return null; }
}

/**
 * Returns lowercase extension with leading dot.
 * IMG_001.CR3 → '.cr3'
 */
function getExt(filename) {
  return path.extname(filename).toLowerCase();
}

/**
 * Returns true for macOS junk files that must never appear in the UI.
 * - '._filename'  → Apple Double resource-fork companion files
 * - '.DS_Store'   → macOS folder metadata
 */
function isJunkFile(filename) {
  return filename.startsWith('._') || filename === '.DS_Store';
}

/**
 * Classifies a filename: 'raw' | 'photo' | 'video' | null (unsupported).
 * RAW is checked before photo (RAW_EXTS ⊂ PHOTO_EXTS).
 */
function mediaType(filename) {
  const e = getExt(filename);
  if (RAW_EXTS.has(e))   return 'raw';
  if (PHOTO_EXTS.has(e)) return 'photo';
  if (VIDEO_EXTS.has(e)) return 'video';
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Reads dirPath and returns immediate subfolders + supported media files.
 * Junk files (._* and .DS_Store) are silently filtered out.
 */
async function readDirectory(dirPath, onBatch = null) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

  const folders = [];
  const files   = [];
  const media   = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Also skip hidden/junk directories
      if (!entry.name.startsWith('.')) {
        folders.push({ name: entry.name, path: fullPath });
      }
      continue;
    }

    if (entry.isFile()) {
      // Part 2: skip macOS junk files before any other check
      if (isJunkFile(entry.name)) continue;

      const type = mediaType(entry.name);
      if (!type) continue;

      media.push({ name: entry.name, path: fullPath, type });
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));

  for (let i = 0; i < media.length; i += 50) {
    const batch = media.slice(i, i + 50);

    const batchFiles = (await Promise.all(
      batch.map(async file => {
        try {
          const stat = await fs.promises.stat(file.path);
          return {
            name:       file.name,
            path:       file.path,
            type:       file.type,
            size:       stat.size,
            modifiedAt: stat.mtime.toISOString()
          };
        } catch {
          return null;
        }
      })
    )).filter(Boolean);

    files.push(...batchFiles);
    if (onBatch && batchFiles.length) {
      onBatch({ folders, files: batchFiles, processed: files.length, total: media.length });
    }
  }

  files.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

  return { folders, files };
}

/**
 * Resolves the DCIM folder path for a given drive mount point.
 * Returns null if not found or inaccessible.
 */
function getDCIMPath(mountpoint) {
  const dcim = path.join(mountpoint, 'DCIM');
  try {
    if (fs.statSync(dcim).isDirectory()) return dcim;
  } catch {
    // not found or no access
  }
  return null;
}

/**
 * NEW (v0.6.0): Recursively scans a directory tree for supported media files.
 *
 * Unlike readDirectory (single level) and scanPrivateFolder (two hardcoded paths),
 * this walks the entire tree from \`startDir\`, filtering by media extensions.
 *
 * Rules:
 *   • Skips system/hidden folders (names starting with '.' or matching SKIP_DIRS)
 *   • Skips files smaller than MIN_FILE_BYTES (50 KB) to omit thumbnails / metadata stubs
 *   • Skips macOS junk (isJunkFile)
 *   • Classifies each file via mediaType(); non-media files are dropped
 *
 * Batching:
 *   • onBatch(batch) is invoked approximately every BATCH_SIZE (50) stat-completed files
 *   • batch shape: { files: [...], processed, total: null }  (total unknown during scan)
 *
 * This function is NOT yet wired into files:get — Commit 3 will do that.
 * Leaving it unused here is intentional (Commit 1 is non-integrated).
 *
 * @param {string} startDir         Absolute path to the scan root
 * @param {Function|null} onBatch   Optional progress callback
 * @param {Array} results           Accumulator (do not pass — for recursion)
 * @returns {Promise<Array<FileObject>>}
 */
const SKIP_DIRS    = new Set(['.Spotlight-V100', '.Trashes', 'System Volume Information', '$RECYCLE.BIN', 'lost+found']);
const MIN_FILE_BYTES = 50 * 1024; // 50 KB — drops proxies, thumb stubs, and metadata sidecars
const BATCH_SIZE     = 50;

async function scanMediaRecursive(startDir, onBatch = null, results = []) {
  let entries;
  try {
    entries = await fsp.readdir(startDir, { withFileTypes: true });
  } catch {
    // Unreadable directory — skip silently. The caller gets whatever was found elsewhere.
    return results;
  }

  // Gather per-directory work: queue subdirs for recursion, stat files in parallel
  const subdirs     = [];
  const fileEntries = [];

  for (const entry of entries) {
    const name = entry.name;
    if (entry.isDirectory()) {
      if (name.startsWith('.')) continue;       // skip all hidden dirs (incl. .Trashes)
      if (SKIP_DIRS.has(name))  continue;       // skip known system dirs
      subdirs.push(path.join(startDir, name));
      continue;
    }
    if (!entry.isFile()) continue;
    if (isJunkFile(name)) continue;
    const type = mediaType(name);
    if (!type) continue;
    fileEntries.push({ name, path: path.join(startDir, name), type });
  }

  // Stat this directory's files in parallel (bounded by the number of files per dir)
  const stattedBatch = (await Promise.all(
    fileEntries.map(async f => {
      const stat = await safeStat(f.path);
      if (!stat) return null;
      if (stat.size < MIN_FILE_BYTES) return null;
      return {
        name:       f.name,
        path:       f.path,
        type:       f.type,
        size:       stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
  )).filter(Boolean);

  // Emit progress batches while accumulating into results
  for (let i = 0; i < stattedBatch.length; i += BATCH_SIZE) {
    const chunk = stattedBatch.slice(i, i + BATCH_SIZE);
    results.push(...chunk);
    if (onBatch && chunk.length) {
      onBatch({ files: chunk, processed: results.length, total: null });
    }
  }

  // Recurse into subdirectories sequentially — keeps memory flat and plays nicely
  // with slow SD cards (parallel recursion can saturate the card's read channel).
  for (const sub of subdirs) {
    await scanMediaRecursive(sub, onBatch, results);
  }

  return results;
}

/**
 * Scans known Sony PRIVATE folder video paths.
 * Only checks two specific subdirectories — never recurses the full PRIVATE tree.
 * Returns file objects compatible with readDirectory() output.
 */
async function scanPrivateFolder(privatePath) {
  const results = [];

  const candidates = [
    path.join(privatePath, 'M4ROOT', 'CLIP'),
    path.join(privatePath, 'AVCHD', 'BDMV', 'STREAM'),
  ];

  for (const candidate of candidates) {
    if (!(await safeExists(candidate))) continue;

    let entries;
    try { entries = await fsp.readdir(candidate); } catch { continue; }

    // Patch 20: parallelize per-file stat calls within each candidate directory
    const candidateFiles = await Promise.all(
      entries
        .filter(file => !isJunkFile(file) && VIDEO_EXTS.has(getExt(file)))
        .map(async file => {
          const fullPath = path.join(candidate, file);
          const stat     = await safeStat(fullPath);
          if (!stat || stat.size <= 500 * 1024) return null;
          return {
            name:       file,
            path:       fullPath,
            type:       'video',
            size:       stat.size,
            modifiedAt: stat.mtime.toISOString(),
            source:     'private',
          };
        })
    );
    results.push(...candidateFiles.filter(Boolean));
  }

  return results;
}

module.exports = { readDirectory, getDCIMPath, scanPrivateFolder, safeExists, scanMediaRecursive };
