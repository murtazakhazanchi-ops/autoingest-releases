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
  platform:   process.platform,

  // ── Drives ──
  getDrives:       () => ipcRenderer.invoke('drives:get'),
  ejectDrive:      (mountpoint) => ipcRenderer.invoke('drive:eject', mountpoint),
  onDrivesUpdated:    (cb) => _register('drives:updated',    (_e, cards) => cb(cards)),
  onAllDrivesUpdated: (cb) => _register('drives:allUpdated', (_e, cards) => cb(cards)),

  // ── File browser ──
  getFiles: (drivePath, folderPath = null, requestId = null) =>
    ipcRenderer.invoke('files:get', { drivePath, folderPath, requestId }),
  getFolders:    (drivePath)   => ipcRenderer.invoke('folders:get',    { drivePath }),
  getFilesDirect: (folderPath) => ipcRenderer.invoke('files:getDirect', { folderPath }),
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
  importFiles: (filePaths, destination, options = {}) =>
    ipcRenderer.invoke('files:import', { filePaths, destination, ...options }),

  /**
   * Event-based import using the fileJobs model (G2).
   * Each job routes its file to an individual archive destination:
   *   archiveRoot/Collection/Event/[SubEvent/]Photographer/[VIDEO/]filename
   *
   * @param {Array<{src: string, dest: string}>} fileJobs
   * @returns {Promise<{ copied, skipped, errors, ... }>}
   */
  importFileJobs: (fileJobs) =>
    ipcRenderer.invoke('files:importJobs', { fileJobs }),
  commitImportTransaction: (fileJobs, eventJsonPath, auditContext = {}) =>
    ipcRenderer.invoke('import:commitTransaction', { fileJobs, eventJsonPath, ...auditContext }),

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
  getThumb:      (srcPath) => ipcRenderer.invoke('thumb:get',               srcPath),
  getVideoThumb: (srcPath) => ipcRenderer.invoke('thumbnail:getVideoThumb', srcPath),

  // ── User / operator identity ──
  listUsers:      ()         => ipcRenderer.invoke('users:list'),
  createUser:     (profile)  => ipcRenderer.invoke('users:create',    profile),
  getActiveUser:  ()         => ipcRenderer.invoke('users:getActive'),
  setActiveUser:  (userId)   => ipcRenderer.invoke('users:setActive', userId),
  splashComplete: ()         => ipcRenderer.invoke('splash:complete'),

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
  onChecksumProgress:      (cb) => _register('checksum:progress',      (_e, data) => cb(data)),
  onChecksumComplete:      (cb) => _register('checksum:complete',      (_e, data) => cb(data)),
  onSyncJobProgress:       (cb) => _register('sync:jobProgress',       (_e, data) => cb(data)),
  onSyncChecksumProgress:  (cb) => _register('sync:checksumProgress',  (_e, data) => cb(data)),

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
  scanMasterEvents:         (masterPath)             => ipcRenderer.invoke('master:scanEvents',   masterPath),
  parseEvent:               (folderName)             => ipcRenderer.invoke('master:parseEvent',   folderName),
  renameEvent:              (masterPath, oldName, newName) => ipcRenderer.invoke('master:renameEvent', masterPath, oldName, newName),

  // ── Settings (persisted preferences) ──
  getArchiveRootSetting:    ()                       => ipcRenderer.invoke('settings:getArchiveRoot'),
  setArchiveRootSetting:    (value)                  => ipcRenderer.invoke('settings:setArchiveRoot', value),
  getLastDestPath:          ()                       => ipcRenderer.invoke('settings:getLastDestPath'),
  setLastDestPath:          (p)                      => ipcRenderer.invoke('settings:setLastDestPath', p),
  getLastEvent:             ()                       => ipcRenderer.invoke('settings:getLastEvent'),
  setLastEvent:             (v)                      => ipcRenderer.invoke('settings:setLastEvent', v),
  verifyLastEvent:          (collectionPath, eventFolderPath) => ipcRenderer.invoke('settings:verifyLastEvent', collectionPath, eventFolderPath),
  resolveArchiveEventPath:  (rootPath, collectionName, eventFolderName) => ipcRenderer.invoke('settings:resolveArchiveEventPath', rootPath, collectionName, eventFolderName),
  getAutoMetadataEnabled:   ()                       => ipcRenderer.invoke('settings:getAutoMetadataEnabled'),
  setAutoMetadataEnabled:   (v)                      => ipcRenderer.invoke('settings:setAutoMetadataEnabled', v),

  // ── Archive Operations ──
  getArchiveOperationsStatus: ()    => ipcRenderer.invoke('archive:getOperationsStatus'),
  setNasRoot:                 (v)   => ipcRenderer.invoke('archive:setNasRoot', v),
  validateNasRoot:            (v)   => ipcRenderer.invoke('archive:validateNasRoot', v),
  setLocalStagingRoot:        (v)   => ipcRenderer.invoke('archive:setLocalStagingRoot', v),
  validateLocalStagingRoot:   (v)   => ipcRenderer.invoke('archive:validateLocalStagingRoot', v),
  setDefaultImportMode:       (v)   => ipcRenderer.invoke('archive:setDefaultImportMode', v),
  setMainArchiveRoot:         (v)   => ipcRenderer.invoke('archive:setMainArchiveRoot', v),
  validateMainArchiveRoot:    (v)   => ipcRenderer.invoke('archive:validateMainArchiveRoot', v),
  initArchiveRoot:            (v)   => ipcRenderer.invoke('archive:initArchiveRoot', v),
  getDeviceIdentity:          ()    => ipcRenderer.invoke('archive:getDeviceIdentity'),
  resolveEffectiveArchiveRoot: ()   => ipcRenderer.invoke('archive:resolveEffectiveRoot'),

  // ── Archive NAS Event List ──
  scanNasEvents:            ()            => ipcRenderer.invoke('archive:scanNasEvents'),
  refreshNasEvents:         ()            => ipcRenderer.invoke('archive:refreshNasEvents'),
  getCachedNasEvents:       ()            => ipcRenderer.invoke('archive:getCachedNasEvents'),
  clearNasEventCache:       ()            => ipcRenderer.invoke('archive:clearNasEventCache'),
  scanStagingCollections:   (stagingRoot) => ipcRenderer.invoke('archive:scanStagingCollections', stagingRoot),

  // ── Local mirror service ──
  previewLocalMirror:   (params) => ipcRenderer.invoke('archive:previewLocalMirror',   params),
  ensureLocalMirror:    (params) => ipcRenderer.invoke('archive:ensureLocalMirror',    params),
  getLocalMirrorStatus: (params) => ipcRenderer.invoke('archive:getLocalMirrorStatus', params),

  // ── Local sync manifest ──
  writeSyncManifest: (localEventPath, manifest) => ipcRenderer.invoke('archive:writeSyncManifest', { localEventPath, manifest }),
  readSyncManifest:  (localEventPath)            => ipcRenderer.invoke('archive:readSyncManifest',  { localEventPath }),
  appendSyncJob:     (localEventPath, job)       => ipcRenderer.invoke('archive:appendSyncJob',     { localEventPath, job }),

  // ── Durable sync queue ──
  refreshSyncQueue:    ()       => ipcRenderer.invoke('archive:refreshSyncQueue'),
  getSyncQueue:        ()       => ipcRenderer.invoke('archive:getSyncQueue'),
  getSyncQueueSummary: ()       => ipcRenderer.invoke('archive:getSyncQueueSummary'),
  readSyncJob:         (jobId)  => ipcRenderer.invoke('archive:readSyncJob', jobId),

  // ── Background archive sync ──
  syncJobNow:             (jobId)   => ipcRenderer.invoke('archive:syncJobNow',            jobId),
  syncAllReadyJobs:       ()        => ipcRenderer.invoke('archive:syncAllReadyJobs'),
  pauseJob:               (jobId)   => ipcRenderer.invoke('archive:pauseJob',              jobId),
  verifyJobChecksum:      (jobId)   => ipcRenderer.invoke('archive:verifyJobChecksum',     jobId),
  checkDirectArchiveLocks: (payload) => ipcRenderer.invoke('archive:checkDirectArchiveLocks', payload),

  // ── Sync slot coordination (advisory) ──
  requestSyncSlot: (jobId) => ipcRenderer.invoke('archive:requestSyncSlot', jobId),
  releaseSyncSlot: (jobId) => ipcRenderer.invoke('archive:releaseSyncSlot', jobId),
  cancelSyncSlot:  (jobId) => ipcRenderer.invoke('archive:cancelSyncSlot',  jobId),

  // ── Transfer Export ──
  chooseTransferRoot:                    ()                        => ipcRenderer.invoke('archive:chooseTransferRoot'),
  getTransferRoot:                       ()                        => ipcRenderer.invoke('archive:getTransferRoot'),
  getTransferExportTree:                 ()                        => ipcRenderer.invoke('archive:getTransferExportTree'),
  validateTransferRoot:                  (v)                       => ipcRenderer.invoke('archive:validateTransferRoot', v),
  previewTransferExport:                 (scope)                   => ipcRenderer.invoke('archive:previewTransferExport',              { scope }),
  runTransferExport:                     (scope, operatorName)     => ipcRenderer.invoke('archive:runTransferExport',                  { scope, operatorName }),
  getTransferExportStatus:               ()                        => ipcRenderer.invoke('archive:getTransferExportStatus'),
  pauseTransferExport:                   ()                        => ipcRenderer.invoke('archive:pauseTransferExport'),
  resumeTransferExport:                  ()                        => ipcRenderer.invoke('archive:resumeTransferExport'),
  getTransferExportCheckpoint:           ()                        => ipcRenderer.invoke('archive:getTransferExportCheckpoint'),
  clearTransferExportCheckpoint:         ()                        => ipcRenderer.invoke('archive:clearTransferExportCheckpoint'),
  resumeTransferExportFromCheckpoint:    (operatorName)            => ipcRenderer.invoke('archive:resumeTransferExportFromCheckpoint', { operatorName }),
  verifyTransferExport:                  (scope)                   => ipcRenderer.invoke('archive:verifyTransferExport',               { scope }),

  // ── Transfer Import ──
  getTransferDriveCollections:           ()                        => ipcRenderer.invoke('archive:getTransferDriveCollections'),
  previewTransferImport:                 (scope)                   => ipcRenderer.invoke('archive:previewTransferImport',              { scope }),
  runTransferImport:                     (scope, operatorName)     => ipcRenderer.invoke('archive:runTransferImport',                  { scope, operatorName }),
  getTransferImportStatus:               ()                        => ipcRenderer.invoke('archive:getTransferImportStatus'),
  pauseTransferImport:                   ()                        => ipcRenderer.invoke('archive:pauseTransferImport'),
  resumeTransferImport:                  ()                        => ipcRenderer.invoke('archive:resumeTransferImport'),
  getTransferImportCheckpoint:           ()                        => ipcRenderer.invoke('archive:getTransferImportCheckpoint'),
  clearTransferImportCheckpoint:         ()                        => ipcRenderer.invoke('archive:clearTransferImportCheckpoint'),
  resumeTransferImportFromCheckpoint:    (operatorName)            => ipcRenderer.invoke('archive:resumeTransferImportFromCheckpoint', { operatorName }),
  verifyTransferImport:                  (scope)                   => ipcRenderer.invoke('archive:verifyTransferImport',               { scope }),

  // ── Archive Diagnostics ──
  runDiagnostics:          (scope)    => ipcRenderer.invoke('archive:runDiagnostics',       { scope }),
  getDiagnosticsStatus:    ()         => ipcRenderer.invoke('archive:getDiagnosticsStatus'),
  getDiagnosticsReport:    ()         => ipcRenderer.invoke('archive:getDiagnosticsReport'),
  runAdoptionPreview:        (scope)  => ipcRenderer.invoke('archive:runAdoptionPreview',        { scope }),
  getAdoptionPreviewStatus:  ()       => ipcRenderer.invoke('archive:getAdoptionPreviewStatus'),
  getAdoptionPreviewReport:  ()       => ipcRenderer.invoke('archive:getAdoptionPreviewReport'),
  dryRunAdoptionCandidate:   (params) => ipcRenderer.invoke('archive:dryRunAdoptionCandidate',   params),
  adoptManualFolder:         (input)  => ipcRenderer.invoke('archive:adoptManualFolder',         input),
  releaseStaleLock:        (lockPath) => ipcRenderer.invoke('archive:releaseStaleLock',     { lockPath }),
  cleanupTempFile:         (tempPath) => ipcRenderer.invoke('archive:cleanupTempFile',      { tempPath }),
  markSyncIssueReviewed:   (ref)      => ipcRenderer.invoke('archive:markSyncIssueReviewed', ref),
  getSyncIssueReviews:     ()         => ipcRenderer.invoke('archive:getSyncIssueReviews'),
  generateConsistencyReport:   ()     => ipcRenderer.invoke('archive:generateConsistencyReport'),
  getConsistencyReport:        ()     => ipcRenderer.invoke('archive:getConsistencyReport'),
  generateCompletenessChecklist: ()   => ipcRenderer.invoke('archive:generateCompletenessChecklist'),
  getCompletenessChecklist:      ()   => ipcRenderer.invoke('archive:getCompletenessChecklist'),
  generateAuditTimeline:         ()   => ipcRenderer.invoke('archive:generateAuditTimeline'),
  getAuditTimeline:              ()   => ipcRenderer.invoke('archive:getAuditTimeline'),

  // ── EXIF metadata service ──
  getMetadataStatus:      (batchId)            => ipcRenderer.invoke('metadata:getStatus',     batchId),
  retryMetadata:          (batchId)            => ipcRenderer.invoke('metadata:retry',          batchId),
  reapplyEventMetadata:   (eventFolderPath)    => ipcRenderer.invoke('metadata:reapplyEvent',   eventFolderPath),
  getMetadataLastRun:     (eventFolderPath)    => ipcRenderer.invoke('metadata:getLastRun',     eventFolderPath),
  onMetadataProgress:     (cb) => _register('metadata:progress', (_e, progress) => cb(progress)),

  // ── Event JSON (disk-backed event persistence) ──
  writeEventJson:   (eventFolderPath, eventData) => ipcRenderer.invoke('event:write',         eventFolderPath, eventData),
  readEventJson:    (eventFolderPath)            => ipcRenderer.invoke('event:read',          eventFolderPath),
  updateEventJson:  (eventFolderPath, patch)     => ipcRenderer.invoke('event:update',        eventFolderPath, patch),
  appendImports:    (eventFolderPath, entries)   => ipcRenderer.invoke('event:appendImports', eventFolderPath, entries),

  // ── Directory operations ──
  ensureDir:       (dirPath)           => ipcRenderer.invoke('dir:ensure',       dirPath),
  findDirByPrefix: (basePath, prefix)  => ipcRenderer.invoke('dir:findByPrefix', basePath, prefix),
  dirExists:          (dirPath) => ipcRenderer.invoke('dir:exists',          dirPath),
  dirHasContent:      (dirPath) => ipcRenderer.invoke('dir:hasContent',      dirPath),
  dirInspectContent:  (dirPath) => ipcRenderer.invoke('dir:inspectContent',  dirPath),
  renameDir:       (oldPath, newPath)  => ipcRenderer.invoke('dir:rename',       oldPath, newPath),

  // ── Window controls ──
  minimize:       () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  close:          () => ipcRenderer.invoke('window:close'),

  // ── Date engine ──
  getTodayDate:      ()                   => ipcRenderer.invoke('date:getToday'),
  convertToHijri:    (isoDate)            => ipcRenderer.invoke('date:toHijri',     isoDate),
  convertToGregorian:(hijri)              => ipcRenderer.invoke('date:toGregorian', hijri),
  getHijriCalendar:  (year, month)        => ipcRenderer.invoke('date:getCalendar', year, month),

  // ── Audit (read-only, on-demand) ──
  verifyEventIntegrity: (eventPath) => ipcRenderer.invoke('audit:verifyEvent', eventPath),

  // ── Source cleanup (post-import only) ──
  deleteFromSource: (files, sourceRoot) => ipcRenderer.invoke('files:deleteFromSource', files, sourceRoot),

  // ── Media preview ──
  getPreviewUrl: (srcPath) => ipcRenderer.invoke('files:getPreviewUrl',   srcPath),
  getRawPreview: (srcPath) => ipcRenderer.invoke('preview:getRawPreview', srcPath),

  // ── Metadata Sync ──
  metadataSyncScanPending:        (masterPath)       => ipcRenderer.invoke('metadataSync:scanPending',        masterPath),
  metadataSyncSyncEvent:          (eventFolderPath)  => ipcRenderer.invoke('metadataSync:syncEvent',          eventFolderPath),
  metadataSyncSyncStatus:         (eventFolderPath)  => ipcRenderer.invoke('metadataSync:syncStatus',         eventFolderPath),
  metadataSyncPreviewEvent:       (eventFolderPath)  => ipcRenderer.invoke('metadataSync:previewEvent',       eventFolderPath),
  metadataSyncScanEventFolder:    (eventFolderPath)  => ipcRenderer.invoke('metadataSync:scanEventFolder',    eventFolderPath),
  metadataSyncListEventsInMaster: (masterPath)       => ipcRenderer.invoke('metadataSync:listEventsInMaster', masterPath),
  metadataSyncChooseEventFolder:  ()                 => ipcRenderer.invoke('metadataSync:chooseEventFolder'),

  // ── Keyword Registry ──
  keywordsUpdateFromBridgeTxt: (filePath, apply) => ipcRenderer.invoke('keywords:updateFromBridgeTxt', filePath, apply),
  keywordsChooseBridgeTxt:     ()                => ipcRenderer.invoke('keywords:chooseBridgeTxt'),
  keywordsLoadRegistry:        ()                => ipcRenderer.invoke('keywords:loadRegistry'),
  keywordsRepairIds:           ()                => ipcRenderer.invoke('keywords:repairIds'),
  keywordsSaveCityCountry:     (cityLabel, countryLabel) => ipcRenderer.invoke('keywords:saveCityCountry', cityLabel, countryLabel),

  // ── Offline Collection Registry ──
  prepareOffline:              (params) => ipcRenderer.invoke('collection:prepareOffline',       params),
  readCollectionLink:          (params) => ipcRenderer.invoke('collection:readLink',              params),
  matchCollectionToNas:        (params) => ipcRenderer.invoke('collection:matchToNas',           params),
  listProvisionalCollections:  ()       => ipcRenderer.invoke('collection:listProvisional'),
  writeProvisionalLink:        (params) => ipcRenderer.invoke('collection:writeProvisionalLink', params),

  // ── Online Registry (advisory — prepare local shells from remote registry entries) ──
  registryGetAll:                ()       => ipcRenderer.invoke('registry:getAll'),
  prepareCollectionFromRegistry: (params) => ipcRenderer.invoke('collection:prepareFromRegistry', params),
  prepareEventFromRegistry:      (params) => ipcRenderer.invoke('event:prepareFromRegistry',      params),
  publishEventToRegistry:        (params) => ipcRenderer.invoke('event:publishRegistry',          params),
  onRealtimeRegistryEntry:       (cb)     => _register('realtime:registry:entry', (_e, ev) => cb(ev)),

  // ── Photographer Folder Sequencing ──
  getPhotographerFolders:      (params) => ipcRenderer.invoke('event:getPhotographerFolders',    params),
  applyPhotographerSequence:   (params) => ipcRenderer.invoke('event:applyPhotographerSequence', params),

  // ── Team Live (advisory only — never writes authoritative files) ──
  reportTeamActivity: (data) => ipcRenderer.invoke('team:reportActivity', data),
  onTeamUpdate:          (cb) => _register('realtime:team:update',    (_e, data) => cb(data)),
  onSyncSlotGranted:     (cb) => _register('realtime:syncSlot:granted', (_e, data) => cb(data)),
  onSyncSlotUpdate:      (cb) => _register('realtime:syncSlot:update',  (_e, data) => cb(data)),
  getTeamLiveSnapshot:   ()   => ipcRenderer.invoke('realtime:getTeamLiveSnapshot'),
  getAppVersion:         ()   => ipcRenderer.invoke('app:getVersion'),

  // ── Realtime Operations (advisory only — never writes authoritative files) ──
  getRealtimeStatus:        ()          => ipcRenderer.invoke('realtime:getStatus'),
  getRealtimeSettings:      ()          => ipcRenderer.invoke('realtime:getSettings'),
  configureRealtime:        (cfg)       => ipcRenderer.invoke('realtime:configure', cfg),
  testRealtimeConnection:   (serverUrl, serverKey) => ipcRenderer.invoke('realtime:testConnection', { serverUrl, serverKey }),
  getRealtimeKnownNames:    ()          => ipcRenderer.invoke('realtime:getKnownNames'),
  onRealtimeStatus:         (cb)        => _register('realtime:statusChanged', (_e, s) => cb(s)),
  onRealtimeEvent:          (cb)        => _register('realtime:event',         (_e, ev) => cb(ev)),

});
