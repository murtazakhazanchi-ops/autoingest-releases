'use strict';

/**
 * rawPreviewService.js — Main-process service.
 *
 * Extracts a large-format preview from RAW camera files using:
 *   macOS   → QuickLook (qlmanage) at 1200px
 *   Windows → PowerShell + System.Drawing (requires OS RAW codec support)
 *
 * Returns a file:// URL on success, null on failure or unsupported platform.
 * The renderer falls back to getThumb() when null is returned.
 *
 * Cache key: SHA-1(normalized-path + ":" + size + ":" + mtimeMs)
 * Cache TTL: 30 days (stale entries evicted on next access)
 */

const { app }           = require('electron');
const path              = require('path');
const fs                = require('fs');
const fsp               = require('fs').promises;
const crypto            = require('crypto');
const os                = require('os');
const { execFile }      = require('child_process');
const { pathToFileURL } = require('url');
const { safeStat, safeExists }  = require('../services/fileUtils');
const { RAW_EXTENSIONS }        = require('../config/app.config.js');

const PREVIEW_SIZE_PX  = 1200;
const QLMANAGE_TIMEOUT = 12_000;
const WIN_PS_TIMEOUT   = 12_000;
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_VALID_BYTES  = 5_000;

let _cacheDir = null;

function getCacheDir() {
  if (_cacheDir) return _cacheDir;
  _cacheDir = path.join(app.getPath('userData'), 'raw-preview-cache');
  fs.mkdirSync(_cacheDir, { recursive: true });
  return _cacheDir;
}

function makeCacheKey(srcPath, stat) {
  const raw = `${path.normalize(srcPath)}:${stat.size}:${stat.mtimeMs}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

// ── macOS: qlmanage QuickLook ────────────────────────────────────────────────
async function extractViaQlmanage(srcPath) {
  const hash   = crypto.createHash('sha1').update(srcPath).digest('hex').slice(0, 12);
  const tmpDir = path.join(os.tmpdir(), `autoingest-rawpv-${hash}`);

  try {
    await fsp.mkdir(tmpDir, { recursive: true });
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const safeResolve = (val) => { if (settled) return; settled = true; resolve(val); };

    let timer;
    const proc = execFile(
      'qlmanage',
      ['-t', '-s', String(PREVIEW_SIZE_PX), '-o', tmpDir, srcPath],
      async (err) => {
        clearTimeout(timer);
        if (err) { safeResolve(null); return; }

        const outFile = path.join(tmpDir, `${path.basename(srcPath)}.png`);
        try {
          await safeStat(outFile);
          safeResolve(outFile);
        } catch {
          safeResolve(null);
        }
      }
    );

    timer = setTimeout(() => {
      proc.kill('SIGKILL');
      safeResolve(null);
    }, QLMANAGE_TIMEOUT);
  });
}

// ── Windows: PowerShell + System.Drawing ────────────────────────────────────
// Requires Windows RAW codec support (Microsoft Camera Codec Pack or OEM drivers).
// Returns null without throwing when codecs are absent — renderer falls back to
// getThumb() automatically.
//
// Paths are passed via environment variables (RAWPV_SRC / RAWPV_OUT), never
// interpolated into the script string, so spaces, unicode, and special characters
// in file paths cannot cause injection or quoting errors.
async function extractViaWin32(srcPath) {
  const t0      = Date.now();
  const hash    = crypto.createHash('sha1').update(srcPath).digest('hex').slice(0, 12);
  const tmpDir  = path.join(os.tmpdir(), `autoingest-rawpv-${hash}`);
  const outFile = path.join(tmpDir, `${path.basename(srcPath)}.png`);

  try {
    await fsp.mkdir(tmpDir, { recursive: true });
  } catch {
    return null;
  }

  const psScript = [
    'Add-Type -AssemblyName System.Drawing',
    'try {',
    '  $src = [System.Drawing.Image]::FromFile($env:RAWPV_SRC)',
    '  $mx  = 1200',
    '  $r   = [Math]::Min(1.0, [Math]::Min($mx / $src.Width, $mx / $src.Height))',
    '  $w   = [Math]::Max(1, [int]($src.Width  * $r))',
    '  $h   = [Math]::Max(1, [int]($src.Height * $r))',
    '  $bmp = [System.Drawing.Bitmap]::new($w, $h)',
    '  $g   = [System.Drawing.Graphics]::FromImage($bmp)',
    '  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '  $g.DrawImage($src, 0, 0, $w, $h)',
    '  $g.Dispose(); $src.Dispose()',
    '  $bmp.Save($env:RAWPV_OUT, [System.Drawing.Imaging.ImageFormat]::Png)',
    '  $bmp.Dispose()',
    '  exit 0',
    '} catch { exit 1 }',
  ].join('\n');

  return new Promise((resolve) => {
    let settled = false;
    const safeResolve = (val) => { if (settled) return; settled = true; resolve(val); };

    let timer;
    const proc = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { env: { ...process.env, RAWPV_SRC: srcPath, RAWPV_OUT: outFile } },
      (err) => {
        clearTimeout(timer);
        const elapsed = Date.now() - t0;
        if (err) {
          console.error(`[rawPreview][win] ${err.killed ? 'timeout' : 'codec-fail'} | ${elapsed}ms | ${srcPath}`);
          safeResolve(null);
          return;
        }
        console.log(`[rawPreview][win] extracted in ${elapsed}ms`);
        safeResolve(outFile);
      }
    );

    timer = setTimeout(() => {
      proc.kill('SIGKILL');
      safeResolve(null);
    }, WIN_PS_TIMEOUT);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────
async function getRawPreview(srcPath) {
  if (!srcPath || typeof srcPath !== 'string') return null;

  const platform = process.platform;
  if (platform !== 'darwin' && platform !== 'win32') return null;

  const normalized = path.normalize(srcPath);

  // Extension guard — authoritative list lives in config/app.config.js only
  const ext = path.extname(normalized).toLowerCase();
  if (!RAW_EXTENSIONS.includes(ext)) return null;

  let stat;
  try {
    stat = await safeStat(normalized);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const key  = makeCacheKey(normalized, stat);
  const dest = path.join(getCacheDir(), `${key}.png`);

  if (await safeExists(dest)) {
    try {
      const cs = await fsp.stat(dest);
      if (Date.now() - cs.mtimeMs <= MAX_CACHE_AGE_MS && cs.size >= MIN_VALID_BYTES) {
        console.log(`[rawPreview][cache] hit | ${path.basename(normalized)}`);
        return pathToFileURL(dest).href;
      }
      await fsp.unlink(dest).catch(() => {});
    } catch {}
  }

  console.log(`[rawPreview][cache] miss | ${path.basename(normalized)}`);
  const tmpFile = platform === 'darwin'
    ? await extractViaQlmanage(normalized)
    : await extractViaWin32(normalized);

  if (!tmpFile) return null;

  try {
    const ts = await fsp.stat(tmpFile);
    if (ts.size < MIN_VALID_BYTES) return null;
    await fsp.copyFile(tmpFile, dest);
    fsp.rm(path.dirname(tmpFile), { recursive: true, force: true }).catch(() => {});
    return pathToFileURL(dest).href;
  } catch {
    return null;
  }
}

module.exports = { getRawPreview };
