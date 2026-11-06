#!/usr/bin/env node
'use strict';

/**
 * qmz-attribution-repair-plan.js
 *
 * READ-ONLY preview tool for archives that passed through the pre-fix QMZ bugs
 * (Creator overwritten with a QMZ sequence code; a QMZ sequence folder listed and
 * PC-prefixed as if it were a photographer). It never renames a folder or rewrites
 * metadata — it only reports what it finds, so a human can review the plan before
 * anything is applied. There is deliberately no "--apply" mode in this tool.
 *
 * What it looks for, walking one event folder's tree:
 *   1. Mis-prefixed QMZ containers — a directory whose bare (PC-prefix-stripped) name
 *      is a QMZ sequence code / `_Unsequenced` / `Enroute` (photographerSequenceService.
 *      isQmzContainerName), but whose on-disk name still carries the erroneous "PCnn-"
 *      prefix a pre-fix sequencing run left behind. Proposed fix: rename the container
 *      back to its bare name — NEVER touches anything inside it.
 *   2. Media files whose Creator/Artist/By-line was likely overwritten with a QMZ
 *      sequence code (or `_Unsequenced`/`Enroute`) — detected by re-resolving the real
 *      photographer from the (corrected) folder structure and comparing it against the
 *      file's current embedded value (read via ExifTool, read-only). Only ever proposed
 *      when the real photographer is unambiguous; otherwise the file is listed under
 *      "needs manual review", never guessed.
 *   3. Media files with no resolvable photographer at all (sitting directly inside a
 *      QMZ container, no photographer sub-folder) — always listed as "needs manual
 *      review", never auto-fixed.
 *
 * Usage:
 *   node scripts/qmz-attribution-repair-plan.js "/absolute/path/to/event/folder" [--json out.json] [--no-read-metadata]
 *
 * --no-read-metadata skips the ExifTool read-back entirely (faster, no ExifTool
 * process spawned) — the plan still reports every file's EXPECTED photographer, just
 * without a "current value" to compare it against.
 *
 * Exit codes: 0 always (this is a report, not a pass/fail gate) unless the event
 * folder path is missing/invalid (2) or an unexpected error occurs (1).
 */

const path = require('path');
const fsp  = require('fs').promises;
const fs   = require('fs');

const photographerSeqService = require('../services/photographerSequenceService');
const config = require('../config/app.config');

// ── CLI ──────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const eventFolderPath = args.find(a => !a.startsWith('--'));
const jsonFlagIdx = args.indexOf('--json');
const jsonOutPath = jsonFlagIdx !== -1 ? args[jsonFlagIdx + 1] : null;
const readMetadata = !args.includes('--no-read-metadata');

if (!eventFolderPath) {
  console.error('Usage: node scripts/qmz-attribution-repair-plan.js "/path/to/event/folder" [--json out.json] [--no-read-metadata]');
  process.exit(2);
}

const MEDIA_EXT = new Set([...config.PHOTO_EXTENSIONS, ...config.VIDEO_EXTENSIONS].map(e => e.toLowerCase()));

// ── Tree walk ────────────────────────────────────────────────────────────────────

/**
 * Walks the event tree, classifying every directory and media file against the same
 * QMZ-container rules the live scan/resolution now uses.
 * @returns {{
 *   containerRenames: Array<{ path, from, to }>,
 *   needsReview: Array<{ path, reason }>,
 *   attributionFixes: Array<{ path, expectedPhotographer, currentCreator }>,
 * }}
 */
async function walk(eventFolderPath) {
  const containerRenames = [];
  const needsReview = [];
  const attributionCandidates = [];

  async function recurse(dirPath, segments) {
    let entries;
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      needsReview.push({ path: dirPath, reason: `Cannot read directory: ${err.message}` });
      return;
    }

    for (const e of entries) {
      const full = path.join(dirPath, e.name);

      if (e.isDirectory()) {
        const isContainer = photographerSeqService.isQmzContainerName(e.name);
        if (isContainer && e.name !== photographerSeqService.canonicalName(e.name)) {
          containerRenames.push({
            path: full,
            from: e.name,
            to: photographerSeqService.canonicalName(e.name),
          });
        }
        await recurse(full, [...segments, { name: e.name, isContainer }]);
        continue;
      }

      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!MEDIA_EXT.has(ext)) continue;

      // Classify this file against the segments walked so far — mirrors
      // eventEvidenceReconstruction.resolvePhotographerFromPath exactly, just applied
      // directly to the walked tree instead of a relative path string.
      if (segments.length === 0) {
        needsReview.push({ path: full, reason: 'Media file sits directly in the event root (no photographer or QMZ-container folder above it) — nothing to verify.' });
        continue;
      }

      const first = segments[0];
      if (!first.isContainer) {
        // Ordinary (non-QMZ) photographer folder — not in scope for this tool.
        continue;
      }
      if (segments.length < 2) {
        needsReview.push({ path: full, reason: `Sits directly inside QMZ container "${first.name}" — no photographer sub-folder found. Cannot resolve a photographer; do not guess.` });
        continue;
      }
      const photographerSeg = segments[1];
      if (photographerSeg.isContainer) {
        needsReview.push({ path: full, reason: `A QMZ container ("${first.name}") directly contains another QMZ-shaped folder ("${photographerSeg.name}") instead of a photographer — ambiguous, needs manual review.` });
        continue;
      }
      const expectedPhotographer = photographerSeqService.canonicalName(photographerSeg.name);
      attributionCandidates.push({ path: full, expectedPhotographer });
    }
  }

  await recurse(eventFolderPath, []);
  return { containerRenames, needsReview, attributionCandidates };
}

// ── Best-effort current-Creator read-back (read-only; never writes) ────────────

async function readCurrentCreator(filePath) {
  try {
    // Lazy require: main/exifService.js pulls in exiftool-vendored only when actually
    // invoked, and this tool must still produce a plan when ExifTool/that module can't
    // be loaded (e.g. run outside the full app environment) — see --no-read-metadata.
    const exifService = require('../main/exifService');
    const tags = await exifService.readFileTags(filePath);
    return tags.Creator ?? tags['XMP-dc:Creator'] ?? null;
  } catch (err) {
    return { error: err.message };
  }
}

// ── Report ───────────────────────────────────────────────────────────────────────

function looksCorrupted(creatorValue, expectedPhotographer) {
  const v = Array.isArray(creatorValue) ? creatorValue[0] : creatorValue;
  if (typeof v !== 'string' || !v) return false;
  if (v === expectedPhotographer) return false;
  return photographerSeqService.isQmzContainerName(v);
}

(async () => {
  let stat;
  try {
    stat = await fsp.stat(eventFolderPath);
  } catch {
    console.error(`Event folder not found: ${eventFolderPath}`);
    process.exit(2);
  }
  if (!stat.isDirectory()) {
    console.error(`Not a directory: ${eventFolderPath}`);
    process.exit(2);
  }

  console.log(`QMZ attribution repair plan (preview only — no files or folders are modified)`);
  console.log(`Event folder: ${eventFolderPath}`);
  console.log(readMetadata ? 'Reading current Creator values via ExifTool (read-only)…' : 'Skipping ExifTool read-back (--no-read-metadata)');
  console.log('');

  const { containerRenames, needsReview, attributionCandidates } = await walk(eventFolderPath);

  const attributionFixes = [];     // confirmed-corrupted Creator, with a reliable replacement
  const attributionUnverified = []; // --no-read-metadata: expected value only, current value not checked
  const attributionUnclear = [];
  for (const cand of attributionCandidates) {
    if (!readMetadata) {
      attributionUnverified.push({ path: cand.path, expectedPhotographer: cand.expectedPhotographer });
      continue;
    }
    const current = await readCurrentCreator(cand.path);
    if (current && typeof current === 'object' && 'error' in current) {
      attributionUnclear.push({ path: cand.path, reason: `Could not read current metadata: ${current.error}` });
      continue;
    }
    const currentVal = Array.isArray(current) ? current[0] : current;
    if (currentVal === cand.expectedPhotographer) continue; // already correct — nothing to report
    if (looksCorrupted(current, cand.expectedPhotographer)) {
      attributionFixes.push({ path: cand.path, expectedPhotographer: cand.expectedPhotographer, currentCreator: currentVal ?? null });
    }
    // A current value that does NOT look QMZ-corrupted (e.g. a real but different
    // photographer name) is NEVER proposed as a fix here — that is an explicit creator
    // correction, out of scope for an automated repair plan.
  }

  const report = {
    eventFolderPath,
    generatedAt: new Date().toISOString(),
    metadataVerified: readMetadata,
    summary: {
      containerRenames: containerRenames.length,
      attributionFixes: attributionFixes.length,
      attributionUnverified: attributionUnverified.length,
      needsManualReview: needsReview.length + attributionUnclear.length,
    },
    containerRenames,
    attributionFixes,
    attributionUnverified,
    needsManualReview: [...needsReview, ...attributionUnclear],
  };

  console.log(`Mis-prefixed QMZ containers to rename back (contents untouched): ${containerRenames.length}`);
  for (const c of containerRenames) console.log(`  ${c.path}\n    "${c.from}" → "${c.to}"`);

  console.log(`\nMedia files whose Creator is confirmed QMZ-corrupted, with a reliable replacement: ${attributionFixes.length}`);
  for (const f of attributionFixes) console.log(`  ${f.path}\n    current: ${JSON.stringify(f.currentCreator)} → expected: ${JSON.stringify(f.expectedPhotographer)}`);

  if (!readMetadata) {
    console.log(`\nMedia files resolved to an expected photographer, but current value NOT checked (--no-read-metadata): ${attributionUnverified.length}`);
    for (const f of attributionUnverified) console.log(`  ${f.path}\n    expected: ${JSON.stringify(f.expectedPhotographer)}`);
  }

  console.log(`\nItems needing manual review (no automatic fix proposed): ${report.needsManualReview.length}`);
  for (const r of report.needsManualReview) console.log(`  ${r.path}\n    ${r.reason}`);

  console.log(`\nThis is a preview only. Nothing was renamed or rewritten. Review this plan before applying any part of it.`);

  if (jsonOutPath) {
    await fsp.writeFile(jsonOutPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nFull report written to: ${jsonOutPath}`);
  }

  // The lazily-spawned ExifTool process pool (readCurrentCreator → main/exifService.js)
  // keeps its own event loop handle alive indefinitely — shut it down explicitly so this
  // one-shot CLI tool actually exits instead of hanging after the report is printed.
  if (readMetadata) {
    try { await require('../main/exifService').shutdown(); } catch { /* never spawned, or already down */ }
  }
})().catch(async err => {
  console.error(`Unexpected error: ${err.message}`);
  console.error(err.stack);
  try { await require('../main/exifService').shutdown(); } catch { /* ignore */ }
  process.exit(1);
});
