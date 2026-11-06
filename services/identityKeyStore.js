/**
 * identityKeyStore.js — OS-protected persistence of the camera-identifier HMAC keys
 * (AI-FEAT-063, AI-RM-014 Q4b).
 *
 * Keys are 32 random bytes. They are stored ONLY as ciphertext produced by the injected
 * secure-storage adapter (electronSecureStorage.js: Electron safeStorage — macOS Keychain,
 * Windows DPAPI), in their own file `keys.json`, never beside the registry in plaintext and
 * never in a log, renderer payload or diagnostic export. A SHA-256 of the ciphertext detects
 * file damage before decryption is attempted.
 *
 * Key IDs are namespaced: `local-<hex>` for a key this computer generated; Q7 will add
 * organisation keys (`org-…`) beside them. Q4b never exports, imports or synchronises keys.
 *
 * Each key records the protecting identity (`identity`): for Electron safeStorage on macOS that
 * is the app name, which selects the Keychain item "<name> Safe Storage". package.json "name"
 * is "auto-ingest" and productName lives only in the electron-builder config, so development
 * runs AND packaged builds both report "auto-ingest" (measured) and share one userData
 * (~/Library/Application Support/auto-ingest) and one Keychain item. A key is only decrypted
 * under the same identity; a renamed app reports 'key-protection-identity-mismatch' instead.
 *
 * Failure policy: anything wrong with a key the registry depends on (file missing, damaged,
 * cannot be decrypted, belongs to another registry, secure storage unavailable) yields NO
 * keyring and a reason. Body matching is then disabled. A missing key is never silently
 * replaced: generation only happens for a registry that has no keys yet.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');
const { createKeyring, KEY_ID_RE } = require('./identityKeyring');
const { atomicWriteFile, readIfExists } = require('./identityFileOps');

const KEY_FILE = 'keys.json';
const KEY_FORMAT = 'autoingest-identity-keys';
const KEY_FILE_VERSION = 1;
const KEY_BYTES = 32;

function _validateKeyDoc(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['not an object'];
  const extra = Object.keys(doc).filter(k => !['format', 'version', 'registryId', 'keys'].includes(k));
  if (extra.length) errors.push(`unexpected field(s) ${extra.join(', ')}`);
  if (doc.format !== KEY_FORMAT) errors.push('wrong format');
  if (doc.version !== KEY_FILE_VERSION) errors.push('unsupported version');
  if (typeof doc.registryId !== 'string' || !doc.registryId) errors.push('registryId missing');
  if (!Array.isArray(doc.keys)) errors.push('keys must be an array');
  else for (const k of doc.keys) {
    if (!k || typeof k !== 'object') { errors.push('key entry must be an object'); continue; }
    const kx = Object.keys(k).filter(x => !['keyId', 'createdAt', 'protection', 'backend', 'identity', 'material', 'sha256'].includes(x));
    if (kx.length) errors.push(`key entry has unexpected field(s) ${kx.join(', ')}`);
    if (!KEY_ID_RE.test(k.keyId || '')) errors.push('key entry keyId invalid');
    if (k.protection !== 'os-secure-storage') errors.push('key entry protection must be os-secure-storage');
    if (typeof k.identity !== 'string' || !k.identity) errors.push('key entry identity missing');
    if (typeof k.material !== 'string' || !k.material) errors.push('key entry material missing');
    if (typeof k.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(k.sha256)) errors.push('key entry checksum missing');
  }
  return errors;
}

/**
 * @param {{ dir: string, secureStorage: {isAvailable(): boolean, backend: string, encrypt(b: Buffer): Buffer, decrypt(b: Buffer): Buffer},
 *           fs?: typeof import('fs').promises, now?: () => Date, randomBytes?: (n: number) => Buffer }} opts
 */
function createIdentityKeyStore({ dir, secureStorage, fs: fsx = require('fs').promises, now = () => new Date(), randomBytes = crypto.randomBytes }) {
  const file = path.join(dir, KEY_FILE);

  async function readDoc() {
    const buf = await readIfExists(fsx, file);
    if (buf === null) return { status: 'missing' };
    let doc;
    try { doc = JSON.parse(buf.toString('utf8')); } catch { return { status: 'corrupt', errors: ['not valid JSON'] }; }
    const errors = _validateKeyDoc(doc);
    return errors.length ? { status: 'corrupt', errors } : { status: 'present', doc };
  }

  /**
   * Decrypt the keys `keyIds` for `registryId`.
   * @returns {Promise<{ keyring: object|null, reason: string|null }>}
   */
  async function load(registryId, keyIds) {
    if (!keyIds.length) return { keyring: null, reason: 'no-keys' };
    let r;
    try { r = await readDoc(); } catch (err) { return { keyring: null, reason: `key-file-unreadable:${err.code || 'error'}` }; }
    if (r.status === 'missing') return { keyring: null, reason: 'key-file-missing' };
    if (r.status === 'corrupt') return { keyring: null, reason: 'key-file-corrupt' };
    if (r.doc.registryId !== registryId) return { keyring: null, reason: 'key-registry-mismatch' };
    // Identity first: even asking whether secure storage is available makes macOS create this
    // app's "<name> Safe Storage" Keychain item, which a key sealed elsewhere can never use.
    for (const keyId of keyIds) {
      const k = r.doc.keys.find(x => x.keyId === keyId);
      if (k && k.identity !== String(secureStorage.identity || '')) return { keyring: null, reason: 'key-protection-identity-mismatch' };
    }
    if (!secureStorage.isAvailable()) return { keyring: null, reason: 'secure-storage-unavailable' };
    const entries = [];
    try {
      for (const keyId of keyIds) {
        const k = r.doc.keys.find(x => x.keyId === keyId);
        if (!k) return { keyring: null, reason: 'key-missing-for-id' };
        // Pinned protecting identity: decrypting under another one would make the OS create a
        // NEW secret for that identity (e.g. a fresh "<other app name> Safe Storage" Keychain
        // item) and still fail. Refuse before touching secure storage.
        if (k.identity !== String(secureStorage.identity || '')) return { keyring: null, reason: 'key-protection-identity-mismatch' };
        const material = Buffer.from(k.material, 'base64');
        if (crypto.createHash('sha256').update(material).digest('hex') !== k.sha256) return { keyring: null, reason: 'key-file-corrupt' };
        let key;
        try { key = secureStorage.decrypt(material); } catch { return { keyring: null, reason: 'key-undecryptable' }; }
        if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) return { keyring: null, reason: 'key-undecryptable' };
        entries.push({ keyId, key });
      }
      return { keyring: createKeyring(entries), reason: null };
    } finally {
      for (const e of entries) e.key.fill(0); // the keyring keeps its own private copy
    }
  }

  /**
   * Generate one new local key and persist it encrypted. Only called while initialising a
   * registry that has no keys. Refuses to overwrite an existing key file of another registry.
   * @returns {Promise<{ keyId: string|null, reason: string|null }>}
   */
  async function generateInitialKey(registryId) {
    if (!secureStorage.isAvailable()) return { keyId: null, reason: 'secure-storage-unavailable' };
    const existing = await readDoc();
    if (existing.status === 'corrupt') return { keyId: null, reason: 'key-file-corrupt' };
    if (existing.status === 'present' && existing.doc.registryId !== registryId) return { keyId: null, reason: 'key-registry-mismatch' };
    const key = randomBytes(KEY_BYTES);
    try {
      const keyId = `local-${randomBytes(6).toString('hex')}`;
      const material = secureStorage.encrypt(key);
      const entry = {
        keyId, createdAt: now().toISOString(), protection: 'os-secure-storage', backend: String(secureStorage.backend || 'unknown'),
        identity: String(secureStorage.identity || ''),
        material: material.toString('base64'), sha256: crypto.createHash('sha256').update(material).digest('hex'),
      };
      const doc = existing.status === 'present' ? { ...existing.doc, keys: [...existing.doc.keys, entry] } : { format: KEY_FORMAT, version: KEY_FILE_VERSION, registryId, keys: [entry] };
      await atomicWriteFile(fsx, file, `${JSON.stringify(doc, null, 2)}\n`);
      return { keyId, reason: null };
    } finally {
      key.fill(0);
    }
  }

  /** Registry ID recorded in an existing key file (orphaned-key adoption), or null. */
  async function existingRegistryId() {
    const r = await readDoc();
    return r.status === 'present' ? { registryId: r.doc.registryId, keyIds: r.doc.keys.map(k => k.keyId) } : null;
  }

  return { load, generateInitialKey, existingRegistryId, file };
}

module.exports = { createIdentityKeyStore, KEY_FILE };
