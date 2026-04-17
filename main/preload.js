'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ── Generic low-level bridge (backwards compatibility) ────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (channel, data) => ipcRenderer.send(channel, data),
  invoke:      (channel, data) => ipcRenderer.invoke(channel, data),
  onMessage:   (channel, cb)   => ipcRenderer.on(channel, (_e, ...a) => cb(...a))
});

// ── Forward renderer-side errors to main process for crash reporting ──────────
// These listeners run in the preload context (full Node access) and relay
// window-level JS errors and unhandled rejections to crashReporter.js via IPC.
// Throttled to max 1 IPC send per event type per 5 seconds to reduce noise.
const _errThrottle      = {};
const ERROR_THROTTLE_MS = 5_000;

window.addEventListener('error', (e) => {
  const now = Date.now();
  if (_errThrottle.error && now - _errThrottle.error < ERROR_THROTTLE_MS) return;
  _errThrottle.error = now;
  ipcRenderer.send('renderer:error', {
    message: e.message  || 'Unknown error',
    source:  e.filename || '',
    lineno:  e.lineno   || 0,
    stack:   e.error && e.error.stack ? e.error.stack : '',
  });
});

window.addEventListener('unhandledrejection', (e) => {
  const now = Date.now();
  if (_errThrottle.rejection && now - _errThrottle.rejection < ERROR_THROTTLE_MS) return;
  _errThrottle.rejection = now;
  ipcRenderer.send('renderer:unhandledRejection', {
    reason: e.reason instanceof Error ? e.reason.message : String(e.reason || ''),
    stack:  e.reason instanceof Error ? (e.reason.stack || '') : '',
  });
});
contextBridge.exposeInMainWorld('api', {

  // ── App info ──
  getVersion: () => require('../package.json').version,

  // ── Drives ──
  getDrives:       () => ipcRenderer.invoke('drives:get'),
  ejectDrive:      (mountpoint) => ipcRenderer.invoke('drive:eject', mountpoint),
  onDrivesUpdated: (cb) => ipcRenderer.on('drives:updated', (_e, cards) => cb(cards)),

  // ── File browser ──
  getFiles: (drivePath, folderPath = null, requestId = null) =>
    ipcRenderer.invoke('files:get', { drivePath, folderPath, requestId }),
  onFilesBatch: (cb) => {
    const listener = (_e, batch) => cb(batch);
    ipcRenderer.on('files:batch', listener);
    return () => ipcRenderer.removeListener('files:batch', listener);
  },

  // ── Destination ──
  getDefaultDest: () => ipcRenderer.invoke('dest:getDefault'),
  chooseDest:     () => ipcRenderer.invoke('dest:choose'),

  /**
   * Scans destination folder and returns { filename: sizeBytes } map.
   * Used for pre-import duplicate detection and file-grid indicators.
   * Returns {} if folder doesn't exist yet.
   *
   * @param {string} destPath
   * @returns {Promise<Object.<string, number>>}
   */
  scanDest: (destPath) => ipcRenderer.invoke('dest:scanFiles', destPath),

  // ── Import ──
  importFiles: (filePaths, destination) =>
    ipcRenderer.invoke('files:import', { filePaths, destination }),

  onImportProgress: (cb) =>
    ipcRenderer.on('import:progress', (_e, progress) => cb(progress)),

  pauseCopy:  () => ipcRenderer.send('copy:pause'),
  resumeCopy: () => ipcRenderer.send('copy:resume'),

  /**
   * Returns a URL for a small cached thumbnail (max 160px, JPEG 50%).
   * Generated on first call, cached on disk for all subsequent calls.
   * Returns null if the source is unreadable.
   *
   * @param {string} srcPath  Absolute path of the source image
   * @returns {Promise<string|null>}
   */
  getThumb: (srcPath) => ipcRenderer.invoke('thumb:get', srcPath),

  /**
   * Send a user feedback report to Google Sheets via the main process.
   * Also used by the crash-recovery auto-open flow.
   *
   * @param {{ reporter, issueType, severity, description, includeLog }} opts
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  sendFeedback: (opts) => ipcRenderer.invoke('feedback:send', opts),

  // ── Auto-update ──
  /** Fires when a new version is available and download begins. cb({ version }) */
  onUpdateAvailable: (cb) =>
    ipcRenderer.on('update:available', (_e, info) => cb(info)),

  /** Fires during download with progress. cb({ percent: 0-100 }) */
  onUpdateProgress: (cb) =>
    ipcRenderer.on('update:progress', (_e, info) => cb(info)),

  /** Fires when download is complete and app is ready to restart. cb({ version }) */
  onUpdateReady: (cb) =>
    ipcRenderer.on('update:ready', (_e, info) => cb(info)),

  /** Triggers quit-and-install immediately. */
  installUpdate: () => ipcRenderer.send('update:install'),

  // ── Global import index ──
  /** Returns { lowercaseFilename: { size, addedAt } } for cross-session already-imported detection. */
  getImportIndex: () => ipcRenderer.invoke('importIndex:get'),

  // ── What's New ──
  /** Returns { version, notes } if the app just updated, null otherwise. Consumed once. */
  getLastUpdateInfo: () => ipcRenderer.invoke('getLastUpdateInfo'),

});
