/**
 * learningStateStore.js — durable, cross-process-safe state for photographer↔camera learning
 * (AI-FEAT-063, AI-RM-014 Q4d). Main process; Electron-free (fs injected).
 *
 * Files under <userData>/identity-registry/learning/ :
 *   learning-journal.json   last N learning outcomes, one entry per import (status, reason,
 *                           counts) — never names, paths, serials, digests or keys
 *   learning-pending.json   committed imports whose learning has not finished yet (Q4d
 *                           recovery). Internal state: holds photographer names and committed
 *                           archive paths, so it is never logged or sent to a renderer
 *   state.lock              short-lived writer lock (pid + token + time)
 *
 * Why a separate lock (not the registry lock): the registry lock is held for a whole process
 * lifetime, so a second AutoIngest sharing the profile could never record that its import is
 * pending. This lock is held only for one read-modify-write (milliseconds) and is never held
 * while waiting for the registry, so the two cannot deadlock.
 *
 * Every update: take the lock → remove temp files left by a writer that crashed (no live
 * writer can own one while we hold the lock) → read both documents → apply the mutator →
 * atomic temp+fsync+rename of whatever changed → release. A crash leaves the previous
 * document intact. A lock whose owner process is gone, or that is older than STALE_MS, is
 * taken over by renaming it away (only one process can win that rename).
 *
 * The files live in their own folder so the registry store's temp quarantine (which runs
 * without this lock when it opens) can never move one of our in-flight writes.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');
const { atomicWriteFile, readIfExists, stamp, TMP_MARK } = require('./identityFileOps');

const STATE_DIR = 'learning';
const JOURNAL_FILE = 'learning-journal.json';
const PENDING_FILE = 'learning-pending.json';
const LOCK_FILE = 'state.lock';
const JOURNAL_FORMAT = 'autoingest-learning-journal';
const PENDING_FORMAT = 'autoingest-learning-pending';
const STALE_MS = 30000;
// Longer than STALE_MS: even a lock that only LOOKS alive (its dead owner's pid reused by another
// process) is taken over by age before a writer gives up, so an update is never silently lost.
const LOCK_TIMEOUT_MS = STALE_MS + 5000;

const _defaultPidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * @param {{ dir: string, fs?: typeof import('fs').promises, now?: () => Date,
 *           isPidAlive?: (pid: number) => boolean, staleMs?: number, lockTimeoutMs?: number,
 *           quarantineDir?: string }} opts
 *   dir — the identity-registry folder; state lives in <dir>/learning
 */
function createLearningStateStore(opts) {
  const { dir, fs: fsx = require('fs').promises, now = () => new Date(), isPidAlive = _defaultPidAlive,
    staleMs = STALE_MS, lockTimeoutMs = staleMs + (LOCK_TIMEOUT_MS - STALE_MS) } = opts;
  const stateDir = path.join(dir, STATE_DIR);
  const quarantineDir = opts.quarantineDir || path.join(dir, 'quarantine');
  const files = { journal: path.join(stateDir, JOURNAL_FILE), pending: path.join(stateDir, PENDING_FILE), lock: path.join(stateDir, LOCK_FILE) };
  let queue = Promise.resolve();
  let heldToken = null;
  const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

  async function _readLock() {
    try { return JSON.parse((await fsx.readFile(files.lock)).toString('utf8')); } catch { return null; }
  }

  async function _acquire() {
    const token = crypto.randomBytes(8).toString('hex');
    const t0 = Date.now();
    for (let wait = 10; ; wait = Math.min(wait * 2, 200)) {
      try {
        const fh = await fsx.open(files.lock, 'wx', 0o600);
        try { await fh.writeFile(JSON.stringify({ pid: process.pid, token, at: now().toISOString() })); } finally { await fh.close(); }
        return token;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
      const held = await _readLock();
      let stale;
      if (held && Number.isInteger(held.pid)) {
        const age = now().getTime() - Date.parse(held.at);
        stale = !isPidAlive(held.pid) || !(age < staleMs);
      } else {
        // Empty or unreadable: possibly a lock another process created a moment ago and has
        // not written yet. Only its age can tell.
        const st = await fsx.stat(files.lock).catch(() => null);
        if (!st) continue;
        stale = !(now().getTime() - st.mtimeMs < staleMs);
      }
      if (stale) {
        // Rename the stale lock away: exactly one contender wins. If what we renamed turns out
        // to be a different, fresh lock (another process took over first), put it back
        // without clobbering anything.
        const aside = path.join(stateDir, `stale-lock-${crypto.randomBytes(4).toString('hex')}`);
        try {
          await fsx.rename(files.lock, aside);
          let moved = null;
          try { moved = JSON.parse((await fsx.readFile(aside)).toString('utf8')); } catch { /* unreadable = the stale one */ }
          if (moved && (!held || moved.token !== held.token)) await fsx.link(aside, files.lock).catch(() => {});
          await fsx.unlink(aside).catch(() => {});
        } catch { /* someone else moved it first */ }
        continue;
      }
      if (Date.now() - t0 > lockTimeoutMs) { const e = new Error('learning state is locked'); e.code = 'ELOCKED'; throw e; }
      await _sleep(wait);
    }
  }

  async function _release(token) {
    const held = await _readLock();
    if (held && held.token === token) await fsx.unlink(files.lock).catch(() => {});
  }

  async function _removeCrashedTemps() {
    let names = [];
    try { names = await fsx.readdir(stateDir); } catch { return; }
    for (const n of names) if (n.includes(TMP_MARK)) await fsx.unlink(path.join(stateDir, n)).catch(() => {});
  }

  async function _readDoc(file, format, listKey) {
    const empty = { format, version: 1, [listKey]: [] };
    const buf = await readIfExists(fsx, file);
    if (buf === null) return { doc: empty, text: null };
    try {
      const p = JSON.parse(buf.toString('utf8'));
      if (p && p.format === format && Array.isArray(p[listKey])) return { doc: p, text: buf.toString('utf8') };
    } catch { /* damaged */ }
    // Damaged: keep a copy for investigation, then start over (the previous good version was
    // never partially overwritten — writes are atomic — so this only follows outside damage).
    await fsx.mkdir(quarantineDir, { recursive: true, mode: 0o700 }).catch(() => {});
    await fsx.copyFile(file, path.join(quarantineDir, `${path.basename(file, '.json')}-damaged-${stamp(now())}-${crypto.randomBytes(4).toString('hex')}.json`)).catch(() => {});
    return { doc: empty, text: '' };
  }

  /**
   * Serialized, locked read-modify-write of both documents.
   * @param {(state: { journal: object[], pending: object[] }) => ({ journal?: object[], pending?: object[], result?: any } | void)} mutator
   *   receives copies; returns the new lists (omit a list to leave it unchanged)
   * @returns {Promise<any>} the mutator's `result`
   */
  function update(mutator) {
    return serial(async () => {
      await fsx.mkdir(stateDir, { recursive: true, mode: 0o700 });
      const token = await _acquire();
      heldToken = token;
      try {
        await _removeCrashedTemps();
        const j = await _readDoc(files.journal, JOURNAL_FORMAT, 'entries');
        const p = await _readDoc(files.pending, PENDING_FORMAT, 'items');
        const out = mutator({ journal: j.doc.entries.map(e => ({ ...e })), pending: p.doc.items.map(i => ({ ...i })) }) || {};
        if (out.journal) {
          const text = `${JSON.stringify({ ...j.doc, entries: out.journal }, null, 2)}\n`;
          if (text !== j.text) await atomicWriteFile(fsx, files.journal, text);
        }
        if (out.pending) {
          const text = `${JSON.stringify({ ...p.doc, items: out.pending }, null, 2)}\n`;
          if (text !== p.text) await atomicWriteFile(fsx, files.pending, text);
        }
        return out.result;
      } finally {
        await _release(token);
        heldToken = null;
      }
    });
  }

  /** Lock-free snapshot (diagnostics, scheduling). Never throws. */
  async function read() {
    const parse = async (file, key) => { try { const b = await readIfExists(fsx, file); const d = b && JSON.parse(b.toString('utf8')); return d && Array.isArray(d[key]) ? d[key] : []; } catch { return []; } };
    return { journal: await parse(files.journal, 'entries'), pending: await parse(files.pending, 'items') };
  }

  /** will-quit: the process cannot await — drop our lock if an update is still in flight. */
  function releaseSync() {
    if (!heldToken) return;
    try {
      const fsSync = require('fs');
      const held = JSON.parse(fsSync.readFileSync(files.lock, 'utf8'));
      if (held.token === heldToken) fsSync.unlinkSync(files.lock);
    } catch { /* already gone */ }
    heldToken = null;
  }

  return { update, read, releaseSync, files, stateDir };
}

module.exports = { createLearningStateStore, STATE_DIR, JOURNAL_FILE, PENDING_FILE, STALE_MS };
