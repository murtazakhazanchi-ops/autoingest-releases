/**
 * sourceCleanupService.js — EQI-4 Safe Source Cleanup (AI-FEAT-064): source card / drive / folder →
 * the operating system's recoverable Trash, only for files verified against their archive copy.
 *
 * Separate from Sort Dump (Event Dump → event folders): it never reads or writes an event's Dump,
 * event.json, the import index, metadata or sync state; it refuses any source inside (or containing)
 * an archive or staging root.
 *
 *   review(sourceRoot)  read-only: lists the source, judges every file (sourceCleanupEligibility.js),
 *                       reports eligible assets, excluded files with reasons, unimported files, and where
 *                       the Trash is. Each call re-reads everything — nothing is cached across cleanups.
 *   run(reviewId)       for each eligible asset: re-verify NOW (the card may have changed since the
 *                       review), then trash its files one by one (trashService.js proves each one is in
 *                       the Trash). A durable journal (<userData>/source-cleanup/journal/<op>.json) records
 *                       every file's state BEFORE it is touched.
 *   recover()           an interrupted run is reconciled from the real source and Trash state — never
 *                       repeated: a file still on the source stays there ("not removed"), a file found
 *                       in the Trash is "trashed", anything else is "needs attention". Runs at startup
 *                       and before every review.
 * One cleanup at a time per computer (a lock file names the process; a second AutoIngest is refused).
 */

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 'autoingest.sourceCleanup';
const REVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_LISTED = 300;
const DONE_KEEP = 100;

/**
 * @param {object} deps
 * @param {string} deps.userData
 * @param {object} deps.evidence      services/sourceCleanupEvidence.js
 * @param {object} deps.eligibility   services/sourceCleanupEligibility.js
 * @param {object} deps.trash         services/trashService.js (capability, trashFile, locate)
 * @param {object} deps.io            { realpath, stat, sha256, imageHash }
 * @param {() => { nasRoot?: string, mainArchiveRoot?: string, stagingRoot?: string }} deps.roots
 * @param {(localEventPath: string, nasRoot: string) => Promise<object>} deps.resolveArchiveEvent
 * @param {(localEventPath: string) => Promise<object|null>} deps.readManifest
 * @param {(eventPath: string, file: string) => string} deps.relKey
 * @param {() => string|null} deps.busyReason  an import, Sort Dump, sync or metadata run that makes cleanup unsafe
 * @param {(root: string) => Promise<Array<{path:string,size:number}>>} deps.listSource
 * @param {(msg: string) => void} [deps.log]
 * @param {object} [deps.testHooks]  { crashAfterTrash(n) } — tests only
 */
function createSourceCleanupService(deps) {
  const log = deps.log || (() => {});
  const base = path.join(deps.userData, 'source-cleanup');
  const journalDir = path.join(base, 'journal');
  const doneDir = path.join(journalDir, 'done');
  const lockFile = path.join(base, 'run.lock');
  const reviews = new Map();
  let running = null;

  async function _writeJson(file, doc) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(doc), 'utf8');
    const fh = await fsp.open(tmp, 'r+'); try { await fh.sync(); } finally { await fh.close(); }
    await fsp.rename(tmp, file);
  }

  // ── scope guards ─────────────────────────────────────────────────────────────
  const inside = (a, b) => { const r = path.resolve(b), q = path.resolve(a); return q === r || q.startsWith(r.endsWith(path.sep) ? r : r + path.sep); };
  function scopeRefusal(root) {
    if (!root || typeof root !== 'string') return 'No source selected.';
    const r = path.resolve(root);
    if (r === path.parse(r).root) return 'A whole disk cannot be a cleanup source — select the card or folder.';
    if (r === path.resolve(require('os').homedir())) return 'Your home folder cannot be a cleanup source.';
    const roots = deps.roots() || {};
    for (const [label, p] of [['the archive', roots.nasRoot], ['the archive', roots.mainArchiveRoot], ['Local Staging', roots.stagingRoot]]) {
      if (!p) continue;
      if (inside(r, p)) return `This source is inside ${label} — Source Cleanup never removes archived photos (event folders and Dumps are sorted with Sort Dump).`;
      if (inside(p, r)) return `This source contains ${label} — select only the card or the folder you imported from.`;
    }
    if (r.split(path.sep).some(seg => seg === 'Dump')) return 'This looks like an event Dump — Source Cleanup never removes archived photos.';
    return null;
  }

  // ── canonical archive copy ───────────────────────────────────────────────────
  async function canonicalOf(ev) {
    if (ev.importMode !== 'local-first') return { path: ev.dest };
    const roots = deps.roots() || {};
    const staging = roots.stagingRoot;
    if (!staging || !inside(ev.dest, staging)) return { reason: 'Local First copy is not in Local Staging — archive copy unknown' };
    const rel = path.relative(path.resolve(staging), path.resolve(ev.dest)).split(path.sep);
    if (rel.length < 3) return { reason: 'Local First copy is outside an event folder' };
    const localEventPath = path.join(path.resolve(staging), rel[0], rel[1]);
    const nasRoot = roots.nasRoot;
    if (!nasRoot) return { reason: 'No archive (NAS) is set — Local First copies are not in the archive yet' };
    const nasOk = await fsp.stat(nasRoot).then(s => s.isDirectory(), () => false);
    if (!nasOk) return { reason: 'The archive (NAS) is not available — cannot confirm the archive copy' };
    const route = await deps.resolveArchiveEvent(localEventPath, nasRoot);
    if (!route || !route.ok) return { reason: `Archive copy unknown: ${(route && route.error) || 'collection not linked'}` };
    const key = deps.relKey(localEventPath, ev.dest);
    let finalRel = key;
    try {
      const m = await deps.readManifest(localEventPath);
      const scopes = [m, ...((m && Array.isArray(m.jobs)) ? m.jobs : [])].filter(Boolean);
      for (const sc of scopes) {
        const hit = (Array.isArray(sc.resolvedFiles) ? sc.resolvedFiles : []).find(f => f.relPath === key);
        if (hit && hit.finalRelPath) { finalRel = hit.finalRelPath; break; }
      }
    } catch { /* no reservation: same relative path */ }
    return { path: path.join(route.archiveEventPath, ...finalRel.split('/').filter(Boolean)), missingReason: 'Not synced to the archive yet (only the Local First copy exists)' };
  }

  const eligibilityIo = () => ({ ...deps.io, canonicalOf });

  // ── journal / recovery ───────────────────────────────────────────────────────
  async function _openJournals() {
    let names = [];
    try { names = (await fsp.readdir(journalDir)).filter(n => n.endsWith('.json')); } catch { return []; }
    const out = [];
    for (const n of names) {
      try { out.push({ file: path.join(journalDir, n), doc: JSON.parse(await fsp.readFile(path.join(journalDir, n), 'utf8')) }); }
      catch { out.push({ file: path.join(journalDir, n), doc: null }); }
    }
    return out;
  }

  async function _finish(file, doc) {
    await _writeJson(file, doc);
    await fsp.mkdir(doneDir, { recursive: true });
    await fsp.rename(file, path.join(doneDir, path.basename(file)));
    try {
      const old = (await fsp.readdir(doneDir)).filter(n => n.endsWith('.json')).sort();
      for (const n of old.slice(0, Math.max(0, old.length - DONE_KEEP))) await fsp.unlink(path.join(doneDir, n)).catch(() => {});
    } catch { /* keep */ }
  }

  /** Reconciles every unfinished run from the real source/Trash state. Never trashes anything. */
  async function recover() {
    if (running) return [];
    const reports = [];
    for (const { file, doc } of await _openJournals()) {
      if (!doc || doc.schema !== SCHEMA) { reports.push({ id: path.basename(file), state: 'unreadable' }); continue; }
      let cap = doc.capability || null;
      for (const f of doc.files) {
        if (f.state === 'trashed' || f.state === 'not-removed' || f.state === 'needs-attention') continue;
        if (f.state !== 'trashing') { f.state = 'not-removed'; f.error = 'Not started before the interruption'; continue; }
        const where = await deps.trash.locate(f.path, f.size, f.trashBefore || [], cap).catch(() => ({ where: 'unknown' }));
        if (where.where === 'source') { f.state = 'not-removed'; f.error = 'Still on the source after the interruption (left untouched)'; }
        else if (where.where === 'trash') { f.state = 'trashed'; f.trashPath = where.trashPath; f.recovered = true; }
        else { f.state = 'needs-attention'; f.error = 'Not on the source and not found in the Trash (card removed?) — check the Trash and the card'; }
      }
      doc.state = 'reconciled';
      doc.reconciledAt = new Date().toISOString();
      doc.summary = _summary(doc.files);
      await _finish(file, doc);
      log(`[source-cleanup] interrupted run reconciled: ${doc.summary.trashed} trashed, ${doc.summary.notRemoved} not removed, ${doc.summary.attention} need attention`);
      reports.push({ id: doc.id, state: 'reconciled', summary: doc.summary, startedAt: doc.startedAt });
    }
    return reports;
  }

  function _summary(files) {
    const s = { trashed: 0, notRemoved: 0, attention: 0, bytes: 0 };
    for (const f of files) {
      if (f.state === 'trashed') { s.trashed++; s.bytes += f.size || 0; }
      else if (f.state === 'needs-attention') s.attention++;
      else s.notRemoved++;
    }
    return s;
  }

  // ── lock (one cleanup per computer) ──────────────────────────────────────────
  async function _lock() {
    await fsp.mkdir(base, { recursive: true });
    try {
      const fh = await fsp.open(lockFile, 'wx');
      await fh.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() })); await fh.close();
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let holder = null;
      try { holder = JSON.parse(await fsp.readFile(lockFile, 'utf8')); } catch { /* unreadable: treat as stale */ }
      const alive = holder && holder.pid && holder.pid !== process.pid && (() => { try { process.kill(holder.pid, 0); return true; } catch { return false; } })();
      if (alive) return false;
      await fsp.unlink(lockFile).catch(() => {});
      return _lock();
    }
  }
  const _unlock = () => fsp.unlink(lockFile).catch(() => {});

  // ── review ───────────────────────────────────────────────────────────────────
  async function review(sourceRoot, { onProgress, sourceLabel } = {}) {
    const refusal = scopeRefusal(sourceRoot);
    if (refusal) return { ok: false, blockers: [refusal] };
    const recovered = await recover().catch(() => []);
    const rootOk = await fsp.stat(sourceRoot).then(s => s.isDirectory(), () => false);
    if (!rootOk) return { ok: false, blockers: ['The source is no longer available (card removed or renamed).'], recovered };
    const cap = await deps.trash.capability(sourceRoot);
    const busy = deps.busyReason();
    const [files, evidence] = await Promise.all([deps.listSource(sourceRoot), deps.evidence.forSource(deps.userData, sourceRoot)]);
    const a = await deps.eligibility.assess({ sourceRoot, files, evidence, io: eligibilityIo(), onProgress });
    const id = `sc-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const eligibleAssets = a.assets.filter(x => x.eligible);
    const byPath = new Map(a.files.map(f => [f.path, f]));
    reviews.set(id, { id, at: Date.now(), sourceRoot: path.resolve(sourceRoot), assets: eligibleAssets, byPath });
    for (const [k, v] of reviews) if (Date.now() - v.at > REVIEW_TTL_MS) reviews.delete(k);
    const rel = (p) => path.relative(sourceRoot, p);
    const blockers = [];
    if (!cap.ok) blockers.push(cap.reason);
    if (busy) blockers.push(busy);
    return {
      ok: true, reviewId: id,
      source: { root: path.resolve(sourceRoot), label: sourceLabel || path.basename(sourceRoot), volume: cap.volume || null, fsType: cap.fsType || null },
      capability: { ok: cap.ok, reason: cap.reason || null, trashDir: cap.trashDir || null, boot: !!cap.boot, platform: cap.platform, verified: cap.verified },
      blockers,
      counts: {
        files: a.files.length, eligibleFiles: a.eligible.length, eligibleAssets: eligibleAssets.length,
        eligibleBytes: a.eligible.reduce((s, f) => s + (f.size || 0), 0), excluded: a.excluded.length, unimported: a.unimported.length,
        verifiedBytes: a.eligible.filter(f => f.verified === 'sha256').length, verifiedImage: a.eligible.filter(f => f.verified === 'image-data').length,
      },
      eligible: a.eligible.slice(0, MAX_LISTED).map(f => ({ rel: rel(f.path), size: f.size, verified: f.verified })),
      excluded: a.excluded.slice(0, MAX_LISTED).map(f => ({ rel: rel(f.path), size: f.size, reason: f.reason })),
      unimported: a.unimported.slice(0, MAX_LISTED).map(f => ({ rel: rel(f.path), size: f.size })),
      recovered,
    };
  }

  // ── run ──────────────────────────────────────────────────────────────────────
  async function run(reviewId, { onProgress } = {}) {
    const rv = reviews.get(reviewId);
    if (!rv || Date.now() - rv.at > REVIEW_TTL_MS) return { ok: false, blockers: ['This review has expired — review the source again.'] };
    reviews.delete(reviewId);   // one run per review: a second run must review again
    if (running) return { ok: false, blockers: ['A cleanup is already running.'] };
    const refusal = scopeRefusal(rv.sourceRoot);
    if (refusal) return { ok: false, blockers: [refusal] };
    const busy = deps.busyReason();
    if (busy) return { ok: false, blockers: [busy] };
    const cap = await deps.trash.capability(rv.sourceRoot);
    if (!cap.ok) return { ok: false, blockers: [cap.reason] };
    if (!rv.assets.length) return { ok: false, blockers: ['Nothing is eligible for cleanup.'] };
    if (!(await _lock())) return { ok: false, blockers: ['Another AutoIngest window or instance is cleaning a source — try again when it finishes.'] };
    running = rv.sourceRoot;
    const id = `sc-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
    const file = path.join(journalDir, `${id}.json`);
    const doc = {
      schema: SCHEMA, version: 1, id, state: 'running', startedAt: new Date().toISOString(), pid: process.pid,
      source: { root: rv.sourceRoot }, capability: { platform: cap.platform, trashDir: cap.trashDir, volume: cap.volume, fsType: cap.fsType },
      files: [],
    };
    for (const asset of rv.assets) for (const p of asset.files) {
      const f = rv.byPath.get(p) || { path: p, size: 0 };
      doc.files.push({ asset: asset.id, path: p, size: f.size, dest: f.dest || null, verified: f.verified || null, batchId: f.batchId || null, state: 'planned' });
    }
    const total = doc.files.length;
    let done = 0, trashedCount = 0;
    const emit = (status) => { if (onProgress) { try { onProgress({ id, done, total, trashed: trashedCount, status }); } catch { /* observer */ } } };
    try {
      await _writeJson(file, doc);
      emit('verifying');
      for (const asset of rv.assets) {
        const members = doc.files.filter(f => f.asset === asset.id);
        const rootOk = await fsp.stat(rv.sourceRoot).then(s => s.isDirectory(), () => false);
        if (!rootOk) {
          for (const m of doc.files.filter(x => x.state === 'planned')) { m.state = 'not-removed'; m.error = 'The source was disconnected'; }
          break;
        }
        // Re-verify the whole asset now — never trust the review's result for a card that may have changed.
        const evidence = await deps.evidence.forSource(deps.userData, rv.sourceRoot);
        const fresh = await deps.eligibility.assess({ sourceRoot: rv.sourceRoot, files: members.map(m => ({ path: m.path, size: m.size })), evidence, io: eligibilityIo() });
        const bad = fresh.files.find(r => !r.eligible);
        if (bad) {
          for (const m of members) { m.state = 'not-removed'; m.error = `Not verified at cleanup time: ${bad.reason}`; }
          done += members.length; emit('running');
          await _writeJson(file, doc);
          continue;
        }
        for (const m of members) {
          m.state = 'trashing';
          const res = await deps.trash.trashFile(m.path, cap, undefined, { beforeTrash: async (cands) => { m.trashBefore = cands; await _writeJson(file, doc); } });
          if (res.outcome === 'trashed') { m.state = 'trashed'; m.trashPath = res.trashPath; trashedCount++; }
          else { m.state = res.outcome; m.error = res.error; }
          done++;
          await _writeJson(file, doc);
          emit('running');
          if (deps.testHooks && typeof deps.testHooks.crashAfterTrash === 'function') deps.testHooks.crashAfterTrash(trashedCount);
          if (res.outcome !== 'trashed') {
            // The asset is now split (some files trashed, this one not): stop this asset and say so.
            for (const rest of members.filter(x => x.state === 'planned')) { rest.state = 'not-removed'; rest.error = `Kept: ${path.basename(m.path)} could not be moved (${res.error})`; done++; }
            const gone = members.filter(x => x.state === 'trashed');
            if (gone.length) for (const g of gone) g.partialAsset = true;
            break;
          }
        }
      }
      doc.state = 'done';
      doc.finishedAt = new Date().toISOString();
      doc.summary = _summary(doc.files);
      await _finish(file, doc);
      emit('done');
      log(`[source-cleanup] ${doc.summary.trashed} file(s) moved to the Trash, ${doc.summary.notRemoved} not removed, ${doc.summary.attention} need attention`);
      return { ok: true, id, summary: doc.summary, files: doc.files.map(f => ({ rel: path.relative(rv.sourceRoot, f.path), state: f.state, error: f.error || null, trashPath: f.trashPath || null, partialAsset: !!f.partialAsset, size: f.size })) };
    } finally {
      running = null;
      await _unlock();
    }
  }

  /** The most recent finished/reconciled runs (audit). */
  async function history(limit = 20) {
    let names = [];
    try { names = (await fsp.readdir(doneDir)).filter(n => n.endsWith('.json')).sort().reverse().slice(0, limit); } catch { return []; }
    const out = [];
    for (const n of names) {
      try { const d = JSON.parse(await fsp.readFile(path.join(doneDir, n), 'utf8')); out.push({ id: d.id, state: d.state, startedAt: d.startedAt, finishedAt: d.finishedAt || d.reconciledAt, summary: d.summary }); } catch { /* skip */ }
    }
    return out;
  }

  return { review, run, recover, history, scopeRefusal, canonicalOf, get running() { return running; } };
}

module.exports = { createSourceCleanupService, SCHEMA };
