/**
 * dumpSortEngine.js — the Sort Dump move transaction (AI-FEAT-064 EQI-3). Main process.
 *
 * Moves already-archived photos from <event>/Dump/<photographer>/… into the event's final folders.
 * A MOVE, never a second copy and never a new import: the photo leaves Dump only after it is at its
 * destination and the event's records point at the destination.
 *
 *   1 preflight   every source is a real file inside Dump (no symlink escapes); every destination is
 *                 inside the event and outside Dump; each shot's final name is decided:
 *                   destination absent                         → that name
 *                   destination holds the same bytes           → already there (no second copy)
 *                   destination holds the same photo, other bytes (metadata rewritten)
 *                                                              → refused, stays in Dump (never "_1")
 *                   destination holds a different photo        → "<stem>_N" for the whole shot,
 *                                                                the import convention for a name clash
 *   2 journal     the full intent is written durably before anything moves (dumpSortJournal)
 *   3 place       hard link (same volume) — the photo then exists at both names;
 *                 no-overwrite rename when links are unsupported (NAS shares);
 *                 copy → verify (SHA-256) → no-overwrite commit across volumes
 *   4 records     event.json: metadata intent keys move with the file, new PC folders recorded,
 *                 one Sort Dump audit entry (never an import entry)              [hooks.applyRecords]
 *   5 staging     the same moves in a synced Local First staging copy            [hooks.mirrorStaging]
 *   6 cleanup     the Dump name is removed — only when the destination is verified as the same file
 *   7 metadata    the moved photos are handed to background metadata: a durable record of them is
 *                 written (verification + rewrite then run without holding the operator)
 *                                                                                 [hooks.queueMetadata]
 *                 (hooks.verifyMetadata instead awaits verification inside the transaction)
 *   8 done        the journal moves to done/ (audit trail) — the move's durable completion boundary
 *
 * RECOVERY (any crash point): the journal says what was intended; the filesystem says what happened.
 * Per shot: nothing placed → it stays in Dump; anything placed → the shot is completed (pairs never
 * split) and steps 4–8 run again (each is idempotent). A source and destination that BOTH exist with
 * different content are never touched — "needs attention".
 */

'use strict';

const path = require('path');
const fsp = require('fs').promises;
const fs = require('fs');
const crypto = require('crypto');
const journal = require('./dumpSortJournal');
const { stemOf, extOf } = require('./dumpSortPlanner');

const PARTIAL = '.aiimport-partial';
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK', 'EACCES']);
const MAX_SUFFIX = 99;

const toAbs = (root, rel) => path.join(root, ...rel.split('/'));
const under = (child, parent) => child === parent || child.startsWith(parent + path.sep);

async function _exists(io, p) { try { await io.lstat(p); return true; } catch { return false; } }

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}

/** Same file: one inode (a hard link), or same size and SHA-256. */
async function sameFile(io, a, b, hash = sha256) {
  const [sa, sb] = await Promise.all([io.stat(a), io.stat(b)]);
  if (sa.ino && sa.ino === sb.ino && sa.dev === sb.dev) return true;
  if (sa.size !== sb.size) return false;
  return (await hash(a)) === (await hash(b));
}

/** Real path of `p`, or of its nearest existing ancestor joined with the rest (for folders not created yet). */
async function _realish(io, p) {
  let cur = p;
  const rest = [];
  for (;;) {
    try { return path.join(await io.realpath(cur), ...rest.reverse()); } catch {
      const parent = path.dirname(cur);
      if (parent === cur) throw new Error('no existing ancestor');
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

function _renameWithSuffix(rel, n) {
  if (!n) return rel;
  const dir = rel.slice(0, rel.lastIndexOf('/') + 1);
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  return `${dir}${stemOf(name)}_${n}${extOf(name)}`;
}

/**
 * Step 1. Resolves real paths and each shot's final names.
 * @returns {Promise<{ assets: object[], refused: Array<{ src: string, reason: string }> }>}
 */
async function preflight({ eventPath, dumpDir, assets, io = fsp, hash = sha256, imageHash = null }) {
  const realEvent = await io.realpath(eventPath);
  const realDump = await io.realpath(path.join(eventPath, dumpDir));
  if (!under(realDump, realEvent)) throw new Error('Dump folder is outside the event folder');
  const refused = [];
  const ready = [];
  const claimed = new Set();
  for (const asset of assets) {
    const why = await _checkAsset(io, realEvent, realDump, asset);
    if (why) { for (const m of asset.members) refused.push({ src: m.src, reason: why }); continue; }
    const decided = await _decideNames(io, realEvent, asset, claimed, hash, imageHash);
    if (decided.reason) { for (const m of asset.members) refused.push({ src: m.src, reason: decided.reason }); continue; }
    for (const m of decided.members) if (!m.already) claimed.add(m.dest.toLowerCase());
    ready.push({ ...asset, members: decided.members, suffix: decided.suffix });
  }
  return { realEvent, assets: ready, refused };
}

async function _checkAsset(io, realEvent, realDump, asset) {
  for (const m of asset.members) {
    const abs = toAbs(realEvent, m.src);
    let st;
    try { st = await io.lstat(abs); } catch { return 'no longer in Dump'; }
    if (st.isSymbolicLink() || !st.isFile()) return 'not a regular file';
    const real = await io.realpath(abs);
    if (!under(real, realDump) || real === realDump) return 'source is outside the Dump folder';
    m.size = st.size;
    const destDir = await _realish(io, path.dirname(toAbs(realEvent, m.dest)));
    if (!under(destDir, realEvent) || under(destDir, realDump)) return 'destination is outside the event or inside Dump';
  }
  return null;
}

async function _decideNames(io, realEvent, asset, claimed, hash, imageHash) {
  for (let n = 0; n <= MAX_SUFFIX; n++) {
    const members = asset.members.map(m => ({ ...m, dest: _renameWithSuffix(m.dest, n), already: false }));
    let clash = false;
    for (const m of members) {
      const destAbs = toAbs(realEvent, m.dest);
      if (claimed.has(m.dest.toLowerCase())) { clash = true; break; }
      if (!(await _exists(io, destAbs))) continue;
      if (await sameFile(io, toAbs(realEvent, m.src), destAbs, hash)) { m.already = true; continue; }
      if (m.role === 'media' && imageHash) {
        const [a, b] = await Promise.all([imageHash(toAbs(realEvent, m.src)).catch(() => null), imageHash(destAbs).catch(() => null)]);
        if (a && a === b) return { reason: `the same photo is already in ${m.dest.slice(0, m.dest.lastIndexOf('/'))}` };
      }
      clash = true;
      break;
    }
    if (!clash) return { members, suffix: n };
  }
  return { reason: 'no free file name at the destination' };
}

/** Step 3 for one file. Returns { mode } or throws { code: 'CONFLICT' }. */
function placeMember(io, realEvent, m, hash = sha256) {
  return placeFile(io, toAbs(realEvent, m.src), toAbs(realEvent, m.dest), hash);
}

/**
 * Places one file at an absolute destination without ever overwriting: hard link, no-overwrite rename,
 * or copy → SHA-256 verify → commit across volumes. Shared with the cross-event move (EQI-3.2).
 */
async function placeFile(io, src, dest, hash = sha256) {
  await io.mkdir(path.dirname(dest), { recursive: true });
  try {
    await io.link(src, dest);
    return { mode: 'link' };
  } catch (err) {
    if (err.code === 'EEXIST') {
      if (await sameFile(io, src, dest, hash)) return { mode: 'already' };
      const e = new Error('a different file appeared at the destination'); e.code = 'CONFLICT'; throw e;
    }
    if (err.code === 'EXDEV') return _copyVerified(io, src, dest, hash);
    if (!LINK_UNSUPPORTED.has(err.code)) throw err;
  }
  if (await _exists(io, dest)) {
    if (await sameFile(io, src, dest, hash)) return { mode: 'already' };
    const e = new Error('a different file appeared at the destination'); e.code = 'CONFLICT'; throw e;
  }
  try {
    await io.rename(src, dest);
    return { mode: 'rename' };
  } catch (err) {
    if (err.code === 'EXDEV') return _copyVerified(io, src, dest, hash);
    throw err;
  }
}

async function _copyVerified(io, src, dest, hash) {
  const partial = dest + PARTIAL;
  await io.unlink(partial).catch(() => {});
  await io.copyFile(src, partial);
  try {
    if ((await hash(src)) !== (await hash(partial))) throw new Error('copy verification failed');
    if (await _exists(io, dest)) { const e = new Error('a different file appeared at the destination'); e.code = 'CONFLICT'; throw e; }
    await io.rename(partial, dest);
  } catch (err) { await io.unlink(partial).catch(() => {}); throw err; }
  return { mode: 'copy' };
}

/**
 * Removes the Dump name of a placed file — only when the destination is verified to be the same file.
 * @returns {'removed'|'gone'|'kept'}
 */
function cleanupMember(io, realEvent, m, hash = sha256) {
  return removeIfSame(io, toAbs(realEvent, m.src), toAbs(realEvent, m.dest), hash);
}

/** cleanupMember for absolute paths: removes `src` only when `dest` is verified to be the same file. */
async function removeIfSame(io, src, dest, hash = sha256) {
  if (!(await _exists(io, src))) return 'gone';
  if (!(await _exists(io, dest))) return 'kept';
  if (!(await sameFile(io, src, dest, hash))) return 'kept';
  await io.unlink(src);
  return 'removed';
}

/**
 * Runs a planned transaction (steps 1–8). `hooks` connect it to event.json, Local First staging,
 * metadata and progress; each returns a promise. A failure after step 2 leaves the journal pending,
 * which recover() completes.
 */
async function run({ eventPath, dumpDir, plan, meta = {}, hooks = {}, io = fsp, hash = sha256, imageHash = null }) {
  const progress = hooks.onProgress || (() => {});
  const pre = await preflight({ eventPath, dumpDir, assets: plan.assets, io, hash, imageHash });
  if (!pre.assets.length) return { ok: false, txId: null, moved: 0, refused: pre.refused, reason: 'nothing to move' };
  const txId = journal.newTxId();
  const doc = {
    txId, createdAt: new Date().toISOString(), phase: 'placing', dumpDir,
    eventFolder: path.basename(eventPath), device: meta.device || null, operator: meta.operator || null,
    assets: pre.assets.map(a => ({ id: a.id, photographer: a.photographer, scopeKey: a.scopeKey, folder: a.folder, members: a.members.map(m => ({ role: m.role, kind: m.kind, src: m.src, dest: m.dest, size: m.size, already: !!m.already })) })),
    newFolders: plan.newFolders || [], intent: meta.intent || null, refused: pre.refused,
  };
  await journal.write(eventPath, doc, io);
  return _complete({ eventPath, realEvent: pre.realEvent, doc, hooks, io, hash, progress, placeFirst: true });
}

/** Completes every unfinished journal of this event (crash, failure or interruption). */
async function recover({ eventPath, hooks = {}, io = fsp, hash = sha256 }) {
  const { journals, unreadable } = await journal.listPending(eventPath, io);
  const results = [];
  const realEvent = await io.realpath(eventPath);
  for (const doc of journals) {
    results.push(await _complete({ eventPath, realEvent, doc, hooks, io, hash, progress: hooks.onProgress || (() => {}), placeFirst: true, recovering: true }));
  }
  return { results, unreadable };
}

async function _complete({ eventPath, realEvent, doc, hooks, io, hash, progress, placeFirst, recovering = false }) {
  const placed = [];       // members now at their destination
  const attention = [];    // { src, dest, reason }
  const total = doc.assets.reduce((n, a) => n + a.members.length, 0);
  let done = 0;
  if (placeFirst) {
    for (const asset of doc.assets) {
      const state = recovering ? await _assetState(io, realEvent, asset, hash) : 'pending';
      if (state === 'conflict') { asset.attention = true; for (const m of asset.members) attention.push({ src: m.src, dest: m.dest, reason: 'source and destination differ' }); continue; }
      if (recovering && state === 'untouched') { asset.dropped = true; continue; }   // never moved: stays in Dump
      const okMembers = [];
      try {
        for (const m of asset.members) {
          const s = await _exists(io, toAbs(realEvent, m.src));
          const d = await _exists(io, toAbs(realEvent, m.dest));
          if (!s && d) { okMembers.push(m); continue; }                 // already moved (rename / cleaned)
          if (!s && !d) { attention.push({ src: m.src, dest: m.dest, reason: 'file missing from both places' }); continue; }
          const r = await placeMember(io, realEvent, m, hash);
          m.mode = r.mode;
          okMembers.push(m);
        }
      } catch (err) {
        if (err.code !== 'CONFLICT') throw err;
        // Put back what this shot already placed so it stays whole in Dump: a link or verified copy is
        // removed (the Dump file is still there), a renamed file is renamed back (never over a file).
        let restored = true;
        for (const m of okMembers) {
          const srcAbs = toAbs(realEvent, m.src);
          const destAbs = toAbs(realEvent, m.dest);
          try {
            if (m.mode === 'link' || m.mode === 'copy') {
              if (await _exists(io, srcAbs) && await sameFile(io, srcAbs, destAbs, hash)) await io.unlink(destAbs);
              else restored = false;
            } else if (m.mode === 'rename') {
              if (await _exists(io, srcAbs)) restored = false;
              else await io.rename(destAbs, srcAbs);
            } else if (m.mode !== 'already') restored = false;
          } catch { restored = false; }
        }
        if (!restored) {
          for (const m of asset.members) attention.push({ src: m.src, dest: m.dest, reason: err.message });
        } else {
          asset.dropped = true;
          doc.refused = [...(doc.refused || []), ...asset.members.map(m => ({ src: m.src, reason: err.message }))];
        }
        continue;
      }
      placed.push(...okMembers);
      done += asset.members.length;
      progress({ stage: 'moving', done, total });
    }
  }
  const pairs = placed.map(m => ({ src: m.src, dest: m.dest, role: m.role, kind: m.kind, size: m.size }));
  const live = doc.assets.filter(a => !a.dropped && !a.attention);

  doc.phase = 'records';
  await journal.write(eventPath, doc, io);
  progress({ stage: 'records', done, total });
  if (hooks.applyRecords) await hooks.applyRecords({ doc, pairs, assets: live });

  doc.phase = 'staging';
  await journal.write(eventPath, doc, io);
  let staging = null;
  if (hooks.mirrorStaging) staging = await hooks.mirrorStaging({ doc, pairs });

  doc.phase = 'cleanup';
  await journal.write(eventPath, doc, io);
  progress({ stage: 'cleanup', done, total });
  for (const m of placed) {
    const r = await cleanupMember(io, realEvent, m, hash);
    if (r === 'kept') attention.push({ src: m.src, dest: m.dest, reason: 'Dump copy kept: destination could not be verified' });
  }

  doc.phase = 'metadata';
  await journal.write(eventPath, doc, io);
  progress({ stage: 'metadata', done, total });
  let metadata = null;
  if (hooks.queueMetadata) {
    try { metadata = await hooks.queueMetadata({ doc, pairs }); } catch (err) { metadata = { state: 'not-queued', error: err.message }; }
  } else if (hooks.verifyMetadata) {
    try { metadata = await hooks.verifyMetadata({ doc, pairs }); } catch (err) { metadata = { state: 'failed', error: err.message }; }
  }

  const movedFiles = pairs.filter(p => p.role === 'media').length;
  doc.outcome = {
    movedFiles, movedAssets: live.length, sidecars: pairs.filter(p => p.role === 'sidecar').length,
    bytes: pairs.filter(p => p.role === 'media').reduce((n, p) => n + (p.size || 0), 0),
    refused: doc.refused || [], attention, staging, metadata, recovered: recovering,
  };
  if (attention.length) {
    doc.phase = 'needs-attention';
    await journal.write(eventPath, doc, io);
  } else {
    doc.phase = 'done';
    await journal.finish(eventPath, doc, io);
  }
  progress({ stage: doc.phase, done: total, total });
  return { ok: attention.length === 0, txId: doc.txId, phase: doc.phase, ...doc.outcome };
}

/** 'untouched' (all only in Dump) | 'partial' | 'conflict' for a journal asset during recovery. */
async function _assetState(io, realEvent, asset, hash) {
  let placedAny = false;
  for (const m of asset.members) {
    const s = await _exists(io, toAbs(realEvent, m.src));
    const d = await _exists(io, toAbs(realEvent, m.dest));
    if (d && m.already) continue;                       // was already at the destination before this sort
    if (!s && d) { placedAny = true; continue; }
    if (s && d) {
      if (await sameFile(io, toAbs(realEvent, m.src), toAbs(realEvent, m.dest), hash)) placedAny = true;
      else return 'conflict';
    }
  }
  if (!placedAny && asset.members.every(m => m.already)) return 'partial';
  return placedAny ? 'partial' : 'untouched';
}

module.exports = { preflight, run, recover, placeMember, cleanupMember, placeFile, removeIfSame, sameFile, sha256, _realish, _renameWithSuffix };
