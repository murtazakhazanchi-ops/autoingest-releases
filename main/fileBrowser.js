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

module.exports = { readDirectory, getDCIMPath, scanPrivateFolder, safeExists };
