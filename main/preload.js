// @ts-nocheck
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Patch 50: centralized listener tracking for clean teardown on reload
const _renderListeners = new Map();

function _register(channel, wrapped) {
  if (!_renderListeners.has(channel)) _renderListeners.set(channel, new Set());
  _renderListeners.get(channel).add(wrapped);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
    _renderListeners.get(channel)?.delete(wrapped);
  };
}

window.addEventListener('beforeunload', () => {
  for (const [channel, listeners] of _renderListeners) {
    for (const l of listeners) ipcRenderer.removeListener(channel, l);
  }
  _renderListeners.clear();
});

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
  onDrivesUpdated: (cb) => _register('drives:updated', (_e, cards) => cb(cards)),

  // ── File browser ──
  getFiles: (drivePath, folderPath = null, requestId = null) =>
    ipcRenderer.invoke('files:get', { drivePath, folderPath, requestId }),
  onFilesBatch: (cb) => _register('files:batch', (_e, batch) => cb(batch)),

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

  onImportProgress: (cb) => _register('import:progress', (_e, progress) => cb(progress)),

  pauseCopy:  () => ipcRenderer.send('copy:pause'),
  resumeCopy: () => ipcRenderer.send('copy:resume'),
  abortCopy:  () => ipcRenderer.send('copy:abort'),

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
  onUpdateAvailable: (cb) => _register('update:available', (_e, info) => cb(info)),
  onUpdateProgress:  (cb) => _register('update:progress',  (_e, info) => cb(info)),
  onUpdateReady:     (cb) => _register('update:ready',     (_e, info) => cb(info)),
  installUpdate:     ()   => ipcRenderer.send('update:install'),

  // ── Global import index ──
  getImportIndex: () => ipcRenderer.invoke('importIndex:get'),

  // ── Checksum verification ──
  runChecksumVerification: () => ipcRenderer.invoke('checksum:run'),
  cancelChecksum: () => ipcRenderer.send('checksum:cancel'),
  onChecksumProgress: (cb) => _register('checksum:progress', (_e, data) => cb(data)),
  onChecksumComplete: (cb) => _register('checksum:complete', (_e, data) => cb(data)),

  // ── What's New ──
  getLastUpdateInfo: () => ipcRenderer.invoke('getLastUpdateInfo'),

  // ── Update state replay (Patch 45) ──
  getLastUpdateState: () => ipcRenderer.invoke('update:getLastState'),

  // ── Controlled lists ──
  getLists:    (name)                                  => ipcRenderer.invoke('lists:get',        name),
  addToList:   (name, value)                           => ipcRenderer.invoke('lists:add',        name, value),
  matchList:   (name, input)                           => ipcRenderer.invoke('lists:match',      name, input),
  learnAlias:  (name, canonicalId, label, typedInput)  => ipcRenderer.invoke('lists:learnAlias', name, canonicalId, label, typedInput),

  // ── Master folder operations ──
  chooseArchiveRoot:        ()                       => ipcRenderer.invoke('master:chooseArchiveRoot'),
  chooseExistingMaster:     (startPath)              => ipcRenderer.invoke('master:chooseExisting', startPath),
  validateMasterAccessible: (folderPath)             => ipcRenderer.invoke('master:validateAccessible', folderPath),
  checkMasterExists:        (basePath, folderName)   => ipcRenderer.invoke('master:checkExists', basePath, folderName),
  createMaster:             (basePath, folderName)   => ipcRenderer.invoke('master:create',      basePath, folderName),

  // ── Settings (persisted preferences) ──
  getArchiveRootSetting:    ()                       => ipcRenderer.invoke('settings:getArchiveRoot'),
  setArchiveRootSetting:    (value)                  => ipcRenderer.invoke('settings:setArchiveRoot', value),

});