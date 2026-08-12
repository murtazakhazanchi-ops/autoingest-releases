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
const settings = require('./settings');
const fs   = require('fs');
const path = require('path');

// ── Part 9: update channel awareness ─────────────────────────────────────────
// electron-updater's GitHub provider resolves updates through two
// independent layers (verified from node_modules/electron-updater/out/
// providers/GitHubProvider.js and AppUpdater.js, not from memory):
//   Layer 1 — allowPrerelease=false (the default for any plain "X.Y.Z"
//     currentVersion) resolves via GET {repo}/releases/latest, which is
//     GitHub's own API and by definition excludes every prerelease/draft
//     release. A Stable client cannot reach an RC release through this path
//     regardless of any channel string.
//   Layer 2 — allowPrerelease=true walks the full releases feed and picks
//     the release whose tag's semver prerelease component matches
//     autoUpdater.channel, then fetches "<channel>.yml"/"<channel>-mac.yml".
// "preview" here maps to the "rc" release channel — the user-facing label
// and the on-disk/CI channel name are deliberately different so the
// Settings UI can rename the tier later without touching the release
// pipeline's own vocabulary.
const RC_UPDATE_CHANNEL = 'rc';

// AppUpdater's `channel` setter throws if you try to reset an
// already-set channel back to null (verified from AppUpdater.js: the
// validation branch only runs "if (this._channel != null)", and rejects a
// non-string new value in that case) — so returning to Stable must set the
// channel to the literal string "latest" rather than attempting to unset
// it. This resolves identically to leaving it unset (GitHubProvider's own
// getDefaultChannelName() is exactly getCustomChannelName("latest")), so
// there is no behavioral difference, only a valid-string requirement to
// satisfy. allowPrerelease is a plain property with no such restriction and
// is set explicitly both directions since it is the property that actually
// gates Layer 1 vs Layer 2.
function applyChannelSetting(channelPref) {
  if (channelPref === 'preview') {
    autoUpdater.channel = RC_UPDATE_CHANNEL;
    autoUpdater.allowPrerelease = true;
    // allowDowngrade=true is a deliberate side effect of the channel setter
    // here (see the comment above it) — a Preview user's currently-installed
    // RC can be numerically ahead of the latest Stable release (e.g.
    // 0.9.13-rc.1 vs. Stable 0.9.12); without allowDowngrade, they could
    // never receive Stable again after opting back out of Preview. Left as
    // the setter's own default for this branch only.
  } else {
    autoUpdater.channel = 'latest';
    autoUpdater.allowPrerelease = false;
    // The channel setter (AppUpdater.js) unconditionally sets
    // allowDowngrade=true as a side effect of ANY assignment — its own doc
    // comment says "If this behavior is not suitable for you, simply set
    // allowDowngrade explicitly after." Code-review-verified regression:
    // without this line, applyChannelSetting('stable') — which runs at
    // every app launch via init(), for every install, not just users who
    // ever touch the Preview setting — would silently flip allowDowngrade
    // to true for the entire existing install base, re-enabling an
    // auto-downgrade code path (isUpdateAvailable(): `allowDowngrade &&
    // isLatestVersionOlder`) that did not exist before this feature.
    // Restoring electron-updater's own pre-existing default here.
    autoUpdater.allowDowngrade = false;
  }
}

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

  // Apply the user's update-channel preference before the first check ever
  // runs. A missing/unrecognized setting resolves to "stable" (see
  // settings.getUpdateChannel()'s own default), so an existing install
  // upgrading into Part 9 behaves identically to today.
  applyChannelSetting(settings.getUpdateChannel());

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

module.exports = { init, getLastUpdateState, applyChannelSetting };
