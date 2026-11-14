/**
 * companionImportService.js — Event Dump imports run by the menu-bar companion WITHOUT the main
 * application window (AI-FEAT-064 EQI-2.1). Main process only.
 *
 * Before EQI-2.1 the companion handed every Dump import to the main window's renderer
 * (workspaceHandoff → renderer/eventDumpImport.js), because that renderer held the orchestration:
 * event data (EventCreator), the per-event runner, the Local First mirror step, the busy-archive
 * dialog and — after metadata — the Local First sync job. So an import needed (and showed) the
 * main window.
 *
 * Now the same orchestration runs here, over the SAME engine pieces — nothing is re-implemented:
 *   ImportRouter.buildDumpFileJobs (Dump routing)  →  ImportSessionRunner (per-event isolation,
 *   source-wide stop)  →  per event: localMirror.ensureLocalMirror + remap (Local First, as
 *   _sessPrepareEvent)  →  main.js _commitImportTransaction (copy + verify, locks, atomic
 *   event.json, import index, Dump re-import guard, metadata batch)  →  the Local First sync job
 *   (as the renderer's _writeLocalFirstManifest) once that event's metadata batch has finished.
 * The main window's own Import Workspace is untouched and keeps its own path.
 *
 * Operator decisions (a busy archive folder) are asked in the companion popup and wait for the
 * operator; nothing is cleared or bypassed automatically. Progress is byte-level (transferStats.js).
 * An import is "complete" only after every event's transaction AND metadata batch have finished.
 */

'use strict';

const path = require('path');
const ImportRouter = require('../renderer/importRouter.js');
const ImportSessionRunner = require('../renderer/importSessionRunner.js');
const { componentsFromEventJson } = require('./eventComponents');
const { createTransferTracker, SAMPLE_MS } = require('./transferStats');

const PUSH_MS = 250;
const META_SILENCE_MS = 10 * 60 * 1000;
const SAFE_NAME = (n) => typeof n === 'string' && n.length > 0 && !/[\\/]/.test(n) && n !== '.' && n !== '..';

/**
 * @param {object} deps
 * @param {(params: object, hooks: object) => Promise<object>} deps.commit   _commitImportTransaction, tracked as an import
 * @param {(eventPath: string) => Promise<object|null>} deps.readEventJson
 * @param {(params: object) => Promise<object>} deps.ensureLocalMirror
 * @param {(eventPath: string, patch: object) => Promise<any>} deps.updateEventJson
 * @param {(args: object) => Promise<object>} deps.checkLocks
 * @param {(args: object) => Promise<object>} deps.clearSelfStaleLock
 * @param {() => Promise<object>} deps.archiveStatus
 * @param {(args: object) => Promise<object>} deps.appendSyncJob
 * @param {() => object|null} deps.activeUser
 * @param {(p: string) => Promise<boolean>} deps.dirExists
 * @param {(p: string) => Promise<number|null>} deps.statSize
 * @param {(kind: string, fn: Function) => Function} [deps.track]   operatorActivity.wrap
 * @param {() => void} deps.onChange
 * @param {(msg: string) => void} [deps.log]
 */
function createCompanionImportService(deps) {
  const log = deps.log || (() => {});
  const track = deps.track || ((kind, fn) => fn);
  /** sourceId → operation (kept after it ends, so a reopened popup still shows the outcome) */
  const _ops = new Map();
  let _running = null;
  let _pushTimer = null;
  const _lfPending = new Map();     // metadata batchId → pending Local First manifest
  const _metaEarly = new Map();     // batchId → terminal outcome that arrived before the commit returned

  function _push() {
    if (_pushTimer) return;
    _pushTimer = setTimeout(() => { _pushTimer = null; try { deps.onChange(); } catch { /* observer */ } }, PUSH_MS);
  }

  /** Path-free view of one card's latest companion import. */
  function view(sourceId) {
    const op = _ops.get(sourceId);
    if (!op) return null;
    const copying = op.stage === 'copying';
    const stats = op.tracker.view(copying);
    return {
      id: op.id, kind: op.kind, state: op.state, stage: op.stage, reason: op.reason, detail: op.detail,
      mode: op.mode, decision: op.decision ? { ...op.decision, folders: [...op.decision.folders] } : null,
      startedAt: op.startedAt, finishedAt: op.finishedAt, current: op.current,
      totals: { totalBytes: stats.totalBytes, transferredBytes: stats.transferredBytes, processedBytes: stats.processedBytes,
        copiedBytes: stats.copiedBytes, skippedBytes: stats.skippedBytes, failedBytes: stats.failedBytes, files: stats.files },
      speedBps: stats.speedBps, etaSec: stats.etaSec, calculating: stats.calculating, stalled: stats.stalled,
      // The established Event Dump result shape (EQI-1 views and tests), from the same verified totals.
      result: { requested: stats.files.total, copied: stats.files.copied, skipped: stats.files.skipped, errors: stats.files.failed, importMode: op.mode },
      metadata: op.kind === 'single' && op.events[0] ? (op.events[0].metadata ? { ...op.events[0].metadata } : null) : null,
      events: op.events.map((e, i) => ({
        eventId: e.eventId, photographer: e.photographer, status: e.status, error: e.error,
        bytes: stats.events[i], metadata: e.metadata ? { ...e.metadata } : null, sync: e.sync,
      })),
    };
  }

  const isRunning = () => !!_running;
  const runningSourceId = () => (_running ? _running.sourceId : null);

  /** The operator's answer to a pending decision (popup). */
  function decide(sourceId, choice) {
    const op = _ops.get(sourceId);
    if (!op || !op.decision || typeof op._resolveDecision !== 'function') return { ok: false, reason: 'no-decision' };
    const allowed = op.decision.sameDevice ? ['recheck', 'clear', 'cancel'] : ['recheck', 'cancel'];
    if (!allowed.includes(choice)) return { ok: false, reason: 'invalid' };
    const r = op._resolveDecision; op._resolveDecision = null;
    r(choice);
    return { ok: true };
  }

  function _waitDecision(op, decision) {
    op.decision = decision;
    op.stage = 'waiting-decision';
    _push();
    return new Promise((resolve) => { op._resolveDecision = (c) => { op.decision = null; resolve(c); }; });
  }

  /**
   * Imports a plan: one batch per (event, photographer). Resolves once the import is FINISHED
   * (every transaction and metadata batch), with the terminal state.
   * @param {{ sourceId: string, kind: 'single'|'multi', source: {label:string,path:string},
   *           localFirstEvent: boolean, collectionName: string,
   *           batches: Array<{ eventId: string, eventPath: string, photographer: string, files: Array<{path:string,size:number}> }> }} plan
   */
  async function run(plan) {
    if (_running) return { state: 'refused', reason: 'busy' };
    const op = {
      id: `ci-${Date.now().toString(36)}`, kind: plan.kind, sourceId: plan.sourceId, state: 'pending', stage: 'preparing',
      reason: null, detail: null, mode: null, decision: null, startedAt: Date.now(), finishedAt: null, current: -1,
      tracker: createTransferTracker({ statSize: deps.statSize }),
      events: plan.batches.map(b => ({ eventId: b.eventId, photographer: b.photographer, status: 'waiting', error: null, metadata: null, batchId: null, sync: null })),
    };
    const sizeBySrc = new Map();
    for (const b of plan.batches) {
      op.tracker.addEvent({ totalBytes: b.files.reduce((n, f) => n + (Number(f.size) || 0), 0), totalFiles: b.files.length });
      for (const f of b.files) sizeBySrc.set(f.path, Number(f.size) || 0);
    }
    _ops.set(plan.sourceId, op);
    _running = op;
    _push();
    let sampler = null;
    const finish = (state, reason = null, detail = null) => {
      op.state = state; op.reason = reason; op.detail = detail; op.finishedAt = Date.now();
      if (state === 'refused' || state === 'failed') op.stage = state;
      if (sampler) { clearInterval(sampler); sampler = null; }
      if (_running === op) _running = null;
      _push();
      return { state, reason };
    };
    try {
      return await track('import', () => _run(plan, op, sizeBySrc, finish, (s) => { sampler = s; }))();
    } catch (err) {
      log(`[companion-import] failed: ${(err && (err.code || err.name)) || 'error'}`);   // never the message: it can carry paths
      return finish('failed', 'error', ImportSessionRunner.cleanMessage(err).slice(0, 200));
    }
  }

  async function _run(plan, op, sizeBySrc, finish, setSampler) {
    // ── pre-flight (same rules as the workspace's Event Dump import) ──
    for (const b of plan.batches) {
      if (!SAFE_NAME(b.eventId) || path.basename(b.eventPath) !== b.eventId) return finish('refused', 'invalid');
      if (typeof b.photographer !== 'string' || !b.photographer.trim() || b.photographer !== b.photographer.trim()) return finish('refused', 'no-photographer');
      if (!b.files.length) return finish('refused', 'nothing-selected');
    }
    let archSt = {};
    try { archSt = (await deps.archiveStatus()) || {}; } catch { archSt = {}; }
    const importMode = plan.localFirstEvent ? 'local-first' : (archSt.defaultImportMode || 'direct-nas');
    op.mode = importMode;
    if (importMode === 'local-first' && !archSt.localStagingRoot) return finish('refused', 'staging-not-configured');
    if (importMode === 'direct-nas' && (archSt.status === 'nas-disconnected' || archSt.status === 'invalid-nas')) return finish('refused', 'archive-offline');

    // every destination read from its OWN event.json, right now
    const items = [];
    for (const b of plan.batches) {
      let json = null;
      try { json = await deps.readEventJson(b.eventPath); } catch { json = null; }
      const comps = componentsFromEventJson(json);
      if (!comps) return finish('refused', 'event-unreadable', b.eventId);
      const collectionPath = path.dirname(b.eventPath);
      const routing = { coll: { name: plan.collectionName || path.basename(collectionPath) }, event: { name: b.eventId, components: comps }, collectionPath, eventPath: b.eventPath };
      const files = b.files.map(f => f.path);
      const { fileJobs } = ImportRouter.buildDumpFileJobs({ eventData: routing, photographer: b.photographer, files });
      if (fileJobs.length !== files.length) return finish('refused', 'routing-failed');
      const isMulti = comps.length > 1;
      items.push({
        eventKey: `${b.eventPath}\u0000${b.photographer}`, ordinal: items.length + 1, name: b.eventId,
        eventPath: b.eventPath, collectionPath, routingEventData: routing, fileJobs, photographer: b.photographer,
        // Dump media belongs to no component yet (as the workspace's Event Dump import).
        group: { id: isMulti ? -1 : 0, subEventId: null, metadataTags: isMulti ? [] : null, files: [...files], fileTagRefinements: null },
      });
    }

    // busy archive folder: the operator decides in the companion (never cleared automatically)
    if (importMode === 'direct-nas' && archSt.nasRoot) {
      for (;;) {
        const lc = await deps.checkLocks({ fileJobs: items.flatMap(i => i.fileJobs) });
        const blocked = (lc && lc.blocked) || [];
        if (!blocked.length) break;
        const sameDevice = !!lc.currentDeviceName && blocked.every(x => x.lockedBy === lc.currentDeviceName);
        const choice = await _waitDecision(op, {
          kind: 'archive-busy', sameDevice, device: sameDevice ? lc.currentDeviceName : (blocked[0].lockedBy || null),
          folders: [...new Set(blocked.map(x => x.photographerFolderName).filter(Boolean))].slice(0, 12),
        });
        if (choice === 'cancel') return finish('refused', 'archive-busy');
        if (choice === 'clear' && sameDevice) {
          const failures = [];
          for (const x of blocked) {
            if (!x.lockPath) continue;
            try { const r = await deps.clearSelfStaleLock({ lockPath: x.lockPath, force: true }); if (!r || !r.ok) failures.push(r && r.reason); }
            catch { failures.push('unexpected-error'); }
          }
          if (failures.length) { op.detail = failures[0] === 'may-still-active' ? 'lock-still-active' : 'lock-not-cleared'; }
        }
        op.stage = 'preparing';
      }
    }

    // ── run: the existing per-event runner over the existing transaction ──
    const sourceMeta = { type: 'memory-card', label: (plan.source && plan.source.label) || 'Memory card', path: (plan.source && plan.source.path) || '' };
    const user = deps.activeUser ? deps.activeUser() : null;
    const importedBy = user && user.id ? { id: user.id, name: user.name } : null;
    const stagingNorm = (archSt.localStagingRoot || '').replace(/\\/g, '/').replace(/\/$/, '');
    setSampler(setInterval(() => { op.tracker.sample().then(_push, () => {}); }, SAMPLE_MS));
    const indexOf = (it) => items.indexOf(it);
    const result = await ImportSessionRunner.run({ events: items, hasBlocking: false }, {
      shouldStop: async () => (sourceMeta.path && !(await deps.dirExists(sourceMeta.path)) ? 'source-disconnected' : null),
      isSourceAlive: async () => (sourceMeta.path ? !!(await deps.dirExists(sourceMeta.path)) : true),
      prepareEvent: (it) => _prepareEvent(it, importMode, archSt),
      markInProgress: async (it, prepared) => { await deps.updateEventJson(prepared.txEventPath, { status: 'in-progress' }); },
      onEventFailed: async (it, prepared) => { if (prepared) await deps.updateEventJson(prepared.txEventPath, { status: 'created' }); },
      onEventStart: (it) => {
        const i = indexOf(it);
        op.current = i; op.stage = 'copying';
        op.events[i].status = 'copying';
        op.tracker.setCurrent(i);
        _push();
      },
      onEventEnd: (e) => {
        const i = items.findIndex(it => it.eventKey === e.eventKey);
        const ev = op.events[i];
        if (!ev) return;
        if (e.summary) op.tracker.reconcile(i, e.summary, sizeBySrc); else op.tracker.abandon(i);
        // completed / completed-with-errors / failed / not-started; metadata is shown beside it.
        ev.status = e.status;
        ev.error = e.error ? String(e.error).slice(0, 200) : (e.status === 'not-started' ? (e.reason || 'not-started') : null);
        _push();
      },
      commit: async (it, prepared, ctx) => {
        const i = indexOf(it);
        const ed = it.routingEventData;
        const archiveEventPath = importMode === 'local-first' && stagingNorm
          && !it.eventPath.replace(/\\/g, '/').startsWith(stagingNorm + '/') ? it.eventPath : null;
        const hooks = {
          onProgress: (p) => op.tracker.onFile(p),
          onCopyStart: (c) => op.tracker.onCopyStart(c),
          onCopyEnd: (c) => op.tracker.onCopyEnd(c),
          onMetadata: (p) => _onMetadata(op, i, p),
        };
        const summary = await deps.commit({
          fileJobs: prepared.txFileJobs, eventJsonPath: prepared.txEventPath,
          collName: ed.coll && ed.coll.name, photographer: it.photographer, subEventNames: [], liveComps: ed.event.components,
          groups: [it.group], source: sourceMeta, importedBy, importMode, destination: 'dump',
          ...(items.length > 1 ? { progressEventPath: it.eventPath, importSessionId: ctx.importSessionId } : {}),
          ...(archiveEventPath ? { archiveEventPath } : {}),
        }, hooks);
        const ev = op.events[i];
        ev.batchId = summary && summary.metadataBatchId ? summary.metadataBatchId : null;
        if (ev.batchId && !ev.metadata) ev.metadata = { state: 'writing', done: 0, total: (summary.copiedFiles || []).length, failed: 0 };
        if (ev.batchId && _metaEarly.has(ev.batchId)) { ev.metadata = _metaEarly.get(ev.batchId); _metaEarly.delete(ev.batchId); }
        if (!ev.batchId) ev.metadata = (Number(summary && summary.copied) || 0) > 0 ? { state: 'not-run' } : null;
        if (importMode === 'local-first') _registerLocalFirst(op, i, it, prepared, summary);
        op.stage = 'finalizing';
        _push();
        return summary;
      },
    });
    op.current = -1;
    op.stage = 'metadata';
    _push();

    // finished only when every committed event's metadata batch has finished too
    await _waitMetadata(op);
    const statuses = result.events.map(e => e.status);
    op.events.forEach((ev, i) => { ev.status = (result.events.find(x => x.eventKey === items[i].eventKey) || { status: 'not-started' }).status; });
    // Never "completed" unless metadata is confirmed: a failed or unconfirmed batch is an issue to review.
    const metaFailed = op.events.some(ev => ev.metadata && (ev.metadata.state === 'some-failed' || ev.metadata.state === 'unconfirmed'));
    const state = result.status === 'aborted' ? (statuses.some(s => s === 'completed' || s === 'completed-with-errors') ? 'partial' : 'failed')
      : statuses.every(s => s === 'completed') ? (metaFailed ? 'completed-with-errors' : 'completed')
      : statuses.every(s => s === 'completed' || s === 'completed-with-errors') ? 'completed-with-errors'
      : statuses.some(s => s === 'completed' || s === 'completed-with-errors') ? 'partial' : 'failed';
    op.stage = 'done';
    log(`[companion-import] ${state}: ${statuses.join(',')}`);
    return finish(state, result.fatal || null);
  }

  /** Local First mirror + destination remap — the workspace's _sessPrepareEvent rule. */
  async function _prepareEvent(item, importMode, archSt) {
    const norm = (p) => (p || '').replace(/\\/g, '/').replace(/\/$/, '');
    if (importMode !== 'local-first') return { ok: true, prepared: { txEventPath: item.eventPath, txFileJobs: item.fileJobs } };
    const normColl = norm(item.collectionPath);
    const normStaging = norm(archSt.localStagingRoot);
    const collectionName = normColl.split('/').filter(Boolean).pop() || '';
    const mirror = await deps.ensureLocalMirror({
      collectionName, eventName: item.routingEventData.event.name || '', eventPath: item.eventPath, eventJsonPath: `${norm(item.eventPath)}/event.json`,
    });
    if (!mirror || !mirror.ok) return { ok: false, error: `Local staging setup failed: ${(mirror && mirror.reason) || 'unknown error'}` };
    const txFileJobs = item.fileJobs.map(job => {
      const nd = job.dest.replace(/\\/g, '/');
      return nd.startsWith(normColl + '/') ? { ...job, dest: `${normStaging}/${collectionName}${nd.slice(normColl.length)}` } : job;
    });
    return { ok: true, prepared: { txEventPath: mirror.localEventPath, txFileJobs } };
  }

  /** One pending sync job per event — the workspace's _sessRegisterLocalFirst / _writeLocalFirstManifest. */
  function _registerLocalFirst(op, i, item, prepared, summary) {
    const norm = (p) => (p || '').replace(/\\/g, '/').replace(/\/$/, '');
    const collectionName = norm(item.collectionPath).split('/').filter(Boolean).pop() || '';
    const prefix = `${norm(prepared.txEventPath)}/`;
    const relFiles = (summary.copiedFiles || []).map(cf => { const d = (cf.dest || '').replace(/\\/g, '/'); return d.startsWith(prefix) ? d.slice(prefix.length) : null; }).filter(Boolean);
    const importedAt = Date.now();
    const manifest = {
      importId: summary.metadataBatchId || importedAt.toString(36), batchId: summary.metadataBatchId || null,
      eventName: item.routingEventData.event.name || '', collectionName, photographer: item.photographer || '',
      fileCount: summary.copied || 0, files: relFiles.length ? relFiles : null, importedAt, localEventPath: prepared.txEventPath,
    };
    const ev = op.events[i];
    if (!manifest.fileCount) return;   // nothing new staged → nothing to sync (as the workspace)
    if (summary.metadataBatchId) {
      const early = ev.metadata && ev.metadata.state !== 'writing' ? ev.metadata : null;
      if (early) _appendSync(op, i, manifest, early); else _lfPending.set(summary.metadataBatchId, { op, i, manifest });
    } else {
      _appendSyncRaw(op, i, manifest, { metadataStatus: 'skipped-disabled', readyForSync: false, needsAttention: true, reason: 'auto-metadata-disabled' });
    }
  }

  function _appendSync(op, i, manifest, outcome) {
    const failed = outcome.state === 'some-failed';
    _appendSyncRaw(op, i, manifest, { metadataStatus: failed ? 'failed' : 'complete', readyForSync: true, needsAttention: failed || outcome.state === 'needs-review' });
  }

  function _appendSyncRaw(op, i, manifest, extra) {
    const job = { importId: manifest.importId, batchId: manifest.batchId, eventName: manifest.eventName, collectionName: manifest.collectionName,
      photographer: manifest.photographer, fileCount: manifest.fileCount, files: manifest.files, importedAt: manifest.importedAt, ...extra };
    op.events[i].sync = 'queuing';
    Promise.resolve(deps.appendSyncJob({ localEventPath: manifest.localEventPath, job }))
      .then((r) => { op.events[i].sync = r && r.ok === false ? 'failed' : (extra.readyForSync ? 'queued' : 'needs-attention'); _push(); },
            () => { op.events[i].sync = 'failed'; _push(); });
  }

  function _onMetadata(op, i, p) {
    if (!p || !p.batchId) return;
    const ev = op.events[i];
    if (p.event === 'file_done' && ev && ev.metadata && ev.metadata.state === 'writing') {
      ev.metadata = { ...ev.metadata, done: Number(p.done) || 0, failed: Number(p.failed) || 0, total: Number(p.total) || ev.metadata.total };
      if (op._metaWaiter) op._metaWaiter();
      _push();
      return;
    }
    if (p.event !== 'batch_complete') return;
    const failed = Number(p.failed) || 0;
    const partial = (Number(p.partial) || 0) + (Number(p.ambiguous) || 0);
    const outcome = { state: failed > 0 ? 'some-failed' : partial > 0 ? 'needs-review' : 'complete', done: Number(p.done) || 0, failed, total: Number(p.total) || 0 };
    if (ev && ev.batchId === p.batchId) ev.metadata = outcome; else _metaEarly.set(p.batchId, outcome);
    const pend = _lfPending.get(p.batchId);
    if (pend) { _lfPending.delete(p.batchId); _appendSync(pend.op, pend.i, pend.manifest, outcome); }
    if (op._metaWaiter) op._metaWaiter();
    _push();
  }

  /**
   * Waits for every committed event's metadata batch. A batch that stops reporting for
   * META_SILENCE_MS is marked "unconfirmed" (it may still finish in the background — Metadata Audit
   * shows the truth), so a silent batch can never keep the companion busy forever.
   */
  function _waitMetadata(op) {
    const pending = () => op.events.some(ev => ev.metadata && ev.metadata.state === 'writing');
    if (!pending()) return Promise.resolve();
    return new Promise((resolve) => {
      let last = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - last < META_SILENCE_MS) return;
        for (const ev of op.events) if (ev.metadata && ev.metadata.state === 'writing') ev.metadata = { ...ev.metadata, state: 'unconfirmed' };
        log('[companion-import] a metadata batch stopped reporting — marked unconfirmed');
        op._metaWaiter();
      }, 5000);
      op._metaWaiter = () => {
        last = Date.now();
        if (!pending()) { clearInterval(watchdog); op._metaWaiter = null; resolve(); }
      };
    });
  }

  function forget(sourceId) { if (!_running || _running.sourceId !== sourceId) _ops.delete(sourceId); }

  return { run, view, decide, isRunning, runningSourceId, forget };
}

module.exports = { createCompanionImportService };
