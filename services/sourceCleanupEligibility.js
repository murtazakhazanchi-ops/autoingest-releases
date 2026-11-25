/**
 * sourceCleanupEligibility.js — which source files EQI-4 Source Cleanup may move to the Trash
 * (AI-FEAT-064). Read-only: it reads files and hashes, never changes anything.
 *
 * A file is eligible only when ALL of these hold (each failure is a stated reason):
 *   1. it is a regular file inside the selected source (after resolving links);
 *   2. a committed import recorded it (services/sourceCleanupEvidence.js) — never the name+size index;
 *   3. it is unchanged since that import (size, modification time and the first/last-64 KB fingerprint);
 *   4. its canonical archive copy is known: the verified destination for Direct Archive; for Local First,
 *      the synced ARCHIVE copy (routed like sync does) — an unsynced staging copy never qualifies;
 *   5. that copy exists and is a different physical file;
 *   6. its content matches the source now: identical bytes (SHA-256), or — when AutoIngest wrote metadata
 *      into the copy — identical image data (ExifTool ImageDataHash, metadata excluded).
 * Files are judged per ASSET (same folder + same base name: RAW + JPEG + XMP sidecar, or a video): an
 * asset is cleaned only when every one of its files on the source is eligible, so a RAW is never removed
 * while its JPEG or sidecar stays behind unverified.
 */

'use strict';

const path = require('path');

const SIDECAR_EXTS = new Set(['.xmp']);
const CONCURRENCY = 3;

/** Asset key: folder + base name, case-insensitive. */
function assetKey(p) {
  const dir = path.dirname(p);
  const base = path.basename(p, path.extname(p));
  return `${dir.toLowerCase()}${path.sep}${base.toLowerCase()}`;
}

function under(root, p) {
  const r = path.resolve(root);
  const q = path.resolve(p);
  return q === r || q.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/**
 * @param {object} args
 * @param {string} args.sourceRoot
 * @param {Array<{ path: string, size?: number }>} args.files  every media/sidecar file now on the source
 * @param {Map<string, object>} args.evidence  sourceCleanupEvidence.forSource()
 * @param {object} args.io  { realpath, stat, sha256, imageHash, fingerprint, canonicalOf(entry) → { path } | { reason } }
 * @param {(p: {done:number,total:number}) => void} [args.onProgress]
 * @returns {Promise<{ files: object[], assets: object[], eligible: object[], excluded: object[], unimported: object[] }>}
 */
async function assess({ sourceRoot, files, evidence, io, onProgress }) {
  const realRoot = await io.realpath(sourceRoot);
  const list = (files || []).filter(f => f && typeof f.path === 'string');
  const results = new Array(list.length);
  let next = 0, done = 0;
  const one = async (f) => {
    const p = path.resolve(f.path);
    const r = { path: p, name: path.basename(p), size: f.size || 0, eligible: false, reason: null, imported: false, verified: null, dest: null };
    const ev = evidence.get(p);
    if (!ev) { r.reason = 'Not imported from this source by AutoIngest'; return r; }
    r.imported = true;
    r.batchId = ev.batchId; r.importMode = ev.importMode;
    let real;
    try { real = await io.realpath(p); } catch { r.reason = 'File no longer on the source'; return r; }
    if (!under(realRoot, real)) { r.reason = 'Outside the selected source'; return r; }
    let st;
    try { st = await io.stat(real); } catch { r.reason = 'Cannot read the file'; return r; }
    if (!st.isFile()) { r.reason = 'Not a regular file'; return r; }
    r.size = st.size;
    const id = ev.src_id || {};
    if (st.size !== ev.size || (id.mtimeMs && Math.abs(Math.round(st.mtimeMs) - id.mtimeMs) > 2000)) { r.reason = 'Changed on the source since it was imported'; return r; }
    if (!ev.src_fp) { r.reason = 'No source fingerprint was recorded at import'; return r; }
    try { if ((await io.fingerprint(real)) !== ev.src_fp) { r.reason = 'Changed on the source since it was imported'; return r; } }
    catch { r.reason = 'Cannot read the file'; return r; }
    const canon = await io.canonicalOf(ev).catch(err => ({ reason: err.message }));
    if (!canon || !canon.path) { r.reason = (canon && canon.reason) || 'Archive copy unknown'; return r; }
    r.dest = canon.path;
    let dst;
    try { dst = await io.stat(canon.path); } catch { r.reason = canon.missingReason || 'Archive copy not found (archive unavailable?)'; return r; }
    if (!dst.isFile()) { r.reason = 'Archive copy is not a file'; return r; }
    if (dst.dev === st.dev && dst.ino === st.ino) { r.reason = 'Source and archive copy are the same file'; return r; }
    if (under(realRoot, canon.path)) { r.reason = 'Archive copy is inside the source'; return r; }
    // Content: identical bytes, or — the copy's metadata was written by AutoIngest — identical image data.
    try {
      if (dst.size === st.size) {
        const [a, b] = await Promise.all([io.sha256(real), io.sha256(canon.path)]);
        if (a && a === b) { r.eligible = true; r.verified = 'sha256'; return r; }
      }
      const ext = path.extname(p).toLowerCase();
      if (!SIDECAR_EXTS.has(ext)) {
        const [a, b] = await Promise.all([io.imageHash(real), io.imageHash(canon.path)]);
        if (a && a === b) { r.eligible = true; r.verified = 'image-data'; return r; }
      }
    } catch { r.reason = 'Could not verify against the archive copy'; return r; }
    r.reason = 'Archive copy differs from the source file';
    return r;
  };
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await one(list[i]);
      done++;
      if (onProgress) { try { onProgress({ done, total: list.length }); } catch { /* observer */ } }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));

  // Per asset: all-or-nothing.
  const byAsset = new Map();
  for (const r of results) {
    const k = assetKey(r.path);
    if (!byAsset.has(k)) byAsset.set(k, []);
    byAsset.get(k).push(r);
  }
  const assets = [];
  for (const [key, members] of byAsset) {
    const blocking = members.filter(m => !m.eligible);
    const ok = blocking.length === 0;
    if (!ok && blocking.length < members.length) {
      for (const m of members) if (m.eligible) { m.eligible = false; m.reason = `Kept with ${blocking[0].name}: ${blocking[0].reason}`; m.heldByPair = true; }
    }
    assets.push({ id: key, eligible: ok, files: members.map(m => m.path), bytes: members.reduce((s, m) => s + (m.size || 0), 0), names: members.map(m => m.name) });
  }
  return {
    files: results,
    assets,
    eligible: results.filter(r => r.eligible),
    excluded: results.filter(r => !r.eligible && r.imported),
    unimported: results.filter(r => !r.imported),
  };
}

module.exports = { assess, assetKey, under };
