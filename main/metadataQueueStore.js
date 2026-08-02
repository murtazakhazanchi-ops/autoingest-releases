'use strict';

/**
 * metadataQueueStore.js — durable manifest + append-only journal persistence for
 * exifService's metadata batches, under userData (never the archive root, which may
 * be offline/read-only/externally-mounted).
 *
 * Manifest: written once, atomically, before any file in the batch is processed.
 * Immutable thereafter — it is the frozen "what should happen" record.
 * Journal: append-only, one line per per-file status transition — the "what already
 * happened" record. Resume replays manifest + journal to compute current state
 * without ever rewriting a full-batch document on every status change.
 */

const fsp  = require('fs/promises');
const fs   = require('fs');
const path = require('path');

function queueDir() {
  // Test-only override so unit tests can run under plain Node (matching this repo's
  // other test/*.test.js files) without needing a real Electron runtime for app.getPath.
  if (process.env.AUTOINGEST_METADATA_QUEUE_DIR) return process.env.AUTOINGEST_METADATA_QUEUE_DIR;
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'metadata-queue');
}

function compactedDir() {
  return path.join(queueDir(), 'compacted');
}

function manifestPath(batchId) {
  return path.join(queueDir(), `${batchId}.manifest.json`);
}

function journalPath(batchId) {
  return path.join(queueDir(), `${batchId}.journal.jsonl`);
}

async function _ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

/**
 * Reads {type, createdAt} from an AutoIngest root marker file (archive-root.json /
 * transfer-root.json) — the same identity mechanism already used elsewhere in this
 * app so a changed mount path for the same physical archive doesn't defeat recovery.
 * Best-effort: returns null if the marker is missing or unreadable, never throws.
 */
async function readRootIdentity(markerPath) {
  try {
    const raw = await fsp.readFile(markerPath, 'utf8');
    const marker = JSON.parse(raw);
    return { type: marker.type || null, createdAt: marker.createdAt || null };
  } catch {
    return null;
  }
}

/**
 * Writes the batch manifest once, atomically. Throws if a manifest for this batchId
 * already exists — manifests are immutable, never overwritten.
 * @param {string} batchId
 * @param {object} manifestData
 */
async function writeManifestOnce(batchId, manifestData) {
  await _ensureDir(queueDir());
  const dest = manifestPath(batchId);
  try {
    await fsp.access(dest);
    return; // already written (e.g. a duplicate applyBatch call for the same batchId) — no-op, immutable.
  } catch { /* doesn't exist yet — proceed */ }

  const tmp = dest + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(manifestData, null, 2), 'utf8');
  await fsp.rename(tmp, dest);
}

async function readManifest(batchId) {
  try {
    const raw = await fsp.readFile(manifestPath(batchId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Appends one journal line. Small atomic append, never a full-document rewrite.
 * @param {string} batchId
 * @param {{dest:string, status:string, attempt?:number, error?:string|null}} entry
 */
async function appendJournalEntry(batchId, entry) {
  await _ensureDir(queueDir());
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  await fsp.appendFile(journalPath(batchId), line, 'utf8');
}

/**
 * Reads and parses every journal line for a batch. Corrupt/unparseable lines are
 * quarantined (moved into a sibling .corrupt-lines file, logged) rather than
 * silently dropped or allowed to abort the whole read.
 * @param {string} batchId
 * @returns {Promise<Array<{ts:string, dest:string, status:string, attempt?:number, error?:string|null}>>}
 */
async function readJournal(batchId) {
  let raw;
  try {
    raw = await fsp.readFile(journalPath(batchId), 'utf8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const entries = [];
  const corrupt = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.dest === 'string' && typeof parsed.status === 'string') {
        entries.push(parsed);
      } else {
        corrupt.push(line);
      }
    } catch {
      corrupt.push(line);
    }
  }
  if (corrupt.length > 0) {
    const quarantinePath = journalPath(batchId) + '.quarantine';
    try {
      await fsp.appendFile(
        quarantinePath,
        corrupt.map(l => JSON.stringify({ quarantinedAt: new Date().toISOString(), line: l })).join('\n') + '\n',
        'utf8'
      );
    } catch { /* best-effort — quarantine failure must not block reading the good entries */ }
    console.error(`[metadataQueueStore] Quarantined ${corrupt.length} corrupt journal line(s) for batch ${batchId}`);
  }
  return entries;
}

const NON_TERMINAL_STATUSES = new Set(['writing', 'queued']);

/**
 * Replays manifest + journal to compute the current per-file state. A file whose
 * last journal entry is non-terminal ('writing'/'queued') is normalized to
 * 'interrupted' — the apply engine's writes are idempotent and read-back-verified,
 * so resuming it is always a safe, verifiable no-op or a genuine completion, never
 * a duplicate write.
 * @param {object} manifest
 * @param {Array} journalEntries
 * @returns {Map<string, {status:string, lastEntry:object|null}>} keyed by dest path
 */
function computeFileStates(manifest, journalEntries) {
  const lastByDest = new Map();
  for (const entry of journalEntries) {
    const prior = lastByDest.get(entry.dest);
    if (!prior || entry.ts >= prior.ts) lastByDest.set(entry.dest, entry);
  }

  const states = new Map();
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  for (const f of files) {
    const last = lastByDest.get(f.dest) || null;
    if (!last) {
      states.set(f.dest, { status: 'interrupted', lastEntry: null });
    } else if (NON_TERMINAL_STATUSES.has(last.status)) {
      states.set(f.dest, { status: 'interrupted', lastEntry: last });
    } else {
      states.set(f.dest, { status: last.status, lastEntry: last });
    }
  }
  return states;
}

/**
 * Lists every batchId with an active (non-compacted) manifest in the queue dir.
 */
async function listActiveBatchIds() {
  await _ensureDir(queueDir());
  let entries;
  try {
    entries = await fsp.readdir(queueDir(), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.manifest.json'))
    .map(e => e.name.slice(0, -'.manifest.json'.length));
}

/**
 * Moves a completed batch's manifest+journal out of the active queue directory.
 * Caller must only call this after the batch's final state is durably reflected
 * in the owning event's event.json metadata-status block — compacting first would
 * make an interrupted-after-compaction batch invisible to resume, silently losing
 * its outcome.
 */
async function compactBatch(batchId) {
  await _ensureDir(compactedDir());
  const moves = [
    [manifestPath(batchId), path.join(compactedDir(), `${batchId}.manifest.json`)],
    [journalPath(batchId), path.join(compactedDir(), `${batchId}.journal.jsonl`)],
  ];
  for (const [from, to] of moves) {
    try {
      await fsp.rename(from, to);
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`[metadataQueueStore] compact failed for ${from}:`, err.message);
    }
  }
}

module.exports = {
  queueDir,
  readRootIdentity,
  writeManifestOnce,
  readManifest,
  appendJournalEntry,
  readJournal,
  computeFileStates,
  listActiveBatchIds,
  compactBatch,
};
