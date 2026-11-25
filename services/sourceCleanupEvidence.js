/**
 * sourceCleanupEvidence.js — durable per-file import evidence for EQI-4 Source Cleanup (AI-FEAT-064).
 *
 * Written by the import transaction ONLY after event.json was committed 'complete': one JSON file per
 * import batch in <userData>/source-cleanup/evidence/<batchId>.json, atomically (tmp + rename). Each
 * entry names the source file, its identity when it was imported (size, modification time, birth
 * time, inode, and a fingerprint of its first and last 64 KB), the verified-copy destination, and how it was imported (Direct Archive / Local First).
 *
 * This is the "was it really imported, from here, to there" half of cleanup eligibility. It is never
 * enough on its own: before anything is moved to the Trash, the source is compared byte-for-byte (or by
 * image data) with the archive copy (services/sourceCleanupEligibility.js). The rolling import index
 * (name + size) is not used.
 *
 * Contents are local to this computer and never logged.
 */

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const SCHEMA = 'autoingest.sourceCleanupEvidence';
const VERSION = 1;
const MAX_FILES_PER_BATCH = 20000;
const MAX_AGE_MS = 180 * 24 * 3600 * 1000;   // evidence older than this is pruned (the card was cleaned or reused long ago)

const evidenceDir = (userData) => path.join(userData, 'source-cleanup', 'evidence');
const safeId = (id) => String(id || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || `b${Date.now().toString(36)}`;

async function _statIdentity(p) {
  const st = await fsp.stat(p, { bigint: false });
  return { size: st.size, mtimeMs: Math.round(st.mtimeMs), birthtimeMs: Math.round(st.birthtimeMs || 0), ino: st.ino, dev: st.dev };
}

const FP_SPAN = 64 * 1024;
/**
 * Source fingerprint: SHA-256 of the size plus the first and last 64 KB. Cheap enough for every imported
 * file (≤128 KB read), and an edited or replaced file — even with the same name, size and time, or the
 * same image data with other metadata — no longer matches.
 */
async function fingerprint(p) {
  const fh = await fsp.open(p, 'r');
  try {
    const { size } = await fh.stat();
    const h = require('crypto').createHash('sha256').update(String(size));
    const head = Buffer.alloc(Math.min(FP_SPAN, size));
    await fh.read(head, 0, head.length, 0);
    h.update(head);
    if (size > FP_SPAN) {
      const tail = Buffer.alloc(Math.min(FP_SPAN, size - FP_SPAN));
      await fh.read(tail, 0, tail.length, size - tail.length);
      h.update(tail);
    }
    return h.digest('hex');
  } finally { await fh.close(); }
}

/**
 * Records the verified copies of one committed import batch. Never throws (cleanup simply has no
 * evidence for a batch whose record could not be written — the files stay on the source).
 * @param {string} userData
 * @param {{ batchId: string, importMode: string|null, eventPath: string|null, destination: string|null,
 *           sourceRoot: string|null, sourceLabel: string|null, sourceType: string|null,
 *           files: Array<{ src: string, dest: string, size: number }> }} batch
 * @returns {Promise<{ ok: boolean, recorded: number, reason?: string }>}
 */
async function recordBatch(userData, batch) {
  try {
    if (!userData || !batch || !Array.isArray(batch.files) || !batch.files.length) return { ok: false, recorded: 0, reason: 'nothing to record' };
    const files = [];
    for (const f of batch.files.slice(0, MAX_FILES_PER_BATCH)) {
      if (!f || typeof f.src !== 'string' || typeof f.dest !== 'string') continue;
      let srcId = null;
      try { srcId = await _statIdentity(f.src); } catch { /* source gone already: no evidence for it */ }
      if (!srcId || (typeof f.size === 'number' && srcId.size !== f.size)) continue;   // changed during the import
      let fp = null;
      try { fp = await fingerprint(f.src); } catch { continue; }
      files.push({ src: path.resolve(f.src), dest: path.resolve(f.dest), size: srcId.size, src_id: srcId, src_fp: fp });
    }
    if (!files.length) return { ok: false, recorded: 0, reason: 'no source file still identical' };
    const doc = {
      schema: SCHEMA, version: VERSION, batchId: String(batch.batchId || ''), recordedAt: new Date().toISOString(),
      importMode: batch.importMode === 'local-first' ? 'local-first' : 'direct',
      eventPath: batch.eventPath ? path.resolve(batch.eventPath) : null, destination: batch.destination || null,
      source: { root: batch.sourceRoot ? path.resolve(batch.sourceRoot) : null, label: batch.sourceLabel || null, type: batch.sourceType || null },
      files,
    };
    const dir = evidenceDir(userData);
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${safeId(batch.batchId)}-${Date.now().toString(36)}.json`);
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(doc), 'utf8');
    const fh = await fsp.open(tmp, 'r+'); try { await fh.sync(); } finally { await fh.close(); }
    await fsp.rename(tmp, file);
    return { ok: true, recorded: files.length };
  } catch (err) {
    return { ok: false, recorded: 0, reason: err.message };
  }
}

/**
 * The newest evidence entry for every file under `sourceRoot` (path-prefix match on resolved paths).
 * Each entry carries its batch's importMode / eventPath / batchId.
 * @returns {Promise<Map<string, object>>} src path → entry
 */
async function forSource(userData, sourceRoot) {
  const out = new Map();
  if (!userData || !sourceRoot) return out;
  const root = path.resolve(sourceRoot);
  const under = (p) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  let names = [];
  try { names = (await fsp.readdir(evidenceDir(userData))).filter(n => n.endsWith('.json')); } catch { return out; }
  const docs = [];
  for (const n of names) {
    try {
      const doc = JSON.parse(await fsp.readFile(path.join(evidenceDir(userData), n), 'utf8'));
      if (doc && doc.schema === SCHEMA && Array.isArray(doc.files)) docs.push(doc);
    } catch { /* a damaged record is ignored: its files are simply not eligible */ }
  }
  docs.sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
  for (const doc of docs) {
    for (const f of doc.files) {
      if (!f || typeof f.src !== 'string' || !under(f.src)) continue;
      out.set(f.src, { ...f, batchId: doc.batchId, importMode: doc.importMode, eventPath: doc.eventPath, destination: doc.destination, recordedAt: doc.recordedAt });
    }
  }
  return out;
}

/** Removes evidence files older than MAX_AGE_MS. Best effort. */
async function prune(userData, now = Date.now()) {
  let removed = 0;
  try {
    const dir = evidenceDir(userData);
    for (const n of await fsp.readdir(dir)) {
      const p = path.join(dir, n);
      try { const st = await fsp.stat(p); if (now - st.mtimeMs > MAX_AGE_MS) { await fsp.unlink(p); removed++; } } catch { /* next */ }
    }
  } catch { /* no evidence yet */ }
  return removed;
}

module.exports = { recordBatch, forSource, prune, fingerprint, evidenceDir, SCHEMA, VERSION };
