// test/eqi4TrashVolumes.test.js — EQI-4: the REAL macOS Trash (Electron shell.trashItem) through
// services/trashService.js on disposable disk-image volumes: FAT32, exFAT, HFS+, APFS, read-only.
// Integration, not simulation: every file must leave the volume's DCIM and arrive, byte-identical, in that
// volume's own .Trashes/<uid> (the same place Finder's Put Back restores from). The images are created,
// attached with -nobrowse at a private mount point, detached and deleted by this test.
// Run (Electron main process):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox --user-data-dir=<tmp> test/eqi4TrashVolumes.test.js

'use strict';

const { app } = require('electron');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../services/trashService');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { failed++; console.error(`  FAIL — ${name}`); console.error(err); }
}
const hdi = (...a) => execFileSync('hdiutil', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

app.whenReady().then(async () => {
  if (process.platform !== 'darwin') { console.log('SKIP — macOS only'); app.exit(0); return; }
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-eqi4-vols-')));
  const mounted = [];
  const attach = (img, mnt, ro = false) => { fs.mkdirSync(mnt, { recursive: true }); hdi('attach', '-nobrowse', ...(ro ? ['-readonly'] : []), '-mountpoint', mnt, img); mounted.push(mnt); return mnt; };
  try {
    for (const [label, fsType, expect] of [['FAT32', 'MS-DOS FAT32', 'msdos'], ['EXFAT', 'ExFAT', 'exfat'], ['HFS', 'HFS+', 'hfs'], ['APFS', 'APFS', 'apfs']]) {
      await t(`${label}: files go to the volume's own Trash, verified, byte-identical; a same-name file too; DCIM kept`, async () => {
        const img = path.join(work, `${label}.dmg`);
        hdi('create', '-size', '48m', '-fs', fsType, '-volname', `AIT${label}`, img);
        const mnt = attach(img, path.join(work, 'mnt', label));
        const dir = path.join(mnt, 'DCIM', '100TEST');
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, 'IMG_0001.JPG');
        fs.writeFileSync(f, crypto.randomBytes(150000));
        const h1 = sha(f);
        const cap = await T.capability(mnt);
        assert.equal(cap.ok, true, JSON.stringify(cap));
        assert.equal(cap.fsType, expect);
        assert.equal(cap.trashDir, path.join(mnt, '.Trashes', String(process.getuid())));
        const r1 = await T.trashFile(f, cap);
        assert.equal(r1.outcome, 'trashed', JSON.stringify(r1));
        assert.equal(fs.existsSync(f), false);
        assert.equal(sha(r1.trashPath), h1, 'recoverable, byte-identical');
        fs.writeFileSync(f, crypto.randomBytes(150000));   // same name again
        const h2 = sha(f);
        const r2 = await T.trashFile(f, cap);
        assert.equal(r2.outcome, 'trashed', JSON.stringify(r2));
        assert.notEqual(r2.trashPath, r1.trashPath);
        assert.equal(sha(r2.trashPath), h2);
        assert.equal(fs.existsSync(dir), true, 'camera folder kept');
        const loc = await T.locate(f, 150000, [r1.trashPath], cap);
        assert.equal(loc.where, 'trash', 'recovery finds the new Trash entry, not the older one');
        assert.equal(loc.trashPath, r2.trashPath);
      });
    }
    await t('read-only volume: refused before anything is attempted', async () => {
      const img = path.join(work, 'RO.dmg');
      hdi('create', '-size', '48m', '-fs', 'MS-DOS FAT32', '-volname', 'AITRO', img);
      const rw = attach(img, path.join(work, 'mnt', 'RO-setup'));
      fs.mkdirSync(path.join(rw, 'DCIM'), { recursive: true }); fs.writeFileSync(path.join(rw, 'DCIM', 'A.JPG'), 'x');
      hdi('detach', rw); mounted.splice(mounted.indexOf(rw), 1);
      const mnt = attach(img, path.join(work, 'mnt', 'RO'), true);
      const cap = await T.capability(mnt);
      assert.equal(cap.ok, false);
      assert.match(cap.reason, /read-only/);
      const r = await T.trashFile(path.join(mnt, 'DCIM', 'A.JPG'), cap);
      assert.equal(r.outcome, 'not-removed');
      assert.equal(fs.existsSync(path.join(mnt, 'DCIM', 'A.JPG')), true);
    });
    await t('the Trash service never deletes: no unlink/rm in its source', async () => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'trashService.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // code only
      assert.equal(/\b(unlink|rmSync|fsp\.rm\b|rimraf|\.rm\()/.test(src), false);
    });
  } finally {
    for (const m of mounted.reverse()) { try { hdi('detach', '-force', m); } catch { /* gone */ } }
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`eqi4TrashVolumes: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
  app.exit(failed ? 1 : 0);
});
