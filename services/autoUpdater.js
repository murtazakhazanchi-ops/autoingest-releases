'use strict';

/**
 * services/autoUpdater.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles auto-update lifecycle via electron-updater + GitHub Releases.
 *
 * Flow:
 *   1. init() is called from main.js inside app.whenReady()
 *   2. 3 s after launch → check for update
 *   3. update:available  → renderer shows banner "Downloading update..."
 *   4. download-progress → renderer shows progress %
 *   5. update:ready      → renderer shows "Restart to update" banner
 *   6. user clicks Install → main calls autoUpdater.quitAndInstall()
 *   7. Re-checks every 4 h
 */

const { autoUpdater } = require('electron-updater');
const { app, ipcMain, BrowserWindow } = require('electron');
const { log } = require('./logger');
const telemetry = require('./telemetry');
const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const CHECK_ON_START_MS = 3_000;   // delay before first check
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ── Patch 43: track last update state for renderer replay ────────────────────
let _lastUpdateState = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function broadcast(channel, payload) {
  _lastUpdateState = { channel, payload }; // Patch 43: track for replay
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  });
}

// ── Init (Patch 41: idempotent) ───────────────────────────────────────────────
let _initDone = false;

function init() {
  if (_initDone) return;
  _initDone = true;
  // Silence electron-updater's own console spam — we use our logger instead
  autoUpdater.logger = null;

  // Don't auto-install on quit — we let the user trigger it
  autoUpdater.autoInstallOnAppQuit = false;

  // ── Events ──
  autoUpdater.on('update-available', (info) => {
    log(`Update available: v${info.version}`);
    broadcast('update:available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    log('No update available');
    fastRetryIndex = 0; // Patch 25: reset on successful check
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    broadcast('update:progress', { percent: pct });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    log(`Update downloaded: v${info.version} — ready to install`);
    broadcast('update:ready', { version: info.version });

    // Patch 52: atomic async write with tmp→rename
    try {
      const filePath = path.join(app.getPath('userData'), 'lastUpdate.json');
      const tmpPath  = filePath + '.tmp';
      const notes    = (info.releaseNotes || '').toString().slice(0, 50_000);
      await fs.promises.writeFile(tmpPath, JSON.stringify({ version: info.version, notes }), 'utf8');
      await fs.promises.rename(tmpPath, filePath);
    } catch (e) {
      log(`Failed to save update info: ${e.message}`);
    }
  });

  autoUpdater.on('error', (err) => {
    log(`AutoUpdater error: ${err.message}`);
    scheduleFastRetry(); // Patch 25: retry with backoff on error
  });

  // ── IPC: renderer requests install (Patch 42) ──
  ipcMain.on('update:install', async () => {
    log('User triggered update install — quitting and installing');

    try {
      await Promise.race([
        telemetry.flush().catch(() => {}),
        new Promise(r => setTimeout(r, 2000)),
      ]);
    } catch {}

    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (e) {
      log(`quitAndInstall failed: ${e.message} — falling back to manual relaunch`);
      app.relaunch();
      app.quit();
    }
  });

  // ── Schedule checks (Patch 25: backoff + periodic) ──
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify()
      .then(() => { fastRetryIndex = 0; })
      .catch(err => {
        log(`Update check failed: ${err.message}`);
        scheduleFastRetry();
      });
  }, CHECK_ON_START_MS);

  log('AutoUpdater initialised');
}

// ── Patch 25: exponential backoff retry ──────────────────────────────────────
const FAST_RETRY_DELAYS = [30_000, 60_000, 120_000, 300_000, 600_000];
let fastRetryIndex  = 0;
let fastRetryTimer  = null;
let recheckTimer    = null;

function scheduleFastRetry() {
  if (fastRetryIndex >= FAST_RETRY_DELAYS.length) {
    if (!recheckTimer) {
      recheckTimer = setInterval(() => {
        autoUpdater.checkForUpdatesAndNotify().catch(err =>
          log(`Periodic update check failed: ${err.message}`));
      }, RECHECK_INTERVAL_MS);
    }
    return;
  }
  const delay = FAST_RETRY_DELAYS[fastRetryIndex++];
  fastRetryTimer = setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify()
      .then(() => { fastRetryIndex = 0; })
      .catch(err => { log(`Update retry failed: ${err.message}`); scheduleFastRetry(); });
  }, delay);
}

function getLastUpdateState() { return _lastUpdateState; }

module.exports = { init, getLastUpdateState };
