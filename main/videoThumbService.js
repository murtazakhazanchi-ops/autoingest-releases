'use strict';

/**
 * videoThumbService.js — Main-process service.
 *
 * Extracts a thumbnail frame from MP4/MOV files using:
 *   macOS → QuickLook (qlmanage) at 300px
 *   Windows → not supported; returns null (renderer shows text fallback)
 *
 * Returns a file:// URL on success, null on failure or unsupported platform.
 *
 * Cache key: SHA-1(normalized-path + ":" + size + ":" + mtimeMs)
 * Cache TTL: 7 days (matches thumbnailer.js)
 */

const { app }           = require('electron');
const path              = require('path');
const fs                = require('fs');
const fsp               = require('fs').promises;
const crypto            = require('crypto');
const os                = require('os');
const { execFile }      = require('child_process');
const { pathToFileURL } = require('url');
const { safeStat, safeExists } = require('../services/fileUtils');
const { VIDEO_EXTENSIONS }     = require('../config/app.config.js');

function fmtBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  return `${(bytes / 1e3).toFixed(0)}KB`;
}

const THUMB_SIZE_PX    = 300;
const QLMANAGE_TIMEOUT = 12_000;
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_VALID_BYTES  = 5_000;

let _cacheDir = null;

function getCacheDir() {
  if (_cacheDir) return _cacheDir;
  _cacheDir = path.join(app.getPath('userData'), 'video-thumbnail-cache');
  fs.mkdirSync(_cacheDir, { recursive: true });
  return _cacheDir;
}

function makeCacheKey(srcPath, stat) {
  const raw = `${path.normalize(srcPath)}:${stat.size}:${stat.mtimeMs}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

async function extractViaQlmanage(srcPath) {
  const hash   = crypto.createHash('sha1').update(srcPath).digest('hex').slice(0, 12);
  const tmpDir = path.join(os.tmpdir(), `autoingest-vidthumb-${hash}`);

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
      ['-t', '-s', String(THUMB_SIZE_PX), '-o', tmpDir, srcPath],
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

async function getVideoThumb(srcPath) {
  if (!srcPath || typeof srcPath !== 'string') return null;
  if (process.platform !== 'darwin') return null;

  const normalized = path.normalize(srcPath);
  const ext = path.extname(normalized).toLowerCase();
  if (!VIDEO_EXTENSIONS.includes(ext)) return null;

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
        console.log(`[videoThumb][cache] hit | ${path.basename(normalized)}`);
        return pathToFileURL(dest).href;
      }
      await fsp.unlink(dest).catch(() => {});
    } catch {}
  }

  const sz = fmtBytes(stat.size);
  console.log(`[videoThumb][cache] miss → extracting | ${sz} | ${path.basename(normalized)}`);
  const t0      = Date.now();
  const tmpFile = await extractViaQlmanage(normalized);

  if (!tmpFile) {
    console.log(`[videoThumb][mac] fallback:null | ${Date.now() - t0}ms | ${sz} | ${path.basename(normalized)}`);
    return null;
  }

  try {
    const ts = await fsp.stat(tmpFile);
    if (ts.size < MIN_VALID_BYTES) {
      console.log(`[videoThumb][mac] fallback:too-small | ${Date.now() - t0}ms | ${sz} | ${path.basename(normalized)}`);
      return null;
    }
    await fsp.copyFile(tmpFile, dest);
    fsp.rm(path.dirname(tmpFile), { recursive: true, force: true }).catch(() => {});
    console.log(`[videoThumb][mac] extracted in ${Date.now() - t0}ms | ${sz} | ${path.basename(normalized)}`);
    return pathToFileURL(dest).href;
  } catch {
    return null;
  }
}

module.exports = { getVideoThumb };
