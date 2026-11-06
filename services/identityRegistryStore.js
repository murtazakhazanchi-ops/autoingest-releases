/**
 * identityRegistryStore.js — the persistent Photographer & Camera Identity Registry
 * (AI-FEAT-063, AI-RM-014 Q4b). Main process only; NOT wired into startup, IPC or the
 * import pipeline in Q4b (that is Q4c and needs separate approval).
 *
 * Files under <userData>/identity-registry/ :
 *   registry.json     versioned document holding the append-only event log (Q4a schema)
 *   keys.json         encrypted HMAC keys (identityKeyStore.js) — never plaintext
 *   registry.lock     single-writer lock (pid + random token)
 *   backups/          copy of the previous registry.json before every write (last N kept)
 *   quarantine/       corrupt registries, interrupted temp files, pre-recovery copies —
 *                     preserved for investigation, never deleted by the app
 *
 * Guarantees:
 *  - Never throws from open(): any failure disables learning with a reason, so AutoIngest
 *    launches and imports exactly as before.
 *  - Writes are serialized in-process (promise queue) and across processes (lock file);
 *    each write is backup → atomic temp+fsync+rename; memory changes only after success.
 *  - A registry changed on disk by someone else since it was loaded is not overwritten.
 *  - Events are immutable and inserted idempotently: same eventId + same content is a
 *    duplicate; same eventId + different content is an integrity conflict — the local event
 *    stays, the other copy is held for review and never used.
 *  - Unknown future event types already in the file are preserved verbatim on rewrite.
 *  - A corrupt or unreadable registry is copied to quarantine, left in place and learning is
 *    disabled. Recovery from a backup is an explicit call; it quarantines the current file
 *    first, so no evidence is overwritten.
 *  - Keys: generated only when a brand-new registry is initialised. A key the registry
 *    depends on that is missing / damaged / undecryptable disables body matching; it is
 *    never silently replaced.
 *  - Status and errors carry no identifiers, digests or keys.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');
const { validateEvent, canonicalJson, createEvent } = require('./identityEvents');
const { deriveRegistryState } = require('./associationModel');
const { createIdentityKeyStore } = require('./identityKeyStore');
const { atomicWriteFile, readIfExists, stamp, TMP_MARK } = require('./identityFileOps');
const P = require('./photographerIdentity');
const { resolveOfficialName } = require('./photographerNameModel');
const { KEY_ID_RE } = require('./identityKeyring');

const REGISTRY_FILE = 'registry.json';
const LOCK_FILE = 'registry.lock';
const BACKUP_DIR = 'backups';
const QUARANTINE_DIR = 'quarantine';
const FORMAT = 'autoingest-identity-registry';
const SCHEMA_VERSION = 1;
const DEFAULT_BACKUP_RETENTION = 10;
const BACKUP_RE = /^registry-\d{8}T\d{9}Z-[0-9a-f]{8}\.json$/;
const TOP_KEYS = ['format', 'schemaVersion', 'registryId', 'createdAt', 'createdBy', 'keyIds', 'events', 'held'];
/** Upgrades from an older schemaVersion n to n+1. v1 is the first version: none yet. */
const MIGRATIONS = Object.freeze({});

/**
 * @returns {{ ok: boolean, unsupportedVersion: boolean, needsMigration: boolean, errors: string[] }}
 */
function validateRegistryDocument(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, unsupportedVersion: false, needsMigration: false, errors: ['not an object'] };
  if (doc.format !== FORMAT) errors.push('wrong format');
  if (!Number.isInteger(doc.schemaVersion) || doc.schemaVersion < 1) errors.push('schemaVersion invalid');
  else if (doc.schemaVersion > SCHEMA_VERSION) return { ok: false, unsupportedVersion: true, needsMigration: false, errors: [`schemaVersion ${doc.schemaVersion} is newer than supported ${SCHEMA_VERSION}`] };
  else if (doc.schemaVersion < SCHEMA_VERSION) return { ok: false, unsupportedVersion: false, needsMigration: true, errors: [`schemaVersion ${doc.schemaVersion} needs migration`] };
  const extra = Object.keys(doc).filter(k => !TOP_KEYS.includes(k));
  if (extra.length) errors.push(`unexpected field(s) ${extra.join(', ')}`);
  if (!P.isUuid(doc.registryId)) errors.push('registryId must be a UUID');
  if (typeof doc.createdAt !== 'string' || Number.isNaN(Date.parse(doc.createdAt))) errors.push('createdAt invalid');
  if (!doc.createdBy || typeof doc.createdBy !== 'object' || typeof doc.createdBy.computerId !== 'string' || Object.keys(doc.createdBy).length !== 1) errors.push('createdBy invalid');
  if (!Array.isArray(doc.keyIds) || !doc.keyIds.every(k => KEY_ID_RE.test(k)) || new Set(doc.keyIds).size !== doc.keyIds.length) errors.push('keyIds invalid');
  if (!Array.isArray(doc.events)) errors.push('events must be an array');
  if (!Array.isArray(doc.held)) errors.push('held must be an array');
  if (errors.length) return { ok: false, unsupportedVersion: false, needsMigration: false, errors };
  const keyIds = new Set(doc.keyIds);
  const ids = new Set();
  doc.events.forEach((e, i) => {
    const res = validateEvent(e);
    if (!res.ok) { errors.push(`event ${i}: ${res.errors.join('; ')}`); return; }
    if (ids.has(e.eventId)) errors.push(`event ${i}: duplicate eventId`);
    ids.add(e.eventId);
    for (const idf of e.identifiers || []) if (!keyIds.has(idf.keyId)) errors.push(`event ${i}: identifier keyId not in registry keyIds`);
  });
  doc.held.forEach((h, i) => {
    if (!h || h.reason !== 'event-id-collision' || typeof h.detectedAt !== 'string' || !validateEvent(h.event).ok || Object.keys(h).length !== 3) errors.push(`held ${i} invalid`);
  });
  return { ok: errors.length === 0, unsupportedVersion: false, needsMigration: false, errors };
}

const _defaultPidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

/**
 * @param {{ dir: string, secureStorage: object, computerId: string, fs?: typeof import('fs').promises,
 *           now?: () => Date, randomUUID?: () => string, randomBytes?: (n: number) => Buffer,
 *           isPidAlive?: (pid: number) => boolean, backupRetention?: number }} opts
 */
function createIdentityRegistryStore(opts) {
  const {
    dir, secureStorage, computerId, fs: fsx = require('fs').promises, now = () => new Date(),
    randomUUID = crypto.randomUUID, randomBytes = crypto.randomBytes, isPidAlive = _defaultPidAlive,
    backupRetention = DEFAULT_BACKUP_RETENTION,
  } = opts;
  const registryFile = path.join(dir, REGISTRY_FILE);
  const lockFile = path.join(dir, LOCK_FILE);
  const backupDir = path.join(dir, BACKUP_DIR);
  const quarantineDir = path.join(dir, QUARANTINE_DIR);
  const keyStore = createIdentityKeyStore({ dir, secureStorage, fs: fsx, now, randomBytes });

  let state = 'closed', reason = null;
  let doc = null, lastSerialized = null, keyring = null, keyReason = 'not-loaded';
  let lockToken = null;
  let queue = Promise.resolve();
  const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };
  const disable = (why) => { state = 'disabled'; reason = why; keyring = null; return getStatus(); };
  const errCode = (err) => (err && err.code) || 'error';
  const serialize = (d) => `${JSON.stringify(d, null, 2)}\n`;

  async function _acquireLock() {
    const token = randomBytes(8).toString('hex');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fh = await fsx.open(lockFile, 'wx', 0o600);
        try { await fh.writeFile(JSON.stringify({ pid: process.pid, token, at: now().toISOString() })); } finally { await fh.close(); }
        lockToken = token;
        return true;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        let held = null;
        try { held = JSON.parse((await fsx.readFile(lockFile)).toString('utf8')); } catch { held = null; }
        if (held && Number.isInteger(held.pid) && isPidAlive(held.pid)) return false;
        // Stale lock from a crashed process: keep a copy for investigation, then take over.
        await fsx.rename(lockFile, path.join(quarantineDir, `stale-lock-${stamp(now())}-${randomBytes(4).toString('hex')}.json`)).catch(() => fsx.unlink(lockFile).catch(() => {}));
      }
    }
    return false;
  }

  async function _releaseLock() {
    if (!lockToken) return;
    try {
      const held = JSON.parse((await fsx.readFile(lockFile)).toString('utf8'));
      if (held.token === lockToken) await fsx.unlink(lockFile);
    } catch { /* already gone */ }
    lockToken = null;
  }

  async function _quarantineInterruptedTemps() {
    for (const name of await fsx.readdir(dir)) {
      if (!name.includes(TMP_MARK)) continue;
      await fsx.rename(path.join(dir, name), path.join(quarantineDir, `interrupted-${stamp(now())}-${name}`)).catch(() => {});
    }
  }

  async function _quarantineCopy(label) {
    const target = path.join(quarantineDir, `${label}-${stamp(now())}-${randomBytes(4).toString('hex')}.json`);
    await fsx.copyFile(registryFile, target);
    return path.basename(target);
  }

  async function _backupNames() {
    try { return (await fsx.readdir(backupDir)).filter(n => BACKUP_RE.test(n)).sort(); }
    catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  }

  async function _loadKeys() {
    try { ({ keyring, reason: keyReason } = await keyStore.load(doc.registryId, doc.keyIds)); }
    catch (err) { keyring = null; keyReason = `key-load-failed:${errCode(err)}`; }
  }

  async function _initialize() {
    const orphan = await keyStore.existingRegistryId().catch(() => null);
    const registryId = orphan ? orphan.registryId : randomUUID();
    let keyIds = orphan ? orphan.keyIds : [];
    if (!keyIds.length) {
      const g = await keyStore.generateInitialKey(registryId);
      if (g.keyId) keyIds = [g.keyId];
    }
    const fresh = { format: FORMAT, schemaVersion: SCHEMA_VERSION, registryId, createdAt: now().toISOString(), createdBy: { computerId }, keyIds, events: [], held: [] };
    const text = serialize(fresh);
    await atomicWriteFile(fsx, registryFile, text);
    doc = fresh; lastSerialized = text;
    await _loadKeys();
    state = 'ready'; reason = orphan ? 'initialized-with-existing-keys' : 'initialized';
  }

  /**
   * Open (or initialise) the registry. Never throws.
   * { initialize: false } (Q5d registry management) opens an EXISTING registry only: with no
   * registry file nothing is created — no folder, lock, key or file — and the store stays disabled.
   */
  function open({ initialize = true } = {}) {
    return serial(async () => {
      if (state === 'ready') return getStatus();
      try {
        if (!initialize && (await readIfExists(fsx, registryFile)) === null) return disable('registry-missing');
        await fsx.mkdir(backupDir, { recursive: true, mode: 0o700 });
        await fsx.mkdir(quarantineDir, { recursive: true, mode: 0o700 });
        if (!(await _acquireLock())) return disable('locked-by-another-process');
        await _quarantineInterruptedTemps();
        const buf = await readIfExists(fsx, registryFile);
        if (buf === null) {
          if ((await _backupNames()).length) return disable('registry-missing-backups-present');
          await _initialize();
          return getStatus();
        }
        let parsed;
        try { parsed = JSON.parse(buf.toString('utf8')); }
        catch { await _quarantineCopy('registry-corrupt'); return disable('registry-corrupt'); }
        const v = validateRegistryDocument(parsed);
        if (v.unsupportedVersion) return disable('unsupported-schema-version'); // left untouched, never rewritten
        if (v.needsMigration) {
          // No migrations exist yet (v1 is the first schema); a future one would run here,
          // after a backup, through _persist. Until then an older file is treated as damaged.
          if (!MIGRATIONS[parsed.schemaVersion]) { await _quarantineCopy('registry-unmigratable'); return disable('registry-corrupt'); }
        }
        if (!v.ok) { await _quarantineCopy('registry-invalid'); return disable('registry-corrupt'); }
        doc = parsed; lastSerialized = buf.toString('utf8');
        await _loadKeys();
        state = 'ready'; reason = null;
        return getStatus();
      } catch (err) {
        return disable(`io-error:${errCode(err)}`);
      }
    });
  }

  async function _persist(next) {
    const onDisk = await readIfExists(fsx, registryFile);
    if (onDisk === null || onDisk.toString('utf8') !== lastSerialized) {
      disable('registry-changed-externally');
      const e = new Error('registry changed on disk since it was loaded'); e.code = 'ECHANGED'; throw e;
    }
    // Backup of the current file first; if the backup cannot be written, nothing is written.
    await atomicWriteFile(fsx, path.join(backupDir, `registry-${stamp(now())}-${randomBytes(4).toString('hex')}.json`), onDisk);
    const text = serialize(next);
    await atomicWriteFile(fsx, registryFile, text);
    doc = next; lastSerialized = text;
    const names = await _backupNames().catch(() => []);
    for (const old of names.slice(0, Math.max(0, names.length - backupRetention))) await fsx.unlink(path.join(backupDir, old)).catch(() => {});
  }

  async function _append(events) {
    if (state !== 'ready') return { ok: false, reason: `registry-${state}${reason ? `:${reason}` : ''}`, added: [], duplicates: [], held: [], rejected: [] };
    const byId = new Map(doc.events.map(e => [e.eventId, canonicalJson(e)]));
    const heldKeys = new Set(doc.held.map(h => `${h.event.eventId}|${canonicalJson(h.event)}`));
    const keyIds = new Set(doc.keyIds);
    const added = [], duplicates = [], held = [], rejected = [];
    const toAdd = [], toHold = [];
    for (const e of Array.isArray(events) ? events : []) {
      const res = validateEvent(e);
      const id = e && typeof e.eventId === 'string' ? e.eventId : null;
      if (!res.ok || !res.known) { rejected.push({ eventId: id, errors: res.ok ? ['unknown event type'] : res.errors }); continue; }
      if ((e.identifiers || []).some(i => !keyIds.has(i.keyId))) { rejected.push({ eventId: id, errors: ['identifier keyId not in this registry'] }); continue; }
      const json = canonicalJson(e);
      if (byId.has(id)) {
        if (byId.get(id) === json) { duplicates.push(id); continue; }
        if (!heldKeys.has(`${id}|${json}`)) { heldKeys.add(`${id}|${json}`); toHold.push({ reason: 'event-id-collision', detectedAt: now().toISOString(), event: e }); }
        held.push(id);
        continue;
      }
      byId.set(id, json); toAdd.push(e); added.push(id);
    }
    if (!toAdd.length && !toHold.length) return { ok: true, added, duplicates, held, rejected };
    const next = { ...doc, events: [...doc.events, ...toAdd], held: [...doc.held, ...toHold] };
    try { await _persist(next); }
    catch (err) { return { ok: false, reason: `write-failed:${errCode(err)}`, added: [], duplicates, held: [], rejected }; }
    return { ok: true, added, duplicates, held, rejected };
  }

  /** Append validated events (idempotent). Memory and disk change together or not at all. */
  const appendEvents = (events) => serial(() => _append(events));

  /**
   * Stable photographer ID for a name in the existing photographer list (the only name
   * authority). The name resolves through OFFICIAL names only (photographerNameModel): current
   * and former registry names, shipped names and frozen shipped spellings — so a renamed
   * photographer, shipped or local, keeps one ID whichever of their names an import uses.
   * Search aliases and learned shortcuts are never consulted. A name that is an official name
   * of several identities is refused ('ambiguous'), except a current shipped list name, which
   * keeps Q4's shipped precedence. Only a name with no identity at all gets a new random ID.
   */
  function ensurePhotographerId(name, { listNames = [], shippedNames = [], origin, at } = {}) {
    return serial(async () => {
      if (state !== 'ready') return { ok: false, reason: `registry-${state}` };
      const n = P.normalizeName(name);
      const entry = listNames.find(x => P.normalizeName(x) === n);
      if (!n || !entry) return { ok: false, reason: 'not-in-photographer-list' };
      const shipped = P.bootstrapShippedIds(shippedNames);
      const derived = deriveRegistryState(doc.events, { shipped });
      const r = resolveOfficialName(entry, { state: derived, shipped });
      if (!r.ok) return r.reason === 'ambiguous' ? { ok: false, reason: 'ambiguous', photographerIds: r.photographerIds } : { ok: false, reason: r.reason };
      if (r.photographerId) return { ok: true, photographerId: r.photographerId, via: r.via };
      const photographerId = P.newPhotographerId(randomUUID);
      const ev = createEvent('photographer-registered', { photographerId, name: entry, idOrigin: 'random' }, { origin, at: at || now().toISOString(), newId: randomUUID });
      const res = await _append([ev]);
      return res.ok && res.added.length ? { ok: true, photographerId, via: 'new' } : { ok: false, reason: res.reason || 'not-recorded' };
    });
  }

  /**
   * Profile commands (Q5b, not wired to IPC): `build(events)` runs INSIDE the write queue against
   * the registry exactly as it is now, so a revision check made by `build` cannot race another
   * write. Returns build's refusal unchanged, or the append result plus build's `result`.
   * @param {(events: object[]) => ({ ok: true, events: object[], result?: object } | { ok: false, reason: string })} build
   */
  function appendEventsChecked(build) {
    return serial(async () => {
      if (state !== 'ready') return { ok: false, reason: `registry-${state}` };
      let plan;
      try { plan = build(doc.events.slice()); } catch { return { ok: false, reason: 'command-failed' }; }
      if (!plan || plan.ok !== true) return plan && plan.reason ? plan : { ok: false, reason: 'command-failed' };
      const res = await _append(plan.events);
      if (!res.ok || res.added.length !== plan.events.length) return { ok: false, reason: res.reason || 'not-recorded', rejected: res.rejected };
      return { ok: true, added: res.added, result: plan.result || null };
    });
  }

  /** Backups with validity — no event content, no identifiers. */
  function listRecoveryCandidates() {
    return serial(async () => {
      const out = [];
      for (const name of (await _backupNames().catch(() => [])).reverse()) {
        try {
          const parsed = JSON.parse((await fsx.readFile(path.join(backupDir, name))).toString('utf8'));
          const v = validateRegistryDocument(parsed);
          out.push({ name, valid: v.ok, eventCount: v.ok ? parsed.events.length : null, sameRegistry: !!(doc && parsed.registryId === doc.registryId) });
        } catch { out.push({ name, valid: false, eventCount: null, sameRegistry: false }); }
      }
      return out;
    });
  }

  /**
   * Explicit recovery: restore a validated backup. The current registry file (corrupt or not)
   * is copied to quarantine first, so no evidence is overwritten. Requires { confirm: true }.
   */
  function recoverFromBackup(name, { confirm = false } = {}) {
    return serial(async () => {
      if (confirm !== true) return { ok: false, reason: 'confirmation-required' };
      if (!lockToken) return { ok: false, reason: 'not-locked' };
      if (typeof name !== 'string' || !BACKUP_RE.test(name) || !(await _backupNames()).includes(name)) return { ok: false, reason: 'unknown-backup' };
      try {
        const text = (await fsx.readFile(path.join(backupDir, name))).toString('utf8');
        const parsed = JSON.parse(text);
        if (!validateRegistryDocument(parsed).ok) return { ok: false, reason: 'backup-invalid' };
        let preserved = null;
        if (await readIfExists(fsx, registryFile) !== null) preserved = await _quarantineCopy('pre-recovery');
        await atomicWriteFile(fsx, registryFile, text);
        doc = parsed; lastSerialized = text;
        await _loadKeys();
        state = 'ready'; reason = 'recovered-from-backup';
        return { ok: true, preserved };
      } catch (err) {
        return { ok: false, reason: `recovery-failed:${errCode(err)}` };
      }
    });
  }

  /** Safe for diagnostics: no identifiers, digests or keys. */
  function getStatus() {
    return {
      state, reason,
      learning: state === 'ready',
      bodyMatching: state === 'ready' && !!keyring,
      keyStatus: state === 'ready' ? (keyring ? 'ready' : keyReason) : 'not-loaded',
      schemaVersion: doc ? doc.schemaVersion : null,
      events: doc ? doc.events.length : 0,
      unknownTypeEvents: doc ? doc.events.filter(e => !validateEvent(e).known).length : 0,
      integrityConflicts: doc ? doc.held.length : 0,
      keyCount: doc ? doc.keyIds.length : 0,
    };
  }

  /**
   * will-quit: the process is ending and cannot await. Releases our lock (only if it is still
   * ours) synchronously and stops accepting writes. An in-flight write is atomic either way.
   */
  function releaseLockSync() {
    if (lockToken) {
      try {
        const fsSync = require('fs');
        const held = JSON.parse(fsSync.readFileSync(lockFile, 'utf8'));
        if (held.token === lockToken) fsSync.unlinkSync(lockFile);
      } catch { /* already gone */ }
      lockToken = null;
    }
    keyring = null; state = 'closed'; reason = 'shutdown';
  }

  function close() {
    return serial(async () => { await _releaseLock(); keyring = null; doc = null; lastSerialized = null; state = 'closed'; reason = null; });
  }

  return {
    open, close, releaseLockSync, getStatus, appendEvents, appendEventsChecked, ensurePhotographerId, listRecoveryCandidates, recoverFromBackup,
    /** Main-process only. Null whenever body matching is disabled. Never send to a renderer. */
    getKeyring: () => (state === 'ready' ? keyring : null),
    getEvents: () => (doc ? doc.events.slice() : []),
    getIntegrityConflicts: () => (doc ? doc.held.map(h => ({ eventId: h.event.eventId, reason: h.reason, detectedAt: h.detectedAt })) : []),
    deriveState: ({ shippedNames = [] } = {}) => (doc ? deriveRegistryState(doc.events, { shipped: P.bootstrapShippedIds(shippedNames) }) : null),
    paths: { registryFile, lockFile, backupDir, quarantineDir, keyFile: keyStore.file },
  };
}

module.exports = { createIdentityRegistryStore, validateRegistryDocument, SCHEMA_VERSION, FORMAT, REGISTRY_FILE, MIGRATIONS };
