/**
 * dumpSortService.js — Sort Dump for one event (AI-FEAT-064 EQI-3). Main process.
 *
 * Connects discovery (dumpSortDiscovery), destination planning (dumpSortPlanner) and the move
 * transaction (dumpSortEngine) to the rest of AutoIngest, through injected dependencies:
 *
 *   guards      the event is in the archive (never Local Staging), its Local First imports are synced,
 *               no metadata batch is still writing its Dump files, no other sort or import is running
 *               on it, and on a NAS the archive folder locks are free (held for the whole move)
 *   records     event.json — metadata intent keys move with each file (tagRefinements /
 *               metadataGroups), the operator's sort-time tags are recorded against the final paths,
 *               new PC folders are added to photographerSequences, and one `dumpSorts` audit entry is
 *               kept. imports[] and the import index are never touched: a sorted photo is not a new import.
 *   staging     a synced Local First staging copy of the event gets the same moves (and the same intent
 *               remap), so no later sync can bring an obsolete Dump copy back to the archive
 *   metadata    the moved photos are verified against their new component's tags; only incomplete
 *               ones are rewritten by the existing metadata batch
 *
 * Nothing here deletes a photographer folder: emptyPhotographerFolders() reports them and
 * deleteEmptyPhotographerFolder() removes one only after re-checking, on the operator's explicit choice.
 */

'use strict';

const path = require('path');
const fsp = require('fs').promises;
const { discoverDump, summarize, findDumpDir } = require('./dumpSortDiscovery');
const { planSort, EVENT_ROOT_KEY, safeSegment } = require('./dumpSortPlanner');
const engine = require('./dumpSortEngine');
const journal = require('./dumpSortJournal');

const MAX_AUDIT = 500;
const IGNORABLE = new Set(['.DS_Store']);   // Finder view state only — never media, never operator data

const under = (child, parent) => child === parent || child.startsWith(parent + path.sep);
const toAbs = (root, rel) => path.join(root, ...rel.split('/'));

/**
 * @param {object} deps
 * @param {Function} deps.updateEventJsonAtomic           main/eventJsonStore
 * @param {object}   deps.intent                          services/eventMetadataIntent
 * @param {() => { archive: string[], staging: string|null, nas: string|null }} deps.roots
 * @param {(eventPath: string) => Promise<string[]>} deps.pendingSyncFor     unsynced Local First jobs for the event
 * @param {(eventPath: string) => Promise<number>} deps.activeMetadataFor     metadata batches still writing its Dump
 * @param {() => boolean} deps.isImportRunning
 * @param {(eventPath: string, rels: string[]) => Promise<{ ok: boolean, release: Function, lockedBy?: string }>} deps.acquireLocks
 * @param {(eventPath: string, files: string[], onProgress?: Function) => Promise<object>} deps.verifyMetadata
 * @param {(p: string) => Promise<string|null>} [deps.imageHash]
 * @param {() => { device: string|null, operator: object|null }} [deps.who]
 * @param {Function} [deps.log]
 */
function createDumpSortService(deps) {
  const log = deps.log || (() => {});
  const running = new Set();

  async function _event(eventPath) {
    if (typeof eventPath !== 'string' || !path.isAbsolute(eventPath)) return { reason: 'No event folder.' };
    const real = await fsp.realpath(eventPath).catch(() => null);
    if (!real) return { reason: 'The event folder is not reachable. Reconnect the archive and try again.' };
    const roots = deps.roots();
    if (roots.staging && under(real, roots.staging)) return { reason: 'This event is in Local Staging. Sync it to the archive first, then sort its Dump in the archive.' };
    if (!roots.archive.some(r => under(real, r))) return { reason: 'This event is not inside a configured archive.' };
    let doc;
    try { doc = JSON.parse(await fsp.readFile(path.join(real, 'event.json'), 'utf8')); } catch { return { reason: 'The event record (event.json) could not be read.' }; }
    if (!doc || !Array.isArray(doc.components) || doc.components.length === 0) return { reason: 'This event has no components to sort into.' };
    return { real, doc };
  }

  /** Event Management: whether Sort Dump is offered for this event, and why not. Read only. */
  async function status(eventPath) {
    const ev = await _event(eventPath);
    if (!ev.real) {
      const found = await discoverDump(eventPath).catch(() => null);
      return { ok: false, reason: ev.reason, ...(found ? summarize(found) : { showSortDump: false }) };
    }
    const found = await discoverDump(ev.real);
    const { journals, unreadable } = await journal.listPending(ev.real);
    return { ok: true, ...summarize(found, { pending: journals.length + unreadable.length }) };
  }

  async function _blockers(ev) {
    const out = [];
    if (running.has(ev.real)) out.push('A Sort Dump is already running for this event.');
    if (deps.isImportRunning()) out.push('An import is running. Sort Dump when it has finished.');
    const pendingSync = await deps.pendingSyncFor(ev.real).catch(() => ['unknown']);
    if (pendingSync.length) out.push('This event has Local First imports that are not yet synced to the archive. Sync them first (Sync Queue).');
    const meta = await deps.activeMetadataFor(ev.real).catch(() => 0);
    if (meta > 0) out.push('Metadata is still being written to this event\'s Dump. Sort Dump when it has finished.');
    return out;
  }

  async function _scopeDirs(real, comps) {
    const keys = comps.length > 1 ? comps.map(c => c.folderName) : [EVENT_ROOT_KEY];
    const out = {};
    for (const k of keys) {
      if (k !== EVENT_ROOT_KEY && !safeSegment(k)) { out[k] = []; continue; }
      const base = k === EVENT_ROOT_KEY ? real : path.join(real, k);
      out[k] = (await fsp.readdir(base, { withFileTypes: true }).catch(() => [])).filter(e => e.isDirectory() && !e.isSymbolicLink()).map(e => e.name);
    }
    return out;
  }

  /**
   * Completes interrupted sorts, then plans the selection.
   * @param {string} eventPath
   * @param {Array<{ path: string, subEventId: string|null }>} selection  absolute Dump paths
   */
  async function plan(eventPath, selection) {
    const ev = await _event(eventPath);
    if (!ev.real) return { ok: false, blockers: [ev.reason] };
    const recovered = await recoverPending(ev.real);
    const blockers = await _blockers(ev);
    const found = await discoverDump(ev.real);
    if (!found.exists) return { ok: false, blockers: ['This event has no Dump folder.'], recovered };
    const dumpRels = [...found.photographers.flatMap(p => p.files.map(f => f.rel)), ...found.sidecars];
    const sel = [];
    const problems = [];
    for (const s of selection || []) {
      const rel = s && typeof s.path === 'string' ? path.relative(ev.real, path.resolve(s.path)).split(path.sep).join('/') : null;
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { problems.push({ rel: String(s && s.path), reason: 'outside this event' }); continue; }
      sel.push({ rel, subEventId: s.subEventId || null });
    }
    const doc = (await _event(ev.real)).doc || ev.doc;
    const p = planSort({ dumpDir: found.dumpDir, components: doc.components, photographerSequences: doc.photographerSequences, scopeDirs: await _scopeDirs(ev.real, doc.components), dumpRels, selection: sel });
    const sizes = new Map(found.photographers.flatMap(ph => ph.files.map(f => [f.rel, f.size])));
    for (const a of p.assets) for (const m of a.members) m.size = sizes.get(m.src) || 0;
    return { ok: blockers.length === 0, blockers, recovered, eventPath: ev.real, dumpDir: found.dumpDir, plan: p, problems: [...problems, ...p.problems], review: _review(p, found) };
  }

  function _review(p, found) {
    const dests = new Map();
    let files = 0, bytes = 0, sidecars = 0;
    for (const a of p.assets) {
      const key = `${a.subEventId || ''}\0${a.folder}`;
      if (!dests.has(key)) {
        const nf = p.newFolders.find(f => f.scopeKey === a.scopeKey && f.folderName === a.folder);
        dests.set(key, { component: a.subEventId, folder: a.folder, photographer: a.photographer, files: 0, bytes: 0, isNew: !!nf, sequence: nf ? nf.sequence : null });
      }
      for (const m of a.members) {
        if (m.role === 'sidecar') { sidecars++; continue; }
        files++; bytes += m.size || 0;
        const d = dests.get(key); d.files++; d.bytes += m.size || 0;
      }
    }
    return { assets: p.assets.length, files, bytes, sidecars, destinations: [...dests.values()], remaining: found.media - files };
  }

  /**
   * Runs Sort Dump. `groups` are the workspace's metadata groups (metadataTags / fileTagRefinements keyed
   * by absolute Dump path) — recorded against the final paths exactly as an import records them.
   */
  async function run(eventPath, { selection, groups = [] } = {}, onProgress = () => {}) {
    const planned = await plan(eventPath, selection);
    if (!planned.ok) return { ok: false, blockers: planned.blockers || [], problems: planned.problems || [] };
    if (!planned.plan.assets.length) return { ok: false, blockers: ['Nothing selected can be moved.'], problems: planned.problems };
    const real = planned.eventPath;
    running.add(real);
    let locks = null;
    try {
      const rels = planned.plan.assets.flatMap(a => a.members.flatMap(m => [m.src, m.dest]));
      locks = await deps.acquireLocks(real, rels);
      if (!locks.ok) return { ok: false, blockers: [`The archive folder is busy${locks.lockedBy ? ` (in use by ${locks.lockedBy})` : ''}. Try again shortly.`], problems: planned.problems };
      const who = deps.who ? deps.who() : {};
      const intentGroups = (groups || []).map(g => ({
        metadataTags: Array.isArray(g.metadataTags) ? g.metadataTags : null,
        files: (g.files || []).map(f => path.relative(real, path.resolve(f)).split(path.sep).join('/')),
        fileTagRefinements: g.fileTagRefinements && typeof g.fileTagRefinements === 'object'
          ? Object.fromEntries(Object.entries(g.fileTagRefinements).map(([k, v]) => [path.relative(real, path.resolve(k)).split(path.sep).join('/'), v]))
          : null,
      }));
      const result = await engine.run({
        eventPath: real, dumpDir: planned.dumpDir, plan: planned.plan,
        meta: { device: who.device || null, operator: who.operator || null, intent: { groups: intentGroups } },
        hooks: _hooks(real, onProgress), imageHash: deps.imageHash || null,
      });
      return { ...result, problems: [...planned.problems, ...(result.refused || [])], recovered: planned.recovered };
    } finally {
      if (locks && locks.release) await locks.release();
      running.delete(real);
    }
  }

  async function recoverPending(real) {
    const { journals } = await journal.listPending(real);
    if (!journals.length) return null;
    log(`[dump-sort] completing ${journals.length} interrupted sort(s)`);
    const r = await engine.recover({ eventPath: real, hooks: _hooks(real, () => {}), imageHash: deps.imageHash || null });
    return r.results.map(x => ({ txId: x.txId, ok: x.ok, movedFiles: x.movedFiles, attention: x.attention }));
  }

  function _hooks(real, onProgress) {
    return {
      onProgress,
      applyRecords: ({ doc, pairs, assets }) => _applyRecords(real, doc, pairs, assets),
      mirrorStaging: ({ pairs }) => _mirrorStaging(real, pairs),
      verifyMetadata: ({ pairs }) => {
        const files = pairs.filter(p => p.role === 'media' && p.kind !== 'video').map(p => toAbs(real, p.dest));
        return files.length ? deps.verifyMetadata(real, files, (p) => onProgress({ stage: 'metadata', ...p })) : Promise.resolve({ state: 'not-needed' });
      },
    };
  }

  async function _applyRecords(real, doc, pairs, assets) {
    const intent = deps.intent;
    const remap = intent.exactPairRemapper(pairs.map(p => ({ fromRel: p.src, toRel: p.dest })));
    const groups = ((doc.intent && doc.intent.groups) || []).map(g => ({
      metadataTags: g.metadataTags,
      files: (g.files || []).map(f => toAbs(real, f)),
      fileTagRefinements: g.fileTagRefinements ? Object.fromEntries(Object.entries(g.fileTagRefinements).map(([k, v]) => [toAbs(real, k), v])) : null,
    }));
    const moved = pairs.filter(p => p.role === 'media');
    // The workspace's sort-time intent is authoritative for the files the operator grouped (exactly as
    // an import records it — Default where nothing was chosen, which also drops a Dump-time "no
    // component" record that must not follow the photo into a component). A moved file outside every
    // group (a recovered move, a RAW/JPEG partner) keeps its own records, remapped to the new path.
    const grouped = new Set(groups.flatMap(g => g.files.map(f => path.normalize(f))));
    const covered = moved.filter(p => grouped.has(path.normalize(toAbs(real, p.src))));
    const delta = covered.length ? intent.buildImportIntentDelta({ eventFolderPath: real, groups, copiedFiles: covered.map(p => ({ src: toAbs(real, p.src), dest: toAbs(real, p.dest) })), skippedFiles: [] }) : null;
    const usedFolders = new Set(pairs.map(p => p.dest.split('/').slice(0, -1).filter(s => s !== 'VIDEO').join('/')));
    const newSeqs = (doc.newFolders || []).filter(f => f.sequence && usedFolders.has(f.scopeKey === EVENT_ROOT_KEY ? f.folderName : `${f.scopeKey}/${f.folderName}`));
    const audit = {
      id: doc.txId, at: new Date().toISOString(), device: doc.device || null, operator: doc.operator || null,
      photographers: [...new Set(assets.map(a => a.photographer))], components: [...new Set(assets.map(a => a.scopeKey))],
      movedFiles: moved.length, sidecars: pairs.length - moved.length, bytes: moved.reduce((n, p) => n + (p.size || 0), 0),
    };
    await deps.updateEventJsonAtomic(path.join(real, 'event.json'), (d) => {
      const changes = { updatedAt: Date.now() };
      let tr = intent.remapTagRefinements(d.tagRefinements, remap);
      let mg = intent.remapMetadataGroups(d.metadataGroups, remap);
      let trValue = tr.changed ? tr.value : d.tagRefinements;
      let mgValue = mg.changed ? mg.value : d.metadataGroups;
      let trChanged = tr.changed, mgChanged = mg.changed;
      if (delta) {
        const t2 = intent.mergeTagRefinements(trValue, delta.refinements);
        if (t2.changed) { trValue = t2.value; trChanged = true; }
        const m2 = intent.mergeMetadataGroups(mgValue, delta.metaTags);
        if (m2.changed) { mgValue = m2.value; mgChanged = true; }
      }
      if (trChanged) changes.tagRefinements = trValue;
      if (mgChanged) changes.metadataGroups = mgValue;
      if (newSeqs.length) {
        const seqs = JSON.parse(JSON.stringify(d.photographerSequences || {}));
        for (const f of newSeqs) {
          seqs[f.scopeKey] = seqs[f.scopeKey] || {};
          if (!seqs[f.scopeKey][f.photographer]) seqs[f.scopeKey][f.photographer] = { sequence: f.sequence, folderName: f.folderName };
        }
        changes.photographerSequences = seqs;
      }
      const prior = Array.isArray(d.dumpSorts) ? d.dumpSorts.filter(e => e && e.id !== audit.id) : [];
      changes.dumpSorts = [...prior, audit].slice(-MAX_AUDIT);
      return changes;
    });
  }

  /** Same moves in a synced Local First staging copy of the event (by path below the event folder). */
  async function _mirrorStaging(real, pairs) {
    const roots = deps.roots();
    if (!roots.staging) return null;
    const staging = path.join(roots.staging, path.basename(path.dirname(real)), path.basename(real));
    if (!(await fsp.stat(staging).then(s => s.isDirectory()).catch(() => false))) return null;
    const out = { moved: 0, alreadyThere: 0, kept: [] };
    const done = [];
    for (const p of pairs) {
      const src = toAbs(staging, p.src);
      const dest = toAbs(staging, p.dest);
      if (!(await fsp.lstat(src).then(s => s.isFile()).catch(() => false))) continue;
      try {
        if (await fsp.lstat(dest).then(() => true).catch(() => false)) {
          if (await engine.sameFile(fsp, src, dest)) { await fsp.unlink(src); out.alreadyThere++; done.push(p); } else out.kept.push(p.src);
          continue;
        }
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.rename(src, dest);
        out.moved++;
        done.push(p);
      } catch (err) { out.kept.push(p.src); log(`[dump-sort] staging copy not moved (${err.code || 'error'})`); }
    }
    if (done.length && await fsp.stat(path.join(staging, 'event.json')).then(() => true).catch(() => false)) {
      const remap = deps.intent.exactPairRemapper(done.map(p => ({ fromRel: p.src, toRel: p.dest })));
      await deps.updateEventJsonAtomic(path.join(staging, 'event.json'), (d) => {
        const changes = {};
        const tr = deps.intent.remapTagRefinements(d.tagRefinements, remap);
        if (tr.changed) changes.tagRefinements = tr.value;
        const mg = deps.intent.remapMetadataGroups(d.metadataGroups, remap);
        if (mg.changed) changes.metadataGroups = mg.value;
        return changes;
      }).catch(err => log(`[dump-sort] staging event.json remap failed (${err.code || 'error'})`));
    }
    return out;
  }

  /** Dump photographer folders with no remaining content (only empty subfolders / Finder state). */
  async function emptyPhotographerFolders(eventPath) {
    const ev = await _event(eventPath);
    if (!ev.real) return { ok: false, reason: ev.reason, folders: [] };
    const dumpDir = await findDumpDir(ev.real);
    if (!dumpDir) return { ok: true, folders: [], dumpEmpty: false };
    const { journals } = await journal.listPending(ev.real);
    if (journals.length) return { ok: true, folders: [], pending: true };
    const entries = await fsp.readdir(path.join(ev.real, dumpDir), { withFileTypes: true }).catch(() => []);
    const folders = [];
    for (const e of entries) {
      if (e.isDirectory() && !e.isSymbolicLink() && await _isEmptyTree(path.join(ev.real, dumpDir, e.name))) folders.push(e.name);
    }
    return { ok: true, folders, dumpDir };
  }

  /**
   * Removes ONE confirmed-empty Dump photographer folder (re-checked now; empty subfolders and Finder
   * state only; never a file). When Dump itself is then empty it is removed too.
   */
  async function deleteEmptyPhotographerFolder(eventPath, name) {
    const ev = await _event(eventPath);
    if (!ev.real) return { ok: false, reason: ev.reason };
    if (!safeSegment(name)) return { ok: false, reason: 'Not a photographer folder.' };
    if (running.has(ev.real)) return { ok: false, reason: 'A Sort Dump is running for this event.' };
    const dumpDir = await findDumpDir(ev.real);
    if (!dumpDir) return { ok: false, reason: 'This event has no Dump folder.' };
    if ((await journal.listPending(ev.real)).journals.length) return { ok: false, reason: 'A Sort Dump for this event has not finished.' };
    const dumpAbs = path.join(ev.real, dumpDir);
    const target = path.join(dumpAbs, name);
    const st = await fsp.lstat(target).catch(() => null);
    if (!st || !st.isDirectory() || st.isSymbolicLink()) return { ok: false, reason: 'The folder is no longer there.' };
    if (!(await _isEmptyTree(target))) return { ok: false, reason: 'The folder is not empty any more, so it was kept.' };
    await _removeEmptyTree(target);
    let dumpRemoved = false;
    const left = (await fsp.readdir(dumpAbs).catch(() => ['?'])).filter(n => !IGNORABLE.has(n));
    if (left.length === 0) {
      for (const n of await fsp.readdir(dumpAbs).catch(() => [])) if (IGNORABLE.has(n)) await fsp.unlink(path.join(dumpAbs, n)).catch(() => {});
      dumpRemoved = await fsp.rmdir(dumpAbs).then(() => true).catch(() => false);
    }
    log(`[dump-sort] empty photographer folder removed${dumpRemoved ? ' (and the empty Dump folder)' : ''}`);
    return { ok: true, dumpRemoved };
  }

  return { status, plan, run, recoverPending, emptyPhotographerFolders, deleteEmptyPhotographerFolder };
}

/** True when the tree holds no file other than Finder state, and no link or special entry. */
async function _isEmptyTree(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return false;
  for (const e of entries) {
    if (e.isSymbolicLink()) return false;
    if (e.isDirectory()) { if (!(await _isEmptyTree(path.join(dir, e.name)))) return false; continue; }
    if (e.isFile() && IGNORABLE.has(e.name)) continue;
    return false;
  }
  return true;
}

/** Bottom-up rmdir (never recursive delete): fails, and keeps everything, if anything appeared. */
async function _removeEmptyTree(dir) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !e.isSymbolicLink()) await _removeEmptyTree(p);
    else if (e.isFile() && IGNORABLE.has(e.name)) await fsp.unlink(p);
  }
  await fsp.rmdir(dir);
}

module.exports = { createDumpSortService, _isEmptyTree };
