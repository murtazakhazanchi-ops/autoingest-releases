/**
 * app.config.js — Central application configuration.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  CRITICAL — MEDIA FORMAT RULES (DO NOT MODIFY WITHOUT EXPLICIT ORDER)  ║
 * ║                                                                          ║
 * ║  1. This file is the SOLE source of truth for all supported extensions.  ║
 * ║  2. fileBrowser.js (and any future module) MUST import from here.        ║
 * ║  3. Extensions must NEVER be hardcoded elsewhere.                        ║
 * ║  4. This list must NEVER be reduced. New formats → append only.          ║
 * ║  5. All extension strings are lowercase with leading dot.                ║
 * ║     fileBrowser.js uses path.extname().toLowerCase() for matching.       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Do NOT import directly in renderer; pass values via IPC if needed.
 */

'use strict';

// ── Supported photo formats ───────────────────────────────────────────────────
// Includes standard image formats + ALL major camera RAW formats.
// COUNT: 18 extensions — DO NOT REMOVE ANY.
const PHOTO_EXTENSIONS = [
  '.jpg',   // JPEG
  '.jpeg',  // JPEG (alternate)
  '.png',   // PNG
  '.tiff',  // TIFF
  '.tif',   // TIFF (short)
  '.cr2',   // Canon RAW v2
  '.cr3',   // Canon RAW v3
  '.nef',   // Nikon RAW
  '.nrw',   // Nikon RAW (compact)
  '.arw',   // Sony RAW
  '.sr2',   // Sony RAW (legacy)
  '.srf',   // Sony RAW (older)
  '.dng',   // Adobe Digital Negative (universal RAW)
  '.raf',   // Fujifilm RAW
  '.orf',   // Olympus RAW
  '.rw2',   // Panasonic RAW
  '.pef',   // Pentax RAW
  '.x3f',   // Sigma RAW
];

// ── RAW-only subset (used for badge styling in the UI) ────────────────────────
// Must be a subset of PHOTO_EXTENSIONS above.
// COUNT: 13 extensions — DO NOT REMOVE ANY.
const RAW_EXTENSIONS = [
  '.cr2',
  '.cr3',
  '.nef',
  '.nrw',
  '.arw',
  '.sr2',
  '.srf',
  '.dng',
  '.raf',
  '.orf',
  '.rw2',
  '.pef',
  '.x3f',
];

// ── Supported video formats ───────────────────────────────────────────────────
// COUNT: 2 extensions.
const VIDEO_EXTENSIONS = [
  '.mp4',
  '.mov',
];

// ── Application settings ──────────────────────────────────────────────────────
module.exports = {
  appName:    'AutoIngest',
  version:    '1.0.0',

  // Window
  defaultWindowWidth:  1200,
  defaultWindowHeight:  800,

  // Media formats — the authoritative lists used across the entire application
  PHOTO_EXTENSIONS,
  RAW_EXTENSIONS,
  VIDEO_EXTENSIONS,
};
