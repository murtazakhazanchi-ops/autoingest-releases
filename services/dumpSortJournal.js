/**
 * dumpSortJournal.js — the durable record of a Sort Dump transaction (AI-FEAT-064 EQI-3).
 *
 *   <event>/.autoingest/dump-sort/<txId>.json        unfinished (or needing attention)
 *   <event>/.autoingest/dump-sort/done/<txId>.json   finished — kept as the audit trail
 *
 * Written next to the media it describes (the event folder, so it travels with the archive and is
 * visible to every computer that opens the event) and never synced as media (".autoingest" is skipped
 * by archive sync, scans and Dump discovery). Every write is temp file → fsync → rename → fsync dir,
 * so a crash leaves either the previous or the new journal, never a torn one.
 *
 * The journal holds the INTENT (which file goes where); what actually happened is always re-derived
 * from the filesystem on recovery (see dumpSortEngine.recover), so it never has to be rewritten per file.
 */

'use strict';

const path = require('path');
const fsp = require('fs').promises;
const crypto = require('crypto');

const SCHEMA = 'autoingest.dumpSort';
const VERSION = 1;
const DIR = path.join('.autoingest', 'dump-sort');
const KEEP_DONE = 50;

const journalDir = (eventPath) => path.join(eventPath, DIR);
const newTxId = () => `ds-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

async function _fsyncDir(io, dir) {
  if (!io.open) return;
  let h;
  try { h = await io.open(dir, 'r'); await h.sync(); } catch { /* not supported on every filesystem */ } finally { if (h) await h.close().catch(() => {}); }
}

async function _atomicWrite(io, file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  if (io.open) {
    const h = await io.open(tmp, 'w');
    try { await h.writeFile(data, 'utf8'); await h.sync(); } finally { await h.close(); }
  } else {
    await io.writeFile(tmp, data, 'utf8');
  }
  try { await io.rename(tmp, file); } catch (err) { await io.unlink(tmp).catch(() => {}); throw err; }
  await _fsyncDir(io, path.dirname(file));
}

/** Writes (creates or replaces) the journal for `doc.txId`. */
async function write(eventPath, doc, io = fsp) {
  const dir = journalDir(eventPath);
  await io.mkdir(dir, { recursive: true });
  const out = { schema: SCHEMA, version: VERSION, ...doc, updatedAt: new Date().toISOString() };
  await _atomicWrite(io, path.join(dir, `${doc.txId}.json`), JSON.stringify(out, null, 1));
  return out;
}

/** Unfinished journals for this event (oldest first). A malformed file is reported, never skipped silently. */
async function listPending(eventPath, io = fsp) {
  const dir = journalDir(eventPath);
  let names;
  try { names = await io.readdir(dir); } catch { return { journals: [], unreadable: [] }; }
  const journals = [];
  const unreadable = [];
  for (const n of names.filter(x => /^ds-[a-z0-9-]+\.json$/.test(x)).sort()) {
    try {
      const doc = JSON.parse(await io.readFile(path.join(dir, n), 'utf8'));
      if (doc && doc.schema === SCHEMA && doc.version === VERSION && Array.isArray(doc.assets)) journals.push(doc);
      else unreadable.push(n);
    } catch { unreadable.push(n); }
  }
  return { journals, unreadable };
}

/** Moves a finished journal to done/ (the audit trail) and trims the oldest beyond KEEP_DONE. */
async function finish(eventPath, doc, io = fsp) {
  const dir = journalDir(eventPath);
  const done = path.join(dir, 'done');
  await io.mkdir(done, { recursive: true });
  const final = { schema: SCHEMA, version: VERSION, ...doc, updatedAt: new Date().toISOString() };
  await _atomicWrite(io, path.join(done, `${doc.txId}.json`), JSON.stringify(final, null, 1));
  await io.unlink(path.join(dir, `${doc.txId}.json`)).catch(() => {});
  await _fsyncDir(io, dir);
  try {
    const old = (await io.readdir(done)).filter(n => n.endsWith('.json')).sort();
    for (const n of old.slice(0, Math.max(0, old.length - KEEP_DONE))) await io.unlink(path.join(done, n)).catch(() => {});
  } catch { /* trimming is best effort */ }
  return final;
}

module.exports = { write, listPending, finish, newTxId, journalDir, atomicWrite: _atomicWrite, SCHEMA, VERSION };
