/**
 * crossEventMoveEngine.js — the two-event move transaction behind "Move Selection to Another Event"
 * (AI-FEAT-064 EQI-3.2). Main process.
 *
 * Moves already-archived photos from one event's Dump (A) to another event of the same collection (B) —
 * into B's Dump or one of B's final folders. A MOVE between events: never a second copy, never a new import.
 * Built on the Sort Dump transaction (dumpSortEngine / dumpSortJournal): the same no-overwrite placement
 * (hard link → no-overwrite rename → copy + SHA-256 verify across volumes), the same verified cleanup and
 * the same atomic journal writes — extended to two event folders.
 *
 *   journal   <A>/.autoingest/dump-sort/transfers/<txId>.json          the full intent (owned by the source)
 *             <B>/.autoingest/dump-sort/transfers-in/<txId>.json       marker: B has an unfinished transfer in
 *             …/transfers/done/<txId>.json                            finished — kept as the audit trail
 *             Both are written BEFORE anything moves. Records never hold absolute paths of the other event:
 *             B is named by its folder in A's collection, so a remount does not orphan the journal.
 *
 * STATE MACHINE (doc.phase, written durably before each step runs):
 *   planned → publishing      every asset is placed at B (pairs never split; a different file at the
 *                             destination stops the shot and puts back what it placed)
 *           → dest-records    B's event.json registers the transfer (transfersIn: original imports,
 *                             photographers, source event, txId, every from → to path) and receives the
 *                             files' intent records (taken from the journal snapshot, not from A's live doc)
 *           → source-records  A's event.json drops the moved files' intent records and keeps a transfersOut
 *                             audit entry; imports[] of both events are never touched
 *           → staging         the same move in synced Local First staging copies         [hooks.mirrorStaging]
 *           → cleanup         A's Dump copy is removed — only when B's file is verified as the same file
 *           → metadata        B's background metadata record is written                  [hooks.queueMetadata]
 *           → done            journal to done/, marker removed — the durable completion boundary
 *   needs-attention          a file whose two copies differ, or a Dump copy that could not be verified away
 *   cancelled                recovery found nothing placed: every photo is still only in A — nothing moved
 *
 * RECOVERY: the journal says what was intended, the two folders say what happened. Before records were
 * written (planned/publishing), a shot with nothing at B stays in A; anything at B is completed. From
 * dest-records on, every journaled asset is completed (re-placed from A if B lost it). Every later step is
 * idempotent (keyed by txId), so it is simply run again. Source and destination that both exist with
 * different content are never touched.
 */

'use strict';

const path = require('path');
const fsp = require('fs').promises;
const crypto = require('crypto');
const journal = require('./dumpSortJournal');
const sortEngine = require('./dumpSortEngine');

const SCHEMA = 'autoingest.crossEventMove';
const VERSION = 1;
const OUT = path.join('.autoingest', 'dump-sort', 'transfers');
const IN = path.join('.autoingest', 'dump-sort', 'transfers-in');
const KEEP_DONE = 50;
const PHASES = ['planned', 'publishing', 'dest-records', 'source-records', 'staging', 'cleanup', 'metadata'];
const TX_RE = /^ds-xe[a-z0-9-]+\.json$/;

const toAbs = (root, rel) => path.join(root, ...rel.split('/'));
const under = (child, parent) => child === parent || child.startsWith(parent + path.sep);
const outDir = (a) => path.join(a, OUT);
const inDir = (b) => path.join(b, IN);
// "ds-" keeps it in the Sort Dump family (dumpSortMetadata records accept it); "xe" marks a cross-event move.
const newTxId = () => `ds-xe${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

async function _exists(io, p) { try { await io.lstat(p); return true; } catch { return false; } }

// ── Journal ────────────────────────────────────────────────────────────────────────────

async function writeJournal(a, doc, io = fsp) {
  await io.mkdir(outDir(a), { recursive: true });
  const out = { schema: SCHEMA, version: VERSION, ...doc, updatedAt: new Date().toISOString() };
  await journal.atomicWrite(io, path.join(outDir(a), `${doc.txId}.json`), JSON.stringify(out, null, 1));
  return out;
}

async function writeMarker(b, doc, io = fsp) {
  await io.mkdir(inDir(b), { recursive: true });
  const marker = { schema: `${SCHEMA}.inbound`, version: VERSION, txId: doc.txId, sourceEventFolder: doc.source.eventFolder, createdAt: doc.createdAt };
  await journal.atomicWrite(io, path.join(inDir(b), `${doc.txId}.json`), JSON.stringify(marker));
}

async function _readDir(io, dir, keep) {
  let names;
  try { names = await io.readdir(dir); } catch { return { docs: [], unreadable: [] }; }
  const docs = [];
  const unreadable = [];
  for (const n of names.filter(x => TX_RE.test(x)).sort()) {
    try {
      const d = JSON.parse(await io.readFile(path.join(dir, n), 'utf8'));
      if (keep(d)) docs.push(d); else unreadable.push(n);
    } catch { unreadable.push(n); }
  }
  return { docs, unreadable };
}

/** Unfinished transfers OUT of event A (oldest first). A malformed journal is reported, never skipped. */
async function listOutbound(a, io = fsp) {
  const r = await _readDir(io, outDir(a), d => d && d.schema === SCHEMA && d.version === VERSION && Array.isArray(d.assets) && d.source && d.destination);
  return { journals: r.docs, unreadable: r.unreadable };
}

/** Unfinished transfers INTO event B (markers). */
async function listInbound(b, io = fsp) {
  const r = await _readDir(io, inDir(b), d => d && d.schema === `${SCHEMA}.inbound` && typeof d.sourceEventFolder === 'string');
  return { markers: r.docs, unreadable: r.unreadable };
}

/** Whether A's journal for `txId` is still open ('pending'), finished ('done') or absent. */
async function journalState(a, txId, io = fsp) {
  if (await _exists(io, path.join(outDir(a), `${txId}.json`))) return 'pending';
  if (await _exists(io, path.join(outDir(a), 'done', `${txId}.json`))) return 'done';
  return 'absent';
}

async function removeMarker(b, txId, io = fsp) {
  await io.unlink(path.join(inDir(b), `${txId}.json`)).catch(() => {});
}

async function _finish(a, b, doc, io) {
  const done = path.join(outDir(a), 'done');
  await io.mkdir(done, { recursive: true });
  const final = { schema: SCHEMA, version: VERSION, ...doc, updatedAt: new Date().toISOString() };
  await journal.atomicWrite(io, path.join(done, `${doc.txId}.json`), JSON.stringify(final, null, 1));
  await io.unlink(path.join(outDir(a), `${doc.txId}.json`)).catch(() => {});
  if (b) await removeMarker(b, doc.txId, io);
  try {
    const old = (await io.readdir(done)).filter(n => n.endsWith('.json')).sort();
    for (const n of old.slice(0, Math.max(0, old.length - KEEP_DONE))) await io.unlink(path.join(done, n)).catch(() => {});
  } catch { /* trimming is best effort */ }
  return final;
}

// ── Preflight ──────────────────────────────────────────────────────────────────────────

/**
 * Real paths and each member's decision at B. Cross-event moves never rename: a destination holding a
 * different file refuses the whole shot (no silent "_1" copy), the same file is reused ("already"), the
 * same photo with different bytes (rewritten metadata) is refused, and a photo already in B under another
 * photographer's Dump folder is refused.
 * @param {object} p
 * @param {string} p.sourcePath  A    @param {string} p.destPath  B
 * @param {string} p.sourceDumpDir    @param {'dump'|'component'} p.kind
 * @param {string|null} p.destDumpDir   B's Dump folder name (kind 'dump': the folder the plan targets)
 * @param {Array<{ rel: string, photographer: string }>} [p.destDumpIndex]  media already in B's Dump
 */
async function preflight({ sourcePath, destPath, sourceDumpDir, kind, destDumpDir, assets, destDumpIndex = [], io = fsp, hash = sortEngine.sha256, imageHash = null }) {
  const realA = await io.realpath(sourcePath);
  const realB = await io.realpath(destPath);
  if (realA === realB) throw new Error('The destination is the source event');
  const realDumpA = await io.realpath(path.join(realA, sourceDumpDir));
  if (!under(realDumpA, realA)) throw new Error('Dump folder is outside the event folder');
  const dumpB = destDumpDir ? path.join(realB, destDumpDir) : null;
  const byName = new Map();
  for (const e of destDumpIndex) {
    const k = e.rel.slice(e.rel.lastIndexOf('/') + 1).toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(e);
  }
  const refused = [];
  const collisions = [];
  const ready = [];
  const claimed = new Set();
  for (const asset of assets) {
    const why = await _check(io, realA, realDumpA, realB, dumpB, kind, asset);
    if (why) { for (const m of asset.members) refused.push({ src: m.src, reason: why }); continue; }
    const d = await _decide(io, realA, realB, asset, claimed, byName, hash, imageHash);
    collisions.push(...d.collisions);
    if (d.reason) { for (const m of asset.members) refused.push({ src: m.src, reason: d.reason }); continue; }
    for (const m of d.members) if (!m.already) claimed.add(m.dest.toLowerCase());
    ready.push({ ...asset, members: d.members });
  }
  return { realA, realB, assets: ready, refused, collisions };
}

async function _check(io, realA, realDumpA, realB, dumpB, kind, asset) {
  for (const m of asset.members) {
    const abs = toAbs(realA, m.src);
    let st;
    try { st = await io.lstat(abs); } catch { return 'no longer in Dump'; }
    if (st.isSymbolicLink() || !st.isFile()) return 'not a regular file';
    const real = await io.realpath(abs);
    if (!under(real, realDumpA) || real === realDumpA) return 'source is outside the Dump folder';
    m.size = st.size;
    const destDir = await sortEngine._realish(io, path.dirname(toAbs(realB, m.dest)));
    if (!under(destDir, realB) || (destDir === realB && kind === 'dump')) return 'destination is outside the destination event';
    const realDumpB = dumpB ? await sortEngine._realish(io, dumpB) : null;
    if (kind === 'dump' && !(realDumpB && under(destDir, realDumpB) && destDir !== realDumpB)) return 'destination is outside the destination event\'s Dump';
    if (kind === 'component' && realDumpB && under(destDir, realDumpB)) return 'destination is inside the destination event\'s Dump';
  }
  return null;
}

async function _decide(io, realA, realB, asset, claimed, byName, hash, imageHash) {
  const collisions = [];
  const members = asset.members.map(m => ({ ...m, already: false }));
  for (const m of members) {
    const srcAbs = toAbs(realA, m.src);
    const destAbs = toAbs(realB, m.dest);
    if (claimed.has(m.dest.toLowerCase())) return { reason: 'two selected files have the same destination name', collisions };
    if (m.role === 'media') {
      const elsewhere = (byName.get(m.dest.slice(m.dest.lastIndexOf('/') + 1).toLowerCase()) || []).filter(e => e.photographer !== asset.folder);
      for (const e of elsewhere) {
        const other = toAbs(realB, e.rel);
        if (await sortEngine.sameFile(io, srcAbs, other, hash).catch(() => false)) {
          collisions.push({ src: m.src, dest: e.rel, kind: 'other-photographer', blocking: true });
          return { reason: `the same photo is already in the destination's Dump under ${e.photographer}`, collisions };
        }
        collisions.push({ src: m.src, dest: e.rel, kind: 'same-name-other-photographer', blocking: false });
      }
    }
    if (!(await _exists(io, destAbs))) continue;
    if (await sortEngine.sameFile(io, srcAbs, destAbs, hash)) {
      m.already = true;
      collisions.push({ src: m.src, dest: m.dest, kind: 'identical', blocking: false });
      continue;
    }
    if (m.role === 'media' && imageHash) {
      const [x, y] = await Promise.all([imageHash(srcAbs).catch(() => null), imageHash(destAbs).catch(() => null)]);
      if (x && x === y) {
        collisions.push({ src: m.src, dest: m.dest, kind: 'same-photo-other-metadata', blocking: true });
        return { reason: 'the same photo, with different metadata, is already at the destination', collisions };
      }
    }
    collisions.push({ src: m.src, dest: m.dest, kind: m.role === 'sidecar' ? 'different-sidecar' : 'different-file', blocking: true });
    return { reason: m.role === 'sidecar' ? 'a different XMP sidecar is already at the destination' : 'a different file with this name is already at the destination', collisions };
  }
  return { members, collisions };
}

// ── Run / recover ──────────────────────────────────────────────────────────────────────

/**
 * Runs a planned transfer. `hooks` (each returns a promise): applyDestRecords, applySourceRecords,
 * mirrorStaging, queueMetadata, onProgress, crash (tests: called with the phase name before it runs).
 * A failure after the journal is written leaves it pending; recover() completes it.
 */
async function run({ sourcePath, destPath, sourceDumpDir, kind, destDumpDir, plan, meta = {}, hooks = {}, destDumpIndex = [], io = fsp, hash = sortEngine.sha256, imageHash = null }) {
  const pre = await preflight({ sourcePath, destPath, sourceDumpDir, kind, destDumpDir, assets: plan.assets, destDumpIndex, io, hash, imageHash });
  if (!pre.assets.length) return { ok: false, txId: null, moved: 0, refused: pre.refused, collisions: pre.collisions, reason: 'nothing to move' };
  const now = new Date().toISOString();
  const doc = {
    txId: newTxId(), createdAt: now, phase: 'planned', kind,
    history: [{ phase: 'planned', at: now }],
    source: { eventFolder: path.basename(pre.realA), dumpDir: sourceDumpDir, eventName: meta.sourceEventName || null },
    destination: { eventFolder: path.basename(pre.realB), dumpDir: destDumpDir || null, component: meta.component || null, eventName: meta.destEventName || null },
    collection: path.basename(path.dirname(pre.realA)),
    device: meta.device || null, operator: meta.operator || null,
    assets: pre.assets.map(a => ({ id: a.id, photographer: a.photographer, scopeKey: a.scopeKey, folder: a.folder, members: a.members.map(m => ({ role: m.role, kind: m.kind, src: m.src, dest: m.dest, size: m.size, already: !!m.already })) })),
    newFolders: plan.newFolders || [], provenance: meta.provenance || null, intent: meta.intent || null,
    refused: pre.refused, collisions: pre.collisions,
  };
  await writeJournal(pre.realA, doc, io);   // A's journal first: a marker without a journal is provably stale
  await writeMarker(pre.realB, doc, io);
  return _complete({ realA: pre.realA, realB: pre.realB, doc, hooks, io, hash, recovering: false });
}

/**
 * Completes every unfinished transfer out of event A. `resolveDest(doc)` → B's current path (A's collection
 * folder + doc.destination.eventFolder); an unreachable B defers that transfer (nothing is guessed).
 */
async function recover({ sourcePath, resolveDest, only = null, hooks = {}, io = fsp, hash = sortEngine.sha256 }) {
  const realA = await io.realpath(sourcePath);
  const { journals, unreadable } = await listOutbound(realA, io);
  const results = [];
  for (const doc of journals) {
    if (only && doc.txId !== only) continue;
    const b = resolveDest ? resolveDest(realA, doc) : path.join(path.dirname(realA), doc.destination.eventFolder);
    const realB = await io.realpath(b).catch(() => null);
    if (!realB) { results.push({ ok: false, txId: doc.txId, deferred: true, reason: 'destination-unreachable' }); continue; }
    results.push(await _complete({ realA, realB, doc, hooks, io, hash, recovering: true }));
  }
  return { results, unreadable };
}

async function _step(a, doc, phase, hooks, io) {
  doc.phase = phase;
  if (phase === 'dest-records') doc.committed = true;   // from here on no journaled asset is ever dropped
  (doc.history = doc.history || []).push({ phase, at: new Date().toISOString() });
  await writeJournal(a, doc, io);
  if (hooks.crash) await hooks.crash(phase);
}

async function _complete({ realA, realB, doc, hooks, io, hash, recovering }) {
  const progress = hooks.onProgress || (() => {});
  const attention = [];
  const total = doc.assets.reduce((n, a) => n + a.members.length, 0);
  const mayDrop = !doc.committed;
  for (const a of doc.assets) if (recovering && a.attention) a.attention = false;   // re-evaluated from the folders
  let done = 0;
  const S = (m) => toAbs(realA, m.src);
  const D = (m) => toAbs(realB, m.dest);

  await _step(realA, doc, 'publishing', hooks, io);
  for (const asset of doc.assets) {
    if (asset.dropped || asset.attention) continue;
    const state = recovering ? await _assetState(io, asset, S, D, hash) : 'pending';
    if (state === 'conflict') { asset.attention = true; for (const m of asset.members) attention.push({ src: m.src, dest: m.dest, reason: 'source and destination differ' }); continue; }
    if (recovering && state === 'untouched' && mayDrop) { asset.dropped = true; continue; }   // never moved: stays in A
    const ok = [];
    try {
      for (const m of asset.members) {
        const s = await _exists(io, S(m));
        const d = await _exists(io, D(m));
        if (!s && d) { m.verified = m.verified || 'moved'; ok.push(m); continue; }
        if (!s && !d) { attention.push({ src: m.src, dest: m.dest, reason: 'file missing from both events' }); continue; }
        const r = await sortEngine.placeFile(io, S(m), D(m), hash);
        m.mode = r.mode;
        m.verified = (await sortEngine.sameFile(io, S(m), D(m), hash)) ? (r.mode === 'link' ? 'same-inode' : 'sha256') : null;
        if (!m.verified) { const e = new Error('the destination copy could not be verified'); e.code = 'CONFLICT'; throw e; }
        ok.push(m);
      }
    } catch (err) {
      if (err.code !== 'CONFLICT') throw err;
      if (await _putBack(io, ok, S, D, hash)) {
        asset.dropped = true;
        doc.refused = [...(doc.refused || []), ...asset.members.map(m => ({ src: m.src, reason: err.message }))];
      } else {
        asset.attention = true;
        for (const m of asset.members) attention.push({ src: m.src, dest: m.dest, reason: err.message });
      }
      continue;
    }
    asset.placed = true;
    done += asset.members.length;
    progress({ stage: 'moving', done, total });
  }
  const live = doc.assets.filter(a => a.placed && !a.dropped && !a.attention);
  const pairs = live.flatMap(a => a.members.map(m => ({ src: m.src, dest: m.dest, role: m.role, kind: m.kind, size: m.size, photographer: a.photographer })));

  if (!pairs.length && !attention.length) {
    // Nothing reached B — every selected photo is still only in A. Closed as cancelled (audit kept).
    doc.outcome = { movedFiles: 0, movedAssets: 0, sidecars: 0, bytes: 0, refused: doc.refused || [], attention: [], metadata: null, recovered: recovering };
    doc.phase = 'cancelled';
    (doc.history = doc.history || []).push({ phase: 'cancelled', at: new Date().toISOString() });
    await _finish(realA, realB, doc, io);
    progress({ stage: 'cancelled', done: total, total });
    return { ok: false, txId: doc.txId, phase: 'cancelled', ...doc.outcome };
  }

  await _step(realA, doc, 'dest-records', hooks, io);
  progress({ stage: 'records', done, total });
  if (hooks.applyDestRecords && pairs.length) await hooks.applyDestRecords({ doc, pairs, assets: live, realA, realB });

  await _step(realA, doc, 'source-records', hooks, io);
  if (hooks.applySourceRecords && pairs.length) await hooks.applySourceRecords({ doc, pairs, assets: live, realA, realB });

  await _step(realA, doc, 'staging', hooks, io);
  let staging = null;
  if (hooks.mirrorStaging && pairs.length) staging = await hooks.mirrorStaging({ doc, pairs, realA, realB });

  await _step(realA, doc, 'cleanup', hooks, io);
  progress({ stage: 'cleanup', done, total });
  for (const a of live) {
    for (const m of a.members) {
      const r = await sortEngine.removeIfSame(io, S(m), D(m), hash);
      if (r === 'kept') attention.push({ src: m.src, dest: m.dest, reason: 'source copy kept: the destination could not be verified' });
    }
  }

  await _step(realA, doc, 'metadata', hooks, io);
  progress({ stage: 'metadata', done, total });
  let metadata = null;
  if (hooks.queueMetadata && pairs.length) {
    try { metadata = await hooks.queueMetadata({ doc, pairs, realA, realB }); } catch (err) { metadata = { state: 'not-queued', error: err.message }; }
  }

  const media = pairs.filter(p => p.role === 'media');
  doc.outcome = {
    movedFiles: media.length, movedAssets: live.length, sidecars: pairs.length - media.length,
    bytes: media.reduce((n, p) => n + (p.size || 0), 0), photographers: [...new Set(live.map(a => a.photographer))],
    refused: doc.refused || [], attention, staging, metadata, recovered: recovering,
  };
  if (hooks.crash) await hooks.crash('finish');
  if (attention.length) {
    doc.phase = 'needs-attention';
    (doc.history = doc.history || []).push({ phase: 'needs-attention', at: new Date().toISOString() });
    await writeJournal(realA, doc, io);   // stays pending: both events stay blocked for renames until resolved
  } else {
    doc.phase = 'done';
    (doc.history = doc.history || []).push({ phase: 'done', at: new Date().toISOString() });
    await _finish(realA, realB, doc, io);
  }
  progress({ stage: doc.phase, done: total, total });
  return { ok: attention.length === 0, txId: doc.txId, phase: doc.phase, ...doc.outcome, moved: pairs.map(p => ({ src: p.src, dest: p.dest })) };
}

/** Puts back what a refused shot already placed so it stays whole in A. true when fully restored. */
async function _putBack(io, placed, S, D, hash) {
  let restored = true;
  for (const m of placed) {
    try {
      if (m.mode === 'link' || m.mode === 'copy') {
        if (await _exists(io, S(m)) && await sortEngine.sameFile(io, S(m), D(m), hash)) await io.unlink(D(m));
        else restored = false;
      } else if (m.mode === 'rename') {
        if (await _exists(io, S(m))) restored = false;
        else await io.rename(D(m), S(m));
      } else if (m.mode !== 'already') restored = false;
    } catch { restored = false; }
  }
  return restored;
}

/** 'untouched' (only in A) | 'partial' | 'conflict' for a journal asset during recovery. */
async function _assetState(io, asset, S, D, hash) {
  let placedAny = false;
  for (const m of asset.members) {
    const s = await _exists(io, S(m));
    const d = await _exists(io, D(m));
    if (d && m.already) continue;                       // was already at B before this transfer
    if (!s && d) { placedAny = true; continue; }
    if (s && d) {
      if (await sortEngine.sameFile(io, S(m), D(m), hash)) placedAny = true;
      else return 'conflict';
    }
  }
  if (!placedAny && asset.members.every(m => m.already)) return 'partial';
  return placedAny ? 'partial' : 'untouched';
}

module.exports = {
  preflight, run, recover, listOutbound, listInbound, journalState, removeMarker, writeJournal,
  outDir, inDir, newTxId, SCHEMA, VERSION, PHASES,
};
