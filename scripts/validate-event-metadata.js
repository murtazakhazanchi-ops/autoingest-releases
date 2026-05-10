#!/usr/bin/env node
'use strict';

/**
 * validate-event-metadata.js
 *
 * Standalone developer tool that validates the consistency of an event folder's
 * event.json and event.metadata.json without modifying any files.
 *
 * Usage:
 *   node scripts/validate-event-metadata.js "/absolute/path/to/event/folder"
 *
 * Exit codes:
 *   0  — PASS or PASS-WITH-WARNINGS (no structural errors)
 *   1  — FAIL (one or more structural errors found)
 */

const path = require('path');
const fsp  = require('fs').promises;
const fs   = require('fs');

// ── CLI ────────────────────────────────────────────────────────────────────────

const eventFolderPath = process.argv[2];
if (!eventFolderPath) {
  console.error('Usage: node scripts/validate-event-metadata.js "/path/to/event/folder"');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let errors   = 0;
let warnings = 0;

function fail(msg)  { console.error(`  [FAIL]  ${msg}`); errors++; }
function warn(msg)  { console.warn( `  [WARN]  ${msg}`); warnings++; }
function ok(msg)    { console.log(  `  [OK]    ${msg}`); }
function info(msg)  { console.log(  `  [INFO]  ${msg}`); }

// ── Main ───────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nValidating: ${eventFolderPath}\n`);

  // ── 1. event folder must exist ──────────────────────────────────────────────
  try {
    const st = await fsp.stat(eventFolderPath);
    if (!st.isDirectory()) { fail('Path exists but is not a directory.'); process.exit(1); }
  } catch {
    fail('Event folder does not exist or is not accessible.');
    process.exit(1);
  }

  // ── 2. event.json ──────────────────────────────────────────────────────────
  const eventJsonPath = path.join(eventFolderPath, 'event.json');
  let eventDoc;
  try {
    const raw = await fsp.readFile(eventJsonPath, 'utf8');
    eventDoc  = JSON.parse(raw);
    ok('event.json — valid JSON');
  } catch (err) {
    fail(`event.json — ${err.message}`);
    process.exit(1);
  }

  const eventId = eventDoc.eventId || null;
  if (!eventId) {
    warn('event.json — missing eventId field');
  } else {
    ok(`event.json — eventId: ${eventId}`);
  }

  const eventName = eventDoc.eventName || eventDoc.folderName || '(unnamed)';
  info(`Event name: ${eventName}`);

  // ── 3. event.metadata.json (optional — first-sync events may not have it) ──
  const metaJsonPath = path.join(eventFolderPath, 'event.metadata.json');
  let metaDoc;
  try {
    const raw = await fsp.readFile(metaJsonPath, 'utf8');
    metaDoc   = JSON.parse(raw);
    ok('event.metadata.json — valid JSON');
  } catch (err) {
    if (err.code === 'ENOENT') {
      info('event.metadata.json — not present (first-sync or migration-needed; not an error)');
    } else {
      fail(`event.metadata.json — ${err.message}`);
    }
  }

  if (!metaDoc) {
    printSummary();
    return;
  }

  // ── 4. eventId consistency ─────────────────────────────────────────────────
  const metaEventId = metaDoc.eventId || null;
  if (!metaEventId) {
    warn('event.metadata.json — missing eventId field');
  } else if (eventId && metaEventId !== eventId) {
    fail(`eventId mismatch: event.json has "${eventId}", event.metadata.json has "${metaEventId}"`);
  } else {
    ok(`eventId consistent: ${metaEventId}`);
  }

  // ── 5. keyword dictionary — no duplicate IDs (structural integrity) ─────────
  const keywords = metaDoc.keywords || {};
  const kwIds    = Object.keys(keywords);
  info(`Keyword dictionary: ${kwIds.length} entries`);

  const seenLabels = new Map();
  for (const id of kwIds) {
    const kw = keywords[id];
    if (!kw || typeof kw !== 'object') { fail(`keyword "${id}" — value is not an object`); continue; }
    if (!kw.label) { warn(`keyword "${id}" — missing label`); }
    const labelLo = (kw.label || '').toLowerCase();
    if (labelLo && seenLabels.has(labelLo)) {
      warn(`keyword label "${kw.label}" appears under both IDs "${seenLabels.get(labelLo)}" and "${id}"`);
    } else if (labelLo) {
      seenLabels.set(labelLo, id);
    }
  }

  // ── 6. file entries — no orphaned keyword references ───────────────────────
  const files     = metaDoc.files || {};
  const filePaths = Object.keys(files);
  info(`File entries: ${filePaths.length}`);

  let orphanedRefs  = 0;
  let malformedPaths = 0;

  for (const relPath of filePaths) {
    // Malformed relPath check
    if (relPath.startsWith('/') || relPath.includes('..')) {
      fail(`file entry "${relPath}" — malformed relative path (absolute or traversal)`);
      malformedPaths++;
    }

    const entry   = files[relPath];
    const extIds  = Array.isArray(entry.externalKeywordIds) ? entry.externalKeywordIds : [];
    const autoIds = Array.isArray(entry.autoKeywordIds)     ? entry.autoKeywordIds     : [];

    for (const id of [...extIds, ...autoIds]) {
      if (!keywords[id]) {
        fail(`file "${relPath}" references keyword ID "${id}" not present in dictionary`);
        orphanedRefs++;
      }
    }
  }

  if (orphanedRefs === 0)   ok('No orphaned keyword references found');
  if (malformedPaths === 0) ok('All file relPaths are well-formed');

  // ── 7. summary counts consistency ─────────────────────────────────────────
  const summary = metaDoc.summary || {};
  if (Object.keys(summary).length > 0) {
    const actualFiles = filePaths.length;
    if (typeof summary.totalFiles === 'number' && summary.totalFiles !== actualFiles) {
      warn(`summary.totalFiles (${summary.totalFiles}) does not match actual file entry count (${actualFiles})`);
    } else if (typeof summary.totalFiles === 'number') {
      ok(`summary.totalFiles matches file entry count (${actualFiles})`);
    }
    const actualKws = kwIds.length;
    if (typeof summary.totalKeywords === 'number' && summary.totalKeywords !== actualKws) {
      warn(`summary.totalKeywords (${summary.totalKeywords}) does not match actual keyword dictionary size (${actualKws})`);
    } else if (typeof summary.totalKeywords === 'number') {
      ok(`summary.totalKeywords matches keyword dictionary size (${actualKws})`);
    }
  } else {
    info('No summary block in event.metadata.json — skipping count checks');
  }

  // ── 8. physical file existence (warnings only) ────────────────────────────
  let missingFiles = 0;
  for (const relPath of filePaths) {
    const absPath = path.join(eventFolderPath, relPath);
    if (!fs.existsSync(absPath)) {
      warn(`file entry "${relPath}" — physical file not found at expected location`);
      missingFiles++;
    }
  }
  if (missingFiles === 0 && filePaths.length > 0) ok('All indexed files physically present');

  printSummary();
}

function printSummary() {
  console.log('');
  if (errors > 0) {
    console.error(`FAIL — ${errors} error(s), ${warnings} warning(s)`);
    process.exit(1);
  } else if (warnings > 0) {
    console.warn(`PASS-WITH-WARNINGS — 0 errors, ${warnings} warning(s)`);
    process.exit(0);
  } else {
    console.log('PASS — no errors or warnings');
    process.exit(0);
  }
}

run().catch(err => {
  console.error(`[validate-event-metadata] Unexpected error: ${err.message}`);
  process.exit(1);
});
