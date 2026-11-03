/**
 * electronSecureStorage.js — adapter from Electron safeStorage to the identity key store's
 * secure-storage interface (AI-RM-014 Q4b). Main process only.
 *
 * Platform protection (Electron safeStorage):
 *   macOS   — encryption key held in the login Keychain item "<app name> Safe Storage".
 *             Survives app reinstall on the same Mac and user account; NOT present on
 *             another Mac (copied userData cannot decrypt — by design).
 *   Windows — DPAPI, bound to the Windows user account. Survives reinstall for that user;
 *             not portable to another user or PC. Requires verification on Windows hardware
 *             before any claim is made (not executed in Q4b).
 *   Linux   — only a real keyring backend counts; the 'basic_text' fallback is plaintext
 *             obfuscation and is treated as UNAVAILABLE.
 * isEncryptionAvailable() is only meaningful after the app 'ready' event. Nothing here touches the
 * Keychain until a key is actually encrypted or decrypted (registry initialisation / first load).
 */

'use strict';

function createElectronSecureStorage(electron = require('electron')) {
  const { safeStorage } = electron;
  const backend = process.platform === 'darwin' ? 'macos-keychain'
    : process.platform === 'win32' ? 'windows-dpapi'
      : `linux-${typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : 'unknown'}`;
  return {
    backend,
    // The identity safeStorage protects keys under. On macOS this is the app name, which names
    // the Keychain item "<name> Safe Storage". Recorded with each key and checked before decrypting.
    identity: electron.app.getName(),
    isAvailable() {
      try {
        if (!safeStorage.isEncryptionAvailable()) return false;
        return !(process.platform === 'linux' && /basic_text|unknown/.test(backend));
      } catch { return false; }
    },
    // safeStorage encrypts strings; key bytes travel as base64 inside the ciphertext.
    encrypt: (buf) => safeStorage.encryptString(buf.toString('base64')),
    decrypt: (cipher) => Buffer.from(safeStorage.decryptString(cipher), 'base64'),
  };
}

module.exports = { createElectronSecureStorage };
