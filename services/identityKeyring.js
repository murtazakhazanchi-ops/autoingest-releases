/**
 * identityKeyring.js — keyed digests of camera body identifiers (AI-FEAT-063, AI-RM-014 Q4a).
 * Pure: no Electron, no filesystem. Keys are INJECTED by the caller.
 *
 * Camera serials are sensitive equipment data. The registry never stores or exports a raw
 * identifier: it stores HMAC-SHA256(key, domain | namespace | make | value). An unkeyed hash
 * is not used because short serials (Nikon: 7 digits) are recoverable by brute force.
 *
 * A keyring holds several keys so a computer can keep matching its own earlier digests after
 * it joins another computer's organisation key (Q7): every observation is digested under
 * every key, and two digests match only under the same keyId.
 *
 * No key is generated, persisted or loaded here. Keys are generated, sealed with the OS
 * secure storage and loaded by identityKeyStore.js (Q4b), which also owns the loss,
 * recovery and secure-storage-unavailable rules.
 */

'use strict';

const crypto = require('crypto');
const util = require('util');

const KEY_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const MIN_KEY_BYTES = 32;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const DOMAIN = 'autoingest.camera-identifier.v1';

/** Values are compared case- and spacing-insensitively; cameras write them upper-case anyway. */
function normalizeIdentifierValue(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * @param {Array<{keyId: string, key: Buffer}>} entries
 * @returns {Readonly<{ keyIds: readonly string[], digest: Function, digestAll: Function }>}
 */
function createKeyring(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('keyring needs at least one key');
  const keys = new Map();
  for (const e of entries) {
    if (!e || typeof e.keyId !== 'string' || !KEY_ID_RE.test(e.keyId)) throw new Error('invalid keyId');
    if (!Buffer.isBuffer(e.key) || e.key.length < MIN_KEY_BYTES) throw new Error(`key ${e.keyId} must be a Buffer of at least ${MIN_KEY_BYTES} bytes`);
    if (keys.has(e.keyId)) throw new Error(`duplicate keyId ${e.keyId}`);
    keys.set(e.keyId, Buffer.from(e.key)); // private copy; the caller's buffer may be wiped
  }
  const keyIds = Object.freeze([...keys.keys()]);

  function digest(keyId, ns, make, value) {
    const key = keys.get(keyId);
    if (!key) throw new Error(`unknown keyId ${keyId}`);
    const v = normalizeIdentifierValue(value);
    if (!ns || !make || !v) throw new Error('digest needs namespace, make and value');
    return crypto.createHmac('sha256', key).update([DOMAIN, ns, make, v].join('\x00')).digest('hex');
  }

  return Object.freeze({
    keyIds,
    digest,
    /** One digest per key: [{ keyId, digest }]. */
    digestAll: (ns, make, value) => keyIds.map(keyId => ({ keyId, digest: digest(keyId, ns, make, value) })),
    // Never let key bytes reach a log line or a JSON payload.
    toJSON: () => ({ keyIds }),
    [util.inspect.custom]: () => `Keyring { keyIds: [${keyIds.join(', ')}] }`,
  });
}

module.exports = { createKeyring, normalizeIdentifierValue, DIGEST_RE, KEY_ID_RE, MIN_KEY_BYTES };
