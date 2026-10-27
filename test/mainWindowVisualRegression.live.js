'use strict';

// AI-FEAT-061 Q1 — main-window visual regression (DEC-027 UI freeze).
// Captures the same main-window screens from a BASELINE checkout (e.g. an export of
// origin/stable/0.9) and from this checkout, under identical conditions (fresh
// userData, OS drive enumeration stubbed to "no drives", same synthetic folder
// source, same window size), then pixel-compares them.
//
// Run: node test/mainWindowVisualRegression.live.js <baselineRoot> [outDir]
//   baselineRoot must have node_modules resolvable (a symlink to this checkout's is fine).

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BASELINE_ROOT = path.resolve(process.argv[2] || '');
const OUT_DIR = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'ai-q1-visual'));
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const WINDOW = { width: 1280, height: 820 };
const SETTLE_MS = 3500;

async function makeFolderFixture() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q1-visual-src-'));
  for (let i = 1; i <= 12; i++) {
    await fsp.writeFile(path.join(dir, `IMG_${String(i).padStart(4, '0')}.JPG`), Buffer.alloc(2048, i));
  }
  return dir;
}

async function capture(root, label, folderSource) {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), `ai-q1-visual-${label}-`));
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [root, '--user-data-dir=' + userDataDir, '--no-sandbox'], cwd: root, timeout: 60000 });
  const shots = {};
  try {
    await app.evaluate((_e, mainJs) => {
      const req = process.getBuiltinModule('module').createRequire(mainJs);
      req('drivelist').list = async () => [];
    }, path.join(root, 'main', 'main.js'));
    let win = await app.firstWindow({ timeout: 60000 });
    await win.waitForTimeout(SETTLE_MS);
    shots.splash = path.join(OUT_DIR, `${label}-splash.png`);
    await win.screenshot({ path: shots.splash, animations: 'disabled' });

    const mainPromise = app.waitForEvent('window', { predicate: p => p.url().endsWith('index.html'), timeout: 30000 });
    const create = await win.evaluate(() => { const el = document.getElementById('splashCreate'); return !!el && getComputedStyle(el).display !== 'none'; });
    if (create) { await win.fill('#splashInputName', 'Visual Regression'); await win.fill('#splashInputRole', 'QA'); await win.click('#splashCreateStartBtn'); }
    else { await win.click('#splashContinueBtn').catch(() => {}); }
    win = await mainPromise;
    await win.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }, size) => {
      const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().endsWith('index.html'));
      w.setSize(size.width, size.height); w.center();
    }, WINDOW);
    await win.evaluate(() => { if (typeof obFinish === 'function') obFinish(); });
    await win.waitForTimeout(SETTLE_MS);
    shots.landing = path.join(OUT_DIR, `${label}-landing.png`);
    await win.screenshot({ path: shots.landing, animations: 'disabled' });

    await win.evaluate((p) => window.selectSource({ type: 'local-folder', path: p, label: 'Visual Fixture' }), folderSource);
    await win.waitForTimeout(SETTLE_MS + 1500);
    shots.folderBrowse = path.join(OUT_DIR, `${label}-folder-browse.png`);
    await win.screenshot({ path: shots.folderBrowse, animations: 'disabled' });
  } finally {
    await app.close().catch(() => {});
    await fsp.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
  return shots;
}

async function diff(a, b, outPath) {
  const [ia, ib] = await Promise.all([sharp(a).raw().ensureAlpha().toBuffer({ resolveWithObject: true }), sharp(b).raw().ensureAlpha().toBuffer({ resolveWithObject: true })]);
  if (ia.info.width !== ib.info.width || ia.info.height !== ib.info.height) {
    return { sizeMismatch: `${ia.info.width}x${ia.info.height} vs ${ib.info.width}x${ib.info.height}`, differing: -1 };
  }
  const out = Buffer.alloc(ia.data.length);
  let differing = 0;
  for (let i = 0; i < ia.data.length; i += 4) {
    const d = Math.abs(ia.data[i] - ib.data[i]) + Math.abs(ia.data[i + 1] - ib.data[i + 1]) + Math.abs(ia.data[i + 2] - ib.data[i + 2]);
    if (d > 0) { differing++; out[i] = 255; out[i + 3] = 255; } else { out[i] = out[i + 1] = out[i + 2] = ia.data[i] >> 2; out[i + 3] = 255; }
  }
  if (differing) await sharp(out, { raw: { width: ia.info.width, height: ia.info.height, channels: 4 } }).png().toFile(outPath);
  return { differing, total: ia.data.length / 4 };
}

(async () => {
  if (!process.argv[2]) { console.error('usage: node test/mainWindowVisualRegression.live.js <baselineRoot> [outDir]'); process.exit(2); }
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const folder = await makeFolderFixture();
  try {
    const base = await capture(BASELINE_ROOT, 'baseline', folder);
    const cand = await capture(PROJECT_ROOT, 'q1', folder);
    let failures = 0;
    for (const key of Object.keys(base)) {
      const r = await diff(base[key], cand[key], path.join(OUT_DIR, `diff-${key}.png`));
      const ok = r.differing === 0;
      if (!ok) failures++;
      console.log(`${ok ? 'PASS' : 'DIFF'} — ${key}: ${r.sizeMismatch ? 'size mismatch ' + r.sizeMismatch : `${r.differing} of ${r.total} pixels differ`}`);
    }
    console.log(`screenshots: ${OUT_DIR}`);
    process.exit(failures ? 1 : 0);
  } finally {
    await fsp.rm(folder, { recursive: true, force: true }).catch(() => {});
  }
})().catch((err) => { console.error(err); process.exit(1); });
