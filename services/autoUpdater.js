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
const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const CHECK_ON_START_MS = 3_000;   // delay before first check
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ── Helpers ───────────────────────────────────────────────────────────────────
function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
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
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    broadcast('update:progress', { percent: pct });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log(`Update downloaded: v${info.version} — ready to install`);
    broadcast('update:ready', { version: info.version });

    // Persist release notes so the renderer can show "What's New" after restart.
    // Written here (pre-quit) and deleted by main.js on the next launch after reading.
    try {
      const filePath = path.join(app.getPath('userData'), 'lastUpdate.json');
      fs.writeFileSync(filePath, JSON.stringify({
        version: info.version,
        notes:   info.releaseNotes || ''
      }), 'utf8');
    } catch (e) {
      log(`Failed to save update info: ${e.message}`);
    }
  });

  autoUpdater.on('error', (err) => {
    log(`AutoUpdater error: ${err.message}`);
    // Silently log — never show errors to user (bad network etc.)
  });

  // ── IPC: renderer requests install ──
  ipcMain.on('update:install', () => {
    log('User triggered update install — quitting and installing');
    const { app } = require('electron');

    // Force relaunch registration before quit — fixes Mac not reopening after update
    app.relaunch();

    // Short delay so renderer can show "Restarting..." before process dies
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (e) {
        log(`quitAndInstall failed: ${e.message} — forcing quit`);
      }
      // Hard fallback: if quitAndInstall stalls, force quit after 3s
      // app.relaunch() above guarantees it comes back up
      setTimeout(() => app.quit(), 3000);
    }, 500);
  });

  // ── Schedule checks ──
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      log(`Update check failed: ${err.message}`);
    });
  }, CHECK_ON_START_MS);

  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      log(`Periodic update check failed: ${err.message}`);
    });
  }, RECHECK_INTERVAL_MS);

  log('AutoUpdater initialised');
}

module.exports = { init };
