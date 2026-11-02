'use strict';

// AI-FEAT-061 Q3 — live verification of automatic camera identification in the real app
// (real main.js, companion, shared ExifTool pool, real fileBrowser discovery). Only the OS
// drive enumeration is stubbed (Electron -r). Card "volumes" are temp folders holding real
// media whose camera tags ExifTool wrote before launch. Every serial here is FAKE.
//
// Covers: two bodies of one model (A/B); model identified without a body; RAW/JPEG pair
// inheritance and a disagreeing pair (conflict); DNG camera serial; phone; video with model
// only; unknown camera; a second card (no cross-card merging in Q3); Q2 date counts intact;
// removal during camera identification and reconnection; no serial in the popup DOM, the
// snapshot or the app log; card files unchanged.
//
// Run: node test/companionQ3Live.test.js     (macOS)

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { ExifTool } = require('exiftool-vendored');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const MAIN_JS = path.join(PROJECT_ROOT, 'main', 'main.js');
const FAKE = { A: 'FAKEBODYAAA1', B: 'FAKEBODYBBB2', DNG: 'FAKEDNGCAM9', X: 'FAKEBODYXXX7' };

function log(...args) { console.log('[companion-q3]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, stepMs = 200) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(stepMs); }
  return last;
}
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())}`; };

const STUB_SRC = `
'use strict';
const fs = require('fs');
const dl = require(require.resolve('drivelist', { paths: [process.env.AI_TEST_PROJECT_ROOT] }));
dl.list = async () => { try { return JSON.parse(fs.readFileSync(process.env.AI_TEST_DRIVES_FILE, 'utf8')); } catch { return []; } };
`;
const fakeDrive = (mountpoint, label) => ({ isSystem: false, isVirtual: false, isUSB: true, isRemovable: true, isCard: true, busType: 'SD', size: 64e9, description: 'Synthetic SD', mountpoints: [{ path: mountpoint, label }] });

function mp4Bytes() {
  const box = (type, body) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
  const d = new Date(); const t = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0) / 1000 + 2082844800;
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(t, 4); mvhd.writeUInt32BE(t, 8); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(1000, 16);
  mvhd.writeUInt32BE(0x00010000, 20); mvhd.writeUInt16BE(0x0100, 24);
  [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].forEach((v, i) => mvhd.writeUInt32BE(v >>> 0, 36 + i * 4));
  mvhd.writeUInt32BE(2, 96);
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2mp41')]));
  return Buffer.concat([ftyp, box('mdat', Buffer.alloc(80 * 1024)), box('moov', box('mvhd', mvhd))]);
}

const inMain = {
  diag: (app) => app.evaluate((_e, m) => process.getBuiltinModule('module').createRequire(m)('../services/companionService').getDiagnostics(), MAIN_JS),
  showPopup: (app) => app.evaluate((_e, m) => { process.getBuiltinModule('module').createRequire(m)('../services/companionService').showPopup(); }, MAIN_JS),
};
const popupPage = (app) => app.windows().filter(p => !p.isClosed() && p.url().endsWith('companion.html')).pop() || null;
const sourceIdOf = (d, label) => (d.snapshot.sources.find(s => s.label === label) || {}).sourceId;

async function cameraRows(app, sourceId) {
  const page = popupPage(app);
  if (!page) return null;
  return page.evaluate((id) => {
    const row = document.querySelector(`.card-row[data-source-id="${id}"]`);
    if (!row || row.querySelector('.cameras').hidden) return null;
    return {
      heading: row.querySelector('.cameras-heading').textContent,
      rows: [...row.querySelectorAll('.camera-row')].map(r => ({ status: r.dataset.status, name: r.querySelector('.camera-name').textContent, count: r.querySelector('.camera-count').textContent, badge: r.querySelector('.camera-badge')?.textContent || '' })),
      more: row.querySelector('.cameras-more').hidden ? '' : row.querySelector('.cameras-more').textContent,
      selected: row.querySelector('.selected-num').textContent,
      text: row.textContent,
    };
  }, sourceId).catch(() => null);
}

async function passSplash(app) {
  const window = await app.firstWindow({ timeout: 60000 });
  await window.waitForTimeout(1500);
  const mainWindowPromise = app.waitForEvent('window', { predicate: p => p.url().endsWith('index.html'), timeout: 30000 });
  await window.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    if (vis('splashSelect')) document.getElementById('splashNewProfileBtn').click();
    if (vis('splashWelcome')) document.getElementById('splashContinueBtn').click();
  });
  await sleep(300);
  try { await window.fill('#splashInputName', 'Q3 Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); } catch { /* not the create screen */ }
  const main = await mainWindowPromise;
  await main.waitForLoadState('domcontentloaded');
  return main;
}

async function snapshotTree(dir) {
  const out = {};
  async function walk(d) { for (const e of await fsp.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else { const st = await fsp.stat(p); out[p] = `${st.size}:${st.mtimeMs}`; } } }
  await walk(dir);
  return out;
}

(async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q3-live-'));
  const stubFile = path.join(work, 'drivelist-stub.js');
  const drivesFile = path.join(work, 'drives.json');
  await fsp.writeFile(stubFile, STUB_SRC);
  const setDrives = (list) => fs.writeFileSync(drivesFile, JSON.stringify(list));

  const noise = Buffer.alloc(240 * 240 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251;
  const jpg = await sharp(noise, { raw: { width: 240, height: 240, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  const tif = await sharp(noise, { raw: { width: 240, height: 240, channels: 3 } }).tiff({ compression: 'none' }).toBuffer();
  const et = new ExifTool({ maxProcs: 2 });
  const stamp = `${today()} 10:00:00`;
  const put = async (dir, name, bytes, tags) => {
    await fsp.mkdir(dir, { recursive: true });
    const p = path.join(dir, name);
    await fsp.writeFile(p, bytes);
    if (tags) await et.write(p, tags, { writeArgs: ['-overwrite_original'] });
    return p;
  };
  const r5 = (serial) => ({ Make: 'Canon', Model: 'Canon EOS R5', DateTimeOriginal: stamp, CreateDate: stamp, ...(serial ? { 'ExifIFD:SerialNumber': serial } : {}) });

  // Card 1: two R5 bodies, model-only R5, pair inheritance, pair conflict, DNG, phone, video, unknown.
  const c1 = path.join(work, 'card1'), d1 = path.join(c1, 'DCIM', '100CANON'), d2 = path.join(c1, 'DCIM', '101CANON');
  for (let i = 1; i <= 3; i++) await put(d1, `IMG_000${i}.JPG`, jpg, r5(FAKE.A));          // body A: 3 JPEG
  await put(d1, 'IMG_0004.CR2', tif, r5(FAKE.A));                                          //   + RAW (4)
  await put(d1, 'IMG_0004.JPG', jpg, r5(null));                                            //   + its JPEG with no serial → inherits (5)
  for (let i = 1; i <= 2; i++) await put(d2, `IMG_010${i}.JPG`, jpg, r5(FAKE.B));          // body B: 2
  for (let i = 1; i <= 2; i++) await put(d2, `IMG_020${i}.JPG`, jpg, r5(null));            // R5 body not identified: 2
  await put(d2, 'IMG_0300.JPG', jpg, r5(FAKE.A));                                          // pair conflict
  await put(d2, 'IMG_0300.CR2', tif, r5(FAKE.X));
  await put(d2, 'DJI_0001.DNG', tif, { Make: 'DJI', Model: 'FC220', DateTimeOriginal: stamp, 'IFD0:CameraSerialNumber': FAKE.DNG });
  await put(d2, 'IMG_9000.JPG', jpg, { Make: 'Apple', Model: 'iPhone 6', DateTimeOriginal: stamp });
  await put(d2, 'IMG_9001.JPG', jpg, { DateTimeOriginal: stamp });                          // unknown camera
  await put(d2, 'C0001.MP4', mp4Bytes(), { 'Keys:Make': 'Panasonic', 'Keys:Model': 'HC-VX870' }); // video: model only
  // Card 2: the same body A again (another card) + a phone.
  const c2 = path.join(work, 'card2'), e1 = path.join(c2, 'DCIM', '100CANON');
  for (let i = 1; i <= 2; i++) await put(e1, `IMG_500${i}.JPG`, jpg, r5(FAKE.A));
  await et.end();
  const before = { ...(await snapshotTree(c1)), ...(await snapshotTree(c2)) };

  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q3-live-ud-'));
  setDrives([]);
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: ['-r', stubFile, PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox'],
    cwd: PROJECT_ROOT, timeout: 60000,
    env: { ...process.env, AI_TEST_DRIVES_FILE: drivesFile, AI_TEST_PROJECT_ROOT: PROJECT_ROOT },
  });
  const pageErrors = [];
  app.on('window', p => p.on('pageerror', err => pageErrors.push(`${p.url().split('/').pop()}: ${err.message}`)));

  try {
    await passSplash(app);
    setDrives([fakeDrive(c1, 'Q3_CARD1')]);
    const id1 = await waitFor(async () => { const d = await inMain.diag(app); const id = sourceIdOf(d, 'Q3_CARD1'); return id && d.snapshot.sources.find(s => s.sourceId === id).assessment?.state === 'complete' ? id : null; }, 60000);
    check(!!id1, 'card assessed (dates + cameras)');
    let d = await inMain.diag(app);
    const a1 = d.snapshot.sources.find(s => s.sourceId === id1).assessment;
    check(d.assessment.identityReads === 2, `maker-note follow-up only for the 2 serial-less R5 JPEGs not covered by a pair (identityReads ${d.assessment.identityReads})`);
    check(a1.summary.counts.selected === 15, `Q2 date counts intact: 15 of 15 files captured today (${a1.summary.counts.selected})`);

    await inMain.showPopup(app);
    const rows = await waitFor(async () => cameraRows(app, id1), 10000);
    log('camera rows', JSON.stringify(rows && rows.rows));
    const byName = (n) => rows && rows.rows.filter(r => r.name === n);
    check(rows && rows.heading === 'Cameras (6)', `heading counts cameras (${rows && rows.heading})`);
    check(rows && JSON.stringify(rows.rows.slice(0, 3).map(r => [r.name, r.count, r.badge])) === JSON.stringify([
      ['Canon EOS R5 · Body A', '5 files', 'Body identified'], ['Canon EOS R5 · Body B', '2 files', 'Body identified'], ['Canon EOS R5', '2 files', 'Body not identified']]),
    'two R5 bodies labelled A (5 incl. the inherited pair JPEG) and B (2); unidentified R5 files kept separate');
    check(rows && rows.more === '+5 more', `the rest is collapsed (${rows && rows.more})`);
    await popupPage(app).click(`.card-row[data-source-id="${id1}"] .cameras-more`);
    const all = await waitFor(async () => { const r = await cameraRows(app, id1); return r && r.rows.length === 8 ? r : null; }, 5000);
    const names = all && all.rows.map(r => `${r.name}|${r.count}|${r.badge}`);
    log('expanded', JSON.stringify(names));
    check(all && names.includes('DJI FC220|1 file|Body identified'), 'DNG camera serial identifies the drone body');
    check(all && names.includes('Apple iPhone 6|1 file|Body not identified'), 'phone: model only');
    check(all && names.includes('Panasonic HC-VX870|1 file|Body not identified'), 'video with model only');
    check(all && names.includes('Unknown camera|1 file|'), 'file without camera metadata: Unknown camera');
    check(all && names.includes('Conflicting camera information|2 files|Not assigned'), 'RAW/JPEG pair with different body serials: 2 conflicting files, not assigned');
    check(all && all.rows.reduce((n, r) => n + Number(r.count.replace(/\D/g, '')), 0) === 15, 'every file counted exactly once');

    // Second card: same body A shown on its own card; Q3 does not link across cards.
    setDrives([fakeDrive(c1, 'Q3_CARD1'), fakeDrive(c2, 'Q3_CARD2')]);
    const id2 = await waitFor(async () => { const x = await inMain.diag(app); const id = sourceIdOf(x, 'Q3_CARD2'); return id && x.snapshot.sources.find(s => s.sourceId === id).assessment?.state === 'complete' ? id : null; }, 60000);
    await inMain.showPopup(app);
    const r2 = await waitFor(async () => cameraRows(app, id2), 10000);
    check(r2 && r2.heading === 'Camera' && r2.rows.length === 1 && r2.rows[0].name === 'Canon EOS R5' && r2.rows[0].badge === 'Body identified', `second card: its own camera list (${JSON.stringify(r2 && r2.rows)})`);

    // Removal during camera identification, then reconnection.
    setDrives([fakeDrive(c2, 'Q3_CARD2')]);
    await waitFor(async () => !sourceIdOf(await inMain.diag(app), 'Q3_CARD1'), 15000);
    setDrives([fakeDrive(c1, 'Q3_CARD1'), fakeDrive(c2, 'Q3_CARD2')]);
    const idR = await waitFor(async () => { const x = await inMain.diag(app); const id = sourceIdOf(x, 'Q3_CARD1'); const j = id && x.assessment.jobs.find(k => k.sourceId === id); return j && j.state === 'identifying' ? id : null; }, 30000, 20);
    if (idR) {
      setDrives([fakeDrive(c2, 'Q3_CARD2')]);
      const gone = await waitFor(async () => { const x = await inMain.diag(app); return !x.assessment.jobs.some(k => k.sourceId === idR) && x.assessment.running !== idR ? x : null; }, 15000, 20);
      check(!!gone, 'card removed during camera identification: job cancelled and dropped');
    } else {
      log('NOTE — identifying phase too short to catch; removal mid-phase covered by the unit test');
    }
    setDrives([fakeDrive(c1, 'Q3_CARD1'), fakeDrive(c2, 'Q3_CARD2')]);
    const idN = await waitFor(async () => { const x = await inMain.diag(app); const id = sourceIdOf(x, 'Q3_CARD1'); return id && id !== id1 && x.snapshot.sources.find(s => s.sourceId === id).assessment?.state === 'complete' ? id : null; }, 60000);
    d = await inMain.diag(app);
    const again = d.snapshot.sources.find(s => s.sourceId === idN);
    check(!!idN && again.assessment.cameras.cameras.length === 6, 'reconnected card assessed afresh with the same camera grouping');

    // Privacy: no fake serial anywhere the operator or a log could see it.
    await inMain.showPopup(app);
    await waitFor(async () => cameraRows(app, idN), 10000);
    const dom = await popupPage(app).evaluate(() => document.documentElement.outerHTML);
    const snap = JSON.stringify((await inMain.diag(app)).snapshot);
    const logFile = path.join(userDataDir, 'app.log');
    const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    const leaks = Object.values(FAKE).filter(v => dom.includes(v) || snap.includes(v) || logText.includes(v));
    check(leaks.length === 0, `no serial in popup DOM, snapshot or app log (${leaks.join(',') || 'none found'})`);
    check(!/\/card1\//.test(snap) && !snap.includes(work), 'no file path in the snapshot');

    const after = { ...(await snapshotTree(c1)), ...(await snapshotTree(c2)) };
    check(JSON.stringify(after) === JSON.stringify(before), 'card files unchanged');
    check(pageErrors.length === 0, `no renderer page errors (${JSON.stringify(pageErrors)})`);
  } catch (err) {
    failures++;
    log('FAIL — exception:', err && err.stack || err);
  } finally {
    await app.close().catch(() => {});
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
  log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
