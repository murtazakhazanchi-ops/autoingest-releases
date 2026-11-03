'use strict';

// AI-FEAT-063 / AI-RM-014 Q4b — the identity key store against REAL Electron safeStorage
// (macOS Keychain). Requires the Electron binary; macOS only (Windows DPAPI must be verified
// separately on Windows hardware). Uses an isolated temp userData and TEST app names, so the
// Keychain items it creates are "AutoIngest-Q4b-SafeStorage-Test Safe Storage" and
// "AutoIngest-Q4b-OtherMac-Test Safe Storage" — never the production AutoIngest item.
// Remove them afterwards with:
//   security delete-generic-password -s "AutoIngest-Q4b-SafeStorage-Test Safe Storage"
//   security delete-generic-password -s "AutoIngest-Q4b-OtherMac-Test Safe Storage"
//
// Phases run as separate processes (a real restart each time):
//   init     new registry → key generated and sealed by safeStorage; one device event written
//   reopen   same app identity → same key, same digest (restart / reinstall on the same Mac)
//   othermac different app identity = different Keychain secret (stands in for a copied
//            userData on another Mac/user) → key undecryptable → body matching disabled,
//            nothing replaced
// Run: node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//        test/identityRegistrySafeStorageQ4b.electron.js

const { app } = require('electron');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const arg = (k) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || null;
const phase = arg('phase') || 'driver';
const SERIAL = 'FAKEQ4BSAFE0001';

if (phase === 'driver') {
  app.whenReady().then(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-q4b-safestorage-'));
    const run = (p) => {
      const r = spawnSync(process.execPath, ['--no-sandbox', __filename, `--phase=${p}`, `--root=${root}`], { encoding: 'utf8', timeout: 60000 });
      const line = (r.stdout || '').split('\n').find(l => l.startsWith('RESULT '));
      if (!line) throw new Error(`phase ${p} produced no result: ${r.stderr}`);
      return JSON.parse(line.slice(7));
    };
    let failures = 0;
    const check = (ok, msg) => { console.log(`  ${ok ? 'ok' : 'FAIL'} — ${msg}`); if (!ok) failures++; };
    try {
      const init = run('init');
      check(init.status.state === 'ready' && init.status.reason === 'initialized', 'init: new registry created');
      check(init.available === true && init.backend === 'macos-keychain', `init: safeStorage available (${init.backend})`);
      check(init.status.bodyMatching === true && init.status.keyCount === 1, 'init: key generated and body matching enabled');
      check(init.keyFile.protection === 'os-secure-storage' && init.keyFile.backend === 'macos-keychain', 'init: key stored as safeStorage ciphertext');
      check(init.plaintextCheck === 'absent', 'init: decrypted key bytes are not present in any file');
      check(init.serialInFiles === false, 'init: raw serial not written to any file');
      const re = run('reopen');
      check(re.status.state === 'ready' && re.status.bodyMatching === true, 'reopen (restart): body matching enabled');
      check(re.digest === init.digest, 'reopen: same key → same identifier digest');
      check(re.status.events === 1, 'reopen: event persisted');
      const other = run('othermac');
      check(other.status.state === 'ready' && other.status.learning === true, 'other Keychain: registry still opens, learning unaffected');
      check(other.status.bodyMatching === false && other.status.keyStatus === 'key-undecryptable', `other Keychain: body matching disabled (${other.status.keyStatus})`);
      check(other.keyFileUnchanged === true, 'other Keychain: key file not replaced');
      const back = run('reopen');
      check(back.digest === init.digest, 'original identity again: key still decrypts (nothing was overwritten)');
    } catch (err) { check(false, err.message); }
    fs.rmSync(root, { recursive: true, force: true });
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
    app.exit(failures ? 1 : 0);
  });
} else {
  const root = arg('root');
  app.setName(phase === 'othermac' ? 'AutoIngest-Q4b-OtherMac-Test' : 'AutoIngest-Q4b-SafeStorage-Test');
  app.setPath('userData', path.join(root, 'userData'));
  if (app.dock) app.dock.hide();
  app.whenReady().then(async () => {
    const { createElectronSecureStorage } = require('../services/electronSecureStorage');
    const { createIdentityRegistryStore } = require('../services/identityRegistryStore');
    const { createEvent } = require('../services/identityEvents');
    const secureStorage = createElectronSecureStorage();
    const dir = path.join(app.getPath('userData'), 'identity-registry');
    const keyFilePath = path.join(dir, 'keys.json');
    const keyBefore = fs.existsSync(keyFilePath) ? fs.readFileSync(keyFilePath, 'utf8') : null;
    const generated = [];
    const randomBytes = (n) => { const b = require('node:crypto').randomBytes(n); if (n === 32) generated.push(Buffer.from(b)); return b; };
    const store = createIdentityRegistryStore({ dir, secureStorage, computerId: 'comp-q4b-electron', randomBytes });
    const status = await store.open();
    const out = { status, available: secureStorage.isAvailable(), backend: secureStorage.backend };
    const ring = store.getKeyring();
    if (ring) out.digest = ring.digest(ring.keyIds[0], 'exif.bodySerial', 'Canon', SERIAL);
    if (phase === 'init' && ring) {
      const origin = { computerId: 'comp-q4b-electron', operatorId: null, workflow: 'registry' };
      await store.appendEvents([createEvent('device-registered', {
        deviceId: require('node:crypto').randomUUID(), make: 'Canon', modelKey: 'EOS70D', modelDisplay: 'Canon EOS 70D',
        identifiers: [{ ns: 'exif.bodySerial', keyId: ring.keyIds[0], digest: out.digest, trusted: true }],
      }, { origin, at: new Date().toISOString() })]);
      out.status = store.getStatus();
      const k = JSON.parse(fs.readFileSync(keyFilePath, 'utf8')).keys[0];
      out.keyFile = { protection: k.protection, backend: k.backend };
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
      out.plaintextCheck = generated.some(g => files.includes(g.toString('hex')) || files.includes(g.toString('base64'))) ? 'PRESENT' : 'absent';
      out.serialInFiles = files.includes(SERIAL);
    }
    if (phase === 'othermac') out.keyFileUnchanged = fs.readFileSync(keyFilePath, 'utf8') === keyBefore;
    await store.close();
    process.stdout.write(`RESULT ${JSON.stringify(out)}\n`);
    app.exit(0);
  });
}
