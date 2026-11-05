/**
 * identityRegistryInspector.js — read-only, non-initializing inspection of the Photographer &
 * Camera Identity Registry (AI-FEAT-063, AI-RM-014 Q5a). Main process; Electron-free (fs
 * injected).
 *
 * identityRegistryStore.open() is the WRITE path: it creates the folder, takes the
 * process-lifetime lock, quarantines temp files and — for a brand-new registry — generates a
 * key and its OS secure-storage (Keychain) item. Viewing the registry must do none of that, so
 * this module only ever calls readFile / readdir. It never creates a file or folder, never
 * takes or steals a lock, never moves anything to quarantine, never decrypts (or touches
 * secure storage at all) and never repairs or recovers.
 *
 * States (distinct, never collapsed):
 *   missing                  no registry.json — nothing learned yet (the normal first state)
 *   missing-backups-present  no registry.json but backups exist — needs attention, not a reset
 *   ready                    valid registry, readable
 *   locked                   valid registry, but another live process holds the write lock;
 *                            the document is still returned (writes are atomic) as read-only
 *   corrupt                  unreadable JSON or an invalid document
 *   incompatible             written by a newer AutoIngest, or an older schema with no migration
 *   unreadable               the file exists but cannot be read (permissions, I/O)
 *
 * Key status is checked WITHOUT decryption (file present, intact, same registry, a key for every
 * keyId, recorded protecting identity equal to this app's). `keyVerified` is therefore always
 * false here: only the runtime store, after it has opened the registry for learning, knows
 * whether the key actually decrypts. Nothing here exposes key material, checksums or IDs.
 */

'use strict';

const path = require('path');
const { validateRegistryDocument, REGISTRY_FILE } = require('./identityRegistryStore');
const { validateEvent } = require('./identityEvents');
const { KEY_ID_RE } = require('./identityKeyring');

const LOCK_FILE = 'registry.lock';
const KEY_FILE = 'keys.json';
const BACKUP_DIR = 'backups';
const KEY_FORMAT = 'autoingest-identity-keys';

const _defaultPidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

async function _read(fsx, file) {
  try { return { ok: true, buf: await fsx.readFile(file) }; }
  catch (err) { return { ok: false, code: err.code || 'error' }; }
}

/**
 * Same checks identityKeyStore.load() makes before it decrypts, and nothing after.
 * @returns {string} 'present-unverified' | 'no-keys' | 'key-file-missing' | 'key-file-corrupt' |
 *   'key-file-unreadable' | 'key-registry-mismatch' | 'key-missing-for-id' | 'key-protection-identity-mismatch'
 */
async function _keyStatus(fsx, dir, doc, expectedIdentity) {
  if (!doc.keyIds.length) return 'no-keys';
  const r = await _read(fsx, path.join(dir, KEY_FILE));
  if (!r.ok) return r.code === 'ENOENT' ? 'key-file-missing' : 'key-file-unreadable';
  let kd;
  try { kd = JSON.parse(r.buf.toString('utf8')); } catch { return 'key-file-corrupt'; }
  if (!kd || kd.format !== KEY_FORMAT || !Array.isArray(kd.keys) || typeof kd.registryId !== 'string') return 'key-file-corrupt';
  if (kd.registryId !== doc.registryId) return 'key-registry-mismatch';
  for (const keyId of doc.keyIds) {
    const k = kd.keys.find(x => x && x.keyId === keyId);
    if (!k || !KEY_ID_RE.test(k.keyId)) return 'key-missing-for-id';
    if (typeof k.material !== 'string' || !/^[0-9a-f]{64}$/.test(k.sha256 || '')) return 'key-file-corrupt';
    if (expectedIdentity != null && k.identity !== String(expectedIdentity)) return 'key-protection-identity-mismatch';
  }
  return 'present-unverified';
}

async function _lockStatus(fsx, dir, isPidAlive) {
  const r = await _read(fsx, path.join(dir, LOCK_FILE));
  if (!r.ok) return 'none';
  let held = null;
  try { held = JSON.parse(r.buf.toString('utf8')); } catch { /* empty or partial: being written */ }
  if (!held || !Number.isInteger(held.pid)) return 'unknown';
  if (held.pid === process.pid) return 'this-process';
  return isPidAlive(held.pid) ? 'other-process' : 'stale';
}

async function _backupsPresent(fsx, dir) {
  try { return (await fsx.readdir(path.join(dir, BACKUP_DIR))).some(n => /^registry-.*\.json$/.test(n)); }
  catch { return false; }
}

/**
 * @param {{ dir: string, fs?: typeof import('fs').promises, isPidAlive?: (pid:number)=>boolean,
 *           expectedIdentity?: string|null }} opts
 *   dir — the identity-registry folder (it need not exist)
 * @returns {Promise<{ state: string, reason: string|null, readOnly: true, events: object[],
 *   heldCount: number, unknownTypeEvents: number, schemaVersion: number|null, keyStatus: string,
 *   keyVerified: false, lock: string }>}
 */
async function inspectRegistryFiles({ dir, fs: fsx = require('fs').promises, isPidAlive = _defaultPidAlive, expectedIdentity = null } = {}) {
  const base = { readOnly: true, events: [], heldCount: 0, unknownTypeEvents: 0, schemaVersion: null, keyStatus: 'not-loaded', keyVerified: false, lock: 'none' };
  const r = await _read(fsx, path.join(dir, REGISTRY_FILE));
  if (!r.ok) {
    if (r.code !== 'ENOENT') return { ...base, state: 'unreadable', reason: `io-error:${r.code}` };
    return (await _backupsPresent(fsx, dir))
      ? { ...base, state: 'missing-backups-present', reason: 'registry-missing-backups-present' }
      : { ...base, state: 'missing', reason: null };
  }
  let parsed;
  try { parsed = JSON.parse(r.buf.toString('utf8')); } catch { return { ...base, state: 'corrupt', reason: 'registry-not-json' }; }
  const v = validateRegistryDocument(parsed);
  if (v.unsupportedVersion) return { ...base, state: 'incompatible', reason: 'newer-schema-version', schemaVersion: parsed.schemaVersion };
  if (v.needsMigration) return { ...base, state: 'incompatible', reason: 'older-schema-without-migration', schemaVersion: parsed.schemaVersion };
  if (!v.ok) return { ...base, state: 'corrupt', reason: 'registry-invalid' };
  const lock = await _lockStatus(fsx, dir, isPidAlive);
  return {
    ...base,
    state: lock === 'other-process' ? 'locked' : 'ready',
    reason: lock === 'other-process' ? 'locked-by-another-process' : null,
    events: parsed.events,
    heldCount: parsed.held.length,
    unknownTypeEvents: parsed.events.filter(e => !validateEvent(e).known).length,
    schemaVersion: parsed.schemaVersion,
    keyStatus: await _keyStatus(fsx, dir, parsed, expectedIdentity),
    lock,
  };
}

module.exports = { inspectRegistryFiles };
