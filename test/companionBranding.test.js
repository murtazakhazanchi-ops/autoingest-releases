'use strict';

// AI-FEAT-061 Q1 — the companion uses the OFFICIAL AutoIngest app icon (assets/mac.icns,
// the icon the packaged app ships with), never a separately drawn logo:
//   - popup header: the official 64 px rendition (icns 'ic12', 32 pt @2x), byte-for-pixel;
//   - macOS menu bar: a monochrome template silhouette of the official emblem (A + I + arrow);
//   - Windows tray: the official emblem on the official navy tile, 16…48 px.
// The official renditions are read straight out of mac.icns, so this runs on any OS.
//
// Run: node test/companionBranding.test.js

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');

let passed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    console.error(`  FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

/** @returns {Buffer} the PNG payload of one chunk type in an .icns file */
function icnsChunk(file, type) {
  const buf = fs.readFileSync(file);
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o + 4);
    if (buf.subarray(o, o + 4).toString('latin1') === type) return buf.subarray(o + 8, o + len);
    o += len;
  }
  throw new Error(`${type} not found in ${file}`);
}

const raw = (input) => sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

/** Square PNG frames of a PNG-compressed .ico, in directory order. */
function icoFrames(file) {
  const ico = fs.readFileSync(file);
  const frames = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const o = 6 + 16 * i;
    frames.push(ico.subarray(ico.readUInt32LE(o + 12), ico.readUInt32LE(o + 12) + ico.readUInt32LE(o + 8)));
  }
  return frames;
}

// Emblem (A + I + arrow, above the wordmark) in the official 1024 px rendition.
const EMBLEM = { left: 167, top: 176, width: 600, height: 468 };

(async () => {
  const OFFICIAL_ICNS = path.join(ASSETS, 'mac.icns');

  // ── Popup header ─────────────────────────────────────────────────────────────
  await t('popup header shows the official app icon (img), not a drawn SVG logo', () => {
    const html = fs.readFileSync(path.join(ROOT, 'renderer', 'companion', 'companion.html'), 'utf8');
    assert.match(html, /<img class="brand-mark" src="app-icon\.png" width="32" height="32"/);
    assert.doesNotMatch(html, /<svg[^>]*brand-mark/);
    const css = fs.readFileSync(path.join(ROOT, 'renderer', 'companion', 'companion.css'), 'utf8');
    assert.match(css, /\.brand-mark \{ width: 32px; height: 32px; flex: none; \}/, 'header layout box unchanged');
  });

  await t('popup app-icon.png is pixel-identical to the official mac.icns 32 pt @2x rendition', async () => {
    const official = await raw(icnsChunk(OFFICIAL_ICNS, 'ic12'));
    const shipped = await raw(path.join(ROOT, 'renderer', 'companion', 'app-icon.png'));
    assert.equal(shipped.info.width, 64);
    assert.equal(shipped.info.height, 64);
    assert.ok(official.data.equals(shipped.data), 'pixels differ from the official icon');
  });

  // ── macOS menu-bar template ─────────────────────────────────────────────────
  const t1 = await raw(path.join(ASSETS, 'tray', 'trayTemplate.png'));
  const t2 = await raw(path.join(ASSETS, 'tray', 'trayTemplate@2x.png'));

  await t('menu-bar template: 16 pt tall, @2x exactly twice the @1x size', () => {
    assert.equal(t1.info.height, 16);
    assert.equal(t2.info.width, t1.info.width * 2);
    assert.equal(t2.info.height, t1.info.height * 2);
  });

  await t('menu-bar template: pure black + alpha (macOS tints it for light/dark menu bars)', () => {
    for (const { data } of [t1, t2]) {
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        assert.ok(data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0, 'non-black pixel in a template image');
        if (data[i + 3] > 127) ink++;
      }
      const coverage = ink / (data.length / 4);
      assert.ok(coverage > 0.2 && coverage < 0.7, `legible glyph coverage (${coverage.toFixed(2)})`);
    }
  });

  await t('menu-bar template is the official emblem silhouette (overlap with the official icon ≥ 80 %)', async () => {
    const { width, height } = t2.info;
    const official = await raw(await sharp(icnsChunk(OFFICIAL_ICNS, 'ic10')).extract(EMBLEM).resize(width, height, { fit: 'fill' }).png().toBuffer());
    let inter = 0, union = 0;
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      const r = official.data[o], g = official.data[o + 1], b = official.data[o + 2];
      const emblem = Math.max(r, g) > 110 || b > 150;          // white A, gold arrow, blue I
      const glyph = t2.data[o + 3] > 127;
      if (emblem && glyph) inter++;
      if (emblem || glyph) union++;
    }
    const iou = inter / union;
    assert.ok(iou >= 0.8, `IoU ${iou.toFixed(2)}`);
  });

  // ── Windows tray ────────────────────────────────────────────────────────────
  await t('Windows tray.ico: square PNG frames 16…48 px for 100–300 % scaling', async () => {
    const sizes = [];
    for (const png of icoFrames(path.join(ASSETS, 'tray', 'tray.ico'))) {
      const { width, height } = await sharp(png).metadata();
      assert.equal(width, height);
      sizes.push(width);
    }
    assert.deepEqual(sizes, [16, 20, 24, 32, 40, 48]);
  });

  await t('Windows tray.ico carries the official branding: navy tile, white A, gold arrow, blue I', async () => {
    const frames = icoFrames(path.join(ASSETS, 'tray', 'tray.ico'));
    const { data } = await raw(frames[frames.length - 1]);
    let navy = 0, white = 0, gold = 0, blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 200) continue;
      if (r < 40 && g < 60 && b < 90) navy++;
      else if (r > 170 && g > 170 && b > 170) white++;
      else if (r > 150 && r - b > 70) gold++;
      else if (b > 120 && b - r > 80) blue++;
    }
    for (const [name, n] of Object.entries({ navy, white, gold, blue })) assert.ok(n >= 8, `${name} pixels: ${n}`);
  });

  // ── Packaged app branding is untouched ──────────────────────────────────────
  await t('companion code loads the tray assets, never the app/Dock icon files', () => {
    const src = fs.readFileSync(path.join(ROOT, 'services', 'companionService.js'), 'utf8');
    assert.match(src, /'tray', 'trayTemplate\.png'/);
    assert.match(src, /'tray', 'tray\.ico'/);
    assert.doesNotMatch(src, /mac\.icns|win\.ico/);
  });

  console.log(`${passed} passed`);
})();
