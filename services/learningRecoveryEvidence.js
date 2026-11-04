/**
 * learningRecoveryEvidence.js — what a LATER run may trust when it recovers the learning of an
 * import that committed but whose learning never finished (AI-FEAT-063, AI-RM-014 Q4d).
 * Pure decisions over injected I/O (stat, read, image-data hash), so every rule is unit-tested.
 *
 * 1. The import must still be verifiably committed (verifyCommittedImport):
 *    - the pending record was made on THIS computer: its computerId equals this computer's and
 *      its importId recomputes from (computerId, entry IDs);
 *    - the event folder's event.json still lists EVERY entry ID with the same photographer
 *      (entries are only written by a successful commit; a rollback restores the pre-import
 *      snapshot, which cannot contain them) and, when recorded, the same operator;
 *    - every committed file lies inside that event folder.
 *    An unreachable event folder or event.json read error is transient (archive offline);
 *    anything else that fails is final: nothing is recovered.
 *
 * 2. Each newly committed file is classified (classifyCommittedFile). The archive copy is the
 *    committed media, but AutoIngest rewrites JPEG/HEIC/TIFF metadata in place after the copy,
 *    so its bytes no longer equal the source and a rewritten file proves nothing by itself:
 *    - archive copy present with EXACTLY the committed size → it was not rewritten (RAW files
 *      only receive .xmp sidecars, videos are never written) → read the archive copy;
 *    - archive copy present but a different size → trusted only if the source file is still
 *      reachable at its committed path with the committed size AND its image-data hash
 *      (pixel/media data only, metadata excluded) equals the archive copy's → read the SOURCE,
 *      whose camera metadata is original. Otherwise "uncertain" (never read);
 *    - archive copy missing (folder reachable) → "missing"; folder unreachable → transient.
 *    Same-size equality is the import engine's own duplicate rule; it is not a byte hash.
 *
 * 3. An uncertain/missing file whose RAW/JPEG partner (same committed folder and base name) is
 *    trusted is covered by that partner — a pair is one capture. Everything else not trusted
 *    is UNREAD, and unread files keep the import's attribution incomplete: no association is
 *    ever inferred from the files that could be read.
 */

'use strict';

const path = require('path');

const _norm = (s) => String(s || '').trim();
const _inside = (parent, child) => { const r = path.relative(parent, child); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
const _transientCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'EIO', 'ETIMEDOUT', 'EHOSTDOWN', 'ENOTCONN', 'EBUSY', 'ESTALE', 'ENETUNREACH', 'EAGAIN']);

/**
 * @param {object} item  pending record { importId, computerId, entryIds, eventDir, photographer, operatorId, files:[{dest}] }
 * @param {{ computerId: string|null, learningKey: (c: string, ids: string[]) => string,
 *           stat: (p: string) => Promise<object>, readFile: (p: string) => Promise<Buffer|string> }} io
 * @returns {Promise<{ ok: true } | { ok: false, transient: boolean, reason: string }>}
 */
async function verifyCommittedImport(item, io) {
  const bad = (reason) => ({ ok: false, transient: false, reason });
  if (!item || !Array.isArray(item.entryIds) || !item.entryIds.length || typeof item.eventDir !== 'string' || !path.isAbsolute(item.eventDir)) return bad('pending-record-invalid');
  if (!io.computerId || item.computerId !== io.computerId) return bad('different-computer');
  if (io.learningKey(io.computerId, item.entryIds) !== item.importId) return bad('import-key-mismatch');
  if (!Array.isArray(item.files) || !item.files.length || !item.files.every(f => f && typeof f.dest === 'string' && _inside(item.eventDir, f.dest))) return bad('file-outside-event');
  try {
    const st = await io.stat(item.eventDir);
    if (!st.isDirectory()) return bad('event-folder-replaced');
  } catch (err) {
    return { ok: false, transient: true, reason: `archive-unreachable:${err.code || 'error'}` };
  }
  let raw;
  try { raw = await io.readFile(path.join(item.eventDir, 'event.json')); }
  catch (err) {
    if (err.code === 'ENOENT') return bad('event-json-missing');
    return { ok: false, transient: _transientCodes.has(err.code), reason: `event-json-unreadable:${err.code || 'error'}` };
  }
  let doc;
  try { doc = JSON.parse(raw.toString()); } catch { return bad('event-json-corrupt'); }
  const imports = Array.isArray(doc && doc.imports) ? doc.imports : [];
  for (const id of item.entryIds) {
    const e = imports.find(x => x && x.id === id);
    if (!e) return bad('import-entry-missing');
    if (_norm(e.photographer) !== _norm(item.photographer)) return bad('photographer-mismatch');
    const op = e.importedBy && typeof e.importedBy.id === 'string' ? e.importedBy.id : null;
    if (item.operatorId && op && op !== item.operatorId) return bad('operator-mismatch');
  }
  return { ok: true };
}

/**
 * @param {{ src?: string, dest: string, size: number }} file  as committed
 * @param {{ stat: (p: string) => Promise<object>, imageDataHash: (p: string) => Promise<string|null> }} io
 * @returns {Promise<{ status: 'archive'|'source'|'uncertain'|'missing'|'unreachable', path?: string, reason?: string }>}
 */
async function classifyCommittedFile(file, io) {
  let st;
  try { st = await io.stat(file.dest); }
  catch (err) {
    if (err.code !== 'ENOENT') return { status: 'unreachable', reason: err.code || 'error' };
    try { await io.stat(path.dirname(file.dest)); return { status: 'missing', reason: 'archive-copy-missing' }; }
    catch (e2) { return { status: 'unreachable', reason: e2.code || 'error' }; }
  }
  if (!st.isFile()) return { status: 'missing', reason: 'archive-copy-replaced' };
  if (!Number.isFinite(file.size)) return { status: 'uncertain', reason: 'committed-size-unknown' };
  if (st.size === file.size) return { status: 'archive', path: file.dest };
  if (typeof file.src !== 'string' || !file.src) return { status: 'uncertain', reason: 'archive-modified-no-source' };
  const sst = await io.stat(file.src).catch(() => null);
  if (!sst || !sst.isFile()) return { status: 'uncertain', reason: 'archive-modified-source-unavailable' };
  if (sst.size !== file.size) return { status: 'uncertain', reason: 'source-changed' };
  let a = null, s = null;
  try { [a, s] = await Promise.all([io.imageDataHash(file.dest), io.imageDataHash(file.src)]); } catch { /* unreadable → uncertain */ }
  if (!a || !s) return { status: 'uncertain', reason: 'image-data-hash-unavailable' };
  if (a !== s) return { status: 'uncertain', reason: 'image-data-mismatch' };
  return { status: 'source', path: file.src };
}

/** Capture key for RAW/JPEG pairing: committed folder + base name (case-insensitive). */
const captureKey = (dest) => `${path.dirname(dest)}\x00${path.basename(dest, path.extname(dest)).toLowerCase()}`;

/**
 * Combine per-file classifications.
 * @param {Array<{ file: object, c: object }>} classified
 * @returns {{ transient: string|null, usable: Array<{file: object, path: string, via: string}>, unread: number, waitingForSource?: number, counts: object }}
 */
function summarize(classified) {
  const counts = { archive: 0, source: 0, uncertain: 0, missing: 0, pairCovered: 0 };
  const unreachable = classified.find(x => x.c.status === 'unreachable');
  if (unreachable) return { transient: `archive-unreachable:${unreachable.c.reason}`, usable: [], unread: classified.length, counts };
  const trustedKeys = new Set(classified.filter(x => x.c.status === 'archive' || x.c.status === 'source').map(x => captureKey(x.file.dest)));
  const usable = [];
  let unread = 0, waitingForSource = 0;
  for (const { file, c } of classified) {
    if (c.status === 'archive' || c.status === 'source') { counts[c.status]++; usable.push({ file, path: c.path, via: c.status }); continue; }
    if (trustedKeys.has(captureKey(file.dest))) { counts.pairCovered++; continue; }
    counts[c.status]++;
    unread++;
    if (c.reason === 'archive-modified-source-unavailable') waitingForSource++; // the card may come back
  }
  return { transient: null, usable, unread, waitingForSource, counts };
}

const MAX_RENAME_CANDIDATES = 20;

/**
 * The import engine skips a file only when a same-named archive file has the same size. Once
 * AutoIngest has rewritten a JPEG's metadata in place that size differs, so re-importing the
 * same card copies the same picture again as NAME_1.JPG. Such a copy is not new evidence: it
 * is found by comparing its image-data hash with the files it was renamed away from.
 * Costs one stat per "_N"-named file; hashes only when the un-suffixed original exists.
 * @param {Array<{dest: string}>} files
 * @param {{ stat: (p: string) => Promise<object>, imageDataHash: (p: string) => Promise<string|null> }} io
 * @returns {Promise<Set<string>>} dest paths that repeat a picture already in that folder
 */
async function findDuplicateCaptures(files, io) {
  const dups = new Set();
  for (const f of files) {
    const ext = path.extname(f.dest);
    const m = /^(.+)_(\d{1,4})$/.exec(path.basename(f.dest, ext));
    if (!m) continue;
    const dir = path.dirname(f.dest);
    const origin = path.join(dir, m[1] + ext);
    const st = await io.stat(origin).catch(() => null);
    if (!st || !st.isFile()) continue;
    const candidates = [origin, ...Array.from({ length: Math.min(Number(m[2]) - 1, MAX_RENAME_CANDIDATES) }, (_, k) => path.join(dir, `${m[1]}_${k + 1}${ext}`))];
    const own = await io.imageDataHash(f.dest).catch(() => null);
    if (!own) continue;
    for (const c of candidates) {
      if (c === f.dest) continue;
      const h = await io.imageDataHash(c).catch(() => null);
      if (h && h === own) { dups.add(f.dest); break; }
    }
  }
  return dups;
}

module.exports = { verifyCommittedImport, classifyCommittedFile, summarize, captureKey, findDuplicateCaptures };
