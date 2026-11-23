/**
 * crossEventMoveService.js — "Move Selection to Another Event" from Sort Dump (AI-FEAT-064 EQI-3.2). Main process.
 *
 * Connects the planner (crossEventMovePlanner) and the two-event transaction (crossEventMoveEngine) to the
 * rest of AutoIngest through injected dependencies — the same guards, records, locks, Local First and
 * background metadata Sort Dump uses, applied to BOTH events:
 *
 *   scope       both events are archive events (never Local Staging) of the SAME collection folder, hence of
 *               one archive root; a different collection or archive root is refused (never guessed)
 *   guards      no import running; no Sort Dump or other transfer running or unfinished on either event; no
 *               unsynced Local First import of either event; no metadata batch still writing the source Dump;
 *               the moved files' intent records are consistent (never silently dropped)
 *   locks       archive folder locks of both events (NAS), always taken in path order, held for the whole move;
 *               B's background metadata takes its own hold before they are released
 *   records     B: transfersIn (original imports, photographers, source event, txId, every from → to path) and
 *               the files' intent records (Dump → Dump: carried as they were; → component: B's Default for the
 *               chosen component, as Sort Dump records an ungrouped photo) + new PC folders; A: the moved
 *               files' intent records removed, transfersOut kept. imports[] and the global import index are
 *               never touched — the index is keyed by file name + size, so the moved photos stay "imported".
 *   staging     synced Local First staging copies get the same move, so no later sync brings a moved photo
 *               back into A's Dump
 *   metadata    B's moved photos are verified against B (and rewritten where needed) in the BACKGROUND by
 *               dumpSortMetadata — the operator is released when the files and both records are committed
 */

'use strict';

const path = require('path');
const fsp = require('fs').promises;
const { discoverDump, findDumpDir } = require('./dumpSortDiscovery');
const { safeSegment, norm, EVENT_ROOT_KEY } = require('./dumpSortPlanner');
const { planTransfer } = require('./crossEventMovePlanner');
const engine = require('./crossEventMoveEngine');
const sortEngine = require('./dumpSortEngine');

const MAX_AUDIT = 500;
const MAX_AUDIT_PATHS = 5000;
const under = (child, parent) => child === parent || child.startsWith(parent + path.sep);
const toAbs = (root, rel) => path.join(root, ...rel.split('/'));
const relOf = (root, abs) => path.relative(root, path.resolve(abs)).split(path.sep).join('/');

/**
 * @param {object} deps
 * @param {Function} deps.updateEventJsonAtomic
 * @param {object}   deps.intent                                    services/eventMetadataIntent
 * @param {() => { archive: string[], staging: string|null, nas: string|null }} deps.roots
 * @param {(real: string) => Promise<string[]>} deps.pendingSyncFor
 * @param {(real: string) => Promise<number>} deps.activeMetadataFor
 * @param {() => boolean} deps.isImportRunning
 * @param {(real: string) => Promise<string|null>} deps.sortBusyFor        Sort Dump running / unfinished on the event
 * @param {(real: string, rels: string[]) => Promise<{ ok: boolean, release: Function, lockedBy?: string, self?: boolean }>} deps.acquireLocks
 * @param {(collectionPath: string) => Promise<object[]>} deps.scanEvents   Event Creator's collection scan
 * @param {ReturnType<import('./dumpSortMetadata').createDumpSortMetadata>} [deps.metadata]
 * @param {(p: string) => Promise<string|null>} [deps.imageHash]
 * @param {() => { device: string|null, operator: object|null }} [deps.who]
 * @param {Function} [deps.log]
 * @param {object} [deps.testHooks]   { crash(phase) } — tests only
 */
function createCrossEventMoveService(deps) {
  const log = deps.log || (() => {});
  const running = new Set();   // real paths of both events of a running transfer

  async function _event(eventPath, role) {
    const label = role === 'destination' ? 'The destination event' : 'This event';
    if (typeof eventPath !== 'string' || !path.isAbsolute(eventPath)) return { reason: `${label} folder is missing.` };
    const real = await fsp.realpath(eventPath).catch(() => null);
    if (!real) return { reason: `${label} folder is not reachable. Reconnect the archive and try again.` };
    const roots = deps.roots();
    if (roots.staging && under(real, roots.staging)) return { reason: `${label} is in Local Staging. Sync it to the archive first.` };
    const root = roots.archive.find(r => under(real, r));
    if (!root) return { reason: `${label} is not inside a configured archive.` };
    let doc;
    try { doc = JSON.parse(await fsp.readFile(path.join(real, 'event.json'), 'utf8')); } catch { return { reason: `${label}'s record (event.json) could not be read.` }; }
    if (!doc || !Array.isArray(doc.components) || doc.components.length === 0) return { reason: `${label} has no components.` };
    return { real, doc, root };
  }

  const _name = (ev) => (ev.doc && typeof ev.doc.eventName === 'string' && ev.doc.eventName) || path.basename(ev.real);

  /** Destination events offered for the source: the other events of its collection, read by the existing scan. */
  async function destinations(sourcePath) {
    const a = await _event(sourcePath, 'source');
    if (!a.real) return { ok: false, reason: a.reason, events: [] };
    const collection = path.dirname(a.real);
    const scanned = await deps.scanEvents(collection).catch(() => []);
    const events = [];
    for (const e of scanned || []) {
      if (!e || !e.folderName || e.folderName === path.basename(a.real)) continue;
      const eventPath = path.join(collection, e.folderName);
      const comps = Array.isArray(e.components) ? e.components : [];
      const meta = e._eventJson || {};
      let unavailable = null;
      if (!e.isFromJson || e.isCorrupt) unavailable = 'no valid event record (event.json)';
      else if (e.isUnresolved) unavailable = 'the event has unresolved components';
      else if (!comps.length) unavailable = 'the event has no components';
      events.push({
        eventPath, folderName: e.folderName, eventName: meta.eventName || e.folderName, hijriDate: e.hijriDate || meta.hijriDate || '',
        components: comps.map(c => ({ folderName: c.folderName, label: _compLabel(c), qmz: Array.isArray(c.types) && c.types.includes('QMZ') })),
        unavailable,
      });
    }
    events.sort((x, y) => String(y.folderName).localeCompare(String(x.folderName)));
    return { ok: true, collection: path.basename(collection), source: { eventPath: a.real, folderName: path.basename(a.real), eventName: _name(a) }, events };
  }

  function _compLabel(c) {
    const types = Array.isArray(c.eventTypes) ? c.eventTypes.map(t => (t && (t.label || t.name)) || t).filter(x => typeof x === 'string') : (Array.isArray(c.types) ? c.types : []);
    return types.length ? `${types.join(', ')} — ${c.folderName}` : c.folderName;
  }

  async function _blockers(a, b) {
    const out = [];
    if (deps.isImportRunning()) out.push('An import is running. Move the photos when it has finished.');
    for (const [ev, who] of [[a, 'This event'], [b, 'The destination event']]) {
      if (running.has(ev.real)) out.push(`${who} has another transfer running.`);
      const sortBusy = await deps.sortBusyFor(ev.real).catch(() => null);
      if (sortBusy && !/^Metadata/.test(sortBusy)) out.push(`${who}: ${sortBusy}`);
      const pending = await deps.pendingSyncFor(ev.real).catch(() => ['unknown']);
      if (pending.length) out.push(`${who} has Local First imports that are not yet synced to the archive. Sync them first (Sync Queue).`);
      const tx = await _pendingTransfers(ev.real);
      if (tx) out.push(`${who} has an unfinished transfer${tx.attention ? ' that needs attention' : ''}. It is completed before anything else moves.`);
    }
    if ((await deps.activeMetadataFor(a.real).catch(() => 0)) > 0) out.push('Metadata is still being written to this event\'s Dump. Move the photos when it has finished.');
    return out;
  }

  async function _pendingTransfers(real) {
    const out = await engine.listOutbound(real);
    const inn = await engine.listInbound(real);
    const n = out.journals.length + out.unreadable.length + inn.markers.length + inn.unreadable.length;
    return n ? { count: n, attention: out.journals.some(j => j.phase === 'needs-attention') } : null;
  }

  /**
   * Completes interrupted transfers touching the event — out of it (its journals) and into it (markers:
   * completed through their source's journal; a marker whose journal is finished or was never written is
   * stale and removed). Under both events' locks, like a new transfer.
   */
  async function recoverFor(real) {
    const results = [];
    const { markers } = await engine.listInbound(real);
    for (const m of markers) {
      const src = path.join(path.dirname(real), m.sourceEventFolder);
      const srcReal = await fsp.realpath(src).catch(() => null);
      if (!srcReal) { results.push({ ok: false, deferred: true, reason: 'source-unreachable', txId: m.txId }); continue; }
      const st = await engine.journalState(srcReal, m.txId);
      if (st !== 'pending') { await engine.removeMarker(real, m.txId); continue; }
      results.push(...await _recoverOut(srcReal));
    }
    results.push(...await _recoverOut(real));
    return results;
  }

  async function _recoverOut(realA) {
    const { journals } = await engine.listOutbound(realA);
    if (!journals.length) return [];
    if (running.has(realA) || deps.isImportRunning()) return [{ ok: false, deferred: true, reason: 'busy' }];
    const out = [];
    for (const j of journals) {
      const realB = await fsp.realpath(path.join(path.dirname(realA), j.destination.eventFolder)).catch(() => null);
      if (!realB) { out.push({ ok: false, deferred: true, reason: 'destination-unreachable', txId: j.txId }); continue; }
      const locks = await _lockBoth(realA, realB, j.assets.flatMap(x => x.members.map(m => m.src)), j.assets.flatMap(x => x.members.map(m => m.dest)));
      if (!locks.ok) { out.push({ ok: false, deferred: true, reason: 'locked', lock: locks.lock, txId: j.txId }); continue; }
      running.add(realA); running.add(realB);
      try {
        log(`[cross-event] completing an interrupted transfer`);
        const r = await engine.recover({ sourcePath: realA, only: j.txId, resolveDest: () => realB, hooks: _hooks(() => {}) });
        for (const x of r.results) {
          if (deps.metadata && x.metadata && x.metadata.state === 'queued') await deps.metadata.start(realB, x.txId).catch(() => {});
          out.push({ txId: x.txId, ok: x.ok, phase: x.phase, movedFiles: x.movedFiles, attention: x.attention, deferred: x.deferred });
        }
      } finally {
        running.delete(realA); running.delete(realB);
        await locks.release();
      }
    }
    return out;
  }

  /** Locks of both events, in path order (deterministic — two opposite transfers never deadlock). */
  async function _lockBoth(realA, realB, srcRels, destRels) {
    const order = [[realA, srcRels], [realB, destRels]].sort((x, y) => (x[0] < y[0] ? -1 : 1));
    const held = [];
    for (let i = 0; i < order.length; i++) {
      const l = await deps.acquireLocks(order[i][0], order[i][1]);
      if (!l.ok) {
        for (const h of held.reverse()) await h.release();
        const lock = { lockedBy: l.lockedBy || null, self: !!l.self, lockPath: l.lockPath || null, lockPaths: l.lockPaths || (l.lockPath ? [l.lockPath] : []) };
        // A crash-left lock of this computer usually sits in BOTH events (the interrupted transfer held both):
        // the other event's are collected too, so one explicit release covers the whole transfer.
        if (lock.self) {
          for (const [real, rels] of order.filter((_, j) => j !== i)) {
            const o = await deps.acquireLocks(real, rels);
            if (o.ok) { await o.release(); continue; }
            if (!o.self) { lock.self = false; lock.lockedBy = o.lockedBy || lock.lockedBy; break; }
            lock.lockPaths = [...new Set([...lock.lockPaths, ...(o.lockPaths || (o.lockPath ? [o.lockPath] : []))])];
          }
        }
        return { ok: false, lock };
      }
      held.push(l);
    }
    return { ok: true, release: async () => { for (const h of held.reverse()) await Promise.resolve(h.release()).catch(() => {}); } };
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
   * Plans a transfer (completing interrupted ones of both events first) and returns the review.
   * @param {string} sourcePath
   * @param {{ destPath: string, kind: 'dump'|'component', component?: string|null, selection: string[] }} args  absolute Dump paths
   */
  async function plan(sourcePath, { destPath, kind, component = null, selection = [] } = {}) {
    const a = await _event(sourcePath, 'source');
    if (!a.real) return { ok: false, blockers: [a.reason] };
    const b = await _event(destPath, 'destination');
    if (!b.real) return { ok: false, blockers: [b.reason] };
    if (a.real === b.real) return { ok: false, blockers: ['Choose another event: the destination is the event being sorted.'] };
    if (path.dirname(a.real) !== path.dirname(b.real)) return { ok: false, blockers: ['The destination event is in another collection. Moving photos between collections is not supported.'] };
    if (a.root !== b.root) return { ok: false, blockers: ['The two events are in different archive locations. Moving photos between archive roots is not supported.'] };
    if (kind !== 'dump' && kind !== 'component') return { ok: false, blockers: ['Choose where the photos go in the destination event.'] };
    const recovered = [...await recoverFor(a.real), ...await recoverFor(b.real)];
    const waiting = recovered.find(r => r && r.deferred);
    const blockers = await _blockers(a, b);
    if (waiting && !blockers.some(x => /unfinished transfer/.test(x))) blockers.push(waiting.reason === 'locked' ? 'An interrupted transfer is waiting for an archive folder lock. It is completed before anything else moves.' : 'An interrupted transfer will be completed when the running work has finished.');
    // Re-read both records now (recovery may have changed them).
    const docA = JSON.parse(await fsp.readFile(path.join(a.real, 'event.json'), 'utf8'));
    const docB = JSON.parse(await fsp.readFile(path.join(b.real, 'event.json'), 'utf8'));
    const foundA = await discoverDump(a.real);
    if (!foundA.exists) return { ok: false, blockers: ['This event has no Dump folder.'], recovered };
    const dumpRels = [...foundA.photographers.flatMap(p => p.files.map(f => f.rel)), ...foundA.sidecars];
    const sel = [];
    const problems = [];
    for (const p of selection || []) {
      const rel = typeof p === 'string' ? relOf(a.real, p) : null;
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { problems.push({ rel: String(p), reason: 'outside this event' }); continue; }
      sel.push(rel);
    }
    const destDumpDir = kind === 'dump' ? ((await findDumpDir(b.real)) || 'Dump') : await findDumpDir(b.real);
    const foundB = await discoverDump(b.real);
    const dumpFolders = kind === 'dump' && foundB.exists
      ? (await fsp.readdir(path.join(b.real, foundB.dumpDir), { withFileTypes: true }).catch(() => [])).filter(e => e.isDirectory() && !e.isSymbolicLink()).map(e => e.name)
      : [];
    const p = planTransfer({
      kind, sourceDumpDir: foundA.dumpDir, sourceDumpRels: dumpRels, selection: sel, component,
      destination: { dumpDir: destDumpDir, dumpFolders, components: docB.components, photographerSequences: docB.photographerSequences, scopeDirs: kind === 'component' ? await _scopeDirs(b.real, docB.components) : {} },
    });
    // Intent records that cannot be read safely are never moved (and never silently dropped).
    const intentA = deps.intent.getIntent(docA);
    const kept = [];
    for (const asset of p.assets) {
      const bad = asset.members.map(m => deps.intent.integrityErrorFor(intentA, deps.intent.relKey(m.src))).find(Boolean);
      if (bad) { for (const m of asset.members.filter(x => x.role === 'media')) problems.push({ rel: m.src, reason: 'its metadata record in this event is inconsistent — resolve it in Metadata Audit first' }); continue; }
      kept.push(asset);
    }
    p.assets = kept;
    const sizes = new Map(foundA.photographers.flatMap(ph => ph.files.map(f => [f.rel, f.size])));
    for (const asset of p.assets) for (const m of asset.members) m.size = sizes.get(m.src) || 0;
    // Collisions are decided by the same preflight the move runs (read only here).
    const destDumpIndex = foundB.exists ? foundB.photographers.flatMap(ph => ph.files.map(f => ({ rel: f.rel, photographer: ph.name }))) : [];
    let pre = { assets: p.assets, refused: [], collisions: [] };
    if (p.assets.length) {
      pre = await engine.preflight({ sourcePath: a.real, destPath: b.real, sourceDumpDir: foundA.dumpDir, kind, destDumpDir: kind === 'dump' ? destDumpDir : foundB.dumpDir, assets: JSON.parse(JSON.stringify(p.assets)), destDumpIndex, imageHash: deps.imageHash || null });
    }
    const allProblems = [...problems, ...p.problems, ...pre.refused.map(r => ({ rel: r.src, reason: r.reason }))];
    const review = _review({ a, b, kind, component, plan: p, pre, foundA, destDumpDir, dumpFolders });
    return {
      ok: blockers.length === 0 && pre.assets.length > 0, blockers, recovered, lock: (waiting && waiting.lock) || null,
      source: { eventPath: a.real, folderName: path.basename(a.real), eventName: _name(a), dumpDir: foundA.dumpDir },
      destination: { eventPath: b.real, folderName: path.basename(b.real), eventName: _name(b), dumpDir: destDumpDir, kind, component },
      plan: p, problems: allProblems, review,
    };
  }

  function _review({ a, b, kind, component, plan: p, pre, foundA, destDumpDir, dumpFolders }) {
    const movable = new Set(pre.assets.map(x => x.id));
    const byFolder = new Map();
    const t = { files: 0, raw: 0, jpeg: 0, videos: 0, sidecars: 0, bytes: 0 };
    for (const asset of p.assets.filter(x => movable.has(x.id))) {
      const key = `${asset.scopeKey}\0${asset.folder}`;
      if (!byFolder.has(key)) {
        const nf = p.newFolders.find(f => f.scopeKey === asset.scopeKey && f.folderName === asset.folder);
        const base = kind === 'dump' ? `${destDumpDir}/${asset.folder}` : (asset.scopeKey === EVENT_ROOT_KEY ? asset.folder : `${asset.scopeKey}/${asset.folder}`);
        byFolder.set(key, { photographer: asset.photographer, folder: asset.folder, component: kind === 'component' ? (asset.scopeKey === EVENT_ROOT_KEY ? null : asset.scopeKey) : null, path: `${path.basename(b.real)}/${base}`, isNew: kind === 'component' ? !!nf : !dumpFolders.includes(asset.folder), sequence: nf ? nf.sequence : null, files: 0, bytes: 0 });
      }
      const d = byFolder.get(key);
      for (const m of asset.members) {
        if (m.role === 'sidecar') { t.sidecars++; continue; }
        t.files++; t.bytes += m.size || 0; d.files++; d.bytes += m.size || 0;
        if (m.kind === 'raw') t.raw++; else if (m.kind === 'video') t.videos++; else t.jpeg++;
      }
    }
    const roots = deps.roots();
    const onNas = !!(roots.nas && under(a.real, roots.nas));
    return {
      ...t, assets: movable.size,
      photographers: [...new Set(p.assets.filter(x => movable.has(x.id)).map(x => x.photographer))],
      destinations: [...byFolder.values()],
      newSequences: p.newFolders.filter(f => f.sequence).map(f => ({ component: f.scopeKey === EVENT_ROOT_KEY ? null : f.scopeKey, folder: f.folderName, sequence: f.sequence })),
      remaining: Math.max(0, foundA.media - t.files),
      collisions: pre.collisions,
      archive: { location: onNas ? 'nas' : 'archive', collection: path.basename(path.dirname(a.real)), sameCollection: true, localFirstCopies: !!roots.staging },
      kind, component,
    };
  }

  /** Runs a transfer: re-plans under both events' locks, then the two-event transaction. */
  async function run(sourcePath, args = {}, onProgress = () => {}) {
    const a0 = await fsp.realpath(sourcePath).catch(() => null);
    const b0 = await fsp.realpath(args.destPath || '').catch(() => null);
    if (a0 && running.has(a0)) return { ok: false, blockers: ['A transfer is already running for this event.'] };
    const planned = await plan(sourcePath, args);
    if (!planned.ok) return { ok: false, blockers: planned.blockers && planned.blockers.length ? planned.blockers : ['Nothing selected can be moved.'], problems: planned.problems || [], lock: planned.lock || null };
    const realA = planned.source.eventPath;
    const realB = planned.destination.eventPath;
    if (running.has(realA) || running.has(realB) || (b0 && running.has(b0))) return { ok: false, blockers: ['A transfer is already running for one of these events.'] };
    running.add(realA); running.add(realB);
    let locks = null;
    try {
      locks = await _lockBoth(realA, realB, planned.plan.assets.flatMap(x => x.members.map(m => m.src)), planned.plan.assets.flatMap(x => x.members.map(m => m.dest)));
      if (!locks.ok) return { ok: false, blockers: [`An archive folder is busy${locks.lock.lockedBy ? ` (in use by ${locks.lock.lockedBy})` : ''}. Try again shortly.`], lock: locks.lock, problems: planned.problems };
      const docA = JSON.parse(await fsp.readFile(path.join(realA, 'event.json'), 'utf8'));
      const who = deps.who ? deps.who() : {};
      const photographers = new Set(planned.plan.assets.map(x => x.photographer));
      const imports = (Array.isArray(docA.imports) ? docA.imports : [])
        .filter(i => i && i.destination === 'dump' && [...photographers].some(ph => norm(ph) === norm(i.photographer)))
        .map(i => ({ id: i.id || null, timestamp: i.timestamp || null, photographer: i.photographer || null }));
      const foundB = await discoverDump(realB);
      const destDumpIndex = foundB.exists ? foundB.photographers.flatMap(ph => ph.files.map(f => ({ rel: f.rel, photographer: ph.name }))) : [];
      const result = await engine.run({
        sourcePath: realA, destPath: realB, sourceDumpDir: planned.source.dumpDir, kind: args.kind,
        destDumpDir: args.kind === 'dump' ? planned.destination.dumpDir : foundB.dumpDir,
        plan: planned.plan, destDumpIndex, imageHash: deps.imageHash || null,
        meta: {
          device: who.device || null, operator: who.operator || null, component: args.component || null,
          sourceEventName: planned.source.eventName, destEventName: planned.destination.eventName,
          provenance: { sourceEvent: planned.source.folderName, imports },
          intent: _intentSnapshot(docA, planned.plan.assets),
        },
        hooks: _hooks(onProgress),
      });
      if (deps.metadata && result.metadata && result.metadata.state === 'queued') {
        result.metadataStart = await deps.metadata.start(realB, result.txId).catch(err => ({ started: false, reason: err.message }));
      }
      log(`[cross-event] transfer ${result.phase}: moved=${result.movedFiles || 0} sidecars=${result.sidecars || 0} attention=${(result.attention || []).length}`);
      return { ...result, problems: [...planned.problems, ...(result.refused || []).map(r => ({ rel: r.src, reason: r.reason }))], source: planned.source, destination: planned.destination, recovered: planned.recovered };
    } finally {
      if (locks && locks.release) await locks.release();
      running.delete(realA); running.delete(realB);
    }
  }

  /** The moved files' intent records in A, copied into the journal (B's records come from here, not A's live doc). */
  function _intentSnapshot(docA, assets) {
    const keys = new Set(assets.flatMap(x => x.members.map(m => deps.intent.relKey(m.src))).filter(Boolean));
    const it = deps.intent.getIntent(docA);
    const tr = [];
    const mg = [];
    for (const k of keys) {
      if (it.refinements.has(k)) tr.push([k, it.refinements.get(k)]);
      if (it.metaTags.has(k)) mg.push([k, it.metaTags.get(k)]);
    }
    return { tagRefinements: tr, metadataGroups: mg };
  }

  function _hooks(onProgress) {
    return {
      onProgress,
      crash: deps.testHooks && deps.testHooks.crash,
      applyDestRecords: (x) => _applyDestRecords(x),
      applySourceRecords: (x) => _applySourceRecords(x),
      mirrorStaging: (x) => _mirrorStaging(x),
      queueMetadata: ({ doc, pairs, realB }) => {
        const rels = pairs.filter(p => p.role === 'media' && p.kind !== 'video').map(p => p.dest);
        return rels.length && deps.metadata ? deps.metadata.record(realB, doc.txId, rels, { eventName: doc.destination.eventName }) : Promise.resolve({ state: 'not-needed' });
      },
    };
  }

  function _snapshotDoc(doc) {
    const snap = doc.intent || { tagRefinements: [], metadataGroups: [] };
    return {
      tagRefinements: snap.tagRefinements.map(([k, v]) => ({ eventTypes: v.eventTypes, additionalKeywords: v.additionalKeywords, relPaths: [k] })),
      metadataGroups: snap.metadataGroups.map(([k, v]) => ({ metadataTags: v, relPaths: [k] })),
    };
  }

  const _paths = (pairs) => pairs.slice(0, MAX_AUDIT_PATHS).map(p => ({ from: p.src, to: p.dest }));

  async function _applyDestRecords({ doc, pairs, assets, realB }) {
    const intent = deps.intent;
    // Dump → Dump carries the files' records as they were (B's Sort Dump decides them again when it sorts);
    // → component: B's Default for the chosen component (A's groups belong to A's components).
    const carried = doc.kind === 'dump' ? _snapshotDoc(doc) : {};
    const media = pairs.filter(p => p.role === 'media');
    const usedFolders = new Set(pairs.map(p => p.dest.split('/').slice(0, -1).filter(s => s !== 'VIDEO').join('/')));
    const newSeqs = (doc.newFolders || []).filter(f => f.sequence && usedFolders.has(f.scopeKey === EVENT_ROOT_KEY ? f.folderName : `${f.scopeKey}/${f.folderName}`));
    const entry = {
      id: doc.txId, at: new Date().toISOString(), kind: doc.kind, component: doc.destination.component || null,
      fromEvent: { folder: doc.source.eventFolder, eventName: doc.source.eventName || null }, collection: doc.collection,
      photographers: [...new Set(assets.map(x => x.photographer))], movedFiles: media.length, sidecars: pairs.length - media.length,
      bytes: media.reduce((n, p) => n + (p.size || 0), 0), device: doc.device || null, operator: doc.operator || null,
      originalImports: (doc.provenance && doc.provenance.imports) || [], paths: _paths(pairs),
    };
    await deps.updateEventJsonAtomic(path.join(realB, 'event.json'), (d) => {
      const changes = { updatedAt: Date.now() };
      const merged = intent.syncMergeIntent(d, carried, pairs.map(p => ({ fromRel: p.src, toRel: p.dest })));
      if (merged.tagRefinements.changed) changes.tagRefinements = merged.tagRefinements.value;
      if (merged.metadataGroups.changed) changes.metadataGroups = merged.metadataGroups.value;
      if (newSeqs.length) {
        const seqs = JSON.parse(JSON.stringify(d.photographerSequences || {}));
        for (const f of newSeqs) {
          seqs[f.scopeKey] = seqs[f.scopeKey] || {};
          if (!seqs[f.scopeKey][f.photographer]) seqs[f.scopeKey][f.photographer] = { sequence: f.sequence, folderName: f.folderName };
        }
        changes.photographerSequences = seqs;
      }
      const prior = Array.isArray(d.transfersIn) ? d.transfersIn.filter(e => e && e.id !== entry.id) : [];
      changes.transfersIn = [...prior, entry].slice(-MAX_AUDIT);
      return changes;
    });
  }

  async function _applySourceRecords({ doc, pairs, assets, realA }) {
    const intent = deps.intent;
    const gone = new Map(pairs.map(p => [intent.relKey(p.src), undefined]).filter(([k]) => k));
    const media = pairs.filter(p => p.role === 'media');
    const entry = {
      id: doc.txId, at: new Date().toISOString(), kind: doc.kind, component: doc.destination.component || null,
      toEvent: { folder: doc.destination.eventFolder, eventName: doc.destination.eventName || null },
      photographers: [...new Set(assets.map(x => x.photographer))], movedFiles: media.length, sidecars: pairs.length - media.length,
      bytes: media.reduce((n, p) => n + (p.size || 0), 0), device: doc.device || null, operator: doc.operator || null, paths: _paths(pairs),
    };
    await deps.updateEventJsonAtomic(path.join(realA, 'event.json'), (d) => {
      const changes = { updatedAt: Date.now() };
      const tr = intent.mergeTagRefinements(d.tagRefinements, gone);
      if (tr.changed) changes.tagRefinements = tr.value;
      const mg = intent.mergeMetadataGroups(d.metadataGroups, gone);
      if (mg.changed) changes.metadataGroups = mg.value;
      const prior = Array.isArray(d.transfersOut) ? d.transfersOut.filter(e => e && e.id !== entry.id) : [];
      changes.transfersOut = [...prior, entry].slice(-MAX_AUDIT);
      return changes;
    });
  }

  /**
   * Synced Local First staging copies (same collection/event below the staging root): A's staging Dump
   * copy goes to B's staging copy when there is one, otherwise it is removed — only when it is verified to
   * be the same file as the archived destination — so no later sync brings it back into A's Dump.
   */
  async function _mirrorStaging({ pairs, realA, realB }) {
    const roots = deps.roots();
    if (!roots.staging) return null;
    const sA = path.join(roots.staging, path.basename(path.dirname(realA)), path.basename(realA));
    const sB = path.join(roots.staging, path.basename(path.dirname(realB)), path.basename(realB));
    const isDir = (p) => fsp.stat(p).then(s => s.isDirectory()).catch(() => false);
    if (!(await isDir(sA))) return null;
    const hasB = await isDir(sB);
    const out = { moved: 0, removed: 0, kept: [] };
    const done = [];
    for (const p of pairs) {
      const src = toAbs(sA, p.src);
      if (!(await fsp.lstat(src).then(s => s.isFile()).catch(() => false))) continue;
      try {
        if (hasB) {
          const dest = toAbs(sB, p.dest);
          if (await fsp.lstat(dest).then(() => true).catch(() => false)) {
            if (await sortEngine.sameFile(fsp, src, dest)) { await fsp.unlink(src); out.removed++; done.push(p); } else out.kept.push(p.src);
            continue;
          }
          await fsp.mkdir(path.dirname(dest), { recursive: true });
          await fsp.rename(src, dest);
          out.moved++;
          done.push(p);
        } else if (await sortEngine.sameFile(fsp, src, toAbs(realB, p.dest)).catch(() => false)) {
          await fsp.unlink(src);
          out.removed++;
          done.push(p);
        } else out.kept.push(p.src);
      } catch (err) { out.kept.push(p.src); log(`[cross-event] staging copy not moved (${err.code || 'error'})`); }
    }
    if (done.length && await fsp.stat(path.join(sA, 'event.json')).then(() => true).catch(() => false)) {
      const gone = new Map(done.map(p => [deps.intent.relKey(p.src), undefined]).filter(([k]) => k));
      await deps.updateEventJsonAtomic(path.join(sA, 'event.json'), (d) => {
        const changes = {};
        const tr = deps.intent.mergeTagRefinements(d.tagRefinements, gone);
        if (tr.changed) changes.tagRefinements = tr.value;
        const mg = deps.intent.mergeMetadataGroups(d.metadataGroups, gone);
        if (mg.changed) changes.metadataGroups = mg.value;
        return changes;
      }).catch(err => log(`[cross-event] staging event.json update failed (${err.code || 'error'})`));
    }
    return out;
  }

  /** Why the event folder must not be renamed, edited or sorted now (a transfer moving or unfinished), or null. */
  async function busyFor(eventPath) {
    const real = await fsp.realpath(eventPath).catch(() => null);
    if (!real) return null;
    if (running.has(real)) return 'Photos are being moved between this event and another event.';
    const p = await _pendingTransfers(real);
    if (p) return p.attention
      ? 'A photo transfer between this event and another event needs attention. Open Sort Dump for the source event to review it.'
      : 'A photo transfer between this event and another event has not finished. Open Sort Dump for the source event to complete it.';
    return null;
  }

  return { destinations, plan, run, recoverFor, busyFor, isRunningFor: (real) => running.has(real) };
}

module.exports = { createCrossEventMoveService };
